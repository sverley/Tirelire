/**
 * Description des tables : une seule source pour créer le schéma SQLite, lire et écrire les
 * lignes, et les échanger entre instances. Chaque table porte en plus une colonne `hlc` :
 * l'horloge de la dernière écriture de la ligne, appareil compris (D58).
 *
 * Les noms SQL sont ceux du domaine (D39, D42, D58) : la propriété `tirelireId` est la colonne
 * `tirelire_id`, sans exception. Une colonne obligatoire est `NOT NULL`, une colonne à valeurs
 * énumérées porte un `CHECK` nommé `table.colonne` : le fichier refuse ce qui ne se lit pas, et
 * `rowProblem` dit la même chose avant d'écrire. Une règle qui lie plusieurs colonnes d'une ligne
 * — le compte principal, unique et présent — est une contrainte de table, nommée de même, que
 * `rowProblem` vérifie aussi, localement comme à la réception.
 */
import {
  ACCOUNT_KINDS,
  CATEGORY_NATURES,
  FLOW_ORIGINS,
  MAIN_ACCOUNT_ID,
  NEED_KINDS,
  OPERATION_ORIGINS,
  OPERATION_STATES,
  PLANNED_FLOW_KINDS,
  REPLENISHMENT_KINDS,
  SETTLEMENT_DIRECTIONS,
} from './model.js';
import { IMPORT_DATE_FORMATS, IMPORT_DELIMITERS, IMPORT_ENCODINGS, IMPORT_SOURCES } from './importer.js';
import {
  ACTION,
  COLONNES_IMPORT,
  estDate,
  estHorodatage,
  PART,
  PLACEMENT,
  problemeDeForme,
  REPORT,
  RYTHME,
  SELECTION,
  TABLE_COMPTES,
  TOLERANCE,
  type Description,
} from './formes.js';

export type ColumnType = 'text' | 'integer' | 'real' | 'json' | 'boolean';

export interface ColumnDef {
  /** Nom de la propriété en TypeScript (camelCase). */
  prop: string;
  /** Nom de la colonne SQL : la propriété en snake_case. */
  col: string;
  type: ColumnType;
  /** Obligatoire : jamais vide (`NOT NULL`). */
  required?: boolean;
  /** Valeurs permises (`CHECK`) ; un booléen n'en a que deux, 0 et 1. */
  values?: readonly string[];
  /** Un texte de forme fixe : une date `AAAA-MM-JJ`, ou un horodatage comme l'écrit `toISOString`. */
  form?: 'date' | 'instant';
  /** Une colonne qui désigne une ligne d'une autre table : le nom SQL de cette table (#198). */
  ref?: string;
  /** La forme d'une colonne JSON, une fois lue ; ses identifiants y portent la table qu'ils désignent. */
  shape?: Description;
}

/** Une règle qui lie plusieurs colonnes d'une ligne : son `CHECK` dans le fichier, et le même refus dit en français. */
export interface TableConstraint {
  /** Nom du `CHECK`, `table.règle`. */
  name: string;
  /** L'expression SQL du `CHECK`, sur les colonnes de la ligne. */
  sql: string;
  /** Ce qui empêche d'écrire la ligne, en nommant la table et la colonne ; `undefined` si elle s'écrit. */
  problem: (id: string, v: Record<string, string | number | null>) => string | undefined;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  constraints?: TableConstraint[];
}

interface Options {
  required?: boolean;
  values?: readonly string[];
  form?: 'date' | 'instant';
  ref?: string;
  shape?: Description;
}

const c = (prop: string, type: ColumnType = 'text', opts: Options = {}): ColumnDef => ({
  prop,
  col: prop.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()),
  type,
  ...opts,
});

/** Colonne obligatoire. */
const req = (prop: string, type: ColumnType = 'text'): ColumnDef => c(prop, type, { required: true });

/** Colonne à valeurs énumérées, obligatoire ou non. */
const oneOf = (prop: string, values: readonly string[], required = false): ColumnDef => c(prop, 'text', { values, ...(required ? { required } : {}) });

