import type { Day } from '#lib/engine/day.ts';
import type { Db } from './db/index.ts';
import { runUserIn } from './engine-run.ts';

// The cut-over from v0 (balances, proposing rules and month closes) to the ledger, one user at a
// time and in one transaction. Runs once per user (B11); a second run changes nothing. The v0
// tables stay, read-only, until after v1.0.0.
//
// - Each account opens its ledger on `today` with its balance (a debt as a negative balance, so
//   net worth is always the plain sum of the ledger). An archived one did not count in v0's net
//   worth, so it opens nothing: it stays archived, with its last balance in Cuentas.
// - Each v0 rule becomes a generating rule; the watermark at `today` keeps it from generating the
//   past, which the balances already hold.
// - Each confirmed close becomes the account's month in the history. Outside flows before the
//   cut-over are unknown: returns count from it.
export function migrateUserToLedger(db: Db, userId: string, today: string) {
  return db.transaction((tx) => migrateIn(tx, userId, today));
}

async function migrateIn(tx: Db, userId: string, today: string) {
  const done = await tx.query(`select 1 from engine_state where user_id = $1 for update`, [userId]);
  if (done.length) return false;

  await tx.query(
    `insert into movement (account_id, day, kind, amount_cents, source, occurrence_key, note)
     select id, $2, 'apertura', case when kind = 'deuda' then -balance_cents else balance_cents end,
            'migracion', 'migracion:' || id, 'Saldo al pasar al libro'
     from money_account where user_id = $1 and balance_cents <> 0 and archived_at is null`,
    [userId, today],
  );
  await tx.query(
    `update money_account set kind = case kind
       when 'inversion' then 'broker' when 'deuda' then 'deuda_prestamo' when 'otro' then 'bien'
       else kind end, updated_at = now()
     where user_id = $1`,
    [userId],
  );
  await tx.query(
    `insert into auto_rule (user_id, name, kind, frequency, day, start_on, end_on, from_account_id,
       to_account_id, amount_cents, active, created_at)
     select user_id, name,
       case type when 'entra' then 'ingreso' when 'sale' then 'gasto' else 'transferencia' end,
       frequency, case when frequency = 'una_vez' then null else day end,
       -- A one-off on its day, clamped to the month (31 in February is the 28th or 29th).
       case when frequency = 'una_vez'
         then least(start_month + (day - 1), (start_month + interval '1 month - 1 day')::date)
         else start_month end,
       (end_month + interval '1 month - 1 day')::date,
       from_account_id, to_account_id, amount_cents, active, created_at
     from rule where user_id = $1`,
    [userId],
  );
  await tx.query(
    `insert into account_month (account_id, month, value_cents, flows_cents)
     select l.account_id, c.month,
            case when l.is_debt then -l.confirmed_cents else l.confirmed_cents end, 0
     from month_close c join month_close_line l on l.close_id = c.id
     where c.user_id = $1 and c.status = 'confirmado'`,
    [userId],
  );
  await tx.query(`insert into engine_state (user_id, processed_through) values ($1, $2)`, [
    userId,
    today,
  ]);
  return true;
}

// What a v0 user sees on Inicio: each account not archived at its balance (a debt as negative).
const v0Values = (tx: Db, userId: string) =>
  tx.query<{ id: string; v: string }>(
    `select id, (case when kind = 'deuda' then -balance_cents else balance_cents end)::text as v
     from money_account where user_id = $1 and archived_at is null`,
    [userId],
  );

export type CutOverDiff = { account: string; before: number; after: number };

export class CutOverMismatch extends Error {
  readonly diffs: CutOverDiff[];
  constructor(diffs: CutOverDiff[]) {
    super(`Net worth differs after the cut-over: ${JSON.stringify(diffs)}`);
    this.diffs = diffs;
  }
}

// The cut-over and its first run inside `tx`, and what differs between v0's Inicio and the
// ledger's after it, account by account and in total. Null if the user was already on the ledger.
async function cutOver(tx: Db, userId: string, today: Day) {
  // Two first requests at once: the second waits here and finds the user already moved.
  await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [userId]);
  const before = await v0Values(tx, userId);
  if (!(await migrateIn(tx, userId, today))) return null;
  await runUserIn(tx, userId, today);
  const [row] = await tx.query<{ total: string; accounts: Record<string, [number]> }>(
    `select total_cents::text as total, accounts from user_day
     where user_id = $1 order by day desc limit 1`,
    [userId],
  );
  const diffs: CutOverDiff[] = before
    .map((a) => ({ account: a.id, before: Number(a.v), after: row?.accounts[a.id]?.[0] ?? 0 }))
    .filter((d) => d.before !== d.after);
  const total = before.reduce((s, a) => s + Number(a.v), 0);
  const after = Number(row?.total ?? 0);
  if (after !== total) diffs.push({ account: 'total', before: total, after });
  return { accounts: before.length, total, diffs };
}

// On the way into the app (B12 tarea 11): a v0 user goes to the ledger and gets the first run, in
// one transaction that commits only if every account and the total are worth after it what they
// were worth before; otherwise nothing changes, the user stays on v0 and the error says where.
// On the ledger already, the run catches up if the cron has not run for this user yet today.
export async function enterApp(db: Db, userId: string, today: Day) {
  const [state] = await db.query<{ through: string }>(
    `select processed_through::text as through from engine_state where user_id = $1`,
    [userId],
  );
  if (state) {
    if (state.through >= today) return 'al-dia' as const;
    await db.transaction((tx) => runUserIn(tx, userId, today));
    return 'puesto-al-dia' as const;
  }
  return db.transaction(async (tx) => {
    const done = await cutOver(tx, userId, today);
    if (!done) return 'al-dia' as const;
    if (done.diffs.length) throw new CutOverMismatch(done.diffs);
    return 'migrado' as const;
  });
}

class DryRun extends Error {}

// The same cut-over as a rehearsal: every v0 user, each in a transaction that is always rolled
// back, with what would differ. Nothing is written (the check before turning it on).
export async function rehearseCutOver(db: Db, today: Day) {
  const users = await db.query<{ id: string }>(
    `select u.id from "user" u where not exists (select 1 from engine_state s where s.user_id = u.id)
     order by u."createdAt", u.id`,
  );
  const report: { accounts: number; total: number; diffs: CutOverDiff[] }[] = [];
  for (const { id } of users)
    await db
      .transaction(async (tx) => {
        const done = await cutOver(tx, id, today);
        if (done) report.push(done);
        throw new DryRun();
      })
      .catch((e: unknown) => {
        if (!(e instanceof DryRun)) throw e;
      });
  return report;
}
