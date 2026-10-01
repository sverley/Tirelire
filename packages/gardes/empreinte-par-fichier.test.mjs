/**
 * Harnais d'audit de #304, composé parmi les tests du codeur (D83) : chaque test porte sa marque.
 * Un fichier de test ne se rejoue que si ce qu'il lit a changé.
 *
 * **Qu'aucun rouge ne fusionne** (niveau 1) — principe 10.1 et D83 (« aucun job sauté ne peut laisser
 * fusionner ce qu'un job joué aurait rougi ») : l'empreinte d'un fichier de test change avec tout ce
 * que lit son ensemble hors des autres fichiers de test, et avec lui-même ; dans la garde et
 * l'hébergement, elle reste celle de l'ensemble ; un fichier attesté ne vaut que sur sa propre
 * empreinte (point 1) ; aucun fichier de test d'un autre ensemble n'en importe un autre (point 3).
 *
 * **Le dégradé** (niveau 3) : si ces tests tombent, le résultat reste juste, obtenu plus lentement —
 * modifier un fichier de test ne fait rejouer que lui, et aucun test navigateur (point 2).
 *
 * - L'empreinte d'un fichier de test (`empreintesDesFichiers`) : ce que lit son ensemble, sans les
 *   autres fichiers de test, plus lui-même ; dans la garde et l'hébergement, celle de l'ensemble.
 * - Aucun fichier de test d'un autre ensemble que la garde et l'hébergement n'en importe un autre :
 *   c'est ce qui permet à son empreinte d'écarter les autres fichiers de test.
 * - Dans un petit dépôt inventé : après un lot attesté vert, modifier un fichier de test ne fait
 *   rejouer que lui, et un fichier de test sans navigateur ne fait rejouer aucun test navigateur.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { after, describe, test } from 'node:test';
import { LISENT_LES_TESTS, couvertureLocale, ensembleDuFichier, empreintes, empreintesDesFichiers, estUnFichierDeTest, fichiersCouverts } from './attestation.mjs';
import { RACINE } from './gardes.mjs';

// ─── L'empreinte d'un fichier de test ───────────────────────────────────────────────────────────

const CHEMINS = [
  'package.json',
  'packages/gardes/lanceur.mjs',
  'packages/gardes/g1.test.mjs',
  'packages/gardes/g2.test.mjs',
  'packages/core/src/plan.ts',
  'packages/core/test/a.test.ts',
  'packages/core/test/b.test.ts',
  'apps/hebergement/h1.test.mjs',
  'apps/hebergement/h2.test.mjs',
  'apps/web/src/App.svelte',
  'apps/web/test/harnais.ts',
  'apps/web/test/w1.test.ts',
  'apps/web/test/w2.test.ts',
  'apps/web/test/navigateur/n1.test.ts',
  'apps/web/test/navigateur/n2.test.ts',
];
const entrees = (versions = {}) => CHEMINS.map((chemin) => ({ mode: '100644', objet: `${chemin}#${versions[chemin] ?? 0}`, chemin }));
const TESTS = CHEMINS.filter(estUnFichierDeTest);
/** Les fichiers de test dont l'empreinte change quand ce chemin change. */
const changés = (chemin) => {
  const avant = empreintesDesFichiers(TESTS, entrees());
  const après = empreintesDesFichiers(TESTS, entrees({ [chemin]: 1 }));
  return TESTS.filter((f) => avant[f] !== après[f]);
};
/** Les mêmes, hors de la garde et de l'hébergement, qui lisent tout. */
const changésAilleurs = (chemin) => changés(chemin).filter((f) => !LISENT_LES_TESTS.includes(ensembleDuFichier(f)));

