/**
 * Dépôt SQLite (sql.js, WebAssembly). Le fichier est un état (D58) : les tables, et sur chaque ligne
 * l'horloge logique de sa dernière écriture, appareil compris. Aucun journal : une ligne réécrite
 * remplace l'ancienne, et le fichier ne grossit qu'avec les données.
 *
 * Toute écriture locale passe par `upsert` / `remove` / `setSetting` ; ce qui vient d'une autre
 * instance passe par `receive`, qui fusionne ligne par ligne (la plus récente gagne) et rend, pour
 * que l'utilisateur la voie, la version écartée d'une ligne modifiée des deux côtés. Le conflit
 * n'est gardé nulle part : il se montre à la synchronisation qui le détecte.
 *
 * Ce qui décrit l'instance — son identité, son horloge, ce qu'elle sait des autres, ses curseurs de
 * relais — n'est pas dans le fichier : c'est `InstanceState`, que l'appelant garde à côté
 * (`instanceState()`) et rend à l'ouverture. Un fichier ouvert sans elle donne une instance neuve.
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { formatTimestamp, HLC, parseTimestamp } from './hlc.js';
import { normalizeLabel, uuidv7 } from './ids.js';
import { DEFAULT_SETTINGS, emptyLedger, type Ledger, type Settings } from './model.js';
import {
  createTableSQL,
  FILE_FORMAT,
  FORMAT_VERSION,
  HLC_COLUMN,
  LEDGER_KEYS,
  rowProblem,
  SYSTEM_SQL,
  TABLES,
  type ColumnDef,
  type LedgerKey,
  type TableDef,
} from './schema.js';

/** Pour chaque instance, la plus grande horloge vue d'elle (D58). */
export type Knowledge = Record<string, string>;

/** Valeur SQL d'une colonne, telle qu'elle voyage. */
export type SqlValue = string | number | null;

/** Une ligne telle qu'elle voyage entre instances : table SQL, identifiant, horloge, colonnes. */
export interface RowState {
  t: string;
  id: string;
  hlc: string;
  v: Record<string, SqlValue>;
}

/** Une ligne modifiée des deux côtés : la version retenue, partout la même, et l'écartée. Jamais gardé. */
export interface Conflict {
  id: string;
  table: string;
  rowId: string;
  kept: RowState;
  discarded: RowState;
  /** Quand cette instance l'a rencontré. */
  at: string;
}

export interface PeerInfo {
  knowledge: Knowledge;
  name?: string;
  at: string;
}

/**
 * Ce qui décrit une instance et reste à elle (D58) : jamais dans le fichier, jamais dans un paquet.
 * `knowledge` n'a de sens qu'avec l'état qu'il accompagne : absent, il se déduit des lignes.
 */
export interface InstanceState {
  siteId: string;
  /** Dernière horloge émise ou reçue : garde l'horloge croissante, même après une restauration. */
  lastHlc?: string;
  knowledge?: Knowledge;
  /** Ce que l'instance sait des autres, par identifiant. */
  peers?: Record<string, PeerInfo>;
  /** Valeurs propres à l'instance (curseurs du relais). */
  local?: Record<string, string>;
}

export type RefusalReason = 'illisible' | 'etranger' | 'ancien' | 'recent';

/** Un fichier ou un paquet qui n'est pas au format de cette version : rien n'en a été écrit. */
export class FormatRefused extends Error {
  constructor(
    readonly reason: RefusalReason,
    message: string,
  ) {
    super(message);
    this.name = 'FormatRefused';
  }
}

/** Une ligne qui ne s'écrit pas : rien n'a été écrit, et le message nomme la table et la colonne. */
export class RowRefused extends Error {
  constructor(
    readonly table: string,
    message: string,
  ) {
    super(`Écriture refusée : ${message} Rien n’a été écrit.`);
    this.name = 'RowRefused';
  }
}

