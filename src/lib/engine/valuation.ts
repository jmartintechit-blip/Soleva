import { addMonths } from './dates.ts';
import { type Day, addDays, dayIn, dayOfMonth, daysBetween, monthOf } from './day.ts';
import { roundHalfAwayFromZero } from './money.ts';

// Whole years from `from` to `on` (an anniversary counts as a full year).
export function wholeYears(from: Day, on: Day): number {
  let years = Number(on.slice(0, 4)) - Number(from.slice(0, 4));
  if (on.slice(5) < from.slice(5)) years--;
  return Math.max(0, years);
}

// Hacienda (Orden HAC/1501/2025): Anexo I value × the Anexo IV percentage for the whole years
// since first registration; past the table's last row, its last percentage. Steps once a year,
// as the official table does.
export function vehicleCents(
  baseCents: number,
  table: { yearsOver: number; pctBp: number }[],
  firstRegistration: Day,
  on: Day,
): number {
  const years = wholeYears(firstRegistration, on);
  const rows = [...table].sort((a, b) => a.yearsOver - b.yearsOver);
  const row = rows.findLast((r) => r.yearsOver <= years) ?? rows[0]!;
  return roundHalfAwayFromZero((baseCents * row.pctBp) / 10_000);
}

// Other goods: what is left of the price after n years per its curve (100 % at purchase), drawn
// straight between anniversaries so it drops a little every day; after the last row, flat.
export function assetCents(
  purchaseCents: number,
  curve: { years: number; pctBp: number }[],
  purchasedOn: Day,
  on: Day,
): number {
  const points = [{ years: 0, pctBp: 10_000 }, ...[...curve].sort((a, b) => a.years - b.years)];
  const years = wholeYears(purchasedOn, on);
  const i = points.findLastIndex((p) => p.years <= years);
  const a = points[i]!;
  const b = points[i + 1];
  let pct = a.pctBp;
  if (b) {
    const start = anniversary(purchasedOn, a.years);
    const end = anniversary(purchasedOn, b.years);
    pct += ((b.pctBp - a.pctBp) * daysBetween(start, on)) / daysBetween(start, end);
  }
  return roundHalfAwayFromZero((purchaseCents * pct) / 10_000);
}

// 29 February's anniversary in a common year is 28 February.
export function anniversary(d: Day, years: number): Day {
  const y = Number(d.slice(0, 4)) + years;
  const candidate = `${y}${d.slice(4)}`;
  return d.slice(5) === '02-29' && addDays(`${y}-02-28`, 1).slice(5) !== '02-29'
    ? `${y}-02-28`
    : candidate;
}

// A product without a public price: each contribution grows at the user's yearly rate since its
// day (an estimate, and always shown as one).
export function estimateCents(
  contributions: { day: Day; cents: number }[],
  annualRateBp: number,
  on: Day,
): number {
  const r = 1 + annualRateBp / 10_000;
  return roundHalfAwayFromZero(
    contributions
      .filter((c) => c.day <= on)
      .reduce((s, c) => s + c.cents * r ** (daysBetween(c.day, on) / 365), 0),
  );
}

// A home: each value put into it (the opening, a value set by hand later) follows INE's housing
// price index of its region from the quarter that value refers to (`from`, else its day) to the
// latest quarter published up to `on`. The ratios chain, so a value set by hand is exactly that
// value on its day and moves with the index from there. Without the index, values stay as given.
export function propertyCents(
  flows: { day: Day; cents: number; from?: Day }[],
  index: { quarter: Day; indexE3: number }[],
  on: Day,
): number {
  const at = (d: Day) => index.findLast((x) => x.quarter <= d)?.indexE3;
  const now = at(on);
  let sum = 0;
  for (const f of flows) {
    if (f.day > on) continue;
    const base = at(f.from ?? f.day);
    sum += now && base ? (f.cents * now) / base : f.cents;
  }
  return roundHalfAwayFromZero(sum);
}

// A car's curve for propertyCents: Hacienda's Anexo IV percentage from each anniversary of its
// first registration (a value put in moves with it, as the table steps once a year).
export const vehicleIndex = (
  table: { yearsOver: number; pctBp: number }[],
  firstRegistration: Day,
) =>
  [...table]
    .sort((a, b) => a.yearsOver - b.yearsOver)
    .map((r) => ({ quarter: anniversary(firstRegistration, r.yearsOver), indexE3: r.pctBp }));

// Another good's curve: it loses `annualLossBp` a year, a little each month, for 50 years.
export function assetIndex(annualLossBp: number, purchasedOn: Day) {
  if (annualLossBp <= 0) return [];
  const keep = 1 - annualLossBp / 10_000;
  return Array.from({ length: 601 }, (_, k) => ({
    quarter: dayIn(addMonths(monthOf(purchasedOn), k), dayOfMonth(purchasedOn)),
    indexE3: Math.max(1, Math.round(1_000_000 * keep ** (k / 12))),
  }));
}
