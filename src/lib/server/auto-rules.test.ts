import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAccount } from './alta.ts';
import {
  deleteAutoRule,
  getAutoRule,
  listAutoRules,
  readRuleForm,
  ruleAccounts,
  saveAutoRule,
  setAutoActive,
} from './auto-rules.ts';
import type { Db } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createPgliteDb } from './db/pglite.ts';
import { runUser } from './engine-run.ts';

let db: Db;
let bank: string;
let broker: string;
let hers: string;
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
  bank = await openAccount(db, 'ana', '2026-10-31', {
    name: 'Bankinter',
    kind: 'efectivo',
    cents: 300_000,
  });
  broker = await openAccount(db, 'ana', '2026-10-31', { name: 'Bróker', kind: 'broker', cents: 0 });
  hers = await openAccount(db, 'eva', '2026-10-31', { name: 'Suya', kind: 'efectivo', cents: 1 });
});
afterEach(() => db.close());

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe('auto rules', () => {
  it('reads RRegla: from today with no end, the day by frequency, only the accounts its kind uses', () => {
    expect(
      readRuleForm(
        form({
          tipo: 'transferencia',
          name: 'Al bróker',
          amount: '1.500',
          from: 'a',
          to: 'b',
          frequency: 'mensual',
          day: '1',
        }),
        '2026-11-01',
      ),
    ).toMatchObject({
      ok: true,
      input: {
        kind: 'transferencia',
        day: 1,
        startOn: '2026-11-01',
        endOn: null,
        amountCents: 150_000,
      },
    });
    // An income has no «from», whatever came in it.
    expect(
      readRuleForm(
        form({
          tipo: 'ingreso',
          name: 'Nómina',
          amount: '1400',
          from: 'a',
          to: 'b',
          frequency: 'semanal',
          day: '5',
        }),
        '2026-11-01',
      ),
    ).toMatchObject({ ok: true, input: { fromAccountId: null, toAccountId: 'b', day: 5 } });
    expect(
      readRuleForm(
        form({
          tipo: 'gasto',
          name: 'IBI',
          amount: '310',
          from: 'a',
          frequency: 'una_vez',
          day: '2026-11-20',
        }),
        '2026-11-01',
      ),
    ).toMatchObject({ ok: true, input: { day: null, startOn: '2026-11-20', endOn: null } });
    const bad = readRuleForm(
      form({
        tipo: 'transferencia',
        name: '',
        amount: '0',
        from: 'a',
        to: 'a',
        frequency: 'semanal',
        day: '8',
        start: '2026-11-01',
        end: '2026-10-01',
      }),
      '2026-11-01',
    );
    expect(bad.ok ? {} : bad.errors).toEqual({
      name: 'Ponle un nombre (hasta 60 letras)',
      amount: 'Escribe un importe, por ejemplo 1.500',
      day: 'Elige el día',
      end: 'La fecha de fin va después del inicio',
      to: 'Elige otra cuenta',
    });
  });

  it('creates, changes, pauses and deletes the user’s own; another’s account is refused', async () => {
    const rule = {
      name: 'Al bróker',
      kind: 'transferencia' as const,
      frequency: 'mensual' as const,
      day: 1,
      startOn: '2026-11-01',
      endOn: null,
      fromAccountId: bank,
      toAccountId: broker,
      amountCents: 150_000,
    };
    const id = (await saveAutoRule(db, 'ana', null, rule))!;
    await runUser(db, 'ana', '2026-11-01');
    expect(
      await db.query(`select count(*)::int as n from movement where rule_id = $1`, [id]),
    ).toEqual([{ n: 2 }]);
    expect(await saveAutoRule(db, 'ana', null, { ...rule, toAccountId: hers })).toBeNull();
    // Nor be about someone else's home, car or good.
    expect(await saveAutoRule(db, 'ana', null, { ...rule, assetAccountId: hers })).toBeNull();
    expect(await saveAutoRule(db, 'eva', id, rule)).toBeNull();
    expect(await saveAutoRule(db, 'ana', id, { ...rule, amountCents: 200_000 })).toBe(id);
    expect(await getAutoRule(db, 'ana', id)).toMatchObject({ amountCents: 200_000, active: true });
    expect(await getAutoRule(db, 'eva', id)).toBeNull();
    expect(await setAutoActive(db, 'eva', id, false)).toBe(false);
    expect(await setAutoActive(db, 'ana', id, false)).toBe(true);
    expect((await listAutoRules(db, 'ana')).map((r) => [r.name, r.active])).toEqual([
      ['Al bróker', false],
    ]);
    // With movements it cannot go: it is paused; one that did nothing yet can.
    expect(await deleteAutoRule(db, 'eva', id)).toBe(false);
    expect(await deleteAutoRule(db, 'ana', id)).toBe('historial');
    const later = (await saveAutoRule(db, 'ana', null, { ...rule, startOn: '2027-01-01' }))!;
    expect(await deleteAutoRule(db, 'ana', later)).toBe(true);
  });

  it('offers the user’s cash accounts with today’s value', async () => {
    await openAccount(db, 'ana', '2026-10-31', {
      name: 'Hipoteca',
      kind: 'deuda_hipoteca',
      cents: 100,
    });
    await runUser(db, 'ana', '2026-11-01');
    expect(await ruleAccounts(db, 'ana')).toEqual([
      { id: bank, name: 'Bankinter', kind: 'efectivo', cents: 300_000 },
      { id: broker, name: 'Bróker', kind: 'broker', cents: 0 },
    ]);
  });
});