describe('[niveau 4] #304 · l’empreinte d’un fichier de test : ce qu’il lit', () => {
  test('[niveau 1] point 1 · modifier un fichier de test du cœur ou de l’interface ne change que sa propre empreinte', () => {
    for (const f of ['packages/core/test/a.test.ts', 'apps/web/test/w1.test.ts', 'apps/web/test/navigateur/n2.test.ts']) assert.deepEqual(changésAilleurs(f), [f], f);
  });

  test('[niveau 1] point 1 · modifier ce que lit l’ensemble, hors fichiers de test, change l’empreinte de tous ses fichiers', () => {
    for (const f of ['packages/core/test/a.test.ts', 'packages/core/test/b.test.ts', 'apps/web/test/w1.test.ts', 'apps/web/test/navigateur/n1.test.ts']) {
      assert.ok(changés('packages/core/src/plan.ts').includes(f), `${f} lit le cœur`);
    }
    assert.ok(changés('apps/web/test/harnais.ts').includes('apps/web/test/navigateur/n1.test.ts'), 'un module d’aide des tests n’est pas un fichier de test : il se lit');
    assert.ok(changés('apps/web/src/App.svelte').includes('apps/web/test/w2.test.ts'));
    assert.ok(!changés('apps/web/src/App.svelte').includes('packages/core/test/a.test.ts'), 'le cœur ne lit pas l’interface');
  });

  test('[niveau 1] point 1 · dans la garde et l’hébergement, dont les tests lisent les autres, l’empreinte reste celle de l’ensemble', () => {
    assert.deepEqual([...LISENT_LES_TESTS].sort(), ['garde', 'hebergement']);
    const e = empreintes(entrees());
    const f = empreintesDesFichiers(TESTS, entrees());
    for (const t of TESTS.filter((x) => LISENT_LES_TESTS.includes(ensembleDuFichier(x)))) assert.equal(f[t], e[ensembleDuFichier(t)], t);
    assert.ok(changés('packages/gardes/g1.test.mjs').includes('packages/gardes/g2.test.mjs'), 'dans la garde, un fichier de test change l’empreinte de ses voisins');
    assert.ok(changés('apps/web/test/w1.test.ts').includes('apps/hebergement/h1.test.mjs'), 'l’hébergement lit aussi les fichiers de test des autres ensembles');
    assert.deepEqual(changésAilleurs('packages/gardes/g1.test.mjs'), [], 'un fichier de test de la garde ne change l’empreinte d’aucun fichier d’un autre ensemble');
  });

  test('[niveau 1] point 1 · ce qui couvre tout un ensemble couvre toujours chacun de ses fichiers ; un fichier attesté ne vaut que sur sa propre empreinte', () => {
    const avant = entrees();
    const après = entrees({ 'apps/web/test/w1.test.ts': 1 });
    const e = empreintes(avant);
    const fAvant = empreintesDesFichiers(TESTS, avant);
    const fAprès = empreintesDesFichiers(TESTS, après);
    const N1 = 'apps/web/test/navigateur/n1.test.ts';
    const vert = { ensemble: 'navigateur', fichier: N1, empreinte: fAvant[N1], seuil: 2, par: 'un lancement', arbre: 'a'.repeat(40), date: '2026-10-01T00:00:00Z' };
    const demande = { dossier: 'apps/web', seuil: 2, navigateur: true, cibles: ['test/navigateur'], nomme: false };
    const c = couvertureLocale({ arbre: 'b', empreintes: empreintes(après), fichiers: fAprès, verts: [vert] });
    assert.equal(fichiersCouverts(c, demande, [N1], empreintes(après), fAprès)[0].couvert, true, 'w1 modifié : n1 reste couvert');
    const ensemble = couvertureLocale({ arbre: 'a', empreintes: e, fichiers: fAvant, main: { commit: 'm'.repeat(40), empreintes: e } });
    assert.equal(fichiersCouverts(ensemble, demande, [N1], e, fAvant)[0].couvert, true, 'la base commune avec main couvre n1');
    const changé = entrees({ [N1]: 1 });
    const cN = couvertureLocale({ arbre: 'c', empreintes: empreintes(changé), fichiers: empreintesDesFichiers(TESTS, changé), verts: [vert] });
    assert.equal(fichiersCouverts(cN, demande, [N1], empreintes(changé), empreintesDesFichiers(TESTS, changé))[0].couvert, false, 'n1 modifié : il se rejoue');
  });
});

// ─── Aucun fichier de test n'en importe un autre ────────────────────────────────────────────────

