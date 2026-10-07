/**
 * Tests du codeur de #383, au niveau 4 (D83) ; l'auditeur a déplacé les autres dans son harnais,
 * `suite-la-nuit-harnais.test.mjs`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANCIEN_TITRE, MARQUE, TITRE, issueDeLaNuit } from './nuit.mjs';

test('[niveau 4] #383, point 4 · l’issue d’une nuit précédente encore ouverte, sous l’ancien titre, se complète', () => {
  assert.notEqual(TITRE, ANCIEN_TITRE);
  assert.equal(issueDeLaNuit([{ number: 4, title: ANCIEN_TITRE, body: MARQUE }, { number: 8, title: TITRE, body: MARQUE }]).number, 4);
});

