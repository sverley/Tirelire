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
  /**
   * Colonne retirée du modèle (D30) : gardée dans le schéma, ignorée à la lecture et à
   * l'écriture locale, acceptée d'un pair non migré, lue par les migrations.
   */
  deprecated?: boolean;
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

/**
 * Colonne dont le nom SQL diffère du nom de la propriété. Sert au renommage du domaine (D41) :
 * « tirelire » côté modèle, `envelopes` / `envelope_id` côté stockage. Renommer une colonne
 * obligerait à la déprécier et à migrer (D30), et casserait la fusion avec un pair non migré,
 * pour un gain nul — le nom SQL n'est jamais lu par personne.
 */
const cAs = (prop: string, col: string, type: ColumnType = 'text'): ColumnDef => ({ prop, col, type });

/** Colonne dépréciée (voir `ColumnDef.deprecated`). */
const old = (prop: string, type: ColumnType = 'text'): ColumnDef => ({ ...c(prop, type), deprecated: true });

/** Colonne dépréciée dont le nom SQL diffère du nom de la propriété. */
const oldAs = (prop: string, col: string, type: ColumnType = 'text'): ColumnDef => ({ ...cAs(prop, col, type), deprecated: true });

/** Version courante du modèle ; `migrateModel` (migration.ts) amène un dépôt plus ancien à cette version. */
export const MODEL_VERSION = 6;

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
  tirelires: {
    // Nom SQL historique conservé (D41) : le domaine dit « tirelire », le stockage garde `envelopes`.
    name: 'envelopes',
    columns: [
      c('id'),
      c('name'),
      c('placement', 'json'),
      c('openingBalance', 'integer'),
      c('openingDate'),
      c('rollover', 'json'),
      c('deletedAt'),
      // Modèle D01–D18 (migration 1 → 2) :
      old('kind'),
      old('accountId'),
      old('target', 'integer'),
      old('periodicity', 'json'),
      old('monthlyAmount', 'integer'),
      old('priority', 'integer'),
    ],
  },
  needs: {
    name: 'needs',
    columns: [
      c('id'),
      cAs('tirelireId', 'envelope_id'),
      c('kind'),
      c('name'),
      c('amount', 'integer'),
      c('periodicity', 'json'),
      c('monthlyAmount', 'integer'),
      c('priority', 'integer'),
      c('deletedAt'),
    ],
  },
  categories: {
    name: 'categories',
    columns: [c('id'), c('name'), c('parentId'), cAs('tirelireId', 'envelope_id'), c('nature'), c('deletedAt')],
  },
  plannedFlows: {
    name: 'planned_flows',
    columns: [
      c('id'),
      c('name'),
      c('kind'),
      c('amount', 'integer'),
      c('accountId'),
      cAs('tirelireId', 'envelope_id'),
      c('counterpartAccountId'),
      c('categoryId'),
      c('periodicity', 'json'),
      c('dateWindowDays', 'integer'),
      c('amountTolerance', 'json'),
      c('labelPattern'),
      c('variable', 'boolean'),
      c('activeFrom'),
      c('activeTo'),
      c('makesRule', 'boolean'),
      c('plannedAllocation', 'json'),
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
      c('state'),
      c('oneOff', 'boolean'),
      c('suggestedCategory'),
      c('plannedFlowId'),
      c('transferAccountId'),
      c('transferOperationId'),
      c('rank', 'integer'),
      c('deletedAt'),
      // Modèle D01–D18 (migration 2 → 3) :
      old('status'),
    ],
  },
  allocations: {
    name: 'allocations',
    columns: [
      c('id'),
      c('operationId'),
      c('categoryId'),
      cAs('tirelireId', 'envelope_id'),
      c('share', 'json'),
      c('deletedAt'),
      // Modèle D01–D18 (migration 2 → 3) :
      old('amount', 'integer'),
    ],
  },
  automations: {
    name: 'automations',
    columns: [
      c('id'),
      c('name'),
      c('selection', 'json'),
      c('action', 'json'),
      c('rank'),
      c('validFrom'),
      c('validTo'),
      c('flowId'),
      c('deletedAt'),
      // Modèle D01–D18 (migration 3 → 4) :
      old('pattern'),
      old('categoryId'),
      oldAs('tirelireId', 'envelope_id'),
      old('priority', 'integer'),
    ],
  },
  // Table du modèle D01–D23, lue par la migration 4 → 5 puis laissée en place (D30) : un appareil
  // resté en arrière continue d'y écrire sans faire échouer la fusion.
  rules: {
    name: 'rules',
    columns: [
      c('id'),
      c('name'),
      c('selection', 'json'),
      c('action', 'json'),
      c('rank'),
      c('validFrom'),
      c('validTo'),
      c('flowId'),
      c('deletedAt'),
      old('pattern'),
      old('categoryId'),
      oldAs('tirelireId', 'envelope_id'),
      old('priority', 'integer'),
    ],
  },
  devices: {
    name: 'devices',
    columns: [c('id'), c('name'), c('user'), c('lastSeen'), c('deletedAt')],
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

/** Colonnes vivantes d'une table (hors dépréciées). */
export function liveColumns(t: TableDef): ColumnDef[] {
  return t.columns.filter((col) => !col.deprecated);
}

/** Clé de `Ledger` correspondant à chaque table. */
export const LEDGER_KEYS = ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows', 'operations', 'allocations', 'automations', 'importProfiles', 'devices'] as const;
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
