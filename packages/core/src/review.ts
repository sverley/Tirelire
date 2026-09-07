/**
 * Bilan et calibrage : budget vs réel par période, moyennes glissantes,
 * suggestions de cibles, provisions provisionné vs payé.
 */
import type { Cents, Envelope, Id, ISODate, Ledger } from './model.js';
import { alive } from './model.js';
import { budgetPerPeriod, envelopeBalance, indexLedger } from './balances.js';
import { occurrencesBetween, payPeriodContaining, previousPeriod, type Period } from './periods.js';
import { addDays, diffDays } from './dates.js';

export interface PeriodSpend {
  key: string;
  label: string;
  /** Dépensé (positif) ; revenus comptés en négatif pour les catégories de revenus. */
  spent: Cents;
  /** Dont ponctuel (exclu des moyennes). */
  oneOff: Cents;
  count: number;
  /**
   * Historique incomplet : la période commence avant la première opération connue (D25).
   * Une comparaison avec une période complète serait trompeuse.
   */
  partial: boolean;
}

export interface CategoryReview {
  categoryId?: Id;
  envelopeId?: Id;
  name: string;
  nature: 'expense' | 'income';
  /** Cible par période (budget lié), s'il y en a une. */
  target?: Cents;
  periods: PeriodSpend[];
  /** Moyennes hors ponctuel, sur les N dernières périodes ayant des données. */
  avg3: Cents;
  avg6: Cents;
  avg12: Cents;
  min: Cents;
  max: Cents;
  last: Cents;
  /** Cible suggérée : moyenne 6 périodes + 5 %, arrondie à la dizaine d'euros. */
  suggestion?: Cents;
  totalSpent: Cents;
}

/** Les N périodes de paie jusqu'à celle qui contient `asOf` (incluse), de la plus ancienne à la plus récente. */
export function lastPeriods(ledger: Ledger, asOf: ISODate, n: number): Period[] {
  const payDay = alive(ledger.accounts).find((a) => a.kind === 'pivot')?.payDay ?? 1;
  const out: Period[] = [];
  let p = payPeriodContaining(asOf, payDay);
  for (let i = 0; i < n; i++) {
    out.unshift(p);
    p = previousPeriod(p, payDay);
  }
  return out;
}

/** Date de la première opération connue, tous comptes confondus (undefined sans opération). */
export function historyStart(ledger: Ledger): ISODate | undefined {
  let first: ISODate | undefined;
  for (const o of alive(ledger.operations)) if (first === undefined || o.date < first) first = o.date;
  return first;
}

