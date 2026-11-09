import { type Month, daysInMonth } from './dates.ts';

// A civil day 'YYYY-MM-DD' in Europe/Madrid. The engine never sees hours or time zones: the
// server turns "now" into today's Madrid date once, and everything else is calendar arithmetic.
export type Day = string;

const toUtc = (d: Day) =>
  Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const DAY_MS = 86_400_000;
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
// Days since 1970-01-01 → 'YYYY-MM-DD' by calendar arithmetic (H. Hinnant's civil_from_days):
// the projection walks ~11.000 days per scenario and `toISOString` was most of its time.
function fromUtc(ms: number): Day {
  const z = Math.floor(ms / DAY_MS) + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

export const addDays = (d: Day, n: number): Day => fromUtc(toUtc(d) + n * DAY_MS);
export const daysBetween = (from: Day, to: Day): number =>
  Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
export const monthOf = (d: Day): Month => d.slice(0, 7);
export const dayOfMonth = (d: Day): number => Number(d.slice(8, 10));
// ISO weekday: 1 = Monday … 7 = Sunday.
export const weekday = (d: Day): number => ((new Date(toUtc(d)).getUTCDay() + 6) % 7) + 1;
export const isWeekend = (d: Day): boolean => weekday(d) >= 6;
export const daysInYear = (d: Day): number =>
  daysInMonth(`${d.slice(0, 4)}-02`) === 29 ? 366 : 365;

// Day `day` of month `m`, clamped: the 31st of February is its last day.
export const dayIn = (m: Month, day: number): Day =>
  `${m}-${String(Math.min(day, daysInMonth(m))).padStart(2, '0')}`;

// Today in Madrid, for the server's edge. The engine itself only takes Days.
export const madridToday = (now = new Date()): Day =>
  now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

// Every day after `from` up to `to` included: the days a run has to generate.
export function* daysAfter(from: Day, to: Day): Generator<Day> {
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) yield d;
}
