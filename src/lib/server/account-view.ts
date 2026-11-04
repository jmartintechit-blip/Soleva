import { type Day, addDays } from '#lib/engine/day.ts';
import { estimateCents } from '#lib/engine/valuation.ts';
import { estimateContributions } from '#lib/engine/insight.ts';
import type { MovementKind } from '#lib/engine/ledger.ts';
import { occurrences } from '#lib/engine/schedule.ts';
import { E8, valueCents } from '#lib/engine/units.ts';
import type { Db } from './db/index.ts';
import { type DayRow, period } from './home.ts';

export interface Position {
  instrumentId: string;
  name: string;
  kind: string;
  qtyE8: string;
  priceE8: string | null;
  priceDay: Day | null;
  currency: string;
  valueCents: number;
  gainCents: number;
  costCents: number;
  estimate: boolean;
  rateBp: number | null;
  stale: boolean;
}

export interface Move {
  day: Day;
  kind: string;
  amountCents: number;
  withholdingCents: number;
  source: string;
  rule: string | null;
  ruleId: string | null;
  instrument: string | null;
  qtyE8: string | null;
  priceE8: string | null;
  fxE8: string | null;
  note: string | null;
  other: string | null;
}

// Everything the account page shows, for someone with access to it (null otherwise: 404). One
// query; values, gains and the next plan day are worked out here from what it returns.
export async function loadAccountView(db: Db, userId: string, accountId: string, today: Day) {
  const [{ j }] = await db.query<{ j: string | null }>(
    `with acc as (
       select a.id, a.name, a.kind from money_account a
       join account_access x on x.account_id = a.id and x.user_id = $1
       where a.id = $2)
     select case when not exists (select 1 from acc) then null else json_build_object(
       'account', (select row_to_json(acc) from acc),
       'cash', (select coalesce(sum(amount_cents), 0)::text from movement
                where account_id = $2 and voided_at is null),
       'positions', (select coalesce(json_agg(json_build_object('instrumentId', i.id, 'name', i.name,
           'kind', i.kind, 'currency', i.currency, 'qty', p.qty_e8::text, 'cost', p.cost_cents::text,
           'price', (select json_build_array(day, close_e8::text) from (
               select day, close_e8, 0 as own from price where instrument_id = i.id and day <= $3
               union all
               select day, close_e8, 1 from price_override where user_id = $1 and instrument_id = i.id and day <= $3
               order by day desc, own desc limit 1) q),
           'fx', (select per_eur_e8::text from fx_rate where currency = i.currency and day <= $3
                  order by day desc limit 1),
           'rate', (select annual_rate_bp from estimate_config e where e.account_id = $2 and e.instrument_id = i.id),
           'since', (select since_on from estimate_config e where e.account_id = $2 and e.instrument_id = i.id),
           'buys', case when i.kind = 'estimado' then (select json_agg(json_build_array(m.day, m.amount_cents,
                       m.kind, m.qty_e8::text, m.price_e8::text, m.fx_e8::text))
                     from movement m where m.account_id = $2 and m.instrument_id = i.id
                       and m.qty_e8 > 0 and m.voided_at is null) end)
         order by i.name), '[]')
         from position p join instrument i on i.id = p.instrument_id
         where p.account_id = $2 and p.qty_e8 > 0),
       'plans', (select coalesce(json_agg(json_build_object('id', r.id, 'name', r.name,
           'frequency', r.frequency, 'day', r.day, 'startOn', r.start_on, 'endOn', r.end_on,
           'legs', (select json_agg(json_build_object('name', i.name, 'amountCents', l.amount_cents)
                    order by l.seq) from auto_rule_leg l join instrument i on i.id = l.instrument_id
                    where l.rule_id = r.id))), '[]')
         from auto_rule r where r.from_account_id = $2 and r.kind = 'plan' and r.active),
       'inflow', (select coalesce(sum(r.amount_cents * case r.frequency when 'semanal' then 52.0 / 12
           when 'quincenal' then 26.0 / 12 when 'mensual' then 1 when 'trimestral' then 1.0 / 3
           when 'anual' then 1.0 / 12 else 0 end), 0)::float8
         from auto_rule r where r.to_account_id = $2 and r.active and r.kind in ('ingreso', 'transferencia')),
       'interest', (select json_build_object('rateBp', (select rate_bp from interest_tier t
           where t.account_id = c.account_id order by up_to_cents nulls last limit 1),
           'payDay', c.pay_day, 'withholdingBp', c.withholding_bp)
         from interest_config c where c.account_id = $2),
       'days', (select coalesce(json_agg(json_build_array(day, total_cents, flows_cents, accounts) order by day), '[]')
                from user_day where user_id = $1 and day >= $4),
       'moves', (select coalesce(json_agg(json_build_object('day', m.day, 'kind', m.kind,
           'amountCents', m.amount_cents, 'withholdingCents', m.withholding_cents, 'source', m.source,
           'rule', r.name, 'ruleId', m.rule_id, 'instrument', i.name, 'qtyE8', m.qty_e8::text, 'note', m.note,
           'priceE8', m.price_e8::text, 'fxE8', m.fx_e8::text,
           'other', (select a2.name from movement o join money_account a2 on a2.id = o.account_id
                     where o.transfer_id = m.transfer_id and o.id <> m.id limit 1))
         order by m.day desc, m.seq desc, m.created_at desc), '[]')
         from (select * from movement where account_id = $2 and voided_at is null
               order by day desc, seq desc, created_at desc limit 60) m
         left join auto_rule r on r.id = m.rule_id left join instrument i on i.id = m.instrument_id)
     ) end::text as j`,
    [userId, accountId, today, addDays(today, -40)],
  );
  if (!j) return null;
  const d = JSON.parse(j) as {
    account: { id: string; name: string; kind: string };
    cash: string;
    positions: {
      instrumentId: string;
      name: string;
      kind: string;
      currency: string;
      qty: string;
      cost: string;
      price: [Day, string] | null;
      fx: string | null;
      rate: number | null;
      since: Day | null;
      buys: [Day, number, MovementKind, string, string | null, string | null][] | null;
    }[];
    plans: {
      id: string;
      name: string;
      frequency: 'semanal' | 'quincenal' | 'mensual' | 'trimestral' | 'anual' | 'una_vez';
      day: number | null;
      startOn: Day;
      endOn: Day | null;
      legs: { name: string; amountCents: number }[];
    }[];
    inflow: number;
    interest: { rateBp: number; payDay: number; withholdingBp: number } | null;
    days: [Day, number, number, DayRow['accounts']][];
    moves: Move[];
  };

  const positions = d.positions.map((p): Position => {
    const estimate = p.kind === 'estimado';
    const cost = Number(p.cost);
    let value = cost;
    if (estimate)
      value = estimateCents(
        estimateContributions(
          (p.buys ?? []).map(([day, amountCents, kind, qty, price, fx]) => ({
            day,
            amountCents,
            kind,
            qtyE8: BigInt(qty),
            priceE8: price ? BigInt(price) : undefined,
            fxE8: fx ? BigInt(fx) : undefined,
          })),
          p.since ?? undefined,
        ),
        p.rate ?? 0,
        today,
      );
    else if (p.price) {
      const fx = p.currency === 'EUR' ? E8 : p.fx ? BigInt(p.fx) : null;
      if (fx) value = valueCents(BigInt(p.qty), BigInt(p.price[1]), fx);
    }
    return {
      instrumentId: p.instrumentId,
      name: p.name,
      kind: p.kind,
      qtyE8: p.qty,
      priceE8: p.price?.[1] ?? null,
      priceDay: p.price?.[0] ?? null,
      currency: p.currency,
      valueCents: value,
      gainCents: value - cost,
      costCents: cost,
      estimate,
      rateBp: p.rate,
      // More than five days without a close (weekends included), as the alert says.
      stale: !estimate && (!p.price || p.price[0] < addDays(today, -7)),
    };
  });
  const rows = d.days.map(([day, total, flows, accounts]): DayRow => ({
    day,
    total,
    flows,
    accounts,
  }));
  const month = period(rows, 'mes', today);
  const accrued = rows.at(-1)?.accounts[accountId]?.[2] ?? 0;
  const cash = Number(d.cash);
  const monthStart = `${today.slice(0, 7)}-01`;
  const cameIn = d.moves.filter(
    (m) => m.day >= monthStart && m.kind === 'transferencia' && m.amountCents > 0,
  );
  return {
    account: d.account,
    // The run's own value of today (Inicio shows the same), or the sum here before the first run.
    value:
      rows.at(-1)?.day === today
        ? (rows.at(-1)!.accounts[accountId]?.[0] ?? 0)
        : cash + accrued + positions.reduce((s, p) => s + p.valueCents, 0),
    cash,
    accrued,
    monthGain: month.accounts[accountId] ?? 0,
    cameIn: cameIn.reduce((s, m) => s + m.amountCents, 0),
    cameFrom: [...new Set(cameIn.map((m) => m.other).filter(Boolean))] as string[],
    positions,
    plans: d.plans.map((p) => ({
      ...p,
      total: p.legs.reduce((s, l) => s + l.amountCents, 0),
      next:
        occurrences(
          {
            frequency: p.frequency,
            day: p.day ?? undefined,
            startOn: p.startOn,
            endOn: p.endOn ?? undefined,
          },
          addDays(today, -1),
          addDays(today, 400),
        )[0] ?? null,
    })),
    inflow: Math.round(d.inflow),
    interest: d.interest,
    moves: d.moves,
  };
}
