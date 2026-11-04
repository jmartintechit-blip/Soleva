import { z } from 'zod';
import type { Account } from '#lib/engine/rules.ts';
import type { Db } from './db/index.ts';

export const MAX_CENTS = 99_999_999_999;

export const KINDS = [
  'efectivo',
  'remunerada',
  'inversion',
  'pension',
  'cripto',
  'inmueble',
  'vehiculo',
  'otro',
  'deuda',
] as const;

export const accountInput = z.object({
  name: z.string().trim().min(1, 'Ponle un nombre').max(60, 'Máximo 60 caracteres'),
  kind: z.enum(KINDS, 'Elige un tipo de cuenta'),
  balanceCents: z
    .number('Escribe un importe, por ejemplo 1.250,50')
    .int()
    .min(0, 'No puede ser negativo')
    .max(MAX_CENTS, 'Importe demasiado alto'),
  isEstimated: z.boolean(),
  annualRateBp: z
    .number('Escribe un porcentaje, por ejemplo 2,5')
    .int()
    .min(-10_000, 'Entre −100 % y 100 %')
    .max(10_000, 'Entre −100 % y 100 %'),
});
export type AccountInput = z.infer<typeof accountInput>;

export interface MoneyAccount extends Account {
  name: string;
  isEstimated: boolean;
  archived: boolean;
  // Given up (b12, baja) on that day.
  closedOn: string | null;
}

const columns = `id, name, kind, balance_cents::float8 as "balanceCents", is_estimated as "isEstimated",
  annual_rate_bp as "annualRateBp", archived_at is not null as archived,
  closed_on::text as "closedOn"`;

// Every query goes through account_access for userId ($1): someone else's id matches nothing.
const can = (roles: string) =>
  `id in (select account_id from account_access where user_id = $1 and role in (${roles}))`;
const READ = can(`'propietario', 'editor', 'lector'`);
const WRITE = can(`'propietario', 'editor'`);
const OWN = can(`'propietario'`);

export const listAccounts = (db: Db, userId: string) =>
  db.query<MoneyAccount & Record<string, unknown>>(
    `select ${columns} from money_account where ${READ} order by archived, created_at, id`,
    [userId],
  );

export async function getAccount(db: Db, userId: string, id: string) {
  const [row] = await db.query<MoneyAccount & Record<string, unknown>>(
    `select ${columns} from money_account where ${READ} and id = $2`,
    [userId, id],
  );
  return row ?? null;
}

export async function createAccount(db: Db, userId: string, a: AccountInput) {
  const [row] = await db.query<{ id: string }>(
    `insert into money_account (user_id, name, kind, balance_cents, is_estimated, annual_rate_bp)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [userId, a.name, a.kind, a.balanceCents, a.isEstimated, a.annualRateBp],
  );
  return row!.id;
}

// Each returns false when the account is not the user's (→ 404).
export async function updateAccount(db: Db, userId: string, id: string, a: AccountInput) {
  const rows = await db.query(
    `update money_account set name = $3, kind = $4, balance_cents = $5, is_estimated = $6,
       annual_rate_bp = $7, updated_at = now()
     where ${WRITE} and id = $2 returning id`,
    [userId, id, a.name, a.kind, a.balanceCents, a.isEstimated, a.annualRateBp],
  );
  return rows.length > 0;
}

export async function setArchived(db: Db, userId: string, id: string, archived: boolean) {
  const rows = await db.query(
    `update money_account set archived_at = case when $3 then coalesce(archived_at, now()) end,
       updated_at = now()
     where ${WRITE} and id = $2 returning id`,
    [userId, id, archived],
  );
  return rows.length > 0;
}

// Its rules go with it (on delete cascade). An account in a closed month stays, so history never
// changes: the deferred foreign key of month_close_line refuses it and this returns 'closed'.
export async function deleteAccount(db: Db, userId: string, id: string) {
  try {
    const rows = await db.query(`delete from money_account where ${OWN} and id = $2 returning id`, [
      userId,
      id,
    ]);
    return rows.length > 0;
  } catch (error) {
    if ((error as { code?: string }).code === '23503') return 'closed';
    throw error;
  }
}
