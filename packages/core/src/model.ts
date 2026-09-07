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
// Enveloppes (sous-comptes comptables)
// ---------------------------------------------------------------------------

/**
 * - `provision` : accumule pour une échéance (montant `target`, périodicité) puis se vide.
 * - `goal`      : épargne alimentée d'un montant mensuel fixe, cible facultative.
 * - `budget`    : dépense courante, montant par période (mensuel ou annuel), avec ou sans report.
 */
export type EnvelopeKind = 'provision' | 'goal' | 'budget';

export type Rollover = { mode: 'none' } | { mode: 'unlimited' } | { mode: 'capped'; months: number };

export interface Envelope {
  id: Id;
  name: string;
  kind: EnvelopeKind;
  /** Compte réel qui héberge l'enveloppe. */
  accountId: Id;
  openingBalance: Cents;
  openingDate: ISODate;
  /** provision : montant de l'échéance ; goal : cible facultative ; budget : montant par période. */
  target?: Cents;
  /** provision : échéance (intervalle + ancrage) ; budget : 1 (mensuel) ou 12 (annuel) avec ancrage. */
  periodicity?: Periodicity;
  /** goal : montant mensuel fixe. */
  monthlyAmount?: Cents;
  /** budget : sort du reliquat en fin de période. */
  rollover?: Rollover;
  /** Ordre de financement : plus petit = financé en premier. */
  priority: number;
  deletedAt?: string;
}

/** Priorités par défaut ; les provisions passent avant, les budgets confort après. */
export const DEFAULT_PRIORITY: Record<EnvelopeKind, number> = {
  provision: 10,
  budget: 20,
  goal: 30,
};

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

export type CategoryNature = 'expense' | 'income';

export interface Category {
  id: Id;
  name: string;
  parentId?: Id;
  /** Enveloppe budget que cette catégorie consomme (facultatif : sinon simple suivi). */
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
  /** Fenêtre de pointage en jours autour de la date attendue. */
  dateWindowDays: number;
  amountTolerance?: AmountTolerance;
  /** Motif de libellé (expression régulière, insensible à la casse) pour le pointage. */
  labelPattern?: string;
  /** Revenu variable : tolérance large, jamais pointé automatiquement sans confirmation. */
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
  | 'matched' // pointée sur un flux prévu
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
  /** Flux prévu pointé. */
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
  /** Début de l'année budgétaire (mois 1-12, jour 1-31). */
  budgetYearStart: { month: number; day: number };
  /** Coussin minimum à laisser en non affecté sur le pivot. */
  pivotCushion: Cents;
  /** Identifiant de cet appareil (pour l'horloge logique et le journal). */
  siteId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  budgetYearStart: { month: 1, day: 1 },
  pivotCushion: 0,
  siteId: 'local',
};

/** L'ensemble des données d'un foyer, tel que chargé en mémoire. */
export interface Ledger {
  accounts: Account[];
  envelopes: Envelope[];
  categories: Category[];
  plannedFlows: PlannedFlow[];
  operations: Operation[];
  allocations: Allocation[];
  rules: Rule[];
  importProfiles: ImportProfile[];
  settings: Settings;
}

export function emptyLedger(settings: Partial<Settings> = {}): Ledger {
  return {
    accounts: [],
    envelopes: [],
    categories: [],
    plannedFlows: [],
    operations: [],
    allocations: [],
    rules: [],
    importProfiles: [],
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

/** Filtre les entités non supprimées. */
export function alive<T extends { deletedAt?: string }>(items: T[]): T[] {
  return items.filter((i) => !i.deletedAt);
}
