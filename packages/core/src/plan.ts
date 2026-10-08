/**
 * Plan de période : à partir des revenus, charges fixes, besoins et positions des tirelires,
 * dire ce que la période dote (D29), ce que les revenus couvrent (D06, lecture), et quels
 * virements ramènent chaque tirelire à son placement voulu (D20, D21).
 *
 * Rien ne s'y lisse d'office (D88, #184) : une échéance demande sa croisière, plus la part d'un
 * lissage que l'utilisateur a décidé ; le manque qui resterait s'annonce (`dueDateShortfalls`).
 */
import type { Account, AllocationLine, Cents, Id, ISODate, Ledger, NeedKind, PlannedFlow, Tirelire } from './model.js';
import { activeAt, alive, monthsOf, needActive, needName, standingOrderTarget } from './model.js';
import { formatCents } from './money.js';
import {
  homeAccount,
  placementGaps,
  periodDemand,
  dotationAccount,
  tirelireBalance,
  tirelireComponents,
  indexLedger,
  needCruise,
  placementShares,
  periodSnapshot,
  settlementBalance,
  unallocated,
  type LedgerIndex,
} from './balances.js';
import { occurrencesBetween, budgetPeriodContaining, previousPeriod, type Period } from './periods.js';
import { addDays, addMonths } from './dates.js';
import { flowOccurrences, tracksOperations, type FlowOccurrence } from './matching.js';
import { computeForecast, withPlannedOperations, type Forecast } from './forecast.js';

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
  /**
   * Ce que le besoin demande au-delà du régime : le rattrapage d'un déficit (D29) ; pour une
   * échéance, ce qu'elle demande, lissage décidé compris (D88, #184).
   */
  catchUp: Cents;
  /**
   * Dotation de la période : pour une échéance, sa croisière plus la part d'un lissage décidé (D88) ;
   * pour un autre besoin, max(croisière, rattrapage d'un déficit), 0 si l'objectif est atteint.
   */
  requested: Cents;
  /** Plancher en cas de marge négative (D06) : ce qu'une échéance demande, lissage décidé compris. */
  floor: Cents;
  /** Part d'un lissage décidé datée dans la période (D88, #184), comprise dans `requested`. */
  smoothing: Cents;
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
  /** Complément exceptionnel ce mois-ci (rattrapage d'un déficit, lissage décidé, écart ancien). */
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
  /** Somme des parts permanentes restant à virer cette période. */
  standing: Cents;
  /**
   * Ce que le budget demande comme **ordre permanent** vers ce compte (D60) : la croisière des
   * tirelires qui y sont placées, indépendante de ce qui a déjà été viré. `standing`, lui, fond à
   * mesure que la période s'exécute — le comparer à l'ordre de la banque ferait crier « ordre
   * inutile » le lendemain du virement.
   */
  permanent: Cents;
  /**
   * De quoi cette somme est faite : une ligne par tirelire placée sur ce compte, avec sa dotation.
   * L'écran l'affiche sous « Détail » — la carte montre une somme, pas quatre lignes.
   */
  breakdown: Array<{ tirelireId: Id; tirelireName: string; cruise: Cents }>;
  /** Somme des compléments exceptionnels. */
  exceptional: Cents;
  /** Compte tiers : règlement de la dette. Positif = principal → tiers, négatif = tiers → principal. */
  settlement: Cents;
  /** Compte d'accueil : argent du compte qui n'appartient à aucune tirelire. Positif = à rapatrier vers le compte principal. */
  surplus: Cents;
  /** Total net à virer ce mois-ci depuis le compte principal (négatif = vers le compte principal). */
  net: Cents;
  /**
   * Les ordres permanents enregistrés vers ce compte (D57, D60, `standingOrderFlows`), comparés à ce
   * que le budget demande — le **fait**, en regard de `permanent` qui est le **calcul** —, dès que
   * le budget a une tirelire ; absent sinon, ou sans ordre. `amount` est la somme de leurs
   * équivalents mensuels (D47), `drift` ce que le budget demande moins cette somme. `parts` compare
   * les parts fixes de chaque tirelire à sa ligne du détail (`breakdown`). `flowId` et `since`
   * n'existent que pour un compte qui a exactement un ordre : le seul que le plan sache enregistrer.
   */
  bankOrder?: BankOrder;
  /**
   * L'ordre que le plan propose (D60, D21), quand le budget en demande un vers ce compte : le
   * multiple du pas d'arrondi au-dessus de `permanent`, et sa ventilation pour ce montant
   * (`proposedOrderAllocation`). Rien ne s'écrit sans validation (I10).
   */
  proposal?: { amount: Cents; allocation: AllocationLine[] };
  /**
   * Les occurrences des ordres enregistrés vers ce compte dans la période, chacune lue sur son flux
   * et nommée par lui (D12, #183, #393) : pointée, attendue dans sa fenêtre, ou attendue non reçue.
   * Toutes, quel que soit le nombre d'ordres : seul l'enregistrement depuis le plan est réservé au
   * compte qui en a exactement un. Absentes sans suivi des opérations (U1) : rien ne s'y pointe, le
   * plan n'y suppose ni réception ni manquement.
   */
  occurrences?: Array<FlowOccurrence & { flowId: Id; flowName: string }>;
}

