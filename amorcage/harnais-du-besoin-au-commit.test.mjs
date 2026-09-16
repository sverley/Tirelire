/**
 * Amorçage de #127, écrit par la session d'audit du 16 septembre 2026.
 *
 * #127 veut que le pré-commit sépare, parmi les tests qu'il choisit, deux ensembles :
 * - le **harnais du besoin** : les fichiers de test que la branche ajoute ou modifie depuis sa base
 *   commune avec `origin/main`, index compris (Q1) ;
 * - la **non-régression** : tout le reste.
 * La non-régression bloque. Le harnais du besoin est joué et affiché, sans bloquer, sauf une erreur
 * de syntaxe (Q2). Un import introuvable est signalé à part, sans bloquer (Q2). Lectures retenues
 * dans l'issue : seuls les `*.test.*` forment le harnais ; sur `main`, ou sans `origin/main`, tout est
 * non-régression, et le crochet le dit.
 *
 * L'amorçage juge en boîte noire, comme celui de #120 :
 * - il copie le dépôt, en fait un dépôt git et active les crochets par `pnpm crochets` ;
 * - la base porte deux sentinelles, une par lanceur (`node:test` dans la garde, vitest dans le cœur).
 *   Chacune rougit quand un fichier voisin, qui n'est pas un test, contient « cassé » : c'est une
 *   régression causée par du code, sans toucher au fichier de test. Quand il contient « rejet », elle
 *   passe mais laisse une promesse rejetée sans la rattraper : le lanceur échoue sans que ce soit un
 *   test rouge (un `await` oublié) ;
 * - `origin/main` est une référence posée sur la base, et chaque cas part d'une branche `essai-127`.
 * Un test rouge injecté porte un nom propre à l'amorçage : un verdict qui ne le nomme pas ne compte
 * pas comme affiché.
 *
 * Aucune lecture ne compare à la base de la PR (D70) : l'`origin/main` jugé est celui de la copie.
 * Hors programme (D62), à lire dans la PR : la forme exacte des messages, un harnais posé dans un
 * paquet que le commit ne fait pas jouer, le relais et l'hébergement (même lanceur que la garde).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { copieDuDepot, DEPOT, lire, RELIRE } from './test/copie-du-depot.mjs';

const BUDGET_MS = 5000;
const ROUGE = 'amorçage 127 : harnais rouge';
const SENTINELLE = 'amorçage 127 : sentinelle';
const SORTIE = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
const RACINE = copieDuDepot();
// Un `node --test` lancé sous `node --test` hérite de NODE_TEST_CONTEXT et sort en 0 même rouge.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([cle]) => cle !== 'NODE_TEST_CONTEXT'));

function lance(commande, args) {
  const debut = performance.now();
  const r = spawnSync(commande, args, { cwd: RACINE, env: ENV, ...SORTIE });
  const duree = Math.round(performance.now() - debut);
  return { code: r.status, duree, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}
const git = (...args) => lance('git', args);
const fin = (texte) => texte.slice(-3000);

function ecrit(fichier, contenu) {
  const chemin = join(RACINE, fichier);
  mkdirSync(dirname(chemin), { recursive: true });
  if (typeof contenu === 'function') {
    const avant = lire(RACINE, fichier);
    const apres = contenu(avant);
    if (apres === avant) throw new Error(`rien n'a changé dans ${fichier} : ${RELIRE}`);
    contenu = apres;
  }
  writeFileSync(chemin, contenu);
}

// Fichiers de la base et des cas.
const SENT_GARDE = 'packages/gardes/sentinelle-127.test.mjs';
const ETAT_GARDE = 'packages/gardes/sentinelle-127.txt';
const SENT_COEUR = 'packages/core/test/sentinelle-127.test.ts';
const ETAT_COEUR = 'packages/core/src/sentinelle-127.txt';
const HARNAIS_GARDE = 'packages/gardes/harnais-127.test.mjs';
const HARNAIS_COEUR = 'packages/core/test/harnais-127.test.ts';
const DOC = { 'docs/notes-127.md': '# Notes de l’amorçage 127\n' };
const CASSE = 'cassé\n';
const REJET = 'rejet\n';
const REJET_MSG = 'amorçage 127 : rejet non attrapé';

const testRougeNode = (nom) =>
  `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\ntest('${ROUGE} ${nom}', () => assert.equal(1, 2));\n`;
const testRougeVitest = (nom) => `import { expect, it } from 'vitest';\nit('${ROUGE} ${nom}', () => expect(1).toBe(2));\n`;

// Dépendances : liens vers celles du dépôt, à la racine et dans chaque paquet du workspace.
const paquets = ['packages', 'apps'].flatMap((p) => (existsSync(join(DEPOT, p)) ? readdirSync(join(DEPOT, p)).map((n) => `${p}/${n}`) : []));
for (const dossier of ['.', ...paquets]) {
  const source = join(DEPOT, dossier, 'node_modules');
  if (existsSync(source) && existsSync(join(RACINE, dossier))) symlinkSync(source, join(RACINE, dossier, 'node_modules'), 'dir');
}

ecrit(SENT_GARDE, `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
test('${SENTINELLE} garde', () => {
  const etat = readFileSync(new URL('./sentinelle-127.txt', import.meta.url), 'utf8');
  if (/rejet/.test(etat)) Promise.reject(new Error('${REJET_MSG}'));
  assert.doesNotMatch(etat, /cassé/);
});
`);
ecrit(ETAT_GARDE, 'intact\n');
ecrit(SENT_COEUR, `import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('${SENTINELLE} cœur', () => {
  const etat = readFileSync(new URL('../src/sentinelle-127.txt', import.meta.url), 'utf8');
  if (/rejet/.test(etat)) Promise.reject(new Error('${REJET_MSG}'));
  expect(etat).not.toMatch(/cassé/);
});
`);
ecrit(ETAT_COEUR, 'intact\n');

git('init', '-q', '-b', 'main');
git('config', 'user.name', 'amorcage');
git('config', 'user.email', 'amorcage@exemple.invalid');
git('config', 'commit.gpgsign', 'false');
appendFileSync(join(RACINE, '.git', 'info', 'exclude'), '\nnode_modules\n');
git('add', '-A');
git('commit', '-q', '--no-verify', '-m', 'base');
const BASE = git('rev-parse', 'HEAD').sortie.trim();
const ACTIVATION = lance('pnpm', ['crochets']);

function exigeActivation() {
  assert.equal(ACTIVATION.code, 0, `« pnpm crochets » échoue dans la copie :\n${fin(ACTIVATION.sortie)}`);
}

function remet() {
  git('checkout', '-q', '-f', 'main');
  git('reset', '-q', '--hard', BASE);
  git('clean', '-fdq');
  git('branch', '-q', '-D', 'essai-127');
  git('update-ref', 'refs/remotes/origin/main', BASE);
}

/** Repart de la base, sur `branche`, avec `origin/main` sur `origine` (ou sans, si `null`). */
function depart({ branche = 'essai-127', origine = BASE } = {}) {
  exigeActivation();
  remet();
  if (origine === null) git('update-ref', '-d', 'refs/remotes/origin/main');
  else git('update-ref', 'refs/remotes/origin/main', origine);
  if (branche !== 'main') git('checkout', '-q', '-b', branche, BASE);
}

