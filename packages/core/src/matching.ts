/**
 * Après import : virements internes, rapprochement de flux prévus, virements vers
 * les tirelires (par libellé), règles de catégorisation, flux attendus non reçus.
 *
 * Toutes les fonctions sont pures : elles reçoivent le grand livre et rendent
 * les lignes à écrire (`Patch`). L'application les enregistre dans le dépôt.
 */
import type { SubOperation, Cents, Id, ISODate, Ledger, Operation, PlannedFlow } from './model.js';
import { alive, isDerivedFlow, isLocked, resumedOperationIds } from './model.js';
import { diffDays, addDays } from './dates.js';
import { occurrencesBetween } from './periods.js';
import { fundByPriority, transferLabel } from './plan.js';
import { tirelireComponents, indexLedger, periodSnapshot } from './balances.js';
import { uuidv7, normalizeLabel } from './ids.js';
import { applyAutomations } from './automations.js';
import { liveSubOperations } from './suboperations.js';

export interface Patch {
  operations: Operation[];
  subOperations: SubOperation[];
  /** Sous-opérations à retirer, à tous les niveaux (une édition manuelle ou une règle en retire, D27). */
  removedSubOperations?: Id[];
}

export function emptyPatch(): Patch {
  return { operations: [], subOperations: [], removedSubOperations: [] };
}

function subOperationsOf(ledger: Ledger, opId: Id): SubOperation[] {
  return liveSubOperations(ledger.subOperations).filter((a) => a.operationId === opId);
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
 * Répartit un virement constaté du compte principal vers `accountId` entre les tirelires placées sur ce
 * compte, par l'ordre de financement de D06 : les planchers (ce que demandent les échéances, lissage décidé compris) d'abord,
 * puis les écarts de placement par priorité ; le reste, s'il y en a, va à la première tirelire.
 * Rend, par tirelire, la part (positive) à ventiler.
 */
export function distributeTransfer(ledger: Ledger, accountId: Id, amount: Cents, asOf: ISODate): Array<{ tirelireId: Id; amount: Cents }> {
  const idx = indexLedger(ledger);
  const principal = idx.principal;
  const lines: Array<{ tirelireId: Id; name: string; priority: number; dueDate: string; floor: Cents; requested: Cents; funded: Cents }> = [];
  for (const e of idx.tireliresById.values()) {
    // Tirelires qui veulent de l'argent sur ce compte (D38).
    if (!e.placement.some((p) => p.accountId === accountId)) continue;
    const comps = tirelireComponents(e, idx, asOf);
    const gap = principal ? (comps.get(principal.id) ?? 0) : 0;
    if (gap <= 0) continue;
    const snap = periodSnapshot(e, idx, asOf);
    const floor = Math.min(gap, snap?.needs.reduce((s, n) => s + n.floor, 0) ?? 0);
    const priority = Math.min(...(idx.needsByTirelire.get(e.id) ?? []).map((n) => n.priority), 1000);
    const dueDate = (snap?.needs.map((n) => n.dueDate).filter((d): d is string => !!d).sort()[0]) ?? '9999-12-31';
    lines.push({ tirelireId: e.id, name: e.name, priority, dueDate, floor, requested: gap, funded: 0 });
  }
  // À priorité égale, l'échéance la plus proche d'abord.
  lines.sort((a, b) => a.priority - b.priority || a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, 'fr'));
  const rest = fundByPriority(lines, Math.abs(amount));
  const out = lines.filter((l) => l.funded > 0).map((l) => ({ tirelireId: l.tirelireId, amount: l.funded }));
  if (rest > 0) {
    if (out.length > 0) out[0]!.amount += rest;
    else if (lines.length > 0) out.push({ tirelireId: lines[0]!.tirelireId, amount: rest });
  }
  return out;
}

