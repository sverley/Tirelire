/**
 * Harnais d'audit de #212 — points 8 et 9, côté texte des décisions (`docs/decisions.md`), lu tel qu'il est écrit.
 *
 * Point 8 : D40 ne range plus les catégories dans ce que l'assistant ne couvre pas volontairement ; le test échoue si
 * la liste de ce que l'assistant renvoie vers Configuration reprend les catégories, ou si D40 ne dit plus que
 * l'assistant les propose. Retenu parmi les tests du codeur (`packages/core/test/assistant-categories-decision.test.ts`,
 * d'où il est déplacé, ici et réécrit en `node:test`).
 *
 * Point 9 (ajouté par l'auditeur) : D61 dit que l'assistant tient la règle des noms, et ne dit plus que « seuls ces
 * trois écrans » (Catégories, Opérations, Saisie) la tiennent. Test écrit par l'auditeur.
 *
 * Niveau 2 (D83) : le besoin couvert est une décision et son énoncé ; un énoncé que le code contredit (D40 range
 * encore les catégories parmi ce que l'assistant ne couvre pas ; D61 compte trois écrans quand l'assistant est le
 * quatrième) en est un cas faux, l'usage restant possible.
 *
 * Dans la garde, non dans le cœur : l'ensemble de la garde lit tout le dépôt, `docs/decisions.md` compris, et se rejoue
 * quand une décision change ; un test du cœur qui lit ce fichier ne se rejoue pas pour un changement de `docs/` seul
 * (D83, « Les empreintes »). Constaté dans le cœur : avec D61 remise à son ancien texte, le lancement sautait le test,
 * « vert sur son empreinte ».
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { RACINE } from './gardes.mjs';

const decisions = readFileSync(join(RACINE, 'docs/decisions.md'), 'utf8');

/** Le texte d'une décision : de son titre au titre suivant, retours à la ligne comptés pour des espaces. */
function decision(numero) {
  const debut = decisions.indexOf(`### D${numero} ·`);
  assert.ok(debut >= 0, `le titre de D${numero} est introuvable`);
  const suite = decisions.slice(debut + 1).search(/\n#{2,3} /);
  assert.ok(suite > 0, `D${numero} n’est suivie d’aucun titre`);
  return decisions.slice(debut, debut + 1 + suite).replace(/\s+/g, ' ');
}

describe('#212 · 8 — D40 et les catégories', () => {
  test('ce que l’assistant ne couvre pas volontairement ne contient plus les catégories [niveau 2]', () => {
    const liste = /ne couvre pas volontairement \(([^)]*)\)/.exec(decision(40));
    assert.ok(liste, 'D40 ne donne plus la liste de ce que l’assistant ne couvre pas volontairement');
    assert.ok(!liste[1].toLowerCase().includes('catégories'), `D40 range encore les catégories parmi ce que l’assistant ne couvre pas : (${liste[1]})`);
  });

  test('D40 dit que l’assistant propose les catégories de l’exemple, avec leur tirelire par défaut et les flux qui les portent, et qu’une catégorie se garde sans tirelire [niveau 2]', () => {
    const d40 = decision(40);
    assert.match(d40, /propose[^.]*les catégories de l'exemple/);
    assert.ok(d40.includes('tirelire par défaut (D32)'), 'D40 ne dit plus « tirelire par défaut (D32) »');
    assert.ok(d40.includes('les flux qui les portent'), 'D40 ne dit plus « les flux qui les portent »');
    assert.ok(d40.includes('une catégorie se garde sans tirelire (I3)'), 'D40 ne dit plus « une catégorie se garde sans tirelire (I3) »');
  });
});

describe('#212 · 9 — D61 et l’assistant', () => {
  test('D61 ne dit plus que seuls les écrans Catégories, Opérations et Saisie tiennent la règle des noms, et dit que l’assistant la tient [niveau 2]', () => {
    const d61 = decision(61);
    assert.doesNotMatch(d61, /seuls ces trois écrans/);
    assert.match(d61, /assistant/i);
  });
});
