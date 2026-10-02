/**
 * Tests du codeur de #198, tour 2 — les identifiants dans les colonnes JSON (points 2 et 10 amendés,
 * porteur, 02/10) et le chemin relatif de la commande (retour 1 de l'auditeur). Tous de niveau 4
 * (D83) : l'auditeur choisit parmi eux ceux du harnais.
 *
 * Les fichiers sont fabriqués comme le ferait un script : des `CREATE TABLE` et des `INSERT` écrits à
 * la main, sans horloge, à partir des lignes de l'exemple, complétées d'un automatisme et d'un profil
 * d'import qui portent chacun de leurs identifiants.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  exampleLedger,
  feuillesDe,
  FichierRefuse,
  FILE_FORMAT,
  FORMAT_VERSION,
  LedgerStore,
  MAIN_ACCOUNT_ID,
  TABLES,
  type Ledger,
  type LedgerKey,
} from '../src/index.js';

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

type Valeur = string | number | null;

/** L'exemple, plus un automatisme et un profil d'import qui portent chacun de leurs identifiants. */
function exempleComplet(): Ledger {
  const l = exampleLedger();
  l.automations.push({
    id: 'auto-json',
    selection: { labelPattern: 'BOULANGERIE', accountId: MAIN_ACCOUNT_ID },
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
    id: 'profil-json',
    name: 'Banque',
    source: 'bank',
    encoding: 'auto',
    delimiter: 'auto',
    headerRow: 0,
    columns: { date: 'Date', label: 'Libellé', amount: 'Montant', account: 'Compte' },
    dateFormat: 'DMY',
    accountMap: { 'FR76 0001': MAIN_ACCOUNT_ID },
  });
  return l;
}

/** Un fichier fabriqué hors de l'application depuis un grand livre : toutes les colonnes, sans horloge. */
function fabriquer(l: Ledger): Uint8Array {
  const db = new SQL.Database();
  db.run('CREATE TABLE meta (key TEXT, value TEXT)');
  db.run('INSERT INTO meta VALUES (?, ?), (?, ?)', ['format', FILE_FORMAT, 'format_version', String(FORMAT_VERSION)]);
  for (const [cle, t] of Object.entries(TABLES)) {
    db.run(`CREATE TABLE ${t.name} (${t.columns.map((c) => c.col).join(', ')})`);
    for (const r of l[cle as LedgerKey] as unknown as Array<Record<string, unknown>>) {
      const valeurs: Valeur[] = t.columns.map((c) => {
        const v = r[c.prop];
        if (v === undefined || v === null) return null;
        if (c.type === 'json') return JSON.stringify(v);
        if (c.type === 'boolean') return v ? 1 : 0;
        return v as Valeur;
      });
      db.run(`INSERT INTO ${t.name} VALUES (${valeurs.map(() => '?').join(', ')})`, valeurs);
    }
  }
  const octets = db.export();
  db.close();
  return octets;
}

const ouvrir = (octets: Uint8Array) => LedgerStore.create({ sqlJs: SQL, bytes: octets, verifier: true, siteId: 'ouvreur' });

async function refus(octets: Uint8Array): Promise<FichierRefuse> {
  try {
    (await ouvrir(octets)).close();
  } catch (err) {
    if (err instanceof FichierRefuse) return err;
    throw err;
  }
  throw new Error('Le fichier s’est ouvert : un refus était attendu.');
}

