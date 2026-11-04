import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAccount } from './alta.ts';
import type { Db } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createPgliteDb } from './db/pglite.ts';
import { readDebtForm, saveDebt } from './debts.ts';
import { runUser } from './engine-run.ts';
import { createGood } from './goods.ts';
import { createProperty, openMortgage } from './property.ts';
import { closeAccount, readCloseForm, removalView, removeAccount } from './removal.ts';

let db: Db;
let bank: string;
let home: string;
let mortgage: string;
beforeEach(async () => {
  db = createPgliteDb();
  await migrate(db);
  for (const id of ['ana', 'eva'])
    await db.query(
      `insert into "user" (id, name, email, "emailVerified") values ($1, '', $2, true)`,
      [id, `${id}@x.es`],
    );
  await db.query(`insert into municipality values ('41039', 'Écija', 'ecija', '01')`);
  // One quarter only: the home keeps its value, so every figure below is easy to follow.
  await db.query(`insert into housing_index values ('01', '2026-04-01', 111393)`);
  await db.query(
    `insert into engine_state (user_id, processed_through) values ('ana', '2026-10-01')`,
  );
  bank = await openAccount(db, 'ana', '2026-10-01', {
    name: 'Bankinter',
    kind: 'efectivo',
    cents: 1_000_000,
  });
  home = (await createProperty(db, 'ana', '2026-10-01', {
    name: 'Piso de Écija',
    kind: 'habitual',
    municipalityCode: '41039',
    areaM2: 90,
    method: 'propio',
    ownCents: 20_000_000,
    growthBp: 200,
  })) as string;
  mortgage = await openMortgage(db, 'ana', '2026-10-01', home, 'Piso de Écija', 6_000_000);
  await runUser(db, 'ana', '2026-10-20');
});
afterEach(() => db.close());

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

type Day = {
  day: string;
  total: number;
  flows: number;
  accounts: Record<string, [number, number, number]>;
  classes: Record<string, number>;
};
const history = () =>
  db.query<Day>(
    `select day::text, total_cents::float8 as total, flows_cents::float8 as flows, accounts, classes
     from user_day where user_id = 'ana' order by day`,
  );
const on = (rows: Day[], day: string) => rows.find((r) => r.day === day)!;
const before = (rows: Day[], day: string) => rows.filter((r) => r.day < day);

async function close(id: string, fields: Record<string, string>, today = '2026-10-20') {
  const view = (await removalView(db, 'ana', id))!;
  const read = readCloseForm(form(fields), view, today);
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return closeAccount(db, 'ana', view, read.input);
}

