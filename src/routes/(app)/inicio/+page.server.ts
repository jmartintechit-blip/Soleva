import { redirect } from '@sveltejs/kit';
import { runUser } from '#lib/server/engine-run.ts';
import { PERIODS, loadHome, period } from '#lib/server/home.ts';
import { howAmIOn } from '#lib/server/projection.ts';
import { requireUserId } from '#lib/server/session.ts';
import { today } from '#lib/server/today.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const db = event.locals.db();
  // Everyone is on the ledger: the way in moves a v0 user over before this.
  const userId = await requireUserId(event);
  const day = today();
  const [state] = await db.query<{ through: string }>(
    `select processed_through::text as through from engine_state where user_id = $1`,
    [userId],
  );
  // Catch up first if the cron has not run for this user yet today.
  if (state && state.through < day) await runUser(db, userId, day);
  const home = await loadHome(db, userId);
  // Nothing in yet: the Alta inicial first.
  if (!home.accounts.length) redirect(303, '/alta');
  const last = home.rows.at(-1);
  const periods = Object.fromEntries(PERIODS.map((p) => [p.key, period(home.rows, p.key, day)]));
  // Cómo voy as a pill (b13/PInicioPildora), only with a plan fixed.
  const how = await howAmIOn(db, userId, day, periods.mes!.value);
  return {
    today: day,
    how: how && { level: how.status.level, gapCents: how.status.gapCents },
    periods,
    accounts: home.accounts.map((a) => ({
      ...a,
      value: last?.accounts[a.id]?.[0] ?? 0,
      accrued: last?.accounts[a.id]?.[2] ?? 0,
    })),
    classes: home.classes,
    alerts: home.alerts,
  };
};
