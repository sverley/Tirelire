/**
 * Soldes reconstruits : jamais stockés, toujours recalculés.
 *
 * Une enveloppe a une position par compte (D19) : ses **composantes**. Elles viennent
 *  - du solde initial, réputé sur le compte de placement à la date d'ouverture ;
 *  - des lignes de ventilation : une dépense ou un revenu pèse sur le compte de l'opération,
 *    un virement interne déplace une composante d'un compte vers l'autre sans changer le solde ;
 *  - des **dotations** calculées (D29) : au début de chaque période, chaque besoin reçoit ce
 *    qu'il demande, sur le pivot (ou sur le compte de placement sans pivot) ;
 *  - des **libérations** calculées (D05, D29) : en fin de période, l'excédent au-delà de la
 *    réserve des besoins non récurrents retourne au non affecté du compte de placement.
 *
 * Deux invariants : la somme des composantes d'une enveloppe fait son solde ; pour un compte,
 * la somme des composantes qu'il porte plus son non affecté fait son solde bancaire.
 */
import type { Account, Allocation, Cents, Envelope, Id, ISODate, Ledger, Need, Operation } from './model.js';
import { alive } from './model.js';
import { nextOccurrence, payPeriodContaining, periodsUntil, nextPeriod, type Period } from './periods.js';
import { divideCents } from './money.js';
import { addDays } from './dates.js';

/** Position d'une enveloppe : compte → composante (centimes signés). */
export type Components = Map<Id, Cents>;

export interface ComponentEffect {
  accountId: Id;
  amount: Cents;
}

export interface EnvelopeEntry {
  operation: Operation;
  allocation: Allocation;
  /** Effets par compte (un pour une dépense, deux pour un virement dont l'autre côté n'est pas importé). */
  effects: ComponentEffect[];
  /** Effet net sur le solde de l'enveloppe. */
  effect: Cents;
}

/** Ce qu'un besoin retient et demande au début d'une période (D29). */
export interface NeedSnapshot {
  needId: Id;
  /** Part du solde de l'enveloppe attribuée à ce besoin (dans l'ordre des priorités). */
  held: Cents;
  /** Mensualité de croisière. */
  cruise: Cents;
  /** Mensualité de rattrapage (échéance ou déficit). */
  catchUp: Cents;
  /** Dotation de la période : max(croisière, rattrapage), 0 si l'objectif est atteint. */
  requested: Cents;
  /** Plancher en cas de marge négative : le rattrapage d'une échéance ne se discute pas. */
  floor: Cents;
  dueDate?: ISODate;
  target?: Cents;
}

export interface PeriodSnapshot {
  period: Period;
  /** Solde de l'enveloppe au début de la période, avant dotation. */
  balanceBefore: Cents;
  needs: NeedSnapshot[];
  /** Somme des dotations de la période. */
  dotation: Cents;
  /** Libération en fin de période (positif = rendu au non affecté ; négatif = remise à zéro d'un déficit). */
  release: Cents;
}

export interface LedgerIndex {
  accountsById: Map<Id, Account>;
  envelopesById: Map<Id, Envelope>;
  needsByEnvelope: Map<Id, Need[]>;
  operationsById: Map<Id, Operation>;
  allocationsByOperation: Map<Id, Allocation[]>;
  /** Écritures vivantes par enveloppe, effets déjà calculés, triées par date. */
  entriesByEnvelope: Map<Id, EnvelopeEntry[]>;
  pivot: Account | undefined;
  payDay: number;
  /** Mémo des chronologies par enveloppe (dotations et libérations), étendues à la demande. */
  timelines: Map<Id, PeriodSnapshot[]>;
}