/**
 * Une opération importée dont le libellé contient le libellé de virement d'un autre compte suivi
 * est un virement interne vers ce compte ; son montant est ventilé sur les tirelires qui y sont
 * placées (`distributeTransfer`). Sans tirelire placée là, le virement est reconnu sans ventilation.
 */
export function matchTirelireTransfers(ledger: Ledger): Patch {
  const patch = emptyPatch();
  const accounts = alive(ledger.accounts).map((a) => ({ a, label: transferLabel(a.name).replace(/^TIRELIRE /, '') }));
  const transferCategory = alive(ledger.categories).find((c) => /^virement/i.test(c.name));
  for (const op of alive(ledger.operations)) {
    if (op.origin !== 'imported') continue;
    if (isLocked(op)) continue;
    if (op.transferAccountId && subOperationsOf(ledger, op.id).length > 0) continue;
    if (!/TIRELIRE/.test(op.normalizedLabel)) continue;
    const hit = accounts
      .filter(({ a, label }) => a.id !== op.accountId && label.length > 0 && op.normalizedLabel.includes(label))
      .sort((a, b) => b.label.length - a.label.length)[0];
    if (!hit) continue;
    const target = op.transferAccountId ?? hit.a.id;
    patch.operations.push({ ...op, state: 'reconciled', transferAccountId: target });
    if (op.amount >= 0) continue;
    for (const part of distributeTransfer(ledger, target, op.amount, op.date)) {
      patch.subOperations.push({
        id: uuidv7(),
        operationId: op.id,
        tirelireId: part.tirelireId,
        share: { kind: 'fixed', amount: -part.amount },
        ...(transferCategory ? { categoryId: transferCategory.id } : {}),
      });
    }
  }
  return patch;
}

// ---------------------------------------------------------------------------
// La reprise (D88) : rapprochement de flux (D12, D22, D24) et reprise d'une saisie
// ---------------------------------------------------------------------------

/** Clé d'une occurrence d'un flux : une opération prévue se désigne par son flux et sa date (D88). */
export function occurrenceKey(flowId: Id, date: ISODate): string {
  return `${flowId}|${date}`;
}

/** L'opération reprend-elle une autre opération, prévue ou saisie (D88) ? */
export function resumesSomething(op: Operation): boolean {
  return !!op.plannedFlowId || !!op.resumedOperationId;
}

/** Pour chaque occurrence reprise, l'opération vivante qui la reprend : une occurrence n'est reprise qu'une fois (D12). */
function occurrenceTakers(ledger: Ledger): Map<string, Operation> {
  const out = new Map<string, Operation>();
  for (const o of alive(ledger.operations)) if (o.plannedFlowId && o.plannedDate) out.set(occurrenceKey(o.plannedFlowId, o.plannedDate), o);
  return out;
}

export interface MatchProposal {
  operationId: Id;
  flowId: Id;
  /** Date de l'occurrence reconnue : avec le flux, elle désigne l'opération prévue reprise (D88). */
  expectedDate: ISODate;
  expectedAmount: Cents;
  /**
   * La saisie qui corrige ou masque déjà cette occurrence : c'est elle que l'opération reprend, et non
   * l'occurrence (D88).
   */
  resumedOperationId?: Id;
  /** 0-1 */
  score: number;
  /** Assez sûr pour être appliqué sans confirmation (D12). */
  auto: boolean;
  reasons: string[];
}

function amountWithinTolerance(flow: PlannedFlow, amount: Cents): { ok: boolean; ratio: number; exact: boolean } {
  const expected = flow.amount;
  if (Math.sign(expected) !== Math.sign(amount)) return { ok: false, ratio: 0, exact: false };
  const diff = Math.abs(Math.abs(amount) - Math.abs(expected));
  const tolAbs = flow.amountTolerance?.abs ?? 0;
  const tolPct = flow.amountTolerance?.pct ?? (flow.variable ? 30 : 0);
  const allowed = Math.max(tolAbs, (Math.abs(expected) * tolPct) / 100);
  const ratio = expected === 0 ? 0 : 1 - Math.min(1, diff / Math.max(1, Math.abs(expected)));
  return { ok: diff <= allowed + 0.5, ratio, exact: diff === 0 };
}

