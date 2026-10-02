/**
 * Rien de dérivé sans raison (#197, point 5), vérifié par la garde (#314, point 6) : une colonne de la
 * table des opérations qui vaut, pour chaque opération importée, son libellé normalisé est dérivée ;
 * si le fichier la garde, `docs/decisions.md` la nomme. La garde lit tout le dépôt : ce test se rejoue
 * quand les décisions changent, et l'interface sans navigateur, où il vivait, ne lit plus `docs/`.
 *
 * Le test et son témoin rouge viennent du harnais d'audit de #197 (`apps/web/test/stockage-domaine.test.ts`),
 * à leur niveau, avec la même exigence. La mesure se fait par la sonde `colonnes-derivees.mjs`, qui
 * sème le fichier comme ce harnais ; le cœur, en TypeScript, s'y charge par
 * `--experimental-transform-types` (Node 22).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RACINE } from './gardes.mjs';

const DECISIONS = join(RACINE, 'docs/decisions.md');

/** Les colonnes dérivées gardées sans que les décisions les nomment, en `snake_case` ou en `camelCase`. */
function verifierRaisonEcrite(derivees, decisions) {
  const camel = (s) => s.replace(/_([a-z])/g, (_m, l) => l.toUpperCase());
  assert.deepEqual(derivees.filter((c) => !decisions.includes('`' + c + '`') && !decisions.includes('`' + camel(c) + '`')), [], 'des colonnes dérivées gardées sans raison écrite');
}

test('#197 · 5. une colonne d’operations qui se déduit du libellé n’est gardée qu’avec sa raison écrite dans les décisions [niveau 2]', () => {
  const ici = join(RACINE, 'packages/gardes');
  const sortie = execFileSync(process.execPath, ['--experimental-transform-types', '--no-warnings', '--import', './colonnes-derivees-crochet.mjs', 'colonnes-derivees.mjs'], { cwd: ici, encoding: 'utf8' });
  const { derivees, normalisables } = JSON.parse(sortie);
  assert.ok(normalisables, 'aucun libellé ne se normalise');
  verifierRaisonEcrite(derivees, readFileSync(DECISIONS, 'utf8'));
});

test('témoin rouge · une colonne dérivée gardée sans raison écrite [niveau 2]', () => {
  assert.throws(() => verifierRaisonEcrite(['normalized_label'], ''), /des colonnes dérivées gardées sans raison écrite/);
});
