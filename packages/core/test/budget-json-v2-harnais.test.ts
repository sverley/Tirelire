/**
 * Harnais d'audit de #378 — le budget JSON définit ses parties ; le cœur n'applique que la différence
 * avec l'état lu.
 *
 * Composé après le codage (auditeur.md, étape 2) : les tests du codeur, tous retenus ; chaque
 * `describe` reprend un point du « Fait quand » sous son numéro. Sont de l'auditeur : au point 7, ce
 * que le projet a changé depuis l'état lu et que la différence ne touche pas reste ; au point 8, rien
 * n'est écrit d'une application refusée, par la voie de l'application (importer, puis appliquer si
 * l'import passe). Les points 10 et 11 : `budget-json-harnais.test.ts` (#366 · 6 et 7) et la relecture.
 *
 * Niveaux (D83), par le besoin couvert :
 * - 0 · l'irréparable : ce que le projet a changé depuis l'état lu et que la différence ne touche pas
 *   reste (point 7) ; rien d'une application refusée n'est écrit (point 8) — sinon une saisie de
 *   l'utilisateur serait écrasée ou le projet altéré.
 * - 2 · un cas est faux : le reste.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import {
  appliquerBudget,
  BUDGET_JSON_FORMAT,
  BUDGET_JSON_VERSION,
  differenceBudget,
  ecrireBudgetJson,
  emptyLedger,
  etatDuProjet,
  exampleLedger,
  identifiantDuNom,
  importerBudgetJson,
  LedgerStore,
  lireBudgetJson,
  MAIN_ACCOUNT_ID,
  preparerApplication,
  type Ledger,
} from '../src/index.js';

const SQL = await initSqlJs();
const DOC = readFileSync(new URL('../../../docs/format-budget-json.md', import.meta.url), 'utf8');
const exemple = (): Record<string, unknown> =>
  JSON.parse([...DOC.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!).find((b) => b.includes('"planned_flows"'))!);
const v2 = (parties: Record<string, unknown>) => ({ format: BUDGET_JSON_FORMAT, version: BUDGET_JSON_VERSION, ...parties });

async function projetExemple(): Promise<LedgerStore> {
  const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
  const r = importerBudgetJson(exemple(), s.load());
  if (!r.ok) throw new Error(r.message);
  appliquerBudget(s, r.application);
  return s;
}
const vivantes = <T extends { deletedAt?: string }>(l: T[]) => l.filter((x) => !x.deletedAt);

describe('[niveau 2] #378 · 1 — la version 2, devenue 3 (#393), puis 4 (#205)', () => {
  it('la version 4 se lit ; les versions 1 à 3 sont refusées en le disant', () => {
    expect(BUDGET_JSON_VERSION).toBe(4);
    expect(lireBudgetJson(v2({})).ok).toBe(true);
    const deux = lireBudgetJson({ ...exemple(), version: 2 });
    expect(deux.ok).toBe(false);
    if (!deux.ok) expect(deux.message).toMatch(/version vaut 2.*version 4/);
    const lu = lireBudgetJson({ ...exemple(), version: 1 });
    expect(lu.ok).toBe(false);
    if (!lu.ok) expect(lu.message).toMatch(/version vaut 1.*version 4/);
  });
});

describe('[niveau 2] #378 · 2 — une partie présente se définit entièrement', () => {
  it('une ligne qu’une table présente ne nomme pas est retirée ; une table absente ne change pas', async () => {
    const s = await projetExemple();
    const avant = s.load();
    const j = ecrireBudgetJson(avant, ['categories']);
    j['categories'] = (j['categories'] as Array<Record<string, unknown>>).filter((c) => c['id'] !== 'cat-enfants');
    const r = importerBudgetJson(j, avant);
    if (!r.ok) throw new Error(r.message);
    appliquerBudget(s, r.application);
    const apres = s.load();
    expect(apres.categories.find((c) => c.id === 'cat-enfants')!.deletedAt).toBeTruthy();
    expect(vivantes(apres.categories).length).toBe(vivantes(avant.categories).length - 1);
    expect(apres.tirelires).toEqual(avant.tirelires);
    expect(apres.plannedFlows).toEqual(avant.plannedFlows);
  });
  it('une liste vide définit une table vide ; une clé de réglage absente ne change pas', async () => {
    const s = await projetExemple();
    const avant = s.load();
    const r = importerBudgetJson(v2({ needs: [], settings: { periodStartDay: 3 } }), avant);
    if (!r.ok) throw new Error(r.message);
    appliquerBudget(s, r.application);
    const apres = s.load();
    expect(vivantes(apres.needs)).toEqual([]);
    expect(apres.settings.periodStartDay).toBe(3);
    expect(apres.settings.principalCushion).toBe(avant.settings.principalCushion);
  });
});

describe('[niveau 2] #378 · 3 — le simple et le complet', () => {
  it('sans identifiant ni colonne facultative : l’identifiant se déduit du nom, les valeurs par défaut s’appliquent', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
    const r = importerBudgetJson(v2({ categories: [{ name: 'Énergie & eau', nature: 'expense' }] }), s.load());
    if (!r.ok) throw new Error(r.message);
    appliquerBudget(s, r.application);
    expect(s.load().categories).toEqual([{ id: 'cat-energie-eau', name: 'Énergie & eau', nature: 'expense' }]);
    expect(identifiantDuNom('categories', 'Énergie & eau')).toBe('cat-energie-eau');
  });
  it('deux lignes de même nom sans identifiant dans une table sont refusées', () => {
    const lu = lireBudgetJson(v2({ categories: [{ name: 'A', nature: 'expense' }, { name: 'A', nature: 'income' }] }));
    expect(lu.ok).toBe(false);
  });
  it('le compte principal du fichier, sans identifiant, est celui du projet ; non nommé, il reste', async () => {
    const lu = lireBudgetJson(v2({ accounts: [{ name: 'Courant', kind: 'principal', opening_balance: 100, opening_date: '2026-01-01' }] }));
    expect(lu.ok && lu.budget.tables.accounts![0]!.id).toBe(MAIN_ACCOUNT_ID);
    const s = await projetExemple();
    const r = importerBudgetJson(v2({ accounts: [] }), s.load());
    expect(r.ok).toBe(false); // des flux désignent encore les comptes retirés
    if (r.ok) return;
    expect(r.problemes.some((p) => p.id === MAIN_ACCOUNT_ID)).toBe(false);
  });
});

describe('[niveau 2] #378 · 4 — le fichier se lit seul', () => {
  it('une référence vers une table qu’il définit vise ses lignes ; vers une autre, elle attend le projet', async () => {
    const besoin = { tirelire_id: 'env-x', kind: 'recurring', priority: 1, name: 'B' };
    expect(lireBudgetJson(v2({ tirelires: [], needs: [besoin] })).ok).toBe(false);
    expect(lireBudgetJson(v2({ needs: [besoin] })).ok).toBe(true);
    expect(importerBudgetJson(v2({ needs: [besoin] }), emptyLedger()).ok).toBe(false);
  });
});

describe('[niveau 2] #378 · 5 — écrire un état', () => {
  it('relire ce que le cœur écrit redonne les mêmes lignes, colonne pour colonne ; les parties choisies seulement', async () => {
    const projet = (await projetExemple()).load();
    const ecrit = ecrireBudgetJson(projet);
    expect(ecrit['version']).toBe(BUDGET_JSON_VERSION);
    const lu = lireBudgetJson(JSON.stringify(ecrit));
    if (!lu.ok) throw new Error(lu.message);
    expect(lu.budget).toEqual(etatDuProjet(projet));
    expect(Object.keys(ecrireBudgetJson(projet, ['tirelires', 'periodStartDay'])).sort()).toEqual(['format', 'settings', 'tirelires', 'version']);
  });
});

describe('[niveau 2] #378 · 6 — la différence', () => {
  it('ajouts, modifications et leurs colonnes, retraits, réglages ; une partie non définie n’en a pas', async () => {
    const projet = (await projetExemple()).load();
    const etatLu = etatDuProjet(projet, ['categories', 'tirelires', 'periodStartDay']);
    const j = ecrireBudgetJson(projet, ['categories', 'periodStartDay']);
    const cats = j['categories'] as Array<Record<string, unknown>>;
    cats.find((c) => c['id'] === 'cat-alim')!['name'] = 'Courses';
    const retiree = cats.pop()!;
    cats.push({ id: 'cat-neuve', name: 'Neuve', nature: 'expense' });
    (j['settings'] as Record<string, unknown>)['periodStartDay'] = 2;
    const lu = lireBudgetJson(j);
    if (!lu.ok) throw new Error(lu.message);
    const d = differenceBudget(lu.budget, etatLu);
    expect(d.tables.categories!.ajouts.map((l) => l.id)).toEqual(['cat-neuve']);
    expect(d.tables.categories!.modifications.map((m) => [m.id, m.colonnes])).toEqual([['cat-alim', ['name']]]);
    expect(d.tables.categories!.retraits.map((l) => l.id)).toEqual([retiree['id']]);
    expect(d.reglages).toEqual([{ cle: 'periodStartDay', avant: 28, apres: 2 }]);
    expect(d.tables.tirelires).toBeUndefined();
  });
});

async function scenario(modifierProjet: (s: LedgerStore) => void, modifierFichier: (cats: Array<Record<string, unknown>>) => void) {
  const s = await projetExemple();
  const etatLu = etatDuProjet(s.load(), ['categories']);
  const j = ecrireBudgetJson(s.load(), ['categories']);
  modifierProjet(s);
  modifierFichier(j['categories'] as Array<Record<string, unknown>>);
  const lu = lireBudgetJson(j);
  if (!lu.ok) throw new Error(lu.message);
  const prep = preparerApplication(differenceBudget(lu.budget, etatLu), etatLu, s.load());
  if (!prep.ok) throw new Error(prep.message);
  return { s, prep };
}

describe('[niveau 0] #378 · 7 — ce que le projet a changé depuis l’état lu, et que la différence ne touche pas, reste', () => {
  it('une ligne modifiée dans le projet, que le fichier laisse telle qu’il l’a lue, garde la modification du projet', async () => {
    const { s, prep } = await scenario(
      (s) => s.upsert('categories', { id: 'cat-enfants', name: 'Petits', nature: 'expense' }),
      (cats) => (cats.find((c) => c['id'] === 'cat-alim')!['name'] = 'Courses'),
    );
    expect(prep.conflits).toEqual([]);
    appliquerBudget(s, prep);
    const l = s.load();
    expect(l.categories.find((c) => c.id === 'cat-enfants')).toMatchObject({ name: 'Petits' });
    expect(l.categories.find((c) => c.id === 'cat-enfants')!.deletedAt).toBeUndefined();
    expect(l.categories.find((c) => c.id === 'cat-alim')!.name).toBe('Courses');
  });
  it('une ligne ajoutée dans le projet, dans une table que le fichier définit, reste', async () => {
    const { s, prep } = await scenario(
      (s) => s.upsert('categories', { id: 'cat-ailleurs', name: 'Ailleurs', nature: 'income' }),
      () => {},
    );
    appliquerBudget(s, prep);
    expect(s.load().categories.find((c) => c.id === 'cat-ailleurs')!.deletedAt).toBeUndefined();
  });
});

describe('[niveau 2] #378 · 7 — appliquer la différence au projet du moment', () => {
  it('ce que le projet a changé ailleurs reste, sans conflit', async () => {
    const { s, prep } = await scenario(
      (s) => s.upsert('categories', { id: 'cat-ailleurs', name: 'Ailleurs', nature: 'income' }),
      (cats) => (cats.find((c) => c['id'] === 'cat-alim')!['name'] = 'Courses'),
    );
    expect(prep.conflits).toEqual([]);
    appliquerBudget(s, prep);
    const l = s.load();
    expect(l.categories.find((c) => c.id === 'cat-ailleurs')!.deletedAt).toBeUndefined();
    expect(l.categories.find((c) => c.id === 'cat-alim')!.name).toBe('Courses');
  });
  it('une même ligne changée des deux côtés : la version de l’application est retenue, le conflit rendu', async () => {
    const { s, prep } = await scenario(
      (s) => s.upsert('categories', { id: 'cat-alim', name: 'Nourriture', nature: 'expense' }),
      (cats) => (cats.find((c) => c['id'] === 'cat-alim')!['name'] = 'Courses'),
    );
    expect(prep.conflits).toEqual([
      { table: 'categories', id: 'cat-alim', retenue: expect.objectContaining({ name: 'Courses' }), ecartee: expect.objectContaining({ name: 'Nourriture' }) },
    ]);
    appliquerBudget(s, prep);
    expect(s.load().categories.find((c) => c.id === 'cat-alim')!.name).toBe('Courses');
  });
  it('un retrait contre une modification est un conflit ; le retrait est une suppression logique', async () => {
    const { s, prep } = await scenario(
      (s) => s.upsert('categories', { id: 'cat-enfants', name: 'Petits', nature: 'expense' }),
      (cats) => cats.splice(cats.findIndex((c) => c['id'] === 'cat-enfants'), 1),
    );
    expect(prep.conflits.map((c) => [c.id, c.retenue, c.ecartee?.['name']])).toEqual([['cat-enfants', null, 'Petits']]);
    appliquerBudget(s, prep);
    expect(s.load().categories.find((c) => c.id === 'cat-enfants')!.deletedAt).toBeTruthy();
  });
});

describe('[niveau 0] #378 · 8 — rien d’une application refusée n’est écrit', () => {
  it('importer puis appliquer si l’import passe : un retrait qu’une opération désigne encore laisse le projet tel quel, octet pour octet', async () => {
    const s = await projetExemple();
    const op = exampleLedger().operations[0]!;
    s.upsert('operations', op);
    s.upsert('subOperations', { id: 'sub-enfants', operationId: op.id, categoryId: 'cat-enfants', share: { kind: 'variable' } });
    const avant = s.export();
    const j = ecrireBudgetJson(s.load(), ['categories', 'periodStartDay']);
    j['categories'] = (j['categories'] as Array<Record<string, unknown>>).filter((c) => c['id'] !== 'cat-enfants');
    (j['settings'] as Record<string, unknown>)['periodStartDay'] = 2;
    const r = importerBudgetJson(j, s.load());
    if (r.ok) appliquerBudget(s, r.application);
    expect(r.ok).toBe(false);
    expect(s.export()).toEqual(avant);
  });
});

describe('[niveau 2] #378 · 8 — tout ou rien', () => {
  it('une ligne retirée qu’une opération désigne encore refuse le tout, rien n’est écrit', async () => {
    const s = await projetExemple();
    const op = exampleLedger().operations[0]!;
    s.upsert('operations', op);
    s.upsert('subOperations', { id: 'sub-enfants', operationId: op.id, categoryId: 'cat-enfants', share: { kind: 'variable' } });
    const avant = s.export();
    const j = ecrireBudgetJson(s.load(), ['categories']);
    j['categories'] = (j['categories'] as Array<Record<string, unknown>>).filter((c) => c['id'] !== 'cat-enfants');
    const r = importerBudgetJson(j, s.load());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemes[0]).toMatchObject({ table: 'sub_operations', id: 'sub-enfants', colonne: 'category_id' });
      expect(r.message).toMatch(/table sub_operations, ligne « sub-enfants », colonne category_id/);
    }
    expect(s.export()).toEqual(avant);
  });
  it('un second compte principal est refusé', () => {
    const p = { kind: 'principal', opening_balance: 0, opening_date: '2026-01-01' };
    expect(lireBudgetJson(v2({ accounts: [{ name: 'A', ...p }, { name: 'B', ...p }] })).ok).toBe(false);
  });
});

describe('[niveau 2] #378 · 9 — l’import donne exactement les lignes du fichier', () => {
  it('pour chaque partie définie, les lignes vivantes du projet sont celles du fichier', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
    const autre: Ledger = { ...exampleLedger(), operations: [], subOperations: [], shortfallAnswers: [] };
    for (const k of ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows'] as const) for (const r of autre[k]) s.upsert(k, r as never);
    s.upsert('categories', { id: 'cat-en-trop', name: 'En trop', nature: 'expense' });
    const j = exemple();
    const r = importerBudgetJson(j, s.load());
    if (!r.ok) throw new Error(r.message);
    appliquerBudget(s, r.application);
    const lu = lireBudgetJson(j);
    if (!lu.ok) throw new Error(lu.message);
    const parId = <T extends { id: string }>(l: T[]) => [...l].sort((a, b) => a.id.localeCompare(b.id));
    const etat = etatDuProjet(s.load());
    for (const k of Object.keys(lu.budget.tables) as Array<keyof typeof lu.budget.tables>) expect(parId(etat.tables[k]!)).toEqual(parId(lu.budget.tables[k]!));
    expect(etat.settings).toMatchObject(lu.budget.settings);
    expect(vivantes(s.load().categories).some((c) => c.id === 'cat-en-trop')).toBe(false);
  });
});
