import { formatCents, parseCents, parseDate, MONTHS_FR, type Cents, type EnvelopeKind, type AccountKind, type PlannedFlowKind } from '@tirelire/core';

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
  pivot: 'Pivot (relevé importé)',
  holding: "Compte d'accueil (livret, PEL…)",
  third: 'Compte tiers (saisie manuelle)',
};

export const ENVELOPE_KINDS: Record<EnvelopeKind, string> = {
  provision: 'Provision (échéance)',
  goal: "Objectif d'épargne",
  budget: 'Budget courant',
};

export const FLOW_KINDS: Record<PlannedFlowKind, string> = {
  income: 'Revenu',
  fixedCharge: 'Charge fixe',
  dueDate: "Échéance payée par une enveloppe",
  transfer: 'Virement interne attendu',
};

export const STATUS_LABELS: Record<string, string> = {
  ok: 'croisière',
  ahead: 'en avance',
  catchUp: 'rattrapage',
  reduced: 'réduit',
  unfunded: 'non financé',
};

export function periodicityLabel(p: { intervalMonths: number; anchorDate: string } | undefined): string {
  if (!p) return '';
  const when = shortDate(p.anchorDate);
  if (p.intervalMonths === 1) return `chaque mois (dès le ${when})`;
  if (p.intervalMonths === 12) return `chaque année le ${when.slice(0, -5)}`;
  return `tous les ${p.intervalMonths} mois (dès le ${when})`;
}
