/**
 * Faire d'un virement importé l'ordre permanent que le plan propose (#434 ; #40, U3).
 *
 * Un virement importé du compte principal vers un compte d'accueil, qu'aucun flux ne reprend, peut
 * devenir l'ordre que le plan propose pour ce compte (D21, D57, D60) : au montant constaté, ventilé
 * comme le plan le propose pour ce montant (#393, point 9). L'opération en est la première
 * occurrence, qu'elle reprend (D88). Aucun calcul propre (principe 13) : l'ordre est celui que
 * l'écran Plan enregistre (`standingTransferFlow`), son motif celui que l'écran Opérations propose
 * pour un automatisme créé depuis une opération (`suggestPattern`), et la reprise celle d'une
 * occurrence confirmée (`applyMatch`). Rien ne s'écrit ici (I10) : les fonctions rendent ce que
 * l'application écrira au geste de l'utilisateur.
 */
import type { Cents, Id, ISODate, Ledger, Operation, PlannedFlow } from './model.js';
import { alive, standingOrderTarget } from './model.js';
import { computePlan, standingTransferFlow, type PlanTransfer } from './plan.js';
import { applyMatch, readLabelPattern, resumesSomething, type Patch } from './matching.js';
import { suggestPattern } from './automations.js';

/**
 * Le compte d'accueil vers lequel l'opération `operationId` peut devenir un ordre permanent, avec ce
 * que le plan lu à `today` propose pour lui (#434, point 1) ; `undefined` sinon. Il faut une
 * opération importée et vivante ; un débit du compte principal reconnu comme virement vers un autre
 * compte vivant — par le libellé, par l'appariement, ou désignée à la main (D11, D22) : toutes
 * portent `transferAccountId` — ; sans reprise (D88) ; vers un compte où le plan propose un ordre
 * (D60 ; #393, point 9), et qui n'a aucun ordre permanent vivant, quelle que soit sa validité
 * (#393, point 5).
 */
function transferToOrder(ledger: Ledger, operationId: Id, today: ISODate): { op: Operation; principalId: Id; transfer: PlanTransfer; plan: ReturnType<typeof computePlan> } | undefined {
  const op = alive(ledger.operations).find((o) => o.id === operationId);
  const principal = alive(ledger.accounts).find((a) => a.kind === 'principal');
  if (!op || !principal || op.origin !== 'imported' || resumesSomething(op)) return undefined;
  if (op.accountId !== principal.id || op.amount >= 0) return undefined;
  const vers = op.transferAccountId;
  if (!vers || vers === principal.id || !alive(ledger.accounts).some((a) => a.id === vers)) return undefined;
  if (alive(ledger.plannedFlows).some((f) => standingOrderTarget(f, principal.id) === vers)) return undefined;
  const plan = computePlan(ledger, today);
  const transfer = plan.transfers.find((t) => t.accountId === vers);
  if (!transfer?.proposal) return undefined;
  return { op, principalId: principal.id, transfer, plan };
}

/**
 * L'ordre permanent que le plan propose de faire du virement importé `operationId` (#434, points 1
 * à 3), lu au plan de `today`, comme l'écran Plan de la période en cours (D52) ; `undefined` si
 * l'opération ne peut pas en devenir un (`transferToOrder`). C'est l'ordre que l'écran Plan
 * enregistre pour un compte sans ordre (`standingTransferFlow`), sauf sur quatre points : son
 * montant, celui de l'opération en positif, ou `amount` que l'utilisateur valide ; sa ventilation,
 * celle que le plan propose pour ce montant ; son ancrage, la date de l'opération, qui en est la
 * première occurrence (D60, D88) ; son motif de libellé, tiré du libellé de l'opération comme celui
 * d'un automatisme créé depuis elle (`suggestPattern`, D24, D39), qui la reconnaît. Rien ne s'écrit (I10).
 */
export function orderFromTransfer(ledger: Ledger, operationId: Id, today: ISODate, id: Id, amount?: Cents): PlannedFlow | undefined {
  const lu = transferToOrder(ledger, operationId, today);
  if (!lu) return undefined;
  const montant = amount ?? -lu.op.amount;
  if (montant <= 0) return undefined;
  const flow = standingTransferFlow(lu.plan, lu.transfer, lu.principalId, id, montant);
  if (!flow) return undefined;
  const motif = readLabelPattern(suggestPattern(lu.op));
  const next: PlannedFlow = { ...flow, periodicity: { ...flow.periodicity, anchorDate: lu.op.date } };
  if (motif) next.labelPattern = motif;
  else delete next.labelPattern;
  return next;
}

/**
 * Enregistrer l'ordre fait du virement importé `operationId` (#434, point 5) : l'ordre que
 * `orderFromTransfer` propose pour le montant validé, à écrire tel quel — un fait que rien ne réécrit
 * (D57, D60) —, et, dans le même geste, ce qu'il écrit sur l'opération : elle reprend sa première
 * occurrence, désignée par l'ordre et la date de l'opération (D88), comme une occurrence confirmée
 * (`applyMatch`) — rapprochée, ou verrouillée si elle l'était (D22) ; les parts de l'ordre si elle ne
 * porte pas de ventilation, la sienne sinon (#393, point 2). `undefined` si l'opération ne peut pas
 * devenir un ordre. Rien ne s'écrit ici : l'application écrit l'ordre et le patch au geste (I10).
 */
export function recordOrderFromTransfer(ledger: Ledger, operationId: Id, today: ISODate, id: Id, amount?: Cents): { flow: PlannedFlow; patch: Patch } | undefined {
  const flow = orderFromTransfer(ledger, operationId, today, id, amount);
  if (!flow) return undefined;
  const avecOrdre: Ledger = { ...ledger, plannedFlows: [...ledger.plannedFlows, flow] };
  const patch = applyMatch(avecOrdre, { operationId, flowId: flow.id, expectedDate: flow.periodicity.anchorDate, expectedAmount: flow.amount, score: 1, auto: false, reasons: [] });
  return { flow, patch };
}
