/**
 * Bilan et calibrage : budget vs réel par période, moyennes glissantes,
 * suggestions de cibles, provisions provisionné vs payé.
 */
import type { Cents, Tirelire, Id, ISODate, Ledger, Need } from './model.js';
import { alive, needActive, needName } from './model.js';
import { allocationAmount, tirelireBalance, indexLedger, needCruise } from './balances.js';
import { occurrencesBetween, budgetPeriodContaining, previousPeriod, type Period } from './periods.js';
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
  tirelireId?: Id;
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

/**
 * Dotation récurrente d'une tirelire par période (somme des croisières de ses besoins récurrents),
 * undefined sans besoin récurrent. `asOf` choisit la version du budget en vigueur (D50) : sans
 * cela, un budget clos l'an dernier servirait encore de cible aujourd'hui.
 */
export function recurringPerPeriod(ledger: Ledger, e: Tirelire, asOf?: ISODate): Cents | undefined {
  const needs = alive(ledger.needs).filter((n) => n.tirelireId === e.id && n.kind === 'recurring' && (asOf === undefined || needActive(n, asOf)));
  if (needs.length === 0) return undefined;
  return needs.reduce((s, n) => s + needCruise(n), 0);
}

/** Les N périodes de paie jusqu'à celle qui contient `asOf` (incluse), de la plus ancienne à la plus récente. */
export function lastPeriods(ledger: Ledger, asOf: ISODate, n: number): Period[] {
  const startDay = ledger.settings.periodStartDay;
  const out: Period[] = [];
  let p = budgetPeriodContaining(asOf, startDay);
  for (let i = 0; i < n; i++) {
    out.unshift(p);
    p = previousPeriod(p, startDay);
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
 * Bilan par catégorie (et par tirelire budget) sur les périodes données.
 * Une opération compte dans la période de sa date. Les virements internes sont exclus.
 */
export function reviewCategories(ledger: Ledger, periods: Period[]): CategoryReview[] {
  const idx = indexLedger(ledger);
  const categories = alive(ledger.categories);
  const tirelires = alive(ledger.tirelires);
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
  // Toutes les catégories et tirelires à besoin récurrent apparaissent, même sans dépense.
  const budgetOf = new Map<Id, Cents>();
  for (const e of tirelires) {
    const t = recurringPerPeriod(ledger, e, periods[periods.length - 1]!.start);
    if (t !== undefined) budgetOf.set(e.id, t);
  }
  for (const c of categories) {
    const target = c.tirelireId ? budgetOf.get(c.tirelireId) : undefined;
    ensure(`cat:${c.id}`, () => ({
      categoryId: c.id,
      name: c.name,
      nature: c.nature,
      ...(target !== undefined && c.tirelireId ? { tirelireId: c.tirelireId, target } : {}),
    }));
  }
  for (const [tirelireId, target] of budgetOf) {
    const e = tirelires.find((x) => x.id === tirelireId)!;
    ensure(`env:${e.id}`, () => ({ tirelireId: e.id, name: `Budget « ${e.name} »`, nature: 'expense', target }));
  }
  for (const op of idx.operationsById.values()) {
    if (op.transferAccountId) continue;
    const p = periodOf(op.date);
    if (!p) continue;
    const pi = periods.indexOf(p);
    for (const al of idx.allocationsByOperation.get(op.id) ?? []) {
      // Un renflouement (D49) fausserait les moyennes : un cadeau gonflerait le revenu moyen, un
      // virement interne compterait deux fois. Il est compté ailleurs, par `reviewReplenishments`.
      if (al.replenishment) continue;
      const targets: CategoryReview[] = [];
      if (al.categoryId) {
        const c = categories.find((x) => x.id === al.categoryId);
        if (c) targets.push(ensure(`cat:${c.id}`, () => ({ categoryId: c.id, name: c.name, nature: c.nature })));
      }
      if (al.tirelireId && budgetOf.has(al.tirelireId)) {
        const e = tirelires.find((x) => x.id === al.tirelireId)!;
        targets.push(ensure(`env:${e.id}`, () => ({ tirelireId: e.id, name: `Budget « ${e.name} »`, nature: 'expense', target: budgetOf.get(e.id)! })));
      }
      for (const t of targets) {
        const ps = t.periods[pi]!;
        const amount = allocationAmount(al, idx);
        const spent = t.nature === 'income' ? amount : -amount;
        ps.spent += spent;
        ps.count++;
        if (op.oneOff) ps.oneOff += spent;
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
    if (r.tirelireId && series.length >= 2 && r.nature === 'expense') {
      const base = series.length >= 6 ? r.avg6 : r.avg3;
      r.suggestion = roundToTen(Math.round(base * 1.05));
    }
    if (series.length > 0 || r.target !== undefined) out.push(r);
  }
  return out.sort((a, b) => b.totalSpent - a.totalSpent);
}

export interface ProvisionReview {
  needId: Id;
  tirelireId: Id;
  name: string;
  dueDate: ISODate;
  /** Montant prévu de l'échéance. */
  target: Cents;
  /** Solde de la tirelire la veille de l'échéance. */
  provisioned: Cents;
  /** Ce qui a réellement été débité sur la tirelire autour de l'échéance (positif). */
  paid: Cents;
  /** paid − target : positif = l'échéance a coûté plus cher que prévu. */
  variance: Cents;
}

/** Pour chaque besoin à échéance, les échéances passées : provisionné (solde de la tirelire la veille) vs payé. */
export function reviewProvisions(ledger: Ledger, from: ISODate, asOf: ISODate): ProvisionReview[] {
  const idx = indexLedger(ledger);
  const out: ProvisionReview[] = [];
  for (const n of alive(ledger.needs).filter((x): x is Need & { periodicity: NonNullable<Need['periodicity']> } => x.kind === 'dueDate' && !!x.periodicity)) {
    const e = idx.tireliresById.get(n.tirelireId);
    if (!e) continue;
    const target = n.amount ?? 0;
    const debut = n.activeFrom && n.activeFrom > from ? n.activeFrom : from;
    const fin = n.activeTo && n.activeTo < asOf ? n.activeTo : asOf;
    for (const due of occurrencesBetween(n.periodicity, debut, fin)) {
      const before = tirelireBalance(e, idx, addDays(due, -1));
      const entries = (idx.entriesByTirelire.get(e.id) ?? []).filter(({ operation, effect }) => effect < 0 && Math.abs(diffDays(operation.date, due)) <= 15);
      const paid = entries.reduce((s, x) => s - x.effect, 0);
      if (paid === 0 && due > asOf) continue;
      out.push({ needId: n.id, tirelireId: e.id, name: needName(n, e), dueDate: due, target, provisioned: before, paid, variance: paid - target });
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
}

export interface ReplenishmentReview {
  tirelireId: Id;
  name: string;
  /** Nombre de renflouements sur la fenêtre observée. */
  count: number;
  /** Total ramené, positif. */
  total: Cents;
  /** Part venue de l'extérieur (cadeau, remboursement, vente). */
  fromOutside: Cents;
  /** Part reprise ailleurs dans le patrimoine : la répartition était mauvaise. */
  fromInside: Cents;
  /** Dotation actuelle par période, si la tirelire en a une. */
  cruise: Cents;
  /**
   * Ce qu'il aurait fallu doter en plus par période pour ne pas avoir à renflouer. Une *proposition*
   * de lecture, jamais appliquée d'office : un renflouement peut être un accident isolé qu'il ne
   * faut surtout pas inscrire dans le budget permanent (D49).
   */
  suggested: Cents;
}

/**
 * Renflouements par tirelire sur `periods` (D49). Le renflouement est la mesure la plus directe
 * d'une dotation sous-évaluée : ce qu'on a dû ramener, réparti sur la fenêtre observée, dit de
 * combien la dotation manquait.
 */
export function reviewReplenishments(ledger: Ledger, periods: Period[]): ReplenishmentReview[] {
  if (periods.length === 0) return [];
  const idx = indexLedger(ledger);
  const debut = periods[0]!.start;
  const fin = periods[periods.length - 1]!.end;
  const parTirelire = new Map<Id, ReplenishmentReview>();

  for (const op of idx.operationsById.values()) {
    if (op.date < debut || op.date > fin) continue;
    for (const al of idx.allocationsByOperation.get(op.id) ?? []) {
      if (!al.replenishment || !al.tirelireId) continue;
      const e = idx.tireliresById.get(al.tirelireId);
      if (!e) continue;
      const montant = allocationAmount(al, idx);
      if (montant <= 0) continue; // seul ce qui entre dans la tirelire renfloue
      let r = parTirelire.get(e.id);
      if (!r) {
        const cruise = (idx.needsByTirelire.get(e.id) ?? []).filter((n) => needActive(n, fin)).reduce((s, n) => s + needCruise(n), 0);
        r = { tirelireId: e.id, name: e.name, count: 0, total: 0, fromOutside: 0, fromInside: 0, cruise, suggested: 0 };
        parTirelire.set(e.id, r);
      }
      r.count++;
      r.total += montant;
      if (al.replenishment === 'external') r.fromOutside += montant;
      else r.fromInside += montant;
    }
  }

  for (const r of parTirelire.values()) r.suggested = Math.ceil(r.total / periods.length);
  return [...parTirelire.values()].sort((a, b) => b.total - a.total);
}
