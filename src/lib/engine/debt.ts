import { addMonths, monthsBetween } from './dates.ts';
import { type Day, dayIn, dayOfMonth, monthOf } from './day.ts';
import { roundHalfAwayFromZero } from './money.ts';

export interface DebtTerms {
  principalCents: number;
  startOn: Day;
  firstPaymentOn: Day;
  termMonths: number;
  rateType: 'fijo' | 'variable';
  initialRateBp: number;
  // Variable only: the official index of each month ('YYYY-MM' → bp), the spread, how often it is
  // reviewed (from the first payment) and the floor, if the contract has one.
  index?: Record<string, number>;
  spreadBp?: number;
  reviewMonths?: number;
  floorBp?: number;
  // Mixed: the first `fixedMonths` payments keep the initial rate; the first review is the next
  // one, and from there every `reviewMonths`.
  fixedMonths?: number;
}

export interface Payment {
  day: Day;
  rateBp: number;
  paymentCents: number;
  interestCents: number;
  principalCents: number;
  outstandingCents: number;
}

// French system: a constant payment C = P·i / (1 − (1+i)^−n), with i the monthly rate.
export function annuityCents(principalCents: number, rateBp: number, months: number): number {
  const i = rateBp / 10_000 / 12;
  if (i === 0) return roundHalfAwayFromZero(principalCents / months);
  return roundHalfAwayFromZero((principalCents * i) / (1 - (1 + i) ** -months));
}

// The latest index published by `month`, two months back (the usual lag of Spanish mortgages).
// However old it is: a review years ahead takes today's Euribor, as the projection assumes.
export function indexFor(t: DebtTerms, reviewMonth: string): number | undefined {
  const by = addMonths(reviewMonth, -2);
  let best: string | undefined;
  for (const m of Object.keys(t.index ?? {}))
    if (m <= by && (best === undefined || m > best)) best = m;
  return best === undefined ? undefined : t.index![best];
}

const isReview = (t: DebtTerms, k: number) => {
  const fixed = t.fixedMonths ?? 0;
  return k > 0 && k >= fixed && (k - fixed) % t.reviewMonths! === 0;
};

// Every payment of the loan: interest on what is owed, the rest lowers it; a variable rate is
// reset at each review (index + spread, never under the floor) and the payment recomputed for
// the months left. The last payment clears the rounding.
export function amortization(t: DebtTerms): Payment[] {
  const first = monthOf(t.firstPaymentOn);
  const day = dayOfMonth(t.firstPaymentOn);
  const out: Payment[] = [];
  let owed = t.principalCents;
  let rate = t.initialRateBp;
  let pay = annuityCents(owed, rate, t.termMonths);
  for (let k = 0; k < t.termMonths && owed > 0; k++) {
    const m = addMonths(first, k);
    if (t.rateType === 'variable' && isReview(t, k)) {
      const idx = indexFor(t, m);
      if (idx !== undefined) {
        const next = Math.max(t.floorBp ?? -Infinity, idx + t.spreadBp!, 0);
        if (next !== rate) {
          rate = next;
          pay = annuityCents(owed, rate, t.termMonths - k);
        }
      }
    }
    const interest = roundHalfAwayFromZero((owed * rate) / 10_000 / 12);
    const principal = k === t.termMonths - 1 ? owed : Math.min(owed, pay - interest);
    owed -= principal;
    out.push({
      day: dayIn(m, day),
      rateBp: rate,
      paymentCents: interest + principal,
      interestCents: interest,
      principalCents: principal,
      outstandingCents: owed,
    });
  }
  return out;
}

// What is still owed after the payments up to `day` (included).
export function outstandingOn(t: DebtTerms, day: Day): number {
  const paid = amortization(t).filter((p) => p.day <= day);
  return paid.length ? paid.at(-1)!.outstandingCents : t.principalCents;
}

export const monthsLeft = (t: DebtTerms, day: Day) =>
  Math.max(0, t.termMonths - monthsBetween(monthOf(t.firstPaymentOn), monthOf(day)));

// The months a French loan of `principalCents` takes at `rateBp` with a payment of `paymentCents`,
// to the nearest whole month (a bank's payment is the annuity of a whole term); null if the
// payment does not cover a month's interest.
export function monthsForPayment(
  principalCents: number,
  rateBp: number,
  paymentCents: number,
): number | null {
  const i = rateBp / 10_000 / 12;
  if (paymentCents <= 0) return null;
  if (i === 0) return Math.max(1, Math.round(principalCents / paymentCents));
  const share = (principalCents * i) / paymentCents;
  if (share >= 1) return null;
  return Math.max(1, Math.round(-Math.log(1 - share) / Math.log(1 + i)));
}
