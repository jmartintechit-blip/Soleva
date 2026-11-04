import { type Day, dayIn } from '#lib/engine/day.ts';
import { addMonths } from '#lib/engine/dates.ts';
import { type DebtTerms, amortization, outstandingOn } from '#lib/engine/debt.ts';
import { parseEuros, parsePercent } from '#lib/engine/money.ts';
import { MAX_CENTS } from './accounts.ts';
import { ruleAccounts } from './auto-rules.ts';
import type { Db } from './db/index.ts';

// RDeuda (b12): a mortgage or loan by the French system, fixed or with the official Euribor.
// Its terms make the schedule; the account owes what the schedule says is outstanding today, and
// each payment the engine writes splits into interest (an expense) and principal (net worth up).

export const DEBT_KINDS = ['deuda_hipoteca', 'deuda_prestamo'];

export interface DebtInput {
  principalCents: number;
  // The month it was signed; the first payment is on `payDay` of the next one.
  startMonth: string;
  payDay: number;
  termMonths: number;
  rateType: 'fijo' | 'variable';
  initialRateBp: number;
  spreadBp: number | null;
  reviewMonths: 6 | 12 | null;
  floorBp: number | null;
  payerAccountId: string;
  // The home it pays for, if any (null unlinks it).
  propertyId: string | null;
}

const terms = (d: DebtInput, index: Record<string, number>): DebtTerms => ({
  principalCents: d.principalCents,
  startOn: `${d.startMonth}-01`,
  firstPaymentOn: dayIn(addMonths(d.startMonth, 1), d.payDay),
  termMonths: d.termMonths,
  rateType: d.rateType,
  initialRateBp: d.initialRateBp,
  ...(d.rateType === 'variable'
    ? {
        index,
        spreadBp: d.spreadBp!,
        reviewMonths: d.reviewMonths!,
        floorBp: d.floorBp ?? undefined,
      }
    : {}),
});

const euribor = async (db: Db) =>
  Object.fromEntries(
    (
      await db.query<{ m: string; bp: number }>(
        `select to_char(month, 'YYYY-MM') as m, rate_bp as bp from index_rate
         where index = 'euribor_12m'`,
      )
    ).map((r) => [r.m, r.bp]),
  );

// A debt account the user can see, with its terms (null until given), its schedule from today and
// what can be linked; null otherwise (404).
export async function debtView(db: Db, userId: string, id: string, today: Day) {
  const [a] = await db.query<{
    name: string;
    kind: string;
    role: string;
    cents: number;
    d: string | null;
    property: string | null;
  }>(
    `select a.name, a.kind, x.role,
            coalesce((select sum(m.amount_cents) from movement m
                      where m.account_id = a.id and m.voided_at is null), 0)::float8 as cents,
            (select json_build_object('principalCents', d.principal_cents::float8,
                'startMonth', to_char(d.start_on, 'YYYY-MM'),
                'payDay', extract(day from d.first_payment_on)::int, 'termMonths', d.term_months,
                'rateType', d.rate_type, 'initialRateBp', d.initial_rate_bp, 'spreadBp', d.spread_bp,
                'reviewMonths', d.review_months, 'floorBp', d.floor_bp,
                'payerAccountId', d.payer_account_id)
             from debt d where d.account_id = a.id)::text as d,
            (select p.account_id from property p where p.mortgage_account_id = a.id limit 1)
              as property
     from money_account a join account_access x on x.account_id = a.id and x.user_id = $1
     where a.id = $2`,
    [userId, id],
  );
  if (!a || !DEBT_KINDS.includes(a.kind)) return null;
  const stored = a.d ? (JSON.parse(a.d) as Omit<DebtInput, 'propertyId'>) : null;
  const input = stored ? { ...stored, propertyId: a.property } : null;
  const schedule = input ? amortization(terms(input, await euribor(db))) : [];
  const ahead = schedule.filter((p) => p.day > today);
  const [payers, properties] = await Promise.all([
    ruleAccounts(db, userId),
    db.query<{ id: string; name: string }>(
      `select a.id, a.name from property p join money_account a on a.id = p.account_id
       join account_access x on x.account_id = a.id and x.user_id = $1
         and x.role in ('propietario', 'editor')
       order by a.created_at`,
      [userId],
    ),
  ]);
  return {
    account: { id, name: a.name, kind: a.kind, cents: a.cents },
    input,
    // The home it is linked to, even before its terms.
    property: a.property,
    next: ahead[0] ?? null,
    ahead,
    totalInterestCents: schedule.reduce((s, p) => s + p.interestCents, 0),
    payers,
    properties,
    canEdit: a.role === 'propietario' || a.role === 'editor',
  };
}

