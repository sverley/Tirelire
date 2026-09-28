/**
 * Au commit, le harnais du besoin qui vit dans le navigateur ne se joue pas et ne bloque pas (#272).
 * Tests du codeur de #272, point 4 : ses points 1 à 3, rejoués sur `.githooks/pre-commit` dans une
 * copie du dépôt.
 *
 * D83 : au pré-commit, « 0 sur les paquets touchés, plus le harnais du besoin en entier ; sans tests
 * navigateur », et « le pré-commit ne fait qu'en afficher le verdict, sans bloquer, sauf une erreur de
 * syntaxe ». Le harnais du besoin qui vit dans le navigateur se joue à la livraison (#264, point 7).
 *
 * Niveau 2 (D83) : si ces cas tombaient, le crochet refuserait à tort un commit ou jouerait ce que
 * D83 exclut ; l'usage resterait possible. Les trois points couvrent le même besoin : même niveau.
 *
 * Chaque scénario est une branche d'audit inventée (`audit/<n>-…`) qui ajoute un harnais du besoin
 * — des fichiers de test qui portent « Harnais d'audit de #<n> » — et touche `docs/gardes.md`, ce qui
 * fait jouer la non-régression de la garde au commit. Chaque test de ces fichiers inventés note son
 * passage dans un témoin : ce qui s'y lit a été joué.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { RACINE } from './gardes.mjs';

/** L'environnement d'un lancement : sans contexte de test ni de git hérité. */
function environnement(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'NODE_TEST_CONTEXT' || k.startsWith('VITEST') || k.startsWith('GIT_') || k === 'TIRELIRE_SEUIL') delete env[k];
  return { ...env, ...extra };
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

/** Un fichier de test vitest inventé : chaque test note `<nom>:<id>` dans le témoin ; `rouge` en ajoute un qui échoue. */
function sourceVitest(nom, { entête, rouge = false } = {}) {
  return [
    ...(entête ? [`// ${entête}`] : []),
    "import { appendFileSync } from 'node:fs';",
    "import { expect, test } from 'vitest';",
    `const note = (id) => { if (process.env.TEMOIN_272) appendFileSync(process.env.TEMOIN_272, '${nom}:' + id + '\\n'); };`,
    "test('vert [niveau 4]', () => { note('vert'); });",
    ...(rouge ? ["test('rouge [niveau 4]', () => { note('rouge'); expect(1).toBe(2); });"] : []),
    '',
  ].join('\n');
}

/** Un test `node:test` de niveau 0, vert : la non-régression de la garde dans la copie. */
const ANCIEN = [
  "import { appendFileSync } from 'node:fs';",
  "import { test } from 'node:test';",
  "test('ancien [niveau 0]', () => { if (process.env.TEMOIN_272) appendFileSync(process.env.TEMOIN_272, 'ancien:vert\\n'); });",
  '',
].join('\n');

const NAVIGATEUR = 'apps/web/test/navigateur/besoin-272.test.ts';
const SANS_NAVIGATEUR = 'apps/web/test/besoin-272.test.ts';

let dossierTemporaire;
const temporaire = () => (dossierTemporaire ??= mkdtempSync(join(tmpdir(), 'commit-272-')));

/**
 * La copie du dépôt, sans ses tests, commise sur `main`, qui sert aussi d'`origin/main` ; puis un
 * scénario par branche, joués l'un après l'autre (ils partagent la copie).
 */
const scénarios = (() => {
  let p;
  return () => (p ??= préparer());
})();

async function préparer() {
  const dépôt = join(temporaire(), 'depot');
  const git = (...a) => execFileSync('git', a, { cwd: dépôt, env: environnement(), encoding: 'utf8' }).trim();
  const suivis = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: RACINE, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of suivis) {
    if (/\.test\.[^/]+$|(^|\/)test\//.test(f) || f.startsWith('apps/web/android/') || !existsSync(join(RACINE, f))) continue;
    mkdirSync(dirname(join(dépôt, f)), { recursive: true });
    cpSync(join(RACINE, f), join(dépôt, f));
  }
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Tests 272');
  git('config', 'user.email', 'tests@exemple.invalid');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dépôt, 'packages/gardes/ancien.test.mjs'), ANCIEN);
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, dépôt], { env: environnement() });

  /** Une branche d'audit : ses fichiers écrits et indexés avec une ligne de `docs/gardes.md`, puis le pré-commit. */
  async function scénario(numéro, fichiers) {
    git('checkout', '-q', '-f', 'main');
    git('clean', '-qfd', '--', 'apps/web/test', 'packages/gardes');
    git('checkout', '-q', '-b', `audit/${numéro}-besoin-invente`);
    for (const [f, texte] of Object.entries(fichiers)) {
      mkdirSync(dirname(join(dépôt, f)), { recursive: true });
      writeFileSync(join(dépôt, f), texte);
    }
    writeFileSync(join(dépôt, 'docs/gardes.md'), `${readFileSync(join(dépôt, 'docs/gardes.md'), 'utf8')}\nUne ligne du registre, inventée.\n`);
    git('add', 'docs/gardes.md', ...Object.keys(fichiers));
    const témoin = join(temporaire(), `temoin-${numéro}`);
    writeFileSync(témoin, '');
    const r = await lancer('sh', ['.githooks/pre-commit'], { cwd: dépôt, env: environnement({ TEMOIN_272: témoin }) });
    return { ...r, joués: readFileSync(témoin, 'utf8').split('\n').filter(Boolean).sort() };
  }

  const entête = (n) => `Harnais d'audit de #${n} : un besoin inventé.`;
  // Le cas de #42 : un harnais du besoin tout entier dans le navigateur.
  const navigateurSeul = await scénario(997, { [NAVIGATEUR]: sourceVitest('navigateur', { entête: entête(997), rouge: true }) });
  // Un harnais du besoin des deux côtés, rouge hors du navigateur : joué, affiché, sans bloquer.
  const mixteRouge = await scénario(996, {
    [NAVIGATEUR]: sourceVitest('navigateur', { entête: entête(996) }),
    [SANS_NAVIGATEUR]: sourceVitest('sans-navigateur', { entête: entête(996), rouge: true }),
  });
  // Le même, avec une erreur de syntaxe hors du navigateur : elle refuse le commit, comme avant #272.
  const mixteSyntaxe = await scénario(995, {
    [NAVIGATEUR]: sourceVitest('navigateur', { entête: entête(995) }),
    [SANS_NAVIGATEUR]: `${sourceVitest('sans-navigateur', { entête: entête(995) })}test('cassé [niveau 4]', () => { const = ; });\n`,
  });
  return { navigateurSeul, mixteRouge, mixteSyntaxe };
}

