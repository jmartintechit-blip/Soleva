import { expect, test } from '@playwright/test';
import { EMAIL, hydrated, resetUser, signIn, sql } from './auth.ts';

// B12 tarea 11: a v0 user goes to the ledger on the way in, with the same net worth; the month
// close sends to Cuentas, and a home or car without details says «Completa sus datos».
test('the way in: v0 to the ledger with the same net worth, and the month close is gone', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await resetUser();
  await signIn(page);
  const db = sql();
  const [{ id }] = await db`select id from "user" where email = ${EMAIL}`;
  const [cash] = await db`insert into money_account (user_id, name, kind, balance_cents)
    values (${id}, 'Banco', 'efectivo', 200000) returning id`;
  await db`insert into money_account (user_id, name, kind, balance_cents)
    values (${id}, 'Indexado', 'inversion', 1000000)`;
  const [flat] = await db`insert into money_account (user_id, name, kind, balance_cents)
    values (${id}, 'Piso', 'inmueble', 15000000) returning id`;
  await db`insert into money_account (user_id, name, kind, balance_cents)
    values (${id}, 'Préstamo', 'deuda', 500000)`;
  await db`insert into money_account (user_id, name, kind, balance_cents, archived_at)
    values (${id}, 'Vieja', 'efectivo', 7000, now())`;
  await db`insert into rule (user_id, name, type, amount_cents, frequency, day, start_month, to_account_id)
    values (${id}, 'Nómina', 'entra', 150000, 'mensual', 1, '2020-01-01', ${cash!.id})`;

  // 2.000 + 10.000 + 150.000 − 5.000, without the archived one: as v0's Inicio said.
  await page.goto('/inicio');
  await hydrated(page);
  await expect(page.getByText('Tu patrimonio')).toBeVisible();
  await expect(page.getByText('157.000 €').first()).toBeVisible();
  expect(await db`select count(*)::int as n from engine_state where user_id = ${id}`).toEqual([
    { n: 1 },
  ]);
  expect(await db`select name from auto_rule where user_id = ${id}`).toEqual([{ name: 'Nómina' }]);

  // The month close is the cuadre now, from Cuentas; so is its reminder.
  await page.goto('/cierre');
  await expect(page).toHaveURL(/\/cuentas$/);
  await page.goto('/cierre/2026-10');
  await expect(page).toHaveURL(/\/cuentas$/);
  await page.goto('/ajustes');
  await expect(page.getByRole('heading', { name: 'Recordatorio del cuadre' })).toBeVisible();

  // A home from v0 has no municipality or m²: it says so, and can be given up or deleted.
  await page.goto(`/cuentas/${flat!.id}`);
  await hydrated(page);
  await expect(page.getByText('150.000 €').first()).toBeVisible();
  const complete = page.getByRole('link', { name: /Completa sus datos/ });
  await expect(complete).toHaveAttribute('href', `/cuentas/${flat!.id}/inmueble`);
  await expect(page.getByRole('link', { name: 'Lo vendí o ya no lo tengo' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Borrar, lo añadí por error' })).toBeVisible();
  // None of a broker's controls: no products, no cuadre, no cash line.
  await expect(page.getByRole('link', { name: 'Añadir producto' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Cuadrar' })).toHaveCount(0);
  await expect(page.getByText(/^Efectivo/)).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByText('Últimos movimientos')).toBeVisible();
  await complete.click();
  await expect(page).toHaveURL(new RegExp(`/cuentas/${flat!.id}/inmueble$`));
  await expect(page.getByLabel('Nombre')).toHaveValue('Piso');
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible();

  // A new account on the ledger goes in through the Alta.
  await page.goto('/cuentas/nueva');
  await expect(page).toHaveURL(/\/alta$/);
});
