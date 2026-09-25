/**
 * Description des tables : une seule source pour créer le schéma SQLite, lire et écrire les
 * lignes, et les échanger entre instances. Chaque table porte en plus une colonne `hlc` :
 * l'horloge de la dernière écriture de la ligne, appareil compris (D58).
 *
 * Les noms SQL sont ceux du domaine (D39, D42, D58) : la propriété `tirelireId` est la colonne
 * `tirelire_id`, sans exception. Une colonne obligatoire est `NOT NULL`, une colonne à valeurs
 * énumérées porte un `CHECK` nommé `table.colonne` : le fichier refuse ce qui ne se lit pas, et
 * `rowProblem` dit la même chose avant d'écrire.
 */
import {
  ACCOUNT_KINDS,
  CATEGORY_NATURES,
  FLOW_ORIGINS,
  NEED_KINDS,
  OPERATION_ORIGINS,
  OPERATION_STATES,
  PLANNED_FLOW_KINDS,
  REPLENISHMENT_KINDS,
  SETTLEMENT_DIRECTIONS,
} from './model.js';
import { IMPORT_DATE_FORMATS, IMPORT_DELIMITERS, IMPORT_ENCODINGS, IMPORT_SOURCES } from './importer.js';

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
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
}

interface Options {
  required?: boolean;
  values?: readonly string[];
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

const ID = req('id');
const DELETED_AT = c('deletedAt');

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
      req('openingDate'),
      c('tracksSettlement', 'boolean'),
      c('settlementThreshold', 'integer'),
      oneOf('settlementDirection', SETTLEMENT_DIRECTIONS),
      c('activeFrom'), // D56
      c('activeTo'),
      DELETED_AT,
    ],
  },
  tirelires: {
    name: 'tirelires',
    columns: [ID, req('name'), req('placement', 'json'), req('openingBalance', 'integer'), req('openingDate'), c('rollover', 'json'), DELETED_AT],
  },
  needs: {
    name: 'needs',
    columns: [
      ID,
      req('tirelireId'),
      oneOf('kind', NEED_KINDS, true),
      c('name'),
      c('amount', 'integer'),
      c('periodicity', 'json'),
      c('monthlyAmount', 'integer'),
      req('priority', 'integer'),
      c('activeFrom'), // D50
      c('activeTo'),
      DELETED_AT,
    ],
  },
  categories: {
    name: 'categories',
    columns: [ID, req('name'), c('parentId'), c('tirelireId'), oneOf('nature', CATEGORY_NATURES, true), DELETED_AT],
  },
  plannedFlows: {
    name: 'planned_flows',
    columns: [
      ID,
      req('name'),
      oneOf('kind', PLANNED_FLOW_KINDS, true),
      req('amount', 'integer'),
      req('accountId'),
      c('tirelireId'),
      c('counterpartAccountId'),
      c('categoryId'),
      req('periodicity', 'json'),
      req('dateWindowDays', 'integer'),
      c('amountTolerance', 'json'),
      c('labelPattern'),
      c('variable', 'boolean'),
      c('activeFrom'),
      c('activeTo'),
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
      req('accountId'),
      oneOf('origin', OPERATION_ORIGINS, true),
      req('date'),
      req('label'),
      c('details'),
      req('amount', 'integer'),
      oneOf('state', OPERATION_STATES, true),
      c('oneOff', 'boolean'),
      c('suggestedCategory'),
      c('plannedFlowId'),
      c('transferAccountId'),
      c('transferOperationId'),
      DELETED_AT,
    ],
  },
  allocations: {
    name: 'allocations',
    columns: [ID, req('operationId'), c('categoryId'), c('tirelireId'), req('share', 'json'), oneOf('replenishment', REPLENISHMENT_KINDS), DELETED_AT],
  },
  automations: {
    name: 'automations',
    columns: [ID, c('name'), req('selection', 'json'), req('action', 'json'), req('rank'), c('validFrom'), c('validTo'), c('flowId'), DELETED_AT],
  },
  devices: {
    name: 'devices',
    columns: [ID, req('name'), c('user'), c('lastSeen'), DELETED_AT],
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
      req('columns', 'json'),
      oneOf('dateFormat', IMPORT_DATE_FORMATS, true),
      c('debitPositive', 'boolean'),
      req('accountMap', 'json'),
      c('accountId'),
      DELETED_AT,
    ],
  },
};

/** Clé de `Ledger` correspondant à chaque table. */
export const LEDGER_KEYS = ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows', 'operations', 'allocations', 'automations', 'importProfiles', 'devices'] as const;
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
  return `CREATE TABLE IF NOT EXISTS ${t.name} (${t.columns.map((col) => columnSQL(t, col)).join(', ')}, ${HLC_COLUMN} TEXT NOT NULL)`;
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
    const val = v[col.col] ?? null;
    if (val === null) {
      if (col.required) return `${t.name}.${col.col} est obligatoire.`;
      continue;
    }
    if (col.type === 'boolean' && val !== 0 && val !== 1) return `${t.name}.${col.col} vaut « ${String(val)} », hors de 0 et 1.`;
    if (col.values && !col.values.includes(val as string))
      return `${t.name}.${col.col} vaut « ${String(val)} », hors de son énumération (${col.values.join(', ')}).`;
  }
  return undefined;
}

/** Marqueur du fichier, dans `meta` : ce qui distingue un dépôt Tirelire de toute autre base. */
export const FILE_FORMAT = 'tirelire';
/**
 * Version du format du fichier et des paquets de synchronisation. Un fichier ou un paquet d'une
 * autre version est refusé en le disant, sans rien écrire (D30, D58). La version 2 parle le
 * domaine et contraint ses colonnes ; la version 1 n'est plus lue.
 */
export const FORMAT_VERSION = 2;

export const SYSTEM_SQL = [
  // Réglages : une ligne par clé, valeur JSON, horloge de la dernière écriture ; synchronisés.
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT, ${HLC_COLUMN} TEXT NOT NULL)`,
  // Le format du fichier et sa version, rien d'autre : ce qui décrit l'instance n'est pas dans le
  // fichier (D58).
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT)`,
];
