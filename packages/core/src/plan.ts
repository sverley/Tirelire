/**
 * Plan de période : à partir des revenus, charges fixes, enveloppes et soldes,
 * déduire ce qu'il faut réserver ou virer, dans quel ordre, et ce qui reste.
 */
import type { Account, Cents, Envelope, EnvelopeKind, Id, ISODate, Ledger, PlannedFlow } from './model.js';
import { alive } from './model.js';
import { budgetPerPeriod, envelopeBalance, indexLedger, isVirtuallyFunded, settlementBalance, unallocated, type LedgerIndex } from './balances.js';
import { nextOccurrence, occurrencesBetween, payPeriodContaining, periodsUntil, type Period } from './periods.js';
import { divideCents } from './money.js';
import { addDays } from './dates.js';

export interface PlanFlowLine {
  flowId: Id;
  name: string;
  accountId: Id;
  /** Dates d'occurrence dans la période (souvent une seule). */
  dates: ISODate[];
  /** Montant total sur la période, signé. */
  amount: Cents;
  variable: boolean;
}

export type LineStatus = 'ok' | 'ahead' | 'catchUp' | 'reduced' | 'unfunded';

export interface PlanLine {
  envelopeId: Id;
  name: string;
  kind: EnvelopeKind;
  accountId: Id;
  priority: number;
  /** Solde reconstruit au début de la période. */
  balance: Cents;
  /** Mensualité de croisière (régime permanent). */
  cruise: Cents;
  /** Mensualité de rattrapage (ce qu'exige l'échéance compte tenu du solde). */
  catchUp: Cents;
  /** Ce que la ligne demande : max(croisière, rattrapage), 0 si l'objectif est atteint. */
  requested: Cents;
  /** Plancher en cas de marge négative (le rattrapage d'une provision ne se discute pas). */
  floor: Cents;
  /** Ce que le plan finance effectivement. */
  funded: Cents;
  /** Prochaine échéance (provision) ou cible (goal). */
  dueDate?: ISODate;
  target?: Cents;
  /** Financé sans virement (budget hébergé sur le pivot). */
  virtual: boolean;
  status: LineStatus;
}

/** Un virement permanent par enveloppe : le libellé nomme l'enveloppe, ce qui rend le rapprochement de flux sans ambiguïté. */
export interface StandingOrder {
  envelopeId: Id;
  envelopeName: string;
  /** Libellé suggéré pour le virement (« TIRELIRE TAXE FONCIERE »). */
  label: string;
  /** Montant permanent (croisière financée). */
  standing: Cents;
  /** Complément exceptionnel ce mois-ci. */
  exceptional: Cents;
}

export interface PlanTransfer {
  accountId: Id;
  accountName: string;
  accountKind: Account['kind'];
  /** Détail par enveloppe hébergée. */
  orders: StandingOrder[];
  /** Somme des virements permanents vers ce compte. */
  standing: Cents;
  /** Somme des compléments exceptionnels ce mois-ci (rattrapages, budgets en dépassement). */
  exceptional: Cents;
  /** Compte tiers : règlement de la dette. Positif = pivot → tiers, négatif = tiers → pivot. */
  settlement: Cents;
  /** Compte d'accueil : écart entre solde bancaire et enveloppes. Positif = à rapatrier vers le pivot. */
  surplus: Cents;
  /** Total net à virer ce mois-ci depuis le pivot (négatif = vers le pivot). */
  net: Cents;
}

export interface PlanWarning {
  code:
    | 'noPivot'
    | 'negativeMargin'
    | 'belowCushion'
    | 'unfunded'
    | 'reduced'
    | 'settlementBlocked'
    | 'noIncome';
  message: string;
  envelopeId?: Id;
  accountId?: Id;
}

export interface Plan {
  period: Period;
  asOf: ISODate;
  incomes: PlanFlowLine[];
  fixedCharges: PlanFlowLine[];
  lines: PlanLine[];
  transfers: PlanTransfer[];
  totals: {
    incomes: Cents;
    fixedCharges: Cents;
    requested: Cents;
    funded: Cents;
    /** revenus − charges fixes − financé. */
    margin: Cents;
    cushion: Cents;
    /** Non affecté du pivot à la date de calcul. */
    pivotUnallocated: Cents;
  };
  warnings: PlanWarning[];
}

const KIND_ORDER: Record<EnvelopeKind, number> = { provision: 0, budget: 1, goal: 2 };

/**
 * Calcule le plan de la période contenant `asOf`, avec les soldes à `asOf`.
 */