/** Colonne qui désigne une ligne d'une autre table, obligatoire ou non. */
const ref = (prop: string, table: string, required = false): ColumnDef => c(prop, 'text', { ref: table, ...(required ? { required } : {}) });

/** Date `AAAA-MM-JJ`, obligatoire ou non. */
const date = (prop: string, required = false): ColumnDef => c(prop, 'text', { form: 'date', ...(required ? { required } : {}) });

/** Colonne JSON d'une forme donnée, obligatoire ou non. */
const json = (prop: string, shape: Description, required = false): ColumnDef => c(prop, 'json', { shape, ...(required ? { required } : {}) });

const ID = req('id');
const DELETED_AT = c('deletedAt', 'text', { form: 'instant' });

export const TABLES: Record<string, TableDef> = {
  accounts: {
    name: 'accounts',
    columns: [
      ID,
      req('name'),
      oneOf('kind', ACCOUNT_KINDS, true),
      c('bank'),
      c('accountNumber'),
      req('openingBalance', 'integer'),
      date('openingDate', true),
      c('tracksSettlement', 'boolean'),
      c('settlementThreshold', 'integer'),
      oneOf('settlementDirection', SETTLEMENT_DIRECTIONS),
      date('activeFrom'), // D56
      date('activeTo'),
      DELETED_AT,
    ],
    constraints: [
      {
        // Le compte principal existe dans toute base et il est unique (D40, D58) : le genre
        // `principal` et l'identifiant `acc-principal` vont ensemble, et cette ligne ne se
        // supprime pas.
        name: 'accounts.principal',
        sql: `(kind = 'principal') = (id = '${MAIN_ACCOUNT_ID}') AND (id <> '${MAIN_ACCOUNT_ID}' OR deleted_at IS NULL)`,
        problem: (id, v) => {
          const principal = v['kind'] === 'principal';
          if (principal && id !== MAIN_ACCOUNT_ID)
            return `accounts.kind vaut « principal » pour « ${id} » : le compte principal existe déjà, unique, sous « ${MAIN_ACCOUNT_ID} ».`;
          if (!principal && id === MAIN_ACCOUNT_ID)
            return `accounts.kind vaut « ${String(v['kind'])} » pour le compte principal : il reste « principal ».`;
          if (principal && v['deleted_at'] != null) return `accounts.deleted_at est posé sur le compte principal : il ne se supprime pas.`;
          return undefined;
        },
      },
    ],
  },
  tirelires: {
    name: 'tirelires',
    columns: [ID, req('name'), json('placement', PLACEMENT, true), req('openingBalance', 'integer'), date('openingDate', true), json('rollover', REPORT), DELETED_AT],
  },
  needs: {
    name: 'needs',
    columns: [
      ID,
      ref('tirelireId', 'tirelires', true),
      oneOf('kind', NEED_KINDS, true),
      c('name'),
      c('amount', 'integer'),
      json('periodicity', RYTHME),
      c('monthlyAmount', 'integer'),
      req('priority', 'integer'),
      date('activeFrom'), // D50
      date('activeTo'),
      DELETED_AT,
    ],
  },
  categories: {
    name: 'categories',
    columns: [ID, req('name'), ref('parentId', 'categories'), ref('tirelireId', 'tirelires'), oneOf('nature', CATEGORY_NATURES, true), DELETED_AT],
  },
  plannedFlows: {
    name: 'planned_flows',
    columns: [
      ID,
      req('name'),
      oneOf('kind', PLANNED_FLOW_KINDS, true),
      req('amount', 'integer'),
      ref('accountId', 'accounts', true),
      ref('tirelireId', 'tirelires'),
      ref('counterpartAccountId', 'accounts'),
      ref('categoryId', 'categories'),
      json('periodicity', RYTHME, true),
      req('dateWindowDays', 'integer'),
      json('amountTolerance', TOLERANCE),
      c('labelPattern'),
      c('variable', 'boolean'),
      date('activeFrom'),
      date('activeTo'),
      c('makesAutomation', 'boolean'), // D24, D39
      oneOf('origin', FLOW_ORIGINS), // D57 : flux déclaré ou dérivé du budget ; absent vaut déclaré
      DELETED_AT,
    ],
  },
  // Chaque colonne est importée, saisie, ou établie par le rapprochement et gardée pour la raison
  // que D58 écrit ; le libellé normalisé se recalcule à la lecture et ne se stocke pas.
  operations: {
    name: 'operations',
    columns: [
      ID,
      ref('accountId', 'accounts', true),
      oneOf('origin', OPERATION_ORIGINS, true),
      date('date', true),
      req('label'),
      c('details'),
      req('amount', 'integer'),
      oneOf('state', OPERATION_STATES, true),
      c('oneOff', 'boolean'),
      c('suggestedCategory'),
      ref('plannedFlowId', 'planned_flows'),
      ref('transferAccountId', 'accounts'),
      ref('transferOperationId', 'operations'),
      DELETED_AT,
    ],
  },
  subOperations: {
    name: 'sub_operations',
    columns: [
      ID,
      ref('operationId', 'operations', true),
      ref('parentId', 'sub_operations'),
      ref('categoryId', 'categories'),
      ref('tirelireId', 'tirelires'),
      json('share', PART, true),
      oneOf('replenishment', REPLENISHMENT_KINDS),
      DELETED_AT,
    ],
  },
  automations: {
    name: 'automations',
    columns: [ID, c('name'), json('selection', SELECTION, true), json('action', ACTION, true), req('rank'), date('validFrom'), date('validTo'), ref('flowId', 'planned_flows'), DELETED_AT],
  },
  devices: {
    name: 'devices',
    columns: [ID, req('name'), c('user'), c('lastSeen', 'text', { form: 'instant' }), DELETED_AT],
  },
  importProfiles: {
    name: 'import_profiles',
    columns: [
      ID,
      req('name'),
      oneOf('source', IMPORT_SOURCES, true),
      oneOf('encoding', IMPORT_ENCODINGS, true),
      oneOf('delimiter', IMPORT_DELIMITERS, true),
      req('headerRow', 'integer'),
      json('columns', COLONNES_IMPORT, true),
      oneOf('dateFormat', IMPORT_DATE_FORMATS, true),
      c('debitPositive', 'boolean'),
      json('accountMap', TABLE_COMPTES, true),
      ref('accountId', 'accounts'),
      DELETED_AT,
    ],
  },
};