/** Le motif de libellé du flux reconnaît-il l'opération ? Un motif illisible ne reconnaît rien. */
function labelRecognized(pattern: string, op: Operation): boolean {
  try {
    const re = new RegExp(pattern, 'i');
    return re.test(op.label) || re.test(op.normalizedLabel) || re.test(op.details ?? '');
  } catch {
    return false;
  }
}

/**
 * La sélection des flux, la seule (D24), sur les opérations bancaires sans reprise, non verrouillées,
 * datées entre `from` et `to` : le compte du flux, son motif de libellé s'il en a un, sa tolérance de
 * montant et la fenêtre de ses occurrences (D12). Ce qu'elle ne reconnaît pas, le flux ne le reprend
 * ni ne le classe.
 *
 * Automatique selon D12 — montant exact, ou dans la tolérance avec le libellé reconnu, flux non
 * variable —, proposée sinon. Une occurrence n'est reprise qu'une fois, et une opération en reprend
 * au plus une : la mieux notée. Une occurrence qu'une saisie corrige ou masque déjà se reprend par
 * cette saisie (D88).
 */
export function proposeMatches(ledger: Ledger, from: ISODate, to: ISODate): MatchProposal[] {
  const flows = alive(ledger.plannedFlows);
  const resumed = resumedOperationIds(ledger.operations);
  const takers = occurrenceTakers(ledger);
  const ops = alive(ledger.operations).filter((o) => o.origin === 'imported' && !isLocked(o) && !resumesSomething(o) && !resumed.has(o.id) && o.date >= from && o.date <= to);
  const candidates: MatchProposal[] = [];
  for (const op of ops) {
    for (const f of flows) {
      if (f.accountId !== op.accountId) continue;
      if (f.activeFrom && op.date < f.activeFrom) continue;
      if (f.activeTo && op.date > f.activeTo) continue;
      const amt = amountWithinTolerance(f, op.amount);
      if (!amt.ok) continue;
      const label = f.labelPattern ? labelRecognized(f.labelPattern, op) : undefined;
      if (label === false) continue;
      const occ = occurrencesBetween(f.periodicity, addDays(op.date, -f.dateWindowDays), addDays(op.date, f.dateWindowDays));
      if (occ.length === 0) continue;
      const expectedDate = occ.sort((a, b) => Math.abs(diffDays(a, op.date)) - Math.abs(diffDays(b, op.date)))[0]!;
      const taker = takers.get(occurrenceKey(f.id, expectedDate));
      // Reprise par une opération bancaire, ou par une saisie déjà reprise : l'occurrence est servie.
      if (taker && (taker.origin !== 'manual' || resumed.has(taker.id))) continue;
      const reasons: string[] = [];
      const dateScore = 1 - Math.abs(diffDays(expectedDate, op.date)) / (f.dateWindowDays + 1);
      reasons.push(`date à ${Math.abs(diffDays(expectedDate, op.date))} j`);
      if (label) reasons.push('libellé reconnu');
      reasons.push(amt.exact ? 'montant exact' : 'montant dans la tolérance');
      if (taker) reasons.push('déjà corrigée par une saisie');
      const score = 0.3 * dateScore + 0.3 * amt.ratio + 0.4 * (label ? 1 : 0.5);
      const auto = !f.variable && (amt.exact || label === true);
      candidates.push({
        operationId: op.id,
        flowId: f.id,
        expectedDate,
        expectedAmount: f.amount,
        ...(taker ? { resumedOperationId: taker.id } : {}),
        score,
        auto,
        reasons,
      });
    }
  }
  // Attribution gloutonne : meilleure note d'abord, une opération et une occurrence à la fois.
  candidates.sort((a, b) => b.score - a.score);
  const usedOps = new Set<Id>();
  const taken = new Set<string>();
  const out: MatchProposal[] = [];
  for (const c of candidates) {
    const key = occurrenceKey(c.flowId, c.expectedDate);
    if (usedOps.has(c.operationId) || taken.has(key)) continue;
    usedOps.add(c.operationId);
    taken.add(key);
    out.push(c);
  }
  return out;
}

