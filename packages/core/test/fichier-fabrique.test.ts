/**
 * Tests du codeur de #198 — « Un fichier fabriqué dehors s'ouvre, ou dit clairement pourquoi il ne
 * s'ouvre pas (D58) ». Tous de niveau 4 (D83) : l'auditeur choisit parmi eux ceux du harnais.
 *
 * Chaque `describe` reprend un point du « Fait quand », sous son numéro. Les fichiers sont fabriqués
 * comme le ferait un script : des `CREATE TABLE` et des `INSERT` écrits à la main, sans horloge, sans
 * `CHECK`, avec seulement les colonnes voulues — jamais par le dépôt de l'application.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  computePlan,
  DEFAULT_SETTINGS,
  exampleLedger,
  exportBundle,
  FichierRefuse,
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

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

type Valeur = string | number | null;
/** Une table fabriquée : ses colonnes, et ses lignes dans l'ordre des colonnes. */
type Table = { colonnes: string[]; lignes: Valeur[][] };

/** Un fichier fabriqué hors de l'application : le marqueur et la version du format, puis les tables données. */
function fabriquer(tables: Record<string, Table> = {}, meta: Record<string, string> = { format: FILE_FORMAT, format_version: String(FORMAT_VERSION) }): Uint8Array {
  const db = new SQL.Database();
  db.run('CREATE TABLE meta (key TEXT, value TEXT)');
  for (const [k, v] of Object.entries(meta)) db.run('INSERT INTO meta VALUES (?, ?)', [k, v]);
  for (const [nom, t] of Object.entries(tables)) {
    db.run(`CREATE TABLE ${nom} (${t.colonnes.join(', ')})`);
    for (const l of t.lignes) db.run(`INSERT INTO ${nom} VALUES (${l.map(() => '?').join(', ')})`, l);
  }
  const octets = db.export();
  db.close();
  return octets;
}

/** Une valeur du modèle, telle qu'un script l'écrirait dans sa colonne. */
function enSql(type: string, v: unknown): Valeur {
  if (v === undefined || v === null) return null;
  if (type === 'json') return JSON.stringify(v);
  if (type === 'boolean') return v ? 1 : 0;
  return v as Valeur;
}

/** Les lignes d'un grand livre, table par table, toutes les colonnes du format, sans horloge. */
function tablesDe(l: Ledger, o: { sansPrincipal?: boolean; reglages?: boolean } = {}): Record<string, Table> {
  const tables: Record<string, Table> = {};
  for (const [cle, t] of Object.entries(TABLES)) {
    const lignes = (l[cle as LedgerKey] as unknown as Array<Record<string, unknown>>).filter((r) => !(o.sansPrincipal && r['id'] === MAIN_ACCOUNT_ID));
    tables[t.name] = { colonnes: t.columns.map((c) => c.col), lignes: lignes.map((r) => t.columns.map((c) => enSql(c.type, r[c.prop]))) };
  }
  if (o.reglages) {
    const lignes = Object.entries(l.settings)
      .filter(([k]) => k !== 'siteId')
      .map(([k, v]) => [k, JSON.stringify(v)]);
    tables['settings'] = { colonnes: ['key', 'value'], lignes };
  }
  return tables;
}

/** Une opération minimale, par ses colonnes obligatoires. */
const OPERATION = { colonnes: ['id', 'account_id', 'origin', 'date', 'label', 'amount', 'state'], ligne: ['op-1', MAIN_ACCOUNT_ID, 'manual', '2026-09-06', 'Boulangerie', -350, 'untreated'] as Valeur[] };

function operations(...lignes: Valeur[][]): Table {
  return { colonnes: OPERATION.colonnes, lignes };
}

async function ouvrir(octets: Uint8Array, siteId = 'ouvreur'): Promise<LedgerStore> {
  return LedgerStore.create({ sqlJs: SQL, bytes: octets, verifier: true, siteId });
}

async function refus(octets: Uint8Array): Promise<FichierRefuse> {
  try {
    (await ouvrir(octets)).close();
  } catch (err) {
    if (err instanceof FichierRefuse) return err;
    throw err;
  }
  throw new Error('Le fichier s’est ouvert : un refus était attendu.');
}

