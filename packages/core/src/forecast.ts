/**
 * Solde prévu des comptes et des tirelires (D52, D88, #296).
 *
 * Le solde prévu d'un compte ou d'une tirelire à une date est son solde réel à la date de lecture,
 * plus les opérations saisies à une date future et les opérations prévues qui comptent jusqu'à
 * cette date ; les dotations d'une tirelire (D29) y comptent comme des opérations prévues sur elle.
 *
 * Un seul calcul (principe 13) : les opérations prévues des flux s'ajoutent, en mémoire, aux
 * opérations du grand livre, et les soldes se lisent avec les fonctions de toujours
 * (`accountBalance`, `tirelireComponents`). Rien ne s'enregistre (I10) : le grand livre reçu n'est
 * pas modifié, et ce qui est rendu se recalcule à chaque lecture.
 *
 * Ce qui compte, occurrence par occurrence d'un flux enregistré (virements permanents compris) :
 * - une occurrence reprise par une opération (`Operation.plannedFlowId`, D12) ne compte plus :
 *   l'opération qui la reprend compte à sa place ;
 * - sur un compte suivi (il porte une opération importée), une occurrence dont la fenêtre est
 *   passée sans reprise ne compte plus, et se signale « attendue, non reçue » ;
 * - sur un compte sans suivi (U1), rien ne se confronte : chaque occurrence compte à sa date, depuis
 *   l'ouverture du compte.
 * Un virement que le plan propose sans qu'il soit enregistré n'a pas de flux : il ne compte pas.
 */
import type { Account, Allocation, Cents, Id, ISODate, Ledger, Operation, PlannedFlow, Tirelire } from './model.js';
import { alive } from './model.js';
import { accountBalance, indexLedger, tirelireComponents, tirelireTimeline, type LedgerIndex } from './balances.js';
import type { Period } from './periods.js';
import { addDays } from './dates.js';
import { distributeTransfer, flowOccurrences, tracksOperations } from './matching.js';

/** D'où vient un mouvement du solde prévu. */
export type ForecastOrigin = 'flux' | 'dotation' | 'liberation' | 'saisie' | 'releve' | 'ouverture';

export interface ForecastMovement {
  date: ISODate;
  label: string;
  /** Effet sur ce compte ou cette tirelire, signé. */
  amount: Cents;
  origin: ForecastOrigin;
  /** Le flux qui produit l'opération prévue (`origin` = `flux`). */
  flowId?: Id;
  /** L'opération enregistrée (`saisie`, `releve`). */
  operationId?: Id;
}

/** Le point le plus bas d'un solde prévu dans la période, quand il est négatif (D88). */
export interface Shortfall {
  date: ISODate;
  amount: Cents;
}

export interface ForecastBalance {
  id: Id;
  name: string;
  /** Solde à la date de lecture, sans les opérations prévues. */
  start: Cents;
  /** Solde prévu à la fin de la période : `start` plus la somme des mouvements. */
  end: Cents;
  /** Ce qui fait passer de `start` à `end`, par date. */
  movements: ForecastMovement[];
  shortfall?: Shortfall;
}

export interface ForecastAccount extends ForecastBalance {
  kind: Account['kind'];
  /** Suivi des opérations : le compte porte une opération importée. */
  tracked: boolean;
  /** Composantes prévues des tirelires que le compte héberge, à la fin de la période (I2). */
  hosted: Array<{ tirelireId: Id; amount: Cents }>;
  /** Non affecté prévu : `end` moins les composantes hébergées (I2). */
  unallocated: Cents;
  /** Opérations prévues dont la fenêtre est passée sans reprise : elles ne comptent plus (D12). */
  notReceived: Array<{ flowId: Id; label: string; date: ISODate; windowEnd: ISODate; amount: Cents }>;
}

export interface Forecast {
  period: Period;
  /** Date de lecture : jusqu'où les soldes sont connus. */
  today: ISODate;
  accounts: ForecastAccount[];
  tirelires: ForecastBalance[];
}

/** Préfixe des identifiants des opérations prévues : elles se désignent par leur flux et leur date (D88). */
const PREVUE = 'prevue:';

/** Identifiant d'une opération prévue, d'après son flux et sa date. */
export function plannedOperationId(flowId: Id, date: ISODate): Id {
  return `${PREVUE}${flowId}:${date}`;
}

export function isPlannedOperation(op: Operation): boolean {
  return op.id.startsWith(PREVUE);
}

/**
 * Les opérations prévues qui comptent jusqu'à `until`, ajoutées en mémoire au grand livre, et les
 * occurrences attendues non reçues. Le grand livre reçu n'est pas modifié.
 */