/** Les ordres permanents enregistrés vers un compte, comparés à ce que le budget demande (D60, I10). */
export interface BankOrder {
  /** Les flux des ordres, dans l'ordre de leur identifiant. */
  flowIds: Id[];
  /** L'ordre, quand le compte en a exactement un. */
  flowId?: Id;
  /** Son ancrage, quand le compte a exactement un ordre. */
  since?: ISODate;
  /** La somme des équivalents mensuels des ordres (D47), au centime, en positif. */
  amount: Cents;
  /** Ce que le budget demande moins `amount`. */
  drift: Cents;
  /** L'écart du montant se signale (point 6 de #393). */
  signaled: boolean;
  /** Par tirelire qui a au moins une part fixe dans ces ordres : leur somme mensuelle, ce que le budget lui demande ici, l'écart. */
  parts: Array<{ tirelireId: Id; tirelireName: string; amount: Cents; requested: Cents; drift: Cents; signaled: boolean }>;
}

export interface PlanWarning {
  code: 'negativeMargin' | 'belowCushion' | 'unfunded' | 'reduced' | 'settlementBlocked' | 'noIncome' | 'principalOverdrawn'
    | 'payoutShort' | 'bankOrderDrift' | 'bankOrderPartDrift';
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
  /**
   * Vrai quand la période affichée commence après `today` : une période à venir (D52, #183). Le plan
   * y dit ce que chaque tirelire demande et ce qu'il faut virer pour elle, calculé sur le seul solde
   * des tirelires, et montre le solde prévu des comptes et des tirelires (`forecast`, D88) : rien n'y
   * est supposé. Le nom reste, parce que des instantanés du plan (#197, #209) le fixent.
   */
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
  /**
   * Pour une période à venir : le solde prévu de chaque compte réel et de chaque tirelire à la fin
   * de la période, avec les opérations qui le font et le manque au point le plus bas (D52, D88).
   * Absent de la période où l'on lit, qui se lit sur le réel.
   */
  forecast?: Forecast;
}

const KIND_ORDER: Record<NeedKind, number> = { payout: -1, dueDate: 0, recurring: 1, goal: 2 };

/**
 * Calcule le plan de la période contenant `asOf`, avec les positions à `asOf`.
 *
 * `today` est la date jusqu'à laquelle les soldes bancaires sont connus (D52) ; par défaut `asOf`,
 * c'est-à-dire « tout est connu jusqu'à la date de calcul ». Jusqu'à la période qui la contient, les
 * virements se lisent sur les positions réelles. Au-delà, ce qu'il faut virer vers un compte est ce
 * que les tirelires placées là demandent pour la période (`periodDemand`), et rien d'autre (#183) ;
 * le solde prévu des comptes et des tirelires s'y ajoute (`forecast`, D52, D88).
 */