export const REFUSAL_MESSAGES: Record<RefusalReason, string> = {
  illisible: 'Ce fichier n’est pas une base de données : ce n’est pas un fichier Tirelire.',
  etranger: 'Ce fichier est une base de données, mais pas un fichier Tirelire : il n’en porte pas le marqueur de format.',
  ancien:
    'Ce fichier vient d’une version antérieure de Tirelire, dont le format n’est plus lu : le format a changé avant la première version publiée, sans reprise des anciens fichiers.',
  recent: 'Ce fichier vient d’une version plus récente de Tirelire, dont le format n’est pas encore lu ici : mettez l’application à jour.',
};

export interface StoreOptions {
  /** Contenu d'un fichier SQLite existant. */
  bytes?: Uint8Array;
  /** L'instance qui ouvre le fichier ; sans elle, une instance neuve. */
  instance?: InstanceState;
  /** Raccourci : identifiant de l'instance, sans le reste de son état. */
  siteId?: string;
  /** Instance sql.js déjà initialisée (sinon initialisée ici). */
  sqlJs?: SqlJsStatic;
  /** Localisation du .wasm (navigateur). */
  locateFile?: (file: string) => string;
  now?: () => number;
}

export interface ReceiveOptions {
  /** Ce que l'émetteur savait quand il a choisi les lignes : sert à reconnaître un conflit. */
  senderKnowledge: Knowledge;
  /**
   * Ce que la réception complète apprend à cette instance. Seulement quand les lignes reçues
   * couvrent tout ce que l'émetteur savait au-delà de ce qu'on savait déjà ; sinon rien.
   */
  learn?: Knowledge;
}

export interface ReceiveResult {
  applied: number;
  ignored: number;
  stale: number;
  conflicts: Conflict[];
}

type Row = Record<string, unknown>;

const SETTINGS_TABLE = 'settings';

/** Instance qui a écrit une horloge. */
export function siteOf(hlc: string): string {
  return parseTimestamp(hlc).site;
}

/** `a` sait-il tout ce que `b` sait ? */
export function knowledgeCovers(a: Knowledge, b: Knowledge): boolean {
  return Object.entries(b).every(([site, h]) => (a[site] ?? '') >= h);
}

export class LedgerStore {
  readonly siteId: string;
  private readonly hlc: HLC;
  private listeners = new Set<() => void>();
  private knowledge: Knowledge;
  private lastHlc: string | undefined;
  private peers: Record<string, PeerInfo>;
  private local: Record<string, string>;
  /**
   * Plus grande horloge de cette instance dans le fichier à l'ouverture. Quand un pair connaît de
   * cette instance plus qu'elle-même (une sauvegarde restaurée), ses lignes écrites depuis
   * l'ouverture lui sont toutes proposées : il ne doit pas les croire vues.
   */
  private readonly ownAtOpen: string;

  private constructor(
    private readonly db: Database,
    instance: InstanceState,
    now: () => number,
  ) {
    this.siteId = instance.siteId;
    this.hlc = new HLC(this.siteId, now);
    const found = this.scanKnowledge();
    this.knowledge = instance.knowledge ? { ...instance.knowledge } : found;
    this.ownAtOpen = found[this.siteId] ?? '';
    this.peers = { ...(instance.peers ?? {}) };
    this.local = { ...(instance.local ?? {}) };
    const highest = [instance.lastHlc, ...Object.values(found), ...Object.values(this.knowledge)].filter((h): h is string => !!h);
    for (const h of highest) this.hlc.receive(h);
    // Sans horloge gardée par l'instance (fichier ouvert tel quel, sauvegarde restaurée), ses
    // écritures d'avant l'ouverture ont pu aller plus loin que le fichier : repartir après
    // l'instant présent les place toutes derrière les nouvelles.
    if (!instance.lastHlc) this.hlc.receive(formatTimestamp({ wall: now() + 1, counter: 0, site: this.siteId }));
    this.lastHlc = instance.lastHlc;
  }

