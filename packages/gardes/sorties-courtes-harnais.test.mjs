/**
 * Harnais d'audit de #352 : les crochets et le lanceur parlent peu quand tout est vert.
 * Tests du codeur, retenus et classés par l'auditeur (D83), et ses ajouts : point 5 (fichier lu
 * changé pendant le lancement), point 4 (vitest, fichier qui ne se charge pas), point 1 (crochet).
 *
 * Le lanceur et le pré-commit se jouent dans un petit dépôt inventé : une garde, un cœur en
 * `node --test` (trois fichiers), une interface en vitest.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { endroitDans, ligneDEnsemble, lignesDesEchecs } from './echecs.mjs';
import { RACINE } from './gardes.mjs';

let dossierTemporaire;
const temporaire = () => (dossierTemporaire ??= mkdtempSync(join(tmpdir(), 'sorties-courtes-')));
after(() => {
  if (dossierTemporaire) rmSync(dossierTemporaire, { recursive: true, force: true });
});

function environnement(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'NODE_TEST_CONTEXT' || k === 'GITHUB_ACTIONS' || k.startsWith('VITEST') || k.startsWith('GIT_') || k.startsWith('TIRELIRE_')) delete env[k];
  return { ...env, GIT_AUTHOR_NAME: 'Tests', GIT_AUTHOR_EMAIL: 'tests@exemple.invalid', GIT_COMMITTER_NAME: 'Tests', GIT_COMMITTER_EMAIL: 'tests@exemple.invalid', ...extra };
}

function lancer(cmd, args, options) {
  return new Promise((fini) => {
    const p = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    p.stdout.on('data', (d) => (sortie += d));
    p.stderr.on('data', (d) => (sortie += d));
    p.on('close', (code) => fini({ code, sortie }));
  });
}

function dépôtInventé(nom) {
  const dépôt = join(temporaire(), nom);
  for (const f of readdirSync(join(RACINE, '.githooks'))) cpSync(join(RACINE, '.githooks', f), join(dépôt, '.githooks', f));
  for (const f of readdirSync(join(RACINE, 'packages/gardes'))) if (/\.mjs$|^package\.json$|^chemins-ignores$/.test(f) && !/\.test\.mjs$/.test(f)) cpSync(join(RACINE, 'packages/gardes', f), join(dépôt, 'packages/gardes', f));
  const écrire = (f, texte) => {
    mkdirSync(dirname(join(dépôt, f)), { recursive: true });
    writeFileSync(join(dépôt, f), texte);
  };
  écrire('typecheck.mjs', '');
  écrire('packages/gardes/package.json', JSON.stringify({ name: 'f-gardes', private: true, type: 'module', scripts: { test: 'node ./lanceur.mjs node --test', typecheck: 'node ../../typecheck.mjs' } }));
  écrire('packages/gardes/g.test.mjs', "import { test } from 'node:test';\ntest('g [niveau 0]', () => {});\n");
  écrire('packages/core/package.json', JSON.stringify({ name: 'f-core', private: true, type: 'module', scripts: { test: 'node ../gardes/lanceur.mjs node --test', typecheck: 'node ../../typecheck.mjs' } }));
  écrire('packages/core/lib.mjs', 'export const un = 1;\n');
  for (const n of ['alpha', 'beta', 'gamma']) écrire(`packages/core/${n}-fichier.test.mjs`, `import { test } from 'node:test';\ntest('${n} [niveau 1]', () => {});\n`);
  écrire('apps/web/package.json', JSON.stringify({ name: 'f-web', private: true, type: 'module', scripts: { test: 'node ../../packages/gardes/lanceur.mjs vitest run', typecheck: 'node ../../typecheck.mjs' } }));
  écrire('apps/web/test/w.test.mjs', "import { test } from 'vitest';\ntest('w [niveau 1]', () => {});\n");
  écrire('.gitignore', 'node_modules\n');
  const env = environnement();
  const git = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: dépôt, env, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, dépôt], { env });
  git('checkout', '-q', '-b', `codage/990-${nom}`);
  const tester = (paquet, ...args) => lancer('pnpm', ['--dir', join(dépôt, paquet), 'run', 'test', ...args], { cwd: dépôt, env });
  return { dépôt, env, git, écrire, tester };
}

const NOMS = /alpha-fichier|beta-fichier|gamma-fichier/;
const lignesDuLanceur = (sortie) => sortie.split('\n').filter((l) => l.startsWith('attestation : '));
const détailDe = (sortie) => readFileSync(sortie.match(/^attestation : détail : (.+)$/m)[1].trim(), 'utf8');

describe('#352 · le lanceur parle peu quand tout est vert', { concurrency: true }, () => {
  test('[niveau 3] points 1, 2 et 3 · tout vert : une ligne par ensemble, sans nom de fichier ; le détail se lit après le lancement', async () => {
    const f = dépôtInventé('vert');
    const premier = await f.tester('packages/core', '2');
    assert.equal(premier.code, 0, premier.sortie);
    assert.doesNotMatch(premier.sortie, NOMS, `aucun nom de fichier de test (point 1)\n${premier.sortie}`);
    const ligne = lignesDuLanceur(premier.sortie).find((l) => l.startsWith('attestation : cœur, seuil 2'));
    assert.equal(ligne, 'attestation : cœur, seuil 2 : vert — 3 joué(s), 0 sauté(s).', premier.sortie);
    assert.ok(ligne.length <= 160);
    assert.match(premier.sortie, /attestation : 3 fichier\(s\) attesté\(s\) vert\(s\)/, 'les fichiers attestés, leur nombre (point 2)');
    const détail = détailDe(premier.sortie);
    assert.match(détail, /cœur : joué\(s\) : alpha-fichier\.test\.mjs, beta-fichier\.test\.mjs, gamma-fichier\.test\.mjs\./, détail);
    assert.match(détail, /Sortie de l'exécuteur[\s\S]*alpha \[niveau 1\]/, `la sortie complète de l'exécuteur (point 3)\n${détail}`);

    const second = await f.tester('packages/core', '2');
    assert.equal(second.code, 0, second.sortie);
    assert.doesNotMatch(second.sortie, NOMS, second.sortie);
    assert.match(second.sortie, /^attestation : cœur, seuil 2 : vert — 0 joué\(s\), 3 sauté\(s\) \(3 attesté\(s\) vert\(s\)\)\.$/m, second.sortie);
    assert.match(détailDe(second.sortie), /cœur : sauté\(s\) — fichier attesté vert par le lancement « test 2 » dans packages\/core, sur l'arbre [0-9a-f]{10}, au seuil 4 : alpha-fichier/, 'ce qui couvre chaque fichier sauté : par qui, sur quel arbre, à quel seuil');
    for (const l of lignesDuLanceur(second.sortie)) assert.ok(l.length <= 160, l);
  });

  test('[niveau 2] point 4 · un fichier rougit : il est nommé avec chaque test en échec, son message et son endroit ; les verts sont comptés', async () => {
    const f = dépôtInventé('rouge');
    f.écrire('packages/core/rouge.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('r1 [niveau 1]', () => {\n  assert.equal(1, 2);\n});\ntest('r2 [niveau 1]', () => {\n  throw new Error('deuxième');\n});\ntest('r3 [niveau 1]', () => {});\n");
    const r = await f.tester('packages/core', '2');
    assert.notEqual(r.code, 0, r.sortie);
    assert.match(r.sortie, /^✗ rouge\.test\.mjs :$/m, r.sortie);
    assert.match(r.sortie, /^ {2}« r1 \[niveau 1\] » — .*1.*2.* \(rouge\.test\.mjs:4:\d+\)$/m, r.sortie);
    assert.match(r.sortie, /^ {2}« r2 \[niveau 1\] » — deuxième \(rouge\.test\.mjs:7:\d+\)$/m, r.sortie);
    assert.doesNotMatch(r.sortie, /r3/, 'un test vert ne se dit pas');
    assert.doesNotMatch(r.sortie, NOMS, `des fichiers verts, seulement leur nombre\n${r.sortie}`);
    assert.match(r.sortie, /attestation : cœur, seuil 2 : rouge \(1 fichier\(s\) rouge\(s\), 3 vert\(s\)\) — 4 joué\(s\), 0 sauté\(s\)\./, r.sortie);
  });

  test('[niveau 2] point 5 · un fichier qui a tourné sans être attesté est nommé, avec la raison', async () => {
    const f = dépôtInventé('saute');
    f.écrire('packages/core/outil.test.mjs', "import { test } from 'node:test';\ntest('o [niveau 1]', { skip: 'outil absent' }, () => {});\n");
    const r = await f.tester('packages/core', '2');
    assert.equal(r.code, 0, r.sortie);
    assert.match(r.sortie, /^attestation : outil\.test\.mjs : non attesté — test\(s\) sauté\(s\) : outil absent\.$/m, r.sortie);
    assert.equal((r.sortie.match(/outil\.test\.mjs/g) ?? []).length, 1, `une ligne, une fois\n${r.sortie}`);
  });

  test('[niveau 2] point 6 · en CI, le lanceur dit encore, fichier par fichier, ce qu’il joue et ce qu’il saute', async () => {
    const f = dépôtInventé('ci');
    await f.tester('packages/core', '2');
    const ci = await lancer('pnpm', ['--dir', join(f.dépôt, 'packages/core'), 'run', 'test', '2'], { cwd: f.dépôt, env: { ...f.env, GITHUB_ACTIONS: 'true' } });
    assert.equal(ci.code, 0, ci.sortie);
    assert.match(ci.sortie, /attestation : cœur : sauté\(s\) — fichier attesté vert .*: alpha-fichier\.test\.mjs, beta-fichier\.test\.mjs, gamma-fichier\.test\.mjs\./, ci.sortie);
    assert.doesNotMatch(ci.sortie, /attestation : détail : /, ci.sortie);
  });

  test('[niveau 3] points 1 à 3 · le pré-commit dit chaque ensemble en une ligne, et où lire son détail, qui reste après lui', async () => {
    const f = dépôtInventé('crochet');
    f.écrire('packages/gardes/outil.mjs', 'export const x = 1;\n');
    f.git('add', '-A');
    const r = await lancer('sh', ['.githooks/pre-commit'], { cwd: f.dépôt, env: f.env });
    assert.equal(r.code, 0, r.sortie);
    assert.match(r.sortie, /^pré-commit : garde : joué au seuil 0 : vert — 1 joué\(s\), 0 sauté\(s\)\.$/m, r.sortie);
    assert.doesNotMatch(r.sortie, /g\.test\.mjs/, r.sortie);
    for (const l of r.sortie.split('\n').filter((x) => /^pré-commit : .+ : (?:joué|non rejoué) au seuil/.test(x))) assert.ok(l.length <= 160, `ligne d'ensemble de ${l.length} caractères (point 1)\n${l}`);
    const m = r.sortie.match(/^pré-commit : détail — .* : (.+)\/ \(\*\.detail, \*\.log\)\.$/m);
    assert.ok(m, r.sortie);
    assert.ok(existsSync(join(m[1], 'garde.log')), `la sortie de l'exécuteur reste après le crochet\n${r.sortie}`);
    assert.match(readFileSync(join(m[1], 'garde.detail'), 'utf8'), /garde : joué\(s\) : g\.test\.mjs\./);
  });

  test('[niveau 2] point 5 · un fichier dont ce qu’il lit change pendant le lancement est nommé, avec la raison (ajouté par l’auditeur)', async () => {
    const f = dépôtInventé('change');
    f.écrire('packages/core/change.test.mjs', "import { test } from 'node:test';\nimport { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\ntest('c [niveau 1]', () => { writeFileSync(join(import.meta.dirname, 'lib.mjs'), 'export const un = 2;\\n'); });\n");
    const r = await f.tester('packages/core', '2');
    assert.equal(r.code, 0, r.sortie);
    assert.match(r.sortie, /^attestation : [a-z-]+\.test\.mjs : non attesté — un fichier qu'il lit a changé pendant le lancement\.$/m, r.sortie);
    assert.doesNotMatch(r.sortie, /fichier\(s\) attesté\(s\) vert\(s\)/, r.sortie);
  });

  test('[niveau 2] point 4 · vitest : le test en échec est nommé avec son message et son endroit ; un fichier qui ne se charge pas aussi (ajouté par l’auditeur)', async () => {
    const f = dépôtInventé('vitest');
    f.écrire('apps/web/test/r.test.mjs', "import { test, expect } from 'vitest';\ntest('rv [niveau 1]', () => {\n  expect(1).toBe(2);\n});\n");
    f.écrire('apps/web/test/s.test.mjs', "import { test } from 'vitest';\ntest('sv [niveau 1]', () => { ;\n");
    const r = await f.tester('apps/web', '2');
    assert.notEqual(r.code, 0, r.sortie);
    assert.match(r.sortie, /^✗ test\/r\.test\.mjs :$/m, r.sortie);
    assert.match(r.sortie, /^ {2}« rv \[niveau 1\] » — .*\(test\/r\.test\.mjs:3:\d+\)$/m, r.sortie);
    assert.match(r.sortie, /^✗ test\/s\.test\.mjs :$/m, r.sortie);
    assert.doesNotMatch(r.sortie, /w\.test\.mjs/, `des fichiers verts, seulement leur nombre\n${r.sortie}`);
  });
});

describe('#352 · la ligne d’un ensemble au bilan d’un crochet', () => {
  test('[niveau 3] point 1 · un cas long tient en 160 caractères, comptes entiers (ajouté par l’auditeur)', () => {
    const comptes = '12 joué(s), 30 sauté(s) (18 attesté(s) vert(s), 12 base commune avec main)';
    const l = ligneDEnsemble('pré-fusion', 'interface sans navigateur', 'joué au seuil 2 : vert, mais son rapport ne se lit pas, donc pas compté vert sur son empreinte', comptes);
    assert.ok(l.length <= 160, `${l.length} : ${l}`);
    assert.ok(l.endsWith(` — ${comptes}.`), l);
  });
});

describe('[niveau 4] #352 · les échecs, dits court', () => {
  test('[niveau 4] point 4 · l’endroit se lit dans la pile, dans le fichier de test d’abord', () => {
    const pile = 'Error: x\n    at f (/d/node_modules/lib.js:1:1)\n    at g (file:///d/t.test.mjs:12:5)\n    at h (/d/autre.mjs:3:4)';
    assert.equal(endroitDans(pile, '/d/t.test.mjs'), '/d/t.test.mjs:12:5');
    assert.equal(endroitDans(pile), '/d/t.test.mjs:12:5', 'hors node_modules');
    assert.equal(endroitDans('sans pile'), null);
    assert.deepEqual(lignesDesEchecs([{ fichier: '/d/t.test.mjs', test: 'a', message: 'm', endroit: '/d/t.test.mjs:1:2' }, { fichier: '/d/t.test.mjs', test: 'b', message: '', endroit: null }], '/d'), ['✗ t.test.mjs :', '  « a » — m (t.test.mjs:1:2)', '  « b » — échec sans message']);
  });

  test('[niveau 3] point 7 · la règle de #302 amendée est écrite dans les rôles et suivie par l’en-tête du lanceur', () => {
    const codeur = readFileSync(join(RACINE, 'docs/roles/codeur.md'), 'utf8').replace(/\s+/g, ' ');
    assert.ok(codeur.includes("Tout lancement de l'outil de test, les tiens compris, atteste les fichiers qu'il joue verts, et dit, pour chaque ensemble, combien de fichiers il joue et combien il saute, et pourquoi ; le détail, fichier par fichier, se lit à la demande, et le lancement dit où"));
    const auditeur = readFileSync(join(RACINE, 'docs/roles/auditeur.md'), 'utf8').replace(/\s+/g, ' ');
    assert.ok(auditeur.includes("lis ce que le lanceur dit jouer et sauter, et pourquoi, et son détail s'il le faut"));
    const lanceur = readFileSync(join(RACINE, 'packages/gardes/lanceur.mjs'), 'utf8').replace(/\s*\n\s*\*\s*/g, ' ');
    assert.ok(lanceur.includes('dit, pour chaque ensemble, combien de fichiers il joue et combien il saute, et pourquoi ; le détail, fichier par fichier, se lit à la demande, et le lancement dit où'));
  });
});
