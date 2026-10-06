/**
 * Les aides des champs (D43, #214).
 *
 * L'aide d'un champ est le texte indicatif qu'il montre tant qu'il est vide. Comme les raccourcis de
 * l'assistant, elle ne contient rien en propre : elle est une lecture du jeu d'exemple, et ce module
 * est la seule à la faire — les écrans n'écrivent aucune valeur d'exemple en dur. Les aides d'un même
 * formulaire viennent toutes d'une même ligne de l'exemple.
 *
 * Deux parties :
 *  - l'assistant : la ligne qui donne ses aides au formulaire d'une étape est celle que le premier
 *    raccourci restant apporterait, ou, quand il n'en reste aucun, la première ligne de l'exemple de
 *    cette étape ; ajouter une ligne qui recopie ces aides fait ce que fait le raccourci de cette
 *    ligne (versions datées et réglages que l'étape ne montre pas compris) ;
 *  - hors de l'assistant : la première ligne de l'exemple du genre du formulaire (le type du flux, du
 *    besoin ou du compte, la nature de la catégorie ou de la saisie), sans rien inventer pour un champ
 *    que l'exemple ne renseigne pas.
 */
import {
  activeAt,
  budgetSuggestions,
  entrySuggestions,
  monthsOf,
  type AccountKind,
  type AccountSuggestion,
  type CategoryNature,
  type CategorySuggestion,
  type Cents,
  type FlowSuggestion,
  type ISODate,
  type NeedKind,
  type NeedSuggestion,
  type PeriodUnit,
  type PlannedFlowKind,
  type TirelireSuggestion,
} from '@tirelire/core';

/** Un montant comme on le saisit : « 3 400,00 », les centimes toujours, un espace entre les milliers. */
export function montantAide(c: Cents): string {
  const [entier, centimes] = (Math.abs(c) / 100).toFixed(2).split('.') as [string, string];
  return `${c < 0 ? '-' : ''}${entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${centimes}`;
}

// ---------------------------------------------------------------------------------------------
// L'assistant
// ---------------------------------------------------------------------------------------------

/**
 * La ligne qui donne ses aides au formulaire d'une étape : celle que le premier raccourci restant de
 * l'étape apporterait, ou, quand il n'en reste aucun, la première ligne de l'exemple de cette étape.
 */
export function ligneDAide<T>(restants: readonly T[], toutes: readonly T[]): T | undefined {
  return restants[0] ?? toutes[0];
}

/** Un flux proposé : toutes ses versions, regroupées par leur nom dans l'ordre de l'exemple (D46, D51). */
export type FluxPropose = { name: string; versions: FlowSuggestion[] };
export function parNom(liste: FlowSuggestion[]): FluxPropose[] {
  const groupes: FluxPropose[] = [];
  for (const p of liste) {
    const groupe = groupes.find((g) => g.name === p.name);
    if (groupe) groupe.versions.push(p);
    else groupes.push({ name: p.name, versions: [p] });
  }
  return groupes;
}

/** La version que montre le raccourci d'un flux : celle en vigueur à la date de lecture, à défaut la première. */
export const versionMontree = (g: FluxPropose, asOf: ISODate): FlowSuggestion => g.versions.find((v) => activeAt(v, asOf)) ?? g.versions[0]!;

/** Le besoin que montre le raccourci d'une tirelire : celui en vigueur à la date de lecture, à défaut le premier. */
export const besoinMontre = (p: TirelireSuggestion, asOf: ISODate): NeedSuggestion | undefined => p.needs.find((n) => activeAt(n, asOf)) ?? p.needs[0];

/** Le montant que montre le raccourci d'une tirelire : celui de son besoin montré — la mensualité d'un objectif. */
export function montantDeLaTirelire(p: TirelireSuggestion, asOf: ISODate): Cents {
  const n = besoinMontre(p, asOf);
  return (n?.kind === 'goal' ? n.monthlyAmount : n?.amount) ?? 0;
}

