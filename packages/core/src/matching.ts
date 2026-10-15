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

/**
 * Le motif de libellé d'une sélection — un flux, un ordre permanent, un automatisme (D24) — tel qu'il
 * se lit : sans les blancs qui le commencent ou le finissent, qu'une banque ne garde pas (#26, point 5).
 * Un motif fait de blancs seuls ne sélectionne rien de plus qu'aucun motif : `undefined`. Le motif
 * enregistré n'en est pas réécrit (D57, I10) : seule sa lecture les retire.
 */
export function readLabelPattern(pattern: string | undefined): string | undefined {
  const lu = pattern?.trim();
  return lu ? lu : undefined;
}

export function emptyPatch(): Patch {
  return { operations: [], subOperations: [], removedSubOperations: [] };
}

function subOperationsOf(ledger: Ledger, opId: Id): SubOperation[] {
  return liveSubOperations(ledger.subOperations).filter((a) => a.operationId === opId);
}

// ---------------------------------------------------------------------------
// Virements internes entre deux comptes importés : l'appariement (#488)
// ---------------------------------------------------------------------------

/**
 * Une paire possible de virement interne que l'appariement automatique n'a pas formée : un débit et un
 * crédit, à confirmer par l'utilisateur (`acceptInternalTransfer`, #488, point 3).
 */
export interface TransferPairProposal {
  debitId: Id;
  creditId: Id;
}

/**
 * La destination connue de chaque opération qui en a une (#488, point 1 ; D11) : le compte vers lequel
 * (ou, pour un crédit, depuis lequel) elle est désignée comme virement, à la main ou par une
 * désignation déjà posée (`transferAccountId`) ; pour un débit, le compte que reconnaît le libellé
 * d'un ordre enregistré vers lui, ou « TIRELIRE <COMPTE> » vers un compte sans ordre
 * (`matchTirelireTransfers`). Rien d'autre : ni le nom ni le numéro d'un compte cités dans un libellé,
 * ni un montant égal.
 */
function knownDestinations(ledger: Ledger): Map<Id, Id> {
  const out = new Map<Id, Id>();
  for (const o of matchTirelireTransfers(ledger).operations) out.set(o.id, o.transferAccountId!);
  for (const o of alive(ledger.operations)) if (o.transferAccountId) out.set(o.id, o.transferAccountId);
  return out;
}

/** Une opération qui peut être un côté d'un virement interne encore sans autre côté : importée, vivante, sans autre côté, d'un montant non nul. */
function sansAutreCote(o: Operation): boolean {
  return o.origin === 'imported' && !o.transferOperationId && o.amount !== 0;
}

/** Les opérations, par montant : un virement n'apparie que des montants opposés. */
function byAmount(ops: Operation[]): Map<Cents, Operation[]> {
  const out = new Map<Cents, Operation[]>();
  for (const o of ops) out.set(o.amount, [...(out.get(o.amount) ?? []), o]);
  return out;
}

/** Les deux opérations sont-elles les deux côtés possibles d'un même virement : deux comptes, montants opposés, à ± `windowDays` ? */
function cotesOpposes(a: Operation, b: Operation, windowDays: number): boolean {
  return a.id !== b.id && a.accountId !== b.accountId && a.amount === -b.amount && Math.abs(diffDays(a.date, b.date)) <= windowDays;
}

/**
 * Les deux opérations peuvent-elles s'apparier par la destination connue (#488, point 2) ? L'une a pour
 * destination connue le compte de l'autre ; aucune n'a pour destination connue un autre compte que
 * celui de l'autre ; une opération verrouillée n'entre que désignée (D22) : une désignation à la main
 * compte, même verrouillée, mais une opération que l'utilisateur a verrouillée sans la désigner reste
 * comme il l'a laissée.
 */
