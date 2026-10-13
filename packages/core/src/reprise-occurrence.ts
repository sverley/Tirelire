/**
 * Reprendre à la main une occurrence d'un flux (#445) : l'utilisateur dit qu'une opération importée est
 * l'occurrence d'un flux prévu qu'il choisit, hors de la fenêtre et de la tolérance du flux.
 *
 * Ce n'est ni un pointage ni une proposition (D12) : l'application offre au choix, l'utilisateur
 * désigne, et la reprise est validée par lui (D88, principe 4.4). L'opération reprend l'occurrence —
 * ou la saisie qui la corrige ou la masque —, exactement comme une proposition acceptée de ce flux à
 * cette date (`applyMatch`), et devient verrouillée : hors de la sélection du flux, aucun automatisme
 * ne referait cette reprise (D22). Le flux ne change pas (D12, I10). Toutes les fonctions sont pures :
 * rien ne s'écrit ici (I10).
 */
import type { Cents, Id, ISODate, Ledger, Operation, PlannedFlow } from './model.js';
import { alive } from './model.js';
import { addDays, diffDays, toDayNumber } from './dates.js';
import { nextOccurrence, occurrencesBetween } from './periods.js';
import { applyMatch, emptyPatch, freeOccurrence, occurrenceIndex, resumesSomething, type OccurrenceIndex, type Patch } from './matching.js';

/**
 * Point 1 : l'opération peut-elle reprendre une occurrence choisie ? Une opération bancaire (importée)
 * qui ne reprend rien, quel que soit son état et qu'une reprise lui soit proposée ou non. Ni une
 * saisie, ni une opération qui reprend déjà une occurrence ou une saisie.
 */
export function canResumeOccurrence(op: Operation): boolean {
  return !op.deletedAt && op.origin === 'imported' && !resumesSomething(op);
}

/** Une occurrence offerte au choix (point 3). */
export interface OfferedOccurrence {
  flowId: Id;
  /** Sa date : avec le flux, elle désigne l'opération prévue (D88). */
  date: ISODate;
  /** La saisie qui la corrige ou la masque : c'est elle que l'opération reprendrait (D88). */
  entry?: Operation;
  /** Le montant de ce qui serait repris : celui de la saisie, sinon celui du flux. */
  amount: Cents;
  /** L'écart : le montant de l'opération, moins celui de ce qui serait repris (comme `resumptionOf`). */
  gap: Cents;
  /** L'écart en jours, en valeur absolue, entre l'occurrence et l'opération. */
  days: number;
}

/** Un flux offert au choix (point 2), avec ses occurrences offertes (point 3). */
export interface OfferedFlow {
  flow: PlannedFlow;
  occurrences: OfferedOccurrence[];
}

/** Le premier jour de la période de validité du flux : ses occurrences ne précèdent pas son ancrage. */
function validFrom(f: PlannedFlow): ISODate {
  return f.activeFrom && f.activeFrom > f.periodicity.anchorDate ? f.activeFrom : f.periodicity.anchorDate;
}

/** Les occurrences du flux dans sa période de validité, de `from` (comprise) vers l'avenir ; sans fin s'il n'en a pas. */
function* forward(f: PlannedFlow, from: ISODate): Generator<ISODate> {
  const start = validFrom(f);
  let d = nextOccurrence(f.periodicity, from > start ? from : start);
  while (!f.activeTo || d <= f.activeTo) {
    yield d;
    d = nextOccurrence(f.periodicity, addDays(d, 1));
  }
}

/** Les occurrences du flux dans sa période de validité, jusqu'à `upTo` (comprise), de la plus ancienne à la plus récente. */
function upTo(f: PlannedFlow, date: ISODate): ISODate[] {
  const end = f.activeTo && f.activeTo < date ? f.activeTo : date;
  const start = validFrom(f);
  return start > end ? [] : occurrencesBetween(f.periodicity, start, end);
}

/** Le flux a-t-il au moins une occurrence libre dans sa période de validité ? Une occurrence n'est reprise qu'une fois (D12). */
function hasFreeOccurrence(index: OccurrenceIndex, f: PlannedFlow): boolean {
  // Les occurrences reprises sont en nombre fini : sans fin de validité, une libre vient toujours.
  for (const d of forward(f, validFrom(f))) if (freeOccurrence(index, f.id, d)) return true;
  return false;
}

