import { expect, test } from '@playwright/test';
import { hydrated, resetUser, signIn } from './auth.ts';

// On the ledger since the way in (B12 tarea 11): accounts go in through the Alta, rules are the
// ledger's (reglas-libro), and nobody else's account or rule is there.
test('Cuentas and Reglas of a new user: empty, new accounts through the Alta, 404 for others', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await resetUser();
  await signIn(page);

  await page.goto('/cuentas');
  await expect(page.getByText('Aún no tienes cuentas')).toBeVisible();
  await hydrated(page);
  await page.getByRole('link', { name: 'Nueva cuenta' }).click();
  await expect(page).toHaveURL(/\/alta$/);
  await expect(page.getByRole('heading', { name: 'Mete tu situación una vez' })).toBeVisible();

  await page.goto('/reglas');
  // Without accounts, rules wait for them.
  await expect(page.getByRole('link', { name: 'Mete primero lo que tienes' })).toBeVisible();

  expect((await page.goto('/cuentas/no-es-mia'))!.status()).toBe(404);
  expect((await page.goto('/reglas/no-es-mia'))!.status()).toBe(404);
});
