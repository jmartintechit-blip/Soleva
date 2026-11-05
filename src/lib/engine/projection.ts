import type { AutoRule } from './advance.ts';
import { ASSUMPTIONS_BP, type Scenario } from './compound.ts';
import { addMonths } from './dates.ts';
import { type DebtTerms, amortization } from './debt.ts';
import { type Day, dayIn, dayOfMonth, daysAfter, monthOf } from './day.ts';
import type { AccountKind } from './insight.ts';
import { type InterestTerms, dailyAccrual, isPayDay, payment } from './interest.ts';
import { roundHalfAwayFromZero } from './money.ts';
import { occurrences } from './schedule.ts';
import { propertyCents } from './valuation.ts';

// Proyección v2 (PROJECT_PLAN §11.11): from today's valuation of the ledger, month by month, in
// euros of each month. Interest and debt payments run day by day, as the daily engine would make
// them; investments, estimates and homes grow once a month at (1 + r)^(1/12); a car or another
// good follows its own series; the rules and plans move money on their real days. Every change
// is an integer flow, so each step's change of the total is exactly the sum of its flows.

export type Group = 'inversiones' | 'efectivo' | 'inmuebles' | 'bienes' | 'estimados' | 'deudas';

// Where the money of a step came from. `aportado` is what the rules bring in minus what they take
// out (debt payments aside: their principal only moves money from cash to the debt). `inflacion`
// is only there in euros of today: what inflation takes from what you have, less what you owe.
export type FlowKind =
  | 'aportado'
  | 'intereses'
  | 'plusvalia'
  | 'inmuebles'
  | 'estimados'
  | 'depreciacion'
  | 'deudas'
  | 'inflacion';

export interface ProjectedAccount {
  id: string;
  kind: AccountKind;
  // Cash in the ledger today; for a debt, what is owed (negative).
  cashCents: number;
  // A savings account: its terms, and the interest earned and not paid yet (millionths of a cent).
  interest?: InterestTerms;
  accruedMicro?: bigint;
  // Units with a public price at today's close: they grow at the scenario.
  investedCents?: number;
  // Products without a public price: each at its own yearly rate (in prudente, at most that one).
  // A plan's buy of that instrument adds to it.
  estimates?: { instrumentId?: string; cents: number; rateBp: number }[];
  // A home: today's value and the yearly growth its owner assumes.
  home?: { cents: number; growthBp: number };
  // A car or another good: what was put into it along its series (Hacienda's table, a yearly loss).
  curve?: {
    flows: { day: Day; cents: number; from?: Day }[];
    index: { quarter: Day; indexE3: number }[];
    step?: number;
  };
  // A debt: its terms; the payments come out of the payer's cash on their days.
  debt?: DebtTerms & { payerAccountId?: string };
}

export interface ProjectionAssumptions {
  returnBp: Record<Scenario, number>;
  inflationBp: number;
  // How the rules' incomes and expenses grow a year («Tus ingresos y gastos»; the inflation by
  // default, so they stay the same in euros of today). Plans and transfers keep their amount.
  rulesGrowthBp: number;
}

export const DEFAULT_ASSUMPTIONS: ProjectionAssumptions = {
  returnBp: {
    prudente: ASSUMPTIONS_BP.prudente,
    base: ASSUMPTIONS_BP.base,
    optimista: ASSUMPTIONS_BP.optimista,
  },
  inflationBp: ASSUMPTIONS_BP.inflation,
  rulesGrowthBp: ASSUMPTIONS_BP.inflation,
};

export interface ProjectionStep {
  day: Day;
  totalCents: number;
  byAccount: Record<string, number>;
  byGroup: Record<Group, number>;
  // What changed since the step before (all zero on the first one, today).
  flows: Record<FlowKind, number>;
  // Debt payments made in the step, per debt: what changes with a review, or stops when paid.
  payments: Record<string, { day: Day; paymentCents: number; rateBp: number }>;
}