describe('baja', () => {
  it('shows a home with its open mortgage to its owner only', async () => {
    await runUser(db, 'ana', '2026-10-20');
    expect(await removalView(db, 'ana', home)).toMatchObject({
      name: 'Piso de Écija',
      isDebt: false,
      href: `/cuentas/${home}/inmueble`,
      openedOn: '2026-10-01',
      closedOn: null,
      cents: 20_000_000,
      mortgage: { id: mortgage, name: 'Hipoteca de Piso de Écija', cents: -6_000_000 },
      accounts: [{ id: bank, name: 'Bankinter' }],
    });
    expect(await removalView(db, 'eva', home)).toBeNull();
    // A bank account is not given up this way.
    expect(await removalView(db, 'ana', bank)).toBeNull();
  });

  it('says what is wrong in the form', async () => {
    const view = (await removalView(db, 'ana', home))!;
    const hers = await openAccount(db, 'eva', '2026-10-01', {
      name: 'Suya',
      kind: 'efectivo',
      cents: 100,
    });
    const errors = (fields: Record<string, string>) => {
      const read = readCloseForm(form(fields), view, '2026-10-20');
      return read.ok ? {} : read.errors;
    };
    expect(errors({ fecha: '2026-10-21', como: 'vendi', hipoteca: 'liquidar' })).toEqual({
      fecha: 'No puede ser después de hoy',
    });
    expect(Object.keys(errors({ fecha: '2026-09-30', como: 'x' })).sort()).toEqual([
      'como',
      'fecha',
      'hipoteca',
    ]);
    expect(
      errors({
        fecha: '2026-10-10',
        como: 'vendi',
        cuenta: hers,
        importe: '1',
        hipoteca: 'mantener',
      }),
    ).toEqual({ cuenta: 'Elige una de tus cuentas' });
    expect(
      errors({ fecha: '2026-10-10', como: 'vendi', cuenta: bank, hipoteca: 'mantener' }),
    ).toEqual({ importe: 'Pon lo que te dieron' });
    // Sold without saying where the money went: it simply leaves.
    expect(
      readCloseForm(
        form({ fecha: '2026-10-10', como: 'vendi', importe: '9', hipoteca: 'mantener' }),
        view,
        '2026-10-20',
      ),
    ).toMatchObject({
      ok: true,
      input: { on: '2026-10-10', toAccountId: undefined, amountCents: undefined },
    });
  });

  it('sold from a day into an account: the days before do not change, the mortgage is paid off from the sale', async () => {
    const was = await history();
    expect(on(was, '2026-10-09').total).toBe(15_000_000);
    expect(
      await close(home, {
        fecha: '2026-10-10',
        como: 'vendi',
        cuenta: bank,
        importe: '210.000',
        hipoteca: 'liquidar',
      }),
    ).toBe(true);
    const now = await history();
    expect(before(now, '2026-10-10')).toEqual(before(was, '2026-10-10'));
    expect(now.map((r) => r.day)).toEqual(was.map((r) => r.day));
    // 10.000 + 210.000 − 60.000: the 10.000 € over its estimate are that day's gain.
    for (const day of ['2026-10-10', '2026-10-20'])
      expect(on(now, day)).toMatchObject({
        total: 16_000_000,
        accounts: { [bank]: [16_000_000, day === '2026-10-10' ? 15_000_000 : 0, 0] },
        classes: { inmuebles: 0, deudas: 0, liquidez: 16_000_000 },
      });
    expect(on(now, '2026-10-10').flows).toBe(0);
    expect(Object.keys(on(now, '2026-10-10').accounts)).toEqual([bank]);
    expect(
      await db.query(
        `select kind, amount_cents::float8 as cents, note from movement
         where account_id = $1 and note = 'baja' order by amount_cents desc`,
        [bank],
      ),
    ).toEqual([
      { kind: 'transferencia', cents: 21_000_000, note: 'baja' },
      { kind: 'amortizacion', cents: -6_000_000, note: 'baja' },
    ]);
    expect(
      await db.query(
        `select closed_on::text, archived_at is not null as archived, balance_cents::int as b
         from money_account where id = any($1) order by id`,
        [[home, mortgage]],
      ),
    ).toEqual([
      { closed_on: '2026-10-10', archived: true, b: 0 },
      { closed_on: '2026-10-10', archived: true, b: 0 },
    ]);
    // The next runs keep it out.
    await runUser(db, 'ana', '2026-10-22');
    expect(on(await history(), '2026-10-22').total).toBe(16_000_000);
    expect((await removalView(db, 'ana', home))!.closedOn).toBe('2026-10-10');
  });

  it('given away: its value that day leaves as money taken out, with no loss on the days after', async () => {
    const laptop = (await createGood(db, 'ana', '2026-10-01', 'bien', {
      name: 'Portátil',
      category: 'electronica',
      purchaseCents: 180_000,
      purchasedOn: '2025-04-01',
      annualLossBp: 2500,
    })) as string;
    await db.query(`update engine_state set processed_through = '2026-10-01'`);
    await db.query(`delete from user_day`);
    await runUser(db, 'ana', '2026-10-20');
    const was = await history();
    const worth = (day: string) => on(was, day).accounts[laptop]![0];
    // Bought for 1.800 €, it loses 25 % a year month by month: less than that now, still something.
    expect(worth('2026-10-10')).toBeLessThan(180_000);
    expect(worth('2026-10-10')).toBeGreaterThan(0);
    expect(await close(laptop, { fecha: '2026-10-10', como: 'ya_no' })).toBe(true);
    const now = await history();
    expect(before(now, '2026-10-10')).toEqual(before(was, '2026-10-10'));
    expect(on(now, '2026-10-10').flows).toBe(-worth('2026-10-10'));
    for (const day of ['2026-10-10', '2026-10-15', '2026-10-20'])
      expect(on(now, day).total).toBe(on(was, day).total - worth(day));
    // That day made what the laptop lost that day, as any other day: nothing more.
    const made = (rows: Day[]) =>
      on(rows, '2026-10-10').total - on(rows, '2026-10-09').total - on(rows, '2026-10-10').flows;
    expect(made(now)).toBe(made(was));
    expect(Object.keys(on(now, '2026-10-12').accounts)).not.toContain(laptop);
  });

  it('a debt paid off on a past day: its payments after it are undone and the bank pays what was owed', async () => {
    const loan = await openAccount(db, 'ana', '2026-10-01', {
      name: 'Préstamo del coche',
      kind: 'deuda_hipoteca',
      cents: 1_000_000,
    });
    const read = readDebtForm(
      form({
        tipo: 'fijo',
        capital: '12.000',
        desde: '2025-10',
        anos: '5',
        tipo_fijo: '5',
        paga: bank,
        dia: '1',
      }),
      '2026-10-01',
    );
    if (!read.ok) throw new Error('form');
    expect(await saveDebt(db, 'ana', loan, '2026-10-01', read.input)).toBe(true);
    await db.query(`update engine_state set processed_through = '2026-10-01'`);
    await db.query(`delete from user_day`);
    await runUser(db, 'ana', '2026-11-10');
    const was = await history();
    const live = (key: string) =>
      db.query<{ n: number }>(
        `select count(*)::int as n from movement where occurrence_key like $1 and voided_at is null`,
        [key],
      );
    expect(await live(`debt:${loan}:2026-11-01:%`)).toEqual([{ n: 3 }]);
    expect(on(was, '2026-11-01').flows).toBeLessThan(0);
    const owed = -on(was, '2026-10-15').accounts[loan]![0];

    expect(
      await close(loan, { fecha: '2026-10-15', como: 'pagada', cuenta: bank }, '2026-11-10'),
    ).toBe(true);
    const now = await history();
    expect(before(now, '2026-10-15')).toEqual(before(was, '2026-10-15'));
    expect(await live(`debt:${loan}:2026-11-01:%`)).toEqual([{ n: 0 }]);
    // Paying a debt from the bank changes nothing; without the November payment, no interest.
    for (const day of ['2026-10-15', '2026-11-01', '2026-11-10'])
      expect(on(now, day).total).toBe(on(was, '2026-10-15').total);
    expect(on(now, '2026-11-01').flows).toBe(0);
    expect(on(now, '2026-10-15').accounts[bank]![0]).toBe(
      on(was, '2026-10-15').accounts[bank]![0] - owed,
    );
    await runUser(db, 'ana', '2026-12-02');
    expect(await live(`debt:${loan}:2026-12-01:%`)).toEqual([{ n: 0 }]);
  });
});