  static async create(opts: StoreOptions = {}): Promise<LedgerStore> {
    const SQL = opts.sqlJs ?? (await initSqlJs(opts.locateFile ? { locateFile: opts.locateFile } : {}));
    let db: Database;
    if (opts.bytes) {
      db = openChecked(SQL, opts.bytes);
      for (const sql of SYSTEM_SQL) db.run(sql);
      for (const t of Object.values(TABLES)) db.run(createTableSQL(t));
    } else {
      db = new SQL.Database();
      for (const sql of SYSTEM_SQL) db.run(sql);
      for (const t of Object.values(TABLES)) db.run(createTableSQL(t));
      db.run(`INSERT INTO meta (key, value) VALUES ('format', ?), ('format_version', ?)`, [FILE_FORMAT, String(FORMAT_VERSION)]);
    }
    // Une ligne remplacée ne laisse rien d'elle dans le fichier : pas de trace de ce qui a changé.
    db.run('PRAGMA secure_delete = ON');
    const instance: InstanceState = opts.instance ?? { siteId: opts.siteId ?? newSiteId() };
    return new LedgerStore(db, instance, opts.now ?? (() => Date.now()));
  }

  /** Ce qui décrit cette instance, à garder à côté du fichier, jamais dedans. */
  instanceState(): InstanceState {
    return {
      siteId: this.siteId,
      ...(this.lastHlc ? { lastHlc: this.lastHlc } : {}),
      knowledge: { ...this.knowledge },
      peers: structuredClone(this.peers),
      local: { ...this.local },
    };
  }

  /** Ce que cette instance sait des autres et d'elle-même : la plus grande horloge vue de chacune. */
  getKnowledge(): Knowledge {
    return { ...this.knowledge };
  }

  // -------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------

  load(): Ledger {
    const ledger = emptyLedger();
    for (const key of LEDGER_KEYS) {
      (ledger[key] as unknown[]) = this.readTable(TABLES[key]!);
    }
    // Ce qui se recalcule ne se stocke pas (D58, D84) : le libellé normalisé se déduit du libellé.
    for (const op of ledger.operations) op.normalizedLabel = normalizeLabel(op.label);
    ledger.settings = this.readSettings();
    return ledger;
  }

  private readTable(t: TableDef): Row[] {
    const stmt = this.db.prepare(`SELECT * FROM ${t.name}`);
    const rows: Row[] = [];
    try {
      while (stmt.step()) rows.push(fromRow(t, stmt.getAsObject() as Row));
    } finally {
      stmt.free();
    }
    return rows;
  }

  readSettings(): Settings {
    const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    const stmt = this.db.prepare(`SELECT key, value FROM settings`);
    try {
      while (stmt.step()) {
        const r = stmt.getAsObject() as { key: string; value: string | null };
        if (r.value !== null) s[r.key] = JSON.parse(r.value);
      }
    } finally {
      stmt.free();
    }
    // L'identité est celle de l'instance, jamais celle d'une donnée.
    s['siteId'] = this.siteId;
    return s as unknown as Settings;
  }

  // -------------------------------------------------------------------------
  // Écriture locale
  // -------------------------------------------------------------------------

  /**
   * Insère ou réécrit une ligne entière, avec une nouvelle horloge ; rien si elle ne change pas.
   * Une ligne qui ne s'écrit pas — colonne obligatoire vide, valeur hors de son énumération — est
   * refusée avant d'écrire, en nommant la table et la colonne (`RowRefused`).
   */
  upsert<K extends LedgerKey>(key: K, row: Ledger[K][number]): void {
    const t = TABLES[key]!;
    const r = row as unknown as Row;
    const v: Record<string, SqlValue> = {};
    for (const col of t.columns) if (col.prop !== 'id') v[col.col] = toSql(col, r[col.prop]);
    const problem = rowProblem(t, r['id'], v);
    if (problem) throw new RowRefused(t.name, problem);
    const existing = this.readRowState(t.name, r['id'] as string);
    if (existing && sameValues(existing.v, v)) return;
    this.transaction(() => this.writeRow({ t: t.name, id: r['id'] as string, hlc: this.tick(), v }));
    this.notify();
  }

