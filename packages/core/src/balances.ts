/**
 * Soldes reconstruits : jamais stockés, toujours recalculés à partir des
 * soldes initiaux, des opérations et de leurs lignes de ventilation.
 */
import type { Account, Allocation, Cents, Envelope, Id, ISODate, Ledger, Operation } from './model.js';
import { alive } from './model.js';
import { payPeriodContaining, periodsUntil, type Period } from './periods.js';
import { divideCents } from './money.js';

export interface EnvelopeEntry {
  operation: Operation;
  allocation: Allocation;
  /** Effet signé sur l'enveloppe. */
  effect: Cents;
}

export interface LedgerIndex {
  accountsById: Map<Id, Account>;
  envelopesById: Map<Id, Envelope>;
  operationsById: Map<Id, Operation>;
  allocationsByOperation: Map<Id, Allocation[]>;
  /** Écritures vivantes par enveloppe, effet déjà calculé. */
  entriesByEnvelope: Map<Id, EnvelopeEntry[]>;
  pivot: Account | undefined;
}

export function indexLedger(ledger: Ledger): LedgerIndex {
  const accountsById = new Map(alive(ledger.accounts).map((a) => [a.id, a]));
  const envelopesById = new Map(alive(ledger.envelopes).map((e) => [e.id, e]));
  const operationsById = new Map(alive(ledger.operations).map((o) => [o.id, o]));
  const allocationsByOperation = new Map<Id, Allocation[]>();
  for (const al of alive(ledger.allocations)) {
    if (!operationsById.has(al.operationId)) continue;
    const arr = allocationsByOperation.get(al.operationId);
    if (arr) arr.push(al);
    else allocationsByOperation.set(al.operationId, [al]);
  }
  const idx: LedgerIndex = {
    accountsById,
    envelopesById,
    operationsById,
    allocationsByOperation,
    entriesByEnvelope: new Map(),
    pivot: [...accountsById.values()].find((a) => a.kind === 'pivot'),
  };
  for (const [opId, allocs] of allocationsByOperation) {
    const op = operationsById.get(opId)!;
    for (const al of allocs) {
      const env = al.envelopeId ? envelopesById.get(al.envelopeId) : undefined;
      if (!env) continue;
      const effect = allocationEffect(op, al, env, idx);
      const arr = idx.entriesByEnvelope.get(env.id);
      const entry = { operation: op, allocation: al, effect };
      if (arr) arr.push(entry);
      else idx.entriesByEnvelope.set(env.id, [entry]);
    }
  }
  return idx;
}

/**
 * Effet signé d'une ligne de ventilation sur son enveloppe (voir `Allocation`).
 * Quand les deux côtés d'un virement sont importés et ventilés sur la même
 * enveloppe, seul le côté du compte hôte compte (à défaut, le premier par identifiant).
 */
export function allocationEffect(op: Operation, al: Allocation, e: Envelope, idx: LedgerIndex): Cents {
  if (!op.transferAccountId) return al.amount;
  const onHost = op.accountId === e.accountId;
  if (op.transferOperationId) {
    const twin = idx.operationsById.get(op.transferOperationId);
    const twinAllocs = twin ? (idx.allocationsByOperation.get(twin.id) ?? []) : [];
    if (twin && twinAllocs.some((a) => a.envelopeId === e.id)) {
      const twinOnHost = twin.accountId === e.accountId;
      if (twinOnHost && !onHost) return 0;
      if (twinOnHost === onHost && twin.id < op.id) return 0;
    }
  }
  return onHost ? al.amount : -al.amount;
}

/** Montant d'un budget par période de paie (un budget annuel est lissé sur 12). */
export function budgetPerPeriod(e: Envelope): Cents {
  if (e.kind !== 'budget' || e.target === undefined) return 0;
  const n = e.periodicity?.intervalMonths ?? 1;
  return divideCents(e.target, n);
}

/** Un budget hébergé sur le pivot est financé « virtuellement » : pas de virement, l'argent y est déjà. */
export function isVirtuallyFunded(e: Envelope, idx: LedgerIndex): boolean {
  return e.kind === 'budget' && idx.pivot !== undefined && e.accountId === idx.pivot.id;
}

function entriesUpTo(e: Envelope, idx: LedgerIndex, asOf: ISODate): EnvelopeEntry[] {
  return (idx.entriesByEnvelope.get(e.id) ?? []).filter(
    ({ operation }) => operation.date <= asOf && operation.date >= e.openingDate,
  );
}

