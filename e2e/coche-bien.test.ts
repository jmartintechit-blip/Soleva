import { expect, test } from '@playwright/test';
import { createNeonDb } from '../src/lib/server/db/index.ts';
import { migrateUserToLedger } from '../src/lib/server/ledger-migration.ts';
import { today } from '../src/lib/server/plan.ts';
import { EMAIL, hydrated, resetUser, signIn, sql } from './auth.ts';

// Needs Hacienda's tables in the database (npm run hacienda): the CI's branch is a copy of dev.
test('RCoche and RBien from the Alta: by Hacienda’s table, by its yearly loss, by hand', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await resetUser();
  await signIn(page);
  const [{ id }] = await sql()`select id from "user" where email = ${EMAIL}`;
  const db = createNeonDb(process.env.DATABASE_URL!);
  try {
    await migrateUserToLedger(db, id, today());
  } finally {
    await db.close();
  }

  await page.goto('/alta');
  await hydrated(page);
  await page.getByRole('link', { name: /Coche o moto/ }).click();
  await expect(page).toHaveURL(/\/cuentas\/nueva\/coche\?volver=alta$/);
  await hydrated(page);
  await page.getByLabel('Busca la marca y el modelo').fill('mazda 3');
  await page.locator('button.found').first().click();
  await page.locator('input[name="matriculacion"]').fill('2013-05-10');
  await page.locator('input[name="matriculacion"]').dispatchEvent('change');
  await expect(page.getByText(/^Valor de Hacienda: /)).toBeVisible();
  // The title is the user's name for it, not Hacienda's model in capitals.
  await page.getByLabel('Nombre').fill('El Mazda');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('El Mazda');
  // «Usar mi valor» off still shows its edge.
  const edge = await page
    .getByRole('switch', { name: /Usar mi valor/ })
    .evaluate((e) => getComputedStyle(e).boxShadow);
  expect(edge).toContain('inset');
  await page.getByRole('button', { name: 'Añadir coche' }).click();
  await expect(page).toHaveURL(/\/alta$/);
  await expect(page.getByText('Vehículo')).toBeVisible();

  await page.getByRole('link', { name: /Otro bien/ }).click();
  await hydrated(page);
  await page.getByLabel('Nombre').fill('Portátil');
  await page.getByLabel('Lo pagaste').fill('1.800');
  await page.locator('input[name="cuando"]').fill(today().slice(0, 7));
  await expect(page.getByText('Dentro de un año: 1.350 €')).toBeVisible();
  await page.getByText('Reloj').click();
  await expect(page.locator('select[name="pierde"]')).toHaveValue('5');
  await page.getByText('Electrónica').click();
  await page.getByRole('button', { name: 'Añadir bien' }).click();
  await expect(page).toHaveURL(/\/alta$/);
  await page.getByRole('link', { name: /^Portátil/ }).click();
  await expect(page).toHaveURL(/\/bien$/);
  await hydrated(page);
  await expect(page.locator('.hero')).toHaveText('1.800 €');
  const hand = page.getByRole('button', { name: /Poner valor a mano/ });
  await expect(hand).toHaveAttribute('aria-expanded', 'false');
  await hand.click();
  await expect(hand).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('Vale hoy').fill('1.000');
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await saved;
  // From the server, not the field: the value by hand wins from today.
  await page.reload();
  await expect(page.locator('.hero')).toHaveText('1.000 €');
});