export function withPlannedOperations(
  ledger: Ledger,
  today: ISODate,
  until: ISODate,
): { ledger: Ledger; notReceived: Array<{ flow: PlannedFlow; date: ISODate; windowEnd: ISODate }> } {
  const accounts = new Map(alive(ledger.accounts).map((a) => [a.id, a]));
  const tirelires = new Set(alive(ledger.tirelires).map((e) => e.id));
  const tracked = new Map<Id, boolean>();
  const isTracked = (id: Id) => {
    let t = tracked.get(id);
    if (t === undefined) tracked.set(id, (t = tracksOperations(ledger, id)));
    return t;
  };

  const operations: Operation[] = [];
  const allocations: Allocation[] = [];
  const transfers: Array<{ flow: PlannedFlow; date: ISODate }> = [];
  const notReceived: Array<{ flow: PlannedFlow; date: ISODate; windowEnd: ISODate }> = [];

  for (const flow of alive(ledger.plannedFlows)) {
    const account = accounts.get(flow.accountId);
    if (!account) continue;
    // Comme le solde du compte (`accountBalance`), une opération compte après la date d'ouverture.
    for (const o of flowOccurrences(ledger, flow, addDays(account.openingDate, 1), until, today)) {
      if (o.status === 'pointee') continue;
      if (o.status === 'nonRecue' && isTracked(flow.accountId)) {
        notReceived.push({ flow, date: o.date, windowEnd: o.windowEnd });
        continue;
      }
      if (flow.kind === 'transfer' && flow.counterpartAccountId && accounts.has(flow.counterpartAccountId)) {
        transfers.push({ flow, date: o.date });
        continue;
      }
      const op = plannedOperation(flow, o.date);
      operations.push(op);
      if (flow.kind === 'dueDate' && flow.tirelireId && tirelires.has(flow.tirelireId))
        allocations.push({
          id: `${op.id}:tirelire`,
          operationId: op.id,
          tirelireId: flow.tirelireId,
          ...(flow.categoryId ? { categoryId: flow.categoryId } : {}),
          share: { kind: 'fixed', amount: flow.amount },
        });
    }
  }

  let out: Ledger = { ...ledger, operations: [...ledger.operations, ...operations], allocations: [...ledger.allocations, ...allocations] };

  /*
   * Un virement prévu sort d'un compte et entre sur l'autre : deux opérations appariées, comme
   * l'import les apparie (`pairInternalTransfers`). Sa ventilation sur les tirelires est celle de
   * l'import, par l'ordre de financement au jour de l'opération (D21, D60) : elle se calcule dans
   * l'ordre des dates, sur ce que les virements précédents ont déjà placé.
   */
  transfers.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const { flow, date } of transfers) {
    const sortie = plannedOperation(flow, date);
    const entree: Operation = {
      ...sortie,
      id: `${sortie.id}:contrepartie`,
      accountId: flow.counterpartAccountId!,
      amount: -flow.amount,
      transferAccountId: flow.accountId,
      transferOperationId: sortie.id,
    };
    sortie.transferAccountId = flow.counterpartAccountId!;
    sortie.transferOperationId = entree.id;
    const parts =
      flow.amount < 0
        ? distributeTransfer(out, flow.counterpartAccountId!, flow.amount, date)
        : [];
    out = {
      ...out,
      operations: [...out.operations, sortie, entree],
      allocations: [
        ...out.allocations,
        ...parts.map((p, i) => ({
          id: `${sortie.id}:part-${i}`,
          operationId: sortie.id,
          tirelireId: p.tirelireId,
          ...(flow.categoryId ? { categoryId: flow.categoryId } : {}),
          share: { kind: 'fixed' as const, amount: -p.amount },
        })),
      ],
    };
  }
  return { ledger: out, notReceived };
}

function plannedOperation(flow: PlannedFlow, date: ISODate): Operation {
  return {
    id: plannedOperationId(flow.id, date),
    accountId: flow.accountId,
    origin: 'manual',
    date,
    label: flow.name,
    normalizedLabel: '',
    amount: flow.amount,
    state: 'reconciled',
    plannedFlowId: flow.id,
  };
}

/**
 * Le solde prévu de chaque compte réel et de chaque tirelire à la fin de `period`, lu à la date
 * `today` : ce qui le fait, mouvement par mouvement, et le manque au point le plus bas.
 */
