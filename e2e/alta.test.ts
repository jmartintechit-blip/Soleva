import { expect, test } from '@playwright/test';
import { createNeonDb } from '../src/lib/server/db/index.ts';
import { migrateUserToLedger } from '../src/lib/server/ledger-migration.ts';
import { today } from '../src/lib/server/today.ts';
import { EMAIL, hydrated, resetUser, signIn, sql } from './auth.ts';

test('Alta inicial: what you have, with the total as you add it, then Inicio', async ({ page }) => {
  test.setTimeout(90_000);
  await resetUser();
  await signIn(page);
  const [{ id }] = await sql()`select id from "user" where email = ${EMAIL}`;
  // On the ledger with nothing in yet (the cut-over will do this on entry, B12).
  const ledger = createNeonDb(process.env.DATABASE_URL!);
  try {
    await migrateUserToLedger(ledger, id, today());
  } finally {
    await ledger.close();
  }

  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/alta$/);
  await hydrated(page);
  await expect(page.getByRole('heading', { name: 'Mete tu situación una vez' })).toBeVisible();
  // No distractions: without the bottom bar.
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toHaveCount(0);

  await page.getByRole('link', { name: /Cuenta remunerada/ }).click();
  await page.getByLabel('Nombre').fill('Bankinter');
  await page.getByLabel('Saldo hoy (€)').fill('38.240,15');
  await page.getByLabel('Interés anual (%)').fill('2');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  // Plus today's interest on today's closing balance: 38.240,15 × 2 % ÷ 365, 19 % withheld.
  await expect(page.getByRole('link', { name: /Bankinter/ })).toContainText('38.241,84 €');
  await expect(page.getByText('Tu patrimonio, de momento').locator('..')).toContainText(
    '38.241,84 €',
  );

  await page.getByRole('link', { name: /Hipoteca o préstamo/ }).click();
  await page.getByLabel('Nombre').fill('Hipoteca');
  await page.getByLabel('Lo que debes (€)').fill('15.000');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.getByText('Tu patrimonio, de momento').locator('..')).toContainText(
    '23.241,84 €',
  );

  // A broker: its products next, and closing comes back here.
  await page.getByRole('link', { name: /Bróker o inversiones/ }).click();
  await page.getByLabel('Nombre').fill('Trade Republic');
  await page.getByLabel('Efectivo en la cuenta (€)').fill('200');
  await page.getByRole('button', { name: 'Añadir y meter sus productos' }).click();
  await expect(page.getByRole('dialog', { name: 'Añadir a Trade Republic' })).toBeVisible();
  await page.getByRole('link', { name: 'Cerrar' }).click();
  await expect(page).toHaveURL(/\/alta$/);
  await expect(page.getByRole('link', { name: /Trade Republic/ })).toContainText('200 €');

  await page.getByRole('link', { name: 'Siguiente: cómo se mueve tu dinero' }).click();
  await expect(page.getByRole('heading', { name: 'Cómo se mueve tu dinero' })).toBeVisible();
  await page.getByRole('link', { name: 'Siguiente: listo' }).click();
  await page.getByRole('link', { name: 'Ir a Inicio' }).click();
  await expect(page.getByText('Tu patrimonio')).toBeVisible();
  await expect(page.getByText('23.441,84 €').first()).toBeVisible();
});
