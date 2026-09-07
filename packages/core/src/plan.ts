/**
 * Plan de période : à partir des revenus, charges fixes, besoins et positions des enveloppes,
 * dire ce que la période dote (D29), ce que les revenus couvrent (D06, lecture), et quels
 * virements ramènent chaque enveloppe à son placement voulu (D20, D21).
 */
import type { Account, Cents, Id, ISODate, Ledger, NeedKind, PlannedFlow } from './model.js';
import { alive, needName } from './model.js';
import {
  envelopeBalance,
  envelopeComponents,
  indexLedger,
  needCruise,
  periodSnapshot,
  settlementBalance,
  unallocated,
  type LedgerIndex,
} from './balances.js';
import { occurrencesBetween, payPeriodContaining, previousPeriod, type Period } from './periods.js';
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

/** Une ligne par besoin (D28). */
export interface PlanLine {
  needId: Id;
  envelopeId: Id;
  envelopeName: string;
  name: string;
  kind: NeedKind;
  /** Compte de placement de l'enveloppe. */
  accountId: Id;
  priority: number;
  /** Solde de l'enveloppe au début de la période, avant dotation. */
  balance: Cents;
  /** Part de ce solde attribuée à ce besoin. */
  held: Cents;
  /** Mensualité de croisière (régime permanent). */
  cruise: Cents;
  /** Mensualité de rattrapage (ce qu'exige l'échéance ou le déficit). */
  catchUp: Cents;
  /** Dotation de la période : max(croisière, rattrapage), 0 si l'objectif est atteint. */
  requested: Cents;
  /** Plancher en cas de marge négative. */
  floor: Cents;
  /** Ce que les revenus de la période couvrent (lecture D06 ; la dotation est acquise). */
  funded: Cents;
  dueDate?: ISODate;
  target?: Cents;
  /** Enveloppe placée sur le pivot : la dotation y reste, aucun virement. */
  virtual: boolean;
  status: LineStatus;
}

/** Écart de placement d'une enveloppe (D20) : ce qui dort ailleurs qu'au placement voulu. */
export interface PlacementGap {
  envelopeId: Id;
  envelopeName: string;
  /** Compte où la composante se trouve. */
  fromAccountId: Id;
  /** Compte de placement voulu. */
  toAccountId: Id;
  /** Positif = à virer de `from` vers `to` ; négatif = l'inverse. */
  amount: Cents;
  /** `todo` : au-dessus du seuil `settings.transferThreshold` ; `watch` : petit écart, à surveiller. */
  status: 'todo' | 'watch';
}

/** Ligne d'un virement par compte : part de l'écart qui concerne une enveloppe. */
export interface StandingOrder {
  envelopeId: Id;
  envelopeName: string;
  /** Part permanente (jusqu'à la croisière des besoins de l'enveloppe). */
  standing: Cents;
  /** Complément exceptionnel ce mois-ci (rattrapage, écart ancien). */
  exceptional: Cents;
  /** Montant total signé : positif = pivot → compte. */
  amount: Cents;
  status: 'todo' | 'watch';
}

export interface PlanTransfer {
  accountId: Id;
  accountName: string;
  accountKind: Account['kind'];
  /** Libellé suggéré pour le virement permanent (D21 : un par couple de comptes). */
  label: string;
  /** Détail par enveloppe. */
  orders: StandingOrder[];
  /** Somme des parts permanentes. */
  standing: Cents;
  /** Somme des compléments exceptionnels. */
  exceptional: Cents;
  /** Compte tiers : règlement de la dette. Positif = pivot → tiers, négatif = tiers → pivot. */
  settlement: Cents;
  /** Compte d'accueil : argent du compte qui n'appartient à aucune enveloppe. Positif = à rapatrier vers le pivot. */
  surplus: Cents;
  /** Total net à virer ce mois-ci depuis le pivot (négatif = vers le pivot). */
  net: Cents;
}

export interface PlanWarning {
  code: 'noPivot' | 'negativeMargin' | 'belowCushion' | 'unfunded' | 'reduced' | 'settlementBlocked' | 'noIncome' | 'pivotOverdrawn';
  message: string;
  envelopeId?: Id;
  needId?: Id;
  accountId?: Id;
}

export interface Plan {
  period: Period;
  asOf: ISODate;
  incomes: PlanFlowLine[];
  fixedCharges: PlanFlowLine[];
  lines: PlanLine[];
  /** Écarts de placement, y compris entre deux comptes hors pivot. */
  gaps: PlacementGap[];
  transfers: PlanTransfer[];
  totals: {
    incomes: Cents;
    fixedCharges: Cents;
    /** Somme des dotations de la période. */
    requested: Cents;
    /** Part des dotations couverte par revenus − charges fixes (lecture D06). */
    funded: Cents;
    /** revenus − charges fixes − financé. */
    margin: Cents;
    cushion: Cents;
    /** Non affecté du pivot à la date de calcul, dotations comprises. */
    pivotUnallocated: Cents;
  };
  warnings: PlanWarning[];
}