export function computePlan(ledger: Ledger, asOf: ISODate, today: ISODate = asOf): Plan {
  const startDay = ledger.settings.periodStartDay;
  const period = budgetPeriodContaining(asOf, startDay);
  const upcoming = period.start > today;
  /*
   * Une période à venir se calcule sur le grand livre prévu (D88, #296, point 10) : ce que chaque
   * tirelire demande et ce que son solde prévu reçoit sont un seul calcul, prélèvements prévus de ses
   * échéances compris. La période où l'on lit se calcule sur le réel. Ce qui se lit sur le réel
   * (occurrences d'un ordre, non affecté) se lit toujours sur le grand livre reçu.
   */
  const prevu = upcoming ? withPlannedOperations(ledger, today, period.end) : undefined;
  const idx = indexLedger(prevu?.ledger ?? ledger);
  const warnings: PlanWarning[] = [];
  const principal = idx.principal;
  // Au-delà d'aujourd'hui, aucun relevé ne dit ce que les comptes portent : ce qui se lit sur le
  // réel se lit à la dernière date connue, pas à une date inventée.
  const known = upcoming ? today : asOf;

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
        smoothing: s.smoothing,
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
    const excess = (upcoming ? demandGaps(e, idx, asOf) : placementGaps(e, idx, asOf)).filter((g) => !idx.accountsById.get(g.accountId)?.tracksSettlement);
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
  /*
   * Ce que chaque tirelire demande comme **dotation permanente**, compte par compte (D60). Quatre
   * pièges, qu'un simple `needCruise` par tirelire ne verrait pas :
   *
   * - un **objectif atteint** ne demande plus rien (D06) : un ordre qui le compterait encore
   *   virerait de l'argent sans emploi ;
   * - une **échéance déjà provisionnée**, elle, continue de compter : elle sera dépensée, et
   *   l'épargne reprend juste après — on ne suspend pas un ordre permanent pour un mois ;
   * - un **besoin versant** (D48) rend de l'argent au lieu d'en réclamer ;
   * - une tirelire **placée sur deux comptes** partage sa dotation entre eux (D37) au lieu de la
   *   demander deux fois.
   *
   * Le partage se lit comme une **différence de positions voulues** — celle qu'aurait la tirelire
   * après la dotation, moins celle qu'elle vise avant — et non comme un découpage du seul flux du
   * mois : une part fixe est un plafond de position (D38). Une précaution plafonnée à 1 000 € sur
   * un livret et déjà à 3 200 € n'en réclame plus rien, sans quoi le plan demanderait d'en rapatrier
   * l'excédent tout en réglant un ordre permanent qui l'y renvoie.
   *
   * Ni le rattrapage d'un déficit ni un lissage décidé n'en font partie : ils sont exceptionnels, un
   * ordre permanent ne s'y règle pas (D60) ; le virement de la période les porte en complément
   * exceptionnel.
   */
  const wantedByAccount = new Map<Id, PlanTransfer['breakdown']>();
  for (const e of idx.tireliresById.values()) {
    const siennes = lines.filter((l) => l.tirelireId === e.id);
    const dotation = siennes.filter((l) => l.kind !== 'payout' && !(l.kind === 'goal' && l.requested === 0)).reduce((s, l) => s + l.cruise, 0);
    if (dotation <= 0) continue;
    const source = principal?.id ?? '';
    const solde = siennes[0]?.balance ?? 0;
    const avant = placementShares(e, solde, source);
    const apres = placementShares(e, solde + dotation, source);
    for (const accountId of apres.keys()) {
      const part = (apres.get(accountId) ?? 0) - (avant.get(accountId) ?? 0);
      if (part <= 0 || accountId === source) continue;
      wantedByAccount.set(accountId, [...(wantedByAccount.get(accountId) ?? []), { tirelireId: e.id, tirelireName: e.name, cruise: part }]);
    }
  }

  // Sans aucune tirelire (U5), le budget ne parle d'aucun compte : aucun ordre ne se compare (D60).
  const aDesTirelires = alive(ledger.tirelires).length > 0;
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
    // Règlements et surplus sont des positions de compte, lues sur le réel : ils appartiennent à la
    // période où l'on lit, pas à une période à venir, qui les redemanderait (#183).
    if (!upcoming && a.tracksSettlement) {
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
    } else if (!upcoming && a.kind === 'epargne') {
      surplus = unallocated(a, ledger, idx, known);
    }
    /*
     * Ce que le budget demande vient d'être calculé ; ce que la banque exécute, lui, ne se devine
     * pas (D60). Les deux se comparent ici, dès que le budget a une tirelire, et l'écart se dit
     * au-delà du pas d'arrondi, dans un sens comme dans l'autre — c'est le seul endroit du plan qui
     * demande un geste hors de l'application. Rien ne s'y réécrit (I10).
     */
    const breakdown = wantedByAccount.get(a.id) ?? [];
    const permanent = Math.max(0, breakdown.reduce((s, b) => s + b.cruise, 0));
    const ordres = principal ? standingOrderFlows(ledger.plannedFlows, principal.id, a.id, asOf) : [];
    const bankOrder = aDesTirelires && ordres.length > 0 ? compareOrders(ordres, permanent, breakdown, ledger, ledger.settings.orderRounding) : undefined;
    if (bankOrder?.signaled)
      warnings.push({
        code: 'bankOrderDrift',
        message:
          permanent === 0
            ? `L'ordre permanent de ${formatCents(bankOrder.amount)} vers « ${a.name} » n'est plus demandé par le budget : à supprimer chez votre banque, puis ici.`
            : `L'ordre permanent vers « ${a.name} » est enregistré à ${formatCents(bankOrder.amount)}, le budget en demande ${formatCents(permanent)} : à modifier chez votre banque, puis à confirmer ici.`,
        accountId: a.id,
      });
    for (const part of bankOrder?.parts ?? [])
      if (part.signaled)
        warnings.push({
          code: 'bankOrderPartDrift',
          message: `La part de « ${part.tirelireName} » dans l'ordre permanent vers « ${a.name} » est enregistrée à ${formatCents(part.amount)}, le budget lui en demande ${formatCents(part.requested)} : l'ordre est à modifier chez votre banque, puis à confirmer ici.`,
          accountId: a.id,
          tirelireId: part.tirelireId,
        });
    const montantPropose = roundOrderUp(permanent, ledger.settings.orderRounding);
    const proposal = permanent > 0 ? { amount: montantPropose, allocation: orderAllocation(breakdown, lines, montantPropose, -1) } : undefined;
    const net = standing + exceptional + settlement - surplus;
    if (orders.length === 0 && settlement === 0 && surplus === 0 && !bankOrder) continue;
    const suivis = ordres.filter((f) => tracksOperations(ledger, f.accountId));
    const occurrences = suivis.length
      ? suivis
          .flatMap((f) => flowOccurrences(ledger, f, period.start, period.end, today).map((o) => ({ ...o, flowId: f.id, flowName: f.name })))
          .sort((x, y) => x.date.localeCompare(y.date) || x.flowName.localeCompare(y.flowName, 'fr') || x.flowId.localeCompare(y.flowId))
      : undefined;
    transfers.push({
      accountId: a.id,
      accountName: a.name,
      accountKind: a.kind,
      label: transferLabel(a.name),
      orders,
      standing,
      permanent,
      breakdown,
      exceptional,
      settlement,
      surplus,
      net,
      ...(bankOrder ? { bankOrder } : {}),
      ...(proposal ? { proposal } : {}),
      ...(occurrences ? { occurrences } : {}),
    });
  }
  transfers.sort((x, y) => Math.abs(y.net) - Math.abs(x.net));

  const principalUnallocated = principal ? unallocated(principal, ledger, upcoming ? indexLedger(ledger) : idx, known) : 0;
  if (principal && principalUnallocated < 0 && !upcoming)
    warnings.push({
      code: 'principalOverdrawn',
      message: 'Les dotations dépassent ce que le compte principal contient : le non affecté est négatif.',
      accountId: principal.id,
    });

  return {
    period,
    asOf,
    today: known,
    simulated: upcoming,
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
    ...(prevu ? { forecast: computeForecast(ledger, period, today, prevu) } : {}),
  };
}