/** Écrit et indexe les fichiers, puis commet avec les crochets. */
function commet(ecritures) {
  for (const [fichier, contenu] of Object.entries(ecritures)) ecrit(fichier, contenu);
  git('add', '--', ...Object.keys(ecritures));
  return lance('git', ['commit', '-q', '-m', 'essai de l’amorçage #127']);
}

function accepte(r, quoi) {
  assert.equal(r.code, 0, `${quoi} : commit refusé :\n${fin(r.sortie)}`);
}
function refuse(r, quoi, nomme) {
  assert.notEqual(r.code, 0, `${quoi} : commit accepté :\n${fin(r.sortie)}`);
  assert.ok(r.sortie.includes(nomme), `${quoi} : le refus ne nomme pas « ${nomme} » :\n${fin(r.sortie)}`);
}
function affiche(r, quoi, nomme) {
  assert.ok(r.sortie.includes(nomme), `${quoi} : le verdict ne nomme pas « ${nomme} » :\n${fin(r.sortie)}`);
}

const durees = [];

test('#127 · base : la copie est prête et ses sentinelles passent le pré-commit', () => {
  depart();
  const r = commet({ [ETAT_GARDE]: 'intact, relu\n', [ETAT_COEUR]: 'intact, relu\n' });
  remet();
  accepte(r, 'sentinelles intactes');
});

test('#127 · un harnais rouge ajouté dans la garde, avec de la documentation, se commet et son verdict s’affiche', () => {
  depart();
  const r = commet({ ...DOC, [HARNAIS_GARDE]: testRougeNode('garde') });
  remet();
  accepte(r, 'harnais rouge de la garde');
  affiche(r, 'harnais rouge de la garde', `${ROUGE} garde`);
});

