import { z } from 'zod';
import { ASSUMPTIONS_BP } from '#lib/engine/compound.ts';
import type { Baseline } from '#lib/engine/project.ts';
import type { Db } from './db/index.ts';

const rate = (min: number, max: number) =>
  z
    .number('Escribe un porcentaje, por ejemplo 6')
    .int()
    .min(min, `Entre ${min / 100} % y ${max / 100} %`)
    .max(max, `Entre ${min / 100} % y ${max / 100} %`);

export const assumptionsInput = z
  .object({
    prudente: rate(-5000, 5000),
    base: rate(-5000, 5000),
    optimista: rate(-5000, 5000),
    inflation: rate(-2000, 5000),
    // «Tus ingresos y gastos»: null follows the inflation; left out, it stays as it was.
    rulesGrowth: rate(-2000, 5000).nullable().optional(),
  })
  .refine((a) => a.prudente <= a.base && a.base <= a.optimista, {
    path: ['base'],
    message: 'Ordénalos: prudente ≤ base ≤ optimista',
  });
export type Assumptions = z.infer<typeof assumptionsInput>;

export async function getSettings(db: Db, userId: string) {
  const [row] = await db.query<{
    prudente: number;
    base: number;
    optimista: number;
    inflation: number;
    rulesGrowth: number | null;
    baseline: Baseline | null;
  }>(
    `select prudent_bp as prudente, base_bp as base, optimistic_bp as optimista,
       inflation_bp as inflation, rules_growth_bp as "rulesGrowth", plan_baseline as baseline
     from settings where user_id = $1`,
    [userId],
  );
  const { baseline = null, ...assumptions } = row ?? { ...ASSUMPTIONS_BP, rulesGrowth: null };
  return { assumptions: assumptions as Assumptions, baseline };
}

export async function saveAssumptions(db: Db, userId: string, a: Assumptions) {
  const growth = a.rulesGrowth !== undefined;
  await db.query(
    `insert into settings (user_id, prudent_bp, base_bp, optimistic_bp, inflation_bp, rules_growth_bp)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id) do update set prudent_bp = $2, base_bp = $3, optimistic_bp = $4,
       inflation_bp = $5, ${growth ? 'rules_growth_bp = $6,' : ''} updated_at = now()`,
    [userId, a.prudente, a.base, a.optimista, a.inflation, a.rulesGrowth ?? null],
  );
}

export async function saveBaseline(db: Db, userId: string, b: Baseline | null) {
  await db.query(
    `insert into settings (user_id, plan_baseline) values ($1, $2)
     on conflict (user_id) do update set plan_baseline = $2, updated_at = now()`,
    [userId, b === null ? null : JSON.stringify(b)],
  );
}

export const reminderInput = z.object({
  enabled: z.boolean(),
  day: z.number('Elige un día del 1 al 28').int().min(1, 'Del 1 al 28').max(28, 'Del 1 al 28'),
});
export type Reminder = z.infer<typeof reminderInput>;

export async function getReminder(db: Db, userId: string): Promise<Reminder> {
  const [row] = await db.query<Reminder>(
    `select reminder_enabled as enabled, reminder_day as day from settings where user_id = $1`,
    [userId],
  );
  return row ?? { enabled: true, day: 1 };
}

export async function saveReminder(db: Db, userId: string, r: Reminder) {
  await db.query(
    `insert into settings (user_id, reminder_enabled, reminder_day) values ($1, $2, $3)
     on conflict (user_id) do update set reminder_enabled = $2, reminder_day = $3,
       updated_at = now()`,
    [userId, r.enabled, r.day],
  );
}
