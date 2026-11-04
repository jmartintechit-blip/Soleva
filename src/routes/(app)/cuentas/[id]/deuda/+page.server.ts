import { error, fail, redirect } from '@sveltejs/kit';
import { debtView, readDebtForm, saveDebt } from '#lib/server/debts.ts';
import { runUser } from '#lib/server/engine-run.ts';
import { today } from '#lib/server/plan.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// b12/RDeuda: a mortgage or loan, its next payment, its terms and its schedule.
export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  const view = await debtView(event.locals.db(), userId, event.params.id, today());
  if (!view) error(404, 'No encontrada');
  return { view, today: today(), fromAlta: event.url.searchParams.get('volver') === 'alta' };
};

export const actions: Actions = {
  default: async (event) => {
    const userId = await requireUserId(event);
    const read = readDebtForm(await event.request.formData(), today());
    if (!read.ok) return fail(400, { values: read.values, errors: read.errors });
    const db = event.locals.db();
    const day = today();
    if (!(await saveDebt(db, userId, event.params.id, day, read.input)))
      error(404, 'No encontrada');
    await runUser(db, userId, day);
    redirect(
      303,
      event.url.searchParams.get('volver') === 'alta'
        ? '/alta'
        : `/cuentas/${event.params.id}/deuda`,
    );
  },
};