/**
 * La ventilation d'un flux pour l'opération qui reprend une de ses occurrences (D88) : celle d'un
 * virement permanent **dérivé** se rejoue par l'ordre de financement (D06, D21, D60) sur le montant
 * réel, au jour de l'opération ; sinon, la catégorie et la tirelire du flux, en part variable.
 */
function flowVentilation(ledger: Ledger, f: PlannedFlow, operationId: Id, amount: Cents, date: ISODate, target: Id | undefined): SubOperation[] {
  /*
   * Virement permanent **dérivé** (D21, D57) : sa ventilation ne se lit pas dans le flux, elle se
   * **rejoue** par l'ordre de financement (D06) sur le montant réellement viré, au jour de
   * l'opération. Une ventilation mémorisée redeviendrait fausse au premier changement de budget —
   * et le pire cas était le montant resté identique, où l'ancienne photo s'appliquait sans que rien
   * ne le dise.
   *
   * Un virement **déclaré**, lui, n'est pas un calcul : il garde la tirelire et la catégorie qu'on
   * lui a données, avec la part variable qui suit le montant du jour. Le rejouer reviendrait à
   * réécrire un fait de l'utilisateur, ce que D57 interdit.
   */
  const parts = f.kind === 'transfer' && isDerivedFlow(f) && target ? distributeTransfer(ledger, target, amount, date) : [];
  if (parts.length > 0)
    return parts.map((part) => ({
      id: uuidv7(),
      operationId,
      tirelireId: part.tirelireId,
      share: { kind: 'fixed' as const, amount: amount < 0 ? -part.amount : part.amount },
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    }));
  if (!f.categoryId && !f.tirelireId) return [];
  return [
    {
      id: uuidv7(),
      operationId,
      // Part variable : la ventilation d'un flux à montant variable reste rejouable (D27).
      share: { kind: 'variable' },
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f.tirelireId ? { tirelireId: f.tirelireId } : {}),
    },
  ];
}

/** Ce qu'un flux reprend devient rapproché (D22), verrouillé s'il le demande ; verrouillé, il le reste. */
function stateOnResumption(op: Operation, f: PlannedFlow | undefined): Operation['state'] {
  return isLocked(op) || f?.locks ? 'locked' : 'reconciled';
}

/**
 * Applique une proposition : l'opération reprend l'occurrence, désignée par son flux et sa date, ou la
 * saisie qui la corrige ou la masque déjà (D88). Elle devient rapprochée, verrouillée si le flux le
 * demande (D22, D24), et garde ce qui a été décidé sur elle : sa ventilation, si elle en a une ;
 * sinon, elle prend celle de ce qu'elle reprend.
 */
export function applyMatch(ledger: Ledger, m: MatchProposal): Patch {
  const patch = emptyPatch();
  const op = alive(ledger.operations).find((o) => o.id === m.operationId);
  const f = alive(ledger.plannedFlows).find((x) => x.id === m.flowId);
  if (!op || !f) return patch;
  if (m.resumedOperationId) return resumeEntryWith(ledger, op, m.resumedOperationId, f);
  const next: Operation = { ...op, state: stateOnResumption(op, f), plannedFlowId: f.id, plannedDate: m.expectedDate };
  delete next.resumedOperationId;
  if (f.kind === 'transfer' && f.counterpartAccountId) next.transferAccountId = f.counterpartAccountId;
  patch.operations.push(next);
  if (subOperationsOf(ledger, op.id).length === 0)
    patch.subOperations.push(...flowVentilation(ledger, f, op.id, op.amount, op.date, f.counterpartAccountId ?? op.transferAccountId));
  return patch;
}