function parDestination(a: Operation, b: Operation, dest: Map<Id, Id>): boolean {
  const da = dest.get(a.id);
  const db = dest.get(b.id);
  if (da !== b.accountId && db !== a.accountId) return false;
  if ((da !== undefined && da !== b.accountId) || (db !== undefined && db !== a.accountId)) return false;
  if ((isLocked(a) && da === undefined) || (isLocked(b) && db === undefined)) return false;
  return true;
}

/** L'état d'un côté apparié par l'import : *classé*, ou *verrouillé* s'il l'était (D22, D33). */
function pairOf(a: Operation, b: Operation, state?: Operation['state']): Operation[] {
  return [
    { ...a, state: state ?? (isLocked(a) ? 'locked' : 'reconciled'), transferAccountId: b.accountId, transferOperationId: b.id },
    { ...b, state: state ?? (isLocked(b) ? 'locked' : 'reconciled'), transferAccountId: a.accountId, transferOperationId: a.id },
  ];
}

/**
 * Apparie les virements internes dont la destination est connue (#488, point 2 ; D11, D33), sur tout le
 * grand livre : une opération importée sans autre côté, dont la destination est connue
 * (`knownDestinations`), s'apparie à une opération importée du compte désigné, de montant opposé, à
 * ± `windowDays`, quand chacune est, pour l'autre, la plus proche en date et la seule à cette distance.
 * Les paires se forment par tours, chacun sur les opérations que les tours précédents ont laissées : le
 * résultat ne dépend pas de l'ordre des opérations. Les deux côtés deviennent *classés* ; un côté
 * verrouillé le reste ; aucune ventilation ne change. Une opération sans destination connue ne
 * s'apparie jamais ici : un montant égal ne suffit pas, une coïncidence formerait une fausse paire. Les
 * paires possibles que l'appariement ne forme pas se proposent (`proposeInternalTransfers`).
 */
export function pairInternalTransfers(ledger: Ledger, windowDays = 2): Patch {
  const patch = emptyPatch();
  const dest = knownDestinations(ledger);
  const ops = alive(ledger.operations).filter(sansAutreCote);
  const parMontant = byAmount(ops);
  const voisins = new Map<Id, Array<{ o: Operation; gap: number }>>();
  for (const a of ops) {
    if (!dest.has(a.id)) continue;
    for (const b of parMontant.get(-a.amount) ?? []) {
      if (!cotesOpposes(a, b, windowDays) || !parDestination(a, b, dest)) continue;
      const gap = Math.abs(diffDays(a.date, b.date));
      for (const [x, y] of [[a, b], [b, a]] as const) {
        const vs = voisins.get(x.id) ?? [];
        if (!vs.some((v) => v.o.id === y.id)) vs.push({ o: y, gap });
        voisins.set(x.id, vs);
      }
    }
  }
  const pris = new Set<Id>();
  /** Le voisin libre le plus proche en date, s'il est seul à cette distance. */
  const plusProche = (id: Id): Operation | undefined => {
    const libres = (voisins.get(id) ?? []).filter((v) => !pris.has(v.o.id));
    const min = Math.min(...libres.map((v) => v.gap));
    const aMin = libres.filter((v) => v.gap === min);
    return aMin.length === 1 ? aMin[0]!.o : undefined;
  };
  for (;;) {
    const tour: Array<[Operation, Operation]> = [];
    for (const a of ops) {
      if (pris.has(a.id) || !dest.has(a.id)) continue;
      const b = plusProche(a.id);
      if (!b || plusProche(b.id)?.id !== a.id) continue;
      if (tour.some(([x, y]) => x.id === b.id || y.id === b.id)) continue;
      tour.push(a.amount < 0 ? [a, b] : [b, a]);
    }
    if (!tour.length) break;
    for (const [d, c] of tour) {
      pris.add(d.id);
      pris.add(c.id);
      patch.operations.push(...pairOf(d, c));
    }
  }
  return patch;
}

