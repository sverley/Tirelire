/**
 * Harnais d'audit de #232 : chaque test a un niveau, qui dit le risque pris à ne pas le jouer ; les
 * règles des harnais sont gardées. Écrit par l'auditeur de #232, découpé par #243.
 *
 * **Le contrat** (D83). Un test porte son niveau, de 0 à 4, par la marque `[niveau N]` dans son
 * titre, sinon dans celui de la suite la plus proche qui l'englobe ; sans marque, il est de niveau 2.
 * L'outil de test prend un seuil en entrée (`pnpm test [N]`, 2 sans entrée) et ne joue que les tests
 * de niveau N ou moins ; les tests navigateur ne se jouent qu'avec l'option `--navigateur`.
 *
 * **Ce que ce fichier garde, au niveau 1** — ce qui, s'il cessait de tenir sans que personne le
 * voie, laisserait tomber une promesse :
 *
 * - la règle des harnais (D81) : tout test d'un harnais de la garde ou du registre est de niveau 0
 *   ou 1, donc joué à chaque fusion, avec ses témoins rouges ;
 * - le seuil 1 de la CI au Ready (D83, principe 10.1) : dans chaque ensemble, au seuil 1, les tests
 *   de niveau 0 et 1 se jouent, et eux seuls ; avec l'option, les tests navigateur aussi ; `ci.yml`,
 *   joué à blanc, vérifie au seuil 1, active les tests navigateur au seuil 2, joue le harnais du
 *   besoin dans une étape bloquante, et ne publie qu'après le seuil 3 au tag `v*`.
 *
 * **Ce qui est ailleurs** (#243) : les autres seuils, l'appel nommé, l'option navigateur sur les
 * paquets sans navigateur et les crochets (pré-commit, livraison) sont des cas de D83, de niveau 2
 * — le budget du pré-commit, de niveau 3. Ils vivent dans `niveaux-des-tests-seuils.test.js`, hors
 * des harnais de la garde (D81), et se jouent à la livraison et à la vérification de l'auditeur :
 * la CI rejoue au Ready ce qui en décide, et la copie du dépôt que rejouent les crochets coûtait à
 * elle seule la plus grande part de la durée de ce fichier au seuil 1.
 *
 * Les outils (lecture des niveaux, fichier inventé, lancements, CI à blanc) sont dans
 * `niveaux-des-tests-outils.mjs`, partagé par les deux fichiers. `node:test` n'a pas de
 * `test.fails` : l'échec attendu d'un témoin tient dans une assertion (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  CI,
  FIXTURE,
  NAVIGATEUR_ÉCRITS,
  PAQUETS,
  attendus,
  auReady,
  auTag,
  commande,
  constater,
  déplier,
  harnais,
  jouer,
  laisseÉchouer,
  lire,
  manquements,
  nettoyer,
  niveauxDesTests,
  publie,
  scénarios,
  source,
  étapesDeTests,
} from './niveaux-des-tests-outils.mjs';

/** Les lancements de ce fichier : le seuil 1 dans chaque ensemble, et l'interface avec l'option. */
const LANCEMENTS = [...Object.keys(PAQUETS).map((p) => `${p}:1`), 'interface:1+nav'];