/**
 * Les saisies qu'une opération bancaire peut reprendre (D88, principe 4.4) : non reprises, du même
 * compte et du même sens, les plus proches en date, puis en montant. Une saisie de zéro n'a pas de
 * sens : elle ne se reprend que par l'occurrence qu'elle masque (`proposeMatches`) ; un lissage
 * décidé n'annonce aucun mouvement de la banque.
 */
export function entryCandidates(ledger: Ledger, operationId: Id): Operation[] {
  const op = alive(ledger.operations).find((o) => o.id === operationId);
  if (!op || op.origin !== 'imported' || resumesSomething(op) || op.amount === 0) return [];
  const resumed = resumedOperationIds(ledger.operations);
  const smoothing = new Set(alive(ledger.shortfallAnswers ?? []).flatMap((a) => (a.operationId ? [a.operationId] : [])));
  const distance = (e: Operation) => [Math.abs(diffDays(e.date, op.date)), Math.abs(e.amount - op.amount)] as const;
  return alive(ledger.operations)
    .filter(
      (e) =>
        e.origin === 'manual' &&
        e.id !== op.id &&
        e.accountId === op.accountId &&
        e.amount !== 0 &&
        Math.sign(e.amount) === Math.sign(op.amount) &&
        !e.resumedOperationId &&
        !resumed.has(e.id) &&
        !smoothing.has(e.id),
    )
    .sort((a, b) => {
      const [da, ma] = distance(a);
      const [db, mb] = distance(b);
      return da - db || ma - mb || a.id.localeCompare(b.id);
    });
}

/**
 * L'opération bancaire reprend la saisie qui annonçait le même mouvement, sur validation de
 * l'utilisateur (D88, principe 4.4). Elle devient rapprochée, garde ce qui a été décidé sur elle, et
 * prend sinon la ventilation de la saisie.
 */
export function resumeEntry(ledger: Ledger, operationId: Id, entryId: Id): Patch {
  const op = alive(ledger.operations).find((o) => o.id === operationId);
  if (!op || !entryCandidates(ledger, operationId).some((e) => e.id === entryId)) return emptyPatch();
  return resumeEntryWith(ledger, op, entryId, undefined);
}

function resumeEntryWith(ledger: Ledger, op: Operation, entryId: Id, flow: PlannedFlow | undefined): Patch {
  const patch = emptyPatch();
  const entry = alive(ledger.operations).find((o) => o.id === entryId);
  if (!entry) return patch;
  const next: Operation = { ...op, state: stateOnResumption(op, flow), resumedOperationId: entry.id };
  delete next.plannedFlowId;
  delete next.plannedDate;
  const target = flow?.counterpartAccountId ?? entry.transferAccountId;
  if (target && !next.transferAccountId) next.transferAccountId = target;
  patch.operations.push(next);
  if (subOperationsOf(ledger, op.id).length > 0) return patch;
  // La saisie corrige un virement permanent dérivé : la ventilation se rejoue sur le montant réel (D21, D60).
  const entryFlow = entry.plannedFlowId ? alive(ledger.plannedFlows).find((f) => f.id === entry.plannedFlowId) : undefined;
  if (entryFlow && entryFlow.kind === 'transfer' && isDerivedFlow(entryFlow)) {
    patch.subOperations.push(...flowVentilation(ledger, entryFlow, op.id, op.amount, op.date, entryFlow.counterpartAccountId ?? next.transferAccountId));
    return patch;
  }
  // Sinon, la ventilation de la saisie, à tous ses niveaux, recopiée sur l'opération qui la reprend.
  const subs = subOperationsOf(ledger, entry.id);
  const ids = new Map(subs.map((s) => [s.id, uuidv7()]));
  for (const s of subs) {
    const copy: SubOperation = { ...s, id: ids.get(s.id)!, operationId: op.id };
    if (s.parentId) copy.parentId = ids.get(s.parentId)!;
    patch.subOperations.push(copy);
  }
  return patch;
}