/**
 * Solde d'une enveloppe au `asOf`.
 *
 * - provision, goal, budget hébergé hors pivot : solde initial + effets jusqu'à `asOf`.
 * - budget sur le pivot sans report : montant de la période − dépensé dans la période courante.
 * - budget sur le pivot avec report : solde initial + une dotation par période écoulée + effets.
 */
export function envelopeBalance(e: Envelope, idx: LedgerIndex, asOf: ISODate): Cents {
  const entries = entriesUpTo(e, idx, asOf);
  const sum = entries.reduce((s, x) => s + x.effect, 0);
  if (!isVirtuallyFunded(e, idx)) return e.openingBalance + sum;

  const payDay = idx.pivot?.payDay ?? 1;
  const period = payPeriodContaining(asOf, payDay);
  const perPeriod = budgetPerPeriod(e);
  const rollover = e.rollover ?? { mode: 'none' };
  if (rollover.mode === 'none') return perPeriod - spentIn(entries, period);

  const opening = payPeriodContaining(e.openingDate, payDay);
  let periods = periodsUntil(opening, asOf, payDay);
  if (rollover.mode === 'capped') periods = Math.min(periods, rollover.months);
  return e.openingBalance + perPeriod * periods + sum;
}

function spentIn(entries: EnvelopeEntry[], period: Period): Cents {
  return entries.reduce((s, { operation, effect }) => {
    if (operation.date < period.start || operation.date > period.end) return s;
    return effect < 0 ? s - effect : s;
  }, 0);
}

/** Dépensé sur une enveloppe pendant une période (effets négatifs, en positif). */
export function spentInPeriod(e: Envelope, idx: LedgerIndex, period: Period): Cents {
  return spentIn(entriesUpTo(e, idx, period.end), period);
}

/** Solde bancaire reconstruit d'un compte réel (pivot, accueil). */
export function accountBalance(a: Account, ledger: Ledger, asOf: ISODate): Cents {
  return alive(ledger.operations)
    .filter((o) => o.accountId === a.id && o.date > a.openingDate && o.date <= asOf)
    .reduce((s, o) => s + o.amount, a.openingBalance);
}

/** Non affecté d'un compte = solde bancaire − somme des enveloppes hébergées. */
export function unallocated(a: Account, ledger: Ledger, idx: LedgerIndex, asOf: ISODate): Cents {
  const hosted = [...idx.envelopesById.values()].filter((e) => e.accountId === a.id);
  const reserved = hosted.reduce((s, e) => s + envelopeBalance(e, idx, asOf), 0);
  return accountBalance(a, ledger, asOf) - reserved;
}

/** Part d'une opération non couverte par ses lignes de ventilation (dans le signe de l'opération). */
export function unallocatedAmount(op: Operation, idx: LedgerIndex): Cents {
  const allocs = idx.allocationsByOperation.get(op.id) ?? [];
  return op.amount - allocs.reduce((s, a) => s + a.amount, 0);
}

/**
 * Solde à régler avec un compte tiers : ce que le pivot lui doit (positif) ou
 * ce qu'il doit au pivot (négatif).
 *
 * - Opération saisie sur le tiers : le pivot lui doit le montant (une dépense
 *   de 80 € → +80 ; un revenu du plan reçu là de 100 € → −100), sauf la part
 *   ventilée sur une enveloppe hébergée sur ce même tiers (l'argent y est déjà).
 * - Virement d'un autre compte vers le tiers (`transferAccountId`) : règle la
 *   dette (−200 sortant du pivot → −200), sauf la part qui alimente une enveloppe
 *   hébergée sur le tiers (c'est une dotation, pas un règlement).
 * Les virements sont enregistrés côté pivot ; une saisie du même virement
 * côté tiers est ignorée pour ne pas compter deux fois.
 */
export function settlementBalance(third: Account, ledger: Ledger, idx: LedgerIndex, asOf: ISODate): Cents {
  let owes = 0;
  for (const op of idx.operationsById.values()) {
    if (op.date > asOf) continue;
    const isOnThird = op.accountId === third.id;
    const isTransferToThird = op.transferAccountId === third.id;
    if (!isOnThird && !isTransferToThird) continue;
    if (isOnThird && op.transferAccountId) continue;
    const hostedHere = (idx.allocationsByOperation.get(op.id) ?? []).reduce((s, al) => {
      const env = al.envelopeId ? idx.envelopesById.get(al.envelopeId) : undefined;
      return env && env.accountId === third.id ? s + al.amount : s;
    }, 0);
    const outside = op.amount - hostedHere;
    owes += isOnThird ? -outside : outside;
  }
  return owes;
}
