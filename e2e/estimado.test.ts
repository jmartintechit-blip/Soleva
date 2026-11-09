import { expect, test } from '@playwright/test';
import { openAccount } from '../src/lib/server/alta.ts';
import { createNeonDb } from '../src/lib/server/db/index.ts';
import { migrateUserToLedger } from '../src/lib/server/ledger-migration.ts';
import { today } from '../src/lib/server/today.ts';
import { EMAIL, hydrated, resetUser, signIn, sql } from './auth.ts';

test('REstimado: a product without a public price, from Añadir producto and from the Alta', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await resetUser();
  await signIn(page);
  const [{ id }] = await sql()`select id from "user" where email = ${EMAIL}`;
  const db = createNeonDb(process.env.DATABASE_URL!);
  let broker: string;
  try {
    await migrateUserToLedger(db, id, today());
    broker = await openAccount(db, id, today(), {
      name: 'Trade Republic',
      kind: 'broker',
      cents: 50_000,
    });
  } finally {
    await db.close();
  }

  // From Añadir producto: the link keeps the account.
  await page.goto(`/cuentas/${broker}/producto`);
  await page.getByRole('link', { name: /Añade un producto sin precio público/ }).click();
  await expect(page).toHaveURL(new RegExp(`/cuentas/nueva/estimado\\?cuenta=${broker}$`));
  await hydrated(page);
  await expect(page.getByText('Trade Republic')).toBeVisible();
  await page.getByLabel('Nombre').fill('Private markets · EQT');
  await page.getByLabel('Invertiste').fill('300');
  await page.locator('input[name="desde"]').fill(today().slice(0, 7));
  await page.getByLabel('Rentabilidad al año que estimas').fill('12');
  // This month: what was put in, give or take a few days of growth.
  await expect(page.locator('.hero')).toHaveText(/^30\d,\d\d €|^300 €$/);
  await expect(page.getByText(/^En un año, si se cumple: /)).toBeVisible();
  await page.getByRole('button', { name: 'Añadir a la cuenta' }).click();

  // On the account, as an estimate.
  await expect(page).toHaveURL(new RegExp(`/cuentas/${broker}$`));
  await expect(
    page.getByRole('region', { name: 'Posiciones' }).getByText('Private markets · EQT'),
  ).toBeVisible();
  await expect(page.getByText(/Estimación · 12 % anual que pusiste tú/)).toBeVisible();

  // From the Alta, and back there.
  await page.goto('/alta');
  await hydrated(page);
  await page.getByRole('link', { name: /Sin precio público/ }).click();
  await expect(page).toHaveURL(/\/cuentas\/nueva\/estimado\?volver=alta$/);
  await hydrated(page);
  await page.getByLabel('Nombre').fill('Crowdfunding');
  await page.getByLabel('Invertiste').fill('1.000');
  await page.getByRole('button', { name: 'Añadir a la cuenta' }).click();
  await expect(page).toHaveURL(/\/alta$/);
  // 500 € of cash, 300 € and 1.000 € at 0 %.
  await expect(page.getByRole('link', { name: /^Trade Republic/ })).toContainText(/1\.80\d/);
});
