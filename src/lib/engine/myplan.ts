import type { Scenario } from './compound.ts';
import { type Day, daysBetween } from './day.ts';
import type { ProjectionStep } from './projection.ts';

// Cómo voy (PROJECT_PLAN §11.11, LEEME-B13): «Fijar como mi plan» keeps a photo of the projection
// (scenario, horizon, unit and the path month by month, in euros of each month so it compares
// straight with the ledger) and, later, says how far today is from it and why.

export type Unit = 'hoy' | 'entonces';

export interface FixedPlan {
  fixedOn: Day;
  scenario: Scenario;
  months: number;
  unit: Unit;
  // Step by step, in euros of then: the total, and what the rules had brought in so far.
  path: { day: Day; totalCents: number; contributedCents: number }[];
  // The figure at the end of the horizon, in the plan's unit (for «Tu plan»).
  finalCents: number;
}

export function fixPlan(
  steps: readonly ProjectionStep[],
  scenario: Scenario,
  unit: Unit,
  finalCents: number,
): FixedPlan {
  let contributed = 0;
  return {
    fixedOn: steps[0]!.day,
    scenario,
    months: steps.length - 1,
    unit,
    path: steps.map((s) => {
      contributed += s.flows.aportado;
      return { day: s.day, totalCents: s.totalCents, contributedCents: contributed };
    }),
    finalCents,
  };
}

// What the plan expected by `day`: straight between its steps (a step is a month), and its last
// value after its end; null before it was fixed.
export function plannedOn(plan: FixedPlan, day: Day) {
  const p = plan.path;
  if (day < p[0]!.day) return null;
  const i = p.findLastIndex((x) => x.day <= day);
  const a = p[i]!;
  const b = p[i + 1];
  if (!b || a.day === day)
    return { totalCents: a.totalCents, contributedCents: a.contributedCents };
  const f = daysBetween(a.day, day) / daysBetween(a.day, b.day);
  const at = (x: number, y: number) => Math.round(x + (y - x) * f);
  return {
    totalCents: at(a.totalCents, b.totalCents),
    contributedCents: at(a.contributedCents, b.contributedCents),
  };
}

// Within 1 % of what was planned for today: on track. Never an alarm: the gap only says which way.
export const ON_TRACK_BP = 100;

export interface HowAmI {
  level: 'en_camino' | 'por_encima' | 'por_debajo';
  plannedCents: number;
  gapCents: number;
  // The three rows of «Por qué», which add up to the gap: what the rules brought in against the
  // plan, what the money made against the scenario, and what moved outside the rules (by hand,
  // reconciliation adjustments, one-off expenses).
  why: { aportado: number; rentabilidad: number; fuera: number };
}

// `actual`: today's net worth, and since the plan was fixed what the rules brought in (incomes
// minus expenses) and what came in or went out outside them.
export function howAmI(
  plan: FixedPlan,
  day: Day,
  actual: { totalCents: number; rulesCents: number; outsideCents: number },
): HowAmI | null {
  const planned = plannedOn(plan, day);
  if (!planned) return null;
  const gapCents = actual.totalCents - planned.totalCents;
  const aportado = actual.rulesCents - planned.contributedCents;
  const fuera = actual.outsideCents;
  const close = Math.abs(gapCents) * 10_000 < ON_TRACK_BP * Math.abs(planned.totalCents);
  return {
    level: close ? 'en_camino' : gapCents > 0 ? 'por_encima' : 'por_debajo',
    plannedCents: planned.totalCents,
    gapCents,
    why: { aportado, rentabilidad: gapCents - aportado - fuera, fuera },
  };
}
