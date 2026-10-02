/**
 * Soldes reconstruits : jamais stockés, toujours recalculés.
 *
 * Une tirelire a une position par compte (D19) : ses **composantes**. Elles viennent
 *  - du solde initial, réputé sur le compte de placement à la date d'ouverture ;
 *  - des sous-opérations qui ne se divisent plus (`countedLines`, D88) : une dépense ou un revenu pèse sur le compte de l'opération,
 *    un virement interne déplace une composante d'un compte vers l'autre sans changer le solde ;
 *  - des **dotations** calculées (D29) : au début de chaque période, chaque besoin reçoit ce
 *    qu'il demande, sur le compte principal (ou sur le compte de placement sans principal) ;
 *  - des parts d'un **lissage décidé** (D88, #184) : des sous-opérations datées d'une saisie, qui
 *    comptent comme des dotations, chacune à sa date ;
 *  - des **libérations** calculées (D05, D29) : en fin de période, l'excédent au-delà de la
 *    réserve des besoins non récurrents retourne au non affecté du compte de placement.
 *
 * Deux invariants : la somme des composantes d'une tirelire fait son solde ; pour un compte,
 * la somme des composantes qu'il porte plus son non affecté fait son solde bancaire.
 */
import type { Account, SubOperation, Cents, Tirelire, Id, ISODate, Ledger, Need, Operation, ValidityState } from './model.js';
import {
  monthsOf, alive, needActive, validityState } from './model.js';
import { nextOccurrence, budgetPeriodContaining, nextPeriod, type Period } from './periods.js';
import { divideCents } from './money.js';
import { addDays } from './dates.js';
import { countedLines, liveSubOperations, type CountedLine } from './suboperations.js';

/** Position d'une tirelire : compte → composante (centimes signés). */
export type Components = Map<Id, Cents>;

export interface ComponentEffect {
  accountId: Id;
  amount: Cents;
}

export interface TirelireEntry {
  operation: Operation;
  /** La ligne comptée (`countedLines`) qui porte cette tirelire. */
  line: CountedLine;
  /** Date à laquelle elle compte dans la tirelire : celle de la ligne (#184). */
  date: ISODate;
  /** Effets par compte (un pour une dépense, deux pour un virement dont l'autre côté n'est pas importé). */
  effects: ComponentEffect[];
  /** Effet net sur le solde de la tirelire. */
  effect: Cents;
}

/** Ce qu'un besoin retient et demande au début d'une période (D29). */
export interface NeedSnapshot {
  needId: Id;
  /** Part du solde de la tirelire attribuée à ce besoin (dans l'ordre des priorités). */
  held: Cents;
  /** Mensualité de croisière. */
  cruise: Cents;
  /**
   * Ce que le besoin demande au-delà du régime : le rattrapage d'un déficit (D29) ; pour une
   * échéance, ce qu'elle demande, lissage décidé compris — rien ne se lisse d'office (D88, #184).
   */
  catchUp: Cents;
  /**
   * Dotation de la période : pour une échéance, sa croisière plus la part d'un lissage décidé (D88) ;
   * pour un autre besoin, max(croisière, rattrapage d'un déficit), 0 si l'objectif est atteint.
   */
  requested: Cents;
  /** Plancher en cas de marge négative (D06) : ce qu'une échéance demande, lissage décidé compris. */
  floor: Cents;
  /** Part d'un lissage décidé datée dans la période (D88, #184) ; comprise dans `requested`. */
  smoothing: Cents;
  dueDate?: ISODate;
  target?: Cents;
}

export interface PeriodSnapshot {
  period: Period;
  /** Solde de la tirelire au début de la période, avant dotation. */
  balanceBefore: Cents;
  needs: NeedSnapshot[];
  /**
   * Somme des dotations calculées de la période, hors lissage décidé : celui-ci est une saisie, qui
   * compte par ses sous-opérations datées (`smoothing`).
   */
  dotation: Cents;
  /** Parts d'un lissage décidé datées dans la période (D88, #184). */
  smoothing: Cents;
  /** Libération en fin de période (positif = rendu au non affecté ; négatif = remise à zéro d'un déficit). */
  release: Cents;
}

