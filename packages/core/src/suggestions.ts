/**
 * Propositions de budget pour l'assistant (D43).
 *
 * Une page blanche ne dit pas ce qu'on attend de vous : « qu'est-ce qui ne tombe pas tous les
 * mois ? » est une bonne question, mais on n'y répond bien qu'en voyant des exemples.
 *
 * Ces propositions sont **entièrement dérivées du jeu d'exemple** (`example.ts`), qui en est la
 * seule source : rien n'est écrit en double ici. Étoffer l'exemple — ce que le lot 8 prévoit —
 * enrichit donc l'assistant du même geste, et aucune des deux listes ne peut prendre du retard sur
 * l'autre. En contrepartie, l'exemple porte une seconde responsabilité : ses libellés sont lus par
 * quelqu'un qui découvre l'application, et ses montants sont les ordres de grandeur qu'on lui
 * propose.
 *
 * Rien n'est imposé : une proposition remplit le formulaire, que l'utilisateur corrige avant
 * d'ajouter.
 */
import { parseDate } from './dates.js';
import { exampleLedger } from './example.js';
import {
  alive,
  type Account,
  type AccountKind,
  type AmountTolerance,
  type Cents,
  type Id,
  type ISODate,
  type FlowOrigin,
  type Ledger,
  type Need,
  type NeedKind,
  type Periodicity,
  type PeriodUnit,
  type PlannedFlow,
  type PlannedFlowKind,
  type Rollover,
  type SettlementDirection,
  type Share,
  type Tirelire,
} from './model.js';

/**
 * Un flux de revenu ou de charge fixe de l'exemple, une version par proposition, avec tout ce que
 * l'exemple en dit : de quoi créer le même flux (`suggestedFlow`), dates de validité comprises
 * (D51). Deux versions d'un même flux — le salaire qui change — sont deux propositions du même nom,
 * chacune avec sa date.
 */
export interface FlowSuggestion {
  name: string;
  /** Positif : le signe appartient au genre du flux, pas à la saisie. */
  amount: Cents;
  interval: number;
  unit: PeriodUnit;
  /** Le jour du mois de la première occurrence. */
  day: number;
  /** Première occurrence, à la date que l'exemple lui donne (D40 : jamais postérieure à celle de la période en cours, sauf pour une version qui commence plus tard). */
  anchorDate: ISODate;
  /** Ce que l'étape ne montre pas, tel que l'exemple le dit : la sélection du flux (D24). */
  dateWindowDays: number;
  amountTolerance?: AmountTolerance;
  labelPattern?: string;
  variable?: boolean;
  /** Les bornes de la version, quand l'exemple la borne ; incluses (D23). */
  activeFrom?: ISODate;
  activeTo?: ISODate;
  /** Le compte du flux, par son nom, quand l'exemple ne le met pas sur le compte principal. */
  accountName?: string;
  /** L'origine du flux, quand l'exemple la dit : `derived` pour un ordre permanent, ce que la banque exécute (D57, D60). */
  origin?: FlowOrigin;
}

export type IncomeSuggestion = FlowSuggestion;
export type ChargeSuggestion = FlowSuggestion;

/**
 * Un besoin de l'exemple, une version par proposition, avec tout ce que l'exemple en dit : genre,
 * nom quand il en porte un, montant, rythme et date d'échéance, mensualité et cible, priorité,
 * dates de validité (D06, D28, D50, D51). Rien ne se recalcule : ce sont les champs du besoin.
 */
export interface NeedSuggestion {
  kind: NeedKind;
  name?: string;
  /** recurring : montant par période ; dueDate : montant de l'échéance ; goal : cible. */
  amount?: Cents;
  /** recurring : le rythme ; dueDate : le rythme et la date d'échéance (son ancrage). */
  periodicity?: Periodicity;
  /** goal : la mensualité. */
  monthlyAmount?: Cents;
  /** L'ordre de financement (D06). L'assistant ne la montre pas ; elle se lit et se modifie dans Tirelires (I11). */
  priority: number;
  activeFrom?: ISODate;
  activeTo?: ISODate;
}

/**
 * Une tirelire de l'exemple, avec tout ce que l'exemple en dit : ses besoins, toutes versions
 * comprises (D28, D51), son reliquat, ce qui y est déjà mis de côté, où dort son argent (D38) et le
 * prélèvement qu'attend chacune de ses échéances (D40).
 */
