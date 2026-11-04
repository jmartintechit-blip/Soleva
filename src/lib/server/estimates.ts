import type { Day } from '#lib/engine/day.ts';
import { parseEuros, parsePercent } from '#lib/engine/money.ts';
import { E8 } from '#lib/engine/units.ts';
import { MAX_CENTS } from './accounts.ts';
import type { Db } from './db/index.ts';
import { ADDED } from './product.ts';

// b12/REstimado: a product without a public price (private markets, ELTIF, crowdfunding…) the
// user already holds. It goes in like Añadir producto, as units from outside (cash does not
// change), at what was put in; it grows at the user's yearly rate from the month it was bought.

// The accounts that hold products: the user's brokers and crypto accounts they can change.
export const estimateAccounts = (db: Db, userId: string) =>
  db.query<{ id: string; name: string }>(
    `select a.id, a.name from money_account a
     join account_access x on x.account_id = a.id and x.user_id = $1
       and x.role in ('propietario', 'editor')
     where a.archived_at is null and a.kind in ('broker', 'cripto')
     order by a.created_at, a.id`,
    [userId],
  );

export interface EstimateInput {
  accountId: string;
  name: string;
  investedCents: number;
  since: Day;
  rateBp: number;
}

export function readEstimateForm(form: FormData, today: Day) {
  const values = Object.fromEntries(
    ['cuenta', 'name', 'invertido', 'desde', 'rentabilidad'].map((k) => [
      k,
      String(form.get(k) ?? '').trim(),
    ]),
  ) as Record<string, string>;
  const errors: Record<string, string> = {};
  if (!values.cuenta) errors.cuenta = 'Elige la cuenta';
  if (!values.name || values.name.length > 60) errors.name = 'Ponle un nombre (hasta 60 letras)';
  const invested = parseEuros(values.invertido);
  if (!invested || invested <= 0 || invested > MAX_CENTS)
    errors.invertido = 'Escribe lo que invertiste, por ejemplo 300';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(values.desde) || values.desde > today.slice(0, 7))
    errors.desde = 'Elige el mes en que invertiste, como mucho este';
  // Empty is 0 %: the most prudent.
  const rate = parsePercent(values.rentabilidad || '0');
  if (rate === null || rate < -10_000 || rate > 10_000)
    errors.rentabilidad = 'Escribe un porcentaje entre −100 y 100, por ejemplo 6';
  if (Object.keys(errors).length) return { ok: false as const, values, errors };
  const input: EstimateInput = {
    accountId: values.cuenta,
    name: values.name,
    investedCents: invested!,
    since: `${values.desde}-01` as Day,
    rateBp: rate!,
  };
  return { ok: true as const, values, input };
}

// Null when the account is not one of the user's brokers or crypto accounts they can change.
export async function addEstimate(
  db: Db,
  userId: string,
  day: Day,
  e: EstimateInput,
): Promise<string | null> {
  if (!(await estimateAccounts(db, userId)).some((a) => a.id === e.accountId)) return null;
  return db.transaction(async (tx) => {
    const [{ id }] = await tx.query<{ id: string }>(
      `insert into instrument (kind, name, currency, owner_user_id)
       values ('estimado', $1, 'EUR', $2) returning id`,
      [e.name, userId],
    );
    await tx.query(
      `insert into estimate_config (account_id, instrument_id, annual_rate_bp, since_on)
       values ($1, $2, $3, $4)`,
      [e.accountId, id, e.rateBp, e.since],
    );
    // One unit at what was put in, in euros ×10^8.
    await tx.query(
      `insert into movement (account_id, day, seq, kind, amount_cents, instrument_id, qty_e8,
         price_e8, fx_e8, source, note)
       values ($1, $2, 0, 'ajuste', 0, $3, $4, $5, $4, 'manual', $6)`,
      [
        e.accountId,
        day,
        id,
        E8.toString(),
        (BigInt(e.investedCents) * 1_000_000n).toString(),
        ADDED,
      ],
    );
    return id!;
  });
}
