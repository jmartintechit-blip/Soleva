import { error, fail, redirect } from '@sveltejs/kit';
import { runUser } from '#lib/server/engine-run.ts';
import { readTermsForm, saveTerms, termsView } from '#lib/server/interest-terms.ts';
import { today } from '#lib/server/today.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// b12/RRemunerada: an account's interest terms and what they make this period.
export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  const view = await termsView(event.locals.db(), userId, event.params.id, today());
  if (!view) error(404, 'No encontrada');
  return { view };
};

export const actions: Actions = {
  default: async (event) => {
    const userId = await requireUserId(event);
    const read = readTermsForm(await event.request.formData());
    if (!read.ok) return fail(400, { values: read.values, errors: read.errors });
    const db = event.locals.db();
    if (!(await saveTerms(db, userId, event.params.id, read.input))) error(404, 'No encontrada');
    await runUser(db, userId, today());
    redirect(303, `/cuentas/${event.params.id}/intereses`);
  },
};