describe('borrar', () => {
  it('deleted by mistake: gone from every day, its mortgage with it', async () => {
    const was = await history();
    const view = (await removalView(db, 'ana', home))!;
    expect(await removeAccount(db, 'ana', view, 'borrar')).toBe(true);
    const now = await history();
    expect(now.map((r) => r.day)).toEqual(was.map((r) => r.day));
    for (const r of now)
      expect(r).toMatchObject({
        total: 1_000_000,
        accounts: { [bank]: [1_000_000, 0, 0] },
        classes: { inmuebles: 0, deudas: 0 },
      });
    expect(
      await db.query(`select count(*)::int as n from money_account where id = any($1)`, [
        [home, mortgage],
      ]),
    ).toEqual([{ n: 0 }]);
    expect(await removalView(db, 'ana', home)).toBeNull();
  });

  it('takes away the money a sale of it brought, and keeps the mortgage if asked', async () => {
    await close(home, {
      fecha: '2026-10-10',
      como: 'vendi',
      cuenta: bank,
      importe: '210.000',
      hipoteca: 'mantener',
    });
    expect(on(await history(), '2026-10-12').total).toBe(1_000_000 + 21_000_000 - 6_000_000);
    const view = (await removalView(db, 'ana', home))!;
    // Unlinked on the baja: nothing to ask about it now.
    expect(view.mortgage).toBeNull();
    expect(await removeAccount(db, 'ana', view)).toBe(true);
    for (const r of await history()) expect(r.total).toBe(1_000_000 - 6_000_000);
    expect(
      await db.query(
        `select count(*)::int as n from movement where account_id = $1 and voided_at is null`,
        [bank],
      ),
    ).toEqual([{ n: 1 }]);
  });
});
