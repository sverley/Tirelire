import { describe, expect, it } from 'vitest';
import { alive, budgetSuggestions, exampleLedger, suggestedCategory } from '../src/index.js';

/**
 * Tests du codeur de #212 — « L'assistant propose les catégories de l'exemple » : la lecture des
 * catégories de l'exemple et de leurs liens par `budgetSuggestions` (`src/suggestions.ts`), sans
 * navigateur. Ce qui se voit à l'écran — l'étape Catégories, les raccourcis, la validation — est dans
 * `apps/web/test/navigateur/assistant-categories-exemple.test.ts`.
 *
 * Chaque test dit, dans son titre, le point du « Fait quand » qu'il vérifie.
 */
const exemple = exampleLedger();
const categories = alive(exemple.categories);
const tirelires = alive(exemple.tirelires);
const flux = alive(exemple.plannedFlows);
// Les catégories ne dépendent pas de la date : elle est fixée comme dans `suggestions.test.ts`.
const s = budgetSuggestions('2026-09-06');
const propose = (nom: string) => s.categories.find((c) => c.name === nom)!;

describe('[niveau 4] #212 · 1 — les dix catégories de l’exemple sont proposées, et elles seules, chacune avec sa nature', () => {
  it('trois de revenu, « Salaire », « Loyer perçu » et « Allocations », puis sept de dépense, dans l’ordre de l’exemple', () => {
    expect(s.categories.map((c) => [c.nature, c.name])).toEqual([
      ['income', 'Salaire'],
      ['income', 'Loyer perçu'],
      ['income', 'Allocations'],
      ['expense', 'Alimentation'],
      ['expense', 'Santé'],
      ['expense', 'Enfants'],
      ['expense', 'Logement'],
      ['expense', 'Assurances'],
      ['expense', 'Abonnements'],
      ['expense', 'Virement interne'],
    ]);
  });

  it('la nature de chacune est celle que l’exemple lui donne', () => {
    for (const p of s.categories) expect(categories.find((c) => c.name === p.name)!.nature, p.name).toBe(p.nature);
  });

  it('les catégories proposées ne dépendent pas de la date de lecture', () => {
    expect(budgetSuggestions('2026-11-15').categories).toEqual(s.categories);
    expect(budgetSuggestions('2027-01-15').categories).toEqual(s.categories);
  });
});

describe('[niveau 4] #212 · 2 — chaque catégorie arrive avec ses liens de l’exemple : sa tirelire par défaut, et le flux qui la porte', () => {
  it('« Alimentation », « Santé » et « Enfants » ont la tirelire par défaut que l’exemple leur donne, « Enfants » celle qui s’appelle « Enfants et loisirs »', () => {
    expect(propose('Alimentation').tirelireName).toBe('Alimentation');
    expect(propose('Santé').tirelireName).toBe('Santé');
    expect(propose('Enfants').tirelireName).toBe('Enfants et loisirs');
  });

  it('aucune autre n’a de tirelire par défaut : l’exemple ne leur en donne pas', () => {
    expect(s.categories.filter((c) => c.tirelireName !== undefined).map((c) => c.name)).toEqual(['Alimentation', 'Santé', 'Enfants']);
  });

  it('chaque flux de l’exemple qui porte une catégorie est proposé avec elle : « Logement » porte « Crédit immobilier » et « Électricité »', () => {
    expect(propose('Logement').flows).toEqual([
      { name: 'Crédit immobilier', kind: 'fixedCharge' },
      { name: 'Électricité', kind: 'fixedCharge' },
    ]);
    expect(propose('Salaire').flows).toEqual([{ name: 'Salaire', kind: 'income' }]);
    expect(propose('Loyer perçu').flows).toEqual([{ name: 'Loyer locatif', kind: 'income' }]);
    expect(propose('Allocations').flows).toEqual([{ name: 'Allocations', kind: 'income' }]);
    expect(propose('Assurances').flows).toEqual([{ name: 'Assurance habitation', kind: 'fixedCharge' }]);
    expect(propose('Abonnements').flows).toEqual([{ name: 'Internet et mobiles', kind: 'fixedCharge' }]);
  });

  it('les catégories sans flux n’en portent aucun : « Alimentation », « Santé », « Enfants » et « Virement interne »', () => {
    for (const nom of ['Alimentation', 'Santé', 'Enfants', 'Virement interne']) expect(propose(nom).flows, nom).toEqual([]);
  });

  it('les deux versions du salaire, deux flux de l’exemple, ne font qu’un flux de la catégorie « Salaire »', () => {
    expect(flux.filter((f) => f.name === 'Salaire')).toHaveLength(2);
    expect(propose('Salaire').flows).toHaveLength(1);
  });
});