/**
 * La demande d'une période à venir, en écarts de placement (#183) : ce qui doit partir du compte de
 * dotation vers chaque compte où la tirelire est placée (positif sur le compte de dotation, négatif
 * sur le compte qui le reçoit), ou en revenir pour un besoin versant. Aucune position de compte
 * n'y entre.
 */
function demandGaps(e: Tirelire, idx: LedgerIndex, asOf: ISODate): Array<{ accountId: Id; amount: Cents }> {
  const source = dotationAccount(e, idx);
  const out: Array<{ accountId: Id; amount: Cents }> = [];
  let total = 0;
  for (const [accountId, part] of periodDemand(e, idx, asOf)) {
    if (accountId === source) continue;
    out.push({ accountId, amount: -part });
    total += part;
  }
  if (total !== 0) out.push({ accountId: source, amount: total });
  return out;
}

/**
 * Ordre de financement de D06 : les planchers par priorité, puis le demandé par priorité,
 * jusqu'à épuisement de `available`. Écrit `funded` sur chaque ligne ; rend le reste.
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
 * Le montant d'ordre permanent proposé pour couvrir `cents` : le multiple de `step` au-dessus
 * (`settings.orderRounding`, une dizaine d'euros par défaut). Un pas nul rend le montant tel quel.
 */
