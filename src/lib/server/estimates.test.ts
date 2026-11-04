import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAccountView } from './account-view.ts';
import { openAccount } from './alta.ts';
import type { Db } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createPgliteDb } from './db/pglite.ts';
import { runUser } from './engine-run.ts';
import { addEstimate, estimateAccounts, readEstimateForm } from './estimates.ts';
import { migrateUserToLedger } from './ledger-migration.ts';

let db: Db;
beforeEach(async () => {
  db = createPgliteDb();
  await migrate(db);
  for (const id of ['ana', 'eva'])
    await db.query(
      `insert into "user" (id, name, email, "emailVerified") values ($1, '', $2, true)`,
      [id, `${id}@x.es`],
    );
});
afterEach(() => db.close());

const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};

describe('estimates', () => {
  it('reads the form, and refuses what does not fit', () => {
    expect(
      readEstimateForm(
        form({
          cuenta: 'b',
          name: 'Private markets · EQT',
          invertido: '300',
          desde: '2026-03',
          rentabilidad: '12',
        }),
        '2026-11-04',
      ),
    ).toMatchObject({
      ok: true,
      input: { accountId: 'b', investedCents: 30_000, since: '2026-03-01', rateBp: 1200 },
    });
    // No rate is 0 %, the most prudent.
    expect(
      readEstimateForm(
        form({ cuenta: 'b', name: 'X', invertido: '300', desde: '2026-03' }),
        '2026-11-04',
      ),
    ).toMatchObject({ ok: true, input: { rateBp: 0 } });
    expect(
      readEstimateForm(
        form({ name: '', invertido: '0', desde: '2026-12', rentabilidad: '150' }),
        '2026-11-04',
      ),
    ).toMatchObject({
      ok: false,
      errors: {
        cuenta: expect.any(String),
        name: expect.any(String),
        invertido: expect.any(String),
        desde: expect.any(String),
        rentabilidad: expect.any(String),
      },
    });
  });

  it('adds it as already held: cash stays, it grows from the month it was bought', async () => {
    await migrateUserToLedger(db, 'ana', '2026-11-04');
    const broker = await openAccount(db, 'ana', '2026-11-04', {
      name: 'Trade Republic',
      kind: 'broker',
      cents: 50_000,
    });
    const bank = await openAccount(db, 'ana', '2026-11-04', {
      name: 'Banco',
      kind: 'efectivo',
      cents: 100,
    });
    const hers = await openAccount(db, 'eva', '2026-11-04', {
      name: 'Suyo',
      kind: 'broker',
      cents: 100,
    });
    expect((await estimateAccounts(db, 'ana')).map((a) => a.id)).toEqual([broker]);
    const e = {
      name: 'Private markets · EQT',
      investedCents: 30_000,
      since: '2026-03-01' as const,
      rateBp: 1200,
    };
    expect(await addEstimate(db, 'ana', '2026-11-04', { ...e, accountId: bank })).toBeNull();
    expect(await addEstimate(db, 'ana', '2026-11-04', { ...e, accountId: hers })).toBeNull();
    expect(await addEstimate(db, 'ana', '2026-11-04', { ...e, accountId: broker })).toBeTruthy();
    await runUser(db, 'ana', '2026-11-04');

    const today = Math.round(30_000 * 1.12 ** (248 / 365));
    const view = (await loadAccountView(db, 'ana', broker, '2026-11-04'))!;
    expect(view.positions).toMatchObject([
      {
        name: 'Private markets · EQT',
        estimate: true,
        valueCents: today,
        gainCents: today - 30_000,
      },
    ]);
    expect(view.value).toBe(50_000 + today);
    const [day] = await db.query<{ total: number; flows: number }>(
      `select total_cents::float8 as total, flows_cents::float8 as flows from user_day
       where user_id = 'ana' order by day desc limit 1`,
    );
    // All of it came in today: nothing was made today.
    expect(day).toEqual({ total: 50_000 + 100 + today, flows: 50_000 + 100 + today });
    // The refused ones left nothing behind.
    expect(await db.query(`select count(*)::int as n from instrument`)).toEqual([{ n: 1 }]);
  });
});
