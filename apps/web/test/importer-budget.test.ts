/**
 * Tests du codeur de #367 — « Importer un budget JSON depuis l'interface ou par une adresse, et le
 * valider dans l'assistant » : ce que l'import pose dans le brouillon de l'assistant et l'adresse
 * qui le porte, sans navigateur, sur un vrai dépôt. Ce qui se voit à l'écran (l'entrée de
 * Configuration, l'ouverture par une adresse) se relit dans les sources, faute de navigateur ici.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { LedgerStore, computePlan, exampleLedger, importerBudgetJson, lireBudgetJson, type Ledger } from '@tirelire/core';
import { brouillonDuFichier, brouillonIntact, montrer, valider } from '../src/lib/brouillon';
import { ADRESSE_BUDGET, adressePorteUnBudget, budgetDeLAdresse } from '../src/lib/importBudget';

const SQL = await initSqlJs();
const JOUR = '2026-09-06';
const lire = (chemin: string) => readFileSync(resolve(process.cwd(), chemin), 'utf8');
const DOC = readFileSync(resolve(process.cwd(), '../../docs/format-budget-json.md'), 'utf8');
const EXEMPLE = [...DOC.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!).find((b) => b.includes('"planned_flows"'))!;

const planDe = (l: Ledger) => {
  const p = computePlan(l, JOUR);
  return { totaux: p.totals, lignes: p.lines, virements: p.transfers, annonces: p.warnings };
};
const sansOperations = (): Ledger => ({ ...exampleLedger(), operations: [], subOperations: [], shortfallAnswers: [] });

async function importe() {
  const store = await LedgerStore.create({ sqlJs: SQL, siteId: 'test' });
  const projet = store.load();
  const lu = importerBudgetJson(EXEMPLE, projet);
  if (!lu.ok) throw new Error(lu.message);
  const budget = lireBudgetJson(EXEMPLE);
  if (!budget.ok) throw new Error(budget.message);
  return { store, projet, brouillon: brouillonDuFichier(projet, budget.budget) };
}

describe('[niveau 4] #367 · 3 — un JSON accepté ouvre l’assistant sur son résumé, le budget posé sur le projet', () => {
  it('le brouillon s’ouvre au résumé, dit qu’il vient d’un import, et n’a aucune proposition d’office', async () => {
    const { brouillon } = await importe();
    expect(brouillon.etape).toBe('summary');
    expect(brouillon.budgetImporte).toBe(true);
    expect(brouillon.semees).toEqual([]);
    expect(brouillon.reglagesProposes).toEqual({});
    expect(brouillonIntact(brouillon), 'un import ne se perd pas en revenant dans l’assistant').toBe(false);
  });

  it('ce que l’assistant montre est le plan de l’exemple privé de ses opérations', async () => {
    const { projet, brouillon } = await importe();
    expect(planDe(montrer(projet, brouillon))).toEqual(planDe(sansOperations()));
  });
});

describe('[niveau 4] #367 · 4 — la validation fait entrer le budget, tout en une fois ; avant, rien n’est enregistré', () => {
  it('le projet ne change pas tant que le brouillon n’est pas validé', async () => {
    const { store, projet, brouillon } = await importe();
    void brouillon;
    expect(store.load()).toEqual(projet);
  });

  it('valider donne au centime le plan de l’exemple privé de ses opérations (point 6)', async () => {
    const { store, projet, brouillon } = await importe();
    valider(store, projet, brouillon);
    expect(planDe(store.load())).toEqual(planDe(sansOperations()));
  });
});

describe('[niveau 4] #367 · 2 — l’adresse porte le JSON après « # »', () => {
  it('le JSON encodé pour une adresse se retrouve tel quel, accents compris', () => {
    const json = JSON.stringify({ format: 'tirelire-budget', version: 4, accounts: [{ name: 'Épargne & « livret » 100 %' }] });
    const hash = ADRESSE_BUDGET + encodeURIComponent(json);
    expect(adressePorteUnBudget(hash)).toBe(true);
    expect(budgetDeLAdresse(hash)).toEqual({ texte: json });
  });

  it('une autre ancre n’est pas un budget', () => {
    expect(adressePorteUnBudget('')).toBe(false);
    expect(adressePorteUnBudget('#plan')).toBe(false);
  });

  it('un texte mal encodé est refusé en le disant, sans exception', () => {
    const r = budgetDeLAdresse(ADRESSE_BUDGET + '%E0%A4%A');
    expect(r).toHaveProperty('refus');
  });

  it('lu, il se retire de l’adresse sans recharger la page, et rien n’est envoyé à un serveur', () => {
    const etat = lire('src/lib/state.svelte.ts');
    const corps = etat.slice(etat.indexOf('ouvrirParAdresse(): void'));
    expect(corps).toMatch(/history\.replaceState/);
    expect(corps.slice(0, corps.indexOf('\n  }\n'))).not.toMatch(/fetch\(|location\.(reload|assign|replace|href\s*=)|sendBeacon|XMLHttpRequest/);
    expect(lire('src/views/ImportBudget.svelte')).not.toMatch(/fetch\(|sendBeacon|XMLHttpRequest/);
  });
});

describe('[niveau 4] #367 · 1 — l’entrée de Configuration', () => {
  it('Configuration offre « Importer un budget (JSON) », qui ouvre l’écran d’import', () => {
    expect(lire('src/views/More.svelte')).toMatch(/id: 'importBudget', label: 'Importer un budget \(JSON\)'/);
    expect(lire('src/App.svelte')).toMatch(/app\.view === 'importBudget'[\s\S]*<ImportBudget \/>/);
  });

  it('l’écran laisse choisir un fichier ou coller le texte, et dit ce que l’import remplace avant d’importer', () => {
    const ecran = lire('src/views/ImportBudget.svelte');
    expect(ecran).toMatch(/type="file"/);
    expect(ecran).toMatch(/<textarea/);
    expect(ecran).toMatch(/app\.assistantPrepare[\s\S]*les remplace/);
  });
});

describe('[niveau 4] #367 · 4 — par une adresse, avec un brouillon non vide, l’import attend l’accord', () => {
  it('l’état garde le budget en attente, l’écran demande, et refuser n’importe rien', () => {
    const etat = lire('src/lib/state.svelte.ts');
    expect(etat).toMatch(/this\.assistantPrepare\) \{[\s\S]*?this\.importEnAttente = lue\.texte;[\s\S]*?return;/);
    expect(etat).toMatch(/if \(accepte && texte !== undefined\) this\.lireImportDeLAdresse/);
    expect(lire('src/App.svelte')).toMatch(/app\.importEnAttente !== undefined[\s\S]*repondreImportEnAttente\(true\)[\s\S]*repondreImportEnAttente\(false\)/);
  });
});

describe('[niveau 4] #367 · 2 — l’assistant déjà affiché passe au brouillon importé', () => {
  it('un import change la version de l’assistant, et l’écran se remonte sur elle', () => {
    expect(lire('src/lib/state.svelte.ts')).toMatch(/this\.assistant = brouillonDuFichier\([^)]*\);\s*this\.versionAssistant\+\+;/);
    expect(lire('src/App.svelte')).toMatch(/\{#key app\.versionAssistant\}<Wizard \/>\{\/key\}/);
  });
});

describe('[niveau 4] #367 · 3 — le résumé d’un budget importé dit d’où il vient et que rien n’est enregistré avant la validation', () => {
  it('l’encart d’import du résumé porte les deux phrases', () => {
    const ecran = lire('src/views/Wizard.svelte');
    const encart = ecran.slice(ecran.indexOf('Ce budget vient d’un import.'), ecran.indexOf('Ce budget vient d’un import.') + 400);
    expect(encart).toMatch(/Rien n’est enregistré avant que vous le validiez/);
  });
});