const INVESTED: AccountKind[] = ['broker', 'cripto', 'pension'];
const DEBTS: AccountKind[] = ['deuda_hipoteca', 'deuda_prestamo'];
const groupOfCash = (k: AccountKind): Group =>
  INVESTED.includes(k)
    ? 'inversiones'
    : DEBTS.includes(k)
      ? 'deudas'
      : k === 'inmueble'
        ? 'inmuebles'
        : k === 'vehiculo' || k === 'bien'
          ? 'bienes'
          : 'efectivo';

const monthlyFactor = (annualBp: number) => (1 + annualBp / 10_000) ** (1 / 12);

// The day of step k: today's day of the month k months on (the 31st falls on the last day of a
// shorter month, and a 29 February comes back to the 29th in the next leap year).
export const stepDay = (today: Day, k: number): Day =>
  dayIn(addMonths(monthOf(today), k), dayOfMonth(today));

const noFlows = (): Record<FlowKind, number> => ({
  aportado: 0,
  intereses: 0,
  plusvalia: 0,
  inmuebles: 0,
  estimados: 0,
  depreciacion: 0,
  deudas: 0,
  inflacion: 0,
});

const emptyGroups = (): Record<Group, number> => ({
  inversiones: 0,
  efectivo: 0,
  inmuebles: 0,
  bienes: 0,
  estimados: 0,
  deudas: 0,
});

// A rule as the projection takes it: «¿Qué pasa si…?» can pause it for a while (the days after
// `from` up to `to`, included). Never stored: the daily engine has no pauses.
export type ProjectedRule = AutoRule & { pause?: { from: Day; to: Day } };

// The order the daily engine runs a day in (advance.ts): incomes, transfers, expenses, plans.
const ORDER: AutoRule['kind'][] = ['ingreso', 'transferencia', 'gasto', 'plan'];

