import { expect, test } from '@playwright/test';
import { createNeonDb } from '../src/lib/server/db/index.ts';
import { migrateUserToLedger } from '../src/lib/server/ledger-migration.ts';
import { today } from '../src/lib/server/plan.ts';
import { EMAIL, hydrated, resetUser, signIn, sql } from './auth.ts';

// Needs the housing data in the database (npm run vivienda): the CI's branch is a copy of dev.
test('Vivienda: by m² of its municipality, with its mortgage, then a value of the user’s', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await resetUser();
  await signIn(page);
  const [{ id }] = await sql()`select id from "user" where email = ${EMAIL}`;
  const ledger = createNeonDb(process.env.DATABASE_URL!);
  try {
    await migrateUserToLedger(ledger, id, today());
  } finally {
    await ledger.close();
  }
  const [{ m2 }] = await sql()`select eur_m2_cents as m2 from housing_m2 where area = '41039'`;

  await page.goto('/alta');
  await hydrated(page);
  await page.getByRole('link', { name: /Vivienda o inmueble/ }).click();
  await expect(page).toHaveURL(/\/cuentas\/nueva\/inmueble\?volver=alta$/);
  await hydrated(page);
  await page.getByLabel('Nombre').fill('Piso de Écija');
  await page.getByLabel('Municipio').fill('ecija');
  await page.getByRole('option').getByRole('button', { name: /Écija/ }).click();
  await expect(page.getByLabel('Municipio')).toHaveValue('Écija (Sevilla)');
  await page.getByLabel('Superficie').fill('90');
  await expect(page.getByText(/90 m² × .*valor tasado medio de Écija/)).toBeVisible();
  await expect(
    page.getByText(
      /No usamos .* del último año \(IPV del INE, vivienda de segunda mano, Andalucía, [1-4]T \d{4}\)/,
    ),
  ).toBeVisible();

  await page.getByRole('switch', { name: /¿Tiene hipoteca\?/ }).check();
  await page.getByLabel('Lo que debes').fill('62.400');
  await expect(page.getByText('Tuyo de verdad')).toBeVisible();
  await page.getByRole('button', { name: 'Añadir vivienda' }).click();

  // A new mortgage is a whole debt: RDeuda opens with what is owed and the home linked.
  await expect(page).toHaveURL(/\/cuentas\/[^/]+\/deuda\?volver=alta$/);
  await hydrated(page);
  await expect(page.locator('input[name="capital"]')).toHaveValue('62.400');
  await expect(page.locator('select[name="inmueble"] option:checked')).toHaveText('Piso de Écija');
  await page.getByRole('link', { name: 'Volver al alta' }).click();

  // Back in the Alta: the home, then its mortgage.
  await expect(page).toHaveURL(/\/alta$/);
  const added = page.getByRole('region', { name: 'Lo que ya has añadido' }).getByRole('link');
  await expect(added.nth(0)).toContainText('Piso de Écija');
  await expect(added.nth(1)).toContainText('Hipoteca de Piso de Écija');
  await expect(added.nth(1)).toContainText('−62.400 €');
  const [home] = await sql()`select p.account_id, m.amount_cents::int as cents from property p
    join movement m on m.account_id = p.account_id where p.mortgage_account_id is not null`;
  expect(home!.cents).toBe(Math.round(90 * Number(m2)));

  // Its page: «Mi valor» wins from today.
  await page.getByRole('link', { name: /^Piso de Écija/ }).click();
  await expect(page).toHaveURL(new RegExp(`/cuentas/${home!.account_id}/inmueble$`));
  await hydrated(page);
  await page.getByText('Mi valor').click();
  await page.getByLabel('Lo que vale según tú').fill('120.000');
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await saved;
  // From the server, not the field.
  await page.reload();
  await expect(page.locator('.hero')).toHaveText('120.000 €');
  await expect(page.getByText('Tuyo de verdad').locator('..')).toContainText('57.600 €');
});
