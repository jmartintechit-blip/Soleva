import type { Day } from '#lib/engine/day.ts';
import { parseEuros, roundHalfAwayFromZero } from '#lib/engine/money.ts';
import { assetIndex, propertyCents, vehicleIndex, wholeYears } from '#lib/engine/valuation.ts';
import { ASSET_KINDS } from '#lib/labels.ts';
import { MAX_CENTS } from './accounts.ts';
import type { Db } from './db/index.ts';

// RCoche and RBien (b12): a car valued by Hacienda's tables (or the user's value, at the same
// pace) and another good losing a yearly percentage. Each value put in (the opening, a value by
// hand later) follows the curve from its own day, as the engine does.

export interface VehicleModel {
  id: string;
  brand: string;
  model: string;
  period: string | null;
  fuel: string | null;
  cc: number | null;
  kw: number | null;
  valueCents: number;
}

// Models of the latest yearly order whose brand and model have every word typed.
export async function searchVehicles(db: Db, q: string): Promise<VehicleModel[]> {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.join('').length || words.join('').length < 2) return [];
  return db.query<VehicleModel & Record<string, unknown>>(
    `select id, brand, model, period, fuel, cc, kw::float8 as kw, value_cents::float8 as "valueCents"
     from vehicle_base
     where order_year = (select max(order_year) from vehicle_base)
       and (select bool_and(lower(brand || ' ' || model) like '%' || w || '%') from unnest($1::text[]) w)
     order by brand, model, period limit 8`,
    [words],
  );
}

const table = (db: Db, baseId: string) =>
  db.query<{ yearsOver: number; pctBp: number; valueCents: number }>(
    `select d.years_over as "yearsOver", d.pct_bp as "pctBp", b.value_cents::float8 as "valueCents"
     from vehicle_base b join vehicle_depreciation d on d.order_year = b.order_year
     where b.id = $1 order by d.years_over`,
    [baseId],
  );

// Hacienda's value of a model on `day`: Anexo I × the Anexo IV percentage for its whole years.
export async function haciendaValue(db: Db, baseId: string, firstRegistration: Day, day: Day) {
  const rows = await table(db, baseId);
  if (!rows.length) return null;
  const years = wholeYears(firstRegistration, day);
  const row = rows.findLast((r) => r.yearsOver <= years) ?? rows[0]!;
  return {
    newCents: rows[0]!.valueCents,
    pctBp: row.pctBp,
    years,
    cents: roundHalfAwayFromZero((rows[0]!.valueCents * row.pctBp) / 10_000),
    curve: rows.map(({ yearsOver, pctBp }) => ({ yearsOver, pctBp })),
  };
}

export interface GoodInput {
  name: string;
  // Car: its model in the table (null: only the user's value) and first registration.
  baseId?: string | null;
  firstRegistration?: Day;
  // Another good: its kind, what it cost and when, and its yearly loss.
  category?: string;
  purchaseCents?: number;
  purchasedOn?: Day;
  annualLossBp?: number;
  // The user's value today (wins over the table or the curve).
  ownCents?: number | null;
}

const refused = (e: unknown) => (e as { code?: string }).code === 'P0001';

async function account(db: Db, userId: string, id: string) {
  const [a] = await db.query<{ name: string; kind: string; role: string }>(
    `select a.name, a.kind, x.role from money_account a
     join account_access x on x.account_id = a.id and x.user_id = $1 where a.id = $2`,
    [userId, id],
  );
  return a ?? null;
}

const flowsOf = (db: Db, id: string) =>
  db.query<{ day: Day; cents: number }>(
    `select day::text as day, amount_cents::float8 as cents from movement
     where account_id = $1 and voided_at is null order by day, seq`,
    [id],
  );

// A car or good the user can see: its details and what it is worth on `day`; null otherwise.
export async function goodView(db: Db, userId: string, id: string, day: Day) {
  const a = await account(db, userId, id);
  if (!a || !['vehiculo', 'bien'].includes(a.kind)) return null;
  const [v] = await db.query<{
    baseId: string | null;
    firstRegistration: Day;
    override: number | null;
  }>(
    `select vehicle_base_id as "baseId", first_registration::text as "firstRegistration",
            override_cents::float8 as override from vehicle where account_id = $1`,
    [id],
  );
  const [g] = await db.query<{
    category: string;
    purchaseCents: number;
    purchasedOn: Day;
    annualLossBp: number;
  }>(
    `select category, purchase_cents::float8 as "purchaseCents", purchased_on::text as "purchasedOn",
            annual_loss_bp as "annualLossBp" from asset where account_id = $1`,
    [id],
  );
  if (!v && !g) return null;
  const flows = await flowsOf(db, id);
  const model = v?.baseId
    ? ((
        await db.query<VehicleModel & Record<string, unknown>>(
          `select id, brand, model, period, fuel, cc, kw::float8 as kw,
                  value_cents::float8 as "valueCents" from vehicle_base where id = $1`,
          [v.baseId],
        )
      )[0] ?? null)
    : null;
  const hacienda = v?.baseId ? await haciendaValue(db, v.baseId, v.firstRegistration, day) : null;
  const index = v
    ? vehicleIndex(hacienda?.curve ?? [], v.firstRegistration)
    : assetIndex(g!.annualLossBp, g!.purchasedOn);
  return {
    id,
    name: a.name,
    canEdit: a.role === 'propietario' || a.role === 'editor',
    valueCents: propertyCents(flows, index, day),
    car: v ? { ...v, model, hacienda, own: v.override !== null } : null,
    good: g ?? null,
  };
}

