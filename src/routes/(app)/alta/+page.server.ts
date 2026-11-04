import { fail, redirect } from '@sveltejs/kit';
import { parseEuros, parsePercent } from '#lib/engine/money.ts';
import { MAX_CENTS } from '#lib/server/accounts.ts';
import { ALTA_KINDS, type AltaKind, WITH_PRODUCTS } from '#lib/labels.ts';
import { openAccount } from '#lib/server/alta.ts';
import { runUser } from '#lib/server/engine-run.ts';
import { today } from '#lib/server/plan.ts';
import { requireUserId } from '#lib/server/session.ts';
import type { Actions, PageServerLoad } from './$types';

// b11/NAlta: 1 · Lo que tienes, 2 · Cómo se mueve, 3 · Listo. For users on the ledger.
export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  const db = event.locals.db();
  const [{ j }] = await db.query<{ j: string | null }>(
    `select case when not exists (select 1 from engine_state where user_id = $1) then null
     else json_build_object(
       'accounts', (select coalesce(json_agg(json_build_object('id', a.id, 'name', a.name,
           'kind', a.kind, 'products', (select count(*) from position p
             where p.account_id = a.id and p.qty_e8 > 0))
           order by a.created_at, a.id), '[]')
         from money_account a join account_access x on x.account_id = a.id
         where x.user_id = $1 and x.role = 'propietario' and a.archived_at is null),
       'values', (select accounts from user_day where user_id = $1 order by day desc limit 1),
       'total', (select total_cents from user_day where user_id = $1 order by day desc limit 1),
       'rules', (select coalesce(json_agg(name order by created_at), '[]') from auto_rule
                 where user_id = $1 and active))
     end::text as j`,
    [userId],
  );
  if (!j) redirect(303, '/inicio');
  const d = JSON.parse(j) as {
    accounts: { id: string; name: string; kind: string; products: number }[];
    values: Record<string, [number, number, number?]> | null;
    total: number | null;
    rules: string[];
  };
  const step = Number(event.url.searchParams.get('paso')) || 1;
  const open = event.url.searchParams.get('tipo');
  return {
    step: Math.min(3, Math.max(1, step)),
    open: ALTA_KINDS.some((k) => k.kind === open) ? (open as AltaKind) : null,
    accounts: d.accounts.map((a) => ({ ...a, value: d.values?.[a.id]?.[0] ?? 0 })),
    total: Number(d.total ?? 0),
    rules: d.rules,
  };
};

export const actions: Actions = {
  anadir: async (event) => {
    const userId = await requireUserId(event);
    const form = await event.request.formData();
    const values = Object.fromEntries(
      ['kind', 'name', 'amount', 'rate'].map((k) => [k, String(form.get(k) ?? '').trim()]),
    );
    // A home, a car and a good go in through their own screens.
    const kind = ALTA_KINDS.find(
      (k) => k.kind === values.kind && !['inmueble', 'vehiculo', 'bien'].includes(k.kind),
    )?.kind;
    const cents = values.amount ? parseEuros(values.amount) : 0;
    const rateBp = values.rate ? parsePercent(values.rate) : 0;
    const errors: Record<string, string> = {};
    if (!kind) errors.kind = 'Elige qué quieres añadir';
    if (!values.name || values.name.length > 60) errors.name = 'Ponle un nombre (hasta 60 letras)';
    if (cents === null || cents < 0 || cents > MAX_CENTS)
      errors.amount = 'Escribe un importe, por ejemplo 1.250,50';
    if (rateBp === null || rateBp < 0 || rateBp > 10_000)
      errors.rate = 'Escribe el interés anual, por ejemplo 2,5';
    if (Object.keys(errors).length) return fail(400, { values, errors });

    const db = event.locals.db();
    const [ledger] = await db.query(`select 1 from engine_state where user_id = $1`, [userId]);
    if (!ledger) redirect(303, '/inicio');
    const day = today();
    const id = await openAccount(db, userId, day, {
      name: values.name!,
      kind: kind!,
      cents: cents!,
      rateBp: rateBp!,
    });
    await runUser(db, userId, day);
    // A broker or crypto account: its products next, then back here.
    if (WITH_PRODUCTS.includes(kind!)) redirect(303, `/cuentas/${id}/producto?volver=alta`);
    redirect(303, '/alta');
  },
};