/** Revenus et charges fixes : une même ligne pour « Quoi ? », « Combien ? », le rythme, le jour et le compte. */
export interface AideFlux {
  ligne: FluxPropose;
  /** La version montrée : la ligne de l'exemple dont viennent toutes les aides. */
  version: FlowSuggestion;
  name: string;
  amount: Cents;
  interval: number;
  unit: PeriodUnit;
  day: number;
}
export function aideFlux(restants: readonly FluxPropose[], toutes: readonly FluxPropose[], asOf: ISODate): AideFlux | undefined {
  const ligne = ligneDAide(restants, toutes);
  if (!ligne) return undefined;
  const version = versionMontree(ligne, asOf);
  return { ligne, version, name: ligne.name, amount: version.amount, interval: version.interval, unit: version.unit, day: version.day };
}
export interface SaisieFlux {
  name: string;
  amount: Cents | undefined;
  interval: number;
  unit: PeriodUnit;
  day: number;
  accountId: string;
}
/** La saisie recopie l'aide, champ par champ : elle vaut alors le raccourci de la ligne (`compteDeLAide` : le compte que l'exemple lui donne, ici). */
export const recopieFlux = (s: SaisieFlux, a: AideFlux, compteDeLAide: string): boolean =>
  s.name === a.name && s.amount === a.amount && s.interval === a.interval && s.unit === a.unit && s.day === a.day && s.accountId === compteDeLAide;

/** Budgets par période : le nom, le montant par période et le report. */
export interface AideCourant {
  ligne: TirelireSuggestion;
  name: string;
  amount: Cents;
  /** Garder ce qui n'a pas été dépensé : le report de la tirelire, gardé quand l'exemple n'en dit rien (D05). */
  keep: boolean;
}
export function aideCourant(restantes: readonly TirelireSuggestion[], toutes: readonly TirelireSuggestion[], asOf: ISODate): AideCourant | undefined {
  const ligne = ligneDAide(restantes, toutes);
  return ligne ? { ligne, name: ligne.name, amount: montantDeLaTirelire(ligne, asOf), keep: ligne.rollover?.mode !== 'none' } : undefined;
}
export const recopieCourant = (s: { name: string; amount: Cents | undefined; keep: boolean }, a: AideCourant): boolean =>
  s.name === a.name && s.amount === a.amount && s.keep === a.keep;

/**
 * Ajouter un besoin à une tirelire de l'étape Budgets : le nom et le montant par période d'un besoin
 * par période de l'exemple qui porte son propre nom (« Cours de piano », 45,00), toujours du même
 * besoin. Recopier ces deux champs ajoute ce que le raccourci de ce besoin apporterait, date de
 * début comprise (#344, #214).
 */
export interface AideBesoin {
  ligne: NeedSuggestion;
  name: string;
  amount: Cents;
}
export function aideBesoin(): AideBesoin | undefined {
  const besoins = budgetSuggestions().tirelires.flatMap((t) => t.needs).filter((n) => n.kind === 'recurring' && n.name !== undefined && n.amount !== undefined);
  const n = besoins[0];
  return n ? { ligne: n, name: n.name!, amount: n.amount! } : undefined;
}
export const recopieBesoin = (s: { name: string; amount: Cents | undefined }, a: AideBesoin): boolean => s.name === a.name && s.amount === a.amount;

/** Dépenses à échéance : le nom, le montant de la facture, son rythme, sa prochaine échéance, le compte et le prélèvement attendu. */
export interface AidePeriodique {
  ligne: TirelireSuggestion;
  name: string;
  amount: Cents;
  months: number;
  dueDate: ISODate | undefined;
  /** Le prélèvement que l'exemple attend pour cette échéance : il y en a un pour la taxe foncière, pas pour l'assurance auto. */
  withFlow: boolean;
  /** Le compte du prélèvement, par son nom, quand l'exemple ne le met pas sur le compte principal. */
  accountName: string | undefined;
}
export function aidePeriodique(restantes: readonly TirelireSuggestion[], toutes: readonly TirelireSuggestion[], asOf: ISODate): AidePeriodique | undefined {
  const ligne = ligneDAide(restantes, toutes);
  if (!ligne) return undefined;
  const n = besoinMontre(ligne, asOf);
  return {
    ligne,
    name: ligne.name,
    amount: n?.amount ?? 0,
    months: n?.periodicity ? monthsOf(n.periodicity) : 12,
    dueDate: n?.periodicity?.anchorDate,
    withFlow: ligne.payments.length > 0,
    accountName: ligne.payments[0]?.accountName,
  };
}
export const recopiePeriodique = (
  s: { name: string; amount: Cents | undefined; months: number; dueDate: string; withFlow: boolean; accountId: string },
  a: AidePeriodique,
  compteDeLAide: string,
): boolean =>
  s.name === a.name && s.amount === a.amount && s.months === a.months && s.dueDate === a.dueDate && s.withFlow === a.withFlow && s.accountId === compteDeLAide;

