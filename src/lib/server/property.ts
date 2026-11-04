import type { Day } from '#lib/engine/day.ts';
import { parseEuros, roundHalfAwayFromZero } from '#lib/engine/money.ts';
import { M2_STEP, propertyCents } from '#lib/engine/valuation.ts';
import { PROPERTY_KINDS, PROVINCE_NAME, type PropertyKind } from '#lib/labels.ts';
import { MAX_CENTS } from './accounts.ts';
import { openAccount } from './alta.ts';
import type { Db } from './db/index.ts';
import { normalize } from './housing.ts';

// Vivienda o inmueble (b12/RInmueble, LEEME-B12-inmueble): always an asset, its mortgage apart.

export interface Place {
  code: string;
  name: string;
  province: string;
}

const place = (r: { code: string; name: string }): Place => ({
  code: r.code,
  name: r.name,
  province: PROVINCE_NAME[r.code.slice(0, 2)] ?? '',
});

// Municipalities whose name has the text, those that start with it first.
export async function searchMunicipalities(db: Db, q: string): Promise<Place[]> {
  const text = normalize(q.slice(0, 60));
  if (text.length < 2) return [];
  const rows = await db.query<{ code: string; name: string }>(
    `select code, name from municipality where search like '%' || $1 || '%'
     order by search like $1 || '%' desc, length(name), name limit 8`,
    [text],
  );
  return rows.map(place);
}

export interface PlaceInfo {
  place: Place;
  // INE's code of its community, for «el índice del INE para …».
  region: string;
  // How much the region's index rose over the last four quarters: shown only to say it is NOT
  // used as a forecast.
  lastYearBp: number | null;
  // The index's latest quarter (INE, second-hand homes), for the note.
  indexQuarter: Day | null;
  // The Ministry of Housing's average appraised value per m², of the municipality or, under
  // 25.000 inhabitants, of its province; null when neither is known.
  m2: {
    area: 'municipio' | 'provincia';
    eurM2Cents: number;
    quarter: Day;
    // The same, brought to the region's latest quarter of the index (as is until a newer one).
    todayEurM2Cents: number;
  } | null;
}

// Null when there is no such municipality.
export async function placeOf(db: Db, code: string): Promise<PlaceInfo | null> {
  const [r] = await db.query<{
    code: string;
    name: string;
    region: string;
    area: string | null;
    quarter: Day | null;
    cents: number | null;
    now: number | null;
    then: number | null;
    ago: number | null;
    iq: Day | null;
  }>(
    `with m as (
       select m.code, m.name, m.region,
              coalesce((select z.region from housing_index z where z.region = m.region limit 1),
                       '00') as idx
       from municipality m where m.code = $1),
     v as (
       select a.area, a.quarter, a.eur_m2_cents from housing_m2 a, m
       where a.area in (m.code, left(m.code, 2)) order by length(a.area) desc limit 1)
     select m.code, m.name, m.region, v.area, v.quarter::text as quarter, v.eur_m2_cents as cents,
            (select index_e3 from housing_index where region = m.idx
             order by quarter desc limit 1) as now,
            (select index_e3 from housing_index where region = m.idx and quarter <= v.quarter
             order by quarter desc limit 1) as then,
            (select h.index_e3 from housing_index h where h.region = m.idx
               and h.quarter = (select max(quarter) from housing_index where region = m.idx)
                               - interval '1 year') as ago,
            (select max(quarter)::text from housing_index where region = m.idx) as iq
     from m left join v on true`,
    [code],
  );
  if (!r) return null;
  return {
    place: place(r),
    region: r.region,
    lastYearBp: r.now && r.ago ? Math.round((r.now / r.ago - 1) * 10_000) : null,
    indexQuarter: r.iq,
    m2:
      r.area && r.cents && r.quarter
        ? {
            area: r.area.length === 5 ? 'municipio' : 'provincia',
            eurM2Cents: r.cents,
            quarter: r.quarter,
            todayEurM2Cents:
              r.now && r.then ? roundHalfAwayFromZero((r.cents * r.now) / r.then) : r.cents,
          }
        : null,
  };
}