/** L'occurrence offerte, lue pour cette opération : ce qui serait repris, et les écarts. */
function offered(index: OccurrenceIndex, f: PlannedFlow, op: Operation, date: ISODate): OfferedOccurrence | undefined {
  const libre = freeOccurrence(index, f.id, date);
  if (!libre) return undefined;
  const amount = libre.entry ? libre.entry.amount : f.amount;
  return { flowId: f.id, date, ...(libre.entry ? { entry: libre.entry } : {}), amount, gap: op.amount - amount, days: Math.abs(diffDays(date, op.date)) };
}

/** La plus proche en jours d'abord ; à égalité, la plus ancienne (point 3). */
const nearestFirst = (a: OfferedOccurrence, b: OfferedOccurrence) => a.days - b.days || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/**
 * Point 3 : les occurrences offertes d'un flux à une opération — deux au plus, libres, dans sa période
 * de validité : la dernière libre à la date de l'opération ou avant, et la première libre après. La
 * plus proche en jours vient d'abord ; à égalité, la plus ancienne.
 */
function offeredOccurrences(index: OccurrenceIndex, f: PlannedFlow, op: Operation): OfferedOccurrence[] {
  const passees = upTo(f, op.date);
  let last: OfferedOccurrence | undefined;
  for (let i = passees.length - 1; i >= 0 && !last; i--) last = offered(index, f, op, passees[i]!);
  let first: OfferedOccurrence | undefined;
  for (const d of forward(f, addDays(op.date, 1))) {
    first = offered(index, f, op, d);
    if (first) break;
  }
  return [last, first].filter((o): o is OfferedOccurrence => !!o).sort(nearestFirst);
}

/** Les flux non supprimés du compte et du sens de l'opération : le montant du flux a le signe du sien (point 2). */
function sameAccountAndSign(f: PlannedFlow, op: Operation): boolean {
  return f.accountId === op.accountId && Math.sign(f.amount) === Math.sign(op.amount);
}

/**
 * Points 2 et 3 : ce qui s'offre au choix d'une opération concernée (point 1). Les flux non supprimés
 * de son compte et de son sens qui ont au moins une occurrence offerte, quels que soient leur motif de
 * libellé, leur tolérance de montant, la fenêtre de leurs occurrences, et qu'ils soient variables ou
 * non ; du plus proche en montant au plus éloigné — l'écart, en valeur absolue, entre le montant du
 * flux et celui de l'opération —, puis par leur nom. Chacun avec ses occurrences offertes.
 */
export function offeredFlows(ledger: Ledger, operationId: Id): OfferedFlow[] {
  const op = alive(ledger.operations).find((o) => o.id === operationId);
  if (!op || !canResumeOccurrence(op)) return [];
  const index = occurrenceIndex(ledger);
  return alive(ledger.plannedFlows)
    .filter((f) => sameAccountAndSign(f, op))
    .map((flow) => ({ flow, occurrences: offeredOccurrences(index, flow, op) }))
    .filter((o) => o.occurrences.length > 0)
    .sort((a, b) => Math.abs(a.flow.amount - op.amount) - Math.abs(b.flow.amount - op.amount) || a.flow.name.localeCompare(b.flow.name, 'fr'));
}

/** Les flux qui ont une occurrence libre, par compte et par sens. */
function flowsWithFreeOccurrence(ledger: Ledger, index: OccurrenceIndex): PlannedFlow[] {
  return alive(ledger.plannedFlows).filter((f) => hasFreeOccurrence(index, f));
}

/**
 * Point 5 : les opérations dont la ligne porte le geste « Reprendre une occurrence » — celles du
 * point 1 à qui au moins un flux est offert (point 2). Un flux a une occurrence offerte à toute
 * opération dès qu'il a une occurrence libre : la dernière avant sa date, ou la première après. Dans
 * un projet sans flux, aucune (U5).
 */
export function operationsOfferedAFlow(ledger: Ledger): Set<Id> {
  const out = new Set<Id>();
  const flows = flowsWithFreeOccurrence(ledger, occurrenceIndex(ledger));
  if (flows.length === 0) return out;
  for (const op of alive(ledger.operations)) if (canResumeOccurrence(op) && flows.some((f) => sameAccountAndSign(f, op))) out.add(op.id);
  return out;
}

