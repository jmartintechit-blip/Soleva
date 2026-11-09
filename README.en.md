<p align="center"><img src="src/lib/assets/favicon.svg" width="88" alt="Soleva logo"></p>

<h1 align="center">Soleva</h1>

<p align="center">Your net worth on autopilot. No bank connection.</p>

<p align="center">
  <a href="https://github.com/jmartintechit-blip/soleva/actions/workflows/ci.yml"><img src="https://github.com/jmartintechit-blip/soleva/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/jmartintechit-blip/soleva/releases"><img src="https://img.shields.io/github/v/release/jmartintechit-blip/soleva?include_prereleases&label=version" alt="Version"></a>
</p>

<p align="center"><a href="README.md">Español</a></p>

You note once how your money comes in and goes out (salary, contributions, fixed expenses) and Soleva proposes your balances every month and shows where you will be in 5, 10 or 20 years. Built for young investors in Spain with several accounts, funds or brokers. The app is in Spanish.

> Soleva does not move money, does not connect to your bank and does not recommend products. Every projection is an estimate, not advice.

<p align="center"><img src="docs/portada.png" width="280" alt="Soleva Projection on mobile, with test data"></p>

## Features

Today (blocks 0 to 6 and 8 to 12):

- Public home page with a compound interest calculator in today's euros (3, 6 and 8 % scenarios, 2.5 % inflation).
- Waitlist with consent and email double opt-in (open).
- Legal notice, terms of use and privacy policy.
- Passwordless sign-in with a 6-digit code by email.
- Private routes behind a session, bottom navigation on mobile and a sidebar on desktop.
- Accounts and rules: create, edit, pause, archive and delete; a New rule sheet with templates.
- Rules and month-by-month projection engine by scenario, with invariant tests.
- Home and Projection: net worth, history, scenarios, horizon, what-ifs, editable assumptions and the on-track light.
- Settings: three themes, reminder, export everything as JSON or CSV, end sessions and delete the account for real.
- Horizonte dark design system with self-hosted fonts.
- Ledger database (v0.8.0), daily engine (v0.9.0) and data and daily runs (v0.10.0): movements generated every day, interest on the real balance, debts, dividends, valuation, returns, alerts, stock closes, ECB rates, the official Euribor and Hacienda's car tables.
- New screens on the ledger (v0.11.0): Home with what you put in against what your money made in each period, Alerts, Account with positions and movements, Add product (search with ISIN and exchanges), Reconcile against the real figures and a three-step onboarding.
- Rules and products (v0.12.0): transfers, incomes, expenses and payments that generate movements; investment plans; interest accounts with tiers; fixed or variable mortgages and loans with their schedule; a home by the m² of its municipality with INE's housing price index; a car by Hacienda's table; goods; products without a public price; giving up, undoing it and deleting; and everyone moving to the ledger on the way in, checked account by account. The month close gives way to reconciling, with a monthly reminder.
- Projection v2 (v0.13.0): from what you have today in the ledger, your rules, plans, debts, homes, cars and goods, 5, 10, 20 or 30 years ahead, in today's euros or euros of then, with a cautious–optimistic band, where each euro comes from, by type and what is coming (end of a promotion, mortgage review, debt paid off). «How am I» against your fixed plan (also on Home), what-ifs (contribute more, pause a plan, a one-off expense) and pay off or invest, in two columns without recommending either.

Coming before the beta: polish (accessibility, performance and an installable app).

## Stack

TypeScript · SvelteKit 3 + Svelte 5 · Cloudflare Workers · Neon Postgres (Frankfurt) with hand-written SQL · Better Auth · Resend · Zod · Vitest + PGlite · Playwright.

Details in [ARCHITECTURE.md](ARCHITECTURE.md) (Spanish).

## Run it locally

You need Node 24 and a [Neon](https://neon.tech) database (free).

```bash
npm ci
cp .dev.vars.example .dev.vars   # the app: DATABASE_URL and BETTER_AUTH_SECRET
cp .env.example .env             # the scripts: DATABASE_URL
npm run migrate
npm run dev
```

- `BETTER_AUTH_SECRET`: a random string of 32 characters or more (`openssl rand -base64 32`).
- `WAITLIST_OPEN=1` shows the waitlist form (still off in production).
- `ALLOWED_EMAILS`: comma-separated emails that may sign in (empty = nobody; sign-up is closed until the beta).
- Without `RESEND_API_KEY`, the sign-in code is printed in the `npm run dev` console.
- `npm test` needs no keys: it uses in-memory Postgres (PGlite).
- `npm run check` runs lint, types, format, tests and build, like CI.
- `npm run e2e` tests with Playwright sign-in, the waitlist, the calculator, accounts and rules, projection, month close and settings against the `.env` branch (with `delivered@resend.dev` in `ALLOWED_EMAILS`); CI runs it on a throwaway Neon branch copied from dev.

## Status

Under construction: blocks 0 to 6 and 8 to 13 done (v0.13.0), deployed with sign-up closed and the waitlist open. Polish (block 7) moves to the end, on the new screens. See [CHANGELOG.md](CHANGELOG.md).

## Roadmap

| Block                   | Scope                                                       |
| ----------------------- | ----------------------------------------------------------- |
| 0 · Skeleton            | Sign-in, design, database, security, CI and deploy          |
| 1 · Public site         | Landing page, compound interest calculator and waitlist     |
| 2 · Engine              | Rules, month close and projection as pure, tested functions |
| 3 · Accounts and rules  | Create, edit, pause and delete                              |
| 4 · Home and projection | Net worth, chart and editable assumptions                   |
| 5 · Month close         | Proposal, correction, confirmation and history              |
| 6 · Settings            | Themes, data export and account deletion                    |
| 8 · Ledger              | Movement data model and moving the current data over        |
| 9 · Daily engine        | Movements generated every day, interest, debts and alerts   |
| 10 · Data               | Prices, exchange rates, Euribor and Hacienda's car tables   |
| 11 · Core screens       | New Home, accounts with holdings, reconciling and alerts    |
| 12 · Rules and products | Plans, debts, home, car, goods and moving to the ledger     |
| 13 · Projection v2      | Projection from rules, plans, debts and depreciation        |
| 14 · Polish             | Accessibility, performance and installable app (was 7)      |

## Security

See [SECURITY.md](SECURITY.md) (Spanish) to report a vulnerability.

## Licence

© 2026 Juan Antonio Martín Nadales. All rights reserved. The code is public so it can be read; see [LICENSE](LICENSE).

Built with AI assistance.