/** Les modules qu'importe une source : `import … from`, `import(…)`, `require(…)`, `export … from`. */
function modulesImportés(source) {
  const r = [];
  for (const m of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"`])([^'"`]+)\1/gm)) r.push(m[2]);
  return r;
}

/** Les fichiers de test qu'un fichier de test importe, parmi `chemins` (depuis la racine). */
function testsImportés(fichier, source, chemins) {
  const tous = new Set(chemins);
  const trouvés = [];
  for (const m of modulesImportés(source)) {
    if (!m.startsWith('.')) continue;
    const base = posix.normalize(posix.join(posix.dirname(fichier), m));
    const candidats = [base, ...['.ts', '.mjs', '.js', '.cjs', '.mts', '.tsx'].map((x) => base + x)];
    const cible = candidats.find((c) => tous.has(c)) ?? (estUnFichierDeTest(base) || /\.test$/.test(base) ? base : null);
    if (cible && (estUnFichierDeTest(cible) || /\.test$/.test(cible))) trouvés.push(cible);
  }
  return trouvés;
}

/** Pour chaque fichier de test hors de la garde et de l'hébergement, les fichiers de test qu'il importe. */
function importsEntreTests(lire, chemins) {
  const fautes = [];
  for (const f of chemins.filter(estUnFichierDeTest)) {
    const id = ensembleDuFichier(f);
    if (!id || LISENT_LES_TESTS.includes(id)) continue;
    for (const t of testsImportés(f, lire(f), chemins)) fautes.push(`${f} importe ${t}`);
  }
  return fautes;
}

describe('[niveau 4] #304, point 3 · aucun fichier de test d’un autre ensemble que la garde et l’hébergement n’en importe un autre', () => {
  test('[niveau 1] le dépôt : aucun import d’un fichier de test par un autre', () => {
    const suivis = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: RACINE, encoding: 'utf8' }).split('\0').filter(Boolean);
    const fautes = importsEntreTests((f) => readFileSync(join(RACINE, f), 'utf8'), suivis);
    assert.deepEqual(fautes, [], 'un fichier de test qui en importe un autre le lit : son empreinte ne l’écarte plus (#304, point 1)');
  });

  test('[niveau 1] témoin rouge · un import, statique, dynamique ou par require, d’un autre fichier de test se voit ; un module d’aide non', () => {
    const chemins = ['apps/web/test/a.test.ts', 'apps/web/test/b.test.ts', 'apps/web/test/harnais.ts', 'packages/core/test/c.test.ts', 'packages/gardes/g.test.mjs', 'packages/gardes/h.test.mjs'];
    const sources = {
      'apps/web/test/a.test.ts': "import { x } from './b.test';\nimport { ouvrirLeSite } from './harnais';\n",
      'apps/web/test/b.test.ts': "const y = await import('../../../packages/core/test/c.test.ts');\n",
      'apps/web/test/harnais.ts': '',
      'packages/core/test/c.test.ts': "const z = require('./autre.test.js');\nexport { w } from './harnais';\n",
      'packages/gardes/g.test.mjs': "import './h.test.mjs';\n",
      'packages/gardes/h.test.mjs': '',
    };
    const fautes = importsEntreTests((f) => sources[f], chemins);
    assert.deepEqual(fautes.sort(), [
      'apps/web/test/a.test.ts importe apps/web/test/b.test.ts',
      'apps/web/test/b.test.ts importe packages/core/test/c.test.ts',
      'packages/core/test/c.test.ts importe packages/core/test/autre.test.js',
    ]);
  });
});

// ─── Dans un dépôt inventé ──────────────────────────────────────────────────────────────────────

let dossierTemporaire;
const temporaire = () => (dossierTemporaire ??= mkdtempSync(join(tmpdir(), 'empreinte-304-')));
after(() => {
  if (dossierTemporaire) rmSync(dossierTemporaire, { recursive: true, force: true });
});

function environnement(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'NODE_TEST_CONTEXT' || k.startsWith('VITEST') || k.startsWith('GIT_') || k.startsWith('TIRELIRE_')) delete env[k];
  return { ...env, GIT_AUTHOR_NAME: 'Tests 304', GIT_AUTHOR_EMAIL: 'tests@exemple.invalid', GIT_COMMITTER_NAME: 'Tests 304', GIT_COMMITTER_EMAIL: 'tests@exemple.invalid', ...extra };
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

/** Un petit dépôt : un cœur en `node --test`, une interface en vitest, deux fichiers sans navigateur et deux dans le navigateur. */
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
  const source = (exécuteur, quoi, titre = quoi) =>
    `import { appendFileSync } from 'node:fs';\nimport { test } from '${exécuteur}';\ntest('${titre} [niveau 1]', () => appendFileSync(process.env.TEMOIN_304, '${quoi}\\n'));\n`;
  écrire('typecheck.mjs', '');
  écrire('packages/gardes/package.json', JSON.stringify({ name: 'f-gardes', private: true, type: 'module', scripts: { test: 'node ./lanceur.mjs node --test', typecheck: 'node ../../typecheck.mjs' } }));
  écrire('packages/core/package.json', JSON.stringify({ name: 'f-core', private: true, type: 'module', scripts: { test: 'node ../gardes/lanceur.mjs node --test', typecheck: 'node ../../typecheck.mjs' } }));
  écrire('packages/core/lib.mjs', 'export const un = 1;\n');
  écrire('packages/core/a.test.mjs', source('node:test', 'a'));
  écrire('packages/core/b.test.mjs', source('node:test', 'b'));
  écrire('apps/web/package.json', JSON.stringify({ name: 'f-web', private: true, type: 'module', scripts: { test: 'node ../../packages/gardes/lanceur.mjs vitest run', typecheck: 'node ../../typecheck.mjs' } }));
  écrire('apps/web/test/w1.test.mjs', source('vitest', 'w1'));
  écrire('apps/web/test/w2.test.mjs', source('vitest', 'w2'));
  écrire('apps/web/test/navigateur/n1.test.mjs', source('vitest', 'n1'));
  écrire('apps/web/test/navigateur/n2.test.mjs', source('vitest', 'n2'));
  écrire('.gitignore', 'node_modules\n');
  const env = environnement({ TEMOIN_304: témoin });
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
  const tester = async (paquet, ...args) => {
    vider();
    const r = await lancer('pnpm', ['--dir', join(dépôt, paquet), 'run', 'test', ...args], { cwd: dépôt, env });
    return { ...r, joués: joués() };
  };
  const commettre = (message) => {
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', message);
  };
  return { dépôt, env, git, écrire, source, tester, joués, vider, commettre };
}

describe('[niveau 4] #304, point 2 · un fichier de test ne se rejoue que si ce qu’il lit a changé', { concurrency: true }, () => {
  test('[niveau 3] interface : après un lot attesté vert, un fichier de test sans navigateur modifié ne fait rejouer que lui, et aucun test navigateur — à la main comme à la demande', async () => {
    const f = dépôtInventé('interface');
    f.git('checkout', '-q', '-b', 'codage/992-interface');
    f.écrire('apps/web/lib.mjs', 'export const deux = 2;\n');
    f.commettre('l’interface change');
    const lot = await f.tester('apps/web', '2', '--navigateur');
    assert.equal(lot.code, 0, lot.sortie);
    assert.deepEqual(lot.joués, ['n1', 'n2', 'w1', 'w2'], lot.sortie);

    f.écrire('apps/web/test/w2.test.mjs', f.source('vitest', 'w2', 'w2 retouché'));
    f.commettre('w2 retouché');
    const main = await f.tester('apps/web', '2', '--navigateur');
    assert.equal(main.code, 0, main.sortie);
    assert.deepEqual(main.joués, ['w2'], `seul le fichier modifié se rejoue\n${main.sortie}`);

    f.écrire('apps/web/test/w1.test.mjs', f.source('vitest', 'w1', 'w1 retouché'));
    f.commettre('w1 retouché');
    f.vider();
    const demande = await lancer('sh', ['.githooks/livraison.sh', 'demande', '--navigateur'], { cwd: f.dépôt, env: f.env });
    assert.equal(demande.code, 0, demande.sortie);
    assert.deepEqual(f.joués(), ['w1'], `à la demande, aucun test navigateur ne se rejoue, et seul w1 parmi les autres\n${demande.sortie}`);

    f.écrire('apps/web/test/navigateur/n2.test.mjs', f.source('vitest', 'n2', 'n2 retouché'));
    f.commettre('n2 retouché');
    const nav = await f.tester('apps/web', '2', '--navigateur');
    assert.deepEqual(nav.joués, ['n2'], `un fichier de test navigateur modifié ne fait rejouer que lui\n${nav.sortie}`);
  });

  test('[niveau 3] cœur : modifier un fichier de test ne fait rejouer que lui ; modifier le code les fait tous rejouer', async () => {
    const f = dépôtInventé('coeur');
    f.git('checkout', '-q', '-b', 'codage/991-coeur');
    f.écrire('packages/core/lib.mjs', 'export const un = 2;\n');
    const lot = await f.tester('packages/core', '2');
    assert.deepEqual(lot.joués, ['a', 'b'], lot.sortie);
    f.écrire('packages/core/b.test.mjs', f.source('node:test', 'b', 'b retouché'));
    const b = await f.tester('packages/core', '2');
    assert.deepEqual(b.joués, ['b'], b.sortie);
    f.écrire('packages/core/lib.mjs', 'export const un = 3;\n');
    const tous = await f.tester('packages/core', '2');
    assert.deepEqual(tous.joués, ['a', 'b'], tous.sortie);
  });
});
