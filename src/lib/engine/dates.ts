// A month is 'YYYY-MM'. The engine trusts its callers: inputs are validated at the boundary.
export type Month = string;

const index = (m: Month) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const fromIndex = (i: number): Month =>
  `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

export const addMonths = (m: Month, n: number): Month => fromIndex(index(m) + n);
export const monthsBetween = (from: Month, to: Month): number => index(to) - index(from);

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function daysInMonth(m: Month): number {
  const y = Number(m.slice(0, 4));
  const n = Number(m.slice(5, 7));
  return n === 2 && y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : DAYS[n - 1]!;
}

// A rule on day 31 falls on the last day of shorter months (30, 29 or 28).
export const ruleDay = (day: number, m: Month): number => Math.min(day, daysInMonth(m));

export type Frequency = 'mensual' | 'trimestral' | 'anual' | 'una_vez';
const STEP: Record<Exclude<Frequency, 'una_vez'>, number> = {
  mensual: 1,
  trimestral: 3,
  anual: 12,
};

// Repeats every 1, 3 or 12 months from its start, up to its end month included.
export function occursIn(
  {
    frequency,
    startMonth,
    endMonth,
  }: { frequency: Frequency; startMonth: Month; endMonth?: Month },
  m: Month,
): boolean {
  const k = monthsBetween(startMonth, m);
  if (k < 0 || (endMonth && monthsBetween(endMonth, m) > 0)) return false;
  return frequency === 'una_vez' ? k === 0 : k % STEP[frequency] === 0;
}
