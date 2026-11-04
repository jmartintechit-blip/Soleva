import { describe, expect, it } from 'vitest';
import { advance } from './advance.ts';
import { market } from './testing.ts';
import {
  type Holdings,
  alerts,
  fingerprint,
  forecastCash,
  handMade,
  moneyWeighted,
  outsideFlows,
  unitFlows,
  valuation,
} from './insight.ts';
import { type Movement, fold } from './ledger.ts';
import { E8, toE8 } from './units.ts';

const mv = (m: Partial<Movement> & Pick<Movement, 'accountId' | 'day' | 'kind'>): Movement => ({
  seq: 0,
  amountCents: 0,
  source: 'manual',
  ...m,
});

describe('moneyWeighted', () => {
  it('separates what you put in from what your money made', () => {
    // 10.000 € that become 11.000 € in a year with nothing added: 10 %.
    const r = moneyWeighted(1_000_000, 1_100_000, [], '2026-01-01', '2027-01-01');
    expect(r).toMatchObject({ putCents: 0, madeCents: 100_000 });
    expect(r.annual).toBeCloseTo(0.1, 8);
    // Half of the gain was a contribution in the middle of the year: the money made less.
    const s = moneyWeighted(
      1_000_000,
      1_150_000,
      [{ day: '2026-07-02', cents: 100_000 }],
      '2026-01-01',
      '2027-01-01',
    );
    expect(s).toMatchObject({ putCents: 100_000, madeCents: 50_000 });
    expect(s.annual!).toBeGreaterThan(0.047);
    expect(s.annual!).toBeLessThan(0.049);
    // A month at 1 %: the period return is 1 %, the yearly one about 12,7 %.
    const m = moneyWeighted(1_000_000, 1_010_000, [], '2026-01-31', '2026-03-03');
    expect(m.period).toBeCloseTo(0.01, 8);
    expect(moneyWeighted(0, 0, [], '2026-01-01', '2026-01-02').annual).toBeNull();
  });

  it('counts incomes, expenses and openings as flows, never transfers or buys', () => {
    const ledger = [
      mv({ accountId: 'a', day: '2026-11-01', kind: 'apertura', amountCents: 100 }),
      mv({
        accountId: 'a',
        day: '2026-11-02',
        kind: 'transferencia',
        amountCents: -50,
        transferId: 't',
      }),
      mv({
        accountId: 'b',
        day: '2026-11-02',
        kind: 'transferencia',
        amountCents: 50,
        transferId: 't',
      }),
      mv({
        accountId: 'b',
        day: '2026-11-03',
        kind: 'compra',
        amountCents: -50,
        instrumentId: 'x',
        qtyE8: 1n,
        priceE8: 1n,
      }),
      mv({ accountId: 'a', day: '2026-11-04', kind: 'ingreso', amountCents: 10 }),
      mv({ accountId: 'a', day: '2026-11-05', kind: 'interes', amountCents: 1 }),
    ];
    expect(outsideFlows(ledger, '2026-10-31', '2026-11-30').map((m) => m.kind)).toEqual([
      'apertura',
      'ingreso',
    ]);
  });
});

