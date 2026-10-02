/**
 * La vérification d'un fichier que l'utilisateur ouvre — une restauration, un fichier fabriqué hors
 * de l'application (D58, #198). Une fonction du cœur, la même à l'ouverture et dans la commande qui
 * sert qui fabrique un fichier (`bin/verifier-fichier.ts`).
 *
 * Un fichier s'ouvre ou il est refusé : rien n'avertit seulement (principe 4, I10). Ce qui se complète
 * est ce que l'application pose d'elle-même pour ses propres lignes — une table absente vaut une table
 * vide, une colonne facultative absente vaut vide, un réglage absent prend sa valeur par défaut, le
 * compte principal absent naît (D40), une ligne sans horloge reçoit une horloge de l'instance qui
 * ouvre. Tout le reste refuse, en nommant la table, la ligne et la colonne.
 *
 * Ce qui se vérifie ligne par ligne est `rowProblem` et `settingProblem`, les mêmes qu'à l'écriture et
 * à la réception. Ce qui lie plusieurs lignes — un identifiant répété, une référence vers une ligne
 * absente, deux parts variables dans une même ventilation (D27), une sous-opération rangée sous une
 * autre opération que la sienne ou dans un cycle (D88), une catégorie parente d'elle-même — ne se voit
 * qu'au fichier entier, et se vérifie ici.
 */
import type { Database } from 'sql.js';
import { settingProblem } from './formes.js';
import { parseTimestamp } from './hlc.js';
import { DEFAULT_MAIN_ACCOUNT, MAIN_ACCOUNT_ID } from './model.js';
import { HLC_COLUMN, rowProblem, TABLES, type TableDef } from './schema.js';

/** Un problème du fichier : la table, la ligne et la colonne quand il en a, et ce qui ne va pas. */
export interface Probleme {
  table: string;
  id?: string;
  colonne?: string;
  message: string;
}

/** Une ligne lue, telle qu'elle s'écrira dans le fichier ouvert ; `hlc` vide si elle est à dater. */
export interface LigneLue {
  id: string;
  hlc: string;
  v: Record<string, string | number | null>;
}

/** Ce que l'ouverture complète : rien pour un fichier que l'application a écrit (#198, point 7). */
export interface Completion {
  /** Tables du format absentes du fichier, ouvertes vides. */
  tables: string[];
  /** Colonnes facultatives absentes, `table.colonne`, ouvertes vides. */
  colonnes: string[];
  /** Lignes sans horloge, `table` et identifiant, datées par l'instance qui ouvre. */
  horloges: Array<{ table: string; id: string }>;
  /** Le compte principal manquait : il naît à son défaut (D40). */
  comptePrincipal: boolean;
}

export interface Lecture {
  problemes: Probleme[];
  /** Les lignes de chaque table du format, par nom SQL ; les réglages sous `settings`. */
  lignes: Map<string, LigneLue[]>;
  completion: Completion;
}

const SETTINGS = 'settings';
const META = 'meta';
const META_CLES = ['format', 'format_version'];

/** Les colonnes que le format connaît pour une table, horloge comprise. */
function colonnesDuFormat(nom: string): string[] {
  if (nom === SETTINGS) return ['key', 'value', HLC_COLUMN];
  if (nom === META) return ['key', 'value'];
  const t = Object.values(TABLES).find((x) => x.name === nom);
  return t ? [...t.columns.map((c) => c.col), HLC_COLUMN] : [];
}

/** La valeur d'une horloge lue : vide si absente, un problème si elle ne se lit pas. */
function horloge(v: unknown): { hlc: string } | { message: string } {
  if (v === null || v === undefined || v === '') return { hlc: '' };
  if (typeof v !== 'string') return { message: `${HLC_COLUMN} vaut « ${String(v)} », qui n’est pas une horloge.` };
  try {
    parseTimestamp(v);
    return { hlc: v };
  } catch {
    return { message: `${HLC_COLUMN} vaut « ${v} », qui n’est pas une horloge (AAAAAAAAAAAAA:CCCC:appareil).` };
  }
}

/** La ligne du compte principal est-elle exactement celle qui naît avec toute base (D40) ? */
function estComptePrincipalParDefaut(v: Record<string, string | number | null>): boolean {
  const t = TABLES['accounts']!;
  const defaut = DEFAULT_MAIN_ACCOUNT as unknown as Record<string, unknown>;
  return t.columns.every((c) => c.col === 'id' || (v[c.col] ?? null) === (defaut[c.prop] ?? null));
}

/**
 * Lit une base déjà reconnue comme un dépôt Tirelire de ce format (marqueur et version, D30), et dit
 * tout ce qui ne va pas, dans l'ordre : les tables et les colonnes, puis chaque table du format ligne
 * par ligne, puis les réglages, puis ce qui lie les lignes entre elles. Rien n'est écrit.
 */