/**
 * Point 7 : l'opération reprend l'occurrence du flux `flowId` à `date` — ou la saisie qui la corrige
 * ou la masque (D88) —, avec ce que le flux lui donne, exactement comme une proposition acceptée de ce
 * flux à cette date (`applyMatch`) : la ventilation du flux si elle ne porte pas la sienne, qu'elle
 * garde sinon ; pour un flux de virement, son compte de destination. Elle devient verrouillée (D22).
 * Le flux ne change pas. Rien n'est rendu si l'opération n'est pas concernée (point 1), si le flux
 * n'est pas de son compte et de son sens (point 2), ou si l'occurrence n'en est pas une libre de sa
 * période de validité (point 3).
 */
export function resumeOccurrence(ledger: Ledger, operationId: Id, flowId: Id, date: ISODate): Patch {
  return resumeWith(ledger, occurrenceIndex(ledger), operationId, flowId, date);
}

function resumeWith(ledger: Ledger, index: OccurrenceIndex, operationId: Id, flowId: Id, date: ISODate): Patch {
  const op = alive(ledger.operations).find((o) => o.id === operationId);
  const f = alive(ledger.plannedFlows).find((x) => x.id === flowId);
  if (!op || !f || !canResumeOccurrence(op) || !sameAccountAndSign(f, op)) return emptyPatch();
  if (date < validFrom(f) || (f.activeTo && date > f.activeTo) || !occurrencesBetween(f.periodicity, date, date).length) return emptyPatch();
  const libre = freeOccurrence(index, f.id, date);
  if (!libre) return emptyPatch();
  const patch = applyMatch(ledger, {
    operationId: op.id,
    flowId: f.id,
    expectedDate: date,
    expectedAmount: f.amount,
    ...(libre.entry ? { resumedOperationId: libre.entry.id } : {}),
    score: 1,
    auto: false,
    reasons: [],
  });
  patch.operations = patch.operations.map((o) => (o.id === op.id ? { ...o, state: 'locked' } : o));
  return patch;
}

/** Pourquoi aucun flux n'est offert aux cibles d'une action groupée (point 6). */
export type BulkOccurrenceRefusal =
  /** Un projet sans flux : le panneau n'en parle pas (U5). */
  | 'noFlow'
  /** Aucune cible n'est concernée (point 1). */
  | 'noTarget'
  /** Les cibles concernées ne partagent pas un même compte et un même sens. */
  | 'mixed'
  /** Aucun flux de leur compte et de leur sens n'a d'occurrence libre. */
  | 'noFree';

export interface BulkOfferedFlows {
  flows: PlannedFlow[];
  /** Quand aucun flux n'est offert, pourquoi. */
  refusal?: BulkOccurrenceRefusal;
}

/**
 * Point 6 : les flux offerts aux cibles d'une action groupée — ceux du point 2 pour le compte et le
 * sens que toutes les cibles concernées (point 1) partagent. Ils se présentent du plus proche en
 * montant au plus éloigné — la somme, sur les cibles concernées, des écarts en valeur absolue entre
 * le montant du flux et le leur, qui pour une seule cible est celui du point 2 —, puis par leur nom.
 */
export function bulkOfferedFlows(ledger: Ledger, targetIds: Id[]): BulkOfferedFlows {
  return offeredToTargets(ledger, occurrenceIndex(ledger), concernedTargets(ledger, targetIds));
}

function offeredToTargets(ledger: Ledger, index: OccurrenceIndex, concerned: Operation[]): BulkOfferedFlows {
  if (alive(ledger.plannedFlows).length === 0) return { flows: [], refusal: 'noFlow' };
  if (concerned.length === 0) return { flows: [], refusal: 'noTarget' };
  const first = concerned[0]!;
  if (concerned.some((o) => o.accountId !== first.accountId || Math.sign(o.amount) !== Math.sign(first.amount))) return { flows: [], refusal: 'mixed' };
  const ecarts = new Map(
    flowsWithFreeOccurrence(ledger, index)
      .filter((f) => sameAccountAndSign(f, first))
      .map((f) => [f, concerned.reduce((s, o) => s + Math.abs(f.amount - o.amount), 0)] as const),
  );
  const flows = [...ecarts.keys()].sort((a, b) => ecarts.get(a)! - ecarts.get(b)! || a.name.localeCompare(b.name, 'fr'));
  return flows.length ? { flows } : { flows: [], refusal: 'noFree' };
}

