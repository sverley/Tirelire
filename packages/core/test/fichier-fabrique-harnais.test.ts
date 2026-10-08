/**
 * Harnais d'audit de #198 — « Un fichier fabriqué dehors s'ouvre, ou dit clairement pourquoi il ne
 * s'ouvre pas (D58) ». Côté cœur ; ce que l'application en fait — un fichier importé refusé qui ne
 * remplace rien, le fichier tenu qui n'est pas revérifié au démarrage (points 3 et 9) — est gardé par
 * le second fichier du harnais, `apps/web/test/fichier-fabrique-harnais.test.ts`.
 *
 * Composé après le codage (auditeur.md, étape 2) : pour chaque phrase du « Fait quand » qu'un test
 * tranche, le test du codeur quand il la tranche — repris de `fichier-fabrique.test.ts`, qui garde
 * les siens non retenus, au niveau 4 —, sinon le mien. Sont de moi : une sauvegarde de l'application,
 * toutes tables, lignes supprimées et sous-opérations à plusieurs niveaux, qui se rouvre sous la
 * vérification entière (la vérification ne refuse jamais ce que l'application a écrit) ; une ligne
 * qui a déjà une horloge la garde ; chaque violation du point 2 qui se lit ligne par ligne, refusée
 * aussi à la réception d'un paquet (point 6 : le codeur n'en jouait que trois) ; les quatre refus que
 * le codeur a ajoutés à la liste du point 2 — une sous-opération sous une autre opération que la
 * sienne, un cycle de parents, une catégorie son propre parent, une clé de `meta` autre que le format
 * et sa version (D88, point 4 : « tout le reste refuse ») — qu'aucun test ne gardait ; la commande
 * jouée sans aucune connexion hors de la machine (I7), par le script du `package.json`.
 *
 * Tour 2 : les tests du codeur sur les identifiants des colonnes JSON (points 2 et 10 amendés, porteur,
 * 02/10) et sur le chemin relatif de la commande sont repris ici, tous ; son fichier
 * `fichier-fabrique-json.test.ts` n'a plus lieu d'être. Est de moi : la sauvegarde de l'application,
 * `C5`, porte aussi ces identifiants, dont certains désignent des lignes supprimées.
 *
 * Chaque `describe` reprend un point du « Fait quand », sous son numéro ; le dernier, `C5`, garde ce
 * que la vérification ne doit jamais refuser. Le point 11, la documentation, est relu. Le point 8 est joué selon le texte que le codeur propose au porteur dans
 * l'issue — celui de l'issue ne peut pas tenir, l'exemple portant des réglages et un compte
 * principal renseignés — et attend sa réponse.
 *
 * Niveaux (D83), par le besoin que couvre chaque test ; le niveau d'un test est dans son titre, ou
 * dans celui de sa suite :
 * - 0 · l'irréparable : une sauvegarde de l'application se rouvre sous la vérification entière
 *   (C5 : « tout revient ») ; la commande ne fait rien sortir de la machine (I7).
 * - 1 · une promesse tombe : toutes les lignes d'un fichier fabriqué qui s'est ouvert atteignent une
 *   autre instance (I8) ; un compte principal resté à son défaut cède devant un compte principal
 *   renseigné (D40, I8 — la promesse du harnais du registre `apps/web/test/compte-principal.test.ts`).
 * - 2 · un cas est faux : ce qui se complète, chaque violation refusée, ce que le refus nomme, la
 *   commande, les mêmes refus à l'écriture et à la réception, l'exemple, le fichier tenu, chaque
 *   colonne qui désigne une autre table.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import {
  computePlan,
  DEFAULT_SETTINGS,
  exampleLedger,
  exportBundle,
  FichierRefuse,
  feuillesDe,
  FILE_FORMAT,
  FORMAT_VERSION,
  FormatRefused,
  importBundle,
  LedgerStore,
  MAIN_ACCOUNT_ID,
  RowRefused,
  siteOf,
  TABLES,
  verifierFichier,
  type Ledger,
  type LedgerKey,
  type RowState,
} from '../src/index.js';

const SQL = await initSqlJs();

type Valeur = string | number | null | undefined;
/** Une ligne fabriquée : colonne → valeur, telle qu'un script l'écrirait. */
type Ligne = Record<string, Valeur>;
type Tables = Record<string, Ligne[]>;