const détail = (r) => `\n--- sortie du pré-commit ---\n${r.sortie.slice(-2500)}`;
/** La ligne qui nomme le harnais du besoin non joué dans le navigateur, et dit qu'il se joue à la livraison. */
const ligneNavigateur = (r) => r.sortie.split('\n').find((l) => l.includes(NAVIGATEUR) && /livraison/i.test(l));

describe('[niveau 2] #272 · au commit, le harnais du besoin qui vit dans le navigateur ne se joue pas et ne bloque pas', () => {
  after(() => {
    if (dossierTemporaire) rmSync(dossierTemporaire, { recursive: true, force: true });
  });

  test('point 1 · ses fichiers de apps/web/test/navigateur/ ne se jouent pas ; le pré-commit les nomme, et dit qu’ils se jouent à la livraison', async () => {
    const { navigateurSeul, mixteRouge } = await scénarios();
    for (const [nom, r] of Object.entries({ navigateurSeul, mixteRouge })) {
      assert.deepEqual(r.joués.filter((j) => j.startsWith('navigateur:')), [], `${nom} : un fichier du harnais dans apps/web/test/navigateur/ s'est joué au commit${détail(r)}`);
      assert.ok(ligneNavigateur(r), `${nom} : aucune ligne ne nomme ${NAVIGATEUR} en disant qu'il se joue à la livraison${détail(r)}`);
    }
  });

  test('point 2 · un harnais sans fichier restant ne se lance pas ; ce qui reste hors du navigateur se joue, rouge affiché sans bloquer', async () => {
    const { navigateurSeul, mixteRouge } = await scénarios();
    assert.doesNotMatch(navigateurSeul.sortie, /harnais-interface|No test files found/, `harnais tout entier dans le navigateur : le harnais de l'interface a été lancé sans fichier à jouer${détail(navigateurSeul)}`);
    assert.deepEqual(
      mixteRouge.joués.filter((j) => j.startsWith('sans-navigateur:')),
      ['sans-navigateur:rouge', 'sans-navigateur:vert'],
      `harnais des deux côtés : ce qui reste hors du navigateur doit se jouer en entier${détail(mixteRouge)}`,
    );
    assert.equal(mixteRouge.code, 0, `harnais rouge hors du navigateur : le commit est refusé, alors que le harnais s'affiche sans bloquer${détail(mixteRouge)}`);
    assert.match(mixteRouge.sortie, /harnais du besoin \(harnais-interface\), rouge — apps\/web\/test\/besoin-272\.test\.ts/, `harnais rouge hors du navigateur : son échec doit s'afficher${détail(mixteRouge)}`);
  });

  test('point 2 · une erreur de syntaxe du harnais hors du navigateur refuse le commit', async () => {
    const { mixteSyntaxe: r } = await scénarios();
    assert.notEqual(r.code, 0, `erreur de syntaxe dans le harnais : le commit passe${détail(r)}`);
    assert.match(r.sortie, /erreur de syntaxe — apps\/web\/test\/besoin-272\.test\.ts/, `erreur de syntaxe dans le harnais : le refus doit la nommer${détail(r)}`);
  });

  test('point 3 · un commit de docs/gardes.md, harnais tout entier dans le navigateur, passe quand la non-régression est verte', async () => {
    const { navigateurSeul: r } = await scénarios();
    assert.ok(r.joués.includes('ancien:vert'), `la non-régression de la garde ne s'est pas jouée : le scénario ne vérifie rien${détail(r)}`);
    assert.equal(r.code, 0, `le commit est refusé${détail(r)}`);
  });
});
