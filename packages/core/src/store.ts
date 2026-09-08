/**
 * Dépôt SQLite (sql.js, WebAssembly) : les tables sont la vérité, le journal
 * de changements n'est qu'un artefact de synchronisation, chaîné par empreinte.
 *
 * Toute écriture passe par `upsert` / `remove` / `setSetting`, qui :
 *  1. mettent à jour la table ;
 *  2. journalisent chaque colonne modifiée avec un horodatage logique ;
 *  3. avancent la chaîne d'empreintes de cet appareil.
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { HLC } from './hlc.js';
import { sha256Hex, uuidv7 } from './ids.js';
import { DEFAULT_SETTINGS, emptyLedger, type Ledger, type Settings } from './model.js';
import { createTableSQL, LEDGER_KEYS, liveColumns, MODEL_VERSION, SYSTEM_SQL, TABLES, type ColumnDef, type LedgerKey, type TableDef } from './schema.js';

export interface ChangeEntry {
  seq: number;
  hlc: string;
  site: string;
  tbl: string;
  rowId: string;
  col: string;
  /** Valeur JSON (null pour effacer). */
  value: string | null;
  prevHash: string;
  hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);

export interface StoreOptions {
  /** Contenu d'un fichier SQLite existant. */
  bytes?: Uint8Array;
  /** Identifiant de cet appareil ; généré et mémorisé sinon. */
  siteId?: string;
  /** Instance sql.js déjà initialisée (sinon initialisée ici). */
  sqlJs?: SqlJsStatic;
  /** Localisation du .wasm (navigateur). */
  locateFile?: (file: string) => string;
  now?: () => number;
}

type Row = Record<string, unknown>;

export class LedgerStore {
  readonly siteId: string;
  private readonly hlc: HLC;
  private listeners = new Set<() => void>();

  private constructor(
    private readonly db: Database,
    siteId: string,
    now: () => number,
  ) {
    this.siteId = siteId;
    this.hlc = new HLC(siteId, now);
    this.hlc.restore(this.getMeta('last_hlc'));
  }

