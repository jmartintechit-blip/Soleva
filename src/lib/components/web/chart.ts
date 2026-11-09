import { futureValue, ASSUMPTIONS_BP, type Plan } from '#lib/engine/compound.ts';

// A line (the chosen scenario) over a band (prudente–optimista), all with one point per step.
// The scale includes 0 and any `extra` value (a goal), so debts below zero still fit.
export function bandPaths(
  lo: number[],
  mid: number[],
  hi: number[],
  w: number,
  h: number,
  extra: number[] = [],
) {
  const n = mid.length - 1;
  const all = [...lo, ...mid, ...hi, ...extra, 0];
  const max = Math.max(...all);
  const min = Math.min(...all);
  const top = max + (max - min) * 0.08 || 1;
  const x = (k: number) => (n ? (k / n) * (w - 14) : 0) + 7;
  const y = (v: number) => h - 8 - ((v - min) / (top - min)) * (h - 20);
  const path = (a: number[]) =>
    a.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const back = lo
    .map((v, k) => [k, v] as const)
    .reverse()
    .map(([k, v]) => `L${x(k).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ');
  return {
    line: path(mid),
    band: `${path(hi)} ${back} Z`,
    end: { x: x(n), y: y(mid[n]!) },
    x,
    y,
  };
}

// Yearly points of the three scenarios for a simple plan (the public page's example).
export function projectionPaths(plan: Omit<Plan, 'months'>, years: number, w: number, h: number) {
  const at = (bp: number) =>
    Array.from({ length: years + 1 }, (_, k) => futureValue({ ...plan, months: k * 12 }, bp));
  const mid = at(ASSUMPTIONS_BP.base);
  return {
    ...bandPaths(at(ASSUMPTIONS_BP.prudente), mid, at(ASSUMPTIONS_BP.optimista), w, h),
    value: mid[years]!,
  };
}
