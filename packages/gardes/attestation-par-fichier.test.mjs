/**
 * Harnais d'audit de #302, composé parmi les tests du codeur (D83) : chaque test porte sa marque ;
 * le second fichier du harnais est `apps/web/test/site-une-fois.test.ts` (point 8).
 *
 * Tout lancement de l'outil de test atteste ce qu'il a joué vert, fichier par fichier, et saute ce
 * qui est vert sur son empreinte.
 *
 * **Qu'aucun rouge ne fusionne** (niveau 1) — principe 10.1 et D83 (« aucun job sauté ne peut laisser
 * fusionner ce qu'un job joué aurait rougi ») : un fichier ne se saute que vert sur la même empreinte,
 * à un seuil au moins égal (point 4) ; n'est pas attesté, ou pas au-delà du seuil joué, un fichier
 * rouge, sauté faute d'outil, écarté en partie par le seuil, ou joué pendant qu'un fichier lu changeait
 * (points 1 et 2) ; un appel nommé se joue toujours (point 2) ; le harnais du besoin pas joué en entier
 * se rejoue (point 5) ; sur `main`, une sous-branche ou une tête détachée — le tag —, rien ne se saute
 * (point 4).
 *
 * **Le dégradé** (niveau 3) : si ces tests tombent, le résultat reste juste, obtenu plus lentement ou
 * moins lisiblement — ce qui a tourné vert ne se rejoue pas, et chaque lancement dit ce qu'il joue et
 * ce qu'il saute (points 1, 3 à 6).
 *
 * - La décision, sans git : ce qui couvre un fichier (`fichiersCouverts`), ce que chaque fichier a
 *   donné (`fichiersDuLancement`), ce que l'attestation garde (`fusionner`, `dejaVert`).
 * - Le lanceur dans un petit dépôt inventé, sur une branche : un lancement atteste, le suivant saute ;
 *   un fichier rouge, un fichier qui change pendant le lancement, un appel nommé, `main` et une
 *   sous-branche n'attestent rien ; le push qui suit un `pnpm test 2` vert ne rejoue rien, hors le
 *   harnais du besoin qu'il n'a pas joué en entier ; la CI au Ready qui suit un lancement des tests
 *   navigateur vert ne les rejoue pas.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
  TOUS,
  couvertureAuReady,
  couvertureLocale,
  dejaVert,
  fichiersCouverts,
  fichiersDuLancement,
  fusionner,
  lireLAttestation,
  texteDeLAttestation,
} from './attestation.mjs';
import { RACINE } from './gardes.mjs';

const ATTESTATION_MJS = join(RACINE, '.githooks/attestation.mjs');
const E = (graine) => Object.fromEntries(TOUS.map((id) => [id, createHash('sha256').update(`${graine}${id}`).digest('hex')]));
const vert = (ensemble, empreinte, seuil, extra = {}) => ({ ensemble, empreinte, seuil, par: 'un lancement', arbre: 'a'.repeat(40), date: '2026-10-01T00:00:00Z', ...extra });
const demande = (dossier, extra = {}) => ({ dossier, seuil: 2, navigateur: false, cibles: [], nomme: false, ...extra });

describe('[niveau 4] #302 · la décision, fichier par fichier', () => {
  const e = E('x');
  const W = 'apps/web/test/w.test.ts';
  const N = 'apps/web/test/navigateur/n.test.ts';
  const H = 'apps/web/test/h.test.ts';

  test('[niveau 1] points 1 et 4 · un fichier attesté vert sur son empreinte se saute, à un seuil au moins égal ; pas un autre', () => {
    // #304 : un fichier attesté vaut sur sa propre empreinte, celle que l'arbre jugé lui donne (`fichiers`).
    const c = couvertureLocale({ arbre: 'a', empreintes: e, fichiers: { [W]: e.interface }, verts: [vert('interface', e.interface, 2, { fichier: W })] });
    const d = (f, s) => fichiersCouverts(c, demande('apps/web', { seuil: s }), [f], e)[0];
    assert.equal(d(W, 2).couvert, true);
    assert.match(d(W, 2).raison, /fichier attesté vert par un lancement, sur l'arbre a{10}, au seuil 2/);
    assert.equal(d(W, 3).couvert, false, 'un seuil plus haut se joue');
    assert.equal(d('apps/web/test/autre.test.ts', 2).couvert, false, 'un autre fichier du même ensemble se joue');
    const ailleurs = couvertureLocale({ arbre: 'a', empreintes: E('y'), fichiers: { [W]: E('y').interface }, verts: [vert('interface', e.interface, 2, { fichier: W })] });
    assert.equal(fichiersCouverts(ailleurs, demande('apps/web'), [W], E('y'))[0].couvert, false, 'sur une autre empreinte, il se joue');
  });

  test('[niveau 1] point 2 · un appel nommé se joue toujours ; un contenu joué d’une autre empreinte que la couverture aussi', () => {
    const c = couvertureLocale({ arbre: 'a', empreintes: e, verts: [vert('interface', e.interface, 4, { fichier: W })] });
    assert.equal(fichiersCouverts(c, demande('apps/web', { nomme: true }), [W], e)[0].couvert, false);
    assert.equal(fichiersCouverts(c, demande('apps/web'), [W], { ...e, interface: E('z').interface })[0].couvert, false);
  });

  test('[niveau 1] point 6 · ce qui couvre tout un ensemble — base commune avec main, tête verte au Ready — couvre chacun de ses fichiers', () => {
    const main = couvertureLocale({ arbre: 'a', empreintes: e, main: { commit: 'm'.repeat(40), empreintes: e } });
    for (const f of [W, N]) assert.equal(fichiersCouverts(main, demande('apps/web', { navigateur: true }), [f], e)[0].couvert, true, f);
    assert.equal(fichiersCouverts(main, demande('apps/web', { seuil: 3 }), [W], e)[0].couvert, false, 'main ne couvre que jusqu’au seuil 2');
    const ready = couvertureAuReady({ arbre: 'a', empreintes: e, tetes: [{ sha: 't'.repeat(40), statut: 'success', empreintes: e }] });
    assert.equal(fichiersCouverts(ready, demande('apps/web', { seuil: 1 }), [W], e)[0].couvert, true);
  });

  test('[niveau 1] point 5 · dans un lancement du harnais du besoin, seul ce qui couvre le harnais, ou le fichier lui-même, le couvre', () => {
    const harnais = [H];
    const eh = { ...e, harnais: 'h'.repeat(64) };
    const ensembleVert = couvertureLocale({ arbre: 'a', empreintes: eh, verts: [vert('interface', eh.interface, 4)], harnais });
    const lancement = demande('apps/web', { seuil: 4, cibles: ['test/h.test.ts'] });
    assert.equal(fichiersCouverts(ensembleVert, lancement, [H], eh)[0].couvert, false, 'l’interface verte ne couvre pas le harnais');
    const fichierVert = couvertureLocale({ arbre: 'a', empreintes: eh, fichiers: { [H]: eh.interface }, verts: [vert('interface', eh.interface, 4, { fichier: H })], harnais });
    assert.equal(fichiersCouverts(fichierVert, lancement, [H], eh)[0].couvert, true, 'le fichier du harnais joué en entier le couvre');
    const auSeuil2 = couvertureLocale({ arbre: 'a', empreintes: eh, fichiers: { [H]: eh.interface }, verts: [vert('interface', eh.interface, 2, { fichier: H })], harnais });
    assert.equal(fichiersCouverts(auSeuil2, lancement, [H], eh)[0].couvert, false, 'joué au seuil 2 seulement, il se rejoue en entier');
  });

  test('[niveau 1] point 4 · une empreinte verte d’un fichier ne vaut jamais pour tout son ensemble ; l’attestation les garde toutes deux', () => {
    const verts = [vert('coeur', e.coeur, 4, { fichier: 'packages/core/test/a.test.ts' })];
    assert.equal(dejaVert({ id: 'coeur', empreinte: e.coeur, seuil: 1, verts }), null);
    const gardes = fusionner(verts, [vert('coeur', e.coeur, 2)], [vert('coeur', e.coeur, 2, { fichier: 'packages/core/test/a.test.ts', date: '2026-09-01T00:00:00Z' })]);
    assert.equal(gardes.length, 2, 'une entrée par fichier et empreinte, au plus haut seuil, et une pour l’ensemble');
    const { attestation } = lireLAttestation(texteDeLAttestation({ branche: 'codage/302-x', verts: gardes }));
    assert.deepEqual(attestation.verts.map((v) => `${v.fichier ?? '-'}:${v.seuil}`).sort(), ['-:2', 'packages/core/test/a.test.ts:4']);
    const étranger = lireLAttestation(texteDeLAttestation({ branche: 'b', verts: [vert('coeur', e.coeur, 2, { fichier: 'apps/web/test/w.test.ts' })] })).attestation;
    assert.deepEqual(étranger.verts, [], 'un fichier n’est attesté que dans l’ensemble de son paquet');
  });

  test('[niveau 1] points 1 et 2 · ce que chaque fichier a donné, sous vitest : rouge, sauté faute d’outil, joué en entier ou non', () => {
    const f = (name, tests, status = 'passed') => ({ name, status, assertionResults: tests.map(([t, s]) => ({ ancestorTitles: [], title: t, status: s })) });
    const r = fichiersDuLancement({
      code: 1,
      sorte: 'vitest',
      seuil: 2,
      rapport: {
        testResults: [
          f('/r/entier', [['a [niveau 1]', 'passed'], ['b', 'todo']]),
          f('/r/ecarte', [['a', 'passed'], ['b [niveau 3]', 'skipped']]),
          f('/r/rouge', [['a', 'failed']], 'failed'),
          f('/r/saute', [['a [niveau 1]', 'skipped']]),
          f('/r/charge', [], 'failed'),
        ],
      },
    });
    assert.deepEqual(Object.fromEntries([...r].map(([k, v]) => [k, `${v.etat}:${v.seuil}`])), {
      '/r/entier': 'vert:4',
      '/r/ecarte': 'vert:2',
      '/r/rouge': 'rouge:4',
      '/r/saute': 'sauté:4',
      '/r/charge': 'rouge:4',
    });
    assert.equal(fichiersDuLancement({ code: 1, sorte: 'vitest', seuil: 2, rapport: { testResults: [f('/r/a', [['a', 'passed']])] } }), null, 'rouge sans fichier rouge : illisible');
    assert.equal(fichiersDuLancement({ code: 0, sorte: 'vitest', seuil: 2, rapport: null }), null);
  });

  test('[niveau 1] points 1 et 2 · ce que chaque fichier a donné, sous node --test', () => {
    const lignes = [
      { type: 'lance', fichier: '/n/a' },
      { type: 'lance', fichier: '/n/b' },
      { type: 'lance', fichier: '/n/c' },
      { type: 'echec', fichier: '/n/b' },
      { type: 'saute', fichier: '/n/c' },
      { type: 'echec', fichier: '/n/enveloppe-sans-lancement' },
    ];
    const r = fichiersDuLancement({ code: 1, sorte: 'node', seuil: 1, lignes, ecartes: new Map([['/n/a', 2]]) });
    assert.deepEqual(Object.fromEntries([...r].map(([k, v]) => [k, `${v.etat}:${v.seuil}`])), { '/n/a': 'vert:1', '/n/b': 'rouge:4', '/n/c': 'sauté:4' });
  });
});

// ─── Le lanceur, dans un dépôt inventé ──────────────────────────────────────────────────────────

let dossierTemporaire;
const temporaire = () => (dossierTemporaire ??= mkdtempSync(join(tmpdir(), 'attestation-302-')));
after(() => {
  if (dossierTemporaire) rmSync(dossierTemporaire, { recursive: true, force: true });
});

function environnement(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'NODE_TEST_CONTEXT' || k.startsWith('VITEST') || k.startsWith('GIT_') || k.startsWith('TIRELIRE_')) delete env[k];
  return { ...env, GIT_AUTHOR_NAME: 'Tests 302', GIT_AUTHOR_EMAIL: 'tests@exemple.invalid', GIT_COMMITTER_NAME: 'Tests 302', GIT_COMMITTER_EMAIL: 'tests@exemple.invalid', ...extra };
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

/**
 * Un petit dépôt : les crochets et la garde du dépôt, un cœur en `node --test` (deux fichiers), une
 * interface en vitest avec un test navigateur ; chaque test note son passage dans `TEMOIN_302`.
 */
