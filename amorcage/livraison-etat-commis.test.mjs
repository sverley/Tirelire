/**
 * Amorçage de #121, écrit par la session d'audit du 16 septembre 2026.
 *
 * #121 veut que la livraison soit jugée sur l'état commis, en moins de 30 s, et que le harnais du
 * besoin la bloque :
 * - `pre-merge-commit` juge l'arbre fusionné (l'index), et `pre-commit` aussi pendant une fusion ;
 * - le pré-push juge ce qu'il pousse, sauf un arbre déjà vérifié à la fusion ;
 * - un push vers `<branche>--codeur` ou `<branche>--auditeur` ne joue que la non-régression ;
 * - le harnais du besoin (les fichiers de harnais que la branche ajoute ou modifie par rapport à
 *   `main`) est toujours joué, et bloque quand arrivent des commits absents de `main` qui touchent
 *   autre chose que le harnais et la documentation ;
 * - la sélection dépend du côté touché (`packages/gardes/chemins-ignores`), et le registre
 *   `packages/gardes/durees-harnais` classe les fichiers rapides ou lents, avec des marges (Q1 et Q2
 *   de l'audit) ; `pnpm durees` le tient à jour.
 *
 * L'amorçage juge en boîte noire, comme ceux de #120 et #127 :
 * - il copie le dépôt, retire les tests réels des paquets qu'il sonde pour rester rapide, pose ses
 *   sentinelles et son propre registre, en fait un dépôt git, et active les crochets par
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

const BUDGET_MS = 30_000;
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
const sentinelleVitest = (nom, entetes = '', corps = '') =>
  `import { appendFileSync } from 'node:fs';\nimport { expect, it } from 'vitest';\n${entetes}` +
  `it('${MARQUE} : ${nom}', () => {\n  ${trace(nom)}\n  expect(true).toBe(true);\n${corps}});\n`;

const S = {
  garde: 'packages/gardes/sentinelle-121.test.mjs',
  gardeEtat: 'packages/gardes/sentinelle-121.txt',
  coeur: 'packages/core/test/sentinelle-121.test.ts',
  coeurEtat: 'packages/core/src/sentinelle-121.ts',
  besoin: 'packages/core/src/besoin-121.ts',
  harnais: 'packages/core/test/harnais-121.test.ts',
  outil: 'packages/core/src/outil-121.ts',
  usage: 'packages/core/src/usage-121.ts',
  webRapide: 'apps/web/test/rapide-121.test.ts',
  webLent: 'apps/web/test/lent-121.test.ts',
  amoRapide: 'amorcage/rapide-121.test.mjs',
  amoLent: 'amorcage/lent-121.test.mjs',
  amoAbsent: 'amorcage/absent-121.test.mjs',
  budgetA: 'amorcage/budget-a-121.test.mjs',
  budgetB: 'amorcage/budget-b-121.test.mjs',
  budgetC: 'amorcage/budget-c-121.test.mjs',
  registre: 'packages/gardes/durees-harnais',
};
const NOM_HARNAIS = 'harnais du besoin';

const registre = ({ budget = 30, margeBudget = 10 } = {}) => `# Registre de l'amorçage 121
seuil 2
marge 1
budget ${budget}
marge-budget ${margeBudget}
rapide 0.25 ${S.garde}
rapide 0.25 ${S.coeur}
rapide 0.25 ${S.webRapide}
lent 20 ${S.webLent}
rapide 0.25 ${S.amoRapide}
lent 50 ${S.amoLent}
rapide 0.25 ${S.budgetA}
rapide 0.125 ${S.budgetB}
rapide 0.5 ${S.budgetC}
`;
// Budget réduit : 1 s planifiée. Passent b (0,125), puis a, la sentinelle de la garde et l'amorçage
// rapide (0,25 chacun) : 0,875 s. c (0,5) dépasse, et l'absent (planifié pour le seuil) aussi.
const REGISTRE_ETROIT = registre({ budget: 2, margeBudget: 1 });

const harnais = (supplement = '') =>
  sentinelleVitest(NOM_HARNAIS, `import { FAIT } from '../src/besoin-121.js';\n`, `  expect(FAIT).toBe(true);\n${supplement}`);
const code = (fait, note) => `export const FAIT: boolean = ${fait}; // ${note}\n`;

// --- Copie ------------------------------------------------------------------------------------

// Les tests réels des paquets sondés sont retirés : seules les sentinelles comptent, et l'amorçage
// reste assez rapide pour la CI. Les modules auxiliaires restent.
for (const dossier of ['amorcage', 'packages/gardes', 'packages/core/test', 'apps/web/test']) {
  for (const nom of readdirSync(join(RACINE, dossier))) {
    const chemin = join(RACINE, dossier, nom);
    if (/\.test\.[^/]+$/.test(nom) && statSync(chemin).isFile()) rmSync(chemin);
  }
}
const paquets = ['packages', 'apps'].flatMap((p) => (existsSync(join(DEPOT, p)) ? readdirSync(join(DEPOT, p)).map((n) => `${p}/${n}`) : []));
for (const dossier of ['.', ...paquets]) {
  const source = join(DEPOT, dossier, 'node_modules');
  if (existsSync(source) && existsSync(join(RACINE, dossier))) symlinkSync(source, join(RACINE, dossier, 'node_modules'), 'dir');
}

ecrit(S.garde, sentinelleNode(S.garde, `  assert.doesNotMatch(readFileSync(new URL('./sentinelle-121.txt', import.meta.url), 'utf8'), /cassé/);\n`));
ecrit(S.gardeEtat, 'intact\n');
ecrit(S.coeur, sentinelleVitest(S.coeur, `import { ETAT } from '../src/sentinelle-121.js';\n`, `  expect(ETAT).not.toBe('cassé');\n`));
ecrit(S.coeurEtat, `export const ETAT: string = 'intact';\n`);
ecrit(S.besoin, code(false, 'base'));
ecrit(S.outil, `export function double(n: number): number {\n  return 2 * n;\n}\n`);
ecrit(S.usage, `import { double } from './outil-121.js';\nexport const QUATRE = double(2);\n`);
ecrit(S.webRapide, sentinelleVitest(S.webRapide));
ecrit(S.webLent, sentinelleVitest(S.webLent));
for (const f of [S.amoRapide, S.amoLent, S.amoAbsent, S.budgetA, S.budgetB, S.budgetC]) ecrit(f, sentinelleNode(f));
ecrit(S.registre, registre());

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

const durees = [];

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

test('#121 · une branche organisationnelle joue la garde et les amorçages rapides, et nomme les lents', () => {
  depart();
  branche(PR, `origin/${PR}`);
  pose({ 'packages/gardes/outil-121.mjs': 'export const OUTIL = 1;\n' }, 'outil de la garde');
  const r = pousse(PR, PR);
  const ensemble = joues();
  remet();
  accepte(r, 'livraison organisationnelle');
  aJoue(ensemble, [S.garde, S.amoRapide, S.amoAbsent, S.budgetA, S.budgetB, S.budgetC], 'branche organisationnelle');
  naPasJoue(ensemble, [S.amoLent, S.coeur, S.webRapide, S.webLent], 'branche organisationnelle');
  affiche(r, 'amorçage lent laissé à la CI', S.amoLent);
});

test('#121 · une branche fonctionnelle du cœur joue le cœur, sans la garde ni les amorçages', () => {
  depart();
  branche(PR, `origin/${PR}`);
  pose({ [S.besoin]: code(false, 'fonctionnelle') });
  const r = pousse(PR, PR);
  const ensemble = joues();
  remet();
  durees.push(['livraison fonctionnelle du cœur', r.duree]);
  accepte(r, 'livraison fonctionnelle du cœur');
  aJoue(ensemble, [S.coeur], 'branche fonctionnelle du cœur');
  naPasJoue(ensemble, [S.garde, S.amoRapide, S.amoAbsent, S.amoLent, S.webLent], 'branche fonctionnelle du cœur');
});

test('#121 · une branche fonctionnelle de l’interface joue ses tests rapides et nomme les lents', () => {
  depart();
  branche(PR, `origin/${PR}`);
  pose({ 'apps/web/src/lib/note-121.ts': 'export const NOTE = 1;\n' }, 'interface');
  const r = pousse(PR, PR);
  const ensemble = joues();
  remet();
  accepte(r, 'livraison fonctionnelle de l’interface');
  aJoue(ensemble, [S.webRapide], 'branche fonctionnelle de l’interface');
  naPasJoue(ensemble, [S.webLent, S.garde, S.amoRapide], 'branche fonctionnelle de l’interface');
  affiche(r, 'test d’interface lent laissé à la CI', S.webLent);
});

test('#121 · un chemin absent de chemins-ignores est organisationnel, et une branche des deux côtés joue les deux', () => {
  depart();
  branche(PR, `origin/${PR}`);
  pose({ 'outils-121/note.mjs': 'export const NOTE = 1;\n', [S.besoin]: code(false, 'mixte') }, 'deux côtés');
  const r = pousse(PR, PR);
  const ensemble = joues();
  remet();
  accepte(r, 'livraison des deux côtés');
  aJoue(ensemble, [S.garde, S.amoRapide, S.coeur], 'branche des deux côtés');
});

test('#121 · le budget du registre arrête la sélection, du plus court au plus long, et nomme le reste', () => {
  depart();
  branche(PR, `origin/${PR}`);
  pose({ [S.registre]: REGISTRE_ETROIT, 'packages/gardes/outil-121.mjs': 'export const OUTIL = 2;\n' }, 'budget réduit');
  const r = pousse(PR, PR);
  const ensemble = joues();
  remet();
  accepte(r, 'livraison sous budget réduit');
  aJoue(ensemble, [S.budgetB, S.budgetA, S.garde, S.amoRapide], 'budget réduit');
  naPasJoue(ensemble, [S.budgetC, S.amoAbsent], 'budget réduit');
  affiche(r, 'fichier laissé à la CI par le budget', S.budgetC);
  affiche(r, 'fichier absent du registre laissé à la CI par le budget', S.amoAbsent);
});

test('#121 · une livraison fonctionnelle du cœur tient en 30 s', () => {
  assert.equal(durees.length, 1, 'durée non relevée : le cas fonctionnel du cœur a échoué avant la mesure');
  const lents = durees.filter(([, d]) => d >= BUDGET_MS);
  assert.deepEqual(lents, [], `livraison au-delà de ${BUDGET_MS} ms : ${lents.map(([q, d]) => `${q} ${d} ms`).join(', ')}`);
});

// --- Registre des durées et commande ------------------------------------------------------------

const lignesUtiles = (texte) => texte.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

test('#121 · chemins-ignores et le registre des durées sont en place dans le dépôt', () => {
  const ignores = join(DEPOT, 'packages/gardes/chemins-ignores');
  assert.ok(existsSync(ignores), 'packages/gardes/chemins-ignores manque');
  const chemins = lignesUtiles(readFileSync(ignores, 'utf8'));
  for (const c of ['apps/', 'packages/core/']) assert.ok(chemins.includes(c), `chemins-ignores ne liste pas ${c}`);
  const fichier = join(DEPOT, S.registre);
  assert.ok(existsSync(fichier), `${S.registre} manque`);
  const lignes = lignesUtiles(readFileSync(fichier, 'utf8'));
  for (const reglage of ['seuil', 'marge', 'budget', 'marge-budget']) {
    assert.ok(lignes.some((l) => new RegExp(`^${reglage} \\d+(\\.\\d+)?$`).test(l)), `le registre n'a pas de réglage « ${reglage} <s> »`);
  }
  const fautives = lignes.filter((l) => !/^(seuil|marge|budget|marge-budget) \d+(\.\d+)?$/.test(l) && !/^(rapide|lent) \d+(\.\d+)? \S/.test(l));
  assert.deepEqual(fautives, [], 'lignes du registre hors format');
  assert.ok(lignes.some((l) => /^(rapide|lent) /.test(l)), 'le registre ne classe aucun fichier');
});

const DUREE = {
  nouveauCourt: ['packages/gardes/duree-121-nouveau-court.test.mjs', 0],
  nouveauLong: ['packages/gardes/duree-121-nouveau-long.test.mjs', 2500],
  rapideMarge: ['packages/gardes/duree-121-rapide-marge.test.mjs', 1300],
  lentMarge: ['packages/gardes/duree-121-lent-marge.test.mjs', 500],
  rapideLong: ['packages/gardes/duree-121-rapide-long.test.mjs', 2600],
};
// seuil 1, marge 0,8 : rapide jusqu'à 1 s pour un nouveau, lent au-delà de 1,8 s, rapide en deçà de 0,2 s.
const REGISTRE_DUREES = `# Registre de l'amorçage 121, commande
seuil 1
marge 0.8
budget 30
marge-budget 10
rapide 0.25 ${S.amoRapide}
rapide 0.5 ${DUREE.rapideMarge[0]}
lent 5 ${DUREE.lentMarge[0]}
rapide 0.5 ${DUREE.rapideLong[0]}
`;
const classes = (texte) => new Map(lignesUtiles(texte).map((l) => l.match(/^(rapide|lent) (\S+) (.+)$/)).filter(Boolean).map((m) => [m[3], [m[1], Number(m[2])]]));

test('#121 · pnpm durees mesure chaque fichier et le classe, avec les marges', () => {
  depart();
  for (const [fichier, ms] of Object.values(DUREE)) {
    ecrit(fichier, sentinelleNode(fichier, `  await new Promise((r) => setTimeout(r, ${ms}));\n`));
  }
  ecrit(S.registre, REGISTRE_DUREES);
  const cibles = Object.values(DUREE).map(([f]) => f);
  const r = lance('pnpm', ['durees', ...cibles]);
  const apres = lire(RACINE, S.registre);
  ecrit(S.registre, REGISTRE_DUREES);
  const verif = lance('pnpm', ['durees', '--verifier', DUREE.nouveauLong[0], DUREE.rapideMarge[0]]);
  const intact = lire(RACINE, S.registre) === REGISTRE_DUREES;
  remet();
  assert.equal(r.code, 0, `pnpm durees échoue :\n${fin(r.sortie)}`);
  const lu = classes(apres);
  const attendu = {
    nouveauCourt: 'rapide', nouveauLong: 'lent', rapideMarge: 'rapide', lentMarge: 'lent', rapideLong: 'lent',
  };
  const ecarts = Object.entries(attendu).filter(([cle, classe]) => lu.get(DUREE[cle][0])?.[0] !== classe)
    .map(([cle, classe]) => `${DUREE[cle][0]} : ${lu.get(DUREE[cle][0])?.[0] ?? 'absent'} au lieu de ${classe}`);
  assert.deepEqual(ecarts, [], `classes écrites par pnpm durees :\n${apres}`);
  assert.ok(lu.get(DUREE.nouveauLong[0])[1] >= 2, `durée écrite pour un fichier de 2,5 s : ${lu.get(DUREE.nouveauLong[0])[1]}`);
  assert.deepEqual(lu.get(S.amoRapide), ['rapide', 0.25], 'pnpm durees a réécrit un fichier qu’on ne lui demandait pas de mesurer');
  assert.equal(verif.code, 0, `pnpm durees --verifier ne sort pas en 0 :\n${fin(verif.sortie)}`);
  assert.ok(intact, 'pnpm durees --verifier a réécrit le registre');
  affiche(verif, 'pnpm durees --verifier, fichier absent du registre', DUREE.nouveauLong[0]);
  assert.ok(!verif.sortie.includes(DUREE.rapideMarge[0]), `pnpm durees --verifier signale un fichier resté dans sa marge :\n${fin(verif.sortie)}`);
});

test('#121 · la CI vérifie le registre sur chaque PR', () => {
  const dossier = join(DEPOT, '.github/workflows');
  const flux = readdirSync(dossier).filter((f) => /\.ya?ml$/.test(f)).map((f) => readFileSync(join(dossier, f), 'utf8'));
  assert.ok(
    flux.some((t) => /^\s*pull_request\s*:?/m.test(t) && /pnpm durees --verifier/.test(t)),
    'aucun workflow déclenché sur les PR ne joue « pnpm durees --verifier »',
  );
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
