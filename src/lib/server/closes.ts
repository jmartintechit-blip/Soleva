import { redirect } from '@sveltejs/kit';
import { type Month, addMonths } from '#lib/engine/dates.ts';
import { type Rule, accrue, applyRules } from '#lib/engine/rules.ts';
import { type MoneyAccount, listAccounts } from './accounts.ts';
import type { Db } from './db/index.ts';
import { listRules } from './rules.ts';

// The month to close today (YYYY-MM-DD, Spain): the current one, or the previous one during the
// first 10 days while it is still open. Null when the current month is already closed.
export function monthToClose(today: string, lastClosed?: Month): Month | null {
  const current = today.slice(0, 7);
  if (lastClosed === current) return null;
  const previous = addMonths(current, -1);
  return Number(today.slice(8, 10)) <= 10 && (lastClosed ?? '') < previous ? previous : current;
}

export interface ProposedLine {
  account: MoneyAccount;
  // What the rules move this month, and the month's interest, return or depreciation (a debt's
  // interest is positive: it adds to what is owed). Both in cents.
  rulesCents: number;
  accrualCents: number;
  proposedCents: number;
}

// One month of rules, then one month of accrual, from today's balances. Never below zero.
export function propose(accounts: MoneyAccount[], rules: Rule[], month: Month): ProposedLine[] {
  const live = accounts.filter((a) => !a.archived);
  const moved = applyRules(live, rules, month);
  const accrual = accrue(live, moved);
  return live.map((a) => ({
    account: a,
    rulesCents: moved[a.id]! - a.balanceCents,
    accrualCents: accrual[a.id]!,
    proposedCents: Math.max(0, moved[a.id]! + accrual[a.id]!),
  }));
}

export async function lastClosedMonth(db: Db, userId: string): Promise<Month | undefined> {
  const [row] = await db.query<{ month: string }>(
    `select to_char(max(month), 'YYYY-MM') as month from month_close
     where user_id = $1 and status = 'confirmado'`,
    [userId],
  );
  return row?.month ?? undefined;
}

export async function proposeClose(db: Db, userId: string, month: Month) {
  const [accounts, rules] = await Promise.all([listAccounts(db, userId), listRules(db, userId)]);
  return propose(accounts, rules, month);
}

// Confirms the month in one go: the proposal is recomputed here, never taken from the browser,
// and the confirmed balances become the accounts' balances. Accounts left out keep the proposal.
// False when the month was already closed.
export async function confirmClose(
  db: Db,
  userId: string,
  month: Month,
  confirmed: Record<string, number>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const lines = await proposeClose(tx, userId, month);
    const [close] = await tx.query<{ id: string }>(
      `insert into month_close (user_id, month) values ($1, $2)
       on conflict (user_id, month) do nothing returning id`,
      [userId, `${month}-01`],
    );
    if (!close) return false;
    for (const l of lines) {
      const cents = confirmed[l.account.id] ?? l.proposedCents;
      await tx.query(
        `insert into month_close_line (close_id, user_id, account_id, is_debt, proposed_cents, confirmed_cents)
         values ($1, $2, $3, $4, $5, $6)`,
        [close.id, userId, l.account.id, l.account.kind === 'deuda', l.proposedCents, cents],
      );
      await tx.query(
        `update money_account set balance_cents = $3, updated_at = now() where user_id = $1 and id = $2`,
        [userId, l.account.id, cents],
      );
    }
    await tx.query(
      `update month_close set status = 'confirmado', confirmed_at = now() where id = $1`,
      [close.id],
    );
    return true;
  });
}

// Changes a confirmed balance and leaves the trace. Amending the latest closed month also moves
// the account's balance. False when the close or the line is not the user's (→ 404).
export async function amendClose(
  db: Db,
  userId: string,
  month: Month,
  accountId: string,
  newCents: number,
  reason: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx.query(
      `insert into close_amendment (close_id, account_id, previous_cents, new_cents, reason)
       select c.id, l.account_id, 0, $4, $5 from month_close c
       join month_close_line l on l.close_id = c.id and l.account_id = $3
       where c.user_id = $1 and c.month = $2 and c.status = 'confirmado'
       returning id`,
      [userId, `${month}-01`, accountId, newCents, reason],
    );
    if (rows.length === 0) return false;
    if ((await lastClosedMonth(tx, userId)) === month)
      await tx.query(
        `update money_account set balance_cents = $3, updated_at = now() where user_id = $1 and id = $2`,
        [userId, accountId, newCents],
      );
    return true;
  });
}

export interface ClosedLine {
  accountId: string;
  name: string;
  isDebt: boolean;
  proposedCents: number;
  confirmedCents: number;
  amendments: { previousCents: number; newCents: number; reason: string; at: string }[];
}

// A confirmed month with its lines and their amendments, or null (→ 404).
export async function getClose(db: Db, userId: string, month: Month) {
  const [close] = await db.query<{ id: string; confirmedAt: string }>(
    `select id, confirmed_at::text as "confirmedAt" from month_close
     where user_id = $1 and month = $2 and status = 'confirmado'`,
    [userId, `${month}-01`],
  );
  if (!close) return null;
  const lines = await db.query<ClosedLine & Record<string, unknown>>(
    `select l.account_id as "accountId", a.name, l.is_debt as "isDebt",
       l.proposed_cents::float8 as "proposedCents", l.confirmed_cents::float8 as "confirmedCents",
       coalesce(json_agg(json_build_object('previousCents', m.previous_cents, 'newCents', m.new_cents,
         'reason', m.reason, 'at', m.created_at) order by m.created_at)
         filter (where m.id is not null), '[]') as amendments
     from month_close_line l
     join money_account a on a.id = l.account_id
     left join close_amendment m on m.close_id = l.close_id and m.account_id = l.account_id
     where l.close_id = $1
     group by l.account_id, a.name, l.is_debt, l.proposed_cents, l.confirmed_cents, a.created_at
     order by a.created_at, l.account_id`,
    [close.id],
  );
  return { month, confirmedAt: close.confirmedAt, lines };
}

// Net worth per closed month, oldest first.
export const netWorthHistory = (db: Db, userId: string) =>
  db.query<{ month: Month; assetsCents: number; debtsCents: number; netCents: number }>(
    `select to_char(month, 'YYYY-MM') as month, assets_cents::float8 as "assetsCents",
       debts_cents::float8 as "debtsCents", net_cents::float8 as "netCents"
     from net_worth_monthly where user_id = $1 order by month`,
    [userId],
  );

// On the ledger the month close is gone (B12 tarea 11): Soleva keeps the balances itself and the
// accounts are squared in the cuadre, from Cuentas. Its pages send there.
export async function leaveClose(db: Db, userId: string) {
  const [ledger] = await db.query(`select 1 from engine_state where user_id = $1`, [userId]);
  if (ledger) redirect(303, '/cuentas');
}