const KIND_ORDER: Record<NeedKind, number> = { dueDate: 0, recurring: 1, goal: 2 };

/**
 * Calcule le plan de la période contenant `asOf`, avec les positions à `asOf`.
 */
export function computePlan(ledger: Ledger, asOf: ISODate): Plan {
  const idx = indexLedger(ledger);
  const warnings: PlanWarning[] = [];
  const pivot = idx.pivot;
  const payDay = idx.payDay;
  const period = payPeriodContaining(asOf, payDay);
  if (!pivot) warnings.push({ code: 'noPivot', message: 'Aucun compte pivot défini.' });

  const flows = alive(ledger.plannedFlows).filter((f) => isActive(f, period));
  const incomes = flowLines(flows.filter((f) => f.kind === 'income'), period);
  const fixedCharges = flowLines(flows.filter((f) => f.kind === 'fixedCharge'), period);
  const totalIncomes = incomes.reduce((s, l) => s + l.amount, 0);
  const totalFixed = -fixedCharges.reduce((s, l) => s + l.amount, 0);
  if (totalIncomes <= 0) warnings.push({ code: 'noIncome', message: 'Aucun revenu prévu sur la période.' });

  // Une ligne par besoin, d'après l'instantané de la période (dotations D29).
  const lines: PlanLine[] = [];
  for (const e of idx.envelopesById.values()) {
    const snap = periodSnapshot(e, idx, asOf);
    if (!snap) continue;
    const needs = idx.needsByEnvelope.get(e.id) ?? [];
    for (const s of snap.needs) {
      const n = needs.find((x) => x.id === s.needId)!;
      lines.push({
        needId: n.id,
        envelopeId: e.id,
        envelopeName: e.name,
        name: needName(n, e),
        kind: n.kind,
        accountId: e.placementAccountId,
        priority: n.priority,
        balance: snap.balanceBefore,
        held: s.held,
        cruise: s.cruise,
        catchUp: s.catchUp,
        requested: s.requested,
        floor: s.floor,
        funded: 0,
        ...(s.dueDate ? { dueDate: s.dueDate } : {}),
        ...(s.target !== undefined ? { target: s.target } : {}),
        virtual: pivot !== undefined && e.placementAccountId === pivot.id,
        status: 'ok',
      });
    }
  }
  lines.sort(
    (a, b) => a.priority - b.priority || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'fr'),
  );

  // Lecture D06 : ce que les revenus couvrent, planchers d'abord, puis le reste par priorité.
  fundByPriority(lines, totalIncomes - totalFixed);
  for (const l of lines) {
    if (l.requested === 0) l.status = 'ahead';
    else if (l.funded === 0) l.status = 'unfunded';
    else if (l.funded < l.requested) l.status = 'reduced';
    else if (l.catchUp > l.cruise) l.status = 'catchUp';
    else if (l.catchUp < l.cruise && l.kind === 'dueDate') l.status = 'ahead';
    else l.status = 'ok';
    if (l.status === 'unfunded')
      warnings.push({ code: 'unfunded', message: `« ${l.name} » n'est pas couverte par les revenus ce mois-ci.`, envelopeId: l.envelopeId, needId: l.needId });
    else if (l.status === 'reduced')
      warnings.push({ code: 'reduced', message: `« ${l.name} » n'est couverte qu'en partie par les revenus.`, envelopeId: l.envelopeId, needId: l.needId });
  }

  const totalRequested = lines.reduce((s, l) => s + l.requested, 0);
  const totalFunded = lines.reduce((s, l) => s + l.funded, 0);
  const margin = totalIncomes - totalFixed - totalFunded;
  const cushion = ledger.settings.pivotCushion;
  if (totalIncomes - totalFixed - totalRequested < 0)
    warnings.push({
      code: 'negativeMargin',
      message: 'Les revenus ne couvrent pas toutes les dotations ; des lignes sont signalées selon leur priorité.',
    });
  else if (margin < cushion)
    warnings.push({ code: 'belowCushion', message: 'La marge est inférieure au coussin minimum du pivot.' });

  // Écarts de placement (D20), tous comptes, sauf les tiers (le règlement les couvre).
  const threshold = ledger.settings.transferThreshold ?? 0;
  const gaps: PlacementGap[] = [];
  for (const e of idx.envelopesById.values()) {
    for (const [accountId, amount] of envelopeComponents(e, idx, asOf)) {
      if (accountId === e.placementAccountId) continue;
      // Une composante qui dort sur un tiers relève du règlement (D04), pas d'un écart.
      const acc = idx.accountsById.get(accountId);
      if (acc?.kind === 'third') continue;
      const status: PlacementGap['status'] = Math.abs(amount) >= threshold ? 'todo' : 'watch';
      gaps.push({ envelopeId: e.id, envelopeName: e.name, fromAccountId: accountId, toAccountId: e.placementAccountId, amount, status });
    }
  }

  // Virements par compte (vue pivot ↔ compte), règlements des tiers, surplus des comptes d'accueil.
  const transfers: PlanTransfer[] = [];
  for (const a of idx.accountsById.values()) {
    if (pivot && a.id === pivot.id) continue;
    const orders: StandingOrder[] = [];
    for (const e of idx.envelopesById.values()) {
      const gapsHere = gaps.filter(
        (g) =>
          g.envelopeId === e.id &&
          ((g.toAccountId === a.id && (!pivot || g.fromAccountId === pivot.id)) || (g.fromAccountId === a.id && (!pivot || g.toAccountId === pivot.id))),
      );
      if (gapsHere.length === 0) continue;
      // Positif = pivot → compte.
      const amount = gapsHere.reduce((s, g) => s + (g.toAccountId === a.id ? g.amount : -g.amount), 0);
      if (amount === 0) continue;
      const cruise = (idx.needsByEnvelope.get(e.id) ?? []).reduce((s, n) => s + needCruise(n), 0);
      const standing = amount > 0 ? Math.min(amount, cruise) : 0;
      orders.push({
        envelopeId: e.id,
        envelopeName: e.name,
        standing,
        exceptional: amount - standing,
        amount,
        status: gapsHere.some((g) => g.status === 'todo') ? 'todo' : 'watch',
      });
    }
    orders.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount));
    const standing = orders.reduce((s, o) => s + o.standing, 0);
    const exceptional = orders.reduce((s, o) => s + o.exceptional, 0);
    let settlement = 0;
    let surplus = 0;
    if (a.kind === 'third') {
      const owes = settlementBalance(a, ledger, idx, asOf);
      const thr = a.settlementThreshold ?? 0;
      const dir = a.settlementDirection ?? 'both';
      if (Math.abs(owes) > thr) {
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
      surplus = unallocated(a, ledger, idx, asOf);
    }
    const net = standing + exceptional + settlement - surplus;
    if (orders.length === 0 && settlement === 0 && surplus === 0) continue;
    transfers.push({
      accountId: a.id,
      accountName: a.name,
      accountKind: a.kind,
      label: transferLabel(a.name),
      orders,
      standing,
      exceptional,
      settlement,
      surplus,
      net,
    });
  }
  transfers.sort((x, y) => Math.abs(y.net) - Math.abs(x.net));

  const pivotUnallocated = pivot ? unallocated(pivot, ledger, idx, asOf) : 0;
  if (pivot && pivotUnallocated < 0)
    warnings.push({
      code: 'pivotOverdrawn',
      message: 'Les dotations dépassent ce que le pivot contient : le non affecté est négatif.',
      accountId: pivot.id,
    });

  return {
    period,
    asOf,
    incomes,
    fixedCharges,
    lines,
    gaps,
    transfers,
    totals: {
      incomes: totalIncomes,
      fixedCharges: totalFixed,
      requested: totalRequested,
      funded: totalFunded,
      margin,
      cushion,
      pivotUnallocated,
    },
    warnings,
  };
}

