import { error, fail, redirect } from '@sveltejs/kit';
import { parseUnits } from '#lib/engine/units.ts';
import { loadAccountView } from '#lib/server/account-view.ts';
import { runUser } from '#lib/server/engine-run.ts';
import { missingIsins, searchProducts } from '#lib/server/market/search.ts';
import { today } from '#lib/server/today.ts';
import { addProduct, quote } from '#lib/server/product.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Search by GET (?q=), choose by GET (&elegido=SYMBOL): one provider call each, and the page
// works without JavaScript.
export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  const db = event.locals.db();
  const [ledger] = await db.query(`select 1 from engine_state where user_id = $1`, [userId]);
  if (!ledger) redirect(303, `/cuentas/${event.params.id}`);
  const day = today();
  const view = await loadAccountView(db, userId, event.params.id, day);
  if (!view) error(404, 'No encontrada');
  const q = (event.url.searchParams.get('q') ?? '').trim().slice(0, 60);
  const chosen = event.url.searchParams.get('elegido')?.slice(0, 30) ?? '';
  const results = q ? await searchProducts(db, q).catch(() => null) : [];
  return {
    account: { id: view.account.id, name: view.account.name, value: view.value },
    q,
    results,
    // Streamed: the results show at once, the ISINs not yet cached follow.
    isins: results?.length
      ? event.locals.defer(missingIsins(db, results))
      : ({} as Record<string, string>),
    chosen: chosen ? ((await quote(db, chosen, day))?.quote ?? null) : null,
    chosenSymbol: chosen,
    // From the Alta inicial: close goes back there, and each add comes back here for the next.
    fromAlta: event.url.searchParams.get('volver') === 'alta',
  };
};

export const actions: Actions = {
  default: async (event) => {
    const userId = await requireUserId(event);
    const form = await event.request.formData();
    const values = {
      units: String(form.get('units') ?? '').trim(),
      avg: String(form.get('avg') ?? '').trim(),
    };
    const qtyE8 = parseUnits(values.units);
    const avgEurE8 = parseUnits(values.avg.replace('€', ''));
    const errors: Record<string, string> = {};
    if (!qtyE8) errors.units = 'Escribe cuántas tienes, por ejemplo 114,8';
    if (!avgEurE8) errors.avg = 'Escribe el precio medio en euros, por ejemplo 97,32';
    // What it cost must fit the ledger's limit: cents = qty·price ÷ 10^14.
    if (qtyE8 && avgEurE8 && qtyE8 * avgEurE8 > 99_999_999_999n * 10n ** 14n)
      errors.units = 'Es demasiado grande';
    if (Object.keys(errors).length) return fail(400, { values, errors });

    const db = event.locals.db();
    const day = today();
    const added = await addProduct(db, userId, event.params.id, day, {
      symbol: String(form.get('symbol') ?? '').slice(0, 30),
      qtyE8: qtyE8!,
      avgEurE8: avgEurE8!,
    });
    if (added === null) error(404, 'No encontrada');
    if (added === 'sin_precio') {
      errors.form = 'No conseguimos su precio ahora. Prueba en un momento.';
      return fail(503, { values, errors });
    }
    await runUser(db, userId, day);
    redirect(
      303,
      form.get('volver') === 'alta'
        ? `/cuentas/${event.params.id}/producto?volver=alta`
        : `/cuentas/${event.params.id}`,
    );
  },
};
