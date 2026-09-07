/**
 * Moteur de règles (D23), règles engendrées par les flux (D24), actions groupées (D26).
 *
 * Une règle est un automatisme, pas de la vérité : le moteur repart chaque fois des opérations
 * non verrouillées et recalcule ce qu'elles portent, plutôt que d'accumuler des effets. Deux
 * passages sur le même grand livre donnent donc le même résultat, et retirer une règle défait ce
 * qu'elle avait posé — ce qu'un moteur incrémental ne saurait pas faire.
 *
 * Les règles s'appliquent du rang le plus élevé au rang 1 : la plus prioritaire écrit en dernier,
 * chaque champ renseigné écrasant ce qu'une règle moins prioritaire avait posé, les champs vides
 * laissant en place. Il n'y a pas de détection de conflit ; le rang tranche.
 */
import type { Allocation, Category, Id, Ledger, Operation, OperationState, PlannedFlow, Rule, RuleAction, RuleSelection, RuleStateAction, Share } from './model.js';
import { alive, isLocked } from './model.js';
import { emptyPatch, type Patch } from './matching.js';
import { uuidv7 } from './ids.js';

// ---------------------------------------------------------------------------
// Rangs : clés triables plutôt qu'index (D31)
// ---------------------------------------------------------------------------

const RANK_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Clé de rang entre `before` et `after` (ordre lexicographique). Deux appareils qui insèrent au
 * même endroit produisent des clés différentes mais ordonnables, ce qui converge à la fusion
 * colonne par colonne de D08, là où deux index égaux se seraient écrasés.
 */
export function rankBetween(before: string | undefined, after: string | undefined): string {
  const lo = before ?? '';
  const hi = after ?? '';
  let prefix = '';
  let i = 0;
  for (;;) {
    const a = lo[i];
    const b = hi[i];
    if (a !== undefined && b !== undefined && a === b) {
      prefix += a;
      i++;
      continue;
    }
    const aIdx = a === undefined ? -1 : RANK_ALPHABET.indexOf(a);
    const bIdx = b === undefined ? RANK_ALPHABET.length : RANK_ALPHABET.indexOf(b);
    if (bIdx - aIdx > 1) return prefix + RANK_ALPHABET[Math.floor((aIdx + bIdx) / 2)]!;
    // Pas de place entre les deux : on descend d'un cran en gardant la borne basse.
    prefix += a ?? RANK_ALPHABET[0]!;
    i++;
  }
}

/** Règles vivantes, du rang le plus élevé au rang 1 : l'ordre d'application (D23). */
export function rulesByRank(ledger: Ledger): Rule[] {
  return alive(ledger.rules).sort((a, b) => (a.rank < b.rank ? 1 : a.rank > b.rank ? -1 : b.id.localeCompare(a.id)));
}

/** Rang à donner à une nouvelle règle pour qu'elle passe avant toutes les autres. */
export function topRank(ledger: Ledger): string {
  const highest = rulesByRank(ledger)[0];
  return rankBetween(highest?.rank, undefined);
}

// ---------------------------------------------------------------------------
// Sélection
// ---------------------------------------------------------------------------