function concernedTargets(ledger: Ledger, targetIds: Id[]): Operation[] {
  const ids = new Set(targetIds);
  return alive(ledger.operations).filter((o) => ids.has(o.id) && canResumeOccurrence(o));
}

/** Ce que fera, pour une cible, la reprise d'un flux par l'action groupée (point 6). */
export interface BulkOccurrenceOutcome {
  operationId: Id;
  /** L'occurrence qu'elle prendra, avec l'écart. */
  occurrence?: OfferedOccurrence;
  /** Pourquoi elle n'en prend aucune : elle n'est pas concernée (point 1), ou aucune occurrence libre ne lui reste. */
  refusal?: 'notConcerned' | 'noneLeft';
}

/**
 * Point 6 : l'aperçu de la reprise du flux `flowId` par les cibles d'une action groupée, dans l'ordre
 * des cibles. Chaque cible concernée reprend une occurrence libre de ce flux (point 3, sans la limite
 * de deux), la plus proche de sa date ; une occurrence n'est prise qu'une fois : les couples d'une
 * cible et d'une occurrence se servent du plus proche en jours au plus éloigné — à égalité, la cible
 * la plus ancienne d'abord, puis l'occurrence la plus ancienne —, une cible et une occurrence à la
 * fois. Un flux qui n'est pas offert à ces cibles (`bulkOfferedFlows`) n'en reprend aucune. Le calcul
 * ne croît pas comme le carré du nombre de cibles (`serveCouples`).
 */
export function bulkOccurrencePlan(ledger: Ledger, targetIds: Id[], flowId: Id): BulkOccurrenceOutcome[] {
  return planWith(ledger, occurrenceIndex(ledger), targetIds, flowId).outcomes;
}

function planWith(ledger: Ledger, index: OccurrenceIndex, targetIds: Id[], flowId: Id): { outcomes: BulkOccurrenceOutcome[]; flow?: PlannedFlow; ops: Map<Id, Operation> } {
  const ops = new Map(alive(ledger.operations).map((o) => [o.id, o]));
  const targets = targetIds.flatMap((id) => (ops.has(id) ? [ops.get(id)!] : []));
  const concerned = targets.filter(canResumeOccurrence);
  const f = offeredToTargets(ledger, index, concerned).flows.find((x) => x.id === flowId);
  const taken = f ? serveCouples(index, f, concerned) : new Map<Id, OfferedOccurrence>();
  const outcomes = targets.map((op): BulkOccurrenceOutcome => {
    const occurrence = taken.get(op.id);
    if (occurrence) return { operationId: op.id, occurrence };
    return { operationId: op.id, refusal: canResumeOccurrence(op) ? 'noneLeft' : 'notConcerned' };
  });
  return { outcomes, ...(f ? { flow: f } : {}), ops };
}

/**
 * Les occurrences libres que des cibles datées de `from` à `to` peuvent prendre, dans l'ordre des
 * dates : n cibles en prennent n au plus, si bien qu'aucune ne va au-delà des n libres qui précèdent
 * `from` ni des n libres qui suivent `to`.
 */
function freeAround(index: OccurrenceIndex, f: PlannedFlow, from: ISODate, to: ISODate, n: number): Array<{ date: ISODate; entry?: Operation }> {
  const libres = (dates: Iterable<ISODate>, limit = Infinity) => {
    const out: Array<{ date: ISODate; entry?: Operation }> = [];
    for (const date of dates) {
      if (out.length >= limit) break;
      const l = freeOccurrence(index, f.id, date);
      if (l) out.push({ date, ...(l.entry ? { entry: l.entry } : {}) });
    }
    return out;
  };
  const jusquA = libres(upTo(f, to));
  const premiere = jusquA.findIndex((o) => o.date >= from);
  const debut = Math.max(0, (premiere < 0 ? jusquA.length : premiere) - n);
  return [...jusquA.slice(debut), ...libres(forward(f, addDays(to, 1)), n)];
}