// RDeuda's form.
export function readDebtForm(form: FormData) {
  const one = (k: string) => String(form.get(k) ?? '').trim();
  const values = Object.fromEntries(
    [
      'tipo',
      'capital',
      'desde',
      'anos',
      'tipo_fijo',
      'tipo_inicial',
      'diferencial',
      'revision',
      'suelo',
      'paga',
      'dia',
      'inmueble',
    ].map((k) => [k, one(k)]),
  ) as Record<string, string>;
  const errors: Record<string, string> = {};
  const rateType = values.tipo === 'variable' ? 'variable' : 'fijo';
  const principal = parseEuros(values.capital);
  const years = Number(values.anos);
  const day = Number(values.dia);
  if (principal === null || principal <= 0 || principal > MAX_CENTS)
    errors.capital = 'Escribe el capital que te prestaron, por ejemplo 150.000';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(values.desde)) errors.desde = 'Elige el mes de la firma';
  if (!Number.isInteger(years) || years < 1 || years > 50)
    errors.anos = 'Escribe los años, de 1 a 50';
  if (!Number.isInteger(day) || day < 1 || day > 31) errors.dia = 'Elige el día de la cuota';
  if (!values.paga) errors.paga = 'Elige de qué cuenta sale';
  const pct = (k: string) => parsePercent(values[k]!);
  const fixed = pct('tipo_fijo');
  const first = pct('tipo_inicial');
  const spread = pct('diferencial');
  const floor = values.suelo ? pct('suelo') : null;
  const bad = (bp: number | null, min = 0) => bp === null || bp < min || bp > 3000;
  if (rateType === 'fijo' && bad(fixed)) errors.tipo_fijo = 'Escribe el tipo, por ejemplo 2,6';
  if (rateType === 'variable') {
    if (bad(first)) errors.tipo_inicial = 'Escribe el tipo de ahora, por ejemplo 3,1';
    if (bad(spread, -1000)) errors.diferencial = 'Escribe el diferencial, por ejemplo 0,8';
    if (values.suelo && bad(floor)) errors.suelo = 'Escribe el suelo, por ejemplo 0';
    if (!['6', '12'].includes(values.revision)) errors.revision = 'Elige cada cuánto se revisa';
  }
  if (Object.keys(errors).length) return { ok: false as const, values, errors };
  return {
    ok: true as const,
    values,
    input: {
      principalCents: principal!,
      startMonth: values.desde!,
      payDay: day,
      termMonths: years * 12,
      rateType,
      initialRateBp: rateType === 'fijo' ? fixed! : first!,
      spreadBp: rateType === 'variable' ? spread : null,
      reviewMonths: rateType === 'variable' ? (Number(values.revision) as 6 | 12) : null,
      floorBp: rateType === 'variable' ? floor : null,
      payerAccountId: values.paga!,
      propertyId: values.inmueble || null,
    } satisfies DebtInput,
  };
}

// Saves the terms and makes the account owe what the schedule says today (an adjustment for the
// difference); links or unlinks its home. Null unless the debt, the paying account and the home
// are the user's to change.
export async function saveDebt(db: Db, userId: string, id: string, today: Day, d: DebtInput) {
  const view = await debtView(db, userId, id, today);
  if (!view?.canEdit) return null;
  if (!view.payers.some((p) => p.id === d.payerAccountId)) return null;
  if (d.propertyId && !view.properties.some((p) => p.id === d.propertyId)) return null;
  const t = terms(d, await euribor(db));
  const owed = outstandingOn(t, today);
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into debt (account_id, principal_cents, start_on, first_payment_on, term_months,
           rate_type, initial_rate_bp, index, spread_bp, review_months, floor_bp, payer_account_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (account_id) do update set principal_cents = excluded.principal_cents,
           start_on = excluded.start_on, first_payment_on = excluded.first_payment_on,
           term_months = excluded.term_months, rate_type = excluded.rate_type,
           initial_rate_bp = excluded.initial_rate_bp, index = excluded.index,
           spread_bp = excluded.spread_bp, review_months = excluded.review_months,
           floor_bp = excluded.floor_bp, payer_account_id = excluded.payer_account_id`,
        [
          id,
          d.principalCents,
          t.startOn,
          t.firstPaymentOn,
          d.termMonths,
          d.rateType,
          d.initialRateBp,
          d.rateType === 'variable' ? 'euribor_12m' : null,
          d.spreadBp,
          d.reviewMonths,
          d.floorBp,
          d.payerAccountId,
        ],
      );
      if (-owed !== view.account.cents)
        await tx.query(
          `insert into movement (account_id, day, kind, amount_cents, source, note)
           values ($1, $2, 'ajuste', $3, 'manual', 'condiciones')`,
          [id, today, -owed - view.account.cents],
        );
      await tx.query(
        `update property set mortgage_account_id = null
         where mortgage_account_id = $1 and account_id is distinct from $2`,
        [id, d.propertyId],
      );
      if (d.propertyId)
        await tx.query(`update property set mortgage_account_id = $1 where account_id = $2`, [
          id,
          d.propertyId,
        ]);
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P0001') return null;
    throw error;
  }
  return true;
}