export interface TirelireSuggestion {
  name: string;
  /** Le sort du reliquat en fin de période, tel que l'exemple le dit (D05) ; absent, il est gardé. */
  rollover?: Rollover;
  /** Ce qui y est déjà mis de côté : son solde d'ouverture dans l'exemple, réputé sur le premier compte du placement. */
  openingBalance: Cents;
  /** Où elle dort (D38) : une part par compte, le compte par son nom, absent pour le compte principal. */
  placement: Array<{ accountName?: string; share: Share }>;
  needs: NeedSuggestion[];
  /** Les prélèvements que l'exemple attend pour ses échéances : ses flux d'échéance, et eux seuls. */
  payments: FlowSuggestion[];
}

/**
 * Un ordre permanent de l'exemple, déjà posé chez la banque (D60) : ce qu'il exécute, de quel compte
 * vers quel compte, avec sa fenêtre, sa tolérance et son libellé.
 */
export interface OrderSuggestion extends FlowSuggestion {
  /** Le compte où arrive l'ordre, par son nom. */
  toAccountName: string;
}

/** Ce que l'exemple dit du compte principal. L'assistant le renseigne, il ne le crée pas (D40). */
export interface MainAccountSuggestion {
  name: string;
  balance: Cents;
}

/** Un autre compte de l'exemple, de quoi en créer la ligne et rien de plus. */
export interface AccountSuggestion {
  name: string;
  kind: Exclude<AccountKind, 'principal'>;
  balance: Cents;
  /**
   * Le suivi d'un solde à régler avec le compte principal, tel que l'exemple le dit : c'est ce qui
   * fait d'un compte un compte tiers (D04, D45).
   */
  settlement?: { threshold: Cents; direction: SettlementDirection };
  /**
   * L'exemple le dit clos (D56) : « vidé et fermé avant la période en cours ». Sa date de clôture ne
   * se copie pas, elle suit la période en cours de celui qui ouvre l'assistant.
   */
  closed?: boolean;
}

export interface BudgetSuggestions {
  mainAccount: MainAccountSuggestion;
  accounts: AccountSuggestion[];
  incomes: IncomeSuggestion[];
  charges: ChargeSuggestion[];
  /** Les tirelires de l'exemple, dans son ordre, chacune avec tous ses besoins. */
  tirelires: TirelireSuggestion[];
  /** Les ordres permanents que l'exemple a déjà posés chez la banque (D60). */
  orders: OrderSuggestion[];
}

/** Un flux de l'exemple, tel qu'il se propose : ce que l'exemple en dit, le compte par son nom quand ce n'est pas le principal. */
function flowSuggestion(f: PlannedFlow, comptes: Account[]): FlowSuggestion {
  const compte = comptes.find((a) => a.id === f.accountId);
  return {
    name: f.name,
    amount: Math.abs(f.amount),
    interval: f.periodicity.interval,
    unit: f.periodicity.unit,
    day: parseDate(f.periodicity.anchorDate).d,
    anchorDate: f.periodicity.anchorDate,
    dateWindowDays: f.dateWindowDays,
    ...(f.amountTolerance ? { amountTolerance: { ...f.amountTolerance } } : {}),
    ...(f.labelPattern !== undefined ? { labelPattern: f.labelPattern } : {}),
    ...(f.variable ? { variable: true } : {}),
    ...(f.activeFrom !== undefined ? { activeFrom: f.activeFrom } : {}),
    ...(f.activeTo !== undefined ? { activeTo: f.activeTo } : {}),
    ...(compte && compte.kind !== 'principal' ? { accountName: compte.name } : {}),
    ...(f.origin !== undefined ? { origin: f.origin } : {}),
  };
}

/** Les flux d'un genre, dans l'ordre de l'exemple : toutes leurs versions, quelle que soit la date de lecture (D51). */
function flowSuggestions(l: Ledger, kind: 'income' | 'fixedCharge'): FlowSuggestion[] {
  const comptes = alive(l.accounts);
  return alive(l.plannedFlows)
    .filter((f) => f.kind === kind)
    .map((f) => flowSuggestion(f, comptes));
}

