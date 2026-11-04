import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAccount } from './alta.ts';
import type { Db } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createPgliteDb } from './db/pglite.ts';
import { runUser } from './engine-run.ts';
import {
  createProperty,
  debtsOf,
  openMortgage,
  placeOf,
  propertyView,
  readPropertyForm,
  searchMunicipalities,
  updateProperty,
} from './property.ts';

let db: Db;
beforeEach(async () => {
  db = createPgliteDb();
  await migrate(db);
  for (const id of ['ana', 'eva'])
    await db.query(
      `insert into "user" (id, name, email, "emailVerified") values ($1, '', $2, true)`,
      [id, `${id}@x.es`],
    );
  await db.query(`insert into municipality values
    ('41039', 'Écija', 'ecija', '01'), ('41091', 'Sevilla', 'sevilla', '01'),
    ('41004', 'Alanís', 'alanis', '01'), ('51001', 'Ceuta', 'ceuta', '18'),
    ('49001', 'Abezames', 'abezames', '07')`);
  await db.query(`insert into housing_m2 values
    ('41039', '2026-04-01', 123150), ('41', '2026-04-01', 145050), ('51001', '2026-04-01', 221490)`);
  await db.query(`insert into housing_index values
    ('01', '2026-01-01', 108090), ('01', '2026-04-01', 111393), ('01', '2026-07-01', 114000),
    ('00', '2026-04-01', 111682), ('00', '2026-07-01', 113916)`);
});
afterEach(() => db.close());

const home = {
  name: 'Piso de Écija',
  kind: 'habitual' as const,
  municipalityCode: '41039',
  areaM2: 90,
  method: 'm2' as const,
  growthBp: 200,
};

