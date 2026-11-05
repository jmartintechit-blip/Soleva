import { ASSUMPTIONS_BP, type Scenario } from './compound.ts';
import { addMonths } from './dates.ts';
import { type DebtTerms, amortization } from './debt.ts';
import { type Day, dayIn, dayOfMonth, daysAfter, monthOf } from './day.ts';
import type { AccountKind } from './insight.ts';
import { type InterestTerms, dailyAccrual, isPayDay, payment } from './interest.ts';
import { roundHalfAwayFromZero } from './money.ts';
import { propertyCents } from './valuation.ts';

// Proyección v2 (PROJECT_PLAN §11.11): from today's valuation of the ledger, month by month, in
// euros of each month. Interest and debt payments run day by day, as the daily engine would make
// them; investments, estimates and homes grow once a month at (1 + r)^(1/12); a car or another
// good follows its own series. Every change is an integer flow, so each step's change of the
// total is exactly the sum of its flows.

export type Group = 'inversiones' | 'efectivo' | 'inmuebles' | 'bienes' | 'estimados' | 'deudas';

// Where the money of a step came from. `aportado` is what the rules bring in minus what they take
// out (debt payments aside: their principal only moves money from cash to the debt).
export type FlowKind =
  'aportado' | 'intereses' | 'plusvalia' | 'inmuebles' | 'estimados' | 'depreciacion' | 'deudas';

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
  estimates?: { cents: number; rateBp: number }[];
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
  // How the rules' incomes and expenses grow a year («Tus ingresos y gastos»; the inflation by default).
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
  payments: Record<string, { paymentCents: number; rateBp: number }>;
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
});

export function projectLedger(
  accounts: readonly ProjectedAccount[],
  today: Day,
  months: number,
  scenario: Scenario,
  assumptions: ProjectionAssumptions = DEFAULT_ASSUMPTIONS,
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

  const scenarioBp = assumptions.returnBp[scenario];
  const prudenteBp = assumptions.returnBp.prudente;
  const investFactor = monthlyFactor(scenarioBp);
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
  const dues = new Map<
    Day,
    {
      debt: ProjectedAccount;
      interestCents: number;
      principalCents: number;
      paymentCents: number;
      rateBp: number;
    }[]
  >();
  for (const a of accounts) {
    const payer = a.debt?.payerAccountId;
    if (!a.debt || !payer || !ids.has(payer)) continue;
    for (const p of amortization(a.debt))
      if (p.day > today && p.day <= end)
        dues.set(p.day, [...(dues.get(p.day) ?? []), { debt: a, ...p }]);
  }

  const netAccrued = (a: ProjectedAccount) => payment(accrued.get(a.id)!, a.interest!).net;
  const snapshot = (
    day: Day,
    flows: Record<FlowKind, number>,
    payments: ProjectionStep['payments'],
  ): ProjectionStep => {
    const byAccount: Record<string, number> = {};
    const byGroup: Record<Group, number> = {
      inversiones: 0,
      efectivo: 0,
      inmuebles: 0,
      bienes: 0,
      estimados: 0,
      deudas: 0,
    };
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

    for (const d of daysAfter(from, to)) {
      // Debt payments first: interest is the payer's expense, the principal moves to the debt.
      for (const p of dues.get(d) ?? []) {
        const owed = -cash.get(p.debt.id)!;
        if (owed <= 0) continue;
        const principal = Math.min(owed, p.principalCents);
        const payer = p.debt.debt!.payerAccountId!;
        cash.set(payer, cash.get(payer)! - p.interestCents - principal);
        cash.set(p.debt.id, cash.get(p.debt.id)! + principal);
        flows.deudas -= p.interestCents;
        payments[p.debt.id] = { paymentCents: p.interestCents + principal, rateBp: p.rateBp };
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
        cash.set(a.id, cash.get(a.id)! + net);
        flows.intereses += net;
      }
    }
    flows.intereses +=
      accounts.filter((a) => a.interest).reduce((s, a) => s + netAccrued(a), 0) - accruedBefore;

    // Once a month: what grows at a rate, from the value at the start of the step.
    for (const a of accounts) {
      const inv = invested.get(a.id)!;
      const grownInv = roundHalfAwayFromZero(inv * investFactor);
      flows.plusvalia += grownInv - inv;
      invested.set(a.id, grownInv);

      const factors = estimateFactors.get(a.id)!;
      const est = estimates.get(a.id)!.map((c, i) => {
        const grown = roundHalfAwayFromZero(c * factors[i]!);
        flows.estimados += grown - c;
        return grown;
      });
      estimates.set(a.id, est);

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
