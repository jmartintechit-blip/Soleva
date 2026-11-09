import { fail, redirect } from '@sveltejs/kit';
import { parsePercent } from '#lib/engine/money.ts';
import { runUser } from '#lib/server/engine-run.ts';
import { today } from '#lib/server/plan.ts';
import { loadProjection } from '#lib/server/projection.ts';
import { fieldErrors, requireUserId } from '#lib/server/session.ts';
import { assumptionsInput, getSettings, saveAssumptions } from '#lib/server/settings.ts';
import type { Actions, PageServerLoad } from './$types';

// Proyección v2 (b13/PProyeccion): the server sends what the projection starts from (today's
// ledger, its rules and the assumptions) and the page runs the engine, so every control is live.
export const load: PageServerLoad = async (event) => {
  const db = event.locals.db();
  const userId = await requireUserId(event);
  const day = today();
  const [state] = await db.query<{ through: string }>(
    `select processed_through::text as through from engine_state where user_id = $1`,
    [userId],
  );
  // Catch up first if the cron has not run for this user yet today, as Inicio does.
  if (state && state.through < day) await runUser(db, userId, day);
  return { projection: await loadProjection(db, userId, day) };
};

const KEYS = ['prudente', 'base', 'optimista', 'inflation', 'rulesGrowth'] as const;

export const actions: Actions = {
  supuestos: async (event) => {
    const userId = await requireUserId(event);
    const db = event.locals.db();
    const form = await event.request.formData();
    const values = Object.fromEntries(KEYS.map((k) => [k, String(form.get(k) ?? '').trim()]));
    const read = (k: (typeof KEYS)[number]) => parsePercent(values[k]!) ?? Number.NaN;
    // «Tus ingresos y gastos» follows the inflation while it is empty, or while it was following
    // and was left as it was shown (the old inflation) or set to the new one.
    const { assumptions } = await getSettings(db, userId);
    const following = assumptions.rulesGrowth === null || assumptions.rulesGrowth === undefined;
    const growth = values.rulesGrowth ? read('rulesGrowth') : null;
    const same = growth === assumptions.inflation || growth === read('inflation');
    const parsed = assumptionsInput.safeParse({
      prudente: read('prudente'),
      base: read('base'),
      optimista: read('optimista'),
      inflation: read('inflation'),
      rulesGrowth: following && same ? null : growth,
    });
    if (!parsed.success) return fail(400, { values, errors: fieldErrors(parsed.error) });
    await saveAssumptions(db, userId, parsed.data);
    redirect(303, '/proyeccion');
  },
};
