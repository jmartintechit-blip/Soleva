// Proyección v2 with rules and plans, in both units, its breakdown, its milestones and the
// reference case of the approved design (LEEME-B13: an INVENTED household).
import { describe, expect, it } from 'vitest';
import type { AutoRule } from './advance.ts';
import type { Scenario } from './compound.ts';
import type { InterestTerms } from './interest.ts';
import {
  DEFAULT_ASSUMPTIONS,
  type ProjectedAccount,
  type ProjectionStep,
  apportion,
  breakdown,
  inTodayEuros,
  milestones,
  projectLedger,
  roundRows,
} from './projection.ts';
import { assetIndex, vehicleIndex } from './valuation.ts';

const TODAY = '2026-11-05';
const flowSum = (s: ProjectionStep) =>
  (Object.values(s.flows) as number[]).reduce((a, b) => a + b, 0);
const rule = (over: Partial<AutoRule> & Pick<AutoRule, 'id' | 'kind'>): AutoRule => ({
  frequency: 'mensual',
  day: 1,
  startOn: '2026-01-01',
  legs: [],
  active: true,
  ...over,
});
const cash = (id: string, cents: number): ProjectedAccount => ({
  id,
  kind: 'efectivo',
  cashCents: cents,
});

const anexoIV = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((y, i) => ({
  yearsOver: y,
  pctBp: [10000, 8400, 6700, 5600, 4700, 3900, 3400, 2800, 2400, 1900, 1700, 1300, 1000][i]!,
}));

const savings: InterestTerms = {
  tiers: [{ rateBp: 200 }],
  baseDays: 365,
  payFrequency: 'mensual',
  payDay: 31,
  withholdingBp: 1900,
  promoUntil: '2027-03-31',
  afterRateBp: 50,
};

// The household of the design: 9.000 € at 2 % until March 2027 and 0,5 % after; a broker of
// 18.000 € with a plan of 100 € a week (paid from the savings account when the broker has no
// cash); a flat of 160.000 € at +2 %; a car at 10 % of 22.000 €; a laptop of 1.400 € losing 25 % a
// year; an estimate of 5.000 € at 7 %; a mixed mortgage of 89.000 € (2,6 % fixed for three years,
// then Euribor 2,2 % + 0,8 %, 180 payments); incomes minus expenses of 1.150 € a month.
const household = (): ProjectedAccount[] => [
  { id: 'rem', kind: 'remunerada', cashCents: 900_000, interest: savings },
  {
    id: 'brk',
    kind: 'broker',
    cashCents: 0,
    investedCents: 1_800_000,
    estimates: [{ instrumentId: 'privado', cents: 500_000, rateBp: 700 }],
  },
  { id: 'piso', kind: 'inmueble', cashCents: 0, home: { cents: 16_000_000, growthBp: 200 } },
  {
    id: 'coche',
    kind: 'vehiculo',
    cashCents: 0,
    curve: { flows: [{ day: TODAY, cents: 220_000 }], index: vehicleIndex(anexoIV, '2013-05-10') },
  },
  {
    id: 'portatil',
    kind: 'bien',
    cashCents: 0,
    curve: { flows: [{ day: TODAY, cents: 140_000 }], index: assetIndex(2500, TODAY) },
  },
  {
    id: 'hip',
    kind: 'deuda_hipoteca',
    cashCents: -8_900_000,
    debt: {
      principalCents: 8_900_000,
      startOn: TODAY,
      firstPaymentOn: '2026-12-05',
      termMonths: 180,
      rateType: 'variable',
      initialRateBp: 260,
      fixedMonths: 36,
      reviewMonths: 12,
      spreadBp: 80,
      index: { '2026-10': 220 },
      payerAccountId: 'rem',
    },
  },
];
const householdRules = (): AutoRule[] => [
  rule({ id: 'nomina', kind: 'ingreso', day: 28, toAccountId: 'rem', amountCents: 200_000 }),
  rule({ id: 'gastos', kind: 'gasto', day: 1, fromAccountId: 'rem', amountCents: 85_000 }),
  rule({
    id: 'plan',
    kind: 'plan',
    frequency: 'semanal',
    day: 1,
    fromAccountId: 'brk',
    legs: [{ instrumentId: 'world', amountCents: 10_000 }],
    shortfall: 'otra_cuenta',
    shortfallAccountId: 'rem',
  }),
];

const run = (scenario: Scenario, months = 240) =>
  projectLedger(household(), TODAY, months, scenario, DEFAULT_ASSUMPTIONS, householdRules());

