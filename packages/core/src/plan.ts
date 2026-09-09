/**
 * Plan de période : à partir des revenus, charges fixes, besoins et positions des tirelires,
 * dire ce que la période dote (D29), ce que les revenus couvrent (D06, lecture), et quels
 * virements ramènent chaque tirelire à son placement voulu (D20, D21).
 */
import type { Account, Cents, Id, ISODate, Ledger, NeedKind, PlannedFlow } from './model.js';
import { alive, isDerivedFlow, needActive, needName } from './model.js';
import { formatCents } from './money.js';
import {
  homeAccount,
  placementGaps,
  dotationAccount,
  tirelireBalance,
  tirelireComponents,
  indexLedger,
  needCruise,
  periodSnapshot,
  settlementBalance,
  unallocated,
  type LedgerIndex,
} from './balances.js';
import { occurrencesBetween, budgetPeriodContaining, previousPeriod, type Period } from './periods.js';
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
  tirelireId: Id;
  tirelireName: string;
  name: string;
  kind: NeedKind;
  /** Compte de placement de la tirelire. */
  accountId: Id;
  priority: number;
  /** Solde de la tirelire au début de la période, avant dotation. */
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
  /** Tirelire placée sur le compte principal : la dotation y reste, aucun virement. */
  virtual: boolean;
  status: LineStatus;
}

/** Écart de placement d'une tirelire (D20) : ce qui dort ailleurs qu'au placement voulu. */
export interface PlacementGap {
  tirelireId: Id;
  tirelireName: string;
  /** Compte où la composante se trouve. */
  fromAccountId: Id;
  /** Compte de placement voulu. */
  toAccountId: Id;
  /** Positif = à virer de `from` vers `to` ; négatif = l'inverse. */
  amount: Cents;
  /** `todo` : au-dessus du seuil `settings.transferThreshold` ; `watch` : petit écart, à surveiller. */
  status: 'todo' | 'watch';
}

/** Ligne d'un virement par compte : part de l'écart qui concerne une tirelire. */
export interface StandingOrder {
  tirelireId: Id;
  tirelireName: string;
  /** Part permanente (jusqu'à la croisière des besoins de la tirelire). */
  standing: Cents;
  /** Complément exceptionnel ce mois-ci (rattrapage, écart ancien). */
  exceptional: Cents;
  /** Montant total signé : positif = principal → compte. */
  amount: Cents;
  status: 'todo' | 'watch';
}

export interface PlanTransfer {
  accountId: Id;
  accountName: string;
  accountKind: Account['kind'];
  /** Libellé suggéré pour le virement permanent (D21 : un par couple de comptes). */
  label: string;
  /** Détail par tirelire. */
  orders: StandingOrder[];
  /** Somme des parts permanentes. */
  standing: Cents;
  /** Somme des compléments exceptionnels. */
  exceptional: Cents;
  /** Compte tiers : règlement de la dette. Positif = principal → tiers, négatif = tiers → principal. */
  settlement: Cents;
  /** Compte d'accueil : argent du compte qui n'appartient à aucune tirelire. Positif = à rapatrier vers le compte principal. */
  surplus: Cents;
  /** Total net à virer ce mois-ci depuis le compte principal (négatif = vers le compte principal). */
  net: Cents;
  /**
   * Ordre permanent enregistré chez la banque (D58), s'il l'a été : le **fait**, en regard de
   * `standing` qui est le **calcul**. `drift` vaut ce que le budget demande moins ce que l'ordre
   * exécute ; non nul, l'ordre est à modifier chez la banque, puis à confirmer ici — l'application
   * ne peut ni le connaître ni le changer toute seule.
   */
  bankOrder?: { flowId: Id; amount: Cents; drift: Cents };
}

export interface PlanWarning {
  code: 'noPrincipal' | 'negativeMargin' | 'belowCushion' | 'unfunded' | 'reduced' | 'settlementBlocked' | 'noIncome' | 'principalOverdrawn'
    | 'payoutShort' | 'bankOrderDrift';
  message: string;
  tirelireId?: Id;
  needId?: Id;
  accountId?: Id;
}

export interface Plan {
  period: Period;
  asOf: ISODate;
  /** Date jusqu'à laquelle les soldes bancaires sont connus (D52). */
  today: ISODate;
  /** Vrai quand la période affichée commence après `today` : les positions sont simulées (D52). */
  simulated: boolean;
  incomes: PlanFlowLine[];
  fixedCharges: PlanFlowLine[];
  lines: PlanLine[];
  /** Écarts de placement, y compris entre deux comptes hors principal. */
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
    /** Non affecté du compte principal à la date de calcul, dotations comprises. */
    principalUnallocated: Cents;
  };
  warnings: PlanWarning[];
}

