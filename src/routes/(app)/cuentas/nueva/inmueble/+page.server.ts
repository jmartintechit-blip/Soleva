import { error, fail, redirect } from '@sveltejs/kit';
import { runUser } from '#lib/server/engine-run.ts';
import { today } from '#lib/server/today.ts';
import { createProperty, debtsOf, openMortgage, readPropertyForm } from '#lib/server/property.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// b12/RInmueble, a new one. From the Alta inicial (?volver=alta) it goes back there.
export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  const db = event.locals.db();
  const [ledger] = await db.query(`select 1 from engine_state where user_id = $1`, [userId]);
  if (!ledger) redirect(303, '/cuentas');
  return {
    view: null,
    debts: await debtsOf(db, userId),
    fromAlta: event.url.searchParams.get('volver') === 'alta',
  };
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
    const id = await createProperty(db, userId, day, read.input);
    if (id === null) error(404, 'No encontrada');
    if (id === 'sin_dato')
      return fail(400, {
        values: read.values,
        errors: { valor: 'Pon tu valor' },
        candidates: [],
        info: read.info,
      });
    const alta = event.url.searchParams.get('volver') === 'alta';
    // A new mortgage: the home first, then the debt and its terms in RDeuda.
    const debt = read.mortgage?.newCents
      ? await openMortgage(db, userId, day, id, read.input.name, read.mortgage.newCents)
      : null;
    await runUser(db, userId, day);
    if (debt) redirect(303, `/cuentas/${debt}/deuda${alta ? '?volver=alta' : ''}`);
    redirect(303, alta ? '/alta' : `/cuentas/${id}`);
  },
};