describe('property', () => {
  it('finds municipalities by part of their name, without accents, those that start first', async () => {
    expect(await searchMunicipalities(db, 'ECI')).toEqual([
      { code: '41039', name: 'Écija', province: 'Sevilla' },
    ]);
    expect((await searchMunicipalities(db, 'la')).map((p) => p.name)).toEqual([
      'Alanís',
      'Sevilla',
    ]);
    expect(await searchMunicipalities(db, 'a')).toEqual([]);
  });

  it('gives the municipality’s €/m², else its province’s, brought to the latest index', async () => {
    expect(await placeOf(db, '41039')).toEqual({
      place: { code: '41039', name: 'Écija', province: 'Sevilla' },
      region: '01',
      lastYearBp: null,
      indexQuarter: '2026-07-01',
      // × 114 / 111,393.
      m2: { area: 'municipio', eurM2Cents: 123150, quarter: '2026-04-01', todayEurM2Cents: 126032 },
    });
    expect((await placeOf(db, '41004'))!.m2).toMatchObject({
      area: 'provincia',
      eurM2Cents: 145050,
    });
    // Ceuta has no index of its own: Spain's.
    expect((await placeOf(db, '51001'))!.m2!.todayEurM2Cents).toBe(
      Math.round((221490 * 113916) / 111682),
    );
    expect((await placeOf(db, '49001'))!.m2).toBeNull();
    expect(await placeOf(db, '99999')).toBeNull();
    // A year of quarters: what the region rose, said only to say it is not a forecast.
    await db.query(
      `insert into housing_index values ('01', '2025-07-01', 101000), ('01', '2025-10-01', 99000)`,
    );
    expect((await placeOf(db, '41039'))!.lastYearBp).toBe(
      Math.round((114000 / 101000 - 1) * 10_000),
    );
  });

  it('opens at m² × €/m² from the Ministry’s quarter, and the engine indexes it from there', async () => {
    await db.query(
      `insert into engine_state (user_id, processed_through) values ('ana', '2026-11-01')`,
    );
    const id = (await createProperty(db, 'ana', '2026-11-01', home)) as string;
    expect(
      await db.query(
        `select a.kind, p.value_method, p.value_on::text, m.kind as mv, m.amount_cents::int as cents
         from money_account a join property p on p.account_id = a.id
         join movement m on m.account_id = a.id where a.id = $1`,
        [id],
      ),
    ).toEqual([
      {
        kind: 'inmueble',
        value_method: 'm2',
        value_on: '2026-04-01',
        mv: 'apertura',
        cents: 11_083_500,
      },
    ]);
    await runUser(db, 'ana', '2026-11-02');
    const [day] = await db.query<{ total: string; classes: Record<string, number> }>(
      `select total_cents::text as total, classes from user_day where user_id = 'ana' and day = '2026-11-02'`,
    );
    expect(day!.total).toBe('11342894');
    expect(day!.classes.inmuebles).toBe(11_342_894);
  });

  it('takes the user’s own value from today; no figure means no m² value', async () => {
    const id = await createProperty(db, 'ana', '2026-11-01', {
      ...home,
      method: 'propio',
      ownCents: 11_500_000,
      purchaseYear: 2018,
      purchaseCents: 9_800_000,
    });
    expect(
      await db.query(`select value_on::text, purchase_year from property where account_id = $1`, [
        id,
      ]),
    ).toEqual([{ value_on: '2026-11-01', purchase_year: 2018 }]);
    expect(
      await createProperty(db, 'ana', '2026-11-01', { ...home, municipalityCode: '49001' }),
    ).toBe('sin_dato');
  });

  it('links only a debt of the same user', async () => {
    const mine = await openAccount(db, 'ana', '2026-11-01', {
      name: 'Hipoteca',
      kind: 'deuda_hipoteca',
      cents: 6_240_000,
    });
    const hers = await openAccount(db, 'eva', '2026-11-01', {
      name: 'Hipoteca',
      kind: 'deuda_hipoteca',
      cents: 100,
    });
    const bank = await openAccount(db, 'ana', '2026-11-01', {
      name: 'Banco',
      kind: 'efectivo',
      cents: 100,
    });
    expect(
      await createProperty(db, 'ana', '2026-11-01', { ...home, mortgageAccountId: mine }),
    ).toBeTruthy();
    expect(
      await createProperty(db, 'ana', '2026-11-01', { ...home, mortgageAccountId: hers }),
    ).toBeNull();
    expect(
      await createProperty(db, 'ana', '2026-11-01', { ...home, mortgageAccountId: bank }),
    ).toBeNull();
    // Nothing half-made of the refused ones.
    expect(await db.query(`select count(*)::int as n from property`)).toEqual([{ n: 1 }]);
    expect(
      await db.query(`select count(*)::int as n from money_account where kind = 'inmueble'`),
    ).toEqual([{ n: 1 }]);
  });

  it('opens a new mortgage after its home, owing what was said, and links it', async () => {
    const homeId = (await createProperty(db, 'ana', '2026-11-01', home)) as string;
    const debt = await openMortgage(db, 'ana', '2026-11-01', homeId, 'Piso', 6_240_000);
    expect(
      await db.query(
        `select a.name, a.kind, m.amount_cents::int as cents,
                (select mortgage_account_id from property where account_id = $2) as linked
         from money_account a join movement m on m.account_id = a.id where a.id = $1`,
        [debt, homeId],
      ),
    ).toEqual([
      { name: 'Hipoteca de Piso', kind: 'deuda_hipoteca', cents: -6_240_000, linked: debt },
    ]);
    const [first] = await db.query<{ id: string }>(
      `select id from money_account order by created_at, id limit 1`,
    );
    expect(first!.id).toBe(homeId);
  });

  it('shows it only to whoever can see it; a new value goes in as an adjustment of today', async () => {
    const id = (await createProperty(db, 'ana', '2026-11-01', home)) as string;
    expect(await propertyView(db, 'eva', id, '2026-11-02')).toBeNull();
    const v = (await propertyView(db, 'ana', id, '2026-11-02'))!;
    expect(v).toMatchObject({
      name: 'Piso de Écija',
      areaM2: 90,
      method: 'm2',
      valueCents: 11_342_894,
    });
    expect(await updateProperty(db, 'eva', id, '2026-11-02', { ...home, name: 'Mío' })).toBeNull();
    // Only the name: no adjustment.
    expect(await updateProperty(db, 'ana', id, '2026-11-02', { ...home, name: 'Casa' })).toBe(true);
    // 120.000 € by hand.
    expect(
      await updateProperty(db, 'ana', id, '2026-11-02', {
        ...home,
        name: 'Casa',
        method: 'propio',
        ownCents: 12_000_000,
      }),
    ).toBe(true);
    expect(
      await db.query(
        `select kind, amount_cents::int as cents from movement where account_id = $1 order by day, seq, kind`,
        [id],
      ),
    ).toEqual([
      { kind: 'apertura', cents: 11_083_500 },
      { kind: 'ajuste', cents: 12_000_000 - 11_342_894 },
    ]);
    expect(await propertyView(db, 'ana', id, '2026-11-03')).toMatchObject({
      name: 'Casa',
      method: 'propio',
      valueCents: 12_000_000,
    });
    // Back to m² with 100 m²: 100 × 1.260,32 €.
    await updateProperty(db, 'ana', id, '2026-11-03', { ...home, areaM2: 100 });
    expect((await propertyView(db, 'ana', id, '2026-11-03'))!.valueCents).toBe(12_603_200);
  });

  it('lists the user’s debts with what is owed', async () => {
    await openAccount(db, 'ana', '2026-11-01', {
      name: 'Hipoteca',
      kind: 'deuda_hipoteca',
      cents: 6_240_000,
    });
    await openAccount(db, 'eva', '2026-11-01', { name: 'Suya', kind: 'deuda_hipoteca', cents: 1 });
    expect(await debtsOf(db, 'ana')).toEqual([
      { id: expect.any(String), name: 'Hipoteca', cents: -6_240_000 },
    ]);
  });

  it('reads the form: the municipality picked or typed exactly, else the candidates', async () => {
    const form = (fields: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ name: 'Piso', kind: 'habitual', m2: '90', ...fields }))
        f.set(k, v);
      return f;
    };
    const ok = await readPropertyForm(db, form({ codigo: '41039' }), 2026);
    expect(ok).toMatchObject({
      ok: true,
      input: { municipalityCode: '41039', areaM2: 90, method: 'm2', growthBp: 200 },
      mortgage: null,
    });
    // Without JavaScript: the exact name (as the box shows it once picked, too).
    expect(await readPropertyForm(db, form({ municipio: 'Écija (Sevilla)' }), 2026)).toMatchObject({
      ok: true,
      input: { municipalityCode: '41039' },
    });
    const vague = await readPropertyForm(db, form({ municipio: 'la' }), 2026);
    expect(vague).toMatchObject({
      ok: false,
      errors: { municipio: 'Elige tu municipio de la lista' },
    });
    expect(vague.ok ? [] : vague.candidates.map((c) => c.name)).toEqual(['Alanís', 'Sevilla']);
    const bad = await readPropertyForm(
      db,
      form({
        codigo: '41039',
        name: '',
        m2: '0',
        ano: '2030',
        metodo: 'propio',
        crecimiento: '700',
      }),
      2026,
    );
    expect(bad.ok ? {} : bad.errors).toEqual({
      name: 'Ponle un nombre (hasta 60 letras)',
      m2: 'Escribe los m², por ejemplo 90',
      ano: 'Escribe el año, por ejemplo 2018',
      valor: 'Escribe lo que vale, por ejemplo 115.000',
      crecimiento: 'Elige cuánto sube al año',
    });
    expect(await readPropertyForm(db, form({ codigo: '49001' }), 2026)).toMatchObject({
      ok: false,
      errors: { valor: expect.stringContaining('pon tu valor') },
    });
    expect(
      await readPropertyForm(
        db,
        form({ codigo: '41039', hipoteca: 'on', hipoteca_id: 'nueva', hipoteca_debe: '62.400' }),
        2026,
      ),
    ).toMatchObject({ ok: true, mortgage: { newCents: 6_240_000 } });
  });
});