/**
 * Ordre de financement de D06 : les planchers par priorité, puis le demandé par priorité,
 * jusqu'à épuisement de `available`. Écrit `funded` sur chaque ligne ; rend le reste.
 * Sert aussi à répartir un virement constaté entre enveloppes (D21).
 */
export function fundByPriority<T extends { floor: Cents; requested: Cents; funded: Cents }>(lines: T[], available: Cents): Cents {
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
  return available;
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

/** Fenêtre de périodes autour de `asOf`, utile pour naviguer dans l'interface. */
export function periodsAround(ledger: Ledger, asOf: ISODate, before: number, after: number): Period[] {
  const pivot = alive(ledger.accounts).find((a) => a.kind === 'pivot');
  const payDay = pivot?.payDay ?? 1;
  const out: Period[] = [];
  let p = payPeriodContaining(asOf, payDay);
  for (let i = 0; i < before; i++) p = previousPeriod(p, payDay);
  for (let i = 0; i < before + 1 + after; i++) {
    out.push(p);
    p = payPeriodContaining(addDays(p.end, 1), payDay);
  }
  return out;
}

/** Libellé de virement (D21 : un par compte cible) : majuscules sans accents, tronqué à ce que les banques acceptent. */
export function transferLabel(accountName: string): string {
  const base = accountName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `TIRELIRE ${base}`.slice(0, 35);
}

/** Solde d'une enveloppe et sa position, pour l'interface. */
export function envelopePosition(ledger: Ledger, envelopeId: Id, asOf: ISODate): { balance: Cents; components: Array<{ accountId: Id; amount: Cents }> } | undefined {
  const idx = indexLedger(ledger);
  const e = idx.envelopesById.get(envelopeId);
  if (!e) return undefined;
  return {
    balance: envelopeBalance(e, idx, asOf),
    components: [...envelopeComponents(e, idx, asOf)].map(([accountId, amount]) => ({ accountId, amount })),
  };
}

export type { LedgerIndex };
