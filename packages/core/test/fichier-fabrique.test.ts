/**
 * Tests du codeur de #198 — « Un fichier fabriqué dehors s'ouvre, ou dit clairement pourquoi il ne
 * s'ouvre pas (D58) ». Tous de niveau 4 (D83).
 *
 * L'auditeur en a retenu la plupart dans son harnais, `fichier-fabrique-harnais.test.ts` et, côté
 * application, `apps/web/test/fichier-fabrique-harnais.test.ts`, où ils ont leur niveau. Restent ici
 * ceux qu'il n'a pas retenus : un réglage présent sans horloge, gardé et daté, les autres prenant
 * leur défaut (le harnais garde le réglage absent, et l'exemple avec ses réglages) ; une base qui
 * n'est pas un fichier Tirelire, refusée en le disant (déjà gardée par `apps/web/test/fichier-etat.test.ts`,
 * « #196 · 6 », au registre de C8).
 */
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, FILE_FORMAT, FORMAT_VERSION, LedgerStore } from '../src/index.js';

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

type Valeur = string | number | null;
/** Une table fabriquée : ses colonnes, et ses lignes dans l'ordre des colonnes. */
type Table = { colonnes: string[]; lignes: Valeur[][] };

/** Un fichier fabriqué hors de l'application : le marqueur et la version du format, puis les tables données. */
function fabriquer(tables: Record<string, Table> = {}): Uint8Array {
  const db = new SQL.Database();
  db.run('CREATE TABLE meta (key TEXT, value TEXT)');
  db.run('INSERT INTO meta VALUES (?, ?), (?, ?)', ['format', FILE_FORMAT, 'format_version', String(FORMAT_VERSION)]);
  for (const [nom, t] of Object.entries(tables)) {
    db.run(`CREATE TABLE ${nom} (${t.colonnes.join(', ')})`);
    for (const l of t.lignes) db.run(`INSERT INTO ${nom} VALUES (${l.map(() => '?').join(', ')})`, l);
  }
  const octets = db.export();
  db.close();
  return octets;
}

const ouvrir = (octets: Uint8Array, siteId = 'ouvreur') => LedgerStore.create({ sqlJs: SQL, bytes: octets, verifier: true, siteId });

describe('[niveau 4] #198 · 1. ce qui manque à un fichier fabriqué se complète', () => {
  it('un réglage présent sans horloge est gardé et daté ; les autres prennent leur défaut', async () => {
    const s = await ouvrir(fabriquer({ settings: { colonnes: ['key', 'value'], lignes: [['periodStartDay', '28']] } }));
    expect(s.load().settings.periodStartDay).toBe(28);
    expect(s.load().settings.orderRounding).toBe(DEFAULT_SETTINGS.orderRounding);
    expect(s.completion.horloges).toEqual([{ table: 'settings', id: 'periodStartDay' }]);
  });
});

describe('[niveau 4] #198 · 3. une base qui n’est pas un fichier Tirelire', () => {
  it('reste refusée en le disant, comme avant', async () => {
    const db = new SQL.Database();
    db.run('CREATE TABLE notes (texte TEXT)');
    const octets = db.export();
    db.close();
    await expect(ouvrir(octets)).rejects.toMatchObject({ reason: 'etranger' });
    await expect(ouvrir(new TextEncoder().encode('date;libellé;montant'))).rejects.toMatchObject({ reason: 'illisible' });
  });
});