describe('valuation and alerts', () => {
  const h: Holdings = {
    accounts: [
      { id: 'brk', kind: 'broker' },
      { id: 'car', kind: 'vehiculo' },
      { id: 'loan', kind: 'deuda_prestamo' },
    ],
    instruments: { world: { kind: 'etf' }, gold: { kind: 'etc' }, pm: { kind: 'estimado' } },
    estimates: { 'brk|pm': 900 },
    vehicles: {
      car: {
        baseCents: 2_150_000,
        table: [
          { yearsOver: 0, pctBp: 10_000 },
          { yearsOver: 12, pctBp: 1000 },
        ],
        firstRegistration: '2013-05-10',
      },
    },
    assets: {},
    properties: {},
    market: market({
      world: { currency: 'USD', price: '108.50' },
      gold: { currency: 'USD', price: '43.40' },
      pm: { currency: 'EUR', price: '1' },
    }),
  };
  const ledger = [
    mv({ accountId: 'brk', day: '2026-01-01', kind: 'apertura', amountCents: 500_000 }),
    mv({
      accountId: 'brk',
      day: '2026-01-02',
      kind: 'compra',
      amountCents: -100_000,
      instrumentId: 'world',
      qtyE8: toE8(10),
      priceE8: toE8('108.50'),
    }),
    mv({
      accountId: 'brk',
      day: '2026-01-02',
      seq: 1,
      kind: 'compra',
      amountCents: -40_000,
      instrumentId: 'gold',
      qtyE8: toE8(10),
      priceE8: toE8('43.40'),
    }),
    mv({
      accountId: 'brk',
      day: '2026-01-02',
      seq: 2,
      kind: 'compra',
      amountCents: -100_000,
      instrumentId: 'pm',
      qtyE8: toE8(1),
      priceE8: toE8(1000),
    }),
    mv({ accountId: 'loan', day: '2026-01-01', kind: 'apertura', amountCents: -300_000 }),
  ];

  it('adds cash, units in euros, estimates, the car by Hacienda and debts by kind of asset', () => {
    const v = valuation(h, ledger, '2027-01-02');
    expect(v.byClass).toEqual({
      liquidez: 260_000,
      renta_variable: 100_000 + 109_000,
      oro: 40_000,
      cripto: 0,
      inmuebles: 0,
      bienes: 215_000,
      deudas: -300_000,
    });
    expect(v.total).toBe(260_000 + 209_000 + 40_000 + 215_000 - 300_000);
  });

  it('values a home by its region’s index, apart from the cash its account holds', () => {
    const home = { id: 'home', kind: 'inmueble' as const };
    const opening = mv({
      accountId: 'home',
      day: '2026-11-01',
      kind: 'apertura',
      amountCents: 10_000_000,
    });
    const withHome: Holdings = {
      ...h,
      accounts: [home],
      properties: {
        home: {
          flows: [{ day: '2026-11-01', cents: 10_000_000, from: '2026-04-01' }],
          index: [
            { quarter: '2026-04-01', indexE3: 100_000 },
            { quarter: '2026-07-01', indexE3: 103_000 },
          ],
        },
      },
    };
    const v = valuation(withHome, [opening], '2026-12-01');
    expect(v.byClass.inmuebles).toBe(10_300_000);
    expect(v.byAccount).toEqual({ home: 10_300_000 });
    // Without its details yet (an Alta before RInmueble), the opening's cash.
    expect(valuation({ ...h, accounts: [home] }, [opening], '2026-12-01').byClass.inmuebles).toBe(
      10_000_000,
    );
  });

  it('warns of cash running out, a plan above what comes in, a promotion ending and old prices', () => {
    const input = {
      rules: [
        {
          id: 'in',
          kind: 'transferencia' as const,
          frequency: 'mensual' as const,
          day: 1,
          startOn: '2026-01-01',
          fromAccountId: 'rem',
          toAccountId: 'brk',
          amountCents: 100_000,
          legs: [],
          active: true,
        },
        {
          id: 'plan',
          kind: 'plan' as const,
          frequency: 'semanal' as const,
          day: 1,
          startOn: '2026-01-01',
          fromAccountId: 'brk',
          legs: [{ instrumentId: 'world', amountCents: 25_000 }],
          active: true,
        },
      ],
      interest: {
        rem: {
          tiers: [{ rateBp: 200 }],
          baseDays: 365 as const,
          payFrequency: 'mensual' as const,
          payDay: 31,
          promoUntil: '2027-01-20',
          afterRateBp: 100,
          withholdingBp: 1900,
        },
      },
      dividends: [],
      debts: {},
      market: {
        ...h.market,
        close: (id: string, day: string) =>
          id === 'gold' ? { day: '2026-12-01', priceE8: toE8('43.40') } : h.market.close(id, day),
      },
    };
    const withSaving = {
      ...h,
      accounts: [...h.accounts, { id: 'rem', kind: 'remunerada' as const }],
    };
    const found = alerts(
      input,
      { ...withSaving, market: input.market },
      ledger,
      '2027-01-04',
    ).alerts;
    // 250 € a week × 52/12 = 1.083,33 € a month, above the 1.000 € that come in.
    expect(found.map((a) => a.key).sort()).toEqual(
      [
        'fin_promocion:rem:2027-01-20',
        'plan_supera:plan',
        'precio_viejo:gold',
        'sin_saldo:rem',
      ].sort(),
    );
  });
});

