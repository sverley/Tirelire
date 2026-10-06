/**
 * Test de développement de la garde (D81, #352, point 10) : l'étape `pnpm test`, `pnpm test N` ou
 * l'une d'elles suivie de `--complet` est l'étape des tests du workflow, et rien d'autre.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { etapeTestsStricte } from '../gardes.mjs';

const ci = (etape) => `name: CI\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n${etape}      - run: pnpm build\n`;
const strict = "        env:\n          TIRELIRE_STRICT: '1'\n";

describe('étape des tests de la CI', () => {
  test("[niveau 4] `--complet` après `pnpm test` ou `pnpm test N` reste l'étape des tests", () => {
    for (const commande of ['pnpm test --complet', ...[0, 1, 2, 3, 4].map((n) => `pnpm test ${n} --complet`)]) {
      assert.equal(etapeTestsStricte(ci(`      - run: ${commande}\n${strict}`)), true, commande);
      assert.equal(etapeTestsStricte(ci(`      - run: ${commande}\n`)), false, `${commande} sans TIRELIRE_STRICT`);
    }
  });

  test("[niveau 4] une autre option ou un autre argument n'est pas l'étape des tests", () => {
    for (const autre of [
      'pnpm test --autre',
      'pnpm test --complet --autre',
      'pnpm test --complet 3',
      'pnpm test 3 --complets',
      'pnpm test 5 --complet',
      'pnpm test 3 autre',
      'pnpm test --complet=1',
    ]) {
      assert.equal(etapeTestsStricte(ci(`      - run: ${autre}\n${strict}`)), false, autre);
    }
  });
});