/** Un besoin de l'exemple, tel qu'il se propose : ses champs, sans son identité ni sa tirelire. */
function needSuggestion(n: Need): NeedSuggestion {
  return {
    kind: n.kind,
    ...(n.name !== undefined ? { name: n.name } : {}),
    ...(n.amount !== undefined ? { amount: n.amount } : {}),
    ...(n.periodicity ? { periodicity: { ...n.periodicity } } : {}),
    ...(n.monthlyAmount !== undefined ? { monthlyAmount: n.monthlyAmount } : {}),
    priority: n.priority,
    ...(n.activeFrom !== undefined ? { activeFrom: n.activeFrom } : {}),
    ...(n.activeTo !== undefined ? { activeTo: n.activeTo } : {}),
  };
}

/** Les tirelires de l'exemple, dans son ordre, chacune avec tous ses besoins, son placement et ses prélèvements attendus. */
function tirelireSuggestions(l: Ledger): TirelireSuggestion[] {
  const comptes = alive(l.accounts);
  const nomDuCompte = (id: Id) => {
    const a = comptes.find((x) => x.id === id);
    return a && a.kind !== 'principal' ? { accountName: a.name } : {};
  };
  return alive(l.tirelires).map((t) => ({
    name: t.name,
    ...(t.rollover ? { rollover: { ...t.rollover } } : {}),
    openingBalance: t.openingBalance,
    placement: t.placement.map((p) => ({ ...nomDuCompte(p.accountId), share: { ...p.share } })),
    needs: alive(l.needs).filter((n) => n.tirelireId === t.id).map(needSuggestion),
    payments: alive(l.plannedFlows)
      .filter((f) => f.kind === 'dueDate' && f.tirelireId === t.id)
      .map((f) => flowSuggestion(f, comptes)),
  }));
}

/** Les ordres permanents de l'exemple : ses virements dérivés, enregistrés comme ce que la banque exécute (D60). */
function orderSuggestions(l: Ledger): OrderSuggestion[] {
  const comptes = alive(l.accounts);
  return alive(l.plannedFlows)
    .filter((f) => f.kind === 'transfer' && f.origin === 'derived')
    .flatMap((f) => {
      const vers = comptes.find((a) => a.id === f.counterpartAccountId);
      return vers ? [{ ...flowSuggestion(f, comptes), toAccountName: vers.name }] : [];
    });
}

/**
 * Le flux que crée une proposition : ce que l'exemple en dit, et rien d'autre — la catégorie, qui
 * n'est pas une proposition, reste à ceux qui la donnent. `id` et les comptes sont ceux de qui
 * l'écrit : l'identité d'un flux et le compte où il se trouve dans le projet ne sont pas ceux de
 * l'exemple ; de même la tirelire que vide un prélèvement attendu, et le compte où arrive un ordre.
 * Le signe suit le genre : seul un revenu entre.
 */
export function suggestedFlow(
  p: FlowSuggestion,
  kind: PlannedFlowKind,
  ids: { id: Id; accountId: Id; tirelireId?: Id; counterpartAccountId?: Id },
): PlannedFlow {
  return {
    id: ids.id,
    name: p.name,
    kind,
    ...(p.origin !== undefined ? { origin: p.origin } : {}),
    amount: kind === 'income' ? p.amount : -p.amount,
    accountId: ids.accountId,
    ...(ids.tirelireId !== undefined ? { tirelireId: ids.tirelireId } : {}),
    ...(ids.counterpartAccountId !== undefined ? { counterpartAccountId: ids.counterpartAccountId } : {}),
    periodicity: { interval: p.interval, unit: p.unit, anchorDate: p.anchorDate },
    dateWindowDays: p.dateWindowDays,
    ...(p.amountTolerance ? { amountTolerance: { ...p.amountTolerance } } : {}),
    ...(p.labelPattern !== undefined ? { labelPattern: p.labelPattern } : {}),
    ...(p.variable ? { variable: true } : {}),
    ...(p.activeFrom !== undefined ? { activeFrom: p.activeFrom } : {}),
    ...(p.activeTo !== undefined ? { activeTo: p.activeTo } : {}),
  };
}

/** Le besoin que crée une proposition, sur la tirelire de qui l'écrit. */
export function suggestedNeed(p: NeedSuggestion, ids: { id: Id; tirelireId: Id }): Need {
  return {
    id: ids.id,
    tirelireId: ids.tirelireId,
    kind: p.kind,
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.amount !== undefined ? { amount: p.amount } : {}),
    ...(p.periodicity ? { periodicity: { ...p.periodicity } } : {}),
    ...(p.monthlyAmount !== undefined ? { monthlyAmount: p.monthlyAmount } : {}),
    priority: p.priority,
    ...(p.activeFrom !== undefined ? { activeFrom: p.activeFrom } : {}),
    ...(p.activeTo !== undefined ? { activeTo: p.activeTo } : {}),
  };
}

