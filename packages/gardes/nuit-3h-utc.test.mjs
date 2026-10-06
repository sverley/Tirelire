/**
 * #348 · La nuit se déclenche une seule fois, à 3 h UTC. Tests du codeur, tous de niveau 4.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { RACINE } from './gardes.mjs';

const NUIT = readFileSync(join(RACINE, '.github/workflows/nuit.yml'), 'utf8').replace(/\r\n?/g, '\n');

/** Ce que vérifie le point 1 : la liste des déclenchements planifiés, et aucune dépendance au fuseau. */
const verifier = (w) => {
  assert.deepEqual([...w.matchAll(/^\s+- cron: '([^']*)'/gm)].map((m) => m[1]), ['0 3 * * *'], 'un seul déclenchement, à 3 h 00 UTC');
  assert.doesNotMatch(w, /github\.event\.schedule|TZ=|Europe\//, 'aucune exécution ne dépend du déclenchement ni d’un fuseau');
};

describe('[niveau 4] #348 · un seul déclenchement planifié, à 3 h 00 UTC', () => {
  test('point 1 et 2 : nuit.yml n’a qu’un cron, 0 3 * * *, et ne lit aucun fuseau', () => verifier(NUIT));

  test('point 3 : plus de job qui écarte un déclenchement ; le job navigateur joue sans condition d’heure, le lancement manuel demeure', () => {
    assert.doesNotMatch(NUIT, /needs\.heure|^\s{2}heure:/m);
    assert.match(NUIT, /^\s+workflow_dispatch:/m);
    assert.match(NUIT, /ref: main/);
  });

  test('point 6, témoin : la vérification rougit sur un workflow à deux déclenchements', () => {
    const deux = NUIT.replace("    - cron: '0 3 * * *'\n", "    - cron: '7 1 * * *'\n    - cron: '7 2 * * *'\n");
    assert.notEqual(deux, NUIT);
    assert.throws(() => verifier(deux));
    assert.throws(() => verifier(NUIT.replace("'0 3 * * *'", "'7 3 * * *'")), 'une autre heure rougit aussi');
  });

  test('point 5 : les textes disent « vers 3 h UTC », sans Paris ni deux déclenchements', () => {
    for (const f of ['docs/methodes.md', 'docs/roles/porteur.md', '.github/workflows/nuit.yml']) {
      const t = readFileSync(join(RACINE, f), 'utf8').replace(/\s+/g, ' ');
      assert.match(t, /vers 3 h UTC/, f);
      assert.doesNotMatch(t, /heure de Paris|3 h à Paris|deux déclenchements/, f);
    }
  });
});
