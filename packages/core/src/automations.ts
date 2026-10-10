/**
 * Moteur de règles (D23), actions groupées (D26). Un flux n'engendre pas d'automatisme à part : sa
 * sélection, la seule, reprend l'opération qui réalise une occurrence (D24, `proposeMatches`).
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
import { liveSubOperations } from './suboperations.js';
import type { SubOperation, Category, Id, Ledger, Operation, OperationState, Automation, AutomationAction, AutomationSelection, AutomationStateAction, AllocationLine, FlowAction } from './model.js';
import { alive, isLocked } from './model.js';
import { emptyPatch, readLabelPattern, type Patch } from './matching.js';
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
export function automationsByRank(ledger: Ledger): Automation[] {
  return alive(ledger.automations).sort((a, b) => (a.rank < b.rank ? 1 : a.rank > b.rank ? -1 : b.id.localeCompare(a.id)));
}

/** Rang à donner à une nouvelle règle pour qu'elle passe avant toutes les autres. */
export function topRank(ledger: Ledger): string {
  const highest = automationsByRank(ledger)[0];
  return rankBetween(highest?.rank, undefined);
}

// ---------------------------------------------------------------------------
// Sélection
// ---------------------------------------------------------------------------

/** L'opération remplit-elle tous les critères renseignés ? */
export function selects(sel: AutomationSelection, op: Operation): boolean {
  if (sel.accountId && op.accountId !== sel.accountId) return false;
  if (sel.amountMin !== undefined && op.amount < sel.amountMin) return false;
  if (sel.amountMax !== undefined && op.amount > sel.amountMax) return false;
  if (sel.dateFrom && op.date < sel.dateFrom) return false;
  if (sel.dateTo && op.date > sel.dateTo) return false;
  const motif = readLabelPattern(sel.labelPattern);
  if (motif) {
    try {
      const re = new RegExp(motif, 'i');
      if (!re.test(op.label) && !re.test(op.normalizedLabel) && !(op.details && re.test(op.details))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** La règle s'applique-t-elle à cette opération, période de validité comprise ? */
export function automationApplies(rule: Automation, op: Operation): boolean {
  if (rule.validFrom && op.date < rule.validFrom) return false;
  if (rule.validTo && op.date > rule.validTo) return false;
  return selects(rule.selection, op);
}

/** Libellé lisible d'une règle : son nom, sinon ce qu'elle sélectionne. */
export function automationLabel(rule: Automation): string {
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
  /**
   * Ventilation résultante, une seule division sans identifiants : ils sont attribués à
   * l'écriture, et elle remplace la ventilation à tous ses niveaux.
   */
  allocation: AllocationLine[];
  /**
   * Aucune règle n'a écrit la ventilation d'une opération que l'import a établie (D33) : elle
   * reste telle qu'elle est, à tous ses niveaux.
   */
  keepsVentilation: boolean;
  /** Règles ayant écrit quelque chose, du rang le plus élevé au rang 1. */
  by: Id[];
}

function stateAfter(current: OperationState, action: AutomationStateAction | undefined): OperationState {
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
function singleLine(action: AutomationAction | FlowAction, categories: Map<Id, Category>): Outcome['allocation'] {
  const tirelireId = action.tirelireId ?? (action.categoryId ? categories.get(action.categoryId)?.tirelireId : undefined);
  if (!action.categoryId && !tirelireId) return [];
  return [
    {
      ...(action.categoryId ? { categoryId: action.categoryId } : {}),
      ...(tirelireId ? { tirelireId } : {}),
      share: { kind: 'variable' },
    },
  ];
}

/**
 * La ventilation que pose une action, d'un automatisme ou d'un flux (D23, D24) : sa division en
 * parts, si elle en a une ; sinon, sa catégorie et sa tirelire en une seule part variable, la
 * tirelire par défaut de la catégorie à défaut de tirelire (D32) ; `undefined` si elle ne ventile
 * rien. Un seul calcul pour les automatismes et les flux, l'ordre permanent compris (D24, D60).
 */
export function actionAllocation(action: AutomationAction | FlowAction | undefined, categories: Map<Id, Category>): AllocationLine[] | undefined {
  if (!action) return undefined;
  if (action.allocation) return action.allocation.map((l) => ({ ...l, share: { ...l.share } }));
  if (action.categoryId || action.tirelireId) return singleLine(action, categories);
  return undefined;
}

/**
 * Applique les règles à une opération, du rang le plus élevé au rang 1. Chaque champ renseigné
 * écrase, les champs vides laissent en place.
 *
 * Le calcul repart à chaque passage de ce que l'import a établi (D33) : une opération qui en reprend
 * une autre (D88) ou appariée en virement interne garde cet acquis, les autres partent vierges. Sans
 * cela, le moteur effacerait le travail que le pipeline vient de faire.
 */
export function outcomeFor(op: Operation, automations: Automation[], categories: Map<Id, Category>, base: SubOperation[] = []): Outcome {
  const fromImport = !!op.plannedFlowId || !!op.resumedOperationId || !!op.transferAccountId;
  const out: Outcome = {
    operationId: op.id,
    state: fromImport ? 'reconciled' : 'untreated',
    oneOff: !!op.oneOff,
    allocation: fromImport
      ? base.map((a) => ({ ...(a.categoryId ? { categoryId: a.categoryId } : {}), ...(a.tirelireId ? { tirelireId: a.tirelireId } : {}), share: a.share }))
      : [],
    keepsVentilation: fromImport,
    by: [],
  };
  for (const rule of [...automations].reverse()) {
    if (!automationApplies(rule, op)) continue;
    const a = rule.action;
    let wrote = false;
    const lines = actionAllocation(a, categories);
    if (lines) {
      out.allocation = lines;
      out.keepsVentilation = false;
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
export interface AutomationDiff {
  operation: Operation;
  /** `allocation` : la division de l'opération elle-même ; `subOperations` : tous ses niveaux. */
  before: { state: OperationState; oneOff: boolean; allocation: SubOperation[]; subOperations: SubOperation[] };
  after: Outcome;
  changed: boolean;
}

function sameAllocation(before: SubOperation[], after: Outcome['allocation']): boolean {
  if (before.length !== after.length) return false;
  return before.every((b, i) => {
    const a = after[i]!;
    return (b.categoryId ?? undefined) === a.categoryId && (b.tirelireId ?? undefined) === a.tirelireId && JSON.stringify(b.share) === JSON.stringify(a.share);
  });
}

/** Sous-opérations vivantes par opération, tous niveaux. */
function subOperationsByOperation(ledger: Ledger): Map<Id, SubOperation[]> {
  const out = new Map<Id, SubOperation[]>();
  for (const sub of liveSubOperations(ledger.subOperations)) {
    const arr = out.get(sub.operationId);
    if (arr) arr.push(sub);
    else out.set(sub.operationId, [sub]);
  }
  return out;
}

/**
 * Remplace la ventilation d'une opération, à tous ses niveaux, par une seule division (D23,
 * #297) : les identifiants de la division de l'opération sont réutilisés dans l'ordre, pour ne
 * réécrire que ce qui bouge quand seule la catégorie change ; tout le reste est retiré, ce que
 * contiennent les sous-opérations réutilisées compris.
 */
function replaceVentilation(patch: Patch, operationId: Id, existing: SubOperation[], lines: Outcome['allocation']): void {
  const reuse = existing.filter((s) => !s.parentId);
  const kept = new Set<Id>();
  for (const line of lines) {
    const old = reuse.shift();
    const id = old?.id ?? uuidv7();
    kept.add(id);
    patch.subOperations.push({
      id,
      operationId,
      share: line.share,
      ...(line.categoryId ? { categoryId: line.categoryId } : {}),
      ...(line.tirelireId ? { tirelireId: line.tirelireId } : {}),
    });
  }
  patch.removedSubOperations!.push(...existing.filter((s) => !kept.has(s.id)).map((s) => s.id));
}

/**
 * Aperçu : ce que donnerait l'application des règles sur les opérations non verrouillées.
 * `extra` permet d'essayer une règle qui n'est pas encore enregistrée, ce que l'interface fait
 * avant validation — l'aperçu est obligatoire (D23), donc il doit être calculable sans écrire.
 */
export function previewAutomations(ledger: Ledger, extra?: Automation): AutomationDiff[] {
  const rules = extra ? [...automationsByRank(ledger), extra].sort((a, b) => (a.rank < b.rank ? 1 : a.rank > b.rank ? -1 : b.id.localeCompare(a.id))) : automationsByRank(ledger);
  const categories = new Map(alive(ledger.categories).map((c) => [c.id, c]));
  const subsByOp = subOperationsByOperation(ledger);
  const out: AutomationDiff[] = [];
  for (const op of alive(ledger.operations)) {
    if (isLocked(op)) continue;
    const subs = subsByOp.get(op.id) ?? [];
    const before = { state: op.state, oneOff: !!op.oneOff, allocation: subs.filter((s) => !s.parentId), subOperations: subs };
    const after = outcomeFor(op, rules, categories, before.allocation);
    const ventilationChanged = !after.keepsVentilation && (subs.length !== before.allocation.length || !sameAllocation(before.allocation, after.allocation));
    const changed = before.state !== after.state || before.oneOff !== after.oneOff || ventilationChanged;
    out.push({ operation: op, before, after, changed });
  }
  return out;
}

/**
 * Applique les règles : recalcule les opérations non verrouillées. Les identifiants de lignes
 * sont réutilisés dans l'ordre pour ne pas faire enfler le journal de changements quand seule la
 * catégorie bouge.
 */
export function applyAutomations(ledger: Ledger): Patch {
  const patch = emptyPatch();
  for (const d of previewAutomations(ledger)) {
    if (!d.changed) continue;
    const next: Operation = { ...d.operation, state: d.after.state };
    if (d.after.oneOff) next.oneOff = true;
    else delete next.oneOff;
    patch.operations.push(next);
    // Gardée, la division de l'opération se réécrit à l'identique, et ce qu'elle contient reste.
    if (d.after.keepsVentilation) patch.subOperations.push(...d.before.allocation);
    else replaceVentilation(patch, d.operation.id, d.before.subOperations, d.after.allocation);
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
export function applyBulkAction(ledger: Ledger, operationIds: Id[], action: AutomationAction): Patch {
  const patch = emptyPatch();
  const categories = new Map(alive(ledger.categories).map((c) => [c.id, c]));
  const wanted = new Set(operationIds);
  const subsByOp = subOperationsByOperation(ledger);
  for (const op of alive(ledger.operations)) {
    if (!wanted.has(op.id)) continue;
    const next: Operation = { ...op, state: stateAfter(op.state, action.state ?? 'lock') };
    if (action.oneOff !== undefined) {
      if (action.oneOff) next.oneOff = true;
      else delete next.oneOff;
    }
    patch.operations.push(next);
    const lines = actionAllocation(action, categories);
    if (!lines) continue;
    replaceVentilation(patch, op.id, subsByOp.get(op.id) ?? [], lines);
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
export function inferSelection(operations: Operation[]): AutomationSelection {
  if (operations.length === 0) return {};
  const sel: AutomationSelection = {};
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