const KIND_ORDER: Record<NeedKind, number> = { payout: -1, dueDate: 0, recurring: 1, goal: 2 };

/**
 * Calcule le plan de la période contenant `asOf`, avec les positions à `asOf`.
 *
 * `today` est la date jusqu'à laquelle les soldes bancaires sont connus (D52) ; par défaut `asOf`,
 * c'est-à-dire « tout est connu jusqu'à la date de calcul ». En regardant une période à venir,
 * l'interface passe la date du jour : au-delà, le plan cesse de lire le réel et suppose exécutés
 * les virements qu'il a proposés pour les périodes précédentes, sans quoi il redemanderait à
 * chaque période tout ce qu'il a déjà demandé aux précédentes.
 */
export function computePlan(ledger: Ledger, asOf: ISODate, today: ISODate = asOf): Plan {
  const idx = indexLedger(ledger);
  const warnings: PlanWarning[] = [];
  const principal = idx.principal;
  const startDay = idx.startDay;
  const period = budgetPeriodContaining(asOf, startDay);
  const simulated = period.start > today;
  // Au-delà d'aujourd'hui, aucun relevé ne dit ce que les comptes portent : ce qui se lit sur le
  // réel (non affecté, soldes à régler) se lit à la dernière date connue, pas à une date inventée.
  const known = simulated ? today : asOf;
  if (!principal) warnings.push({ code: 'noPrincipal', message: 'Aucun compte principal défini.' });

  const flows = alive(ledger.plannedFlows).filter((f) => isActive(f, period));
  const incomes = flowLines(flows.filter((f) => f.kind === 'income'), period);
  const fixedCharges = flowLines(flows.filter((f) => f.kind === 'fixedCharge'), period);
  const totalIncomes = incomes.reduce((s, l) => s + l.amount, 0);
  const totalFixed = -fixedCharges.reduce((s, l) => s + l.amount, 0);
  if (totalIncomes <= 0) warnings.push({ code: 'noIncome', message: 'Aucun revenu prévu sur la période.' });

  // Une ligne par besoin, d'après l'instantané de la période (dotations D29).
  const lines: PlanLine[] = [];
  for (const e of idx.tireliresById.values()) {
    const snap = periodSnapshot(e, idx, asOf);
    if (!snap) continue;
    const needs = idx.needsByTirelire.get(e.id) ?? [];
    for (const s of snap.needs) {
      const n = needs.find((x) => x.id === s.needId)!;
      lines.push({
        needId: n.id,
        tirelireId: e.id,
        tirelireName: e.name,
        name: needName(n, e),
        kind: n.kind,
        accountId: homeAccount(e) ?? dotationAccount(e, idx),
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
        virtual: principal !== undefined && homeAccount(e) === principal.id,
        status: 'ok',
      });
    }
  }
  lines.sort(
    (a, b) => a.priority - b.priority || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'fr'),
  );

  /*
   * Les versements (D48) ne se disputent pas les revenus : ils en apportent. Une tirelire de
   * saison verse ce qu'elle porte, ce qui augmente d'autant ce que les autres besoins peuvent se
   * partager. `fundByPriority` écrête à zéro et ne saurait pas traiter une demande négative.
   */
  const payouts = lines.filter((l) => l.kind === 'payout');
  for (const l of payouts) l.funded = l.requested;
  const apport = -payouts.reduce((s, l) => s + l.requested, 0);
  fundByPriority(
    lines.filter((l) => l.kind !== 'payout'),
    totalIncomes - totalFixed + apport,
  );
  for (const l of lines) {
    if (l.kind === 'payout') {
      // Le versement est « réduit » quand la tirelire n'a plus de quoi tenir le rythme annoncé.
      l.status = -l.requested < l.cruise ? 'reduced' : 'ok';
      if (l.status === 'reduced')
        warnings.push({
          code: 'payoutShort',
          message: `« ${l.name} » ne verse plus le montant prévu : la réserve s'épuise.`,
          tirelireId: l.tirelireId,
          needId: l.needId,
        });
      continue;
    }
    if (l.requested === 0) l.status = 'ahead';
    else if (l.funded === 0) l.status = 'unfunded';
    else if (l.funded < l.requested) l.status = 'reduced';
    else if (l.catchUp > l.cruise) l.status = 'catchUp';
    else if (l.catchUp < l.cruise && l.kind === 'dueDate') l.status = 'ahead';
    else l.status = 'ok';
    if (l.status === 'unfunded')
      warnings.push({ code: 'unfunded', message: `« ${l.name} » n'est pas couverte par les revenus ce mois-ci.`, tirelireId: l.tirelireId, needId: l.needId });
    else if (l.status === 'reduced')
      warnings.push({ code: 'reduced', message: `« ${l.name} » n'est couverte qu'en partie par les revenus.`, tirelireId: l.tirelireId, needId: l.needId });
  }

  const totalRequested = lines.reduce((s, l) => s + l.requested, 0);
  const totalFunded = lines.reduce((s, l) => s + l.funded, 0);
  const margin = totalIncomes - totalFixed - totalFunded;
  const cushion = ledger.settings.principalCushion;
  if (totalIncomes - totalFixed - totalRequested < 0)
    warnings.push({
      code: 'negativeMargin',
      message: 'Les revenus ne couvrent pas toutes les dotations ; des lignes sont signalées selon leur priorité.',
    });
  else if (margin < cushion)
    warnings.push({ code: 'belowCushion', message: 'La marge est inférieure au coussin minimum du compte principal.' });

  // Écarts de placement (D20), tous comptes, sauf les tiers (le règlement les couvre).
  const threshold = ledger.settings.transferThreshold ?? 0;
  const gaps: PlacementGap[] = [];
  for (const e of idx.tireliresById.values()) {
    // Un excédent sur un compte doit rejoindre un compte où il manque (D38) : on apparie les deux.
    const excess = placementGaps(e, idx, asOf, today).filter((g) => !idx.accountsById.get(g.accountId)?.tracksSettlement);
    const surplus = excess.filter((g) => g.amount > 0).sort((a, b) => b.amount - a.amount);
    const missing = excess.filter((g) => g.amount < 0).sort((a, b) => a.amount - b.amount);
    let mi = 0;
    for (const from of surplus) {
      let left = from.amount;
      while (left > 0 && mi < missing.length) {
        const to = missing[mi]!;
        const amount = Math.min(left, -to.amount);
        const status: PlacementGap['status'] = amount >= threshold ? 'todo' : 'watch';
        gaps.push({ tirelireId: e.id, tirelireName: e.name, fromAccountId: from.accountId, toAccountId: to.accountId, amount, status });
        left -= amount;
        to.amount += amount;
        if (to.amount === 0) mi++;
      }
    }
  }

  // Virements par compte (vue principal ↔ compte), règlements des tiers, surplus des comptes d'accueil.
  const transfers: PlanTransfer[] = [];
  for (const a of idx.accountsById.values()) {
    if (principal && a.id === principal.id) continue;
    const orders: StandingOrder[] = [];
    for (const e of idx.tireliresById.values()) {
      const gapsHere = gaps.filter(
        (g) =>
          g.tirelireId === e.id &&
          ((g.toAccountId === a.id && (!principal || g.fromAccountId === principal.id)) || (g.fromAccountId === a.id && (!principal || g.toAccountId === principal.id))),
      );
      if (gapsHere.length === 0) continue;
      // Positif = principal → compte.
      const amount = gapsHere.reduce((s, g) => s + (g.toAccountId === a.id ? g.amount : -g.amount), 0);
      if (amount === 0) continue;
      const cruise = (idx.needsByTirelire.get(e.id) ?? []).filter((n) => needActive(n, asOf)).reduce((s, n) => s + needCruise(n), 0);
      const standing = amount > 0 ? Math.min(amount, cruise) : 0;
      orders.push({
        tirelireId: e.id,
        tirelireName: e.name,
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
    if (a.tracksSettlement) {
      const owes = settlementBalance(a, ledger, idx, known);
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
    } else if (a.kind === 'epargne') {
      surplus = unallocated(a, ledger, idx, known);
    }
    /*
     * Ce que le budget demande vient d'être calculé ; ce que la banque exécute, lui, ne se devine
     * pas (D58). Les deux se comparent ici, et l'écart se dit — c'est le seul endroit du plan qui
     * demande un geste hors de l'application.
     */
    const flux = standingOrderFlow(flows, a.id);
    const bankOrder = flux ? { flowId: flux.id, amount: Math.abs(flux.amount), drift: standing - Math.abs(flux.amount) } : undefined;
    // L'ordre arrondi au-dessus du budget couvre ce qu'on lui demande : rien à corriger. On ne
    // signale que l'ordre trop court, ou celui qui vire nettement plus que ce qui est demandé.
    if (bankOrder && (bankOrder.drift > 0 || bankOrder.drift < -ORDER_STEP))
      warnings.push({
        code: 'bankOrderDrift',
        message:
          standing === 0
            ? `L'ordre permanent de ${formatCents(bankOrder.amount)} vers « ${a.name} » n'est plus demandé par le budget : à supprimer chez la banque, puis ici.`
            : `L'ordre permanent vers « ${a.name} » est à ${formatCents(bankOrder.amount)}, le budget en demande ${formatCents(standing)} : à modifier chez la banque, puis à confirmer ici.`,
        accountId: a.id,
      });
    const net = standing + exceptional + settlement - surplus;
    if (orders.length === 0 && settlement === 0 && surplus === 0 && !bankOrder) continue;
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
      ...(bankOrder ? { bankOrder } : {}),
    });
  }
  transfers.sort((x, y) => Math.abs(y.net) - Math.abs(x.net));

  const principalUnallocated = principal ? unallocated(principal, ledger, idx, known) : 0;
  if (principal && principalUnallocated < 0 && !simulated)
    warnings.push({
      code: 'principalOverdrawn',
      message: 'Les dotations dépassent ce que le compte principal contient : le non affecté est négatif.',
      accountId: principal.id,
    });

  return {
    period,
    asOf,
    today: known,
    simulated,
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
      principalUnallocated,
    },
    warnings,
  };
}

