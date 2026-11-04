import { error, json } from '@sveltejs/kit';
import { haciendaValue, searchVehicles } from '#lib/server/goods.ts';
import { today } from '#lib/server/plan.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { RequestHandler } from './$types';

// RCoche: ?q= the models of Hacienda's table; ?id=&fecha= one's value by its years of use.
export const GET: RequestHandler = async (event) => {
  await requireUserId(event);
  const db = event.locals.db();
  const id = event.url.searchParams.get('id');
  if (id) {
    const fecha = event.url.searchParams.get('fecha') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) error(400, 'Fecha');
    const value = await haciendaValue(db, id.slice(0, 60), fecha, today());
    if (!value) error(404, 'No encontrado');
    return json(value);
  }
  return json(await searchVehicles(db, (event.url.searchParams.get('q') ?? '').slice(0, 60)));
};
