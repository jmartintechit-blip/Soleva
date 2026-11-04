import { expect, test } from '@playwright/test';
import { openAccount } from '../src/lib/server/alta.ts';
import { createNeonDb } from '../src/lib/server/db/index.ts';
import { runUser } from '../src/lib/server/engine-run.ts';
import { createGood } from '../src/lib/server/goods.ts';
import { migrateUserToLedger } from '../src/lib/server/ledger-migration.ts';
import { today } from '../src/lib/server/plan.ts';
import { createProperty, openMortgage } from '../src/lib/server/property.ts';
import { EMAIL, hydrated, resetUser, signIn, sql } from './auth.ts';

// Needs the housing data in the database (npm run vivienda): the CI's branch is a copy of dev.
test('Baja: a home sold into the bank pays off its mortgage; a good added by mistake is deleted', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await resetUser();
  await signIn(page);
  const [{ id: user }] = await sql()`select id from "user" where email = ${EMAIL}`;
  const day = today();
  const db = createNeonDb(process.env.DATABASE_URL!);
  let home: string;
  let laptop: string;
  try {
    await migrateUserToLedger(db, user, day);
    await openAccount(db, user, day, { name: 'Bankinter', kind: 'efectivo', cents: 1_000_000 });
    home = (await createProperty(db, user, day, {
      name: 'Piso de Écija',
      kind: 'habitual',
      municipalityCode: '41039',
      areaM2: 90,
      method: 'propio',
      ownCents: 20_000_000,
      growthBp: 200,
    })) as string;
    await openMortgage(db, user, day, home, 'Piso de Écija', 6_000_000);
    laptop = (await createGood(db, user, day, 'bien', {
      name: 'Portátil',
      category: 'electronica',
      purchaseCents: 120_000,
      purchasedOn: `${day.slice(0, 7)}-01`,
      annualLossBp: 2500,
    })) as string;
    await runUser(db, user, day);
  } finally {
    await db.close();
  }
  const total = async () =>
    Number(
      (await sql()`select total_cents from user_day where user_id = ${user} and day = ${day}`)[0]!
        .total_cents,
    );
  expect(await total()).toBe(1_000_000 + 20_000_000 - 6_000_000 + 120_000);

  // «Lo vendí o ya no lo tengo», from RInmueble.
  await page.goto(`/cuentas/${home}/inmueble`);
  await hydrated(page);
  await page.getByRole('link', { name: 'Lo vendí o ya no lo tengo' }).click();
  await expect(page).toHaveURL(new RegExp(`/cuentas/${home}/baja$`));
  await hydrated(page);
  await expect(page.getByLabel('Desde el día')).toHaveValue(day);
  await expect(page.getByRole('radio', { name: 'Lo vendí' })).toBeChecked();
  await page.getByLabel('Te dieron').fill('210.000');
  await page.getByLabel('Entró en').selectOption({ label: 'Bankinter' });
  await expect(page.getByRole('radio', { name: 'Liquidarla en esa fecha' })).toBeChecked();
  await page.getByRole('button', { name: 'Dar de baja' }).click();

  await expect(page).toHaveURL(/\/cuentas$/);
  const archived = page.getByRole('region', { name: 'Archivadas' });
  await expect(archived.getByRole('link', { name: /^Piso de Écija/ })).toContainText(
    'de baja desde el',
  );
  await expect(archived.getByRole('link', { name: /^Hipoteca de Piso de Écija/ })).toContainText(
    'de baja desde el',
  );
  // 10.000 + 210.000 − 60.000, and the laptop.
  expect(await total()).toBe(16_000_000 + 120_000);
  // The bank shows where the money came from.
  await page
    .getByRole('region', { name: 'Tus cuentas' })
    .getByRole('link', { name: /Bankinter/ })
    .click();
  await expect(page.getByText('Venta de Piso de Écija')).toBeVisible();
  await expect(page.getByText('Hipoteca de Piso de Écija: liquidada')).toBeVisible();
  // Its own page now only says since when.
  await page.goto(`/cuentas/${home}/inmueble`);
  await expect(page).toHaveURL(new RegExp(`/cuentas/${home}/baja$`));
  await expect(page.getByText(/Ya no lo tienes desde el/)).toBeVisible();

  // «Borrar, lo añadí por error», from RBien: this page is the confirmation.
  await page.goto(`/cuentas/${laptop}/bien`);
  await hydrated(page);
  await page.getByRole('link', { name: 'Borrar, lo añadí por error' }).click();
  await expect(page).toHaveURL(new RegExp(`/cuentas/${laptop}/borrar$`));
  await expect(page.getByRole('heading', { name: '¿Borrar Portátil?' })).toBeVisible();
  await page.getByRole('button', { name: 'Borrar para siempre' }).click();
  await expect(page).toHaveURL(/\/cuentas$/);
  await expect(page.getByRole('link', { name: /Portátil/ })).toHaveCount(0);
  expect(await sql()`select 1 from money_account where id = ${laptop}`).toHaveLength(0);
  expect(await total()).toBe(16_000_000);
});
