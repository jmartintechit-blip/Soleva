// Texts shown for the stored values, shared by pages and forms.
export const KIND_LABEL = {
  efectivo: 'Cuenta corriente o efectivo',
  remunerada: 'Cuenta remunerada',
  inversion: 'Inversión',
  pension: 'Plan de pensiones',
  cripto: 'Cripto',
  inmueble: 'Inmueble',
  vehiculo: 'Vehículo',
  otro: 'Otro',
  deuda: 'Deuda o préstamo',
  broker: 'Bróker',
  deuda_hipoteca: 'Hipoteca',
  deuda_prestamo: 'Préstamo',
  bien: 'Bien',
  deposito: 'Depósito',
  letra: 'Letras del Tesoro',
} as const;

// Inicio's breakdown by kind of asset (engine/insight.ts AssetClass).
export const CLASS_LABEL: Record<string, string> = {
  liquidez: 'Liquidez',
  renta_variable: 'Renta variable',
  oro: 'Oro',
  cripto: 'Cripto',
  inmuebles: 'Inmuebles',
  bienes: 'Bienes',
};

// These follow the projection's scenario return, so they have no rate of their own.
export const FOLLOWS_SCENARIO = ['inversion', 'pension', 'cripto'];

export const RATE_LABEL: Record<string, string> = {
  deuda: 'Interés anual que te cobran',
  vehiculo: 'Cuánto cambia su valor al año',
  inmueble: 'Cuánto cambia su valor al año',
};

export const FREQUENCY_LABEL = {
  mensual: 'Mes',
  trimestral: 'Trimestre',
  anual: 'Año',
  una_vez: 'Una vez',
} as const;

export const TYPE_LABEL = { entra: 'Entra', sale: 'Sale', mueve: 'Se mueve' } as const;

// In-app themes (Horizonte README); the brand and the public web stay in Amanecer.
export const THEMES = [
  { id: 'amanecer', label: 'Amanecer', color: '#FFB547' },
  { id: 'crepusculo', label: 'Crepúsculo', color: '#B9A3FF' },
  { id: 'rose', label: 'Rosé', color: '#F2B0A0' },
] as const;
export type Theme = (typeof THEMES)[number]['id'];
export const THEME_COOKIE = 'soleva_theme';
export const asTheme = (v: string | undefined | null): Theme =>
  THEMES.find((t) => t.id === v)?.id ?? 'amanecer';

// Inicio's periods (server/home.ts computes them).
export const PERIODS = [
  { key: 'dia', label: 'Día', short: 'hoy' },
  { key: 'mes', label: 'Mes', short: 'mes' },
  { key: 'm3', label: '3M', short: '3 meses' },
  { key: 'm6', label: '6M', short: '6 meses' },
  { key: 'ano', label: 'Año', short: 'año' },
  { key: 'todo', label: 'Todo', short: 'total' },
] as const;
export type PeriodKey = (typeof PERIODS)[number]['key'];

// Alta inicial (b11/NAlta): what can go in, and what its amount is called.
export const ALTA_KINDS = [
  { kind: 'efectivo', label: 'Cuenta bancaria', hint: 'nómina, día a día', amount: 'Saldo hoy' },
  { kind: 'remunerada', label: 'Cuenta remunerada', hint: 'con interés', amount: 'Saldo hoy' },
  {
    kind: 'broker',
    label: 'Bróker o inversiones',
    hint: 'ETF, fondos, acciones',
    amount: 'Efectivo en la cuenta',
    placeholder: 'Nombre, p. ej. Trade Republic',
  },
  { kind: 'cripto', label: 'Cripto', hint: 'precio automático', amount: 'Efectivo en la cuenta' },
  { kind: 'vehiculo', label: 'Coche o moto', hint: 'lo que vale hoy', amount: 'Valor hoy' },
  { kind: 'bien', label: 'Otro bien', hint: 'PC, joyas, reloj…', amount: 'Valor hoy' },
  // Its own screen (b12/RInmueble), not a line here.
  {
    kind: 'inmueble',
    label: 'Vivienda o inmueble',
    hint: 'por m² de tu zona',
    amount: 'Valor hoy',
  },
  {
    kind: 'deuda_hipoteca',
    label: 'Hipoteca o préstamo',
    hint: 'lo que te queda',
    amount: 'Lo que debes',
  },
] as const;
export type AltaKind = (typeof ALTA_KINDS)[number]['kind'];
// Where its products go in next.
export const WITH_PRODUCTS: AltaKind[] = ['broker', 'cripto'];

