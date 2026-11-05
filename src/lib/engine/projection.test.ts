import { describe, expect, it } from 'vitest';
import { amortization } from './debt.ts';
import type { InterestTerms } from './interest.ts';
import {
  type FlowKind,
  type ProjectedAccount,
  type ProjectionStep,
  projectLedger,
  stepDay,
} from './projection.ts';
import { vehicleIndex } from './valuation.ts';

const anexoIV = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((y, i) => ({
  yearsOver: y,
  pctBp: [10000, 8400, 6700, 5600, 4700, 3900, 3400, 2800, 2400, 1900, 1700, 1300, 1000][i]!,
}));

const savings = (over: Partial<InterestTerms> = {}): InterestTerms => ({
  tiers: [{ rateBp: 200 }],
  baseDays: 365,
  payFrequency: 'mensual',
  payDay: 31,
  withholdingBp: 1900,
  ...over,
});

const flowSum = (s: ProjectionStep) =>
  (Object.values(s.flows) as number[]).reduce((a, b) => a + b, 0);
const total = (steps: ProjectionStep[], kind: FlowKind) =>
  steps.reduce((s, x) => s + x.flows[kind], 0);

// Everything at once: cash with interest, a broker, an estimate, a home, a car, a laptop and a
// mortgage paid from the savings account.
const everything = (): ProjectedAccount[] => [
  {
    id: 'rem',
    kind: 'remunerada',
    cashCents: 900_000,
    interest: savings({ promoUntil: '2027-03-31', afterRateBp: 50 }),
    accruedMicro: 12_345_678n,
  },
  {
    id: 'brk',
    kind: 'broker',
    cashCents: 15_000,
    investedCents: 1_785_000,
    estimates: [{ cents: 500_000, rateBp: 700 }],
  },
  { id: 'piso', kind: 'inmueble', cashCents: 0, home: { cents: 16_000_000, growthBp: 200 } },
  {
    id: 'coche',
    kind: 'vehiculo',
    cashCents: 0,
    curve: {
      flows: [{ day: '2026-11-05', cents: 220_000 }],
      index: vehicleIndex(anexoIV, '2013-05-10'),
    },
  },
  {
    id: 'hip',
    kind: 'deuda_hipoteca',
    cashCents: -8_900_000,
    debt: {
      principalCents: 8_900_000,
      startOn: '2026-11-05',
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

describe('projectLedger', () => {
  it('anchors each step to today’s day: the 31st falls on the last day, 29 February comes back', () => {
    expect([1, 2, 3].map((k) => stepDay('2026-01-31', k))).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect([12, 24, 48].map((k) => stepDay('2028-02-29', k))).toEqual([
      '2029-02-28',
      '2030-02-28',
      '2032-02-29',
    ]);
    const steps = projectLedger(
      [{ id: 'e', kind: 'efectivo', cashCents: 100 }],
      '2028-02-29',
      48,
      'base',
    );
    expect(steps).toHaveLength(49);
    expect(steps[0]!.day).toBe('2028-02-29');
    expect(steps[12]!.day).toBe('2029-02-28');
    expect(steps[48]!.day).toBe('2032-02-29');
    // Plain cash stays where it is, in euros of then.
    expect(steps.every((s) => s.totalCents === 100)).toBe(true);
  });

  it('changes the total by exactly the sum of its integer flows, every step, for 30 years', () => {
    const steps = projectLedger(everything(), '2026-11-05', 360, 'base');
    for (let k = 1; k < steps.length; k++) {
      const s = steps[k]!;
      expect(s.totalCents - steps[k - 1]!.totalCents).toBe(flowSum(s));
      for (const v of [...Object.values(s.flows), ...Object.values(s.byAccount)])
        expect(Number.isInteger(v)).toBe(true);
      expect(Object.values(s.byGroup).reduce((a, b) => a + b, 0)).toBe(s.totalCents);
    }
    // Today is today's valuation, with the interest earned and not paid yet (net of 19 %).
    expect(steps[0]!.byAccount.rem).toBe(900_000 + 10);
    expect(steps[0]!.totalCents).toBe(
      900_010 + 1_800_000 + 500_000 + 16_000_000 + 220_000 - 8_900_000,
    );
  });

  it('accrues day by day across the end of a promotion in the middle of a month', () => {
    const rem = (promoUntil?: string): ProjectedAccount => ({
      id: 'r',
      kind: 'remunerada',
      cashCents: 1_000_000,
      interest: savings({ promoUntil, afterRateBp: 50 }),
    });
    // 1 to 28 March: 15 days at 2 % and 13 at 0,5 % on 10.000 € = 999 cents gross, 809 net.
    const [, promo] = projectLedger([rem('2027-03-15')], '2027-02-28', 1, 'base');
    expect(promo!.flows.intereses).toBe(809);
    const [, plain] = projectLedger([rem()], '2027-02-28', 1, 'base');
    expect(plain!.flows.intereses).toBe(1_243);
    // Paid on 31 March, and from then the account itself earns on it.
    const steps = projectLedger([rem('2027-03-15')], '2027-02-28', 3, 'base');
    expect(steps[2]!.byAccount.r! - steps[0]!.byAccount.r!).toBe(
      steps[1]!.flows.intereses + steps[2]!.flows.intereses,
    );
  });

  it('stops paying a loan once it is paid, halfway through the horizon', () => {
    const loan: ProjectedAccount = {
      id: 'p',
      kind: 'deuda_prestamo',
      cashCents: -2_400_000,
      debt: {
        principalCents: 2_400_000,
        startOn: '2026-11-05',
        firstPaymentOn: '2026-12-05',
        termMonths: 24,
        rateType: 'fijo',
        initialRateBp: 300,
        payerAccountId: 'c',
      },
    };
    const steps = projectLedger(
      [loan, { id: 'c', kind: 'efectivo', cashCents: 5_000_000 }],
      '2026-11-05',
      36,
      'base',
    );
    const plan = amortization(loan.debt!);
    expect(steps[24]!.byAccount.p).toBe(0);
    expect(steps[12]!.byAccount.p).toBe(-plan[11]!.outstandingCents);
    expect(total(steps, 'deudas')).toBe(-plan.reduce((s, x) => s + x.interestCents, 0));
    // Paid: no more payments, and the cash it paid from stays put.
    for (const s of steps.slice(25)) {
      expect(s.payments).toEqual({});
      expect(s.byAccount.c).toBe(steps[24]!.byAccount.c);
    }
    expect(steps[24]!.byAccount.c).toBe(5_000_000 - 2_400_000 + total(steps, 'deudas'));
  });

  it('reviews a mixed mortgage after its fixed years with today’s Euribor: 597,64 → 611,41 €', () => {
    const debt = everything().find((a) => a.id === 'hip')!.debt!;
    const plan = amortization(debt);
    expect(plan[0]!.paymentCents).toBe(59_764);
    expect(plan[35]!.rateBp).toBe(260);
    // December 2029 takes October 2026's 2,20 % (three years old) + 0,80.
    expect(plan[36]!.rateBp).toBe(300);
    expect(plan[36]!.paymentCents).toBe(61_141);
    expect(plan.at(-1)!.day).toBe('2041-11-05');
    expect(plan.at(-1)!.outstandingCents).toBe(0);
    const steps = projectLedger(everything(), '2026-11-05', 240, 'base');
    // Step k holds payment k − 1 (the first one is on 5 December, in step 1).
    expect(steps[36]!.payments.hip).toEqual({
      day: '2029-11-05',
      paymentCents: 59_764,
      rateBp: 260,
    });
    expect(steps[37]!.payments.hip).toEqual({
      day: '2029-12-05',
      paymentCents: 61_141,
      rateBp: 300,
    });
    expect(steps[180]!.byAccount.hip).toBe(0);
    expect(steps[181]!.payments).toEqual({});
  });

  it('drops a car on each anniversary along Hacienda’s table and leaves it flat at its minimum', () => {
    const car = (firstRegistration: string): ProjectedAccount => ({
      id: 'v',
      kind: 'vehiculo',
      cashCents: 0,
      curve: {
        flows: [{ day: '2026-11-05', cents: 1_000_000 }],
        index: vehicleIndex(anexoIV, firstRegistration),
      },
    });
    // Over 12 years already: 10 % all along.
    const old = projectLedger([car('2013-05-10')], '2026-11-05', 120, 'base');
    expect(old.every((s) => s.totalCents === 1_000_000)).toBe(true);
    expect(total(old, 'depreciacion')).toBe(0);
    // From 2022: 47 % today, 39 % from 1 March 2027 … 10 % from 1 March 2034, then flat.
    const young = projectLedger([car('2022-03-01')], '2026-11-05', 240, 'base');
    expect(young[3]!.totalCents).toBe(1_000_000);
    expect(young[4]!.flows.depreciacion).toBe(829_787 - 1_000_000);
    expect(young[88]!.totalCents).toBe(212_766);
    expect(young.slice(89).every((s) => s.flows.depreciacion === 0)).toBe(true);
    expect(young[240]!.byGroup.bienes).toBe(212_766);
  });

  it('keeps prudente ≤ base ≤ optimista, an estimate in prudente at most at the scenario', () => {
    const at = (s: 'prudente' | 'base' | 'optimista') =>
      projectLedger(everything(), '2026-11-05', 240, s).at(-1)!;
    const [p, b, o] = [at('prudente'), at('base'), at('optimista')];
    expect(p.totalCents).toBeLessThan(b.totalCents);
    expect(b.totalCents).toBeLessThan(o.totalCents);
    // 1.785.000 cents at 6 % for 20 years, once a month.
    expect(b.byGroup.inversiones).toBeCloseTo(15_000 + 1_785_000 * 1.06 ** 20, -3);
    // The estimate grows at its 7 % in base and optimista, at 3 % in prudente.
    expect(b.byGroup.estimados).toBe(o.byGroup.estimados);
    expect(b.byGroup.estimados).toBeCloseTo(500_000 * 1.07 ** 20, -3);
    expect(p.byGroup.estimados).toBeCloseTo(500_000 * 1.03 ** 20, -3);
    // An estimate under the scenario keeps its own rate in prudente too.
    const low: ProjectedAccount = {
      id: 'x',
      kind: 'broker',
      cashCents: 0,
      estimates: [{ cents: 500_000, rateBp: 200 }],
    };
    expect(projectLedger([low], '2026-11-05', 240, 'prudente').at(-1)!.totalCents).toBeCloseTo(
      500_000 * 1.02 ** 20,
      -3,
    );
    // Nothing but investments and estimates depends on the scenario.
    for (const g of ['efectivo', 'inmuebles', 'bienes', 'deudas'] as const)
      expect(p.byGroup[g]).toBe(o.byGroup[g]);
  });
});