  /** Suppression logique : la ligne reste, datée, et la suppression voyage comme une écriture. */
  remove(key: LedgerKey, id: string): void {
    const t = TABLES[key]!;
    const col = t.columns.find((c) => c.prop === 'deletedAt');
    if (!col) throw new Error(`${t.name} ne supporte pas la suppression logique`);
    const existing = this.readRowState(t.name, id);
    if (!existing || existing.v[col.col]) return;
    this.transaction(() => this.writeRow({ ...existing, hlc: this.tick(), v: { ...existing.v, [col.col]: new Date().toISOString() } }));
    this.notify();
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (key === 'siteId') return; // l'identité de l'instance n'est pas un réglage partagé
    if (jsonEq(this.readSettings()[key], value)) return;
    this.transaction(() => this.writeRow({ t: SETTINGS_TABLE, id: key, hlc: this.tick(), v: { value: JSON.stringify(value) } }));
    this.notify();
  }

  private tick(): string {
    const h = this.hlc.tick();
    this.lastHlc = h;
    this.learnOne(h);
    return h;
  }

  private writeRow(row: RowState): void {
    if (row.t === SETTINGS_TABLE) {
      this.db.run(
        `INSERT INTO settings (key, value, ${HLC_COLUMN}) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, ${HLC_COLUMN} = excluded.${HLC_COLUMN}`,
        [row.id, row.v['value'] ?? null, row.hlc],
      );
      return;
    }
    const t = tableByName(row.t)!;
    const cols = t.columns.filter((c) => c.col !== 'id');
    const names = [...cols.map((c) => c.col), HLC_COLUMN];
    const values: SqlValue[] = [row.id, ...cols.map((c) => row.v[c.col] ?? null), row.hlc];
    this.db.run(
      `INSERT INTO ${t.name} (id, ${names.join(', ')}) VALUES (${values.map(() => '?').join(', ')}) ` +
        `ON CONFLICT(id) DO UPDATE SET ${names.map((n) => `${n} = excluded.${n}`).join(', ')}`,
      values,
    );
  }

  private readRowState(table: string, id: string): RowState | undefined {
    if (table === SETTINGS_TABLE) {
      const r = this.db.exec(`SELECT value, ${HLC_COLUMN} FROM settings WHERE key = ?`, [id])[0]?.values[0];
      return r ? { t: table, id, hlc: (r[1] as string | null) ?? '', v: { value: r[0] as SqlValue } } : undefined;
    }
    const t = tableByName(table)!;
    const cols = t.columns.filter((c) => c.col !== 'id');
    const r = this.db.exec(`SELECT ${[...cols.map((c) => c.col), HLC_COLUMN].join(', ')} FROM ${t.name} WHERE id = ?`, [id])[0]?.values[0];
    if (!r) return undefined;
    const v: Record<string, SqlValue> = {};
    cols.forEach((c, i) => (v[c.col] = (r[i] as SqlValue) ?? null));
    return { t: table, id, hlc: (r[cols.length] as string | null) ?? '', v };
  }

  // -------------------------------------------------------------------------
  // Synchronisation par delta d'état (D58)
  // -------------------------------------------------------------------------

  /**
   * Les lignes que ne connaît pas une instance qui sait `known` : celles dont l'horloge dépasse ce
   * qu'elle a vu de leur auteur (voir `ownAtOpen` pour les lignes de cette instance).
   */
  rowsNewerThan(known: Knowledge): RowState[] {
    const out: RowState[] = [];
    const theirs = known[this.siteId];
    const ownLimit = theirs !== undefined && theirs > (this.knowledge[this.siteId] ?? '') ? minHlc(theirs, this.ownAtOpen) : theirs;
    for (const row of this.allRows()) {
      if (!row.hlc) continue;
      const site = siteOf(row.hlc);
      const limit = site === this.siteId ? ownLimit : known[site];
      if (limit === undefined || row.hlc > limit) out.push(row);
    }
    return out;
  }

  private *allRows(): Generator<RowState> {
    for (const t of Object.values(TABLES)) {
      const cols = t.columns.filter((c) => c.col !== 'id');
      const stmt = this.db.prepare(`SELECT id, ${[...cols.map((c) => c.col), HLC_COLUMN].join(', ')} FROM ${t.name}`);
      try {
        while (stmt.step()) {
          const r = stmt.get();
          const v: Record<string, SqlValue> = {};
          cols.forEach((c, i) => (v[c.col] = (r[i + 1] as SqlValue) ?? null));
          yield { t: t.name, id: r[0] as string, hlc: (r[cols.length + 1] as string | null) ?? '', v };
        }
      } finally {
        stmt.free();
      }
    }
    const stmt = this.db.prepare(`SELECT key, value, ${HLC_COLUMN} FROM settings`);
    try {
      while (stmt.step()) {
        const r = stmt.get();
        yield { t: SETTINGS_TABLE, id: r[0] as string, hlc: (r[2] as string | null) ?? '', v: { value: (r[1] as SqlValue) ?? null } };
      }
    } finally {
      stmt.free();
    }
  }