/**
 * Les paires possibles de virement interne que l'appariement automatique n'a pas formées, à confirmer
 * (#488, point 3) : un débit et un crédit importés de deux comptes différents, de montants opposés, à
 * ± `windowDays`, ni l'un ni l'autre apparié, et soit tous deux non verrouillés et sans destination
 * connue, soit l'un à destination connue que l'appariement n'a pu départager — limité alors aux
 * opérations du compte désigné (`parDestination`). Une opération à plusieurs candidats en a autant de
 * propositions. Rien ne s'écrit (I10) : ne pas apparier laisse la proposition, sans rien enregistrer.
 * Dans l'ordre de la liste d'Opérations, par le débit, puis par le crédit.
 */
export function proposeInternalTransfers(ledger: Ledger, windowDays = 2): TransferPairProposal[] {
  const dest = knownDestinations(ledger);
  const ops = alive(ledger.operations).filter(sansAutreCote);
  const parMontant = byAmount(ops);
  const out: Array<{ d: Operation; c: Operation }> = [];
  for (const d of ops) {
    if (d.amount > 0) continue;
    for (const c of parMontant.get(-d.amount) ?? []) {
      if (!cotesOpposes(d, c, windowDays)) continue;
      const libres = !dest.has(d.id) && !dest.has(c.id) && !isLocked(d) && !isLocked(c);
      if (libres || parDestination(d, c, dest)) out.push({ d, c });
    }
  }
  const parDate = (a: Operation, b: Operation) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id));
  return out.sort((x, y) => parDate(x.d, y.d) || parDate(x.c, y.c)).map(({ d, c }) => ({ debitId: d.id, creditId: c.id }));
}

/**
 * L'utilisateur apparie une paire proposée (#488, point 3) : les deux côtés se lient et se
 * verrouillent (D22), sans que leur ventilation change. Rien si la paire n'est plus proposée.
 */
export function acceptInternalTransfer(ledger: Ledger, p: TransferPairProposal, windowDays = 2): Patch {
  const patch = emptyPatch();
  if (!proposeInternalTransfers(ledger, windowDays).some((x) => x.debitId === p.debitId && x.creditId === p.creditId)) return patch;
  const ops = new Map(alive(ledger.operations).map((o) => [o.id, o]));
  patch.operations.push(...pairOf(ops.get(p.debitId)!, ops.get(p.creditId)!, 'locked'));
  return patch;
}

/**
 * Défaire l'appariement de l'opération `operationId` (#488, point 5) : elle ne désigne plus d'autre
 * côté, et l'autre côté — celui qu'elle désigne, et toute opération qui la désigne — ne désigne plus
 * ni elle ni son compte, en gardant son état et sa ventilation. Ce que l'opération elle-même devient
 * d'autre (sa désignation, son état) est au geste qui la défait. Aucun côté ne reste à désigner comme
 * son autre côté une opération qui ne le désigne pas.
 */
export function unpairTransfer(ledger: Ledger, operationId: Id): Patch {
  const patch = emptyPatch();
  const op = alive(ledger.operations).find((o) => o.id === operationId);
  if (!op) return patch;
  const autres = alive(ledger.operations).filter((o) => o.id !== op.id && (o.id === op.transferOperationId || o.transferOperationId === op.id));
  if (!op.transferOperationId && !autres.length) return patch;
  const next: Operation = { ...op };
  delete next.transferOperationId;
  patch.operations.push(next);
  for (const o of autres) {
    const libre: Operation = { ...o };
    delete libre.transferAccountId;
    delete libre.transferOperationId;
    patch.operations.push(libre);
  }
  return patch;
}

/**
 * L'utilisateur désigne l'opération comme virement vers (ou, pour un crédit, depuis) le compte
 * `accountId` (#488, point 4 ; D22) : elle se verrouille ; appariée à un autre compte, son appariement
 * se défait des deux côtés (`unpairTransfer`). Quand l'autre côté est importé et seul candidat — une
 * opération du compte désigné, sans autre côté, de montant opposé, à ± `windowDays`, qui peut
 * s'apparier par cette destination (`parDestination`) —, elle s'apparie à lui, les deux côtés
 * verrouillés. À plusieurs candidats, elle est désignée sans être appariée, et les candidats se
 * proposent ; sans candidat, elle est désignée seule, et l'import qui apporte l'autre côté l'apparie.
 */
