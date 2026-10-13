/**
 * Faire d'opérations importées le flux prévu que l'historique propose, et repérer les séries qui se
 * répètent (#456 ; #16, U4).
 *
 * Un seul code pour ce qu'on désigne et pour ce qu'on repère (principe 13) : le flux d'une opération,
 * de plusieurs opérations désignées ensemble, ou d'une série que le repérage trouve de lui-même, se
 * fait par `buildProposal`. Le motif de libellé est celui d'un automatisme créé depuis l'opération
 * (`suggestPattern`, D24, D39) ; l'ordre permanent est celui que l'écran Plan décrit
 * (`newStandingOrder`, #434) ; la sélection du flux se lit comme le rapprochement la lit
 * (`amountWithinTolerance`, `labelMatcher`) ; les occurrences se servent comme celles de la reprise
 * groupée (`serveNearest`, #445) ; la reprise est celle d'une occurrence confirmée (`applyMatch`).
 *
 * Rien ne s'écrit ici (I10) : les propositions se calculent, elles ne se stockent pas (D89) ; seul
 * `recordFlowFromOperations` rend ce que l'application écrira au geste de l'utilisateur.
 */
import type { AllocationLine, Cents, Id, ISODate, Ledger, Operation, Periodicity, PlannedFlow } from './model.js';
import { alive, monthsOf } from './model.js';
import { addDays, addMonths, diffDays, parseDate } from './dates.js';
import { occurrencesBetween } from './periods.js';
import { computePlan, newStandingOrder, proposedOrderAllocation, type Plan, type PlanTransfer } from './plan.js';
import { amountWithinTolerance, applyMatch, emptyPatch, labelMatcher, readLabelPattern, resumesSomething, type Patch } from './matching.js';
import { inferSelection, suggestPattern } from './automations.js';
import { transferTarget } from './ordre-depuis-virement.js';
import { serveNearest } from './reprise-occurrence.js';
import { liveSubOperations } from './suboperations.js';

// ---------------------------------------------------------------------------
// Les écarts d'une série (point 3)
// ---------------------------------------------------------------------------

/** L'écart régulier d'une série : une semaine, un mois, trois mois ou un an (D47). */
export interface SeriesGap {
  interval: number;
  unit: 'week' | 'month' | 'year';
}

const GAPS: readonly SeriesGap[] = [
  { interval: 1, unit: 'week' },
  { interval: 1, unit: 'month' },
  { interval: 3, unit: 'month' },
  { interval: 1, unit: 'year' },
];

/** À combien de jours de sa date une opération est encore de la série, et la fenêtre du flux qu'elle fonde : 1 jour pour une semaine, 5 sinon. */
function gapTolerance(g: SeriesGap): number {
  return g.unit === 'week' ? 1 : 5;
}

/** Le nombre d'opérations d'une série : trois, deux si l'écart est d'un an. */
function gapMinimum(g: SeriesGap): number {
  return g.unit === 'year' ? 2 : 3;
}

/**
 * La `k`-ième date d'un rythme qui passe par `anchor` (k négatif : avant lui), comptée depuis lui pour
 * ne pas dériver : le calendrier de D47, celui de `nextOccurrence` (le 31, puis le dernier jour des
 * mois courts).
 */
function rhythmDate(anchor: ISODate, p: { interval: number; unit: Periodicity['unit'] }, k: number): ISODate {
  if (p.unit === 'day') return addDays(anchor, k * p.interval);
  if (p.unit === 'week') return addDays(anchor, 7 * k * p.interval);
  return addMonths(anchor, k * p.interval * (p.unit === 'year' ? 12 : 1));
}

/** Les dates d'un rythme qui passe par `anchor`, de `from` à `to` comprises, vers l'arrière comme vers l'avant. */
function rhythmDates(anchor: ISODate, p: { interval: number; unit: Periodicity['unit'] }, from: ISODate, to: ISODate): ISODate[] {
  if (p.interval < 1 || from > to) return [];
  let k: number;
  if (p.unit === 'day' || p.unit === 'week') k = Math.floor(diffDays(anchor, from) / (p.interval * (p.unit === 'week' ? 7 : 1))) - 1;
  else {
    const a = parseDate(anchor);
    const f = parseDate(from);
    k = Math.floor(((f.y - a.y) * 12 + (f.m - a.m)) / (p.interval * (p.unit === 'year' ? 12 : 1))) - 1;
  }
  const out: ISODate[] = [];
  for (let d = rhythmDate(anchor, p, k); d <= to; d = rhythmDate(anchor, p, ++k)) if (d >= from) out.push(d);
  return out;
}