  /**
   * Fusionne des lignes venues d'une autre instance, ligne entière, la plus récente gagne,
   * suppression comprise. Une ligne modifiée des deux côtés sans que l'un ait vu l'autre est un
   * conflit : les deux instances retiennent la même version, et l'écartée est rendue pour être
   * montrée, sans être gardée. Tout ou rien : une ligne illisible refuse le paquet entier, sans rien écrire.
   */
  receive(rows: RowState[], opts: ReceiveOptions): ReceiveResult {
    for (const row of rows) checkRow(row);
    const result: ReceiveResult = { applied: 0, ignored: 0, stale: 0, conflicts: [] };
    const before = { knowledge: { ...this.knowledge }, lastHlc: this.lastHlc };
    try {
      this.transaction(() => {
        for (const row of rows) {
          this.hlc.receive(row.hlc);
          const local = this.readRowState(row.t, row.id);
          if (local && local.hlc === row.hlc) {
            result.ignored++;
            continue;
          }
          const incomingWins = !local || row.hlc > local.hlc;
          if (local && !sameValues(local.v, row.v)) {
            const senderSawLocal = !local.hlc || (opts.senderKnowledge[siteOf(local.hlc)] ?? '') >= local.hlc;
            const weSawIncoming = (this.knowledge[siteOf(row.hlc)] ?? '') >= row.hlc;
            if (!senderSawLocal && !weSawIncoming) {
              const conflict: Conflict = {
                id: uuidv7(),
                table: row.t,
                rowId: row.id,
                kept: incomingWins ? row : local,
                discarded: incomingWins ? local : row,
                at: new Date().toISOString(),
              };
              result.conflicts.push(conflict);
            }
          }
          if (incomingWins) {
            this.writeRow(row);
            result.applied++;
          } else {
            result.stale++;
          }
        }
        if (opts.learn) {
          for (const h of Object.values(opts.learn)) this.hlc.receive(h);
          for (const row of rows) this.learnOne(row.hlc);
          for (const h of Object.values(opts.learn)) this.learnOne(h);
        }
        this.lastHlc = this.hlc.tick();
      });
    } catch (err) {
      this.knowledge = before.knowledge;
      this.lastHlc = before.lastHlc;
      throw err;
    }
    this.notify();
    return result;
  }

  /** Mémorise ce qu'un pair sait, pour ne lui envoyer ensuite que ce qui lui manque. */
  notePeer(site: string, knowledge: Knowledge, name?: string): void {
    this.peers[site] = { knowledge: { ...knowledge }, ...(name ? { name } : {}), at: new Date().toISOString() };
    this.notify();
  }

  /** Pairs rencontrés, avec ce qu'ils savaient au dernier échange. */
  listPeers(): Array<{ site: string } & PeerInfo> {
    return Object.entries(this.peers).map(([site, p]) => ({ site, ...p }));
  }

  getLocal(key: string): string | undefined {
    return this.local[key];
  }

  setLocal(key: string, value: string | undefined): void {
    if (value === undefined) delete this.local[key];
    else this.local[key] = value;
    this.notify();
  }

  private learnOne(h: string): void {
    if (!h) return;
    const site = siteOf(h);
    if ((this.knowledge[site] ?? '') < h) this.knowledge[site] = h;
  }

  private scanKnowledge(): Knowledge {
    const k: Knowledge = {};
    const names = [...Object.values(TABLES).map((t) => t.name), SETTINGS_TABLE];
    for (const name of names) {
      const r = this.db.exec(`SELECT ${HLC_COLUMN} FROM ${name} WHERE ${HLC_COLUMN} IS NOT NULL AND ${HLC_COLUMN} <> ''`)[0];
      for (const [h] of r?.values ?? []) {
        const site = siteOf(h as string);
        if ((k[site] ?? '') < (h as string)) k[site] = h as string;
      }
    }
    return k;
  }