describe('[niveau 4] #198 · 1. un fichier fabriqué au format s’ouvre, et ce qui lui manque se complète', () => {
  it('un fichier qui ne porte que le marqueur et la version s’ouvre : tables vides, réglages par défaut, compte principal né à son défaut', async () => {
    const s = await ouvrir(fabriquer());
    const l = s.load();
    expect(l.accounts.map((a) => a.id)).toEqual([MAIN_ACCOUNT_ID]);
    expect(l.operations).toEqual([]);
    const { siteId: _s, ...reglages } = l.settings;
    const { siteId: _d, ...defauts } = DEFAULT_SETTINGS;
    expect(reglages).toEqual(defauts);
    expect(s.completion.comptePrincipal).toBe(true);
    expect(s.completion.tables).toEqual([...Object.values(TABLES).map((t) => t.name), 'settings']);
    // Le compte principal né à son défaut ne voyage pas (D40).
    expect(s.rowsNewerThan({})).toEqual([]);
  });

  it('une colonne facultative absente vaut vide ; une ligne sans horloge reçoit une horloge de l’instance qui ouvre', async () => {
    const s = await ouvrir(fabriquer({ operations: operations(OPERATION.ligne) }));
    const op = s.load().operations[0]!;
    expect(op).toMatchObject({ id: 'op-1', amount: -350, date: '2026-09-06' });
    expect(op.details).toBeUndefined();
    expect(s.completion.colonnes).toContain('operations.details');
    const [h] = s.query(`SELECT hlc FROM operations WHERE id = 'op-1'`).map((r) => String(r['hlc']));
    expect(siteOf(h!)).toBe('ouvreur');
  });

  it('un réglage présent sans horloge est gardé et daté ; les autres prennent leur défaut', async () => {
    const s = await ouvrir(fabriquer({ settings: { colonnes: ['key', 'value'], lignes: [['periodStartDay', '28']] } }));
    expect(s.load().settings.periodStartDay).toBe(28);
    expect(s.load().settings.orderRounding).toBe(DEFAULT_SETTINGS.orderRounding);
    expect(s.completion.horloges).toEqual([{ table: 'settings', id: 'periodStartDay' }]);
  });
});

