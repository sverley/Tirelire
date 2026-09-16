/**
 * Amorçage de #120, écrit par la session d'audit de #119.
 *
 * #120 veut des crochets suivis dans le dépôt (`.githooks/`), activés par `pnpm crochets`, qui pose
 * aussi `merge.ff false`, et un pré-commit sous 5 s. Le pré-push garde le typecheck en attendant #121. Ce pré-commit choisit ses tests d'après les
 * fichiers du commit (l'index) et les joue sur la copie de travail. Les règles sont celles que
 * `CLAUDE.md` nomme pour `VM-regles-primaires`.
 *
 * L'amorçage juge en boîte noire :
 * - il copie le dépôt et en fait un dépôt git ;
 * - il active les crochets par la commande documentée ;
 * - il commet des changements choisis et lit le verdict de git.
 * Les dépendances de la copie sont des liens vers celles du dépôt. Chaque cas part du même commit de
 * base et y revient. Un test rouge injecté porte un nom propre à l'amorçage : un refus qui ne le nomme
 * pas ne compte pas comme une détection.
 *
 * Les durées se mesurent sur la machine qui joue l'amorçage : le budget de 5 s s'y tient ou non. La
 * prose (README, CLAUDE.md, décision) se juge par présence textuelle (D62).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { after, test } from 'node:test';
import { copieDuDepot, DEPOT, lire, RELIRE } from './test/copie-du-depot.mjs';

const BUDGET_MS = 5000;
const ROUGE = 'amorçage 120 : test rouge';
const SORTIE = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
const RACINE = copieDuDepot();
// Un `node --test` lancé sous `node --test` hérite de NODE_TEST_CONTEXT et sort en 0 même rouge :
// le crochet doit tourner comme chez un développeur.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([cle]) => cle !== 'NODE_TEST_CONTEXT'));

function lance(commande, args, env = ENV) {
  const debut = performance.now();
  const r = spawnSync(commande, args, { cwd: RACINE, env, ...SORTIE });
  const duree = Math.round(performance.now() - debut);
  return { code: r.status, duree, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}
const git = (...args) => lance('git', args);
const fin = (texte) => texte.slice(-3000);

// Dépendances : liens vers celles du dépôt, à la racine et dans chaque paquet du workspace.
const paquets = ['packages', 'apps'].flatMap((p) => (existsSync(join(DEPOT, p)) ? readdirSync(join(DEPOT, p)).map((n) => `${p}/${n}`) : []));
for (const dossier of ['.', ...paquets]) {
  const source = join(DEPOT, dossier, 'node_modules');
  if (existsSync(source) && existsSync(join(RACINE, dossier))) symlinkSync(source, join(RACINE, dossier, 'node_modules'), 'dir');
}

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
}

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

/** Écrit les fichiers, indexe ceux de `indexer`, commet avec les crochets, puis revient à la base. */
function commet(ecritures, { indexer = Object.keys(ecritures), env } = {}) {
  remet();
  for (const [fichier, contenu] of Object.entries(ecritures)) ecrit(fichier, contenu);
  if (indexer.length) git('add', '--', ...indexer);
  const r = lance('git', ['commit', '-q', '-m', 'essai de l’amorçage #120'], env);
  remet();
  return r;
}

const ajoutCommentaire = (t) => `${t}\n// amorçage #120\n`;
const testRougeVitest = (lieu) => `import { expect, it } from 'vitest';\nit('${ROUGE} ${lieu}', () => expect(1).toBe(2));\n`;
const testRougeNode = (lieu) =>
  `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\ntest('${ROUGE} ${lieu}', () => assert.equal(1, 2));\n`;

/** Un PATH où tout est présent sauf les outils nommés. */
function cheminSans(outils) {
  const bin = mkdtempSync(join(tmpdir(), 'tirelire-120-bin-'));
  after(() => rmSync(bin, { recursive: true, force: true }));
  for (const dossier of (process.env.PATH ?? '').split(delimiter)) {
    let noms = [];
    try {
      noms = readdirSync(dossier);
    } catch {
      continue;
    }
    for (const nom of noms) {
      if (outils.some((o) => nom.startsWith(o)) || existsSync(join(bin, nom))) continue;
      try {
        symlinkSync(join(dossier, nom), join(bin, nom));
      } catch {
        // nom déjà pris par un dossier précédent du PATH
      }
    }
  }
  return bin;
}

