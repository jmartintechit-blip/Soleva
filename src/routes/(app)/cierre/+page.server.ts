import { fail, redirect } from '@sveltejs/kit';
import { parseEuros } from '#lib/engine/money.ts';
import { MAX_CENTS } from '#lib/server/accounts.ts';
import {
  confirmClose,
  lastClosedMonth,
  leaveClose,
  monthToClose,
  netWorthHistory,
  proposeClose,
} from '#lib/server/closes.ts';
import type { Db } from '#lib/server/db/index.ts';
import { today } from '#lib/server/plan.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// The month is always worked out here from today and the last close, never sent by the browser.
async function current(db: Db, userId: string) {
  const month = monthToClose(today(), await lastClosedMonth(db, userId));
  return month ? { month, lines: await proposeClose(db, userId, month) } : null;
}

export const load: PageServerLoad = async (event) => {
  const db = event.locals.db();
  const userId = await requireUserId(event);
  await leaveClose(event.locals.db(), userId);
  const [open, history] = await Promise.all([current(db, userId), netWorthHistory(db, userId)]);
  return { month: open?.month ?? null, lines: open?.lines ?? [], history: history.reverse() };
};

export const actions: Actions = {
  confirmar: async (event) => {
    const db = event.locals.db();
    const userId = await requireUserId(event);
    await leaveClose(event.locals.db(), userId);
    const open = await current(db, userId);
    if (!open) redirect(303, '/cierre');
    const form = await event.request.formData();
    const values: Record<string, string> = {};
    const confirmed: Record<string, number> = {};
    const errors: Record<string, string> = {};
    for (const { account } of open.lines) {
      const text = String(form.get(account.id) ?? '');
      values[account.id] = text;
      const cents = parseEuros(text);
      if (cents == null || cents < 0 || cents > MAX_CENTS)
        errors[account.id] = 'Escribe un importe, por ejemplo 1.250,50';
      else confirmed[account.id] = cents;
    }
    if (Object.keys(errors).length) return fail(400, { values, errors });
    if (!(await confirmClose(db, userId, open.month, confirmed))) redirect(303, '/cierre');
    const history = await netWorthHistory(db, userId);
    return {
      done: { month: open.month, net: history.at(-1)!.netCents, prev: history.at(-2) ?? null },
    };
  },
};
