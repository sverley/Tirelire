import { describe, expect, it } from 'vitest';
import { emptyLedger, findCategoryByName, LEDGER_KEYS, type Category } from '../src/index.js';

const categories: Category[] = [
  { id: 'c1', name: 'Santé', nature: 'expense' },
  { id: 'c2', name: 'Salaire', nature: 'income' },
  { id: 'c3', name: 'Ancienne', nature: 'expense', deletedAt: '2026-01-01T00:00:00.000Z' },
];

describe('findCategoryByName', () => {
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

describe('LEDGER_KEYS', () => {
  it('couvre toutes les tables du grand livre', () => {
    // Ce que recopie `replaceWith` (charger l'exemple, importer un jeu de démonstration) est
    // parcouru depuis cette liste : si une table du modèle n'y figure pas, elle est perdue.
    const tables = Object.keys(emptyLedger()).filter((k) => k !== 'settings');
    expect([...LEDGER_KEYS].sort()).toEqual(tables.sort());
  });
});