export function designateTransfer(ledger: Ledger, operationId: Id, accountId: Id, windowDays = 2): Patch {
  const op = alive(ledger.operations).find((o) => o.id === operationId);
  if (!op || accountId === op.accountId) return emptyPatch();
  if (op.transferOperationId && op.transferAccountId === accountId) return { ...emptyPatch(), operations: [{ ...op, state: 'locked' }] };
  const defait = unpairTransfer(ledger, op.id);
  const apres = applyPatchToLedger(ledger, defait);
  const next: Operation = { ...op, state: 'locked', transferAccountId: accountId };
  delete next.transferOperationId;
  const avec = applyPatchToLedger(apres, { ...emptyPatch(), operations: [next] });
  const patch: Patch = { ...emptyPatch(), operations: defait.operations.filter((o) => o.id !== op.id) };
  const dest = knownDestinations(avec);
  const candidats =
    op.origin === 'imported'
      ? alive(avec.operations).filter((o) => o.accountId === accountId && sansAutreCote(o) && cotesOpposes(next, o, windowDays) && parDestination(next, o, dest))
      : [];
  if (candidats.length === 1) patch.operations.push(...pairOf(next, candidats[0]!, 'locked'));
  else patch.operations.push(next);
  return patch;
}

// ---------------------------------------------------------------------------
// Virements vers un compte, reconnus par le libellé de leur ordre ou « TIRELIRE <COMPTE> » (D11, D21)
// ---------------------------------------------------------------------------

/**
 * Une opération importée qui ne reprend rien, non verrouillée et pas encore reconnue comme virement,
 * est un virement interne vers un compte d'accueil (D11) :
 * - quand le motif de libellé d'un ordre enregistré vers ce compte (D57, D60) la reconnaît, comme la
 *   sélection de l'ordre le ferait (D12, D24), que l'ordre soit en cours, terminé ou à venir à sa date :
 *   seulement un débit du compte d'où part l'ordre, le compte principal (D24, D57) ;
 * - vers un compte sans ordre enregistré, quand elle contient le libellé tiré de son nom actuel
 *   (`transferLabel`). Celui d'un compte qui a un ordre ne reconnaît rien : renommer le compte ne
 *   change pas ce qui est reconnu (domaine plan et flux, hypothèse 3).
 * Entre plusieurs comptes, le libellé d'un ordre l'emporte sur un libellé tiré d'un nom ; entre
 * libellés de même sorte, le plus long ; à égalité, aucun compte. Le libellé d'un ordre reconnu
 * exactement l'emporte sur un libellé reconnu souplement (`labelRecognizer`) ; quand aucun ordre ne la
 * reconnaît exactement, le compte seul à la reconnaître souplement en est la destination, et, s'ils
 * sont plusieurs, aucun compte (#488, point 8). Elle n'est pas ventilée d'office :
 * son montant y reste non affecté (D21 ; domaine rapprochement et bilan, hypothèse 1). Quand un ordre
 * vers ce compte la reprend (D12), c'est lui qui la ventile par son action (`applyMatch`), qu'il passe
 * avant ou après cette reconnaissance : elle ne pose aucune sous-opération.
 */
