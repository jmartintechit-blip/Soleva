import { describe, expect, it } from 'vitest';
import { amortization, annuityCents, monthsForPayment, outstandingOn } from './debt.ts';
import { type InterestTerms, MICRO, dailyAccrual, isPayDay, payment } from './interest.ts';
import {
  assetCents,
  assetIndex,
  estimateCents,
  M2_STEP,
  propertyCents,
  vehicleCents,
  vehicleIndex,
  wholeYears,
} from './valuation.ts';

const terms: InterestTerms = {
  tiers: [{ upToCents: 5_000_000, rateBp: 250 }, { rateBp: 0 }],
  baseDays: 365,
  payFrequency: 'mensual',
  payDay: 31,
  withholdingBp: 1900,
};

describe('interest', () => {
  it('accrues each day on that day’s balance, by marginal tiers, and nothing below zero', () => {
    // 10.000 € at 2,5 %: 10.000 × 0,025 / 365 = 0,68493 € a day.
    expect(dailyAccrual(1_000_000, terms, '2026-11-01')).toBe(68_493_150n);
    // Above 50.000 € the rest earns 0 %: 80.000 € earns as 50.000 €.
    expect(dailyAccrual(8_000_000, terms, '2026-11-01')).toBe(
      dailyAccrual(5_000_000, terms, '2026-11-01'),
    );
    expect(dailyAccrual(-100, terms, '2026-11-01')).toBe(0n);
    const promo = { ...terms, promoUntil: '2026-11-30', afterRateBp: 100 };
    expect(dailyAccrual(1_000_000, promo, '2026-12-01')).toBe(27_397_260n);
    expect(dailyAccrual(1_000_000, { ...terms, baseDays: 360 }, '2026-11-01')).toBe(69_444_444n);
  });

  it('pays on its day of each period, withholding 19 %', () => {
    expect(isPayDay(terms, '2026-11-30')).toBe(true);
    expect(isPayDay(terms, '2026-11-29')).toBe(false);
    const quarterly = { ...terms, payFrequency: 'trimestral' as const, payDay: 1 };
    expect(isPayDay(quarterly, '2026-12-01')).toBe(true);
    expect(isPayDay(quarterly, '2026-11-01')).toBe(false);
    // 30 days of 0,68493 € are 20,54 €: 3,90 € withheld, 16,64 € paid.
    expect(payment(68_493_150n * 30n, terms)).toEqual({ gross: 2054, withheld: 390, net: 1664 });
    expect(payment(MICRO - 1n, terms)).toEqual({ gross: 0, withheld: 0, net: 0 });
  });
});

describe('debt', () => {
  it('computes the French payment and clears the loan to the cent', () => {
    // 150.000 € at 3 % over 25 years: 711,32 € a month.
    expect(annuityCents(15_000_000, 300, 300)).toBe(71_132);
    expect(annuityCents(120_000, 0, 12)).toBe(10_000);
    // And back: that payment is 300 months; one that only covers the interest never ends.
    expect(monthsForPayment(15_000_000, 300, 71_132)).toBe(300);
    expect(monthsForPayment(15_000_000, 300, 80_000)).toBe(253);
    expect(monthsForPayment(120_000, 0, 10_000)).toBe(12);
    expect(monthsForPayment(15_000_000, 300, 37_500)).toBeNull();
    expect(monthsForPayment(15_000_000, 300, 0)).toBeNull();
    const plan = amortization({
      principalCents: 15_000_000,
      startOn: '2026-01-10',
      firstPaymentOn: '2026-02-10',
      termMonths: 300,
      rateType: 'fijo',
      initialRateBp: 300,
    });
    expect(plan).toHaveLength(300);
    expect(plan[0]).toEqual({
      day: '2026-02-10',
      rateBp: 300,
      paymentCents: 71_132,
      interestCents: 37_500,
      principalCents: 33_632,
      outstandingCents: 14_966_368,
    });
    expect(plan.at(-1)!.outstandingCents).toBe(0);
    expect(plan.reduce((s, p) => s + p.principalCents, 0)).toBe(15_000_000);
  });

  it('resets a variable rate at each review from the Euribor two months before, with its floor', () => {
    const t = {
      principalCents: 10_000_000,
      startOn: '2026-01-15',
      firstPaymentOn: '2026-02-15',
      termMonths: 240,
      rateType: 'variable' as const,
      initialRateBp: 200,
      index: { '2026-12': 240, '2027-12': -50 },
      spreadBp: 80,
      reviewMonths: 12,
      floorBp: 100,
    };
    const plan = amortization(t);
    expect(plan[11]!.rateBp).toBe(200);
    // Review in February 2027 takes December 2026: 2,40 + 0,80.
    expect(plan[12]!.rateBp).toBe(320);
    expect(plan[12]!.paymentCents).toBeGreaterThan(plan[11]!.paymentCents);
    // Next year the Euribor is −0,50 %: 0,30 %, but the floor keeps it at 1 %.
    expect(plan[24]!.rateBp).toBe(100);
    expect(plan.at(-1)!.outstandingCents).toBe(0);
    expect(outstandingOn(t, '2026-02-14')).toBe(10_000_000);
    expect(outstandingOn(t, '2026-02-15')).toBe(plan[0]!.outstandingCents);
  });
});