export interface LedgerIndex {
  accountsById: Map<Id, Account>;
  tireliresById: Map<Id, Tirelire>;
  needsByTirelire: Map<Id, Need[]>;
  operationsById: Map<Id, Operation>;
  /** Sous-opérations vivantes par opération, tous niveaux (`liveSubOperations`). */
  subOperationsByOperation: Map<Id, SubOperation[]>;
  /** Lignes comptées par opération (`countedLines`), une pour une opération sans sous-opération. */
  linesByOperation: Map<Id, CountedLine[]>;
  /** Écritures vivantes par tirelire, effets déjà calculés, triées par date. */
  entriesByTirelire: Map<Id, TirelireEntry[]>;
  principal: Account | undefined;
  startDay: number;
  /** Mémo des chronologies par tirelire (dotations et libérations), étendues à la demande. */
  timelines: Map<Id, PeriodSnapshot[]>;
  /**
   * Parts des lissages décidés, par besoin (D88, #184) : les lignes datées de la saisie que désigne
   * une réponse vivante, sur la tirelire du besoin.
   */
  smoothingByNeed: Map<Id, Array<{ date: ISODate; amount: Cents }>>;
  /** Les saisies de lissage que désigne une réponse vivante. */
  smoothingOperations: Set<Id>;
}

export function indexLedger(ledger: Ledger): LedgerIndex {
  const accountsById = new Map(alive(ledger.accounts).map((a) => [a.id, a]));
  const tireliresById = new Map(alive(ledger.tirelires).map((e) => [e.id, e]));
  const needsByTirelire = new Map<Id, Need[]>();
  for (const n of alive(ledger.needs)) {
    if (!tireliresById.has(n.tirelireId)) continue;
    const arr = needsByTirelire.get(n.tirelireId);
    if (arr) arr.push(n);
    else needsByTirelire.set(n.tirelireId, [n]);
  }
  for (const arr of needsByTirelire.values()) arr.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const operationsById = new Map(alive(ledger.operations).map((o) => [o.id, o]));
  const subOperationsByOperation = new Map<Id, SubOperation[]>();
  for (const sub of liveSubOperations(ledger.subOperations, new Set(operationsById.keys()))) {
    const arr = subOperationsByOperation.get(sub.operationId);
    if (arr) arr.push(sub);
    else subOperationsByOperation.set(sub.operationId, [sub]);
  }
  const linesByOperation = new Map<Id, CountedLine[]>();
  for (const op of operationsById.values()) linesByOperation.set(op.id, countedLines(op, subOperationsByOperation.get(op.id) ?? []));
  const principal = [...accountsById.values()].find((a) => a.kind === 'principal');
  const idx: LedgerIndex = {
    accountsById,
    tireliresById,
    needsByTirelire,
    operationsById,
    subOperationsByOperation,
    linesByOperation,
    entriesByTirelire: new Map(),
    principal,
    startDay: ledger.settings.periodStartDay,
    timelines: new Map(),
    smoothingByNeed: new Map(),
    smoothingOperations: new Set(),
  };
  const needsById = new Map(alive(ledger.needs).map((n) => [n.id, n]));
  for (const answer of alive(ledger.shortfallAnswers ?? [])) {
    const op = answer.operationId ? operationsById.get(answer.operationId) : undefined;
    const need = needsById.get(answer.needId);
    if (!op || !need) continue;
    idx.smoothingOperations.add(op.id);
    const parts = idx.smoothingByNeed.get(need.id) ?? [];
    for (const line of linesByOperation.get(op.id) ?? []) if (line.tirelireId === need.tirelireId) parts.push({ date: line.date, amount: line.amount });
    idx.smoothingByNeed.set(need.id, parts);
  }
  for (const [opId, lines] of linesByOperation) {
    const op = operationsById.get(opId)!;
    for (const line of lines) {
      const env = line.tirelireId ? tireliresById.get(line.tirelireId) : undefined;
      if (!env) continue;
      const effects = lineEffects(op, line, idx);
      const entry: TirelireEntry = { operation: op, line, date: line.date, effects, effect: effects.reduce((s, x) => s + x.amount, 0) };
      const arr = idx.entriesByTirelire.get(env.id);
      if (arr) arr.push(entry);
      else idx.entriesByTirelire.set(env.id, [entry]);
    }
  }
  for (const arr of idx.entriesByTirelire.values()) arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return idx;
}