// ---------------------------------------------------------------------------
// L'opération dont on fait un flux (point 1)
// ---------------------------------------------------------------------------

/** Une opération dont on peut faire un flux : son motif (point 2) et, pour un virement, le compte d'accueil de l'ordre (point 5). */
interface Source {
  op: Operation;
  pattern: string;
  target?: Id;
}

/** Les opérations dans l'ordre des dates ; le même jour, par identifiant. */
const byDate = (a: Operation, b: Operation) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Point 1 : l'opération peut-elle devenir un flux ? Bancaire (importée), vivante, sans reprise (D88),
 * d'un montant non nul — sans quoi elle n'a pas de sens —, et dont le libellé donne un motif (point 2) ;
 * reconnue comme virement interne, seulement le débit du principal vers un compte d'accueil vivant qui
 * n'a aucun ordre permanent vivant (`transferTarget`, #434). Son compte, son sens et son état n'y
 * changent rien.
 */
function sourceOf(ledger: Ledger, op: Operation, principalId: Id | undefined): Source | undefined {
  if (op.deletedAt || op.origin !== 'imported' || resumesSomething(op) || op.amount === 0) return undefined;
  const pattern = readLabelPattern(suggestPattern(op));
  if (!pattern) return undefined;
  if (!op.transferAccountId) return { op, pattern };
  const target = principalId ? transferTarget(ledger, op, principalId) : undefined;
  return target ? { op, pattern, target } : undefined;
}

/** Ce qui est désigné : les opérations, dans l'ordre des dates, leur motif commun et, pour des virements, leur compte d'accueil. */
interface Designation {
  ops: Operation[];
  pattern: string;
  target?: Id;
  principalId?: Id;
}

function principalOf(ledger: Ledger): Id | undefined {
  return alive(ledger.accounts).find((a) => a.kind === 'principal')?.id;
}

/**
 * Point 1, pour plusieurs opérations : chacune peut devenir un flux, toutes du même compte et du même
 * sens, toutes des virements vers un même compte d'accueil ou aucune, et un même motif les reconnaît
 * toutes (point 2) : celui que l'application propose pour un automatisme créé depuis chacune (D39),
 * quand c'est le même pour toutes — la notion de ressemblance d'une série (« Tranché ») —, sinon le
 * motif commun que propose une sélection de plusieurs opérations (`inferSelection`, D26).
 */
function designationOf(ledger: Ledger, operationIds: Id[]): Designation | undefined {
  const ids = new Set(operationIds);
  if (ids.size === 0) return undefined;
  const ops = alive(ledger.operations).filter((o) => ids.has(o.id));
  if (ops.length !== ids.size) return undefined;
  const principalId = principalOf(ledger);
  const sources = ops.map((o) => sourceOf(ledger, o, principalId));
  if (sources.some((s) => !s)) return undefined;
  const ss = (sources as Source[]).sort((a, b) => byDate(a.op, b.op));
  const first = ss[0]!;
  if (ss.some((s) => s.op.accountId !== first.op.accountId || Math.sign(s.op.amount) !== Math.sign(first.op.amount) || s.target !== first.target)) return undefined;
  const pattern = ss.every((s) => s.pattern === first.pattern) ? first.pattern : readLabelPattern(inferSelection(ss.map((s) => s.op)).labelPattern);
  if (!pattern) return undefined;
  const reconnait = labelMatcher(pattern);
  if (!ss.every((s) => reconnait(s.op))) return undefined;
  return { ops: ss.map((s) => s.op), pattern, ...(first.target ? { target: first.target } : {}), ...(principalId ? { principalId } : {}) };
}

/** Point 1 : le cœur propose-t-il un flux pour cette opération seule ? */
export function canBecomeFlow(ledger: Ledger, operationId: Id): boolean {
  const op = ledger.operations.find((o) => o.id === operationId);
  return !!op && sourceOf(ledger, op, principalOf(ledger)) !== undefined;
}

// ---------------------------------------------------------------------------
// Les séries (point 3)
// ---------------------------------------------------------------------------

