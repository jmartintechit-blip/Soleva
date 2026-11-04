import type { Day } from '#lib/engine/day.ts';
import { parseEuros } from '#lib/engine/money.ts';
import type { AutoFrequency } from '#lib/engine/schedule.ts';
import { MAX_CENTS } from './accounts.ts';
import type { Db } from './db/index.ts';

// The rules that generate movements (b12/RRegla): a transfer, an income or an expense, on its
// day. Plans (several products) have their own screen (RPlan). Every account must be one the user
// can change: the database refuses the rest (auto_rule_access).

export const RULE_KINDS = ['transferencia', 'ingreso', 'gasto'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const RULE_FREQUENCIES = ['semanal', 'mensual', 'trimestral', 'anual', 'una_vez'] as const;

export interface AutoRuleRow {
  id: string;
  name: string;
  kind: RuleKind | 'plan';
  frequency: AutoFrequency;
  day: number | null;
  startOn: Day;
  endOn: Day | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  amountCents: number | null;
  active: boolean;
  shortfall: 'no_comprar' | 'otra_cuenta';
  shortfallAccountId: string | null;
  // The home, car or good it is about (IBI, insurance, rent): it stops when that is given up.
  assetAccountId: string | null;
  // A plan's sum of its legs, per occurrence.
  legsCents: number;
}

const SELECT = `select r.id, r.name, r.kind, r.frequency, r.day, r.start_on::text as "startOn",
    r.end_on::text as "endOn", r.from_account_id as "fromAccountId",
    r.to_account_id as "toAccountId", r.amount_cents::float8 as "amountCents", r.active,
    r.shortfall, r.shortfall_account_id as "shortfallAccountId",
    r.asset_account_id as "assetAccountId",
    coalesce((select sum(l.amount_cents) from auto_rule_leg l where l.rule_id = r.id), 0)::float8
      as "legsCents"
  from auto_rule r`;

export const listAutoRules = (db: Db, userId: string) =>
  db.query<AutoRuleRow & Record<string, unknown>>(
    `${SELECT} where r.user_id = $1 order by r.active desc, r.created_at, r.id`,
    [userId],
  );

export async function getAutoRule(db: Db, userId: string, id: string) {
  const [r] = await db.query<AutoRuleRow & Record<string, unknown>>(
    `${SELECT} where r.user_id = $1 and r.id = $2`,
    [userId, id],
  );
  return r ?? null;
}

export interface RuleInput {
  name: string;
  kind: RuleKind;
  frequency: (typeof RULE_FREQUENCIES)[number];
  day: number | null;
  startOn: Day;
  endOn: Day | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  amountCents: number;
  assetAccountId?: string | null;
}

const FIELDS = [
  'tipo',
  'name',
  'amount',
  'from',
  'to',
  'frequency',
  'day',
  'start',
  'end',
  'es_de',
] as const;
export type RuleValues = Record<(typeof FIELDS)[number], string>;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// RRegla's form, checked. Its day: the weekday (semanal), the day of the month (31 = the last)
// or the date itself (una vez). From today and with no end unless «Más opciones» says otherwise.
export function readRuleForm(form: FormData, today: Day) {
  const values = Object.fromEntries(
    FIELDS.map((k) => [k, String(form.get(k) ?? '').trim()]),
  ) as RuleValues;
  const errors: Partial<Record<(typeof FIELDS)[number] | 'form', string>> = {};
  const kind = RULE_KINDS.find((k) => k === values.tipo);
  const frequency = RULE_FREQUENCIES.find((f) => f === values.frequency);
  const cents = parseEuros(values.amount);
  const start = values.start || today;
  let day: number | null = null;
  let startOn = start;
  if (!kind) errors.tipo = 'Elige qué hace la regla';
  if (!values.name || values.name.length > 60) errors.name = 'Ponle un nombre (hasta 60 letras)';
  if (cents === null || cents <= 0 || cents > MAX_CENTS)
    errors.amount = 'Escribe un importe, por ejemplo 1.500';
  if (!frequency) errors.frequency = 'Elige cada cuánto';
  else if (frequency === 'una_vez') {
    if (!isDay(values.day)) errors.day = 'Elige el día';
    else startOn = values.day;
  } else {
    day = Number(values.day);
    const max = frequency === 'semanal' ? 7 : 31;
    if (!Number.isInteger(day) || day < 1 || day > max) errors.day = 'Elige el día';
  }
  if (frequency !== 'una_vez' && !isDay(start)) errors.start = 'Elige la fecha de inicio';
  if (values.end && (!isDay(values.end) || values.end < startOn))
    errors.end = 'La fecha de fin va después del inicio';
  const from = kind === 'ingreso' ? null : values.from || null;
  const to = kind === 'gasto' ? null : values.to || null;
  if (kind && kind !== 'ingreso' && !from) errors.from = 'Elige la cuenta';
  if (kind && kind !== 'gasto' && !to) errors.to = 'Elige la cuenta';
  if (kind === 'transferencia' && from && from === to) errors.to = 'Elige otra cuenta';
  if (Object.keys(errors).length) return { ok: false as const, values, errors };
  return {
    ok: true as const,
    values,
    input: {
      name: values.name,
      kind: kind!,
      frequency: frequency!,
      day,
      startOn,
      endOn: frequency === 'una_vez' ? null : values.end || null,
      fromAccountId: from,
      toAccountId: to,
      amountCents: cents!,
      // Only an income or an expense is about something; a transfer is between accounts.
      assetAccountId: kind !== 'transferencia' && values.es_de ? values.es_de : null,
    } satisfies RuleInput,
  };
}

const refused = (error: unknown) => (error as { code?: string }).code === 'P0001';

// A new rule (`id` null) or a change to one of the user's; null when it is not theirs, is a plan,
// or uses an account they cannot change. What it already generated stays; it rules from now on.
export async function saveAutoRule(
  db: Db,
  userId: string,
  id: string | null,
  r: RuleInput,
): Promise<string | null> {
  const params = [
    r.name,
    r.kind,
    r.frequency,
    r.day,
    r.startOn,
    r.endOn,
    r.fromAccountId,
    r.toAccountId,
    r.amountCents,
    r.assetAccountId ?? null,
  ];
  try {
    if (id === null) {
      const [row] = await db.query<{ id: string }>(
        `insert into auto_rule (user_id, name, kind, frequency, day, start_on, end_on,
           from_account_id, to_account_id, amount_cents, asset_account_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [userId, ...params],
      );
      return row!.id;
    }
    const rows = await db.query<{ id: string }>(
      `update auto_rule set name = $3, kind = $4, frequency = $5, day = $6, start_on = $7,
         end_on = $8, from_account_id = $9, to_account_id = $10, amount_cents = $11,
         asset_account_id = $12, updated_at = now()
       where id = $1 and user_id = $2 and kind <> 'plan' returning id`,
      [id, userId, ...params],
    );
    return rows[0]?.id ?? null;
  } catch (error) {
    if (refused(error)) return null;
    throw error;
  }
}

export async function setAutoActive(db: Db, userId: string, id: string, active: boolean) {
  const rows = await db.query(
    `update auto_rule set active = $3, updated_at = now() where id = $1 and user_id = $2
     returning 1`,
    [id, userId, active],
  );
  return rows.length > 0;
}

// Only a rule that has not generated anything yet: one with movements in the ledger is paused
// instead ('historial'), so what happened keeps saying which rule it came from.
export async function deleteAutoRule(
  db: Db,
  userId: string,
  id: string,
): Promise<boolean | 'historial'> {
  try {
    const rows = await db.query(
      `delete from auto_rule where id = $1 and user_id = $2 returning 1`,
      [id, userId],
    );
    return rows.length > 0;
  } catch (error) {
    if ((error as { code?: string }).code === '23503') return 'historial';
    throw error;
  }
}

// The accounts a rule can use, with today's value (for «tiene saldo para N meses»).
export async function ruleAccounts(db: Db, userId: string) {
  return db.query<{ id: string; name: string; kind: string; cents: number }>(
    `select a.id, a.name, a.kind,
            coalesce((select (d.accounts -> a.id ->> 0)::float8 from user_day d
                      where d.user_id = $1 order by d.day desc limit 1), 0) as cents
     from money_account a
     join account_access x on x.account_id = a.id and x.user_id = $1
       and x.role in ('propietario', 'editor')
     where a.archived_at is null
       and a.kind not in ('inmueble', 'vehiculo', 'bien', 'deuda_hipoteca', 'deuda_prestamo')
     order by a.created_at, a.id`,
    [userId],
  );
}

// The homes, cars and goods a rule can be about (its IBI, insurance or rent), still the user's.
export const ruleAssets = (db: Db, userId: string) =>
  db.query<{ id: string; name: string }>(
    `select a.id, a.name from money_account a
     join account_access x on x.account_id = a.id and x.user_id = $1
       and x.role in ('propietario', 'editor')
     where a.kind in ('inmueble', 'vehiculo', 'bien') and a.closed_on is null
       and a.archived_at is null
     order by a.created_at, a.id`,
    [userId],
  );