export function projectLedger(
  accounts: readonly ProjectedAccount[],
  today: Day,
  months: number,
  scenario: Scenario,
  assumptions: ProjectionAssumptions = DEFAULT_ASSUMPTIONS,
  rules: readonly ProjectedRule[] = [],
): ProjectionStep[] {
  const ids = new Set(accounts.map((a) => a.id));
  const cash = new Map(accounts.map((a) => [a.id, a.cashCents]));
  const accrued = new Map(
    accounts.filter((a) => a.interest).map((a) => [a.id, a.accruedMicro ?? 0n]),
  );
  const invested = new Map(accounts.map((a) => [a.id, a.investedCents ?? 0]));
  const estimates = new Map(accounts.map((a) => [a.id, (a.estimates ?? []).map((e) => e.cents)]));
  const homes = new Map(accounts.map((a) => [a.id, a.home?.cents ?? 0]));
  const curveAt = (a: ProjectedAccount, d: Day) =>
    a.curve ? propertyCents(a.curve.flows, a.curve.index, d, a.curve.step) : 0;
  const curves = new Map(accounts.map((a) => [a.id, curveAt(a, today)]));
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const investFactor = monthlyFactor(assumptions.returnBp[scenario]);
  const prudenteBp = assumptions.returnBp.prudente;
  const estimateFactors = new Map(
    accounts.map((a) => [
      a.id,
      (a.estimates ?? []).map((e) =>
        monthlyFactor(scenario === 'prudente' ? Math.min(e.rateBp, prudenteBp) : e.rateBp),
      ),
    ]),
  );

  // Payments due after today, by day, for the debts whose payer is projected too.
  const end = stepDay(today, months);
  type Due = {
    debt: ProjectedAccount;
    interestCents: number;
    principalCents: number;
    rateBp: number;
  };
  const dues = new Map<Day, Due[]>();
  for (const a of accounts) {
    const payer = a.debt?.payerAccountId;
    if (!a.debt || !payer || !ids.has(payer)) continue;
    for (const p of amortization(a.debt))
      if (p.day > today && p.day <= end)
        dues.set(p.day, [...(dues.get(p.day) ?? []), { debt: a, ...p }]);
  }

  // Each live rule on its days, if every account it touches is in the projection.
  const ruleDays = new Map<Day, AutoRule[]>();
  for (const r of [...rules].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))) {
    const touched = [r.fromAccountId, r.toAccountId, r.shortfallAccountId].filter(Boolean);
    if (!r.active || !touched.every((id) => ids.has(id!))) continue;
    for (const d of occurrences(r, today, end))
      if (!r.pause || d <= r.pause.from || d > r.pause.to)
        ruleDays.set(d, [...(ruleDays.get(d) ?? []), r]);
  }

  const netAccrued = (a: ProjectedAccount) => payment(accrued.get(a.id)!, a.interest!).net;
  const move = (id: string, cents: number) => cash.set(id, cash.get(id)! + cents);
  const snapshot = (
    day: Day,
    flows: Record<FlowKind, number>,
    payments: ProjectionStep['payments'],
  ): ProjectionStep => {
    const byAccount: Record<string, number> = {};
    const byGroup = emptyGroups();
    for (const a of accounts) {
      const own = cash.get(a.id)! + (a.interest ? netAccrued(a) : 0);
      const est = estimates.get(a.id)!.reduce((s, c) => s + c, 0);
      byGroup[groupOfCash(a.kind)] += own;
      byGroup.inversiones += invested.get(a.id)!;
      byGroup.estimados += est;
      byGroup.inmuebles += homes.get(a.id)!;
      byGroup.bienes += curves.get(a.id)!;
      byAccount[a.id] = own + invested.get(a.id)! + est + homes.get(a.id)! + curves.get(a.id)!;
    }
    const totalCents = Object.values(byAccount).reduce((s, c) => s + c, 0);
    return { day, totalCents, byAccount, byGroup, flows, payments };
  };

  const steps = [snapshot(today, noFlows(), {})];
  for (let k = 1; k <= months; k++) {
    const from = stepDay(today, k - 1);
    const to = stepDay(today, k);
    const flows = noFlows();
    const payments: ProjectionStep['payments'] = {};
    const accruedBefore = accounts.filter((a) => a.interest).reduce((s, a) => s + netAccrued(a), 0);
    // What grows this month is what there was at its start; this month's buys grow from the next.
    const investedBefore = new Map(invested);
    const estimatesBefore = new Map([...estimates].map(([id, e]) => [id, [...e]]));
    const indexed = (cents: number) =>
      roundHalfAwayFromZero(cents * (1 + assumptions.rulesGrowthBp / 10_000) ** (k / 12));

    for (const d of daysAfter(from, to)) {
      for (const r of ruleDays.get(d) ?? []) {
        if (r.kind === 'ingreso') {
          const cents = indexed(r.amountCents!);
          move(r.toAccountId!, cents);
          flows.aportado += cents;
        } else if (r.kind === 'gasto') {
          const cents = indexed(r.amountCents!);
          move(r.fromAccountId!, -cents);
          flows.aportado -= cents;
        } else if (r.kind === 'transferencia') {
          move(r.fromAccountId!, -r.amountCents!);
          move(r.toAccountId!, r.amountCents!);
        } else
          for (const leg of r.legs) {
            // A broker never goes below zero: bring the money from the chosen account, or skip.
            if (cash.get(r.fromAccountId!)! < leg.amountCents) {
              if (r.shortfall !== 'otra_cuenta' || !r.shortfallAccountId) continue;
              move(r.shortfallAccountId, -leg.amountCents);
              move(r.fromAccountId!, leg.amountCents);
            }
            move(r.fromAccountId!, -leg.amountCents);
            const a = byId.get(r.fromAccountId!)!;
            const i = (a.estimates ?? []).findIndex((e) => e.instrumentId === leg.instrumentId);
            if (i >= 0) estimates.get(a.id)![i]! += leg.amountCents;
            else invested.set(a.id, invested.get(a.id)! + leg.amountCents);
          }
      }
      // Debt payments: interest is the payer's expense, the principal moves to the debt.
      for (const p of dues.get(d) ?? []) {
        const owed = -cash.get(p.debt.id)!;
        if (owed <= 0) continue;
        const principal = Math.min(owed, p.principalCents);
        move(p.debt.debt!.payerAccountId!, -p.interestCents - principal);
        move(p.debt.id, principal);
        flows.deudas -= p.interestCents;
        payments[p.debt.id] = {
          day: d,
          paymentCents: p.interestCents + principal,
          rateBp: p.rateBp,
        };
      }
      // Interest on the day's closing balance, paid net of withholding on its day.
      for (const a of accounts) {
        if (!a.interest) continue;
        const sum = accrued.get(a.id)! + dailyAccrual(cash.get(a.id)!, a.interest, d);
        if (!isPayDay(a.interest, d)) {
          accrued.set(a.id, sum);
          continue;
        }
        const { net } = payment(sum, a.interest);
        accrued.set(a.id, 0n);
        move(a.id, net);
        flows.intereses += net;
      }
    }
    flows.intereses +=
      accounts.filter((a) => a.interest).reduce((s, a) => s + netAccrued(a), 0) - accruedBefore;

    // Once a month: what grows at a rate.
    for (const a of accounts) {
      const inv = investedBefore.get(a.id)!;
      const gain = roundHalfAwayFromZero(inv * investFactor) - inv;
      flows.plusvalia += gain;
      invested.set(a.id, invested.get(a.id)! + gain);

      const factors = estimateFactors.get(a.id)!;
      const before = estimatesBefore.get(a.id)!;
      estimates.set(
        a.id,
        estimates.get(a.id)!.map((c, i) => {
          const g = roundHalfAwayFromZero(before[i]! * factors[i]!) - before[i]!;
          flows.estimados += g;
          return c + g;
        }),
      );

      if (a.home) {
        const h = homes.get(a.id)!;
        const grown = roundHalfAwayFromZero(h * monthlyFactor(a.home.growthBp));
        flows.inmuebles += grown - h;
        homes.set(a.id, grown);
      }
      if (a.curve) {
        const v = curveAt(a, to);
        flows.depreciacion += v - curves.get(a.id)!;
        curves.set(a.id, v);
      }
    }
    steps.push(snapshot(to, flows, payments));
  }
  return steps;
}

