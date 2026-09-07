/**
 * Description des tables : une seule source pour créer le schéma SQLite,
 * lire et écrire les lignes, et journaliser les changements colonne par colonne.
 */

export type ColumnType = 'text' | 'integer' | 'real' | 'json' | 'boolean';

export interface ColumnDef {
  /** Nom de la propriété en TypeScript (camelCase). */
  prop: string;
  /** Nom de la colonne SQL (snake_case). */
  col: string;
  type: ColumnType;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
}

const c = (prop: string, type: ColumnType = 'text'): ColumnDef => ({
  prop,
  col: prop.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()),
  type,
});

export const TABLES: Record<string, TableDef> = {
  accounts: {
    name: 'accounts',
    columns: [
      c('id'),
      c('name'),
      c('kind'),
      c('bank'),
      c('accountNumber'),
      c('openingBalance', 'integer'),
      c('openingDate'),
      c('payDay', 'integer'),
      c('settlementThreshold', 'integer'),
      c('settlementDirection'),
      c('deletedAt'),
    ],
  },
  envelopes: {
    name: 'envelopes',
    columns: [
      c('id'),
      c('name'),
      c('kind'),
      c('accountId'),
      c('openingBalance', 'integer'),
      c('openingDate'),
      c('target', 'integer'),
      c('periodicity', 'json'),
      c('monthlyAmount', 'integer'),
      c('rollover', 'json'),
      c('priority', 'integer'),
      c('deletedAt'),
    ],
  },
  categories: {
    name: 'categories',
    columns: [c('id'), c('name'), c('parentId'), c('envelopeId'), c('nature'), c('deletedAt')],
  },
  plannedFlows: {
    name: 'planned_flows',
    columns: [
      c('id'),
      c('name'),
      c('kind'),
      c('amount', 'integer'),
      c('accountId'),
      c('envelopeId'),
      c('counterpartAccountId'),
      c('categoryId'),
      c('periodicity', 'json'),
      c('dateWindowDays', 'integer'),
      c('amountTolerance', 'json'),
      c('labelPattern'),
      c('variable', 'boolean'),
      c('activeFrom'),
      c('activeTo'),
      c('deletedAt'),
    ],
  },
  operations: {
    name: 'operations',
    columns: [
      c('id'),
      c('accountId'),
      c('origin'),
      c('date'),
      c('label'),
      c('normalizedLabel'),
      c('details'),
      c('amount', 'integer'),
      c('status'),
      c('suggestedCategory'),
      c('plannedFlowId'),
      c('transferAccountId'),
      c('transferOperationId'),
      c('rank', 'integer'),
      c('deletedAt'),
    ],
  },
  allocations: {
    name: 'allocations',
    columns: [c('id'), c('operationId'), c('categoryId'), c('envelopeId'), c('amount', 'integer'), c('deletedAt')],
  },
  rules: {
    name: 'rules',
    columns: [c('id'), c('pattern'), c('categoryId'), c('envelopeId'), c('priority', 'integer'), c('deletedAt')],
  },
  importProfiles: {
    name: 'import_profiles',
    columns: [
      c('id'),
      c('name'),
      c('source'),
      c('encoding'),
      c('delimiter'),
      c('headerRow', 'integer'),
      c('columns', 'json'),
      c('dateFormat'),
      c('debitPositive', 'boolean'),
      c('accountMap', 'json'),
      c('accountId'),
      c('deletedAt'),
    ],
  },
};

/** Clé de `Ledger` correspondant à chaque table. */
export const LEDGER_KEYS = ['accounts', 'envelopes', 'categories', 'plannedFlows', 'operations', 'allocations', 'rules', 'importProfiles'] as const;
export type LedgerKey = (typeof LEDGER_KEYS)[number];

export function createTableSQL(t: TableDef): string {
  const cols = t.columns.map((col) => {
    const sqlType = col.type === 'integer' || col.type === 'boolean' ? 'INTEGER' : col.type === 'real' ? 'REAL' : 'TEXT';
    return col.col === 'id' ? `${col.col} TEXT PRIMARY KEY` : `${col.col} ${sqlType}`;
  });
  return `CREATE TABLE IF NOT EXISTS ${t.name} (${cols.join(', ')})`;
}

export const SYSTEM_SQL = [
  // Réglages : une ligne par clé, valeur JSON.
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  // Journal de changements : artefact de synchronisation, chaîné par empreinte, par appareil.
  `CREATE TABLE IF NOT EXISTS changes (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     hlc TEXT NOT NULL,
     site TEXT NOT NULL,
     tbl TEXT NOT NULL,
     row_id TEXT NOT NULL,
     col TEXT NOT NULL,
     value TEXT,
     prev_hash TEXT NOT NULL,
     hash TEXT NOT NULL UNIQUE
   )`,
  `CREATE INDEX IF NOT EXISTS changes_site_seq ON changes(site, seq)`,
  // Version courante de chaque cellule : sert à décider si un changement reçu l'emporte.
  `CREATE TABLE IF NOT EXISTS cell_versions (tbl TEXT, row_id TEXT, col TEXT, hlc TEXT, PRIMARY KEY (tbl, row_id, col))`,
  // Métadonnées locales (jamais synchronisées) : appareil, tête de chaîne, dernier HLC.
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
];