export function roundOrderUp(cents: Cents, step: Cents): Cents {
  if (step <= 0) return cents;
  return Math.ceil(cents / step) * step;
}

/**
 * Ancrage du flux de l'ordre permanent. Un ordre déjà enregistré garde le sien : corriger son
 * montant ne dit pas qu'il commence aujourd'hui, et le déplacer ferait perdre la reconnaissance
 * des virements déjà passés. Un ordre nouveau s'ancre sur la période en cours, jamais sur celle
 * qu'on regarde — le Plan se feuillette, et un ordre enregistré en lisant décembre vire dès ce
 * mois-ci.
 */
function standingAnchor(plan: Plan): ISODate {
  let anchor = plan.period.start;
  while (anchor > plan.today) anchor = addMonths(anchor, -1);
  return anchor;
}

/**
 * Les ordres permanents vers un compte (D57, D60) : les flux de virement vivants dont l'argent va du
 * compte principal vers ce compte — décrits sur le principal, de montant négatif, avec ce compte pour
 * contrepartie, ou décrits sur ce compte, de montant positif, avec le principal pour contrepartie —,
 * quelle que soit la façon dont ils ont été créés, et dont la validité couvre `date`, la date à
 * laquelle le plan lit sa période (D52). Triés par identifiant.
 */
export function standingOrderFlows(flows: PlannedFlow[], principalId: Id, accountId: Id, date: ISODate): PlannedFlow[] {
  return alive(flows)
    .filter((f) => activeAt(f, date) && standingOrderTarget(f, principalId) === accountId)
    .sort((x, y) => x.id.localeCompare(y.id));
}

/** L'équivalent mensuel d'un montant d'un flux (D47) : divisé par l'équivalent en mois de son rythme, au centime, en positif. */
export function monthlyEquivalent(amount: Cents, f: PlannedFlow): Cents {
  return Math.round(Math.abs(amount) / monthsOf(f.periodicity));
}