/**
 * Ordre de financement de D06 : les planchers par priorité, puis le demandé par priorité,
 * jusqu'à épuisement de `available`. Écrit `funded` sur chaque ligne ; rend le reste.
 * Sert aussi à répartir un virement constaté entre tirelires (D21).
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

/**
 * Pas d'un ordre permanent : on pose chez sa banque un montant rond, jamais 683,50 €. Il sert à
 * deux choses — proposer le montant à confirmer, et servir de zone morte au signalement : un ordre
 * arrondi au-dessus de ce que le budget demande n'est pas un ordre à corriger.
 */
export const ORDER_STEP: Cents = 1000;

/** Le montant d'ordre proposé pour couvrir `cents` : la dizaine d'euros au-dessus. */
export function roundOrderUp(cents: Cents): Cents {
  return Math.ceil(cents / ORDER_STEP) * ORDER_STEP;
}

/** L'ordre permanent enregistré vers un compte (D57) : un flux dérivé, un seul par compte. */
export function standingOrderFlow(flows: PlannedFlow[], accountId: Id): PlannedFlow | undefined {
  return alive(flows).find((f) => f.kind === 'transfer' && isDerivedFlow(f) && f.counterpartAccountId === accountId);
}

/**
 * Flux **dérivé** du virement permanent vers un compte (D21, D57, D58) : un seul par couple de
 * comptes, mensuel. Ce qu'il enregistre est un fait — le montant que l'ordre exécute chez la
 * banque, son libellé, sa tolérance — pour que la ligne soit reconnue à l'import. Sa ventilation,
 * elle, ne s'écrit nulle part : elle se rejoue par l'ordre de financement au jour de l'opération.
 *
 * `amount` vaut par défaut la part permanente que demande le budget — le cas de celui qui vient de
 * poser l'ordre chez sa banque. Le complément exceptionnel du mois n'en fait jamais partie : il
 * n'a pas vocation à devenir un ordre permanent.
 */
