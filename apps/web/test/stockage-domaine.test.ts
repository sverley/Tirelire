/**
 * Harnais d'audit de #197 — « Le stockage parle le vocabulaire du domaine, et ne garde rien de mort (D58) ».
 * Garde C8 et I8, et ce que #197 demande encore de C5.
 *
 * Chaque `describe` reprend un point du « Fait quand » de l'issue, sous son numéro ; le point 8 (les
 * catalogues) se vérifie en relisant (D81). Le harnais ne suppose rien de ce que l'issue laisse au
 * codeur : ni les noms nouveaux, ni la forme des contraintes, ni le sort de chaque colonne dérivée.
 * Il lit donc le fichier sans nom de table ni de colonne : une table ou une colonne se **retrouve**
 * par ce qu'elle contient (la ligne `acc-principal`, la colonne qui y vaut `principal`). Il passe par
 * ce que l'application appelle déjà : le dépôt (`LedgerStore`), l'import (`prepareImport`,
 * `runPipeline`, comme l'écran Import), le protocole (`runSync`), l'échange par fichier
 * (`exportBundle`, `importBundle`) et le relais (`relaySync`), sur le jeu d'exemple chargé comme le
 * fait l'application (`replaceWith`).
 *
 * Ce que chaque point mesure, et où il s'arrête :
 *
 * 1. Aucun nom de table ni de colonne ne contient `envelope` ni `rule` ; une table porte `tirelire`,
 *    une `automat…`, et toute colonne qui contient l'identifiant d'une tirelire porte `tirelire`.
 *    « Même nom, même chose » se mesure par le type déclaré, identique d'une table à l'autre, et
 *    par le cas que l'issue nomme : le rang d'une opération parmi les identiques du jour et la clé
 *    triable d'un automatisme ne partagent pas un nom. Le reste du sens se relit.
 * 2. Une table ou une colonne est vivante si l'application l'écrit (une valeur y est, après un
 *    chargement complet) ou la lit : la **sonde** change sa valeur dans le fichier, rouvre, et
 *    compare ce que rendent `load()` et `exportBundle()` ; une ouverture refusée compte comme une
 *    lecture. Le code : aucune fonction de migration exportée, plus la machinerie qui les portait,
 *    et un ancien genre de compte n'est plus lu comme le nouveau.
 * 3. La forme `op_` + 16 hexadécimaux ; le même relevé, deux fois ou sur deux instances.
 * 4. Par l'application (`upsert`, `importBundle`) : l'écriture échoue et le contenu du fichier ne
 *    bouge pas ; chaque colonne obligatoire et chaque énumération est refusée ; le message nomme la
 *    table et la colonne telles que le fichier les nomme. Par le fichier lui-même (D58 : `NOT NULL`,
 *    `CHECK`) : la même écriture en SQL échoue. Un test par besoin, pour que chacun ait son niveau.
 * 5. Une colonne d'`operations` qui vaut partout le libellé normalisé est dérivée : si elle est
 *    gardée, `docs/decisions.md` la nomme. Ce test et son témoin vivent dans la garde
 *    (`packages/gardes/colonnes-derivees.test.mjs`, #314) : l'interface ne lit plus `docs/`. Que la
 *    raison tienne, et le classement des autres colonnes (saisie, importée, dérivée), se relit.
 * 6. Un fichier et un paquet de `main` avant #197 (966ebc3), données inventées, compressés en base64
 *    en fin de fichier.
 * 7. Le plan de l'exemple à trois dates, et l'import d'un relevé inventé (opérations, rapprochements
 *    et ventilations, sans leurs identifiants), comparés à ce que `main` donnait avant #197.
 *
 * Les assertions sont dans des fonctions à part, pour que les témoins rouges, en fin de fichier,
 * rejouent les mêmes sur une version volontairement cassée du besoin.
 *
 * Niveaux (#232, D83), marqués dans chaque titre ; un témoin a le niveau de ce qu'il garde :
 * - 0 : point 3, les deux tests sans doublon ; point 4, une ligne refusée, écrite ou reçue, n'écrit
 *   rien ; point 6, les quatre tests ; point 7, l'export qui se rouvre à l'identique.
 * - 2 : points 1 et 2 (le point 5 est dans la garde) ; point 3, la forme de la clé ; point 4, chaque colonne refusée et le refus
 *   par le fichier lui-même ; point 7, le plan et l'import.
 * - 3 : point 4, les deux refus qui nomment la table et la colonne.
 *
 * Au point 7, la convergence (I8) est retirée, en doublon (#246) : « #196 · 2. deux instances
 * convergent » (`fichier-etat.test.ts`, niveau 0, au registre) la couvre, en direct, par le relais
 * et par fichier, avec créations, modifications et suppressions dans toutes les tables, tirelires,
 * automatismes et besoins compris. L'export qui se rouvre à l'identique reste : il compare le
 * contenu de chaque table du fichier, horloges des lignes et table `meta` comprises, que
 * « #196 · 8 » ne lit que par `load()`.
 */
import { webcrypto } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import * as coeur from '@tirelire/core';
import {
  LedgerStore,
  addDays,
  bankMultiAccountProfile,
  computePlan,
  exampleLedger,
  exportBundle,
  importBundle,
  memoryTransportPair,
  parseCsv,
  parseRows,
  prepareImport,
  rankBetween,
  runPipeline,
  runSync,
  type Ledger,
} from '@tirelire/core';
import { relaySync } from '../src/lib/relay';

const SQL = await initSqlJs();
const CLES = ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows', 'operations', 'subOperations', 'shortfallAnswers', 'automations', 'importProfiles', 'devices'] as const;
type Cle = (typeof CLES)[number];
type Ligne = Record<string, unknown> & { id: string };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Outils
// ─────────────────────────────────────────────────────────────────────────────────────────────

function instance(bytes?: Uint8Array, siteId?: string): Promise<LedgerStore> {
  return LedgerStore.create({ sqlJs: SQL, ...(bytes ? { bytes } : {}), ...(siteId ? { siteId } : {}) });
}

function lignes(store: LedgerStore, cle: Cle): Ligne[] {
  return (store.load()[cle] as unknown as Ligne[]).slice();
}