export function lireBase(db: Database): Lecture {
  const problemes: Probleme[] = [];
  const lignes = new Map<string, LigneLue[]>();
  const completion: Completion = { tables: [], colonnes: [], horloges: [], comptePrincipal: false };

  // Les tables et leurs colonnes.
  const presentes = (db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`)[0]?.values ?? []).map(
    (r) => r[0] as string,
  );
  const colonnesPresentes = new Map<string, Set<string>>();
  for (const nom of presentes) {
    const connues = colonnesDuFormat(nom);
    if (!connues.length) {
      problemes.push({ table: nom, message: `La table « ${nom} » n’est pas du format.` });
      continue;
    }
    const cols = (db.exec(`PRAGMA table_info("${nom.replace(/"/g, '""')}")`)[0]?.values ?? []).map((r) => r[1] as string);
    colonnesPresentes.set(nom, new Set(cols));
    for (const col of cols) if (!connues.includes(col)) problemes.push({ table: nom, colonne: col, message: `La colonne « ${nom}.${col} » n’est pas du format.` });
  }

  const meta = colonnesPresentes.has(META) ? (db.exec(`SELECT key FROM ${META}`)[0]?.values ?? []).map((r) => String(r[0])) : [];
  for (const cle of meta) if (!META_CLES.includes(cle)) problemes.push({ table: META, id: cle, message: `meta « ${cle} » n’est pas du format : meta ne porte que ${META_CLES.join(' et ')}.` });

  // Chaque table du format, ligne par ligne.
  for (const t of Object.values(TABLES)) {
    const presentesIci = colonnesPresentes.get(t.name);
    const lues: LigneLue[] = [];
    lignes.set(t.name, lues);
    if (!presentesIci) {
      completion.tables.push(t.name);
      continue;
    }
    for (const c of t.columns) if (!presentesIci.has(c.col) && !c.required) completion.colonnes.push(`${t.name}.${c.col}`);
    lireTable(db, t, presentesIci, lues, problemes, completion);
  }

  // Les réglages.
  const reglages: LigneLue[] = [];
  lignes.set(SETTINGS, reglages);
  const colsReglages = colonnesPresentes.get(SETTINGS);
  if (!colsReglages) completion.tables.push(SETTINGS);
  else {
    const vues = new Set<string>();
    const sel = ['key', 'value', HLC_COLUMN].map((c) => (colsReglages.has(c) ? c : `NULL AS ${c}`)).join(', ');
    for (const [key, value, h] of db.exec(`SELECT ${sel} FROM ${SETTINGS}`)[0]?.values ?? []) {
      const id = typeof key === 'string' ? key : String(key);
      const pb = settingProblem(key, value);
      if (pb) problemes.push({ table: SETTINGS, id, colonne: 'value', message: pb });
      if (vues.has(id)) problemes.push({ table: SETTINGS, id, colonne: 'key', message: `settings « ${id} » se répète.` });
      vues.add(id);
      const lu = horloge(h);
      if ('message' in lu) problemes.push({ table: SETTINGS, id, colonne: HLC_COLUMN, message: `settings « ${id} » : ${lu.message}` });
      else {
        if (!lu.hlc) completion.horloges.push({ table: SETTINGS, id });
        reglages.push({ id, hlc: lu.hlc, v: { value: (value as string | null) ?? null } });
      }
    }
  }

  // Le compte principal naît s'il manque (D40).
  if (!lignes.get('accounts')!.some((l) => l.id === MAIN_ACCOUNT_ID)) completion.comptePrincipal = true;

  liens(lignes, problemes);
  return { problemes, lignes, completion };
}

function lireTable(db: Database, t: TableDef, presentes: Set<string>, lues: LigneLue[], problemes: Probleme[], completion: Completion): void {
  const cols = [...t.columns.map((c) => c.col), HLC_COLUMN];
  const sel = cols.map((c) => (presentes.has(c) ? `"${c}"` : `NULL AS "${c}"`)).join(', ');
  const ids = new Set<string>();
  const stmt = db.prepare(`SELECT ${sel} FROM "${t.name}"`);
  try {
    while (stmt.step()) {
      const r = stmt.get();
      const brut = r[0];
      const id = typeof brut === 'string' ? brut : brut === null || brut === undefined ? '' : String(brut);
      const v: Record<string, string | number | null> = {};
      t.columns.forEach((c, i) => {
        if (c.col !== 'id') v[c.col] = (r[i] as string | number | null) ?? null;
      });
      const nombre = problemes.length;
      if (typeof brut !== 'string' || !brut) problemes.push({ table: t.name, ...(id ? { id } : {}), colonne: 'id', message: `${t.name}.id est obligatoire, et c’est un texte.` });
      else if (ids.has(id)) problemes.push({ table: t.name, id, colonne: 'id', message: `L’identifiant « ${id} » se répète dans la table ${t.name}.` });
      ids.add(id);
      const pb = rowProblem(t, id || '?', v);
      if (pb) problemes.push({ table: t.name, ...(id ? { id } : {}), ...colonneDe(t, pb), message: pb });
      const lu = horloge(r[cols.length - 1]);
      if ('message' in lu) problemes.push({ table: t.name, ...(id ? { id } : {}), colonne: HLC_COLUMN, message: `${t.name}.${lu.message}` });
      const h = 'hlc' in lu ? lu.hlc : '';
      lues.push({ id, hlc: h, v });
      if (problemes.length > nombre) continue;
      // Le compte principal resté à son défaut garde l'horloge vide de celui qui naît avec toute
      // base : il cède devant tout compte principal renseigné (D40).
      if (!h && !(t.name === 'accounts' && id === MAIN_ACCOUNT_ID && estComptePrincipalParDefaut(v))) completion.horloges.push({ table: t.name, id });
    }
  } finally {
    stmt.free();
  }
}

