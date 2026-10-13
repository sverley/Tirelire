/**
 * Les alertes d'un fichier (#463) : ce que l'application signale sur sa base, lue en mémoire (D88),
 * pour une lecture — une date de lecture (D52) et des périodes budgétaires lues, consécutives. Les
 * écrans qui montrent ces alertes les prennent d'ici, et la skill de #451 les rend telles quelles :
 * une seule source pour ce qui est signalé (principe 13, D78). Le cœur calcule, l'interface affiche
 * (D89) : les seuils, les fenêtres, les périodes et les dates de lecture sont ici, et rien d'autre.
 *
 * Aucun calcul propre (point 4) : chaque genre vient du calcul du cœur qui le fait — le plan de chaque
 * période lue (`readBudgetPeriod`, lu comme l'écran Plan le lit), les échéances en manque
 * (`dueDateShortfalls`), les attendus non reçus (`missingFlows`), les reprises proposées
 * (`proposeMatches`), les virements qui peuvent devenir un ordre (`transfersToOrder`) —, et ses
 * montants et ses dates sont ceux que ce calcul rend, portés à part du message : qui lit l'alerte n'a
 * rien à extraire du message ni à recalculer (point 3).
 *
 * Rien ne s'écrit (I10, D89 : « jamais stocker ce qui se recalcule ») : la fonction ne fait que lire,
 * et aucune proposition qu'elle rend ne s'applique, pas même une reprise que D12 dit automatique.
 */
import type { Cents, Id, ISODate, Ledger, Tirelire } from './model.js';
import { alive } from './model.js';
import { addDays, diffDays, shortDate } from './dates.js';
import { formatCents } from './money.js';
import { budgetPeriodContaining, nextPeriod, type Period } from './periods.js';
import { PLAN_WARNING_CODES, type Plan, type PlanWarning } from './plan.js';
import { readBudgetPeriod, shortfallsWithin, type BudgetPeriodReading } from './lecture-budget.js';
import { dueDateShortfalls, shortfallsForPeriod, type DueDateShortfall } from './shortfall.js';
import { missingFlows, proposeMatches, type MatchProposal, type MissingFlow } from './matching.js';
import { transfersToOrder } from './ordre-depuis-virement.js';

/** Au-delà de ce nombre de jours entre la dernière opération connue et la date de lecture, l'historique est en retard. */
const JOURS_AVANT_RETARD = 15;
/** La fenêtre des reprises proposées, autour de la période qui contient la date de lecture (D12). */
const REPRISES_AVANT = 400;
const REPRISES_APRES = 40;
/** Les attendus non reçus se cherchent depuis ce nombre de jours avant la première période lue (D12). */
const ATTENDUS_AVANT = 60;

/** La lecture : la date de lecture, et les périodes lues. */
export interface AlertReading {
  /** La date de lecture (D52), celle que tous les écrans suivent (« Lecture au … »). */
  today: ISODate;
  /** Une date de la première période lue ; sans elle, la période qui contient la date de lecture. */
  from?: ISODate;
  /** Le nombre de périodes lues, consécutives, à partir de la première : 1 par défaut. */
  count?: number;
}

interface Said {
  /** La phrase qui dit l'alerte, en français, au vouvoiement (D85). */
  message: string;
}

/** Une alerte qui tient à une période lue. */
interface InPeriod {
  period: Period;
}

// ── À la date de lecture, quelles que soient les périodes lues ────────────────────────────────

/** L'historique s'arrête loin derrière la date de lecture (point 5). */
export interface StaleHistoryAlert extends Said {
  code: 'staleHistory';
  /** La date de la dernière opération connue, vivante, tous comptes et toutes origines confondus. */
  lastOperationDate: ISODate;
  /** Le nombre de jours entre elle et la date de lecture. */
  days: number;
}

/** Une tirelire dont le compte où elle se range n'est pas un compte vivant (point 6). */
export interface OrphanTirelireAlert extends Said {
  code: 'orphanTirelire';
  tirelireId: Id;
  tirelireName: string;
  /** Le compte visé, quand il y en a un : le premier du placement, ou le compte principal. */
  accountId?: Id;
}

/** Une opération, par ce que l'application en montre. */
export interface AlertOperation {
  id: Id;
  label: string;
  accountId: Id;
  date: ISODate;
  amount: Cents;
}

/** Des opérations vivantes à l'état « non traitée » (point 7, D22). */
export interface UntreatedOperationsAlert extends Said {
  code: 'untreatedOperations';
  count: number;
  operations: AlertOperation[];
}