/**
 * L'écart se signale-t-il ? Au-delà du pas d'arrondi des ordres, dans un sens comme dans l'autre ;
 * un écart égal au pas ne se signale pas, un pas nul fait signaler tout écart non nul (D60, #204).
 */
function driftSignaled(drift: Cents, step: Cents): boolean {
  return Math.abs(drift) > Math.max(0, step);
}

/**
 * Les ordres d'un compte comparés à ce que le budget y demande, montant et parts fixes (D60, I10).
 * Une part nomme sa tirelire par le grand livre, celles qui ont été retirées comprises : un ordre
 * garde ses parts quand une tirelire disparaît, et le signal la nomme encore.
 */
function compareOrders(ordres: PlannedFlow[], permanent: Cents, breakdown: PlanTransfer['breakdown'], ledger: Ledger, step: Cents): BankOrder {
  const amount = ordres.reduce((s, f) => s + monthlyEquivalent(f.amount, f), 0);
  const drift = permanent - amount;
  const fixes = new Map<Id, Cents>();
  for (const f of ordres)
    for (const l of f.action?.allocation ?? [])
      if (l.tirelireId && l.share.kind === 'fixed') fixes.set(l.tirelireId, (fixes.get(l.tirelireId) ?? 0) + monthlyEquivalent(l.share.amount, f));
  const parts: BankOrder['parts'] = [...fixes].map(([tirelireId, montant]) => {
    const requested = breakdown.find((b) => b.tirelireId === tirelireId)?.cruise ?? 0;
    const d = requested - montant;
    return { tirelireId, tirelireName: ledger.tirelires.find((t) => t.id === tirelireId)?.name ?? tirelireId, amount: montant, requested, drift: d, signaled: driftSignaled(d, step) };
  });
  const seul = ordres.length === 1 ? ordres[0]! : undefined;
  return {
    flowIds: ordres.map((f) => f.id),
    ...(seul ? { flowId: seul.id, since: seul.periodicity.anchorDate } : {}),
    amount,
    drift,
    // Un ordre que le budget ne demande plus est signalé à tout montant : il continue de virer (D60).
    signaled: permanent === 0 || driftSignaled(drift, step),
    parts,
  };
}

/**
 * La ventilation d'un ordre de `amount` (positif) vers un compte, en parts du signe `sign` : une part
 * fixe, sans catégorie, par tirelire placée sur ce compte à qui le budget y demande quelque chose
 * (`breakdown`), chacune jusqu'à sa ligne du détail, dans l'ordre de financement de D06 — d'abord les
 * tirelires qui portent un besoin à échéance actif, puis les autres ; dans chaque groupe, par la
 * priorité de leur besoin le plus prioritaire, puis l'échéance la plus proche, puis le nom —, jusqu'à
 * épuiser le montant. Une tirelire qui ne reçoit rien n'a pas de part ; ce que le montant a de plus
 * que la somme demandée reste sans part, non affecté sur le compte d'accueil (D21).
 */
function orderAllocation(breakdown: PlanTransfer['breakdown'], lines: PlanLine[], amount: Cents, sign: 1 | -1): AllocationLine[] {
  const rangs = breakdown
    .filter((b) => b.cruise > 0)
    .map((b) => {
      const siennes = lines.filter((l) => l.tirelireId === b.tirelireId);
      const echeances = siennes.filter((l) => l.kind === 'dueDate');
      return {
        b,
        echeance: echeances.length > 0 ? 0 : 1,
        priority: Math.min(...siennes.map((l) => l.priority), Number.MAX_SAFE_INTEGER),
        dueDate: siennes.map((l) => l.dueDate).filter((d): d is ISODate => !!d).sort()[0] ?? '9999-12-31',
      };
    })
    .sort((x, y) => x.echeance - y.echeance || x.priority - y.priority || x.dueDate.localeCompare(y.dueDate) || x.b.tirelireName.localeCompare(y.b.tirelireName, 'fr'));
  const out: AllocationLine[] = [];
  let reste = Math.max(0, amount);
  for (const r of rangs) {
    const part = Math.min(r.b.cruise, reste);
    if (part <= 0) continue;
    out.push({ tirelireId: r.b.tirelireId, share: { kind: 'fixed', amount: sign * part } });
    reste -= part;
  }
  return out;
}

