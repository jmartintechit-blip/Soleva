import type { Scenario } from './compound.ts';
import { type DebtTerms, amortization, monthsForPayment } from './debt.ts';
import { type Day, dayOfMonth } from './day.ts';
import {
  DEFAULT_ASSUMPTIONS,
  type ProjectedAccount,
  type ProjectedRule,
  type ProjectionAssumptions,
  type ProjectionStep,
  inTodayEuros,
  projectLedger,
  stepDay,
} from './projection.ts';
import type { Unit } from './myplan.ts';

// «¿Qué pasa si…?» and «Amortizar o invertir» (LEEME-B13): each one changes a copy of the rules or
// the accounts and projects it again with the same engine. Nothing here is ever stored: the
// button takes the user to RPlan or RRegla, filled in, and only saving there changes anything.

const WHAT_IF = 'que-pasa-si';

// Put `cents` more a month into a plan (it buys more of its first product, paid from
// `fromAccountId` when its own account has no cash) or into an account (a transfer to it).
export function contributeMore(
  rules: readonly ProjectedRule[],
  to: { planId: string } | { accountId: string },
  fromAccountId: string,
  cents: number,
  today: Day,
): ProjectedRule[] {
  if (cents <= 0) return [...rules];
  const when = {
    frequency: 'mensual' as const,
    day: dayOfMonth(today),
    startOn: today,
    active: true,
  };
  if ('planId' in to) {
    const plan = rules.find((r) => r.id === to.planId && r.kind === 'plan');
    if (!plan?.legs[0]) return [...rules];
    return [
      ...rules,
      {
        ...when,
        id: WHAT_IF,
        kind: 'plan',
        fromAccountId: plan.fromAccountId,
        legs: [{ instrumentId: plan.legs[0].instrumentId, amountCents: cents }],
        shortfall: 'otra_cuenta',
        shortfallAccountId: fromAccountId,
      },
    ];
  }
  return [
    ...rules,
    {
      ...when,
      id: WHAT_IF,
      kind: 'transferencia',
      fromAccountId,
      toAccountId: to.accountId,
      amountCents: cents,
      legs: [],
    },
  ];
}

// A plan that buys nothing for the next `months` months; the money stays where it was.
export function pausePlan(
  rules: readonly ProjectedRule[],
  planId: string,
  months: number,
  today: Day,
): ProjectedRule[] {
  return rules.map((r) =>
    r.id === planId ? { ...r, pause: { from: today, to: stepDay(today, months) } } : r,
  );
}

// One expense of `cents` (in euros of today: it rises with «Tus ingresos y gastos», like any
// expense) from `fromAccountId`, `months` months from now.
export function oneOffExpense(
  rules: readonly ProjectedRule[],
  fromAccountId: string,
  cents: number,
  months: number,
  today: Day,
): ProjectedRule[] {
  return [
    ...rules,
    {
      id: WHAT_IF,
      kind: 'gasto',
      frequency: 'una_vez',
      startOn: stepDay(today, months),
      fromAccountId,
      amountCents: cents,
      legs: [],
      active: true,
    },
  ];
}

// The loan after paying `amountCents` off today: what is left, from its next payment, at the rate
// that payment has. «Reducir cuota» keeps the months left and lowers the payment; «reducir plazo»
// keeps the payment and pays it off sooner. A variable or mixed rate keeps its review months.
// Null if nothing is owed any more.
export function prepaid(
  t: DebtTerms,
  today: Day,
  amountCents: number,
  mode: 'plazo' | 'cuota',
): DebtTerms | null {
  const plan = amortization(t);
  const done = plan.filter((p) => p.day <= today).length;
  const next = plan[done];
  if (!next) return null;
  const owed = (done ? plan[done - 1]!.outstandingCents : t.principalCents) - amountCents;
  if (owed <= 0) return { ...t, principalCents: 0, termMonths: 0 };
  const left = plan.length - done;
  const months =
    mode === 'cuota'
      ? left
      : Math.min(left, monthsForPayment(owed, next.rateBp, next.paymentCents) ?? left);
  // Reviews keep their months: the first one left is `fixed` payments from the next one (a review
  // due on the next payment is already in its rate).
  let fixedMonths: number | undefined;
  if (t.rateType === 'variable') {
    const f = t.fixedMonths ?? 0;
    const r = t.reviewMonths!;
    fixedMonths = done < f ? f - done : (r - ((done - f) % r)) % r;
  }
  return {
    ...t,
    principalCents: owed,
    startOn: today,
    firstPaymentOn: next.day,
    termMonths: months,
    initialRateBp: next.rateBp,
    fixedMonths,
  };
}

