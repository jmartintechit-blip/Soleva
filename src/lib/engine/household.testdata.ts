// The household of the design's reference case (LEEME-B13), INVENTED, for the projection tests.
import type { AutoRule } from './advance.ts';
import type { InterestTerms } from './interest.ts';
import type { ProjectedAccount } from './projection.ts';
import { assetIndex, vehicleIndex } from './valuation.ts';

export const TODAY = '2026-11-05';
export const rule = (over: Partial<AutoRule> & Pick<AutoRule, 'id' | 'kind'>): AutoRule => ({
  frequency: 'mensual',
  day: 1,
  startOn: '2026-01-01',
  legs: [],
  active: true,
  ...over,
});
export const cash = (id: string, cents: number): ProjectedAccount => ({
  id,
  kind: 'efectivo',
  cashCents: cents,
});

export const anexoIV = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((y, i) => ({
  yearsOver: y,
  pctBp: [10000, 8400, 6700, 5600, 4700, 3900, 3400, 2800, 2400, 1900, 1700, 1300, 1000][i]!,
}));

export const savings: InterestTerms = {
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
export const household = (): ProjectedAccount[] => [
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
export const householdRules = (): AutoRule[] => [
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