/**
 * La ventilation que le plan propose pour un ordre de `amount` (positif) vers le compte de
 * `transfer` (D21, D60, point 9 de #393), dans le signe d'un ordre décrit sur le compte principal :
 * elle se recalcule pour le montant que l'utilisateur valide.
 */
export function proposedOrderAllocation(plan: Plan, transfer: PlanTransfer, amount: Cents): AllocationLine[] {
  return orderAllocation(transfer.breakdown, plan.lines, amount, -1);
}

/**
 * L'ordre permanent à enregistrer vers le compte de `transfer`, pour le montant que l'utilisateur
 * valide — par défaut celui que le plan propose (`PlanTransfer.proposal`) —, avec la ventilation
 * proposée pour ce montant (`proposedOrderAllocation`) : un fait que rien ne réécrit (D57, D60).
 * Vers un compte qui a exactement un ordre, `existing` est cet ordre : il en remplace le montant et la
 * ventilation, et garde son ancrage, son nom, sa sélection — motif de libellé, tolérance, fenêtre —
 * et son état ; un ordre décrit sur le compte d'accueil y reste décrit. Vers un compte qui a
 * plusieurs ordres, ou dont l'ordre n'est pas `existing`, le plan n'en crée ni n'en réécrit aucun :
 * `undefined`. Un ordre nouveau est mensuel, sur le compte principal.
 */
export function standingTransferFlow(
  plan: Plan,
  transfer: PlanTransfer,
  principalId: Id,
  id: Id,
  amount: Cents = transfer.proposal?.amount ?? transfer.permanent,
  existing?: PlannedFlow,
): PlannedFlow | undefined {
  if (amount <= 0) return undefined;
  const ordres = transfer.bankOrder?.flowIds ?? [];
  if (ordres.length > 1 || (ordres.length === 1 && existing?.id !== ordres[0]) || (ordres.length === 0 && existing)) return undefined;
  if (existing) {
    const sign = existing.amount > 0 ? 1 : -1;
    const allocation = orderAllocation(transfer.breakdown, plan.lines, amount, sign);
    const state = existing.action?.state;
    const action = { ...(allocation.length ? { allocation } : {}), ...(state ? { state } : {}) };
    const next: PlannedFlow = { ...existing, amount: sign * amount };
    if (Object.keys(action).length) next.action = action;
    else delete next.action;
    return next;
  }
  const allocation = proposedOrderAllocation(plan, transfer, amount);
  return {
    id,
    name: `Virement ${transfer.accountName}`,
    kind: 'transfer',
    amount: -amount,
    accountId: principalId,
    counterpartAccountId: transfer.accountId,
    periodicity: { interval: 1, unit: 'month' as const, anchorDate: standingAnchor(plan) },
    dateWindowDays: 5,
    labelPattern: transfer.label,
    amountTolerance: { pct: 20 },
    ...(allocation.length ? { action: { allocation } } : {}),
  };
}

/**
 * La date à laquelle se lit le plan d'une période (D52) : la date de lecture `today` dans la période
 * qui la contient, le premier jour de la période ailleurs. Une seule règle pour tous les écrans qui
 * lisent une période — le Plan, le Bilan (#320) —, pour qu'ils disent la même chose au centime.
 */
export function periodReadingDate(period: Period, today: ISODate): ISODate {
  return period.start <= today && today <= period.end ? today : period.start;
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