/** Chaque violation du point 2 : un fichier, et ce que le refus doit nommer. */
const VIOLATIONS: Array<{ cas: string; fichier: () => Uint8Array; table: string; id?: string; colonne?: string }> = [
  { cas: 'une table qui n’est pas du format', fichier: () => fabriquer({ budgets: { colonnes: ['id'], lignes: [['b']] } }), table: 'budgets' },
  {
    cas: 'une colonne qui n’est pas du format',
    fichier: () => fabriquer({ operations: { colonnes: [...OPERATION.colonnes, 'montant_euros'], lignes: [[...OPERATION.ligne, 3.5]] } }),
    table: 'operations',
    colonne: 'montant_euros',
  },
  {
    cas: 'une colonne obligatoire vide',
    fichier: () => fabriquer({ operations: operations(['op-1', MAIN_ACCOUNT_ID, 'manual', '2026-09-06', null, -350, 'untreated']) }),
    table: 'operations',
    id: 'op-1',
    colonne: 'label',
  },
  {
    cas: 'une colonne obligatoire absente d’une table qui a des lignes',
    fichier: () => fabriquer({ operations: { colonnes: OPERATION.colonnes.filter((c) => c !== 'state'), lignes: [OPERATION.ligne.filter((_, i) => i !== 6)] } }),
    table: 'operations',
    id: 'op-1',
    colonne: 'state',
  },
  {
    cas: 'une valeur hors de son énumération',
    fichier: () => fabriquer({ operations: operations(['op-1', MAIN_ACCOUNT_ID, 'manual', '2026-09-06', 'Pain', -350, 'pointee']) }),
    table: 'operations',
    id: 'op-1',
    colonne: 'state',
  },
  {
    cas: 'un booléen hors de 0 et 1',
    fichier: () => fabriquer({ operations: { colonnes: [...OPERATION.colonnes, 'one_off'], lignes: [[...OPERATION.ligne, 2]] } }),
    table: 'operations',
    id: 'op-1',
    colonne: 'one_off',
  },
  {
    cas: 'un montant qui n’est pas un entier de centimes',
    fichier: () => fabriquer({ operations: operations(['op-1', MAIN_ACCOUNT_ID, 'manual', '2026-09-06', 'Pain', -3.5, 'untreated']) }),
    table: 'operations',
    id: 'op-1',
    colonne: 'amount',
  },
  {
    cas: 'un montant écrit en texte',
    fichier: () => fabriquer({ operations: operations(['op-1', MAIN_ACCOUNT_ID, 'manual', '2026-09-06', 'Pain', '-3,50', 'untreated']) }),
    table: 'operations',
    id: 'op-1',
    colonne: 'amount',
  },
  {
    cas: 'une date mal formée',
    fichier: () => fabriquer({ operations: operations(['op-1', MAIN_ACCOUNT_ID, 'manual', '06/09/2026', 'Pain', -350, 'untreated']) }),
    table: 'operations',
    id: 'op-1',
    colonne: 'date',
  },
  {
    cas: 'une date qui n’existe pas',
    fichier: () => fabriquer({ operations: operations(['op-1', MAIN_ACCOUNT_ID, 'manual', '2026-02-30', 'Pain', -350, 'untreated']) }),
    table: 'operations',
    id: 'op-1',
    colonne: 'date',
  },
  {
    cas: 'un horodatage qui n’a pas la forme qu’écrit l’application',
    fichier: () => fabriquer({ operations: { colonnes: [...OPERATION.colonnes, 'deleted_at'], lignes: [[...OPERATION.ligne, '2026-09-06 10:00']] } }),
    table: 'operations',
    id: 'op-1',
    colonne: 'deleted_at',
  },
  {
    cas: 'une colonne JSON qui ne se lit pas',
    fichier: () => fabriquer({ operations: operations(OPERATION.ligne), sub_operations: { colonnes: ['id', 'operation_id', 'share'], lignes: [['s-1', 'op-1', '{fixed']] } }),
    table: 'sub_operations',
    id: 's-1',
    colonne: 'share',
  },
  {
    cas: 'une part ni fixe, ni en pourcentage, ni variable',
    fichier: () => fabriquer({ operations: operations(OPERATION.ligne), sub_operations: { colonnes: ['id', 'operation_id', 'share'], lignes: [['s-1', 'op-1', '{"kind":"moitie"}']] } }),
    table: 'sub_operations',
    id: 's-1',
    colonne: 'share',
  },
  {
    cas: 'deux parts variables dans une ventilation (D27)',
    fichier: () =>
      fabriquer({
        operations: operations(OPERATION.ligne),
        sub_operations: { colonnes: ['id', 'operation_id', 'share'], lignes: [['s-1', 'op-1', '{"kind":"variable"}'], ['s-2', 'op-1', '{"kind":"variable"}']] },
      }),
    table: 'sub_operations',
    id: 's-2',
    colonne: 'share',
  },
  {
    cas: 'deux parts variables dans un placement (D38)',
    fichier: () =>
      fabriquer({
        tirelires: {
          colonnes: ['id', 'name', 'placement', 'opening_balance', 'opening_date'],
          lignes: [['t-1', 'Vacances', JSON.stringify([{ accountId: MAIN_ACCOUNT_ID, share: { kind: 'variable' } }, { accountId: MAIN_ACCOUNT_ID, share: { kind: 'variable' } }]), 0, '2026-09-01']],
        },
      }),
    table: 'tirelires',
    id: 't-1',
    colonne: 'placement',
  },
  {
    cas: 'un identifiant qui se répète dans une table',
    fichier: () => fabriquer({ operations: operations(OPERATION.ligne, OPERATION.ligne) }),
    table: 'operations',
    id: 'op-1',
    colonne: 'id',
  },
  {
    cas: 'une ventilation sans son opération',
    fichier: () => fabriquer({ sub_operations: { colonnes: ['id', 'operation_id', 'share'], lignes: [['s-1', 'op-absente', '{"kind":"variable"}']] } }),
    table: 'sub_operations',
    id: 's-1',
    colonne: 'operation_id',
  },
  {
    cas: 'une horloge présente qui ne se lit pas',
    fichier: () => fabriquer({ operations: { colonnes: [...OPERATION.colonnes, 'hlc'], lignes: [[...OPERATION.ligne, 'hier']] } }),
    table: 'operations',
    id: 'op-1',
    colonne: 'hlc',
  },
  {
    cas: 'un second compte principal (D40)',
    fichier: () => fabriquer({ accounts: { colonnes: ['id', 'name', 'kind', 'opening_balance', 'opening_date'], lignes: [['acc-2', 'Autre', 'principal', 0, '2026-09-01']] } }),
    table: 'accounts',
    id: 'acc-2',
    colonne: 'kind',
  },
  {
    cas: 'un réglage qui n’est pas du format',
    fichier: () => fabriquer({ settings: { colonnes: ['key', 'value'], lignes: [['devise', '"EUR"']] } }),
    table: 'settings',
    id: 'devise',
  },
  {
    cas: 'un réglage d’une valeur hors de sa forme',
    fichier: () => fabriquer({ settings: { colonnes: ['key', 'value'], lignes: [['periodStartDay', '32']] } }),
    table: 'settings',
    id: 'periodStartDay',
  },
  {
    cas: 'un réglage qui décrit une instance (D58)',
    fichier: () => fabriquer({ settings: { colonnes: ['key', 'value'], lignes: [['siteId', '"telephone"']] } }),
    table: 'settings',
    id: 'siteId',
  },
];

