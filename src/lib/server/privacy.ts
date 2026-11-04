import type { Db, Row } from './db/index.ts';

const iso = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const month = (col: string) => `to_char(${col}, 'YYYY-MM')`;
// Cents to euros for people and spreadsheets: 1234567 → 12345.67, exact (numeric, then float8).
const eur = (col: string) => `(${col} / 100.0)::float8`;
// Units, prices and rates kept ×10^8: 150000000 → 1.5.
const e8 = (col: string) => `(${col} / 100000000.0)::float8`;
// The accounts the user owns (shared ones are their owner's data).
const OWN = `select account_id from account_access where user_id = $1 and role = 'propietario'`;

// Everything the user wrote down, one flat table per kind, so JSON and CSV share it (GDPR art. 20).
// Amounts in euros (the app keeps cents) and rates in basis points.
export async function exportData(db: Db, userId: string) {
  const q = (sql: string) => db.query(sql, [userId]);
  const [ajustes, cuentas, reglas, cierres, enmiendas] = await Promise.all([
    q(`select u.email, ${iso('u."createdAt"')} as user_created_at,
         coalesce(s.prudent_bp, 300) as prudent_bp, coalesce(s.base_bp, 600) as base_bp,
         coalesce(s.optimistic_bp, 800) as optimistic_bp, coalesce(s.inflation_bp, 250) as inflation_bp,
         coalesce(s.reminder_day, 1) as reminder_day,
         coalesce(s.reminder_enabled, true) as reminder_enabled,
         s.plan_baseline::text as plan_baseline
       from "user" u left join settings s on s.user_id = u.id where u.id = $1`),
    q(`select id, name, kind, ${eur('balance_cents')} as balance_eur, is_estimated, annual_rate_bp,
         ${iso('archived_at')} as archived_at, ${iso('created_at')} as created_at
       from money_account where user_id = $1 order by created_at, id`),
    q(`select id, name, type, ${eur('amount_cents')} as amount_eur, frequency, day,
         ${month('start_month')} as start_month, ${month('end_month')} as end_month,
         from_account_id, to_account_id, active, ${iso('created_at')} as created_at
       from rule where user_id = $1 order by created_at, id`),
    q(`select ${month('c.month')} as month, c.status, ${iso('c.confirmed_at')} as confirmed_at,
         l.account_id, a.name as account_name, l.is_debt,
         ${eur('l.proposed_cents')} as proposed_eur, ${eur('l.confirmed_cents')} as confirmed_eur
       from month_close c join month_close_line l on l.close_id = c.id
       join money_account a on a.id = l.account_id
       where c.user_id = $1 order by c.month, a.name, l.account_id`),
    q(`select ${month('c.month')} as month, e.account_id, ${eur('e.previous_cents')} as previous_eur,
         ${eur('e.new_cents')} as new_eur, e.reason, ${iso('e.created_at')} as created_at
       from close_amendment e join month_close c on c.id = e.close_id
       where c.user_id = $1 order by e.created_at, e.id`),
  ]);
  const ledger = await Promise.all([
    q(`select m.id, m.account_id, a.name as account_name, m.day::text as day, m.seq, m.kind,
         ${eur('m.amount_cents')} as amount_eur, i.name as instrument, i.isin,
         ${e8('m.qty_e8')} as quantity, ${e8('m.price_e8')} as price, ${e8('m.fx_e8')} as fx_per_eur,
         ${eur('m.fee_cents')} as fee_eur, ${eur('m.withholding_cents')} as withholding_eur,
         m.transfer_id, m.origin_movement_id, m.source, m.rule_id, m.provisional,
         ${iso('m.voided_at')} as voided_at, m.replaces_id, m.note, ${iso('m.created_at')} as created_at
       from movement m join money_account a on a.id = m.account_id
       left join instrument i on i.id = m.instrument_id
       where m.account_id in (${OWN}) order by m.day, m.account_id, m.seq, m.created_at, m.id`),
    q(`select id, name, kind, frequency, day, start_on::text as start_on, end_on::text as end_on,
         from_account_id, to_account_id, ${eur('amount_cents')} as amount_eur, active, shortfall,
         shortfall_account_id,
         ${iso('created_at')} as created_at
       from auto_rule where user_id = $1 order by created_at, id`),
    q(`select l.rule_id, l.seq, i.name as instrument, i.isin, ${eur('l.amount_cents')} as amount_eur
       from auto_rule_leg l join auto_rule r on r.id = l.rule_id join instrument i on i.id = l.instrument_id
       where r.user_id = $1 order by l.rule_id, l.seq`),
    q(`select c.account_id, c.base_days, c.pay_frequency, c.pay_day, c.promo_until::text as promo_until,
         c.after_rate_bp, c.withholding_bp, ${eur('t.up_to_cents')} as tier_up_to_eur, t.rate_bp
       from interest_config c left join interest_tier t on t.account_id = c.account_id
       where c.account_id in (${OWN}) order by c.account_id, t.up_to_cents nulls last`),
    q(`select d.account_id, i.name as instrument, i.isin, ${e8('d.per_unit_e8')} as per_unit,
         array_to_string(d.pay_months, ' ') as pay_months, d.pay_day, d.withholding_origin_bp,
         d.withholding_es_bp
       from dividend_config d join instrument i on i.id = d.instrument_id
       where d.account_id in (${OWN}) order by d.account_id, i.name`),
    q(`select e.account_id, i.name as instrument, e.annual_rate_bp
       from estimate_config e join instrument i on i.id = e.instrument_id
       where e.account_id in (${OWN}) order by e.account_id, i.name`),
    q(`select account_id, ${eur('principal_cents')} as principal_eur, start_on::text as start_on,
         first_payment_on::text as first_payment_on, term_months, rate_type, initial_rate_bp, index,
         spread_bp, review_months, floor_bp, payer_account_id
       from debt where account_id in (${OWN}) order by account_id`),
    q(`select v.account_id, b.order_year, b.brand, b.model, b.period, b.fuel,
         v.first_registration::text as first_registration, ${eur('v.override_cents')} as override_eur
       from vehicle v left join vehicle_base b on b.id = v.vehicle_base_id
       where v.account_id in (${OWN}) order by v.account_id`),
    q(`select account_id, category, ${eur('purchase_cents')} as purchase_eur,
         purchased_on::text as purchased_on, annual_loss_bp
       from asset where account_id in (${OWN}) order by account_id`),
    q(`select p.account_id, p.kind, m.name as municipio, p.area_m2, p.purchase_year,
         ${eur('p.purchase_cents')} as purchase_eur, p.value_method, p.value_on::text as value_on,
         p.growth_bp, p.mortgage_account_id
       from property p join municipality m on m.code = p.municipality_code
       where p.account_id in (${OWN}) order by p.account_id`),
    q(`select id, kind, name, isin, ticker, currency, ${iso('created_at')} as created_at
       from instrument where owner_user_id = $1 order by created_at, id`),
    q(`select o.instrument_id, i.name as instrument, o.day::text as day, ${e8('o.close_e8')} as price
       from price_override o join instrument i on i.id = o.instrument_id
       where o.user_id = $1 order by o.instrument_id, o.day`),
    q(`select kind, account_id, instrument_id, day::text as day, state, ${iso('created_at')} as created_at
       from alert where user_id = $1 order by created_at, id`),
    q(`select day::text as day, ${eur('total_cents')} as total_eur, ${eur('flows_cents')} as flows_eur
       from user_day where user_id = $1 order by day`),
    q(`select account_id, ${month('month')} as month, ${eur('value_cents')} as value_eur,
         ${eur('flows_cents')} as flows_eur
       from account_month where account_id in (${OWN}) order by month, account_id`),
  ]);
  const [
    movimientos,
    reglas_auto,
    patas_plan,
    intereses,
    dividendos,
    estimados,
    deudas,
    vehiculos,
    bienes,
    inmuebles,
    instrumentos_propios,
    precios_propios,
    alertas,
    patrimonio_diario,
    historico_mensual,
  ] = ledger;
  return {
    ajustes,
    cuentas,
    reglas,
    cierres,
    enmiendas,
    movimientos,
    reglas_auto,
    patas_plan,
    intereses,
    dividendos,
    estimados,
    deudas,
    vehiculos,
    bienes,
    inmuebles,
    instrumentos_propios,
    precios_propios,
    alertas,
    patrimonio_diario,
    historico_mensual,
  };
}

