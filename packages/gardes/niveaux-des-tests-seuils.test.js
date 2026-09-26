/**
 * Second fichier du harnais de #232 (D81, forme normale) : ses tests de niveaux 2 et 3, découpés par
 * #243 du harnais de la garde `niveaux-des-tests.test.mjs`. Son extension `.test.js` le tient hors
 * des harnais de la garde (`packages/gardes/*.test.mjs`) ; les crochets et `node --test` le jouent
 * comme les autres fichiers de test du paquet.
 *
 * Ce qu'il vérifie, au niveau 2 — des cas de D83, l'usage restant possible s'ils tombaient, et la CI
 * rejouant au Ready ce qui décide de la fusion :
 *
 * - dans la garde et le cœur, sans seuil (2), aux seuils 0, 2, 3 et 4, et par l'appel nommé : les
 *   tests joués sont ceux du seuil, et ce qui est écarté se compte et se dit ; le seuil 1 de chaque
 *   ensemble reste au harnais de la garde ;
 * - l'option navigateur, acceptée par les paquets sans navigateur, n'y change rien ;
 * - les crochets, dans une copie du dépôt : le pré-commit au seuil 0, la livraison au seuil 2, le
 *   harnais du besoin en entier aux deux, un besoin fonctionnel qui fait jouer l'interface.
 *
 * Au niveau 3 : le budget de 5 s du pré-commit — dépassé, le résultat reste juste, obtenu moins bien.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DÉFAUT, NIVEAUX, NOMMÉ, PAQUETS, TOUT, attendus, constater, crochets, nettoyer, scénarios } from './niveaux-des-tests-outils.mjs';

/** Les lancements de ce fichier ; le seuil 1 est au harnais de la garde. */
const LANCEMENTS = ['garde', 'cœur'].flatMap((p) => [`${p}:défaut`, ...NIVEAUX.filter((s) => s !== 1).map((s) => `${p}:${s}`), `${p}:nommé`, `${p}:1+nav`]);

describe('[niveau 2] D83 · les seuils, l’appel nommé et l’option navigateur (#232)', () => {
  before(() => {
    for (const l of LANCEMENTS) scénarios[l]().catch(() => {});
    crochets().catch(() => {});
  });
  after(nettoyer);

  describe('le seuil et l’appel nommé, dans la garde et le cœur', () => {
    for (const paquet of ['garde', 'cœur']) {
      const exécuteur = PAQUETS[paquet].exécuteur === 'vitest' ? 'vitest' : 'node --test';
      test(`${paquet} (${exécuteur}) : sans seuil en entrée, le seuil est 2`, async () => {
        constater(await scénarios[`${paquet}:défaut`](), DÉFAUT, `${paquet}, \`pnpm test\` sans seuil`);
      });
      for (const s of NIVEAUX.filter((n) => n !== 1)) {
        test(`${paquet} (${exécuteur}) : au seuil ${s}, les tests de niveau ${s} ou moins`, async () => {
          constater(await scénarios[`${paquet}:${s}`](), s, `${paquet}, \`pnpm test ${s}\``);
        });
      }
      test(`${paquet} (${exécuteur}) : un test de niveau 4 appelé nommément se joue, seul`, async () => {
        const r = await scénarios[`${paquet}:nommé`]();
        assert.equal(r.code, 0, `${paquet}, appel nommé : le lancement échoue\n${r.sortie.slice(-2000)}`);
        assert.deepEqual(r.joués, ['n4'], `${paquet} : « n4 [niveau 4] », appelé par le filtre de nom de son exécuteur (motif « ${NOMMÉ} ») au seuil par défaut, se joue, et lui seul (#232, point 4)\n${r.sortie.slice(-1500)}`);
      });
    }
  });

  describe('l’option navigateur, dans les paquets sans navigateur', () => {
    for (const paquet of ['garde', 'cœur']) {
      test(`${paquet} : l’option navigateur est acceptée, et ne change rien d’autre`, async () => {
        constater(await scénarios[`${paquet}:1+nav`](), 1, `${paquet}, \`pnpm test 1 --navigateur\``);
      });
    }
  });

  describe('les crochets : pré-commit et livraison', () => {
    test('le pré-commit vérifie au seuil 0 les paquets touchés', async () => {
      const { préCommit: r } = await crochets();
      assert.equal(r.code, 0, `pré-commit refusé\n${r.sortie.slice(-2000)}`);
      assert.deepEqual(r.ancien, attendus(0), 'pré-commit : la non-régression du paquet touché se joue au seuil 0 (#232, point 5)');
    });

    test('le pré-commit tient dans son budget de 5 s [niveau 3]', async () => {
      const { préCommit: r } = await crochets();
      assert.ok(r.ms < 5000, `pré-commit : ${r.ms} ms, au-delà de son budget de 5 s (#232, point 5)`);
    });

    test('le pré-commit joue le harnais du besoin en entier, et les autres tests de la branche à leur niveau', async () => {
      const { préCommit: r } = await crochets();
      assert.deepEqual(r.nouveau, TOUT, 'pré-commit : le harnais du besoin — le fichier qui porte le numéro de l’issue — se joue en entier, niveau 4 compris (#232, point 9)');
      assert.deepEqual(r.codeur, attendus(0), 'pré-commit : un autre fichier de test que la branche ajoute n’est pas le harnais du besoin ; il se joue à son niveau, au seuil 0 (#232, point 9)');
    });

    test('la livraison vérifie au seuil 2, et joue le harnais du besoin en entier, lui seul', async () => {
      const { livraison: r } = await crochets();
      assert.equal(r.code, 0, `livraison (pré-push) refusée\n${r.sortie.slice(-2000)}`);
      assert.deepEqual(r.ancien, attendus(2), 'livraison : la non-régression se joue au seuil 2 (#232, point 6)');
      assert.deepEqual(r.nouveau, TOUT, 'livraison : le harnais du besoin — le fichier qui porte le numéro de l’issue — se joue en entier, niveau 4 compris (#232, point 9)');
      assert.deepEqual(r.codeur, attendus(2), 'livraison : un autre fichier de test que la branche ajoute n’est pas le harnais du besoin ; il se joue à son niveau, au seuil 2 (#232, point 9)');
    });

    test('la livraison d’un besoin fonctionnel vérifie l’interface au seuil 2, tests navigateur compris quand un navigateur est là', async () => {
      const { fonctionnel: r } = await crochets();
      assert.equal(r.code, 0, `livraison (pré-push) d'un besoin fonctionnel refusée\n${r.sortie.slice(-2000)}`);
      assert.deepEqual(r.web, attendus(2), 'livraison : les tests headless de l’interface se jouent au seuil 2 (#232, point 6)');
      if (r.nav.length) assert.deepEqual(r.nav, attendus(2), 'livraison : avec un navigateur, les tests navigateur se jouent au seuil 2 (#232, point 6)');
      else assert.ok(r.sortie.split('\n').some((l) => /navigateur/i.test(l)), `livraison : sans navigateur, elle le dit et laisse les tests navigateur à la CI (#232, point 6)\n${r.sortie.slice(-1500)}`);
    });
  });
});
