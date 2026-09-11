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
import { verifierPrSurGithub } from './github.mjs';
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
const item = (cle, { analyse = "La PR change l'écran Plan : le regarder à 375 px.", cochee = false } = {}) =>
  `- \`${cle}\` · essai${consigneDe(cle) ? ` — ${consigneDe(cle)}` : ''}\n  - Analyse (agent, 2026-09-11) : ${analyse}\n  - [${cochee ? 'x' : ' '}] Validée par un développeur humain\n`;

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

test('une vérification manuelle recopie sa consigne du registre, coupée ou non, et la déclaration se lit comme GitHub l’affiche (#60)', () => {
  const avec = (tete, suite = '') => section('U2', 'aucun', `- \`VM-U2-parcours\` · U2${tete}\n${suite}  - Analyse (agent, 2026-09-11) : relu.\n  - [x] Validée par un développeur humain\n`);
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

// ─── Validations enregistrées, et annulées par une modification postérieure (#61) ─────────────

const TETE = 'a'.repeat(40);
const NOUVELLE = 'b'.repeat(40);
const ANALYSE = "La PR change l'écran Plan : le regarder à 375 px.";
const enregistree = (extra = {}) => ({ cle: 'VM-C1-appareil', tete: TETE, cible: 'main', analyse: V.empreinteAnalyse(ANALYSE), par: 'sverley', date: '2026-09-11T10:42:00.000Z', ...extra });
const duBot = (...h) => ({ user: { login: V.AUTEUR_HORODATAGE }, body: V.texteHorodatage(h) });
const valider = (corps, validations) => verifierPr({ entrees, corps, fichiersModifies: [], validations });
const ouverte = section('C1', 'aucun', item('VM-C1-appareil'));
const cochee = (analyse = ANALYSE) => section('C1', 'aucun', item('VM-C1-appareil', { analyse, cochee: true }));

function fauxGithub(corps, { tete = TETE, cible = 'main', commentaires = [] } = {}) {
  const etat = { pr: { number: 7, body: corps, head: { sha: tete }, base: { ref: cible } }, commentaires: [...commentaires], descriptions: 0 };
  const api = {
    lirePr: async () => structuredClone(etat.pr),
    lireCommentaires: async () => structuredClone(etat.commentaires),
    commenter: async (_n, body) => void etat.commentaires.push({ user: { login: V.AUTEUR_HORODATAGE }, body }),
    modifierDescription: async (_n, body) => void ((etat.pr.body = body), etat.descriptions++),
  };
  return { etat, api };
}
const surEvenement = (etat, action, extra = {}) => ({ action, sender: { login: 'sverley' }, pull_request: structuredClone(etat.pr), ...extra });
const github = (evenement, api, fichiersDepuis = () => ['apps/web/src/App.svelte']) =>
  verifierPrSurGithub({ evenement, api, entrees, fichiersModifies: [], fichiersDepuis, attendre: async () => {} });

test("sur GitHub, une case cochée ne vaut validation qu'enregistrée pour l'état actuel de la PR", () => {
  const horodatages = V.lireHorodatages([duBot(enregistree())]);
  assert.deepEqual(valider(cochee(), { tete: TETE, cible: 'main', horodatages }).validees, ['VM-C1-appareil']);
  const sans = valider(cochee(), { tete: TETE, cible: 'main', horodatages: [] });
  assert.deepEqual([sans.validees, sans.nonEnregistrees], [[], ['VM-C1-appareil']]);
  assert.match(texte(sans.enAttente), /case cochée sans validation enregistrée/);
  // Un commentaire qui imite l'enregistrement, écrit avec un compte ordinaire, ne valide rien.
  assert.deepEqual(V.lireHorodatages([{ user: { login: 'sverley' }, body: V.texteHorodatage([enregistree()]) }]), []);
});

test('seule une modification postérieure du code annule la validation ; documentation, harnais et analyse, non', () => {
  const horodatages = V.lireHorodatages([duBot(enregistree())]);
  const apres = (fichiers, cible = 'main') => ({ tete: NOUVELLE, cible, horodatages, fichiersDepuis: () => fichiers });
  const code = valider(cochee(), apres(['docs/x.md', 'apps/web/src/App.svelte']));
  assert.deepEqual([code.validees, code.annulees.map((a) => a.cle)], [[], ['VM-C1-appareil']]);
  assert.match(texte(code.enAttente), /validation annulée, code modifié depuis la validation, de aaaaaaa à bbbbbbb : apps\/web\/src\/App\.svelte\./);
  assert.doesNotMatch(texte(code.enAttente), /docs\/x\.md/);

  const sansCode = valider(cochee('Une autre analyse, réécrite après la validation.'), apres(['docs/x.md', 'README.md', 'apps/web/test/harnais.ts', 'packages/core/test/plan.test.ts']));
  assert.deepEqual([sansCode.aCorriger, sansCode.enAttente, sansCode.validees], [[], [], ['VM-C1-appareil']]);

  assert.match(texte(valider(cochee(), apres([], 'autre')).enAttente), /branche cible changée, de main à autre/);
  assert.match(texte(valider(cochee(), apres(null)).enAttente), /impossibles à comparer/);
});

test('documentation et harnais ne sont pas du code, et docs/gardes.md cite leurs motifs', () => {
  const nonCode = ['README.md', 'CLAUDE.md', '.github/pull_request_template.md', 'docs/analyse-du-besoin.html', 'apps/web/test/harnais.ts', 'packages/core/test/plan.test.ts', 'apps/relay/server.test.mjs', 'packages/gardes/gardes.test.mjs'];
  const code = ['apps/web/src/App.svelte', 'package.json', 'pnpm-lock.yaml', '.github/workflows/ci.yml', 'apps/web/vitest.config.ts', 'packages/gardes/gardes.mjs', 'apps/hebergement/verifier.sh'];
  assert.deepEqual(V.fichiersDeCode([...nonCode, ...code]), code);
  const registre = lire(DOCUMENTS.gardes);
  for (const motif of [...V.SANS_EFFET.documentation, ...V.SANS_EFFET.harnais]) assert.ok(registre.includes(`\`${motif}\``), `${motif} manque dans ${DOCUMENTS.gardes}`);
});

test("sur un vrai dépôt : une fusion propre de la cible n'apporte aucun fichier, une résolution de conflit si", () => {
  const racine = mkdtempSync(join(tmpdir(), 'gardes-validation-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !cle.startsWith('GIT_')));
  try {
    const g = (...a) => execFileSync('git', ['-c', 'user.name=Essai', '-c', 'user.email=essai@exemple.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: racine, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const ecrire = (fichier, contenu) => {
      mkdirSync(dirname(join(racine, fichier)), { recursive: true });
      writeFileSync(join(racine, fichier), contenu);
    };
    const commit = (message) => (g('add', '-A'), g('commit', '-q', '-m', message), g('rev-parse', 'HEAD'));
    const depuis = (ancienne) => V.fichiersDepuisValidation({ ancienne, base: g('rev-parse', 'main'), tete: g('rev-parse', 'HEAD'), racine });
    g('init', '-q', '-b', 'main');
    ecrire('src/a.ts', 'a\nb\nc\n');
    ecrire('src/b.ts', 'x\n');
    ecrire('docs/x.md', 'doc\n');
    commit('départ');
    g('checkout', '-q', '-b', 'pr');
    ecrire('src/a.ts', 'A\nb\nc\n');
    const validee = commit('le code de la PR, validé');
    g('checkout', '-q', 'main');
    ecrire('src/b.ts', 'y\n');
    commit('main avance');
    g('checkout', '-q', 'pr');
    ecrire('docs/x.md', 'doc revue\n');
    ecrire('pkg/test/a.test.ts', 'garde\n');
    commit('documentation et harnais');
    g('merge', '-q', '--no-edit', 'main');
    assert.deepEqual(depuis(validee).sort(), ['docs/x.md', 'pkg/test/a.test.ts']);

    g('checkout', '-q', 'main');
    ecrire('src/a.ts', 'Z\nb\nc\n');
    commit('main touche la même ligne');
    g('checkout', '-q', 'pr');
    assert.throws(() => g('merge', '-q', '--no-edit', 'main'));
    ecrire('src/a.ts', 'AZ\nb\nc\n');
    commit('conflit résolu dans le code');
    assert.deepEqual(V.fichiersDeCode(depuis(validee)), ['src/a.ts']);
    assert.equal(depuis('f'.repeat(40)), null);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test('décocher ne touche que les cases désignées', () => {
  const corps = section('C1', 'aucun', item('VM-C1-appareil', { cochee: true }) + item('VM-C1-autre', { cochee: true }));
  const apres = V.decocher(corps, ['VM-C1-appareil']);
  assert.deepEqual([...V.cochees(apres)], ['VM-C1-autre']);
  assert.equal(apres.replace('- [ ] Validée', '- [x] Validée'), corps);
});

test('cocher la case enregistre la validation, et la vérification passe au vert', async () => {
  const { etat, api } = fauxGithub(cochee());
  const r = await github(surEvenement(etat, 'edited', { changes: { body: { from: ouverte } } }), api);
  assert.deepEqual([r.aCorriger, r.enAttente, r.validees], [[], [], ['VM-C1-appareil']]);
  assert.match(etat.commentaires[0].body, /\*\*Validation enregistrée\*\* par sverley/);
  assert.deepEqual(V.lireHorodatages(etat.commentaires).map((h) => [h.cle, h.tete, h.cible]), [['VM-C1-appareil', TETE, 'main']]);
});

test("un commit de code poussé après la validation l'annule : la case se décoche et la vérification redevient rouge", async () => {
  const { etat, api } = fauxGithub(cochee(), { tete: NOUVELLE, commentaires: [duBot(enregistree())] });
  const r = await github(surEvenement(etat, 'synchronize'), api);
  assert.deepEqual(r.validees, []);
  assert.match(texte(r.enAttente), /analysée, en attente de validation/);
  assert.deepEqual([...V.cochees(etat.pr.body)], []);
  assert.match(etat.commentaires.at(-1).body, /\*\*Validation annulée\*\*[\s\S]*code modifié depuis la validation, de aaaaaaa à bbbbbbb : apps\/web\/src\/App\.svelte/);
});

test("un commit de documentation ou de harnais, ou l'analyse réécrite, laissent la validation en place", async () => {
  const autre = cochee('Une autre analyse, réécrite après la validation.');
  const { etat, api } = fauxGithub(autre, { tete: NOUVELLE, commentaires: [duBot(enregistree())] });
  const r = await github(surEvenement(etat, 'synchronize'), api, () => ['docs/gardes.md', 'packages/gardes/gardes.test.mjs']);
  assert.deepEqual([r.aCorriger, r.enAttente, r.validees], [[], [], ['VM-C1-appareil']]);
  assert.deepEqual([[...V.cochees(etat.pr.body)], etat.descriptions, etat.commentaires.length], [['VM-C1-appareil'], 0, 1]);
});

test("une case cochée à l'ouverture ou juste avant un push n'est pas une validation", async () => {
  const ouverture = fauxGithub(cochee());
  const r = await github(surEvenement(ouverture.etat, 'opened'), ouverture.api);
  assert.deepEqual([r.validees, [...V.cochees(ouverture.etat.pr.body)], V.lireHorodatages(ouverture.etat.commentaires)], [[], [], []]);

  const push = fauxGithub(cochee(), { tete: NOUVELLE });
  const evenement = surEvenement(push.etat, 'edited', { changes: { body: { from: ouverte } } });
  evenement.pull_request.head.sha = TETE; // la case a été cochée sur la tête d'avant le push
  const avantPush = await github(evenement, push.api);
  assert.deepEqual([avantPush.validees, V.lireHorodatages(push.etat.commentaires)], [[], []]);
  assert.match(texte(avantPush.enAttente), /La PR a changé pendant la validation/);
  assert.equal(push.etat.descriptions, 0, 'une vérification en retard ne décoche rien');
});

// ─── Formes voisines et tests nommés (#59) ────────────────────────────────────────────────────

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
    "it.skipIf(false)('conditionnel', () => {});",
    "// it('en commentaire', () => {});",
    "/* describe('en bloc', () => { it('dans le bloc', () => {}); }); */",
  ].join('\n');
  const { actifs, inactifs } = V.analyserTests(source);
  assert.deepEqual([...actifs], ['positions et soldes (D19, D29)', "budget construit par l'assistant (D40)", 'un titre en gabarit', 'option sans effet', 'conditionnel']);
  assert.deepEqual([...inactifs], ['désactivé', 'seulement prévu', 'sans test actif', 'en pause', 'suite désactivée', 'dans la suite désactivée', 'option skip']);
  assert.deepEqual([...V.titresDeTests(source)], [...actifs]);
  assert.equal(V.testNomme("« budget construit par  l'assistant (D40) » : sans aucune opération"), "budget construit par l'assistant (D40)");
  assert.equal(V.testNomme('moteur de règles de classement.'), null);

  const documents = {
    invariants: '## I1 · Premier\n',
    contraintes: '',
    gardes: '## I1 · Premier\n\n- **Harnais** · `a/un.test.ts`, `a/deux.test.ts` — « le test\n  nommé » : garde I1.\n',
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