export function indexLedger(ledger: Ledger): LedgerIndex {
  const accountsById = new Map(alive(ledger.accounts).map((a) => [a.id, a]));
  const envelopesById = new Map(alive(ledger.envelopes).map((e) => [e.id, e]));
  const needsByEnvelope = new Map<Id, Need[]>();
  for (const n of alive(ledger.needs)) {
    if (!envelopesById.has(n.envelopeId)) continue;
    const arr = needsByEnvelope.get(n.envelopeId);
    if (arr) arr.push(n);
    else needsByEnvelope.set(n.envelopeId, [n]);
  }
  for (const arr of needsByEnvelope.values()) arr.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const operationsById = new Map(alive(ledger.operations).map((o) => [o.id, o]));
  const allocationsByOperation = new Map<Id, Allocation[]>();
  for (const al of alive(ledger.allocations)) {
    if (!operationsById.has(al.operationId)) continue;
    const arr = allocationsByOperation.get(al.operationId);
    if (arr) arr.push(al);
    else allocationsByOperation.set(al.operationId, [al]);
  }
  const pivot = [...accountsById.values()].find((a) => a.kind === 'pivot');
  const idx: LedgerIndex = {
    accountsById,
    envelopesById,
    needsByEnvelope,
    operationsById,
    allocationsByOperation,
    entriesByEnvelope: new Map(),
    pivot,
    payDay: pivot?.payDay ?? 1,
    timelines: new Map(),
  };
  for (const [opId, allocs] of allocationsByOperation) {
    const op = operationsById.get(opId)!;
    for (const al of allocs) {
      const env = al.envelopeId ? envelopesById.get(al.envelopeId) : undefined;
      if (!env) continue;
      const effects = allocationEffects(op, al, idx);
      const entry: EnvelopeEntry = { operation: op, allocation: al, effects, effect: effects.reduce((s, x) => s + x.amount, 0) };
      const arr = idx.entriesByEnvelope.get(env.id);
      if (arr) arr.push(entry);
      else idx.entriesByEnvelope.set(env.id, [entry]);
    }
  }
  for (const arr of idx.entriesByEnvelope.values()) arr.sort((a, b) => (a.operation.date < b.operation.date ? -1 : a.operation.date > b.operation.date ? 1 : 0));
  return idx;
}

/** Montant d'une ligne de ventilation (D10 : part du montant de l'opération, dans son signe). */
export function allocationAmount(al: Allocation): Cents {
  return al.amount;
}

/**
 * Effets par compte d'une ligne de ventilation (D19).
 *  - dépense ou revenu : `amount` sur le compte de l'opération ;
 *  - virement interne : `amount` sur le compte de départ et `−amount` sur le compte d'arrivée,
 *    sauf si l'autre côté du virement est importé et ventilé sur la même enveloppe (il porte
 *    alors lui-même sa composante).
 */
export function allocationEffects(op: Operation, al: Allocation, idx: LedgerIndex): ComponentEffect[] {
  const amount = allocationAmount(al);
  const own: ComponentEffect = { accountId: op.accountId, amount };
  if (!op.transferAccountId) return [own];
  if (op.transferOperationId) {
    const twin = idx.operationsById.get(op.transferOperationId);
    const twinAllocs = twin ? (idx.allocationsByOperation.get(twin.id) ?? []) : [];
    if (twin && twinAllocs.some((a) => a.envelopeId === al.envelopeId)) return [own];
  }
  return [own, { accountId: op.transferAccountId, amount: -amount }];
}

/** Effet net d'une ligne sur le solde de son enveloppe (0 pour un virement interne). */
export function allocationEffect(op: Operation, al: Allocation, idx: LedgerIndex): Cents {
  return allocationEffects(op, al, idx).reduce((s, x) => s + x.amount, 0);
}

function entriesUpTo(e: Envelope, idx: LedgerIndex, asOf: ISODate): EnvelopeEntry[] {
  return (idx.entriesByEnvelope.get(e.id) ?? []).filter(({ operation }) => operation.date <= asOf && operation.date >= e.openingDate);
}

function entriesEffect(e: Envelope, idx: LedgerIndex, from: ISODate, to: ISODate): Cents {
  return (idx.entriesByEnvelope.get(e.id) ?? []).reduce(
    (s, x) => (x.operation.date >= from && x.operation.date <= to && x.operation.date >= e.openingDate ? s + x.effect : s),
    0,
  );
}

// ---------------------------------------------------------------------------
// Chronologie : dotations et libérations par période (D29)
// ---------------------------------------------------------------------------

/** Compte qui reçoit les dotations : le pivot, sinon le compte de placement. */
export function dotationAccount(e: Envelope, idx: LedgerIndex): Id {
  return idx.pivot?.id ?? e.placementAccountId;
}

/** Croisière d'un besoin par période de paie. */
export function needCruise(n: Need): Cents {
  switch (n.kind) {
    case 'recurring':
      return divideCents(n.amount ?? 0, n.periodicity?.intervalMonths ?? 1);
    case 'dueDate':
      return divideCents(n.amount ?? 0, n.periodicity?.intervalMonths ?? 12);
    case 'goal':
      return n.monthlyAmount ?? 0;
  }
}

/** Réserve des besoins non récurrents : ce que la libération de fin de période ne touche pas. */
function reserveOf(needs: Need[]): Cents {
  return needs.reduce((s, n) => (n.kind === 'recurring' ? s : s + (n.amount ?? 0)), 0);
}

