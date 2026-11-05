import {
  type AutoRule,
  type EngineInput,
  type Market,
  accruedInterest,
  advance,
} from '#lib/engine/advance.ts';
import { type Day, addDays, daysAfter, monthOf } from '#lib/engine/day.ts';
import type { DebtTerms } from '#lib/engine/debt.ts';
import {
  type AccountKind,
  type Forecast,
  type Holdings,
  type InstrumentKind,
  accountFlows,
  alerts,
  outsideFlows,
  unitFlows,
  valuation,
} from '#lib/engine/insight.ts';
import { M2_STEP, assetIndex, vehicleIndex } from '#lib/engine/valuation.ts';
import { type InterestTerms, isPayDay } from '#lib/engine/interest.ts';
import { type Movement, fold, holdingKey } from '#lib/engine/ledger.ts';
import { reprice } from '#lib/engine/reconcile.ts';
import { E8 } from '#lib/engine/units.ts';
import type { Db } from './db/index.ts';

// A run talks to the database three times (plus its lock): one read of the user's setup, one of
// the ledger and the market data it needs, one write of everything. Every round trip through the
// Neon driver costs CPU in Workers, which a run has little of.

const big = (v: string | null | undefined) => (v == null ? undefined : BigInt(v));
const num = (v: string | number | null | undefined) => (v == null ? undefined : Number(v));

const ESTIMATE = (m: string) =>
  `exists (select 1 from instrument i where i.id = ${m}.instrument_id and i.kind = 'estimado')`;

interface Setup {
  state: { through: Day; forecast: Forecast | null; touched: boolean; hand: string } | null;
  accounts: { id: string; kind: AccountKind; closedOn: Day | null }[];
  rules: (Omit<
    AutoRule,
    | 'amountCents'
    | 'legs'
    | 'day'
    | 'endOn'
    | 'fromAccountId'
    | 'toAccountId'
    | 'shortfallAccountId'
  > & {
    shortfallAccountId: string | null;
    day: number | null;
    endOn: Day | null;
    fromAccountId: string | null;
    toAccountId: string | null;
    amountCents: string | null;
    legs: { instrumentId: string; amountCents: string }[];
  })[];
  interest: {
    accountId: string;
    baseDays: 360 | 365;
    payFrequency: InterestTerms['payFrequency'];
    payDay: number;
    promoUntil: Day | null;
    afterRateBp: number | null;
    withholdingBp: number;
    tiers: { upToCents: string | null; rateBp: number }[];
  }[];
  dividends: {
    accountId: string;
    instrumentId: string;
    perUnitE8: string;
    payMonths: number[];
    payDay: number;
    withholdingOriginBp: number;
    withholdingEsBp: number;
  }[];
  index: Record<string, number>;
  debts: {
    accountId: string;
    principalCents: string;
    startOn: Day;
    firstPaymentOn: Day;
    termMonths: number;
    rateType: 'fijo' | 'variable';
    initialRateBp: number;
    spreadBp: number | null;
    reviewMonths: number | null;
    floorBp: number | null;
    payerAccountId: string | null;
  }[];
  positions: [string, string, string, string][];
  estimates: Record<string, number>;
  estimatesSince: Record<string, Day>;
  vehicles: {
    accountId: string;
    firstRegistration: Day;
    table: { yearsOver: number; pctBp: number }[] | null;
    flows: [Day, string][];
  }[];
  assets: { accountId: string; purchasedOn: Day; annualLossBp: number; flows: [Day, string][] }[];
  properties: {
    accountId: string;
    valueOn: Day;
    method: 'm2' | 'propio';
    flows: [Day, string, Movement['kind']][];
    index: [Day, number][];
  }[];
}

