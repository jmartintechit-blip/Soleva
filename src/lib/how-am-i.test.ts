import { describe, expect, it } from 'vitest';
import { pillText, signedEuros } from './how-am-i.ts';

describe('Cómo voy in words', () => {
  it('says which way and by how much, never as an alarm', () => {
    expect(pillText({ level: 'en_camino', gapCents: -50_000 })).toBe('Vas en camino');
    expect(pillText({ level: 'por_encima', gapCents: 140_000 })).toBe(
      'Por encima de tu plan · +1.400 €',
    );
    expect(pillText({ level: 'por_debajo', gapCents: -140_000 })).toBe(
      'Algo por debajo de tu plan · −1.400 €',
    );
    expect(signedEuros(0)).toBe('0 €');
  });
});