/** Charge l'exemple comme l'application (`replaceWith`) : toutes les tables, puis les réglages. */
function charger(store: LedgerStore, l: Ledger = exampleLedger()): void {
  for (const cle of CLES) for (const r of l[cle] as unknown as Ligne[]) store.upsert(cle, r as never);
  for (const [k, v] of Object.entries(l.settings)) if (k !== 'siteId') store.setSetting(k as never, v as never);
}

const NUM_COURANT = '00011111971';
const NUM_LIVRET = '00022222971';

/** Relevé inventé (D84), au format des exports bancaires français : deux comptes de l'exemple. */
const RELEVE = [
  'Date transaction;Date comptabilisation;Num Compte;Libellé Compte;Libellé opération;Libellé complet;Catégorie;Sous-Catégorie;Montant;Pointée;',
  '28/08/2026;28/08/2026;00011111971;Compte Courant;VIR SEPA RECU SALAIRE EMPLOYEUR;VIR SEPA RECU DE: EMPLOYEUR SA MOTIF: SALAIRE AOUT;Revenus du travail;Salaires;3400,00;Non;',
  '01/09/2026;01/09/2026;00011111971;Compte Courant;VIR TIRELIRE LIVRET A;VIR PERMANENT TIRELIRE LIVRET A;Épargne;Virement interne;-600,00;Non;',
  '01/09/2026;01/09/2026;00022222971;Livret A;VIR TIRELIRE LIVRET A;VIR PERMANENT TIRELIRE LIVRET A;Épargne;Virement interne;600,00;Non;',
  '03/09/2026;03/09/2026;00011111971;Compte Courant;CARTE X2009 02/09 SUPERMARCHE;CARTE X2009 02/09 SUPERMARCHE DU BOURG;Vie quotidienne;Alimentation;-85,40;Non;',
  '03/09/2026;03/09/2026;00011111971;Compte Courant;CARTE X2009 02/09 SUPERMARCHE;CARTE X2009 02/09 SUPERMARCHE DU BOURG;Vie quotidienne;Alimentation;-85,40;Non;',
  '04/09/2026;04/09/2026;00011111971;Compte Courant;CARTE X2009 03/09 BOULANGERIE DU COIN;CARTE X2009 03/09 BOULANGERIE DU COIN;Vie quotidienne;Alimentation;-12,30;Non;',
  '05/09/2026;05/09/2026;00011111971;Compte Courant;ECHEANCE PRET IMMO 000123;ECHEANCE PRET IMMO 000123;Logement;Crédit;-950,00;Non;',
  '05/09/2026;05/09/2026;00011111971;Compte Courant;VIR LOYER LOCATAIRE;VIR SEPA RECU DE: LOCATAIRE MOTIF: LOYER SEPTEMBRE;Revenus;Loyers;700,00;Non;',
  '05/09/2026;05/09/2026;00011111971;Compte Courant;VIR CAF ALLOCATIONS;VIR SEPA RECU DE: CAF;Revenus;Allocations;100,00;Non;',
].join('\r\n');
const LIGNES_DU_RELEVE = 9;

function profil() {
  const p = bankMultiAccountProfile('profil-197');
  p.accountMap = { [NUM_COURANT]: 'acc-principal', [NUM_LIVRET]: 'acc-livret' };
  return p;
}

/** Un automatisme, comme l'écran Opérations en crée depuis une recherche (D39). */
function automatiser(store: LedgerStore): void {
  store.upsert('automations', { id: 'auto-supermarche-197', name: 'Supermarché', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim' }, rank: rankBetween(undefined, undefined) } as never);
}

/** L'import comme l'écran Import (`doImport`) : profil, opérations retenues, puis la chaîne automatique. */
function importer(store: LedgerStore): void {
  const p = profil();
  store.upsert('importProfiles', p as never);
  const lu = parseRows(parseCsv(RELEVE), p);
  expect(lu.errors, 'le relevé inventé ne se lit pas').toEqual([]);
  const prep = prepareImport(store.load(), lu.rows, p);
  const ops = prep.candidates.filter((c) => (c.exact ? false : c.probable ? (c.similarity ?? 0) < 0.5 : true)).map((c) => c.operation);
  for (const o of ops) store.upsert('operations', o);
  const dates = ops.map((o) => o.date).sort();
  if (!dates.length) return;
  runPipeline(store.load(), dates[0]!, addDays(dates[dates.length - 1]!, 1), (patch) => {
    for (const o of patch.operations) store.upsert('operations', o);
    for (const a of patch.subOperations) store.upsert('subOperations', a);
    for (const id of patch.removedSubOperations ?? []) store.remove('subOperations', id);
    return store.load();
  });
}

/** L'exemple, un automatisme, un appareil et un relevé importé : toutes les tables ont des lignes. */
async function semee(siteId?: string): Promise<LedgerStore> {
  const s = await instance(undefined, siteId);
  charger(s);
  automatiser(s);
  s.upsert('devices', { id: 'appareil-197', name: 'Tablette du salon' } as never);
  importer(s);
  return s;
}

function importees(store: LedgerStore): Ligne[] {
  return lignes(store, 'operations').filter((o) => o['origin'] === 'imported' && !o['deletedAt']);
}

/** L'état d'une instance, comparable d'une instance à l'autre : sans son identité, lignes triées. */
function etat(store: LedgerStore): Record<string, unknown> {
  const l = store.load() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const cle of CLES) out[cle] = [...(l[cle] as Ligne[])].sort((a, b) => a.id.localeCompare(b.id));
  const { siteId: _identite, ...reglages } = l['settings'] as Record<string, unknown>;
  out['settings'] = reglages;
  return out;
}

/** Le contenu de toutes les tables d'un fichier SQLite, relu ligne à ligne. */
function contenu(bytes: Uint8Array): string {
  const db = new SQL.Database(bytes);
  try {
    const tables = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)[0]?.values.map((v) => String(v[0])) ?? [];
    return tables.map((t) => `${t} ${JSON.stringify(db.exec(`SELECT * FROM "${t}" ORDER BY rowid`)[0] ?? null)}`).join('\n');
  } finally {
    db.close();
  }
}