// Integer parts of `values` that add up to exactly `total` (largest remainder): each one is its
// value rounded down, and the units left go to the largest fractions.
export function apportion(values: readonly number[], total: number): number[] {
  const floors = values.map(Math.floor);
  let left = total - floors.reduce((s, x) => s + x, 0);
  const order = values.map((v, i) => [v - floors[i]!, i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i]!++;
    left--;
  }
  // A total under the rounded-down sum (only from float noise): take from the smallest fractions.
  for (const [, i] of order.reverse()) {
    if (left >= 0) break;
    floors[i]!--;
    left++;
  }
  return floors;
}

const apportionRecord = <K extends string>(rec: Record<K, number>, total: number) => {
  const keys = Object.keys(rec) as K[];
  const parts = apportion(
    keys.map((k) => rec[k]),
    total,
  );
  return Object.fromEntries(keys.map((k, i) => [k, parts[i]!])) as Record<K, number>;
};

// The same steps in euros of today: step k is deflated by (1 + inflation)^(k/12), each flow in the
// month it happens. Values and flows stay whole cents; what is left of each step's change after
// the other flows is what inflation took (−(assets − debts at the start) × the month's inflation,
// deflated, up to the rounding), so the identity still holds to the cent.
export function inTodayEuros(steps: readonly ProjectionStep[], inflationBp: number) {
  const out: ProjectionStep[] = [];
  steps.forEach((s, k) => {
    const deflator = (1 + inflationBp / 10_000) ** (k / 12);
    const totalCents = roundHalfAwayFromZero(s.totalCents / deflator);
    const real = <K extends string>(rec: Record<K, number>) =>
      apportionRecord(
        Object.fromEntries(
          Object.entries(rec).map(([id, c]) => [id, (c as number) / deflator]),
        ) as Record<K, number>,
        totalCents,
      );
    const flows = noFlows();
    if (k > 0) {
      for (const f of Object.keys(flows) as FlowKind[])
        if (f !== 'inflacion') flows[f] = roundHalfAwayFromZero(s.flows[f] / deflator);
      const others = Object.values(flows).reduce((a, b) => a + b, 0);
      flows.inflacion = totalCents - out[k - 1]!.totalCents - others;
    }
    out.push({
      ...s,
      totalCents,
      byAccount: real(s.byAccount),
      byGroup: real(s.byGroup),
      flows,
    });
  });
  return out;
}

