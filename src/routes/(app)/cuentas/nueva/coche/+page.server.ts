import { loadGood, saveGood } from '#lib/server/goods-routes.ts';
import type { Actions, PageServerLoad } from './$types';

// b12/RCoche.
export const load: PageServerLoad = (event) => loadGood(event, 'vehiculo');

export const actions: Actions = { default: (event) => saveGood(event, 'vehiculo') };