// Read 1: the run's state (and whether anything was entered or voided by hand since the last
// run, plus a digest of what was) and everything set up for the user's own accounts.
async function readSetup(tx: Db, userId: string): Promise<Setup> {
  const [{ j }] = await tx.query<{ j: string }>(
    `with a as (
       select a.id, a.kind, a.closed_on, a.created_at from money_account a
       join account_access x on x.account_id = a.id where x.user_id = $1 and x.role = 'propietario')
     select json_build_object(
       'state', (select json_build_object('through', s.processed_through, 'forecast', s.forecast,
           'touched', exists (select 1 from movement m where m.account_id in (select id from a)
             and (m.created_at > s.updated_at or m.voided_at > s.updated_at)),
           'hand', (select md5(coalesce(string_agg(m.account_id || m.day || m.amount_cents
                      || (m.voided_at is not null), ',' order by m.id), ''))
                    from movement m where m.account_id in (select id from a)
                      and (m.source not in ('regla', 'motor') or m.voided_at is not null)))
         from engine_state s where s.user_id = $1),
       'accounts', (select coalesce(json_agg(json_build_object('id', id, 'kind', kind, 'closedOn', closed_on) order by created_at, id), '[]') from a),
       'rules', (select coalesce(json_agg(json_build_object('id', r.id, 'kind', r.kind, 'frequency', r.frequency,
           'day', r.day, 'startOn', r.start_on, 'endOn', r.end_on, 'fromAccountId', r.from_account_id,
           'toAccountId', r.to_account_id, 'amountCents', r.amount_cents::text, 'active', r.active,
           'shortfall', r.shortfall, 'shortfallAccountId', r.shortfall_account_id,
           'legs', (select coalesce(json_agg(json_build_object('instrumentId', l.instrument_id,
                      'amountCents', l.amount_cents::text) order by l.seq), '[]')
                    from auto_rule_leg l where l.rule_id = r.id))
         order by r.created_at, r.id), '[]') from auto_rule r where r.user_id = $1),
       'interest', (select coalesce(json_agg(json_build_object('accountId', c.account_id, 'baseDays', c.base_days,
           'payFrequency', c.pay_frequency, 'payDay', c.pay_day, 'promoUntil', c.promo_until,
           'afterRateBp', c.after_rate_bp, 'withholdingBp', c.withholding_bp,
           'tiers', (select coalesce(json_agg(json_build_object('upToCents', t.up_to_cents::text,
                       'rateBp', t.rate_bp) order by t.up_to_cents nulls last), '[]')
                     from interest_tier t where t.account_id = c.account_id))), '[]')
         from interest_config c where c.account_id in (select id from a)),
       'dividends', (select coalesce(json_agg(json_build_object('accountId', d.account_id,
           'instrumentId', d.instrument_id, 'perUnitE8', d.per_unit_e8::text, 'payMonths', d.pay_months,
           'payDay', d.pay_day, 'withholdingOriginBp', d.withholding_origin_bp,
           'withholdingEsBp', d.withholding_es_bp)), '[]')
         from dividend_config d where d.account_id in (select id from a)),
       'index', (select coalesce(json_object_agg(to_char(month, 'YYYY-MM'), rate_bp), '{}')
         from index_rate where index = 'euribor_12m'),
       'debts', (select coalesce(json_agg(json_build_object('accountId', d.account_id,
           'principalCents', d.principal_cents::text, 'startOn', d.start_on, 'firstPaymentOn', d.first_payment_on,
           'termMonths', d.term_months, 'rateType', d.rate_type, 'initialRateBp', d.initial_rate_bp,
           'spreadBp', d.spread_bp, 'reviewMonths', d.review_months, 'floorBp', d.floor_bp,
           'payerAccountId', d.payer_account_id)), '[]')
         from debt d where d.account_id in (select id from a)),
       'positions', (select coalesce(json_agg(json_build_array(p.account_id, p.instrument_id,
           p.qty_e8::text, p.cost_cents::text)), '[]')
         from position p join instrument i on i.id = p.instrument_id
         where p.account_id in (select id from a) and i.kind <> 'estimado'),
       'estimates', (select coalesce(json_object_agg(e.account_id || '|' || e.instrument_id, e.annual_rate_bp), '{}')
         from estimate_config e where e.account_id in (select id from a)),
       'estimatesSince', (select coalesce(json_object_agg(e.account_id || '|' || e.instrument_id, e.since_on), '{}')
         from estimate_config e where e.account_id in (select id from a) and e.since_on is not null),
       -- Whole too: each value moves along its curve from its own day.
       'vehicles', (select coalesce(json_agg(json_build_object('accountId', v.account_id,
           'firstRegistration', v.first_registration,
           'table', (select json_agg(json_build_object('yearsOver', d.years_over, 'pctBp', d.pct_bp))
                     from vehicle_depreciation d where d.order_year = b.order_year),
           'flows', (select coalesce(json_agg(json_build_array(m.day, m.amount_cents::text) order by m.day, m.seq), '[]')
                     from movement m where m.account_id = v.account_id and m.voided_at is null))), '[]')
         from vehicle v left join vehicle_base b on b.id = v.vehicle_base_id
         where v.account_id in (select id from a)),
       'assets', (select coalesce(json_agg(json_build_object('accountId', s.account_id,
           'purchasedOn', s.purchased_on, 'annualLossBp', s.annual_loss_bp,
           'flows', (select coalesce(json_agg(json_build_array(m.day, m.amount_cents::text) order by m.day, m.seq), '[]')
                     from movement m where m.account_id = s.account_id and m.voided_at is null))), '[]')
         from asset s where s.account_id in (select id from a)),
       -- Whole, also in a compact run: each value is indexed from its own day.
       'properties', (select coalesce(json_agg(json_build_object('accountId', p.account_id,
           'valueOn', p.value_on, 'method', p.value_method,
           'flows', (select coalesce(json_agg(json_build_array(m.day, m.amount_cents::text, m.kind)
                       order by m.day, m.seq), '[]')
                     from movement m where m.account_id = p.account_id and m.voided_at is null),
           'index', (select coalesce(json_agg(json_build_array(h.quarter, h.index_e3) order by h.quarter), '[]')
                     from housing_index h where h.region = coalesce((select z.region from housing_index z
                       where z.region = r.region limit 1), '00')))), '[]')
         from property p join municipality r on r.code = p.municipality_code
         where p.account_id in (select id from a))
     )::text as j`,
    [userId],
  );
  return JSON.parse(j) as Setup;
}