export type ExportTable = keyof Awaited<ReturnType<typeof exportData>>;
// Every table has its CSV.
export const EXPORT_TABLES = [
  'cuentas',
  'reglas',
  'cierres',
  'enmiendas',
  'ajustes',
  'movimientos',
  'reglas_auto',
  'patas_plan',
  'intereses',
  'dividendos',
  'estimados',
  'deudas',
  'vehiculos',
  'bienes',
  'inmuebles',
  'instrumentos_propios',
  'precios_propios',
  'alertas',
  'patrimonio_diario',
  'historico_mensual',
] as const satisfies ExportTable[];

// As Excel in Spanish opens it: ";" between cells and a decimal comma (1623,45). Otherwise
// RFC 4180, plus a leading quote on cells a spreadsheet would run as a formula.
export function toCsv(rows: Row[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (typeof v === 'number') s = s.replace('.', ',');
    if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
    return /[";\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const head = Object.keys(rows[0] ?? {});
  return [head, ...rows.map((r) => head.map((k) => r[k]))]
    .map((line) => line.map(cell).join(';'))
    .join('\r\n');
}

// Every session of the user, on every device.
export async function endSessions(db: Db, userId: string) {
  await db.query(`delete from session where "userId" = $1`, [userId]);
}

// For real: the user row cascades to sessions, accounts, rules, closes and settings; pending
// sign-in codes are keyed by email ("<type>-otp-<email>"), not by user, so they go by hand.
export async function deleteUser(db: Db, userId: string) {
  await db.transaction(async (tx) => {
    const [user] = await tx.query<{ email: string }>(`select email from "user" where id = $1`, [
      userId,
    ]);
    if (!user) return;
    await tx.query(
      `delete from verification where right(identifier, length($1) + 5) = '-otp-' || $1`,
      [user.email],
    );
    await tx.query(`delete from "user" where id = $1`, [userId]);
  });
}