/**
 * Effets par compte d'une ligne comptée (D19).
 *  - dépense ou revenu : `amount` sur le compte de l'opération ;
 *  - virement interne : `amount` sur le compte de départ et `−amount` sur le compte d'arrivée,
 *    sauf si l'autre côté du virement est importé et compte une ligne sur la même tirelire (il
 *    porte alors lui-même sa composante).
 */
export function lineEffects(op: Operation, line: CountedLine, idx: LedgerIndex): ComponentEffect[] {
  const own: ComponentEffect = { accountId: op.accountId, amount: line.amount };
  if (!op.transferAccountId) return [own];
  if (op.transferOperationId) {
    const twin = idx.operationsById.get(op.transferOperationId);
    const twinLines = twin ? (idx.linesByOperation.get(twin.id) ?? []) : [];
    if (twin && twinLines.some((l) => l.tirelireId && l.tirelireId === line.tirelireId)) return [own];
  }
  return [own, { accountId: op.transferAccountId, amount: -line.amount }];
}

/** Effet net d'une ligne comptée sur le solde de sa tirelire (0 pour un virement interne). */
export function lineEffect(op: Operation, line: CountedLine, idx: LedgerIndex): Cents {
  return lineEffects(op, line, idx).reduce((s, x) => s + x.amount, 0);
}

function entriesUpTo(e: Tirelire, idx: LedgerIndex, asOf: ISODate): TirelireEntry[] {
  return (idx.entriesByTirelire.get(e.id) ?? []).filter(({ date }) => date <= asOf && date >= e.openingDate);
}

function entriesEffect(e: Tirelire, idx: LedgerIndex, from: ISODate, to: ISODate): Cents {
  return (idx.entriesByTirelire.get(e.id) ?? []).reduce((s, x) => (x.date >= from && x.date <= to && x.date >= e.openingDate ? s + x.effect : s), 0);
}

/** Parts d'un lissage décidé du besoin datées dans la période `p` (D88, #184). */
export function smoothingIn(idx: LedgerIndex, needId: Id, p: Period): Cents {
  return (idx.smoothingByNeed.get(needId) ?? []).reduce((s, x) => (x.date >= p.start && x.date <= p.end ? s + x.amount : s), 0);
}

// ---------------------------------------------------------------------------
// Chronologie : dotations et libérations par période (D29)
// ---------------------------------------------------------------------------

/** Compte de repli d'une tirelire : le premier compte de son placement voulu (D38). */
export function homeAccount(e: Tirelire): Id | undefined {
  return e.placement[0]?.accountId;
}

/** Compte qui reçoit les dotations : le compte principal, sinon le premier compte du placement. */
export function dotationAccount(e: Tirelire, idx: LedgerIndex): Id {
  return idx.principal?.id ?? homeAccount(e) ?? '';
}

/** Croisière d'un besoin par période de paie. */
export function needCruise(n: Need): Cents {
  switch (n.kind) {
    case 'recurring':
      return divideCents(n.amount ?? 0, n.periodicity ? monthsOf(n.periodicity) : 1);
    case 'dueDate':
      return divideCents(n.amount ?? 0, n.periodicity ? monthsOf(n.periodicity) : 12);
    case 'goal':
      return n.monthlyAmount ?? 0;
    case 'payout':
      // Montant déclaré pour la périodicité (l'année, en général), réparti sur les périodes.
      return divideCents(n.amount ?? 0, n.periodicity ? monthsOf(n.periodicity) : 12);
  }
}

/** Réserve des besoins non récurrents : ce que la libération de fin de période ne touche pas. */
function reserveOf(needs: Need[]): Cents {
  return needs.reduce((s, n) => (n.kind === 'recurring' || n.kind === 'payout' ? s : s + (n.amount ?? 0)), 0);
}

/**
 * Attribue le solde aux besoins dans l'ordre des priorités et calcule ce que chacun demande
 * pour la période `p`. Un déficit pèse sur le premier besoin récurrent si la tirelire reporte,
 * sinon sur le premier besoin.
 *
 * Une échéance demande sa croisière, plus la part d'un lissage décidé datée dans la période
 * (`smoothingOf`), et rien d'autre : ce qui ne sera pas réuni à temps est un manque, qui s'annonce
 * et ne se lisse que sur décision de l'utilisateur (principe 1.4, D88, #184). Entièrement
 * provisionnée, elle ne demande plus que la part d'un lissage décidé.
 */
