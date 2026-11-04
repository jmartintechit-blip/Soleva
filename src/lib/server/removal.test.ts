import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAccount } from './alta.ts';
import type { Db } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createPgliteDb } from './db/pglite.ts';
import { saveAutoRule } from './auto-rules.ts';
import { readDebtForm, saveDebt } from './debts.ts';
import { runUser } from './engine-run.ts';
import { createGood } from './goods.ts';
import { createProperty, openMortgage } from './property.ts';
import { closeAccount, readCloseForm, removalView, removeAccount, undoClosing } from './removal.ts';

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
    expect(
      errors({ fecha: '2026-10-21', como: 'vendi', importe: '1', hipoteca: 'liquidar' }),
    ).toEqual({ fecha: 'No puede ser después de hoy' });
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
    // Sold, what it brought is always said, also without an account; for 0 €, it was not a sale.
    expect(errors({ fecha: '2026-10-10', como: 'vendi', hipoteca: 'mantener' })).toEqual({
      importe: 'Pon lo que te dieron',
    });
    expect(
      errors({ fecha: '2026-10-10', como: 'vendi', importe: '0', hipoteca: 'mantener' }),
    ).toEqual({ importe: 'Por 0 € no es una venta: elige «Ya no lo tengo»' });
    expect(
      readCloseForm(
        form({ fecha: '2026-10-10', como: 'vendi', importe: '9', hipoteca: 'mantener' }),
        view,
        '2026-10-20',
      ),
    ).toMatchObject({
      ok: true,
      input: { on: '2026-10-10', toAccountId: undefined, amountCents: 900 },
    });
    // Given away, any figure typed before is ignored.
    expect(
      readCloseForm(
        form({ fecha: '2026-10-10', como: 'ya_no', importe: '0', hipoteca: 'mantener' }),
        view,
        '2026-10-20',
      ),
    ).toMatchObject({ ok: true, input: { amountCents: undefined } });
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

  it('sold without an account: what it brought is that day’s gain, and leaves', async () => {
    const was = await history();
    await close(home, {
      fecha: '2026-10-10',
      como: 'vendi',
      importe: '210.000',
      hipoteca: 'mantener',
    });
    const now = await history();
    expect(before(now, '2026-10-10')).toEqual(before(was, '2026-10-10'));
    // The home (200.000 €) goes; 210.000 € leave as money taken out: 10.000 € made that day.
    expect(on(now, '2026-10-10')).toMatchObject({
      total: 1_000_000 - 6_000_000,
      flows: -21_000_000,
    });
    expect(
      on(now, '2026-10-10').total - on(now, '2026-10-09').total - on(now, '2026-10-10').flows,
    ).toBe(1_000_000);
    expect((await removalView(db, 'ana', home))!.closing).toMatchObject({
      soldCents: 21_000_000,
      worthCents: 20_000_000,
      main: null,
      undoable: true,
    });
  });

  it('on a past day: what it, its debt and its rules (IBI, insurance, rent) made after it is voided, and those rules stop', async () => {
    const laptop = (await createGood(db, 'ana', '2026-10-01', 'bien', {
      name: 'Portátil',
      category: 'electronica',
      purchaseCents: 180_000,
      purchasedOn: '2025-04-01',
      annualLossBp: 2500,
    })) as string;
    const rule = (name: string, kind: 'ingreso' | 'gasto', cents: number, about: string) =>
      saveAutoRule(db, 'ana', null, {
        name,
        kind,
        frequency: 'mensual',
        day: 5,
        startOn: '2026-10-02',
        endOn: null,
        fromAccountId: kind === 'gasto' ? bank : null,
        toAccountId: kind === 'ingreso' ? bank : null,
        amountCents: cents,
        assetAccountId: about,
      });
    const ibi = (await rule('IBI', 'gasto', 30_000, home))!;
    const rent = (await rule('Alquiler', 'ingreso', 80_000, home))!;
    const insurance = (await rule('Seguro del portátil', 'gasto', 2_000, laptop))!;
    // The mortgage gets its terms, so it has payments (interest and principal) every month.
    const read = readDebtForm(
      form({
        tipo: 'fijo',
        capital: '62.000',
        desde: '2025-10',
        anos: '25',
        tipo_fijo: '3',
        paga: bank,
        dia: '1',
        inmueble: home,
      }),
      '2026-10-01',
    );
    if (!read.ok) throw new Error(JSON.stringify(read.errors));
    expect(await saveDebt(db, 'ana', mortgage, '2026-10-01', read.input)).toBe(true);
    await db.query(`update engine_state set processed_through = '2026-10-01'`);
    await db.query(`delete from user_day`);
    await runUser(db, 'ana', '2026-11-20');
    const was = await history();
    const live = (where: string, params: unknown[]) =>
      db.query<{ day: string }>(
        `select day::text from movement where voided_at is null and ${where} order by day`,
        params,
      );
    expect((await live('rule_id = $1', [ibi])).map((m) => m.day)).toEqual([
      '2026-10-05',
      '2026-11-05',
    ]);
    expect(await live(`occurrence_key like $1`, [`debt:${mortgage}:2026-11-01:%`])).toHaveLength(3);

    expect(
      await close(home, { fecha: '2026-10-20', como: 'ya_no', hipoteca: 'liquidar' }, '2026-11-20'),
    ).toBe(true);
    const now = await history();
    expect(before(now, '2026-10-20')).toEqual(before(was, '2026-10-20'));
    // Its IBI and rent of November are gone; the laptop's insurance is not about the home.
    expect((await live('rule_id = $1', [ibi])).map((m) => m.day)).toEqual(['2026-10-05']);
    expect((await live('rule_id = $1', [rent])).map((m) => m.day)).toEqual(['2026-10-05']);
    expect((await live('rule_id = $1', [insurance])).map((m) => m.day)).toEqual([
      '2026-10-05',
      '2026-11-05',
    ]);
    // The mortgage paid off with it: its November payment (interest and principal) is gone.
    expect(await live(`occurrence_key like $1`, [`debt:${mortgage}:2026-11-01:%`])).toHaveLength(0);
    expect(
      await db.query(`select name, active from auto_rule where id = any($1) order by name`, [
        [ibi, rent, insurance],
      ]),
    ).toEqual([
      { name: 'Alquiler', active: false },
      { name: 'IBI', active: false },
      { name: 'Seguro del portátil', active: true },
    ]);
    // The laptop keeps losing value as before: a good's depreciation is its curve, not movements.
    expect(on(now, '2026-11-20').accounts[laptop]).toEqual(on(was, '2026-11-20').accounts[laptop]);
    await runUser(db, 'ana', '2026-12-06');
    expect((await live('rule_id = $1', [ibi])).map((m) => m.day)).toEqual(['2026-10-05']);
    expect(await live(`occurrence_key like $1`, [`debt:${mortgage}:2026-12-01:%`])).toHaveLength(0);
  });

  it('undone: it counts again from that day, with what was voided and what was skipped meanwhile', async () => {
    const ibi = (await saveAutoRule(db, 'ana', null, {
      name: 'IBI',
      kind: 'gasto',
      frequency: 'mensual',
      day: 5,
      startOn: '2026-10-02',
      endOn: null,
      fromAccountId: bank,
      toAccountId: null,
      amountCents: 30_000,
      assetAccountId: home,
    }))!;
    const read = readDebtForm(
      form({
        tipo: 'fijo',
        capital: '62.000',
        desde: '2025-10',
        anos: '25',
        tipo_fijo: '3',
        paga: bank,
        dia: '1',
        inmueble: home,
      }),
      '2026-10-01',
    );
    if (!read.ok) throw new Error(JSON.stringify(read.errors));
    await saveDebt(db, 'ana', mortgage, '2026-10-01', read.input);
    await db.query(`update engine_state set processed_through = '2026-10-01'`);
    await db.query(`delete from user_day`);
    await runUser(db, 'ana', '2026-11-20');
    const was = await history();
    const at = (rows: Day[], day: string) => on(rows, day).total;

    // Given up on 20 October (on 20 November); three weeks later, on 10 December, undone.
    await close(home, { fecha: '2026-10-20', como: 'ya_no', hipoteca: 'liquidar' }, '2026-11-20');
    await runUser(db, 'ana', '2026-12-10');
    const view = (await removalView(db, 'ana', mortgage))!;
    // The mortgage went with the home: undoing it undoes the home's baja.
    expect(view.closing).toMatchObject({
      main: { id: home, name: 'Piso de Écija' },
      undoable: true,
    });
    expect(await undoClosing(db, 'ana', mortgage)).toBe(true);
    await runUser(db, 'ana', '2026-12-10');

    const now = await history();
    // Every day it was given up says again what it said before.
    expect(now.filter((r) => r.day <= '2026-11-20')).toEqual(was);
    const live = (where: string, params: unknown[]) =>
      db.query<{ day: string; cents: number }>(
        `select day::text, amount_cents::float8 as cents from movement
         where voided_at is null and ${where} order by day`,
        params,
      );
    // What was voided is back, and what the engine skipped while it was given up is made now.
    expect((await live('rule_id = $1', [ibi])).map((m) => m.day)).toEqual([
      '2026-10-05',
      '2026-11-05',
      '2026-12-05',
    ]);
    for (const month of ['2026-11-01', '2026-12-01'])
      expect(
        await live(
          `occurrence_key like $1 or (replaces_id in (select id from movement
          where occurrence_key like $1))`,
          [`debt:${mortgage}:${month}:%`],
        ),
      ).toHaveLength(3);
    expect(await live(`note = 'baja'`, [])).toEqual([]);
    const [interest] = await live(`occurrence_key = $1`, [`debt:${mortgage}:2026-12-01:interes`]);
    expect(at(now, '2026-12-10')).toBe(at(was, '2026-11-20') - 30_000 + interest!.cents);
    expect(Object.keys(on(now, '2026-12-10').accounts).sort()).toEqual(
      [bank, home, mortgage].sort(),
    );
    expect(
      await db.query(
        `select closed_on, archived_at, closing from money_account where id = any($1)`,
        [[home, mortgage]],
      ),
    ).toEqual([
      { closed_on: null, archived_at: null, closing: null },
      { closed_on: null, archived_at: null, closing: null },
    ]);
    expect(await db.query(`select active from auto_rule where id = $1`, [ibi])).toEqual([
      { active: true },
    ]);
    expect(
      await db.query(`select mortgage_account_id as m from property where account_id = $1`, [home]),
    ).toEqual([{ m: mortgage }]);
  });

  it('undone after keeping the mortgage: it is linked to the home again', async () => {
    await close(home, { fecha: '2026-10-10', como: 'ya_no', hipoteca: 'mantener' });
    expect(
      await db.query(`select mortgage_account_id as m from property where account_id = $1`, [home]),
    ).toEqual([{ m: null }]);
    const was = await history();
    expect(await undoClosing(db, 'ana', home)).toBe(true);
    expect(
      await db.query(`select mortgage_account_id as m from property where account_id = $1`, [home]),
    ).toEqual([{ m: mortgage }]);
    const now = await history();
    expect(before(now, '2026-10-10')).toEqual(before(was, '2026-10-10'));
    for (const r of now) expect(r.total).toBe(15_000_000);
    // Only its owner, and only what was given up.
    expect(await undoClosing(db, 'ana', home)).toBe(false);
    expect(await undoClosing(db, 'eva', home)).toBe(false);
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
