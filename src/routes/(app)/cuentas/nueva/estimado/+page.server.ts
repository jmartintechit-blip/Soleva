import { error, fail, redirect } from '@sveltejs/kit';
import { runUser } from '#lib/server/engine-run.ts';
import { addEstimate, estimateAccounts, readEstimateForm } from '#lib/server/estimates.ts';
import { today } from '#lib/server/today.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// b12/REstimado, from Añadir producto (?cuenta=) or the Alta inicial (?volver=alta).
export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  const db = event.locals.db();
  const [ledger] = await db.query(`select 1 from engine_state where user_id = $1`, [userId]);
  if (!ledger) redirect(303, '/cuentas');
  const accounts = await estimateAccounts(db, userId);
  const asked = event.url.searchParams.get('cuenta');
  return {
    accounts,
    account: accounts.find((a) => a.id === asked)?.id ?? accounts[0]?.id ?? null,
    today: today(),
    fromAlta: event.url.searchParams.get('volver') === 'alta',
  };
};

export const actions: Actions = {
  default: async (event) => {
    const userId = await requireUserId(event);
    const day = today();
    const read = readEstimateForm(await event.request.formData(), day);
    if (!read.ok) return fail(400, { values: read.values, errors: read.errors });
    const db = event.locals.db();
    if (!(await addEstimate(db, userId, day, read.input))) error(404, 'No encontrada');
    await runUser(db, userId, day);
    redirect(
      303,
      event.url.searchParams.get('volver') === 'alta'
        ? '/alta'
        : `/cuentas/${read.input.accountId}`,
    );
  },
};
