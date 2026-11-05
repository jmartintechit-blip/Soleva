// Cómo voy, «¿Qué pasa si…?» and «Amortizar o invertir» on the design's household (INVENTED).
import { describe, expect, it } from 'vitest';
import type { Scenario } from './compound.ts';
import { amortization } from './debt.ts';
import { TODAY, household, householdRules } from './household.testdata.ts';
import { fixPlan, howAmI, plannedOn } from './myplan.ts';
import {
  DEFAULT_ASSUMPTIONS,
  type ProjectedRule,
  breakdown,
  inTodayEuros,
  projectLedger,
} from './projection.ts';
import { amortizeOrInvest, contributeMore, oneOffExpense, pausePlan, prepaid } from './whatif.ts';

const nominal = (rules: ProjectedRule[] = householdRules(), s: Scenario = 'base') =>
  projectLedger(household(), TODAY, 240, s, DEFAULT_ASSUMPTIONS, rules);
const figure = (rules?: ProjectedRule[]) =>
  breakdown(inTodayEuros(nominal(rules), DEFAULT_ASSUMPTIONS.inflationBp)).figure;
// Within `pct` % of the design's figure (its numbers come from a monthly model).
const near = (actual: number, design: number, pct = 1) =>
  expect(Math.abs(actual - design)).toBeLessThanOrEqual((Math.abs(design) * pct) / 100);

describe('Cómo voy', () => {
  const steps = nominal();
  const plan = fixPlan(steps, 'base', 'hoy', 40_950_000);

  it('keeps the path month by month in euros of then, with what the rules were to bring in', () => {
    expect(plan.fixedOn).toBe(TODAY);
    expect(plan.months).toBe(240);
    expect(plan.path).toHaveLength(241);
    expect(plan.path[12]).toEqual({
      day: '2027-11-05',
      totalCents: steps[12]!.totalCents,
      contributedCents: steps.slice(1, 13).reduce((s, x) => s + x.flows.aportado, 0),
    });
    expect(plannedOn(plan, '2026-11-04')).toBeNull();
    expect(plannedOn(plan, '2046-12-01')!.totalCents).toBe(steps[240]!.totalCents);
    // Halfway between two steps (15 of 30 days), halfway between their values.
    const mid = plannedOn(plan, '2026-11-20')!.totalCents;
    expect(mid).toBe(Math.round((steps[0]!.totalCents + steps[1]!.totalCents) / 2));
  });

  it('is on track within 1 % of the plan, and explains the gap in three rows that add up to it', () => {
    const day = '2027-11-05';
    const planned = plan.path[12]!;
    const on = howAmI(plan, day, {
      totalCents: planned.totalCents - 50_000,
      rulesCents: planned.contributedCents,
      outsideCents: 0,
    })!;
    expect(on.level).toBe('en_camino');
    expect(on.gapCents).toBe(-50_000);
    // 3.000 € under, 1.000 € of them because less came in and 1.200 € spent outside the rules.
    const below = howAmI(plan, day, {
      totalCents: planned.totalCents - 300_000,
      rulesCents: planned.contributedCents - 100_000,
      outsideCents: -120_000,
    })!;
    expect(below.level).toBe('por_debajo');
    expect(below.why).toEqual({ aportado: -100_000, rentabilidad: -80_000, fuera: -120_000 });
    expect(below.why.aportado + below.why.rentabilidad + below.why.fuera).toBe(below.gapCents);
    const above = howAmI(plan, day, {
      totalCents: planned.totalCents + 300_000,
      rulesCents: planned.contributedCents,
      outsideCents: 0,
    })!;
    expect(above.level).toBe('por_encima');
    expect(above.why.rentabilidad).toBe(300_000);
  });
});

