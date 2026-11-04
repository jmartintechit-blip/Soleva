import { type Day, addDays } from '#lib/engine/day.ts';
import { parseEuros } from '#lib/engine/money.ts';
import { MAX_CENTS } from './accounts.ts';
import { ruleAccounts } from './auto-rules.ts';
import type { Db } from './db/index.ts';
import { DEBT_KINDS } from './debts.ts';
import { rebuildHistory, valuesOn } from './engine-run.ts';

// The baja of a home, car, good or debt (B12): «Lo vendí o ya no lo tengo» from a day, which
// leaves the days before as they were, or «Borrar, lo añadí por error», which takes it out of all
// of history. Only its owner can do either.

const REMOVABLE = ['inmueble', 'vehiculo', 'bien', ...DEBT_KINDS];

export type MortgageChoice = 'liquidar' | 'mantener' | 'borrar';

export interface RemovalView {
  id: string;
  name: string;
  kind: string;
  isDebt: boolean;
  // Its own page (RInmueble, RCoche, RBien, RDeuda), to go back to.
  href: string;
  // The first day it can be given up from: the day it came into Soleva.
  openedOn: Day;
  closedOn: Day | null;
  // What it was worth (or owed, negative) on the last day of history.
  cents: number;
  // A property's mortgage still open: its owner chooses what happens to it.
  mortgage: { id: string; name: string; cents: number } | null;
  // Where the money of a sale can come in, or a debt be paid from.
  accounts: { id: string; name: string }[];
}

export async function removalView(db: Db, userId: string, id: string): Promise<RemovalView | null> {
  const [a] = await db.query<{
    name: string;
    kind: string;
    page: string | null;
    openedOn: string;
    closedOn: string | null;
    cents: number;
    mortgage: string | null;
  }>(
    `with last as (select accounts from user_day where user_id = $1 order by day desc limit 1)
     select a.name, a.kind, a.closed_on::text as "closedOn",
            coalesce(a.opened_on, (select min(m.day) from movement m where m.account_id = a.id),
                     a.created_at::date)::text as "openedOn",
            coalesce((select (l.accounts -> a.id ->> 0)::float8 from last l), 0) as cents,
            (select 'inmueble' from property where account_id = a.id
             union all select 'coche' from vehicle where account_id = a.id
             union all select 'bien' from asset where account_id = a.id limit 1) as page,
            (select json_build_object('id', d.id, 'name', d.name,
                'cents', coalesce((select (l.accounts -> d.id ->> 0)::float8 from last l), 0))
             from property p join money_account d on d.id = p.mortgage_account_id
             where p.account_id = a.id and d.closed_on is null)::text as mortgage
     from money_account a
     join account_access x on x.account_id = a.id and x.user_id = $1 and x.role = 'propietario'
     -- Only on the ledger: before the cut-over an account is deleted from its v0 page.
     where a.id = $2 and exists (select 1 from engine_state where user_id = $1)`,
    [userId, id],
  );
  if (!a || !REMOVABLE.includes(a.kind)) return null;
  const isDebt = DEBT_KINDS.includes(a.kind);
  const accounts = (await ruleAccounts(db, userId)).map(({ id, name }) => ({ id, name }));
  return {
    id,
    name: a.name,
    kind: a.kind,
    isDebt,
    href: `/cuentas/${id}${isDebt ? '/deuda' : a.page ? `/${a.page}` : ''}`,
    openedOn: a.openedOn,
    closedOn: a.closedOn,
    cents: a.cents,
    mortgage: a.mortgage ? JSON.parse(a.mortgage) : null,
    accounts,
  };
}

