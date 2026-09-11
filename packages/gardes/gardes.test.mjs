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

- **Harnais** · \`a/test/un.test.ts\` — garde le calcul.
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

test('dans les vrais documents aussi, un ajout sans garde fait échouer', () => {
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
const item = (cle, { analyse = "La PR change l'écran Plan : le regarder à 375 px.", cochee = false } = {}) =>
  `- \`${cle}\` · consigne\n  - Analyse (agent, 2026-09-11) : ${analyse}\n  - [${cochee ? 'x' : ' '}] Validée par un développeur humain\n`;

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
  const declaree = pr(section('aucun', 'C1', item('VM-C1-appareil', { cochee: true })), ['b/deux.mjs']);
  assert.deepEqual(declaree.aCorriger, []);
});

test("une vérification demandée garde la PR rouge tant qu'elle n'est pas analysée puis validée", () => {
  assert.match(texte(pr(section('C1', 'aucun')).aCorriger), /`VM-C1-appareil` \(C1\) est demandée mais ne figure pas/);
  assert.match(texte(pr(section('C1', 'aucun', item('VM-C1-appareil', { analyse: 'à écrire', cochee: true }))).aCorriger), /`VM-C1-appareil` : analyse à écrire/);

  const attente = pr(section('C1', 'aucun', item('VM-C1-appareil')));
  assert.deepEqual(attente.aCorriger, []);
  assert.match(texte(attente.enAttente), /`VM-C1-appareil` : analysée, en attente de validation par un développeur humain/);

  const validee = pr(section('C1', 'aucun', item('VM-C1-appareil', { cochee: true })));
  assert.deepEqual([validee.aCorriger, validee.enAttente, validee.validees], [[], [], ['VM-C1-appareil']]);
});

test('déclarer une entrée demande aussi les vérifications des entrées qui la couvrent, de proche en proche', () => {
  const manquantes = texte(pr(section('I1', 'aucun')).aCorriger);
  assert.match(manquantes, /`VM-U1-parcours` \(I1, par U1\) est demandée/);
  assert.match(manquantes, /`VM-U2-parcours` \(I1, par U2\) est demandée/);
});

test('les commentaires ne comptent pas, un identifiant ou une vérification inconnus non plus', () => {
  const commentee = pr(section('I7', 'aucun', `<!--\n${item('VM-C1-appareil', { cochee: true })}-->\n`));
  assert.match(texte(commentee.aCorriger), /I7 est déclaré mais n'a pas d'entrée/);
  assert.deepEqual(commentee.validees, []);
  assert.match(texte(pr(section('aucun', 'aucun', item('VM-C1-apareil', { cochee: true }))).aCorriger), /`VM-C1-apareil` n'est ni une vérification manuelle/);
});

test('retirer une vérification manuelle ou un harnais du registre demande la même validation', () => {
  const apres = lireRegistre(
    GARDES.replace(/^- \*\*Vérification manuelle\*\* · `VM-C1-appareil`.*\n/m, '').replace(/^- \*\*Harnais\*\* · `a\/test\/un\.test\.ts`.*\n/m, ''),
  ).entrees;
  const retire = (corps) => verifierPr({ entrees: apres, entreesAvant: entrees, corps, fichiersModifies: [] });
  const rouge = texte(retire(section('aucun', 'aucun')).aCorriger);
  assert.match(rouge, /`VM-C1-appareil` \(vérification manuelle retirée\) est demandée/);
  assert.match(rouge, /`I2 · a\/test\/un\.test\.ts` \(harnais retiré\) est demandée/);
  const valide = retire(section('aucun', 'aucun', item('VM-C1-appareil', { cochee: true }) + item('I2 · a/test/un.test.ts', { analyse: 'Renommé en a/test/deux.test.ts.', cochee: true })));
  assert.deepEqual([valide.aCorriger, valide.enAttente], [[], []]);
});

test("la section préparée par « demander » reste rouge tant que l'analyse n'est pas écrite", () => {
  const preparee = preparerSection({ entrees, fichiersModifies: ['b/deux.mjs'], date: '2026-09-11' });
  assert.match(preparee, /^Touchés : C1$/m);
  const r = pr(`Pour #1 : rien.\n\n${preparee}\n`, ['b/deux.mjs']);
  assert.match(texte(r.aCorriger), /« Lien possible masqué : » à remplir/);
  assert.match(texte(r.aCorriger), /`VM-C1-appareil` : analyse à écrire/);
});