describe('¿Qué pasa si…?', () => {
  const base = figure();

  it('puts 200 € more a month into the plan, from the savings account (design: 433.600 €)', () => {
    const rules = contributeMore(householdRules(), { planId: 'plan' }, 'rem', 20_000, TODAY);
    expect(rules).toHaveLength(householdRules().length + 1);
    near(figure(rules), 43_360_000);
    // To an account instead: the transfer only moves money, so it is a little more than nothing.
    const toBroker = contributeMore(householdRules(), { accountId: 'brk' }, 'rem', 20_000, TODAY);
    expect(nominal(toBroker).at(-1)!.byAccount.brk).toBeGreaterThan(
      nominal().at(-1)!.byAccount.brk!,
    );
    expect(contributeMore(householdRules(), { planId: 'plan' }, 'rem', 0, TODAY)).toEqual(
      householdRules(),
    );
  });

  it('pauses the plan for 6 months and the money stays in cash (design: 405.500 €)', () => {
    const rules = pausePlan(householdRules(), 'plan', 6, TODAY);
    const steps = nominal(rules);
    const plain = nominal();
    expect(steps[6]!.byGroup.inversiones).toBeLessThan(plain[6]!.byGroup.inversiones);
    expect(steps[6]!.totalCents).toBeLessThan(plain[6]!.totalCents);
    // From the 7th month it buys again, as much as before.
    const bought = (s: typeof steps, k: number) =>
      s[k]!.byGroup.inversiones - s[k - 1]!.byGroup.inversiones - s[k]!.flows.plusvalia;
    expect(bought(steps, 3)).toBe(0);
    expect(bought(steps, 8)).toBe(bought(plain, 8));
    near(figure(rules), 40_550_000);
  });

  it('spends 15.000 € of today in a year, from the savings account (design: 398.700 €)', () => {
    const rules = oneOffExpense(householdRules(), 'rem', 1_500_000, 12, TODAY);
    const steps = nominal(rules);
    // In euros of then it costs 15.000 × 1,025 on 5 November 2027.
    expect(steps[12]!.flows.aportado - nominal()[12]!.flows.aportado).toBe(-1_537_500);
    near(figure(rules), 39_870_000);
    expect(figure(rules)).toBeLessThan(base);
  });
});

describe('Amortizar o invertir', () => {
  const debt = household().find((a) => a.id === 'hip')!.debt!;

  it('lowers the payment for the same months, or keeps it and ends sooner, keeping the review', () => {
    const cuota = prepaid(debt, TODAY, 1_000_000, 'cuota')!;
    const plazo = prepaid(debt, TODAY, 1_000_000, 'plazo')!;
    const a = amortization(cuota);
    const b = amortization(plazo);
    expect(a).toHaveLength(180);
    expect(Math.round(a[0]!.paymentCents / 100)).toBe(530);
    expect(Math.abs(b[0]!.paymentCents - 59_764)).toBeLessThanOrEqual(100);
    expect(b.length).toBeLessThan(180);
    // Still fixed for three years and then 3 %.
    expect(a[35]!.rateBp).toBe(260);
    expect(a[36]!.rateBp).toBe(300);
    expect(b[36]!.rateBp).toBe(300);
    expect(prepaid(debt, TODAY, 9_000_000, 'cuota')!.principalCents).toBe(0);
  });

  it('keeps the review months when a mortgage is prepaid after some payments', () => {
    const later = '2030-02-10';
    const plan = amortization(debt);
    const done = plan.filter((p) => p.day <= later).length;
    const after = amortization(prepaid(debt, later, 500_000, 'cuota')!);
    // The next review of the original is a year after December 2029: December 2030.
    const k = plan.findIndex((p, i) => i > done && (i - 36) % 12 === 0);
    expect(after[0]!.day).toBe(plan[done]!.day);
    expect(after[k - done]!.day).toBe(plan[k]!.day);
    expect(after.reduce((s, p) => s + p.principalCents, 0)).toBe(
      plan[done - 1]!.outstandingCents - 500_000,
    );
  });

  it('puts both paths side by side, in euros of today (design: 410.100 / 411.500 / 421.700 €)', () => {
    const run = (mode: 'plazo' | 'cuota') =>
      amortizeOrInvest(household(), householdRules(), TODAY, 240, 'base', 'hoy', {
        debtId: 'hip',
        amountCents: 1_000_000,
        mode,
        fromAccountId: 'rem',
        investAccountId: 'brk',
      })!;
    const cuota = run('cuota');
    const plazo = run('plazo');
    near(cuota.amortizar.finalCents, 41_010_000);
    near(plazo.amortizar.finalCents, 41_150_000);
    near(cuota.invertir.finalCents, 42_170_000);
    near(cuota.invertir.investedFinalCents, 1_960_000);
    expect(cuota.amortizar.paymentBeforeCents).toBe(59_764);
    expect(Math.round(cuota.amortizar.paymentAfterCents / 100)).toBe(530);
    expect(plazo.amortizar.paidOffOn < '2041-11-05').toBe(true);
    expect(cuota.invertir.paidOffOn).toBe('2041-11-05');
    // Interest saved, as agreed with the bank (euros of then): design 2.300 € and 5.000 €.
    near(cuota.amortizar.interestSavedCents, 230_000, 10);
    near(plazo.amortizar.interestSavedCents, 500_000, 10);
    expect(
      amortizeOrInvest(household(), [], TODAY, 240, 'base', 'hoy', {
        debtId: 'nada',
        amountCents: 1,
        mode: 'cuota',
        fromAccountId: 'rem',
      }),
    ).toBeNull();
  });
});