/**
 * Défaire une reprise (D88) : l'opération ne reprend plus rien, et ce qu'elle reprenait compte de
 * nouveau. Verrouillée, elle garde ce qui a été décidé sur elle (D22) ; sinon, elle repart de ce que
 * l'import a établi et les automatismes la reprennent (D33).
 */
export function undoResumption(ledger: Ledger, operationId: Id): Patch {
  const patch = emptyPatch();
  const op = alive(ledger.operations).find((o) => o.id === operationId);
  if (!op || !resumesSomething(op)) return patch;
  const next: Operation = { ...op };
  delete next.plannedFlowId;
  delete next.plannedDate;
  delete next.resumedOperationId;
  patch.operations.push(next);
  if (isLocked(op)) return patch;
  const after = applyPatchToLedger(ledger, patch);
  const automated = applyAutomations(after);
  const mine = automated.operations.find((o) => o.id === op.id);
  if (mine) patch.operations[0] = mine;
  patch.subOperations.push(...automated.subOperations.filter((s) => s.operationId === op.id));
  const own = new Set(subOperationsOf(ledger, op.id).map((s) => s.id));
  patch.removedSubOperations!.push(...(automated.removedSubOperations ?? []).filter((id) => own.has(id)));
  return patch;
}

/** Ce qu'une opération reprend (D88) : une occurrence d'un flux, ou une saisie, avec son montant et l'écart. */
export interface Resumption {
  /** L'occurrence reprise : son flux et sa date. */
  flow?: PlannedFlow;
  date: ISODate;
  /** La saisie reprise. */
  operation?: Operation;
  /** Montant de ce qui est repris : celui du flux pour une occurrence, celui de la saisie sinon. */
  amount: Cents;
  /** Écart : le montant de l'opération qui reprend, moins celui de ce qu'elle reprend. */
  gap: Cents;
}

export function resumptionOf(ledger: Ledger, op: Operation): Resumption | undefined {
  if (op.plannedFlowId && op.plannedDate) {
    const flow = ledger.plannedFlows.find((f) => f.id === op.plannedFlowId);
    const amount = flow?.amount ?? 0;
    return { ...(flow ? { flow } : {}), date: op.plannedDate, amount, gap: op.amount - amount };
  }
  if (op.resumedOperationId) {
    const operation = ledger.operations.find((o) => o.id === op.resumedOperationId);
    const amount = operation?.amount ?? 0;
    return { ...(operation ? { operation } : {}), date: operation?.date ?? op.date, amount, gap: op.amount - amount };
  }
  return undefined;
}

/** L'opération vivante qui reprend celle-ci, s'il y en a une (D88). */
export function resumerOf(ledger: Ledger, operationId: Id): Operation | undefined {
  return alive(ledger.operations).find((o) => o.resumedOperationId === operationId);
}

/**
 * Ce qui empêche de supprimer ces opérations (#306, point 9) : les opérations vivantes qui en
 * reprennent une. Tant que la reprise tient, la saisie reprise ne se supprime pas — sinon
 * l'occurrence qu'elle corrigeait redeviendrait libre, et le mouvement compterait deux fois.
 * Défaire d'abord la reprise (`undoResumption`) la rend supprimable.
 */
export function removalBlockers(ledger: Ledger, operationIds: Id[]): Operation[] {
  const ids = new Set(operationIds);
  return alive(ledger.operations).filter((o) => !!o.resumedOperationId && ids.has(o.resumedOperationId) && !ids.has(o.id));
}

