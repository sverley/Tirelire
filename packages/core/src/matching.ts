/**
 * Après import : virements internes, rapprochement de flux prévus, virements vers
 * un compte reconnus par leur libellé, règles de catégorisation, flux attendus non reçus.
 *
 * Toutes les fonctions sont pures : elles reçoivent le grand livre et rendent
 * les lignes à écrire (`Patch`). L'application les enregistre dans le dépôt.
 */
import type { SubOperation, Cents, Id, ISODate, Ledger, Operation, PlannedFlow } from './model.js';
import { alive, isLocked, resumedOperationIds, standingOrderTarget } from './model.js';
import { diffDays, addDays } from './dates.js';
import { occurrencesBetween } from './periods.js';
import { transferLabel } from './plan.js';
import { uuidv7, normalizeLabel } from './ids.js';
import { actionAllocation, applyAutomations } from './automations.js';
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
// Virements vers un compte, reconnus par le libellé de leur ordre ou « TIRELIRE <COMPTE> » (D11, D21)
// ---------------------------------------------------------------------------

/**
 * Une opération importée qui ne reprend rien, non verrouillée et pas encore reconnue comme virement,
 * est un virement interne vers un compte d'accueil (D11) :
 * - quand le motif de libellé d'un ordre enregistré vers ce compte (D57, D60) la reconnaît, comme la
 *   sélection de l'ordre le ferait (D12, D24), que l'ordre soit en cours ou terminé à sa date ;
 * - vers un compte sans ordre enregistré, quand elle contient le libellé tiré de son nom actuel
 *   (`transferLabel`). Celui d'un compte qui a un ordre ne reconnaît rien : renommer le compte ne
 *   change pas ce qui est reconnu (domaine plan et flux, hypothèse 3).
 * Entre plusieurs comptes, le libellé d'un ordre l'emporte sur un libellé tiré d'un nom ; entre
 * libellés de même sorte, le plus long ; à égalité, aucun compte. Elle n'est pas ventilée d'office :
 * son montant y reste non affecté (D21 ; domaine rapprochement et bilan, hypothèse 1). Quand un ordre
 * vers ce compte la reprend (D12), c'est lui qui la ventile par son action (`applyMatch`), qu'il passe
 * avant ou après cette reconnaissance : elle ne pose aucune sous-opération.
 */
export function matchTirelireTransfers(ledger: Ledger): Patch {
  const patch = emptyPatch();
  const principal = alive(ledger.accounts).find((a) => a.kind === 'principal');
  const ordres = new Map<Id, string[]>();
  for (const f of alive(ledger.plannedFlows)) {
    const vers = principal ? standingOrderTarget(f, principal.id) : undefined;
    if (vers === undefined) continue;
    ordres.set(vers, [...(ordres.get(vers) ?? []), ...(f.labelPattern ? [f.labelPattern] : [])]);
  }
  const accounts = alive(ledger.accounts).map((a) => ({
    a,
    patterns: ordres.get(a.id),
    name: transferLabel(a.name).replace(/^TIRELIRE /, ''),
  }));
  for (const op of alive(ledger.operations)) {
    if (op.origin !== 'imported') continue;
    if (isLocked(op) || op.transferAccountId || resumesSomething(op)) continue;
    const parOrdre: Array<{ id: Id; length: number }> = [];
    const parNom: Array<{ id: Id; length: number }> = [];
    for (const { a, patterns, name } of accounts) {
      if (a.id === op.accountId) continue;
      if (patterns) {
        const longest = Math.max(-1, ...patterns.filter((p) => labelRecognized(p, op)).map((p) => p.length));
        if (longest >= 0) parOrdre.push({ id: a.id, length: longest });
      } else if (name.length > 0 && /TIRELIRE/.test(op.normalizedLabel) && op.normalizedLabel.includes(name)) parNom.push({ id: a.id, length: name.length });
    }
    const hit = longestAlone(parOrdre.length ? parOrdre : parNom);
    if (!hit) continue;
    patch.operations.push({ ...op, state: 'reconciled', transferAccountId: hit });
  }
  return patch;
}

/** Le compte au libellé le plus long, s'il est seul à cette longueur. */
function longestAlone(hits: Array<{ id: Id; length: number }>): Id | undefined {
  const max = Math.max(-1, ...hits.map((h) => h.length));
  const best = hits.filter((h) => h.length === max);
  return best.length === 1 ? best[0]!.id : undefined;
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
 * La ventilation d'un flux pour l'opération qui reprend une de ses occurrences, ou la saisie qui la
 * corrige (D24, D88) : celle de son action, par le même calcul que l'action d'un automatisme sur une
 * opération qu'il retient (`actionAllocation`), tirelire par défaut de la catégorie comprise (D32).
 * Les parts en pourcentage et la part variable se calculent sur le montant de l'opération ; ce que
 * les parts n'absorbent pas reste sans tirelire, le non affecté du compte (D21, D29). Aucune
 * ventilation ne se calcule depuis l'état du plan ou des tirelires au jour de l'opération (D27).
 */
export function flowVentilation(ledger: Ledger, f: PlannedFlow, operationId: Id): SubOperation[] {
  const categories = new Map(alive(ledger.categories).map((c) => [c.id, c]));
  return (actionAllocation(f.action, categories) ?? []).map((l) => ({
    id: uuidv7(),
    operationId,
    share: l.share,
    ...(l.categoryId ? { categoryId: l.categoryId } : {}),
    ...(l.tirelireId ? { tirelireId: l.tirelireId } : {}),
  }));
}

/** Ce qu'un flux reprend devient rapproché (D22), verrouillé s'il le demande ; verrouillé, il le reste. */
function stateOnResumption(op: Operation, f: PlannedFlow | undefined): Operation['state'] {
  return isLocked(op) || f?.action?.state === 'lock' ? 'locked' : 'reconciled';
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
  if (subOperationsOf(ledger, op.id).length === 0) patch.subOperations.push(...flowVentilation(ledger, f, op.id));
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
  // La ventilation de la saisie, à tous ses niveaux, recopiée sur l'opération qui la reprend (D88) :
  // celle qu'une saisie qui corrige une occurrence a prise du flux à sa création compris.
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
 * verrouillée (D22), et prend à sa création la ventilation de l'action du flux, calculée sur son
 * montant (`flowVentilation`). Un virement corrigé garde ses deux côtés, comme l'opération prévue qu'il
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
  patch.subOperations.push(...flowVentilation(ledger, f, op.id));
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
