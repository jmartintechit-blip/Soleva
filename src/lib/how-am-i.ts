import { formatEuros } from './engine/money.ts';
import type { HowAmI } from './engine/myplan.ts';

// Cómo voy in words (b13/PComoVoy, PInicioPildora): never an alarm, only which way and by how much.
export const LEVEL_TEXT: Record<HowAmI['level'], string> = {
  en_camino: 'Vas en camino',
  por_encima: 'Por encima de tu plan',
  por_debajo: 'Algo por debajo de tu plan',
};

// «+1.400 €», «−1.400 €» or «0 €».
export const signedEuros = (cents: number) => `${cents > 0 ? '+' : ''}${formatEuros(cents)}`;

// The pill and the row in Proyección: «Vas en camino» alone, or the level with the gap.
export const pillText = (s: Pick<HowAmI, 'level' | 'gapCents'>) =>
  s.level === 'en_camino'
    ? LEVEL_TEXT.en_camino
    : `${LEVEL_TEXT[s.level]} · ${signedEuros(s.gapCents)}`;
