/**
 * Harnais d'audit de #383 : la nuit joue la suite entière au seuil 2, sauf ce qu'une nuit précédente a
 * trouvé vert sur son empreinte ; une nuit rouge se signale, quel que soit l'ensemble. Tests du codeur,
 * déplacés ici par l'auditeur (`suite-la-nuit.test.mjs` garde le reste, au niveau 4). Les points 5 et 6
 * se relisent, sans test.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { ENSEMBLES, planDeLaNuit, SEUIL_DE_LA_NUIT } from './attestation.mjs';
import { RACINE } from './gardes.mjs';
import { fichiersRougesDesJournaux } from './nuit.mjs';

const temporaires = [];
const temporaire = (nom) => {
  const d = mkdtempSync(join(tmpdir(), `tirelire-383-${nom}-`));
  temporaires.push(d);
  return d;
};
after(() => {
  for (const d of temporaires) rmSync(d, { recursive: true, force: true });
});
const IDS = ENSEMBLES.map((e) => e.id);
const E = (c) => Object.fromEntries(IDS.map((id, i) => [id, `${c}${i}`.padEnd(64, c)]));

describe('[niveau 1] #383, points 1 et 2 · le plan de la nuit', () => {
  test('sans attestation, chaque ensemble se joue au seuil 2, tests navigateur compris, sans harnais du besoin', () => {
    const p = planDeLaNuit({ empreintes: E('a') });
    assert.deepEqual(p.map((x) => x.id), ['garde', 'coeur', 'relais', 'hebergement', 'interface', 'navigateur']);
    assert.ok(p.every((x) => x.jouer && x.seuil === 2 && x.dossier));
    assert.equal(SEUIL_DE_LA_NUIT, 2);
  });

  test('un ensemble vert sur son empreinte à un seuil au moins égal à 2 se saute ; au seuil 1, ou sur une autre empreinte, il se joue', () => {
    const e = E('b');
    const verts = [
      { ensemble: 'garde', empreinte: e.garde, seuil: 2, par: 'la nuit', commit: 'c'.repeat(40) },
      { ensemble: 'relais', empreinte: e.relais, seuil: 3, par: 'la nuit', commit: 'c'.repeat(40) },
      { ensemble: 'coeur', empreinte: e.coeur, seuil: 1, par: 'la CI', commit: 'c'.repeat(40) },
      { ensemble: 'interface', empreinte: 'autre'.padEnd(64, 'x'), seuil: 2, par: 'la nuit', commit: 'c'.repeat(40) },
    ];
    const p = Object.fromEntries(planDeLaNuit({ empreintes: e, verts }).map((x) => [x.id, x]));
    assert.equal(p.garde.jouer, false);
    assert.match(p.garde.raison, /trouvée verte par la nuit/);
    assert.equal(p.relais.jouer, false);
    assert.equal(p.coeur.jouer, true);
    assert.equal(p.interface.jouer, true);
    assert.equal(p.navigateur.jouer, true);
  });
});

// ─── La nuit, de bout en bout, sur un dépôt de poche ───────────────────────────────────────────

function dépôtGit() {
  const racine = temporaire('depot');
  const dépôt = join(racine, 'depot');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t.invalid', GIT_CONFIG_GLOBAL: '/dev/null', GITHUB_HEAD_REF: '' };
  const git = (...args) => execFileSync('git', args, { cwd: dépôt, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', join(racine, 'origine.git')], { env });
  mkdirSync(dépôt);
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', join(racine, 'origine.git'));
  cpSync(join(RACINE, '.githooks'), join(dépôt, '.githooks'), { recursive: true });
  cpSync(join(RACINE, 'packages/gardes'), join(dépôt, 'packages/gardes'), { recursive: true, filter: (s) => !s.includes('node_modules') });
  for (const d of ['packages/core', 'apps/relay', 'apps/hebergement', 'apps/web']) cpSync(join(RACINE, d, 'package.json'), join(dépôt, d, 'package.json'), { recursive: true });
  const écrire = (chemin, texte) => {
    mkdirSync(dirname(join(dépôt, chemin)), { recursive: true });
    writeFileSync(join(dépôt, chemin), texte);
  };
  const commettre = (m) => {
    git('add', '-A');
    git('commit', '-q', '-m', m);
    git('push', '-q', 'origin', 'main');
  };
  return { racine, dépôt, env, git, écrire, commettre };
}

test('[niveau 1] #383, points 1 à 3 · chaque ensemble se joue, ce qu’une nuit trouve vert vaut pour les suivantes, un ensemble rouge se rejoue, une nuit sans changement ne joue rien et le dit', () => {
  const f = dépôtGit();
  f.écrire('packages/core/src/a.ts', 'export const a = 1;\n');
  f.écrire('apps/relay/x.test.mjs', '// x\n');
  f.commettre('main');
  let n = 0;
  const nuit = () => {
    const d = join(f.racine, `nuit-${++n}`);
    const résumé = join(d, '..', `résumé-${n}`);
    const r = spawnSync('node', ['.githooks/attestation.mjs', 'nuit', d, résumé], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const lancer = readFileSync(join(d, 'lancer'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
    return { d, sortie: r.stdout, résumé: readFileSync(résumé, 'utf8'), jouer: readFileSync(join(d, 'jouer'), 'utf8').trim(), lancer };
  };
  /** Chaque ensemble lancé, vert sauf ceux de `rouges` ; puis le bilan et l'envoi, comme `nuit.yml`. */
  const jouée = (x, rouges = []) => {
    const j = join(x.d, 'journaux');
    mkdirSync(j, { recursive: true });
    writeFileSync(join(j, 'lances'), x.lancer.map(([id, , s]) => `${id}\t${id}\t${s}\n`).join(''));
    for (const [id, , s] of x.lancer) {
      writeFileSync(join(j, `${id}.code`), rouges.includes(id) ? '1\n' : '0\n');
      writeFileSync(join(j, `${id}.log`), '');
      if (s === 'vitest') writeFileSync(join(j, `${id}.rapport`), JSON.stringify({ testResults: [] }));
    }
    const b = spawnSync('node', ['.githooks/attestation.mjs', 'bilan', join(x.d, 'plan'), j, 'la nuit', f.git('rev-parse', 'HEAD^{tree}'), f.git('rev-parse', 'HEAD'), 'nuit', join(x.d, 'verts.json'), '--enregistrer'], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
    assert.equal(b.status, 0, b.stderr);
    spawnSync('node', ['.githooks/attestation.mjs', 'envoyer', 'origin', 'nuit', 'attestation-de-la-nuit'], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
    return b.stdout;
  };

  const première = nuit();
  assert.equal(première.jouer, 'oui');
  assert.deepEqual(première.lancer, [
    ['garde', 'packages/gardes', 'node'],
    ['coeur', 'packages/core', 'vitest'],
    ['relais', 'apps/relay', 'node'],
    ['hebergement', 'apps/hebergement', 'node'],
    ['interface', 'apps/web', 'vitest'],
    ['navigateur', 'apps/web', 'vitest'],
  ]);
  for (const nom of ['garde', 'cœur', 'relais', 'hébergement', 'interface sans navigateur', 'interface dans le navigateur']) assert.match(première.résumé, new RegExp(`- ${nom}, seuil 2 : se joue`), première.résumé);
  jouée(première, ['relais']);

  const deuxième = nuit();
  assert.deepEqual(deuxième.lancer.map(([id]) => id), ['relais'], 'seul l’ensemble rouge se rejoue');
  assert.match(deuxième.résumé, /- cœur, seuil 2 : sauté — empreinte trouvée verte par la nuit, sur le commit [0-9a-f]{10}, au seuil 2/);
  jouée(deuxième);

  const troisième = nuit();
  assert.equal(troisième.jouer, 'non');
  assert.deepEqual(troisième.lancer, []);
  assert.match(troisième.résumé, /Rien ne se joue cette nuit/);

  f.écrire('packages/core/src/a.ts', 'export const a = 2;\n');
  f.commettre('cœur');
  const quatrième = nuit();
  assert.ok(quatrième.lancer.some(([id]) => id === 'coeur') && quatrième.lancer.some(([id]) => id === 'garde'), 'ce qu’ils lisent a changé : ils se rejouent');
  assert.ok(!quatrième.lancer.some(([id]) => id === 'relais'), 'le relais ne lit pas le cœur');
});

