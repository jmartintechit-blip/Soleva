import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAccount } from './alta.ts';
import { saveAutoRule } from './auto-rules.ts';
import type { Db } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createPgliteDb } from './db/pglite.ts';
import { readDebtForm, saveDebt } from './debts.ts';
import { addEstimate } from './estimates.ts';
import { runUser } from './engine-run.ts';
import { exportData } from './privacy.ts';
import {
  getFixedPlan,
  howAmIToday,
  loadProjection,
  planFor,
  projectView,
  saveFixedPlan,
} from './projection.ts';
import { createProperty } from './property.ts';
import { saveAssumptions } from './settings.ts';

const TODAY = '2026-10-31';
let db: Db;
let bank: string;
let loan: string;
let home: string;

beforeEach(async () => {
  db = createPgliteDb();
  await migrate(db);
  for (const id of ['ana', 'eva'])
    await db.query(
      `insert into "user" (id, name, email, "emailVerified") values ($1, '', $2, true)`,
      [id, `${id}@x.es`],
    );
  await db.query(`insert into engine_state (user_id, processed_through) values ('ana', $1)`, [
    TODAY,
  ]);
  await db.query(`insert into municipality values ('41039', 'Écija', 'ecija', '01')`);
  bank = await openAccount(db, 'ana', TODAY, {
    name: 'Bankinter',
    kind: 'efectivo',
    cents: 2_000_000,
  });
  loan = await openAccount(db, 'ana', TODAY, {
    name: 'Hipoteca',
    kind: 'deuda_hipoteca',
    cents: 9_000_000,
  });
  home = (await createProperty(db, 'ana', TODAY, {
    name: 'Piso',
    kind: 'habitual',
    municipalityCode: '41039',
    areaM2: 90,
    method: 'propio',
    ownCents: 16_000_000,
    growthBp: 200,
  })) as string;
  const form = new FormData();
  for (const [k, v] of Object.entries({
    tipo: 'fijo',
    capital: '90.000',
    desde: '2026-10',
    anos: '15',
    tipo_fijo: '2,6',
    paga: bank,
    dia: '5',
  }))
    form.set(k, v);
  const read = readDebtForm(form, TODAY);
  if (!read.ok) throw new Error('form');
  await saveDebt(db, 'ana', loan, TODAY, read.input);
  await saveAutoRule(db, 'ana', null, {
    name: 'Nómina',
    kind: 'ingreso',
    frequency: 'mensual',
    day: 28,
    startOn: TODAY,
    endOn: null,
    fromAccountId: null,
    toAccountId: bank,
    amountCents: 150_000,
  });
  await openAccount(db, 'eva', TODAY, { name: 'Suya', kind: 'efectivo', cents: 100 });
});
afterEach(() => db.close());