export interface PropertyInput {
  name: string;
  kind: PropertyKind;
  municipalityCode: string;
  areaM2: number;
  purchaseYear?: number;
  purchaseCents?: number;
  method: 'm2' | 'propio';
  // With 'propio': what it is worth today.
  ownCents?: number;
  growthBp: number;
  mortgageAccountId?: string;
}

const isRefused = (error: unknown) => (error as { code?: string }).code === 'P0001';

// Opens the property with its value: m² × the Ministry's €/m², which refers to the Ministry's
// quarter (the index moves it from there), or the user's own, from today. 'sin_dato' without a
// figure for the municipality or its province; null when the mortgage is not a debt the user
// can change.
export async function createProperty(
  db: Db,
  userId: string,
  day: Day,
  p: PropertyInput,
): Promise<string | 'sin_dato' | null> {
  let cents = p.ownCents ?? 0;
  let valueOn = day;
  if (p.method === 'm2') {
    const m2 = (await placeOf(db, p.municipalityCode))?.m2;
    if (!m2) return 'sin_dato';
    cents = toStep(p.areaM2 * m2.eurM2Cents);
    valueOn = m2.quarter;
  }
  try {
    return await db.transaction(async (tx) => {
      const [{ id }] = await tx.query<{ id: string }>(
        `insert into money_account (user_id, name, kind, balance_cents, opened_on)
         values ($1, $2, 'inmueble', 0, $3) returning id`,
        [userId, p.name, day],
      );
      await tx.query(
        `insert into property (account_id, kind, municipality_code, area_m2, purchase_year,
           purchase_cents, value_method, value_on, growth_bp, mortgage_account_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          p.kind,
          p.municipalityCode,
          p.areaM2,
          p.purchaseYear ?? null,
          p.purchaseCents ?? null,
          p.method,
          valueOn,
          p.growthBp,
          p.mortgageAccountId ?? null,
        ],
      );
      await tx.query(
        `insert into movement (account_id, day, kind, amount_cents, source)
         values ($1, $2, 'apertura', $3, 'manual')`,
        [id, day, cents],
      );
      return id!;
    });
  } catch (error) {
    if (isRefused(error)) return null;
    throw error;
  }
}

// The user's debts, to link one as the mortgage, with what is owed today (negative).
export async function debtsOf(db: Db, userId: string) {
  return db.query<{ id: string; name: string; cents: number }>(
    `select a.id, a.name,
            coalesce(sum(m.amount_cents) filter (where m.voided_at is null), 0)::float8 as cents
     from money_account a
     join account_access x on x.account_id = a.id and x.user_id = $1
       and x.role in ('propietario', 'editor')
     left join movement m on m.account_id = a.id
     where a.kind in ('deuda_hipoteca', 'deuda_prestamo') and a.archived_at is null
     group by a.id, a.name, a.created_at order by a.created_at, a.id`,
    [userId],
  );
}

export interface PropertyView {
  id: string;
  name: string;
  kind: PropertyKind;
  areaM2: number;
  purchaseYear: number | null;
  purchaseCents: number | null;
  method: 'm2' | 'propio';
  growthBp: number;
  mortgageAccountId: string | null;
  valueCents: number;
  // Before rounding by m²: what a value set by hand adjusts from.
  exactCents: number;
  info: PlaceInfo;
  canEdit: boolean;
}

// An estimate by m² is stored and shown to the hundred euros, so RInmueble, the Alta, Cuentas
// and Inicio say the same figure.
const toStep = (cents: number) => roundHalfAwayFromZero(cents / M2_STEP) * M2_STEP;

// What it is worth on `day`, from its own movements and its region's index (as the engine),
// before rounding.
async function valueOf(db: Db, id: string, valueOn: Day, region: string, day: Day) {
  const flows = await db.query<{ day: Day; cents: number; kind: string }>(
    `select day::text as day, amount_cents::float8 as cents, kind from movement
     where account_id = $1 and voided_at is null order by day, seq`,
    [id],
  );
  const index = await db.query<{ quarter: Day; indexE3: number }>(
    `select quarter::text as quarter, index_e3 as "indexE3" from housing_index
     where region = coalesce((select region from housing_index where region = $1 limit 1), '00')
     order by quarter`,
    [region],
  );
  return propertyCents(
    flows.map((f) => ({ ...f, from: f.kind === 'apertura' ? valueOn : undefined })),
    index,
    day,
  );
}

// The property behind an account the user can see; null otherwise (404).
export async function propertyView(
  db: Db,
  userId: string,
  id: string,
  day: Day,
): Promise<PropertyView | null> {
  const [r] = await db.query<{
    name: string;
    kind: PropertyKind;
    code: string;
    area: number;
    year: number | null;
    purchase: number | null;
    method: 'm2' | 'propio';
    valueOn: Day;
    growth: number;
    mortgage: string | null;
    role: string;
  }>(
    `select a.name, p.kind, p.municipality_code as code, p.area_m2 as area, p.purchase_year as year,
            p.purchase_cents::float8 as purchase, p.value_method as method,
            p.value_on::text as "valueOn", p.growth_bp as growth,
            p.mortgage_account_id as mortgage, x.role
     from property p join money_account a on a.id = p.account_id
     join account_access x on x.account_id = a.id and x.user_id = $1
     where p.account_id = $2`,
    [userId, id],
  );
  if (!r) return null;
  const info = (await placeOf(db, r.code))!;
  const exactCents = await valueOf(db, id, r.valueOn, info.region, day);
  return {
    id,
    name: r.name,
    kind: r.kind,
    areaM2: r.area,
    purchaseYear: r.year,
    purchaseCents: r.purchase,
    method: r.method,
    growthBp: r.growth,
    mortgageAccountId: r.mortgage,
    valueCents: r.method === 'm2' ? toStep(exactCents) : exactCents,
    exactCents,
    info,
    canEdit: r.role === 'propietario' || r.role === 'editor',
  };
}

// Changes what the user changed. A new value (their own, or the m² one after changing the m²
// or the method) goes in as an 'ajuste' of today: it wins from today and the index moves it from
// there. Null without the right to change it, or with a mortgage that is not theirs.
export async function updateProperty(
  db: Db,
  userId: string,
  id: string,
  day: Day,
  p: PropertyInput,
): Promise<true | 'sin_dato' | null> {
  const before = await propertyView(db, userId, id, day);
  if (!before?.canEdit) return null;
  let target: number | null = null;
  if (p.method === 'propio' && p.ownCents !== undefined && p.ownCents !== before.valueCents)
    target = p.ownCents;
  if (
    p.method === 'm2' &&
    (before.method !== 'm2' ||
      p.areaM2 !== before.areaM2 ||
      p.municipalityCode !== before.info.place.code)
  ) {
    const m2 = (await placeOf(db, p.municipalityCode))?.m2;
    if (!m2) return 'sin_dato';
    target = toStep(p.areaM2 * m2.todayEurM2Cents);
  }
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`update money_account set name = $2 where id = $1`, [id, p.name]);
      await tx.query(
        `update property set kind = $2, municipality_code = $3, area_m2 = $4, purchase_year = $5,
           purchase_cents = $6, value_method = $7, growth_bp = $8, mortgage_account_id = $9
         where account_id = $1`,
        [
          id,
          p.kind,
          p.municipalityCode,
          p.areaM2,
          p.purchaseYear ?? null,
          p.purchaseCents ?? null,
          p.method,
          p.growthBp,
          p.mortgageAccountId ?? null,
        ],
      );
      if (target !== null && target !== before.exactCents)
        await tx.query(
          `insert into movement (account_id, day, kind, amount_cents, source)
           values ($1, $2, 'ajuste', $3, 'manual')`,
          [id, day, target - before.exactCents],
        );
      return true as const;
    });
  } catch (error) {
    if (isRefused(error)) return null;
    throw error;
  }
}

export const GROWTH_BP = [0, 100, 200, 300, 400, 500];
const PROPERTY_KINDS_SET = new Set<string>(PROPERTY_KINDS.map((k) => k.kind));
const FIELDS = [
  'name',
  'kind',
  'municipio',
  'codigo',
  'm2',
  'ano',
  'precio',
  'metodo',
  'valor',
  'crecimiento',
  'hipoteca',
  'hipoteca_id',
  'hipoteca_debe',
] as const;
export type PropertyValues = Record<(typeof FIELDS)[number], string>;

// RInmueble's form, checked. The municipality is the one picked from the list or, without
// JavaScript, the one whose name is exactly what was typed; otherwise the candidates to pick.
// The mortgage: none, one of the user's debts, or 'nueva' with what is owed.
export async function readPropertyForm(db: Db, form: FormData, thisYear: number) {
  const values = Object.fromEntries(
    FIELDS.map((k) => [k, String(form.get(k) ?? '').trim()]),
  ) as PropertyValues;
  const errors: Partial<Record<(typeof FIELDS)[number] | 'form', string>> = {};
  let candidates: Place[] = [];
  let info = /^\d{5}$/.test(values.codigo) ? await placeOf(db, values.codigo) : null;
  if (!info) {
    // «Écija (Sevilla)», as the box shows it once picked, is Écija.
    const typed = values.municipio.replace(/\s*\([^)]*\)$/, '');
    candidates = await searchMunicipalities(db, typed);
    const exact = candidates.filter((c) => normalize(c.name) === normalize(typed));
    if (exact.length === 1) info = await placeOf(db, exact[0]!.code);
    else
      errors.municipio = values.municipio
        ? 'Elige tu municipio de la lista'
        : 'Escribe el municipio';
  }
  if (info) candidates = [];
  const kind = PROPERTY_KINDS_SET.has(values.kind) ? (values.kind as PropertyKind) : null;
  const area = /^\d{1,6}$/.test(values.m2) ? Number(values.m2) : null;
  const year = values.ano ? Number(values.ano) : undefined;
  const price = values.precio ? parseEuros(values.precio) : undefined;
  const own = values.valor ? parseEuros(values.valor) : undefined;
  const growth = Number(values.crecimiento || 200);
  const method = values.metodo === 'propio' ? 'propio' : 'm2';
  if (!values.name || values.name.length > 60) errors.name = 'Ponle un nombre (hasta 60 letras)';
  if (!kind) errors.kind = 'Elige qué es';
  if (!area || area > 100_000) errors.m2 = 'Escribe los m², por ejemplo 90';
  if (year !== undefined && !(Number.isInteger(year) && year >= 1900 && year <= thisYear))
    errors.ano = 'Escribe el año, por ejemplo 2018';
  if (price === null || (price !== undefined && (price <= 0 || price > MAX_CENTS)))
    errors.precio = 'Escribe el precio, por ejemplo 98.000';
  if (method === 'propio' && (own === undefined || own === null || own <= 0 || own > MAX_CENTS))
    errors.valor = 'Escribe lo que vale, por ejemplo 115.000';
  if (method === 'm2' && info && !info.m2)
    errors.valor = `No hay valor oficial para ${info.place.name} ni su provincia: pon tu valor`;
  if (!GROWTH_BP.includes(growth)) errors.crecimiento = 'Elige cuánto sube al año';
  let mortgage: { id?: string; newCents?: number } | null = null;
  if (values.hipoteca) {
    if (values.hipoteca_id && values.hipoteca_id !== 'nueva') mortgage = { id: values.hipoteca_id };
    else {
      const owed = parseEuros(values.hipoteca_debe);
      if (owed === null || owed <= 0 || owed > MAX_CENTS)
        errors.hipoteca_debe = 'Escribe lo que debes, por ejemplo 62.400';
      else mortgage = { newCents: owed };
    }
  }
  if (Object.keys(errors).length) return { ok: false as const, values, errors, candidates, info };
  return {
    ok: true as const,
    values,
    info: info!,
    mortgage,
    input: {
      name: values.name,
      kind: kind!,
      municipalityCode: info!.place.code,
      areaM2: area!,
      purchaseYear: year,
      purchaseCents: price ?? undefined,
      method,
      ownCents: own ?? undefined,
      growthBp: growth,
      mortgageAccountId: mortgage?.id,
    } satisfies PropertyInput,
  };
}

// «Una nueva» hipoteca: a debt with what is owed, opened after its home (the Alta lists them in that
// order) and linked to it; its terms come next, in RDeuda.
export async function openMortgage(
  db: Db,
  userId: string,
  day: Day,
  propertyId: string,
  name: string,
  cents: number,
): Promise<string> {
  const id = await openAccount(db, userId, day, {
    name: `Hipoteca de ${name}`.slice(0, 60),
    kind: 'deuda_hipoteca',
    cents,
  });
  await db.query(`update property set mortgage_account_id = $1 where account_id = $2`, [
    id,
    propertyId,
  ]);
  return id;
}