// Vivienda o inmueble (b12/RInmueble).
export const PROPERTY_KINDS = [
  { kind: 'habitual', label: 'Vivienda habitual' },
  { kind: 'segunda', label: 'Segunda residencia' },
  { kind: 'alquiler', label: 'Alquiler' },
  { kind: 'local', label: 'Local' },
  { kind: 'garaje', label: 'Garaje' },
  { kind: 'terreno', label: 'Terreno' },
] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number]['kind'];

// Otro bien (b12/RBien): its kind and how much it loses a year by default (editable).
export const ASSET_KINDS = [
  { kind: 'electronica', label: 'Electrónica', lossPct: 25 },
  { kind: 'moto', label: 'Moto o bici', lossPct: 15 },
  { kind: 'reloj', label: 'Reloj', lossPct: 5 },
  { kind: 'joyas', label: 'Joyas y arte', lossPct: 0 },
  { kind: 'otro', label: 'Otro', lossPct: 10 },
] as const;

// INE's codes of provinces and autonomous communities, as people write them.
export const PROVINCE_NAME: Record<string, string> = {
  '01': 'Álava',
  '02': 'Albacete',
  '03': 'Alicante',
  '04': 'Almería',
  '05': 'Ávila',
  '06': 'Badajoz',
  '07': 'Illes Balears',
  '08': 'Barcelona',
  '09': 'Burgos',
  '10': 'Cáceres',
  '11': 'Cádiz',
  '12': 'Castellón',
  '13': 'Ciudad Real',
  '14': 'Córdoba',
  '15': 'A Coruña',
  '16': 'Cuenca',
  '17': 'Girona',
  '18': 'Granada',
  '19': 'Guadalajara',
  '20': 'Gipuzkoa',
  '21': 'Huelva',
  '22': 'Huesca',
  '23': 'Jaén',
  '24': 'León',
  '25': 'Lleida',
  '26': 'La Rioja',
  '27': 'Lugo',
  '28': 'Madrid',
  '29': 'Málaga',
  '30': 'Murcia',
  '31': 'Navarra',
  '32': 'Ourense',
  '33': 'Asturias',
  '34': 'Palencia',
  '35': 'Las Palmas',
  '36': 'Pontevedra',
  '37': 'Salamanca',
  '38': 'Santa Cruz de Tenerife',
  '39': 'Cantabria',
  '40': 'Segovia',
  '41': 'Sevilla',
  '42': 'Soria',
  '43': 'Tarragona',
  '44': 'Teruel',
  '45': 'Toledo',
  '46': 'Valencia',
  '47': 'Valladolid',
  '48': 'Bizkaia',
  '49': 'Zamora',
  '50': 'Zaragoza',
  '51': 'Ceuta',
  '52': 'Melilla',
};
// For «el índice del INE para …».
export const REGION_NAME: Record<string, string> = {
  '00': 'España',
  '01': 'Andalucía',
  '02': 'Aragón',
  '03': 'Asturias',
  '04': 'Illes Balears',
  '05': 'Canarias',
  '06': 'Cantabria',
  '07': 'Castilla y León',
  '08': 'Castilla-La Mancha',
  '09': 'Cataluña',
  '10': 'la Comunitat Valenciana',
  '11': 'Extremadura',
  '12': 'Galicia',
  '13': 'la Comunidad de Madrid',
  '14': 'la Región de Murcia',
  '15': 'Navarra',
  '16': 'el País Vasco',
  '17': 'La Rioja',
  '18': 'Ceuta',
  '19': 'Melilla',
};