// What a new one is worth today: the user's value, the table's or what is left of its price.
async function startValue(db: Db, p: GoodInput, day: Day) {
  if (p.ownCents) return p.ownCents;
  if (p.baseId)
    return (await haciendaValue(db, p.baseId, p.firstRegistration!, day))?.cents ?? null;
  if (p.purchaseCents && p.purchasedOn)
    return propertyCents(
      [{ day: p.purchasedOn, cents: p.purchaseCents }],
      assetIndex(p.annualLossBp ?? 0, p.purchasedOn),
      day,
    );
  return null;
}

// Opens a car (`baseId` or own value) or a good, with its value today. 'sin_valor' when there
// is none to give it.
export async function createGood(
  db: Db,
  userId: string,
  day: Day,
  kind: 'vehiculo' | 'bien',
  p: GoodInput,
): Promise<string | 'sin_valor'> {
  const cents = await startValue(db, p, day);
  if (!cents) return 'sin_valor';
  return db.transaction(async (tx) => {
    const [{ id }] = await tx.query<{ id: string }>(
      `insert into money_account (user_id, name, kind, balance_cents, opened_on)
       values ($1, $2, $3, 0, $4) returning id`,
      [userId, p.name, kind, day],
    );
    if (kind === 'vehiculo')
      await tx.query(
        `insert into vehicle (account_id, vehicle_base_id, first_registration, override_cents)
         values ($1, $2, $3, $4)`,
        [id, p.baseId ?? null, p.firstRegistration, p.ownCents ?? null],
      );
    else
      await tx.query(
        `insert into asset (account_id, category, purchase_cents, purchased_on, annual_loss_bp)
         values ($1, $2, $3, $4, $5)`,
        [id, p.category, p.purchaseCents, p.purchasedOn, p.annualLossBp],
      );
    await tx.query(
      `insert into movement (account_id, day, kind, amount_cents, source)
       values ($1, $2, 'apertura', $3, 'manual')`,
      [id, day, cents],
    );
    return id!;
  });
}

// Changes its details. A value of the user's goes in as an adjustment of today (it wins from
// then, along the curve); changing the model, the registration or the price does too, to what
// the table or the curve says today. Null without the right to change it.
export async function updateGood(
  db: Db,
  userId: string,
  id: string,
  day: Day,
  p: GoodInput,
): Promise<true | null> {
  const before = await goodView(db, userId, id, day);
  if (!before?.canEdit) return null;
  let target: number | null = null;
  if (p.ownCents) target = p.ownCents;
  else if (
    before.car &&
    (p.baseId !== before.car.baseId ||
      p.firstRegistration !== before.car.firstRegistration ||
      before.car.own)
  )
    target = await startValue(db, { ...p, ownCents: null }, day);
  else if (
    before.good &&
    (p.purchaseCents !== before.good.purchaseCents || p.purchasedOn !== before.good.purchasedOn)
  )
    target = await startValue(db, p, day);
  try {
    await db.transaction(async (tx) => {
      await tx.query(`update money_account set name = $2 where id = $1`, [id, p.name]);
      if (before.car)
        await tx.query(
          `update vehicle set vehicle_base_id = $2, first_registration = $3, override_cents = $4
           where account_id = $1`,
          [id, p.baseId ?? null, p.firstRegistration, p.ownCents ?? null],
        );
      else
        await tx.query(
          `update asset set category = $2, purchase_cents = $3, purchased_on = $4,
             annual_loss_bp = $5 where account_id = $1`,
          [id, p.category, p.purchaseCents, p.purchasedOn, p.annualLossBp],
        );
      if (target && target !== before.valueCents)
        await tx.query(
          `insert into movement (account_id, day, kind, amount_cents, source)
           values ($1, $2, 'ajuste', $3, 'manual')`,
          [id, day, target - before.valueCents],
        );
    });
  } catch (error) {
    if (refused(error)) return null;
    throw error;
  }
  return true;
}

