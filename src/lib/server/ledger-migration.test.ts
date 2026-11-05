import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAccount, listAccounts, setArchived } from './accounts.ts';
import { amendClose, confirmClose, netWorthHistory } from './closes.ts';
import type { Db } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createPgliteDb } from './db/pglite.ts';
import { loadHome } from './home.ts';
import {
  CutOverMismatch,
  enterApp,
  migrateUserToLedger,
  rehearseCutOver,
} from './ledger-migration.ts';
import { createRule } from './rules.ts';

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

const base = { isEstimated: false, annualRateBp: 0 };
const TODAY = '2026-11-15';

// Net worth from the ledger: the plain sum of every account's movements.
const ledgerNet = async (userId: string) =>
  Number(
    (
      await db.query<{ n: string }>(
        `select coalesce(sum(m.amount_cents), 0)::text as n from movement m
         join money_account a on a.id = m.account_id where a.user_id = $1`,
        [userId],
      )
    )[0]!.n,
  );

describe('migrateUserToLedger', () => {
  it('loses nothing: balances, rules and closed months are the same after the cut-over', async () => {
    const cash = await createAccount(db, 'ana', {
      ...base,
      name: 'Banco',
      kind: 'efectivo',
      balanceCents: 200_037,
    });
    const fund = await createAccount(db, 'ana', {
      ...base,
      name: 'Fondo',
      kind: 'inversion',
      balanceCents: 1_000_000,
    });
    const loan = await createAccount(db, 'ana', {
      ...base,
      name: 'Préstamo',
      kind: 'deuda',
      balanceCents: 50_000,
    });
    const old = await createAccount(db, 'ana', {
      ...base,
      name: 'Vieja',
      kind: 'otro',
      balanceCents: 7_000,
    });
    await setArchived(db, 'ana', old, true);
    const rule = { day: 31, startMonth: '2026-01', active: true } as const;
    await createRule(db, 'ana', {
      ...rule,
      name: 'Nómina',
      type: 'entra',
      frequency: 'mensual',
      amountCents: 150_000,
      fromAccountId: undefined,
      toAccountId: cash,
    });
    await createRule(db, 'ana', {
      ...rule,
      name: 'Aportación',
      type: 'mueve',
      frequency: 'mensual',
      amountCents: 30_000,
      fromAccountId: cash,
      toAccountId: fund,
      endMonth: '2027-02',
    });
    await createRule(db, 'ana', {
      ...rule,
      name: 'Seguro',
      type: 'sale',
      frequency: 'una_vez',
      startMonth: '2027-02',
      amountCents: 40_000,
      fromAccountId: cash,
      toAccountId: undefined,
      active: false,
    });
    await confirmClose(db, 'ana', '2026-10', {
      [cash]: 200_037,
      [fund]: 1_000_000,
      [loan]: 50_000,
    });
    await amendClose(db, 'ana', '2026-10', cash, 199_000, 'Un recibo');
    await createAccount(db, 'eva', { ...base, name: 'De Eva', kind: 'efectivo', balanceCents: 1 });

    const accountsBefore = await listAccounts(db, 'ana');
    // As v0's Inicio: without the archived one.
    const net = accountsBefore.reduce(
      (s, a) => s + (a.archived ? 0 : a.kind === 'deuda' ? -a.balanceCents : a.balanceCents),
      0,
    );
    const history = await netWorthHistory(db, 'ana');

    expect(await migrateUserToLedger(db, 'ana', TODAY)).toBe(true);

    expect(await ledgerNet('ana')).toBe(net);
    expect(
      await db.query(
        `select a.name, a.kind, m.day::text as day, m.amount_cents::float8 as amount, m.source
         from movement m join money_account a on a.id = m.account_id
         where a.user_id = 'ana' order by a.created_at`,
      ),
    ).toEqual([
      { name: 'Banco', kind: 'efectivo', day: TODAY, amount: 199_000, source: 'migracion' },
      { name: 'Fondo', kind: 'broker', day: TODAY, amount: 1_000_000, source: 'migracion' },
      {
        name: 'Préstamo',
        kind: 'deuda_prestamo',
        day: TODAY,
        amount: -50_000,
        source: 'migracion',
      },
    ]);
    expect(
      await db.query(
        `select name, kind, frequency, day, start_on::text as "startOn", end_on::text as "endOn",
           amount_cents::float8 as amount, active
         from auto_rule order by name`,
      ),
    ).toEqual([
      {
        name: 'Aportación',
        kind: 'transferencia',
        frequency: 'mensual',
        day: 31,
        startOn: '2026-01-01',
        endOn: '2027-02-28',
        amount: 30_000,
        active: true,
      },
      {
        name: 'Nómina',
        kind: 'ingreso',
        frequency: 'mensual',
        day: 31,
        startOn: '2026-01-01',
        endOn: null,
        amount: 150_000,
        active: true,
      },
      {
        name: 'Seguro',
        kind: 'gasto',
        frequency: 'una_vez',
        day: null,
        startOn: '2027-02-28',
        endOn: null,
        amount: 40_000,
        active: false,
      },
    ]);
    // The closed month, with its amendment, is the same net worth in the new history.
    const [month] = await db.query<{ n: string }>(
      `select sum(value_cents)::text as n from account_month where month = '2026-10-01'`,
    );
    expect(Number(month!.n)).toBe(history[0]!.netCents);
    expect(
      await db.query(`select processed_through::text as d from engine_state where user_id = 'ana'`),
    ).toEqual([{ d: TODAY }]);

    // Twice is once, and nobody else is touched.
    expect(await migrateUserToLedger(db, 'ana', '2026-11-16')).toBe(false);
    expect(await ledgerNet('ana')).toBe(net);
    expect(await ledgerNet('eva')).toBe(0);
    expect(await db.query(`select 1 from auto_rule where user_id = 'eva'`)).toEqual([]);
  });
});

