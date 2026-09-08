/**
 * Modèle de données de Tirelire.
 *
 * Conventions :
 *  - les montants sont des entiers en centimes (`Cents`), signés ;
 *  - les dates sont des chaînes ISO `AAAA-MM-JJ` (`ISODate`), sans heure ni fuseau ;
 *  - toute entité porte un `id` (UUID v7 pour ce que l'utilisateur crée,
 *    clé déterministe pour ce qui vient de la banque) et un `deletedAt`
 *    facultatif : on ne supprime jamais physiquement, on marque.
 */

import type { ImportProfile } from './importer.js';

export type Cents = number;
export type ISODate = string;
export type Id = string;

/** Périodicité générique : tous les `intervalMonths` mois à partir de `anchorDate`. */
/** Unité d'un rythme. Le mois reste la plus courante ; la semaine sert aux revenus non mensuels. */
export type PeriodUnit = 'day' | 'week' | 'month' | 'year';

export interface Periodicity {
  /** Nombre d'unités entre deux occurrences (D47). */
  interval: number;
  unit: PeriodUnit;
  anchorDate: ISODate;
  /**
   * Ancienne forme, lue mais plus jamais écrite (D30, D47). La migration 8 → 9 la convertit ; ce
   * champ n'existe que pour qu'un rythme écrit par un appareil non migré reste interprétable.
   */
  intervalMonths?: number;
}

/** Rythme effectif, quelle que soit la forme dans laquelle il a été écrit. */
export function stepOf(p: Periodicity): { interval: number; unit: PeriodUnit } {
  if (p.interval && p.unit) return { interval: p.interval, unit: p.unit };
  return { interval: p.intervalMonths ?? 1, unit: 'month' };
}

/**
 * Équivalent en mois d'un rythme, pour les calculs de lissage. Approché pour les jours et les
 * semaines — un mois ne fait pas un nombre entier de semaines — ce qui suffit à répartir une
 * dotation, jamais à dater une occurrence (`nextOccurrence` fait, lui, du calendrier exact).
 */
