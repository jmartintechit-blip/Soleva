import { fail, redirect } from '@sveltejs/kit';
import { asTheme, THEME_COOKIE } from '#lib/labels.ts';
import { postAuth } from '#lib/server/auth.ts';
import { deleteUser, endSessions } from '#lib/server/privacy.ts';
import { fieldErrors, requireUserId } from '#lib/server/session.ts';
import { getReminder, getSettings, reminderInput, saveReminder } from '#lib/server/settings.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  const db = event.locals.db();
  const [{ assumptions }, reminder, ledger] = await Promise.all([
    getSettings(db, userId),
    getReminder(db, userId),
    db.query(`select 1 from engine_state where user_id = $1`, [userId]),
  ]);
  // On the ledger the reminder is the monthly cuadre's, not the month close's.
  return { assumptions, reminder, ledger: ledger.length > 0 };
};

export const actions: Actions = {
  // A device preference, not data about the user: a cookie, no query on every page.
  tema: async (event) => {
    await requireUserId(event);
    const theme = asTheme(String((await event.request.formData()).get('theme')));
    event.cookies.set(THEME_COOKIE, theme, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      httpOnly: true,
    });
    return { theme };
  },

  recordatorio: async (event) => {
    const userId = await requireUserId(event);
    const form = await event.request.formData();
    const day = String(form.get('day') ?? '');
    const parsed = reminderInput.safeParse({
      enabled: form.get('enabled') === 'on',
      day: /^\d{1,2}$/.test(day) ? Number(day) : Number.NaN,
    });
    if (!parsed.success) return fail(400, { reminderErrors: fieldErrors(parsed.error) });
    await saveReminder(event.locals.db(), userId, parsed.data);
    return { reminderSaved: true };
  },

  sesiones: async (event) => {
    const userId = await requireUserId(event);
    await postAuth(event.locals.auth(), event, '/sign-out', {});
    await endSessions(event.locals.db(), userId);
    redirect(303, '/entrar');
  },

  borrar: async (event) => {
    const userId = await requireUserId(event);
    const form = await event.request.formData();
    if (
      String(form.get('confirm') ?? '')
        .trim()
        .toUpperCase() !== 'BORRAR'
    )
      return fail(400, { deleteError: 'Escribe BORRAR para confirmar' });
    await postAuth(event.locals.auth(), event, '/sign-out', {});
    await deleteUser(event.locals.db(), userId);
    event.cookies.delete(THEME_COOKIE, { path: '/' });
    redirect(303, '/');
  },
};