test('#120 · les crochets sont des scripts suivis dans .githooks, et simple-git-hooks est retiré', () => {
  const pkg = JSON.parse(lire(RACINE, 'package.json'));
  assert.equal(pkg['simple-git-hooks'], undefined, 'package.json configure encore simple-git-hooks');
  assert.equal(pkg.devDependencies?.['simple-git-hooks'], undefined, 'simple-git-hooks reste une dépendance');
  const suivi = spawnSync('git', ['ls-files', '-s', '--', '.githooks/pre-commit'], { cwd: DEPOT, ...SORTIE }).stdout.trim();
  assert.match(suivi, /^100755 /, `.githooks/pre-commit n'est pas suivi comme exécutable : « ${suivi} »`);
});

test('#120 · « pnpm crochets » active .githooks et pose merge.ff false, sans crochet actif ailleurs', () => {
  exigeActivation();
  assert.equal(git('config', 'core.hooksPath').sortie.trim(), '.githooks', 'core.hooksPath ne vaut pas .githooks');
  assert.equal(git('config', 'merge.ff').sortie.trim(), 'false', 'merge.ff ne vaut pas false');
  const dossier = join(RACINE, '.git', 'hooks');
  const actifs = existsSync(dossier) ? readdirSync(dossier).filter((f) => !f.endsWith('.sample')) : [];
  assert.deepEqual(actifs, [], `des crochets restent actifs dans .git/hooks : ${actifs.join(', ')}`);
});

test('#120 · le crochet joué est celui de la branche extraite', () => {
  exigeActivation();
  remet();
  assert.ok(existsSync(join(RACINE, '.githooks', 'pre-commit')), 'la branche de base n’a pas de .githooks/pre-commit');
  git('checkout', '-q', '-b', 'essai-120');
  ecrit('.githooks/pre-commit', '#!/bin/sh\necho "crochet de la branche essai-120"\nexit 1\n');
  chmodSync(join(RACINE, '.githooks', 'pre-commit'), 0o755);
  git('add', '.githooks/pre-commit');
  const preparation = git('commit', '-q', '--no-verify', '-m', 'crochet propre à la branche');
  assert.equal(preparation.code, 0, fin(preparation.sortie));
  ecrit('docs/architecture.md', ajoutCommentaire);
  git('add', 'docs/architecture.md');
  const surEssai = git('commit', '-q', '-m', 'documentation sur essai-120');
  assert.notEqual(surEssai.code, 0, 'le crochet de la branche essai-120 n’a pas été joué');
  assert.match(surEssai.sortie, /crochet de la branche essai-120/);
  const surBase = commet({ 'docs/architecture.md': ajoutCommentaire });
  git('branch', '-q', '-D', 'essai-120');
  assert.equal(surBase.code, 0, `revenu sur la base, le commit est refusé :\n${fin(surBase.sortie)}`);
  assert.doesNotMatch(surBase.sortie, /essai-120/, 'le crochet de essai-120 est encore joué sur la base');
});

test('#120 · un commit de documentation seule ne joue aucun test, même si la copie de travail casse le cœur', () => {
  exigeActivation();
  const r = commet(
    { 'docs/architecture.md': ajoutCommentaire, 'packages/core/test/amorcage-120.test.ts': testRougeVitest('du cœur') },
    { indexer: ['docs/architecture.md'] },
  );
  assert.equal(r.code, 0, `un commit de documentation seule est refusé :\n${fin(r.sortie)}`);
  assert.ok(r.duree < BUDGET_MS, `le crochet a pris ${r.duree} ms pour de la documentation (budget ${BUDGET_MS} ms)`);
});

for (const [lieu, fichier, contenu] of [
  ['du cœur', 'packages/core/test/amorcage-120.test.ts', testRougeVitest('du cœur')],
  ['de la garde', 'packages/gardes/amorcage-120.test.mjs', testRougeNode('de la garde')],
  ['du relais', 'apps/relay/amorcage-120.test.mjs', testRougeNode('du relais')],
  ['de l’hébergement', 'apps/hebergement/amorcage-120.test.mjs', testRougeNode('de l’hébergement')],
]) {
  test(`#120 · un commit qui casse un test ${lieu} est refusé, en nommant le test`, () => {
    exigeActivation();
    const r = commet({ [fichier]: contenu });
    assert.notEqual(r.code, 0, `le commit passe malgré un test rouge ${lieu}`);
    assert.ok(r.sortie.includes(`${ROUGE} ${lieu}`), `le refus ne nomme pas le test rouge ${lieu} :\n${fin(r.sortie)}`);
  });
}

