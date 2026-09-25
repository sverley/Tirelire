/**
 * Périodes budgétaires (d'une paie à la suivante) et occurrences d'une périodicité
 * « tous les N jours, semaines, mois ou années à partir d'une date » (D47).
 */
import { type ISODate, type Periodicity } from './model.js';
import { addDays, addMonths, addUnits, dateInMonth, daysInMonth, diffDays, parseDate, MONTHS_FR, formatDate } from './dates.js';

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
 * Période de paie contenant `date`, pour un jour de paie `startDay` (1-31).
 * `startDay = 1` redonne le mois calendaire.
 *
 * Le mois de référence (libellé, clé) est le mois qui contient le milieu de la
 * période : une période du 28 août au 27 septembre s'appelle « septembre ».
 */
export function budgetPeriodContaining(date: ISODate, startDay: number): Period {
  const { y, m } = parseDate(date);
  let start = dateInMonth(y, m, startDay);
  if (start > date) {
    const prev = addMonths(formatDate({ y, m, d: 1 }), -1);
    const p = parseDate(prev);
    start = dateInMonth(p.y, p.m, startDay);
  }
  return periodFromStart(start, startDay);
}

function periodFromStart(start: ISODate, startDay: number): Period {
  const s = parseDate(start);
  const nextMonth = addMonths(formatDate({ y: s.y, m: s.m, d: 1 }), 1);
  const n = parseDate(nextMonth);
  const nextStart = dateInMonth(n.y, n.m, startDay);
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
export function nextPeriod(p: Period, startDay: number): Period {
  return periodFromStart(addDays(p.end, 1), startDay);
}

export function previousPeriod(p: Period, startDay: number): Period {
  return budgetPeriodContaining(addDays(p.start, -1), startDay);
}

/**
 * Nombre de périodes de `from` (incluse) jusqu'à celle qui contient `date` (incluse).
 * Vaut 1 si `date` est dans `from`, 0 si `date` est avant `from`.
 */
export function periodsUntil(from: Period, date: ISODate, startDay: number): number {
  if (date < from.start) return 0;
  let n = 1;
  let p = from;
  while (date > p.end) {
    p = nextPeriod(p, startDay);
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
  const { interval, unit } = p;
  if (interval < 1) throw new Error('interval doit être ≥ 1');
  if (p.anchorDate >= from) return p.anchorDate;

  // Jours et semaines : un pas de longueur fixe, donc un simple quotient de jours.
  if (unit === 'day' || unit === 'week') {
    const pas = unit === 'week' ? interval * 7 : interval;
    return addDays(p.anchorDate, Math.ceil(diffDays(p.anchorDate, from) / pas) * pas);
  }

  // Mois et années : on repart toujours de l'ancrage pour ne pas dériver (31 → 30 → 30…).
  const pas = unit === 'year' ? interval * 12 : interval;
  const a = parseDate(p.anchorDate);
  const f = parseDate(from);
  let k = Math.floor(((f.y - a.y) * 12 + (f.m - a.m)) / pas);
  let candidate = addMonths(p.anchorDate, k * pas);
  while (candidate < from) {
    k++;
    candidate = addMonths(p.anchorDate, k * pas);
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
  const { interval, unit } = p;
  const prev = nextOccurrence(p, addUnits(next, -interval, unit));
  return prev < date ? prev : undefined;
}