export function computePlan(ledger: Ledger, asOf: ISODate): Plan {
  const idx = indexLedger(ledger);
  const warnings: PlanWarning[] = [];
  const pivot = idx.pivot;
  const payDay = pivot?.payDay ?? 1;
  const period = payPeriodContaining(asOf, payDay);
  if (!pivot) warnings.push({ code: 'noPivot', message: 'Aucun compte pivot défini.' });

  const flows = alive(ledger.plannedFlows).filter((f) => isActive(f, period));
  const incomes = flowLines(flows.filter((f) => f.kind === 'income'), period);
  const fixedCharges = flowLines(flows.filter((f) => f.kind === 'fixedCharge'), period);
  const totalIncomes = incomes.reduce((s, l) => s + l.amount, 0);
  const totalFixed = -fixedCharges.reduce((s, l) => s + l.amount, 0);
  if (totalIncomes <= 0) warnings.push({ code: 'noIncome', message: 'Aucun revenu prévu sur la période.' });

  // Soldes à la date de calcul : ce qui a déjà été viré ou dépensé ce mois-ci est pris en compte.
  const balanceDate = asOf;
  const lines = alive(ledger.envelopes)
    .map((e) => envelopeLine(e, idx, period, balanceDate, payDay))
    .sort(
      (a, b) =>
        a.priority - b.priority || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'fr'),
    );

  // Financement par priorité : d'abord les planchers, puis le reste.
  let available = totalIncomes - totalFixed;
  for (const l of lines) {
    const give = Math.max(0, Math.min(l.floor, available));
    l.funded = give;
    available -= give;
  }
  for (const l of lines) {
    const want = l.requested - l.funded;
    const give = Math.max(0, Math.min(want, available));
    l.funded += give;
    available -= give;
  }
  for (const l of lines) {
    if (l.requested === 0) l.status = 'ahead';
    else if (l.funded === 0) l.status = 'unfunded';
    else if (l.funded < l.requested) l.status = 'reduced';
    else if (l.catchUp > l.cruise) l.status = 'catchUp';
    else if (l.catchUp < l.cruise && l.kind === 'provision') l.status = 'ahead';
    else l.status = 'ok';
    if (l.status === 'unfunded')
      warnings.push({ code: 'unfunded', message: `« ${l.name} » n'est pas financée ce mois-ci.`, envelopeId: l.envelopeId });
    else if (l.status === 'reduced')
      warnings.push({ code: 'reduced', message: `« ${l.name} » est financée partiellement.`, envelopeId: l.envelopeId });
  }

  const totalRequested = lines.reduce((s, l) => s + l.requested, 0);
  const totalFunded = lines.reduce((s, l) => s + l.funded, 0);
  const margin = totalIncomes - totalFixed - totalFunded;
  const cushion = ledger.settings.pivotCushion;
  if (totalIncomes - totalFixed - totalRequested < 0)
    warnings.push({
      code: 'negativeMargin',
      message: 'Les revenus ne couvrent pas tout ce qui est demandé ; des lignes ont été réduites selon leur priorité.',
    });
  else if (margin < cushion)
    warnings.push({ code: 'belowCushion', message: 'La marge est inférieure au coussin minimum du pivot.' });

  // Virements par compte.
  const transfers: PlanTransfer[] = [];
  for (const a of idx.accountsById.values()) {
    if (pivot && a.id === pivot.id) continue;
    const hosted = lines.filter((l) => l.accountId === a.id && !l.virtual);
    const orders: StandingOrder[] = hosted.map((l) => ({
      envelopeId: l.envelopeId,
      envelopeName: l.name,
      label: transferLabel(l.name),
      standing: Math.min(l.funded, l.cruise),
      exceptional: Math.max(0, l.funded - l.cruise),
    }));
    const standing = orders.reduce((s, o) => s + o.standing, 0);
    const exceptional = orders.reduce((s, o) => s + o.exceptional, 0);
    let settlement = 0;
    let surplus = 0;
    if (a.kind === 'third') {
      const owes = settlementBalance(a, ledger, idx, balanceDate);
      const threshold = a.settlementThreshold ?? 0;
      const dir = a.settlementDirection ?? 'both';
      if (Math.abs(owes) > threshold) {
        if (owes > 0 && dir !== 'fromThird') settlement = owes;
        else if (owes < 0 && dir !== 'toThird') settlement = owes;
        else
          warnings.push({
            code: 'settlementBlocked',
            message: `Un règlement de ${owes} centimes avec « ${a.name} » est bloqué par le sens autorisé.`,
            accountId: a.id,
          });
      }
    } else if (a.kind === 'holding') {
      surplus = unallocated(a, ledger, idx, balanceDate);
    }
    const net = standing + exceptional + settlement - surplus;
    if (hosted.length === 0 && settlement === 0 && surplus === 0) continue;
    transfers.push({
      accountId: a.id,
      accountName: a.name,
      accountKind: a.kind,
      orders,
      standing,
      exceptional,
      settlement,
      surplus,
      net,
    });
  }
  transfers.sort((x, y) => Math.abs(y.net) - Math.abs(x.net));

  return {
    period,
    asOf,
    incomes,
    fixedCharges,
    lines,
    transfers,
    totals: {
      incomes: totalIncomes,
      fixedCharges: totalFixed,
      requested: totalRequested,
      funded: totalFunded,
      margin,
      cushion,
      pivotUnallocated: pivot ? unallocated(pivot, ledger, idx, balanceDate) : 0,
    },
    warnings,
  };
}

