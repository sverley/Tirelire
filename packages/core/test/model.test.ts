import { describe, expect, it } from 'vitest';
import { findCategoryByName, type Category } from '../src/index.js';

const categories: Category[] = [
  { id: 'c1', name: 'Santé', nature: 'expense' },
  { id: 'c2', name: 'Salaire', nature: 'income' },
  { id: 'c3', name: 'Ancienne', nature: 'expense', deletedAt: '2026-01-01T00:00:00.000Z' },
];

/**
 * `findCategoryByName` évite une catégorie en double quand on en crée une à la volée (écrans
 * Opérations, Saisie, Catégories). Aucun document fondateur n'écrit ce besoin : la question est posée
 * au porteur dans la PR de #245 — l'écrire, ou retirer le code et ce test par une nouvelle issue.
 */
describe('[niveau 2] findCategoryByName : une catégorie créée à la volée retrouve celle qui porte déjà son nom', () => {
  it('retrouve une catégorie existante malgré la casse et les accents', () => {
    expect(findCategoryByName(categories, 'sante', 'expense')?.id).toBe('c1');
    expect(findCategoryByName(categories, '  SANTÉ  ', 'expense')?.id).toBe('c1');
  });

  it('ne mélange pas les natures', () => {
    expect(findCategoryByName(categories, 'Santé', 'income')).toBeUndefined();
  });

  it('ignore les catégories supprimées', () => {
    expect(findCategoryByName(categories, 'Ancienne', 'expense')).toBeUndefined();
  });

  it("ne renvoie rien pour un nom vide", () => {
    expect(findCategoryByName(categories, '   ', 'expense')).toBeUndefined();
  });
});
