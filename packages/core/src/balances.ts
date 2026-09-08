/**
 * Soldes reconstruits : jamais stockés, toujours recalculés.
 *
 * Une tirelire a une position par compte (D19) : ses **composantes**. Elles viennent
 *  - du solde initial, réputé sur le compte de placement à la date d'ouverture ;
 *  - des lignes de ventilation : une dépense ou un revenu pèse sur le compte de l'opération,
 *    un virement interne déplace une composante d'un compte vers l'autre sans changer le solde ;
 *  - des **dotations** calculées (D29) : au début de chaque période, chaque besoin reçoit ce
 *    qu'il demande, sur le compte principal (ou sur le compte de placement sans principal) ;
 *  - des **libérations** calculées (D05, D29) : en fin de période, l'excédent au-delà de la
 *    réserve des besoins non récurrents retourne au non affecté du compte de placement.
 *
 * Deux invariants : la somme des composantes d'une tirelire fait son solde ; pour un compte,
 * la somme des composantes qu'il porte plus son non affecté fait son solde bancaire.
 */
import type { Account, Allocation, Cents, Tirelire, Id, ISODate, Ledger, Need, Operation } from './model.js';
import { alive } from './model.js';
import { nextOccurrence, payPeriodContaining, periodsUntil, nextPeriod, type Period } from './periods.js';
import { divideCents } from './money.js';
import { addDays } from './dates.js';

/** Position d'une tirelire : compte → composante (centimes signés). */
export type Components = Map<Id, Cents>;

export interface ComponentEffect {
  accountId: Id;
  amount: Cents;
}

export interface TirelireEntry {
  operation: Operation;
  allocation: Allocation;
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
  /** Solde de la tirelire au début de la période, avant dotation. */
  balanceBefore: Cents;
  needs: NeedSnapshot[];
  /** Somme des dotations de la période. */
  dotation: Cents;
  /** Libération en fin de période (positif = rendu au non affecté ; négatif = remise à zéro d'un déficit). */
  release: Cents;
}

export interface LedgerIndex {
  accountsById: Map<Id, Account>;
  tirelliresById_TMP: Map<Id, Tirelire>;
  needsByTirelire: Map<Id, Need[]>;
  operationsById: Map<Id, Operation>;
  allocationsByOperation: Map<Id, Allocation[]>;
  /** Écritures vivantes par tirelire, effets déjà calculés, triées par date. */
  entriesByTirelire: Map<Id, TirelireEntry[]>;
  principal: Account | undefined;
  payDay: number;
  /** Mémo des chronologies par tirelire (dotations et libérations), étendues à la demande. */
  timelines: Map<Id, PeriodSnapshot[]>;
  /** Montant résolu de chaque ligne de ventilation (D27), part variable comprise. */
  amountsByAllocation: Map<Id, Cents>;
}

export function indexLedger(ledger: Ledger): LedgerIndex {
  const accountsById = new Map(alive(ledger.accounts).map((a) => [a.id, a]));
  const tirelliresById_TMP = new Map(alive(ledger.tirelires).map((e) => [e.id, e]));
  const needsByTirelire = new Map<Id, Need[]>();
  for (const n of alive(ledger.needs)) {
    if (!tirelliresById_TMP.has(n.tirelireId)) continue;
    const arr = needsByTirelire.get(n.tirelireId);
    if (arr) arr.push(n);
    else needsByTirelire.set(n.tirelireId, [n]);
  }
  for (const arr of needsByTirelire.values()) arr.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const operationsById = new Map(alive(ledger.operations).map((o) => [o.id, o]));
  const allocationsByOperation = new Map<Id, Allocation[]>();
  for (const al of alive(ledger.allocations)) {
    if (!operationsById.has(al.operationId)) continue;
    const arr = allocationsByOperation.get(al.operationId);
    if (arr) arr.push(al);
    else allocationsByOperation.set(al.operationId, [al]);
  }
  const principal = [...accountsById.values()].find((a) => a.kind === 'principal');
  const idx: LedgerIndex = {
    accountsById,
    tirelliresById_TMP,
    needsByTirelire,
    operationsById,
    allocationsByOperation,
    entriesByTirelire: new Map(),
    principal,
    payDay: principal?.payDay ?? 1,
    timelines: new Map(),
    amountsByAllocation: new Map(),
  };
  for (const [opId, allocs] of allocationsByOperation) {
    const op = operationsById.get(opId)!;
    for (const [id, amount] of resolveShares(op, allocs)) idx.amountsByAllocation.set(id, amount);
  }
  for (const [opId, allocs] of allocationsByOperation) {
    const op = operationsById.get(opId)!;
    for (const al of allocs) {
      const env = al.tirelireId ? tirelliresById_TMP.get(al.tirelireId) : undefined;
      if (!env) continue;
      const effects = allocationEffects(op, al, idx);
      const entry: TirelireEntry = { operation: op, allocation: al, effects, effect: effects.reduce((s, x) => s + x.amount, 0) };
      const arr = idx.entriesByTirelire.get(env.id);
      if (arr) arr.push(entry);
      else idx.entriesByTirelire.set(env.id, [entry]);
    }
  }
  for (const arr of idx.entriesByTirelire.values()) arr.sort((a, b) => (a.operation.date < b.operation.date ? -1 : a.operation.date > b.operation.date ? 1 : 0));
  return idx;
}