describe('[niveau 4] #198 · 2. est refusé, sans rien ouvrir, écrire ni effacer, un fichier où…', () => {
  for (const v of VIOLATIONS) {
    it(v.cas, async () => {
      const octets = v.fichier();
      const copie = octets.slice();
      const e = await refus(octets);
      expect(e).toBeInstanceOf(FormatRefused);
      expect(e.reason).toBe('invalide');
      expect(e.problemes[0]).toMatchObject({ table: v.table, ...(v.id ? { id: v.id } : {}), ...(v.colonne ? { colonne: v.colonne } : {}) });
      // Rien n'a été écrit dans le fichier refusé.
      expect(octets).toEqual(copie);
    });
  }
});

describe('[niveau 4] #198 · 3. le refus nomme le premier problème et dit combien d’autres il y a', () => {
  it('table, ligne et colonne du premier, puis le nombre des autres', async () => {
    const e = await refus(
      fabriquer({
        operations: operations(['op-1', MAIN_ACCOUNT_ID, 'manual', '2026-09-06', 'Pain', -3.5, 'untreated'], ['op-2', MAIN_ACCOUNT_ID, 'manual', 'hier', 'Lait', -120, 'untreated']),
        sub_operations: { colonnes: ['id', 'operation_id', 'share'], lignes: [['s-1', 'op-absente', '{"kind":"variable"}']] },
      }),
    );
    expect(e.problemes).toHaveLength(3);
    expect(e.message).toContain('table operations, ligne « op-1 », colonne amount');
    expect(e.message).toContain('2 autres problèmes');
  });

  it('une base qui n’est pas un fichier Tirelire reste refusée en le disant, comme avant', async () => {
    const db = new SQL.Database();
    db.run('CREATE TABLE notes (texte TEXT)');
    const octets = db.export();
    db.close();
    await expect(ouvrir(octets)).rejects.toMatchObject({ reason: 'etranger' });
    await expect(ouvrir(new TextEncoder().encode('date;libellé;montant'))).rejects.toMatchObject({ reason: 'illisible' });
  });
});

describe('[niveau 4] #198 · 4. rien n’avertit seulement : le fichier s’ouvre, ou il est refusé', () => {
  it('le verdict n’a que deux issues, et un problème refuse toujours', async () => {
    const bon = await verifierFichier(fabriquer({ operations: operations(OPERATION.ligne) }), { sqlJs: SQL });
    expect(bon).toMatchObject({ ouvre: true });
    for (const v of VIOLATIONS) expect((await verifierFichier(v.fichier(), { sqlJs: SQL })).ouvre, v.cas).toBe(false);
  });
});

