/**
 * Après import : virements internes, rapprochement de flux prévus, virements vers
 * les enveloppes (par libellé), règles de catégorisation, flux attendus non reçus.
 *
 * Toutes les fonctions sont pures : elles reçoivent le grand livre et rendent
 * les lignes à écrire (`Patch`). L'application les enregistre dans le dépôt.
 */
import type { Allocation, Cents, Id, ISODate, Ledger, Operation, PlannedFlow, Rule } from './model.js';
import { alive } from './model.js';
import { diffDays, addDays } from './dates.js';
import { occurrencesBetween } from './periods.js';
import { transferLabel } from './plan.js';
import { uuidv7 } from './ids.js';

export interface Patch {
  operations: Operation[];
  allocations: Allocation[];
}

export function emptyPatch(): Patch {
  return { operations: [], allocations: [] };
}

function allocationsOf(ledger: Ledger, opId: Id): Allocation[] {
  return alive(ledger.allocations).filter((a) => a.operationId === opId);
}

// ---------------------------------------------------------------------------
// Virements internes entre deux comptes importés
// ---------------------------------------------------------------------------

/**
 * Apparie débit sur un compte et crédit du même montant sur un autre compte
 * suivi à ± `windowDays`. Ne touche qu'aux opérations en attente.
 */