/** Un nœud de la file des dates : les cibles d'un même jour, de la plus petite à la plus grande par leur identifiant, ou une date offerte. */
type Noeud<T> =
  | { kind: 'cibles'; day: number; date: ISODate; cibles: Operation[]; tete: number; prev?: Noeud<T> | undefined; next?: Noeud<T> | undefined; vivant: boolean }
  | { kind: 'occurrence'; day: number; date: ISODate; slot: T; prev?: Noeud<T> | undefined; next?: Noeud<T> | undefined; vivant: boolean };
type Cibles<T> = Extract<Noeud<T>, { kind: 'cibles' }>;
type Occ<T> = Extract<Noeud<T>, { kind: 'occurrence' }>;
interface Couple<T> {
  days: number;
  cibles: Cibles<T>;
  occ: Occ<T>;
  cible: Id;
}

/** L'ordre des couples (point 6) : en jours, puis la cible la plus ancienne, puis l'occurrence la plus ancienne, puis l'identifiant de la cible. */
function avant<T>(a: Couple<T>, b: Couple<T>): boolean {
  if (a.days !== b.days) return a.days < b.days;
  if (a.cibles.day !== b.cibles.day) return a.cibles.day < b.cibles.day;
  if (a.occ.day !== b.occ.day) return a.occ.day < b.occ.day;
  return a.cible < b.cible;
}

/** Point 6 : les occurrences libres que prennent les cibles concernées, servies par `serveNearest`. */
function serveCouples(index: OccurrenceIndex, f: PlannedFlow, concerned: Operation[]): Map<Id, OfferedOccurrence> {
  const taken = new Map<Id, OfferedOccurrence>();
  if (concerned.length === 0) return taken;
  const jours = concerned.map((o) => o.date).sort();
  const libres = freeAround(index, f, jours[0]!, jours[jours.length - 1]!, concerned.length);
  const ops = new Map(concerned.map((o) => [o.id, o]));
  for (const [id, { slot, days }] of serveNearest(concerned, libres)) {
    const amount = slot.entry ? slot.entry.amount : f.amount;
    taken.set(id, { flowId: f.id, date: slot.date, ...(slot.entry ? { entry: slot.entry } : {}), amount, gap: ops.get(id)!.amount - amount, days });
  }
  return taken;
}

/**
 * Sert les couples d'une cible et d'une date offerte du plus proche au plus éloigné, une cible et une
 * date à la fois (point 6) — à égalité, la cible la plus ancienne d'abord, puis la date la plus
 * ancienne, puis l'identifiant de la cible —, sans couple de plus de `maxDays` jours. Sur une ligne de
 * dates, le couple le plus proche est toujours fait de deux nœuds voisins — un jour de cibles et une
 * date offerte —, puisqu'un nœud entre eux ferait un couple plus proche, ou aussi proche et servi avant
 * (les cibles d'un même jour sont un seul nœud, servies par leur identifiant ; les dates offertes sont
 * distinctes). Les nœuds vivent dans une file doublement chaînée, les couples voisins dans un tas :
 * servir un couple retire au plus deux nœuds et ne crée que les couples de leurs voisins. Le calcul
 * croît comme (cibles + dates) × log, non comme leur produit. Un seul appariement pour la reprise
 * groupée (#445) et pour les occurrences d'un flux fait d'opérations (#456).
 */