describe('[niveau 4] #198 · 5. la même vérification se lance hors de l’interface, par une commande du dépôt', () => {
  const coeur = resolve(__dirname, '..');
  const lancer = (fichier: string) =>
    spawnSync('node', ['--experimental-transform-types', '--no-warnings', '--import', './bin/resolution-ts.mjs', 'bin/verifier-fichier.ts', fichier], { cwd: coeur, encoding: 'utf8' });

  it('un fichier refusé : chaque problème nommé, pas seulement le premier, et la commande échoue', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'tirelire-198-'));
    const chemin = join(dossier, 'fabrique.sqlite');
    const octets = fabriquer({
      operations: operations(['op-1', MAIN_ACCOUNT_ID, 'manual', '2026-09-06', 'Pain', -3.5, 'untreated'], ['op-2', MAIN_ACCOUNT_ID, 'manual', 'hier', 'Lait', -120, 'untreated']),
    });
    writeFileSync(chemin, octets);
    const r = lancer(chemin);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('table operations, ligne « op-1 », colonne amount');
    expect(r.stdout).toContain('table operations, ligne « op-2 », colonne date');
    // Même verdict qu'à l'ouverture.
    const e = await refus(octets);
    expect(e.problemes).toHaveLength(2);
  }, 30_000);

  it('un fichier qui s’ouvre : la commande réussit et dit ce qui se complète', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'tirelire-198-'));
    const chemin = join(dossier, 'fabrique.sqlite');
    writeFileSync(chemin, fabriquer({ operations: operations(OPERATION.ligne) }));
    const r = lancer(chemin);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('s’ouvre');
    expect(r.stdout).toContain('1 ligne(s) sans horloge');
  }, 30_000);
});

describe('[niveau 4] #198 · 6. une ligne refusée à l’ouverture l’est à l’écriture et à la réception', () => {
  const CAS: Array<{ cas: string; cle: LedgerKey; ligne: Record<string, unknown>; v: Record<string, Valeur> }> = [
    {
      cas: 'un montant non entier',
      cle: 'operations',
      ligne: { id: 'op-1', accountId: MAIN_ACCOUNT_ID, origin: 'manual', date: '2026-09-06', label: 'Pain', normalizedLabel: 'PAIN', amount: -3.5, state: 'untreated' },
      v: { account_id: MAIN_ACCOUNT_ID, origin: 'manual', date: '2026-09-06', label: 'Pain', amount: -3.5, state: 'untreated' },
    },
    {
      cas: 'une date mal formée',
      cle: 'operations',
      ligne: { id: 'op-1', accountId: MAIN_ACCOUNT_ID, origin: 'manual', date: '6 sept.', label: 'Pain', normalizedLabel: 'PAIN', amount: -350, state: 'untreated' },
      v: { account_id: MAIN_ACCOUNT_ID, origin: 'manual', date: '6 sept.', label: 'Pain', amount: -350, state: 'untreated' },
    },
    {
      cas: 'deux parts variables dans un placement',
      cle: 'tirelires',
      ligne: { id: 't-1', name: 'V', placement: [{ accountId: MAIN_ACCOUNT_ID, share: { kind: 'variable' } }, { accountId: MAIN_ACCOUNT_ID, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-09-01' },
      v: { name: 'V', placement: JSON.stringify([{ accountId: MAIN_ACCOUNT_ID, share: { kind: 'variable' } }, { accountId: MAIN_ACCOUNT_ID, share: { kind: 'variable' } }]), opening_balance: 0, opening_date: '2026-09-01' },
    },
  ];
  for (const c of CAS) {
    it(c.cas, async () => {
      const s = await LedgerStore.create({ sqlJs: SQL, siteId: 'a' });
      expect(() => s.upsert(c.cle, c.ligne as never)).toThrow(RowRefused);
      const t = TABLES[c.cle]!;
      const row: RowState = { t: t.name, id: String(c.ligne['id']), hlc: '1788000000000:0000:b', v: c.v };
      expect(() => s.receive([row], { senderKnowledge: {} })).toThrow(FormatRefused);
      const fichier = fabriquer({ [t.name]: { colonnes: ['id', ...Object.keys(c.v)], lignes: [[row.id, ...Object.values(c.v)]] } });
      await expect(ouvrir(fichier)).rejects.toBeInstanceOf(FichierRefuse);
    });
  }

  it('un réglage qui décrit une instance, ou hors de sa forme, est refusé à la réception comme à l’ouverture ; hors de sa forme, à l’écriture', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 'a' });
    expect(() => s.setSetting('periodStartDay', 32)).toThrow(RowRefused);
    for (const [key, value] of [['siteId', '"b"'], ['periodStartDay', '0']]) {
      expect(() => s.receive([{ t: 'settings', id: key!, hlc: '1788000000000:0000:b', v: { value: value! } }], { senderKnowledge: {} })).toThrow(FormatRefused);
      await expect(ouvrir(fabriquer({ settings: { colonnes: ['key', 'value'], lignes: [[key!, value!]] } }))).rejects.toBeInstanceOf(FichierRefuse);
    }
  });
});

