import { expect, test } from '@playwright/test';
import { EMAIL, hydrated, resetUser, signIn, sql } from './auth.ts';

test('home and projection follow the accounts and rules, live', async ({ page }) => {
  // Pages that vite dev compiles cold in CI.
  test.setTimeout(90_000);
  const db = sql();
  await resetUser();
  await signIn(page);
  const [{ id }] = await db`select id from "user" where email = ${EMAIL}`;
  const [cash] = await db`insert into money_account (user_id, name, kind, balance_cents)
    values (${id}, 'Banco', 'efectivo', 200000) returning id`;
  const [fund] = await db`insert into money_account (user_id, name, kind, balance_cents)
    values (${id}, 'Indexado', 'inversion', 1000000) returning id`;
  await db`insert into rule (user_id, name, type, amount_cents, frequency, day, start_month,
      from_account_id, to_account_id)
    values (${id}, 'Ahorro', 'mueve', 30000, 'mensual', 1, date_trunc('month', now()),
      ${cash!.id}, ${fund!.id})`;

  // On the way in the user goes to the ledger with the same 12.000 €, and the v0 rule becomes a
  // transfer: the projection v2 starts from there.
  await page.goto('/inicio');
  await expect(page.getByText('12.000 €').first()).toBeVisible();

  await page.goto('/proyeccion');
  await hydrated(page);
  const value = page.locator('.value');
  await expect(value).not.toHaveText('0 €');
  await expect(page.getByText(/Estimación, no asesoramiento/)).toBeVisible();
  await expect(page.getByText('Lo que tienes hoy')).toBeVisible();
  await expect(page.getByText('12.000 €').first()).toBeVisible();
  // Everything follows the controls: in euros of then the same money is more euros.
  const today = await value.textContent();
  await page.getByRole('button', { name: 'Euros de entonces' }).click();
  await expect(value).not.toHaveText(today!);
  await page.getByRole('button', { name: '5 años' }).click();
  await expect(page.getByText('Tu patrimonio dentro de 5 años')).toBeVisible();
  await page.getByRole('button', { name: 'Optimista' }).click();
  await expect(page.getByRole('button', { name: 'Optimista' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('link', { name: 'Supuestos' }).click();
  await page.getByRole('textbox', { name: /^Base/ }).fill('9');
  await page.getByRole('button', { name: 'Guardar supuestos' }).click();
  await expect(page.getByText('Ordénalos: prudente ≤ base ≤ optimista')).toBeVisible();
});
