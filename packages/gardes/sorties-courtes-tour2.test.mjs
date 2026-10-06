/** Tests du codeur de #352, tour 2 (retours de l'auditeur), tous de niveau 4. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ligneDEnsemble } from './echecs.mjs';

describe('[niveau 4] #352, tour 2 · la ligne d’un ensemble au bilan d’un crochet', () => {
  test('[niveau 4] point 1 · un cas long tient en 160 caractères, comptes entiers', () => {
    const comptes = '12 joué(s), 30 sauté(s) (18 attesté(s) vert(s), 12 base commune avec main)';
    const l = ligneDEnsemble('pré-fusion', 'interface sans navigateur', "joué au seuil 2 : vert, mais son rapport ne se lit pas, donc pas compté vert sur son empreinte", comptes);
    assert.ok(l.length <= 160, `${l.length} : ${l}`);
    assert.ok(l.endsWith(` — ${comptes}.`), l);
    assert.equal(ligneDEnsemble('demande', 'garde', 'joué au seuil 2 : vert', '1 joué(s), 0 sauté(s)'), 'demande : garde : joué au seuil 2 : vert — 1 joué(s), 0 sauté(s).');
    assert.equal(ligneDEnsemble('demande', 'garde', 'non joué — x', ''), 'demande : garde : non joué — x.', 'sans comptes, la ligne reste celle d’avant');
  });
});