  // -------------------------------------------------------------------------
  // Divers
  // -------------------------------------------------------------------------

  /** Le fichier : les tables et leur format, sans rien de l'instance. */
  export(): Uint8Array {
    return this.db.export();
  }

  /** Requête SQL libre (exploration et tests). */
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

}

// ---------------------------------------------------------------------------

function newSiteId(): string {
  return uuidv7().slice(-12);
}

/**
 * Ouvre un fichier seulement s'il est au format de cette version. Rien n'est écrit dans le fichier
 * refusé : sql.js travaille sur une copie, et l'appelant n'enregistre rien tant que l'ouverture
 * n'a pas réussi.
 */
function openChecked(SQL: SqlJsStatic, bytes: Uint8Array): Database {
  let db: Database;
  let tables: Set<string>;
  try {
    db = new SQL.Database(bytes);
    tables = new Set((db.exec(`SELECT name FROM sqlite_master WHERE type = 'table'`)[0]?.values ?? []).map((v) => v[0] as string));
  } catch {
    throw refused('illisible');
  }
  const meta = tables.has('meta') ? new Map((db.exec(`SELECT key, value FROM meta`)[0]?.values ?? []).map((v) => [v[0] as string, v[1] as string])) : new Map<string, string>();
  const format = meta.get('format');
  if (format !== FILE_FORMAT) {
    db.close();
    // Le format de l'application avant D58 : un journal de changements, une identité dans `meta`.
    const earlier = tables.has('changes') || tables.has('cell_versions') || meta.has('site_id') || meta.has('model_version');
    throw refused(earlier && format === undefined ? 'ancien' : 'etranger');
  }
  const version = Number(meta.get('format_version'));
  if (version !== FORMAT_VERSION) {
    db.close();
    throw refused(Number.isFinite(version) && version > FORMAT_VERSION ? 'recent' : 'ancien');
  }
  return db;
}

function refused(reason: RefusalReason): FormatRefused {
  return new FormatRefused(reason, REFUSAL_MESSAGES[reason]);
}

function tableByName(name: string): TableDef | undefined {
  return Object.values(TABLES).find((t) => t.name === name);
}

/** Une ligne reçue est-elle lisible par ce format ? Sinon le paquet est refusé en entier. */
function checkRow(row: RowState): void {
  const bad = (why: string) => new FormatRefused('etranger', `Ligne reçue illisible (${why}) : ce paquet n’est pas au format de cette version de Tirelire. Rien n’a été écrit.`);
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || typeof row.hlc !== 'string' || !row.v || typeof row.v !== 'object')
    throw bad('forme');
  try {
    parseTimestamp(row.hlc);
  } catch {
    throw bad(`horloge ${String(row.hlc)}`);
  }
  if (row.t === SETTINGS_TABLE) {
    if (Object.keys(row.v).some((k) => k !== 'value')) throw bad('réglage');
    return;
  }
  const t = tableByName(row.t);
  if (!t) throw bad(`table ${String(row.t)}`);
  const known = new Set(t.columns.map((c) => c.col));
  for (const [k, val] of Object.entries(row.v)) {
    if (!known.has(k) || k === 'id') throw bad(`colonne ${t.name}.${k}`);
    if (val !== null && typeof val !== 'string' && typeof val !== 'number') throw bad(`valeur ${t.name}.${k}`);
  }
  const problem = rowProblem(t, row.id, row.v);
  if (problem) throw new FormatRefused('etranger', `Ligne reçue refusée : ${problem} Rien n’a été écrit.`);
}

function sameValues(a: Record<string, SqlValue>, b: Record<string, SqlValue>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  return true;
}

function minHlc(a: string | undefined, b: string): string | undefined {
  if (a === undefined) return undefined;
  return a < b ? a : b;
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

function fromRow(t: TableDef, raw: Row): Row {
  const out: Row = {};
  for (const col of t.columns) {
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
  return out;
}

function jsonEq(a: unknown, b: unknown): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