type RawMovement = [
  string,
  string,
  Day,
  number,
  Movement['kind'],
  string,
  string | null,
  string | null,
  string | null,
  string | null,
  string,
  string | null,
  Movement['source'],
  string | null,
  string | null,
  boolean,
  boolean,
  boolean,
];

// Read 2: the ledger (whole, or from `start` on with each account's cash before it summed up),
// the instruments in play and their closes from `since` on (plus the last one before it), and the
// ECB rates of their currencies the same way.
async function readLedger(
  tx: Db,
  userId: string,
  ids: string[],
  extra: string[],
  start: Day | null,
  since: Day,
) {
  const [{ j }] = await tx.query<{ j: string }>(
    `with mv as (
       select m.*, ${ESTIMATE('m')} as estimate from movement m
       where m.account_id = any($1) and ($2::date is null or m.day > $2 or ${ESTIMATE('m')})),
     used as (select instrument_id as id from mv where instrument_id is not null
              union select unnest($3::text[])),
     ins as (select id, kind, currency from instrument where id in (select id from used)),
     pr as (
       (select distinct on (instrument_id) instrument_id, day, close_e8, 0 as own from price
        where instrument_id in (select id from ins) and day < $4 order by instrument_id, day desc)
       union all
       (select instrument_id, day, close_e8, 0 from price where instrument_id in (select id from ins) and day >= $4)
       union all
       (select distinct on (instrument_id) instrument_id, day, close_e8, 1 from price_override
        where user_id = $5 and instrument_id in (select id from ins) and day < $4 order by instrument_id, day desc)
       union all
       (select instrument_id, day, close_e8, 1 from price_override
        where user_id = $5 and instrument_id in (select id from ins) and day >= $4)),
     fx as (
       (select distinct on (currency) currency, day, per_eur_e8 from fx_rate
        where currency in (select currency from ins) and day < $4 order by currency, day desc)
       union all
       (select currency, day, per_eur_e8 from fx_rate where currency in (select currency from ins) and day >= $4))
     select json_build_object(
       'movements', (select coalesce(json_agg(json_build_array(m.id, m.account_id, m.day, m.seq, m.kind,
           m.amount_cents::text, m.instrument_id, m.qty_e8::text, m.price_e8::text, m.fx_e8::text,
           m.withholding_cents::text, m.transfer_id, m.source, m.rule_id, m.occurrence_key,
           m.provisional, m.voided_at is not null, m.estimate)
         order by m.day, m.seq, m.created_at, m.id), '[]') from mv m),
       'openings', (select coalesce(json_agg(json_build_array(account_id, cash)), '[]') from (
           select m.account_id, sum(m.amount_cents)::text as cash from movement m
           where $2::date is not null and m.account_id = any($1) and m.day <= $2
             and m.voided_at is null and not ${ESTIMATE('m')}
           group by m.account_id) o),
       'instruments', (select coalesce(json_agg(json_build_array(id, kind, currency)), '[]') from ins),
       'prices', (select coalesce(json_agg(json_build_array(instrument_id, day, close_e8::text)
         order by instrument_id, day, own), '[]') from pr),
       'fx', (select coalesce(json_agg(json_build_array(currency, day, per_eur_e8::text)
         order by currency, day), '[]') from fx)
     )::text as j`,
    [ids, start, extra, since, userId],
  );
  return JSON.parse(j) as {
    movements: RawMovement[];
    openings: [string, string][];
    instruments: [string, InstrumentKind, string][];
    prices: [string, Day, string][];
    fx: [string, Day, string][];
  };
}

