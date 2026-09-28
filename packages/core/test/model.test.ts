import { describe, expect, it } from 'vitest';
import { findCategoryByName, type Category } from '../src/index.js';

const categories: Category[] = [
  { id: 'c1', name: 'Santé', nature: 'expense' },
  { id: 'c2', name: 'Salaire', nature: 'income' },
  { id: 'c3', name: 'Ancienne', nature: 'expense', deletedAt: '2026-01-01T00:00:00.000Z' },
];

/**
 * D61 : parmi les catégories vivantes d'une même nature, deux ne portent pas le même nom, comparé
 * sans tenir compte de la casse, des accents ni des espaces autour. Niveau 0 (D83) : un doublon que
 * la recherche manque s'écrit dans la base, et y reste une fois le code corrigé.
 */
describe('[niveau 0] D61 · deux catégories d’une même nature ne portent pas le même nom', () => {
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