describe('projection on the server', () => {
  it('starts from today’s ledger, valued as Inicio values it, with the rules and the debt', async () => {
    const p = await loadProjection(db, 'ana', TODAY);
    const byId = Object.fromEntries(p.accounts.map((a) => [a.id, a]));
    expect(byId[bank]).toMatchObject({ kind: 'efectivo', cashCents: 2_000_000 });
    expect(byId[home]).toMatchObject({ cashCents: 0, home: { cents: 16_000_000, growthBp: 200 } });
    expect(byId[loan]!.cashCents).toBe(-9_000_000);
    expect(byId[loan]!.debt).toMatchObject({
      termMonths: 180,
      initialRateBp: 260,
      payerAccountId: bank,
    });
    expect(p.rules.map((r) => r.kind)).toEqual(['ingreso']);
    expect(p.ruleNames).toEqual({ [p.rules[0]!.id]: 'Nómina' });
    expect(p.accountNames[home]).toBe('Piso');
    expect(p.assumptions).toEqual({
      returnBp: { prudente: 300, base: 600, optimista: 800 },
      inflationBp: 250,
      rulesGrowthBp: 250,
    });
    const [day] = await db.query<{ total: number }>(
      `select total_cents::int as total from user_day where user_id = 'ana' order by day desc limit 1`,
    );
    const steps = projectView(p, { scenario: 'base', years: 5, unit: 'entonces' });
    expect(steps).toHaveLength(61);
    expect(steps[0]!.totalCents).toBe(day?.total ?? 2_000_000 + 16_000_000 - 9_000_000);
    expect(steps[0]!.totalCents).toBe(9_000_000);
    // Paid from the bank on the 5th: the mortgage goes down, the bank gets the salary.
    expect(steps[12]!.byAccount[loan]!).toBeGreaterThan(-9_000_000);
  });

  it('splits a broker into its cash, its quoted units and its estimates at their rate', async () => {
    const brk = await openAccount(db, 'ana', TODAY, {
      name: 'Bróker',
      kind: 'broker',
      cents: 50_000,
    });
    const [{ id: world }] = await db.query<{ id: string }>(
      `insert into instrument (kind, name, currency, price_source, source_id)
       values ('etf', 'World', 'EUR', 'yahoo', 'WRLD') returning id`,
    );
    await db.query(`insert into price values ($1, '2026-10-30', 10000000000, 'yahoo')`, [world]);
    // 10 units at 100 €.
    await db.query(
      `insert into movement (account_id, day, seq, kind, amount_cents, instrument_id, qty_e8,
         price_e8, fx_e8, source)
       values ($1, $2, 0, 'ajuste', 0, $3, 1000000000, 10000000000, 100000000, 'manual')`,
      [brk, TODAY, world],
    );
    const est = await addEstimate(db, 'ana', TODAY, {
      accountId: brk,
      name: 'Crowdfunding',
      investedCents: 300_000,
      since: '2026-01-01',
      rateBp: 700,
    });
    const p = await loadProjection(db, 'ana', TODAY);
    const b = p.accounts.find((a) => a.id === brk)!;
    expect(b).toMatchObject({ kind: 'broker', cashCents: 50_000, investedCents: 100_000 });
    expect(b.estimates).toHaveLength(1);
    expect(b.estimates![0]).toMatchObject({ instrumentId: est, rateBp: 700 });
    // Grown at 7 % since January, as Inicio values it.
    expect(b.estimates![0]!.cents).toBeGreaterThan(300_000);
    expect(b.estimates![0]!.cents).toBeLessThan(320_000);
    const [step] = projectView(p, { scenario: 'base', years: 5, unit: 'entonces' });
    expect(step!.byAccount[brk]).toBe(150_000 + b.estimates![0]!.cents);
  });

  it('only sees the user’s own accounts', async () => {
    const p = await loadProjection(db, 'eva', TODAY);
    expect(p.accounts.map((a) => p.accountNames[a.id])).toEqual(['Suya']);
    expect(p.rules).toEqual([]);
  });

  it('follows the inflation in «Tus ingresos y gastos» until it is set', async () => {
    await saveAssumptions(db, 'ana', { prudente: 200, base: 500, optimista: 700, inflation: 300 });
    let p = await loadProjection(db, 'ana', TODAY);
    expect(p.assumptions.rulesGrowthBp).toBe(300);
    expect(p.rulesGrowthFollowsInflation).toBe(true);
    await saveAssumptions(db, 'ana', {
      prudente: 200,
      base: 500,
      optimista: 700,
      inflation: 300,
      rulesGrowth: 100,
    });
    p = await loadProjection(db, 'ana', TODAY);
    expect(p.assumptions.rulesGrowthBp).toBe(100);
    // Saving the other assumptions alone leaves it as it is.
    await saveAssumptions(db, 'ana', { prudente: 300, base: 600, optimista: 800, inflation: 250 });
    p = await loadProjection(db, 'ana', TODAY);
    expect(p.assumptions.rulesGrowthBp).toBe(100);
  });

  it('fixes my plan from stored data, replaces it, exports it, and says how I am doing', async () => {
    const p = await loadProjection(db, 'ana', TODAY);
    expect(await howAmIToday(db, 'ana', p)).toBeNull();
    const plan = planFor(p, { scenario: 'base', years: 10, unit: 'hoy' });
    await saveFixedPlan(db, 'ana', plan);
    expect(await getFixedPlan(db, 'ana')).toEqual(plan);
    expect(await getFixedPlan(db, 'eva')).toBeNull();
    const again = planFor(p, { scenario: 'prudente', years: 5, unit: 'entonces' });
    await saveFixedPlan(db, 'ana', again);
    expect((await getFixedPlan(db, 'ana'))!.months).toBe(60);
    expect((await exportData(db, 'ana')).mi_plan).toHaveLength(61);

    // A week later: the engine ran, and 1.000 € went out by hand.
    const later = '2026-11-07';
    await runUser(db, 'ana', later);
    await db.query(
      `insert into movement (account_id, day, kind, amount_cents, source)
       values ($1, '2026-11-06', 'gasto', -100000, 'manual')`,
      [bank],
    );
    await runUser(db, 'ana', later);
    const now = await loadProjection(db, 'ana', later);
    const how = (await howAmIToday(db, 'ana', now))!;
    expect(how.plan.fixedOn).toBe(TODAY);
    expect(how.status.why.fuera).toBe(-100_000);
    expect(how.status.why.aportado + how.status.why.rentabilidad + how.status.why.fuera).toBe(
      how.status.gapCents,
    );
    expect(how.status.level).toBe('por_debajo');
  });
});
