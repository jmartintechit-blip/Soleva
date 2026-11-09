import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASSUMPTIONS_BP } from '#lib/engine/compound.ts';
import type { Db } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createPgliteDb } from './db/pglite.ts';
import { assumptionsInput, getSettings, saveAssumptions } from './settings.ts';

let db: Db;
beforeEach(async () => {
  db = createPgliteDb();
  await migrate(db);
  for (const id of ['ana', 'eva'])
    await db.query(
      `insert into "user" (id, name, email, "emailVerified") values ($1, '', $2, true)`,
      [id, `${id}@example.com`],
    );
});
afterEach(() => db.close());

describe('settings', () => {
  it('uses the defaults until saved, then keeps each user apart', async () => {
    const defaults = { ...ASSUMPTIONS_BP, rulesGrowth: null };
    expect(await getSettings(db, 'ana')).toEqual({ assumptions: defaults });
    const mine = { prudente: 200, base: 500, optimista: 700, inflation: 200, rulesGrowth: null };
    await saveAssumptions(db, 'ana', mine);
    expect(await getSettings(db, 'ana')).toEqual({ assumptions: mine });
    expect((await getSettings(db, 'eva')).assumptions).toEqual(defaults);
  });

  it('keeps «Tus ingresos y gastos» unless it is sent, and null follows the inflation', async () => {
    const a = { prudente: 300, base: 600, optimista: 800, inflation: 250 };
    await saveAssumptions(db, 'ana', { ...a, rulesGrowth: 400 });
    expect((await getSettings(db, 'ana')).assumptions.rulesGrowth).toBe(400);
    await saveAssumptions(db, 'ana', { ...a, inflation: 300 });
    expect((await getSettings(db, 'ana')).assumptions).toEqual({
      ...a,
      inflation: 300,
      rulesGrowth: 400,
    });
    await saveAssumptions(db, 'ana', { ...a, rulesGrowth: null });
    expect((await getSettings(db, 'ana')).assumptions.rulesGrowth).toBeNull();
    expect(assumptionsInput.safeParse({ ...a, rulesGrowth: 6000 }).success).toBe(false);
  });

  it('requires prudente ≤ base ≤ optimista', () => {
    const r = assumptionsInput.safeParse({
      prudente: 700,
      base: 600,
      optimista: 800,
      inflation: 250,
    });
    expect(r.error?.issues[0]?.message).toBe('Ordénalos: prudente ≤ base ≤ optimista');
  });
});