function average(values: Cents[]): Cents {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

function roundToTen(c: Cents): Cents {
  return Math.round(c / 1000) * 1000;
}

/**
 * Bilan par catégorie (et par enveloppe budget) sur les périodes données.
 * Une opération compte dans la période de sa date. Les virements internes sont exclus.
 */
export function reviewCategories(ledger: Ledger, periods: Period[]): CategoryReview[] {
  const idx = indexLedger(ledger);
  const categories = alive(ledger.categories);
  const envelopes = alive(ledger.envelopes);
  const byKey = new Map<string, CategoryReview>();
  const firstKnown = historyStart(ledger);
  const partial = (p: Period) => firstKnown === undefined || p.start < firstKnown;
  const periodOf = (date: ISODate): Period | undefined => periods.find((p) => date >= p.start && date <= p.end);
  const ensure = (key: string, init: () => Omit<CategoryReview, 'periods' | 'avg3' | 'avg6' | 'avg12' | 'min' | 'max' | 'last' | 'totalSpent'>) => {
    let r = byKey.get(key);
    if (!r) {
      r = { ...init(), periods: periods.map((p) => ({ key: p.key, label: p.label, spent: 0, oneOff: 0, count: 0, partial: partial(p) })), avg3: 0, avg6: 0, avg12: 0, min: 0, max: 0, last: 0, totalSpent: 0 };
      byKey.set(key, r);
    }
    return r;
  };
  // Toutes les catégories et budgets apparaissent, même sans dépense.
  for (const c of categories) {
    const env = c.envelopeId ? envelopes.find((e) => e.id === c.envelopeId) : undefined;
    ensure(`cat:${c.id}`, () => ({
      categoryId: c.id,
      name: c.name,
      nature: c.nature,
      ...(env?.kind === 'budget' ? { envelopeId: env.id, target: budgetPerPeriod(env) } : {}),
    }));
  }
  for (const e of envelopes.filter((x) => x.kind === 'budget')) {
    ensure(`env:${e.id}`, () => ({ envelopeId: e.id, name: `Budget « ${e.name} »`, nature: 'expense', target: budgetPerPeriod(e) }));
  }
  for (const op of idx.operationsById.values()) {
    if (op.transferAccountId || op.status === 'transfer') continue;
    const p = periodOf(op.date);
    if (!p) continue;
    const pi = periods.indexOf(p);
    for (const al of idx.allocationsByOperation.get(op.id) ?? []) {
      const targets: CategoryReview[] = [];
      if (al.categoryId) {
        const c = categories.find((x) => x.id === al.categoryId);
        if (c) targets.push(ensure(`cat:${c.id}`, () => ({ categoryId: c.id, name: c.name, nature: c.nature })));
      }
      if (al.envelopeId) {
        const e = envelopes.find((x) => x.id === al.envelopeId);
        if (e?.kind === 'budget') targets.push(ensure(`env:${e.id}`, () => ({ envelopeId: e.id, name: `Budget « ${e.name} »`, nature: 'expense', target: budgetPerPeriod(e) })));
      }
      for (const t of targets) {
        const ps = t.periods[pi]!;
        const spent = t.nature === 'income' ? al.amount : -al.amount;
        ps.spent += spent;
        ps.count++;
        if (op.status === 'oneOff') ps.oneOff += spent;
      }
    }
  }
  const out: CategoryReview[] = [];
  for (const r of byKey.values()) {
    const regular = r.periods.map((p) => p.spent - p.oneOff);
    // On ignore les périodes sans aucune opération en tête de série (avant le début de l'historique).
    const firstIdx = r.periods.findIndex((p) => p.count > 0);
    const series = firstIdx < 0 ? [] : regular.slice(firstIdx);
    r.avg3 = average(series.slice(-3));
    r.avg6 = average(series.slice(-6));
    r.avg12 = average(series.slice(-12));
    r.min = series.length ? Math.min(...series) : 0;
    r.max = series.length ? Math.max(...series) : 0;
    r.last = series[series.length - 1] ?? 0;
    r.totalSpent = r.periods.reduce((s, p) => s + p.spent, 0);
    if (r.envelopeId && series.length >= 2 && r.nature === 'expense') {
      const base = series.length >= 6 ? r.avg6 : r.avg3;
      r.suggestion = roundToTen(Math.round(base * 1.05));
    }
    if (series.length > 0 || r.target !== undefined) out.push(r);
  }
  return out.sort((a, b) => b.totalSpent - a.totalSpent);
}

export interface ProvisionReview {
  envelopeId: Id;
  name: string;
  dueDate: ISODate;
  /** Montant prévu de l'échéance. */
  target: Cents;
  /** Solde de l'enveloppe la veille de l'échéance. */
  provisioned: Cents;
  /** Ce qui a réellement été débité sur l'enveloppe autour de l'échéance (positif). */
  paid: Cents;
  /** paid − target : positif = l'échéance a coûté plus cher que prévu. */
  variance: Cents;
}

/** Pour chaque provision, les échéances passées : provisionné vs payé. */
export function reviewProvisions(ledger: Ledger, from: ISODate, asOf: ISODate): ProvisionReview[] {
  const idx = indexLedger(ledger);
  const out: ProvisionReview[] = [];
  for (const e of alive(ledger.envelopes).filter((x): x is Envelope & { periodicity: NonNullable<Envelope['periodicity']> } => x.kind === 'provision' && !!x.periodicity)) {
    for (const due of occurrencesBetween(e.periodicity, from, asOf)) {
      const before = envelopeBalance(e, idx, addDays(due, -1));
      const entries = (idx.entriesByEnvelope.get(e.id) ?? []).filter(({ operation, effect }) => effect < 0 && Math.abs(diffDays(operation.date, due)) <= 15);
      const paid = entries.reduce((s, x) => s - x.effect, 0);
      if (paid === 0 && due > asOf) continue;
      out.push({ envelopeId: e.id, name: e.name, dueDate: due, target: e.target ?? 0, provisioned: before, paid, variance: paid - (e.target ?? 0) });
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
}