/** Une opération d'un groupe : celles de même compte, même sens et même motif, sans reprise. */
interface Member {
  op: Operation;
  /** Peut fonder une série : bancaire, non marquée ponctuelle, et, pour un virement interne, qui peut devenir un ordre. */
  founds: boolean;
  target?: Id;
}

/** Une série trouvée : ses opérations, dans l'ordre des dates, et son écart. */
interface FoundSeries {
  ops: Operation[];
  gap: SeriesGap;
  pattern: string;
  target?: Id;
}

/**
 * Les groupes où se cherchent les séries : les opérations vivantes, sans reprise, d'un montant non nul,
 * au libellé qui donne un motif, rangées par compte, sens et motif (point 2), chacune dans l'ordre des
 * dates. Seules les bancaires peuvent fonder une série ; une saisie de même compte, même sens et même
 * motif y est une « autre opération », qui la coupe (point 3). `only`, s'il est donné, limite la
 * lecture à un groupe.
 */
function seriesGroups(ledger: Ledger, principalId: Id | undefined, only?: { accountId: Id; sign: number; pattern: string }): Map<string, { pattern: string; members: Member[] }> {
  const groups = new Map<string, { pattern: string; members: Member[] }>();
  for (const op of alive(ledger.operations)) {
    if (resumesSomething(op) || op.amount === 0) continue;
    const sign = Math.sign(op.amount);
    if (only && (op.accountId !== only.accountId || sign !== only.sign)) continue;
    const pattern = readLabelPattern(suggestPattern(op));
    if (!pattern || (only && pattern !== only.pattern)) continue;
    const target = op.transferAccountId && principalId ? transferTarget(ledger, op, principalId) : undefined;
    const key = `${op.accountId}|${sign}|${pattern}`;
    const g = groups.get(key) ?? { pattern, members: [] };
    g.members.push({ op, founds: op.origin === 'imported' && !op.oneOff && (!op.transferAccountId || !!target), ...(target ? { target } : {}) });
    groups.set(key, g);
  }
  for (const g of groups.values()) g.members.sort((a, b) => byDate(a.op, b.op));
  return groups;
}

/**
 * Point 3 : les séries d'un groupe. Une série est une suite d'au moins trois opérations — deux si
 * l'écart est d'un an — qui peuvent toutes fonder une série, vers un même compte d'accueil ou aucun, et
 * se suivent dans le groupe sans aucune autre entre la première et la dernière ; la plus ancienne fixe
 * les dates, et chacune des suivantes tombe à la date suivante de l'écart, à 1 jour près pour une
 * semaine, à 5 jours près sinon. Chaque opération fonde au plus une série : les séries se prennent de la
 * plus ancienne opération à la plus récente, la plus longue possible en partant de chacune. Les
 * tolérances des quatre écarts ne se recouvrent pas : la deuxième opération dit l'écart.
 */