/**
 * Attribue le solde aux besoins dans l'ordre des priorités et calcule ce que chacun demande
 * pour la période `p`. Un déficit pèse sur le premier besoin récurrent si l'enveloppe reporte,
 * sinon sur le premier besoin.
 */
export function needSnapshots(e: Envelope, needs: Need[], balance: Cents, p: Period, payDay: number): NeedSnapshot[] {
  let remaining = balance;
  const out: NeedSnapshot[] = [];
  for (const n of needs) {
    const cruise = needCruise(n);
    switch (n.kind) {
      case 'dueDate': {
        const target = n.amount ?? 0;
        const per = n.periodicity ?? { intervalMonths: 12, anchorDate: p.start };
        const dueDate = nextOccurrence(per, p.start);
        const held = Math.min(Math.max(remaining, 0), target);
        remaining -= held;
        const k = Math.max(1, periodsUntil(p, dueDate, payDay));
        const catchUp = Math.max(0, Math.ceil(Math.max(0, target - held) / k));
        // Entièrement provisionné : rien à ajouter avant l'échéance.
        const requested = held >= target ? 0 : Math.max(cruise, catchUp);
        out.push({ needId: n.id, held, cruise, catchUp, requested, floor: catchUp, dueDate, target });
        break;
      }
      case 'goal': {
        const target = n.amount;
        const held = target === undefined ? Math.max(remaining, 0) : Math.min(Math.max(remaining, 0), target);
        remaining -= held;
        const reached = target !== undefined && held >= target;
        const requested = reached ? 0 : target !== undefined ? Math.min(cruise, target - held) : cruise;
        out.push({ needId: n.id, held, cruise, catchUp: requested, requested, floor: 0, ...(target !== undefined ? { target } : {}) });
        break;
      }
      case 'recurring': {
        const held = Math.max(remaining, 0);
        remaining -= held;
        out.push({ needId: n.id, held, cruise, catchUp: cruise, requested: cruise, floor: 0, target: n.amount ?? 0 });
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
function releaseOf(e: Envelope, needs: Need[], balanceEnd: Cents): Cents {
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
 * Chronologie d'une enveloppe jusqu'à la période contenant `until` (incluse) : pour chaque
 * période depuis l'ouverture, solde avant dotation, dotations par besoin, libération. La
 * période qui contient la date d'ouverture est réputée déjà comprise dans le solde initial,
 * sauf si l'ouverture tombe le premier jour. Mémorisée dans l'index.
 */
export function envelopeTimeline(e: Envelope, idx: LedgerIndex, until: ISODate): PeriodSnapshot[] {
  const needs = idx.needsByEnvelope.get(e.id) ?? [];
  let tl = idx.timelines.get(e.id);
  if (!tl) {
    tl = [];
    idx.timelines.set(e.id, tl);
  }
  const target = payPeriodContaining(until, idx.payDay);
  let p: Period;
  if (tl.length) p = nextPeriod(tl[tl.length - 1]!.period, idx.payDay);
  else {
    p = payPeriodContaining(e.openingDate, idx.payDay);
    if (p.start < e.openingDate) p = nextPeriod(p, idx.payDay);
  }
  while (p.start <= target.start) {
    const prior = tl.reduce((s, x) => s + x.dotation - x.release, 0);
    const balanceBefore = e.openingBalance + prior + entriesEffect(e, idx, e.openingDate, addDays(p.start, -1));
    const snaps = needSnapshots(e, needs, balanceBefore, p, idx.payDay);
    const dotation = snaps.reduce((s, x) => s + x.requested, 0);
    const balanceEnd = balanceBefore + dotation + entriesEffect(e, idx, p.start, p.end);
    tl.push({ period: p, balanceBefore, needs: snaps, dotation, release: releaseOf(e, needs, balanceEnd) });
    p = nextPeriod(p, idx.payDay);
  }
  return tl;
}

/** Instantané de la période contenant `asOf` (undefined si l'enveloppe n'est pas encore ouverte). */
export function periodSnapshot(e: Envelope, idx: LedgerIndex, asOf: ISODate): PeriodSnapshot | undefined {
  const p = payPeriodContaining(asOf, idx.payDay);
  return envelopeTimeline(e, idx, asOf).find((s) => s.period.start === p.start);
}

// ---------------------------------------------------------------------------
// Positions et soldes
// ---------------------------------------------------------------------------

function add(c: Components, accountId: Id, amount: Cents): void {
  if (amount === 0) return;
  c.set(accountId, (c.get(accountId) ?? 0) + amount);
}

/**
 * Position d'une enveloppe au `asOf` : composantes par compte, dotations (datées du début de
 * période, comptées si ≤ `asOf`) et libérations (datées de la fin de période, comptées si
 * < `asOf`) comprises. Les composantes nulles sont omises.
 */
export function envelopeComponents(e: Envelope, idx: LedgerIndex, asOf: ISODate): Components {
  const c: Components = new Map();
  if (e.openingDate <= asOf) add(c, e.placementAccountId, e.openingBalance);
  for (const entry of entriesUpTo(e, idx, asOf)) for (const eff of entry.effects) add(c, eff.accountId, eff.amount);
  const dot = dotationAccount(e, idx);
  for (const s of envelopeTimeline(e, idx, asOf)) {
    if (s.period.start <= asOf) add(c, dot, s.dotation);
    if (s.period.end < asOf) add(c, e.placementAccountId, -s.release);
  }
  for (const [k, v] of c) if (v === 0) c.delete(k);
  return c;
}

/** Solde d'une enveloppe = somme de ses composantes. */
export function envelopeBalance(e: Envelope, idx: LedgerIndex, asOf: ISODate): Cents {
  let s = 0;
  for (const v of envelopeComponents(e, idx, asOf).values()) s += v;
  return s;
}

/** Écarts de placement (D20) : composantes hors du compte de placement. Positif = à déplacer vers le placement. */
export function placementGaps(e: Envelope, idx: LedgerIndex, asOf: ISODate): ComponentEffect[] {
  const out: ComponentEffect[] = [];
  for (const [accountId, amount] of envelopeComponents(e, idx, asOf)) {
    if (accountId === e.placementAccountId) continue;
    out.push({ accountId, amount });
  }
  return out;
}

/** Dépensé sur une enveloppe pendant une période (effets négatifs, en positif). */
export function spentInPeriod(e: Envelope, idx: LedgerIndex, period: Period): Cents {
  return entriesUpTo(e, idx, period.end).reduce((s, { operation, effect }) => {
    if (operation.date < period.start || operation.date > period.end) return s;
    return effect < 0 ? s - effect : s;
  }, 0);
}

/** Solde bancaire reconstruit d'un compte réel (pivot, accueil). */
export function accountBalance(a: Account, ledger: Ledger, asOf: ISODate): Cents {
  return alive(ledger.operations)
    .filter((o) => o.accountId === a.id && o.date > a.openingDate && o.date <= asOf)
    .reduce((s, o) => s + o.amount, a.openingBalance);
}

/** Composantes portées par un compte, toutes enveloppes confondues. */
export function componentsOnAccount(a: Account, idx: LedgerIndex, asOf: ISODate): Cents {
  let s = 0;
  for (const e of idx.envelopesById.values()) s += envelopeComponents(e, idx, asOf).get(a.id) ?? 0;
  return s;
}

/** Non affecté d'un compte = solde bancaire − composantes qu'il porte (second invariant de D19). */
export function unallocated(a: Account, ledger: Ledger, idx: LedgerIndex, asOf: ISODate): Cents {
  return accountBalance(a, ledger, asOf) - componentsOnAccount(a, idx, asOf);
}

/** Part d'une opération non couverte par ses lignes de ventilation (dans le signe de l'opération). */
export function unallocatedAmount(op: Operation, idx: LedgerIndex): Cents {
  const allocs = idx.allocationsByOperation.get(op.id) ?? [];
  return op.amount - allocs.reduce((s, a) => s + allocationAmount(a), 0);
}

/**
 * Solde à régler avec un compte tiers (D04) : ce que le pivot lui doit (positif) ou ce qu'il
 * doit au pivot (négatif).
 *
 * - Opération saisie sur le tiers : le pivot lui doit le montant (une dépense de 80 € → +80 ;
 *   un revenu reçu là de 100 € → −100), sauf la part ventilée sur une enveloppe placée sur ce
 *   tiers (l'argent y est déjà, ou doit y être).
 * - Virement d'un autre compte vers le tiers : règle la dette (−200 sortant du pivot → −200),
 *   sauf la part qui alimente une enveloppe placée sur le tiers (dotation, pas règlement).
 * Les virements sont enregistrés côté pivot ; une saisie du même virement côté tiers est ignorée.
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
    const placedHere = (idx.allocationsByOperation.get(op.id) ?? []).reduce((s, al) => {
      const env = al.envelopeId ? idx.envelopesById.get(al.envelopeId) : undefined;
      return env && env.placementAccountId === third.id ? s + allocationAmount(al) : s;
    }, 0);
    const outside = op.amount - placedHere;
    owes += isOnThird ? -outside : outside;
  }
  return owes;
}
