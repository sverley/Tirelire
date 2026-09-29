/**
 * Harnais d'audit de #246, composé par #285 parmi les tests du codeur (D83) : un test qui porte
 * sa propre marque est retenu à ce niveau ; les autres restent au niveau 4.
 *
 * #236, point 8 de #246 : sur tout le dépôt, chaque test porte sa marque de niveau, `[niveau N]`,
 * sur lui ou sur une suite qui l'englobe (D83).
 *
 * Ce n'est pas un test de la garde (D81 : « ses trois vérifications et la règle des harnais ») : il
 * appartient au codeur qui l'a écrit, tant qu'un auditeur ne le retient pas dans un harnais, et se
 * joue par `pnpm test` à son niveau.
 *
 * Le besoin couvert (D83) : « chaque test porte sa marque ». S'il cesse d'être tenu sans que
 * personne le voie, un test sans marque est lu au niveau 2 : s'il garde un invariant ou un usage,
 * il quitte le seuil 1 du Ready, et un rouge ne se découvre qu'après la fusion (principe 10.1).
 *
 * Les fichiers lus sont ceux que les ensembles jouent — `*.test.*` du cœur, de l'interface (headless
 * et navigateur), de la garde, du relais et de l'hébergement — et les tests de développement de la
 * garde (`packages/gardes/dev/*.dev.mjs`, D81), suivis ou nouveaux, tels que la copie de travail
 * les porte. Le niveau s'y lit sans exécuter (D83) : un titre calculé ne compte que par ce qu'il
 * écrit en toutes lettres.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { RACINE, appelsDeTests, fichiersDuDepot } from './gardes.mjs';
import { niveauDuTitre } from './niveaux.mjs';

const FICHIER_DE_TEST = /(?:^|\/)[^/]+\.test\.[cm]?[jt]sx?$|^packages\/gardes\/dev\/[^/]+\.dev\.mjs$/;

/**
 * Texte d'un titre tel qu'il est écrit : sa valeur pour une chaîne ; pour un gabarit, ses parties
 * écrites en toutes lettres, où ce que `${…}` calcule devient « … » ; `''` pour une expression.
 */
function titreEcrit(source, appel) {
  if (appel.titre !== null) return appel.titre;
  const m = source.slice(appel.ouvrante + 1).match(/^\s*`((?:[^`\\]|\\[\s\S])*)`/);
  return m ? m[1].replace(/\$\{[^}]*\}/g, '…').replace(/\s+/g, ' ').trim() : '';
}

/** Tests d'une source sans marque, ni sur eux ni sur une suite qui les englobe : leurs titres. */
function testsSansMarque(source) {
  return appelsDeTests(source)
    .filter((a) => !a.suite)
    .filter((a) => [a, ...a.englobantes].every((b) => niveauDuTitre(titreEcrit(source, b)) === null))
    .map((a) => [...a.englobantes, a].map((b) => titreEcrit(source, b) || '(titre calculé)').join(' › '));
}

const fichiersDeTest = () => fichiersDuDepot(RACINE).filter((f) => FICHIER_DE_TEST.test(f));

describe('[niveau 4] #236 point 1, D83 · chaque test du dépôt porte sa marque de niveau, sur lui ou sur une suite qui l’englobe', () => {
  test('[niveau 1] aucun test du dépôt n’est sans marque', () => {
    const sans = fichiersDeTest().flatMap((f) => testsSansMarque(readFileSync(join(RACINE, f), 'utf8')).map((t) => `${f} : ${t}`));
    assert.deepEqual(
      sans,
      [],
      `${sans.length} test(s) sans marque [niveau N], ni sur eux ni sur une suite qui les englobe. D83 : chaque test porte sa marque, choisie par la suite de questions.`,
    );
  });

  test('les fichiers lus couvrent chaque ensemble : cœur, interface headless et navigateur, garde, relais, hébergement', () => {
    const fichiers = fichiersDeTest();
    for (const dossier of ['packages/core/test/', 'apps/web/test/', 'apps/web/test/navigateur/', 'packages/gardes/', 'apps/relay/', 'apps/hebergement/']) {
      assert.ok(fichiers.some((f) => f.startsWith(dossier)), `aucun fichier de test lu sous ${dossier}`);
    }
    assert.ok(fichiers.includes('packages/gardes/marques-des-tests.test.mjs'), 'ce fichier ne se lit pas lui-même');
    assert.ok(fichiers.every((f) => !f.includes('node_modules/')));
  });

  test('témoin rouge · un test sans marque, hors de toute suite ou dans une suite qui n’en porte pas, se voit', () => {
    const source = [
      "import { describe, it, test } from 'vitest';",
      "test('seul', () => {});",
      "describe('suite', () => { it('dedans', () => {}); });",
      "describe('[niveau 1] marquée', () => { test('gardé', () => {}); });",
    ].join('\n');
    assert.deepEqual(testsSansMarque(source), ['seul', 'suite › dedans']);
  });

  test('témoin rouge · une suite qui perd sa marque rend visibles tous les tests qu’elle englobait', () => {
    const avec = "describe('[niveau 0] a', () => { describe('b', () => { test('c', () => {}); test.todo('d'); }); });";
    assert.deepEqual(testsSansMarque(avec), []);
    assert.deepEqual(testsSansMarque(avec.replace('[niveau 0] ', '')), ['a › b › c', 'a › b › d']);
  });

  test('témoin rouge · un titre calculé ne compte que par ce qu’il écrit en toutes lettres', () => {
    const source = [
      'for (const n of noms) test(n, () => {});',
      'test(`${n} [niveau ${k}]`, () => {});',
      "test.each([1, 2])('cas %i', () => {});",
    ].join('\n');
    assert.deepEqual(testsSansMarque(source), ['(titre calculé)', '… [niveau …]', 'cas %i']);
  });

  test('témoin vert · la marque se lit sur le test, sur une suite lointaine, dans un gabarit, et sur un test répété', () => {
    const source = [
      "test('a [niveau 3]', () => {});",
      "describe('[niveau 2] loin', () => { describe('près', () => { it('b', () => {}); it.skip('c', () => {}); }); });",
      'for (const n of noms) test(`[niveau 4] ${n}`, () => {});',
      "test.each([1, 2])('cas %i [niveau 0]', () => {});",
      "// test('commenté', () => {});",
    ].join('\n');
    assert.deepEqual(testsSansMarque(source), []);
  });
});