function latest(list: { day: Day; priceE8: bigint }[] | undefined, day: Day) {
  if (!list?.length || list[0]!.day > day) return undefined;
  let [lo, hi] = [0, list.length - 1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid]!.day <= day) lo = mid;
    else hi = mid - 1;
  }
  return list[lo];
}

// Everything the engine needs about one user, from two reads. `from` is where the run starts.
// The ledger comes whole, or (`compact`, when nothing was changed by hand since the last run)
// compacted: each account's cash as one opening at the window start (the eve of the last
// interest payment or of the month start, whichever is earlier), the window's movements (units stripped up to
// `from`), the holdings of the cache as stand-ins on `from`, and estimates whole (their value is
// their contributions). The same results from a few hundred rows instead of years.
export async function loadUser(tx: Db, userId: string, setup: Setup, from: Day, compact: boolean) {
  const accounts = setup.accounts.map((a) =>
    a.closedOn ? { id: a.id, kind: a.kind, closedOn: a.closedOn } : { id: a.id, kind: a.kind },
  );
  const ids = accounts.map((a) => a.id);
  // An account given up owes nothing more: what it made before is in the ledger already.
  const closed = new Set(setup.accounts.filter((a) => a.closedOn).map((a) => a.id));
  const interest: Record<string, InterestTerms> = {};
  for (const c of setup.interest)
    interest[c.accountId] = {
      baseDays: c.baseDays,
      payFrequency: c.payFrequency,
      payDay: c.payDay,
      promoUntil: c.promoUntil ?? undefined,
      afterRateBp: c.afterRateBp ?? undefined,
      withholdingBp: c.withholdingBp,
      tiers: c.tiers.map((t) => ({ upToCents: num(t.upToCents), rateBp: t.rateBp })),
    };
  const rules = setup.rules.map((r): AutoRule => ({
    ...r,
    day: r.day ?? undefined,
    endOn: r.endOn ?? undefined,
    fromAccountId: r.fromAccountId ?? undefined,
    toAccountId: r.toAccountId ?? undefined,
    shortfallAccountId: r.shortfallAccountId ?? undefined,
    amountCents: num(r.amountCents),
    legs: r.legs.map((l) => ({ instrumentId: l.instrumentId, amountCents: Number(l.amountCents) })),
  }));
  const dividends = setup.dividends.map((d) => ({ ...d, perUnitE8: BigInt(d.perUnitE8) }));
  const debts: Record<string, DebtTerms & { payerAccountId?: string }> = {};
  for (const d of setup.debts.filter((d) => !closed.has(d.accountId)))
    debts[d.accountId] = {
      principalCents: Number(d.principalCents),
      startOn: d.startOn,
      firstPaymentOn: d.firstPaymentOn,
      termMonths: d.termMonths,
      rateType: d.rateType,
      initialRateBp: d.initialRateBp,
      index: setup.index,
      spreadBp: d.spreadBp ?? undefined,
      reviewMonths: d.reviewMonths ?? undefined,
      floorBp: d.floorBp ?? undefined,
      payerAccountId: d.payerAccountId ?? undefined,
    };

  let start: Day | null = null;
  if (compact) {
    start = addDays(`${monthOf(from)}-01`, -1);
    for (const t of Object.values(interest)) {
      let d = from;
      for (let k = 0; k < 366 && !isPayDay(t, d); k++) d = addDays(d, -1);
      // The day before: the pay day's own movements (its payment) must be seen as such.
      if (addDays(d, -1) < start) start = addDays(d, -1);
    }
  }
  // Only the closes a run can use: shortcut: a buy still provisional before `since` is not
  // repriced; widen `since` if that ever happens (a close more than 10 days late).
  const since = addDays(from, -10);
  const extra = [
    ...rules.flatMap((r) => r.legs.map((l) => l.instrumentId)),
    ...dividends.map((d) => d.instrumentId),
    ...setup.positions.map((p) => p[1]),
  ];
  const data = await readLedger(tx, userId, ids, extra, start, since);

  const all = data.movements.map((x): Movement & { id: string; estimate: boolean } => ({
    id: x[0],
    accountId: x[1],
    day: x[2],
    seq: x[3],
    kind: x[4],
    amountCents: Number(x[5]),
    instrumentId: x[6] ?? undefined,
    qtyE8: big(x[7]),
    priceE8: big(x[8]),
    fxE8: big(x[9]),
    withholdingCents: Number(x[10]),
    transferId: x[11] ?? undefined,
    source: x[12],
    ruleId: x[13] ?? undefined,
    occurrenceKey: x[14] ?? undefined,
    provisional: x[15],
    voided: x[16],
    estimate: x[17],
  }));
  const provisional = all.filter((m) => m.provisional && !m.voided);
  const standIns = new Map<string, Movement>();
  let ledger: Movement[] = all;
  if (start !== null) {
    const openings = data.openings.map(([accountId, cash]): Movement => ({
      accountId,
      day: start,
      seq: -1,
      kind: 'apertura',
      amountCents: Number(cash),
      source: 'motor',
    }));
    const neutral: Movement[] = [];
    for (const [account, instrument, qty, cost] of setup.positions) {
      // A buy of what the cache holds, with its cost, and the cash it took given back.
      standIns.set(holdingKey(account, instrument), {
        accountId: account,
        day: from,
        seq: -1,
        kind: 'compra',
        amountCents: -Number(cost),
        instrumentId: instrument,
        qtyE8: BigInt(qty),
        priceE8: 1n,
        source: 'motor',
      });
      neutral.push({
        accountId: account,
        day: from,
        seq: -1,
        kind: 'apertura',
        amountCents: Number(cost),
        source: 'motor',
      });
    }
    const stripped = all.map((m) =>
      !m.estimate && m.day <= from && m.qtyE8 !== undefined
        ? { ...m, instrumentId: undefined, qtyE8: undefined }
        : m,
    );
    ledger = [...openings, ...stripped, ...neutral, ...standIns.values()];
  }

  const instruments: Record<string, { kind: InstrumentKind; currency: string }> = {};
  for (const [id, kind, currency] of data.instruments) instruments[id] = { kind, currency };
  const prices = new Map<string, { day: Day; priceE8: bigint }[]>();
  for (const [instrument, day, close] of data.prices) {
    const list = prices.get(instrument) ?? [];
    // The user's own price of a day replaces the provider's (it comes after it).
    if (list.at(-1)?.day === day) list.pop();
    list.push({ day, priceE8: BigInt(close) });
    prices.set(instrument, list);
  }
  const rates = new Map<string, { day: Day; priceE8: bigint }[]>();
  for (const [currency, day, v] of data.fx)
    rates.set(currency, [...(rates.get(currency) ?? []), { day, priceE8: BigInt(v) }]);
  const market: Market = {
    currency: (id) => instruments[id]?.currency ?? 'EUR',
    close: (id, day) => latest(prices.get(id), day),
    perEur: (c, day) => (c === 'EUR' ? E8 : latest(rates.get(c), day)?.priceE8),
  };

  const properties: Holdings['properties'] = {};
  for (const p of setup.properties)
    properties[p.accountId] = {
      flows: p.flows.map(([day, cents, kind]) => ({
        day,
        cents: Number(cents),
        from: kind === 'apertura' ? p.valueOn : undefined,
      })),
      index: p.index.map(([quarter, indexE3]) => ({ quarter, indexE3 })),
      ...(p.method === 'm2' ? { step: M2_STEP } : {}),
    };
  const flowsOf = (f: [Day, string][]) => f.map(([day, cents]) => ({ day, cents: Number(cents) }));
  for (const v of setup.vehicles)
    properties[v.accountId] = {
      flows: flowsOf(v.flows),
      index: vehicleIndex(v.table ?? [], v.firstRegistration),
    };
  for (const g of setup.assets)
    properties[g.accountId] = {
      flows: flowsOf(g.flows),
      index: assetIndex(g.annualLossBp, g.purchasedOn),
    };

  const input: EngineInput = { rules, interest, dividends, debts, market };
  const holdings: Holdings = {
    accounts,
    instruments,
    estimates: setup.estimates,
    estimatesSince: setup.estimatesSince,
    vehicles: {},
    assets: {},
    properties,
    market,
  };
  return { ledger, provisional, standIns, input, holdings };
}