/**
 * Montants résolus des lignes d'une opération (D27) : une part fixe vaut son montant, une part
 * en pourcentage se calcule sur le montant de l'opération, et la part variable prend le reste,
 * bornée à zéro — jamais de signe opposé à l'opération. Les lignes sont résolues dans l'ordre
 * reçu, ce qui rend le calcul déterministe et rejouable à montant inconnu d'avance.
 */
export function resolveShares(op: Operation, allocations: Allocation[]): Map<Id, Cents> {
  const out = new Map<Id, Cents>();
  const sign = op.amount < 0 ? -1 : 1;
  let used = 0;
  let variable: Allocation | undefined;
  for (const al of allocations) {
    if (al.share.kind === 'variable') {
      // Une seule ligne variable (D27) : les suivantes ne prennent rien.
      if (variable) out.set(al.id, 0);
      else variable = al;
      continue;
    }
    const amount = al.share.kind === 'fixed' ? al.share.amount : Math.round((op.amount * al.share.pct) / 100);
    out.set(al.id, amount);
    used += amount;
  }
  if (variable) {
    const rest = op.amount - used;
    out.set(variable.id, sign * rest > 0 ? rest : 0);
  }
  return out;
}

/** Reste non couvert par les lignes fixes et en pourcentage, borné à zéro (part variable, D27). */
export function variableRest(op: Operation, allocations: Allocation[]): Cents {
  const sign = op.amount < 0 ? -1 : 1;
  const used = allocations.reduce((s, al) => {
    if (al.share.kind === 'fixed') return s + al.share.amount;
    if (al.share.kind === 'percent') return s + Math.round((op.amount * al.share.pct) / 100);
    return s;
  }, 0);
  const rest = op.amount - used;
  return sign * rest > 0 ? rest : 0;
}

/** Montant résolu d'une ligne de ventilation, dans le signe de l'opération (D27). */
export function allocationAmount(al: Allocation, idx?: LedgerIndex): Cents {
  const memo = idx?.amountsByAllocation.get(al.id);
  if (memo !== undefined) return memo;
  if (al.share.kind === 'fixed') return al.share.amount;
  return 0;
}

/**
 * Effets par compte d'une ligne de ventilation (D19).
 *  - dépense ou revenu : `amount` sur le compte de l'opération ;
 *  - virement interne : `amount` sur le compte de départ et `−amount` sur le compte d'arrivée,
 *    sauf si l'autre côté du virement est importé et ventilé sur la même tirelire (il porte
 *    alors lui-même sa composante).
 */
export function allocationEffects(op: Operation, al: Allocation, idx: LedgerIndex): ComponentEffect[] {
  const amount = allocationAmount(al, idx);
  const own: ComponentEffect = { accountId: op.accountId, amount };
  if (!op.transferAccountId) return [own];
  if (op.transferOperationId) {
    const twin = idx.operationsById.get(op.transferOperationId);
    const twinAllocs = twin ? (idx.allocationsByOperation.get(twin.id) ?? []) : [];
    if (twin && twinAllocs.some((a) => a.tirelireId === al.tirelireId)) return [own];
  }
  return [own, { accountId: op.transferAccountId, amount: -amount }];
}

