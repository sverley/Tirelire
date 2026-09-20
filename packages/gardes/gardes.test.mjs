/**
 * Harnais de l'objectif primaire (#58, D61) : la garde se vérifie elle-même.
 *
 * Le premier test tient le dépôt réel : chaque invariant, usage et contrainte a son harnais, sa
 * vérification manuelle ou un renvoi gardé. Les autres tiennent la règle sur des documents
 * inventés, pour qu'elle ne dépende pas du contenu du jour : un ajout sans garde, un harnais
 * renommé, une case non cochée ou une garde retirée doivent se voir.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
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

test('le dépôt tient sa garde : chaque invariant, usage et contrainte est gardé', () => {
  const { problemes, ids } = verifierCouverture();
  for (const genre of ['I', 'U', 'C']) {
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

// ─── Demandes d'une PR ───────────────────────────────────────────────────────────────────────

const { entrees } = lireRegistre(GARDES);
const pr = (corps, fichiersModifies = []) => verifierPr({ entrees, corps, fichiersModifies });
const section = (touches, masques, verifications = '') =>
  `Pour #1 : rien.\n\n## Ce qui change\n\nRien.\n\n## Invariants et contraintes\n\nTouchés : ${touches}\nLien possible masqué : ${masques}\n\n### Vérifications manuelles\n\n${verifications}\n## Après\n\nFin.\n`;
/** Consigne du registre inventé, recopiée comme `demander` l'écrit (tranché dans #60). */
const consigneDe = (cle) => [...entrees.values()].flatMap((e) => e.verifications).find((v) => v.id === cle)?.description ?? '';
const item = (cle) => `- \`${cle}\` · essai${consigneDe(cle) ? ` — ${consigneDe(cle)}` : ''}\n`;
/** La case unique de la PR, en pied de section, que seul le porteur coche (tranché le 19 septembre). */
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
  assert.deepEqual([r.aCorriger, r.enAttente], [[], []]);
});