// History: each day after `from` up to `to` (`to` too, as prices move), and each account at the
// end of every month it crossed.
function history(
  input: EngineInput,
  holdings: Holdings,
  all: readonly Movement[],
  from: Day,
  to: Day,
) {
  const days: [Day, number, number, string, string][] = [];
  const months: [string, string, number, number][] = [];
  for (const d of new Set([...daysAfter(from, to), to])) {
    const v = valuation(holdings, all, d);
    // Interest earned this period and not paid yet counts in the account's value.
    const accrued = accruedInterest(input, all, d);
    for (const [a, cents] of Object.entries(accrued)) {
      if (!(a in v.byAccount)) continue;
      v.byAccount[a]! += cents;
      v.total += cents;
      v.byClass.liquidez += cents;
    }
    const units = unitFlows(holdings, all, addDays(d, -1), d);
    const flows =
      outsideFlows(all, addDays(d, -1), d).reduce((s, m) => s + m.amountCents, 0) +
      Object.values(units).reduce((s, c) => s + c, 0);
    const own = accountFlows(all, addDays(d, -1), d);
    for (const [a, cents] of Object.entries(units)) own[a] = (own[a] ?? 0) + cents;
    const perAccount = Object.fromEntries(
      Object.entries(v.byAccount).map(([a, value]) => [a, [value, own[a] ?? 0, accrued[a] ?? 0]]),
    );
    days.push([d, v.total, flows, JSON.stringify(perAccount), JSON.stringify(v.byClass)]);
    if (monthOf(addDays(d, 1)) !== monthOf(d))
      for (const [account, value] of Object.entries(v.byAccount)) {
        const own = all.filter((m) => m.accountId === account);
        const before = addDays(`${monthOf(d)}-01`, -1);
        const monthFlows = outsideFlows(own, before, d);
        months.push([
          account,
          `${monthOf(d)}-01`,
          value,
          monthFlows.reduce((s, m) => s + m.amountCents, 0) +
            (unitFlows(holdings, own, before, d)[account] ?? 0),
        ]);
      }
  }
  return { days, months };
}