/** L'opération remplit-elle tous les critères renseignés ? */
export function selects(sel: RuleSelection, op: Operation): boolean {
  if (sel.accountId && op.accountId !== sel.accountId) return false;
  if (sel.amountMin !== undefined && op.amount < sel.amountMin) return false;
  if (sel.amountMax !== undefined && op.amount > sel.amountMax) return false;
  if (sel.dateFrom && op.date < sel.dateFrom) return false;
  if (sel.dateTo && op.date > sel.dateTo) return false;
  if (sel.labelPattern) {
    try {
      const re = new RegExp(sel.labelPattern, 'i');
      if (!re.test(op.label) && !re.test(op.normalizedLabel) && !(op.details && re.test(op.details))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** La règle s'applique-t-elle à cette opération, période de validité comprise ? */
export function ruleApplies(rule: Rule, op: Operation): boolean {
  if (rule.validFrom && op.date < rule.validFrom) return false;
  if (rule.validTo && op.date > rule.validTo) return false;
  return selects(rule.selection, op);
}

/** Libellé lisible d'une règle : son nom, sinon ce qu'elle sélectionne. */
export function ruleLabel(rule: Rule): string {
  if (rule.name) return rule.name;
  const s = rule.selection;
  const parts = [s.labelPattern, s.amountMin !== undefined || s.amountMax !== undefined ? 'montant' : undefined, s.accountId ? 'compte' : undefined].filter(Boolean);
  return parts.join(' · ') || 'tout';
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/** Ce qu'une opération porterait après application : ventilation et état résolus. */
export interface Outcome {
  operationId: Id;
  state: OperationState;
  oneOff: boolean;
  /** Ventilation résultante, sans identifiants : ils sont attribués à l'écriture. */
  allocation: Array<{ categoryId?: Id; envelopeId?: Id; share: Share }>;
  /** Règles ayant écrit quelque chose, du rang le plus élevé au rang 1. */
  by: Id[];
}

function stateAfter(current: OperationState, action: RuleStateAction | undefined): OperationState {
  switch (action) {
    case 'lock':
      return 'locked';
    case 'reconcile':
      return 'reconciled';
    case 'unlock':
      return 'untreated';
    default:
      return current;
  }
}

/** Ventilation à une seule ligne, celle que pose une action qui ne fixe qu'une catégorie. */
function singleLine(action: RuleAction, categories: Map<Id, Category>): Outcome['allocation'] {
  const envelopeId = action.envelopeId ?? (action.categoryId ? categories.get(action.categoryId)?.envelopeId : undefined);
  if (!action.categoryId && !envelopeId) return [];
  return [
    {
      ...(action.categoryId ? { categoryId: action.categoryId } : {}),
      ...(envelopeId ? { envelopeId } : {}),
      share: { kind: 'variable' },
    },
  ];
}

/**
 * Applique les règles à une opération, du rang le plus élevé au rang 1. Chaque champ renseigné
 * écrase, les champs vides laissent en place.
 *
 * Le calcul repart à chaque passage de ce que l'import a établi (D33) : une opération rapprochée
 * d'un flux ou appariée en virement interne garde cet acquis, les autres partent vierges. Sans
 * cela, le moteur effacerait le travail que le pipeline vient de faire.
 */
export function outcomeFor(op: Operation, rules: Rule[], categories: Map<Id, Category>, base: Allocation[] = []): Outcome {
  const fromImport = !!op.plannedFlowId || !!op.transferAccountId;
  const out: Outcome = {
    operationId: op.id,
    state: fromImport ? 'reconciled' : 'untreated',
    oneOff: !!op.oneOff,
    allocation: fromImport
      ? base.map((a) => ({ ...(a.categoryId ? { categoryId: a.categoryId } : {}), ...(a.envelopeId ? { envelopeId: a.envelopeId } : {}), share: a.share }))
      : [],
    by: [],
  };
  for (const rule of [...rules].reverse()) {
    if (!ruleApplies(rule, op)) continue;
    const a = rule.action;
    let wrote = false;
    if (a.allocation) {
      out.allocation = a.allocation.map((l) => ({ ...l }));
      wrote = true;
    } else if (a.categoryId || a.envelopeId) {
      out.allocation = singleLine(a, categories);
      wrote = true;
    }
    if (a.oneOff !== undefined) {
      out.oneOff = a.oneOff;
      wrote = true;
    }
    if (a.state && a.state !== 'none') {
      out.state = stateAfter(out.state, a.state);
      wrote = true;
    }
    if (wrote) out.by.unshift(rule.id);
  }
  return out;
}

/** Différence lisible entre ce qu'une opération porte et ce qu'elle porterait (aperçu, D23). */
export interface RuleDiff {
  operation: Operation;
  before: { state: OperationState; oneOff: boolean; allocation: Allocation[] };
  after: Outcome;
  changed: boolean;
}

function sameAllocation(before: Allocation[], after: Outcome['allocation']): boolean {
  if (before.length !== after.length) return false;
  return before.every((b, i) => {
    const a = after[i]!;
    return (b.categoryId ?? undefined) === a.categoryId && (b.envelopeId ?? undefined) === a.envelopeId && JSON.stringify(b.share) === JSON.stringify(a.share);
  });
}

/**
 * Aperçu : ce que donnerait l'application des règles sur les opérations non verrouillées.
 * `extra` permet d'essayer une règle qui n'est pas encore enregistrée, ce que l'interface fait
 * avant validation — l'aperçu est obligatoire (D23), donc il doit être calculable sans écrire.
 */
export function previewRules(ledger: Ledger, extra?: Rule): RuleDiff[] {
  const rules = extra ? [...rulesByRank(ledger), extra].sort((a, b) => (a.rank < b.rank ? 1 : a.rank > b.rank ? -1 : b.id.localeCompare(a.id))) : rulesByRank(ledger);
  const categories = new Map(alive(ledger.categories).map((c) => [c.id, c]));
  const allocsByOp = new Map<Id, Allocation[]>();
  for (const al of alive(ledger.allocations)) {
    const arr = allocsByOp.get(al.operationId);
    if (arr) arr.push(al);
    else allocsByOp.set(al.operationId, [al]);
  }
  const out: RuleDiff[] = [];
  for (const op of alive(ledger.operations)) {
    if (isLocked(op)) continue;
    const before = { state: op.state, oneOff: !!op.oneOff, allocation: allocsByOp.get(op.id) ?? [] };
    const after = outcomeFor(op, rules, categories, before.allocation);
    const changed = before.state !== after.state || before.oneOff !== after.oneOff || !sameAllocation(before.allocation, after.allocation);
    out.push({ operation: op, before, after, changed });
  }
  return out;
}

/**
 * Applique les règles : recalcule les opérations non verrouillées. Les identifiants de lignes
 * sont réutilisés dans l'ordre pour ne pas faire enfler le journal de changements quand seule la
 * catégorie bouge.
 */
export function applyRules(ledger: Ledger): Patch {
  const patch = emptyPatch();
  for (const d of previewRules(ledger)) {
    if (!d.changed) continue;
    const next: Operation = { ...d.operation, state: d.after.state };
    if (d.after.oneOff) next.oneOff = true;
    else delete next.oneOff;
    patch.operations.push(next);
    const reuse = [...d.before.allocation];
    for (const line of d.after.allocation) {
      const old = reuse.shift();
      patch.allocations.push({
        id: old?.id ?? uuidv7(),
        operationId: d.operation.id,
        share: line.share,
        ...(line.categoryId ? { categoryId: line.categoryId } : {}),
        ...(line.envelopeId ? { envelopeId: line.envelopeId } : {}),
      });
    }
    patch.removedAllocations!.push(...reuse.map((a) => a.id));
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Actions groupées (D26)
// ---------------------------------------------------------------------------

/**
 * Applique une action à une sélection d'opérations. Ne se conserve pas et ne se rejoue pas :
 * seuls ses effets restent. À la différence d'une règle, elle peut déverrouiller, et elle
 * verrouille par défaut — c'est un geste de l'utilisateur, donc de la vérité (D22).
 */
export function applyBulkAction(ledger: Ledger, operationIds: Id[], action: RuleAction): Patch {
  const patch = emptyPatch();
  const categories = new Map(alive(ledger.categories).map((c) => [c.id, c]));
  const wanted = new Set(operationIds);
  const allocsByOp = new Map<Id, Allocation[]>();
  for (const al of alive(ledger.allocations)) {
    if (!wanted.has(al.operationId)) continue;
    const arr = allocsByOp.get(al.operationId);
    if (arr) arr.push(al);
    else allocsByOp.set(al.operationId, [al]);
  }
  for (const op of alive(ledger.operations)) {
    if (!wanted.has(op.id)) continue;
    const next: Operation = { ...op, state: stateAfter(op.state, action.state ?? 'lock') };
    if (action.oneOff !== undefined) {
      if (action.oneOff) next.oneOff = true;
      else delete next.oneOff;
    }
    patch.operations.push(next);
    const lines = action.allocation ?? (action.categoryId || action.envelopeId ? singleLine(action, categories) : undefined);
    if (!lines) continue;
    const reuse = [...(allocsByOp.get(op.id) ?? [])];
    for (const line of lines) {
      const old = reuse.shift();
      patch.allocations.push({
        id: old?.id ?? uuidv7(),
        operationId: op.id,
        share: line.share,
        ...(line.categoryId ? { categoryId: line.categoryId } : {}),
        ...(line.envelopeId ? { envelopeId: line.envelopeId } : {}),
      });
    }
    patch.removedAllocations!.push(...reuse.map((a) => a.id));
  }
  return patch;
}

/**
 * Filtre qui tente de reproduire une sélection manuelle (D26) : le chemin inverse, celui par
 * lequel on arrive aux règles sans jamais en écrire. On propose le plus grand préfixe de mots
 * commun aux libellés, le compte s'il est unique, et une fourchette de montants élargie.
 *
 * Le filtre proposé peut sélectionner plus large que la sélection d'origine ; c'est voulu, et
 * c'est pourquoi l'aperçu reste obligatoire avant d'en faire une règle.
 */
export function inferSelection(operations: Operation[]): RuleSelection {
  if (operations.length === 0) return {};
  const sel: RuleSelection = {};
  const words = operations.map((o) => o.normalizedLabel.split(/\s+/).filter(Boolean));
  const common: string[] = [];
  for (let i = 0; i < (words[0]?.length ?? 0); i++) {
    const w = words[0]![i]!;
    if (words.every((ws) => ws[i] === w)) common.push(w);
    else break;
  }
  if (common.length === 0) {
    // Pas de préfixe : on cherche un mot présent partout, le plus long.
    const candidates = (words[0] ?? []).filter((w) => w.length > 2 && words.every((ws) => ws.includes(w)));
    const best = candidates.sort((a, b) => b.length - a.length)[0];
    if (best) common.push(best);
  }
  if (common.length) sel.labelPattern = common.map(escapeRegExp).join('.*');
  const accounts = new Set(operations.map((o) => o.accountId));
  if (accounts.size === 1) sel.accountId = operations[0]!.accountId;
  const amounts = operations.map((o) => o.amount);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (min < 0 === max < 0) {
    sel.amountMin = min - Math.abs(Math.round(min * 0.2));
    sel.amountMax = max + Math.abs(Math.round(max * 0.2));
  }
  return sel;
}

/**
 * Motif proposé à partir d'un seul libellé : les premiers mots significatifs, débarrassés du
 * vocabulaire bancaire qui ne distingue rien (« CARTE », « PRELEVEMENT », « VIR »).
 */
export function suggestPattern(op: Operation): string {
  const words = op.normalizedLabel.split(' ').filter((w) => w.length > 2 && !/^\d+$/.test(w));
  const skip = new Set(['CARTE', 'PRELEVEMENT', 'EUROPEEN', 'VIR', 'VIREMENT', 'RECU', 'EMIS', 'PERM', 'INST', 'SEPA', 'DE', 'DE:']);
  const kept = words.filter((w) => !skip.has(w)).slice(0, 2);
  return (kept.length ? kept : words.slice(0, 2)).join('.*');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Règles engendrées par les flux (D24)
// ---------------------------------------------------------------------------

/** Règle déterministe correspondant à un flux : elle porte toute la classification, donc verrouille. */
export function ruleFromFlow(flow: PlannedFlow, rank: string, id: Id = uuidv7()): Rule {
  const selection: RuleSelection = { accountId: flow.accountId };
  if (flow.labelPattern) selection.labelPattern = flow.labelPattern;
  if (!flow.variable) {
    const tol = Math.max(flow.amountTolerance?.abs ?? 0, Math.round((Math.abs(flow.amount) * (flow.amountTolerance?.pct ?? 0)) / 100));
    selection.amountMin = Math.min(flow.amount - tol, flow.amount + tol);
    selection.amountMax = Math.max(flow.amount - tol, flow.amount + tol);
  }
  const action: RuleAction = { state: 'lock' };
  if (flow.categoryId) action.categoryId = flow.categoryId;
  if (flow.envelopeId) action.envelopeId = flow.envelopeId;
  return {
    id,
    name: flow.name,
    selection,
    action,
    rank,
    flowId: flow.id,
    ...(flow.activeFrom ? { validFrom: flow.activeFrom } : {}),
    ...(flow.activeTo ? { validTo: flow.activeTo } : {}),
  };
}

export interface FlowRulesPatch {
  rules: Rule[];
}

/**
 * Synchronise les règles engendrées par les flux (D24). Modifier un flux **archive** sa règle en
 * lui posant une fin de validité et en crée une nouvelle : les opérations déjà classées ne sont
 * pas réécrites, puisqu'aucune règle nouvelle ne les sélectionne. C'est ce qui rend l'historique
 * rejouable dans l'ordre chronologique plutôt que réinterprété à l'aune du budget d'aujourd'hui.
 */
export function syncFlowRules(ledger: Ledger, asOf: string): FlowRulesPatch {
  const out: FlowRulesPatch = { rules: [] };
  const existing = new Map<Id, Rule>();
  for (const r of alive(ledger.rules)) if (r.flowId && !r.validTo) existing.set(r.flowId, r);
  let rank = topRank(ledger);
  for (const flow of alive(ledger.plannedFlows)) {
    const current = existing.get(flow.id);
    if (!flow.makesRule) {
      if (current) out.rules.push({ ...current, validTo: asOf });
      continue;
    }
    const wanted = ruleFromFlow(flow, current?.rank ?? rank);
    if (!current) {
      out.rules.push(wanted);
      rank = rankBetween(rank, undefined);
      continue;
    }
    const same = JSON.stringify({ ...wanted, id: '', rank: '' }) === JSON.stringify({ ...current, id: '', rank: '' });
    if (same) continue;
    // Le flux a changé : on archive la règle en cours et on en crée une qui vaut à partir d'ici.
    out.rules.push({ ...current, validTo: asOf });
    out.rules.push({ ...ruleFromFlow(flow, rank), validFrom: flow.activeFrom && flow.activeFrom > asOf ? flow.activeFrom : asOf });
    rank = rankBetween(rank, undefined);
  }
  return out;
}
