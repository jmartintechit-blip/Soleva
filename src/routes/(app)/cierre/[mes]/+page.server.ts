import { error, fail } from '@sveltejs/kit';
import { parseEuros } from '#lib/engine/money.ts';
import { MAX_CENTS } from '#lib/server/accounts.ts';
import { amendClose, getClose, leaveClose } from '#lib/server/closes.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Anything that is not a real month is a 404, never a database cast error.
const validMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  await leaveClose(event.locals.db(), userId);
  const close = validMonth(event.params.mes)
    ? await getClose(event.locals.db(), userId, event.params.mes)
    : null;
  if (!close) error(404, 'No encontrado');
  return { close };
};

export const actions: Actions = {
  enmendar: async (event) => {
    const userId = await requireUserId(event);
    await leaveClose(event.locals.db(), userId);
    if (!validMonth(event.params.mes)) error(404, 'No encontrado');
    const form = await event.request.formData();
    const account = String(form.get('account') ?? '');
    const amount = String(form.get('amount') ?? '').trim();
    const reason = String(form.get('reason') ?? '').trim();
    const cents = parseEuros(amount);
    const errors: Record<string, string> = {};
    if (cents == null || cents < 0 || cents > MAX_CENTS)
      errors.amount = 'Escribe un importe, por ejemplo 1.250,50';
    if (!reason || reason.length > 200)
      errors.reason = 'Cuenta en pocas palabras por qué cambia (máx. 200 caracteres)';
    if (Object.keys(errors).length)
      return fail(400, { account, values: { amount, reason }, errors });
    const ok = await amendClose(
      event.locals.db(),
      userId,
      event.params.mes,
      account,
      cents!,
      reason,
    );
    if (!ok) error(404, 'No encontrado');
    return { amended: account };
  },
};