describe('incremental cash forecast', () => {
  const input = {
    rules: [
      {
        id: 'fee',
        kind: 'gasto' as const,
        frequency: 'mensual' as const,
        day: 30,
        startOn: '2026-01-01',
        fromAccountId: 'aut',
        amountCents: 30_000,
        legs: [],
        active: true,
      },
    ],
    interest: {},
    dividends: [],
    debts: {},
    market: market({}),
  };
  const h: Holdings = {
    accounts: [{ id: 'aut', kind: 'efectivo' }],
    instruments: {},
    estimates: {},
    vehicles: {},
    assets: {},
    properties: {},
    market: market({}),
  };
  const opening = mv({
    accountId: 'aut',
    day: '2026-10-31',
    kind: 'apertura',
    amountCents: 100_000,
  });

  it('only simulates the new days while nothing changed, and gives what a full run gives', () => {
    const first = forecastCash(input, h, [opening], '2026-11-01');
    expect(first.through).toBe('2026-12-31');
    expect(first.firstNegative).toEqual({});
    // A day later, with the ledger as the engine left it: one new day simulated from the stored cash.
    const ledger = [opening, ...advance(input, [opening], '2026-11-01', '2026-12-31')];
    const next = forecastCash(input, h, ledger, '2026-12-31', first);
    const full = forecastCash(input, h, ledger, '2026-12-31');
    expect(next).toEqual(full);
    // 1.000 € minus 300 € on the 30th: 700, 400, 100 and −200 € on 28 February.
    expect(next.firstNegative).toEqual({ aut: '2027-02-28' });
  });

  it('starts again from the real balances when something was changed by hand', () => {
    const first = forecastCash(input, h, [opening], '2026-12-31');
    const gift = mv({ accountId: 'aut', day: '2026-12-31', kind: 'ingreso', amountCents: 50_000 });
    const after = forecastCash(input, h, [opening, gift], '2026-12-31', first);
    expect(after.fingerprint).not.toBe(first.fingerprint);
    expect(after.firstNegative).toEqual({});
    expect(fingerprint(input, handMade([opening]))).toBe(first.fingerprint);
  });
});

describe('units from outside', () => {
  it('count as money put in at that day’s close, with the average price as their cost', () => {
    const h: Holdings = {
      accounts: [{ id: 'brk', kind: 'broker' }],
      instruments: { w: { kind: 'etf' } },
      estimates: {},
      vehicles: {},
      assets: {},
      properties: {},
      market: market({ w: { currency: 'EUR', price: '131.51' } }),
    };
    const added: Movement = {
      accountId: 'brk',
      day: '2026-10-30',
      seq: 0,
      kind: 'ajuste',
      amountCents: 0,
      instrumentId: 'w',
      qtyE8: toE8('10'),
      priceE8: toE8('97.32'),
      fxE8: E8,
      source: 'manual',
    };
    expect(unitFlows(h, [added], '2026-10-29', '2026-10-30')).toEqual({ brk: 131_510 });
    expect(unitFlows(h, [added], '2026-10-30', '2026-10-31')).toEqual({});
    expect(fold([added]).holdings.get('brk|w')).toEqual({ qtyE8: toE8('10'), costCents: 97_320 });
    // The day it comes in, net worth grows by exactly what came in: nothing was made.
    expect(valuation(h, [added], '2026-10-30').total - valuation(h, [], '2026-10-29').total).toBe(
      131_510,
    );
  });

  it('an estimate added as already held grows from when it was bought, its growth no gain of today', () => {
    const h: Holdings = {
      accounts: [{ id: 'brk', kind: 'broker' }],
      instruments: { pm: { kind: 'estimado' } },
      estimates: { 'brk|pm': 1200 },
      estimatesSince: { 'brk|pm': '2026-03-01' },
      vehicles: {},
      assets: {},
      properties: {},
      market: market({}),
    };
    // 300 € put in in March, at 12 % a year: added to Soleva on 4 November.
    const added: Movement = {
      accountId: 'brk',
      day: '2026-11-04',
      seq: 0,
      kind: 'ajuste',
      amountCents: 0,
      instrumentId: 'pm',
      qtyE8: E8,
      priceE8: toE8('300'),
      fxE8: E8,
      source: 'manual',
    };
    const today = Math.round(30_000 * 1.12 ** (248 / 365));
    expect(valuation(h, [added], '2026-11-04').total).toBe(today);
    expect(unitFlows(h, [added], '2026-11-03', '2026-11-04')).toEqual({ brk: today });
    // Its cost is what was put in: the position shows the gain since March.
    expect(fold([added]).holdings.get('brk|pm')).toEqual({ qtyE8: E8, costCents: 30_000 });
    expect(valuation(h, [added], '2027-03-01').total).toBe(33_600);
    // Without a day of purchase, from the day it came in.
    expect(valuation({ ...h, estimatesSince: {} }, [added], '2026-11-04').total).toBe(30_000);
  });
});
