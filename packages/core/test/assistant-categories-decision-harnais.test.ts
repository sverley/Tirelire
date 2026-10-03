/**
 * Harnais d'audit de #212 — point 8 : la décision D40 (`docs/decisions.md`) ne range plus les catégories dans ce
 * que l'assistant ne couvre pas volontairement. C'est un texte, lu tel qu'il est écrit : le test échoue si la liste
 * de ce que l'assistant renvoie vers Configuration reprend les catégories, ou si D40 ne dit plus que l'assistant les
 * propose. Retenu parmi les tests du codeur (`assistant-categories-decision.test.ts`, d'où il est déplacé).
 *
 * Niveau 2 (D83) : le besoin couvert est une décision, D40, et son énoncé ; un énoncé qui range encore les
 * catégories parmi ce que l'assistant ne couvre pas en est un cas faux, l'usage restant possible.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const decisions = readFileSync(new URL('../../../docs/decisions.md', import.meta.url), 'utf8');
/** Le texte de D40 : de son titre à celui de D41, retours à la ligne comptés pour des espaces. */
const d40 = (() => {
  const debut = decisions.indexOf('### D40 ·');
  const fin = decisions.indexOf('### D41 ·');
  expect(debut, 'le titre de D40 est introuvable').toBeGreaterThanOrEqual(0);
  expect(fin, 'le titre de D41 est introuvable').toBeGreaterThan(debut);
  return decisions.slice(debut, fin).replace(/\s+/g, ' ');
})();

describe('[niveau 2] #212 · 8 — D40 et les catégories', () => {
  it('ce que l’assistant ne couvre pas volontairement ne contient plus les catégories', () => {
    const liste = /ne couvre pas volontairement \(([^)]*)\)/.exec(d40);
    expect(liste, 'D40 ne donne plus la liste de ce que l’assistant ne couvre pas volontairement').not.toBeNull();
    expect(liste![1]!.toLowerCase()).not.toContain('catégories');
  });

  it('D40 dit que l’assistant propose les catégories de l’exemple, avec leur tirelire par défaut et les flux qui les portent, et qu’une catégorie se garde sans tirelire', () => {
    expect(d40).toMatch(/propose[^.]*les catégories de l'exemple/);
    expect(d40).toContain('tirelire par défaut (D32)');
    expect(d40).toContain('les flux qui les portent');
    expect(d40).toContain('une catégorie se garde sans tirelire (I3)');
  });
});
