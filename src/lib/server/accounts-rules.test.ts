import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountInput,
  MAX_CENTS,
  accountInput,
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  setArchived,
  updateAccount,
} from './accounts.ts';
import type { Db } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createPgliteDb } from './db/pglite.ts';
import {
  type RuleInput,
  createRule,
  deleteRule,
  getRule,
  listRules,
  ruleInput,
  setActive,
  updateRule,
} from './rules.ts';

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

const cash: AccountInput = {
  name: 'Banco',
  kind: 'efectivo',
  balanceCents: 125_050,
  isEstimated: false,
  annualRateBp: 0,
};
const fund: AccountInput = { ...cash, name: 'Indexado', kind: 'inversion', annualRateBp: 600 };
const saving = (from: string, to: string): RuleInput => ({
  name: 'Ahorro',
  type: 'mueve',
  amountCents: 30_000,
  frequency: 'mensual',
  day: 31,
  startMonth: '2026-11',
  fromAccountId: from,
  toAccountId: to,
  active: true,
});

describe('accounts', () => {
  it('creates, reads back in cents, edits, archives and deletes', async () => {
    const id = await createAccount(db, 'ana', cash);
    expect(await getAccount(db, 'ana', id)).toEqual({
      id,
      ...cash,
      archived: false,
      closedOn: null,
    });
    await updateAccount(db, 'ana', id, { ...cash, balanceCents: MAX_CENTS });
    expect((await getAccount(db, 'ana', id))!.balanceCents).toBe(MAX_CENTS);
    expect(await setArchived(db, 'ana', id, true)).toBe(true);
    expect((await listAccounts(db, 'ana'))[0]!.archived).toBe(true);
    expect(await deleteAccount(db, 'ana', id)).toBe(true);
    expect(await listAccounts(db, 'ana')).toEqual([]);
  });

  it("never reads or touches another user's account (404)", async () => {
    const id = await createAccount(db, 'ana', cash);
    expect(await getAccount(db, 'eva', id)).toBeNull();
    expect(await listAccounts(db, 'eva')).toEqual([]);
    expect(await updateAccount(db, 'eva', id, fund)).toBe(false);
    expect(await setArchived(db, 'eva', id, true)).toBe(false);
    expect(await deleteAccount(db, 'eva', id)).toBe(false);
    expect(await getAccount(db, 'ana', 'not-a-uuid')).toBeNull();
    expect(await getAccount(db, 'ana', id)).toMatchObject({ name: 'Banco', archived: false });
  });

  it('goes through account_access: the owner row comes alone, and roles limit what others do', async () => {
    const id = await createAccount(db, 'ana', cash);
    expect(
      await db.query(`select user_id, role from account_access where account_id = $1`, [id]),
    ).toEqual([{ user_id: 'ana', role: 'propietario' }]);
    // A second owner is refused: the owner is the one whose deletion takes the account.
    await expect(
      db.query(`insert into account_access values ($1, 'eva', 'propietario')`, [id]),
    ).rejects.toThrow();

    await db.query(`insert into account_access values ($1, 'eva', 'lector')`, [id]);
    expect(await getAccount(db, 'eva', id)).toMatchObject({ name: 'Banco' });
    expect(await updateAccount(db, 'eva', id, fund)).toBe(false);
    await db.query(`update account_access set role = 'editor' where user_id = 'eva'`);
    expect(await updateAccount(db, 'eva', id, fund)).toBe(true);
    expect(await deleteAccount(db, 'eva', id)).toBe(false);
    expect(await deleteAccount(db, 'ana', id)).toBe(true);
    expect(await db.query(`select 1 from account_access`)).toEqual([]);
  });

  it('validates input with messages in Spanish', () => {
    expect(accountInput.safeParse(cash).success).toBe(true);
    const bad = accountInput.safeParse({ ...cash, name: ' ', balanceCents: -1 });
    expect(bad.error?.issues.map((i) => i.message)).toEqual([
      'Ponle un nombre',
      'No puede ser negativo',
    ]);
  });

  it('the database refuses negative balances and unknown kinds', async () => {
    await expect(createAccount(db, 'ana', { ...cash, balanceCents: -1 })).rejects.toThrow();
    await expect(createAccount(db, 'ana', { ...cash, kind: 'otra' as 'otro' })).rejects.toThrow();
  });
});