interface Colonne {
  nom: string;
  type: string;
  nonNul: boolean;
  cle: boolean;
}

/** Les tables d'un fichier et leurs colonnes, hors tables internes de SQLite. */
function schema(bytes: Uint8Array): Map<string, Colonne[]> {
  const db = new SQL.Database(bytes);
  try {
    const tables = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)[0]?.values.map((v) => String(v[0])) ?? [];
    return new Map(
      tables.map((t) => [
        t,
        (db.exec(`PRAGMA table_info("${t}")`)[0]?.values ?? []).map((v) => ({ nom: String(v[1]), type: String(v[2]).toUpperCase(), nonNul: v[3] === 1, cle: Number(v[5]) > 0 })),
      ]),
    );
  } finally {
    db.close();
  }
}

/** Où le fichier range la valeur `valeur` de la ligne `id` : sa table et sa colonne. */
function ou(bytes: Uint8Array, id: string, valeur: unknown): { table: string; colonne: string } {
  const db = new SQL.Database(bytes);
  try {
    for (const [table, cols] of schema(bytes)) {
      if (!cols.some((c) => c.nom === 'id')) continue;
      const r = db.exec(`SELECT * FROM "${table}" WHERE id = ?`, [id])[0];
      if (!r) continue;
      const i = r.columns.findIndex((c, k) => c !== 'id' && r.values[0]![k] !== null && String(r.values[0]![k]) === String(valeur));
      if (i >= 0) return { table, colonne: r.columns[i]! };
    }
  } finally {
    db.close();
  }
  throw new Error(`la valeur ${String(valeur)} de la ligne ${id} n’est nulle part dans le fichier`);
}

/** Une copie du fichier, modifiée en SQL, contraintes `CHECK` ignorées : ce que fabriquerait un autre outil. */
function modifier(bytes: Uint8Array, fn: (db: Database) => void): Uint8Array {
  const db = new SQL.Database(bytes);
  try {
    db.run('PRAGMA ignore_check_constraints = ON');
    fn(db);
    return db.export();
  } finally {
    db.close();
  }
}

/** Ce que rend une promesse qui doit être refusée, sans attendre au-delà de `ms`. */
async function issue(fn: () => unknown, ms = 2000): Promise<{ etat: 'refusé' | 'accepté' | 'sans réponse'; dit: string }> {
  const delai = new Promise<{ etat: 'sans réponse'; dit: string }>((r) => setTimeout(() => r({ etat: 'sans réponse', dit: '' }), ms));
  const essai = Promise.resolve()
    .then(fn)
    .then(
      (v) => ({ etat: 'accepté' as const, dit: JSON.stringify(v ?? null) }),
      (e: unknown) => ({ etat: 'refusé' as const, dit: e instanceof Error ? e.message : String(e) }),
    );
  return Promise.race([essai, delai]);
}

/** Remplace, partout dans un objet, une chaîne exacte par une autre valeur. */
function remplacer(o: unknown, de: string, par: unknown): unknown {
  if (o === de) return par;
  if (Array.isArray(o)) return o.map((x) => remplacer(x, de, par));
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, remplacer(v, de, par)]));
  return o;
}

