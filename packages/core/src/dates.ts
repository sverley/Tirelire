/**
 * Manipulation de dates civiles (`AAAA-MM-JJ`) sans fuseau horaire.
 * Tout passe par des entiers année/mois/jour : aucune conversion en Date locale,
 * donc aucun décalage d'un jour selon la machine.
 */
import type { ISODate } from './model.js';

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

export function parseDate(iso: ISODate): YMD {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Date invalide : ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function formatDate({ y, m, d }: YMD): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

/** Nombre de jours depuis le 1er janvier 1970 (calcul purement civil). */
export function toDayNumber(iso: ISODate): number {
  const { y, m, d } = parseDate(iso);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function fromDayNumber(n: number): ISODate {
  const dt = new Date(n * 86_400_000);
  return formatDate({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
}

export function addDays(iso: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(iso) + days);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** Ajoute des mois en bornant le jour à la longueur du mois d'arrivée (31 janv. + 1 mois = 28/29 févr.). */
export function addMonths(iso: ISODate, months: number): ISODate {
  const { y, m, d } = parseDate(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return formatDate({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
}

/** Date du `day` (borné) dans le mois donné. */
export function dateInMonth(y: number, m: number, day: number): ISODate {
  return formatDate({ y, m, d: Math.min(day, daysInMonth(y, m)) });
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function todayISO(now: Date = new Date()): ISODate {
  return formatDate({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

export const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

/** Avance `iso` de `n` unités (n peut être négatif). */
export function addUnits(iso: ISODate, n: number, unit: 'day' | 'week' | 'month' | 'year'): ISODate {
  if (unit === 'day') return addDays(iso, n);
  if (unit === 'week') return addDays(iso, n * 7);
  return addMonths(iso, unit === 'year' ? n * 12 : n);
}