/**
 * Une reprise que la sélection des flux propose (point 8, D12, D88) : la proposition elle-même
 * (`MatchProposal`, ce que l'application applique au geste de l'utilisateur), avec les noms que
 * l'application montre.
 */
export interface MatchProposalAlert extends Said, MatchProposal {
  code: 'matchProposal';
  operationLabel: string;
  operationDate: ISODate;
  operationAmount: Cents;
  flowName: string;
  /** Le libellé de la saisie qu'elle reprendrait, quand une saisie corrige ou masque déjà l'occurrence. */
  resumedOperationLabel?: string;
}

/** Une opération qui peut devenir l'ordre permanent d'un compte d'accueil (point 9, #434, #435). */
export interface TransferToOrderAlert extends Said {
  code: 'transferToOrder';
  operationId: Id;
  operationLabel: string;
  date: ISODate;
  /** Le montant de l'opération, signé comme elle : négatif, débit du compte principal. */
  amount: Cents;
  accountId: Id;
  accountName: string;
}

/** Une échéance en manque, ou déjà répondue (point 10, principe 1.4, D88, #184). */
export interface DueDateShortfallAlert extends Said, DueDateShortfall {
  code: 'dueDateShortfall';
  /** Les périodes lues dont le plan la signale (`shortfallsForPeriod`), par leur clé. */
  signaledIn: string[];
  /** Sa date tombe dans les périodes lues (#320). */
  inReading: boolean;
}

// ── Dans chaque période lue ──────────────────────────────────────────────────────────────────

/** Un avertissement du plan d'une période lue : le message que le Plan en montre, et ce que porte son code. */
type InPlan<T> = Said & InPeriod & T;

/** Un besoin que les revenus de la période ne couvrent pas entièrement (`unfunded`, `reduced`). */
interface UncoveredNeed {
  needId: Id;
  needName: string;
  tirelireId: Id;
  tirelireName: string;
  /** La dotation demandée. */
  requested: Cents;
  /** Ce que les revenus en couvrent. */
  funded: Cents;
  /** Ce qu'ils n'en couvrent pas. */
  uncovered: Cents;
}

/** Un avertissement du plan de la période (point 11), avec le message que le Plan en montre, selon son code. */
export type PlanWarningAlert =
  | InPlan<{ code: 'noIncome' }>
  | InPlan<{
      code: 'negativeMargin';
      /** Ce qui manque aux revenus, charges fixes déduites, pour couvrir les dotations demandées. */
      missing: Cents;
    }>
  | InPlan<{ code: 'belowCushion'; margin: Cents; cushion: Cents }>
  | InPlan<UncoveredNeed & { code: 'unfunded' }>
  | InPlan<UncoveredNeed & { code: 'reduced' }>
  | InPlan<{
      code: 'payoutShort';
      needId: Id;
      needName: string;
      tirelireId: Id;
      tirelireName: string;
      /** Ce qu'il verse sur la période. */
      paid: Cents;
      /** Ce qu'il devrait verser : sa croisière. */
      cruise: Cents;
    }>
  | InPlan<{
      code: 'principalOverdrawn';
      accountId: Id;
      accountName: string;
      /** Le non affecté du compte principal, négatif. */
      unallocated: Cents;
    }>
  | InPlan<{
      code: 'settlementBlocked';
      accountId: Id;
      accountName: string;
      /** Le règlement bloqué, signé comme le plan le calcule : positif du principal vers le tiers. */
      amount: Cents;
    }>
  | InPlan<{
      code: 'bankOrderDrift';
      accountId: Id;
      accountName: string;
      /** Le montant de l'ordre enregistré : la somme mensuelle des ordres vers ce compte. */
      recorded: Cents;
      /** Ce que le budget demande ; zéro quand il ne demande plus rien. */
      requested: Cents;
      accountRetired: boolean;
    }>
  | InPlan<{
      code: 'bankOrderPartDrift';
      accountId: Id;
      accountName: string;
      tirelireId: Id;
      tirelireName: string;
      /** Sa part enregistrée, par mois. */
      recorded: Cents;
      /** Ce que le budget lui demande ; zéro pour une tirelire retirée. */
      requested: Cents;
      tirelireRetired: boolean;
    }>;

/** Le solde prévu d'un compte réel ou d'une tirelire passe sous zéro dans une période à venir (point 12, D52, D88). */
export type ForecastShortfallAlert = Said &
  InPeriod & {
    code: 'forecastShortfall';
    /** Le point le plus bas du solde prévu, négatif. */
    amount: Cents;
    /** Sa date. */
    date: ISODate;
  } & ({ accountId: Id; accountName: string } | { tirelireId: Id; tirelireName: string });