describe('[niveau 4] #198 · 7. un fichier fabriqué qui s’est ouvert devient un fichier de l’application', () => {
  it('enregistré puis rouvert, il s’ouvre sans rien compléter', async () => {
    const s = await ouvrir(fabriquer(tablesDe(exampleLedger(), { reglages: true })));
    expect(s.completion.horloges.length).toBeGreaterThan(0);
    const r = await ouvrir(s.export(), 'autre');
    expect(r.completion).toEqual({ tables: [], colonnes: [], horloges: [], comptePrincipal: false });
    expect(r.load()).toEqual({ ...s.load(), settings: { ...s.load().settings, siteId: 'autre' } });
  });

  it('toutes ses lignes atteignent une autre instance à la synchronisation', async () => {
    const a = await ouvrir(fabriquer(tablesDe(exampleLedger(), { reglages: true })), 'a');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'b' });
    importBundle(b, exportBundle(a));
    const { settings: _sa, ...la } = a.load();
    const { settings: _sb, ...lb } = b.load();
    expect(lb).toEqual(la);
    expect({ ...b.load().settings, siteId: 'a' }).toEqual(a.load().settings);
  });

  it('un compte principal resté à son défaut cède devant un compte principal renseigné, dans les deux sens', async () => {
    const sansPrincipal = tablesDe(exampleLedger(), { sansPrincipal: true });
    const a = await ouvrir(fabriquer(sansPrincipal), 'a');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'b' });
    b.upsert('accounts', { id: MAIN_ACCOUNT_ID, name: 'Compte joint', kind: 'principal', openingBalance: 123_45, openingDate: '2026-01-01' });
    importBundle(a, exportBundle(b));
    expect(a.load().accounts.find((x) => x.id === MAIN_ACCOUNT_ID)).toMatchObject({ name: 'Compte joint', openingBalance: 123_45 });

    const c = await ouvrir(fabriquer(sansPrincipal), 'c');
    const d = await LedgerStore.create({ sqlJs: SQL, siteId: 'd' });
    d.upsert('accounts', { id: MAIN_ACCOUNT_ID, name: 'Compte joint', kind: 'principal', openingBalance: 123_45, openingDate: '2026-01-01' });
    importBundle(d, exportBundle(c));
    expect(d.load().accounts.find((x) => x.id === MAIN_ACCOUNT_ID)).toMatchObject({ name: 'Compte joint', openingBalance: 123_45 });
  });

  it('un compte principal écrit dans le fichier exactement à son défaut, sans horloge, reste un défaut', async () => {
    const s = await ouvrir(
      fabriquer({ accounts: { colonnes: ['id', 'name', 'kind', 'opening_balance', 'opening_date'], lignes: [[MAIN_ACCOUNT_ID, 'Compte principal', 'principal', 0, '1970-01-01']] } }),
    );
    expect(s.completion.horloges).toEqual([]);
    expect(s.rowsNewerThan({})).toEqual([]);
  });
});

