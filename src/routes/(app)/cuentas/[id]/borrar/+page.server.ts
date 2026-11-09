import { error, fail, redirect } from '@sveltejs/kit';
import { runUser } from '#lib/server/engine-run.ts';
import { today } from '#lib/server/today.ts';
import { removalView, removeAccount } from '#lib/server/removal.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// «Borrar, lo añadí por error»: this page is the confirmation; it goes from every day of history.
export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  const view = await removalView(event.locals.db(), userId, event.params.id);
  if (!view) error(404, 'No encontrada');
  return { view };
};

export const actions: Actions = {
  default: async (event) => {
    const userId = await requireUserId(event);
    const db = event.locals.db();
    const view = await removalView(db, userId, event.params.id);
    if (!view) error(404, 'No encontrada');
    const form = await event.request.formData();
    const hipoteca = String(form.get('hipoteca') ?? '');
    if (form.get('confirmar') !== 'si')
      return fail(400, { error: 'Confirma que quieres borrarlo' });
    if (view.mortgage && !['mantener', 'borrar'].includes(hipoteca))
      return fail(400, { error: 'Elige qué pasa con la hipoteca' });
    const done = await removeAccount(
      db,
      userId,
      view,
      hipoteca === 'borrar' ? 'borrar' : 'mantener',
    );
    if (done === 'cerrada')
      return fail(409, {
        error: 'Está en meses cerrados del cierre antiguo: dalo de baja en lugar de borrarlo.',
      });
    await runUser(db, userId, today());
    redirect(303, '/cuentas');
  },
};