// ── Sur l'ensemble de la lecture ─────────────────────────────────────────────────────────────

/** Une occurrence d'un flux attendue, non reçue (point 13, D12, D88). */
export interface MissingFlowAlert extends Said, MissingFlow {
  code: 'missingFlow';
}

export type Alert =
  | StaleHistoryAlert
  | OrphanTirelireAlert
  | UntreatedOperationsAlert
  | MatchProposalAlert
  | TransferToOrderAlert
  | DueDateShortfallAlert
  | PlanWarningAlert
  | ForecastShortfallAlert
  | MissingFlowAlert;

export type AlertCode = Alert['code'];

/**
 * Le compte où se range une tirelire : son premier compte de placement (D38) ; sans placement, le
 * compte principal, où restent ses dotations (D29). `undefined` sans l'un ni l'autre.
 */
export function tirelireShelfAccount(ledger: Ledger, e: Tirelire): Id | undefined {
  if (e.placement.length > 0) return e.placement[0]!.accountId;
  return alive(ledger.accounts).find((a) => a.kind === 'principal')?.id;
}

/** Les périodes lues : la première contient `from`, ou la date de lecture ; les suivantes s'enchaînent. */
export function readPeriods(ledger: Ledger, reading: AlertReading): Period[] {
  const count = reading.count ?? 1;
  if (!Number.isInteger(count) || count < 1) throw new RangeError('Une lecture lit au moins une période, en nombre entier.');
  const startDay = ledger.settings.periodStartDay;
  const out: Period[] = [];
  for (let p = budgetPeriodContaining(reading.from ?? reading.today, startDay); out.length < count; p = nextPeriod(p, startDay)) out.push(p);
  return out;
}

/**
 * Les alertes du fichier pour cette lecture : à la date de lecture d'abord (points 5 à 10), puis
 * celles de chaque période lue, dans l'ordre des périodes (points 11 et 12), puis celles de l'ensemble
 * de la lecture (point 13) ; dans un même genre, dans l'ordre où l'écran qui les montre les montre.
 * `only` restreint le calcul aux genres qu'on demande, dans le même ordre.
 */
export function readAlerts<C extends AlertCode = AlertCode>(ledger: Ledger, reading: AlertReading, only?: readonly C[]): Array<Extract<Alert, { code: C }>> {
  const voulu = (c: AlertCode) => !only || (only as readonly AlertCode[]).includes(c);
  const today = reading.today;
  const periods = readPeriods(ledger, reading);
  const out: Alert[] = [];
  if (voulu('staleHistory')) out.push(...staleHistory(ledger, today));
  if (voulu('orphanTirelire')) out.push(...orphanTirelires(ledger));
  if (voulu('untreatedOperations')) out.push(...untreatedOperations(ledger));
  if (voulu('matchProposal')) out.push(...matchProposals(ledger, today));
  if (voulu('transferToOrder')) out.push(...transfersToOrderAlerts(ledger, today));
  if (voulu('dueDateShortfall')) out.push(...dueDateShortfallAlerts(ledger, today, periods));
  if (PLAN_WARNING_CODES.some(voulu) || voulu('forecastShortfall'))
    for (const p of periods) {
      const { plan, reading: lu } = readBudgetPeriod(ledger, p, today);
      for (const w of plan.warnings) if (voulu(w.code)) out.push(planWarningAlert(ledger, plan, lu, w));
      if (voulu('forecastShortfall')) out.push(...forecastShortfalls(plan));
    }
  if (voulu('missingFlow'))
    for (const m of missingFlows(ledger, addDays(periods[0]!.start, -ATTENDUS_AVANT), today))
      out.push({ code: 'missingFlow', ...m, message: `« ${m.name} », attendu le ${shortDate(m.expectedDate)} pour ${formatCents(m.amount)}, n’est pas reçu : sa fenêtre s’est close le ${shortDate(m.windowEnd)}.` });
  return out as Array<Extract<Alert, { code: C }>>;
}

function staleHistory(ledger: Ledger, today: ISODate): StaleHistoryAlert[] {
  let last: ISODate | undefined;
  for (const o of alive(ledger.operations)) if (last === undefined || o.date > last) last = o.date;
  if (last === undefined) return [];
  const days = diffDays(last, today);
  if (days <= JOURS_AVANT_RETARD) return [];
  return [
    {
      code: 'staleHistory',
      lastOperationDate: last,
      days,
      message: `Dernière opération connue le ${shortDate(last)}, il y a ${days} jours : les soldes et le plan supposent qu’il ne s’est rien passé depuis. Mettez vos opérations à jour, en important un relevé ou en les saisissant.`,
    },
  ];
}