// «De dónde sale» to 100 €: what you have today and the flows of the whole horizon, rounded so the
// rows add up to the figure (the final total to 100 €). Without inflation in euros of then.
export const ROW_STEP = 10_000;

export function breakdown(steps: readonly ProjectionStep[], step = ROW_STEP) {
  const sum = (kinds: FlowKind[]) =>
    steps.reduce((s, x) => s + kinds.reduce((t, f) => t + x.flows[f], 0), 0);
  const rows = {
    hoy: steps[0]!.totalCents,
    aportado: sum(['aportado']),
    rentabilidad: sum(['intereses', 'plusvalia', 'inmuebles', 'estimados']),
    depreciacion: sum(['depreciacion']),
    deudas: sum(['deudas']),
    inflacion: sum(['inflacion']),
  };
  return roundRows(rows, steps.at(-1)!.totalCents, step);
}

// Rows of a total to `step` (100 € by default), adding up to the total to `step`.
export function roundRows<K extends string>(
  rows: Record<K, number>,
  totalCents: number,
  step = ROW_STEP,
): { figure: number; rows: Record<K, number> } {
  const figure = roundHalfAwayFromZero(totalCents / step);
  const units = apportionRecord(
    Object.fromEntries(Object.entries(rows).map(([k, c]) => [k, (c as number) / step])) as Record<
      K,
      number
    >,
    figure,
  );
  const scaled = Object.fromEntries(
    Object.entries(units).map(([k, u]) => [k, (u as number) * step]),
  ) as Record<K, number>;
  return { figure: figure * step, rows: scaled };
}

export type Milestone =
  | { kind: 'fin_promocion'; day: Day; accountId: string; fromBp: number; toBp: number }
  | {
      kind: 'revision';
      day: Day;
      accountId: string;
      fromCents: number;
      toCents: number;
      rateBp: number;
    }
  | { kind: 'deuda_pagada'; day: Day; accountId: string; freedCents: number }
  | { kind: 'fin_regla'; day: Day; ruleId: string };

// What happens within the horizon, by day: a promotion that ends, a review of a variable or mixed
// mortgage that changes its payment, a debt paid off (and the payment it frees) and a rule or plan
// that ends.
export function milestones(
  accounts: readonly ProjectedAccount[],
  rules: readonly AutoRule[],
  steps: readonly ProjectionStep[],
): Milestone[] {
  const today = steps[0]!.day;
  const end = steps.at(-1)!.day;
  const within = (d: Day | undefined): d is Day => d !== undefined && d > today && d <= end;
  const out: Milestone[] = [];
  for (const a of accounts) {
    const t = a.interest;
    if (t && within(t.promoUntil))
      out.push({
        kind: 'fin_promocion',
        day: t.promoUntil,
        accountId: a.id,
        fromBp: t.tiers[0]?.rateBp ?? 0,
        toBp: t.afterRateBp ?? 0,
      });
    if (!a.debt) continue;
    let last: { paymentCents: number; rateBp: number } | undefined;
    for (let k = 1; k < steps.length; k++) {
      const p = steps[k]!.payments[a.id];
      if (!p) continue;
      if (last && p.rateBp !== last.rateBp)
        out.push({
          kind: 'revision',
          day: p.day,
          accountId: a.id,
          fromCents: last.paymentCents,
          toCents: p.paymentCents,
          rateBp: p.rateBp,
        });
      if (steps[k]!.byAccount[a.id] === 0 && steps[k - 1]!.byAccount[a.id]! < 0)
        // The last payment clears the rounding: it frees the usual one.
        out.push({
          kind: 'deuda_pagada',
          day: p.day,
          accountId: a.id,
          freedCents: last?.paymentCents ?? p.paymentCents,
        });
      last = p;
    }
  }
  for (const r of rules)
    if (r.active && r.frequency !== 'una_vez' && within(r.endOn))
      out.push({ kind: 'fin_regla', day: r.endOn, ruleId: r.id });
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