/**
 * Corriger une opération prévue, ou la masquer (D88, porteur, 30/09) : une saisie qui la reprend —
 * elle vaudra `amount`, à `date` ; zéro, elle n'aura pas lieu. La saisie est un fait de l'utilisateur,
 * verrouillée (D22), et prend la ventilation du flux, rejouée sur son montant pour un virement
 * permanent dérivé. Un virement corrigé garde ses deux côtés, comme l'opération prévue qu'il
 * remplace (`withPlannedOperations`) ; masqué, il n'en a pas. La retirer fait compter de nouveau
 * l'opération prévue.
 */
export function correctPlannedOperation(ledger: Ledger, flowId: Id, occurrenceDate: ISODate, amount: Cents, date: ISODate): Patch {
  const patch = emptyPatch();
  const f = alive(ledger.plannedFlows).find((x) => x.id === flowId);
  if (!f || occurrenceTakers(ledger).has(occurrenceKey(f.id, occurrenceDate))) return patch;
  const op: Operation = {
    id: uuidv7(),
    accountId: f.accountId,
    origin: 'manual',
    date,
    label: f.name,
    normalizedLabel: normalizeLabel(f.name),
    amount,
    state: 'locked',
    plannedFlowId: f.id,
    plannedDate: occurrenceDate,
  };
  const counterpart = f.kind === 'transfer' ? f.counterpartAccountId : undefined;
  if (counterpart) op.transferAccountId = counterpart;
  patch.operations.push(op);
  if (amount === 0) return patch;
  if (counterpart) {
    const twin: Operation = { ...op, id: uuidv7(), accountId: counterpart, amount: -amount, transferAccountId: f.accountId, transferOperationId: op.id };
    delete twin.plannedFlowId;
    delete twin.plannedDate;
    op.transferOperationId = twin.id;
    patch.operations.push(twin);
  }
  patch.subOperations.push(...flowVentilation(ledger, f, op.id, amount, date, counterpart));
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

/** Ce qu'est devenue une occurrence attendue d'un flux, au pointage de D12. */
export type OccurrenceStatus = 'pointee' | 'attendue' | 'nonRecue';

export interface FlowOccurrence {
  /** Date attendue de l'occurrence. */
  date: ISODate;
  /** Fin de sa fenêtre de rapprochement. */
  windowEnd: ISODate;
  /**
   * `pointee` : une opération la reprend (D88) ; `attendue` : sa fenêtre court encore à `asOf` ;
   * `nonRecue` : la fenêtre est passée sans reprise (D12).
   */
  status: OccurrenceStatus;
  /** L'opération qui la reprend, s'il y en a une. */
  operationId?: Id;
}

/**
 * Le suivi des opérations d'un compte : il porte au moins une opération importée. Sans suivi
 * (U1), rien ne se pointe : une occurrence n'y est ni reçue ni manquante, et le plan n'en dit rien
 * (#183, point 6).
 */
export function tracksOperations(ledger: Ledger, accountId: Id): boolean {
  return alive(ledger.operations).some((o) => o.accountId === accountId && o.origin === 'imported');
}

/**
 * Les occurrences d'un flux entre `from` et `to`, chacune avec ce qu'elle est devenue à `asOf`
 * (D12) : reprise, attendue dans sa fenêtre, ou attendue non reçue. Une opération reprend
 * l'occurrence que désignent son flux et sa date (D88) : saisie qui la corrige ou la masque, ou
 * opération bancaire qui la réalise.
 */
export function flowOccurrences(ledger: Ledger, flow: PlannedFlow, from: ISODate, to: ISODate, asOf: ISODate): FlowOccurrence[] {
  const takers = new Map<ISODate, Operation>();
  for (const o of alive(ledger.operations)) if (o.plannedFlowId === flow.id && o.plannedDate) takers.set(o.plannedDate, o);
  const out: FlowOccurrence[] = [];
  for (const d of occurrencesBetween(flow.periodicity, from, to)) {
    if (flow.activeFrom && d < flow.activeFrom) continue;
    if (flow.activeTo && d > flow.activeTo) continue;
    const windowEnd = addDays(d, flow.dateWindowDays);
    const op = takers.get(d);
    if (op) out.push({ date: d, windowEnd, status: 'pointee', operationId: op.id });
    else out.push({ date: d, windowEnd, status: windowEnd >= asOf ? 'attendue' : 'nonRecue' });
  }
  return out;
}

/**
 * Ce qui compte, parmi les occurrences d'un flux (D12, D88) — un seul calcul, pour le solde prévu
 * (`withPlannedOperations`) comme pour le bloc « Attendus, non reçus » (`missingFlows`) :
 * - une occurrence reprise par une opération (son flux et sa date, `Operation.plannedFlowId` et
 *   `plannedDate`) ne compte plus, l'opération compte à sa place ;
 * - sur un compte suivi (`tracksOperations`), une occurrence dont la fenêtre est passée sans reprise
 *   est « attendue, non reçue », et ne compte plus ;
 * - sur un compte sans suivi (U1), rien ne se confronte : toute autre occurrence compte à sa date.
 */
export function flowOccurrencesThatCount(
  ledger: Ledger,
  flow: PlannedFlow,
  from: ISODate,
  to: ISODate,
  asOf: ISODate,
  tracked: boolean = tracksOperations(ledger, flow.accountId),
): { counted: FlowOccurrence[]; notReceived: FlowOccurrence[] } {
  const counted: FlowOccurrence[] = [];
  const notReceived: FlowOccurrence[] = [];
  for (const o of flowOccurrences(ledger, flow, from, to, asOf)) {
    if (o.status === 'pointee') continue;
    if (o.status === 'nonRecue' && tracked) notReceived.push(o);
    else counted.push(o);
  }
  return { counted, notReceived };
}

/** Occurrences de flux attendues, non reçues entre `from` et `asOf` (`flowOccurrencesThatCount`). */
export function missingFlows(ledger: Ledger, from: ISODate, asOf: ISODate): MissingFlow[] {
  const out: MissingFlow[] = [];
  const accounts = new Set(alive(ledger.accounts).map((a) => a.id));
  for (const f of alive(ledger.plannedFlows)) {
    if (!accounts.has(f.accountId)) continue;
    for (const o of flowOccurrencesThatCount(ledger, f, from, asOf, asOf).notReceived)
      out.push({ flowId: f.id, name: f.name, expectedDate: o.date, amount: f.amount, windowEnd: o.windowEnd });
  }
  return out.sort((a, b) => (a.expectedDate < b.expectedDate ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Pipeline après import
// ---------------------------------------------------------------------------

export interface PipelineReport {
  transfersPaired: number;
  tirelireTransfers: number;
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
  const e = matchTirelireTransfers(l);
  l = apply(e);
  const proposals = proposeMatches(l, from, to);
  let autoMatched = 0;
  for (const m of proposals.filter((p) => p.auto)) {
    l = apply(applyMatch(l, m));
    autoMatched++;
  }
  const r = applyAutomations(l);
  l = apply(r);
  return {
    transfersPaired: t.operations.length / 2,
    tirelireTransfers: e.operations.length,
    autoMatched,
    proposals: proposals.filter((p) => !p.auto),
    ruled: r.operations.length,
  };
}

/** Applique un patch à un grand livre en mémoire (nouvel objet). */
export function applyPatchToLedger(ledger: Ledger, patch: Patch): Ledger {
  const ops = new Map(ledger.operations.map((o) => [o.id, o]));
  for (const o of patch.operations) ops.set(o.id, o);
  const subs = new Map(ledger.subOperations.map((a) => [a.id, a]));
  for (const a of patch.subOperations) subs.set(a.id, a);
  for (const id of patch.removedSubOperations ?? []) subs.delete(id);
  return { ...ledger, operations: [...ops.values()], subOperations: [...subs.values()] };
}
