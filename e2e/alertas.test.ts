import { expect, test } from '@playwright/test';
import { EMAIL, hydrated, resetUser, signIn, sql } from './auth.ts';

test('alerts: the user’s own numbers, a counter in the sidebar, hidden on request', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await resetUser();
  await signIn(page);
  const db = sql();
  const [{ id }] = await db`select id from "user" where email = ${EMAIL}`;
  const [acc] = await db`insert into money_account (user_id, name, kind, balance_cents)
    values (${id}, 'Bróker', 'broker', 0) returning id`;
  // The way in moves the user to the ledger and runs it, which resolves the alerts it does not
  // find: the alert goes in after it.
  await page.goto('/cuentas');
  await db`insert into alert (user_id, kind, account_id, day, dedupe_key, detail)
    values (${id}, 'plan_supera', ${acc!.id}, '2026-11-02', 'plan_supera:r1',
            ${{ each: 36000, frequency: 'semanal', spend: 156000, inflow: 150000, ruleId: 'r1' }})`;

  await page.goto('/inicio');
  await hydrated(page);
  await expect(page.getByRole('link', { name: /Alertas/ })).toContainText('1');
  await page.getByRole('link', { name: /Alertas/ }).click();
  await expect(page.getByRole('heading', { name: '1 cosa que mirar' })).toBeVisible();
  await expect(
    page.getByText('De media salen 1.560 € al mes (360 € × 52 ÷ 12) y entran 1.500 €.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ocultar' }).click();
  await expect(page.getByRole('heading', { name: 'Nada que mirar' })).toBeVisible();
  expect(await db`select state from alert where user_id = ${id}`).toEqual([{ state: 'vista' }]);
});
