import { type Day, addDays } from '#lib/engine/day.ts';
import { parseEuros } from '#lib/engine/money.ts';
import { MAX_CENTS } from './accounts.ts';
import { ruleAccounts } from './auto-rules.ts';
import type { Db } from './db/index.ts';
import { DEBT_KINDS } from './debts.ts';
import { generateFor, rebuildHistory, valuesOn } from './engine-run.ts';

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
  // Given up: what it was sold for, what it was worth (or owed) that day, and the account it was
  // given up with (a mortgage paid off with its home), whose baja is the one to undo.
  closing: {
    soldCents: number | null;
    worthCents: number;
    main: { id: string; name: string } | null;
    // Not when the account it went with has been deleted since.
    undoable: boolean;
  } | null;
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
    closing: { soldCents?: number | null; worthCents?: number; main?: string } | null;
    mainName: string | null;
  }>(
    `with last as (select accounts from user_day where user_id = $1 order by day desc limit 1)
     select a.name, a.kind, a.closed_on::text as "closedOn", a.closing,
            (select m.name from money_account m where m.id = a.closing ->> 'main') as "mainName",
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
    closing: a.closing
      ? {
          soldCents: a.closing.soldCents ?? null,
          worthCents: a.closing.worthCents ?? 0,
          main: a.closing.main && a.mainName ? { id: a.closing.main, name: a.mainName } : null,
          undoable: !a.closing.main || !!a.mainName,
        }
      : null,
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
  // Sold, what it brought is always said (it goes into an account or leaves); for nothing, it was
  // not a sale.
  if (sold && !view.isDebt) {
    const cents = values.importe ? parseEuros(values.importe) : null;
    if (!values.importe) errors.importe = 'Pon lo que te dieron';
    else if (cents === null || cents === undefined || !Number.isInteger(cents) || cents < 0)
      errors.importe = 'Escribe un importe, por ejemplo 180.000';
    else if (cents === 0) errors.importe = 'Por 0 € no es una venta: elige «Ya no lo tengo»';
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

// Every live movement of these accounts after `day`, the other leg of each of their transfers, a
// debt's interest (written in the payer's account) and what their rules made: void, so nothing of
// them is left behind.
async function voidAfter(tx: Db, ids: string[], day: Day | null, rules: string[] = []) {
  await tx.query(
    `with legs as (
       select distinct transfer_id from movement
       where (account_id = any($1) or rule_id = any($3)) and transfer_id is not null
         and ($2::date is null or day > $2))
     update movement set voided_at = now()
     where voided_at is null and ($2::date is null or day > $2) and (
       account_id = any($1) or rule_id = any($3) or transfer_id in (select transfer_id from legs)
       or occurrence_key like any (select 'debt:' || id || ':%' from unnest($1::text[]) as id))`,
    [ids, day, rules],
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

// What a baja did, kept on the account so it can be undone.
interface Closing {
  at: string;
  // How far the engine had gone: from there on it made nothing for what was given up.
  through: Day;
  also: string[];
  rules: string[];
  // A mortgage kept and unlinked from the home; the home a debt paid off alone was linked to.
  unlinked: string | null;
  home: string | null;
  soldCents: number | null;
  worthCents: number;
}

// «Lo vendí o ya no lo tengo» from `on`: the days before keep what it was worth; from `on` on it is
// not there. Sold, what it brought over its estimate is a gain of that day; the money comes into
// the chosen account as a transfer, or leaves (money taken out) if it went to none. Given away, its
// value that day leaves as money taken out, so no loss shows. A debt is paid off from an account,
// or just stops counting. A home's mortgage is paid off the same day (from the account of the
// sale, if any), kept or deleted. The rules about it (IBI, insurance, rent) stop with it, and
// whatever it or they made after `on` is voided.
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
      const rules = (
        await tx.query<{ id: string }>(
          `select id from auto_rule where user_id = $1 and active
             and (from_account_id = any($2) or to_account_id = any($2) or asset_account_id = any($2))`,
          [userId, ids],
        )
      ).map((r) => r.id);
      const [{ through }] = await tx.query<{ through: string }>(
        `select processed_through::text as through from engine_state where user_id = $1`,
        [userId],
      );
      await voidAfter(tx, ids, on, rules);
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
      const sold = !view.isDebt ? input.amountCents : undefined;
      if (view.isDebt) await settle(view.id, !!to);
      else if (sold && to) await move(tx, on, 'transferencia', view.id, to, sold);
      else if (sold)
        await insertMovement(tx, { accountId: view.id, day: on, kind: 'ajuste', cents: -sold });
      else await settle(view.id, false);
      if (ids.length > 1) await settle(mortgage!.id, !!to);
      // A debt paid off on its own leaves its home without a mortgage.
      const [home] = view.isDebt
        ? await tx.query<{ id: string }>(
            `update property set mortgage_account_id = null where mortgage_account_id = $1
             returning account_id as id`,
            [view.id],
          )
        : [];
      const unlinked = mortgage && input.mortgage === 'mantener' ? mortgage.id : null;
      if (unlinked)
        await tx.query(`update property set mortgage_account_id = null where account_id = $1`, [
          view.id,
        ]);
      const closing: Omit<Closing, 'at'> = {
        through: through!,
        also: ids.slice(1),
        rules,
        unlinked,
        home: home?.id ?? null,
        soldCents: sold ?? null,
        worthCents: worth(view.id),
      };
      await tx.query(
        `update money_account set closed_on = $2, archived_at = now(), balance_cents = 0,
           updated_at = now(),
           closing = jsonb_build_object('at', now()) || case when id = $3 then $4::jsonb
             else jsonb_build_object('main', $3::text, 'worthCents', ($5::jsonb ->> id)::float8) end
         where id = any($1)`,
        [ids, on, view.id, JSON.stringify(closing), JSON.stringify(values)],
      );
      // Nothing of it is generated any more; its months after the baja are not its.
      if (rules.length)
        await tx.query(
          `update auto_rule set active = false, updated_at = now() where id = any($1)`,
          [rules],
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

// «Deshacer la baja»: it counts again from the day it was given up, as if it never had been. What
// the baja wrote is voided; what it voided is entered again (but not what belonged to a mortgage
// deleted with it); its rules start again and their links come back; what the engine did not make
// for it while it was given up is made now; and the history from that day is rebuilt. An account
// closed along with another (a mortgage paid off with its home) undoes that one's baja.
export async function undoClosing(db: Db, userId: string, id: string) {
  return db.transaction((tx) => undoIn(tx, userId, id));
}

async function undoIn(tx: Db, userId: string, id: string): Promise<boolean> {
  const [a] = await tx.query<{ on: string; closing: Closing | { main: string } | null }>(
    `select a.closed_on::text as on, a.closing from money_account a
     join account_access x on x.account_id = a.id and x.user_id = $1 and x.role = 'propietario'
     where a.id = $2 and a.closed_on is not null`,
    [userId, id],
  );
  if (!a?.closing) return false;
  if ('main' in a.closing) return undoIn(tx, userId, a.closing.main);
  const c = a.closing;
  const ids = [id, ...c.also];
  await tx.query(
    `update movement set voided_at = now()
     where voided_at is null and note = 'baja' and (account_id = any($1) or transfer_id in (
       select transfer_id from movement where account_id = any($1) and note = 'baja'
         and transfer_id is not null))`,
    [ids],
  );
  await tx.query(
    `insert into movement (account_id, day, seq, kind, amount_cents, instrument_id, qty_e8,
       price_e8, fx_e8, fee_cents, withholding_cents, transfer_id, source, rule_id, provisional,
       replaces_id, note)
     select m.account_id, m.day, m.seq, m.kind, m.amount_cents, m.instrument_id, m.qty_e8,
            m.price_e8, m.fx_e8, m.fee_cents, m.withholding_cents,
            case when m.transfer_id is not null then md5(m.transfer_id || $3::text) end,
            m.source, m.rule_id, m.provisional, m.id, m.note
     from movement m
     join account_access x on x.account_id = m.account_id and x.user_id = $1
       and x.role = 'propietario'
     where m.voided_at = $2::timestamptz
       and (m.transfer_id is null or exists (
         select 1 from movement o where o.transfer_id = m.transfer_id and o.id <> m.id))
       and (m.occurrence_key is null or m.occurrence_key not like 'debt:%' or exists (
         select 1 from money_account d where d.id = split_part(m.occurrence_key, ':', 2)))`,
    [userId, c.at, `${id}${c.at}`],
  );
  await tx.query(
    `update money_account set closed_on = null, archived_at = null, closing = null,
       updated_at = now()
     where id = any($1)`,
    [ids],
  );
  if (c.rules.length)
    await tx.query(
      `update auto_rule set active = true, updated_at = now() where id = any($1) and user_id = $2`,
      [c.rules, userId],
    );
  if (c.unlinked)
    await tx.query(
      `update property set mortgage_account_id = $2 where account_id = $1
         and exists (select 1 from money_account d where d.id = $2 and d.closed_on is null)`,
      [id, c.unlinked],
    );
  if (c.home)
    await tx.query(
      `update property set mortgage_account_id = $2
       where account_id = $1 and mortgage_account_id is null`,
      [c.home, id],
    );
  await generateFor(tx, userId, ids, c.rules, c.through);
  await rebuildHistory(tx, userId, addDays(a.on, -1));
  return true;
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
