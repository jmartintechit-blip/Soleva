import { error, fail, redirect } from '@sveltejs/kit';
import { runUser } from '#lib/server/engine-run.ts';
import { today } from '#lib/server/plan.ts';
import {
  debtsOf,
  openMortgage,
  propertyView,
  readPropertyForm,
  updateProperty,
} from '#lib/server/property.ts';
import { closedOn } from '#lib/server/removal.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// b12/RInmueble, one already there: its page. A new value of the user's wins from today.
export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  const db = event.locals.db();
  const view = await propertyView(db, userId, event.params.id, today());
  if (!view) error(404, 'No encontrada');
  if (await closedOn(db, view.id)) redirect(303, `/cuentas/${view.id}/baja`);
  return { view, debts: await debtsOf(db, userId), fromAlta: false };
};

export const actions: Actions = {
  default: async (event) => {
    const userId = await requireUserId(event);
    const db = event.locals.db();
    const day = today();
    const read = await readPropertyForm(
      db,
      await event.request.formData(),
      Number(day.slice(0, 4)),
    );
    if (!read.ok)
      return fail(400, {
        values: read.values,
        errors: read.errors,
        candidates: read.candidates,
        info: read.info,
      });
    if (!(await propertyView(db, userId, event.params.id, day))?.canEdit)
      error(404, 'No encontrada');
    const done = await updateProperty(db, userId, event.params.id, day, read.input);
    if (done === null) error(404, 'No encontrada');
    if (done === 'sin_dato')
      return fail(400, {
        values: read.values,
        errors: { valor: 'Pon tu valor' },
        candidates: [],
        info: read.info,
      });
    const debt = read.mortgage?.newCents
      ? await openMortgage(
          db,
          userId,
          day,
          event.params.id,
          read.input.name,
          read.mortgage.newCents,
        )
      : null;
    await runUser(db, userId, day);
    redirect(303, debt ? `/cuentas/${debt}/deuda` : `/cuentas/${event.params.id}/inmueble`);
  },
};
