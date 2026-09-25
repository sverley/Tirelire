import {
  activeAt,
  formatCents,
  parseCents,
  parseDate,
  validityState,
  MONTHS_FR,
  type Account,
  type Cents,
  type NeedKind,
  type AccountKind,
  type PlannedFlowKind,
  type PeriodUnit,
  type Periodicity,
  type ValidityState,
} from '@tirelire/core';

export const money = (c: Cents, sign = false) => formatCents(c, { sign });

export function moneyClass(c: Cents): string {
  return c < 0 ? 'num neg' : c > 0 ? 'num pos' : 'num';
}

/** « 15 oct. 2026 » */
export function shortDate(iso: string): string {
  const { y, m, d } = parseDate(iso);
  const mon = MONTHS_FR[m - 1]!;
  const abbr = mon.length > 4 ? mon.slice(0, 4).replace(/\.$/, '') + '.' : mon;
  return `${d} ${abbr} ${y}`;
}

export function centsToInput(c: Cents | undefined): string {
  if (c === undefined) return '';
  return (c / 100).toFixed(2).replace('.', ',');
}

export function inputToCents(s: string): Cents | undefined {
  return parseCents(s);
}

export const ACCOUNT_KINDS: Record<AccountKind, string> = {
  principal: 'Compte principal',
  courant: 'Compte courant',
  epargne: 'Épargne',
};

export const NEED_KINDS: Record<NeedKind, string> = {
  dueDate: 'Échéance (montant à une date)',
  recurring: 'Récurrent (tant par période)',
  goal: "Objectif (montant sans date)",
  payout: 'Versement (une réserve qui alimente le budget)',
};

/** Nom court pour la pastille d'une ligne de plan. */
export const NEED_KINDS_SHORT: Record<NeedKind, string> = {
  dueDate: 'échéance',
  recurring: 'courant',
  goal: 'objectif',
  payout: 'versement',
};

export const ROLLOVER_LABELS: Record<'none' | 'unlimited' | 'capped', string> = {
  none: 'Libéré en fin de période',
  unlimited: 'Reporté',
  capped: 'Reporté, plafonné',
};

export const FLOW_KINDS: Record<PlannedFlowKind, string> = {
  income: 'Revenu',
  fixedCharge: 'Charge fixe',
  dueDate: "Échéance payée par une tirelire",
  transfer: 'Virement interne attendu',
};

export const STATUS_LABELS: Record<string, string> = {
  ok: 'croisière',
  ahead: 'en avance',
  catchUp: 'rattrapage',
  reduced: 'réduit',
  unfunded: 'non financé',
};

export const UNITS: Record<PeriodUnit, { un: string; pluriel: string }> = {
  day: { un: 'jour', pluriel: 'jours' },
  week: { un: 'semaine', pluriel: 'semaines' },
  month: { un: 'mois', pluriel: 'mois' },
  year: { un: 'an', pluriel: 'ans' },
};

export function periodicityLabel(p: Periodicity | undefined): string {
  if (!p) return '—';
  const when = shortDate(p.anchorDate);
  const { interval, unit } = p;
  if (interval === 1) {
    if (unit === 'month') return `chaque mois (dès le ${when})`;
    if (unit === 'year') return `chaque année le ${when.slice(0, -5)}`;
    return `chaque ${UNITS[unit].un} (dès le ${when})`;
  }
  return `tous les ${interval} ${UNITS[unit].pluriel} (dès le ${when})`;
}

/**
 * Période de validité d'un besoin (D50) ou d'un flux (D23), en clair. Vide quand il n'y en a pas :
 * la plupart des lignes n'ont pas de bornes, et l'écrire à chaque fois n'apprendrait rien.
 */
export function validityLabel(x: { activeFrom?: string; activeTo?: string }): string {
  if (x.activeFrom && x.activeTo) return `en vigueur du ${shortDate(x.activeFrom)} au ${shortDate(x.activeTo)}`;
  if (x.activeFrom) return `à partir du ${shortDate(x.activeFrom)}`;
  if (x.activeTo) return `jusqu’au ${shortDate(x.activeTo)}`;
  return '';
}

/** Nom de chaque état, tel qu'il s'écrit sur son interrupteur (D56). */
export const STATE_LABELS: Record<ValidityState, string> = {
  active: 'En cours',
  upcoming: 'À venir',
  closed: 'Clos',
};

/** Pastille d'état d'une ligne datée, à la date de travail : rien si elle est en vigueur. */
export function validityBadge(x: { activeFrom?: string; activeTo?: string }, asOf: string): string {
  const state = validityState(x, asOf);
  return state === 'active' ? '' : STATE_LABELS[state].toLowerCase();
}

/**
 * Comptes proposés dans un menu : ceux en vigueur, plus celui déjà choisi (D56). Un compte clos ne
 * doit plus recevoir de flux ni de placement neuf, mais il doit rester lisible là où il est déjà
 * désigné — sinon le menu s'ouvrirait vide sur une ligne existante et l'enregistrement suivant
 * effacerait le compte sans l'avoir dit.
 */
export function openAccounts(accounts: Account[], asOf: string, ...selected: Array<string | undefined>): Account[] {
  return accounts.filter((a) => activeAt(a, asOf) || selected.includes(a.id));
}
