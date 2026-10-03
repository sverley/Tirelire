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
import { parseDate, todayISO } from './dates.js';
import { exampleLedger } from './example.js';
import {
  activeAt,
  alive,
  type Account,
  type AccountKind,
  type AmountTolerance,
  type Cents,
  type Id,
  type ISODate,
  type Ledger,
  type PeriodUnit,
  type PlannedFlow,
  type SettlementDirection,
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
}

export type IncomeSuggestion = FlowSuggestion;
export type ChargeSuggestion = FlowSuggestion;

export interface EverydaySuggestion {
  name: string;
  amount: Cents;
  /** Report du reliquat en fin de période (D05). */
  keep: boolean;
}

export interface PeriodicSuggestion {
  name: string;
  amount: Cents;
  interval: number;
  unit: PeriodUnit;
  /** Mois et jour de l'échéance ; l'année est celle de la prochaine occurrence. */
  month: number;
  day: number;
}

export interface SavingsSuggestion {
  name: string;
  monthly: Cents;
  target?: Cents;
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
  everyday: EverydaySuggestion[];
  periodic: PeriodicSuggestion[];
  savings: SavingsSuggestion[];
}

/** Les flux d'un genre, dans l'ordre de l'exemple : toutes leurs versions, quelle que soit la date de lecture (D51). */
function flowSuggestions(l: Ledger, kind: 'income' | 'fixedCharge'): FlowSuggestion[] {
  const comptes = alive(l.accounts);
  return alive(l.plannedFlows)
    .filter((f) => f.kind === kind)
    .map((f) => {
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
      };
    });
}

/**
 * Le flux que crée une proposition : ce que l'exemple en dit, et rien d'autre — la catégorie, qui
 * n'est pas une proposition, reste à ceux qui la donnent. `id` et `accountId` sont ceux de qui
 * l'écrit : l'identité d'un flux et le compte où il se trouve dans le projet ne sont pas ceux de
 * l'exemple.
 */
export function suggestedFlow(
  p: FlowSuggestion,
  kind: 'income' | 'fixedCharge',
  ids: { id: Id; accountId: Id },
): PlannedFlow {
  return {
    id: ids.id,
    name: p.name,
    kind,
    amount: kind === 'income' ? p.amount : -p.amount,
    accountId: ids.accountId,
    periodicity: { interval: p.interval, unit: p.unit, anchorDate: p.anchorDate },
    dateWindowDays: p.dateWindowDays,
    ...(p.amountTolerance ? { amountTolerance: { ...p.amountTolerance } } : {}),
    ...(p.labelPattern !== undefined ? { labelPattern: p.labelPattern } : {}),
    ...(p.variable ? { variable: true } : {}),
    ...(p.activeFrom !== undefined ? { activeFrom: p.activeFrom } : {}),
    ...(p.activeTo !== undefined ? { activeTo: p.activeTo } : {}),
  };
}

/**
 * Propositions à offrir dans l'assistant, lues dans le jeu d'exemple.
 *
 * L'exemple porte plusieurs versions d'un même flux ou d'un même besoin (D50, D51) : « Salaire » y
 * figure à 3 400 puis à 3 550 €, « Alimentation » à 900 puis à 950 €. Les **flux** — revenus et
 * charges fixes — se proposent avec toutes leurs versions, chacune avec ses dates : la ligne dit
 * laquelle elle est. Les **besoins** ne se proposent encore que dans la version en vigueur à
 * `asOf`, sinon l'assistant offrirait deux lignes de même nom sans dire laquelle prendre.
 */
export function budgetSuggestions(asOf: ISODate = todayISO()): BudgetSuggestions {
  const l = exampleLedger();
  const needs = alive(l.needs).filter((n) => activeAt(n, asOf));
  // Le nom du besoin s'il en porte un — une tirelire peut en porter plusieurs (D28), et « Cours de
  // piano » se reconnaît mieux que « Enfants et loisirs » répété deux fois.
  const nameOf = (n: { name?: string; tirelireId?: string }) =>
    n.name ?? alive(l.tirelires).find((t) => t.id === n.tirelireId)?.name ?? '';

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

  const incomes: IncomeSuggestion[] = flowSuggestions(l, 'income');
  const charges: ChargeSuggestion[] = flowSuggestions(l, 'fixedCharge');

  const everyday: EverydaySuggestion[] = needs
    .filter((n) => n.kind === 'recurring')
    .map((n) => ({
      name: nameOf(n),
      amount: n.amount ?? 0,
      keep: alive(l.tirelires).find((t) => t.id === n.tirelireId)?.rollover?.mode !== 'none',
    }));

  const periodic: PeriodicSuggestion[] = needs
    .filter((n) => n.kind === 'dueDate')
    .map((n) => {
      const { m, d } = parseDate(n.periodicity?.anchorDate ?? '2027-01-01');
      return {
        name: nameOf(n),
        amount: n.amount ?? 0,
        ...(n.periodicity ? { interval: n.periodicity.interval, unit: n.periodicity.unit } : { interval: 12, unit: 'month' as const }),
        month: m,
        day: d,
      };
    });

  const savings: SavingsSuggestion[] = needs
    .filter((n) => n.kind === 'goal')
    .map((n) => ({
      name: nameOf(n),
      monthly: n.monthlyAmount ?? 0,
      ...(n.amount !== undefined ? { target: n.amount } : {}),
    }));

  return { mainAccount, accounts, incomes, charges, everyday, periodic, savings };
}

/**
 * Prochaine occurrence d'un jour et d'un mois donnés, à partir de `from` : l'assistant s'en sert
 * pour dater l'échéance proposée sans demander l'année.
 */
export function nextDueDate(month: number, day: number, from: string): string {
  const { y, m, d } = parseDate(from);
  const year = month > m || (month === m && day >= d) ? y : y + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