export function needSnapshots(
  e: Tirelire,
  needs: Need[],
  balance: Cents,
  p: Period,
  startDay: number,
  smoothingOf: (needId: Id) => Cents = () => 0,
): NeedSnapshot[] {
  let remaining = balance;
  const out: NeedSnapshot[] = [];
  for (const n of needs) {
    const cruise = needCruise(n);
    switch (n.kind) {
      case 'dueDate': {
        const target = n.amount ?? 0;
        const per = n.periodicity ?? { interval: 12, unit: 'month' as const, anchorDate: p.start };
        const dueDate = nextOccurrence(per, p.start);
        const held = Math.min(Math.max(remaining, 0), target);
        remaining -= held;
        const smoothing = smoothingOf(n.id);
        // Entièrement provisionnée : plus de croisière avant l'échéance ; un lissage décidé reste dû.
        const requested = (held >= target ? 0 : cruise) + smoothing;
        out.push({ needId: n.id, held, cruise, catchUp: requested, requested, floor: requested, smoothing, dueDate, target });
        break;
      }
      case 'goal': {
        const target = n.amount;
        const held = target === undefined ? Math.max(remaining, 0) : Math.min(Math.max(remaining, 0), target);
        remaining -= held;
        const reached = target !== undefined && held >= target;
        const requested = reached ? 0 : target !== undefined ? Math.min(cruise, target - held) : cruise;
        out.push({ needId: n.id, held, cruise, catchUp: requested, requested, floor: 0, smoothing: 0, ...(target !== undefined ? { target } : {}) });
        break;
      }
      case 'payout': {
        // On ne verse que ce que la tirelire porte : une saison décevante réduit le versement.
        const held = Math.max(remaining, 0);
        remaining -= held;
        const verse = Math.min(cruise, held);
        out.push({ needId: n.id, held, cruise, catchUp: 0, requested: -verse || 0, floor: 0, smoothing: 0, target: n.amount ?? 0 });
        break;
      }
      case 'recurring': {
        const held = Math.max(remaining, 0);
        remaining -= held;
        out.push({ needId: n.id, held, cruise, catchUp: cruise, requested: cruise, floor: 0, smoothing: 0, target: n.amount ?? 0 });
        break;
      }
    }
  }
  if (remaining < 0 && out.length > 0) {
    const rollover = e.rollover ?? { mode: 'unlimited' };
    const bearer =
      (rollover.mode !== 'none' ? out.find((s) => needs.find((n) => n.id === s.needId)?.kind === 'recurring') : undefined) ?? out[0]!;
    bearer.catchUp += -remaining;
    bearer.requested = Math.max(bearer.cruise, bearer.catchUp);
  }
  return out;
}

/** Libération en fin de période (D29) : excédent au-delà de la réserve (et du plafond), ou remise à zéro d'un déficit. */
function releaseOf(e: Tirelire, needs: Need[], balanceEnd: Cents): Cents {
  const rollover = e.rollover ?? { mode: 'unlimited' };
  if (rollover.mode === 'unlimited') return 0;
  const reserve = reserveOf(needs);
  if (rollover.mode === 'none') {
    if (balanceEnd < 0) return balanceEnd;
    return Math.max(0, balanceEnd - reserve);
  }
  const cap = reserve + rollover.months * needs.reduce((s, n) => (n.kind === 'recurring' ? s + needCruise(n) : s), 0);
  return Math.max(0, balanceEnd - cap);
}

/**
 * Chronologie d'une tirelire jusqu'à la période contenant `until` (incluse) : pour chaque
 * période depuis l'ouverture, solde avant dotation, dotations par besoin, libération. La
 * période qui contient la date d'ouverture est réputée déjà comprise dans le solde initial,
 * sauf si l'ouverture tombe le premier jour. Mémorisée dans l'index.
 */