function isActive(f: PlannedFlow, p: Period): boolean {
  if (f.activeFrom && f.activeFrom > p.end) return false;
  if (f.activeTo && f.activeTo < p.start) return false;
  return true;
}

function flowLines(flows: PlannedFlow[], p: Period): PlanFlowLine[] {
  const out: PlanFlowLine[] = [];
  for (const f of flows) {
    const dates = occurrencesBetween(f.periodicity, p.start, p.end).filter(
      (d) => (!f.activeFrom || d >= f.activeFrom) && (!f.activeTo || d <= f.activeTo),
    );
    if (dates.length === 0) continue;
    out.push({ flowId: f.id, name: f.name, accountId: f.accountId, dates, amount: f.amount * dates.length, variable: !!f.variable });
  }
  return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

function envelopeLine(e: Envelope, idx: LedgerIndex, period: Period, balanceDate: ISODate, payDay: number): PlanLine {
  const balance = envelopeBalance(e, idx, balanceDate);
  const base = {
    envelopeId: e.id,
    name: e.name,
    kind: e.kind,
    accountId: e.accountId,
    priority: e.priority,
    balance,
    funded: 0,
    virtual: isVirtuallyFunded(e, idx),
    status: 'ok' as LineStatus,
  };
  switch (e.kind) {
    case 'provision': {
      const target = e.target ?? 0;
      const per = e.periodicity ?? { intervalMonths: 12, anchorDate: period.start };
      const dueDate = nextOccurrence(per, period.start);
      const cruise = divideCents(target, per.intervalMonths);
      const n = Math.max(1, periodsUntil(period, dueDate, payDay));
      const catchUp = Math.max(0, Math.ceil(Math.max(0, target - balance) / n));
      return { ...base, cruise, catchUp, requested: Math.max(cruise, catchUp), floor: catchUp, dueDate, target };
    }
    case 'goal': {
      const monthly = e.monthlyAmount ?? 0;
      const reached = e.target !== undefined && balance >= e.target;
      const requested = reached ? 0 : e.target !== undefined ? Math.min(monthly, e.target - balance) : monthly;
      return { ...base, cruise: monthly, catchUp: requested, requested, floor: 0, ...(e.target !== undefined ? { target: e.target } : {}) };
    }
    case 'budget': {
      const cruise = budgetPerPeriod(e);
      const rollover = e.rollover ?? { mode: 'none' };
      const deficit = rollover.mode !== 'none' && balance < 0 ? -balance : 0;
      // Un budget virtuel se « finance » à hauteur de sa dotation : c'est de la réservation, pas un virement.
      const catchUp = cruise + deficit;
      return { ...base, cruise, catchUp, requested: catchUp, floor: 0, ...(e.target !== undefined ? { target: e.target } : {}) };
    }
  }
}

/** Fenêtre de périodes autour de `asOf`, utile pour naviguer dans l'interface. */
export function periodsAround(ledger: Ledger, asOf: ISODate, before: number, after: number): Period[] {
  const pivot = alive(ledger.accounts).find((a) => a.kind === 'pivot');
  const payDay = pivot?.payDay ?? 1;
  const out: Period[] = [];
  let p = payPeriodContaining(asOf, payDay);
  for (let i = 0; i < before; i++) p = payPeriodContaining(addDays(p.start, -1), payDay);
  for (let i = 0; i < before + 1 + after; i++) {
    out.push(p);
    p = payPeriodContaining(addDays(p.end, 1), payDay);
  }
  return out;
}

/** Libellé de virement : majuscules sans accents, tronqué à ce que les banques acceptent. */
export function transferLabel(envelopeName: string): string {
  const base = envelopeName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `TIRELIRE ${base}`.slice(0, 35);
}