describe('[niveau 4] #212 · 3 — une catégorie se garde sans sa tirelire', () => {
  const alimentation = propose('Alimentation');

  it('la catégorie créée porte la tirelire par défaut que celui qui l’écrit lui donne', () => {
    expect(suggestedCategory(alimentation, { id: 'c1', tirelireId: 't1' })).toEqual({ id: 'c1', name: 'Alimentation', nature: 'expense', tirelireId: 't1' });
  });

  it('sans tirelire de ce nom chez lui, la catégorie arrive sans tirelire par défaut : elle reste une catégorie (D32)', () => {
    expect(suggestedCategory(alimentation, { id: 'c1' })).toEqual({ id: 'c1', name: 'Alimentation', nature: 'expense' });
  });

  it('une catégorie de revenu n’a jamais de tirelire par défaut, même si on lui en désigne une', () => {
    expect(suggestedCategory(propose('Salaire'), { id: 'c2', tirelireId: 't1' })).toEqual({ id: 'c2', name: 'Salaire', nature: 'income' });
  });
});

describe('[niveau 4] #212 · 5 — ces propositions viennent de l’exemple et de lui seul, dans les deux sens', () => {
  it('chaque catégorie proposée figure dans l’exemple par sa nature et son nom, et chaque catégorie de l’exemple est proposée', () => {
    const cle = (nature: string, nom: string) => `${nature}|${nom}`;
    expect(s.categories.map((c) => cle(c.nature, c.name)).sort()).toEqual(categories.map((c) => cle(c.nature, c.name)).sort());
  });

  it('la tirelire par défaut proposée est celle que l’exemple donne, par son nom, et toute tirelire par défaut de l’exemple est proposée', () => {
    const dansLExemple = categories.map((c) => [c.name, tirelires.find((t) => t.id === c.tirelireId)?.name]);
    expect(s.categories.map((c) => [c.name, c.tirelireName])).toEqual(dansLExemple);
  });

  it('les flux proposés sont ceux que l’exemple lie à chaque catégorie, ni plus ni moins', () => {
    const liens = (nom: string) => {
      const id = categories.find((c) => c.name === nom)!.id;
      const noms = flux.filter((f) => f.categoryId === id).map((f) => `${f.kind}|${f.name}`);
      return [...new Set(noms)].sort();
    };
    for (const p of s.categories) expect(p.flows.map((f) => `${f.kind}|${f.name}`).sort(), p.name).toEqual(liens(p.name));
  });

  it('l’exemple ne donne de catégorie parente à aucune : l’étape n’en propose pas, et ce test le dit si l’exemple en gagne une', () => {
    expect(categories.filter((c) => c.parentId !== undefined)).toEqual([]);
  });

  it('une proposition ne porte que ce que l’exemple dit : son nom, sa nature, sa tirelire par défaut, ses flux', () => {
    const permis = new Set(['name', 'nature', 'tirelireName', 'flows']);
    for (const p of s.categories) for (const cle of Object.keys(p)) expect(permis, `${p.name} : ${cle}`).toContain(cle);
  });
});