/** Chaque identifiant d'une colonne JSON : la ligne qui le porte, et comment lui faire viser une ligne absente. */
const CAS: Array<{ chemin: string; table: string; id: string; colonne: string; casser: (l: Ledger) => void }> = [
  {
    chemin: 'tirelires.placement[].accountId',
    table: 'tirelires',
    id: 'env-vac',
    colonne: 'placement',
    casser: (l) => (l.tirelires.find((t) => t.id === 'env-vac')!.placement[0]!.accountId = 'acc-absent'),
  },
  {
    chemin: 'automations.selection.accountId',
    table: 'automations',
    id: 'auto-json',
    colonne: 'selection',
    casser: (l) => (l.automations[0]!.selection.accountId = 'acc-absent'),
  },
  {
    chemin: 'automations.action.categoryId',
    table: 'automations',
    id: 'auto-json',
    colonne: 'action',
    casser: (l) => (l.automations[0]!.action.categoryId = 'cat-absente'),
  },
  {
    chemin: 'automations.action.tirelireId',
    table: 'automations',
    id: 'auto-json',
    colonne: 'action',
    casser: (l) => (l.automations[0]!.action.tirelireId = 'env-absente'),
  },
  {
    chemin: 'automations.action.allocation[].categoryId',
    table: 'automations',
    id: 'auto-json',
    colonne: 'action',
    casser: (l) => (l.automations[0]!.action.allocation![1]!.categoryId = 'cat-absente'),
  },
  {
    chemin: 'automations.action.allocation[].tirelireId',
    table: 'automations',
    id: 'auto-json',
    colonne: 'action',
    casser: (l) => (l.automations[0]!.action.allocation![0]!.tirelireId = 'env-absente'),
  },
  {
    chemin: 'import_profiles.account_map{}',
    table: 'import_profiles',
    id: 'profil-json',
    colonne: 'account_map',
    casser: (l) => (l.importProfiles[0]!.accountMap['FR76 0001'] = 'acc-absent'),
  },
];

describe('[niveau 4] #198 · 2. un identifiant dans une colonne JSON qui désigne une ligne absente refuse le fichier', () => {
  it('l’exemple, avec un automatisme et un profil d’import qui portent tous leurs identifiants, s’ouvre', async () => {
    const s = await ouvrir(fabriquer(exempleComplet()));
    expect(s.load().automations.map((a) => a.id)).toEqual(['auto-json']);
  });

  for (const c of CAS) {
    it(`${c.chemin} vers une ligne absente : refusé, en nommant table, ligne et colonne`, async () => {
      const l = exempleComplet();
      c.casser(l);
      const e = await refus(fabriquer(l));
      expect(e.problemes).toHaveLength(1);
      expect(e.problemes[0]).toMatchObject({ table: c.table, id: c.id, colonne: c.colonne });
      expect(e.message).toContain(`table ${c.table}, ligne « ${c.id} », colonne ${c.colonne}`);
    });
  }

  it('un identifiant qui désigne une ligne supprimée, mais présente dans le fichier, ne refuse pas', async () => {
    const l = exempleComplet();
    l.categories.push({ id: 'cat-retiree', name: 'Retirée', nature: 'expense', deletedAt: '2026-09-01T10:00:00.000Z' });
    l.automations[0]!.action.categoryId = 'cat-retiree';
    expect((await ouvrir(fabriquer(l))).load().automations[0]!.action.categoryId).toBe('cat-retiree');
  });
});

describe('[niveau 4] #198 · 10. tout identifiant d’une colonne JSON est vérifié', () => {
  const feuilles = Object.values(TABLES).flatMap((t) => t.columns.filter((c) => c.shape).flatMap((c) => feuillesDe(`${t.name}.${c.col}`, c.shape!)));

  it('chaque valeur nommée en « Id », et chaque valeur de la table des comptes, déclare la table qu’elle désigne', () => {
    const identifiants = feuilles.filter((f) => /Id$/.test(f.chemin) || f.chemin.endsWith('{}'));
    expect(identifiants.filter((f) => !f.feuille.ref).map((f) => f.chemin)).toEqual([]);
    for (const f of identifiants) expect(Object.values(TABLES).map((t) => t.name)).toContain(f.feuille.ref);
  });

  it('chaque identifiant déclaré d’une forme JSON est vérifié à l’ouverture d’un fichier', () => {
    const declares = feuilles.filter((f) => f.feuille.ref).map((f) => f.chemin);
    expect(new Set(declares)).toEqual(new Set(CAS.map((c) => c.chemin)));
  });
});

describe('[niveau 4] #198 · 5. la commande lit un chemin relatif depuis le dossier de l’appel', () => {
  it('appelée par pnpm depuis un autre dossier, avec un chemin relatif', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'tirelire-198-'));
    writeFileSync(join(dossier, 'fabrique.sqlite'), fabriquer(exempleComplet()));
    const coeur = resolve(__dirname, '..');
    const r = spawnSync('pnpm', ['--dir', coeur, 'run', '--silent', 'verifier-fichier', 'fabrique.sqlite'], { cwd: dossier, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('fabrique.sqlite : s’ouvre');
  }, 30_000);
});