describe('[niveau 1] D81 · règle des harnais : ceux de la garde et du registre ne portent que les niveaux 0 et 1 (#232)', () => {
  test('le niveau se lit dans le fichier : marque du test, sinon de la suite qui l’englobe, sinon 2', () => {
    const lus = Object.fromEntries(niveauxDesTests(source('node', 'lecture')).filter((t) => !t.suite).map((t) => [t.titre.split(' ')[0], t.niveau]));
    assert.deepEqual(lus, Object.fromEntries(FIXTURE.map((t) => [t.id, t.niveau])));
  });

  test('tout test d’un harnais de la garde ou du registre est de niveau 0 ou 1', () => {
    const liste = harnais();
    assert.ok(liste.some((h) => h.source !== 'garde'), 'aucun harnais du registre trouvé : le harnais de #232 est à relire');
    const m = [...new Set(liste.flatMap((h) => manquements(lire(h.fichier), h)))];
    assert.deepEqual(m, [], `règle des harnais (#232, point 10) :\n${m.join('\n')}`);
  });

  const gardé = `
describe('garde [niveau 1]', () => {
  it('tient', () => {});
  it('témoin rouge · casse', () => {});
  it('irréparable [niveau 0]', () => {});
});
test('rétrocompatibilité [niveau 3]', () => {});
`;

  test('témoin vert · un harnais en niveaux 0 et 1, et un test hors de la portée nommée', () => {
    assert.deepEqual(manquements(gardé.replace(/test\('rétro[^\n]*\n/, ''), { fichier: 'vert' }), []);
    assert.deepEqual(manquements(gardé, { fichier: 'vert', noms: ['tient', 'témoin rouge · casse'] }), []);
  });

  test('témoin rouge · un test de la garde sans marque, donc de niveau 2', () => {
    assert.equal(manquements(`${gardé.replace(/test\('rétro[^\n]*\n/, '')}\ntest('oublié', () => {});`, { fichier: 'rouge' }).length, 1);
  });

  test('témoin rouge · un test de niveau 3 dans un fichier de la garde', () => {
    assert.equal(manquements(gardé, { fichier: 'rouge' }).length, 1);
  });

  test('témoin rouge · un test nommé au registre dont le témoin est de niveau 2', () => {
    const source = `${gardé}\ntest('témoin rouge · hors de la suite', () => {});`;
    assert.equal(manquements(source, { fichier: 'rouge', noms: ['tient', 'témoin rouge · hors de la suite'] }).length, 1);
  });

  test('témoin rouge · une suite nommée au registre qui contient un test de niveau 4', () => {
    const source = gardé.replace("it('tient', () => {});", "it('tient', () => {});\n  it('trace [niveau 4]', () => {});");
    assert.equal(manquements(source, { fichier: 'rouge', noms: ['garde [niveau 1]'] }).length, 1);
  });
});

describe('[niveau 1] D83, principe 10.1 · au Ready, la CI joue tout ce qui garde une promesse (#232)', () => {
  // Tout part d'avance ; chaque test attend le sien, et un lancement en échec ne rougit que ses tests.
  before(() => {
    for (const l of LANCEMENTS) scénarios[l]().catch(() => {});
  });
  after(nettoyer);

  for (const [paquet, { exécuteur }] of Object.entries(PAQUETS)) {
    if (paquet === 'interface') continue;
    const nom = exécuteur === 'vitest' ? 'vitest' : 'node --test';
    test(`${paquet} (${nom}) : au seuil 1, les tests de niveau 1 ou moins`, async () => {
      constater(await scénarios[`${paquet}:1`](), 1, `${paquet}, \`pnpm test 1\``);
    });
  }

  test('interface (vitest) : sans l’option, les tests navigateur sont écartés, et la sortie dit ce qu’elle compte', async () => {
    const r = await scénarios['interface:1']();
    assert.equal(r.code, 0, `interface, \`pnpm test 1\` : le lancement échoue\n${r.sortie.slice(-2000)}`);
    assert.deepEqual(r.joués, attendus(1), 'interface headless : au seuil 1, seuls les tests de niveau 1 ou moins (#232, points 1 et 3)');
    assert.deepEqual(r.navigateur, [], 'interface dans le navigateur : sans `--navigateur`, aucun test navigateur ne se joue (#232, point 3)');
    const lignes = r.sortie.split('\n');
    assert.ok(lignes.some((l) => /navigateur/i.test(l) && /écart/i.test(l)), `interface : sans \`--navigateur\`, la sortie dit que les tests navigateur sont écartés (#232, point 3)\n${r.sortie.slice(-1500)}`);
    // La ligne dit ce qu'elle compte : des fichiers et des tests écrits, sans les exécuter ; la
    // boucle compte pour un. Qu'elle ne présente pas ce nombre comme celui des tests exécutés reste
    // à la relecture.
    assert.ok(
      lignes.some((l) => /navigateur/i.test(l) && /écart/i.test(l) && /fichier/i.test(l) && /écrit/i.test(l) && new RegExp(`(?<!\\d)${NAVIGATEUR_ÉCRITS}(?!\\d)`).test(l)),
      `interface : sans \`--navigateur\`, la ligne dit ce qu'elle compte — des fichiers et des tests écrits : ici ${NAVIGATEUR_ÉCRITS} tests écrits, la boucle comptant pour un (#232, point 3)\n${lignes.filter((l) => /navigateur/i.test(l)).join('\n')}`,
    );
  });

  test('interface (vitest) : avec l’option, les tests navigateur se jouent au seuil', async () => {
    const r = await scénarios['interface:1+nav']();
    constater(r, 1, 'interface, `pnpm test 1 --navigateur`');
    assert.deepEqual(r.navigateur, [...attendus(1), 'b1', 'b2'].sort(), 'interface dans le navigateur : avec `--navigateur`, au seuil 1, seuls les tests de niveau 1 ou moins (#232, points 1 et 3)');
  });

  test('témoin rouge · un seuil 1 qui laisse de côté un test de niveau 0 ou 1 fait échouer le constat', () => {
    for (const oublié of attendus(1)) {
      const joués = attendus(1).filter((id) => id !== oublié);
      const écartés = FIXTURE.length - joués.length;
      const r = { code: 0, joués, fichiers: 1, sortie: `seuil 1 : ${écartés} test(s) écarté(s), de niveau supérieur à 1.` };
      assert.throws(() => constater(r, 1, 'témoin'), /seuls les tests de niveau 1 ou moins/, `« ${oublié} » laissé de côté au seuil 1 passerait inaperçu`);
    }
  });

  // La CI, jouée à blanc.

  test('au Ready, la CI vérifie au seuil 1, et active les tests navigateur au seuil 2', () => {
    const tests = étapesDeTests(lire(CI), auReady);
    const suite = tests.filter((t) => !t.navigateur);
    assert.ok(suite.length, `${CI} : aucune étape ne joue les tests au passage en Ready`);
    for (const t of suite) assert.equal(t.seuil, 1, `${CI} : au Ready, « ${t.job.nom} » joue les tests au seuil ${t.seuil}, attendu 1 (#232, point 7)`);
    const navigateur = tests.filter((t) => t.navigateur && t.seuil === 2 && !laisseÉchouer(t.job, t.é));
    assert.ok(navigateur.length, `${CI} : au Ready, aucune étape bloquante n'active les tests navigateur (\`--navigateur\`) au seuil 2 (#232, point 7)`);
  });

  test('au Ready, une étape bloquante joue le harnais du besoin, par sa définition commune', () => {
    const joués = jouer(lire(CI), auReady).flatMap((job) => job.joués.map((é) => ({ job, é })));
    const harnais = joués.filter(({ é }) => /harnais-du-besoin/.test(déplier(commande(é))));
    assert.ok(harnais.length, `${CI} : au Ready, aucune étape ne joue le harnais du besoin (définition de D83, \`.githooks/harnais-du-besoin.sh\`) (#232, point 9)`);
    for (const { job, é } of harnais) assert.ok(!laisseÉchouer(job, é), `${CI} : le harnais du besoin, dans « ${job.nom} », ne doit pas se laisser échouer (#232, point 9)`);
  });

  test('au tag v*, la CI vérifie au seuil 3, tests navigateur activés, avant de publier', () => {
    const yaml = lire(CI);
    const tag = étapesDeTests(yaml, auTag);
    const au3 = tag.filter((t) => t.seuil >= 3);
    assert.ok(au3.length, `${CI} : au tag v*, aucune étape ne joue les tests au seuil 3 (#232, point 8)`);
    assert.ok(au3.some((t) => t.navigateur), `${CI} : au tag v*, les tests au seuil 3 activent les tests navigateur (\`--navigateur\`) (#232, point 8)`);
    assert.ok(jouer(yaml, auTag).some((job) => job.joués.some(publie)), `${CI} : au tag v*, rien ne publie ; le harnais de #232 est à relire`);
    const rouges = new Set(au3.map((t) => t.é.texte));
    const publiéQuandMême = jouer(yaml, auTag, (é) => rouges.has(é.texte)).filter((job) => job.joués.some(publie)).map((j) => j.nom);
    assert.deepEqual(publiéQuandMême, [], `${CI} : au tag v*, un rouge au seuil 3 doit empêcher de publier (#232, point 8)`);
  });

  test('témoin rouge · une CI qui vérifie au seuil 0 au Ready, ou joue le harnais du besoin sans bloquer', () => {
    const yaml = lire(CI);
    assert.match(yaml, /pnpm test 1\b/, `${CI} : le témoin cherche « pnpm test 1 » ; il est à relire`);
    const au0 = étapesDeTests(yaml.replace(/pnpm test 1\b/g, 'pnpm test 0'), auReady).filter((t) => !t.navigateur);
    assert.ok(au0.some((t) => t.seuil !== 1), 'témoin : au seuil 0, le test du seuil 1 au Ready devrait échouer');
    const étape = jouer(yaml, auReady).flatMap((job) => job.joués.map((é) => ({ job, é }))).find(({ é }) => /harnais-du-besoin/.test(déplier(commande(é))));
    assert.ok(étape, `${CI} : le témoin cherche l'étape du harnais du besoin ; il est à relire`);
    const lâche = { ...étape.é, texte: `${étape.é.texte.replace(/\n*$/, '')}\n        continue-on-error: true\n` };
    assert.ok(laisseÉchouer(étape.job, lâche), 'témoin : un harnais du besoin qui se laisse échouer devrait rougir le test du Ready');
  });
});