export function standingTransferFlow(plan: Plan, transfer: PlanTransfer, principalId: Id, id: Id, amount: Cents = transfer.standing): PlannedFlow | undefined {
  if (amount <= 0) return undefined;
  return {
    id,
    name: `Virement ${transfer.accountName}`,
    kind: 'transfer',
    origin: 'derived',
    amount: -amount,
    accountId: principalId,
    counterpartAccountId: transfer.accountId,
    periodicity: { interval: 1, unit: 'month' as const, anchorDate: plan.period.start },
    dateWindowDays: 5,
    labelPattern: transfer.label,
    amountTolerance: { pct: 20 },
  };
}

/** Fenêtre de périodes autour de `asOf`, utile pour naviguer dans l'interface. */
export function periodsAround(ledger: Ledger, asOf: ISODate, before: number, after: number): Period[] {
  const principal = alive(ledger.accounts).find((a) => a.kind === 'principal');
  const startDay = ledger.settings.periodStartDay;
  const out: Period[] = [];
  let p = budgetPeriodContaining(asOf, startDay);
  for (let i = 0; i < before; i++) p = previousPeriod(p, startDay);
  for (let i = 0; i < before + 1 + after; i++) {
    out.push(p);
    p = budgetPeriodContaining(addDays(p.end, 1), startDay);
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

/** Solde d'une tirelire et sa position, pour l'interface. */
export function tirelirePosition(ledger: Ledger, tirelireId: Id, asOf: ISODate): { balance: Cents; components: Array<{ accountId: Id; amount: Cents }> } | undefined {
  const idx = indexLedger(ledger);
  const e = idx.tireliresById.get(tirelireId);
  if (!e) return undefined;
  return {
    balance: tirelireBalance(e, idx, asOf),
    components: [...tirelireComponents(e, idx, asOf)].map(([accountId, amount]) => ({ accountId, amount })),
  };
}

export type { LedgerIndex };
