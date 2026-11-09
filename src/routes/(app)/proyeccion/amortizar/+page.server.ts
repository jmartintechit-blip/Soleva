import { redirect } from '@sveltejs/kit';
import { today } from '#lib/server/today.ts';
import { loadProjection, viewInput } from '#lib/server/projection.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// Amortizar o invertir (b13/PAmortizar): two paths with the same money, worked out in the page with
// the engine. No action: it is not a recommendation (it goes through the legal review).
const CASH = ['efectivo', 'remunerada'];
const INVEST = ['broker', 'cripto', 'pension'];

export const load: PageServerLoad = async (event) => {
  const db = event.locals.db();
  const userId = await requireUserId(event);
  const p = await loadProjection(db, userId, today());
  const named = (id: string) => p.accountNames[id] ?? 'Tu cuenta';
  const debts = p.accounts
    .filter((a) => a.debt && a.cashCents < 0)
    .map((a) => ({ id: a.id, name: named(a.id), owedCents: -a.cashCents }));
  if (!debts.length) redirect(303, '/proyeccion');
  const q = event.url.searchParams;
  const parsed = viewInput.safeParse({
    scenario: q.get('escenario') ?? undefined,
    years: q.get('anos') ?? undefined,
    unit: q.get('unidad') ?? undefined,
  });
  // The money comes from the cash account with most of it; it would go to the first investment
  // account (or, if there is none, a new one only for the sum).
  const from = p.accounts
    .filter((a) => CASH.includes(a.kind))
    .sort((a, b) => b.cashCents - a.cashCents)[0]?.id;
  const invest = p.accounts.find((a) => INVEST.includes(a.kind))?.id;
  return {
    projection: p,
    view: parsed.success ? parsed.data : viewInput.parse({}),
    debts,
    from: from ?? null,
    invest: invest ?? null,
  };
};