// What each of the user's accounts is worth at the end of `day`, from the whole ledger as it is in
// `tx` (the baja asks it before the account is given up).
export async function valuesOn(tx: Db, userId: string, day: Day) {
  const setup = await readSetup(tx, userId);
  const { ledger, holdings } = await loadUser(tx, userId, setup, day, false);
  return valuation(holdings, ledger, day).byAccount;
}

// What the engine owes these accounts and rules from the day after `from` up to where it is, and
// nothing else: after «Deshacer la baja», the payments and rules it skipped while they were given
// up. Only theirs, so no other rule is made for days it was never made for.
export async function generateFor(
  tx: Db,
  userId: string,
  ids: string[],
  ruleIds: string[],
  from: Day,
) {
  const setup = await readSetup(tx, userId);
  if (!setup.state || from >= setup.state.through) return 0;
  const { ledger, input } = await loadUser(tx, userId, setup, from, false);
  const only = new Set(ids);
  const mine = <T>(o: Record<string, T>) =>
    Object.fromEntries(Object.entries(o).filter(([id]) => only.has(id)));
  const fresh = advance(
    {
      ...input,
      rules: input.rules.filter((r) => ruleIds.includes(r.id)),
      debts: mine(input.debts),
      interest: mine(input.interest),
      dividends: input.dividends.filter((d) => only.has(d.accountId)),
    },
    ledger,
    from,
    setup.state.through,
  );
  if (!fresh.length) return 0;
  const col = <U>(f: (m: Movement) => U) => fresh.map(f);
  await tx.query(
    `insert into movement (account_id, day, seq, kind, amount_cents, instrument_id, qty_e8, price_e8,
       fx_e8, withholding_cents, transfer_id, source, rule_id, occurrence_key, provisional)
     select * from unnest($1::text[], $2::date[], $3::int[], $4::text[], $5::bigint[], $6::text[],
       $7::bigint[], $8::bigint[], $9::bigint[], $10::bigint[], $11::text[], $12::text[], $13::text[],
       $14::text[], $15::boolean[])
     on conflict (occurrence_key) where occurrence_key is not null do nothing`,
    [
      col((m) => m.accountId),
      col((m) => m.day),
      col((m) => m.seq),
      col((m) => m.kind),
      col((m) => m.amountCents),
      col((m) => m.instrumentId ?? null),
      col((m) => m.qtyE8?.toString() ?? null),
      col((m) => m.priceE8?.toString() ?? null),
      col((m) => m.fxE8?.toString() ?? null),
      col((m) => m.withholdingCents ?? 0),
      col((m) => m.transferId ?? null),
      col((m) => m.source),
      col((m) => m.ruleId ?? null),
      col((m) => m.occurrenceKey ?? null),
      col((m) => m.provisional ?? false),
    ],
  );
  return fresh.length;
}