function orphanTirelires(ledger: Ledger): OrphanTirelireAlert[] {
  const vivants = new Set(alive(ledger.accounts).map((a) => a.id));
  const out: OrphanTirelireAlert[] = [];
  for (const e of alive(ledger.tirelires)) {
    const vise = tirelireShelfAccount(ledger, e);
    if (vise && vivants.has(vise)) continue;
    out.push({
      code: 'orphanTirelire',
      tirelireId: e.id,
      tirelireName: e.name,
      ...(vise ? { accountId: vise } : {}),
      message: vise
        ? `La tirelire « ${e.name} » se range sur un compte qui n’existe plus : donnez-lui un compte de placement.`
        : `La tirelire « ${e.name} » n’a ni compte de placement ni compte principal où se ranger : donnez-lui un compte de placement.`,
    });
  }
  return out;
}

function untreatedOperations(ledger: Ledger): UntreatedOperationsAlert[] {
  const ops = alive(ledger.operations).filter((o) => o.state === 'untreated');
  if (ops.length === 0) return [];
  const n = ops.length;
  return [
    {
      code: 'untreatedOperations',
      count: n,
      operations: ops.map((o) => ({ id: o.id, label: o.label, accountId: o.accountId, date: o.date, amount: o.amount })),
      message: n > 1 ? `${n} opérations non traitées : aucun automatisme ne les a classées, et vous ne les avez pas modifiées.` : `1 opération non traitée : aucun automatisme ne l’a classée, et vous ne l’avez pas modifiée.`,
    },
  ];
}

function matchProposals(ledger: Ledger, today: ISODate): MatchProposalAlert[] {
  const p = budgetPeriodContaining(today, ledger.settings.periodStartDay);
  const ops = new Map(ledger.operations.map((o) => [o.id, o]));
  const flows = new Map(ledger.plannedFlows.map((f) => [f.id, f]));
  return proposeMatches(ledger, addDays(p.start, -REPRISES_AVANT), addDays(p.end, REPRISES_APRES)).map((m) => {
    const op = ops.get(m.operationId)!;
    const flowName = flows.get(m.flowId)?.name ?? m.flowId;
    const saisie = m.resumedOperationId ? ops.get(m.resumedOperationId) : undefined;
    return {
      code: 'matchProposal',
      ...m,
      operationLabel: op.label,
      operationDate: op.date,
      operationAmount: op.amount,
      flowName,
      ...(saisie ? { resumedOperationLabel: saisie.label } : {}),
      message:
        `L’opération « ${op.label} » du ${shortDate(op.date)}, de ${formatCents(op.amount)}, peut reprendre l’opération prévue « ${flowName} » du ${shortDate(m.expectedDate)}, de ${formatCents(m.expectedAmount)}` +
        (saisie ? `, par la saisie « ${saisie.label} » qui la corrige` : '') +
        (m.auto ? ' : elle s’appliquerait sans confirmation.' : ' : à confirmer.'),
    };
  });
}

function transfersToOrderAlerts(ledger: Ledger, today: ISODate): TransferToOrderAlert[] {
  const vers = transfersToOrder(ledger, today);
  if (vers.size === 0) return [];
  const comptes = new Map(ledger.accounts.map((a) => [a.id, a.name]));
  return alive(ledger.operations)
    .filter((o) => vers.has(o.id))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((o) => {
      const accountId = vers.get(o.id)!;
      const accountName = comptes.get(accountId) ?? accountId;
      return {
        code: 'transferToOrder',
        operationId: o.id,
        operationLabel: o.label,
        date: o.date,
        amount: o.amount,
        accountId,
        accountName,
        message: `Le virement « ${o.label} » du ${shortDate(o.date)}, de ${formatCents(-o.amount)}, vers « ${accountName} » peut devenir votre ordre permanent vers ce compte.`,
      };
    });
}

function dueDateShortfallAlerts(ledger: Ledger, today: ISODate, periods: Period[]): DueDateShortfallAlert[] {
  const all = dueDateShortfalls(ledger, today);
  const dedans = new Set(shortfallsWithin(all, periods));
  return all.map((s) => ({
    code: 'dueDateShortfall',
    ...s,
    signaledIn: periods.filter((p) => shortfallsForPeriod([s], p, today).length > 0).map((p) => p.key),
    inReading: dedans.has(s),
    message: dueDateMessage(s),
  }));
}

