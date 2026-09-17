/**
 * Amorçage de #121, écrit par la session d'audit du 16 septembre 2026.
 *
 * #121 veut que la livraison soit jugée sur l'état commis, et que le harnais du besoin la bloque :
 * - `pre-merge-commit` juge l'arbre fusionné (l'index), et `pre-commit` aussi pendant une fusion ;
 * - le pré-push juge ce qu'il pousse, sauf un arbre déjà vérifié à la fusion ;
 * - un push vers `<branche>--codeur` ou `<branche>--auditeur` ne joue que la non-régression ;
 * - le harnais du besoin (les fichiers de harnais que la branche ajoute ou modifie par rapport à
 *   `main`) est toujours joué, quelle que soit sa finalité, et bloque quand arrivent des commits
 *   absents de `main` qui touchent autre chose que le harnais et la documentation ;
 * - la sélection dépend de la nature du besoin (`packages/gardes/chemins-ignores`) et de la finalité
 *   des tests : fonctionnel, typecheck et tests headless ; organisationnel, garde et amorçages ; les
 *   tests navigateur (`apps/web/test/navigateur/`) restent à la CI ;
 * - aucun seuil ne bloque ; un dépassement de l'objectif de plus de 20 % s'affiche.
 *
 * L'amorçage juge en boîte noire, comme ceux de #120 et #127 :
 * - il copie le dépôt, retire les tests réels des paquets qu'il sonde pour rester rapide, pose ses
 *   sentinelles, en fait un dépôt git, et active les crochets par
 *   `pnpm crochets` ;
 * - `origin` est un dépôt nu local (rien ne sort de la machine, D71), la branche de la PR s'appelle
 *   `essai-121` ;
 * - chaque sentinelle écrit son nom dans le fichier que nomme `COMPTEUR_121` : ce qui a été joué se
 *   lit là, et non dans la forme des messages ;
 * - le harnais du besoin de l'essai vérifie `FAIT` dans `packages/core/src/besoin-121.ts`.
 *
 * Aucune lecture ne compare à la base de la PR (D70). Hors programme (D62), à lire dans la PR : la
 * forme exacte des messages, le cherry-pick (même chemin que le rebase), la sous-branche de
 * l'auditeur (même règle que celle du codeur), l'outil manquant (mécanisme de `TIRELIRE_STRICT`
 * déjà gardé), le passage d'un fichier lent à rapide (la mesure d'un fichier vide est trop proche du
 * démarrage du lanceur), les contournements.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { after, test } from 'node:test';
import { copieDuDepot, DEPOT, lire } from './test/copie-du-depot.mjs';

const SORTIE = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
const RACINE = copieDuDepot();
const DIVERS = mkdtempSync(join(tmpdir(), 'tirelire-amorcage-121-'));
after(() => rmSync(DIVERS, { recursive: true, force: true }));
const ORIGINE = join(DIVERS, 'origine.git');
const COMPTEUR = join(DIVERS, 'joues.txt');
const PR = 'essai-121';
const CODEUR = `${PR}--codeur`;
const AUDITEUR = `${PR}--auditeur`;
// Un `node --test` lancé sous `node --test` hérite de NODE_TEST_CONTEXT et sort en 0 même rouge.
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([cle]) => cle !== 'NODE_TEST_CONTEXT')),
  COMPTEUR_121: COMPTEUR,
};

function lance(commande, args, cwd = RACINE) {
  const debut = performance.now();
  const r = spawnSync(commande, args, { cwd, env: ENV, ...SORTIE });
  const duree = Math.round(performance.now() - debut);
  return { code: r.status, duree, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}
const git = (...args) => lance('git', args);
const fin = (texte) => texte.slice(-3000);
function exige(r, quoi) {
  if (r.code !== 0) throw new Error(`mise en place de l'amorçage : ${quoi} échoue :\n${fin(r.sortie)}`);
  return r.sortie.trim();
}

function ecrit(fichier, contenu) {
  const chemin = join(RACINE, fichier);
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, contenu);
}

// --- Sentinelles -------------------------------------------------------------------------------

const MARQUE = 'amorçage 121';
const trace = (nom) => `if (process.env.COMPTEUR_121) appendFileSync(process.env.COMPTEUR_121, '${nom}\\n');`;
const sentinelleNode = (nom, corps = '') =>
  `import assert from 'node:assert/strict';\nimport { appendFileSync, readFileSync } from 'node:fs';\nimport { test } from 'node:test';\n` +
  `test('${MARQUE} : ${nom}', async () => {\n  ${trace(nom)}\n  assert.ok(true);\n${corps}});\n`;
const sentinelleVitest = (nom, entetes = '', corps = '', titre = nom) =>
  `import { appendFileSync } from 'node:fs';\nimport { expect, it } from 'vitest';\n${entetes}` +
  `it('${MARQUE} : ${titre}', async () => {\n  ${trace(nom)}\n  expect(true).toBe(true);\n${corps}}, 60_000);\n`;

const S = {
  garde: 'packages/gardes/sentinelle-121.test.mjs',
  gardeEtat: 'packages/gardes/sentinelle-121.txt',
  coeur: 'packages/core/test/sentinelle-121.test.ts',
  coeurEtat: 'packages/core/src/sentinelle-121.ts',
  lenteur: 'packages/core/src/lenteur-121.txt',
  besoin: 'packages/core/src/besoin-121.ts',
  harnais: 'packages/core/test/harnais-121.test.ts',
  outil: 'packages/core/src/outil-121.ts',
  usage: 'packages/core/src/usage-121.ts',
  headless: 'apps/web/test/headless-121.test.ts',
  navigateur: 'apps/web/test/navigateur/sentinelle-121.test.ts',
  harnaisNav: 'apps/web/test/navigateur/harnais-121.test.ts',
  amorcage: 'amorcage/sentinelle-121.test.mjs',
};
// Le compteur reçoit le chemin du fichier ; les messages se lisent au nom du fichier, que les
// crochets ne peuvent pas écrire d'eux-mêmes, contrairement à « harnais du besoin ».
const NOM_HARNAIS = 'harnais-121';
// Au-delà de 36 s, la livraison d'un besoin fonctionnel dépasse son objectif (30 s) de plus de 20 %.
const LENTEUR_MS = 37_000;

const harnais = (supplement = '') =>
  sentinelleVitest(S.harnais, `import { FAIT } from '../src/besoin-121.js';\n`, `  expect(FAIT).toBe(true);\n${supplement}`, 'essai harnais-121');
const code = (fait, note) => `export const FAIT: boolean = ${fait}; // ${note}\n`;

// --- Copie ------------------------------------------------------------------------------------

// Les tests réels des paquets sondés sont retirés : seules les sentinelles comptent, et l'amorçage
// reste assez rapide pour la CI. Les modules auxiliaires restent.
function retireTests(dossier) {
  const racine = join(RACINE, dossier);
  if (!existsSync(racine)) return;
  for (const nom of readdirSync(racine)) {
    const chemin = join(racine, nom);
    if (statSync(chemin).isDirectory()) retireTests(`${dossier}/${nom}`);
    else if (/\.test\.[^/]+$/.test(nom)) rmSync(chemin);
  }
}
for (const dossier of ['amorcage', 'packages/gardes', 'packages/core/test', 'apps/web/test']) retireTests(dossier);
const paquets = ['packages', 'apps'].flatMap((p) => (existsSync(join(DEPOT, p)) ? readdirSync(join(DEPOT, p)).map((n) => `${p}/${n}`) : []));
for (const dossier of ['.', ...paquets]) {
  const source = join(DEPOT, dossier, 'node_modules');
  if (existsSync(source) && existsSync(join(RACINE, dossier))) symlinkSync(source, join(RACINE, dossier, 'node_modules'), 'dir');
}

ecrit(S.garde, sentinelleNode(S.garde, `  assert.doesNotMatch(readFileSync(new URL('./sentinelle-121.txt', import.meta.url), 'utf8'), /cassé/);\n`));
ecrit(S.gardeEtat, 'intact\n');
ecrit(S.coeur, sentinelleVitest(
  S.coeur,
  `import { readFileSync } from 'node:fs';\nimport { ETAT } from '../src/sentinelle-121.js';\n`,
  `  expect(ETAT).not.toBe('cassé');\n` +
  `  if (readFileSync(new URL('../src/lenteur-121.txt', import.meta.url), 'utf8').includes('lent')) await new Promise((r) => setTimeout(r, ${LENTEUR_MS}));\n`,
));
ecrit(S.coeurEtat, `export const ETAT: string = 'intact';\n`);
ecrit(S.lenteur, 'rapide\n');
ecrit(S.besoin, code(false, 'base'));
ecrit(S.outil, `export function double(n: number): number {\n  return 2 * n;\n}\n`);
ecrit(S.usage, `import { double } from './outil-121.js';\nexport const QUATRE = double(2);\n`);
ecrit(S.headless, sentinelleVitest(S.headless));
ecrit(S.navigateur, sentinelleVitest(S.navigateur));
ecrit(S.amorcage, sentinelleNode(S.amorcage));

exige(lance('git', ['init', '-q', '--bare', '-b', 'main', ORIGINE], DIVERS), 'git init --bare');
exige(git('init', '-q', '-b', 'main'), 'git init');
git('config', 'user.name', 'amorcage');
git('config', 'user.email', 'amorcage@exemple.invalid');
git('config', 'commit.gpgsign', 'false');
appendFileSync(join(RACINE, '.git', 'info', 'exclude'), '\nnode_modules\n');
exige(git('add', '-A'), 'git add');
exige(git('commit', '-q', '--no-verify', '-m', 'base'), 'commit de base');
const BASE = exige(git('rev-parse', 'HEAD'), 'rev-parse');
exige(git('remote', 'add', 'origin', ORIGINE), 'remote add');
exige(git('push', '-q', '--no-verify', 'origin', 'main', `main:refs/heads/${PR}`), 'push de la base');
const ACTIVATION = lance('pnpm', ['crochets']);

// --- Outils des cas -----------------------------------------------------------------------------

function exigeCrochets() {
  assert.equal(ACTIVATION.code, 0, `« pnpm crochets » échoue dans la copie :\n${fin(ACTIVATION.sortie)}`);
  assert.ok(existsSync(join(RACINE, '.githooks', 'pre-merge-commit')), 'aucun crochet .githooks/pre-merge-commit : la fusion ne juge rien');
}

/** Remet la copie et `origin` sur la base, sans autre branche que main et essai-121. */
function remet() {
  git('merge', '--abort');
  git('rebase', '--abort');
  git('checkout', '-q', '-f', 'main');
  git('reset', '-q', '--hard', BASE);
  git('clean', '-fdq');
  for (const b of exige(git('for-each-ref', '--format=%(refname:short)', 'refs/heads'), 'branches').split('\n')) {
    if (b && b !== 'main') git('branch', '-q', '-D', b);
  }
  const distantes = exige(lance('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], ORIGINE), 'branches distantes');
  for (const ref of distantes.split('\n')) if (ref) lance('git', ['update-ref', '-d', ref], ORIGINE);
  exige(lance('git', ['update-ref', 'refs/heads/main', BASE], ORIGINE), 'origin/main');
  exige(lance('git', ['update-ref', `refs/heads/${PR}`, BASE], ORIGINE), `origin/${PR}`);
  exige(git('fetch', '-q', '--prune', 'origin'), 'fetch');
  rmSync(COMPTEUR, { force: true });
}

function depart() {
  exigeCrochets();
  remet();
}

/** Commit de mise en place, sans crochet : il figure un état déjà commis ailleurs. */
function pose(ecritures, message = 'mise en place de l’amorçage #121') {
  for (const [fichier, contenu] of Object.entries(ecritures)) ecrit(fichier, contenu);
  exige(git('add', '--', ...Object.keys(ecritures)), 'git add');
  exige(git('commit', '-q', '--no-verify', '-m', message), 'commit de mise en place');
  return exige(git('rev-parse', 'HEAD'), 'rev-parse');
}
const branche = (nom, depuis = BASE) => exige(git('checkout', '-q', '-f', '-b', nom, depuis), `checkout ${nom}`);
/** Publie sur origin/<ref> le commit courant, sans crochet : un état déjà livré. */
const publie = (ref) => exige(git('push', '-q', '-f', '--no-verify', 'origin', `HEAD:refs/heads/${ref}`), `push ${ref}`) && git('fetch', '-q', 'origin');

/** L'auditeur a déjà livré son harnais sur la branche de la PR. */
function harnaisLivre(contenu = harnais()) {
  branche('prepa-harnais');
  pose({ [S.harnais]: contenu }, 'harnais du besoin');
  publie(PR);
}

const fusionne = (quoi) => {
  rmSync(COMPTEUR, { force: true });
  return lance('git', ['merge', '--no-edit', quoi]);
};
const pousse = (source, cible) => {
  rmSync(COMPTEUR, { force: true });
  return lance('git', ['push', 'origin', `${source}:refs/heads/${cible}`]);
};
const joues = () => new Set(existsSync(COMPTEUR) ? readFileSync(COMPTEUR, 'utf8').split('\n').filter(Boolean) : []);

function accepte(r, quoi) {
  assert.equal(r.code, 0, `${quoi} : refusé :\n${fin(r.sortie)}`);
}
function refuse(r, quoi, nomme) {
  assert.notEqual(r.code, 0, `${quoi} : accepté :\n${fin(r.sortie)}`);
  assert.ok(r.sortie.includes(nomme), `${quoi} : le refus ne nomme pas « ${nomme} » :\n${fin(r.sortie)}`);
}
function affiche(r, quoi, nomme) {
  assert.ok(r.sortie.includes(nomme), `${quoi} : la sortie ne nomme pas « ${nomme} » :\n${fin(r.sortie)}`);
}
function aJoue(ensemble, attendus, quoi) {
  const manquent = attendus.filter((f) => !ensemble.has(f));
  assert.deepEqual(manquent, [], `${quoi} : pas joués : ${manquent.join(', ')} (joués : ${[...ensemble].join(', ') || 'rien'})`);
}
function naPasJoue(ensemble, exclus, quoi) {
  const joue = exclus.filter((f) => ensemble.has(f));
  assert.deepEqual(joue, [], `${quoi} : joués à tort : ${joue.join(', ')}`);
}

// --- État commis (constats 1 et 2 de #119) -------------------------------------------------------

test('#121 · la pré-fusion juge l’index : un fichier non indexé ne sauve pas une fusion qui ne compile pas', () => {
  depart();
  branche('prepa');
  pose({ [S.besoin]: `import { AUTRE } from './oubli-121.js';\nexport const FAIT: boolean = AUTRE;\n` }, 'import d’un fichier jamais commis');
  publie(PR);
  branche(CODEUR);
  pose({ 'docs/notes-121.md': '# Notes du codeur\n' });
  ecrit('packages/core/src/oubli-121.ts', 'export const AUTRE = false;\n');
  const r = fusionne(`origin/${PR}`);
  remet();
  refuse(r, 'fusion dont l’index importe un fichier non commis', 'oubli-121');
});

test('#121 · la pré-fusion juge l’index : une copie de travail cassée ne refuse pas une fusion saine', () => {
  depart();
  branche('prepa');
  pose({ [S.besoin]: code(false, 'mise à jour de la PR') });
  publie(PR);
  branche(CODEUR);
  pose({ 'docs/notes-121.md': '# Notes du codeur\n' });
  ecrit(S.coeurEtat, `export const ETAT: string = 'cassé';\nexport const X: number = 'pas un nombre';\n`);
  const r = fusionne(`origin/${PR}`);
  const ensemble = joues();
  remet();
  accepte(r, 'fusion saine, copie de travail cassée hors index');
  aJoue(ensemble, [S.coeur], 'fusion saine qui touche le cœur');
});

test('#121 · deux branches vertes dont la fusion ne compile plus : la fusion est refusée', () => {
  depart();
  branche('prepa');
  pose({ [S.outil]: 'export const RIEN = 0;\n', [S.usage]: 'export const QUATRE = 4;\n' }, 'double() retirée');
  publie(PR);
  branche(CODEUR);
  pose({ 'packages/core/src/usage2-121.ts': `import { double } from './outil-121.js';\nexport const HUIT = double(4);\n` }, 'nouvel usage de double()');
  const r = fusionne(`origin/${PR}`);
  remet();
  refuse(r, 'fusion de deux branches vertes incompatibles', 'double');
});

test('#121 · pendant une fusion en conflit, le pré-commit juge l’index', () => {
  depart();
  branche('prepa');
  pose({ [S.besoin]: code(false, 'côté PR') });
  publie(PR);
  branche(CODEUR);
  pose({ [S.besoin]: code(false, 'côté codeur') });
  const conflit = lance('git', ['merge', '--no-edit', `origin/${PR}`]);
  assert.notEqual(conflit.code, 0, `le conflit attendu n’a pas eu lieu :\n${fin(conflit.sortie)}`);
  ecrit(S.besoin, `import { AUTRE } from './oubli-121.js';\nexport const FAIT: boolean = AUTRE;\n`);
  exige(git('add', '--', S.besoin), 'git add de la résolution');
  ecrit('packages/core/src/oubli-121.ts', 'export const AUTRE = false;\n');
  const r = lance('git', ['commit', '--no-edit']);
  remet();
  refuse(r, 'résolution de conflit dont l’index importe un fichier non commis', 'oubli-121');
});

// --- Blocage par le harnais du besoin ------------------------------------------------------------

test('#121 · l’auditeur livre un harnais rouge : la fusion passe en affichant le verdict, le push ne rejoue rien', () => {
  depart();
  branche(AUDITEUR);
  pose({ [S.harnais]: harnais() }, 'harnais du besoin');
  branche(PR, `origin/${PR}`);
  const fusion = fusionne(AUDITEUR);
  const ensemble = joues();
  const push = fusion.code === 0 ? pousse(PR, PR) : null;
  const rejoues = joues();
  remet();
  accepte(fusion, 'fusion du harnais rouge de l’auditeur');
  affiche(fusion, 'fusion du harnais rouge de l’auditeur', NOM_HARNAIS);
  aJoue(ensemble, [S.harnais], 'fusion du harnais de l’auditeur');
  accepte(push, 'livraison du harnais de l’auditeur');
  assert.equal(rejoues.size, 0, `le push rejoue un arbre déjà vérifié à la fusion : ${[...rejoues].join(', ')}`);
});

test('#121 · le codeur livre du code qui laisse le harnais rouge : la fusion et le push sont refusés', () => {
  depart();
  harnaisLivre();
  branche(CODEUR);
  pose({ [S.besoin]: code(false, 'tentative ratée, fusion') });
  branche(PR, `origin/${PR}`);
  const fusion = fusionne(CODEUR);
  remet();
  harnaisLivre();
  branche(PR, `origin/${PR}`);
  pose({ [S.besoin]: code(false, 'tentative ratée, push direct') });
  const push = pousse(PR, PR);
  remet();
  refuse(fusion, 'fusion du code, harnais rouge', NOM_HARNAIS);
  refuse(push, 'push du code, harnais rouge', NOM_HARNAIS);
});

test('#121 · le codeur livre du code qui passe le harnais : la fusion passe, le push ne rejoue rien', () => {
  depart();
  harnaisLivre();
  branche(CODEUR);
  pose({ [S.besoin]: code(true, 'réussite, fusion') });
  branche(PR, `origin/${PR}`);
  const fusion = fusionne(CODEUR);
  const ensemble = joues();
  const push = fusion.code === 0 ? pousse(PR, PR) : null;
  const rejoues = joues();
  remet();
  accepte(fusion, 'fusion du code, harnais vert');
  aJoue(ensemble, [S.harnais, S.coeur], 'fusion du code');
  accepte(push, 'livraison du code vérifié');
  assert.equal(rejoues.size, 0, `le push rejoue un arbre déjà vérifié à la fusion : ${[...rejoues].join(', ')}`);
});

test('#121 · une mise à jour depuis main passe, harnais rouge affiché', () => {
  depart();
  harnaisLivre();
  branche('prepa-main');
  pose({ [S.coeurEtat]: `export const ETAT: string = 'intact'; // main avance\n` }, 'main avance');
  publie('main');
  branche(PR, `origin/${PR}`);
  const r = fusionne('origin/main');
  remet();
  accepte(r, 'mise à jour depuis main, harnais rouge');
  affiche(r, 'mise à jour depuis main, harnais rouge', NOM_HARNAIS);
});

test('#121 · le codeur se met à jour après une correction du harnais : la fusion passe, harnais rouge affiché', () => {
  depart();
  harnaisLivre();
  pose({ [S.harnais]: harnais(`  expect(typeof FAIT).toBe('string');\n`) }, 'correction du harnais');
  publie(PR);
  branche(CODEUR);
  pose({ [S.besoin]: code(true, 'travail en cours du codeur') });
  const r = fusionne(`origin/${PR}`);
  remet();
  accepte(r, 'mise à jour du codeur après correction du harnais');
  affiche(r, 'mise à jour du codeur après correction du harnais', NOM_HARNAIS);
});

// --- Pré-push ----------------------------------------------------------------------------------

test('#121 · un push vers une sous-branche ne joue que la non-régression', () => {
  depart();
  branche(CODEUR);
  pose({ [S.harnais]: harnais() }, 'harnais du besoin');
  pose({ [S.besoin]: code(false, 'travail en cours, sous-branche') });
  const enCours = pousse(CODEUR, CODEUR);
  const ensemble = joues();
  pose({ [S.coeurEtat]: `export const ETAT: string = 'cassé';\n` }, 'régression');
  const regression = pousse(CODEUR, CODEUR);
  remet();
  accepte(enCours, 'push de travail en cours, harnais rouge');
  naPasJoue(ensemble, [S.harnais], 'push vers une sous-branche');
  aJoue(ensemble, [S.coeur], 'push vers une sous-branche qui touche le cœur');
  refuse(regression, 'push d’une régression vers une sous-branche', S.coeur.split('/').pop());
});

test('#121 · un arbre jamais vérifié (rebase) est rejoué au push, avec la même règle', () => {
  depart();
  harnaisLivre();
  branche(CODEUR);
  pose({ [S.besoin]: code(false, 'rebase raté') });
  exige(git('rebase', '-q', `origin/${PR}`), 'rebase');
  const rouge = pousse('HEAD', PR);
  pose({ [S.besoin]: code(true, 'rebase réussi') });
  const vert = pousse('HEAD', PR);
  const ensemble = joues();
  remet();
  refuse(rouge, 'push après rebase, harnais rouge', NOM_HARNAIS);
  accepte(vert, 'push après rebase, harnais vert');
  aJoue(ensemble, [S.harnais, S.coeur], 'push d’un arbre jamais vérifié');
});

// --- Sélection ----------------------------------------------------------------------------------

const outilDeLaGarde = { 'packages/gardes/outil-121.mjs': 'export const OUTIL = 1;\n' };

test('#121 · besoin fonctionnel : tests headless du cœur et de l’interface, ni garde, ni amorçages, ni navigateur', () => {
  depart();
  branche(PR, `origin/${PR}`);
  pose({ [S.besoin]: code(false, 'fonctionnel') });
  const r = pousse(PR, PR);
  const ensemble = joues();
  remet();
  accepte(r, 'livraison fonctionnelle');
  aJoue(ensemble, [S.coeur, S.headless], 'besoin fonctionnel');
  naPasJoue(ensemble, [S.garde, S.amorcage, S.navigateur], 'besoin fonctionnel');
});

test('#121 · besoin organisationnel : garde et amorçages, ni cœur, ni interface, ni navigateur', () => {
  depart();
  branche(PR, `origin/${PR}`);
  pose(outilDeLaGarde, 'outil de la garde');
  const r = pousse(PR, PR);
  const ensemble = joues();
  remet();
  accepte(r, 'livraison organisationnelle');
  aJoue(ensemble, [S.garde, S.amorcage], 'besoin organisationnel');
  naPasJoue(ensemble, [S.coeur, S.headless, S.navigateur], 'besoin organisationnel');
});

test('#121 · un chemin absent de chemins-ignores est organisationnel, et une branche des deux côtés joue les deux sélections', () => {
  depart();
  branche(PR, `origin/${PR}`);
  pose({ 'outils-121/note.mjs': 'export const NOTE = 1;\n', [S.besoin]: code(false, 'mixte') }, 'deux côtés');
  const r = pousse(PR, PR);
  const ensemble = joues();
  remet();
  accepte(r, 'livraison des deux côtés');
  aJoue(ensemble, [S.garde, S.amorcage, S.coeur, S.headless], 'branche des deux côtés');
  naPasJoue(ensemble, [S.navigateur], 'branche des deux côtés');
});

test('#121 · un test navigateur du harnais du besoin est joué à la livraison, les autres restent à la CI', () => {
  depart();
  branche(PR, `origin/${PR}`);
  pose({ [S.harnaisNav]: sentinelleVitest(S.harnaisNav) }, 'harnais navigateur');
  pose({ 'apps/web/src/lib/note-121.ts': 'export const NOTE = 1;\n' }, 'interface');
  const r = pousse(PR, PR);
  const ensemble = joues();
  remet();
  accepte(r, 'livraison de l’interface avec un harnais navigateur');
  aJoue(ensemble, [S.harnaisNav, S.headless], 'harnais navigateur');
  naPasJoue(ensemble, [S.navigateur, S.garde, S.amorcage], 'harnais navigateur');
});

test('#121 · une sélection qui dépasse son objectif de plus de 20 % le signale, sans bloquer', () => {
  depart();
  branche(PR, `origin/${PR}`);
  pose({ [S.lenteur]: 'lent\n' }, 'non-régression lente');
  const r = pousse(PR, PR);
  const ensemble = joues();
  remet();
  accepte(r, `livraison fonctionnelle de plus de ${LENTEUR_MS} ms`);
  aJoue(ensemble, [S.coeur], 'livraison lente');
  assert.match(r.sortie, /objectif/i, `aucun message ne signale le dépassement de l’objectif (${r.duree} ms) :\n${fin(r.sortie)}`);
});

// --- Tri et liste des chemins ------------------------------------------------------------------

const lignesUtiles = (texte) => texte.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

test('#121 · chemins-ignores est en place, et les tests navigateur sont rangés à part', () => {
  const ignores = join(DEPOT, 'packages/gardes/chemins-ignores');
  assert.ok(existsSync(ignores), 'packages/gardes/chemins-ignores manque');
  const chemins = lignesUtiles(readFileSync(ignores, 'utf8'));
  for (const c of ['apps/', 'packages/core/']) assert.ok(chemins.includes(c), `chemins-ignores ne liste pas ${c}`);
  const tests = join(DEPOT, 'apps/web/test');
  const nav = join(tests, 'navigateur');
  assert.ok(existsSync(nav) && readdirSync(nav).some((f) => /\.test\.ts$/.test(f)), 'apps/web/test/navigateur/ ne contient aucun test');
  const horsRang = readdirSync(tests)
    .filter((f) => /\.test\.ts$/.test(f))
    .filter((f) => /ouvrirLeSite\s*\(/.test(readFileSync(join(tests, f), 'utf8')));
  assert.deepEqual(horsRang, [], 'des tests qui ouvrent le navigateur restent hors de apps/web/test/navigateur/');
});

// --- Documentation -----------------------------------------------------------------------------

const paragraphes = (texte) => texte.replace(/\r\n?/g, '\n').split(/\n\s*\n|\n(?=\s*- )/);

test('#121 · CLAUDE.md décrit les sous-branches et le circuit d’un harnais corrigé ; plus d’attente de #121', () => {
  const texte = lire(DEPOT, 'CLAUDE.md');
  const paras = paragraphes(texte);
  assert.ok(paras.some((p) => p.includes('--codeur') && p.includes('--auditeur')), 'CLAUDE.md ne nomme pas les sous-branches --codeur et --auditeur');
  assert.ok(
    paras.some((p) => /harnais/.test(p) && /auditeur/.test(p) && /corrig/.test(p) && /rebase|fusionn/.test(p) && /livr/.test(p)),
    'CLAUDE.md ne décrit pas le circuit : harnais corrigé par l’auditeur, codeur qui rebase ou fusionne, puis livre',
  );
  for (const fichier of ['CLAUDE.md', 'README.md']) {
    assert.doesNotMatch(lire(DEPOT, fichier), /en attendant (que )?#121/, `${fichier} attend encore #121`);
  }
});