export function monthsOf(p: Periodicity): number {
  const { interval, unit } = stepOf(p);
  const JOURS_PAR_MOIS = 365.2425 / 12;
  if (unit === 'day') return interval / JOURS_PAR_MOIS;
  if (unit === 'week') return (interval * 7) / JOURS_PAR_MOIS;
  if (unit === 'year') return interval * 12;
  return interval;
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

/**
 * Nature du compte, et rien d'autre (D45) : la façon dont les opérations y entrent — import d'un
 * relevé ou saisie à la main — n'en fait pas partie. Tout compte peut être importé dès lors que
 * l'import sait attribuer chaque ligne à un compte (par son numéro, D18, ou par le compte choisi
 * pour le fichier entier).
 *
 * - `principal` : le compte par lequel tout transite ; il n'y en a qu'un.
 * - `courant`   : un autre compte courant (compte joint, compte d'un membre du foyer).
 * - `epargne`   : livret, PEL, assurance-vie… il héberge des tirelires.
 */
export type AccountKind = 'principal' | 'courant' | 'epargne';

export type SettlementDirection = 'both' | 'toThird' | 'fromThird';

export interface Account {
  id: Id;
  name: string;
  kind: AccountKind;
  bank?: string;
  /** Numéro de compte ou IBAN, saisi ou mémorisé depuis un import (voir `matchAccountByNumber`). */
  accountNumber?: string;
  openingBalance: Cents;
  openingDate: ISODate;
  /**
   * Suivre un **solde à régler** avec le compte principal (D04, D45). Utile quand les dépenses
   * faites depuis ce compte sont réellement à la charge du foyer : elles créent une dette d'un
   * compte envers l'autre, que le plan propose de solder. Indépendant de la nature du compte et de
   * la façon dont ses opérations y sont entrées.
   */
  tracksSettlement?: boolean;
  /** En dessous de ce montant, on ne propose pas de virement de règlement. */
  settlementThreshold?: Cents;
  /** Sens autorisé des virements de règlement. */
  settlementDirection?: SettlementDirection;
  deletedAt?: string;
}

// ---------------------------------------------------------------------------
// Tirelires et besoins
// ---------------------------------------------------------------------------

export type Rollover = { mode: 'none' } | { mode: 'unlimited' } | { mode: 'capped'; months: number };

/**
 * Une tirelire est un pot à solde unique (D28), réparti sur plusieurs comptes (D19) : sa
 * position réelle est un vecteur « compte → composante », reconstruit et jamais stocké
 * (`tirelireComponents`). Elle déclare où son argent devrait dormir (`placementAccountId`,
 * D20) ; l'écart entre position et placement nourrit le plan. Le report (D05, D29) porte sur
 * la tirelire : en fin de période, l'excédent au-delà de la réserve des besoins non récurrents
 * est libéré (`none`) ou plafonné (`capped`).
 */
/**
 * Composante voulue du placement (D38) : la part du solde de la tirelire qui devrait se trouver
 * sur ce compte. `variable` désigne le reste ; il n'y en a qu'une.
 */
export interface PlacementPart {
  accountId: Id;
  share: Share;
}

export interface Tirelire {
  id: Id;
  name: string;
  /**
   * Où l'argent de la tirelire devrait dormir (D20, D38) : une répartition, pas un compte. Vide,
   * elle ne produit aucun écart — l'argent est bien là où il est.
   */
  placement: PlacementPart[];
  /** Solde à `openingDate`, réputé sur le premier compte du placement. */
  openingBalance: Cents;
  openingDate: ISODate;
  /** Sort de l'excédent en fin de période ; `unlimited` par défaut. */
  rollover?: Rollover;
  deletedAt?: string;
}

/**
 * Un besoin de financement porté par une tirelire (D28) :
 * - `recurring` : `amount` par période (lissé sur `periodicity.intervalMonths` périodes, 1 par défaut) ;
 * - `dueDate`   : `amount` pour chaque échéance de `periodicity`, rattrapage lissé sur les périodes restantes ;
 * - `goal`      : `monthlyAmount` par période jusqu'à `amount` (cible facultative).
 * Les priorités et planchers de D06 se posent sur les besoins ; le solde de la tirelire leur est
 * attribué dans l'ordre des priorités (D29).
 */
export type NeedKind = 'recurring' | 'dueDate' | 'goal';

export interface Need {
  id: Id;
  tirelireId: Id;
  kind: NeedKind;
  /** Libellé facultatif (« Taxe foncière ») ; sinon le nom de la tirelire. */
  name?: string;
  /** recurring : montant par période ; dueDate : montant de l'échéance ; goal : cible facultative. */
  amount?: Cents;
  /** recurring : 1 (mensuel) ou 12 (annuel) avec ancrage ; dueDate : échéance (intervalle + ancrage). */
  periodicity?: Periodicity;
  /** goal : mensualité. */
  monthlyAmount?: Cents;
  /** Ordre de financement : plus petit = servi en premier. */
  priority: number;
  deletedAt?: string;
}

/** Priorités par défaut ; les échéances passent avant, les objectifs après. */
export const DEFAULT_PRIORITY: Record<NeedKind, number> = {
  dueDate: 10,
  recurring: 20,
  goal: 30,
};

/** Nom affiché d'un besoin. */
export function needName(n: Need, e: Tirelire | undefined): string {
  return n.name ?? e?.name ?? '';
}

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

export type CategoryNature = 'expense' | 'income';

export interface Category {
  id: Id;
  name: string;
  parentId?: Id;
  /** Tirelire par défaut de la catégorie (D32) : proposée quand une règle ou une saisie n'en fixe pas. */
  tirelireId?: Id;
  /** `income` pour les catégories de revenus. */
  nature: CategoryNature;
  deletedAt?: string;
}

/** Compare deux noms de catégorie sans tenir compte de la casse ni des accents. */
function sameCategoryName(a: string, b: string): boolean {
  const fold = (s: string) =>
    s
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  return fold(a) === fold(b) && fold(a) !== '';
}

/**
 * Cherche, parmi les catégories vivantes de même nature, celle qui porte déjà ce nom
 * (insensible à la casse et aux accents). Sert à éviter les doublons quand une catégorie
 * est créée à la volée depuis une opération.
 */
export function findCategoryByName(categories: Category[], name: string, nature: CategoryNature): Category | undefined {
  return categories.find((c) => !c.deletedAt && c.nature === nature && sameCategoryName(c.name, name));
}

// ---------------------------------------------------------------------------
// Flux prévus
// ---------------------------------------------------------------------------

/**
 * - `income`      : revenu attendu (salaire, loyer, aides).
 * - `fixedCharge` : prélèvement ou virement fixe payé depuis le compte, non couvert par une tirelire.
 * - `dueDate`     : échéance payée depuis une tirelire (la tirelire se vide à la date).
 * - `transfer`    : virement interne attendu entre deux comptes suivis.
 */
export type PlannedFlowKind = 'income' | 'fixedCharge' | 'dueDate' | 'transfer';

export interface AmountTolerance {
  abs?: Cents;
  pct?: number;
}

export interface PlannedFlow {
  id: Id;
  name: string;
  kind: PlannedFlowKind;
  /** Signé : positif = crédit sur `accountId`, négatif = débit. */
  amount: Cents;
  accountId: Id;
  /** dueDate : tirelire vidée ; transfer : compte de contrepartie via `counterpartAccountId`. */
  tirelireId?: Id;
  counterpartAccountId?: Id;
  categoryId?: Id;
  periodicity: Periodicity;
  /** Fenêtre de rapprochement de flux en jours autour de la date attendue. */
  dateWindowDays: number;
  amountTolerance?: AmountTolerance;
  /** Motif de libellé (expression régulière, insensible à la casse) pour le rapprochement de flux. */
  labelPattern?: string;
  /** Revenu variable : tolérance large, jamais rapproché d'un flux automatiquement sans confirmation. */
  variable?: boolean;
  activeFrom?: ISODate;
  activeTo?: ISODate;
  /** Le flux engendre-t-il une règle déterministe (D24) ? */
  makesRule?: boolean;
  /**
   * Virement permanent : ventilation prévue par couple de comptes (D21), calculée d'avance par le
   * plan. Si le montant constaté diffère du prévu, elle est rejouée par l'ordre de financement de
   * D06 plutôt qu'appliquée telle quelle — un prorata saupoudrerait au lieu de servir les planchers.
   */
  plannedAllocation?: Array<{ tirelireId: Id; share: Share }>;
  deletedAt?: string;
}

// ---------------------------------------------------------------------------
// Opérations et affectations
// ---------------------------------------------------------------------------

export type OperationOrigin = 'imported' | 'manual';

/**
 * État d'une opération (D22). La vérité est ce qui est verrouillé :
 *  - `untreated` : aucune règle ne l'a vue ; elle peut porter une classification proposée
 *    par une règle « Ne rien faire », qui n'est donc pas une décision ;
 *  - `reconciled` : classée par une règle, reprise à chaque passage, malléable ;
 *  - `locked` : plus aucune règle ne l'atteint ; toute modification manuelle verrouille.
 * Seul l'utilisateur déverrouille, à l'unité ou par action groupée (D26).
 */
export type OperationState = 'untreated' | 'reconciled' | 'locked';

export const OPERATION_STATES: OperationState[] = ['untreated', 'reconciled', 'locked'];

/**
 * Une opération est ventilée en une ou plusieurs lignes (`Allocation`) à parts (D27), chacune
 * portant une catégorie et une tirelire. Sans aucune ligne, elle vaut une ligne variable sans
 * classement : tout son montant pèse sur le « non affecté » du compte.
 */
export interface Operation {
  id: Id;
  accountId: Id;
  origin: OperationOrigin;
  date: ISODate;
  label: string;
  normalizedLabel: string;
  /** Libellé complet fourni par la banque (références, motifs). */
  details?: string;
  /** Signé : négatif = débit du compte. */
  amount: Cents;
  /** État de traitement (D22) ; la nature (virement, ponctuelle) est portée à part. */
  state: OperationState;
  /** Dépense exceptionnelle : comptée dans les soldes, exclue des moyennes du bilan. */
  oneOff?: boolean;
  /** Catégorie proposée par la source (banque, Linxo), à confirmer. */
  suggestedCategory?: string;
  /** Flux prévu rapproché (rapprochement de flux, D22) : ne change aucun état à lui seul. */
  plannedFlowId?: Id;
  /** Transfert interne : compte de contrepartie. */
  transferAccountId?: Id;
  /** Opération de contrepartie appariée (si les deux relevés sont importés). */
  transferOperationId?: Id;
  /** Import : rang parmi les opérations identiques du même jour (entre dans la clé). */
  rank?: number;
  deletedAt?: string;
}

/** Une opération verrouillée est de la vérité : aucune règle ne la réécrit (D22). */
export function isLocked(op: Operation): boolean {
  return op.state === 'locked';
}

/**
 * Part d'une ligne de ventilation (D27) : un montant fixe, un pourcentage du montant de
 * l'opération, ou la part variable — le reste, bornée à zéro, jamais négative. Une seule ligne
 * variable par ventilation ; une opération sans ligne vaut une ligne variable non classée.
 */
export type Share =
  | { kind: 'fixed'; amount: Cents }
  | { kind: 'percent'; pct: number }
  | { kind: 'variable' };

/**
 * Ligne de ventilation. Son montant résolu est une part du montant de l'opération, dans le même
 * signe (une dépense de 85 € ventilée en −60 alimentation et le reste en vêtements).
 *
 * Effet sur la tirelire (D19) : le montant sur le compte de l'opération ; pour un virement
 * interne, aussi son opposé sur le compte de contrepartie, ce qui déplace une composante sans
 * changer le solde.
 */
export interface Allocation {
  id: Id;
  operationId: Id;
  categoryId?: Id;
  tirelireId?: Id;
  share: Share;
  deletedAt?: string;
}

/** Ligne fixe (raccourci de lecture). */
export function fixedShare(amount: Cents): Share {
  return { kind: 'fixed', amount };
}

// ---------------------------------------------------------------------------
// Règles (D23)
// ---------------------------------------------------------------------------

/**
 * Sélection d'une règle ou d'une action groupée : tous les critères renseignés doivent être
 * remplis. `labelPattern` est une expression régulière insensible à la casse, éprouvée sur le
 * libellé, le libellé normalisé et le détail.
 */
export interface AutomationSelection {
  labelPattern?: string;
  accountId?: Id;
  /** Bornes de montant, dans le signe de l'opération (−5000 à −1000 pour de grosses dépenses). */
  amountMin?: Cents;
  amountMax?: Cents;
  dateFrom?: ISODate;
  dateTo?: ISODate;
}

/**
 * Effet d'une règle sur l'état d'une opération (D23) :
 *  - `lock`      : verrouille, l'opération devient de la vérité ;
 *  - `reconcile` : la marque rapprochée, donc reprise à chaque passage ;
 *  - `none`      : ne touche pas à l'état — l'opération peut porter une classification tout en
 *                  restant non traitée, ce que l'interface doit savoir distinguer de « rien dessus » ;
 *  - `unlock`    : réservé aux actions groupées (D26), indisponible dans une règle.
 */
export type AutomationStateAction = 'lock' | 'reconcile' | 'none' | 'unlock';

/**
 * Action d'une règle : chaque champ est facultatif, et seuls les champs renseignés écrasent ce
 * qu'une règle moins prioritaire a posé. `allocation` remplace la ventilation entière ; une part
 * variable la rend rejouable à montant inconnu d'avance (D27).
 */
export interface AutomationAction {
  categoryId?: Id;
  tirelireId?: Id;
  allocation?: Array<{ categoryId?: Id; tirelireId?: Id; share: Share }>;
  oneOff?: boolean;
  state?: AutomationStateAction;
}

/**
 * Une règle est un automatisme, pas de la vérité : elle se rejoue à chaque passage sur les
 * opérations non verrouillées. Le `rank` tranche les désaccords — les règles s'appliquent du rang
 * le plus élevé au rang 1, la plus prioritaire écrivant en dernier. Il est stocké comme clé
 * triable (D31) plutôt que comme index, pour que deux appareils qui réordonnent en même temps
 * convergent au lieu de produire des doublons.
 *
 * Les périodes de validité rendent les règles rejouables dans l'ordre chronologique sur un
 * historique importé : une règle archivée (`validTo`) ne sélectionne plus rien après sa fin.
 */
export interface Automation {
  id: Id;
  name?: string;
  selection: AutomationSelection;
  action: AutomationAction;
  /** Clé de rang triable ; comparée en ordre lexicographique, l'identifiant tranche les égalités. */
  rank: string;
  /** Validité : bornes sur la date de l'opération, pas sur l'horloge. */
  validFrom?: ISODate;
  validTo?: ISODate;
  /** Règle engendrée par un flux prévu (D24) : archivée et remplacée quand le flux change. */
  flowId?: Id;
  deletedAt?: string;
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export interface Settings {
  /**
   * Jour du mois où commence la période budgétaire (1-31), D44. C'est un choix du foyer, pas une
   * propriété d'un compte : un compte vit avec ou sans paie. L'assistant propose de le caler sur le
   * jour du principal revenu, mais rien n'y oblige — `1` redonne le mois calendaire.
   */
  periodStartDay: number;
  /** Coussin minimum à laisser en non affecté sur le compte principal. */
  principalCushion: Cents;
  /** En dessous de ce montant, un écart de placement (D20) est « à surveiller » plutôt qu'« à faire ». */
  transferThreshold: Cents;
  /** Identifiant de cet appareil (pour l'horloge logique et le journal). */
  siteId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  periodStartDay: 1,
  principalCushion: 0,
  transferThreshold: 1000,
  siteId: 'local',
};

/** L'ensemble des données d'un foyer, tel que chargé en mémoire. */
/** Un appareil connu du foyer (synchronisé) : identifiant = `siteId`. */
export interface Device {
  id: Id;
  name: string;
  /** Prénom ou nom de la personne qui utilise l'appareil. */
  user?: string;
  lastSeen?: string;
  deletedAt?: string;
}

export interface Ledger {
  accounts: Account[];
  tirelires: Tirelire[];
  needs: Need[];
  categories: Category[];
  plannedFlows: PlannedFlow[];
  operations: Operation[];
  allocations: Allocation[];
  automations: Automation[];
  importProfiles: ImportProfile[];
  devices: Device[];
  settings: Settings;
}

export function emptyLedger(settings: Partial<Settings> = {}): Ledger {
  return {
    accounts: [],
    tirelires: [],
    needs: [],
    categories: [],
    plannedFlows: [],
    operations: [],
    allocations: [],
    automations: [],
    importProfiles: [],
    devices: [],
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

/** Filtre les entités non supprimées. */
export function alive<T extends { deletedAt?: string }>(items: T[]): T[] {
  return items.filter((i) => !i.deletedAt);
}