// The history from the day after `from` up to where the engine is, again from the ledger as it is
// in `tx`, without making any movement: after a baja or a deletion, those days say what is true
// now. Never before the first day of history (that would make days that were never there).
export async function rebuildHistory(tx: Db, userId: string, from: Day) {
  await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [userId]);
  const setup = await readSetup(tx, userId);
  if (!setup.state) return;
  const [{ first }] = await tx.query<{ first: string | null }>(
    `select min(day)::text as first from user_day where user_id = $1`,
    [userId],
  );
  const start = first && addDays(first, -1) > from ? addDays(first, -1) : from;
  const through = setup.state.through;
  if (start >= through) return;
  const { ledger, input, holdings } = await loadUser(tx, userId, setup, start, false);
  const { days, months } = history(input, holdings, ledger, start, through);
  const col = <T, U>(xs: T[], f: (x: T) => U) => xs.map(f);
  await tx.query(
    `with ud as (
       insert into user_day (user_id, day, total_cents, flows_cents, accounts, classes)
       select $1, * from unnest($2::date[], $3::bigint[], $4::bigint[], $5::jsonb[], $6::jsonb[])
       on conflict (user_id, day) do update set total_cents = excluded.total_cents,
         flows_cents = excluded.flows_cents, accounts = excluded.accounts, classes = excluded.classes
       returning 1)
     insert into account_month (account_id, month, value_cents, flows_cents)
     select * from unnest($7::text[], $8::date[], $9::bigint[], $10::bigint[])
     on conflict (account_id, month) do update
       set value_cents = excluded.value_cents, flows_cents = excluded.flows_cents`,
    [
      userId,
      col(days, (x) => x[0]),
      col(days, (x) => x[1]),
      col(days, (x) => x[2]),
      col(days, (x) => x[3]),
      col(days, (x) => x[4]),
      col(months, (x) => x[0]),
      col(months, (x) => x[1]),
      col(months, (x) => x[2]),
      col(months, (x) => x[3]),
    ],
  );
}

// One user's run, alone (advisory lock) and all or nothing: generate what is owed up to `today`,
// reprice the buys whose close is out, rebuild the holdings cache, keep the daily and monthly
// history and refresh the alerts. Users not on the ledger yet (before the cut-over) are skipped.
export function runUser(db: Db, userId: string, today: Day) {
  return db.transaction((tx) => runUserIn(tx, userId, today));
}