export function serveNearest<T extends { date: ISODate }>(targets: Operation[], slots: T[], maxDays = Infinity): Map<Id, { slot: T; days: number }> {
  const taken = new Map<Id, { slot: T; days: number }>();
  if (targets.length === 0 || slots.length === 0) return taken;
  const parJour = new Map<ISODate, Operation[]>();
  for (const op of targets) parJour.set(op.date, [...(parJour.get(op.date) ?? []), op]);
  const noeuds: Noeud<T>[] = [
    ...[...parJour.keys()].map((date): Noeud<T> => ({ kind: 'cibles', day: toDayNumber(date), date, cibles: parJour.get(date)!.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), tete: 0, vivant: true })),
    ...slots.map((slot): Noeud<T> => ({ kind: 'occurrence', day: toDayNumber(slot.date), date: slot.date, slot, vivant: true })),
  ].sort((a, b) => a.day - b.day || (a.kind === b.kind ? 0 : a.kind === 'cibles' ? -1 : 1));
  for (let i = 1; i < noeuds.length; i++) {
    noeuds[i - 1]!.next = noeuds[i]!;
    noeuds[i]!.prev = noeuds[i - 1]!;
  }

  const tas: Couple<T>[] = [];
  const pousser = (a: Noeud<T> | undefined, b: Noeud<T> | undefined) => {
    if (!a || !b || a.kind === b.kind) return;
    const cibles = a.kind === 'cibles' ? a : (b as Cibles<T>);
    const occ = a.kind === 'occurrence' ? a : (b as Occ<T>);
    if (cibles.tete >= cibles.cibles.length) return;
    const days = Math.abs(occ.day - cibles.day);
    if (days > maxDays) return;
    tas.push({ days, cibles, occ, cible: cibles.cibles[cibles.tete]!.id });
    for (let i = tas.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!avant(tas[i]!, tas[p]!)) break;
      [tas[i], tas[p]] = [tas[p]!, tas[i]!];
      i = p;
    }
  };
  const extraire = (): Couple<T> => {
    const haut = tas[0]!;
    const dernier = tas.pop()!;
    if (tas.length) {
      tas[0] = dernier;
      for (let i = 0; ; ) {
        const g = 2 * i + 1;
        const d = g + 1;
        let m = i;
        if (g < tas.length && avant(tas[g]!, tas[m]!)) m = g;
        if (d < tas.length && avant(tas[d]!, tas[m]!)) m = d;
        if (m === i) break;
        [tas[i], tas[m]] = [tas[m]!, tas[i]!];
        i = m;
      }
    }
    return haut;
  };
  const retirer = (n: Noeud<T>) => {
    n.vivant = false;
    if (n.prev) n.prev.next = n.next;
    if (n.next) n.next.prev = n.prev;
    pousser(n.prev, n.next);
  };

  for (const n of noeuds) pousser(n, n.next);
  while (tas.length) {
    const c = extraire();
    const { cibles, occ } = c;
    // Un couple périmé : un de ses nœuds est servi, ils ne sont plus voisins, ou ce n'est plus la première cible du jour.
    if (!cibles.vivant || !occ.vivant || (cibles.next !== occ && cibles.prev !== occ) || cibles.cibles[cibles.tete]?.id !== c.cible) continue;
    const op = cibles.cibles[cibles.tete++]!;
    taken.set(op.id, { slot: occ.slot, days: c.days });
    retirer(occ);
    if (cibles.tete >= cibles.cibles.length) retirer(cibles);
    else {
      pousser(cibles.prev, cibles);
      pousser(cibles, cibles.next);
    }
  }
  return taken;
}

/**
 * Point 6 : « Appliquer » — les reprises que montre l'aperçu (`bulkOccurrencePlan`), et elles seules :
 * chacune comme au point 7, par la même reprise (`resumeWith`, puis `applyMatch`). Les occurrences sont
 * distinctes : chaque reprise se lit sur le même grand livre, réduit, pour chacune, à ce qu'elle lit —
 * son opération, la saisie qu'elle reprendrait, leurs sous-opérations et le flux — pour ne pas
 * parcourir tout le grand livre à chaque cible.
 */
export function applyBulkOccurrence(ledger: Ledger, targetIds: Id[], flowId: Id): Patch {
  const patch = emptyPatch();
  const index = occurrenceIndex(ledger);
  const { outcomes, flow, ops } = planWith(ledger, index, targetIds, flowId);
  if (!flow) return patch;
  const sous = new Map<Id, Ledger['subOperations']>();
  for (const s of ledger.subOperations) sous.set(s.operationId, [...(sous.get(s.operationId) ?? []), s]);
  for (const o of outcomes) {
    if (!o.occurrence) continue;
    const op = ops.get(o.operationId)!;
    const entry = o.occurrence.entry;
    const reduit: Ledger = {
      ...ledger,
      operations: entry ? [op, entry] : [op],
      subOperations: [...(sous.get(op.id) ?? []), ...(entry ? (sous.get(entry.id) ?? []) : [])],
      plannedFlows: [flow],
    };
    const p = resumeWith(reduit, index, op.id, flowId, o.occurrence.date);
    patch.operations.push(...p.operations);
    patch.subOperations.push(...p.subOperations);
    patch.removedSubOperations!.push(...(p.removedSubOperations ?? []));
  }
  return patch;
}
