/**
 * Harnais d'audit de #307 : les tests navigateur de non-régression se jouent la nuit, sur `main` ;
 * ceux de l'issue, pendant toute la PR. Composé par l'auditeur, un test par phrase du « Fait quand »
 * qu'un test peut trancher : des tests du codeur, déplacés ici (`navigateur-la-nuit.test.mjs` garde
 * les siens, au niveau 4), et des tests de l'auditeur. Le point 7 (les textes) se relit, sans test
 * (D81) ; les durées du point 6 se mesurent (voir la vérification de la PR).
 *
 * Point 1 : la CI ne joue pas la non-régression dans le navigateur. Point 2 : ce que la branche ajoute
 * ou modifie se joue en entier, à la livraison comme au Ready, sauf fichier vert sur son empreinte.
 * Point 3 : la nuit. Point 4 : une nuit rouge se signale. Point 5 : le tag rejoue tout.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, describe, test } from 'node:test';
import { RACINE } from './gardes.mjs';
import { MARQUE, ROUGE, TITRE, VERTE } from './nuit.mjs';
import { commande, interpoler, jouer } from './workflow-a-blanc.mjs';

const lireFichier = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');
const h = (c) => c.repeat(64);
const A = 'a'.repeat(40);

const temporaires = [];
const temporaire = (nom) => {
  const d = mkdtempSync(join(tmpdir(), `tirelire-307-${nom}-`));
  temporaires.push(d);
  return d;
};
after(() => {
  for (const d of temporaires) rmSync(d, { recursive: true, force: true });
});

// ─── La CI jouée à blanc ────────────────────────────────────────────────────────────────────────

const ctx = (github, inputs = {}) => ({ github: { event: {}, ...github }, vars: {}, secrets: {}, inputs });
const AU_READY = ctx({ event_name: 'pull_request', ref: 'refs/pull/307/merge', event: { action: 'ready_for_review', pull_request: { number: 307, draft: false, head: { sha: A } } } });
const SUR_MAIN = ctx({ event_name: 'push', ref: 'refs/heads/main' });
const AU_TAG = ctx({ event_name: 'push', ref: 'refs/tags/v1.0.0' });
const FORCEE = ctx({ event_name: 'workflow_dispatch', ref: 'refs/heads/main' }, { version_forcee: true });
const commandes = (c) => jouer(lireFichier('.github/workflows/ci.yml'), c).flatMap((job) => job.joués.map((é) => commande(é)));

describe('[niveau 2] #307, point 1 · la CI ne joue la non-régression dans le navigateur ni au Ready ni après la fusion', () => {
  test('au Ready et sur main, aucune commande de ci.yml n’active les tests navigateur', () => {
    for (const [nom, c] of [['au Ready', AU_READY], ['sur main', SUR_MAIN]]) {
      const l = commandes(c);
      assert.ok(l.some((x) => /\bpnpm test 1\b/.test(x)), `${nom} : le seuil 1 se joue toujours`);
      // Aucune forme ne vaut : `pnpm test 1 --navigateur` les jouerait aussi.
      assert.ok(!l.some((x) => /--navigateur\b|\btest\/navigateur\b/.test(x)), `${nom} : la non-régression dans le navigateur ne se joue pas\n${l.join('\n')}`);
    }
  });
});

describe('[niveau 1] #307, point 5 · le tag et la version forcée rejouent tout, tests navigateur compris, sans rien sauter', () => {
  test('au seuil 3, sans attestation', () => {
    for (const [nom, c] of [['au tag', AU_TAG], ['version forcée', FORCEE]]) {
      const l = commandes(c);
      assert.ok(l.some((x) => /pnpm --dir apps\/web run test 3 --navigateur test\/navigateur/.test(x)), `${nom}\n${l.join('\n')}`);
      assert.ok(!l.some((x) => /\btest\b[^\n]*--attestation/.test(x)), `${nom} : rien ne se saute`);
    }
  });
});

// ─── Point 2 : les tests navigateur de l'issue ───────────────────────────────────────────────────

/** Un dépôt avec `origin` et les crochets du dépôt : `git`, `écrire`, `commettre`. */
function dépôtGit(nom) {
  const racine = temporaire(nom);
  const dépôt = join(racine, 'depot');
  const origine = join(racine, 'origine.git');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t.invalid', GIT_CONFIG_GLOBAL: '/dev/null', GITHUB_HEAD_REF: '' };
  const git = (...args) => execFileSync('git', args, { cwd: dépôt, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', origine], { env });
  mkdirSync(dépôt);
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', origine);
  cpSync(join(RACINE, '.githooks'), join(dépôt, '.githooks'), { recursive: true });
  cpSync(join(RACINE, 'packages/gardes'), join(dépôt, 'packages/gardes'), { recursive: true, filter: (s) => !s.includes('node_modules') });
  const écrire = (chemin, texte) => {
    mkdirSync(dirname(join(dépôt, chemin)), { recursive: true });
    writeFileSync(join(dépôt, chemin), texte);
  };
  const commettre = (message) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  return { dépôt, env, git, écrire, commettre };
}

describe('[niveau 2] #307, point 2 · les tests navigateur de l’issue : ce que la branche ajoute ou modifie, hors harnais', () => {
  test('au Ready, ils se jouent après le harnais du besoin ; sur main, jamais', () => {
    const l = commandes(AU_READY);
    const harnais = l.findIndex((x) => /harnais-du-besoin\.sh --jouer/.test(x));
    const issue = l.findIndex((x) => /tests-de-l-issue\.sh --jouer --attestation/.test(x));
    assert.ok(harnais >= 0 && issue > harnais, l.join('\n'));
    assert.ok(!commandes(SUR_MAIN).some((x) => /tests-de-l-issue/.test(x)), 'sur main, aucune issue');
  });

  test('la liste du Ready : fichiers navigateur ajoutés ou modifiés depuis main, sans le harnais du besoin ni les autres tests, jouée en entier', () => {
    const f = dépôtGit('liste');
    for (const n of ['a', 'b', 'c']) f.écrire(`apps/web/test/navigateur/${n}.test.ts`, `// ${n}\n`);
    f.écrire('apps/web/test/w.test.ts', '// w\n');
    f.commettre('main');
    f.git('push', '-q', 'origin', 'main');
    f.git('fetch', '-q', 'origin');
    f.git('checkout', '-q', '-b', 'codage/307-essai');
    f.écrire('apps/web/test/navigateur/a.test.ts', '// a modifié\n');
    f.écrire('apps/web/test/navigateur/d.test.ts', '// nouveau\n');
    f.écrire('apps/web/test/navigateur/h.test.ts', '// Harnais d’audit de #307\n');
    f.écrire('apps/web/test/w.test.ts', '// w modifié\n');
    f.git('rm', '-q', 'apps/web/test/navigateur/c.test.ts');
    f.git('add', '-A');
    const liste = join(f.dépôt, '..', 'liste');
    const r = spawnSync('sh', ['-c', `. .githooks/tests-de-l-issue.sh && tests_de_l_issue '${liste}'`, '.githooks/tests-de-l-issue.sh'], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readFileSync(liste, 'utf8').split('\n').filter(Boolean), ['apps/web/test/navigateur/a.test.ts', 'apps/web/test/navigateur/d.test.ts']);

    // Joués par l'étape du Ready : en entier (seuil 4), navigateur activé, avec l'attestation, et l'étape rougit si un fichier rougit.
    const bin = join(f.dépôt, '..', 'bin');
    const appels = join(f.dépôt, '..', 'appels-pnpm');
    mkdirSync(bin);
    writeFileSync(join(bin, 'pnpm'), `#!/bin/sh\necho "$*" >> '${appels}'\nexit "$PNPM_CODE"\n`, { mode: 0o755 });
    const attestation = join(f.dépôt, '..', 'attestation.json');
    const ready = (code) => spawnSync('sh', ['.githooks/tests-de-l-issue.sh', '--jouer', '--attestation', attestation], { cwd: f.dépôt, env: { ...f.env, PATH: `${bin}:${process.env.PATH}`, PNPM_CODE: code }, encoding: 'utf8' });
    assert.equal(ready('0').status, 0);
    assert.equal(readFileSync(appels, 'utf8').trim(), `--dir apps/web run test 4 --navigateur --attestation ${attestation} test/navigateur/a.test.ts test/navigateur/d.test.ts`);
    assert.equal(ready('1').status, 1, 'un fichier rouge fait échouer l’étape du Ready');
  });

  test('le bilan atteste les fichiers de l’issue un à un, jamais toute l’interface dans le navigateur', () => {
    const f = dépôtGit('bilan');
    f.écrire('apps/web/test/navigateur/a.test.ts', '// a\n');
    f.écrire('apps/web/test/navigateur/b.test.ts', '// b\n');
    f.commettre('main');
    f.git('checkout', '-q', '-b', 'codage/307-bilan');
    const j = join(f.dépôt, '..', 'journaux');
    mkdirSync(j);
    writeFileSync(join(j, 'lances'), 'issue\tissue-navigateur\tvitest\n');
    writeFileSync(join(j, 'issue-navigateur.code'), '1\n');
    writeFileSync(join(j, 'issue-navigateur.log'), '');
    writeFileSync(join(j, 'issue-navigateur.rapport'), JSON.stringify({ testResults: [{ name: join(f.dépôt, 'apps/web/test/navigateur/a.test.ts'), status: 'passed', assertionResults: [] }, { name: join(f.dépôt, 'apps/web/test/navigateur/b.test.ts'), status: 'failed', assertionResults: [{ status: 'failed', title: '[niveau 4] b', ancestorTitles: [] }] }] }));
    writeFileSync(join(j, 'issue-navigateur.bilan'), JSON.stringify({ lisible: true, fichiers: [{ fichier: 'apps/web/test/navigateur/a.test.ts', ensemble: 'navigateur', etat: 'vert', seuil: 4 }, { fichier: 'apps/web/test/navigateur/b.test.ts', ensemble: 'navigateur', etat: 'rouge', seuil: 4 }] }));
    const plan = join(j, 'plan');
    writeFileSync(plan, `navigateur\t0\t2\t${h('n')}\tsans demande\n`);
    const verts = join(j, 'verts.json');
    writeFileSync(verts, '[]\n');
    const r = spawnSync('node', ['.githooks/attestation.mjs', 'bilan', plan, j, 'pré-push', f.git('rev-parse', 'HEAD^{tree}'), f.git('rev-parse', 'HEAD'), 'codage/307-bilan', verts, '--enregistrer'], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /pré-push : tests navigateur de l'issue : joués en entier : rouge\./, r.stdout);
    const message = f.git('log', '-1', '--format=%B', 'refs/attestations/codage/307-bilan');
    const attestés = JSON.parse(message.slice(message.indexOf('{'))).verts;
    assert.deepEqual(attestés.map((v) => [v.ensemble, v.fichier, v.seuil]), [['navigateur', 'apps/web/test/navigateur/a.test.ts', 4]], 'a seul, sur son empreinte, au seuil 4');
  });

  test('la livraison joue en entier les fichiers que la branche ajoute ou modifie, jamais la non-régression sans demande ; demandée, elle ne rejoue pas ce qui est vert, ni deux fois ce qu’elle exclut', async () => {
    const racine = temporaire('livraison');
    const dépôt = join(racine, 'depot');
    const distant = join(racine, 'distant.git');
    const témoin = join(racine, 'temoin');
    writeFileSync(témoin, '');
    for (const f of readdirSync(join(RACINE, '.githooks'))) cpSync(join(RACINE, '.githooks', f), join(dépôt, '.githooks', f));
    for (const f of readdirSync(join(RACINE, 'packages/gardes'))) {
      if (/\.mjs$|^package\.json$|^chemins-ignores$/.test(f) && !/\.test\.mjs$/.test(f)) cpSync(join(RACINE, 'packages/gardes', f), join(dépôt, 'packages/gardes', f));
    }
    const écrire = (f, texte) => {
      mkdirSync(dirname(join(dépôt, f)), { recursive: true });
      writeFileSync(join(dépôt, f), texte);
    };
    /** Un test navigateur de niveau 2 et un de niveau 4, chacun noté sous son nom. */
    const nav = (n) => [
      "import { appendFileSync } from 'node:fs';",
      "import { test } from 'vitest';",
      "const note = (q) => () => appendFileSync(process.env.TEMOIN_307, q + ' ' + (performance.timeOrigin + performance.now()) + '\\n');",
      `test('${n} [niveau 2]', note('nav-${n}'));`,
      `test('${n}4 [niveau 4]', note('nav-${n}4'));`,
      '',
    ].join('\n');
    écrire('typecheck.mjs', 'process.exit(0);\n');
    écrire('packages/gardes/package.json', JSON.stringify({ name: 'f-gardes', private: true, type: 'module', scripts: { test: 'node ./lanceur.mjs node --test', typecheck: 'node ../../typecheck.mjs' } }));
    écrire('packages/gardes/g.test.mjs', "import { test } from 'node:test';\ntest('g [niveau 1]', () => {});\n");
    écrire('apps/web/package.json', JSON.stringify({ name: 'f-web', private: true, type: 'module', scripts: { test: 'node ../../packages/gardes/lanceur.mjs vitest run', typecheck: 'node ../../typecheck.mjs' } }));
    écrire('apps/web/test/w.test.mjs', "import { test } from 'vitest';\ntest('w [niveau 1]', () => {});\n");
    for (const n of ['m', 'n', 'd']) écrire(`apps/web/test/navigateur/${n}.test.mjs`, nav(n));
    écrire('docs/a.md', 'Un document.\n');
    écrire('.gitignore', 'node_modules\n');
    const env = { ...process.env, TEMOIN_307: témoin, TIRELIRE_NAV: process.execPath, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t.invalid' };
    for (const k of Object.keys(env)) if (k === 'NODE_TEST_CONTEXT' || k.startsWith('VITEST') || (k.startsWith('GIT_') && !/^GIT_(AUTHOR|COMMITTER)_/.test(k)) || k === 'TIRELIRE_SEUIL') delete env[k];
    const git = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: dépôt, env, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', distant], { env });
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('remote', 'add', 'origin', distant);
    git('push', '-q', 'origin', 'main');
    git('fetch', '-q', 'origin');
    execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, dépôt], { env });
    const livrer = (...args) => new Promise((fini) => {
      const p = spawn('sh', ['.githooks/livraison.sh', ...args], { cwd: dépôt, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let sortie = '';
      p.stdout.on('data', (d) => (sortie += d));
      p.stderr.on('data', (d) => (sortie += d));
      p.on('close', (code) => fini({ code, sortie }));
    });
    const joués = () => readFileSync(témoin, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')[0]).filter((q) => q.startsWith('nav-')).sort();

    // La branche modifie n, ajoute p et supprime d ; m ne bouge pas.
    const B = 'codage/307-livraison';
    git('checkout', '-q', '-b', B);
    écrire('apps/web/test/navigateur/n.test.mjs', `${nav('n')}// modifié\n`);
    écrire('apps/web/test/navigateur/p.test.mjs', nav('p'));
    écrire('apps/web/test/navigateur/h.test.mjs', `// Harnais d'audit de #307 : un harnais navigateur, joué par le harnais du besoin et non par l'issue.\n${nav('h')}`);
    git('rm', '-q', 'apps/web/test/navigateur/d.test.mjs');
    git('add', '-A');
    git('commit', '-q', '-m', 'branche');
    const push = await livrer('push', `refs/heads/${B}`, git('rev-parse', 'HEAD'), `refs/heads/${B}`, '0'.repeat(40), 'origin');
    assert.equal(push.code, 0, push.sortie);
    assert.deepEqual(joués(), ['nav-h', 'nav-h4', 'nav-n', 'nav-n4', 'nav-p', 'nav-p4'], `la livraison joue n et p en entier, niveau 4 compris — ni m, que la branche ne touche pas, ni d, qu’elle supprime — et le harnais h une seule fois, par le harnais du besoin\n${push.sortie}`);

    writeFileSync(témoin, '');
    const demande = await livrer('demande', '--navigateur');
    assert.equal(demande.code, 0, demande.sortie);
    assert.deepEqual(joués(), ['nav-m'], `demandée, la non-régression se joue au seuil 2, sans n ni p, déjà verts sur leur empreinte\n${demande.sortie}`);

    // n change de nouveau : il se joue en entier, une seule fois — la non-régression l'exclut. (m peut
    // se rejouer : son ensemble n'est plus vert sur son empreinte, cela relève de #302.)
    writeFileSync(témoin, '');
    écrire('apps/web/test/navigateur/n.test.mjs', `${nav('n')}// modifié encore\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'n encore');
    const encore = await livrer('demande', '--navigateur');
    assert.equal(encore.code, 0, encore.sortie);
    assert.deepEqual(joués().filter((q) => q.startsWith('nav-n')), ['nav-n', 'nav-n4'], `n se joue une fois, en entier, hors de la non-régression\n${encore.sortie}`);

    // Une branche qui ne fait que supprimer un test navigateur n'a rien à y jouer, et n'échoue pas.
    writeFileSync(témoin, '');
    git('checkout', '-q', 'main');
    git('checkout', '-q', '-b', 'codage/307-suppression');
    git('rm', '-q', 'apps/web/test/navigateur/m.test.mjs');
    git('commit', '-q', '-m', 'suppression');
    const suppression = await livrer('push', 'refs/heads/codage/307-suppression', git('rev-parse', 'HEAD'), 'refs/heads/codage/307-suppression', '0'.repeat(40), 'origin');
    assert.equal(suppression.code, 0, `supprimer un test navigateur ne fait pas échouer la livraison\n${suppression.sortie}`);
    assert.deepEqual(joués(), [], 'rien à jouer dans le navigateur');
  });
});

// ─── Point 3 : la nuit ───────────────────────────────────────────────────────────────────────────

describe('[niveau 1] #307, point 3 · chaque nuit, vers 3 h à Paris, les tests navigateur sur main, sauf fichier vert sur son empreinte', () => {
  test('le workflow de la nuit : sur main, au seuil 2, avec l’attestation de la nuit', () => {
    const w = lireFichier('.github/workflows/nuit.yml');
    assert.match(w, /ref: main/);
    assert.match(w, /node \.githooks\/attestation\.mjs nuit "\$NUIT"/);
    assert.match(w, /pnpm run test 2 --navigateur --attestation "\$NUIT\/couverture\.json" --bilan/);
    assert.match(w, /TIRELIRE_STRICT: '1'/);
    assert.match(w, /attestation\.mjs envoyer origin nuit attestation-de-la-nuit/);
    assert.match(w, /node packages\/gardes\/nuit\.mjs signaler/);
  });

  test('chaque jour, un seul des deux déclenchements joue, et il tombe à 3 h à Paris, heure d’été comme d’hiver', () => {
    const w = lireFichier('.github/workflows/nuit.yml');
    const crons = [...w.matchAll(/^\s+- cron: '(\d+) (\d+) \* \* \*'/gm)].map((m) => ({ planifié: `${m[1]} ${m[2]} * * *`, minute: Number(m[1]), heure: Number(m[2]) }));
    assert.equal(crons.length, 2, 'deux déclenchements UTC');
    const cas = w.slice(w.indexOf('case "$GITHUB_EVENT_NAME'), w.indexOf('esac') + 4);
    assert.ok(cas.startsWith('case'), 'la décision de l’heure se lit dans le workflow');
    const mémo = new Map();
    const joue = (planifié, décalage) => {
      const clé = `${planifié}|${décalage}`;
      if (!mémo.has(clé)) mémo.set(clé, spawnSync('sh', ['-c', `GITHUB_EVENT_NAME=schedule PLANIFIE='${planifié}' decalage='${décalage}'; ${cas}; echo $jouer`], { encoding: 'utf8' }).stdout.trim() === 'oui');
      return mémo.get(clé);
    };
    const paris = (t) => {
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', timeZoneName: 'longOffset', hour: 'numeric', hourCycle: 'h23' }).formatToParts(t);
      return { décalage: p.find((x) => x.type === 'timeZoneName').value.replace('GMT', '').replace(':', ''), heure: Number(p.find((x) => x.type === 'hour').value) };
    };
    for (let jour = Date.UTC(2026, 0, 1); jour < Date.UTC(2028, 0, 1); jour += 86400000) {
      const date = new Date(jour).toISOString().slice(0, 10);
      const quiJouent = crons.map((c) => ({ ...c, ...paris(new Date(jour + (c.heure * 60 + c.minute) * 60000)) })).filter((d) => joue(d.planifié, d.décalage));
      assert.equal(quiJouent.length, 1, `${date} : ${quiJouent.length} déclenchement(s) jouent`);
      assert.equal(quiJouent[0].heure, 3, `${date} : le déclenchement qui joue tombe à ${quiJouent[0].heure} h à Paris`);
    }
    assert.equal(joue('', '+0100'), false, 'un déclenchement inconnu ne joue pas');
    const manuel = spawnSync('sh', ['-c', `GITHUB_EVENT_NAME=workflow_dispatch PLANIFIE='' decalage='+0100'; ${cas}; echo $jouer`], { encoding: 'utf8' }).stdout.trim();
    assert.equal(manuel, 'oui', 'le lancement manuel joue toujours');
  });

  test('ce qu’une nuit trouve vert vaut pour les suivantes ; une nuit sans changement ne joue rien et le dit ; un fichier rouge se rejoue', () => {
    const f = dépôtGit('nuit');
    f.écrire('apps/web/src/x.ts', 'export const x = 1;\n');
    f.écrire('apps/web/test/navigateur/a.test.ts', '// a\n');
    f.écrire('apps/web/test/navigateur/b.test.ts', '// b\n');
    f.commettre('main');
    f.git('push', '-q', 'origin', 'main');
    const d = (n) => join(f.dépôt, '..', `nuit-${n}`);
    const nuit = (n) => {
      const r = spawnSync('node', ['.githooks/attestation.mjs', 'nuit', d(n)], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return { sortie: r.stdout, jouer: readFileSync(join(d(n), 'jouer'), 'utf8').trim(), couverture: JSON.parse(readFileSync(join(d(n), 'couverture.json'), 'utf8')) };
    };
    /** Un lancement simulé : les fichiers verts ou rouges, puis le bilan et l'envoi, comme dans `nuit.yml`. */
    const jouée = (n, états) => {
      const j = join(d(n), 'journaux');
      mkdirSync(j, { recursive: true });
      const rouge = Object.values(états).includes('rouge');
      writeFileSync(join(j, 'lances'), 'navigateur\tnavigateur\tvitest\n');
      writeFileSync(join(j, 'navigateur.code'), rouge ? '1\n' : '0\n');
      writeFileSync(join(j, 'navigateur.log'), '');
      writeFileSync(join(j, 'navigateur.rapport'), JSON.stringify({ testResults: Object.entries(états).map(([x, e]) => ({ name: join(f.dépôt, `apps/web/test/navigateur/${x}.test.ts`), status: e === 'vert' ? 'passed' : 'failed', assertionResults: [] })) }));
      writeFileSync(join(j, 'navigateur.bilan'), JSON.stringify({ lisible: true, fichiers: Object.entries(états).map(([x, e]) => ({ fichier: `apps/web/test/navigateur/${x}.test.ts`, ensemble: 'navigateur', etat: e, seuil: 2 })) }));
      const b = spawnSync('node', ['.githooks/attestation.mjs', 'bilan', join(d(n), 'plan'), j, 'la nuit', f.git('rev-parse', 'HEAD^{tree}'), f.git('rev-parse', 'HEAD'), 'nuit', join(d(n), 'verts.json'), '--enregistrer'], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
      assert.equal(b.status, 0, b.stderr);
      const e = spawnSync('node', ['.githooks/attestation.mjs', 'envoyer', 'origin', 'nuit', 'attestation-de-la-nuit'], { cwd: f.dépôt, env: f.env, encoding: 'utf8' });
      assert.match(e.stdout, /envoyée \(attestation-de-la-nuit\)/, e.stdout + e.stderr);
    };

    const première = nuit(1);
    assert.equal(première.jouer, 'oui', première.sortie);
    assert.match(première.sortie, /aucune attestation de la nuit lue/i);
    jouée(1, { a: 'vert', b: 'rouge' });

    const deuxième = nuit(2);
    assert.equal(deuxième.jouer, 'oui', 'une nuit rouge : la suivante rejoue');
    assert.deepEqual(Object.keys(deuxième.couverture.fichiers), ['apps/web/test/navigateur/a.test.ts'], 'a, vert, se saute ; b, rouge, se rejoue');
    jouée(2, { b: 'vert' });

    const troisième = nuit(3);
    assert.equal(troisième.jouer, 'non', troisième.sortie);
    assert.match(troisième.sortie, /rien ne se joue cette nuit — empreinte trouvée verte par la nuit, sur le commit [0-9a-f]{10}, au seuil 2 ; rien de ce qu'ils lisent n'a changé/);

    f.écrire('docs/note.md', 'rien que de la documentation\n');
    f.commettre('docs');
    assert.equal(nuit(4).jouer, 'non', 'la documentation : les tests navigateur ne la lisent pas');
    f.écrire('apps/web/src/x.ts', 'export const x = 2;\n');
    f.commettre('code');
    const cinquième = nuit(5);
    assert.equal(cinquième.jouer, 'oui', 'ce qu’ils lisent a changé : ils se rejouent');
    assert.deepEqual(cinquième.couverture.fichiers, {}, 'aucun fichier ne reste couvert');
  });
});

// ─── Point 4 : une nuit rouge se signale ─────────────────────────────────────────────────────────

describe('[niveau 1] #307, point 4 · une nuit rouge — même sans avoir pu jouer — ouvre ou complète une issue ; la nuit verte qui suit le dit ; aucune nuit ne bloque une fusion', () => {
  test('ce que la nuit demande à GitHub : une issue, un commentaire, ou rien', () => {
    const dossier = temporaire('signal');
    const faux = join(dossier, 'fetch.mjs');
    // Un GitHub de poche : il répond d'après `STUB_REPONSES` et note chaque appel dans `STUB_JOURNAL`.
    writeFileSync(faux, [
      "import { appendFileSync } from 'node:fs';",
      'const reponses = JSON.parse(process.env.STUB_REPONSES);',
      'globalThis.fetch = async (url, options = {}) => {',
      "  const chemin = decodeURIComponent(new URL(url).pathname).split('/repos/o/r/')[1];",
      "  const methode = options.method ?? 'GET';",
      '  appendFileSync(process.env.STUB_JOURNAL, JSON.stringify({ methode, chemin, corps: options.body ? JSON.parse(options.body) : null }) + String.fromCharCode(10));',
      "  const r = methode === 'GET' ? (reponses[chemin] ?? []) : { number: 12 };",
      "  return { ok: true, status: 200, json: async () => r, text: async () => '' };",
      '};',
      '',
    ].join('\n'));
    const rapport = join(dossier, 'rapport.json');
    writeFileSync(rapport, JSON.stringify({ testResults: [{ name: '/x/apps/web/test/navigateur/b.test.ts', status: 'failed' }, { name: '/x/apps/web/test/navigateur/a.test.ts', status: 'passed' }] }));
    const commit = 'c'.repeat(40);
    const ouverte = (commentaires) => ({ issues: [{ number: 9, title: TITRE, body: `${MARQUE}\n${ROUGE}\nNuit rouge`, comments: commentaires.length }], 'issues/9/comments': commentaires.map((body) => ({ body })) });
    const nuit = (verdict, reponses) => {
      const journal = join(dossier, `journal-${Math.random().toString(36).slice(2)}`);
      writeFileSync(journal, '');
      const r = spawnSync('node', ['--import', pathToFileURL(faux).href, 'nuit.mjs', 'signaler', verdict, commit, rapport, 'https://exemple.invalid/run/1'], { cwd: join(RACINE, 'packages/gardes'), encoding: 'utf8', env: { ...process.env, GH_TOKEN: 't', GH_REPO: 'o/r', STUB_REPONSES: JSON.stringify(reponses), STUB_JOURNAL: journal } });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      return readFileSync(journal, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.methode === 'POST');
    };

    const créée = nuit('rouge', {});
    assert.equal(créée.length, 1, JSON.stringify(créée));
    assert.equal(créée[0].chemin, 'issues');
    assert.equal(créée[0].corps.title, TITRE);
    assert.ok(créée[0].corps.body.includes(MARQUE) && créée[0].corps.body.includes('`apps/web/test/navigateur/b.test.ts`') && créée[0].corps.body.includes(commit), créée[0].corps.body);
    assert.ok(!créée[0].corps.body.includes('a.test.ts'), 'seul le fichier rouge est nommé');

    const complétée = nuit('rouge', ouverte([ROUGE]));
    assert.deepEqual(complétée.map((x) => x.chemin), ['issues/9/comments'], 'une issue de la nuit est ouverte : elle se complète, il ne s’en ouvre pas une autre');
    assert.ok(complétée[0].corps.body.includes('`apps/web/test/navigateur/b.test.ts`') && complétée[0].corps.body.includes(commit));

    const verte = nuit('vert', ouverte([VERTE, ROUGE]));
    assert.deepEqual(verte.map((x) => x.chemin), ['issues/9/comments'], 'la nuit verte qui suit la rouge le dit dans son issue');
    assert.ok(verte[0].corps.body.includes(VERTE) && verte[0].corps.body.includes(commit));

    assert.deepEqual(nuit('vert', ouverte([ROUGE, VERTE])), [], 'une nuit verte après une nuit verte ne dit rien : c’est le dernier commentaire qui compte');
    assert.deepEqual(nuit('vert', {}), [], 'sans issue ouverte, une nuit verte ne dit rien');
  });

  test('une nuit qui devait jouer se signale rouge, même si elle échoue avant de savoir ce qu’elle joue, et nomme alors le commit du déclenchement ; une nuit qui n’a rien à jouer ne dit rien', () => {
    const SHA = 's'.repeat(40);
    const nuit = (plan, échoue) => {
      const ctx = { github: { event: {}, event_name: 'schedule', sha: SHA }, vars: {}, secrets: {}, inputs: {}, needs: { heure: { outputs: { jouer: 'oui' } } }, steps: { plan, tests: { outcome: 'skipped', outputs: {} } } };
      const jouées = jouer(lireFichier('.github/workflows/nuit.yml'), ctx, (é) => échoue && /^\s+(?:- )?id: plan\b/m.test(é.texte)).flatMap((j) => j.joués);
      const signal = jouées.find((é) => /nuit\.mjs signaler/.test(é.texte));
      return signal ? { commit: interpoler(/^\s+COMMIT: (.*)$/m.exec(signal.texte)[1], ctx) } : null;
    };
    assert.deepEqual(nuit({ outcome: 'success', outputs: { jouer: 'oui', commit: 'c' } }, false), { commit: 'c' }, 'le plan dit de jouer : le signal se joue, avec le commit du plan');
    assert.equal(nuit({ outcome: 'success', outputs: { jouer: 'non', commit: 'c' } }, false), null, 'le plan dit que rien ne se joue : rien à signaler');
    assert.deepEqual(nuit({ outcome: 'failure', outputs: {} }, true), { commit: SHA }, 'le plan lui-même échoue (outil, extraction) : la nuit est rouge, se signale, et nomme le commit du déclenchement');
  });

  /** Le script de l'étape du signal, tel que `nuit.yml` l'écrit : le corps de `run`, sans son retrait. */
  const scriptDuSignal = () => {
    const lignes = lireFichier('.github/workflows/nuit.yml').split('\n');
    const début = lignes.findIndex((l) => l.includes('- name: Une nuit rouge se signale'));
    const run = lignes.findIndex((l, i) => i > début && /^ {8}run: \|$/.test(l));
    const corps = [];
    for (const l of lignes.slice(run + 1)) {
      if (l.trim() && !l.startsWith(' '.repeat(10))) break;
      corps.push(l.slice(10));
    }
    return corps.join('\n');
  };
  const COMMIT = 'c'.repeat(40);
  const EXECUTION = 'https://exemple.invalid/run/1';

  test('avec le dépôt extrait, l’étape du signal donne à nuit.mjs le verdict, le commit, le rapport de la nuit et l’exécution, sans appeler gh', () => {
    const d = temporaire('signal-depot');
    mkdirSync(join(d, 'packages/gardes'), { recursive: true });
    mkdirSync(join(d, 'bin'));
    writeFileSync(join(d, 'packages/gardes/nuit.mjs'), "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.APPELS, JSON.stringify(process.argv.slice(2)) + '\\n');\n");
    writeFileSync(join(d, 'bin/gh'), `#!/bin/sh\necho gh >> "${d}/appels-gh"\n`, { mode: 0o755 });
    const jouée = (résultat, nuit) => {
      rmSync(join(d, 'appels'), { force: true });
      const env = { ...process.env, PATH: `${join(d, 'bin')}:${process.env.PATH}`, APPELS: join(d, 'appels'), RESULTAT: résultat, COMMIT, EXECUTION, RUNNER_TEMP: d };
      delete env.NUIT;
      if (nuit) env.NUIT = nuit;
      const r = spawnSync('bash', ['-e', '-c', scriptDuSignal()], { cwd: d, encoding: 'utf8', env });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      return JSON.parse(readFileSync(join(d, 'appels'), 'utf8').trim());
    };
    assert.deepEqual(jouée('failure', '/n'), ['signaler', 'rouge', COMMIT, '/n/journaux/navigateur.rapport', EXECUTION]);
    assert.deepEqual(jouée('success', '/n'), ['signaler', 'vert', COMMIT, '/n/journaux/navigateur.rapport', EXECUTION], 'tests verts : la nuit est verte');
    assert.deepEqual(jouée('skipped', null), ['signaler', 'rouge', COMMIT, `${d}/nuit/journaux/navigateur.rapport`, EXECUTION], 'tests sautés : rouge ; sans le dossier de la nuit, celui que le plan lui aurait donné');
    assert.equal(existsSync(join(d, 'appels-gh')), false, 'gh ne sert que sans le dépôt');
  });

  const JQ = spawnSync('jq', ['--version']).status === 0;
  test('sans le dépôt extrait, la nuit rouge se signale par gh : l’issue de la nuit se complète, sinon il s’en ouvre une', { skip: !JQ && !process.env.TIRELIRE_STRICT && 'jq absent' }, () => {
    const nuit = (ouvertes) => {
      const d = temporaire('signal-gh');
      mkdirSync(join(d, 'bin'));
      writeFileSync(join(d, 'issues.json'), JSON.stringify(ouvertes));
      // Un `gh` de poche : il note ses appels, et applique à `issues.json` le filtre `--jq` qu'on lui donne, avec le vrai jq.
      writeFileSync(join(d, 'bin/gh'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${d}/appels"\nif [ "$1 $2" = "issue list" ]; then\n  while [ $# -gt 0 ]; do\n    if [ "$1" = --jq ]; then shift; jq -r "$1" "${d}/issues.json"; exit $?; fi\n    shift\n  done\nfi\nexit 0\n`, { mode: 0o755 });
      const r = spawnSync('bash', ['-e', '-c', scriptDuSignal()], { cwd: d, encoding: 'utf8', env: { ...process.env, PATH: `${join(d, 'bin')}:${process.env.PATH}`, RESULTAT: 'skipped', COMMIT, EXECUTION, RUNNER_TEMP: d } });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      return readFileSync(join(d, 'appels'), 'utf8');
    };
    const issue = (number, title, body) => ({ number, title, body });

    const créée = nuit([]);
    assert.ok(créée.includes(`issue create --title ${TITRE} --body ${MARQUE}`), créée);
    assert.ok(créée.includes(ROUGE) && créée.includes(COMMIT), 'la marque de la nuit rouge, et le commit jugé');
    assert.doesNotMatch(créée, /issue comment/);

    const complétée = nuit([issue(5, TITRE, 'sans marque'), issue(9, TITRE, `${MARQUE}\nplus récente`), issue(7, TITRE, `${MARQUE}\nla plus ancienne`), issue(3, 'une autre issue', MARQUE)]);
    assert.match(complétée, /^issue comment 7 --body <!-- nuit : rouge -->/m, 'la plus ancienne issue de la nuit, par son titre et sa marque');
    assert.doesNotMatch(complétée, /issue create/);

    const autre = nuit([issue(5, TITRE, 'sans marque')]);
    assert.ok(autre.includes('issue create'), 'une issue au même titre, sans la marque de la nuit, n’est pas celle de la nuit');
  });

  test('la nuit ne se lance que seule et n’écrit que des branches et des issues : elle ne peut bloquer aucune fusion', () => {
    const w = lireFichier('.github/workflows/nuit.yml');
    const déclencheurs = w.slice(w.indexOf('\non:'), w.indexOf('\npermissions:'));
    assert.deepEqual([...déclencheurs.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]).sort(), ['schedule', 'workflow_dispatch'], 'ni pull_request, ni push : aucune tête de PR ne porte son résultat');
    assert.match(w, /^permissions: \{\}/m, 'aucun droit par défaut');
    const droits = [...w.matchAll(/^ {6}([a-z-]+): (?:read|write)/gm)].map((m) => m[1]).sort();
    assert.deepEqual(droits, ['contents', 'issues'], 'ni statut, ni vérification, ni commentaire de PR');
    for (const f of readdirSync(join(RACINE, '.github/workflows')).filter((x) => x !== 'nuit.yml')) {
      const autre = lireFichier(`.github/workflows/${f}`);
      assert.doesNotMatch(autre, /workflow_run:|uses: \.\/\.github\/workflows\/nuit\.yml/, `${f} : rien ne dépend de la nuit`);
    }
  });
});
