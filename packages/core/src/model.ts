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
export interface Periodicity {
  intervalMonths: number;
  anchorDate: ISODate;
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

/**
 * - `pivot`   : le compte réel par lequel tout transite (relevé importé).
 * - `holding` : compte d'accueil réel (livret, PEL…) qui héberge des enveloppes.
 * - `third`   : compte tiers, non importé, saisi à la main ; porte un solde à régler avec le pivot.
 */
export type AccountKind = 'pivot' | 'holding' | 'third';

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
  /** Jour de paie (1-31), seulement pour le pivot : début de la période budgétaire. */
  payDay?: number;
  /** Comptes tiers : en dessous de ce montant, on ne propose pas de virement de règlement. */
  settlementThreshold?: Cents;
  /** Comptes tiers : sens autorisé des virements de règlement. */
  settlementDirection?: SettlementDirection;
  deletedAt?: string;
}

// ---------------------------------------------------------------------------
// Enveloppes et besoins
// ---------------------------------------------------------------------------

export type Rollover = { mode: 'none' } | { mode: 'unlimited' } | { mode: 'capped'; months: number };

/**
 * Une enveloppe est un pot à solde unique (D28), réparti sur plusieurs comptes (D19) : sa
 * position réelle est un vecteur « compte → composante », reconstruit et jamais stocké
 * (`envelopeComponents`). Elle déclare où son argent devrait dormir (`placementAccountId`,
 * D20) ; l'écart entre position et placement nourrit le plan. Le report (D05, D29) porte sur
 * l'enveloppe : en fin de période, l'excédent au-delà de la réserve des besoins non récurrents
 * est libéré (`none`) ou plafonné (`capped`).
 */
export interface Envelope {
  id: Id;
  name: string;
  /** Compte où l'argent de l'enveloppe devrait se trouver. */
  placementAccountId: Id;
  /** Solde à `openingDate`, réputé sur le compte de placement. */
  openingBalance: Cents;
  openingDate: ISODate;
  /** Sort de l'excédent en fin de période ; `unlimited` par défaut. */
  rollover?: Rollover;
  deletedAt?: string;
}

/**
 * Un besoin de financement porté par une enveloppe (D28) :
 * - `recurring` : `amount` par période (lissé sur `periodicity.intervalMonths` périodes, 1 par défaut) ;
 * - `dueDate`   : `amount` pour chaque échéance de `periodicity`, rattrapage lissé sur les périodes restantes ;
 * - `goal`      : `monthlyAmount` par période jusqu'à `amount` (cible facultative).
 * Les priorités et planchers de D06 se posent sur les besoins ; le solde de l'enveloppe leur est
 * attribué dans l'ordre des priorités (D29).
 */
export type NeedKind = 'recurring' | 'dueDate' | 'goal';

export interface Need {
  id: Id;
  envelopeId: Id;
  kind: NeedKind;
  /** Libellé facultatif (« Taxe foncière ») ; sinon le nom de l'enveloppe. */
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
export function needName(n: Need, e: Envelope | undefined): string {
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
  /** Enveloppe par défaut de la catégorie (D32) : proposée quand une règle ou une saisie n'en fixe pas. */
  envelopeId?: Id;
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
 * - `fixedCharge` : prélèvement ou virement fixe payé depuis le compte, non couvert par une enveloppe.
 * - `dueDate`     : échéance payée depuis une enveloppe (l'enveloppe se vide à la date).
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
  /** dueDate : enveloppe vidée ; transfer : compte de contrepartie via `counterpartAccountId`. */
  envelopeId?: Id;
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
  deletedAt?: string;
}

// ---------------------------------------------------------------------------
// Opérations et affectations
// ---------------------------------------------------------------------------

export type OperationOrigin = 'imported' | 'manual';

export type OperationStatus =
  | 'pending' // à traiter
  | 'matched' // rapprochée d'un flux prévu
  | 'categorized' // catégorisée
  | 'transfer' // transfert interne apparié
  | 'oneOff'; // dépense ponctuelle

/**
 * Une opération est ventilée en une ou plusieurs lignes (`Allocation`), chacune
 * portant une catégorie et une enveloppe. L'opération simple a une seule ligne.
 * Sans aucune ligne, l'opération pèse sur le « non affecté » du compte.
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
  status: OperationStatus;
  /** Catégorie proposée par la source (banque, Linxo), à confirmer. */
  suggestedCategory?: string;
  /** Flux prévu rapproché (rapprochement de flux, D22). */
  plannedFlowId?: Id;
  /** Transfert interne : compte de contrepartie. */
  transferAccountId?: Id;
  /** Opération de contrepartie appariée (si les deux relevés sont importés). */
  transferOperationId?: Id;
  /** Import : rang parmi les opérations identiques du même jour (entre dans la clé). */
  rank?: number;
  deletedAt?: string;
}

/**
 * Ligne de ventilation. `amount` est une part du montant de l'opération, dans
 * le même signe (une dépense de 85 € ventilée en −60 alimentation et −25 vêtements).
 *
 * Effet sur l'enveloppe :
 *  - dépense ou revenu : `amount` tel quel (−80 € sur un budget) ;
 *  - virement interne (`transferAccountId` sur l'opération) : −`amount` si
 *    l'opération est lue côté compte de départ, +`amount` côté compte hôte de
 *    l'enveloppe (un virement de 350 € qui quitte le pivot vers le livret,
 *    ventilé −100/−50/−200, donne +100/+50/+200 aux enveloppes du livret).
 */
export interface Allocation {
  id: Id;
  operationId: Id;
  categoryId?: Id;
  envelopeId?: Id;
  amount: Cents;
  deletedAt?: string;
}

// ---------------------------------------------------------------------------
// Règles de catégorisation
// ---------------------------------------------------------------------------

export interface Rule {
  id: Id;
  pattern: string;
  categoryId?: Id;
  envelopeId?: Id;
  priority: number;
  deletedAt?: string;
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export interface Settings {
  /** Coussin minimum à laisser en non affecté sur le pivot. */
  pivotCushion: Cents;
  /** En dessous de ce montant, un écart de placement (D20) est « à surveiller » plutôt qu'« à faire ». */
  transferThreshold: Cents;
  /** Identifiant de cet appareil (pour l'horloge logique et le journal). */
  siteId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  pivotCushion: 0,
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
  envelopes: Envelope[];
  needs: Need[];
  categories: Category[];
  plannedFlows: PlannedFlow[];
  operations: Operation[];
  allocations: Allocation[];
  rules: Rule[];
  importProfiles: ImportProfile[];
  devices: Device[];
  settings: Settings;
}

export function emptyLedger(settings: Partial<Settings> = {}): Ledger {
  return {
    accounts: [],
    envelopes: [],
    needs: [],
    categories: [],
    plannedFlows: [],
    operations: [],
    allocations: [],
    rules: [],
    importProfiles: [],
    devices: [],
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

/** Filtre les entités non supprimées. */
export function alive<T extends { deletedAt?: string }>(items: T[]): T[] {
  return items.filter((i) => !i.deletedAt);
}