export interface CloseInput {
  on: Day;
  // A sale (or, for a debt, paying it off) whose money comes into (or leaves) an account.
  toAccountId?: string;
  // What the sale brought in; a debt is paid off for what it owes that day.
  amountCents?: number;
  mortgage?: MortgageChoice;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const longDate = (d: Day) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

// The form of «Lo vendí o ya no lo tengo» (for a debt, «La pagué o ya no la tengo»).
export function readCloseForm(form: FormData, view: RemovalView, today: Day) {
  const one = (k: string) => String(form.get(k) ?? '').trim();
  const values = Object.fromEntries(
    ['fecha', 'como', 'cuenta', 'importe', 'hipoteca'].map((k) => [k, one(k)]),
  );
  const errors: Record<string, string> = {};
  const on = values.fecha!;
  if (!ISO.test(on) || Number.isNaN(Date.parse(`${on}T12:00:00Z`)))
    errors.fecha = 'Pon el día, por ejemplo 01/10/2026';
  else if (on > today) errors.fecha = 'No puede ser después de hoy';
  else if (on < view.openedOn)
    errors.fecha = `Lo añadiste el ${longDate(view.openedOn)}: pon ese día o uno después`;
  const sold = view.isDebt ? values.como === 'pagada' : values.como === 'vendi';
  if (!sold && values.como !== 'ya_no') errors.como = 'Elige una opción';
  const to = sold && values.cuenta ? values.cuenta : undefined;
  if (to && !view.accounts.some((a) => a.id === to)) errors.cuenta = 'Elige una de tus cuentas';
  let amountCents: number | undefined;
  if (to && !view.isDebt) {
    const cents = values.importe ? parseEuros(values.importe) : null;
    if (cents === null || cents === undefined || !Number.isInteger(cents) || cents <= 0)
      errors.importe = values.importe
        ? 'Escribe un importe, por ejemplo 180.000'
        : 'Pon lo que te dieron';
    else if (cents > MAX_CENTS) errors.importe = 'Importe demasiado alto';
    else amountCents = cents;
  }
  let mortgage: MortgageChoice | undefined;
  if (view.mortgage) {
    if (!['liquidar', 'mantener', 'borrar'].includes(values.hipoteca!))
      errors.hipoteca = 'Elige qué pasa con la hipoteca';
    else mortgage = values.hipoteca as MortgageChoice;
  }
  if (Object.keys(errors).length) return { ok: false as const, values, errors };
  const input: CloseInput = { on, toAccountId: to, amountCents, mortgage };
  return { ok: true as const, values, input };
}

const insertMovement = (
  tx: Db,
  m: { accountId: string; day: Day; kind: string; cents: number; transferId?: string },
) =>
  tx.query(
    `insert into movement (account_id, day, kind, amount_cents, transfer_id, source, note)
     values ($1, $2, $3, $4, $5, 'manual', 'baja')`,
    [m.accountId, m.day, m.kind, m.cents, m.transferId ?? null],
  );

// Money moved between two own accounts on `day` (a sale's, or paying off a debt): never a gain.
async function move(
  tx: Db,
  day: Day,
  kind: 'transferencia' | 'amortizacion',
  from: string,
  to: string,
  cents: number,
) {
  const [{ t }] = await tx.query<{ t: string }>(`select gen_random_uuid()::text as t`);
  await insertMovement(tx, { accountId: from, day, kind, cents: -cents, transferId: t });
  await insertMovement(tx, { accountId: to, day, kind, cents, transferId: t });
}

// Every live movement of these accounts after `day`, the other leg of each of their transfers and
// a debt's interest (written in the payer's account): void, so nothing of them is left behind.
async function voidAfter(tx: Db, ids: string[], day: Day | null) {
  await tx.query(
    `with legs as (
       select distinct transfer_id from movement
       where account_id = any($1) and transfer_id is not null and ($2::date is null or day > $2))
     update movement set voided_at = now()
     where voided_at is null and ($2::date is null or day > $2) and (
       account_id = any($1) or transfer_id in (select transfer_id from legs)
       or occurrence_key like any (select 'debt:' || id || ':%' from unnest($1::text[]) as id))`,
    [ids, day],
  );
}

// Deleted with all it ever had (rules, details, movements by cascade), after voiding what it left
// in other accounts. Returns the first day it was in the ledger, or 'cerrada' when it is in a
// closed month of the old cierre (its foreign key refuses the delete).
async function deleteIn(tx: Db, userId: string, ids: string[]) {
  const [{ first }] = await tx.query<{ first: string | null }>(
    `select min(day)::text as first from movement where account_id = any($1)`,
    [ids],
  );
  await voidAfter(tx, ids, null);
  await tx.query(
    `delete from money_account where id = any($1) and id in (
       select account_id from account_access where user_id = $2 and role = 'propietario')`,
    [ids, userId],
  );
  return first;
}

// The day it was given up, if it was: its pages then show only that (and «Borrar»).
export async function closedOn(db: Db, id: string) {
  const [row] = await db.query<{ d: string | null }>(
    `select closed_on::text as d from money_account where id = $1`,
    [id],
  );
  return row?.d ?? null;
}

const isClosedMonth = (e: unknown) => (e as { code?: string }).code === '23503';

// «Lo vendí o ya no lo tengo» from `on`: the days before keep what it was worth; from `on` on it is
// not there. Sold into an account, the money comes in as a transfer (what it brought over its
// estimate is a gain of that day). Otherwise its value that day leaves as money taken out, so the
// days after show no loss. A debt is paid off from an account, or just stops counting. A home's
// mortgage is paid off the same day (from the account of the sale, if any), kept or deleted.
export async function closeAccount(db: Db, userId: string, view: RemovalView, input: CloseInput) {
  const { on } = input;
  try {
    return await db.transaction(async (tx) => {
      let from = addDays(on, -1);
      const mortgage = view.mortgage;
      if (mortgage && input.mortgage === 'borrar') {
        const first = await deleteIn(tx, userId, [mortgage.id]);
        if (first && addDays(first, -1) < from) from = addDays(first, -1);
      }
      const ids = [view.id, ...(mortgage && input.mortgage === 'liquidar' ? [mortgage.id] : [])];
      await voidAfter(tx, ids, on);
      const values = await valuesOn(tx, userId, on);
      const worth = (id: string) => values[id] ?? 0;
      const to = input.toAccountId;
      // What it is worth leaves as such (or a debt stops owing it), unless paid between accounts.
      const settle = async (id: string, paid: boolean) => {
        const cents = worth(id);
        if (paid && cents < 0) await move(tx, on, 'amortizacion', to!, id, -cents);
        else if (cents !== 0)
          await insertMovement(tx, { accountId: id, day: on, kind: 'ajuste', cents: -cents });
      };
      if (view.isDebt) await settle(view.id, !!to);
      else if (to && input.amountCents)
        await move(tx, on, 'transferencia', view.id, to, input.amountCents);
      else await settle(view.id, false);
      if (ids.length > 1) await settle(mortgage!.id, !!to);
      // A debt paid off on its own leaves its home without a mortgage.
      if (view.isDebt)
        await tx.query(
          `update property set mortgage_account_id = null where mortgage_account_id = $1`,
          [view.id],
        );
      if (mortgage && input.mortgage === 'mantener')
        await tx.query(`update property set mortgage_account_id = null where account_id = $1`, [
          view.id,
        ]);
      await tx.query(
        `update money_account set closed_on = $2, archived_at = coalesce(archived_at, now()),
           balance_cents = 0, updated_at = now()
         where id = any($1)`,
        [ids, on],
      );
      // Nothing of it is generated any more; its months after the baja are not its.
      await tx.query(
        `update auto_rule set active = false
         where from_account_id = any($1) or to_account_id = any($1)`,
        [ids],
      );
      await tx.query(
        `delete from account_month where account_id = any($1)
           and month >= date_trunc('month', $2::date)::date`,
        [ids, on],
      );
      await rebuildHistory(tx, userId, from);
      return true as const;
    });
  } catch (error) {
    if (isClosedMonth(error)) return 'cerrada' as const;
    throw error;
  }
}

// «Borrar, lo añadí por error»: as if it had never been entered, also on the days before. A home's
// mortgage is kept (unlinked) or deleted with it.
export async function removeAccount(
  db: Db,
  userId: string,
  view: RemovalView,
  mortgage: 'mantener' | 'borrar' = 'mantener',
) {
  try {
    return await db.transaction(async (tx) => {
      const ids = [view.id, ...(view.mortgage && mortgage === 'borrar' ? [view.mortgage.id] : [])];
      const first = await deleteIn(tx, userId, ids);
      if (first) await rebuildHistory(tx, userId, addDays(first, -1));
      return true as const;
    });
  } catch (error) {
    if (isClosedMonth(error)) return 'cerrada' as const;
    throw error;
  }
}
