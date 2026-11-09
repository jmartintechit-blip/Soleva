import { expect, test } from '@playwright/test';
import { openAccount } from '../src/lib/server/alta.ts';
import { createNeonDb } from '../src/lib/server/db/index.ts';
import { runUser } from '../src/lib/server/engine-run.ts';
import { migrateUserToLedger } from '../src/lib/server/ledger-migration.ts';
import { today } from '../src/lib/server/today.ts';
import { EMAIL, hydrated, resetUser, signIn, sql } from './auth.ts';

test('Reglas on the ledger: a transfer with what it means, changed, paused', async ({ page }) => {
  test.setTimeout(90_000);
  await resetUser();
  await signIn(page);
  const [{ id }] = await sql()`select id from "user" where email = ${EMAIL}`;
  const db = createNeonDb(process.env.DATABASE_URL!);
  try {
    await migrateUserToLedger(db, id, today());
    await openAccount(db, id, today(), { name: 'Bankinter', kind: 'efectivo', cents: 300_000 });
    await openAccount(db, id, today(), { name: 'Trade Republic', kind: 'broker', cents: 0 });
    await runUser(db, id, today());
  } finally {
    await db.close();
  }

  await page.goto('/reglas');
  await hydrated(page);
  await page.getByRole('link', { name: 'Nueva regla' }).click();
  await hydrated(page);
  await page.getByLabel('Nombre').fill('Al bróker');
  await page.getByLabel('Importe').fill('1.500');
  await page.locator('select[name="to"]').selectOption({ label: 'Trade Republic' });
  await page.locator('select[name="day"]').selectOption('1');
  await expect(
    page.getByText(
      'No cambia tu patrimonio: mueve dinero entre tus cuentas. Bankinter baja y Trade Republic sube el día 1.',
    ),
  ).toBeVisible();
  await page.getByText('Gasto o cuota').click();
  await expect(
    page.getByText(/^Resta 1\.500 € al mes\. Bankinter tiene saldo para 2 meses/),
  ).toBeVisible();
  await page.getByText('Transferencia').click();
  await page.getByRole('button', { name: 'Crear regla' }).click();

  await expect(page).toHaveURL(/\/reglas\?creada$/);
  await expect(page.getByRole('link', { name: /Al bróker/ })).toContainText(
    'Transferencia · el día 1 · Bankinter → Trade Republic',
  );
  await page.getByRole('link', { name: /Al bróker/ }).click();
  await hydrated(page);
  await page.getByLabel('Importe').fill('2.000');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page).toHaveURL(/\/reglas$/);
  await expect(page.locator('.sv-row__value').first()).toContainText('2.000 €');
  await page.getByRole('switch', { name: 'Al bróker: activa' }).click();
  await expect(page.getByRole('switch', { name: 'Al bróker: en pausa' })).toBeVisible();
});