describe('rules', () => {
  it('creates, reads back in engine shape, edits, pauses and deletes', async () => {
    const [a, b] = [await createAccount(db, 'ana', cash), await createAccount(db, 'ana', fund)];
    const id = (await createRule(db, 'ana', saving(a, b)))!;
    expect(await getRule(db, 'ana', id)).toEqual({ id, ...saving(a, b) });
    const income: RuleInput = {
      ...saving(a, b),
      type: 'entra',
      fromAccountId: undefined,
      endMonth: '2027-12',
    };
    expect(await updateRule(db, 'ana', id, income)).toBe(true);
    expect(await getRule(db, 'ana', id)).toEqual({ id, ...income, fromAccountId: undefined });
    expect(await setActive(db, 'ana', id, false)).toBe(true);
    expect((await listRules(db, 'ana'))[0]!.active).toBe(false);
    expect(await deleteRule(db, 'ana', id)).toBe(true);
    expect(await listRules(db, 'ana')).toEqual([]);
  });

  it("never reads or touches another user's rule (404)", async () => {
    const [a, b] = [await createAccount(db, 'ana', cash), await createAccount(db, 'ana', fund)];
    const id = (await createRule(db, 'ana', saving(a, b)))!;
    expect(await getRule(db, 'eva', id)).toBeNull();
    expect(await listRules(db, 'eva')).toEqual([]);
    expect(await updateRule(db, 'eva', id, saving(a, b))).toBe(false);
    expect(await setActive(db, 'eva', id, false)).toBe(false);
    expect(await deleteRule(db, 'eva', id)).toBe(false);
    expect((await getRule(db, 'ana', id))!.active).toBe(true);
  });

  it("cannot point at another user's accounts, even with the right id", async () => {
    const mine = await createAccount(db, 'eva', cash);
    const [a, b] = [await createAccount(db, 'ana', cash), await createAccount(db, 'ana', fund)];
    expect(await createRule(db, 'eva', saving(mine, b))).toBeNull();
    const id = (await createRule(db, 'ana', saving(a, b)))!;
    expect(await updateRule(db, 'ana', id, saving(a, mine))).toBe(false);
    expect(await listRules(db, 'eva')).toEqual([]);
  });

  it('goes away with its account', async () => {
    const [a, b] = [await createAccount(db, 'ana', cash), await createAccount(db, 'ana', fund)];
    await createRule(db, 'ana', saving(a, b));
    await deleteAccount(db, 'ana', b);
    expect(await listRules(db, 'ana')).toEqual([]);
  });

  it('validates each type needs its accounts, and drops the unused side', () => {
    const msgs = (r: unknown) => ruleInput.safeParse(r).error?.issues.map((i) => i.message);
    expect(msgs({ ...saving('a', 'a') })).toEqual(['Elige dos cuentas distintas']);
    expect(msgs({ ...saving('a', 'b'), type: 'sale', fromAccountId: undefined })).toEqual([
      'Elige de qué cuenta sale',
    ]);
    expect(msgs({ ...saving('a', 'b'), endMonth: '2026-10' })).toEqual([
      'Termina antes de empezar',
    ]);
    expect(msgs({ ...saving('a', 'b'), day: 32, startMonth: '2026-13' })).toEqual([
      'Día entre 1 y 31',
      'Mes no válido',
    ]);
    expect(ruleInput.parse({ ...saving('a', 'b'), type: 'sale' }).toAccountId).toBeUndefined();
  });

  it('the database refuses rules whose accounts do not fit their type', async () => {
    const a = await createAccount(db, 'ana', cash);
    await expect(createRule(db, 'ana', { ...saving(a, a), type: 'mueve' })).rejects.toThrow();
    await expect(
      createRule(db, 'ana', { ...saving(a, a), type: 'entra', toAccountId: undefined }),
    ).rejects.toThrow();
  });
});