describe('[niveau 4] #198 · 8. les lignes de l’exemple, fabriquées dehors, donnent le plan de l’exemple', () => {
  const asOf = '2026-09-06';

  it('avec ses réglages, sans aucune horloge : le plan de l’exemple, au centime', async () => {
    const s = await ouvrir(fabriquer(tablesDe(exampleLedger(), { reglages: true })));
    expect(computePlan(s.load(), asOf)).toEqual(computePlan(exampleLedger(), asOf));
  });

  it('sans réglages ni compte principal, sans aucune horloge : il s’ouvre, avec les réglages par défaut et le compte principal né à son défaut', async () => {
    const s = await ouvrir(fabriquer(tablesDe(exampleLedger(), { sansPrincipal: true })));
    const l = s.load();
    expect(s.completion.comptePrincipal).toBe(true);
    expect(l.settings.periodStartDay).toBe(DEFAULT_SETTINGS.periodStartDay);
    // Le même plan que l'exemple réduit aux mêmes défauts.
    const attendu = exampleLedger();
    attendu.settings = { ...DEFAULT_SETTINGS };
    attendu.accounts = attendu.accounts.map((a) => (a.id === MAIN_ACCOUNT_ID ? { id: MAIN_ACCOUNT_ID, name: 'Compte principal', kind: 'principal', openingBalance: 0, openingDate: '1970-01-01' } : a));
    expect(computePlan(l, asOf)).toEqual(computePlan(attendu, asOf));
  });
});

describe('[niveau 4] #198 · 9. le fichier que l’application tient déjà ne passe que par le contrôle du format', () => {
  it('sans l’option de vérification, une référence vers une ligne absente n’empêche pas l’ouverture', async () => {
    const octets = fabriquer({ sub_operations: { colonnes: ['id', 'operation_id', 'share', 'hlc'], lignes: [['s-1', 'op-absente', '{"kind":"variable"}', '1788000000000:0000:a']] } });
    const s = await LedgerStore.create({ sqlJs: SQL, bytes: octets, siteId: 'a' });
    expect(s.load().subOperations.map((x) => x.id)).toEqual(['s-1']);
    await expect(ouvrir(octets)).rejects.toBeInstanceOf(FichierRefuse);
  });
});

/** L'exemple, plus un automatisme rattaché à un flux et un profil d'import rattaché à un compte, qu'il n'a pas. */
function exempleAvecToutesLesTables(): Ledger {
  const l = exampleLedger();
  l.automations.push({ id: 'auto-198', selection: { labelPattern: 'SALAIRE' }, action: { state: 'none' }, rank: 'a', flowId: l.plannedFlows[0]!.id });
  l.importProfiles.push({
    id: 'profil-198',
    name: 'Banque',
    source: 'bank',
    encoding: 'auto',
    delimiter: 'auto',
    headerRow: 0,
    columns: { date: 'Date', label: 'Libellé', amount: 'Montant' },
    dateFormat: 'DMY',
    accountMap: {},
    accountId: MAIN_ACCOUNT_ID,
  });
  return l;
}

describe('[niveau 4] #198 · 10. toute colonne qui désigne une ligne d’une autre table est vérifiée', () => {
  it('l’exemple complété de toutes ses tables s’ouvre, fabriqué dehors', async () => {
    expect((await ouvrir(fabriquer(tablesDe(exempleAvecToutesLesTables(), { reglages: true })))).completion.comptePrincipal).toBe(false);
  });

  const tables = Object.values(TABLES);
  const references = tables.flatMap((t) => t.columns.filter((c) => c.ref).map((c) => ({ t, c })));

  it('une colonne en `_id` porte la table qu’elle désigne', () => {
    const sansRef = tables.flatMap((t) => t.columns.filter((c) => c.col.endsWith('_id') && !c.ref).map((c) => `${t.name}.${c.col}`));
    expect(sansRef).toEqual([]);
    for (const { c } of references) expect(tables.map((t) => t.name)).toContain(c.ref);
  });

  for (const { t, c } of references) {
    it(`${t.name}.${c.col} vers une ligne absente refuse le fichier`, async () => {
      // La ligne de l'exemple qui porte cette colonne, ou une ligne de l'exemple à qui on la donne.
      const tablesEx = tablesDe(exempleAvecToutesLesTables(), { reglages: true });
      const table = tablesEx[t.name]!;
      const i = table.colonnes.indexOf(c.col);
      expect(table.lignes.length, `l’exemple n’a aucune ligne dans ${t.name}`).toBeGreaterThan(0);
      const ligne = [...table.lignes[0]!];
      ligne[i] = 'absent-198';
      table.lignes = [ligne, ...table.lignes.slice(1)];
      const e = await refus(fabriquer(tablesEx));
      expect(e.problemes).toContainEqual(expect.objectContaining({ table: t.name, id: String(ligne[0]), colonne: c.col }));
    });
  }
});