describe('[niveau 1] #383, point 4 · une nuit rouge se signale, quel que soit l’ensemble', () => {
  test('les fichiers rouges se lisent dans les journaux de chaque ensemble, node comme vitest', () => {
    const j = temporaire('journaux');
    const racine = '/r';
    const fichiers = {
      lances: 'garde\tgarde\tnode\nrelais\trelais\tnode\nnavigateur\tnavigateur\tvitest\n',
      'garde.code': '1\n',
      'garde.rapport': `${JSON.stringify({ type: 'passe', file: '/r/packages/gardes/a.test.mjs' })}\n${JSON.stringify({ type: 'echec', file: '/r/packages/gardes/b.test.mjs', name: 'x' })}\n`,
      'relais.code': '0\n',
      'relais.rapport': '',
      'navigateur.code': '1\n',
      'navigateur.rapport': JSON.stringify({ testResults: [{ name: '/r/apps/web/test/navigateur/c.test.ts', status: 'failed' }] }),
    };
    const lire = (p) => fichiers[p.slice(j.length + 1)] ?? null;
    assert.deepEqual(fichiersRougesDesJournaux(j, racine, lire), ['apps/web/test/navigateur/c.test.ts', 'packages/gardes/b.test.mjs']);
    const sans = { lances: 'coeur\tcoeur\tvitest\n', 'coeur.code': '1\n' };
    assert.equal(fichiersRougesDesJournaux(j, racine, (p) => sans[p.slice(j.length + 1)] ?? null), null, 'rouge sans rapport : les fichiers ne se lisent pas');
  });

  test('le workflow joue chaque ensemble lancé, même après un rouge, et rougit', () => {
    const w = readFileSync(join(RACINE, '.github/workflows/nuit.yml'), 'utf8').split('\n');
    const début = w.findIndex((l) => l.includes('- name: La suite au seuil 2'));
    const run = w.findIndex((l, i) => i > début && /^ {8}run: \|$/.test(l));
    const corps = [];
    for (const l of w.slice(run + 1)) {
      if (l.trim() && !l.startsWith(' '.repeat(10))) break;
      corps.push(l.slice(10));
    }
    const d = temporaire('suite');
    mkdirSync(join(d, 'bin'));
    mkdirSync(join(d, 'nuit'));
    for (const x of ['packages/gardes', 'packages/core', 'apps/relay', 'apps/web']) mkdirSync(join(d, x), { recursive: true });
    writeFileSync(join(d, 'bin/pnpm'), `#!/bin/sh\nprintf '%s %s\\n' "$(basename "$PWD")" "$*" >> "${d}/appels"\n[ "$(basename "$PWD")" = relay ] && exit 1\nexit 0\n`, { mode: 0o755 });
    writeFileSync(join(d, 'nuit/lancer'), 'garde\tpackages/gardes\tnode\nrelais\tapps/relay\tnode\nnavigateur\tapps/web\tvitest\n');
    const r = spawnSync('bash', ['-e', '-c', corps.join('\n')], { cwd: d, encoding: 'utf8', env: { ...process.env, PATH: `${join(d, 'bin')}:${process.env.PATH}`, NUIT: join(d, 'nuit') } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const appels = readFileSync(join(d, 'appels'), 'utf8').trim().split('\n');
    assert.equal(appels.length, 3, appels.join('\n'));
    assert.ok(appels.every((a) => / run test 2 --attestation /.test(a)));
    assert.match(appels[2], /^web .*--navigateur test\/navigateur/);
    assert.equal(readFileSync(join(d, 'nuit/journaux/lances'), 'utf8'), 'garde\tgarde\tnode\nrelais\trelais\tnode\nnavigateur\tnavigateur\tvitest\n');
    assert.equal(readFileSync(join(d, 'nuit/journaux/relais.code'), 'utf8').trim(), '1');
  });
});