export function tirelireTimeline(e: Tirelire, idx: LedgerIndex, until: ISODate): PeriodSnapshot[] {
  const needs = idx.needsByTirelire.get(e.id) ?? [];
  let tl = idx.timelines.get(e.id);
  if (!tl) {
    tl = [];
    idx.timelines.set(e.id, tl);
  }
  const target = budgetPeriodContaining(until, idx.startDay);
  let p: Period;
  if (tl.length) p = nextPeriod(tl[tl.length - 1]!.period, idx.startDay);
  else {
    p = budgetPeriodContaining(e.openingDate, idx.startDay);
    if (p.start < e.openingDate) p = nextPeriod(p, idx.startDay);
  }
  while (p.start <= target.start) {
    const prior = tl.reduce((s, x) => s + x.dotation - x.release, 0);
    const balanceBefore = e.openingBalance + prior + entriesEffect(e, idx, e.openingDate, addDays(p.start, -1));
    // Seuls les besoins en vigueur le premier jour de la période sont dotés (D50) : un budget
    // clos en juin ne réclame plus rien en juillet, et un budget ouvert en juin ne rétroagit pas.
    const actifs = needs.filter((n) => needActive(n, p.start));
    const snaps = needSnapshots(e, actifs, balanceBefore, p, idx.startDay, (needId) => smoothingIn(idx, needId, p));
    // Le lissage décidé compte par les sous-opérations de sa saisie (`entriesEffect`) : la dotation
    // calculée ne le compte pas une seconde fois.
    const smoothing = snaps.reduce((s, x) => s + x.smoothing, 0);
    const dotation = snaps.reduce((s, x) => s + x.requested, 0) - smoothing;
    const balanceEnd = balanceBefore + dotation + entriesEffect(e, idx, p.start, p.end);
    tl.push({ period: p, balanceBefore, needs: snaps, dotation, smoothing, release: releaseOf(e, actifs, balanceEnd) });
    p = nextPeriod(p, idx.startDay);
  }
  return tl;
}

/** Instantané de la période contenant `asOf` (undefined si la tirelire n'est pas encore ouverte). */
export function periodSnapshot(e: Tirelire, idx: LedgerIndex, asOf: ISODate): PeriodSnapshot | undefined {
  const p = budgetPeriodContaining(asOf, idx.startDay);
  return tirelireTimeline(e, idx, asOf).find((s) => s.period.start === p.start);
}

// ---------------------------------------------------------------------------
// Positions et soldes
// ---------------------------------------------------------------------------

function add(c: Components, accountId: Id, amount: Cents): void {
  if (amount === 0) return;
  c.set(accountId, (c.get(accountId) ?? 0) + amount);
}

/**
 * Position d'une tirelire au `asOf` : composantes par compte, dotations (datées du début de
 * période, comptées si ≤ `asOf`) et libérations (datées de la fin de période, comptées si
 * < `asOf`) comprises. Les composantes nulles sont omises.
 */
export function tirelireComponents(e: Tirelire, idx: LedgerIndex, asOf: ISODate): Components {
  const c: Components = new Map();
  const home = homeAccount(e);
  if (e.openingDate <= asOf && home) add(c, home, e.openingBalance);
  for (const entry of entriesUpTo(e, idx, asOf)) for (const eff of entry.effects) add(c, eff.accountId, eff.amount);
  const dot = dotationAccount(e, idx);
  for (const s of tirelireTimeline(e, idx, asOf)) {
    if (s.period.start <= asOf) add(c, dot, s.dotation);
    if (s.period.end < asOf && home) add(c, home, -s.release);
  }
  for (const [k, v] of c) if (v === 0) c.delete(k);
  return c;
}

/** Solde d'une tirelire = somme de ses composantes. */
export function tirelireBalance(e: Tirelire, idx: LedgerIndex, asOf: ISODate): Cents {
  let s = 0;
  for (const v of tirelireComponents(e, idx, asOf).values()) s += v;
  return s;
}

/**
 * État d'une tirelire (D56). Elle ne porte pas de dates : ce sont ses besoins qui en ont (D50), et
 * son état se lit sur eux — en vigueur dès qu'un seul l'est, à venir si tous attendent, close si
 * tous sont finis.
 *
 * Deux réserves, qui toutes deux protègent contre l'oubli d'argent :
 *  - une tirelire qui porte encore un solde reste en vigueur, quels que soient ses besoins. Le
 *    dernier besoin d'une tirelire s'éteint souvent avant qu'elle soit vidée ; la ranger dans les
 *    closes ferait disparaître de l'écran de l'argent qui existe.
 *  - une tirelire sans aucun besoin est en vigueur : elle ne demande rien au plan (l'écran le dit
 *    déjà), mais rien ne permet de la dire terminée.
 */
