/**
 * Règles des harnais (#232, D81) : tout test d'un harnais de la garde ou du registre est de niveau 0
 * ou 1, témoins compris — joué à chaque fusion. Portée : une ligne `Harnais` qui nomme un test porte
 * sur ce test, sa suite et son témoin ; une ligne qui cite un fichier, sur tout le fichier ; un
 * fichier de test de la garde, sur tout le fichier. La lecture des niveaux se vérifie ici aussi : le
 * lanceur et la règle s'appuient sur elle.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { RACINE, fichiersDuDepot } from './gardes.mjs';
import { lireSeuil, motifDuSeuil, niveauxDuFichier, niveauxHorsDesHarnais } from './niveaux.mjs';

const lireDepot = (chemin) => {
  try {
    return readFileSync(join(RACINE, chemin), 'utf8');
  } catch {
    return null;
  }
};

/** Un registre d'une entrée, dont la ligne `Harnais` cite `chemin` et, s'il est donné, nomme `nom`. */
const registre = (chemin, nom, temoin = 'témoin rouge · t') =>
  `## I1 · Essai\n\n- **Harnais** · \`${chemin}\` — ${nom ? `« ${nom} » : ` : ''}ce qu'il garde.\n  Témoin rouge : « ${temoin} »\n`;

const regle = (fichiers, reg = '') => niveauxHorsDesHarnais({ registre: reg, fichiers: Object.keys(fichiers), lireFichier: (c) => fichiers[c] ?? null });

describe('[niveau 1] règles des harnais (#232)', () => {
  test('le niveau se lit dans le fichier : marque du test, sinon de la suite la plus proche, sinon 2', () => {
    const lus = niveauxDuFichier(`
      test('a', () => {});
      test('[niveau 0] b', () => {});
      describe('[niveau 4] s', () => {
        it('c', () => {});
        describe('t', () => { it('[niveau 3] d', () => {}); it('e', () => {}); });
      });
    `);
    const niveau = Object.fromEntries(lus.filter((l) => !l.suite).map((l) => [l.titre, l.niveau]));
    assert.deepEqual(niveau, { a: 2, '[niveau 0] b': 0, c: 4, '[niveau 3] d': 3, e: 4 });
  });

  test('le seuil est le premier argument, 2 sans entrée, et son motif garde la marque la plus proche', () => {
    assert.deepEqual(lireSeuil(['1', 'x']), { seuil: 1, reste: ['x'] });
    assert.deepEqual(lireSeuil(['x']), { seuil: 2, reste: ['x'] });
    const joue = (seuil, nom) => new RegExp(motifDuSeuil(seuil)).test(nom);
    assert.equal(joue(1, 'suite [niveau 4] s [niveau 1] t'), true);
    assert.equal(joue(1, 'suite [niveau 1] s t'), true);
    assert.equal(joue(1, 'suite t'), false);
    assert.equal(joue(2, 'suite t'), true);
    assert.equal(joue(2, '[niveau 1] s [niveau 3] t'), false);
  });

  test('tout test d’un harnais de la garde ou du registre est de niveau 0 ou 1', () => {
    assert.deepEqual(niveauxHorsDesHarnais({ registre: lireDepot('docs/gardes.md'), fichiers: fichiersDuDepot(), lireFichier: lireDepot }), []);
  });

  test('témoin vert · la portée nommée ne s’étend pas aux voisins', () => {
    const source = `describe('[niveau 1]', () => { describe('n', () => { it('x', () => {}); }); });\nit('[niveau 1] témoin rouge · t', () => {});\nit('voisin', () => {});\n`;
    assert.deepEqual(regle({ 'a/x.test.ts': source }, registre('a/x.test.ts', 'n')), []);
  });

  test('témoin rouge · un test de la garde sans marque, donc de niveau 2', () => {
    const r = regle({ 'packages/gardes/x.test.mjs': "test('sans marque', () => {});\n" });
    assert.match(r.join('\n'), /packages\/gardes\/x\.test\.mjs : « sans marque » est de niveau 2/);
  });

  test('témoin rouge · une suite nommée au registre qui contient un test de niveau 4', () => {
    const source = `describe('[niveau 1]', () => { describe('n', () => { it('[niveau 4] diagnostic', () => {}); }); });\nit('[niveau 1] témoin rouge · t', () => {});\n`;
    assert.match(regle({ 'a/x.test.ts': source }, registre('a/x.test.ts', 'n')).join('\n'), /« \[niveau 4\] diagnostic » est de niveau 4/);
  });

  test('témoin rouge · un témoin nommé au registre laissé au niveau 2', () => {
    const source = `describe('[niveau 1]', () => { describe('n', () => { it('x', () => {}); }); });\nit('témoin rouge · t', () => {});\n`;
    assert.match(regle({ 'a/x.test.ts': source }, registre('a/x.test.ts', 'n')).join('\n'), /« témoin rouge · t » est de niveau 2/);
  });

  test('témoin rouge · un fichier cité sans nom, dont un test est de niveau 3', () => {
    const source = `describe('[niveau 1] tout', () => { it('x', () => {}); it('[niveau 3] y', () => {}); });\n`;
    assert.match(regle({ 'a/x.test.ts': source }, registre('a/x.test.ts', null)).join('\n'), /« \[niveau 3\] y » est de niveau 3/);
  });
});
