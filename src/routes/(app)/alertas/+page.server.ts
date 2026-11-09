import { error } from '@sveltejs/kit';
import type { StoredAlert } from '#lib/alerts.ts';
import { today } from '#lib/server/today.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  const alerts = await event.locals.db().query<StoredAlert & Record<string, unknown>>(
    `select l.id, l.kind, l.day::text as day, l.account_id as "accountId", a.name as account,
       i.name as instrument, l.detail
     from alert l left join money_account a on a.id = l.account_id
     left join instrument i on i.id = l.instrument_id
     where l.user_id = $1 and l.state = 'abierta'
     order by l.kind in ('sin_saldo', 'plan_supera', 'compra_no_ejecutada') desc, l.day, l.id`,
    [userId],
  );
  return { alerts, today: today() };
};

export const actions: Actions = {
  // Hidden until it changes or stops being true (the engine reopens a resolved one, not this).
  ocultar: async (event) => {
    const userId = await requireUserId(event);
    const id = String((await event.request.formData()).get('id') ?? '');
    const rows = await event.locals
      .db()
      .query(`update alert set state = 'vista' where id = $1 and user_id = $2 returning 1`, [
        id,
        userId,
      ]);
    if (!rows.length) error(404);
  },
};