describe('enterApp', () => {
  // What Inicio shows: per account and in total, before (v0) and after (the ledger's last day).
  const v0Inicio = async (userId: string) => {
    const accounts = (await listAccounts(db, userId)).filter((a) => !a.archived);
    const byAccount = Object.fromEntries(
      accounts.map((a) => [a.id, a.kind === 'deuda' ? -a.balanceCents : a.balanceCents]),
    );
    return { byAccount, total: Object.values(byAccount).reduce((s, v) => s + v, 0) };
  };
  const ledgerInicio = async (userId: string) => {
    const home = await loadHome(db, userId);
    const last = home.rows.at(-1)!;
    return {
      byAccount: Object.fromEntries(
        home.accounts.map((a) => [a.id, last.accounts[a.id]?.[0] ?? 0]),
      ),
      total: last.total,
    };
  };

  it('moves a v0 user to the ledger with the same net worth, account by account and in total', async () => {
    const every = [
      ['Banco', 'efectivo', 200_037, false, 0],
      ['Remunerada', 'remunerada', 500_000, false, 250],
      ['Fondo', 'inversion', 1_200_000, false, 0],
      ['Plan', 'pension', 300_000, true, 0],
      ['Bitcoin', 'cripto', 45_678, true, 0],
      ['Piso', 'inmueble', 18_000_000, true, 0],
      ['Coche', 'vehiculo', 1_200_000, true, 0],
      ['Reloj', 'otro', 90_000, true, 0],
      ['Hipoteca', 'deuda', 9_000_000, false, 0],
      ['Vacía', 'efectivo', 0, false, 0],
    ] as const;
    const ids: string[] = [];
    for (const [name, kind, balanceCents, isEstimated, annualRateBp] of every)
      ids.push(
        await createAccount(db, 'ana', { name, kind, balanceCents, isEstimated, annualRateBp }),
      );
    const old = await createAccount(db, 'ana', {
      ...base,
      name: 'Vieja',
      kind: 'efectivo',
      balanceCents: 7_000,
    });
    await setArchived(db, 'ana', old, true);
    await createRule(db, 'ana', {
      name: 'Nómina',
      type: 'entra',
      frequency: 'mensual',
      day: 15,
      startMonth: '2026-01',
      active: true,
      amountCents: 150_000,
      fromAccountId: undefined,
      toAccountId: ids[0],
    });
    await confirmClose(db, 'ana', '2026-10', { [ids[0]!]: 200_037, [ids[8]!]: 9_000_000 });
    await createAccount(db, 'eva', { ...base, name: 'De Eva', kind: 'efectivo', balanceCents: 1 });

    const before = await v0Inicio('ana');

    expect(await enterApp(db, 'ana', TODAY)).toBe('migrado');
    expect(await ledgerInicio('ana')).toEqual(before);
    // The archived account stays out of net worth, and keeps its balance in Cuentas.
    expect((await listAccounts(db, 'ana')).find((a) => a.id === old)).toMatchObject({
      archived: true,
      balanceCents: 7_000,
    });
    // The rule does not repeat today's pay, which the balance already holds.
    expect(
      await db.query(`select 1 from movement where source = 'regla' and day <= $1`, [TODAY]),
    ).toEqual([]);

    // Once: the second visit does nothing; the next day the run catches up, rules included.
    expect(await enterApp(db, 'ana', TODAY)).toBe('al-dia');
    expect(await ledgerInicio('ana')).toEqual(before);
    expect(await enterApp(db, 'ana', '2026-12-16')).toBe('puesto-al-dia');
    expect(
      await db.query(`select processed_through::text as d from engine_state where user_id = 'ana'`),
    ).toEqual([{ d: '2026-12-16' }]);
    expect((await ledgerInicio('ana')).byAccount[ids[0]!]).toBe(200_037 + 150_000);
    // Nobody else is touched.
    expect(await db.query(`select 1 from engine_state where user_id = 'eva'`)).toEqual([]);
  });

  it('a new user with nothing yet goes to the ledger at zero', async () => {
    expect(await enterApp(db, 'eva', TODAY)).toBe('migrado');
    expect(await loadHome(db, 'eva')).toMatchObject({ accounts: [] });
  });

  it('if anything would not add up, changes nothing and the user stays on v0', async () => {
    const cash = await createAccount(db, 'ana', {
      ...base,
      name: 'Banco',
      kind: 'efectivo',
      balanceCents: 100_000,
    });
    // A stray movement from before: the ledger would say 100.050 € where v0 says 100.000 €.
    await db.query(
      `insert into movement (account_id, day, kind, amount_cents, source) values ($1, $2, 'ajuste', 5000, 'manual')`,
      [cash, '2026-11-01'],
    );
    const error = await enterApp(db, 'ana', TODAY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CutOverMismatch);
    expect((error as CutOverMismatch).diffs).toEqual([
      { account: cash, before: 100_000, after: 105_000 },
      { account: 'total', before: 100_000, after: 105_000 },
    ]);
    expect(await db.query(`select 1 from engine_state`)).toEqual([]);
    expect(await db.query(`select 1 from user_day`)).toEqual([]);
    expect(await db.query(`select count(*)::int as n from movement`)).toEqual([{ n: 1 }]);
  });

  it('rehearses every v0 user without writing anything', async () => {
    await createAccount(db, 'ana', { ...base, name: 'Banco', kind: 'efectivo', balanceCents: 100 });
    const loan = await createAccount(db, 'eva', {
      ...base,
      name: 'Préstamo',
      kind: 'deuda',
      balanceCents: 300,
    });
    expect(await rehearseCutOver(db, TODAY)).toEqual([
      { accounts: 1, total: 100, diffs: [] },
      { accounts: 1, total: -300, diffs: [] },
    ]);
    for (const table of ['engine_state', 'movement', 'user_day', 'account_month', 'auto_rule'])
      expect(await db.query(`select 1 from ${table}`)).toEqual([]);
    expect((await listAccounts(db, 'eva'))[0]).toMatchObject({ id: loan, kind: 'deuda' });
    // A user already on the ledger is not rehearsed.
    await enterApp(db, 'ana', TODAY);
    expect(await rehearseCutOver(db, TODAY)).toEqual([{ accounts: 1, total: -300, diffs: [] }]);
  });
});