/** Effet net d'une ligne sur le solde de son tirelire (0 pour un virement interne). */
export function allocationEffect(op: Operation, al: Allocation, idx: LedgerIndex): Cents {
  return allocationEffects(op, al, idx).reduce((s, x) => s + x.amount, 0);
}

function entriesUpTo(e: Tirelire, idx: LedgerIndex, asOf: ISODate): TirelireEntry[] {
  return (idx.entriesByTirelire.get(e.id) ?? []).filter(({ operation }) => operation.date <= asOf && operation.date >= e.openingDate);
}

function entriesEffect(e: Tirelire, idx: LedgerIndex, from: ISODate, to: ISODate): Cents {
  return (idx.entriesByTirelire.get(e.id) ?? []).reduce(
    (s, x) => (x.operation.date >= from && x.operation.date <= to && x.operation.date >= e.openingDate ? s + x.effect : s),
    0,
  );
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
 * pour la période `p`. Un déficit pèse sur le premier besoin récurrent si la tirelire reporte,
 * sinon sur le premier besoin.
 */
export function needSnapshots(e: Tirelire, needs: Need[], balance: Cents, p: Period, payDay: number): NeedSnapshot[] {
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

/** Instantané de la période contenant `asOf` (undefined si la tirelire n'est pas encore ouverte). */
export function periodSnapshot(e: Tirelire, idx: LedgerIndex, asOf: ISODate): PeriodSnapshot | undefined {
  const p = payPeriodContaining(asOf, idx.payDay);
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
 * Position voulue d'une tirelire (D38) : le placement, résolu sur son solde du moment. Les parts
 * fixes et les pourcentages d'abord, la part « reste » ensuite. Sans placement déclaré, la
 * position voulue est la position réelle : l'argent est bien là où il est.
 */
export function wantedComponents(e: Tirelire, idx: LedgerIndex, asOf: ISODate): Components {
  const real = tirelireComponents(e, idx, asOf);
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
 * Écarts de placement (D20, D38) : par compte, ce qui s'y trouve de trop (positif) ou y manque
 * (négatif) au regard du placement voulu.
 */
export function placementGaps(e: Tirelire, idx: LedgerIndex, asOf: ISODate): ComponentEffect[] {
  const real = tirelireComponents(e, idx, asOf);
  const wanted = wantedComponents(e, idx, asOf);
  const out: ComponentEffect[] = [];
  for (const accountId of new Set([...real.keys(), ...wanted.keys()])) {
    const amount = (real.get(accountId) ?? 0) - (wanted.get(accountId) ?? 0);
    if (amount !== 0) out.push({ accountId, amount });
  }
  return out;
}

/** Dépensé sur une tirelire pendant une période (effets négatifs, en positif). */
export function spentInPeriod(e: Tirelire, idx: LedgerIndex, period: Period): Cents {
  return entriesUpTo(e, idx, period.end).reduce((s, { operation, effect }) => {
    if (operation.date < period.start || operation.date > period.end) return s;
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
  for (const e of idx.tirelliresById_TMP.values()) s += tirelireComponents(e, idx, asOf).get(a.id) ?? 0;
  return s;
}

/** Non affecté d'un compte = solde bancaire − composantes qu'il porte (second invariant de D19). */
export function unallocated(a: Account, ledger: Ledger, idx: LedgerIndex, asOf: ISODate): Cents {
  return accountBalance(a, ledger, asOf) - componentsOnAccount(a, idx, asOf);
}

/** Part d'une opération non couverte par ses lignes de ventilation (dans le signe de l'opération). */
export function unallocatedAmount(op: Operation, idx: LedgerIndex): Cents {
  const allocs = idx.allocationsByOperation.get(op.id) ?? [];
  return op.amount - allocs.reduce((s, a) => s + allocationAmount(a, idx), 0);
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
    const placedHere = (idx.allocationsByOperation.get(op.id) ?? []).reduce((s, al) => {
      const env = al.tirelireId ? idx.tirelliresById_TMP.get(al.tirelireId) : undefined;
      return env && homeAccount(env) === third.id ? s + allocationAmount(al, idx) : s;
    }, 0);
    const outside = op.amount - placedHere;
    owes += isOnThird ? -outside : outside;
  }
  return owes;
}