describe('projectLedger with rules and plans', () => {
  it('raises incomes and expenses with «Tus ingresos y gastos» and leaves plans and transfers as they are', () => {
    const rules = [
      rule({ id: 'in', kind: 'ingreso', day: 10, toAccountId: 'a', amountCents: 100_000 }),
      rule({ id: 'out', kind: 'gasto', day: 12, fromAccountId: 'a', amountCents: 40_000 }),
      rule({
        id: 'mv',
        kind: 'transferencia',
        day: 15,
        fromAccountId: 'a',
        toAccountId: 'b',
        amountCents: 10_000,
      }),
    ];
    const steps = projectLedger(
      [cash('a', 0), cash('b', 0)],
      TODAY,
      24,
      'base',
      DEFAULT_ASSUMPTIONS,
      rules,
    );
    // Step 12 (a year on): 600 € × 1,025.
    expect(steps[12]!.flows.aportado).toBe(61_500);
    expect(steps[12]!.byAccount.b! - steps[11]!.byAccount.b!).toBe(10_000);
    // In euros of today, a rule that grows with inflation stays the same.
    const real = inTodayEuros(steps, DEFAULT_ASSUMPTIONS.inflationBp);
    expect(real.slice(1).every((s) => Math.abs(s.flows.aportado - 60_000) <= 1)).toBe(true);
    // With «Tus ingresos y gastos» at 0 %, the same amount in euros of then.
    const flat = projectLedger(
      [cash('a', 0), cash('b', 0)],
      TODAY,
      24,
      'base',
      { ...DEFAULT_ASSUMPTIONS, rulesGrowthBp: 0 },
      rules,
    );
    expect(flat.slice(1).every((s) => s.flows.aportado === 60_000)).toBe(true);
  });

  it('runs a rule from its start to its end, a one-off once, and skips one that is paused', () => {
    const rules = [
      rule({
        id: 'tramo',
        kind: 'ingreso',
        day: 1,
        startOn: '2027-03-01',
        endOn: '2027-05-31',
        toAccountId: 'a',
        amountCents: 1_000,
      }),
      rule({
        id: 'una',
        kind: 'gasto',
        frequency: 'una_vez',
        startOn: '2028-02-29',
        fromAccountId: 'a',
        amountCents: 50_000,
      }),
      rule({ id: 'off', kind: 'ingreso', toAccountId: 'a', amountCents: 9_999, active: false }),
      rule({ id: 'fuera', kind: 'ingreso', toAccountId: 'cerrada', amountCents: 9_999 }),
    ];
    const g = { ...DEFAULT_ASSUMPTIONS, rulesGrowthBp: 0 };
    const steps = projectLedger([cash('a', 0)], TODAY, 36, 'base', g, rules);
    expect(steps.map((s) => s.flows.aportado).filter((x) => x !== 0)).toEqual([
      1_000, 1_000, 1_000, -50_000,
    ]);
    expect(steps[16]!.flows.aportado).toBe(-50_000);
  });

  it('buys a plan from the broker’s cash, from another account when short, or not at all', () => {
    const broker = (cents: number): ProjectedAccount => ({
      id: 'brk',
      kind: 'broker',
      cashCents: cents,
      estimates: [{ instrumentId: 'priv', cents: 0, rateBp: 700 }],
    });
    const plan = (shortfall?: AutoRule['shortfall']) =>
      rule({
        id: 'p',
        kind: 'plan',
        day: 10,
        fromAccountId: 'brk',
        legs: [
          { instrumentId: 'etf', amountCents: 30_000 },
          { instrumentId: 'priv', amountCents: 20_000 },
        ],
        shortfall,
        shortfallAccountId: shortfall === 'otra_cuenta' ? 'c' : undefined,
      });
    const zero = { ...DEFAULT_ASSUMPTIONS, returnBp: { prudente: 0, base: 0, optimista: 0 } };
    const at = (brokerCents: number, shortfall?: AutoRule['shortfall']) =>
      projectLedger([broker(brokerCents), cash('c', 1_000_000)], TODAY, 1, 'base', zero, [
        plan(shortfall),
      ])[1]!;
    // Enough cash: both legs, the estimate's into the estimate.
    let s = at(50_000);
    expect(s.byGroup.inversiones).toBe(30_000);
    expect(s.byGroup.estimados).toBe(20_000);
    // Short of the second leg, without another account: only the first one.
    s = at(40_000);
    expect(s.byGroup.inversiones).toBe(30_000 + 10_000);
    expect(s.byGroup.estimados).toBe(0);
    // From another account: all of it, and nothing changes net worth.
    s = at(0, 'otra_cuenta');
    expect(s.byAccount.c).toBe(1_000_000 - 50_000);
    expect(s.totalCents).toBe(1_000_000);
    expect(s.flows.aportado).toBe(0);
  });

  it('grows this month’s buys from the next month on, so a plan never earns before it is bought', () => {
    const steps = projectLedger(
      [{ id: 'brk', kind: 'broker', cashCents: 100_000 }],
      TODAY,
      2,
      'base',
      DEFAULT_ASSUMPTIONS,
      [
        rule({
          id: 'p',
          kind: 'plan',
          day: 20,
          fromAccountId: 'brk',
          legs: [{ instrumentId: 'etf', amountCents: 100_000 }],
        }),
      ],
    );
    expect(steps[1]!.flows.plusvalia).toBe(0);
    expect(steps[2]!.flows.plusvalia).toBe(Math.round(100_000 * (1.06 ** (1 / 12) - 1)));
  });
});

