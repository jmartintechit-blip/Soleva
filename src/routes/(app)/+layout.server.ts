import { asTheme, THEME_COOKIE } from '#lib/labels.ts';
import { requireUserId, sessionOf } from '#lib/server/session.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
  // The way in (the cut-over to the ledger, or today's run) happens here once per request.
  const userId = await requireUserId(event);
  const session = (await sessionOf(event))!;
  // Open alerts, for the sidebar's counter and Inicio's bell.
  const [{ n }] = await event.locals
    .db()
    .query<{ n: number }>(
      `select count(*)::int as n from alert where user_id = $1 and state = 'abierta'`,
      [userId],
    );
  return {
    email: session.user.email,
    theme: asTheme(event.cookies.get(THEME_COOKIE)),
    alerts: n,
  };
};