describe('valuation', () => {
  const anexoIV = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((y, i) => ({
    yearsOver: y,
    pctBp: [10000, 8400, 6700, 5600, 4700, 3900, 3400, 2800, 2400, 1900, 1700, 1300, 1000][i]!,
  }));

  it('values a car by Hacienda’s table, a full year at a time', () => {
    expect(wholeYears('2013-05-10', '2026-05-09')).toBe(12);
    expect(wholeYears('2013-05-10', '2026-05-10')).toBe(13);
    // A 2013 diesel is past 12 years: 10 % of its Anexo I value.
    expect(vehicleCents(2_150_000, anexoIV, '2013-05-10', '2026-11-01')).toBe(215_000);
    expect(vehicleCents(2_150_000, anexoIV, '2026-03-01', '2026-11-01')).toBe(2_150_000);
    expect(vehicleCents(2_150_000, anexoIV, '2025-03-01', '2026-11-01')).toBe(1_806_000);
  });

  it('lowers other goods a little every day along their curve, and flat after it', () => {
    const pc = [
      { years: 1, pctBp: 7000 },
      { years: 2, pctBp: 5000 },
    ];
    expect(assetCents(150_000, pc, '2026-01-01', '2026-01-01')).toBe(150_000);
    expect(assetCents(150_000, pc, '2026-01-01', '2027-01-01')).toBe(105_000);
    // 182 of the 365 days of the second year: 70 % − 20 % × 182/365 = 60,03 %.
    expect(assetCents(150_000, pc, '2026-01-01', '2027-07-02')).toBe(90_041);
    expect(assetCents(150_000, pc, '2026-01-01', '2035-01-01')).toBe(75_000);
    expect(assetCents(150_000, pc, '2024-02-29', '2025-02-28')).toBe(105_000);
  });

  it('grows an estimated product from each contribution at the user’s rate', () => {
    expect(estimateCents([{ day: '2026-01-01', cents: 100_000 }], 900, '2027-01-01')).toBe(109_000);
    expect(
      estimateCents(
        [
          { day: '2026-01-01', cents: 100_000 },
          { day: '2027-01-01', cents: 100_000 },
          { day: '2030-01-01', cents: 999 },
        ],
        900,
        '2027-01-01',
      ),
    ).toBe(209_000);
  });
});

describe('propertyCents', () => {
  // Andalucía, second-hand, base 2025 (INE table 80270).
  const ipv = [
    { quarter: '2026-01-01', indexE3: 108_090 },
    { quarter: '2026-04-01', indexE3: 111_393 },
    { quarter: '2026-07-01', indexE3: 114_000 },
  ];
  // 90 m² × 1.231,50 €/m² of Écija in 2026T2.
  const opening = { day: '2026-11-01', cents: 11_083_500, from: '2026-04-01' };

  it('moves the m² value with the index from the Ministry’s quarter', () => {
    expect(propertyCents([opening], ipv.slice(0, 2), '2026-11-01')).toBe(11_083_500);
    // 2026T3 out: × 114 / 111,393.
    expect(propertyCents([opening], ipv, '2026-11-01')).toBe(11_342_894);
    expect(propertyCents([opening], ipv, '2026-10-31')).toBe(0);
    // Valued by m²: to the hundred euros.
    expect(propertyCents([opening], ipv, '2026-11-01', M2_STEP)).toBe(11_340_000);
  });

  it('a value given today waits for a later quarter; one set by hand wins from its day', () => {
    const own = { day: '2026-11-01', cents: 11_500_000 };
    expect(propertyCents([own], ipv, '2027-03-01')).toBe(11_500_000);
    const later = [...ipv, { quarter: '2027-01-01', indexE3: 117_420 }];
    // From 2026T3 (the latest out on its day… and the latest ≤ its quarter) to 2027T1.
    expect(propertyCents([own], later, '2027-01-01')).toBe(11_845_000);
    // On 1 Feb the user says 120.000 €: the adjustment makes it so, and it moves from there.
    const set = { day: '2027-02-01', cents: 12_000_000 - 11_845_000 };
    expect(propertyCents([own, set], later, '2027-02-01')).toBe(12_000_000);
    const next = [...later, { quarter: '2027-04-01', indexE3: 120_000 }];
    expect(propertyCents([own, set], next, '2027-05-01')).toBe(
      Math.round((12_000_000 * 120_000) / 117_420),
    );
    // Without the index, as given.
    expect(propertyCents([own], [], '2030-01-01')).toBe(11_500_000);
  });
});

describe('cars and goods along their curve', () => {
  it('a car moves with Hacienda’s table from each anniversary; a value given is followed', () => {
    const table = [
      { yearsOver: 0, pctBp: 10_000 },
      { yearsOver: 11, pctBp: 1_100 },
      { yearsOver: 12, pctBp: 1_000 },
    ];
    const index = vehicleIndex(table, '2013-05-10');
    // Entered on 1 Nov 2026 at 2.240 € (13 years: 10 %): flat after the table's last row.
    const opening = [{ day: '2026-11-01', cents: 224_000 }];
    expect(propertyCents(opening, index, '2030-01-01')).toBe(224_000);
    // A 2015 car entered at 3.000 € loses from 11 % to 10 % on 2027-03-01.
    const young = vehicleIndex(table, '2015-03-01');
    expect(propertyCents([{ day: '2026-11-01', cents: 300_000 }], young, '2027-03-01')).toBe(
      Math.round((300_000 * 1_000) / 1_100),
    );
  });

  it('a good loses its yearly rate a little each month; at 0 % it keeps its value', () => {
    const index = assetIndex(2_500, '2024-10-15');
    const paid = [{ day: '2024-10-15', cents: 180_000 }];
    expect(propertyCents(paid, index, '2025-10-15')).toBe(135_000);
    expect(propertyCents(paid, index, '2025-04-20')).toBe(Math.round(180_000 * 0.75 ** 0.5));
    expect(assetIndex(0, '2024-10-15')).toEqual([]);
  });
});