/** Épargne : le nom, le montant par période et la cible. */
export interface AideEpargne {
  ligne: TirelireSuggestion;
  name: string;
  monthly: Cents;
  target: Cents | undefined;
}
export function aideEpargne(restantes: readonly TirelireSuggestion[], toutes: readonly TirelireSuggestion[], asOf: ISODate): AideEpargne | undefined {
  const ligne = ligneDAide(restantes, toutes);
  if (!ligne) return undefined;
  const n = besoinMontre(ligne, asOf);
  return { ligne, name: ligne.name, monthly: montantDeLaTirelire(ligne, asOf), target: n?.kind === 'goal' ? n.amount : undefined };
}
export const recopieEpargne = (s: { name: string; monthly: Cents | undefined; target: Cents | undefined }, a: AideEpargne): boolean =>
  s.name === a.name && s.monthly === a.monthly && s.target === a.target;

/** Catégories : le nom et la nature. */
export interface AideCategorie {
  ligne: CategorySuggestion;
  name: string;
  nature: CategoryNature;
}
export function aideCategorie(restantes: readonly CategorySuggestion[], toutes: readonly CategorySuggestion[]): AideCategorie | undefined {
  const ligne = ligneDAide(restantes, toutes);
  return ligne ? { ligne, name: ligne.name, nature: ligne.nature } : undefined;
}
export const recopieCategorie = (s: { name: string; nature: CategoryNature }, a: AideCategorie): boolean => s.name === a.name && s.nature === a.nature;

/** Comptes : le nom, le type et le solde actuel. */
export interface AideCompte {
  ligne: AccountSuggestion;
  name: string;
  kind: AccountSuggestion['kind'];
  balance: Cents;
}
export function aideCompte(restants: readonly AccountSuggestion[], tous: readonly AccountSuggestion[]): AideCompte | undefined {
  const ligne = ligneDAide(restants, tous);
  return ligne ? { ligne, name: ligne.name, kind: ligne.kind, balance: ligne.balance } : undefined;
}
export const recopieCompte = (s: { name: string; kind: AccountKind; balance: Cents }, a: AideCompte): boolean =>
  s.name === a.name && s.kind === a.kind && s.balance === a.balance;

// ---------------------------------------------------------------------------------------------
// Hors de l'assistant : la première ligne de l'exemple du genre du formulaire
// ---------------------------------------------------------------------------------------------

/** Tirelire : le nom d'une tirelire de l'exemple. */
export function aidesDeTirelire(): { name: string | undefined } {
  return { name: budgetSuggestions().tirelires[0]?.name };
}

/**
 * Besoin : les valeurs d'un besoin de l'exemple du genre choisi — de préférence un besoin qui porte son
 * propre nom, puisque le champ « Nom » en a une valeur —, toutes de ce même besoin. Un genre que
 * l'exemple ne porte pas (le versement, D48) n'a aucune aide.
 */
export function aidesDeBesoin(kind: NeedKind): { name: string | undefined; amount: string | undefined; monthlyAmount: string | undefined } {
  const besoins = budgetSuggestions().tirelires.flatMap((t) => t.needs).filter((n) => n.kind === kind);
  const n = besoins.find((x) => x.name !== undefined) ?? besoins[0];
  return {
    name: n?.name,
    amount: n?.amount !== undefined ? montantAide(n.amount) : undefined,
    monthlyAmount: n?.monthlyAmount !== undefined ? montantAide(n.monthlyAmount) : undefined,
  };
}

/** Flux prévu : le nom, le montant et le motif de libellé d'un flux de l'exemple du type choisi, toujours du même flux. */
export function aidesDeFluxPrevu(kind: PlannedFlowKind): { name: string | undefined; amount: string | undefined; labelPattern: string | undefined } {
  const s = budgetSuggestions();
  const p: FlowSuggestion | undefined =
    kind === 'income' ? s.incomes[0] : kind === 'fixedCharge' ? s.charges[0] : kind === 'dueDate' ? s.tirelires.flatMap((t) => t.payments)[0] : s.orders[0];
  return { name: p?.name, amount: p ? montantAide(p.amount) : undefined, labelPattern: p?.labelPattern };
}

/** Catégorie : le nom d'une catégorie de l'exemple de la nature choisie. */
export function aidesDeCategorie(nature: CategoryNature): { name: string | undefined } {
  return { name: budgetSuggestions().categories.find((c) => c.nature === nature)?.name };
}

/** Saisie : le libellé, le montant et la catégorie d'une opération saisie de l'exemple de la nature choisie, toujours de la même opération. */
export function aidesDeSaisie(nature: 'expense' | 'income' | 'transfer'): { label: string | undefined; amount: string | undefined; newCategory: string | undefined } {
  const o = entrySuggestions().find((x) => x.nature === nature);
  return { label: o?.label, amount: o ? montantAide(o.amount) : undefined, newCategory: o?.categoryName };
}