/**
 * La tirelire que crée une proposition, avec ses besoins et ses prélèvements attendus. Les comptes
 * se retrouvent par `compte` : le compte principal pour un nom absent, sinon celui du même nom chez
 * qui l'écrit ; une part sur un compte qu'il n'a pas est laissée de côté — une tirelire sans
 * placement ne produit aucun écart (D38) —, de même qu'un prélèvement sur un compte qu'il n'a pas
 * se met sur le compte principal (D40). La date d'ouverture est celle de qui l'écrit (D40).
 */
export function suggestedTirelire(
  p: TirelireSuggestion,
  ids: { id: Id; newId: () => Id; openingDate: ISODate; principalId: Id; compte: (name: string) => Id | undefined },
): { tirelire: Tirelire; needs: Need[]; flows: PlannedFlow[] } {
  const compte = (name?: string) => (name === undefined ? ids.principalId : ids.compte(name));
  const placement = p.placement.flatMap((part) => {
    const accountId = compte(part.accountName);
    return accountId === undefined ? [] : [{ accountId, share: { ...part.share } }];
  });
  return {
    tirelire: {
      id: ids.id,
      name: p.name,
      placement,
      openingBalance: p.openingBalance,
      openingDate: ids.openingDate,
      ...(p.rollover ? { rollover: { ...p.rollover } } : {}),
    },
    needs: p.needs.map((n) => suggestedNeed(n, { id: ids.newId(), tirelireId: ids.id })),
    flows: p.payments.map((f) =>
      suggestedFlow(f, 'dueDate', { id: ids.newId(), accountId: compte(f.accountName) ?? ids.principalId, tirelireId: ids.id }),
    ),
  };
}

/**
 * L'ordre que crée une proposition, ou rien s'il manque l'un de ses deux comptes chez qui l'écrit :
 * un ordre vers un compte retiré ne se propose pas.
 */
export function suggestedOrder(
  p: OrderSuggestion,
  ids: { id: Id; principalId: Id; compte: (name: string) => Id | undefined },
): PlannedFlow | undefined {
  const depuis = p.accountName === undefined ? ids.principalId : ids.compte(p.accountName);
  const vers = ids.compte(p.toAccountName);
  if (depuis === undefined || vers === undefined) return undefined;
  return suggestedFlow(p, 'transfer', { id: ids.id, accountId: depuis, counterpartAccountId: vers });
}

/**
 * Propositions à offrir dans l'assistant, lues dans le jeu d'exemple : tout ce qui le constitue,
 * opérations exceptées (porteur, 24 septembre 2026).
 *
 * L'exemple porte plusieurs versions d'un même flux ou d'un même besoin (D50, D51) : « Salaire » y
 * figure à 3 400 puis à 3 550 €, « Alimentation » à 900 puis à 950 €. Flux et besoins se proposent
 * avec **toutes leurs versions**, chacune avec ses dates : la ligne dit laquelle elle est. Plus rien
 * ne dépend donc de la date de lecture, que la signature garde pour ceux qui la donnent.
 */
export function budgetSuggestions(_asOf?: ISODate): BudgetSuggestions {
  const l = exampleLedger();

  // Les comptes : tous ceux de l'exemple, le compte clos et les comptes tiers compris (porteur,
  // 24 septembre 2026). L'exemple porte toujours son compte principal.
  const main = alive(l.accounts).find((a) => a.kind === 'principal')!;
  const mainAccount: MainAccountSuggestion = { name: main.name, balance: main.openingBalance };
  const accounts: AccountSuggestion[] = alive(l.accounts)
    .filter((a): a is Account & { kind: AccountSuggestion['kind'] } => a.kind !== 'principal')
    .map((a) => ({
      name: a.name,
      kind: a.kind,
      balance: a.openingBalance,
      ...(a.tracksSettlement
        ? { settlement: { threshold: a.settlementThreshold ?? 0, direction: a.settlementDirection ?? ('both' as const) } }
        : {}),
      ...(a.activeTo !== undefined ? { closed: true } : {}),
    }));

  return {
    mainAccount,
    accounts,
    incomes: flowSuggestions(l, 'income'),
    charges: flowSuggestions(l, 'fixedCharge'),
    tirelires: tirelireSuggestions(l),
    orders: orderSuggestions(l),
  };
}
