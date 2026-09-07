/**
 * Périodes budgétaires (de paie à paie) et occurrences d'une périodicité
 * « tous les N mois à partir d'une date ».
 */
import type { ISODate, Periodicity } from './model.js';
import { addDays, addMonths, dateInMonth, daysInMonth, parseDate, MONTHS_FR, formatDate } from './dates.js';

export interface Period {
  /** Premier jour inclus. */
  start: ISODate;
  /** Dernier jour inclus. */
  end: ISODate;
  /** Libellé humain : « septembre 2026 ». */
  label: string;
  /** Clé de tri et d'identité : `AAAA-MM` du mois de référence. */
  key: string;
}

/**
 * Période de paie contenant `date`, pour un jour de paie `payDay` (1-31).
 * `payDay = 1` redonne le mois calendaire.
 *
 * Le mois de référence (libellé, clé) est le mois qui contient le milieu de la
 * période : une période du 28 août au 27 septembre s'appelle « septembre ».
 */
export function payPeriodContaining(date: ISODate, payDay: number): Period {
  const { y, m } = parseDate(date);
  let start = dateInMonth(y, m, payDay);
  if (start > date) {
    const prev = addMonths(formatDate({ y, m, d: 1 }), -1);
    const p = parseDate(prev);
    start = dateInMonth(p.y, p.m, payDay);
  }
  return periodFromStart(start, payDay);
}

function periodFromStart(start: ISODate, payDay: number): Period {
  const s = parseDate(start);
  const nextMonth = addMonths(formatDate({ y: s.y, m: s.m, d: 1 }), 1);
  const n = parseDate(nextMonth);
  const nextStart = dateInMonth(n.y, n.m, payDay);
  const end = addDays(nextStart, -1);
  const mid = addDays(start, Math.floor((daysInMonth(s.y, s.m) - 1) / 2));
  const ref = parseDate(mid);
  return {
    start,
    end,
    label: `${MONTHS_FR[ref.m - 1]} ${ref.y}`,
    key: `${ref.y}-${String(ref.m).padStart(2, '0')}`,
  };
}

/** Période suivante / précédente. */
export function nextPeriod(p: Period, payDay: number): Period {
  return periodFromStart(addDays(p.end, 1), payDay);
}

export function previousPeriod(p: Period, payDay: number): Period {
  return payPeriodContaining(addDays(p.start, -1), payDay);
}

/**
 * Nombre de périodes de `from` (incluse) jusqu'à celle qui contient `date` (incluse).
 * Vaut 1 si `date` est dans `from`, 0 si `date` est avant `from`.
 */
export function periodsUntil(from: Period, date: ISODate, payDay: number): number {
  if (date < from.start) return 0;
  let n = 1;
  let p = from;
  while (date > p.end) {
    p = nextPeriod(p, payDay);
    n++;
    if (n > 1200) throw new Error('periodsUntil : boucle trop longue');
  }
  return n;
}

// ---------------------------------------------------------------------------
// Périodicités
// ---------------------------------------------------------------------------

/** Première occurrence de `p` à une date ≥ `from`. */
export function nextOccurrence(p: Periodicity, from: ISODate): ISODate {
  if (p.intervalMonths < 1) throw new Error('intervalMonths doit être ≥ 1');
  if (p.anchorDate >= from) return p.anchorDate;
  const a = parseDate(p.anchorDate);
  const f = parseDate(from);
  const monthsApart = (f.y - a.y) * 12 + (f.m - a.m);
  let k = Math.floor(monthsApart / p.intervalMonths);
  let candidate = addMonths(p.anchorDate, k * p.intervalMonths);
  while (candidate < from) {
    k++;
    candidate = addMonths(p.anchorDate, k * p.intervalMonths);
  }
  return candidate;
}

/** Toutes les occurrences de `p` dans [start, end]. */
export function occurrencesBetween(p: Periodicity, start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let d = nextOccurrence(p, start);
  while (d <= end) {
    out.push(d);
    // on repart de l'ancrage à chaque pas pour ne pas dériver (31 → 30 → 30…)
    d = nextOccurrence(p, addDays(d, 1));
  }
  return out;
}

/** Dernière occurrence strictement avant `date` (ou undefined). */
export function previousOccurrence(p: Periodicity, date: ISODate): ISODate | undefined {
  const next = nextOccurrence(p, date);
  const prev = nextOccurrence(p, addMonths(next, -p.intervalMonths));
  return prev < date ? prev : undefined;
}