/** Un fichier fabriqué hors de l'application : le marqueur et la version, puis des tables sans clé, sans `CHECK`, sans horloge. */
function fabriquer(tables: Tables = {}): Uint8Array {
  const db = new SQL.Database();
  db.run('CREATE TABLE meta (key TEXT, value TEXT)');
  db.run('INSERT INTO meta VALUES (?, ?), (?, ?)', ['format', FILE_FORMAT, 'format_version', String(FORMAT_VERSION)]);
  for (const [nom, lignes] of Object.entries(tables)) {
    if (nom === 'meta') {
      for (const l of lignes) db.run('INSERT INTO meta VALUES (?, ?)', [l['key'] ?? null, l['value'] ?? null]); // des clés de plus, dans la table qui porte le format
      continue;
    }
    const cols = [...new Set(lignes.flatMap((l) => Object.keys(l)))];
    db.run(`CREATE TABLE ${nom} (${cols.join(', ')})`);
    for (const l of lignes) db.run(`INSERT INTO ${nom} VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => l[c] ?? null));
  }
  const octets = db.export();
  db.close();
  return octets;
}

const ouvrir = (octets: Uint8Array, siteId = 'ouvreur') => LedgerStore.create({ sqlJs: SQL, bytes: octets, verifier: true, siteId });

async function refus(octets: Uint8Array): Promise<FichierRefuse> {
  try {
    (await ouvrir(octets)).close();
  } catch (err) {
    if (err instanceof FichierRefuse) return err;
    throw err;
  }
  throw new Error('Le fichier s’est ouvert : un refus était attendu.');
}

const OP: Ligne = { id: 'op-1', account_id: MAIN_ACCOUNT_ID, origin: 'manual', date: '2026-09-06', label: 'Pain', amount: -350, state: 'untreated' };
const op = (o: Ligne = {}): Ligne => ({ ...OP, ...o });
const VARIABLE = '{"kind":"variable"}';
const FIXE = '{"kind":"fixed","amount":-100}';
const part = (id: string, share: string, o: Ligne = {}): Ligne => ({ id, operation_id: 'op-1', share, ...o });
const PLACEMENT_2_VARIABLES = JSON.stringify([
  { accountId: MAIN_ACCOUNT_ID, share: { kind: 'variable' } },
  { accountId: MAIN_ACCOUNT_ID, share: { kind: 'variable' } },
]);

const enSql = (type: string, v: unknown): Valeur => (v === undefined || v === null ? null : type === 'json' ? JSON.stringify(v) : type === 'boolean' ? (v ? 1 : 0) : (v as Valeur));

/** Les lignes d'un grand livre, table par table, toutes les colonnes du format, sans horloge. */
function tablesDe(l: Ledger, o: { sansPrincipal?: boolean; reglages?: boolean } = {}): Tables {
  const tables: Tables = {};
  for (const [cle, t] of Object.entries(TABLES)) {
    const lignes = (l[cle as LedgerKey] as unknown as Array<Record<string, unknown>>).filter((r) => !(o.sansPrincipal && r['id'] === MAIN_ACCOUNT_ID));
    if (lignes.length) tables[t.name] = lignes.map((r) => Object.fromEntries(t.columns.map((c) => [c.col, enSql(c.type, r[c.prop])])));
  }
  if (o.reglages)
    tables['settings'] = Object.entries(l.settings)
      .filter(([k]) => k !== 'siteId')
      .map(([key, v]) => ({ key, value: JSON.stringify(v) }));
  return tables;
}

/** L’exemple, plus un automatisme et un profil d’import rattaché à un compte, qu’il n’a pas, avec chacun leurs identifiants dans leurs colonnes JSON. */
function exempleCompletDeToutesLesTables(): Ledger {
  const l = exampleLedger();
  l.automations.push({
    id: 'auto-198',
    selection: { labelPattern: 'SALAIRE', accountId: MAIN_ACCOUNT_ID },
    action: {
      categoryId: 'cat-loyer',
      tirelireId: 'env-vac',
      allocation: [
        { categoryId: 'cat-loyer', tirelireId: 'env-vac', share: { kind: 'fixed', amount: 1000 } },
        { categoryId: 'cat-salaire', share: { kind: 'variable' } },
      ],
      state: 'none',
    },
    rank: 'a',
  });
  l.importProfiles.push({
    id: 'profil-198',
    name: 'Banque',
    source: 'bank',
    encoding: 'auto',
    delimiter: 'auto',
    headerRow: 0,
    columns: { date: 'Date', label: 'Libellé', amount: 'Montant' },
    dateFormat: 'DMY',
    accountMap: { 'FR76 0001': MAIN_ACCOUNT_ID },
    accountId: MAIN_ACCOUNT_ID,
  });
  return l;
}

describe('[niveau 2] #198 · 1. un fichier fabriqué au format s’ouvre, et ce qui lui manque et se déduit se complète', () => {
  it('un fichier qui ne porte que le marqueur et la version s’ouvre : tables vides, réglages par défaut, compte principal né à son défaut, rien ne voyage', async () => {
    const s = await ouvrir(fabriquer());
    const l = s.load();
    expect(l.accounts.map((a) => a.id)).toEqual([MAIN_ACCOUNT_ID]);
    expect(l.operations).toEqual([]);
    const { siteId: _s, ...reglages } = l.settings;
    const { siteId: _d, ...defauts } = DEFAULT_SETTINGS;
    expect(reglages).toEqual(defauts);
    expect(s.completion.comptePrincipal).toBe(true);
    expect(s.completion.tables).toEqual([...Object.values(TABLES).map((t) => t.name), 'settings']);
    expect(s.rowsNewerThan({})).toEqual([]); // le compte principal né à son défaut ne voyage pas (D40)
  });

  it('une colonne facultative absente vaut vide ; une ligne sans horloge reçoit une horloge de l’instance qui ouvre', async () => {
    const s = await ouvrir(fabriquer({ operations: [OP] }));
    const o = s.load().operations[0]!;
    expect(o).toMatchObject({ id: 'op-1', amount: -350, date: '2026-09-06' });
    expect(o.details).toBeUndefined();
    expect(s.completion.colonnes).toContain('operations.details');
    expect(siteOf(String(s.query(`SELECT hlc FROM operations WHERE id = 'op-1'`)[0]!['hlc']))).toBe('ouvreur');
  });

  it('une ligne qui a déjà une horloge la garde, sans en recevoir une autre', async () => {
    const s = await ouvrir(fabriquer({ operations: [op({ hlc: '1788000000000:0000:telephone' })] }));
    expect(s.query(`SELECT hlc FROM operations WHERE id = 'op-1'`)[0]!['hlc']).toBe('1788000000000:0000:telephone');
    expect(s.completion.horloges).toEqual([]);
  });
});

/** Chaque violation du point 2 : un fichier, ce que le refus nomme, et si elle se lit ligne par ligne (`lie` : seulement dans le fichier entier). */
interface Violation {
  cas: string;
  tables: Tables;
  table: string;
  id?: string;
  colonne?: string;
  lie?: true;
  /** Pour un identifiant dans une colonne JSON : son chemin, tel que `feuillesDe` le dit (point 10). */
  chemin?: string;
}
const AUTO = (selection: string, action: string): Ligne => ({ id: 'a-1', selection, action, rank: 'a' });
/** Un flux prévu, d'action `action` (#393, point 12). */
const FLUX = (action: string): Ligne => ({
  id: 'f-1',
  name: 'Loyer',
  kind: 'fixedCharge',
  amount: -70000,
  account_id: 'acc-principal',
  periodicity: '{"interval":1,"unit":"month","anchorDate":"2026-09-05"}',
  date_window_days: 3,
  action,
});
const PROFIL = (accountMap: string): Ligne => ({
  id: 'p-1',
  name: 'Banque',
  source: 'bank',
  encoding: 'auto',
  delimiter: 'auto',
  header_row: 0,
  columns: '{"date":"Date","label":"Libellé"}',
  date_format: 'DMY',
  account_map: accountMap,
});
const VIOLATIONS: Violation[] = [
  { cas: 'une table qui n’est pas du format', tables: { budgets: [{ id: 'b' }] }, table: 'budgets' },
  { cas: 'une colonne qui n’est pas du format', tables: { operations: [op({ montant_euros: 3.5 })] }, table: 'operations', colonne: 'montant_euros' },
  { cas: 'une colonne obligatoire vide', tables: { operations: [op({ label: null })] }, table: 'operations', id: 'op-1', colonne: 'label' },
  { cas: 'une valeur hors de son énumération', tables: { operations: [op({ state: 'pointee' })] }, table: 'operations', id: 'op-1', colonne: 'state' },
  { cas: 'un booléen hors de 0 et 1', tables: { operations: [op({ one_off: 2 })] }, table: 'operations', id: 'op-1', colonne: 'one_off' },
  { cas: 'un montant qui n’est pas un entier de centimes', tables: { operations: [op({ amount: -3.5 })] }, table: 'operations', id: 'op-1', colonne: 'amount' },
  { cas: 'un montant écrit en texte', tables: { operations: [op({ amount: '-3,50' })] }, table: 'operations', id: 'op-1', colonne: 'amount' },
  { cas: 'une date mal formée', tables: { operations: [op({ date: '06/09/2026' })] }, table: 'operations', id: 'op-1', colonne: 'date' },
  { cas: 'une date qui n’existe pas', tables: { operations: [op({ date: '2026-02-30' })] }, table: 'operations', id: 'op-1', colonne: 'date' },
  { cas: 'un horodatage qui n’a pas la forme qu’écrit l’application', tables: { operations: [op({ deleted_at: '2026-09-06 10:00' })] }, table: 'operations', id: 'op-1', colonne: 'deleted_at' },
  { cas: 'une colonne JSON qui ne se lit pas', tables: { operations: [OP], sub_operations: [part('s-1', '{fixed')] }, table: 'sub_operations', id: 's-1', colonne: 'share' },
  { cas: 'une part ni fixe, ni en pourcentage, ni variable', tables: { operations: [OP], sub_operations: [part('s-1', '{"kind":"moitie"}')] }, table: 'sub_operations', id: 's-1', colonne: 'share' },
  { cas: 'deux parts variables dans une ventilation (D27)', tables: { operations: [OP], sub_operations: [part('s-1', VARIABLE), part('s-2', VARIABLE)] }, table: 'sub_operations', id: 's-2', colonne: 'share', lie: true },
  {
    cas: 'deux parts variables dans un placement (D38)',
    tables: { tirelires: [{ id: 't-1', name: 'Vacances', placement: PLACEMENT_2_VARIABLES, opening_balance: 0, opening_date: '2026-09-01' }] },
    table: 'tirelires',
    id: 't-1',
    colonne: 'placement',
  },
  { cas: 'un identifiant qui se répète dans une table', tables: { operations: [OP, OP] }, table: 'operations', id: 'op-1', colonne: 'id', lie: true },
  { cas: 'une ventilation sans son opération', tables: { sub_operations: [part('s-1', VARIABLE, { operation_id: 'op-absente' })] }, table: 'sub_operations', id: 's-1', colonne: 'operation_id', lie: true },
  { cas: 'une sous-opération rangée sous une sous-opération d’une autre opération (D88)', tables: { operations: [OP, op({ id: 'op-2' })], sub_operations: [part('s-1', FIXE), part('s-2', FIXE, { operation_id: 'op-2', parent_id: 's-1' })] }, table: 'sub_operations', id: 's-2', colonne: 'parent_id', lie: true },
  { cas: 'des sous-opérations qui se contiennent l’une l’autre (D88)', tables: { operations: [OP], sub_operations: [part('s-1', FIXE, { parent_id: 's-2' }), part('s-2', FIXE, { parent_id: 's-1' })] }, table: 'sub_operations', id: 's-1', colonne: 'parent_id', lie: true },
  { cas: 'une catégorie qui est son propre parent', tables: { categories: [{ id: 'c-1', name: 'Courses', nature: 'expense', parent_id: 'c-1' }] }, table: 'categories', id: 'c-1', colonne: 'parent_id', lie: true },
  { cas: 'une clé de meta autre que le format et sa version', tables: { meta: [{ key: 'auteur', value: 'script' }] }, table: 'meta', id: 'auteur', lie: true },
  // Un identifiant dans une colonne JSON désigne une ligne absente (points 2 et 10, porteur 02/10) : chacun refuse, comme une colonne.
  ...(
    [
      ['tirelires.placement[].accountId', 'tirelires', 't-1', 'placement', { id: 't-1', name: 'Vacances', placement: '[{"accountId":"acc-absent","share":{"kind":"variable"}}]', opening_balance: 0, opening_date: '2026-09-01' }],
      ['automations.selection.accountId', 'automations', 'a-1', 'selection', AUTO('{"accountId":"acc-absent"}', '{}')],
      ['automations.action.categoryId', 'automations', 'a-1', 'action', AUTO('{}', '{"categoryId":"cat-absente"}')],
      ['automations.action.tirelireId', 'automations', 'a-1', 'action', AUTO('{}', '{"tirelireId":"env-absente"}')],
      ['automations.action.allocation[].categoryId', 'automations', 'a-1', 'action', AUTO('{}', '{"allocation":[{"categoryId":"cat-absente","share":{"kind":"variable"}}]}')],
      ['automations.action.allocation[].tirelireId', 'automations', 'a-1', 'action', AUTO('{}', '{"allocation":[{"tirelireId":"env-absente","share":{"kind":"variable"}}]}')],
      ['planned_flows.action.categoryId', 'planned_flows', 'f-1', 'action', FLUX('{"categoryId":"cat-absente"}')],
      ['planned_flows.action.tirelireId', 'planned_flows', 'f-1', 'action', FLUX('{"tirelireId":"env-absente"}')],
      ['planned_flows.action.allocation[].categoryId', 'planned_flows', 'f-1', 'action', FLUX('{"allocation":[{"categoryId":"cat-absente","share":{"kind":"variable"}}]}')],
      ['planned_flows.action.allocation[].tirelireId', 'planned_flows', 'f-1', 'action', FLUX('{"allocation":[{"tirelireId":"env-absente","share":{"kind":"variable"}}]}')],
      ['planned_flows.kept.parts[].tirelireId', 'planned_flows', 'f-1', 'kept', { ...FLUX('{}'), action: null, kept: '{"amount":30000,"parts":[{"tirelireId":"env-absente","amount":10000}]}' }],
      ['import_profiles.account_map{}', 'import_profiles', 'p-1', 'account_map', PROFIL('{"FR76 0001":"acc-absent"}')],
    ] as const
  ).map(([chemin, table, id, colonne, ligne]): Violation => ({ cas: `${chemin} vers une ligne absente`, tables: { [table]: [ligne] }, table, id, colonne, lie: true, chemin })),
  { cas: 'une horloge présente qui ne se lit pas', tables: { operations: [op({ hlc: 'hier' })] }, table: 'operations', id: 'op-1', colonne: 'hlc' },
  {
    cas: 'un second compte principal (D40)',
    tables: { accounts: [{ id: 'acc-2', name: 'Autre', kind: 'principal', opening_balance: 0, opening_date: '2026-09-01' }] },
    table: 'accounts',
    id: 'acc-2',
    colonne: 'kind',
  },
  { cas: 'un réglage qui n’est pas du format', tables: { settings: [{ key: 'devise', value: '"EUR"' }] }, table: 'settings', id: 'devise' },
  { cas: 'un réglage d’une valeur hors de sa forme', tables: { settings: [{ key: 'periodStartDay', value: '32' }] }, table: 'settings', id: 'periodStartDay' },
  { cas: 'un réglage qui décrit une instance (D58)', tables: { settings: [{ key: 'siteId', value: '"telephone"' }] }, table: 'settings', id: 'siteId' },
];

/** La ligne fautive d'une violation, telle qu'un paquet la porterait. */
function recue(v: Violation): RowState {
  const lignes = v.tables[v.table]!;
  const { id, key, hlc, ...reste } = lignes.find((l) => !v.id || l['id'] === v.id || l['key'] === v.id) ?? lignes[0]!;
  return { t: v.table, id: String(id ?? key), hlc: String(hlc ?? '1788000000000:0000:b'), v: Object.fromEntries(Object.entries(reste).map(([k, x]) => [k, x ?? null])) };
}

describe('[niveau 2] #198 · 2. est refusé, sans rien ouvrir, un fichier où… (3 le nomme, 4 rien n’avertit seulement, 6 la même ligne est refusée à la réception)', () => {
  it('le même fichier, sans aucune de ces violations, s’ouvre : le verdict n’a que deux issues (4)', async () => {
    expect(await verifierFichier(fabriquer({ operations: [OP], sub_operations: [part('s-1', VARIABLE)] }), { sqlJs: SQL })).toMatchObject({ ouvre: true });
  });

  for (const v of VIOLATIONS) {
    it(v.cas, async () => {
      const octets = fabriquer(v.tables);
      const e = await refus(octets);
      expect(e).toBeInstanceOf(FormatRefused);
      expect(e.reason).toBe('invalide');
      expect(e.problemes[0]).toMatchObject({ table: v.table, ...(v.id ? { id: v.id } : {}), ...(v.colonne ? { colonne: v.colonne } : {}) });
      expect((await verifierFichier(octets, { sqlJs: SQL })).ouvre).toBe(false);
      if (!v.lie) {
        const dest = await LedgerStore.create({ sqlJs: SQL, siteId: 'destinataire' });
        expect(() => dest.receive([recue(v)], { senderKnowledge: {} })).toThrow(FormatRefused);
      }
    });
  }
  it('un identifiant dans une colonne JSON qui désigne une ligne supprimée, mais présente dans le fichier, ne refuse pas', async () => {
    const octets = fabriquer({ categories: [{ id: 'c-retiree', name: 'Retirée', nature: 'expense', deleted_at: '2026-09-01T10:00:00.000Z' }], automations: [AUTO('{}', '{"categoryId":"c-retiree"}')] });
    expect((await verifierFichier(octets, { sqlJs: SQL })).ouvre).toBe(true);
  });
});

describe('[niveau 2] #198 · 3. le refus nomme le premier problème et dit combien d’autres il y a', () => {
  it('table, ligne et colonne du premier, puis le nombre des autres', async () => {
    const e = await refus(
      fabriquer({
        operations: [op({ amount: -3.5 }), op({ id: 'op-2', date: 'hier' })],
        sub_operations: [part('s-1', VARIABLE, { operation_id: 'op-absente' })],
      }),
    );
    expect(e.problemes).toHaveLength(3);
    expect(e.message).toContain('table operations, ligne « op-1 », colonne amount');
    expect(e.message).toContain('2 autres problèmes');
  });
});

describe('[niveau 2] #198 · 5. la même vérification se lance hors de l’interface, par une commande du dépôt', () => {
  const coeur = resolve(__dirname, '..');
  /** La commande du dépôt, telle que le `package.json` du cœur la définit : `pnpm --dir packages/core run verifier-fichier <fichier>`. */
  const script = (JSON.parse(readFileSync(join(coeur, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts['verifier-fichier']!;
  const sansSortie = pathToFileURL(resolve(coeur, '../gardes/sans-sortie.mjs')).href;
  const lancer = (octets: Uint8Array, env: Record<string, string> = {}) => {
    const chemin = join(mkdtempSync(join(tmpdir(), 'tirelire-198-')), 'fabrique.sqlite');
    writeFileSync(chemin, octets);
    return spawnSync(`${script} "${chemin}"`, { shell: true, cwd: coeur, encoding: 'utf8', env: { ...process.env, ...env } });
  };

  it('un fichier refusé : chaque problème nommé, pas seulement le premier, et la commande échoue', async () => {
    const octets = fabriquer({ operations: [op({ amount: -3.5 }), op({ id: 'op-2', date: 'hier' })] });
    const r = lancer(octets);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('table operations, ligne « op-1 », colonne amount');
    expect(r.stdout).toContain('table operations, ligne « op-2 », colonne date');
    expect((await refus(octets)).problemes).toHaveLength(2); // même verdict qu'à l'ouverture
  }, 30_000);

  it('un chemin relatif se lit depuis le dossier de l’appel, pas depuis celui du cœur où pnpm lance la commande', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'tirelire-198-'));
    writeFileSync(join(dossier, 'fabrique.sqlite'), fabriquer({ operations: [OP] }));
    const r = spawnSync('pnpm', ['--dir', coeur, 'run', '--silent', 'verifier-fichier', 'fabrique.sqlite'], { cwd: dossier, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('s’ouvre');
  }, 30_000);

  it('[niveau 0] un fichier qui s’ouvre : la commande réussit, dit ce qui se complète, et ne tente aucune connexion hors de la machine (I7)', () => {
    // Le préchargement de la garde de #113 fait sortir le processus en échec dès qu'il tente de sortir.
    const r = lancer(fabriquer({ operations: [OP] }), { NODE_OPTIONS: `--import=${sansSortie}` });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('s’ouvre');
    expect(r.stdout).toContain('1 ligne(s) sans horloge');
    expect(r.stderr).not.toContain('hors de la machine');
  }, 30_000);
});

describe('[niveau 2] #198 · 6. une ligne refusée à l’ouverture l’est aussi à l’écriture (à la réception : dans chaque cas du point 2)', () => {
  it('un montant non entier, une date mal formée, deux parts variables dans un placement, un réglage hors de sa forme : refusés, et rien n’est écrit', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 'ecrivain' });
    const ligne = { id: 'op-1', accountId: MAIN_ACCOUNT_ID, origin: 'manual', date: '2026-09-06', label: 'Pain', normalizedLabel: 'PAIN', amount: -350, state: 'untreated' };
    expect(() => s.upsert('operations', { ...ligne, amount: -3.5 } as never)).toThrow(RowRefused);
    expect(() => s.upsert('operations', { ...ligne, date: '6 sept.' } as never)).toThrow(RowRefused);
    const placement = [
      { accountId: MAIN_ACCOUNT_ID, share: { kind: 'variable' } },
      { accountId: MAIN_ACCOUNT_ID, share: { kind: 'variable' } },
    ];
    expect(() => s.upsert('tirelires', { id: 't-1', name: 'V', placement, openingBalance: 0, openingDate: '2026-09-01' } as never)).toThrow(RowRefused);
    expect(() => s.setSetting('periodStartDay', 32)).toThrow(RowRefused);
    expect(s.load().operations).toEqual([]);
    expect(s.load().tirelires).toEqual([]);
    expect(() => s.upsert('operations', ligne as never)).not.toThrow(); // la même ligne, bien formée, s'écrit
  });
});

describe('#198 · 7. un fichier fabriqué qui s’est ouvert devient un fichier de l’application', () => {
  it('[niveau 2] enregistré puis rouvert, il s’ouvre sans rien compléter', async () => {
    const s = await ouvrir(fabriquer(tablesDe(exampleLedger(), { reglages: true })));
    expect(s.completion.horloges.length).toBeGreaterThan(0);
    const r = await ouvrir(s.export(), 'autre');
    expect(r.completion).toEqual({ tables: [], colonnes: [], horloges: [], comptePrincipal: false });
    expect(r.load()).toEqual({ ...s.load(), settings: { ...s.load().settings, siteId: 'autre' } });
  });

  it('[niveau 1] toutes ses lignes atteignent une autre instance à la synchronisation (I8)', async () => {
    const a = await ouvrir(fabriquer(tablesDe(exampleLedger(), { reglages: true })), 'a');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'b' });
    importBundle(b, exportBundle(a));
    const { settings: _sa, ...la } = a.load();
    const { settings: _sb, ...lb } = b.load();
    expect(lb).toEqual(la);
    expect({ ...b.load().settings, siteId: 'a' }).toEqual(a.load().settings);
  });

  it('[niveau 1] un compte principal resté à son défaut cède toujours devant un compte principal renseigné, dans les deux sens (D40, I8)', async () => {
    const renseigne = { id: MAIN_ACCOUNT_ID, name: 'Compte joint', kind: 'principal', openingBalance: 123_45, openingDate: '2026-01-01' } as const;
    const parDefaut: Ligne = { id: MAIN_ACCOUNT_ID, name: 'Compte principal', kind: 'principal', opening_balance: 0, opening_date: '1970-01-01' };
    const ancien = () => LedgerStore.create({ sqlJs: SQL, siteId: 'ailleurs', now: () => 1_700_000_000_000 }); // le compte renseigné est plus vieux que l'ouverture du fichier : seule l'absence d'horloge le fait gagner
    const nomDuPrincipal = (s: LedgerStore) => s.load().accounts.find((x) => x.id === MAIN_ACCOUNT_ID)?.name;
    for (const [cas, fichier] of [
      ['compte principal absent du fichier', () => fabriquer()],
      ['compte principal écrit à son défaut dans le fichier, sans horloge', () => fabriquer({ accounts: [parDefaut] })],
    ] as const) {
      const b = await ancien();
      b.upsert('accounts', renseigne);
      const a = await ouvrir(fichier(), 'a');
      importBundle(a, exportBundle(b));
      expect(nomDuPrincipal(a), `${cas} : le défaut reçoit le renseigné`).toBe('Compte joint');

      const d = await ancien();
      d.upsert('accounts', renseigne);
      const c = await ouvrir(fichier(), 'c');
      importBundle(d, exportBundle(c));
      expect(nomDuPrincipal(d), `${cas} : le défaut envoyé ne remplace pas le renseigné`).toBe('Compte joint');
    }
  });

  it('[niveau 2] un compte principal écrit dans le fichier exactement à son défaut, sans horloge, reste un défaut', async () => {
    const s = await ouvrir(fabriquer({ accounts: [{ id: MAIN_ACCOUNT_ID, name: 'Compte principal', kind: 'principal', opening_balance: 0, opening_date: '1970-01-01' }] }));
    expect(s.completion.horloges).toEqual([]);
    expect(s.rowsNewerThan({})).toEqual([]);
  });
});

describe('[niveau 2] #198 · 8. les lignes de l’exemple, fabriquées dehors, donnent le plan de l’exemple (selon le texte proposé au porteur)', () => {
  const asOf = '2026-09-06';

  it('avec ses réglages, sans aucune horloge : le plan de l’exemple, au centime', async () => {
    const s = await ouvrir(fabriquer(tablesDe(exampleLedger(), { reglages: true })));
    expect(computePlan(s.load(), asOf)).toEqual(computePlan(exampleLedger(), asOf));
  });

  it('sans réglages ni compte principal, sans aucune horloge : il s’ouvre, avec les réglages par défaut et le compte principal né à son défaut', async () => {
    const s = await ouvrir(fabriquer(tablesDe(exampleLedger(), { sansPrincipal: true })));
    expect(s.completion.comptePrincipal).toBe(true);
    expect(s.load().settings.periodStartDay).toBe(DEFAULT_SETTINGS.periodStartDay);
    const attendu = exampleLedger();
    attendu.settings = { ...DEFAULT_SETTINGS };
    attendu.accounts = attendu.accounts.map((a) => (a.id === MAIN_ACCOUNT_ID ? { id: MAIN_ACCOUNT_ID, name: 'Compte principal', kind: 'principal', openingBalance: 0, openingDate: '1970-01-01' } : a));
    expect(computePlan(s.load(), asOf)).toEqual(computePlan(attendu, asOf));
  });
});

describe('[niveau 2] #198 · 9. le fichier que l’application tient déjà ne passe que par le contrôle du format', () => {
  it('sans l’option de vérification, une référence vers une ligne absente n’empêche pas l’ouverture ; avec elle, elle refuse', async () => {
    const octets = fabriquer({ sub_operations: [part('s-1', VARIABLE, { operation_id: 'op-absente', hlc: '1788000000000:0000:a' })] });
    const s = await LedgerStore.create({ sqlJs: SQL, bytes: octets, siteId: 'a' });
    expect(s.load().subOperations.map((x) => x.id)).toEqual(['s-1']);
    await expect(ouvrir(octets)).rejects.toBeInstanceOf(FichierRefuse);
  });
});

describe('[niveau 2] #198 · 10. toute colonne qui désigne une ligne d’une autre table est vérifiée', () => {
  const tables = Object.values(TABLES);
  const references = tables.flatMap((t) => t.columns.filter((c) => c.ref).map((c) => ({ t, c })));

  it('toute colonne en `_id` déclare la table qu’elle désigne, et cette table existe : le format ne gagne pas une référence sans qu’elle se vérifie', () => {
    expect(tables.flatMap((t) => t.columns.filter((c) => c.col.endsWith('_id') && !c.ref).map((c) => `${t.name}.${c.col}`))).toEqual([]);
    for (const { c } of references) expect(tables.map((t) => t.name)).toContain(c.ref);
  });

  it('l’exemple, complété de toutes les tables, s’ouvre ; chacune de ses références vers une ligne absente refuse le fichier, en nommant table, ligne et colonne', async () => {
    const complet = () => tablesDe(exempleCompletDeToutesLesTables(), { reglages: true });
    expect((await ouvrir(fabriquer(complet()))).completion.comptePrincipal).toBe(false);
    const manques: string[] = [];
    for (const { t, c } of references) {
      const tablesEx = complet();
      const lignes = tablesEx[t.name];
      if (!lignes?.length) {
        manques.push(`${t.name}.${c.col} : l’exemple n’a aucune ligne dans ${t.name}`);
        continue;
      }
      lignes[0] = { ...lignes[0]!, [c.col]: 'absent-198' };
      const octets = fabriquer(tablesEx);
      const verdict = await verifierFichier(octets, { sqlJs: SQL });
      const nomme = !verdict.ouvre && verdict.problemes.some((p) => p.table === t.name && p.id === String(lignes[0]!['id']) && p.colonne === c.col);
      if (!nomme) manques.push(`${t.name}.${c.col}`);
    }
    expect(manques).toEqual([]);
  });

  const feuilles = tables.flatMap((t) => t.columns.filter((c) => c.shape).flatMap((c) => feuillesDe(`${t.name}.${c.col}`, c.shape!)));

  it('chaque valeur d’une forme JSON nommée en « Id », et chaque valeur de la table des comptes d’un profil, déclare la table qu’elle désigne', () => {
    const identifiants = feuilles.filter((f) => /Id$/.test(f.chemin) || f.chemin.endsWith('{}'));
    expect(identifiants.filter((f) => !f.feuille.ref).map((f) => f.chemin)).toEqual([]);
    for (const f of identifiants) expect(tables.map((t) => t.name)).toContain(f.feuille.ref);
  });

  it('chaque identifiant déclaré d’une forme JSON est un de ceux que le point 2 casse un à un : un identifiant ajouté à une forme rougit ce test ou le précédent', () => {
    expect(new Set(feuilles.filter((f) => f.feuille.ref).map((f) => f.chemin))).toEqual(new Set(VIOLATIONS.flatMap((v) => (v.chemin ? [v.chemin] : []))));
  });
});

describe('[niveau 0] #198 · C5. une sauvegarde de l’application se rouvre sous la vérification entière', () => {
  it('toutes les tables, des identifiants dans les colonnes JSON, des lignes supprimées dont certaines qu’ils désignent, des sous-opérations sur trois niveaux, un appareil, des réglages : rien n’est refusé, rien n’est complété, tout revient', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 'a' });
    const l = exempleCompletDeToutesLesTables();
    for (const cle of Object.keys(TABLES) as LedgerKey[]) for (const r of l[cle] as unknown as Array<Record<string, unknown>>) s.upsert(cle, r as never);
    s.upsert('operations', { id: 'op-198', accountId: MAIN_ACCOUNT_ID, origin: 'manual', date: '2026-09-06', label: 'Courses', normalizedLabel: 'COURSES', amount: -5000, state: 'untreated' } as never);
    s.upsert('subOperations', { id: 's-racine', operationId: 'op-198', share: { kind: 'fixed', amount: -3000 } } as never);
    s.upsert('subOperations', { id: 's-reste', operationId: 'op-198', share: { kind: 'variable' } } as never);
    s.upsert('subOperations', { id: 's-fils', operationId: 'op-198', parentId: 's-racine', share: { kind: 'percent', pct: 50 } } as never);
    s.upsert('subOperations', { id: 's-petit-fils', operationId: 'op-198', parentId: 's-fils', share: { kind: 'variable' } } as never);
    s.upsert('devices', { id: 'telephone', name: 'Téléphone', user: 'Marie', lastSeen: '2026-09-06T08:00:00.000Z' } as never);
    s.setSetting('periodStartDay', 5);
    s.remove('operations', l.operations[0]!.id);
    s.remove('categories', 'cat-loyer'); // les identifiants de l'automatisme, de ses allocations et du profil désignent encore des lignes : supprimées, mais présentes
    s.remove('tirelires', 'env-vac');
    s.remove('subOperations', 's-petit-fils');
    s.remove('devices', 'telephone');
    const r = await LedgerStore.create({ sqlJs: SQL, bytes: s.export(), verifier: true, siteId: 'b' });
    expect(r.completion).toEqual({ tables: [], colonnes: [], horloges: [], comptePrincipal: false });
    expect(r.load()).toEqual({ ...s.load(), settings: { ...s.load().settings, siteId: 'b' } });
  });
});