async function direct(a: LedgerStore, b: LedgerStore): Promise<void> {
  const [x, y] = memoryTransportPair();
  await Promise.all([runSync(a, x), runSync(b, y)]);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// La sonde du point 2
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Ce que l'application lit d'un fichier : ce que rend `load()` et ce qu'elle enverrait à un pair. */
async function lecture(bytes: Uint8Array): Promise<string> {
  try {
    const s = await instance(bytes, 'sonde197');
    const lu = JSON.stringify({ etat: etat(s), paquet: exportBundle(s) });
    s.close();
    return lu;
  } catch (e) {
    return `refusé : ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Une autre valeur du même genre que `v`. */
function autre(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return /INT|BOOL/.test(type) ? 1 : /REAL|NUM|FLOA|DOUB/.test(type) ? 1.5 : 'sonde-197';
  if (typeof v === 'number') return v + 1;
  const s = String(v);
  try {
    const j = JSON.parse(s) as unknown;
    if (Array.isArray(j)) return JSON.stringify([...j, 'sonde-197']);
    if (j && typeof j === 'object') return JSON.stringify({ ...j, sonde197: 1 });
    if (typeof j === 'number') return JSON.stringify(j + 1);
    if (typeof j === 'boolean') return JSON.stringify(!j);
    if (typeof j === 'string') return JSON.stringify(j + '-sonde-197');
  } catch {
    /* pas du JSON */
  }
  return s + '-sonde-197';
}

/** Les tables et colonnes que l'application n'écrit pas (vides partout) et ne lit pas. */
async function sonder(bytes: Uint8Array): Promise<string[]> {
  const base = await lecture(bytes);
  const morts: string[] = [];
  for (const [table, cols] of schema(bytes)) {
    const db = new SQL.Database(bytes);
    const n = Number(db.exec(`SELECT count(*) FROM "${table}"`)[0]!.values[0]![0]);
    const ecrites = new Set(cols.filter((c) => Number(db.exec(`SELECT count(*) FROM "${table}" WHERE "${c.nom}" IS NOT NULL`)[0]!.values[0]![0]) > 0).map((c) => c.nom));
    const premiere = n ? db.exec(`SELECT * FROM "${table}" ORDER BY rowid LIMIT 1`)[0]! : undefined;
    db.close();
    if (!n) {
      const sonde = modifier(bytes, (d) =>
        d.run(`INSERT INTO "${table}" (${cols.map((c) => `"${c.nom}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => (c.cle || c.nom === 'id' ? 'sonde-197' : c.nonNul ? autre(null, c.type) : null)) as never),
      );
      if ((await lecture(sonde)) === base) morts.push(table);
      continue;
    }
    for (const c of cols) {
      if (ecrites.has(c.nom)) continue;
      const v = premiere!.values[0]![premiere!.columns.indexOf(c.nom)];
      const sonde = modifier(bytes, (d) => d.run(`UPDATE "${table}" SET "${c.nom}" = ? WHERE rowid = (SELECT min(rowid) FROM "${table}")`, [autre(v, c.type)] as never));
      if ((await lecture(sonde)) === base) morts.push(`${table}.${c.nom}`);
    }
  }
  return morts;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Assertions, partagées avec les témoins rouges
// ─────────────────────────────────────────────────────────────────────────────────────────────

function verifierNomsDuDomaine(bytes: Uint8Array): void {
  const noms = [...schema(bytes)].flatMap(([t, cols]) => [t, ...cols.map((c) => `${t}.${c.nom}`)]);
  expect(noms.filter((n) => /envelope|rule/i.test(n)), 'des noms de l’ancien vocabulaire').toEqual([]);
}

function verifierNomsPortes(bytes: Uint8Array, tirelires: string[]): void {
  const tables = [...schema(bytes).keys()];
  expect(tables.some((t) => /tirelire/i.test(t)), `aucune table ne porte le nom des tirelires : ${tables.join(', ')}`).toBe(true);
  expect(tables.some((t) => /automat/i.test(t)), `aucune table ne porte le nom des automatismes : ${tables.join(', ')}`).toBe(true);
  const db = new SQL.Database(bytes);
  const fautives: string[] = [];
  try {
    for (const [t, cols] of schema(bytes))
      for (const c of cols) {
        if (c.nom === 'id') continue;
        const vals = (db.exec(`SELECT DISTINCT "${c.nom}" FROM "${t}" WHERE "${c.nom}" IS NOT NULL`)[0]?.values ?? []).map((v) => String(v[0]));
        if (vals.some((v) => tirelires.includes(v)) && !/tirelire/i.test(c.nom)) fautives.push(`${t}.${c.nom}`);
      }
  } finally {
    db.close();
  }
  expect(fautives, 'des colonnes qui désignent une tirelire sans la nommer').toEqual([]);
}

function verifierMemesTypes(bytes: Uint8Array): void {
  const types = new Map<string, Set<string>>();
  for (const [t, cols] of schema(bytes)) for (const c of cols) (types.get(c.nom) ?? types.set(c.nom, new Set()).get(c.nom)!).add(`${c.type} (${t})`);
  const ecarts = [...types].filter(([, s]) => new Set([...s].map((x) => x.split(' ')[0])).size > 1).map(([n, s]) => `${n} : ${[...s].join(', ')}`);
  expect(ecarts, 'un même nom de colonne, deux types').toEqual([]);
}

function verifierRangsSepares(rangDuJour: string[], cleDeTri: string[]): void {
  expect(cleDeTri.length, 'la clé triable de l’automatisme n’est pas dans le fichier').toBeGreaterThan(0);
  expect(rangDuJour.filter((n) => cleDeTri.includes(n)), 'le rang du jour et la clé triable partagent un nom').toEqual([]);
}

function verifierRienDeMort(morts: string[]): void {
  expect(morts, 'des tables ou des colonnes que l’application ne lit ni n’écrit').toEqual([]);
}

function verifierPasDeSynonyme(r: { etat: string; dit: string }, nouveau: string): void {
  if (r.etat === 'accepté') expect(JSON.parse(r.dit), 'l’ancienne valeur est lue comme la nouvelle').not.toBe(nouveau);
}

function verifierCles(ids: string[]): void {
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.filter((id) => !/^op_[0-9a-f]{16}$/.test(id)), 'des identifiants d’opération hors de la forme op_ + 16 hexadécimaux').toEqual([]);
}

function verifierRefuse(err: unknown, pourquoi: string): void {
  expect(err, `${pourquoi} : l’écriture est acceptée`).toBeDefined();
}

function verifierRefusSansEcriture(err: unknown, pourquoi: string, avant: string, apres: string): void {
  verifierRefuse(err, pourquoi);
  expect(apres, `${pourquoi} : le refus a écrit quelque chose`).toBe(avant);
}

function verifierRefusNomme(err: unknown, table: string, colonne: string): void {
  verifierRefuse(err, `${table}.${colonne}`);
  const dit = err instanceof Error ? err.message : String(err);
  expect(dit, 'le refus ne nomme pas la table').toContain(table);
  expect(dit, 'le refus ne nomme pas la colonne').toContain(colonne);
}

/** Ce que lève `fn`, ou `undefined` si elle ne lève rien. */
function leve(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

function verifierRefusFichier(bytes: Uint8Array, table: string, colonne: string, id: string, valeur: unknown): void {
  const db = new SQL.Database(bytes);
  let refuse = false;
  try {
    db.run(`UPDATE "${table}" SET "${colonne}" = ? WHERE id = ?`, [valeur, id] as never);
  } catch {
    refuse = true;
  } finally {
    db.close();
  }
  expect(refuse, `le fichier accepte ${table}.${colonne} = ${JSON.stringify(valeur)}`).toBe(true);
}

function verifierRefus(r: { etat: string; dit: string }): void {
  expect(r.etat, 'le format précédent n’est pas refusé').toBe('refusé');
  expect(r.dit.trim(), 'le refus ne dit rien').not.toBe('');
}

function verifierRienEcrit(avant: string, apres: string): void {
  expect(apres, 'l’instance a écrit en recevant le format précédent').toBe(avant);
}

function verifierMemePlan(store: LedgerStore): void {
  const avant = deplier(PLANS_AVANT) as Record<string, unknown>;
  for (const [date, plan] of Object.entries(avant)) expect(JSON.parse(JSON.stringify(computePlan(store.load(), date))), `le plan du ${date} a changé`).toEqual(plan);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. Le fichier parle le domaine
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('#197 · 1. le fichier parle le domaine', () => {
  it('dans un fichier neuf, aucun nom de table ni de colonne ne contient envelope ni rule [niveau 2]', async () => {
    verifierNomsDuDomaine((await instance()).export());
  });

  it('les tirelires et les automatismes y portent leur nom, jusque dans les colonnes qui désignent une tirelire [niveau 2]', async () => {
    const s = await semee();
    verifierNomsPortes(s.export(), lignes(s, 'tirelires').map((t) => t.id));
  });

  it('deux colonnes de même nom désignent la même chose : même type, et le rang du jour n’est pas la clé triable [niveau 2]', async () => {
    const s = await semee();
    const bytes = s.export();
    verifierMemesTypes(bytes);
    // Les deux achats identiques du 3 septembre : ce qui les distingue dans le fichier est le rang du jour.
    const [o1, o2] = importees(s).filter((o) => String(o['label']).includes('SUPERMARCHE'));
    expect(o2, 'les deux opérations identiques du jour ne sont pas importées').toBeDefined();
    const db = new SQL.Database(bytes);
    const { table } = ou(bytes, o1!.id, o1!['date']);
    const r = db.exec(`SELECT * FROM "${table}" WHERE id IN (?, ?)`, [o1!.id, o2!.id])[0]!;
    db.close();
    const rangDuJour = r.columns.filter((_c, k) => {
      const [a, b] = [r.values[0]![k], r.values[1]![k]];
      return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) === 1;
    });
    const auto = lignes(s, 'automations').find((a) => a.id === 'auto-supermarche-197')!;
    const cleDeTri = [ou(bytes, auto.id, auto['rank']).colonne];
    verifierRangsSepares(rangDuJour, cleDeTri);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. Rien de mort
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('#197 · 2. rien de mort', () => {
  it('un fichier neuf ne porte aucune table ni colonne que l’application ne lit ni n’écrit [niveau 2]', async () => {
    const s = await semee();
    verifierRienDeMort(await sonder(s.export()));
  });

  it('le code ne porte plus d’étape de migration, ni la machinerie qui les portait [niveau 2]', () => {
    expect(Object.keys(coeur).filter((n) => /migrat/i.test(n)), 'des migrations exportées par le cœur').toEqual([]);
    const machinerie = ['readRawTable', 'readLegacyTable', 'readLegacySetting', 'setModelVersion', 'modelVersion'].filter((m) => m in LedgerStore.prototype);
    expect(machinerie, 'la machinerie des migrations reste dans le dépôt').toEqual([]);
  });

  it('un ancien genre de compte n’est plus lu comme le nouveau [niveau 2]', async () => {
    const s = await instance();
    charger(s);
    const bytes = s.export();
    for (const [ancien, nouveau, compte] of [
      ['pivot', 'principal', 'acc-principal'],
      ['holding', 'epargne', 'acc-livret'],
      ['third', 'courant', 'acc-enfants'],
    ] as const) {
      const { table, colonne } = ou(bytes, compte, nouveau);
      const plante = modifier(bytes, (db) => db.run(`UPDATE "${table}" SET "${colonne}" = ? WHERE id = ?`, [ancien, compte]));
      verifierPasDeSynonyme(await issue(async () => lignes(await instance(plante), 'accounts').find((c) => c.id === compte)?.['kind']), nouveau);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. La clé est courte et stable
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('#197 · 3. la clé est courte et stable', () => {
  it('une opération importée a pour identifiant op_ suivi de 16 hexadécimaux [niveau 2]', async () => {
    const s = await semee();
    expect(importees(s).length).toBe(LIGNES_DU_RELEVE);
    verifierCles(importees(s).map((o) => o.id));
  });

  it('importer deux fois le même relevé sur la même instance ne crée aucun doublon [niveau 0]', async () => {
    const s = await semee();
    const avant = importees(s).map((o) => o.id).sort();
    importer(s);
    expect(importees(s).map((o) => o.id).sort()).toEqual(avant);
  });

  it('deux instances qui importent le même relevé donnent les mêmes identifiants, et aucun doublon après synchronisation [niveau 0]', async () => {
    const a = await semee();
    const b = await semee();
    const ids = importees(a).map((o) => o.id).sort();
    expect(importees(b).map((o) => o.id).sort()).toEqual(ids);
    await direct(a, b);
    expect(importees(a).map((o) => o.id).sort()).toEqual(ids);
    expect(importees(b).map((o) => o.id).sort()).toEqual(ids);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. Le fichier refuse l'incohérent
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne de chaque cas : la clé du modèle, la ligne, le champ touché et la valeur écrite. */
function casIncoherents(s: LedgerStore): Array<{ cle: Cle; ligne: Ligne; champ: string; valeur: unknown; pourquoi: string }> {
  const compte = lignes(s, 'accounts').find((c) => c.id === 'acc-principal')!;
  const op = importees(s)[0]!;
  const ventilation = lignes(s, 'subOperations').find((a) => !a['deletedAt'])!;
  const besoin = lignes(s, 'needs')[0]!;
  const flux = lignes(s, 'plannedFlows')[0]!;
  const categorie = lignes(s, 'categories').find((c) => c['nature'])!;
  return [
    { cle: 'accounts', ligne: compte, champ: 'name', valeur: undefined, pourquoi: 'un compte sans nom' },
    { cle: 'accounts', ligne: compte, champ: 'kind', valeur: undefined, pourquoi: 'un compte sans genre' },
    { cle: 'operations', ligne: op, champ: 'date', valeur: undefined, pourquoi: 'une opération sans date' },
    { cle: 'operations', ligne: op, champ: 'amount', valeur: undefined, pourquoi: 'une opération sans montant' },
    { cle: 'subOperations', ligne: ventilation, champ: 'operationId', valeur: undefined, pourquoi: 'une ventilation sans opération' },
    { cle: 'accounts', ligne: compte, champ: 'kind', valeur: 'pivot', pourquoi: 'un genre de compte inconnu' },
    { cle: 'operations', ligne: op, champ: 'state', valeur: 'bidon', pourquoi: 'un état d’opération inconnu' },
    { cle: 'needs', ligne: besoin, champ: 'kind', valeur: 'bidon', pourquoi: 'un genre de besoin inconnu' },
    { cle: 'plannedFlows', ligne: flux, champ: 'kind', valeur: 'bidon', pourquoi: 'un genre de flux inconnu' },
    { cle: 'categories', ligne: categorie, champ: 'nature', valeur: 'bidon', pourquoi: 'une nature de catégorie inconnue' },
  ];
}

/** Écrit la ligne du cas par l'application, sans le champ ou avec la valeur du cas. */
function ecrire(s: LedgerStore, c: { cle: Cle; ligne: Ligne; champ: string; valeur: unknown }): void {
  const { [c.champ]: _retire, ...reste } = c.ligne;
  s.upsert(c.cle, (c.valeur === undefined ? reste : { ...reste, [c.champ]: c.valeur }) as never);
}

/** Le paquet d'une instance où une valeur a été remplacée, partout où elle paraît. */
async function paquetIncoherent(de: string, par: unknown): Promise<{ paquet: unknown; table: string; colonne: string }> {
  const b = await instance();
  charger(b);
  return { paquet: remplacer(structuredClone(exportBundle(b)), de, par), ...ou(b.export(), 'acc-principal', de) };
}

const RECUES = [
  ['principal', 'pivot'],
  ['Compte courant', null],
] as const;

describe('#197 · 4. le fichier refuse l’incohérent', () => {
  // Ce qui ne se rattrape pas : une ligne refusée qui écrirait quand même resterait dans le fichier.
  it('une ligne refusée à l’écriture n’écrit rien [niveau 0]', async () => {
    const s = await instance();
    charger(s);
    const compte = lignes(s, 'accounts').find((c) => c.id === 'acc-principal')!;
    for (const c of [
      { cle: 'accounts' as const, ligne: compte, champ: 'name', valeur: undefined, pourquoi: 'un compte sans nom' },
      { cle: 'accounts' as const, ligne: compte, champ: 'kind', valeur: 'pivot', pourquoi: 'un genre de compte inconnu' },
    ]) {
      const avant = contenu(s.export());
      verifierRefusSansEcriture(leve(() => ecrire(s, c)), c.pourquoi, avant, contenu(s.export()));
    }
  });

  it('une ligne incohérente reçue d’une autre instance est refusée sans rien écrire [niveau 0]', async () => {
    for (const [de, par] of RECUES) {
      const { paquet } = await paquetIncoherent(de, par);
      const a = await instance();
      const avant = contenu(a.export());
      verifierRefusSansEcriture(leve(() => importBundle(a, paquet as never)), `${de} reçu comme ${String(par)}`, avant, contenu(a.export()));
    }
  });

  it('chaque colonne obligatoire vide et chaque valeur hors de son énumération est refusée à l’écriture [niveau 2]', async () => {
    const s = await semee();
    for (const c of casIncoherents(s)) verifierRefuse(leve(() => ecrire(s, c)), c.pourquoi);
  });

  it('le refus d’une écriture nomme la table et la colonne [niveau 3]', async () => {
    const s = await semee();
    for (const c of casIncoherents(s)) {
      const { table, colonne } = ou(s.export(), c.ligne.id, c.ligne[c.champ]);
      verifierRefusNomme(leve(() => ecrire(s, c)), table, colonne);
    }
  });

  it('le refus d’une ligne reçue nomme la table et la colonne [niveau 3]', async () => {
    for (const [de, par] of RECUES) {
      const { paquet, table, colonne } = await paquetIncoherent(de, par);
      const a = await instance();
      verifierRefusNomme(leve(() => importBundle(a, paquet as never)), table, colonne);
    }
  });

  it('le fichier lui-même refuse une colonne obligatoire vide et une valeur hors de son énumération [niveau 2]', async () => {
    const s = await semee();
    const bytes = s.export();
    for (const c of casIncoherents(s)) {
      const { table, colonne } = ou(bytes, c.ligne.id, c.ligne[c.champ]);
      verifierRefusFichier(bytes, table, colonne, c.ligne.id, c.valeur ?? null);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 6. Le format précédent est refusé comme #196 le prévoit
// ─────────────────────────────────────────────────────────────────────────────────────────────

const RELAIS = { url: 'https://relais.exemple.invalid/tirelire', room: 'salon-197', passphrase: 'phrase du foyer 197' };

/** Un relais en mémoire, au contrat de `apps/hebergement/serveur/relais.php`. */
function relaisFactice() {
  const depots: Array<Record<string, unknown> & { id: number; site?: unknown }> = [];
  const repondre = (corps: unknown) => new Response(JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', async (entree: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url);
    if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
      const id = depots.length + 1;
      depots.push({ ...(JSON.parse(String(init?.body)) as Record<string, unknown>), id });
      return repondre({ id });
    }
    const site = url.searchParams.get('site') ?? '';
    const apres = Number(url.searchParams.get('after') ?? 0);
    return repondre({ records: depots.filter((r) => r.id > apres && r.site !== site) });
  });
  return depots;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Le chiffrement du relais de `main` avant #197. */
async function depotAvant(texte: string): Promise<{ iv: string; blob: string }> {
  const enc = new TextEncoder();
  const base = await webcrypto.subtle.importKey('raw', enc.encode(RELAIS.passphrase), 'PBKDF2', false, ['deriveKey']);
  const cle = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('tirelire:' + RELAIS.room), iterations: 200_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, enc.encode(texte)));
  return { iv: Buffer.from(iv).toString('base64'), blob: Buffer.from(ct).toString('base64') };
}

describe('#197 · 6. le format précédent est refusé comme #196 le prévoit', () => {
  it('un fichier au format de main avant #197 est refusé en le disant, et rien n’en est effacé [niveau 0]', async () => {
    const avant = fichierAvant();
    const copie = avant.slice();
    verifierRefus(await issue(() => instance(avant)));
    expect(Buffer.from(avant).equals(Buffer.from(copie)), 'le fichier refusé a été modifié').toBe(true);
  });

  it('en direct : une instance au format de main avant #197 arrête la synchronisation, et rien n’est écrit [niveau 0]', async () => {
    const a = await semee();
    const avant = contenu(a.export());
    const p = paquetAvant() as { format: string; version: number; site: string; rows: unknown[]; knowledge: unknown };
    const env = { format: p.format, version: p.version, site: p.site };
    const [x, y] = memoryTransportPair();
    y.onMessage(() => undefined);
    const r = issue(() => runSync(a, x));
    for (const m of [
      { ...env, type: 'hello', knowledge: {} },
      { ...env, type: 'request' },
      { ...env, type: 'changes', rows: p.rows, knowledge: p.knowledge },
      { ...env, type: 'done' },
      { ...env, type: 'bye' },
    ])
      await y.send(m as never);
    const fin = await r;
    expect(fin.etat, 'la synchronisation ne s’arrête pas').not.toBe('sans réponse');
    if (fin.etat === 'accepté') expect(fin.dit, 'la synchronisation se termine sans dire le format').toMatch(/format|version/i);
    verifierRienEcrit(avant, contenu(a.export()));
  });

  it('par fichier : un paquet au format de main avant #197 est refusé en le disant, et rien n’est écrit [niveau 0]', async () => {
    const a = await semee();
    const avant = contenu(a.export());
    verifierRefus(await issue(() => importBundle(a, paquetAvant() as never)));
    verifierRienEcrit(avant, contenu(a.export()));
  });

  it('par le relais : un dépôt d’une instance de main avant #197 arrête la synchronisation, et rien n’est reçu [niveau 0]', async () => {
    const a = await instance();
    charger(a);
    const depots = relaisFactice();
    const { iv, blob } = await depotAvant(JSON.stringify(paquetAvant()));
    depots.push({ id: 1, site: 'avant197000', iv, blob, at: '2026-09-25T00:00:00Z' });
    const avant = JSON.stringify(etat(a));
    verifierRefus(await issue(() => relaySync(a, RELAIS), 10_000));
    verifierRienEcrit(avant, JSON.stringify(etat(a)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 7. Ce qui tenait tient encore
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Ce que l'import a produit, sans identifiants : opérations, rapprochements, ventilations. */
function releve(store: LedgerStore): unknown {
  const ops = importees(store);
  const cle = (o: Ligne) => [o['accountId'], o['date'], o['label'], o['amount']].join('|');
  const tries = [...ops].sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0));
  const rang = new Map(tries.map((o, i) => [o.id, i]));
  const ventilations = lignes(store, 'subOperations').filter((a) => !a['deletedAt']);
  const ou_ = (v: unknown) => v ?? null;
  return tries.map((o) => ({
    accountId: o['accountId'],
    date: o['date'],
    label: o['label'],
    details: ou_(o['details']),
    amount: o['amount'],
    state: o['state'],
    oneOff: ou_(o['oneOff']),
    plannedFlowId: ou_(o['plannedFlowId']),
    transferAccountId: ou_(o['transferAccountId']),
    transfer: o['transferOperationId'] ? (rang.get(String(o['transferOperationId'])) ?? 'inconnue') : null,
    allocations: ventilations
      .filter((a) => a['operationId'] === o.id)
      .map((a) => ({ categoryId: ou_(a['categoryId']), tirelireId: ou_(a['tirelireId']), share: ou_(a['share']), replenishment: ou_(a['replenishment']) }))
      .map((a) => JSON.stringify(a))
      .sort(),
  }));
}

describe('#197 · 7. ce qui tenait tient encore', () => {
  it('un fichier exporté se rouvre à l’identique [niveau 0]', async () => {
    const a = await semee();
    a.remove('categories', 'cat-abos');
    const bytes = a.export();
    const b = await instance(bytes.slice());
    expect(etat(b)).toEqual(etat(a));
    expect(contenu(b.export())).toBe(contenu(bytes));
  });

  it('l’exemple se charge et donne le même plan qu’avant [niveau 2]', async () => {
    const s = await instance();
    charger(s);
    verifierMemePlan(s);
  });

  it('un import de relevé inventé donne les mêmes opérations, classements compris [niveau 2]', async () => {
    const s = await semee();
    expect(releve(s)).toEqual(deplier(RELEVE_AVANT));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Témoins rouges : les mêmes assertions, sur une version volontairement cassée du besoin.
// ─────────────────────────────────────────────────────────────────────────────────────────────

it.fails('témoin rouge · un fichier qui garde les noms envelopes et rules [niveau 2]', () => {
  // Version cassée : le fichier de main avant #197.
  verifierNomsDuDomaine(fichierAvant());
});

it.fails('témoin rouge · une colonne que l’application ne lit ni n’écrit [niveau 2]', async () => {
  const s = await semee();
  const bytes = s.export();
  // Version cassée : une colonne ajoutée au fichier, que rien n'écrit ni ne lit.
  const { table } = ou(bytes, 'acc-principal', 'principal');
  verifierRienDeMort(await sonder(modifier(bytes, (db) => db.run(`ALTER TABLE "${table}" ADD COLUMN colonne_morte_197 TEXT`))));
});

it.fails('témoin rouge · un ancien genre de compte lu comme le nouveau [niveau 2]', () => {
  // Version cassée : la lecture qui traduit `pivot` en `principal`.
  verifierPasDeSynonyme({ etat: 'accepté', dit: JSON.stringify('principal') }, 'principal');
});

it.fails('témoin rouge · une clé d’opération à 32 hexadécimaux [niveau 2]', () => {
  verifierCles(['op_' + '0123456789abcdef'.repeat(2)]);
});

it.fails('témoin rouge · une ligne refusée qui écrit quand même [niveau 0]', () => {
  // Version cassée : l'écriture a eu lieu avant le refus.
  verifierRefusSansEcriture(new Error('refusé'), 'un compte sans nom', 'avant', 'après');
});

it.fails('témoin rouge · un refus qui ne nomme pas la colonne [niveau 3]', () => {
  verifierRefusNomme(new Error('Écriture refusée : accounts est incomplet.'), 'accounts', 'name');
});

it.fails('témoin rouge · un fichier qui accepte un genre de compte inconnu [niveau 2]', () => {
  // Version cassée : le fichier de main avant #197, sans contrainte.
  verifierRefusFichier(fichierAvant(), 'accounts', 'kind', 'cpt-avant-197', 'pivot');
});

it.fails('témoin rouge · un fichier du format précédent ouvert sans lire son format [niveau 0]', async () => {
  // Version cassée : l'ouverture prend toute base SQLite, sans lire son marqueur ni sa version.
  verifierRefus(await issue(() => new SQL.Database(fichierAvant())));
});

it.fails('témoin rouge · un plan qui n’est plus celui d’avant [niveau 2]', async () => {
  const s = await instance();
  // Version cassée : l'exemple chargé sans le besoin de l'Alimentation.
  const l = exampleLedger();
  l.needs = l.needs.filter((n) => n.tirelireId !== 'env-alim');
  charger(s, l);
  verifierMemePlan(s);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Ce que main donnait avant #197 (966ebc3), données inventées (D84), compressé par gzip en base64 :
// un fichier (un compte, une tirelire, un besoin, une catégorie, un flux qui engendre un
// automatisme, un réglage) et le paquet de la même instance ; le plan de l'exemple au 6 septembre
// 2026, au 20 octobre 2026 et au 10 janvier 2027 ; ce que donne l'import du relevé ci-dessus.
// Les plans sont adaptés par #184, qui ne lisse plus rien d'office : chaque ligne porte la part d'un
// lissage décidé (`smoothing`, 50 € pour la taxe foncière en septembre et en octobre), et une
// échéance demande sa croisière plus cette part, qui sont aussi son rattrapage et son plancher (D06,
// D88) ; tous les montants demandés, financés et virés sont ceux d'avant. Ils sont adaptés encore par
// #393 : l'ordre permanent du plan porte ses ordres, son signalement et ses parts, le plan propose
// l'ordre et sa ventilation, le message dit « enregistré » ; et le virement « TIRELIRE LIVRET A » du
// relevé, que l'ordre de l'exemple reprend, prend les parts de cet ordre, qui n'en a pas encore
// (#395) : son montant reste non affecté sur le Livret A (D21, point 3 de #393). Rien d'autre ne
// change, au centime.
// ─────────────────────────────────────────────────────────────────────────────────────────────

function deplier(b64: string): unknown {
  return JSON.parse(gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
}

function fichierAvant(): Uint8Array {
  return new Uint8Array(gunzipSync(Buffer.from(FICHIER_AVANT, 'base64')));
}

function paquetAvant(): unknown {
  return deplier(PAQUET_AVANT);
}

const FICHIER_AVANT = 
  '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';
const PAQUET_AVANT = 
  'H4sIAAAAAAAAA62UXW7bMAzHr1Lw2QGctGkavbYYsOftrR4MxmZiIbLk0bSTIDCwa+wIO8duspMM8kfSrGmaYXsURYnk709yD0vH' +
  'OQooEM1kNNOIBAUCqIlL7SyocQClFgIFWKOV8XwWhiEEILvCGwv8WpF/sMCSQO2bANbWbQylK388eaRgPJuHk/ndXRiG4ViFYThT' +
  'Lx2aANhtSlDPe/BJYZK4ykoJAegUFCSFjFr/0Xg+gwAyk5z7dKJOU619IhZzn++jywuhm/TXt++t003301pbH6BgbRNdoGkLsmtQ' +
  'tjImGBKJbZUviAerK8hqu4oXaNAmBGo89TkcL1JswU3Cyf0ofBhNHjw3xmRdxiWJGMrJyvDb0RJLxlRmzqRn7lLNlEgrzZCb6Jri' +
  'Jbv8D5O4wZCSIaE0xj5a0wQdYbI1GVfQAbFovgbx7QXEn/tWegW5MJj0JcPzPhqofkwjUNGpuBEEEZQZMkWg9lGrT+tVI2tcGIqg' +
  'ab7AGQ3ewc/OGFcfNXyTjCVKD1QWVF5D5e4clQFxfJZv33hMScWs7QqCHmOvZO4JgZp0jVUQa5fqRMsOFOwj0FaIazSRH9QIKqul' +
  'xZQ7K1kLEW2SOX5CofbiCCOCBoLO0eziIVAXtmDtuA0yCf+xwxIUWjnWxxZL8Kopnl6aYpSfP9pfXzcZsh8TfZidy/wtSsX+S9oW' +
  'ZEuCC6UUBq2lNF4av6T6apam2l5Tzv2Fcj6YavvWSlrqLaWPGfLK5zbINJq2/TDspbPb8aTwjkXrTVwgS/zybX/bSbV7YfpfDTcf' +
  'hdOu4fxQxhttU7eJU9yVoG6HsmJxhrgb4y68wQWZuEAR4sPCG1bA3yzAHNdUxlz5V+MAHOuVtu/2rl+72q4OWnc0PgmyPOHuba1n' +
  '57Su0VTtOnrwq6v5DZIgwzd8BwAA';
const PLANS_AVANT = 
  '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' +
  'AA==';
const RELEVE_AVANT = 
  'H4sIAAAAAAAAA+2WXW/aMBSG/4p1rhPNBOggdyY1baRAUD6qTU0v3GBaa8ZBJlAhxH+vwkcJMFppGVUn7SaK49cf5zlvjn2/BJam' +
  '2Uzl7hDs4t2UYq55DgYMWc7BBgtbVyZum7gGBkj2yCXYcOcGKHID6rkBRZ57F9AIkWIMz5mQ061iQIMe6dN+9FstGxfrgn2FMcYG' +
  'TPPNepqnmUqF5EMwIFPcH43AVjMpDZhIphQfdmX2Umx38zHXTE1HXJOjOCZaqFRMmIS9BmzLACZllrJcZGoK9v3DyjhlUB57gKFl' +
  'Wq0jDCEdEBRQJ0Yh8UgRI+0NPP8njYMTIHvtNbX3OhQS1PMjt2u/zUH8OCoxqjcOIc1UrjnLKzA67Ni1q7C5oEXMP/YIjGT2Ys6F' +
  '3vv6nGFOBGDjykTqJSIOCSKKflgYtxG2vuE2CuN1/IFzSw/IvKtE1zHq+HFwUwbUajY+3R6wTCBlOX/K9MIdJmCvmyaTYpyAkUAu' +
  'NJdC820fV/N93/SZaZ6AvUzgl1AbwZxpwR4lT2BlJKD5RHIlps9jrvJks4MV/E/Av5aAxrkE1AusHT/2SP+GBu4aq+O7/XIitlHv' +
  'INes+tcvgs1SwNS5paTvUDQoSprb6/kIY1yz6u8E2W5WqnWp5kNxps5VMJXMnvjGCMfGWk/yiYZqHh0yDuki4nm+QyLX74cfHLoO' +
  '6ZZ+21q1cyVlo78Oei36epSLm0rxdEhUXFA+oPym291rNsNDOohor7MevkvB92opkNmC6wu4fcH1BZLw8AouDSKzcQsAAA==';