// The same run inside a transaction the caller holds (the cut-over checks it before committing).
export async function runUserIn(tx: Db, userId: string, today: Day) {
  await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [userId]);
  const setup = await readSetup(tx, userId);
  const state = setup.state;
  if (!state) return null;
  const from = state.through < today ? state.through : today;
  const compact = !state.touched && state.forecast !== null;
  const { ledger, provisional, standIns, input, holdings } = await loadUser(
    tx,
    userId,
    setup,
    from,
    compact,
  );

  const fresh = advance(input, ledger, from, today);

  // Provisional buys whose own day's close is now published.
  const repriced: Movement[] = [];
  const repricedIds: string[] = [];
  for (const m of provisional) {
    const q = input.market.close(m.instrumentId!, m.day);
    const fx = input.market.perEur(input.market.currency(m.instrumentId!), m.day);
    if (q?.day !== m.day || !fx) continue;
    const r = reprice(m, q.priceE8, fx);
    repriced.push(r);
    repricedIds.push(m.id);
    // Compacted, the cache's stand-in holds the old units; whole, the movement itself does.
    const standIn = standIns.get(holdingKey(m.accountId, m.instrumentId!));
    if (standIn) standIn.qtyE8! += r.qtyE8! - m.qtyE8!;
    else Object.assign(m, r);
  }

  const all = [...ledger, ...fresh];
  const held = [...fold(all).holdings].filter(([, h]) => h.qtyE8 > 0n);

  const { days, months } = history(input, holdings, all, from, today);
  const today_ = valuation(holdings, all, today);
  const { alerts: found, forecast } = alerts(
    input,
    holdings,
    all,
    today,
    state.forecast ?? undefined,
    state.hand,
  );

  // The one write: every part is a data-modifying CTE of the same statement. The parts touch
  // different rows (positions kept are upserted, the others deleted; alerts found are upserted,
  // the others resolved), so a single snapshot is enough.
  const col = <T, U>(xs: T[], f: (x: T) => U) => xs.map(f);
  await tx.query(
    `with
     ins as (
       insert into movement (account_id, day, seq, kind, amount_cents, instrument_id, qty_e8, price_e8,
         fx_e8, withholding_cents, transfer_id, source, rule_id, occurrence_key, provisional)
       select * from unnest($1::text[], $2::date[], $3::int[], $4::text[], $5::bigint[], $6::text[],
         $7::bigint[], $8::bigint[], $9::bigint[], $10::bigint[], $11::text[], $12::text[], $13::text[],
         $14::text[], $15::boolean[])
       on conflict (occurrence_key) where occurrence_key is not null do nothing returning 1),
     rep as (
       update movement m set price_e8 = r.price, fx_e8 = r.fx, qty_e8 = r.qty, provisional = false
       from unnest($16::text[], $17::bigint[], $18::bigint[], $19::bigint[]) as r(id, price, fx, qty)
       where m.id = r.id returning 1),
     pos as (
       insert into position (account_id, instrument_id, qty_e8, cost_cents)
       select * from unnest($20::text[], $21::text[], $22::bigint[], $23::bigint[])
       on conflict (account_id, instrument_id) do update
         set qty_e8 = excluded.qty_e8, cost_cents = excluded.cost_cents, updated_at = now()
       returning 1),
     gone as (
       delete from position p where p.account_id = any($24::text[]) and not exists (
         select 1 from unnest($20::text[], $21::text[]) as k(a, i)
         where k.a = p.account_id and k.i = p.instrument_id)
       returning 1),
     ud as (
       insert into user_day (user_id, day, total_cents, flows_cents, accounts, classes)
       select $25, * from unnest($26::date[], $27::bigint[], $28::bigint[], $40::jsonb[], $41::jsonb[])
       on conflict (user_id, day) do update set total_cents = excluded.total_cents,
         flows_cents = excluded.flows_cents, accounts = excluded.accounts, classes = excluded.classes
       returning 1),
     am as (
       insert into account_month (account_id, month, value_cents, flows_cents)
       select * from unnest($29::text[], $30::date[], $31::bigint[], $32::bigint[])
       on conflict (account_id, month) do update
         set value_cents = excluded.value_cents, flows_cents = excluded.flows_cents
       returning 1),
     al as (
       insert into alert (user_id, kind, account_id, instrument_id, day, dedupe_key, detail)
       select $25, * from unnest($33::text[], $34::text[], $35::text[], $36::date[], $37::text[],
         $44::jsonb[])
       on conflict (user_id, dedupe_key) do update set day = excluded.day, detail = excluded.detail,
         state = case when alert.state = 'resuelta' then 'abierta' else alert.state end
       returning 1),
     -- Bridge until the projection reads the ledger (B13): v0 pages keep reading balance_cents.
     -- Not for an archived account: one archived in v0 keeps its last balance in Cuentas (it
     -- opened nothing in the ledger) and a baja already set its own to 0.
     bal as (
       update money_account m set balance_cents = least(99999999999, greatest(0, abs(b.v)))
       from unnest($42::text[], $43::bigint[]) as b(id, v)
       where m.id = b.id and m.archived_at is null
       returning 1),
     res as (
       update alert set state = 'resuelta'
       where user_id = $25 and state <> 'resuelta' and not (dedupe_key = any($37::text[]))
       returning 1)
     update engine_state set processed_through = $38, forecast = $39, updated_at = now()
     where user_id = $25`,
    [
      col(fresh, (m) => m.accountId),
      col(fresh, (m) => m.day),
      col(fresh, (m) => m.seq),
      col(fresh, (m) => m.kind),
      col(fresh, (m) => m.amountCents),
      col(fresh, (m) => m.instrumentId ?? null),
      col(fresh, (m) => m.qtyE8?.toString() ?? null),
      col(fresh, (m) => m.priceE8?.toString() ?? null),
      col(fresh, (m) => m.fxE8?.toString() ?? null),
      col(fresh, (m) => m.withholdingCents ?? 0),
      col(fresh, (m) => m.transferId ?? null),
      col(fresh, (m) => m.source),
      col(fresh, (m) => m.ruleId ?? null),
      col(fresh, (m) => m.occurrenceKey ?? null),
      col(fresh, (m) => m.provisional ?? false),
      repricedIds,
      col(repriced, (r) => r.priceE8!.toString()),
      col(repriced, (r) => r.fxE8!.toString()),
      col(repriced, (r) => r.qtyE8!.toString()),
      col(held, ([k]) => k.split('|')[0]),
      col(held, ([k]) => k.split('|')[1]),
      col(held, ([, h]) => h.qtyE8.toString()),
      col(held, ([, h]) => Math.max(0, h.costCents)),
      holdings.accounts.map((a) => a.id),
      userId,
      col(days, (x) => x[0]),
      col(days, (x) => x[1]),
      col(days, (x) => x[2]),
      col(months, (x) => x[0]),
      col(months, (x) => x[1]),
      col(months, (x) => x[2]),
      col(months, (x) => x[3]),
      col(found, (a) => a.kind),
      col(found, (a) => a.accountId ?? null),
      col(found, (a) => a.instrumentId ?? null),
      col(found, (a) => a.day),
      col(found, (a) => a.key),
      today,
      JSON.stringify(forecast),
      col(days, (x) => x[3]),
      col(days, (x) => x[4]),
      Object.keys(today_.byAccount),
      Object.values(today_.byAccount),
      col(found, (a) => JSON.stringify(a.detail)),
    ],
  );
  return { generated: fresh.length, repriced: repriced.length, alerts: found.length };
}
