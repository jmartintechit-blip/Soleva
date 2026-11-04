import { error, fail, redirect } from '@sveltejs/kit';
import { runUser } from '#lib/server/engine-run.ts';
import { today } from '#lib/server/plan.ts';
import { closeAccount, readCloseForm, removalView } from '#lib/server/removal.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// «Lo vendí o ya no lo tengo» (for a debt, «La pagué o ya no la tengo»): from a day on it is not
// there; the days before do not change. Once given up, this page says so.
export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  const view = await removalView(event.locals.db(), userId, event.params.id);
  if (!view) error(404, 'No encontrada');
  return { view, today: today() };
};

export const actions: Actions = {
  default: async (event) => {
    const userId = await requireUserId(event);
    const db = event.locals.db();
    const day = today();
    const view = await removalView(db, userId, event.params.id);
    if (!view) error(404, 'No encontrada');
    if (view.closedOn) redirect(303, `/cuentas/${view.id}/baja`);
    const read = readCloseForm(await event.request.formData(), view, day);
    if (!read.ok) return fail(400, { values: read.values, errors: read.errors });
    const done = await closeAccount(db, userId, view, read.input);
    if (done === 'cerrada')
      return fail(409, {
        values: read.values,
        errors: {
          hipoteca:
            'Esta hipoteca está en meses cerrados del cierre antiguo: liquídala o mantenla.',
        } as Record<string, string>,
      });
    await runUser(db, userId, day);
    redirect(303, '/cuentas');
  },
};
