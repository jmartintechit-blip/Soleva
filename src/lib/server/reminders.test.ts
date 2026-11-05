import { afterEach, beforeEach, expect, it } from 'vitest';
import { createAccount } from './accounts.ts';
import { confirmClose } from './closes.ts';
import type { Db } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { createPgliteDb } from './db/pglite.ts';
import type { Email } from './email.ts';
import { sendReminders } from './reminders.ts';

let db: Db;
let sent: Email[];
const run = (today: string) =>
  sendReminders(db, today, 'https://solevaapp.com', async (e) => {
    sent.push(e);
  });

beforeEach(async () => {
  db = createPgliteDb();
  await migrate(db);
  sent = [];
  for (const id of ['ana', 'eva', 'leo'])
    await db.query(
      `insert into "user" (id, name, email, "emailVerified") values ($1, '', $2, true)`,
      [id, `${id}@example.com`],
    );
  const account = {
    kind: 'efectivo',
    isEstimated: false,
    annualRateBp: 0,
    balanceCents: 100,
  } as const;
  await createAccount(db, 'ana', { ...account, name: 'Banco' });
  await createAccount(db, 'eva', { ...account, name: 'Banco' });
  // leo has no accounts: nothing to close.
});
afterEach(() => db.close());

it('reminds on the chosen day, once per open month, and respects the switch', async () => {
  expect(await run('2026-11-02')).toBe(0);
  expect(await run('2026-11-01')).toBe(2);
  expect(sent.map((e) => e.to).sort()).toEqual(['ana@example.com', 'eva@example.com']);
  expect(sent[0]!.subject).toBe('Cierra octubre en Soleva');
  expect(sent[0]!.text).toContain('https://solevaapp.com/cierre');
  expect(await run('2026-11-01')).toBe(0);

  // Next month: ana closed November already, eva turned it off.
  await confirmClose(db, 'ana', '2026-11', {});
  await db.query(`update settings set reminder_enabled = false where user_id = 'eva'`);
  expect(await run('2026-12-01')).toBe(0);

  // A later day of her choosing reminds about the current month.
  await db.query(`update settings set reminder_day = 28 where user_id = 'ana'`);
  expect(await run('2026-12-28')).toBe(1);
  expect(sent.at(-1)!.subject).toBe('Cierra diciembre en Soleva');
});

it('on the ledger: «Cuadra tus cuentas», to Cuentas, once in each month on the chosen day', async () => {
  await db.query(
    `insert into engine_state (user_id, processed_through) values ('ana', '2026-11-01')`,
  );
  expect(await run('2026-11-01')).toBe(2);
  const ana = sent.find((e) => e.to === 'ana@example.com')!;
  expect(ana.subject).toBe('Cuadra tus cuentas en Soleva');
  expect(ana.text).toContain('https://solevaapp.com/cuentas');
  expect(ana.text).not.toContain('/cierre');
  expect(sent.find((e) => e.to === 'eva@example.com')!.subject).toBe('Cierra octubre en Soleva');
  expect(await run('2026-11-01')).toBe(0);
  // The next month, again (the ledger has no month left to close that would hold it back).
  expect(await run('2026-12-01')).toBe(2);
  expect(sent.slice(-2).find((e) => e.to === 'ana@example.com')!.subject).toBe(
    'Cuadra tus cuentas en Soleva',
  );
});