// Les règles, au sens de `CLAUDE.md` (VM-regles-primaires) : la garde les lit, un commit qui en touche
// une joue ses tests. Le test rouge de la garde reste dans la copie de travail, hors du commit.
for (const regle of ['CLAUDE.md', 'docs/decisions.md', 'docs/description-projet.md', 'docs/invariants.md', 'docs/contraintes.md', 'docs/gardes.md']) {
  test(`#120 · un commit qui touche ${regle} joue les tests de la garde`, () => {
    exigeActivation();
    const r = commet(
      { [regle]: (t) => `${t}\n`, 'packages/gardes/amorcage-120.test.mjs': testRougeNode('de la garde') },
      { indexer: [regle] },
    );
    assert.notEqual(r.code, 0, `un commit sur ${regle} ne joue pas les tests de la garde :\n${fin(r.sortie)}`);
    assert.ok(r.sortie.includes(`${ROUGE} de la garde`), `le refus ne nomme pas le test rouge de la garde :\n${fin(r.sortie)}`);
  });
}

test('#120 · un commit sur le cœur qui passe tient en 5 s', () => {
  exigeActivation();
  // Meilleure de trois mesures : les autres amorçages tournent en parallèle et chargent la machine.
  const essais = [];
  for (let i = 0; i < 3; i += 1) {
    const r = commet({ 'packages/core/src/index.ts': ajoutCommentaire });
    assert.equal(r.code, 0, `un commit sain sur le cœur est refusé :\n${fin(r.sortie)}`);
    essais.push(r.duree);
    if (r.duree < BUDGET_MS) break;
  }
  const meilleure = Math.min(...essais);
  assert.ok(meilleure < BUDGET_MS, `le crochet a pris ${essais.join(', ')} ms pour un commit sur le cœur (budget ${BUDGET_MS} ms)`);
});

test('#120 · un script de test absent fait échouer le crochet, au lieu de passer en silence', () => {
  exigeActivation();
  const r = commet({
    'packages/core/package.json': (t) => t.replace('"test":', '"test-retire":'),
    'packages/core/src/index.ts': ajoutCommentaire,
  });
  assert.notEqual(r.code, 0, `le commit passe alors que le cœur n'a plus de script de test :\n${fin(r.sortie)}`);
});

test('#120 · un outil manquant fait sauter le test concerné, avec un message, sans refuser le commit', () => {
  exigeActivation();
  const env = { ...ENV, PATH: cheminSans(['php', 'lftp']) };
  delete env.TIRELIRE_STRICT;
  const r = commet({ 'apps/hebergement/assembler.mjs': ajoutCommentaire }, { env });
  assert.equal(r.code, 0, `sans php ni lftp, le commit sur l'hébergement est refusé :\n${fin(r.sortie)}`);
  assert.match(r.sortie, /skip|saut/i, `aucun test sauté n'est signalé :\n${fin(r.sortie)}`);
});

test('#120 · le pré-push garde le typecheck : une erreur de type ne se pousse pas', () => {
  exigeActivation();
  const distant = mkdtempSync(join(tmpdir(), 'tirelire-120-distant-'));
  after(() => rmSync(distant, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q', '--bare', distant], SORTIE);
  remet();
  ecrit('packages/core/src/index.ts', (t) => `${t}\nexport const casse120: number = 'texte';\n`);
  git('add', 'packages/core/src/index.ts');
  git('commit', '-q', '--no-verify', '-m', 'erreur de type');
  const r = git('push', '-q', distant, 'HEAD:refs/heads/essai-120');
  remet();
  assert.notEqual(r.code, 0, `une erreur de type a été poussée :\n${fin(r.sortie)}`);
  assert.match(r.sortie, /casse120|TS2322/, `le refus ne nomme pas l'erreur de type :\n${fin(r.sortie)}`);
});

test('#120 · README et CLAUDE.md disent comment activer les crochets, et la règle des worktrees est retirée', () => {
  for (const fichier of ['README.md', 'CLAUDE.md']) {
    const texte = lire(RACINE, fichier);
    assert.ok(texte.includes('pnpm crochets'), `${fichier} ne cite pas « pnpm crochets »`);
    assert.doesNotMatch(texte, /simple-git-hooks/, `${fichier} cite encore simple-git-hooks`);
  }
  assert.doesNotMatch(lire(RACINE, 'CLAUDE.md'), /git worktree`? par session/, 'CLAUDE.md garde la règle « un git worktree par session »');
});

test('#120 · une décision postérieure à D71 remplace le budget de D66 par 5 s', () => {
  const sections = lire(RACINE, 'docs/decisions.md').split(/^(?=## D\d+)/m);
  const nouvelle = sections.find((s) => Number(/^## D(\d+)/.exec(s)?.[1]) > 71 && /D66/.test(s) && /\b5\s?s\b/.test(s));
  assert.ok(nouvelle, 'aucune décision postérieure à D71 ne remplace le budget de D66 par 5 s');
});
