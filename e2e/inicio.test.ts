import { expect, test } from '@playwright/test';
import { createNeonDb } from '../src/lib/server/db/index.ts';
import { runUser } from '../src/lib/server/engine-run.ts';
import { migrateUserToLedger } from '../src/lib/server/ledger-migration.ts';
import { today } from '../src/lib/server/today.ts';
import { EMAIL, hydrated, resetUser, signIn, sql } from './auth.ts';

test('Inicio on the ledger: value, what you put in and made, accounts and the main alert', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await resetUser();
  await signIn(page);
  const db = sql();
  const [{ id }] = await db`select id from "user" where email = ${EMAIL}`;
  const [bank] = await db`insert into money_account (user_id, name, kind, balance_cents)
    values (${id}, 'Banco', 'efectivo', 1000050) returning id`;
  // The cut-over the app will do on entry (B12), done here by hand.
  const ledger = createNeonDb(process.env.DATABASE_URL!);
  try {
    await migrateUserToLedger(ledger, id, today());
    await runUser(ledger, id, today());
  } finally {
    await ledger.close();
  }
  await db`insert into alert (user_id, kind, account_id, day, dedupe_key, detail)
    values (${id}, 'sin_saldo', ${bank!.id}, ${today()}, 'sin_saldo:x', ${{ cash: 100 }})`;

  await page.goto('/inicio');
  await hydrated(page);
  await expect(page.getByText('Tu patrimonio')).toBeVisible();
  await expect(page.getByText('10.000,50 €').first()).toBeVisible();
  await page.getByRole('button', { name: 'Todo' }).click();
  await expect(page.getByRole('button', { name: 'Todo' })).toHaveAttribute('aria-pressed', 'true');
  // Opening the account is money you put in, not money it made.
  await expect(page.getByText('Lo que aportaste').locator('..')).toContainText('+10.000,50 €');
  await expect(page.getByText('Lo que ganó tu dinero').locator('..')).toContainText('0 €');
  await expect(page.getByText('Esta cuenta se queda sin saldo')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Banco/ })).toHaveAttribute(
    'href',
    `/cuentas/${bank!.id}`,
  );
  await expect(page.getByText('Estimación, no asesoramiento')).toBeVisible();

  // The account's own page: its value, and the opening among its movements.
  await page.getByRole('link', { name: /^Banco/ }).click();
  await expect(page.getByRole('heading', { name: 'Banco' })).toBeVisible();
  await expect(page.getByText('10.000,50 €').first()).toBeVisible();
  await expect(page.getByText('Saldo inicial')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cuadrar' })).toHaveAttribute(
    'href',
    `/cuentas/${bank!.id}/cuadre`,
  );

  // Cuadre: the bank really has 9.990 €; the difference is an ajuste of today.
  await page.getByRole('link', { name: 'Cuadrar' }).click();
  await expect(page.getByRole('heading', { name: 'Cuadra Banco' })).toBeVisible();
  const save = page.getByRole('button', { name: /^Guardar cuadre/ });
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'Efectivo coincide. Cambiar' }).click();
  const real = page.getByLabel('Valor real de Efectivo');
  await expect(real).toHaveValue('10000,50');
  await real.fill('9.990');
  await expect(page.getByText('−10,50 €')).toBeVisible();
  await expect(save).toHaveText('Guardar cuadre · 1 cambio');
  await save.click();
  await expect(page.getByRole('heading', { name: 'Banco' })).toBeVisible();
  await expect(page.getByText('9.990 €').first()).toBeVisible();
  await expect(page.getByText('Ajustaste el efectivo a lo real')).toBeVisible();

  // Añadir producto opens as a sheet over the account and closes back to it (the search itself
  // goes to the price provider: covered by unit tests, not here).
  await page.goto(`/cuentas/${bank!.id}/producto`);
  await expect(page.getByRole('dialog', { name: 'Añadir a Banco' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Añadir a la cuenta' })).toBeDisabled();
  await page.getByRole('link', { name: 'Cerrar' }).click();
  await expect(page.getByRole('heading', { name: 'Banco' })).toBeVisible();
});