export function tirelireValidityState(e: Tirelire, idx: LedgerIndex, asOf: ISODate): ValidityState {
  if (tirelireBalance(e, idx, asOf) !== 0) return 'active';
  const needs = idx.needsByTirelire.get(e.id) ?? [];
  if (needs.length === 0) return 'active';
  const states = needs.map((n) => validityState(n, asOf));
  if (states.includes('active')) return 'active';
  return states.includes('upcoming') ? 'upcoming' : 'closed';
}

/**
 * Position voulue d'une tirelire (D38) : le placement, résolu sur son solde du moment. Les parts
 * fixes et les pourcentages d'abord, la part « reste » ensuite. Sans placement déclaré, la
 * position voulue est la position réelle : l'argent est bien là où il est.
 */
export function wantedComponents(e: Tirelire, idx: LedgerIndex, asOf: ISODate): Components {
  return resolvePlacement(e, tirelireComponents(e, idx, asOf));
}

/**
 * Position voulue d'une tirelire qui porterait `amount` (D37, D38). Une dotation se répartit en
 * comparant deux appels — la position voulue après, moins celle d'avant : une part fixe est un
 * plafond de position, pas une part du flux du mois. `fromAccountId` garde ce qu'aucune part ne
 * réclame : l'argent naît sur le compte principal et y reste tant que rien ne le place ailleurs.
 */
export function placementShares(e: Tirelire, amount: Cents, fromAccountId: Id): Components {
  return resolvePlacement(e, new Map([[fromAccountId, amount]]));
}

/**
 * Répartition voulue d'une position donnée. Séparée de `wantedComponents` pour servir aussi bien
 * à la position réelle qu'à la demande d'une période, calculée sur le seul solde de la tirelire
 * (`periodDemand`, D52).
 */
function resolvePlacement(e: Tirelire, real: Components): Components {
  if (e.placement.length === 0) return real;
  const total = [...real.values()].reduce((s, v) => s + v, 0);
  const out: Components = new Map();
  let used = 0;
  let rest: Id | undefined;
  for (const part of e.placement) {
    if (part.share.kind === 'variable') {
      if (rest === undefined) rest = part.accountId;
      continue;
    }
    const amount = part.share.kind === 'fixed' ? part.share.amount : Math.round((total * part.share.pct) / 100);
    // On ne veut pas placer plus que ce que la tirelire contient : la dernière part absorbe le manque.
    const capped = total >= 0 ? Math.min(amount, Math.max(0, total - used)) : Math.max(amount, Math.min(0, total - used));
    add(out, part.accountId, capped);
    used += capped;
  }
  if (rest !== undefined) add(out, rest, total - used);
  else if (total !== used) {
    // Pas de part « reste » : le surplus est réputé vouloir rester là où il est déjà.
    for (const [accountId, amount] of real) {
      if (e.placement.some((p) => p.accountId === accountId)) continue;
      add(out, accountId, amount);
    }
  }
  for (const [k, v] of out) if (v === 0) out.delete(k);
  return out;
}

/**
 * Écarts de placement (D20, D38), lus sur le réel : par compte, ce qui s'y trouve de trop (positif)
 * ou y manque (négatif) au regard du placement voulu, à `asOf`. Ne sert qu'à la période où l'on lit :
 * pour une période à venir, ce qu'il faut virer est ce que les tirelires demandent (`periodDemand`),
 * et les positions des comptes se lisent en solde prévu (`computeForecast`, D52, D88).
 */
export function placementGaps(e: Tirelire, idx: LedgerIndex, asOf: ISODate): ComponentEffect[] {
  const real = tirelireComponents(e, idx, asOf);
  const wanted = resolvePlacement(e, real);
  const out: ComponentEffect[] = [];
  for (const accountId of new Set([...real.keys(), ...wanted.keys()])) {
    const amount = (real.get(accountId) ?? 0) - (wanted.get(accountId) ?? 0);
    if (amount !== 0) out.push({ accountId, amount });
  }
  return out;
}

/**
 * Ce que la tirelire demande pour la période contenant `asOf`, compte par compte (D52, #183) : sa
 * dotation, répartie comme son placement la veut — la position voulue après la dotation, moins
 * celle d'avant, toutes deux calculées sur le solde de la tirelire (D29), jamais sur une position
 * de compte. Rien n'y suppose qu'un virement a eu lieu : c'est ce qu'il faut virer pour elle.
 * Le compte de dotation garde ce qu'aucune part ne réclame.
 */
