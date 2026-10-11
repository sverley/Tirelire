/**
 * Harnais d'audit de #365 — « La section Catégories sert à l'assistant et à l'écran Catégories » : la
 * section écrite une fois (point 1), sur le texte des sources ; le brouillon ouvert sur la section
 * (point 7), sans navigateur, sur un vrai dépôt (`LedgerStore`). Ce que l'écran et l'assistant montrent
 * et enregistrent est dans `section-categories-ecran-harnais.test.ts`.
 *
 * Les tests sont ceux du codeur (`section-categories.test.ts`, d'où ils sont déplacés en entier), classés
 * par la suite de questions de D83. Point 1, niveau 1 : le principe 13 et I11, que la section rend vrais par
 * construction (D94) ; vu rouge sur le `Wizard.svelte` et le `Categories.svelte` de `main`. Point 7 : ce que
 * le brouillon couvre et D93, niveau 2 (cas de règle, comme pour #363) ; le titre, niveau 3.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { LedgerStore, MAIN_ACCOUNT_ID, alive, type Category, type PlannedFlow } from '@tirelire/core';
import { ecrire, nouveauBrouillon, preparerValidation, titreDeLAssistant, valider } from '../src/lib/brouillon';

const lire = (chemin: string) => readFileSync(resolve(__dirname, '..', chemin), 'utf8');
const ecran = lire('src/views/Categories.svelte');
const wizard = lire('src/views/Wizard.svelte');
const composant = lire('src/lib/SectionCategories.svelte');

describe('[niveau 1] #365 · 1 — une section, écrite une fois', () => {
  it('l’assistant et l’écran emploient la même section ; l’assistant sur son brouillon, l’écran sur le projet', () => {
    expect(wizard).toMatch(/<SectionCategories s=\{sectionCategories\} \/>/);
    expect(wizard).toMatch(/new SectionDesCategories\(\s*\{[\s\S]*?app\.assistantLedger[\s\S]*?app\.assistantUpsert/);
    expect(ecran).toMatch(/<SectionCategories s=\{section\}/);
    expect(ecran).toMatch(/new SectionDesCategories\(\s*\{[\s\S]*?app\.ledger[\s\S]*?app\.upsert/);
    expect(ecran).not.toMatch(/assistantUpsert|assistantLedger/);
  });
  it('ni l’assistant ni l’écran ne réécrivent la ligne, les raccourcis, le formulaire ou le texte', () => {
    // L'assistant garde ses raccourcis des autres étapes : seuls ceux des catégories sont lus ici.
    for (const ecrit of ['aria-label="Nom de la catégorie"', 'sans demander de tirelire', 'Tirelire par défaut : ', 'suggestedCategory', 'appliquerCategorie', 'restantesCategories', 'Ajouter une catégorie</button>']) {
      expect(wizard, ecrit).not.toContain(ecrit);
      expect(ecran, ecrit).not.toContain(ecrit);
    }
    for (const ecrit of ['Ajouter en un geste', 'class="prop"']) expect(ecran, ecrit).not.toContain(ecrit);
    expect(composant).toContain('aria-label="Nom de la catégorie"');
    expect(composant).toContain('Ajouter en un geste');
    expect(lire('src/lib/sectionCategories.svelte.ts')).toContain('Tirelire par défaut : ');
  });
  it('seul l’assistant garnit d’office ; l’écran replie l’explication', () => {
    expect(wizard).toContain('sectionCategories.garnir()');
    expect(ecran).not.toMatch(/\.garnir\(/);
    expect(ecran).toMatch(/<SectionCategories[^>]*explicationRepliee/);
  });
});

const SQL = await initSqlJs();
const depot = () => LedgerStore.create({ sqlJs: SQL });
const cat = (id: string, name: string, extra: Partial<Category> = {}): Category => ({ id, name, nature: 'expense', ...extra });
const charge = (id: string, name: string, categoryId?: string): PlannedFlow => ({
  id,
  name,
  kind: 'fixedCharge',
  amount: -9000,
  accountId: MAIN_ACCOUNT_ID,
  periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-05' },
  dateWindowDays: 3,
  ...(categoryId ? { action: { categoryId } } : {}),
});

describe('#365 · 7 — le brouillon ouvert sur la section Catégories', () => {
  it('[niveau 3] le titre nomme la section', () => {
    expect(titreDeLAssistant('categories')).toBe('Compléter mes catégories');
  });

  it('[niveau 2] ouvert, il ne couvre que les catégories ; aucun réglage ne se propose d’office, même sur un projet vierge', async () => {
    const store = await depot();
    const b = nouveauBrouillon(store.load(), 'categories');
    expect(Object.keys(b.fichier.tables)).toEqual(['categories']);
    expect(b.fichier.settings).toEqual({});
    expect(b.reglagesProposes).toEqual({});
    expect(b.etape).toBe('categories');
  });

  it('[niveau 2] une ligne changée des deux côtés suit D93, et ce que le projet a changé ailleurs reste', async () => {
    const store = await depot();
    store.upsert('categories', cat('c-a', 'Alimentation'));
    store.upsert('plannedFlows', charge('f-e', 'Électricité'));
    const projet = store.load();
    const b = nouveauBrouillon(projet, 'categories');
    ecrire(b, 'categories', cat('c-a', 'Courses'));
    ecrire(b, 'plannedFlows', { ...charge('f-e', 'Électricité'), action: { categoryId: 'c-a' } });
    // Ailleurs, pendant que le brouillon attend : la même catégorie renommée, un flux ajouté.
    store.upsert('categories', cat('c-a', 'Épicerie'));
    store.upsert('plannedFlows', charge('f-i', 'Internet'));
    const maintenant = store.load();
    const { preparation } = preparerValidation(maintenant, b);
    expect(preparation.ok).toBe(true);
    valider(store, maintenant, b);
    const apres = store.load();
    expect(alive(apres.categories).map((c) => c.name)).toEqual(['Courses']);
    expect(alive(apres.plannedFlows).find((f) => f.id === 'f-e')?.action?.categoryId).toBe('c-a');
    expect(alive(apres.plannedFlows).map((f) => f.name).sort()).toEqual(['Internet', 'Électricité']);
  });
});
