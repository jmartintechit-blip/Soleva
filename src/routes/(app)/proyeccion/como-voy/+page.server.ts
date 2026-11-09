import { redirect } from '@sveltejs/kit';
import { breakdown, inTodayEuros, projectLedger } from '#lib/engine/projection.ts';
import { plannedOn } from '#lib/engine/myplan.ts';
import { runUser } from '#lib/server/engine-run.ts';
import { today } from '#lib/server/today.ts';
import {
  howAmIToday,
  loadProjection,
  planFor,
  saveFixedPlan,
  viewInput,
} from '#lib/server/projection.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Cómo voy (b13/PComoVoy, PComoVoyVacio): today against «mi plan», or what fixing it would keep.
// The view (scenario, horizon, unit) comes from Proyección's controls; the plan is always built
// here from today's ledger.
const viewOf = (url: URL) =>
  viewInput.parse({
    scenario: url.searchParams.get('escenario') ?? undefined,
    years: url.searchParams.get('anos') ?? undefined,
    unit: url.searchParams.get('unidad') ?? undefined,
  });

export const load: PageServerLoad = async (event) => {
  const db = event.locals.db();
  const userId = await requireUserId(event);
  const day = today();
  const [state] = await db.query<{ through: string }>(
    `select processed_through::text as through from engine_state where user_id = $1`,
    [userId],
  );
  if (state && state.through < day) await runUser(db, userId, day);
  const p = await loadProjection(db, userId, day);
  if (!p.accounts.length) redirect(303, '/proyeccion');
  let view;
  try {
    view = viewOf(event.url);
  } catch {
    view = viewInput.parse({});
  }
  const how = await howAmIToday(db, userId, p);
  if (!how) {
    // Nothing fixed yet: what would be kept.
    return { how: null, view, figure: planFor(p, view).finalCents };
  }
  // «Tu plan»: its final figure against today's projection with the same view.
  const months = how.plan.months;
  const steps = projectLedger(p.accounts, day, months, how.plan.scenario, p.assumptions, p.rules);
  const shown = how.plan.unit === 'hoy' ? inTodayEuros(steps, p.assumptions.inflationBp) : steps;
  const planned = plannedOn(how.plan, day)!;
  return {
    how,
    view,
    today: day,
    nowFigure: breakdown(shown).figure,
    planned,
    startCents: how.plan.path[0]!.totalCents,
  };
};

export const actions: Actions = {
  // «Fijar como mi plan» and «Volver a fijar mi plan con lo de hoy»: never from the browser's numbers.
  default: async (event) => {
    const db = event.locals.db();
    const userId = await requireUserId(event);
    const form = await event.request.formData();
    const parsed = viewInput.safeParse({
      scenario: form.get('escenario') ?? undefined,
      years: form.get('anos') ?? undefined,
      unit: form.get('unidad') ?? undefined,
    });
    const view = parsed.success ? parsed.data : viewInput.parse({});
    const p = await loadProjection(db, userId, today());
    if (p.accounts.length) await saveFixedPlan(db, userId, planFor(p, view));
    redirect(303, '/proyeccion/como-voy');
  },
};
