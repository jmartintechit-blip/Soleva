import { error, fail, redirect } from '@sveltejs/kit';
import { DEFAULT_RATE_BP } from '#lib/engine/rules.ts';
import { parseEuros, parsePercent } from '#lib/engine/money.ts';
import {
  accountInput,
  createAccount,
  deleteAccount,
  getAccount,
  setArchived,
  updateAccount,
} from '#lib/server/accounts.ts';
import { loadAccountView } from '#lib/server/account-view.ts';
import { closedOn } from '#lib/server/removal.ts';
import { today } from '#lib/server/plan.ts';
import { fieldErrors, requireUserId } from '#lib/server/session.ts';
import { FOLLOWS_SCENARIO } from '#lib/labels.ts';
import type { Actions, PageServerLoad } from './$types';

const NEW = 'nueva';

export const load: PageServerLoad = async (event) => {
  const userId = await requireUserId(event);
  if (event.params.id === NEW) return { view: null, account: null };
  const db = event.locals.db();
  // On the ledger: the account's page (b11/NCuenta); before the cut-over, its v0 form.
  const [ledger] = await db.query(`select 1 from engine_state where user_id = $1`, [userId]);
  if (ledger) {
    const view = await loadAccountView(db, userId, event.params.id, today());
    if (!view) error(404, 'No encontrada');
    // Given up (sold, paid off): its baja page says since when.
    if (await closedOn(db, view.account.id)) redirect(303, `/cuentas/${view.account.id}/baja`);
    // A home has its own page (b12/RInmueble).
    const [home] = await db.query(`select 1 from property where account_id = $1`, [
      view.account.id,
    ]);
    if (home) redirect(303, `/cuentas/${view.account.id}/inmueble`);
    const [good] = await db.query<{ page: string }>(
      `select 'coche' as page from vehicle where account_id = $1
       union all select 'bien' from asset where account_id = $1`,
      [view.account.id],
    );
    if (good) redirect(303, `/cuentas/${view.account.id}/${good.page}`);
    // So do a mortgage and a loan (b12/RDeuda).
    if (['deuda_hipoteca', 'deuda_prestamo'].includes(view.account.kind))
      redirect(303, `/cuentas/${view.account.id}/deuda`);
    return { view, account: null };
  }
  const account = await getAccount(db, userId, event.params.id);
  if (!account) error(404, 'No encontrada');
  return { view: null, account };
};

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export const actions: Actions = {
  guardar: async (event) => {
    const userId = await requireUserId(event);
    const form = await event.request.formData();
    const values = Object.fromEntries(
      ['name', 'kind', 'balance', 'rate'].map((k) => [k, text(form, k)]),
    );
    const kind = values.kind!;
    // Empty rate, or an account that follows the scenario: the default for its kind.
    const rate = FOLLOWS_SCENARIO.includes(kind) || !values.rate ? '' : values.rate;
    const parsed = accountInput.safeParse({
      name: values.name,
      kind,
      balanceCents: parseEuros(values.balance!) ?? Number.NaN,
      isEstimated: form.get('isEstimated') === 'on',
      annualRateBp: rate
        ? (parsePercent(rate) ?? Number.NaN)
        : (DEFAULT_RATE_BP[kind as keyof typeof DEFAULT_RATE_BP] ?? 0),
    });
    if (!parsed.success) {
      const errors = fieldErrors(parsed.error);
      // Rename to the form's fields.
      return fail(400, {
        values,
        errors: { ...errors, balance: errors.balanceCents, rate: errors.annualRateBp },
      });
    }
    const db = event.locals.db();
    if (event.params.id === NEW) await createAccount(db, userId, parsed.data);
    else if (!(await updateAccount(db, userId, event.params.id, parsed.data)))
      error(404, 'No encontrada');
    redirect(303, '/cuentas');
  },

  archivar: async (event) => {
    const form = await event.request.formData();
    const ok = await setArchived(
      event.locals.db(),
      await requireUserId(event),
      event.params.id,
      form.get('archived') === 'true',
    );
    if (!ok) error(404, 'No encontrada');
    redirect(303, '/cuentas');
  },

  borrar: async (event) => {
    const deleted = await deleteAccount(
      event.locals.db(),
      await requireUserId(event),
      event.params.id,
    );
    if (deleted === 'closed')
      return fail(409, {
        deleteError: 'Está en meses cerrados: archívala para conservar tu histórico.',
      });
    if (!deleted) error(404, 'No encontrada');
    redirect(303, '/cuentas');
  },
};