export function matchTirelireTransfers(ledger: Ledger): Patch {
  const patch = emptyPatch();
  const principal = alive(ledger.accounts).find((a) => a.kind === 'principal');
  const ordres = new Map<Id, Array<{ length: number; reconnait: (op: Operation) => LabelRecognition }>>();
  for (const f of alive(ledger.plannedFlows)) {
    const vers = principal ? standingOrderTarget(f, principal.id) : undefined;
    if (vers === undefined) continue;
    const motif = readLabelPattern(f.labelPattern);
    ordres.set(vers, [...(ordres.get(vers) ?? []), ...(motif ? [{ length: motif.length, reconnait: labelRecognizer(motif) }] : [])]);
  }
  const accounts = alive(ledger.accounts).map((a) => ({
    a,
    patterns: ordres.get(a.id),
    name: transferLabel(a.name).replace(/^TIRELIRE ?/, ''),
  }));
  for (const op of alive(ledger.operations)) {
    if (op.origin !== 'imported') continue;
    if (isLocked(op) || op.transferAccountId || resumesSomething(op)) continue;
    const parOrdre: Array<{ id: Id; length: number }> = [];
    const parOrdreSouple: Id[] = [];
    const parNom: Array<{ id: Id; length: number }> = [];
    const dansLeSensDeLOrdre = !!principal && op.accountId === principal.id && op.amount < 0;
    for (const { a, patterns, name } of accounts) {
      if (a.id === op.accountId) continue;
      if (patterns) {
        if (!dansLeSensDeLOrdre) continue;
        const lus = patterns.map((p) => ({ length: p.length, comment: p.reconnait(op) }));
        const longest = Math.max(-1, ...lus.filter((p) => p.comment === 'exact').map((p) => p.length));
        if (longest >= 0) parOrdre.push({ id: a.id, length: longest });
        else if (lus.some((p) => p.comment === 'souple')) parOrdreSouple.push(a.id);
      } else if (name.length > 0 && /TIRELIRE/.test(op.normalizedLabel) && op.normalizedLabel.includes(name)) parNom.push({ id: a.id, length: name.length });
    }
    // L'exacte l'emporte ; entre comptes reconnus souplement seulement, un seul compte, ou aucun (#488, point 8).
    const hit = parOrdre.length ? longestAlone(parOrdre) : parOrdreSouple.length ? (parOrdreSouple.length === 1 ? parOrdreSouple[0] : undefined) : longestAlone(parNom);
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

/** Ce qui dit si une occurrence est libre (`freeOccurrence`), lu une fois sur le grand livre. */
export interface OccurrenceIndex {
  /** Pour chaque occurrence reprise, l'opération qui la reprend. */
  takers: Map<string, Operation>;
  /** Les opérations reprises par une opération vivante. */
  resumed: Set<Id>;
}

export function occurrenceIndex(ledger: Ledger): OccurrenceIndex {
  return { takers: occurrenceTakers(ledger), resumed: resumedOperationIds(ledger.operations) };
}

/**
 * L'occurrence d'un flux à cette date est-elle libre (D12, D88) ? Aucune opération bancaire ne la
 * reprend, ni aucune saisie qu'une autre opération reprend : une occurrence n'est reprise qu'une fois.
 * Libre, elle se rend avec la saisie qui la corrige ou la masque, s'il y en a une : c'est cette saisie
 * qu'une opération bancaire reprendrait (D88). Non libre : `undefined`.
 */
export function freeOccurrence(index: OccurrenceIndex, flowId: Id, date: ISODate): { entry?: Operation } | undefined {
  const taker = index.takers.get(occurrenceKey(flowId, date));
  if (!taker) return {};
  if (taker.origin !== 'manual' || index.resumed.has(taker.id)) return undefined;
  return { entry: taker };
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

/**
 * Le montant `amount` est-il dans la tolérance du flux (D12, D24) ? Du signe du flux, à l'écart permis
 * près : le plus grand de sa tolérance absolue et de sa tolérance en pourcentage — 30 % pour un flux
 * variable qui n'en dit pas. Une seule lecture de la sélection d'un flux, pour le rapprochement
 * (`proposeMatches`) comme pour les occurrences que l'historique propose (#456).
 */
export function amountWithinTolerance(flow: Pick<PlannedFlow, 'amount' | 'amountTolerance' | 'variable'>, amount: Cents): { ok: boolean; ratio: number; exact: boolean } {
  const expected = flow.amount;
  if (Math.sign(expected) !== Math.sign(amount)) return { ok: false, ratio: 0, exact: false };
  const diff = Math.abs(Math.abs(amount) - Math.abs(expected));
  const tolAbs = flow.amountTolerance?.abs ?? 0;
  const tolPct = flow.amountTolerance?.pct ?? (flow.variable ? 30 : 0);
  const allowed = Math.max(tolAbs, (Math.abs(expected) * tolPct) / 100);
  const ratio = expected === 0 ? 0 : 1 - Math.min(1, diff / Math.max(1, Math.abs(expected)));
  return { ok: diff <= allowed + 0.5, ratio, exact: diff === 0 };
}

/** Le score minimal de la reconnaissance souple d'un motif littéral (`labelScore`, #488, point 8). */
export const LABEL_SCORE_MIN = 0.8;

/** Les mots d'un libellé, sans casse ni accents : la ponctuation et les blancs les séparent. */
function labelWords(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/**
 * La part des mots du motif que le texte contient, dans l'ordre, entre 0 et 1 (#488, point 8) : casse,
 * accents, ponctuation et blancs ignorés ; un préfixe ou un suffixe ajouté par la source ignoré ; au
 * plus deux mots insérés entre deux mots du motif. Un mot du texte qui commence par celui du motif le
 * reconnaît (« BOURSO » dans « BOURSORAMA ») ; le dernier mot du texte, tronqué par la source à trois
 * caractères au moins, reconnaît aussi le mot du motif qu'il commence. Ce que la reconnaissance en
 * tolère est `labelCutScore`.
 */
export function labelScore(motif: string, texte: string): number {
  const m = labelWords(motif);
  const t = labelWords(texte);
  if (!m.length) return 0;
  let best = 0;
  for (let start = 0; start < t.length && best < 1; start++) {
    let i = start;
    let n = 0;
    for (const mot of m) {
      const k = t.slice(i, i + 3).findIndex((w, j) => wordRecognizes(mot, t, i + j));
      if (k < 0) continue;
      n++;
      i += k + 1;
    }
    best = Math.max(best, n / m.length);
  }
  return best;
}

/** Le mot `t[ti]` reconnaît-il le mot du motif `mot` : il le commence, ou, dernier du texte, il en est la coupure à trois caractères au moins. */
function wordRecognizes(mot: string, t: string[], ti: number): boolean {
  const w = t[ti]!;
  return w.startsWith(mot) || (ti === t.length - 1 && w.length >= 3 && mot.startsWith(w));
}

/**
 * Le score de `labelScore` limité à la fin coupée (porteur, 16/10 ; #488, point 8) : 1 quand tous les
 * mots du motif sont reconnus ; sinon, la part des premiers mots du motif reconnus quand le texte
 * s'arrête au dernier d'entre eux — aucun mot du texte ne le suit —, les mots du motif qui le suivent
 * étant les seuls absents ; 0 autrement. Un mot remplacé par un autre (« … THOMAS » contre « … LEA »),
 * ou absent au début ou au milieu, n'est pas une coupure.
 */
export function labelCutScore(motif: string, texte: string): number {
  const m = labelWords(motif);
  const t = labelWords(texte);
  if (!m.length) return 0;
  const memo = new Map<number, number>();
  // Le meilleur score quand les `mi` premiers mots du motif sont reconnus, et que le suivant se cherche
  // à partir du mot `ti` du texte, au plus deux mots plus loin.
  const suite = (mi: number, ti: number): number => {
    if (mi === m.length) return 1;
    const cle = mi * (t.length + 1) + ti;
    const connu = memo.get(cle);
    if (connu !== undefined) return connu;
    let best = ti === t.length ? mi / m.length : 0;
    for (let k = 0; k < 3 && ti + k < t.length && best < 1; k++) if (wordRecognizes(m[mi]!, t, ti + k)) best = Math.max(best, suite(mi + 1, ti + k + 1));
    memo.set(cle, best);
    return best;
  };
  let best = 0;
  for (let start = 0; start < t.length && best < 1; start++) if (wordRecognizes(m[0]!, t, start)) best = Math.max(best, suite(1, start + 1));
  return best;
}

/** Les parties d'un motif littéral, écrit « texte » ou « texte.*texte » ; `undefined` pour toute autre expression régulière. */
function literalParts(motif: string): string[] | undefined {
  const parts = motif
    .split(/\.[*+]/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length && parts.every((p) => !/[\\^$|?*+()[\]{}]/.test(p)) ? parts : undefined;
}

/**
 * Comment un motif de libellé reconnaît une opération (#488, point 8) : `exact`, par sa lecture en
 * expression régulière ou par un score de 1 ; `souple`, par un score d'au moins `LABEL_SCORE_MIN`
 * seulement ; `undefined`, pas du tout.
 */
export type LabelRecognition = 'exact' | 'souple' | undefined;

/**
 * La reconnaissance d'un motif de libellé, compilée une fois pour être lue sur beaucoup d'opérations
 * (#456, point 12) : le libellé, le libellé normalisé ou le libellé complet. Un motif illisible ne
 * reconnaît rien. Une seule lecture du motif d'une sélection de flux (D24), pour `proposeMatches`, pour
 * les ordres (`matchTirelireTransfers`, donc la destination connue) et pour les occurrences que
 * l'historique propose. Un motif littéral, « texte » ou « texte.*texte », reconnaît aussi l'opération
 * quand chacune de ses parties a un score d'au moins `LABEL_SCORE_MIN` sur le libellé ou le libellé
 * complet, les mots absents n'étant tolérés qu'à la fin coupée (`labelCutScore` ; #488, point 8) ; une autre expression régulière garde sa seule lecture. La
 * reconnaissance dit si elle est exacte ou souple : entre plusieurs ordres, l'exacte l'emporte.
 */
export function labelRecognizer(motif: string): (op: Operation) => LabelRecognition {
  let re: RegExp;
  try {
    re = new RegExp(motif, 'i');
  } catch {
    return () => undefined;
  }
  const parts = literalParts(motif);
  return (op) => {
    if (re.test(op.label) || re.test(op.normalizedLabel) || re.test(op.details ?? '')) return 'exact';
    if (!parts) return undefined;
    // Chaque partie, sur le libellé ou le libellé complet, sa fin seule pouvant manquer ; la plus faible décide.
    const score = Math.min(...parts.map((p) => Math.max(labelCutScore(p, op.label), op.details ? labelCutScore(p, op.details) : 0)));
    return score >= 1 ? 'exact' : score >= LABEL_SCORE_MIN ? 'souple' : undefined;
  };
}

/** Le motif de libellé reconnaît-il l'opération, exactement ou souplement (`labelRecognizer`) ? */
export function labelMatcher(motif: string): (op: Operation) => boolean {
  const reconnait = labelRecognizer(motif);
  return (op) => reconnait(op) !== undefined;
}

/**
 * La sélection des flux, la seule (D24), sur les opérations bancaires sans reprise, non verrouillées,
 * datées entre `from` et `to` : le compte du flux, son motif de libellé s'il en a un, sa tolérance de
 * montant et la fenêtre de ses occurrences (D12). Ce qu'elle ne reconnaît pas, le flux ne le reprend
 * ni ne le classe.
 *
 * Automatique selon D12 — montant exact, ou dans la tolérance avec le libellé reconnu, flux non
 * variable —, proposée sinon. Le libellé d'un flux reconnu exactement l'emporte sur un libellé reconnu
 * souplement (`labelRecognizer`) : les flux qui ne le reconnaissent que souplement ne la sélectionnent
 * pas ; et quand plusieurs flux ne la reconnaissent que souplement, aucun ne la reprend sans
 * confirmation (#488, point 8 : un libellé coupé qui convient à deux ordres ne désigne ni l'un ni
 * l'autre). Une occurrence n'est reprise qu'une fois, et une opération en reprend
 * au plus une : la mieux notée. Une occurrence qu'une saisie corrige ou masque déjà se reprend par
 * cette saisie (D88).
 */
export function proposeMatches(ledger: Ledger, from: ISODate, to: ISODate): MatchProposal[] {
  const flows = alive(ledger.plannedFlows);
  const index = occurrenceIndex(ledger);
  const resumed = index.resumed;
  const ops = alive(ledger.operations).filter((o) => o.origin === 'imported' && !isLocked(o) && !resumesSomething(o) && !resumed.has(o.id) && o.date >= from && o.date <= to);
  const lecteurs = new Map(flows.map((f) => [f.id, readLabelPattern(f.labelPattern)] as const).flatMap(([id, motif]) => (motif ? [[id, labelRecognizer(motif)] as const] : [])));
  const candidates: MatchProposal[] = [];
  for (const op of ops) {
    const lus = new Map(flows.flatMap((f) => (f.accountId === op.accountId && lecteurs.has(f.id) ? [[f.id, lecteurs.get(f.id)!(op)] as const] : [])));
    const exacte = [...lus.values()].includes('exact');
    const souples = [...lus.values()].filter((r) => r === 'souple').length;
    for (const f of flows) {
      if (f.accountId !== op.accountId) continue;
      if (f.activeFrom && op.date < f.activeFrom) continue;
      if (f.activeTo && op.date > f.activeTo) continue;
      const amt = amountWithinTolerance(f, op.amount);
      if (!amt.ok) continue;
      const lu = lus.get(f.id);
      const label = lecteurs.has(f.id) ? lu !== undefined : undefined;
      if (label === false) continue;
      if (lu === 'souple' && exacte) continue;
      const occ = occurrencesBetween(f.periodicity, addDays(op.date, -f.dateWindowDays), addDays(op.date, f.dateWindowDays));
      if (occ.length === 0) continue;
      const expectedDate = occ.sort((a, b) => Math.abs(diffDays(a, op.date)) - Math.abs(diffDays(b, op.date)))[0]!;
      // Reprise par une opération bancaire, ou par une saisie déjà reprise : l'occurrence est servie.
      const libre = freeOccurrence(index, f.id, expectedDate);
      if (!libre) continue;
      const taker = libre.entry;
      const reasons: string[] = [];
      const dateScore = 1 - Math.abs(diffDays(expectedDate, op.date)) / (f.dateWindowDays + 1);
      reasons.push(`date à ${Math.abs(diffDays(expectedDate, op.date))} j`);
      if (label) reasons.push('libellé reconnu');
      reasons.push(amt.exact ? 'montant exact' : 'montant dans la tolérance');
      if (taker) reasons.push('déjà corrigée par une saisie');
      const score = 0.3 * dateScore + 0.3 * amt.ratio + 0.4 * (label ? 1 : 0.5);
      const auto = !f.variable && (amt.exact || label === true) && !(lu === 'souple' && souples > 1);
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
  /** Les virements internes appariés à cet import, par leur destination connue (#488, point 2). */
  transfersPaired: number;
  /** Les paires de virement interne à confirmer, après cet import (#488, points 3 et 7). */
  transferProposals: number;
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
  // Une opération que l'ordre d'un compte vient de reprendre a désormais sa destination connue.
  const t2 = pairInternalTransfers(l);
  if (t2.operations.length) l = apply(t2);
  const r = applyAutomations(l);
  l = apply(r);
  return {
    transfersPaired: (t.operations.length + t2.operations.length) / 2,
    transferProposals: proposeInternalTransfers(l).length,
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