export function pairInternalTransfers(ledger: Ledger, windowDays = 2): Patch {
  const patch = emptyPatch();
  const pending = alive(ledger.operations).filter((o) => o.status === 'pending' && !o.transferOperationId);
  const used = new Set<Id>();
  const debits = pending.filter((o) => o.amount < 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const credits = pending.filter((o) => o.amount > 0);
  for (const d of debits) {
    if (used.has(d.id)) continue;
    let best: Operation | undefined;
    let bestGap = Infinity;
    for (const c of credits) {
      if (used.has(c.id) || c.accountId === d.accountId || c.amount !== -d.amount) continue;
      const gap = Math.abs(diffDays(d.date, c.date));
      if (gap > windowDays || gap >= bestGap) continue;
      best = c;
      bestGap = gap;
    }
    if (!best) continue;
    used.add(d.id);
    used.add(best.id);
    patch.operations.push(
      { ...d, status: 'transfer', transferAccountId: best.accountId, transferOperationId: best.id },
      { ...best, status: 'transfer', transferAccountId: d.accountId, transferOperationId: d.id },
    );
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Virements vers les enveloppes, reconnus par leur libellé « TIRELIRE … »
// ---------------------------------------------------------------------------

/**
 * Une opération dont le libellé contient le libellé de virement d'une enveloppe
 * hébergée sur un autre compte est un virement interne vers ce compte,
 * ventilé sur cette enveloppe.
 */
export function matchEnvelopeTransfers(ledger: Ledger): Patch {
  const patch = emptyPatch();
  const envelopes = alive(ledger.envelopes);
  const labels = envelopes.map((e) => ({ e, label: transferLabel(e.name).replace(/^TIRELIRE /, '') }));
  for (const op of alive(ledger.operations)) {
    if (op.origin !== 'imported') continue;
    if (op.status !== 'pending' && !(op.status === 'transfer' && allocationsOf(ledger, op.id).length === 0)) continue;
    if (!/TIRELIRE/.test(op.normalizedLabel)) continue;
    const hit = labels
      .filter(({ e, label }) => e.accountId !== op.accountId && op.normalizedLabel.includes(label))
      .sort((a, b) => b.label.length - a.label.length)[0];
    if (!hit) continue;
    patch.operations.push({ ...op, status: 'transfer', transferAccountId: op.transferAccountId ?? hit.e.accountId });
    patch.allocations.push({ id: uuidv7(), operationId: op.id, envelopeId: hit.e.id, amount: op.amount });
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Rapprochement de flux prévus
// ---------------------------------------------------------------------------

export interface MatchProposal {
  operationId: Id;
  flowId: Id;
  expectedDate: ISODate;
  expectedAmount: Cents;
  /** 0-1 */
  score: number;
  /** Assez sûr pour être appliqué sans confirmation. */
  auto: boolean;
  reasons: string[];
}

function amountWithinTolerance(flow: PlannedFlow, amount: Cents): { ok: boolean; ratio: number } {
  const expected = flow.amount;
  if (Math.sign(expected) !== Math.sign(amount)) return { ok: false, ratio: 0 };
  const diff = Math.abs(Math.abs(amount) - Math.abs(expected));
  const tolAbs = flow.amountTolerance?.abs ?? 0;
  const tolPct = flow.amountTolerance?.pct ?? (flow.variable ? 30 : 0);
  const allowed = Math.max(tolAbs, (Math.abs(expected) * tolPct) / 100);
  const ratio = expected === 0 ? 0 : 1 - Math.min(1, diff / Math.max(1, Math.abs(expected)));
  return { ok: diff <= allowed + 0.5, ratio };
}

/**
 * Propose un flux prévu pour chaque opération en attente. Une occurrence d'un
 * flux n'est proposée qu'à une seule opération (la mieux notée).
 */
export function proposeMatches(ledger: Ledger, from: ISODate, to: ISODate): MatchProposal[] {
  const flows = alive(ledger.plannedFlows);
  const ops = alive(ledger.operations).filter((o) => o.status === 'pending' && o.date >= from && o.date <= to);
  const taken = new Set<string>(); // flowId|date déjà rapprochés
  for (const o of alive(ledger.operations)) {
    if (o.plannedFlowId) {
      const f = flows.find((x) => x.id === o.plannedFlowId);
      if (!f) continue;
      const occ = occurrencesBetween(f.periodicity, addDays(o.date, -f.dateWindowDays - 1), addDays(o.date, f.dateWindowDays + 1));
      const nearest = occ.sort((a, b) => Math.abs(diffDays(a, o.date)) - Math.abs(diffDays(b, o.date)))[0];
      if (nearest) taken.add(`${f.id}|${nearest}`);
    }
  }
  const candidates: MatchProposal[] = [];
  for (const op of ops) {
    for (const f of flows) {
      if (f.accountId !== op.accountId) continue;
      if (f.activeFrom && op.date < f.activeFrom) continue;
      if (f.activeTo && op.date > f.activeTo) continue;
      const amt = amountWithinTolerance(f, op.amount);
      if (!amt.ok) continue;
      const occ = occurrencesBetween(f.periodicity, addDays(op.date, -f.dateWindowDays), addDays(op.date, f.dateWindowDays));
      if (occ.length === 0) continue;
      const expectedDate = occ.sort((a, b) => Math.abs(diffDays(a, op.date)) - Math.abs(diffDays(b, op.date)))[0]!;
      if (taken.has(`${f.id}|${expectedDate}`)) continue;
      const reasons: string[] = [];
      const dateScore = 1 - Math.abs(diffDays(expectedDate, op.date)) / (f.dateWindowDays + 1);
      reasons.push(`date à ${Math.abs(diffDays(expectedDate, op.date))} j`);
      let labelScore = 0.5;
      if (f.labelPattern) {
        const re = new RegExp(f.labelPattern, 'i');
        labelScore = re.test(op.label) || re.test(op.normalizedLabel) || re.test(op.details ?? '') ? 1 : 0;
        reasons.push(labelScore ? 'libellé reconnu' : 'libellé différent');
      }
      if (amt.ratio === 1) reasons.push('montant exact');
      else reasons.push('montant dans la tolérance');
      const score = 0.3 * dateScore + 0.3 * amt.ratio + 0.4 * labelScore;
      const auto = !f.variable && (f.labelPattern ? labelScore === 1 && amt.ratio >= 0.98 : amt.ratio === 1 && dateScore >= 0.5);
      candidates.push({ operationId: op.id, flowId: f.id, expectedDate, expectedAmount: f.amount, score, auto, reasons });
    }
  }
  // Attribution gloutonne : meilleure note d'abord, une opération et une occurrence à la fois.
  candidates.sort((a, b) => b.score - a.score);
  const usedOps = new Set<Id>();
  const out: MatchProposal[] = [];
  for (const c of candidates) {
    const key = `${c.flowId}|${c.expectedDate}`;
    if (usedOps.has(c.operationId) || taken.has(key)) continue;
    usedOps.add(c.operationId);
    taken.add(key);
    out.push(c);
  }
  return out;
}

/** Applique une proposition : statut, flux, et ventilation d'après le flux. */
export function applyMatch(ledger: Ledger, m: MatchProposal): Patch {
  const patch = emptyPatch();
  const op = alive(ledger.operations).find((o) => o.id === m.operationId);
  const f = alive(ledger.plannedFlows).find((x) => x.id === m.flowId);
  if (!op || !f) return patch;
  const next: Operation = { ...op, status: f.kind === 'transfer' ? 'transfer' : 'matched', plannedFlowId: f.id };
  if (f.kind === 'transfer' && f.counterpartAccountId) next.transferAccountId = f.counterpartAccountId;
  patch.operations.push(next);
  const existing = allocationsOf(ledger, op.id);
  if (existing.length === 0 && (f.categoryId || f.envelopeId)) {
    patch.allocations.push({
      id: uuidv7(),
      operationId: op.id,
      amount: op.amount,
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f.envelopeId ? { envelopeId: f.envelopeId } : {}),
    });
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Règles de catégorisation
// ---------------------------------------------------------------------------

export function ruleMatches(rule: Rule, op: Operation): boolean {
  try {
    const re = new RegExp(rule.pattern, 'i');
    return re.test(op.label) || re.test(op.normalizedLabel) || (!!op.details && re.test(op.details));
  } catch {
    return false;
  }
}

/** Applique la première règle (par priorité) qui matche à chaque opération en attente non ventilée. */
export function applyRules(ledger: Ledger): Patch {
  const patch = emptyPatch();
  const rules = alive(ledger.rules).sort((a, b) => a.priority - b.priority);
  if (rules.length === 0) return patch;
  const categories = new Map(alive(ledger.categories).map((c) => [c.id, c]));
  for (const op of alive(ledger.operations)) {
    if (op.status !== 'pending') continue;
    if (allocationsOf(ledger, op.id).length > 0) continue;
    const rule = rules.find((r) => ruleMatches(r, op));
    if (!rule) continue;
    const envelopeId = rule.envelopeId ?? (rule.categoryId ? categories.get(rule.categoryId)?.envelopeId : undefined);
    patch.operations.push({ ...op, status: 'categorized' });
    patch.allocations.push({
      id: uuidv7(),
      operationId: op.id,
      amount: op.amount,
      ...(rule.categoryId ? { categoryId: rule.categoryId } : {}),
      ...(envelopeId ? { envelopeId } : {}),
    });
  }
  return patch;
}

/** Propose un motif de règle à partir d'un libellé : les premiers mots significatifs. */
export function suggestPattern(op: Operation): string {
  const words = op.normalizedLabel.split(' ').filter((w) => w.length > 2 && !/^\d+$/.test(w));
  const skip = new Set(['CARTE', 'PRELEVEMENT', 'EUROPEEN', 'VIR', 'VIREMENT', 'RECU', 'EMIS', 'PERM', 'INST', 'SEPA', 'DE', 'DE:']);
  const kept = words.filter((w) => !skip.has(w)).slice(0, 2);
  return (kept.length ? kept : words.slice(0, 2)).join('.*');
}

// ---------------------------------------------------------------------------
// Flux attendus non reçus
// ---------------------------------------------------------------------------

export interface MissingFlow {
  flowId: Id;
  name: string;
  expectedDate: ISODate;
  amount: Cents;
  /** Fin de la fenêtre de rapprochement. */
  windowEnd: ISODate;
}

/** Occurrences de flux dont la fenêtre est passée sans opération rapprochée. */
export function missingFlows(ledger: Ledger, from: ISODate, asOf: ISODate): MissingFlow[] {
  const out: MissingFlow[] = [];
  const matched = new Set<string>();
  const flows = alive(ledger.plannedFlows);
  for (const o of alive(ledger.operations)) {
    if (!o.plannedFlowId) continue;
    const f = flows.find((x) => x.id === o.plannedFlowId);
    if (!f) continue;
    const occ = occurrencesBetween(f.periodicity, addDays(o.date, -f.dateWindowDays - 1), addDays(o.date, f.dateWindowDays + 1));
    for (const d of occ) matched.add(`${f.id}|${d}`);
  }
  for (const f of flows) {
    // Un flux ne peut manquer que sur un compte importé.
    const acc = ledger.accounts.find((a) => a.id === f.accountId);
    if (!acc || acc.kind === 'third') continue;
    for (const d of occurrencesBetween(f.periodicity, from, asOf)) {
      if (f.activeFrom && d < f.activeFrom) continue;
      if (f.activeTo && d > f.activeTo) continue;
      const windowEnd = addDays(d, f.dateWindowDays);
      if (windowEnd >= asOf) continue;
      if (matched.has(`${f.id}|${d}`)) continue;
      out.push({ flowId: f.id, name: f.name, expectedDate: d, amount: f.amount, windowEnd });
    }
  }
  return out.sort((a, b) => (a.expectedDate < b.expectedDate ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Pipeline après import
// ---------------------------------------------------------------------------

export interface PipelineReport {
  transfersPaired: number;
  envelopeTransfers: number;
  autoMatched: number;
  proposals: MatchProposal[];
  ruled: number;
}

/**
 * Enchaîne les étapes automatiques sur un grand livre déjà enrichi des nouvelles
 * opérations, et rend un patch cumulé ainsi qu'un rapport. `apply` reçoit chaque
 * patch intermédiaire pour que les étapes suivantes voient le résultat des précédentes.
 */
export function runPipeline(ledger: Ledger, from: ISODate, to: ISODate, apply: (p: Patch) => Ledger): PipelineReport {
  let l = ledger;
  const t = pairInternalTransfers(l);
  l = apply(t);
  const e = matchEnvelopeTransfers(l);
  l = apply(e);
  const proposals = proposeMatches(l, from, to);
  let autoMatched = 0;
  for (const m of proposals.filter((p) => p.auto)) {
    l = apply(applyMatch(l, m));
    autoMatched++;
  }
  const r = applyRules(l);
  l = apply(r);
  return {
    transfersPaired: t.operations.length / 2,
    envelopeTransfers: e.operations.length,
    autoMatched,
    proposals: proposals.filter((p) => !p.auto),
    ruled: r.operations.length,
  };
}

/** Applique un patch à un grand livre en mémoire (nouvel objet). */
export function applyPatchToLedger(ledger: Ledger, patch: Patch): Ledger {
  const ops = new Map(ledger.operations.map((o) => [o.id, o]));
  for (const o of patch.operations) ops.set(o.id, o);
  const allocs = new Map(ledger.allocations.map((a) => [a.id, a]));
  for (const a of patch.allocations) allocs.set(a.id, a);
  return { ...ledger, operations: [...ops.values()], allocations: [...allocs.values()] };
}
