/**
 * Sonde des colonnes dérivées (#314, point 6 ; reprise de #197, point 5) : ce n'est pas un test.
 * Elle sème un fichier comme le fait le harnais de #197 — l'exemple chargé comme l'application, un
 * automatisme, un appareil, puis un relevé inventé importé comme l'écran Import —, et écrit sur la
 * sortie standard, en JSON, les colonnes de la table des opérations qui valent, pour chaque opération
 * importée, son libellé normalisé : `{ derivees, normalisables }`, `normalisables` disant qu'au moins
 * un libellé importé change en se normalisant (sans quoi la mesure ne trancherait rien).
 *
 * Le cœur est en TypeScript, ses imports internes en `.js` : `colonnes-derivees.test.mjs` la lance par
 * `node --experimental-transform-types --import ./colonnes-derivees-crochet.mjs`, le crochet
 * résolvant un `.js` absent vers son `.ts`.
 */
import { createRequire } from 'node:module';

const coeur = await import(new URL('../core/src/index.ts', import.meta.url).href);
const { LedgerStore, addDays, bankMultiAccountProfile, exampleLedger, normalizeLabel, parseCsv, parseRows, prepareImport, rankBetween, runPipeline } = coeur;
const initSqlJs = createRequire(new URL('../core/package.json', import.meta.url))('sql.js');
const SQL = await initSqlJs();

const CLES = ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows', 'operations', 'subOperations', 'automations', 'importProfiles', 'devices'];
const NUM_COURANT = '00011111971';
const NUM_LIVRET = '00022222971';
/** Le relevé inventé du harnais de #197 (D84). */
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

const store = await LedgerStore.create({ sqlJs: SQL });
// L'exemple, comme l'application (`replaceWith`) : toutes les tables, puis les réglages.
const l = exampleLedger();
for (const cle of CLES) for (const r of l[cle]) store.upsert(cle, r);
for (const [k, v] of Object.entries(l.settings)) if (k !== 'siteId') store.setSetting(k, v);
// Un automatisme, comme l'écran Opérations en crée depuis une recherche (D39), et un appareil.
store.upsert('automations', { id: 'auto-supermarche-197', name: 'Supermarché', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim' }, rank: rankBetween(undefined, undefined) });
store.upsert('devices', { id: 'appareil-197', name: 'Tablette du salon' });
// L'import comme l'écran Import (`doImport`) : profil, opérations retenues, puis la chaîne automatique.
const p = bankMultiAccountProfile('profil-197');
p.accountMap = { [NUM_COURANT]: 'acc-principal', [NUM_LIVRET]: 'acc-livret' };
store.upsert('importProfiles', p);
const lu = parseRows(parseCsv(RELEVE), p);
if (lu.errors.length) throw new Error(`le relevé inventé ne se lit pas : ${JSON.stringify(lu.errors)}`);
const prep = prepareImport(store.load(), lu.rows, p);
const nouvelles = prep.candidates.filter((c) => (c.exact ? false : c.probable ? (c.similarity ?? 0) < 0.5 : true)).map((c) => c.operation);
for (const o of nouvelles) store.upsert('operations', o);
const dates = nouvelles.map((o) => o.date).sort();
if (dates.length) {
  runPipeline(store.load(), dates[0], addDays(dates[dates.length - 1], 1), (patch) => {
    for (const o of patch.operations) store.upsert('operations', o);
    for (const a of patch.subOperations) store.upsert('subOperations', a);
    for (const id of patch.removedSubOperations ?? []) store.remove('subOperations', id);
    return store.load();
  });
}

const ops = store.load().operations.filter((o) => o.origin === 'imported' && !o.deletedAt);
if (!ops.length) throw new Error('aucune opération importée');
const bytes = store.export();
const db = new SQL.Database(bytes);
try {
  // La table des opérations, retrouvée par ce qu'elle contient : celle qui porte toutes les opérations importées.
  const tables = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)[0]?.values.map((v) => String(v[0])) ?? [];
  const marques = ops.map(() => '?').join(', ');
  let r = null;
  for (const t of tables) {
    const cols = db.exec(`PRAGMA table_info("${t}")`)[0]?.values.map((v) => String(v[1])) ?? [];
    if (!cols.includes('id')) continue;
    const x = db.exec(`SELECT * FROM "${t}" WHERE id IN (${marques})`, ops.map((o) => o.id))[0];
    if (x && x.values.length === ops.length) {
      r = x;
      break;
    }
  }
  if (!r) throw new Error('aucune table ne porte les opérations importées');
  const libelle = new Map(ops.map((o) => [o.id, String(o.label)]));
  const idx = r.columns.indexOf('id');
  const derivees = r.columns.filter((_c, k) => r.values.every((v) => v[k] === normalizeLabel(libelle.get(String(v[idx])))));
  const normalisables = ops.some((o) => normalizeLabel(String(o.label)) !== o.label);
  process.stdout.write(`${JSON.stringify({ derivees, normalisables })}\n`);
} finally {
  db.close();
}