  static async create(opts: StoreOptions = {}): Promise<LedgerStore> {
    const SQL = opts.sqlJs ?? (await initSqlJs(opts.locateFile ? { locateFile: opts.locateFile } : {}));
    const db = opts.bytes ? new SQL.Database(opts.bytes) : new SQL.Database();
    for (const sql of SYSTEM_SQL) db.run(sql);
    for (const t of Object.values(TABLES)) db.run(createTableSQL(t));
    const fresh = !opts.bytes;
    migrate(db);
    let siteId = opts.siteId ?? readMeta(db, 'site_id');
    if (!siteId) siteId = uuidv7().slice(-12);
    db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('site_id', ?)`, [siteId]);
    // Un dépôt neuf est au modèle courant ; un dépôt existant garde sa version jusqu'à `migrateModel`.
    if (fresh && readMeta(db, 'model_version') === undefined)
      db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('model_version', ?)`, [String(MODEL_VERSION)]);
    return new LedgerStore(db, siteId, opts.now ?? (() => Date.now()));
  }

  // -------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------

  load(): Ledger {
    const ledger = emptyLedger();
    for (const key of LEDGER_KEYS) {
      (ledger[key] as unknown[]) = this.readTable(TABLES[key]!);
    }
    ledger.settings = this.readSettings();
    return ledger;
  }

  private readTable(t: TableDef, includeDeprecated = false): Row[] {
    const stmt = this.db.prepare(`SELECT * FROM ${t.name}`);
    const rows: Row[] = [];
    try {
      while (stmt.step()) rows.push(fromRow(t, stmt.getAsObject() as Row, includeDeprecated));
    } finally {
      stmt.free();
    }
    return rows;
  }

  /** Lignes brutes d'une table, colonnes dépréciées comprises : réservé aux migrations (D30). */
  readRawTable(key: LedgerKey): Row[] {
    return this.readTable(TABLES[key]!, true);
  }

  /**
   * Lecture d'une table héritée, absente du grand livre mais toujours déclarée (D30) : sert aux
   * migrations qui déplacent des lignes d'une table vers une autre.
   */
  readLegacyTable(name: keyof typeof TABLES): Row[] {
    return this.readTable(TABLES[name]!, true);
  }

  /** Version du modèle enregistrée dans ce dépôt (0 pour un dépôt antérieur à D30). */
  get modelVersion(): number {
    return Number(this.getMeta('model_version') ?? 0);
  }

  setModelVersion(v: number): void {
    this.setMeta('model_version', String(v));
  }

  readSettings(): Settings {
    const s: Record<string, unknown> = { ...DEFAULT_SETTINGS, siteId: this.siteId };
    const stmt = this.db.prepare(`SELECT key, value FROM settings`);
    try {
      while (stmt.step()) {
        const r = stmt.getAsObject() as { key: string; value: string | null };
        if (r.value !== null) s[r.key] = JSON.parse(r.value);
      }
    } finally {
      stmt.free();
    }
    return s as unknown as Settings;
  }

  /** Valeur brute d'un réglage sous son ancien nom : réservé aux migrations (D30, D41). */
  readLegacySetting(key: string): unknown {
    const stmt = this.db.prepare(`SELECT value FROM settings WHERE key = ?`);
    try {
      stmt.bind([key]);
      if (!stmt.step()) return undefined;
      const v = (stmt.getAsObject() as { value: string | null }).value;
      return v === null ? undefined : JSON.parse(v);
    } finally {
      stmt.free();
    }
  }

  // -------------------------------------------------------------------------
  // Écriture locale
  // -------------------------------------------------------------------------

  /** Insère ou met à jour une ligne ; seules les colonnes qui changent sont journalisées. */
  upsert<K extends LedgerKey>(key: K, row: Ledger[K][number]): void {
    const t = TABLES[key]!;
    const r = row as unknown as Row;
    if (typeof r['id'] !== 'string' || !r['id']) throw new Error('id manquant');
    this.transaction(() => {
      const existing = this.readRow(t, r['id'] as string);
      this.db.run(`INSERT OR IGNORE INTO ${t.name} (id) VALUES (?)`, [r['id'] as string]);
      for (const col of liveColumns(t)) {
        if (col.prop === 'id') continue;
        const next = r[col.prop];
        const prev = existing ? existing[col.prop] : undefined;
        if (existing !== undefined && jsonEq(next, prev)) continue;
        if (existing === undefined && next === undefined) continue;
        this.writeCell(t, r['id'] as string, col, next);
      }
    });
    this.notify();
  }

  /** Suppression logique. */
  remove(key: LedgerKey, id: string): void {
    const t = TABLES[key]!;
    const col = t.columns.find((c) => c.prop === 'deletedAt');
    if (!col) throw new Error(`${t.name} ne supporte pas la suppression logique`);
    this.transaction(() => {
      const existing = this.readRow(t, id);
      if (!existing || existing['deletedAt']) return;
      this.writeCell(t, id, col, new Date().toISOString());
    });
    this.notify();
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.transaction(() => {
      const current = this.readSettings()[key];
      if (jsonEq(current, value)) return;
      const json = JSON.stringify(value);
      this.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, json]);
      this.appendLocalChange('settings', key, 'value', json);
    });
    this.notify();
  }

  private writeCell(t: TableDef, id: string, col: ColumnDef, value: unknown): void {
    const sqlValue = toSql(col, value);
    this.db.run(`UPDATE ${t.name} SET ${col.col} = ? WHERE id = ?`, [sqlValue, id]);
    this.appendLocalChange(t.name, id, col.col, value === undefined ? null : JSON.stringify(value));
  }

  private appendLocalChange(tbl: string, rowId: string, col: string, value: string | null): void {
    const hlc = this.hlc.tick();
    const prevHash = this.getMeta('chain_head') ?? GENESIS_HASH;
    const hash = changeHash(prevHash, hlc, this.siteId, tbl, rowId, col, value);
    this.db.run(
      `INSERT INTO changes (hlc, site, tbl, row_id, col, value, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [hlc, this.siteId, tbl, rowId, col, value, prevHash, hash],
    );
    this.db.run(`INSERT OR REPLACE INTO cell_versions (tbl, row_id, col, hlc) VALUES (?, ?, ?, ?)`, [tbl, rowId, col, hlc]);
    this.setMeta('chain_head', hash);
    this.setMeta('last_hlc', hlc);
  }

  // -------------------------------------------------------------------------
  // Synchronisation (transport à venir)
  // -------------------------------------------------------------------------

  /** Changements locaux et relayés après `seq` (0 = tout). */
  changesSince(seq: number, site?: string): ChangeEntry[] {
    const stmt = site
      ? this.db.prepare(`SELECT * FROM changes WHERE seq > ? AND site = ? ORDER BY seq`)
      : this.db.prepare(`SELECT * FROM changes WHERE seq > ? ORDER BY seq`);
    stmt.bind(site ? [seq, site] : [seq]);
    const out: ChangeEntry[] = [];
    try {
      while (stmt.step()) {
        const r = stmt.getAsObject() as Record<string, unknown>;
        out.push({
          seq: r['seq'] as number,
          hlc: r['hlc'] as string,
          site: r['site'] as string,
          tbl: r['tbl'] as string,
          rowId: r['row_id'] as string,
          col: r['col'] as string,
          value: (r['value'] as string | null) ?? null,
          prevHash: r['prev_hash'] as string,
          hash: r['hash'] as string,
        });
      }
    } finally {
      stmt.free();
    }
    return out;
  }

  /** Dernier numéro de séquence local. */
  get lastSeq(): number {
    const r = this.db.exec(`SELECT COALESCE(MAX(seq), 0) FROM changes`);
    return (r[0]?.values[0]?.[0] as number) ?? 0;
  }

  /**
   * Applique des changements venus d'un autre appareil : une cellule n'est
   * modifiée que si l'horodatage reçu est plus récent que le sien. Les entrées
   * sont conservées dans le journal même si elles perdent, pour pouvoir être relayées.
   */
  applyRemote(entries: ChangeEntry[]): { applied: number; ignored: number; stale: number } {
    let applied = 0;
    let ignored = 0;
    let stale = 0;
    this.transaction(() => {
      for (const e of entries) {
        if (e.site === this.siteId) {
          ignored++;
          continue;
        }
        const known = this.db.exec(`SELECT 1 FROM changes WHERE hash = ?`, [e.hash]);
        if (known.length > 0) {
          ignored++;
          continue;
        }
        const expected = changeHash(e.prevHash, e.hlc, e.site, e.tbl, e.rowId, e.col, e.value);
        if (expected !== e.hash) throw new Error(`Empreinte invalide pour le changement ${e.hash}`);
        this.db.run(
          `INSERT INTO changes (hlc, site, tbl, row_id, col, value, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [e.hlc, e.site, e.tbl, e.rowId, e.col, e.value, e.prevHash, e.hash],
        );
        this.hlc.receive(e.hlc);
        const cur = this.db.exec(`SELECT hlc FROM cell_versions WHERE tbl = ? AND row_id = ? AND col = ?`, [e.tbl, e.rowId, e.col]);
        const curHlc = cur[0]?.values[0]?.[0] as string | undefined;
        if (curHlc !== undefined && curHlc >= e.hlc) {
          stale++;
          continue;
        }
        this.applyCell(e);
        this.db.run(`INSERT OR REPLACE INTO cell_versions (tbl, row_id, col, hlc) VALUES (?, ?, ?, ?)`, [e.tbl, e.rowId, e.col, e.hlc]);
        applied++;
      }
      this.setMeta('last_hlc', this.hlc.tick());
    });
    if (applied > 0) this.notify();
    return { applied, ignored, stale };
  }

  private applyCell(e: ChangeEntry): void {
    if (e.tbl === 'settings') {
      this.db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [e.rowId, e.value]);
      return;
    }
    const t = Object.values(TABLES).find((x) => x.name === e.tbl);
    if (!t) throw new Error(`Table inconnue : ${e.tbl}`);
    const col = t.columns.find((c) => c.col === e.col);
    if (!col) throw new Error(`Colonne inconnue : ${e.tbl}.${e.col}`);
    this.db.run(`INSERT OR IGNORE INTO ${t.name} (id) VALUES (?)`, [e.rowId]);
    const value = e.value === null ? undefined : JSON.parse(e.value);
    this.db.run(`UPDATE ${t.name} SET ${col.col} = ? WHERE id = ?`, [toSql(col, value), e.rowId]);
  }

  /** Vérifie la chaîne d'empreintes d'un appareil ; retourne le premier maillon cassé, ou undefined. */
  verifyChain(site: string = this.siteId): number | undefined {
    let prev = GENESIS_HASH;
    for (const e of this.changesSince(0, site)) {
      if (e.prevHash !== prev) return e.seq;
      if (changeHash(e.prevHash, e.hlc, e.site, e.tbl, e.rowId, e.col, e.value) !== e.hash) return e.seq;
      prev = e.hash;
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Divers
  // -------------------------------------------------------------------------

  export(): Uint8Array {
    return this.db.export();
  }

  /** Requête SQL libre en lecture (pour l'exploration et les tests). */
  query(sql: string, params: unknown[] = []): Row[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as never);
    const out: Row[] = [];
    try {
      while (stmt.step()) out.push(stmt.getAsObject() as Row);
    } finally {
      stmt.free();
    }
    return out;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.db.close();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private transaction(fn: () => void): void {
    this.db.run('BEGIN');
    try {
      fn();
      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  private readRow(t: TableDef, id: string): Row | undefined {
    const stmt = this.db.prepare(`SELECT * FROM ${t.name} WHERE id = ?`);
    stmt.bind([id]);
    try {
      return stmt.step() ? fromRow(t, stmt.getAsObject() as Row) : undefined;
    } finally {
      stmt.free();
    }
  }

  private getMeta(key: string): string | undefined {
    return readMeta(this.db, key);
  }

  private setMeta(key: string, value: string): void {
    this.db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, value]);
  }
}

// ---------------------------------------------------------------------------

function readMeta(db: Database, key: string): string | undefined {
  const r = db.exec(`SELECT value FROM meta WHERE key = ?`, [key]);
  return r[0]?.values[0]?.[0] as string | undefined;
}

function migrate(db: Database): void {
  // Ajoute les colonnes manquantes aux tables existantes (évolution du schéma).
  for (const t of Object.values(TABLES)) {
    const existing = new Set(db.exec(`PRAGMA table_info(${t.name})`)[0]?.values.map((v) => v[1] as string) ?? []);
    for (const col of t.columns) {
      if (existing.has(col.col)) continue;
      const sqlType = col.type === 'integer' || col.type === 'boolean' ? 'INTEGER' : col.type === 'real' ? 'REAL' : 'TEXT';
      db.run(`ALTER TABLE ${t.name} ADD COLUMN ${col.col} ${sqlType}`);
    }
  }
}

function toSql(col: ColumnDef, value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  switch (col.type) {
    case 'json':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 1 : 0;
    case 'integer':
    case 'real':
      return Number(value);
    default:
      return String(value);
  }
}

function fromRow(t: TableDef, raw: Row, includeDeprecated = false): Row {
  const out: Row = {};
  for (const col of t.columns) {
    if (col.deprecated && !includeDeprecated) continue;
    const v = raw[col.col];
    if (v === null || v === undefined) continue;
    switch (col.type) {
      case 'json':
        out[col.prop] = JSON.parse(v as string);
        break;
      case 'boolean':
        out[col.prop] = v === 1 || v === true;
        break;
      default:
        out[col.prop] = v;
    }
  }
  // D41 : « pivot » reste accepté comme synonyme de « principal », pour qu'un appareil non migré
  // qui réécrit l'ancienne valeur ne rende pas le compte principal méconnaissable.
  if (t.name === 'accounts' && out['kind'] === 'pivot') out['kind'] = 'principal';
  return out;
}

function jsonEq(a: unknown, b: unknown): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function changeHash(
  prevHash: string,
  hlc: string,
  site: string,
  tbl: string,
  rowId: string,
  col: string,
  value: string | null,
): string {
  return sha256Hex([prevHash, hlc, site, tbl, rowId, col, value ?? ' '].join('|'));
}