export function computeForecast(ledger: Ledger, period: Period, today: ISODate): Forecast {
  const end = period.end;
  const { ledger: prevu, notReceived } = withPlannedOperations(ledger, today, end);
  const idx = indexLedger(prevu);
  /** Un mouvement compte s'il est daté après la date de lecture, ou s'il est une opération prévue. */
  const compte = (op: Operation) => op.date <= end && (op.date > today || isPlannedOperation(op));

  const tirelires: ForecastBalance[] = [];
  const components = new Map<Id, Map<Id, Cents>>();
  for (const e of idx.tireliresById.values()) {
    if (e.openingDate > end) continue;
    const comps = tirelireComponents(e, idx, end);
    components.set(e.id, comps);
    const movements = tirelireMovements(e, idx, today, end, compte);
    const total = [...comps.values()].reduce((s, v) => s + v, 0);
    tirelires.push(balance(e.id, e.name, total, movements, period));
  }

  const accounts: ForecastAccount[] = [];
  for (const a of idx.accountsById.values()) {
    if (a.activeTo && a.activeTo < period.start) continue;
    if (a.activeFrom && a.activeFrom > end) continue;
    const movements: ForecastMovement[] = [];
    for (const op of idx.operationsById.values()) {
      if (op.accountId !== a.id || op.date <= a.openingDate || !compte(op)) continue;
      movements.push(movementOf(op));
    }
    const total = accountBalance(a, prevu, end);
    const hosted: ForecastAccount['hosted'] = [];
    for (const [tirelireId, comps] of components) {
      const amount = comps.get(a.id) ?? 0;
      if (amount !== 0) hosted.push({ tirelireId, amount });
    }
    const sumHosted = hosted.reduce((s, h) => s + h.amount, 0);
    accounts.push({
      ...balance(a.id, a.name, total, movements, period),
      kind: a.kind,
      tracked: tracksOperations(ledger, a.id),
      hosted,
      unallocated: total - sumHosted,
      notReceived: notReceived
        .filter((n) => n.flow.accountId === a.id)
        .map((n) => ({ flowId: n.flow.id, label: n.flow.name, date: n.date, windowEnd: n.windowEnd, amount: n.flow.amount })),
    });
  }
  return { period, today, accounts, tirelires };
}

function movementOf(op: Operation, amount: Cents = op.amount): ForecastMovement {
  if (isPlannedOperation(op)) return { date: op.date, label: op.label, amount, origin: 'flux', ...(op.plannedFlowId ? { flowId: op.plannedFlowId } : {}) };
  return { date: op.date, label: op.label, amount, origin: op.origin === 'imported' ? 'releve' : 'saisie', operationId: op.id };
}

/**
 * Ce qui fait passer le solde d'une tirelire de la date de lecture à `end` : les écritures qui
 * comptent, les dotations des périodes qui commencent après la date de lecture, les libérations
 * des périodes qui finissent avant `end` (mêmes bornes que `tirelireComponents`).
 */
function tirelireMovements(e: Tirelire, idx: LedgerIndex, today: ISODate, end: ISODate, compte: (op: Operation) => boolean): ForecastMovement[] {
  const out: ForecastMovement[] = [];
  if (e.openingDate > today && e.openingDate <= end && e.openingBalance !== 0)
    out.push({ date: e.openingDate, label: 'Solde initial', amount: e.openingBalance, origin: 'ouverture' });
  for (const entry of idx.entriesByTirelire.get(e.id) ?? []) {
    if (entry.operation.date < e.openingDate || !compte(entry.operation) || entry.effect === 0) continue;
    out.push(movementOf(entry.operation, entry.effect));
  }
  for (const s of tirelireTimeline(e, idx, end)) {
    if (s.period.start > today && s.period.start <= end && s.dotation !== 0)
      out.push({ date: s.period.start, label: `Dotation (${s.period.label})`, amount: s.dotation, origin: 'dotation' });
    if (s.period.end >= today && s.period.end < end && s.release !== 0)
      out.push({ date: s.period.end, label: `Libération du reliquat (${s.period.label})`, amount: -s.release, origin: 'liberation' });
  }
  return out;
}

/** Trie les mouvements, en déduit le solde de départ et le manque au point le plus bas de la période. */
function balance(id: Id, name: string, end: Cents, movements: ForecastMovement[], period: Period): ForecastBalance {
  movements.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const start = end - movements.reduce((s, m) => s + m.amount, 0);
  // Solde à la fin de chaque jour de la période où il bouge, et à son premier jour.
  let solde = start;
  let i = 0;
  for (; i < movements.length && movements[i]!.date < period.start; i++) solde += movements[i]!.amount;
  let low: Shortfall = { date: period.start, amount: solde };
  for (; i < movements.length; ) {
    const date = movements[i]!.date;
    for (; i < movements.length && movements[i]!.date === date; i++) solde += movements[i]!.amount;
    if (date === period.start) low = { date, amount: solde };
    else if (solde < low.amount) low = { date, amount: solde };
  }
  return { id, name, start, end, movements, ...(low.amount < 0 ? { shortfall: low } : {}) };
}