// A home or car from v0, on the ledger without its details (B12 tarea 11): valued at its balance
// until the user completes it in RInmueble or RCoche, and given up or deleted like the others.
// Null for anything else, given up, or someone else's.
export async function bareAsset(db: Db, userId: string, id: string) {
  const [a] = await db.query<{ name: string; kind: string; role: string }>(
    `select a.name, a.kind, x.role from money_account a
     join account_access x on x.account_id = a.id and x.user_id = $1
     where a.id = $2 and a.kind in ('inmueble', 'vehiculo') and a.closed_on is null
       and not exists (select 1 from property where account_id = a.id)
       and not exists (select 1 from vehicle where account_id = a.id)
       and exists (select 1 from engine_state where user_id = $1)`,
    [userId, id],
  );
  if (!a) return null;
  return {
    id,
    name: a.name,
    page: a.kind === 'inmueble' ? ('inmueble' as const) : ('coche' as const),
    canEdit: a.role === 'propietario' || a.role === 'editor',
  };
}

// Completes a bare car (see bareAsset): its details from today and, as a value put in, an
// adjustment of today to what the table (or the user) says it is worth. Null if it is not one the
// user can change; 'sin_valor' with no value to give it.
export async function completeGood(
  db: Db,
  userId: string,
  id: string,
  day: Day,
  p: GoodInput,
): Promise<true | 'sin_valor' | null> {
  const bare = await bareAsset(db, userId, id);
  if (!bare?.canEdit || bare.page !== 'coche') return null;
  const target = await startValue(db, p, day);
  if (!target) return 'sin_valor';
  try {
    await db.transaction(async (tx) => {
      await tx.query(`update money_account set name = $2 where id = $1`, [id, p.name]);
      await tx.query(
        `insert into vehicle (account_id, vehicle_base_id, first_registration, override_cents)
         values ($1, $2, $3, $4)`,
        [id, p.baseId ?? null, p.firstRegistration, p.ownCents ?? null],
      );
      const now = (await goodView(tx, userId, id, day))!.valueCents;
      if (target !== now)
        await tx.query(
          `insert into movement (account_id, day, kind, amount_cents, source)
           values ($1, $2, 'ajuste', $3, 'manual')`,
          [id, day, target - now],
        );
    });
  } catch (error) {
    if (refused(error)) return null;
    throw error;
  }
  return true;
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// RCoche's and RBien's forms.
export function readGoodForm(form: FormData, kind: 'vehiculo' | 'bien', today: Day) {
  const one = (k: string) => String(form.get(k) ?? '').trim();
  const values = Object.fromEntries(
    ['name', 'modelo', 'matriculacion', 'mio', 'valor', 'tipo', 'precio', 'cuando', 'pierde'].map(
      (k) => [k, one(k)],
    ),
  ) as Record<string, string>;
  const errors: Record<string, string> = {};
  if (!values.name || values.name.length > 60) errors.name = 'Ponle un nombre (hasta 60 letras)';
  const own = values.mio ? parseEuros(values.valor) : null;
  if (values.mio && (own === null || own <= 0 || own > MAX_CENTS))
    errors.valor = 'Escribe lo que vale, por ejemplo 2.910';
  if (kind === 'vehiculo') {
    if (!isDay(values.matriculacion) || values.matriculacion > today)
      errors.matriculacion = 'Elige la fecha de la primera matriculación';
    if (!values.modelo && !values.mio) errors.modelo = 'Elige el modelo o pon tu valor';
  } else {
    if (!ASSET_KINDS.some((k) => k.kind === values.tipo)) errors.tipo = 'Elige qué es';
    const price = parseEuros(values.precio);
    if (price === null || price <= 0 || price > MAX_CENTS)
      errors.precio = 'Escribe lo que pagaste, por ejemplo 1.800';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(values.cuando) || `${values.cuando}-01` > today)
      errors.cuando = 'Elige cuándo lo compraste';
    const loss = Number(values.pierde);
    if (!Number.isInteger(loss) || loss < 0 || loss > 100)
      errors.pierde = 'Elige cuánto pierde al año';
  }
  if (Object.keys(errors).length) return { ok: false as const, values, errors };
  return {
    ok: true as const,
    values,
    input: (kind === 'vehiculo'
      ? {
          name: values.name!,
          baseId: values.modelo || null,
          firstRegistration: values.matriculacion!,
          ownCents: own,
        }
      : {
          name: values.name!,
          category: values.tipo!,
          purchaseCents: parseEuros(values.precio)!,
          purchasedOn: `${values.cuando}-01`,
          annualLossBp: Number(values.pierde) * 100,
          ownCents: own,
        }) satisfies GoodInput,
  };
}