/** Clé de `Ledger` correspondant à chaque table. */
export const LEDGER_KEYS = ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows', 'operations', 'subOperations', 'automations', 'importProfiles', 'devices'] as const;
export type LedgerKey = (typeof LEDGER_KEYS)[number];

/** Colonne de chaque table, réglages compris : l'horloge logique de la dernière écriture (D58). */
export const HLC_COLUMN = 'hlc';

const BOOLEAN_VALUES = [0, 1] as const;

function sqlLiteral(v: string | number): string {
  return typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`;
}

function columnSQL(t: TableDef, col: ColumnDef): string {
  if (col.col === 'id') return `id TEXT PRIMARY KEY NOT NULL CONSTRAINT "${t.name}.id" CHECK (id <> '')`;
  const sqlType = col.type === 'integer' || col.type === 'boolean' ? 'INTEGER' : col.type === 'real' ? 'REAL' : 'TEXT';
  const parts = [col.col, sqlType];
  if (col.required) parts.push('NOT NULL');
  const values: ReadonlyArray<string | number> | undefined = col.type === 'boolean' ? BOOLEAN_VALUES : col.values;
  if (values) parts.push(`CONSTRAINT "${t.name}.${col.col}" CHECK (${col.col} IN (${values.map(sqlLiteral).join(', ')}))`);
  return parts.join(' ');
}

export function createTableSQL(t: TableDef): string {
  const constraints = (t.constraints ?? []).map((k) => `, CONSTRAINT "${k.name}" CHECK (${k.sql})`).join('');
  return `CREATE TABLE IF NOT EXISTS ${t.name} (${t.columns.map((col) => columnSQL(t, col)).join(', ')}, ${HLC_COLUMN} TEXT NOT NULL${constraints})`;
}

/**
 * Ce qui empêche d'écrire une ligne, en nommant la table et la colonne ; `undefined` si elle
 * s'écrit. Les mêmes règles que le `NOT NULL` et les `CHECK` du fichier, vérifiées avant d'écrire
 * pour que le refus se dise en français et que rien ne soit écrit.
 */
export function rowProblem(t: TableDef, id: unknown, v: Record<string, string | number | null>): string | undefined {
  if (typeof id !== 'string' || !id) return `${t.name}.id est obligatoire.`;
  for (const col of t.columns) {
    if (col.col === 'id') continue;
    const problem = valueProblem(t, col, v[col.col] ?? null);
    if (problem) return problem;
  }
  for (const k of t.constraints ?? []) {
    const problem = k.problem(id, v);
    if (problem) return problem;
  }
  return undefined;
}

/**
 * Ce qui ne va pas dans la valeur d'une colonne, telle qu'elle est stockée ; `undefined` si elle a sa
 * forme. Obligatoire, énumération, booléen, entier, texte, date, horodatage, JSON et sa forme : la
 * même vérification à l'écriture, à la réception d'un paquet et à l'ouverture d'un fichier (D58, #198).
 */
export function valueProblem(t: TableDef, col: ColumnDef, val: unknown): string | undefined {
  const nom = `${t.name}.${col.col}`;
  if (val === null || val === undefined) return col.required ? `${nom} est obligatoire.` : undefined;
  if (typeof val !== 'string' && typeof val !== 'number') return `${nom} porte une valeur qui n’est ni un texte ni un nombre.`;
  if (col.type === 'boolean') return val !== 0 && val !== 1 ? `${nom} vaut « ${String(val)} », hors de 0 et 1.` : undefined;
  if (col.type === 'integer') return typeof val !== 'number' || !Number.isInteger(val) ? `${nom} vaut « ${String(val)} », qui n’est pas un nombre entier.` : undefined;
  if (col.type === 'real') return typeof val !== 'number' ? `${nom} vaut « ${String(val)} », qui n’est pas un nombre.` : undefined;
  if (typeof val !== 'string') return `${nom} vaut ${String(val)}, qui n’est pas un texte.`;
  if (col.values && !col.values.includes(val)) return `${nom} vaut « ${val} », hors de son énumération (${col.values.join(', ')}).`;
  if (col.form === 'date' && !estDate(val)) return `${nom} vaut « ${val} », qui n’est pas une date AAAA-MM-JJ.`;
  if (col.form === 'instant' && !estHorodatage(val)) return `${nom} vaut « ${val} », qui n’est pas un horodatage AAAA-MM-JJTHH:MM:SS.mmmZ.`;
  if (col.type === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(val);
    } catch {
      return `${nom} vaut « ${val} », qui ne se lit pas en JSON.`;
    }
    return col.shape ? problemeDeForme(nom, parsed, col.shape) : undefined;
  }
  return undefined;
}

/** Marqueur du fichier, dans `meta` : ce qui distingue un dépôt Tirelire de toute autre base. */
export const FILE_FORMAT = 'tirelire';
/**
 * Version du format du fichier et des paquets de synchronisation. Un fichier ou un paquet d'une
 * autre version est refusé en le disant, sans rien écrire (D30, D58). La version 4 range les
 * sous-opérations à tous les niveaux dans `sub_operations` (D88, #297) ; aucune version antérieure
 * n'est plus lue.
 */
export const FORMAT_VERSION = 4;

export const SYSTEM_SQL = [
  // Réglages : une ligne par clé, valeur JSON, horloge de la dernière écriture ; synchronisés.
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT, ${HLC_COLUMN} TEXT NOT NULL)`,
  // Le format du fichier et sa version, rien d'autre : ce qui décrit l'instance n'est pas dans le
  // fichier (D58).
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT)`,
];
