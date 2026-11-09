import { expect, test } from '@playwright/test';
import { toE8 } from '../src/lib/engine/units.ts';
import { openAccount } from '../src/lib/server/alta.ts';
import { saveAutoRule } from '../src/lib/server/auto-rules.ts';
import { createNeonDb } from '../src/lib/server/db/index.ts';
import { runUser } from '../src/lib/server/engine-run.ts';
import { migrateUserToLedger } from '../src/lib/server/ledger-migration.ts';
import { today } from '../src/lib/server/today.ts';
import { savePlan } from '../src/lib/server/plans.ts';
import { EMAIL, hydrated, resetUser, signIn, sql } from './auth.ts';

// Without the price provider: the plan's product is seeded, and the search is answered here.
test('RPlan: products and amounts, the monthly average against what comes in', async ({ page }) => {
  test.setTimeout(90_000);
  await resetUser();
  await signIn(page);
  const [{ id }] = await sql()`select id from "user" where email = ${EMAIL}`;
  const db = createNeonDb(process.env.DATABASE_URL!);
  let broker: string;
  let plan: string;
  try {
    await migrateUserToLedger(db, id, today());
    const bank = await openAccount(db, id, today(), {
      name: 'Bankinter',
      kind: 'efectivo',
      cents: 900_000,
    });
    broker = await openAccount(db, id, today(), {
      name: 'Trade Republic',
      kind: 'broker',
      cents: 20_000,
    });
    await saveAutoRule(db, id, null, {
      name: 'Al bróker',
      kind: 'transferencia',
      frequency: 'mensual',
      day: 1,
      startOn: today(),
      endOn: null,
      fromAccountId: bank,
      toAccountId: broker,
      amountCents: 150_000,
    });
    await sql()`delete from instrument where source_id = 'E2EPLAN.DE'`;
    plan = (await savePlan(
      db,
      id,
      null,
      {
        accountId: broker,
        frequency: 'semanal',
        day: 1,
        startOn: today(),
        shortfall: 'no_comprar',
        shortfallAccountId: null,
        legs: [{ symbol: 'E2EPLAN.DE', amountCents: 25_000 }],
      },
      async (symbol) => ({
        quote: {
          symbol,
          exchange: 'GER',
          market: 'XETRA',
          name: 'Fondo de prueba World',
          kind: 'etf',
          isin: null,
          currency: 'EUR',
          priceEurE8: toE8(100).toString(),
          day: today(),
        },
        closes: [{ day: today(), priceE8: toE8(100) }],
        perEurE8: toE8(1),
      }),
    )) as string;
    await runUser(db, id, today());
  } finally {
    await db.close();
  }

  await page.goto(`/cuentas/${broker}`);
  await page
    .getByRole('link', { name: /Plan semanal/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/reglas/${plan}$`));
  await hydrated(page);
  await expect(page.getByRole('heading', { name: 'Plan en Trade Republic' })).toBeVisible();
  // 250 € a week are 1.083,33 € a month: 1.500 € come in.
  await expect(
    page.getByText('Entran 1.500 € al mes: sobran 416,67 €, que se quedan como efectivo.'),
  ).toBeVisible();

  await page.route('**/reglas/buscar?*', (route) =>
    route.fulfill({
      json: [
        {
          name: 'Physical Gold',
          kind: 'etc',
          isin: 'IE00B4ND3602',
          listings: [
            {
              symbol: 'PPFB.DE',
              exchange: 'GER',
              market: 'XETRA',
              name: 'Physical Gold',
              kind: 'etc',
            },
          ],
        },
      ],
    }),
  );
  await page.getByRole('button', { name: '+ Añadir producto al plan' }).click();
  await page.getByLabel('Busca por nombre, ISIN o ticker').fill('gold');
  await page.getByRole('button', { name: /Physical Gold/ }).click();
  await page.getByLabel('Importe de Physical Gold').fill('100');
  await expect(page.getByText('Total por semana').locator('..')).toContainText('350 €');
  await expect(
    page.getByText(
      /faltan 16,67 € al mes\. Hacia .* el efectivo no llegará: las compras que no quepan no se harán y te avisaremos\./,
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Quitar Physical Gold' }).click();

  await page.getByText('Mensual').click();
  await page.locator('select[name="day"]').selectOption('2');
  await page.getByLabel('Importe de Fondo de prueba World').fill('300');
  await page.getByRole('button', { name: 'Guardar plan' }).click();
  await expect(page).toHaveURL(new RegExp(`/cuentas/${broker}$`));
  await expect(page.getByRole('link', { name: /Plan mensual · 300 €/ }).first()).toBeVisible();
});
