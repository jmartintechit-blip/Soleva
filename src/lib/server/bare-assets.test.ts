import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAccount } from './accounts.ts';
import type { Db } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createPgliteDb } from './db/pglite.ts';
import { runUser } from './engine-run.ts';
import { bareAsset, completeGood, goodView } from './goods.ts';
import { enterApp } from './ledger-migration.ts';
import { completeProperty, propertyView } from './property.ts';
import { closeAccount, readCloseForm, removalView, removeAccount, undoClosing } from './removal.ts';

// A home and a car from v0 reach the ledger without their details (B12 tarea 11): valued at
// their balance, given up and deleted like the others, and completed in RInmueble and RCoche.
let db: Db;
let bank: string;
let flat: string;
let car: string;
beforeEach(async () => {
  db = createPgliteDb();
  await migrate(db);
  for (const id of ['ana', 'eva'])
    await db.query(
      `insert into "user" (id, name, email, "emailVerified") values ($1, '', $2, true)`,
      [id, `${id}@x.es`],
    );
  await db.query(`insert into municipality values ('41039', 'Écija', 'ecija', '01')`);
  await db.query(`insert into housing_m2 values ('41039', '2026-04-01', 123150)`);
  await db.query(`insert into housing_index values ('01', '2026-04-01', 111393)`);
  const base = { isEstimated: true, annualRateBp: 0 };
  bank = await createAccount(db, 'ana', {
    ...base,
    isEstimated: false,
    name: 'Banco',
    kind: 'efectivo',
    balanceCents: 1_000_000,
  });
  flat = await createAccount(db, 'ana', {
    ...base,
    name: 'Piso',
    kind: 'inmueble',
    balanceCents: 15_000_000,
  });
  car = await createAccount(db, 'ana', {
    ...base,
    name: 'Coche',
    kind: 'vehiculo',
    balanceCents: 900_000,
  });
  expect(await enterApp(db, 'ana', '2026-11-15')).toBe('migrado');
  await runUser(db, 'ana', '2026-11-20');
});
afterEach(() => db.close());

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const lastDay = async () =>
  (
    await db.query<{ total: number; accounts: Record<string, [number]> }>(
      `select total_cents::float8 as total, accounts from user_day where user_id = 'ana'
       order by day desc limit 1`,
    )
  )[0]!;

describe('a home or car from v0 without its details', () => {
  it('is bare to its owner only, valued at its balance', async () => {
    expect(await bareAsset(db, 'ana', flat)).toEqual({
      id: flat,
      name: 'Piso',
      page: 'inmueble',
      canEdit: true,
    });
    expect(await bareAsset(db, 'ana', car)).toMatchObject({ page: 'coche' });
    expect(await bareAsset(db, 'ana', bank)).toBeNull();
    expect(await bareAsset(db, 'eva', flat)).toBeNull();
    expect(await lastDay()).toMatchObject({
      total: 16_900_000,
      accounts: { [flat]: [15_000_000, 0, 0], [car]: [900_000, 0, 0] },
    });
  });

  it('is given up, undone and deleted like the others', async () => {
    const view = (await removalView(db, 'ana', car))!;
    expect(view).toMatchObject({ kind: 'vehiculo', href: `/cuentas/${car}`, mortgage: null });
    const read = readCloseForm(
      form({ fecha: '2026-11-18', como: 'vendi', cuenta: bank, importe: '8.000' }),
      view,
      '2026-11-20',
    );
    if (!read.ok) throw new Error(JSON.stringify(read.errors));
    expect(await closeAccount(db, 'ana', view, read.input)).toBe(true);
    expect(await bareAsset(db, 'ana', car)).toBeNull();
    expect((await lastDay()).accounts[bank]![0]).toBe(1_800_000);
    expect((await lastDay()).accounts[car]).toBeUndefined();

    expect(await undoClosing(db, 'ana', car)).toBe(true);
    expect(await lastDay()).toMatchObject({
      total: 16_900_000,
      accounts: { [bank]: [1_000_000, 0, 0], [car]: [900_000, 0, 0] },
    });

    expect(await removeAccount(db, 'ana', (await removalView(db, 'ana', flat))!, 'borrar')).toBe(
      true,
    );
    expect(await lastDay()).toMatchObject({ total: 1_900_000 });
    expect(await db.query(`select 1 from money_account where id = $1`, [flat])).toEqual([]);
  });

  it('completed in RInmueble: m² × €/m² from today, the index moves it from there', async () => {
    const home = {
      name: 'Piso de Écija',
      kind: 'habitual' as const,
      municipalityCode: '41039',
      areaM2: 90,
      method: 'm2' as const,
      growthBp: 200,
    };
    expect(await completeProperty(db, 'eva', flat, '2026-11-20', home)).toBeNull();
    expect(await completeProperty(db, 'ana', car, '2026-11-20', home)).toBeNull();
    expect(await completeProperty(db, 'ana', flat, '2026-11-20', home)).toBe(true);
    // 90 m² × 1.231,50 €/m², to the hundred.
    expect(await propertyView(db, 'ana', flat, '2026-11-20')).toMatchObject({
      name: 'Piso de Écija',
      method: 'm2',
      valueCents: 11_080_000,
    });
    expect(await bareAsset(db, 'ana', flat)).toBeNull();
    // Twice is not a second property.
    expect(await completeProperty(db, 'ana', flat, '2026-11-20', home)).toBeNull();
    await runUser(db, 'ana', '2026-11-21');
    expect((await lastDay()).accounts[flat]![0]).toBe(11_080_000);
  });

  it('completed in RCoche: the user’s value from today', async () => {
    const own = { name: 'Mi coche', firstRegistration: '2020-03-01', ownCents: 700_000 };
    expect(await completeGood(db, 'ana', flat, '2026-11-20', own)).toBeNull();
    expect(await completeGood(db, 'ana', car, '2026-11-20', own)).toBe(true);
    expect(await goodView(db, 'ana', car, '2026-11-20')).toMatchObject({
      name: 'Mi coche',
      valueCents: 700_000,
      car: { own: true },
    });
    expect(await bareAsset(db, 'ana', car)).toBeNull();
    await runUser(db, 'ana', '2026-11-21');
    expect((await lastDay()).accounts[car]![0]).toBe(700_000);
  });
});
