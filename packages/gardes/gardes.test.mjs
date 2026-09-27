/**
 * Les tests de la garde (#58, D81) : la garde se vérifie elle-même — ses trois vérifications et la
 * règle des harnais. Ce sont les seuls tests de la garde ; ils ne portent que les niveaux 0 et 1.
 * Tout autre fichier de test de `packages/gardes` est le harnais d'un besoin (D81).
 *
 * Le premier test tient le dépôt réel : chaque invariant, usage et contrainte a son harnais, sa
 * vérification manuelle ou un renvoi gardé. Les autres tiennent la règle sur des documents
 * inventés, pour qu'elle ne dépende pas du contenu du jour : un ajout sans garde, un harnais
 * renommé, une case non cochée ou une garde retirée doivent se voir. La règle des harnais se joue
 * sur le dépôt réel, puis sur ses témoins (`regle-des-harnais.mjs`).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import * as V from './gardes.mjs';
import {
  DOCUMENTS,
  RACINE,
  fichiersDuDepot,
  globVersRegex,
  lireRegistre,
  preparerSection,
  verifierCouverture,
  verifierCouvertureTextes,
  verifierPr,
} from './gardes.mjs';
import { TESTS_DE_LA_GARDE, harnais, manquements, niveauxDesTests } from './regle-des-harnais.mjs';

const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8');
const texte = (problemes) => problemes.join('\n');

const INVARIANTS = `# Invariants

## I1 · Premier

Texte.

## I2 · Deuxième

- **U1 · Usage un.** Texte.
- **U2 · Usage deux.** Texte.
`;

const CONTRAINTES = `# Contraintes

## C1 · Une contrainte
`;

const FICHIERS = ['a/test/un.test.ts', 'a/src/sync.ts', 'a/src/vue/Plan.svelte', 'b/deux.mjs'];

const GARDES = `# Gardes

## Écrire une entrée

- **Harnais** · ce titre n'a pas d'identifiant : cette ligne ne compte pas.

## I1 · Premier

- **Couvert par** · I2 — la raison d'être passe par I2.

## I2 · Deuxième

Chemins : \`a/src/**\`

- **Harnais** · \`a/test/un.test.ts\` — garde le calcul. Témoin rouge : à bâtir (#38).
- **Couvert par** · U1, U2 — chaque usage.

### U1 · Usage un

- **Vérification manuelle** · \`VM-U1-parcours\` — Suivre le parcours complet sur une base vide et constater qu'il aboutit.

### U2 · Usage deux

- **Vérification manuelle** · \`VM-U2-parcours\` — Suivre le second parcours
  sur une base vide et constater qu'il aboutit.

## C1 · Une contrainte

Chemins : \`b/*.mjs\`

- **Vérification manuelle** · \`VM-C1-appareil\` — Sur un vrai téléphone, constater que l'écran touché reste lisible.
- **À bâtir** · une mesure automatique.
`;

const couverture = (modif = {}) =>
  verifierCouvertureTextes({ invariants: INVARIANTS, contraintes: CONTRAINTES, gardes: GARDES, fichiers: FICHIERS, ...modif }).problemes;

// Depuis #162, les usages vivent dans la description, et leurs gardes dans l'entrée d'I3 : le dépôt
// n'a plus d'identifiant U… à lire. La garde sait toujours en lire (jeu inventé ci-dessous).
describe('[niveau 1] tests de la garde · D81 : la garde se vérifie elle-même, ses trois vérifications et la règle des harnais (#58)', () => {
  describe('D81, point 1 · chaque invariant et chaque contrainte a son entrée, gardée', () => {
    test('le dépôt tient sa garde : chaque invariant et chaque contrainte est gardé', () => {
      const { problemes, ids } = verifierCouverture();
      for (const genre of ['I', 'C']) {
        assert.ok([...ids.keys()].some((id) => id.startsWith(genre)), `aucun identifiant ${genre}… lu : le format des documents a changé ?`);
      }
      assert.deepEqual(problemes, []);
    });

    test('le jeu inventé est gardé, et une ligne sous un titre sans identifiant ne compte pas', () => {
      assert.deepEqual(couverture(), []);
    });

    test('un invariant, un usage ou une contrainte ajouté sans garde se voit aussitôt', () => {
      assert.match(texte(couverture({ invariants: `${INVARIANTS}\n## I3 · Nouveau\n` })), /^I3 · Nouveau \(docs\/invariants\.md\) n'a pas d'entrée/m);
      assert.match(texte(couverture({ invariants: `${INVARIANTS}- **U3 · Nouvel usage.** Texte.\n` })), /^U3 · Nouvel usage .* n'a pas d'entrée/m);
      assert.match(texte(couverture({ contraintes: `${CONTRAINTES}\n## C2 · Nouvelle\n` })), /^C2 · Nouvelle \(docs\/contraintes\.md\) n'a pas d'entrée/m);
    });

    test('dans les vrais documents aussi, un ajout ou un retrait sans garde et un harnais absent font échouer', () => {
      const vrais = {
        invariants: lire(DOCUMENTS.invariants),
        contraintes: lire(DOCUMENTS.contraintes),
        gardes: lire(DOCUMENTS.gardes),
        fichiers: fichiersDuDepot(),
      };
      const ajoutI = verifierCouvertureTextes({ ...vrais, invariants: `${vrais.invariants}\n## I99 · Ajouté sans garde\n` }).problemes;
      assert.ok(ajoutI.some((p) => p.startsWith('I99 ')), texte(ajoutI));
      const ajoutC = verifierCouvertureTextes({ ...vrais, contraintes: `${vrais.contraintes}\n## C99 · Ajoutée sans garde\n` }).problemes;
      assert.ok(ajoutC.some((p) => p.startsWith('C99 ')), texte(ajoutC));
      const retrait = verifierCouvertureTextes({ ...vrais, gardes: vrais.gardes.replace(/^## C6 · [\s\S]*?(?=^## C7 · )/m, '') }).problemes;
      assert.ok(retrait.some((p) => p.startsWith('C6 ')), texte(retrait));
      const harnais = 'packages/core/test/sync.test.ts';
      const absent = verifierCouvertureTextes({ ...vrais, fichiers: vrais.fichiers.filter((f) => f !== harnais) }).problemes;
      assert.ok(absent.some((p) => p.includes(`\`${harnais}\` n'existe pas`)), texte(absent));
    });

    test('une entrée sans garde, ou gardée seulement par une boucle de renvois, est refusée', () => {
      const sansGarde = GARDES.replace(/^- \*\*Vérification manuelle\*\* · `VM-C1-appareil`.*\n/m, '');
      assert.match(texte(couverture({ gardes: sansGarde })), /C1 : ni harnais, ni vérification manuelle/);

      const boucle = `## I1 · x\n\n- **Couvert par** · I2 — l'un par l'autre.\n\n## I2 · y\n\n- **Couvert par** · I1 — l'autre par l'un.\n`;
      const p = texte(verifierCouvertureTextes({ invariants: '## I1 · x\n## I2 · y\n', contraintes: '', gardes: boucle, fichiers: [] }).problemes);
      assert.match(p, /I1 : ni harnais/);
      assert.match(p, /I2 : ni harnais/);
      assert.match(texte(couverture({ gardes: GARDES.replace('**Couvert par** · I2 —', '**Couvert par** · I9 —') })), /renvoi vers I9, qui n'a pas d'entrée/);
    });

    test('un harnais renommé, un motif de chemin périmé ou une étiquette mal écrite cassent le lien', () => {
      assert.match(texte(couverture({ fichiers: FICHIERS.filter((f) => f !== 'a/test/un.test.ts') })), /le harnais `a\/test\/un\.test\.ts` n'existe pas/);
      assert.match(texte(couverture({ gardes: GARDES.replace('`b/*.mjs`', '`c/*.mjs`') })), /le motif `c\/\*\.mjs` ne désigne aucun fichier/);
      assert.match(texte(couverture({ gardes: GARDES.replace('**Harnais** · `a', '**Harnai** · `a') })), /étiquette inconnue « Harnai »/);
      assert.match(texte(couverture({ gardes: GARDES.replace('`a/test/un.test.ts` — garde le calcul.', '`a/test/un.test.ts`') })), /un harnais s'écrit/);
      assert.match(texte(couverture({ gardes: `${GARDES}\n## I7 · Inventé\n\n- **À bâtir** · plus tard.\n` })), /I7 n'existe ni dans/);
    });

    test('une vérification manuelle porte le nom de son entrée, un nom unique et une vraie consigne', () => {
      assert.match(texte(couverture({ gardes: GARDES.replace('VM-C1-appareil', 'VM-C2-appareil') })), /doit s'écrire VM-C1-nom/);
      const doublon = GARDES.replace('- **À bâtir**', "- **Vérification manuelle** · `VM-C1-appareil` — Une seconde consigne, assez longue pour en être une.\n- **À bâtir**");
      assert.match(texte(couverture({ gardes: doublon })), /`VM-C1-appareil` est déjà définie en C1/);
      assert.match(texte(couverture({ gardes: GARDES.replace("Sur un vrai téléphone, constater que l'écran touché reste lisible.", 'Regarder.') })), /doit dire ce qu'on fait/);
    });

    test('motifs de chemin', () => {
      assert.ok(globVersRegex('apps/web/src/**/*.svelte').test('apps/web/src/App.svelte'));
      assert.ok(globVersRegex('apps/web/src/**/*.svelte').test('apps/web/src/views/Plan.svelte'));
      assert.ok(!globVersRegex('apps/web/src/*.svelte').test('apps/web/src/views/Plan.svelte'));
      assert.ok(globVersRegex('apps/relay/**').test('apps/relay/server.mjs'));
      assert.ok(!globVersRegex('apps/relay/**').test('apps/relayeur/server.mjs'));
      assert.ok(!globVersRegex('packages/core/src/sync.ts').test('packages/core/src/syncXts'));
    });
  });

  describe('D81, points 2 et 3 · une PR déclare les entrées qu’elle touche, et recopie leurs vérifications manuelles (#150)', () => {
    // ─── Demandes d'une PR ───────────────────────────────────────────────────────────────────────

    const { entrees } = lireRegistre(GARDES);
    const pr = (corps, fichiersModifies = []) => verifierPr({ entrees, corps, fichiersModifies });
    const section = (touches, masques, verifications = '') =>
      `Pour #1 : rien.\n\n## Ce qui change\n\nRien.\n\n## Invariants et contraintes\n\nTouchés : ${touches}\nLien possible masqué : ${masques}\n\n### Vérifications manuelles\n\n${verifications}\n## Après\n\nFin.\n`;
    /** Consigne du registre inventé, recopiée comme `demander` l'écrit (tranché dans #60). */
    const consigneDe = (cle) => [...entrees.values()].flatMap((e) => e.verifications).find((v) => v.id === cle)?.description ?? '';
    const item = (cle) => `- \`${cle}\` · essai${consigneDe(cle) ? ` — ${consigneDe(cle)}` : ''}\n`;
    /** L'ancienne case « Validée » : le passage en Ready l'a remplacée (#150), elle ne compte plus pour rien. */
    const casePorteur = (cochee) => `\n- [${cochee ? 'x' : ' '}] Validée par le porteur\n`;

    test("une PR sans section, ou avec la section du modèle laissée telle quelle, est refusée", () => {
      assert.match(texte(pr('Pour #1 : rien.').aCorriger), /pas de section « ## Invariants et contraintes »/);
      const modele = pr(lire(DOCUMENTS.modele)).aCorriger;
      assert.match(texte(modele), /« Touchés : » à remplir/);
      assert.match(texte(modele), /« Lien possible masqué : » à remplir/);
      assert.match(texte(pr(section('aucun', 'aucun').replace(/^Lien possible.*\n/m, '')).aCorriger), /La ligne « Lien possible masqué : » manque/);
    });

    test('rien de touché, rien de masqué, rien dans le plancher : la PR passe', () => {
      const r = pr(section('aucun', 'aucun'), ['docs/notes.md']);
      assert.deepEqual(r.aCorriger, []);
    });

    test("un fichier modifié qui répond aux chemins d'une entrée impose de la déclarer", () => {
      assert.match(texte(pr(section('aucun', 'aucun'), ['b/deux.mjs']).aCorriger), /C1 n'est pas déclaré alors que la PR modifie b\/deux\.mjs/);
      const declaree = pr(section('aucun', 'C1', item('VM-C1-appareil')), ['b/deux.mjs']);
      assert.deepEqual(declaree.aCorriger, []);
    });

    test('une vérification demandée figure dans la section, sans case à cocher : le passage en Ready valide (#150)', () => {
      assert.match(texte(pr(section('C1', 'aucun')).aCorriger), /`VM-C1-appareil` \(C1\) est demandée mais ne figure pas/);
      assert.deepEqual(pr(section('C1', 'aucun', item('VM-C1-appareil'))).aCorriger, []);
      // Une case restée d'avant, vide, cochée ou en double, ne compte pour rien.
      for (const reste of [casePorteur(false), casePorteur(true), casePorteur(true) + casePorteur(true)]) {
        assert.deepEqual(pr(section('C1', 'aucun', item('VM-C1-appareil') + reste)).aCorriger, []);
      }
    });

    test('une PR ferme les issues qu’elle cite par « Close #n », hors code et commentaires (#150)', () => {
      assert.deepEqual(V.issuesFermees('Close #150'), [150]);
      assert.deepEqual(V.issuesFermees('closes: #3, Fixes #4 et resolved #3'), [3, 4]);
      assert.deepEqual(V.issuesFermees('Close #…\n<!-- Close #8 -->\n~~~\nClose #9\n~~~\nVoir #10, disclose #11'), []);
    });

    test('déclarer une entrée demande aussi les vérifications des entrées qui la couvrent, de proche en proche', () => {
      const manquantes = texte(pr(section('I1', 'aucun')).aCorriger);
      assert.match(manquantes, /`VM-U1-parcours` \(I1, par U1\) est demandée/);
      assert.match(manquantes, /`VM-U2-parcours` \(I1, par U2\) est demandée/);
    });

    test('les commentaires ne comptent pas, un identifiant ou une vérification inconnus non plus', () => {
      const commentee = pr(section('I7', 'aucun', `<!--\n${item('VM-C1-appareil')}-->\n`));
      assert.match(texte(commentee.aCorriger), /I7 est déclaré mais n'a pas d'entrée/);
      assert.match(texte(pr(section('aucun', 'aucun', item('VM-C1-apareil'))).aCorriger), /`VM-C1-apareil` n'est ni une vérification manuelle/);
    });

    test('une vérification manuelle recopie sa consigne du registre, coupée ou non, et la déclaration se lit comme GitHub l’affiche (#60)', () => {
      const avec = (tete, suite = '') => section('U2', 'aucun', `- \`VM-U2-parcours\` · U2${tete}\n${suite}`);
      assert.deepEqual(pr(avec(` — ${consigneDe('VM-U2-parcours')}`)).aCorriger, []);
      assert.deepEqual(pr(avec(' — Suivre le second parcours', "  sur une base vide et constater qu'il aboutit.\n")).aCorriger, []);
      assert.match(texte(pr(avec('')).aCorriger), /`VM-U2-parcours` : consigne à recopier/);
      assert.match(texte(pr(avec(' — Suivre le second parcours')).aCorriger), /`VM-U2-parcours` : la consigne diffère/);

      const declares = (touches, masques = 'aucun') => pr(section(touches, masques)).declares;
      assert.deepEqual(declares('u1, C1'), ['U1', 'C1']);
      assert.deepEqual(declares('U1 à U2'), ['U1', 'U2']);
      assert.deepEqual(declares('U1,\nC1'), ['U1', 'C1']);
      assert.match(texte(pr(section('U2–C1', 'aucun')).aCorriger), /n'est pas une plage/);
      assert.match(texte(pr(section('aucun', 'aucun\nTouchés : C1')).aCorriger), /La ligne « Touchés : » figure 2 fois/);
      const exemple = 'Exemple :\n\n~~~\n## Invariants et contraintes\n\nTouchés : aucun\n~~~\n\n';
      assert.deepEqual(pr(exemple + section('C1', 'aucun')).declares, ['C1']);
      assert.match(texte(pr(section('aucun', 'aucun') + '\n## Invariants et contraintes\n').aCorriger), /figure 2 fois/);
    });

    test('retirer une vérification manuelle ou un harnais du registre demande la même validation', () => {
      const apres = lireRegistre(
        GARDES.replace(/^- \*\*Vérification manuelle\*\* · `VM-C1-appareil`.*\n/m, '').replace(/^- \*\*Harnais\*\* · `a\/test\/un\.test\.ts`.*\n/m, ''),
      ).entrees;
      const retire = (corps) => verifierPr({ entrees: apres, entreesAvant: entrees, corps, fichiersModifies: [] });
      const rouge = texte(retire(section('aucun', 'aucun')).aCorriger);
      assert.match(rouge, /`VM-C1-appareil` \(vérification manuelle retirée\) est demandée/);
      assert.match(rouge, /`I2 · a\/test\/un\.test\.ts` \(harnais retiré\) est demandée/);
      const valide = retire(section('aucun', 'aucun', item('VM-C1-appareil') + item('I2 · a/test/un.test.ts')));
      assert.deepEqual(valide.aCorriger, []);
    });

    test('la section préparée par « demander » se remplit, sans case (#150)', () => {
      const preparee = preparerSection({ entrees, fichiersModifies: ['b/deux.mjs'] });
      assert.match(preparee, /^Touchés : C1$/m);
      assert.doesNotMatch(preparee, /Validée/);
      const r = pr(`Pour #1 : rien.\n\n${preparee}\n`, ['b/deux.mjs']);
      assert.match(texte(r.aCorriger), /« Lien possible masqué : » à remplir/);
      const remplie = pr(`Pour #1 : rien.\n\n${preparee.replace('masqué : à analyser', 'masqué : aucun')}\n`, ['b/deux.mjs']);
      assert.deepEqual(remplie.aCorriger, []);
    });

  });

  describe('D81, point 1 · le registre et les documents se lisent sans rien laisser passer', () => {
    test('un identifiant écrit sous une forme voisine est refusé en le nommant, dans les documents comme au registre', () => {
      const { ids, illisibles } = V.lireIdentifiants(
        '## I1 · Premier\n\n## I2 — Voisin\n### I3 · Trop bas\n\n- **U1 · Usage lu.** Oui.\n- **U2** · Voisin.\n## C1 · Dans le mauvais document\n',
        '## C1 · Contrainte\n## c2 · En minuscules\n',
      );
      assert.deepEqual([...ids.keys()], ['I1', 'U1', 'C1']);
      assert.deepEqual(illisibles.map((p) => p.split(' ')[0]), ['I2', 'I3', 'U2', 'C1', 'C2']);
      assert.match(illisibles[0], /un invariant s'écrit « ## I2 · Titre » dans docs\/invariants\.md/);
      assert.match(illisibles[3], /une contrainte s'écrit « ## C1 · Titre » dans docs\/contraintes\.md/);
      assert.match(texte(V.lireRegistre('## I1 — Voisin\n\n- **Harnais** · `a.test.ts` — garde.\n').problemes), /I1 n'est pas lu ; une entrée s'écrit « ## I1 · Titre »/);
    });

    test('un test nommé au registre se cherche parmi les tests qui tournent, pas n\'importe où dans le fichier', () => {
      const source = [
        "describe('positions et soldes (D19, D29)', () => {",
        '  it("budget construit par l\'assistant (D40)", () => {});',
        '  test(`un titre en gabarit`, () => {});',
        '  test.skip("désactivé", () => {});',
        "  it.todo('seulement prévu');",
        "  expect(/'\\/\\//.test('pas un titre')).toBe(true);",
        '});',
        "describe('sans test actif', () => { it.skip('en pause', () => {}); });",
        "describe.skip('suite désactivée', () => { it('dans la suite désactivée', () => {}); });",
        "test('option skip', { skip: 'plus tard' }, () => {});",
        "test('option sans effet', { timeout: 10 }, () => {});",
        "test('option conditionnelle', { skip: !process.env.PHP }, () => {});",
        "it.skipIf(false)('conditionnel', () => {});",
        "// it('en commentaire', () => {});",
        "/* describe('en bloc', () => { it('dans le bloc', () => {}); }); */",
      ].join('\n');
      const { actifs, inactifs } = V.analyserTests(source);
      assert.deepEqual([...actifs], ['positions et soldes (D19, D29)', "budget construit par l'assistant (D40)", 'un titre en gabarit', 'option sans effet', 'option conditionnelle', 'conditionnel']);
      assert.deepEqual([...inactifs], ['désactivé', 'seulement prévu', 'sans test actif', 'en pause', 'suite désactivée', 'dans la suite désactivée', 'option skip']);
      assert.deepEqual([...V.titresDeTests(source)], [...actifs]);
      // Une suite de niveau est une enveloppe ; un test qui en porte le titre, non (#238).
      const niveaux = [
        "describe('[niveau 1] harnais de la garde', () => { it('une garantie', () => {}); });",
        "describe('[niveau 2]', () => { it('une autre', () => {}); });",
        "describe('[niveau 5] hors des niveaux', () => { it('une troisième', () => {}); });",
        "describe('pas [niveau 1] en tête', () => { it('une quatrième', () => {}); });",
        "it('[niveau 3] un test, pas une suite', () => {});",
      ].join('\n');
      assert.deepEqual([...V.analyserTests(niveaux).enveloppes], ['[niveau 1] harnais de la garde', '[niveau 2]']);
      assert.deepEqual([...V.analyserTests(source).enveloppes], []);
      assert.equal(V.testNomme("« budget construit par  l'assistant (D40) » : sans aucune opération"), "budget construit par l'assistant (D40)");
      assert.equal(V.testNomme('moteur de règles de classement.'), null);

      const documents = {
        invariants: '## I1 · Premier\n',
        contraintes: '',
        gardes: '## I1 · Premier\n\n- **Harnais** · `a/un.test.ts`, `a/deux.test.ts` — « le test\n  nommé » : garde I1. Témoin rouge : à bâtir (#38).\n',
        fichiers: ['a/un.test.ts', 'a/deux.test.ts'],
      };
      const couverture = (contenus) => V.verifierCouvertureTextes({ ...documents, lireFichier: (c) => contenus[c] ?? null }).problemes;
      assert.deepEqual(couverture({ 'a/deux.test.ts': "it('le test nommé', () => {});" }), []);
      assert.match(texte(couverture({ 'a/un.test.ts': "// le test nommé\nit('un autre', () => {});" })), /le test « le test nommé » ne tourne dans aucun de `a\/un\.test\.ts`, `a\/deux\.test\.ts` \(renommé, supprimé ou mis en commentaire \?\)/);
    });

    test('un usage en liste numérotée, en gras souligné ou en italique est refusé en le nommant', () => {
      const { ids, illisibles } = V.lireIdentifiants('## I3 · Usages\n\n1. **U7 · Numéroté.**\n- __U8 · Souligné.__\n- *U9 · Italique.*\n- U1 et U2, dans une phrase, ne définissent rien.\n', '');
      assert.deepEqual([[...ids.keys()], illisibles.map((p) => p.split(' ')[0])], [['I3'], ['U7', 'U8', 'U9']]);
    });

    test("un test nommé présent mais qui ne tourne pas est signalé comme tel", () => {
      const problemes = V.verifierCouvertureTextes({
        invariants: '## I1 · Premier\n',
        contraintes: '',
        gardes: '## I1 · Premier\n\n- **Harnais** · `a/un.test.ts` — « suite gardée » : garde I1.\n',
        fichiers: ['a/un.test.ts'],
        lireFichier: () => "describe('suite gardée', () => {\n  it.skip('seul test', () => {});\n});\n",
      }).problemes;
      assert.match(texte(problemes), /le test « suite gardée » ne tourne dans aucun de `a\/un\.test\.ts` \(il y figure sans tourner/);
    });

    test("un harnais du registre qui se saute faute d'outil doit rendre l'outil obligatoire en CI", () => {
      const documents = {
        invariants: '## I1 · Premier\n',
        contraintes: '',
        gardes: '## I1 · Premier\n\n- **Harnais** · `a/outil.test.mjs` — garde I1. Témoin rouge : à bâtir (#38).\n',
        fichiers: ['a/outil.test.mjs', 'a/harnais.ts'],
      };
      const CI_STRICTE = "jobs:\n  test:\n    steps:\n      - run: pnpm test\n        env:\n          TIRELIRE_STRICT: '1'\n";
      const couverture = (contenus) =>
        V.verifierCouvertureTextes({ ...documents, lireFichier: (c) => ({ '.github/workflows/ci.yml': CI_STRICTE, ...contenus })[c] ?? null }).problemes;
      const saute = "const present = false;\ntest('avec outil', { skip: !present && 'absent' }, () => {});\n";
      assert.match(
        texte(couverture({ 'a/outil.test.mjs': `// TIRELIRE_STRICT, cité en commentaire, ne suffit pas\n${saute}` })),
        /le harnais `a\/outil\.test\.mjs` se saute sous condition sans rendre son outil obligatoire en CI/,
      );
      assert.deepEqual(couverture({ 'a/outil.test.mjs': saute.replace('!present &&', '!present && !process.env.TIRELIRE_STRICT &&') }), []);
      assert.deepEqual(
        couverture({
          'a/outil.test.mjs': "import { nav } from './harnais.js';\ndescribe.skipIf(!nav)('suite', () => { it('t', () => {}); });\n",
          'a/harnais.ts': 'export const nav = null;\nif (!nav && process.env.TIRELIRE_STRICT) throw new Error();\n',
        }),
        [],
      );
      assert.deepEqual(couverture({ 'a/outil.test.mjs': "test('sans condition', () => {});\n", '.github/workflows/ci.yml': '' }), []);
      const strict = saute.replace('!present &&', '!present && !process.env.TIRELIRE_STRICT &&');
      assert.match(texte(couverture({ 'a/outil.test.mjs': strict, '.github/workflows/ci.yml': 'jobs: {}\n' })), /\.github\/workflows\/ci\.yml : l'étape « pnpm test » ne pose pas `TIRELIRE_STRICT`, alors que a\/outil\.test\.mjs se sautent faute d'outil/);
    });

    test("l'étape pnpm test de la CI pose TIRELIRE_STRICT, dans son env, celui du job ou celui du workflow", () => {
      const ci = (etape, { job = '', workflow = '' } = {}) =>
        `name: CI\n${workflow}jobs:\n  test:\n    runs-on: ubuntu-latest\n${job}    steps:\n      - uses: actions/checkout@v4\n${etape}      - run: pnpm build\n`;
      const strict = "        env:\n          TIRELIRE_STRICT: '1'\n";
      assert.equal(V.etapeTestsStricte(ci(`      - run: pnpm test\n${strict}`)), true);
      assert.equal(V.etapeTestsStricte(ci(`      - name: Tests\n        run: pnpm test\n${strict}`)), true);
      assert.equal(V.etapeTestsStricte(ci('      - run: pnpm test\n', { job: "    env:\n      TIRELIRE_STRICT: '1'\n" })), true);
      assert.equal(V.etapeTestsStricte(ci('      - run: pnpm test\n', { workflow: "env:\n  TIRELIRE_STRICT: '1'\n" })), true);
      assert.equal(V.etapeTestsStricte(ci("      - run: pnpm test\n        env:\n          # TIRELIRE_STRICT: '1'\n")), false);
      assert.equal(V.etapeTestsStricte(ci("      - run: pnpm test\n        env:\n          TIRELIRE_STRICT: '0'\n")), false);
      assert.equal(V.etapeTestsStricte(ci('      - run: pnpm test\n').replace('      - run: pnpm build\n', `      - run: pnpm build\n${strict}`)), false);
      assert.equal(V.etapeTestsStricte(''), false);
      // `pnpm test N` : les tests jusqu'au niveau N, avec les mêmes exigences (#238).
      for (const n of [0, 1, 2, 3, 4]) {
        assert.equal(V.etapeTestsStricte(ci(`      - run: pnpm test ${n}\n${strict}`)), true, `pnpm test ${n}`);
        assert.equal(V.etapeTestsStricte(ci(`      - run: pnpm test ${n}\n`)), false, `pnpm test ${n} sans TIRELIRE_STRICT`);
      }
      for (const autre of ['pnpm test 5', 'pnpm test 12', 'pnpm test 1 2', 'pnpm test1']) {
        assert.equal(V.etapeTestsStricte(ci(`      - run: ${autre}\n${strict}`)), false, autre);
      }
      assert.equal(V.etapeTestsStricte(lire(V.CI_WORKFLOW)), true);
    });

    test('une liste de chemins trop longue pour une ligne se prolonge en dessous, et s’arrête au premier texte', () => {
      const registre = [
        '## C9 · Une contrainte aux chemins nombreux',
        '',
        'Chemins : `a/un.ts`, `a/deux.ts`,',
        '`b/**/*.svelte`, `c/trois.html`',
        'Cette phrase ne prolonge rien : la liste est close.',
        '',
        '- **Vérification manuelle** · `VM-C9-relire` — Relire les quatre chemins et constater que la garde les lit tous.',
      ].join('\n');
      const { entrees, problemes } = lireRegistre(registre);
      assert.deepEqual(entrees.get('C9').chemins, ['a/un.ts', 'a/deux.ts', 'b/**/*.svelte', 'c/trois.html']);
      assert.deepEqual(problemes, []);
    });
  });

  describe('D81 · la règle des harnais : les tests de la garde et les harnais du registre ne portent que les niveaux 0 et 1 (#232)', () => {
    test('le niveau se lit dans le fichier : marque du test, sinon de la suite qui l’englobe, sinon 2', () => {
      const source = [
        "test('n0 [niveau 0]', () => {});",
        "test('n3 [niveau 3]', () => {});",
        "test('s sans marque', () => {});",
        "describe('groupe [niveau 3]', () => {",
        "  test('g3 hérite de sa suite', () => {});",
        "  test('g0 [niveau 0]', () => {});",
        '});',
        "describe('groupe sans marque', () => { test('gs hérite du défaut', () => {}); });",
      ].join('\n');
      const lus = Object.fromEntries(niveauxDesTests(source).filter((t) => !t.suite).map((t) => [t.titre.split(' ')[0], t.niveau]));
      assert.deepEqual(lus, { n0: 0, n3: 3, s: 2, g3: 3, g0: 0, gs: 2 });
    });

    test('tout test de la garde ou d’un harnais du registre est de niveau 0 ou 1', () => {
      const liste = harnais();
      assert.ok(liste.some((h) => h.source !== 'garde'), 'aucun harnais du registre trouvé : la règle des harnais est à relire');
      assert.ok(liste.some((h) => h.fichier === TESTS_DE_LA_GARDE && existsSync(join(RACINE, h.fichier))), `${TESTS_DE_LA_GARDE} introuvable : la règle des harnais est à relire`);
      const m = [...new Set(liste.flatMap((h) => manquements(lire(h.fichier), h)))];
      assert.deepEqual(m, [], `règle des harnais (D81) :\n${m.join('\n')}`);
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
});
