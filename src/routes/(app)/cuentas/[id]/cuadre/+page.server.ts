import { error, fail, redirect } from '@sveltejs/kit';
import { parseEuros } from '#lib/engine/money.ts';
import { parseUnits } from '#lib/engine/units.ts';
import { MAX_CENTS } from '#lib/server/accounts.ts';
import { loadCuadre, saveCuadre } from '#lib/server/cuadre.ts';
import { runUser } from '#lib/server/engine-run.ts';
import { today } from '#lib/server/today.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  const db = event.locals.db();
  // Before the cut-over to the ledger there is nothing to square: the v0 account form.
  const [ledger] = await db.query(`select 1 from engine_state where user_id = $1`, [userId]);
  if (!ledger) redirect(303, `/cuentas/${event.params.id}`);
  const cuadre = await loadCuadre(db, userId, event.params.id);
  if (!cuadre) error(404, 'No encontrada');
  return cuadre;
};

export const actions: Actions = {
  default: async (event) => {
    const userId = await requireUserId(event);
    const form = await event.request.formData();
    // Only the rows the user opened are sent: «cash» and «u:<instrument>».
    const values: Record<string, string> = {};
    const errors: Record<string, string> = {};
    let cashCents: number | undefined;
    const units: Record<string, bigint> = {};
    for (const [key, raw] of form) {
      const text = String(raw).trim();
      values[key] = text;
      if (key === 'cash') {
        const cents = parseEuros(text);
        if (cents === null || Math.abs(cents) > MAX_CENTS)
          errors[key] = 'Escribe un importe, por ejemplo 187,90';
        else cashCents = cents;
      } else if (key.startsWith('u:')) {
        const qty = parseUnits(text);
        if (qty === null) errors[key] = 'Escribe una cantidad, por ejemplo 114,7987';
        else units[key.slice(2)] = qty;
      }
    }
    if (Object.keys(errors).length) return fail(400, { values, errors });

    const db = event.locals.db();
    const day = today();
    const saved = await saveCuadre(db, userId, event.params.id, day, { cashCents, units });
    if (saved === null) error(404, 'No encontrada');
    if (saved) await runUser(db, userId, day);
    redirect(303, `/cuentas/${event.params.id}`);
  },
};