export function periodDemand(e: Tirelire, idx: LedgerIndex, asOf: ISODate): Components {
  const snap = periodSnapshot(e, idx, asOf);
  const out: Components = new Map();
  // Ce que la tirelire demande : sa dotation, et la part d'un lissage décidé de la période (D88).
  const demande = snap ? snap.dotation + snap.smoothing : 0;
  if (!snap || demande === 0) return out;
  const source = dotationAccount(e, idx);
  const avant = resolvePlacement(e, new Map([[source, snap.balanceBefore]]));
  const apres = resolvePlacement(e, new Map([[source, snap.balanceBefore + demande]]));
  for (const accountId of new Set([...avant.keys(), ...apres.keys()])) {
    const part = (apres.get(accountId) ?? 0) - (avant.get(accountId) ?? 0);
    if (part !== 0) out.set(accountId, part);
  }
  return out;
}

/** Dépensé sur une tirelire pendant une période (effets négatifs, en positif). */
export function spentInPeriod(e: Tirelire, idx: LedgerIndex, period: Period): Cents {
  return entriesUpTo(e, idx, period.end).reduce((s, { date, effect }) => {
    if (date < period.start || date > period.end) return s;
    return effect < 0 ? s - effect : s;
  }, 0);
}

/** Solde bancaire reconstruit d'un compte réel (principal, accueil). */
export function accountBalance(a: Account, ledger: Ledger, asOf: ISODate): Cents {
  return alive(ledger.operations)
    .filter((o) => o.accountId === a.id && o.date > a.openingDate && o.date <= asOf)
    .reduce((s, o) => s + o.amount, a.openingBalance);
}

/** Composantes portées par un compte, toutes tirelires confondues. */
export function componentsOnAccount(a: Account, idx: LedgerIndex, asOf: ISODate): Cents {
  let s = 0;
  for (const e of idx.tireliresById.values()) s += tirelireComponents(e, idx, asOf).get(a.id) ?? 0;
  return s;
}

/** Non affecté d'un compte = solde bancaire − composantes qu'il porte (second invariant de D19). */
export function unallocated(a: Account, ledger: Ledger, idx: LedgerIndex, asOf: ISODate): Cents {
  return accountBalance(a, ledger, asOf) - componentsOnAccount(a, idx, asOf);
}

/**
 * Part d'une opération sans tirelire, à tous les niveaux (dans le signe de l'opération) : ce qui
 * reste sur son compte réel, le non affecté (D29, D88).
 */
export function unallocatedAmount(op: Operation, idx: LedgerIndex): Cents {
  return (idx.linesByOperation.get(op.id) ?? []).reduce((s, l) => (l.tirelireId && idx.tireliresById.has(l.tirelireId) ? s : s + l.amount), 0);
}

/**
 * Solde à régler avec un compte tiers (D04) : ce que le compte principal lui doit (positif) ou ce qu'il
 * doit au compte principal (négatif).
 *
 * - Opération saisie sur le tiers : le compte principal lui doit le montant (une dépense de 80 € → +80 ;
 *   un revenu reçu là de 100 € → −100), sauf la part ventilée sur une tirelire placée sur ce
 *   tiers (l'argent y est déjà, ou doit y être).
 * - Virement d'un autre compte vers le tiers : règle la dette (−200 sortant du compte principal → −200),
 *   sauf la part qui alimente une tirelire placée sur le tiers (dotation, pas règlement).
 * Les virements sont enregistrés côté principal ; une saisie du même virement côté tiers est ignorée.
 * Les écarts de placement (D20) ne sont pas proposés pour un tiers : le règlement les couvre.
 */
export function settlementBalance(third: Account, ledger: Ledger, idx: LedgerIndex, asOf: ISODate): Cents {
  let owes = 0;
  for (const op of idx.operationsById.values()) {
    if (op.date > asOf) continue;
    const isOnThird = op.accountId === third.id;
    const isTransferToThird = op.transferAccountId === third.id;
    if (!isOnThird && !isTransferToThird) continue;
    if (isOnThird && op.transferAccountId) continue;
    const placedHere = (idx.linesByOperation.get(op.id) ?? []).reduce((s, line) => {
      const env = line.tirelireId ? idx.tireliresById.get(line.tirelireId) : undefined;
      return env && homeAccount(env) === third.id ? s + line.amount : s;
    }, 0);
    const outside = op.amount - placedHere;
    owes += isOnThird ? -outside : outside;
  }
  return owes;
}
