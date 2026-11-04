import { loadGood, saveGood } from '#lib/server/goods-routes.ts';
import type { Actions, PageServerLoad } from './$types';

// b12/RBien.
export const load: PageServerLoad = (event) => loadGood(event, 'bien');

export const actions: Actions = { default: (event) => saveGood(event, 'bien') };
