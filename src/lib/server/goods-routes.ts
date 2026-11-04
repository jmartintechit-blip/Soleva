import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { runUser } from './engine-run.ts';
import { createGood, goodView, readGoodForm, updateGood } from './goods.ts';
import { today } from './plan.ts';
import { requireUserId } from './session.ts';

// The four routes of RCoche and RBien (new and existing) share their load and save.

export async function loadGood(event: RequestEvent, kind: 'vehiculo' | 'bien') {
  const userId = await requireUserId(event);
  const db = event.locals.db();
  const day = today();
  const id = event.params.id;
  if (!id) {
    const [ledger] = await db.query(`select 1 from engine_state where user_id = $1`, [userId]);
    if (!ledger) redirect(303, '/cuentas');
    return { view: null, today: day, fromAlta: event.url.searchParams.get('volver') === 'alta' };
  }
  const view = await goodView(db, userId, id, day);
  if (!view || (kind === 'vehiculo') !== !!view.car) error(404, 'No encontrada');
  return { view, today: day, fromAlta: false };
}

export async function saveGood(event: RequestEvent, kind: 'vehiculo' | 'bien') {
  const userId = await requireUserId(event);
  const day = today();
  const read = readGoodForm(await event.request.formData(), kind, day);
  if (!read.ok) return fail(400, { values: read.values, errors: read.errors });
  const db = event.locals.db();
  const id = event.params.id;
  let target = id;
  if (id) {
    const view = await goodView(db, userId, id, day);
    if (!view || (kind === 'vehiculo') !== !!view.car) error(404, 'No encontrada');
    if (!(await updateGood(db, userId, id, day, read.input))) error(404, 'No encontrada');
  } else {
    const made = await createGood(db, userId, day, kind, read.input);
    if (made === 'sin_valor')
      return fail(400, {
        values: read.values,
        errors: { valor: 'No hay valor para ese modelo: pon tu valor' },
      });
    target = made;
  }
  await runUser(db, userId, day);
  redirect(
    303,
    !id && event.url.searchParams.get('volver') === 'alta'
      ? '/alta'
      : `/cuentas/${target}/${kind === 'vehiculo' ? 'coche' : 'bien'}`,
  );
}