function dépôtInventé(nom) {
  const dépôt = join(temporaire(), nom);
  const distant = join(temporaire(), `${nom}.git`);
  const témoin = join(temporaire(), `${nom}.temoin`);
  writeFileSync(témoin, '');
  for (const f of readdirSync(join(RACINE, '.githooks'))) cpSync(join(RACINE, '.githooks', f), join(dépôt, '.githooks', f));
  for (const f of readdirSync(join(RACINE, 'packages/gardes'))) if (/\.mjs$|^package\.json$|^chemins-ignores$/.test(f) && !/\.test\.mjs$/.test(f)) cpSync(join(RACINE, 'packages/gardes', f), join(dépôt, 'packages/gardes', f));
  const écrire = (f, texte) => {
    mkdirSync(dirname(join(dépôt, f)), { recursive: true });
    writeFileSync(join(dépôt, f), texte);
  };
  const note = (quoi) => `import { appendFileSync } from 'node:fs';\nconst note = () => appendFileSync(process.env.TEMOIN_302, ${JSON.stringify(quoi)} + '\\n');\n`;
  écrire('typecheck.mjs', '');
  écrire('packages/gardes/package.json', JSON.stringify({ name: 'f-gardes', private: true, type: 'module', scripts: { test: 'node ./lanceur.mjs node --test', typecheck: 'node ../../typecheck.mjs' } }));
  écrire('packages/gardes/g.test.mjs', `${note('garde')}import { test } from 'node:test';\ntest('g [niveau 0]', note);\n`);
  écrire('packages/core/package.json', JSON.stringify({ name: 'f-core', private: true, type: 'module', scripts: { test: 'node ../gardes/lanceur.mjs node --test', typecheck: 'node ../../typecheck.mjs' } }));
  écrire('packages/core/lib.mjs', 'export const un = 1;\n');
  écrire('packages/core/a.test.mjs', `${note('a')}import { test } from 'node:test';\ntest('a [niveau 1]', note);\n`);
  écrire('packages/core/b.test.mjs', `${note('b')}import { test } from 'node:test';\ntest('b [niveau 2]', note);\n`);
  écrire('apps/web/package.json', JSON.stringify({ name: 'f-web', private: true, type: 'module', scripts: { test: 'node ../../packages/gardes/lanceur.mjs vitest run', typecheck: 'node ../../typecheck.mjs' } }));
  écrire('apps/web/test/w.test.mjs', `${note('w')}import { test } from 'vitest';\ntest('w [niveau 1]', note);\n`);
  écrire('apps/web/test/navigateur/n.test.mjs', `${note('n')}import { test } from 'vitest';\ntest('n [niveau 2]', note);\n`);
  écrire('docs/a.md', 'Un document.\n');
  écrire('.gitignore', 'node_modules\n');
  const env = environnement({ TEMOIN_302: témoin });
  const git = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: dépôt, env, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', distant], { env });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('remote', 'add', 'origin', distant);
  git('push', '-q', 'origin', 'main');
  git('fetch', '-q', 'origin');
  execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, dépôt], { env });
  const joués = () => readFileSync(témoin, 'utf8').split('\n').filter(Boolean).sort();
  const vider = () => writeFileSync(témoin, '');
  /** `pnpm --dir <paquet> run test …` ; rend la sortie et les tests joués. */
  const tester = async (paquet, ...args) => {
    vider();
    const r = await lancer('pnpm', ['--dir', join(dépôt, paquet), 'run', 'test', ...args], { cwd: dépôt, env });
    return { ...r, joués: joués() };
  };
  const attestation = (branche) => {
    const c = execFileSync('git', ['rev-parse', '-q', '--verify', `refs/attestations/${branche}`], { cwd: dépôt, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return lireLAttestation(git('log', '-1', '--format=%B', c.trim())).attestation;
  };
  const attestationOuRien = (branche) => {
    try {
      return attestation(branche);
    } catch {
      return null;
    }
  };
  return { dépôt, distant, env, git, écrire, tester, joués, vider, attestation: attestationOuRien };
}

describe('[niveau 4] #302 · le lanceur atteste ce qu’il joue vert, et saute ce qui l’est', { concurrency: true }, () => {
  test('[niveau 3] points 1 et 4 · un lancement atteste chaque fichier joué vert ; le suivant le saute et dit pourquoi ; un changement de ce que lit l’ensemble fait tout rejouer', async () => {
    const f = dépôtInventé('saut');
    f.git('checkout', '-q', '-b', 'codage/997-saut');
    // Sans changement, la base commune avec main couvrirait tout (point 6).
    f.écrire('packages/core/lib.mjs', 'export const un = 4;\n');
    const premier = await f.tester('packages/core', '2');
    assert.equal(premier.code, 0, premier.sortie);
    assert.deepEqual(premier.joués, ['a', 'b'], premier.sortie);
    assert.match(premier.sortie, /attestation : cœur, seuil 2 : 2 fichier\(s\) joué\(s\), 0 sauté\(s\)/);
    const a = f.attestation('codage/997-saut');
    assert.deepEqual(a.verts.map((v) => `${v.ensemble}:${v.fichier}:${v.seuil}`).sort(), ['coeur:packages/core/a.test.mjs:4', 'coeur:packages/core/b.test.mjs:4'], 'joués en entier, ils sont attestés au seuil 4');
    const second = await f.tester('packages/core', '2');
    assert.equal(second.code, 0, second.sortie);
    assert.deepEqual(second.joués, [], second.sortie);
    assert.match(second.sortie, /attestation : cœur : sauté\(s\) — fichier attesté vert par le lancement « test 2 » dans packages\/core, sur l'arbre [0-9a-f]{10}, au seuil 4 : a\.test\.mjs, b\.test\.mjs\./, second.sortie);
    f.écrire('packages/core/lib.mjs', 'export const un = 2;\n');
    const après = await f.tester('packages/core', '2');
    assert.deepEqual(après.joués, ['a', 'b'], `un fichier que lit l'ensemble a changé, copie de travail comprise : tout se rejoue\n${après.sortie}`);
  });

  test('[niveau 1] points 1 et 2 · un fichier écarté en partie par le seuil est attesté à ce seuil, sous node comme sous vitest ; un fichier rouge, sauté faute d’outil, ou un appel nommé, n’atteste rien', async () => {
    const f = dépôtInventé('rouge');
    f.git('checkout', '-q', '-b', 'codage/996-rouge');
    f.écrire('packages/core/lib.mjs', 'export const un = 4;\n');
    f.écrire('packages/core/r.test.mjs', "import { test } from 'node:test';\ntest('r [niveau 1]', () => { throw new Error('rouge'); });\n");
    f.écrire('packages/core/s.test.mjs', "import { test } from 'node:test';\ntest('s [niveau 1]', { skip: 'faute d’outil' }, () => {});\n");
    const r = await f.tester('packages/core', '1');
    assert.notEqual(r.code, 0, r.sortie);
    assert.match(r.sortie, /attestation : r\.test\.mjs : non attesté — rouge\./, r.sortie);
    assert.match(r.sortie, /attestation : s\.test\.mjs : non attesté — un test s'est sauté/, r.sortie);
    const a = f.attestation('codage/996-rouge');
    assert.deepEqual(a.verts.map((v) => `${v.fichier}:${v.seuil}`).sort(), ['packages/core/a.test.mjs:4', 'packages/core/b.test.mjs:1'], `b, de niveau 2, écarté au seuil 1 : attesté au seuil 1\n${r.sortie}`);
    // Sous vitest (ajouté par l'auditeur) : un fichier dont un test est écarté par le seuil n'est attesté qu'à ce seuil.
    f.écrire('apps/web/test/x.test.mjs', "import { test } from 'vitest';\ntest('x1 [niveau 1]', () => {});\ntest('x3 [niveau 3]', () => {});\n");
    const v = await f.tester('apps/web', '2');
    assert.equal(v.code, 0, v.sortie);
    assert.deepEqual(
      f.attestation('codage/996-rouge').verts.filter((x) => x.fichier?.startsWith('apps/web/')).map((x) => `${x.fichier}:${x.seuil}`).sort(),
      ['apps/web/test/w.test.mjs:4', 'apps/web/test/x.test.mjs:2'],
      `x, dont un test de niveau 3 est écarté au seuil 2 : attesté au seuil 2\n${v.sortie}`,
    );
    rmSync(join(f.dépôt, 'packages/core/r.test.mjs'));
    rmSync(join(f.dépôt, 'packages/core/s.test.mjs'));
    f.git('update-ref', '-d', 'refs/attestations/codage/996-rouge');
    const nommé = await f.tester('packages/core', '2', '--test-name-pattern=a');
    assert.equal(nommé.code, 0, nommé.sortie);
    assert.ok(nommé.joués.includes('a'), nommé.sortie);
    assert.equal(f.attestation('codage/996-rouge'), null, `un appel nommé n'atteste rien\n${nommé.sortie}`);
    await f.tester('packages/core', '2');
    const nomméEncore = await f.tester('packages/core', '2', '--test-name-pattern=a');
    assert.ok(nomméEncore.joués.includes('a'), `un appel nommé se joue, même attesté vert\n${nomméEncore.sortie}`);
  });

  test('[niveau 1] point 2 · un fichier que lit l’ensemble change pendant le lancement : rien de l’ensemble n’est attesté', async () => {
    const f = dépôtInventé('change');
    f.git('checkout', '-q', '-b', 'codage/995-change');
    f.écrire('packages/core/lib.mjs', 'export const un = 4;\n');
    f.écrire('packages/core/z.test.mjs', "import { appendFileSync } from 'node:fs';\nimport { test } from 'node:test';\ntest('z [niveau 1]', () => appendFileSync(new URL('./lib.mjs', import.meta.url), '// changé\\n'));\n");
    const r = await f.tester('packages/core', '2');
    assert.equal(r.code, 0, r.sortie);
    assert.match(r.sortie, /attestation : cœur : un fichier qu'il lit a changé pendant le lancement, rien n'en est attesté\./, r.sortie);
    assert.equal(f.attestation('codage/995-change'), null);
  });

  test('[niveau 1] point 4 · sur main, sur une sous-branche et sur une tête détachée (le tag), rien ne se saute ni ne s’atteste', async () => {
    const f = dépôtInventé('main');
    for (const branche of ['main', 'codage/994-x--codeur']) {
      if (branche !== 'main') f.git('checkout', '-q', '-b', branche);
      await f.tester('packages/core', '2');
      const r = await f.tester('packages/core', '2');
      assert.deepEqual(r.joués, ['a', 'b'], `${branche} : tout se joue\n${r.sortie}`);
      assert.match(r.sortie, /rien ne se saute ni ne s'atteste/, r.sortie);
      assert.equal(f.attestation(branche), null, branche);
    }
    // Une tête détachée, comme au tag (ajouté par l'auditeur) : l'attestation de la branche de ce commit ne la couvre pas.
    f.git('checkout', '-q', '-b', 'codage/992-tag');
    f.écrire('packages/core/lib.mjs', 'export const un = 5;\n');
    f.git('commit', '-q', '--no-verify', '-am', 'besoin #992');
    await f.tester('packages/core', '2');
    assert.equal(f.attestation('codage/992-tag').verts.length, 2, 'la branche a attesté ses deux fichiers');
    f.git('checkout', '-q', '--detach');
    const tag = await f.tester('packages/core', '3');
    assert.deepEqual(tag.joués, ['a', 'b'], `tête détachée : tout se joue\n${tag.sortie}`);
    assert.match(tag.sortie, /aucune branche extraite : rien ne se saute ni ne s'atteste/, tag.sortie);
  });

  test('[niveau 3] points 3 et 5 · le push qui suit un « pnpm test 2 » vert ne rejoue rien, hors le harnais du besoin qu’il n’a pas joué en entier ; la CI au Ready qui suit des tests navigateur verts ne les rejoue pas', async () => {
    const f = dépôtInventé('push');
    const B = 'codage/993-push';
    f.git('checkout', '-q', '-b', B);
    f.écrire('packages/core/lib.mjs', 'export const un = 3;\n');
    f.écrire('packages/core/h.test.mjs', `// Harnais d'audit de #993 : un besoin inventé.\nimport { appendFileSync } from 'node:fs';\nimport { test } from 'node:test';\ntest('h [niveau 2]', () => appendFileSync(process.env.TEMOIN_302, 'h\\n'));\ntest('h4 [niveau 4]', () => appendFileSync(process.env.TEMOIN_302, 'h4\\n'));\n`);
    f.git('add', '-A');
    f.git('commit', '-q', '--no-verify', '-m', 'besoin #993');
    for (const [p, ...args] of [['packages/core', '2'], ['apps/web', '2', '--navigateur']]) {
      const r = await f.tester(p, ...args);
      assert.equal(r.code, 0, r.sortie);
    }
    f.vider();
    const sha = f.git('rev-parse', 'HEAD');
    const push = await lancer('sh', ['.githooks/livraison.sh', 'push', `refs/heads/${B}`, sha, `refs/heads/${B}`, '0'.repeat(40), 'origin'], { cwd: f.dépôt, env: f.env });
    assert.equal(push.code, 0, push.sortie);
    assert.deepEqual(f.joués(), ['h', 'h4'], `seul le harnais du besoin, joué au seuil 2 sans son test de niveau 4, se rejoue en entier\n${push.sortie}`);
    assert.match(push.sortie, /pré-push : cœur : non rejoué au seuil 2 — chaque fichier est vert sur son empreinte : vert\./, push.sortie);
    f.git('push', '-q', '--no-verify', 'origin', `HEAD:refs/heads/${B}`);

    // La CI au Ready, sur la tête poussée : un clone du distant, ce qui couvre l'arbre, les tests navigateur au seuil 2.
    const ci = join(temporaire(), 'push-ci');
    execFileSync('git', ['clone', '-q', '--branch', B, f.distant, ci], { env: f.env });
    execFileSync('git', ['checkout', '-q', '--detach'], { cwd: ci, env: f.env });
    execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, ci], { env: f.env });
    const couverture = join(temporaire(), 'push-ci.json');
    execFileSync('node', [ATTESTATION_MJS, 'ready', sha, B, 'origin/main', couverture], { cwd: ci, env: f.env, encoding: 'utf8' });
    f.vider();
    const nav = await lancer('pnpm', ['--dir', join(ci, 'apps/web'), 'run', 'test', '2', '--navigateur', '--attestation', couverture, 'test/navigateur'], { cwd: ci, env: f.env });
    assert.equal(nav.code, 0, nav.sortie);
    assert.deepEqual(f.joués(), [], `les tests navigateur joués verts en local, poussés, ne se rejouent pas au Ready\n${nav.sortie}`);
    assert.match(nav.sortie, /attestation : interface dans le navigateur : sauté\(s\) — fichier attesté vert par le lancement « test 2 --navigateur » dans apps\/web/, nav.sortie);
    assert.ok(existsSync(couverture));
  });
});
