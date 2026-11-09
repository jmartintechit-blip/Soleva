import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS, milestones, projectLedger } from './engine/projection.ts';
import { TODAY, household, householdRules } from './engine/household.testdata.ts';
import { groupAccounts, groupNote, milestoneTexts, monthLabel, pct } from './projection-view.ts';

const names = {
  accounts: { rem: 'Bankinter', hip: 'Tu hipoteca', brk: 'MyInvestor' },
  rules: { nomina: 'Nómina' },
};

describe('projection in words', () => {
  it('writes months and percentages the Spanish way', () => {
    expect(monthLabel('2027-03-31')).toBe('mar 2027');
    expect(monthLabel('2041-09')).toBe('sept 2041');
    expect(pct(250)).toBe('2,5 %');
    expect(pct(-50)).toBe('-0,5 %');
  });

  it('tells the design’s milestones of the reference household', () => {
    const accounts = household();
    const steps = projectLedger(
      accounts,
      TODAY,
      240,
      'base',
      DEFAULT_ASSUMPTIONS,
      householdRules(),
    );
    const texts = milestoneTexts(milestones(accounts, householdRules(), steps), accounts, names);
    expect(texts[0]).toEqual({
      day: '2027-03-31',
      label: 'mar 2027',
      title: 'Fin de la promoción de Bankinter',
      detail: 'El interés baja del 2 % al 0,5 %.',
    });
    expect(texts[1]).toMatchObject({
      label: 'dic 2029',
      title: 'Tu hipoteca pasa a variable',
      detail: 'Con el Euríbor de hoy, la cuota sube de 598 € a 611 €.',
    });
    expect(texts.at(-1)).toMatchObject({
      title: 'Tu hipoteca pagada',
      detail: 'Liberas 611 € al mes.',
    });
  });

  it('says what each row «Por tipo» grows with', () => {
    const a = household();
    const note = (g: Parameters<typeof groupNote>[0], s: 'prudente' | 'base' = 'base', end = 1) =>
      groupNote(g, a, s, DEFAULT_ASSUMPTIONS, end);
    expect(note('inversiones')).toBe('Al escenario (6 % al año)');
    expect(note('efectivo')).toBe('A su interés: 0,5 % tras la promoción');
    expect(note('inmuebles')).toBe('+2 % al año, tu supuesto');
    expect(note('bienes')).toBe('Tabla de Hacienda (se queda en el 10 %) y la curva de cada bien');
    expect(note('estimados')).toBe('7 % al año, tu estimación');
    expect(note('estimados', 'prudente')).toBe('3 %: en prudente, como mucho el escenario');
    expect(note('deudas', 'base', -100)).toBe('Se paga sola cada mes · fin en nov 2041');
    expect(groupNote('deudas', a, 'base', DEFAULT_ASSUMPTIONS, 0, '2041-11-05')).toBe(
      'Pagada en nov 2041',
    );
    expect(groupAccounts(a, 'inversiones').map((x) => x.id)).toEqual(['brk']);
    expect(groupAccounts(a, 'estimados').map((x) => x.id)).toEqual(['brk']);
    expect(groupAccounts(a, 'bienes').map((x) => x.id)).toEqual(['coche', 'portatil']);
  });
});
