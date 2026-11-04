import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createPgliteDb } from './db/pglite.ts';
import { runUser } from './engine-run.ts';
import {
  createGood,
  goodView,
  haciendaValue,
  readGoodForm,
  searchVehicles,
  updateGood,
} from './goods.ts';

let db: Db;
let mazda: string;
beforeEach(async () => {
  db = createPgliteDb();
  await migrate(db);
  for (const id of ['ana', 'eva'])
    await db.query(
      `insert into "user" (id, name, email, "emailVerified") values ($1, '', $2, true)`,
      [id, `${id}@x.es`],
    );
  await db.query(
    `insert into engine_state (user_id, processed_through) values ('ana', '2026-10-31')`,
  );
  [{ id: mazda }] = await db.query<{ id: string }>(
    `insert into vehicle_base (order_year, brand, model, period, fuel, cc, value_cents)
     values (2026, 'MAZDA', '3 1.6 CRTD 115 CV', '2009-2013', 'D', 1598, 2240000) returning id`,
  );
  await db.query(`insert into vehicle_base (order_year, brand, model, value_cents)
    values (2025, 'MAZDA', '3 1.6 CRTD 115 CV', 1), (2026, 'SEAT', 'IBIZA 1.0', 1500000)`);
  await db.query(`insert into vehicle_depreciation values
    (2026, 0, 10000), (2026, 1, 8400), (2026, 11, 1100), (2026, 12, 1000)`);
});
afterEach(() => db.close());

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe('cars and goods', () => {
  it('finds models of the latest order by every word, and their value by years of use', async () => {
    expect((await searchVehicles(db, 'mazda crtd')).map((m) => [m.model, m.valueCents])).toEqual([
      ['3 1.6 CRTD 115 CV', 2_240_000],
    ]);
    expect(await searchVehicles(db, 'm')).toEqual([]);
    // 13 years in 2026: 10 %.
    expect(await haciendaValue(db, mazda, '2013-05-10', '2026-11-01')).toMatchObject({
      newCents: 2_240_000,
      pctBp: 1000,
      years: 13,
      cents: 224_000,
    });
  });

  it('opens a car at Hacienda’s value; a value of the user’s wins from its day', async () => {
    const id = (await createGood(db, 'ana', '2026-11-01', 'vehiculo', {
      name: 'Coche',
      baseId: mazda,
      firstRegistration: '2013-05-10',
    })) as string;
    expect(await goodView(db, 'eva', id, '2026-11-01')).toBeNull();
    expect(await goodView(db, 'ana', id, '2026-11-01')).toMatchObject({ valueCents: 224_000 });
    await runUser(db, 'ana', '2026-11-01');
    const [day] = await db.query<{ classes: Record<string, number> }>(
      `select classes from user_day where user_id = 'ana' and day = '2026-11-01'`,
    );
    expect(day!.classes.bienes).toBe(224_000);
    expect(await updateGood(db, 'eva', id, '2026-11-02', { name: 'Mío' })).toBeNull();
    await updateGood(db, 'ana', id, '2026-11-02', {
      name: 'Coche',
      baseId: mazda,
      firstRegistration: '2013-05-10',
      ownCents: 291_000,
    });
    expect(await goodView(db, 'ana', id, '2027-06-01')).toMatchObject({
      valueCents: 291_000,
      car: { own: true },
    });
  });

  it('opens a good at what is left of its price, and it keeps losing its rate', async () => {
    const id = (await createGood(db, 'ana', '2025-10-01', 'bien', {
      name: 'Portátil',
      category: 'electronica',
      purchaseCents: 180_000,
      purchasedOn: '2024-10-01',
      annualLossBp: 2500,
    })) as string;
    expect((await goodView(db, 'ana', id, '2025-10-01'))!.valueCents).toBe(135_000);
    expect((await goodView(db, 'ana', id, '2026-10-01'))!.valueCents).toBe(101_250);
    expect(
      await createGood(db, 'ana', '2026-11-01', 'vehiculo', {
        name: 'X',
        firstRegistration: '2020-01-01',
      }),
    ).toBe('sin_valor');
  });

  it('reads RCoche and RBien', () => {
    expect(
      readGoodForm(
        form({ name: 'Coche', modelo: 'm1', matriculacion: '2013-05-10' }),
        'vehiculo',
        '2026-11-01',
      ),
    ).toMatchObject({ ok: true, input: { baseId: 'm1', ownCents: null } });
    expect(
      readGoodForm(
        form({ name: 'Coche', matriculacion: '2013-05-10', mio: 'on', valor: '2.910' }),
        'vehiculo',
        '2026-11-01',
      ),
    ).toMatchObject({ ok: true, input: { baseId: null, ownCents: 291_000 } });
    const bad = readGoodForm(
      form({ name: '', matriculacion: '2030-01-01' }),
      'vehiculo',
      '2026-11-01',
    );
    expect(Object.keys(bad.ok ? {} : bad.errors).sort()).toEqual([
      'matriculacion',
      'modelo',
      'name',
    ]);
    expect(
      readGoodForm(
        form({ name: 'Reloj', tipo: 'reloj', precio: '900', cuando: '2020-06', pierde: '5' }),
        'bien',
        '2026-11-01',
      ),
    ).toMatchObject({ ok: true, input: { purchasedOn: '2020-06-01', annualLossBp: 500 } });
  });
});