function dueDateMessage(s: DueDateShortfall): string {
  const quoi = `« ${s.name} »${s.name !== s.tirelireName ? ` dans « ${s.tirelireName} »` : ''}`;
  const parts = (ps: Array<{ date: ISODate; amount: Cents }>) => ps.map((p) => `${formatCents(p.amount)} le ${shortDate(p.date)}`).join(', ');
  const debut =
    s.amount > 0
      ? `Il manquera ${formatCents(s.amount)} le ${shortDate(s.dueDate)} pour ${quoi}, en plus des virements permanents`
      : `L’échéance ${quoi} du ${shortDate(s.dueDate)} sera réunie à temps`;
  if (s.answer?.kind === 'smoothing') return `${debut} ; lissage décidé : ${parts(s.answer.parts)}.`;
  if (s.answer?.kind === 'refusal') return `${debut} ; lissage refusé.`;
  if (s.proposal) return `${debut}. Il vous est proposé de le lisser : ${parts(s.proposal)}.`;
  return `${debut}.`;
}

function planWarningAlert(ledger: Ledger, plan: Plan, lu: BudgetPeriodReading, w: PlanWarning): PlanWarningAlert {
  const base = { period: plan.period, message: w.message };
  const compte = (id: Id | undefined) => ledger.accounts.find((a) => a.id === id)?.name ?? id ?? '';
  switch (w.code) {
    case 'noIncome':
      return { code: w.code, ...base };
    case 'negativeMargin':
      return { code: w.code, ...base, missing: w.amount ?? 0 };
    case 'belowCushion':
      return { code: w.code, ...base, margin: plan.totals.margin, cushion: plan.totals.cushion };
    case 'unfunded':
    case 'reduced': {
      const n = lu.needs.find((x) => x.needId === w.needId)!;
      const besoin: UncoveredNeed = { needId: n.needId, needName: n.name, tirelireId: n.tirelireId, tirelireName: n.tirelireName, requested: n.requested, funded: n.funded, uncovered: n.uncovered };
      return { code: w.code, ...base, ...besoin } as Extract<PlanWarningAlert, { code: 'unfunded' | 'reduced' }>;
    }
    case 'payoutShort': {
      const l = plan.lines.find((x) => x.needId === w.needId)!;
      return { code: w.code, ...base, needId: l.needId, needName: l.name, tirelireId: l.tirelireId, tirelireName: l.tirelireName, paid: -l.requested, cruise: l.cruise };
    }
    case 'principalOverdrawn':
      return { code: w.code, ...base, accountId: w.accountId!, accountName: compte(w.accountId), unallocated: plan.totals.principalUnallocated };
    case 'settlementBlocked':
      return { code: w.code, ...base, accountId: w.accountId!, accountName: compte(w.accountId), amount: w.amount ?? 0 };
    case 'bankOrderDrift': {
      const t = plan.transfers.find((x) => x.accountId === w.accountId)!;
      return { code: w.code, ...base, accountId: t.accountId, accountName: t.accountName, recorded: t.bankOrder!.amount, requested: t.permanent, accountRetired: !!t.accountRetired };
    }
    case 'bankOrderPartDrift': {
      const t = plan.transfers.find((x) => x.accountId === w.accountId)!;
      const part = t.bankOrder!.parts.find((x) => x.tirelireId === w.tirelireId)!;
      return {
        code: w.code,
        ...base,
        accountId: t.accountId,
        accountName: t.accountName,
        tirelireId: part.tirelireId,
        tirelireName: part.tirelireName,
        recorded: part.amount,
        requested: part.requested,
        tirelireRetired: !!part.retired,
      };
    }
  }
}

function forecastShortfalls(plan: Plan): ForecastShortfallAlert[] {
  const f = plan.forecast;
  if (!f) return [];
  const message = (nom: string, amount: Cents, date: ISODate) => `Manque : le solde prévu de « ${nom} » descend à ${formatCents(amount)} le ${shortDate(date)}.`;
  const out: ForecastShortfallAlert[] = [];
  for (const a of f.accounts)
    if (a.shortfall)
      out.push({ code: 'forecastShortfall', period: plan.period, accountId: a.id, accountName: a.name, amount: a.shortfall.amount, date: a.shortfall.date, message: message(a.name, a.shortfall.amount, a.shortfall.date) });
  for (const t of f.tirelires)
    if (t.shortfall)
      out.push({ code: 'forecastShortfall', period: plan.period, tirelireId: t.id, tirelireName: t.name, amount: t.shortfall.amount, date: t.shortfall.date, message: message(t.name, t.shortfall.amount, t.shortfall.date) });
  return out;
}
