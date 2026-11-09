import { redirect } from '@sveltejs/kit';
import { today } from '#lib/server/today.ts';
import { loadProjection, viewInput } from '#lib/server/projection.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// ¿Qué pasa si…? (b13/PQuePasaSi): the same inputs as Proyección; the page tries each change with
// the engine and nothing is saved here.
const TABS = ['aporto', 'pausa', 'gasto'] as const;
const CASH = ['efectivo', 'remunerada'];
const TARGETS = ['efectivo', 'remunerada', 'broker', 'cripto', 'pension'];

export const load: PageServerLoad = async (event) => {
  const db = event.locals.db();
  const userId = await requireUserId(event);
  const p = await loadProjection(db, userId, today());
  if (!p.accounts.length) redirect(303, '/proyeccion');
  const q = event.url.searchParams;
  const parsed = viewInput.safeParse({
    scenario: q.get('escenario') ?? undefined,
    years: q.get('anos') ?? undefined,
    unit: q.get('unidad') ?? undefined,
  });
  const tab = (TABS as readonly string[]).includes(q.get('que') ?? '')
    ? (q.get('que') as (typeof TABS)[number])
    : 'aporto';
  const named = (id: string) => p.accountNames[id] ?? 'Tu cuenta';
  // Money comes out of cash: the accounts with most of it first.
  const cash = p.accounts
    .filter((a) => CASH.includes(a.kind))
    .sort((a, b) => b.cashCents - a.cashCents)
    .map((a) => ({ id: a.id, name: named(a.id) }));
  const plans = p.rules
    .filter((r) => r.kind === 'plan' && r.active)
    .map((r) => ({
      id: r.id,
      name: p.ruleNames[r.id] ?? `Plan en ${named(r.fromAccountId ?? '')}`,
      cents: r.legs.reduce((s, l) => s + l.amountCents, 0),
      frequency: r.frequency,
      accountId: r.fromAccountId ?? '',
      payerId: r.shortfall === 'otra_cuenta' ? r.shortfallAccountId : undefined,
    }));
  const targets = p.accounts
    .filter((a) => TARGETS.includes(a.kind))
    .map((a) => ({ id: a.id, name: named(a.id) }));
  return {
    projection: p,
    view: parsed.success ? parsed.data : viewInput.parse({}),
    tab,
    cash,
    plans,
    targets,
  };
};