test('#127 · un harnais rouge ajouté dans le cœur, avec de la documentation, se commet et son verdict s’affiche', () => {
  depart();
  const r = commet({ ...DOC, [HARNAIS_COEUR]: testRougeVitest('cœur') });
  remet();
  durees.push(['harnais rouge du cœur', r.duree]);
  accepte(r, 'harnais rouge du cœur');
  affiche(r, 'harnais rouge du cœur', `${ROUGE} cœur`);
});

test('#127 · un test existant cassé par du code refuse le commit', () => {
  depart();
  const garde = commet({ [ETAT_GARDE]: CASSE });
  depart();
  const coeur = commet({ [ETAT_COEUR]: CASSE });
  remet();
  refuse(garde, 'régression de la garde', `${SENTINELLE} garde`);
  refuse(coeur, 'régression du cœur', `${SENTINELLE} cœur`);
});

test('#127 · une régression refuse le commit, même s’il ajoute un harnais rouge', () => {
  depart();
  const garde = commet({ [ETAT_GARDE]: CASSE, [HARNAIS_GARDE]: testRougeNode('garde') });
  depart();
  const coeur = commet({ [ETAT_COEUR]: CASSE, [HARNAIS_COEUR]: testRougeVitest('cœur') });
  remet();
  durees.push(['régression et harnais du cœur', coeur.duree]);
  refuse(garde, 'régression de la garde avec harnais', `${SENTINELLE} garde`);
  refuse(coeur, 'régression du cœur avec harnais', `${SENTINELLE} cœur`);
});

test('#127 · une erreur non attrapée dans la non-régression refuse le commit, même avec un harnais rouge', () => {
  depart();
  const garde = commet({ [ETAT_GARDE]: REJET, [HARNAIS_GARDE]: testRougeNode('garde') });
  depart();
  const coeur = commet({ [ETAT_COEUR]: REJET, [HARNAIS_COEUR]: testRougeVitest('cœur') });
  remet();
  const fautes = [];
  for (const [r, quoi] of [[garde, 'garde'], [coeur, 'cœur']]) {
    if (r.code === 0) fautes.push(`${quoi} : commit accepté :\n${fin(r.sortie)}`);
    else if (!r.sortie.includes(REJET_MSG)) fautes.push(`${quoi} : le refus ne nomme pas l'erreur « ${REJET_MSG} » :\n${fin(r.sortie)}`);
  }
  assert.deepEqual(fautes, [], `rejet non attrapé dans la non-régression, avec un harnais rouge :\n${fautes.join('\n\n')}`);
});

test('#127 · un test existant que la branche modifie compte dans le harnais du besoin (Q1)', () => {
  depart();
  const garde = commet({ [SENT_GARDE]: (t) => `${t}test('${ROUGE} existant garde', () => assert.equal(1, 2));\n` });
  depart();
  const coeur = commet({ [SENT_COEUR]: (t) => `${t}it('${ROUGE} existant cœur', () => expect(1).toBe(2));\n` });
  remet();
  accepte(garde, 'test existant de la garde rendu rouge');
  affiche(garde, 'test existant de la garde rendu rouge', `${ROUGE} existant garde`);
  accepte(coeur, 'test existant du cœur rendu rouge');
  affiche(coeur, 'test existant du cœur rendu rouge', `${ROUGE} existant cœur`);
});

test('#127 · un harnais commis plus tôt sur la branche reste non bloquant aux commits suivants', () => {
  depart();
  const premier = commet({ [HARNAIS_GARDE]: testRougeNode('garde') });
  const second = commet({ [ETAT_GARDE]: 'intact, relu\n' });
  remet();
  accepte(premier, 'premier commit, harnais rouge');
  accepte(second, 'second commit, harnais déjà commis');
  affiche(second, 'second commit, harnais déjà commis', `${ROUGE} garde`);
});

test('#127 · la base commune, et non la pointe d’origin/main, définit le harnais du besoin', () => {
  depart();
  // origin/main avance sur la sentinelle, que la branche ne touche pas.
  git('checkout', '-q', '--detach', BASE);
  ecrit(SENT_GARDE, (t) => `${t}// main a avancé\n`);
  git('add', '--', SENT_GARDE);
  git('commit', '-q', '--no-verify', '-m', 'main avance');
  const avance = git('rev-parse', 'HEAD').sortie.trim();
  git('checkout', '-q', '-f', 'essai-127');
  git('update-ref', 'refs/remotes/origin/main', avance);
  const r = commet({ [ETAT_GARDE]: CASSE });
  remet();
  refuse(r, 'régression sur un test que seul origin/main a modifié', `${SENTINELLE} garde`);
});

