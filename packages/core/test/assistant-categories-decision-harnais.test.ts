/**
 * Harnais d'audit de #212 — points 8 et 9, côté texte des décisions (`docs/decisions.md`), lu tel qu'il est écrit.
 *
 * Point 8 : D40 ne range plus les catégories dans ce que l'assistant ne couvre pas volontairement ; le test échoue si
 * la liste de ce que l'assistant renvoie vers Configuration reprend les catégories, ou si D40 ne dit plus que
 * l'assistant les propose. Retenu parmi les tests du codeur (`assistant-categories-decision.test.ts`, d'où il est
 * déplacé).
 *
 * Point 9 (ajouté par l'auditeur) : D61 dit que l'assistant tient la règle des noms, et ne dit plus que « seuls ces
 * trois écrans » (Catégories, Opérations, Saisie) la tiennent. Test écrit par l'auditeur.
 *
 * Niveau 2 (D83) : le besoin couvert est une décision et son énoncé ; un énoncé que le code contredit (D40 range
 * encore les catégories parmi ce que l'assistant ne couvre pas ; D61 compte trois écrans quand l'assistant est le
 * quatrième) en est un cas faux, l'usage restant possible.
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

/** Le texte de D61 : de son titre au titre suivant, retours à la ligne comptés pour des espaces. */
const d61 = (() => {
  const debut = decisions.indexOf('### D61 ·');
  expect(debut, 'le titre de D61 est introuvable').toBeGreaterThanOrEqual(0);
  const suite = decisions.slice(debut + 1).search(/\n#{2,3} /);
  expect(suite, 'D61 n’est suivie d’aucun titre').toBeGreaterThan(0);
  return decisions.slice(debut, debut + 1 + suite).replace(/\s+/g, ' ');
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

describe('[niveau 2] #212 · 9 — D61 et l’assistant', () => {
  it('D61 ne dit plus que seuls les écrans Catégories, Opérations et Saisie tiennent la règle des noms, et dit que l’assistant la tient', () => {
    expect(d61).not.toMatch(/seuls ces trois écrans/);
    expect(d61).toMatch(/assistant/i);
  });
});
