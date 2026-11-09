import { expect, test } from '@playwright/test';
import { openAccount } from '../src/lib/server/alta.ts';
import { createNeonDb } from '../src/lib/server/db/index.ts';
import { runUser } from '../src/lib/server/engine-run.ts';
import { migrateUserToLedger } from '../src/lib/server/ledger-migration.ts';
import { today } from '../src/lib/server/today.ts';
import { EMAIL, hydrated, resetUser, signIn, sql } from './auth.ts';

test('RRemunerada: the period interest, then its tiers and how it pays', async ({ page }) => {
  test.setTimeout(90_000);
  await resetUser();
  await signIn(page);
  const [{ id }] = await sql()`select id from "user" where email = ${EMAIL}`;
  const db = createNeonDb(process.env.DATABASE_URL!);
  let bank: string;
  try {
    await migrateUserToLedger(db, id, today());
    bank = await openAccount(db, id, today(), {
      name: 'Bankinter',
      kind: 'remunerada',
      cents: 3_824_015,
      rateBp: 200,
    });
    await runUser(db, id, today());
  } finally {
    await db.close();
  }

  await page.goto(`/cuentas/${bank}`);
  await page.getByRole('link', { name: 'Intereses' }).first().click();
  await hydrated(page);
  await expect(page.getByText(/sobre el saldo de cada día/)).toBeVisible();
  await expect(page.getByText('Retención (19 %)')).toBeVisible();
  await expect(page.getByText('Todo el saldo')).toBeVisible();

  await page.getByRole('button', { name: '+ Añadir tramo' }).click();
  await page.getByLabel('Tramo 1: hasta (€)').fill('50.000');
  await page.getByLabel('Tramo 1: interés anual (%)').fill('2');
  await page.getByLabel('Tramo 2: interés anual (%)').fill('0');
  await expect(page.getByText('Lo que pase de 50.000 €')).toBeVisible();
  await page.getByLabel('Día de pago').selectOption('1');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(/Netos · se pagan el 1 /)).toBeVisible();
  await expect(page.getByLabel('Tramo 1: hasta (€)')).toHaveValue('50.000');
});
