import { z } from 'zod';
import type { Scenario } from '#lib/engine/compound.ts';
import type { Day } from '#lib/engine/day.ts';
import { type FixedPlan, type Unit, fixPlan, howAmI } from '#lib/engine/myplan.ts';
import {
  type ProjectionAssumptions,
  breakdown,
  inTodayEuros,
  projectLedger,
} from '#lib/engine/projection.ts';
import type { Db } from './db/index.ts';
import { projectionInputs } from './engine-run.ts';
import { getSettings } from './settings.ts';

// Proyección v2 (B13) on the server: the inputs come from the ledger as it is today, and «my plan»
// is always built here from stored data, never taken from the browser.

export const HORIZON_YEARS = [5, 10, 20, 30] as const;
export const SCENARIOS = ['prudente', 'base', 'optimista'] as const;
export const UNITS = ['hoy', 'entonces'] as const;

export const viewInput = z.object({
  scenario: z.enum(SCENARIOS).default('base'),
  years: z.coerce
    .number()
    .refine((y) => (HORIZON_YEARS as readonly number[]).includes(y))
    .default(20),
  unit: z.enum(UNITS).default('hoy'),
});
export type View = z.infer<typeof viewInput>;

export async function loadProjection(db: Db, userId: string, today: Day) {
  const [inputs, settings, names] = await Promise.all([
    projectionInputs(db, userId, today),
    getSettings(db, userId),
    db.query<{ id: string; name: string; kind: 'cuenta' | 'regla' }>(
      `select a.id, a.name, 'cuenta' as kind from money_account a
         join account_access x on x.account_id = a.id
         where x.user_id = $1 and x.role = 'propietario'
       union all
       select r.id, r.name, 'regla' from auto_rule r where r.user_id = $1`,
      [userId],
    ),
  ]);
  const a = settings.assumptions;
  const assumptions: ProjectionAssumptions = {
    returnBp: { prudente: a.prudente, base: a.base, optimista: a.optimista },
    inflationBp: a.inflation,
    rulesGrowthBp: a.rulesGrowth ?? a.inflation,
  };
  return {
    today,
    ...inputs,
    assumptions,
    // Whether «Tus ingresos y gastos» follows the inflation (nothing set).
    rulesGrowthFollowsInflation: a.rulesGrowth === null || a.rulesGrowth === undefined,
    accountNames: Object.fromEntries(
      names.filter((n) => n.kind === 'cuenta').map((n) => [n.id, n.name]),
    ),
    ruleNames: Object.fromEntries(
      names.filter((n) => n.kind === 'regla').map((n) => [n.id, n.name]),
    ),
  };
}
export type Projection = Awaited<ReturnType<typeof loadProjection>>;

// The projection of one view: steps in its unit.
export function projectView(p: Projection, { scenario, years, unit }: View) {
  const steps = projectLedger(p.accounts, p.today, years * 12, scenario, p.assumptions, p.rules);
  return unit === 'hoy' ? inTodayEuros(steps, p.assumptions.inflationBp) : steps;
}

// «Fijar como mi plan»: the view's projection from today's ledger, kept as a path in euros of
// then (so it compares with the ledger later), with its figure in the view's unit.
export function planFor(p: Projection, view: View): FixedPlan {
  const steps = projectLedger(
    p.accounts,
    p.today,
    view.years * 12,
    view.scenario as Scenario,
    p.assumptions,
    p.rules,
  );
  const shown = view.unit === 'hoy' ? inTodayEuros(steps, p.assumptions.inflationBp) : steps;
  return fixPlan(steps, view.scenario, view.unit as Unit, breakdown(shown).figure);
}

export async function saveFixedPlan(db: Db, userId: string, plan: FixedPlan) {
  await db.query(
    `insert into fixed_plan (user_id, fixed_on, scenario, months, unit, path, final_cents)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id) do update set fixed_on = $2, scenario = $3, months = $4, unit = $5,
       path = $6, final_cents = $7, updated_at = now()`,
    [
      userId,
      plan.fixedOn,
      plan.scenario,
      plan.months,
      plan.unit,
      JSON.stringify(plan.path),
      plan.finalCents,
    ],
  );
}

export async function getFixedPlan(db: Db, userId: string): Promise<FixedPlan | null> {
  const [row] = await db.query<{
    fixedOn: Day;
    scenario: Scenario;
    months: number;
    unit: Unit;
    path: FixedPlan['path'];
    finalCents: string;
  }>(
    `select fixed_on::text as "fixedOn", scenario, months, unit, path,
       final_cents::text as "finalCents"
     from fixed_plan where user_id = $1`,
    [userId],
  );
  return row ? { ...row, finalCents: Number(row.finalCents) } : null;
}

// Cómo voy today: today's net worth (as Inicio has it) against the plan, and since the day it was
// fixed what the rules brought in (incomes minus expenses) and what moved outside them (by hand,
// reconciliation adjustments, one-off expenses, a new account's opening). Null without a plan.
export async function howAmIToday(db: Db, userId: string, p: Projection) {
  const plan = await getFixedPlan(db, userId);
  if (!plan) return null;
  const [flows] = await db.query<{ rules: string; outside: string }>(
    `select coalesce(sum(m.amount_cents) filter (where m.source = 'regla'
                and m.kind in ('ingreso', 'gasto')), 0)::text as rules,
            coalesce(sum(m.amount_cents) filter (where m.source in ('manual', 'cuadre')
                and m.kind in ('apertura', 'ingreso', 'gasto', 'ajuste')), 0)::text as outside
     from movement m
     where m.account_id in (select account_id from account_access
                            where user_id = $1 and role = 'propietario')
       and m.voided_at is null and m.day > $2 and m.day <= $3`,
    [userId, plan.fixedOn, p.today],
  );
  const total = projectLedger(p.accounts, p.today, 0, 'base', p.assumptions)[0]!.totalCents;
  const status = howAmI(plan, p.today, {
    totalCents: total,
    rulesCents: Number(flows!.rules),
    outsideCents: Number(flows!.outside),
  });
  return status && { plan, status };
}