function seriesOfGroup(pattern: string, members: Member[]): FoundSeries[] {
  const out: FoundSeries[] = [];
  let i = 0;
  while (i < members.length) {
    const start = members[i]!;
    if (!start.founds) {
      i++;
      continue;
    }
    let best: { run: Operation[]; gap: SeriesGap } | undefined;
    for (const gap of GAPS) {
      const run = [start.op];
      for (let j = i + 1; j < members.length; j++) {
        const m = members[j]!;
        if (!m.founds || m.target !== start.target) break;
        if (Math.abs(diffDays(rhythmDate(start.op.date, gap, run.length), m.op.date)) > gapTolerance(gap)) break;
        run.push(m.op);
      }
      if (run.length >= gapMinimum(gap) && (!best || run.length > best.run.length)) best = { run, gap };
    }
    if (!best) {
      i++;
      continue;
    }
    out.push({ ops: best.run, gap: best.gap, pattern, ...(start.target ? { target: start.target } : {}) });
    i += best.run.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Le flux proposé (points 2 à 5)
// ---------------------------------------------------------------------------

/**
 * Un flux proposé : un flux prévu dont le rythme peut être inconnu (point 3) — sa périodicité ne porte
 * alors que la date par laquelle passera le rythme que l'utilisateur donnera, celle de la plus ancienne
 * des opérations qui le fondent. Il ne s'enregistre pas tant que le rythme n'est pas donné (point 8).
 */
export type ProposedFlow = Omit<PlannedFlow, 'periodicity'> & { periodicity: Periodicity | { anchorDate: ISODate } };

/** Le rythme du flux proposé est-il connu ? */
export function rhythmKnown(flow: ProposedFlow): flow is PlannedFlow {
  const p = flow.periodicity;
  return 'unit' in p && 'interval' in p && Number.isInteger(p.interval) && p.interval >= 1;
}

/** Ce que le cœur propose pour des opérations désignées (points 1 à 5). */
export interface FlowProposal {
  flow: ProposedFlow;
  /** Les opérations désignées, dans l'ordre des dates : elles sont toujours proposées comme occurrences (point 6). */
  operations: Operation[];
  /** Ce qui fonde le flux (point 3) : la série qui contient toutes les opérations désignées, sinon elles ; dans l'ordre des dates. */
  founders: Operation[];
  /** L'écart de la série qui le fonde, s'il y en a une. */
  gap?: SeriesGap;
}

/**
 * Point 4 : le montant de ce qui fonde le flux. Tous égaux au centime : fixe, à ce montant, sans
 * tolérance. Sinon variable, à leur moyenne au centime, avec la plus petite tolérance parmi 10 %, 20 %,
 * 30 %… qui reconnaît chacun, lue comme la sélection du flux la lit (`amountWithinTolerance`).
 */
function amountOf(founders: Operation[]): { amount: Cents; pct?: number } {
  const sign = Math.sign(founders[0]!.amount);
  const abs = founders.map((o) => Math.abs(o.amount));
  if (abs.every((a) => a === abs[0])) return { amount: founders[0]!.amount };
  const amount = sign * Math.round(abs.reduce((s, a) => s + a, 0) / abs.length);
  let pct = 10;
  while (!abs.every((a) => amountWithinTolerance({ amount, amountTolerance: { pct }, variable: true }, sign * a).ok)) pct += 10;
  return { amount, pct };
}

/** Les lignes de premier niveau de chaque opération, lues une fois. */
type TopLines = (opId: Id) => AllocationLine[];

function topLinesOf(ledger: Ledger, opIds: Set<Id>): TopLines {
  const par = new Map<Id, AllocationLine[]>();
  for (const s of liveSubOperations(ledger.subOperations, opIds)) {
    if (s.parentId) continue;
    const line: AllocationLine = { ...(s.categoryId ? { categoryId: s.categoryId } : {}), ...(s.tirelireId ? { tirelireId: s.tirelireId } : {}), share: { ...s.share } };
    par.set(s.operationId, [...(par.get(s.operationId) ?? []), line]);
  }
  return (opId) => par.get(opId) ?? [];
}

const lineKey = (l: AllocationLine) => JSON.stringify([l.categoryId ?? null, l.tirelireId ?? null, l.share]);

/**
 * Point 2 : la ventilation que portent les opérations, part pour part — la catégorie, la tirelire et
 * la part de chaque ligne de premier niveau (D24, D27). Pour plusieurs opérations, celle que portent
 * toutes, la même ; sinon aucune. Une opération qui n'en porte aucune n'en donne aucune : rien n'est
 * supposé (principe 4.4) ; des parts qui ne portent ni catégorie ni tirelire n'en sont pas une. La
 * catégorie que la banque suggère n'en est pas une (#230).
 */
function commonVentilation(ops: Operation[], lines: TopLines): AllocationLine[] {
  const first = lines(ops[0]!.id);
  if (!first.some((l) => l.categoryId || l.tirelireId)) return [];
  const key = first.map(lineKey).sort().join('\n');
  return ops.every((o) => lines(o.id).map(lineKey).sort().join('\n') === key) ? first.map((l) => ({ ...l, share: { ...l.share } })) : [];
}

/**
 * Point 2 : le nom tiré du libellé, par les mots qu'en garde le motif (`suggestPattern`, `inferSelection`) :
 * le même pour toutes les opérations d'une série, si bien que le flux d'une opération d'une série
 * porte le nom de celui de la série (point 7).
 */
function nameFromPattern(pattern: string): string {
  return pattern.split('.*').join(' ');
}

/**
 * Ce que le budget demande à chaque occurrence d'un ordre de rythme `rythme` vers le compte de
 * `transfer` : la dotation mensuelle de chaque tirelire, multipliée par l'équivalent en mois du rythme
 * (`monthsOf`, D47) — trois mois pour un trimestre. Le plan compare un ordre par son équivalent mensuel,
 * parts fixes comprises (point 10) : la ventilation qu'il propose pour un ordre de 900 € par trimestre,
 * quand le budget demande 300 € par mois, est d'une part fixe de 900 €, que la comparaison ramène à
 * 300 € par mois, sans écart. Un ordre mensuel, ou sans série, garde ce que le plan propose (#434).
 */
function perOccurrence(transfer: PlanTransfer, rythme: Periodicity | undefined): PlanTransfer {
  const mois = rythme ? monthsOf(rythme) : 1;
  return mois === 1 ? transfer : { ...transfer, breakdown: transfer.breakdown.map((b) => ({ ...b, cruise: Math.round(b.cruise * mois) })) };
}

/**
 * Points 2 à 5 : le flux que proposent des opérations désignées `d`, fondé par `founders` — la série
 * `gap` qui les contient toutes, ou elles. Un seul code pour le flux d'une opération, de plusieurs, et
 * d'une série du repérage (principe 13).
 *
 * - Son compte est celui des opérations ; son genre, un revenu pour un crédit, une charge fixe pour un
 *   débit, l'ordre permanent pour un virement du principal vers un compte d'accueil (D57) ; son motif,
 *   celui de la désignation (D39) ; sa ventilation, celle que portent les opérations désignées (D24).
 * - Fondé par une série : son écart pour rythme, sa fenêtre (1 jour pour une semaine, 5 sinon). Sans
 *   série : rythme inconnu, fenêtre de 5 jours ; un ordre, lui, est mensuel (D60).
 * - Son montant et sa tolérance, ceux de ce qui le fonde (point 4).
 * - Son rythme passe par la date de la plus ancienne des opérations qui le fondent.
 * - L'ordre (point 5) est décrit comme celui que l'écran Plan enregistre (`newStandingOrder`) : nom,
 *   fenêtre et tolérance d'un ordre que le plan propose, la tolérance du point 4 si elle est plus
 *   large ; sa ventilation, celle que le plan propose pour ce montant si le budget y demande un ordre —
 *   le plan lu à `today` (D52), ce qu'il demande compté par occurrence (`perOccurrence`) —, celle des
 *   opérations sinon.
 * - `corrected`, s'il est donné, est le montant que l'utilisateur valide, en positif, du sens des
 *   opérations : la ventilation que le plan propose se recalcule pour lui (#434, point 3).
 */
function buildProposal(ledger: Ledger, d: Designation, founders: Operation[], gap: SeriesGap | undefined, id: Id, plan: () => Plan, lines: TopLines, corrected?: Cents): FlowProposal {
  const anchorDate = founders[0]!.date;
  const constat = amountOf(founders);
  const amount = corrected === undefined ? constat.amount : Math.sign(founders[0]!.amount) * corrected;
  const pct = constat.pct;
  const ventilation = () => commonVentilation(d.ops, lines);
  const rythme = gap ? { interval: gap.interval, unit: gap.unit, anchorDate } : undefined;
  let flow: ProposedFlow;
  if (d.target && d.principalId) {
    const compte = ledger.accounts.find((a) => a.id === d.target)!;
    const lu = plan();
    const transfer = lu.transfers.find((t) => t.accountId === d.target);
    const allocation = transfer?.proposal ? proposedOrderAllocation(lu, perOccurrence(transfer, rythme), -amount) : ventilation();
    const ordre = newStandingOrder(d.principalId, { id: compte.id, name: compte.name }, id, -amount, anchorDate, allocation, d.pattern);
    flow = { ...ordre, ...(rythme ? { periodicity: rythme } : {}), ...(pct !== undefined ? { variable: true, amountTolerance: { pct: Math.max(pct, ordre.amountTolerance?.pct ?? 0) } } : {}) };
  } else {
    const allocation = ventilation();
    flow = {
      id,
      name: nameFromPattern(d.pattern),
      kind: amount > 0 ? 'income' : 'fixedCharge',
      amount,
      accountId: d.ops[0]!.accountId,
      periodicity: rythme ?? { anchorDate },
      dateWindowDays: gap ? gapTolerance(gap) : 5,
      labelPattern: d.pattern,
      ...(pct !== undefined ? { variable: true, amountTolerance: { pct } } : {}),
      ...(allocation.length ? { action: { allocation } } : {}),
    };
  }
  return { flow, operations: d.ops, founders, ...(gap ? { gap } : {}) };
}

/**
 * Points 1 à 5 : le flux que l'historique propose pour les opérations `operationIds`, désignées
 * ensemble — une seule, ou plusieurs —, d'identifiant `id`, le plan lu à `today` (D52) pour un ordre ;
 * `undefined` si elles ne peuvent pas devenir un flux (point 1). Ce qui le fonde est la série qui les
 * contient toutes, s'il y en a une (le repérage, `detectSeries`), sinon elles : si bien que le flux
 * proposé pour une opération d'une série est celui de la série, sa ventilation exceptée (point 7). Un
 * virement qu'aucune série ne fonde, vers un compte où le budget demande un ordre, donne l'ordre de
 * #434 (`orderFromTransfer`). `amount`, s'il est donné, est le montant que l'utilisateur valide, en
 * positif (`buildProposal`). Rien ne s'écrit (I10).
 */
export function flowFromOperations(ledger: Ledger, operationIds: Id[], today: ISODate, id: Id, amount?: Cents): FlowProposal | undefined {
  if (amount !== undefined && amount <= 0) return undefined;
  const d = designationOf(ledger, operationIds);
  if (!d) return undefined;
  const first = d.ops[0]!;
  const ownPattern = readLabelPattern(suggestPattern(first));
  let serie: FoundSeries | undefined;
  if (ownPattern === d.pattern) {
    // Une série a le motif de chacune de ses opérations : seul ce groupe peut les contenir toutes.
    const groups = seriesGroups(ledger, d.principalId, { accountId: first.accountId, sign: Math.sign(first.amount), pattern: d.pattern });
    for (const g of groups.values()) serie ??= seriesOfGroup(g.pattern, g.members).find((s) => d.ops.every((o) => s.ops.some((x) => x.id === o.id)));
  }
  let plan: Plan | undefined;
  return buildProposal(ledger, d, serie?.ops ?? d.ops, serie?.gap, id, () => (plan ??= computePlan(ledger, today)), topLinesOf(ledger, new Set(d.ops.map((o) => o.id))), amount);
}

// ---------------------------------------------------------------------------
// Le repérage (point 7)
// ---------------------------------------------------------------------------

/** Une série que le repérage trouve : ses opérations, dans l'ordre des dates, et le flux qu'elle deviendrait. */
export interface DetectedSeries {
  operations: Operation[];
  gap: SeriesGap;
  flow: PlannedFlow;
}

/**
 * Point 7 : toutes les séries des opérations importées, sans que l'utilisateur ait rien désigné, chacune
 * avec les opérations qui la fondent et le flux qu'elle deviendrait — celui que propose
 * `flowFromOperations` pour toutes ses opérations, par le même code (`buildProposal`). Les opérations
 * qu'un flux reprend déjà ne fondent aucune série. Le même historique rend la même liste, dans le même
 * ordre : par la date de la première opération, puis par son identifiant ; l'identifiant du flux, tiré
 * de cette opération, ne sert qu'à le désigner tant qu'il n'est pas enregistré : l'application lui en
 * donne un nouveau avant de l'enregistrer (`recordFlowFromOperations`). Sans opération
 * importée, la liste est vide ; sans budget ni tirelire, elle se rend quand même (I3). Le plan, lu à
 * `today`, ne se calcule qu'une fois, et seulement pour un ordre. Rien ne s'écrit (I10).
 */
export function detectSeries(ledger: Ledger, today: ISODate): DetectedSeries[] {
  const principalId = principalOf(ledger);
  const series: FoundSeries[] = [];
  for (const g of seriesGroups(ledger, principalId).values()) series.push(...seriesOfGroup(g.pattern, g.members));
  series.sort((a, b) => byDate(a.ops[0]!, b.ops[0]!));
  let plan: Plan | undefined;
  const lu = () => (plan ??= computePlan(ledger, today));
  const lines = topLinesOf(ledger, new Set(series.flatMap((s) => s.ops.map((o) => o.id))));
  return series.map((s) => {
    const d: Designation = { ops: s.ops, pattern: s.pattern, ...(s.target ? { target: s.target } : {}), ...(principalId ? { principalId } : {}) };
    const { flow } = buildProposal(ledger, d, s.ops, s.gap, `serie-${s.ops[0]!.id}`, lu, lines);
    return { operations: s.ops, gap: s.gap, flow: flow as PlannedFlow };
  });
}

// ---------------------------------------------------------------------------
// Les occurrences (point 6)
// ---------------------------------------------------------------------------

/** Une opération proposée comme occurrence d'un flux (point 6). */
export interface HistoryOccurrence {
  operation: Operation;
  /** La date du rythme qui lui est proposée ; absente au rythme inconnu. */
  expectedDate?: ISODate;
  /** L'écart de jours, en valeur absolue, entre l'opération et cette date. */
  days?: number;
  /** L'écart de montant : celui de l'opération, moins celui du flux. */
  gap: Cents;
  /** Désignée par l'utilisateur : proposée que le flux la reconnaisse ou non. */
  designated: boolean;
}

/**
 * Point 6 : les opérations proposées comme occurrences du flux `flow` — celui qu'on propose, ou celui
 * que l'utilisateur corrige (rythme, montant, tolérance, motif, fenêtre) —, sur tout l'historique
 * importé, avant comme après les opérations qui le fondent. Ce sont celles que sa sélection reconnaît
 * (D12, D24) : bancaires, vivantes, sans reprise, de son compte et de son sens, au libellé reconnu par
 * son motif, au montant dans sa tolérance, à une date dans sa fenêtre autour d'une date de son rythme,
 * qui passe par l'ancrage de sa périodicité (la plus ancienne des opérations qui le fondent), vers
 * l'avant comme vers l'arrière. Une opération n'est proposée que pour une date, et une date qu'à une
 * opération : les plus proches (`serveNearest`). Les opérations désignées `designatedIds` sont
 * proposées avec les autres : celles que le flux ne reconnaît pas, à la date libre de son rythme la
 * plus proche ; au rythme inconnu, elles seules, sans date. Dans l'ordre des dates ; aucune n'est
 * reprise (I10).
 */
export function historyOccurrences(ledger: Ledger, flow: ProposedFlow, designatedIds: Id[]): HistoryOccurrence[] {
  const wanted = new Set(designatedIds);
  const designated = alive(ledger.operations).filter((o) => wanted.has(o.id));
  const out = (taken: Map<Id, { date: ISODate; days: number }>, ops: Operation[]): HistoryOccurrence[] =>
    ops.sort(byDate).map((operation) => {
      const t = taken.get(operation.id);
      return { operation, ...(t ? { expectedDate: t.date, days: t.days } : {}), gap: operation.amount - flow.amount, designated: wanted.has(operation.id) };
    });
  if (!rhythmKnown(flow)) return out(new Map(), designated);
  const p = flow.periodicity;
  const motif = readLabelPattern(flow.labelPattern);
  // Sans motif, la sélection ne lit pas le libellé : celle du rapprochement non plus (`proposeMatches`).
  const reconnait = motif ? labelMatcher(motif) : () => true;
  const sign = Math.sign(flow.amount);
  const fenetre = Math.max(0, flow.dateWindowDays);
  const reconnues = alive(ledger.operations).filter(
    (o) =>
      o.origin === 'imported' &&
      !resumesSomething(o) &&
      o.accountId === flow.accountId &&
      o.amount !== 0 &&
      Math.sign(o.amount) === sign &&
      (!flow.activeFrom || o.date >= flow.activeFrom) &&
      (!flow.activeTo || o.date <= flow.activeTo) &&
      amountWithinTolerance(flow, o.amount).ok &&
      reconnait(o),
  );
  const taken = new Map<Id, { date: ISODate; days: number }>();
  if (reconnues.length) {
    const dates = reconnues.map((o) => o.date).sort();
    const slots = rhythmDates(p.anchorDate, p, addDays(dates[0]!, -fenetre), addDays(dates[dates.length - 1]!, fenetre)).map((date) => ({ date }));
    for (const [opId, { slot, days }] of serveNearest(reconnues, slots, fenetre)) taken.set(opId, { date: slot.date, days });
  }
  const restantes = designated.filter((o) => !taken.has(o.id));
  if (restantes.length) {
    // Les dates prises sont entre les bornes : au-delà, n + 1 dates libres de chaque côté suffisent à n opérations.
    const pris = new Set([...taken.values()].map((t) => t.date));
    const dates = [...restantes.map((o) => o.date), ...pris].sort();
    const marge = restantes.length + 1;
    const libres = rhythmDates(p.anchorDate, p, rhythmDate(dates[0]!, p, -marge), rhythmDate(dates[dates.length - 1]!, p, marge))
      .filter((d) => !pris.has(d))
      .map((date) => ({ date }));
    for (const [opId, { slot, days }] of serveNearest(restantes, libres)) taken.set(opId, { date: slot.date, days });
  }
  const proposees = new Map(reconnues.filter((o) => taken.has(o.id)).map((o) => [o.id, o]));
  for (const o of designated) proposees.set(o.id, o);
  return out(taken, [...proposees.values()]);
}

// ---------------------------------------------------------------------------
// Enregistrer (point 8)
// ---------------------------------------------------------------------------

/**
 * Point 8 : enregistrer le flux `flow`, tel que l'utilisateur l'a corrigé, et, dans le même geste, les
 * reprises `resumptionIds` qu'il désigne parmi les occurrences proposées (point 6) : un seul bloc, à
 * écrire tel quel, ou rien — `undefined` si le rythme est inconnu, si le montant est nul, si un flux
 * porte déjà son identifiant (c'est un flux nouveau, qui n'en réécrit aucun), ou si une des opérations
 * ne peut pas reprendre une occurrence du flux (bancaire, vivante, sans reprise, de son compte et de son
 * sens).
 *
 * Le flux s'ancre sur la date de la plus ancienne opération désignée ; sans reprise désignée, sur
 * l'ancrage proposé, la plus ancienne des opérations qui le fondent (D60). Chaque opération désignée
 * reprend l'occurrence du flux qui lui est la plus proche, une occurrence n'étant reprise qu'une fois
 * (`serveNearest`), désignée par son flux et sa date (D88), comme une occurrence confirmée
 * (`applyMatch`) : rapprochée, ou verrouillée si elle l'était (D22) ; la ventilation du flux si elle
 * n'en porte pas, la sienne sinon. Un virement seul, enregistré avec lui-même pour seule reprise,
 * donne ce que #434 enregistre (`recordOrderFromTransfer`). Rien ne s'écrit ici (I10).
 */
export function recordFlowFromOperations(ledger: Ledger, flow: ProposedFlow, resumptionIds: Id[]): { flow: PlannedFlow; patch: Patch } | undefined {
  if (!rhythmKnown(flow) || flow.amount === 0 || ledger.plannedFlows.some((f) => f.id === flow.id)) return undefined;
  const ids = new Set(resumptionIds);
  const ops = alive(ledger.operations).filter((o) => ids.has(o.id));
  if (ops.length !== ids.size) return undefined;
  if (ops.some((o) => o.origin !== 'imported' || resumesSomething(o) || o.accountId !== flow.accountId || Math.sign(o.amount) !== Math.sign(flow.amount))) return undefined;
  ops.sort(byDate);
  const anchorDate = ops[0]?.date ?? flow.periodicity.anchorDate;
  const nouveau: PlannedFlow = { ...flow, periodicity: { ...flow.periodicity, anchorDate } };
  const patch = emptyPatch();
  if (!ops.length) return { flow: nouveau, patch };
  const dates = occurrencesBetween(nouveau.periodicity, anchorDate, rhythmDate(ops[ops.length - 1]!.date, nouveau.periodicity, ops.length + 1)).map((date) => ({ date }));
  const sous = new Map<Id, Ledger['subOperations']>();
  for (const s of ledger.subOperations) if (ids.has(s.operationId)) sous.set(s.operationId, [...(sous.get(s.operationId) ?? []), s]);
  const servies = serveNearest(ops, dates);
  if (servies.size !== ops.length) return undefined;
  for (const op of ops) {
    const reduit: Ledger = { ...ledger, operations: [op], subOperations: sous.get(op.id) ?? [], plannedFlows: [nouveau] };
    const p = applyMatch(reduit, { operationId: op.id, flowId: nouveau.id, expectedDate: servies.get(op.id)!.slot.date, expectedAmount: nouveau.amount, score: 1, auto: false, reasons: [] });
    patch.operations.push(...p.operations);
    patch.subOperations.push(...p.subOperations);
    patch.removedSubOperations!.push(...(p.removedSubOperations ?? []));
  }
  return { flow: nouveau, patch };
}
