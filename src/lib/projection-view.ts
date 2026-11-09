import type { Scenario } from './engine/compound.ts';
import { addMonths } from './engine/dates.ts';
import type { Day } from './engine/day.ts';
import { formatEuros } from './engine/money.ts';
import {
  type Group,
  type Milestone,
  type ProjectedAccount,
  type ProjectionAssumptions,
  groupOfCash,
} from './engine/projection.ts';

// What Proyección v2 (b13/PProyeccion) says about the numbers: months, percentages, the rows «Por
// tipo» with their assumption in grey, and each milestone's title and detail.

const MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sept',
  'oct',
  'nov',
  'dic',
];
// 'YYYY-MM-DD' or 'YYYY-MM' → «mar 2027».
export const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
// Basis points → «2,5 %».
export const pct = (bp: number) => `${String(bp / 100).replace('.', ',')} %`;

export const GROUPS: { key: Group; label: string }[] = [
  { key: 'inversiones', label: 'Inversiones' },
  { key: 'efectivo', label: 'Efectivo y remuneradas' },
  { key: 'inmuebles', label: 'Inmuebles' },
  { key: 'bienes', label: 'Coche y bienes' },
  { key: 'estimados', label: 'Estimados' },
  { key: 'deudas', label: 'Deudas' },
];

// The accounts behind a row «Por tipo» (a broker's units are investments, its estimates estimates).
export function groupAccounts(accounts: readonly ProjectedAccount[], g: Group) {
  return accounts.filter((a) =>
    g === 'estimados'
      ? !!a.estimates?.length
      : g === 'inversiones'
        ? groupOfCash(a.kind) === 'inversiones' || !!a.investedCents
        : groupOfCash(a.kind) === g,
  );
}

// The day of a debt's last payment.
const lastPayment = (a: ProjectedAccount) =>
  a.debt ? addMonths(a.debt.firstPaymentOn.slice(0, 7), a.debt.termMonths - 1) : undefined;

// The grey line of a row «Por tipo»: the assumption it grows (or shrinks) with.
export function groupNote(
  g: Group,
  accounts: readonly ProjectedAccount[],
  scenario: Scenario,
  assumptions: ProjectionAssumptions,
  endCents: number,
  paidOn?: Day,
): string {
  const these = groupAccounts(accounts, g);
  switch (g) {
    case 'inversiones':
      return `Al escenario (${pct(assumptions.returnBp[scenario])} al año)`;
    case 'efectivo': {
      const paying = these.filter((a) => a.interest);
      if (!paying.length) return 'El efectivo no crece (0 %)';
      if (paying.length > 1) return 'Cada remunerada a su interés; el efectivo, al 0 %';
      const t = paying[0]!.interest!;
      return t.promoUntil
        ? `A su interés: ${pct(t.afterRateBp ?? 0)} tras la promoción`
        : `A su interés (${pct(t.tiers[0]?.rateBp ?? 0)})`;
    }
    case 'inmuebles': {
      const homes = these.filter((a) => a.home);
      if (homes.length !== 1) return 'Cada uno a tu supuesto';
      const bp = homes[0]!.home!.growthBp;
      return `${bp > 0 ? '+' : ''}${pct(bp)} al año, tu supuesto`;
    }
    case 'bienes': {
      const car = these.some((a) => a.kind === 'vehiculo');
      const goods = these.some((a) => a.kind === 'bien');
      if (car && goods) return 'Tabla de Hacienda (se queda en el 10 %) y la curva de cada bien';
      return car ? 'Tabla de Hacienda (se queda en el 10 %)' : 'Pierden valor según su curva';
    }
    case 'estimados': {
      const rates = these.flatMap((a) => a.estimates!.map((e) => e.rateBp));
      const cap = assumptions.returnBp.prudente;
      if (scenario === 'prudente' && rates.some((r) => r > cap))
        return `${pct(cap)}: en prudente, como mucho el escenario`;
      return new Set(rates).size === 1
        ? `${pct(rates[0]!)} al año, tu estimación`
        : 'Cada uno a tu estimación';
    }
    case 'deudas': {
      if (endCents === 0) return paidOn ? `Pagada en ${monthLabel(paidOn)}` : 'Pagada';
      if (these.some((a) => !a.debt?.payerAccountId)) return 'Sin cuenta que la pague: no baja';
      const last = these
        .map(lastPayment)
        .filter((d) => d !== undefined)
        .sort()
        .at(-1);
      return last ? `Se paga sola cada mes · fin en ${monthLabel(last)}` : 'Se paga sola cada mes';
    }
  }
}

export interface MilestoneText {
  day: Day;
  label: string;
  title: string;
  detail: string;
}

// Each milestone, in words. The first review of a mixed mortgage is when it «pasa a variable».
export function milestoneTexts(
  list: readonly Milestone[],
  accounts: readonly ProjectedAccount[],
  names: { accounts: Record<string, string>; rules: Record<string, string> },
): MilestoneText[] {
  const reviewed = new Set<string>();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const account = (id: string) => names.accounts[id] ?? 'tu cuenta';
  return list.map((m) => {
    const base = { day: m.day, label: monthLabel(m.day) };
    switch (m.kind) {
      case 'fin_promocion':
        return {
          ...base,
          title: `Fin de la promoción de ${account(m.accountId)}`,
          detail: `El interés ${m.toBp < m.fromBp ? 'baja' : 'pasa'} del ${pct(m.fromBp)} al ${pct(m.toBp)}.`,
        };
      case 'revision': {
        const first = !reviewed.has(m.accountId) && !!byId.get(m.accountId)?.debt?.fixedMonths;
        reviewed.add(m.accountId);
        const move =
          m.toCents > m.fromCents ? 'sube' : m.toCents < m.fromCents ? 'baja' : 'se queda';
        return {
          ...base,
          title: first
            ? `${account(m.accountId)} pasa a variable`
            : `Revisión de ${account(m.accountId)}`,
          detail:
            move === 'se queda'
              ? `Con el Euríbor de hoy, la cuota se queda en ${formatEuros(m.toCents)}.`
              : `Con el Euríbor de hoy, la cuota ${move} de ${formatEuros(m.fromCents)} a ${formatEuros(m.toCents)}.`,
        };
      }
      case 'deuda_pagada':
        return {
          ...base,
          title: `${account(m.accountId)} pagada`,
          detail: `Liberas ${formatEuros(m.freedCents)} al mes.`,
        };
      case 'fin_regla':
        return {
          ...base,
          title: `Termina «${names.rules[m.ruleId] ?? 'una regla'}»`,
          detail: 'Desde ese día, la proyección deja de contarla.',
        };
    }
  });
}