/** La colonne que nomme un message de `rowProblem`, `table.colonne`. */
function colonneDe(t: TableDef, message: string): { colonne?: string } {
  const m = new RegExp(`^${t.name}\\.(\\w+)`).exec(message);
  return m ? { colonne: m[1]! } : {};
}

/** Ce qui lie les lignes entre elles : références, ventilations, niveaux (D27, D88). */
function liens(lignes: Map<string, LigneLue[]>, problemes: Probleme[]): void {
  const ids = new Map<string, Set<string>>();
  for (const [nom, l] of lignes) ids.set(nom, new Set(l.map((x) => x.id)));
  ids.get('accounts')!.add(MAIN_ACCOUNT_ID); // il naît s'il manque (D40)

  for (const t of Object.values(TABLES)) {
    for (const c of t.columns) {
      if (!c.ref) continue;
      const cible = ids.get(c.ref)!;
      for (const l of lignes.get(t.name)!) {
        const x = l.v[c.col];
        if (x !== null && x !== undefined && !cible.has(String(x)))
          problemes.push({ table: t.name, id: l.id, colonne: c.col, message: `${t.name}.${c.col} désigne « ${String(x)} », absent de la table ${c.ref}.` });
      }
    }
  }

  // Une seule part variable par ventilation (D27) : parmi les sous-opérations vivantes d'un même niveau.
  const subs = lignes.get('sub_operations')!;
  const parId = new Map(subs.map((s) => [s.id, s]));
  const variables = new Map<string, number>();
  for (const s of subs) {
    if (s.v['deleted_at'] !== null) continue;
    let share: { kind?: unknown } = {};
    try {
      share = JSON.parse(String(s.v['share']));
    } catch {
      /* déjà dit ligne par ligne */
    }
    if (share.kind !== 'variable') continue;
    const niveau = `${String(s.v['operation_id'])}\u0000${String(s.v['parent_id'] ?? '')}`;
    const n = (variables.get(niveau) ?? 0) + 1;
    variables.set(niveau, n);
    if (n === 2) {
      const ou = s.v['parent_id'] ? `la sous-opération « ${String(s.v['parent_id'])} »` : `l’opération « ${String(s.v['operation_id'])} »`;
      problemes.push({ table: 'sub_operations', id: s.id, colonne: 'share', message: `sub_operations.share : une deuxième part variable dans la ventilation de ${ou} — une seule est permise (D27).` });
    }
  }

  // Une sous-opération est rangée sous un niveau de sa propre opération, sans cycle (D88).
  for (const s of subs) {
    const parent = s.v['parent_id'];
    if (parent === null) continue;
    const p = parId.get(String(parent));
    if (p && p.v['operation_id'] !== s.v['operation_id'])
      problemes.push({ table: 'sub_operations', id: s.id, colonne: 'parent_id', message: `sub_operations.parent_id désigne « ${String(parent)} », qui appartient à une autre opération.` });
  }
  cycles('sub_operations', subs, problemes);
  cycles('categories', lignes.get('categories')!, problemes);
}

/** Une ligne qui se contient elle-même, de parent en parent. */
function cycles(table: string, lues: LigneLue[], problemes: Probleme[]): void {
  const parent = new Map(lues.map((l) => [l.id, l.v['parent_id'] === null || l.v['parent_id'] === undefined ? undefined : String(l.v['parent_id'])]));
  for (const l of lues) {
    const vus = new Set<string>([l.id]);
    let p = parent.get(l.id);
    while (p !== undefined && parent.has(p)) {
      if (vus.has(p)) {
        if (p === l.id) problemes.push({ table, id: l.id, colonne: 'parent_id', message: `${table}.parent_id : la ligne « ${l.id} » se contient elle-même, de parent en parent.` });
        break;
      }
      vus.add(p);
      p = parent.get(p);
    }
  }
}

/** Un problème, en une phrase qui nomme la table, la ligne et la colonne. */
export function decrireProbleme(p: Probleme): string {
  const ou = [`table ${p.table}`, ...(p.id ? [`ligne « ${p.id} »`] : []), ...(p.colonne ? [`colonne ${p.colonne}`] : [])].join(', ');
  return `${ou} : ${p.message}`;
}

/** Le refus d'un fichier : le premier problème, et combien d'autres il y a (#198, point 3). */
export function messageDeRefus(problemes: Probleme[]): string {
  const autres = problemes.length - 1;
  const suite = autres === 0 ? '' : autres === 1 ? ' Il y a 1 autre problème.' : ` Il y a ${autres} autres problèmes.`;
  return `Ce fichier Tirelire ne s’ouvre pas, il ne respecte pas le format — ${decrireProbleme(problemes[0]!)}${suite}`;
}