describe('euros of today, breakdown and milestones', () => {
  it('keeps the identity to the cent in both units, inflation the rest of each step', () => {
    const nominal = run('base');
    const real = inTodayEuros(nominal, DEFAULT_ASSUMPTIONS.inflationBp);
    const monthly = 1.025 ** (1 / 12) - 1;
    for (const steps of [nominal, real])
      for (let k = 1; k < steps.length; k++) {
        const s = steps[k]!;
        expect(s.totalCents - steps[k - 1]!.totalCents).toBe(flowSum(s));
        expect(Object.values(s.byGroup).reduce((a, b) => a + b, 0)).toBe(s.totalCents);
        expect(Object.values(s.byAccount).reduce((a, b) => a + b, 0)).toBe(s.totalCents);
      }
    expect(nominal.every((s) => s.flows.inflacion === 0)).toBe(true);
    // −(assets − debts at the start of the month) × the month's inflation, deflated.
    for (let k = 1; k < real.length; k++) {
      const expected = (-nominal[k - 1]!.totalCents * monthly) / 1.025 ** (k / 12);
      expect(Math.abs(real[k]!.flows.inflacion - expected)).toBeLessThanOrEqual(8);
    }
  });

  it('rounds the rows to 100 € so they add up to the figure, by largest remainder', () => {
    expect(apportion([1.4, 1.4, 1.2], 4)).toEqual([2, 1, 1]);
    expect(apportion([-1.5, 3.7], 2)).toEqual([-2, 4]);
    const { figure, rows } = roundRows({ a: 4_049_99, b: 4_049_99, c: 100 }, 8_100_98);
    expect(figure).toBe(8_100_00);
    expect(Object.values(rows).reduce((s, x) => s + x, 0)).toBe(figure);
    const real = inTodayEuros(run('base'), DEFAULT_ASSUMPTIONS.inflationBp);
    const b = breakdown(real);
    expect(Object.values(b.rows).reduce((s, x) => s + x, 0)).toBe(b.figure);
    const types = roundRows(real.at(-1)!.byGroup, real.at(-1)!.totalCents);
    expect(types.figure).toBe(b.figure);
    expect(Object.values(types.rows).reduce((s, x) => s + x, 0)).toBe(b.figure);
  });

  it('finds the end of the promotion, the review, the mortgage paid off and a rule that ends', () => {
    const rules = [
      ...householdRules(),
      rule({
        id: 'beca',
        kind: 'ingreso',
        endOn: '2028-06-30',
        toAccountId: 'rem',
        amountCents: 10_000,
      }),
    ];
    const steps = projectLedger(household(), TODAY, 240, 'base', DEFAULT_ASSUMPTIONS, rules);
    expect(milestones(household(), rules, steps)).toEqual([
      { kind: 'fin_promocion', day: '2027-03-31', accountId: 'rem', fromBp: 200, toBp: 50 },
      { kind: 'fin_regla', day: '2028-06-30', ruleId: 'beca' },
      {
        kind: 'revision',
        day: '2029-12-05',
        accountId: 'hip',
        fromCents: 59_764,
        toCents: 61_141,
        rateBp: 300,
      },
      { kind: 'deuda_pagada', day: '2041-11-05', accountId: 'hip', freedCents: 61_141 },
    ]);
    // Over 5 years, only what falls within them.
    const five = steps.slice(0, 61);
    expect(milestones(household(), rules, five).map((m) => m.kind)).toEqual([
      'fin_promocion',
      'fin_regla',
      'revision',
    ]);
  });
});

describe('reference case of the design (LEEME-B13, ±1 %)', () => {
  const within = (actual: number, expected: number) =>
    expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(0.01);

  it('lands 20 years on, base, at 408.700 € of today (353.600 – 455.200) and 669.800 € of then', () => {
    const real = (s: Scenario) => inTodayEuros(run(s), DEFAULT_ASSUMPTIONS.inflationBp);
    const base = real('base');
    expect(base[0]!.totalCents).toBe(10_660_000);
    within(breakdown(base).figure, 40_870_000);
    within(breakdown(real('prudente')).figure, 35_360_000);
    within(breakdown(real('optimista')).figure, 45_520_000);
    within(breakdown(run('base')).figure, 66_980_000);
  });

  it('explains it with the rows of the design, to within 1 % of the figure', () => {
    const { figure, rows } = breakdown(inTodayEuros(run('base'), DEFAULT_ASSUMPTIONS.inflationBp));
    const design = {
      hoy: 10_660_000,
      aportado: 27_540_000,
      rentabilidad: 16_970_000,
      depreciacion: -130_000,
      deudas: -1_810_000,
      inflacion: -12_360_000,
    };
    for (const k of Object.keys(design) as (keyof typeof design)[])
      expect(Math.abs(rows[k] - design[k])).toBeLessThanOrEqual(figure * 0.01);
    expect(rows.hoy).toBe(design.hoy);
    expect(Object.values(rows).reduce((s, x) => s + x, 0)).toBe(figure);
  });
});
