/**
 * Harnais d'audit de #352, réouverture (points 8 et 9) : l'outillage de la garde ne tire pas son
 * comportement de l'environnement ; ce qui dépend du contexte lui est servi. Tests du codeur, retenus
 * et classés par l'auditeur (D83) ; second fichier, pour son propre dépôt inventé.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { RACINE } from './gardes.mjs';

const temp = mkdtempSync(join(tmpdir(), 'tirelire-352-t3-'));
after(() => rmSync(temp, { recursive: true, force: true }));

/** L'environnement des sessions, sans rien de la CI ; `ci` y ajoute ce que pose GitHub Actions. */
function environnement(ci) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'NODE_TEST_CONTEXT' || k === 'CI' || k.startsWith('GITHUB_') || k.startsWith('VITEST') || k.startsWith('GIT_') || k.startsWith('TIRELIRE_')) delete env[k];
  Object.assign(env, { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t.invalid', GIT_CONFIG_GLOBAL: '/dev/null' });
  if (ci) Object.assign(env, { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_HEAD_REF: 'codage/1-ailleurs', GITHUB_STEP_SUMMARY: join(temp, 'resume-env.md') });
  return env;
}

function dépôt(nom) {
  const d = join(temp, nom);
  const écrire = (f, t) => {
    mkdirSync(dirname(join(d, f)), { recursive: true });
    writeFileSync(join(d, f), t);
  };
  for (const f of readdirSync(join(RACINE, '.githooks'))) cpSync(join(RACINE, '.githooks', f), join(d, '.githooks', f));
  for (const f of readdirSync(join(RACINE, 'packages/gardes'))) if (/\.mjs$|^chemins-ignores$/.test(f) && !/\.test\.mjs$/.test(f)) cpSync(join(RACINE, 'packages/gardes', f), join(d, 'packages/gardes', f));
  écrire('packages/core/a.test.mjs', "import { test } from 'node:test';\ntest('a [niveau 1]', () => {});\n");
  écrire('packages/core/s.test.mjs', "import { test } from 'node:test';\ntest('s [niveau 1]', { skip: 'lftp absent' }, () => {});\n");
  const git = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: d, env: environnement(false), encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', `codage/991-${nom}`);
  return { d, git, écrire };
}

/** Le lanceur dans `packages/core`, sans pnpm ; la sortie sans ce qui varie d'un lancement à l'autre. */
function lanceur(d, args, ci) {
  const r = spawnSync(process.execPath, [join(d, 'packages/gardes/lanceur.mjs'), 'node', '--test', ...args], { cwd: join(d, 'packages/core'), env: environnement(ci), encoding: 'utf8' });
  const sortie = `${r.stdout}${r.stderr}`.split('\n').filter((l) => l.startsWith('attestation : ')).join('\n').replace(/duration_ms.*|\d{4}-\d\d-\d\dT[\d:.]+Z/g, '');
  return { code: r.status, sortie };
}

describe('#352, réouverture · le lanceur ne lit pas l’environnement', () => {
  test('[niveau 3] point 8 · avec --complet (la CI), un fichier non attesté parce qu’un test s’y est sauté est dit avec la raison réelle', () => {
    const { d } = dépôt('raison');
    const r = lanceur(d, ['1', '--complet'], false);
    assert.equal(r.code, 0, r.sortie);
    assert.match(r.sortie, /s\.test\.mjs : non attesté — test\(s\) sauté\(s\) : lftp absent\./, r.sortie);
    assert.match(r.sortie, /cœur, seuil 1 : 2 fichier\(s\) joué\(s\), 0 sauté\(s\)/, 'la sortie complète, celle de la CI');
  });

  test('[niveau 2] point 9 · même lancement, mêmes options : même sortie et même verdict, avec ou sans CI et GITHUB_ACTIONS', () => {
    for (const args of [['1'], ['1', '--complet']]) {
      const sans = lanceur(dépôt(`sans-${args.length}`).d, args, false);
      const avec = lanceur(dépôt(`avec-${args.length}`).d, args, true);
      const net = (s) => s.replace(/sans-\d|avec-\d/g, 'X').replace(/arbre [0-9a-f]{10}/g, 'arbre …');
      assert.equal(avec.code, sans.code);
      assert.equal(net(avec.sortie), net(sans.sortie), `test ${args.join(' ')}`);
    }
  });

  test('[niveau 2] point 9 · le harnais du besoin se reconnaît à la branche servie (--branche), pas à GITHUB_HEAD_REF', () => {
    const { d, git, écrire } = dépôt('harnais');
    git('update-ref', 'refs/remotes/origin/main', 'main');
    écrire('packages/core/h.test.mjs', "// Harnais d'audit de #991\nimport { test } from 'node:test';\ntest('h [niveau 4]', () => {});\n");
    git('add', '-A');
    git('commit', '-q', '-m', 'h');
    git('checkout', '-q', '--detach');
    const jouer = (ci, ...extra) => spawnSync('sh', ['.githooks/harnais-du-besoin.sh', '--jouer', ...extra], { cwd: d, env: { ...environnement(ci), PATH: `${join(temp, 'bin')}:${process.env.PATH}` }, encoding: 'utf8' });
    mkdirSync(join(temp, 'bin'), { recursive: true });
    writeFileSync(join(temp, 'bin', 'pnpm'), '#!/bin/sh\necho "pnpm $*"\n', { mode: 0o755 });
    const servie = jouer(true, '--branche', 'codage/991-harnais');
    assert.match(servie.stdout, /pnpm --dir packages\/core run test 4 --navigateur h\.test\.mjs/, servie.stdout + servie.stderr);
    // GITHUB_HEAD_REF (codage/1-…) écarterait le harnais de #991 s'il était lu ; sans branche servie, la
    // tête détachée retient tout harnais d'audit, avec ou sans CI.
    const sansBranche = jouer(true);
    assert.match(sansBranche.stdout, /h\.test\.mjs/, `GITHUB_HEAD_REF ne sert pas de branche\n${sansBranche.stdout}`);
    assert.equal(jouer(false).stdout, sansBranche.stdout);
    assert.doesNotMatch(jouer(true, '--branche', 'codage/1-autre').stdout, /pnpm --dir/, 'la branche servie choisit le harnais');
    assert.equal(jouer(false, '--branche', 'codage/991-harnais').stdout, servie.stdout);
  });
});

describe('#352, réouverture · la garde ne lit pas l’environnement', () => {
  test('[niveau 2] point 9 · le résumé et les annotations sont servis (--resume, --annotations), pas lus de GITHUB_STEP_SUMMARY ni de GITHUB_ACTIONS', () => {
    const corps = join(temp, 'corps.md');
    writeFileSync(corps, '## Invariants et contraintes\n\nTouchés : aucun\nLien possible masqué : aucun\n');
    const resume = join(temp, 'resume-servi.md');
    const garde = (ci, ...extra) => spawnSync(process.execPath, [join(RACINE, 'packages/gardes/cli.mjs'), 'pr', '--corps-fichier', corps, ...extra], { cwd: RACINE, env: environnement(ci), encoding: 'utf8' });
    const sans = garde(false);
    const avec = garde(true);
    assert.equal(avec.status, sans.status);
    assert.equal(avec.stdout, sans.stdout, 'avec ou sans CI, même sortie');
    assert.throws(() => readFileSync(join(temp, 'resume-env.md')), 'GITHUB_STEP_SUMMARY ne se lit pas');
    const servi = garde(false, '--resume', resume, '--annotations');
    assert.ok(readFileSync(resume, 'utf8').length > 0, 'le résumé servi reçoit le bilan');
    assert.equal(servi.status, sans.status);
  });
});