test("un fichier modifié qui répond aux chemins d'une entrée impose de la déclarer", () => {
  assert.match(texte(pr(section('aucun', 'aucun'), ['b/deux.mjs']).aCorriger), /C1 n'est pas déclaré alors que la PR modifie b\/deux\.mjs/);
  const declaree = pr(section('aucun', 'C1', item('VM-C1-appareil') + casePorteur(true)), ['b/deux.mjs']);
  assert.deepEqual(declaree.aCorriger, []);
});

test("une vérification demandée garde la PR rouge tant que le porteur n'a pas coché l'unique case", () => {
  assert.match(texte(pr(section('C1', 'aucun')).aCorriger), /`VM-C1-appareil` \(C1\) est demandée mais ne figure pas/);
  assert.match(texte(pr(section('C1', 'aucun', item('VM-C1-appareil'))).aCorriger), /La case « - \[ \] Validée par le porteur » manque/);

  const attente = pr(section('C1', 'aucun', item('VM-C1-appareil') + casePorteur(false)));
  assert.deepEqual(attente.aCorriger, []);
  assert.match(texte(attente.enAttente), /Une vérification manuelle est demandée : en attente de la case du porteur/);

  const validee = pr(section('C1', 'aucun', item('VM-C1-appareil') + casePorteur(true)));
  assert.deepEqual([validee.aCorriger, validee.enAttente, validee.validees], [[], [], ['VM-C1-appareil']]);
  assert.match(texte(pr(section('C1', 'aucun', item('VM-C1-appareil') + casePorteur(true) + casePorteur(true))).aCorriger), /figure 2 fois : n'en garder qu'une/);
});

test('déclarer une entrée demande aussi les vérifications des entrées qui la couvrent, de proche en proche', () => {
  const manquantes = texte(pr(section('I1', 'aucun')).aCorriger);
  assert.match(manquantes, /`VM-U1-parcours` \(I1, par U1\) est demandée/);
  assert.match(manquantes, /`VM-U2-parcours` \(I1, par U2\) est demandée/);
});

test('les commentaires ne comptent pas, un identifiant ou une vérification inconnus non plus', () => {
  const commentee = pr(section('I7', 'aucun', `<!--\n${item('VM-C1-appareil')}${casePorteur(true)}-->\n`));
  assert.match(texte(commentee.aCorriger), /I7 est déclaré mais n'a pas d'entrée/);
  assert.deepEqual(commentee.validees, []);
  assert.match(texte(pr(section('aucun', 'aucun', item('VM-C1-apareil') + casePorteur(true))).aCorriger), /`VM-C1-apareil` n'est ni une vérification manuelle/);
});

test('une vérification manuelle recopie sa consigne du registre, coupée ou non, et la déclaration se lit comme GitHub l’affiche (#60)', () => {
  const avec = (tete, suite = '') => section('U2', 'aucun', `- \`VM-U2-parcours\` · U2${tete}\n${suite}` + casePorteur(true));
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
  const valide = retire(section('aucun', 'aucun', item('VM-C1-appareil') + item('I2 · a/test/un.test.ts') + casePorteur(true)));
  assert.deepEqual([valide.aCorriger, valide.enAttente], [[], []]);
});

test("la section préparée par « demander » se remplit, puis attend l'unique case du porteur", () => {
  const preparee = preparerSection({ entrees, fichiersModifies: ['b/deux.mjs'] });
  assert.match(preparee, /^Touchés : C1$/m);
  assert.match(preparee, /^- \[ \] Validée par le porteur$/m);
  const r = pr(`Pour #1 : rien.\n\n${preparee}\n`, ['b/deux.mjs']);
  assert.match(texte(r.aCorriger), /« Lien possible masqué : » à remplir/);
  const remplie = pr(`Pour #1 : rien.\n\n${preparee.replace('masqué : à analyser', 'masqué : aucun')}\n`, ['b/deux.mjs']);
  assert.deepEqual(remplie.aCorriger, []);
  assert.match(texte(remplie.enAttente), /en attente de la case du porteur/);
});


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

// ── #113 (D71) : un harnais joué en local ne sort pas de la machine ─────────────────────────────

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { cibleDe, designer, estLocal, message, tentatives, vider } from './sans-sortie.mjs';

const PRECHARGE = pathToFileURL(join(RACINE, V.SANS_SORTIE)).href;

/** Joue `node --test` avec la garde préchargée, dans un dossier jetable garni de `fichiers`. */
function jouerSousGarde(fichiers) {
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-113-'));
  try {
    for (const [nom, contenu] of Object.entries(fichiers)) writeFileSync(join(dossier, nom), contenu);
    // Sans ce retrait, le `node --test` enfant se croit dans celui-ci et ne joue rien.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--import', PRECHARGE, '--test'], { cwd: dossier, env, encoding: 'utf8', timeout: 30_000 });
    return { code: r.status, sortie: `${r.stdout}\n${r.stderr}` };
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

test('#113 : la boucle locale est la machine, le reste non', () => {
  for (const h of [undefined, '', 'localhost', 'LOCALHOST.', 'app.localhost', '127.0.0.1', '127.8.0.3', '::1', '[::1]', '::ffff:127.0.0.1', '0.0.0.0', '::']) {
    assert.equal(estLocal(h), true, String(h));
  }
  // #118 : la même adresse écrite autrement reste la machine — l'analyseur d'URL réécrit
  // `[::ffff:127.0.0.1]` en `[::ffff:7f00:1]`, et `::1` s'écrit de plusieurs façons.
  for (const h of ['::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '[::ffff:7f00:1]', '0::1', '::0:1', '0:0:0:0:0:0:0:1', '::ffff:127.255.255.254']) {
    assert.equal(estLocal(h), true, h);
  }
  for (const h of ['::ffff:c000:20a', '::ffff:128.0.0.1', '2001:db8::1', 'ffff::1', '::1:0', ':::1', '1:2:3:4:5:6:7']) {
    assert.equal(estLocal(h), false, h);
  }
  for (const h of ['exemple.com', 'api.github.com', '10.0.0.1', '192.168.1.2', '128.0.0.1', '::2', 'localhost.exemple.com', '127.0.0.1.nip.io']) {
    assert.equal(estLocal(h), false, h);
  }
});

test('#113 : la cible se lit sous toutes les formes de connect, et un path vide n’est pas un socket de fichier', () => {
  assert.deepEqual(cibleDe([{ host: 'exemple.com', port: 443 }]), { hote: 'exemple.com', port: 443 });
  assert.deepEqual(cibleDe([[{ host: 'exemple.com', port: 80, path: null }, () => {}]]), { hote: 'exemple.com', port: 80 });
  assert.deepEqual(cibleDe([80, 'exemple.com', () => {}]), { hote: 'exemple.com', port: 80 });
  assert.deepEqual(cibleDe(['8080']), { hote: undefined, port: '8080' });
  assert.deepEqual(cibleDe(['/tmp/prise.sock']), { chemin: '/tmp/prise.sock' });
  assert.deepEqual(cibleDe([{ path: '/tmp/prise.sock' }]), { chemin: '/tmp/prise.sock' });
  assert.match(message([{ hote: 'exemple.com', port: 80 }, { hote: '2001:db8::1', port: 443 }]), /exemple\.com:80, \[2001:db8::1\]:443 \(#113/);
  assert.equal(designer({ hote: 'exemple.com' }), 'exemple.com');
  assert.equal(designer({ hote: '[::2]', port: 1 }), '[::2]:1');
});

test('#113 : dans ce processus même, la connexion sortante est refusée et retenue avant toute résolution, puis oubliée par vider', async () => {
  const avant = tentatives().length;
  const erreur = await new Promise((r) => net.connect({ host: 'retenue.invalid', port: 80 }).on('error', r).on('connect', () => r(null)));
  try {
    assert.equal(erreur?.code, 'ERR_TIRELIRE_HORS_MACHINE');
    assert.match(erreur.message, /retenue\.invalid:80/);
    assert.deepEqual(tentatives().slice(avant), [{ hote: 'retenue.invalid', port: 80 }]);
  } finally {
    // Oublier la sonde, sans quoi ce fichier sortirait en échec : c'est la garde qui le veut.
    vider();
  }
  assert.deepEqual(tentatives(), []);
});

test('#113 : une connexion hors de la machine fait échouer node --test en nommant l’hôte, par fetch comme par node:http, depuis le code testé et erreur avalée', () => {
  const { code, sortie } = jouerSousGarde({
    'code.mjs': [
      "import http from 'node:http';",
      "export const parFetch = () => fetch('http://hors-machine.invalid:80/').then(() => 'passé', () => 'avalé');",
      "export const parHttp = () => new Promise((r) => http.get('http://autre-hors-machine.invalid:80/', { agent: false }, (x) => { x.resume(); r('passé'); }).on('error', () => r('avalé')));",
    ].join('\n'),
    'sonde.test.mjs': [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { parFetch, parHttp } from './code.mjs';",
      "test('fetch avalé', async () => assert.equal(await parFetch(), 'avalé'));",
      "test('http avalé', async () => assert.equal(await parHttp(), 'avalé'));",
    ].join('\n'),
  });
  assert.notEqual(code, 0, sortie);
  assert.match(sortie, /# pass 2/, 'les deux tests passent : c’est la garde, pas une assertion, qui fait échouer');
  assert.match(sortie, /hors-machine\.invalid:80/);
  assert.match(sortie, /autre-hors-machine\.invalid:80/);
});

test('#113 : témoin — la boucle locale passe sous la même garde, par fetch comme par node:http', () => {
  const { code, sortie } = jouerSousGarde({
    'boucle.test.mjs': [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import http from 'node:http';",
      "test('boucle locale', async () => {",
      "  const serveur = http.createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1');",
      "  await new Promise((r) => serveur.once('listening', r));",
      "  const { port } = serveur.address();",
      "  for (const h of ['127.0.0.1', 'localhost']) assert.equal(await (await fetch(`http://${h}:${port}/`)).text(), 'ok');",
      "  const recu = await new Promise((r) => http.get(`http://127.0.0.1:${port}/`, { agent: false }, (x) => { let t = ''; x.on('data', (d) => (t += d)); x.on('end', () => r(t)); }));",
      "  assert.equal(recu, 'ok');",
      "  serveur.close();",
      "});",
    ].join('\n'),
  });
  assert.equal(code, 0, sortie);
  assert.match(sortie, /# pass 1\b/, 'le témoin a bien joué son test');
  assert.doesNotMatch(sortie, /hors de la machine/);
});

test('#113 : chaque lanceur local du dépôt est branché sur la garde', () => {
  assert.ok(existsSync(join(RACINE, V.SANS_SORTIE)) && existsSync(join(RACINE, V.SANS_SORTIE_VITEST)));
  assert.deepEqual(V.paquetsDuWorkspace(), ['packages/core', 'packages/gardes', 'apps/hebergement', 'apps/relay', 'apps/web']);
  assert.deepEqual(V.verifierLanceursLocaux(), []);
});

test('#113 : sous vitest aussi, une connexion hors de la machine fait échouer le fichier en nommant l’hôte, erreur avalée', () => {
  const vitest = join(RACINE, 'packages/core/node_modules/.bin/vitest');
  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-113-vitest-'));
  try {
    const setup = JSON.stringify(join(RACINE, V.SANS_SORTIE_VITEST));
    writeFileSync(join(dossier, 'vitest.config.mjs'), `export default { test: { include: ['*.test.mjs'], setupFiles: [${setup}] } };\n`);
    writeFileSync(join(dossier, 'sonde.test.mjs'), [
      "import { test, expect } from 'vitest';",
      "test('avalé', async () => expect(await fetch('http://vitest-hors-machine.invalid:80/').then(() => 'passé', () => 'avalé')).toBe('avalé'));",
    ].join('\n'));
    writeFileSync(join(dossier, 'boucle.test.mjs'), "import { test } from 'vitest';\ntest('rien ne sort', () => {});\n");
    const r = spawnSync(vitest, ['run', '--root', dossier], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, CI: '1', NO_COLOR: '1' } });
    const sortie = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
    assert.notEqual(r.status, 0, sortie);
    assert.match(sortie, /vitest-hors-machine\.invalid:80/);
    assert.match(sortie, /1 failed \| 1 passed/, 'seul le fichier qui sort échoue');
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('#113 : témoin — un lanceur non branché est nommé, qu’il soit node --test, vitest ou inconnu', () => {
  const racine = mkdtempSync(join(tmpdir(), 'tirelire-113-depot-'));
  try {
    const ecrire = (chemin, contenu) => {
      mkdirSync(dirname(join(racine, chemin)), { recursive: true });
      writeFileSync(join(racine, chemin), typeof contenu === 'string' ? contenu : JSON.stringify(contenu));
    };
    ecrire('pnpm-workspace.yaml', 'packages:\n  - paquets/*\n\nonlyBuiltDependencies:\n  - esbuild\n');
    ecrire('package.json', { scripts: {} });
    ecrire('paquets/branche/package.json', { name: 'branche', scripts: { test: 'node --import ../../packages/gardes/sans-sortie.mjs --test' } });
    ecrire('paquets/nu/package.json', { name: 'nu', scripts: { test: 'node --test' } });
    ecrire('paquets/ailleurs/package.json', { name: 'ailleurs', scripts: { test: 'node --import ./sans-sortie.mjs --test' } });
    ecrire('paquets/vite-branche/package.json', { name: 'vite-branche', scripts: { test: 'vitest run' } });
    ecrire('paquets/vite-branche/vitest.config.ts', "export default { test: { setupFiles: ['../../packages/gardes/sans-sortie-vitest.mjs'] } };");
    ecrire('paquets/vite-commente/package.json', { name: 'vite-commente', scripts: { test: 'vitest run' } });
    ecrire('paquets/vite-commente/vitest.config.ts', "export default { test: {\n // setupFiles: ['../../packages/gardes/sans-sortie-vitest.mjs'],\n} };");
    ecrire('paquets/vite-sans-config/package.json', { name: 'vite-sans-config', scripts: { test: 'vitest run' } });
    ecrire('paquets/jest/package.json', { name: 'jest', scripts: { test: 'jest' } });
    ecrire('paquets/sans-test/package.json', { name: 'sans-test', scripts: {} });
    const problemes = V.verifierLanceursLocaux(racine);
    const noms = problemes.map((p) => /^`([^`]+)`/.exec(p)?.[1]);
    assert.deepEqual(noms.sort(), ['ailleurs', 'jest', 'nu', 'vite-commente', 'vite-sans-config'], problemes.join('\n'));
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});
