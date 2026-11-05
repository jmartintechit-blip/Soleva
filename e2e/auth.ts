import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { type Page, expect } from '@playwright/test';

// Resend's test sink, so a local run with a real key emails nobody. Must be in ALLOWED_EMAILS.
export const EMAIL = 'delivered@resend.dev';
export const CODE = '246810';
export const sql = () => neon(process.env.DATABASE_URL!);

// The real code is only emailed (or logged), so swap the stored hash for one of a known code.
// Mirrors better-auth's email-otp storage: base64url(sha256(otp)) + ':' + attempts.
// Better Auth keeps an unused earlier code as another row until it expires, and checks the newest
// one: so does this. Expecting a single row failed whenever an earlier run left a code unused.
export async function setCode(email: string, code: string) {
  const hash = createHash('sha256').update(code).digest('base64url');
  const rows = await sql()`update verification set value = ${`${hash}:0`}
    where id = (select id from verification where identifier = ${`sign-in-otp-${email}`}
                order by "createdAt" desc limit 1)
    returning id`;
  expect(rows).toHaveLength(1);
}

// Interactive: the root layout marks <html data-hydrated> on mount. Before that, vite dev's late
// hydration resets what a test typed or opened.
export const hydrated = (page: Page) =>
  expect(page.locator('html[data-hydrated]')).toBeAttached({ timeout: 30_000 });

// For a form post that reloads the page: the mark is cleared first, so only the new page's counts.
export async function hydratedAfter(page: Page, action: () => Promise<unknown>) {
  await page.evaluate(() => delete document.documentElement.dataset.hydrated);
  await action();
  await hydrated(page);
}

// A clean start: deleting the user cascades to everything (confirmed closes can't be deleted alone).
export const resetUser = () => sql()`delete from "user" where email = ${EMAIL}`;

export async function signIn(page: Page) {
  // The test branch is a copy of dev: earlier local runs may have used up the code limit.
  await sql()`delete from "rateLimit"`;
  await page.goto('/entrar');
  await hydrated(page);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('button', { name: 'Enviarme el código' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu email' })).toBeVisible();
  await setCode(EMAIL, CODE);
  await page.getByLabel('Código').fill(CODE);
  await page.getByRole('button', { name: 'Entrar' }).click();
  // On entry a new user goes to the ledger with nothing in yet: the Alta inicial.
  await expect(page).toHaveURL(/\/alta$/);
  // Back to before the cut-over, so a test can set up v0 data first (that cut-over only wrote the
  // engine state and today's empty day). The next page of the app moves the user again, with it.
  await sql()`delete from user_day where user_id = (select id from "user" where email = ${EMAIL})`;
  await sql()`delete from engine_state where user_id = (select id from "user" where email = ${EMAIL})`;
}