// The interest still to pay, as agreed with the bank: in euros of then, whatever the unit.
const interestAfter = (t: DebtTerms, today: Day) =>
  amortization(t)
    .filter((p) => p.day > today)
    .reduce((s, p) => s + p.interestCents, 0);

export interface AmortizeOrInvest {
  debtId: string;
  amountCents: number;
  mode: 'plazo' | 'cuota';
  // Where the money comes from, and where it would be invested (a broker, cripto or pension).
  fromAccountId: string;
  investAccountId?: string;
}

// Two paths with the same money, side by side and never ranked: pay the debt off now, or invest
// it at the scenario. Each says what it would be in `months` months, in the unit chosen (the
// interest saved, as agreed with the bank, in euros of then).
export function amortizeOrInvest(
  accounts: readonly ProjectedAccount[],
  rules: readonly ProjectedRule[],
  today: Day,
  months: number,
  scenario: Scenario,
  unit: Unit,
  input: AmortizeOrInvest,
  assumptions: ProjectionAssumptions = DEFAULT_ASSUMPTIONS,
) {
  const debt = accounts.find((a) => a.id === input.debtId)?.debt;
  if (!debt) return null;
  const amount = Math.min(
    input.amountCents,
    -accounts.find((a) => a.id === input.debtId)!.cashCents,
  );
  const inUnit = (steps: ProjectionStep[]) =>
    unit === 'hoy' ? inTodayEuros(steps, assumptions.inflationBp) : steps;
  const spend = (a: ProjectedAccount) =>
    a.id === input.fromAccountId ? { ...a, cashCents: a.cashCents - amount } : a;

  // Paying it off.
  const after = prepaid(debt, today, amount, input.mode);
  if (!after || amount <= 0) return null;
  const paidAccounts = accounts.map((a) =>
    a.id === input.debtId
      ? { ...a, cashCents: a.cashCents + amount, debt: { ...debt, ...after } }
      : spend(a),
  );
  const paidSteps = inUnit(
    projectLedger(paidAccounts, today, months, scenario, assumptions, rules),
  );
  const newPlan = amortization(after);
  const nextBefore = amortization(debt).find((p) => p.day > today);

  // Investing it: the same money into the investment account (a new one if there is none).
  const target = input.investAccountId;
  const investAccounts = accounts
    .map(spend)
    .map((a) => (a.id === target ? { ...a, investedCents: (a.investedCents ?? 0) + amount } : a));
  if (!target)
    investAccounts.push({ id: WHAT_IF, kind: 'broker', cashCents: 0, investedCents: amount });
  const investSteps = inUnit(
    projectLedger(investAccounts, today, months, scenario, assumptions, rules),
  );
  const alone = inUnit(
    projectLedger(
      [{ id: WHAT_IF, kind: 'broker', cashCents: 0, investedCents: amount }],
      today,
      months,
      scenario,
      assumptions,
    ),
  );

  return {
    amortizar: {
      interestSavedCents: interestAfter(debt, today) - interestAfter(after, today),
      paidOffOn: newPlan.at(-1)?.day ?? today,
      paymentBeforeCents: nextBefore?.paymentCents ?? 0,
      paymentAfterCents: newPlan[0]?.paymentCents ?? 0,
      finalCents: paidSteps.at(-1)!.totalCents,
    },
    invertir: {
      investedFinalCents: alone.at(-1)!.totalCents,
      paidOffOn: amortization(debt).at(-1)?.day ?? today,
      finalCents: investSteps.at(-1)!.totalCents,
    },
  };
}
