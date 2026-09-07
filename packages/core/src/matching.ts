/**
 * Après import : virements internes, rapprochement de flux prévus, virements vers
 * les enveloppes (par libellé), règles de catégorisation, flux attendus non reçus.
 *
 * Toutes les fonctions sont pures : elles reçoivent le grand livre et rendent
 * les lignes à écrire (`Patch`). L'application les enregistre dans le dépôt.
 */
import type { Allocation, Cents, Id, ISODate, Ledger, Operation, PlannedFlow } from './model.js';
import { alive, isLocked } from './model.js';
import { diffDays, addDays } from './dates.js';
import { occurrencesBetween } from './periods.js';
import { fundByPriority, transferLabel } from './plan.js';
import { envelopeComponents, indexLedger, periodSnapshot } from './balances.js';
import { uuidv7, normalizeLabel } from './ids.js';
import { applyRules } from './rules.js';

export interface Patch {
  operations: Operation[];
  allocations: Allocation[];
  /** Lignes de ventilation à supprimer (une édition manuelle peut en retirer, D27). */
  removedAllocations?: Id[];
}

export function emptyPatch(): Patch {
  return { operations: [], allocations: [], removedAllocations: [] };
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
  const pending = alive(ledger.operations).filter((o) => !isLocked(o) && !o.transferAccountId && !o.transferOperationId);
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
      { ...d, state: 'reconciled', transferAccountId: best.accountId, transferOperationId: best.id },
      { ...best, state: 'reconciled', transferAccountId: d.accountId, transferOperationId: d.id },
    );
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Virements vers un compte, reconnus par leur libellé « TIRELIRE <COMPTE> » (D21)
// ---------------------------------------------------------------------------

/**
 * Répartit un virement constaté du pivot vers `accountId` entre les enveloppes placées sur ce
 * compte, par l'ordre de financement de D06 : les planchers (rattrapages d'échéances) d'abord,
 * puis les écarts de placement par priorité ; le reste, s'il y en a, va à la première enveloppe.
 * Rend, par enveloppe, la part (positive) à ventiler.
 */
export function distributeTransfer(ledger: Ledger, accountId: Id, amount: Cents, asOf: ISODate): Array<{ envelopeId: Id; amount: Cents }> {
  const idx = indexLedger(ledger);
  const pivot = idx.pivot;
  const lines: Array<{ envelopeId: Id; name: string; priority: number; dueDate: string; floor: Cents; requested: Cents; funded: Cents }> = [];
  for (const e of idx.envelopesById.values()) {
    if (e.placementAccountId !== accountId) continue;
    const comps = envelopeComponents(e, idx, asOf);
    const gap = pivot ? (comps.get(pivot.id) ?? 0) : 0;
    if (gap <= 0) continue;
    const snap = periodSnapshot(e, idx, asOf);
    const floor = Math.min(gap, snap?.needs.reduce((s, n) => s + n.floor, 0) ?? 0);
    const priority = Math.min(...(idx.needsByEnvelope.get(e.id) ?? []).map((n) => n.priority), 1000);
    const dueDate = (snap?.needs.map((n) => n.dueDate).filter((d): d is string => !!d).sort()[0]) ?? '9999-12-31';
    lines.push({ envelopeId: e.id, name: e.name, priority, dueDate, floor, requested: gap, funded: 0 });
  }
  // À priorité égale, l'échéance la plus proche d'abord.
  lines.sort((a, b) => a.priority - b.priority || a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, 'fr'));
  const rest = fundByPriority(lines, Math.abs(amount));
  const out = lines.filter((l) => l.funded > 0).map((l) => ({ envelopeId: l.envelopeId, amount: l.funded }));
  if (rest > 0) {
    if (out.length > 0) out[0]!.amount += rest;
    else if (lines.length > 0) out.push({ envelopeId: lines[0]!.envelopeId, amount: rest });
  }
  return out;
}

/**
 * Une opération importée dont le libellé contient le libellé de virement d'un autre compte suivi
 * est un virement interne vers ce compte ; son montant est ventilé sur les enveloppes qui y sont
 * placées (`distributeTransfer`). Sans enveloppe placée là, le virement est reconnu sans ventilation.
 */
export function matchEnvelopeTransfers(ledger: Ledger): Patch {
  const patch = emptyPatch();
  const accounts = alive(ledger.accounts).map((a) => ({ a, label: transferLabel(a.name).replace(/^TIRELIRE /, '') }));
  const transferCategory = alive(ledger.categories).find((c) => /^virement/i.test(c.name));
  for (const op of alive(ledger.operations)) {
    if (op.origin !== 'imported') continue;
    if (isLocked(op)) continue;
    if (op.transferAccountId && allocationsOf(ledger, op.id).length > 0) continue;
    if (!/TIRELIRE/.test(op.normalizedLabel)) continue;
    const hit = accounts
      .filter(({ a, label }) => a.id !== op.accountId && label.length > 0 && op.normalizedLabel.includes(label))
      .sort((a, b) => b.label.length - a.label.length)[0];
    if (!hit) continue;
    const target = op.transferAccountId ?? hit.a.id;
    patch.operations.push({ ...op, state: 'reconciled', transferAccountId: target });
    if (op.amount >= 0) continue;
    for (const part of distributeTransfer(ledger, target, op.amount, op.date)) {
      patch.allocations.push({
        id: uuidv7(),
        operationId: op.id,
        envelopeId: part.envelopeId,
        share: { kind: 'fixed', amount: -part.amount },
        ...(transferCategory ? { categoryId: transferCategory.id } : {}),
      });
    }
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
  const ops = alive(ledger.operations).filter((o) => !isLocked(o) && !o.plannedFlowId && o.date >= from && o.date <= to);
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
  // Le rapprochement de flux ne verrouille pas à lui seul (D22) : il rend l'opération rapprochée.
  const next: Operation = { ...op, state: isLocked(op) ? 'locked' : 'reconciled', plannedFlowId: f.id };
  if (f.kind === 'transfer' && f.counterpartAccountId) next.transferAccountId = f.counterpartAccountId;
  patch.operations.push(next);
  const existing = allocationsOf(ledger, op.id);
  if (existing.length === 0 && (f.categoryId || f.envelopeId)) {
    patch.allocations.push({
      id: uuidv7(),
      operationId: op.id,
      // Part variable : la ventilation d'un flux à montant variable reste rejouable (D27).
      share: { kind: 'variable' },
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f.envelopeId ? { envelopeId: f.envelopeId } : {}),
    });
  }
  return patch;
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
  for (const id of patch.removedAllocations ?? []) allocs.delete(id);
  return { ...ledger, operations: [...ops.values()], allocations: [...allocs.values()] };
}