test('#127 · sur main, tout est non-régression : un harnais rouge refuse le commit', () => {
  depart({ branche: 'main' });
  const r = commet({ ...DOC, [HARNAIS_GARDE]: testRougeNode('garde') });
  remet();
  refuse(r, 'harnais rouge commis sur main', `${ROUGE} garde`);
});

test('#127 · sans origin/main, tout est non-régression, et le crochet le dit', () => {
  depart({ origine: null });
  const r = commet({ ...DOC, [HARNAIS_GARDE]: testRougeNode('garde') });
  remet();
  refuse(r, 'harnais rouge sans origin/main', `${ROUGE} garde`);
  assert.match(r.sortie, /origin\/main/, `le refus ne dit pas que origin/main manque :\n${fin(r.sortie)}`);
});

test('#127 · un harnais ajouté en erreur de syntaxe refuse le commit, en le disant (Q2)', () => {
  depart();
  const garde = commet({ [HARNAIS_GARDE]: `import { test } from 'node:test';\ntest('${ROUGE} syntaxe garde', () => {\n` });
  depart();
  const coeur = commet({ [HARNAIS_COEUR]: `import { it } from 'vitest';\nit('${ROUGE} syntaxe cœur', () => {\n` });
  remet();
  for (const [r, quoi, fichier] of [[garde, 'syntaxe cassée dans la garde', 'harnais-127.test.mjs'], [coeur, 'syntaxe cassée dans le cœur', 'harnais-127.test.ts']]) {
    refuse(r, quoi, fichier);
    assert.match(r.sortie, /syntax/i, `${quoi} : le refus ne parle pas de syntaxe :\n${fin(r.sortie)}`);
  }
});

test('#127 · un harnais ajouté dont un import est introuvable est signalé, sans refuser le commit (Q2)', () => {
  depart();
  const garde = commet({ [HARNAIS_GARDE]: `import { rien } from './module-absent-127.mjs';\n${testRougeNode('import garde')}` });
  depart();
  const coeur = commet({ [HARNAIS_COEUR]: `import { rien } from '../src/module-absent-127';\n${testRougeVitest('import cœur')}` });
  remet();
  for (const [r, quoi, fichier] of [[garde, 'import introuvable dans la garde', 'harnais-127.test.mjs'], [coeur, 'import introuvable dans le cœur', 'harnais-127.test.ts']]) {
    accepte(r, quoi);
    affiche(r, quoi, 'module-absent-127');
    affiche(r, quoi, fichier);
  }
});

test('#127 · le pré-commit tient en 5 s avec un harnais du besoin dans le cœur (D73)', () => {
  assert.ok(durees.length === 2, `durées non relevées (${durees.length}/2) : les cas du cœur ont échoué avant la mesure`);
  const lents = durees.filter(([, d]) => d >= BUDGET_MS);
  assert.deepEqual(lents, [], `pré-commit au-delà de ${BUDGET_MS} ms : ${lents.map(([q, d]) => `${q} ${d} ms`).join(', ')}`);
});

const paragraphes = (texte) => texte.replace(/\r\n?/g, '\n').split(/\n\s*\n|\n(?=\s*- )/);

test('#127 · README et CLAUDE.md disent ce que le pré-commit bloque et ce qu’il affiche, sans proposer --no-verify', () => {
  for (const fichier of ['README.md', 'CLAUDE.md']) {
    const texte = lire(RACINE, fichier);
    const dit = paragraphes(texte).some(
      (p) => /pré-commit/.test(p) && /harnais du besoin/.test(p) && /non[- ]régression/i.test(p) && /bloqu|refus/.test(p) && /affich/.test(p),
    );
    assert.ok(dit, `${fichier} ne dit pas, pour le pré-commit, ce que la non-régression bloque et ce que le harnais du besoin ne fait qu'afficher`);
    for (const p of paragraphes(texte).filter((x) => x.includes('--no-verify'))) {
      assert.match(p, /contournement/, `${fichier} cite --no-verify sans le dire contournement : « ${p.trim().slice(0, 200)} »`);
    }
  }
});
