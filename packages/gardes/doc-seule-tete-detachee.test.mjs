/**
 * Harnais d'audit de #314 : « Une documentation seule ne rejoue que la garde, même sur une tête
 * détachée ». Composé par l'auditeur parmi les tests du codeur, tous retenus, scindés par besoin.
 *
 * Ce que tranche chaque test, phrase du « Fait quand » par phrase :
 * - point 1 : sur une tête détachée, un lancement sans `--attestation` n'atteste rien et ne lit
 *   l'attestation d'aucune branche [1] ; il saute ce que couvre la base commune avec `main` [3]. Sur
 *   `main` et sur une sous-branche : le test adapté de #302 (`attestation-par-fichier.test.mjs`).
 * - point 2 : une documentation seule rejoue la garde et l'hébergement, à la main sur une tête
 *   détachée, à la livraison et au Ready [1] ; le reste se saute, sur la branche comme sur une tête
 *   détachée, et le lancement ou la livraison le dit [3].
 * - point 3 : sur une tête détachée, au seuil 3 du tag, la base commune ne couvre rien [1].
 * - point 6 : l'interface sans navigateur ne lit plus rien de `docs/`, `docs/decisions.md` compris
 *   [3] ; la garde, elle, se rejoue quand les décisions changent [1] (la vérification déplacée est
 *   `colonnes-derivees.test.mjs`, niveau 2).
 * Les points 4 et 5 (le rôle de l'auditeur, D83) se vérifient en relisant (D81).
 *
 * Niveaux (D83) : ne pas jouer ce que le « Fait quand » rejoue laisserait des niveaux 0 à 2 sans
 * passage avant la fusion — principe 10.1 — : niveau 1 ; rejouer ce qui pouvait se sauter garde le
 * résultat juste, obtenu plus lentement : niveau 3.
 *
 * Le lanceur et la livraison se jouent dans un petit dépôt inventé : une garde, un cœur et un
 * hébergement en `node --test`, chaque test notant son passage dans `TEMOIN_314`. Chaque scénario se
 * joue une fois ; ses tests en lisent le résultat.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { couvertureAuReady, empreintes, lireLesEntrees } from './attestation.mjs';
import { RACINE } from './gardes.mjs';

// ─── Au Ready, sans git ─────────────────────────────────────────────────────────────────────────

describe('#314 · au Ready, une documentation seule', () => {
  const avant = lireLesEntrees(execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], { cwd: RACINE, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
  const main = { commit: 'm'.repeat(40), empreintes: empreintes(avant) };
  const docs = avant.map((x) => x.chemin).filter((c) => c.startsWith('docs/'));
  /** Ce que `main` couvre au Ready quand seuls ces chemins changent. */
  const couverts = (chemins) => {
    const apres = avant.map((x) => (chemins.includes(x.chemin) ? { ...x, objet: '0'.repeat(40) } : x));
    const c = couvertureAuReady({ arbre: 'a', empreintes: empreintes(apres), main });
    return Object.keys(c.ensembles).sort();
  };

  test('[niveau 1] points 2 et 6 · tout document de docs/, docs/decisions.md compris : main ne couvre ni la garde ni l’hébergement', () => {
    assert.ok(docs.includes('docs/decisions.md') && docs.includes('docs/roles/auditeur.md'), 'les documents existent');
    for (const chemins of [docs, ['docs/decisions.md']]) {
      const c = couverts(chemins);
      assert.ok(!c.includes('garde') && !c.includes('hebergement'), `${chemins.length} document(s) : ${c.join(', ')}`);
    }
  });

  test('[niveau 3] points 2 et 6 · tout document de docs/, docs/decisions.md compris : main couvre le cœur, le relais et l’interface sans navigateur', () => {
    for (const chemins of [docs, ['docs/decisions.md'], ['docs/roles/auditeur.md']]) assert.deepEqual(couverts(chemins), ['coeur', 'interface', 'relais'], chemins.join(', '));
  });
});

// ─── Le lanceur et la livraison, dans un dépôt inventé ──────────────────────────────────────────

let dossierTemporaire;
const temporaire = () => (dossierTemporaire ??= mkdtempSync(join(tmpdir(), 'doc-seule-314-')));
after(() => {
  if (dossierTemporaire) rmSync(dossierTemporaire, { recursive: true, force: true });
});

function environnement(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'NODE_TEST_CONTEXT' || k.startsWith('VITEST') || k.startsWith('GIT_') || k.startsWith('TIRELIRE_')) delete env[k];
  return { ...env, GIT_AUTHOR_NAME: 'Tests 314', GIT_AUTHOR_EMAIL: 'tests@exemple.invalid', GIT_COMMITTER_NAME: 'Tests 314', GIT_COMMITTER_EMAIL: 'tests@exemple.invalid', ...extra };
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

/** Un petit dépôt, `main` poussé sur un distant, puis une branche qui ne change qu'un document de `docs/`. */
function dépôtInventé(nom, branche) {
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
  const note = (quoi) => `import { appendFileSync } from 'node:fs';\nimport { test } from 'node:test';\ntest('${quoi} [niveau 0]', () => appendFileSync(process.env.TEMOIN_314, '${quoi}\\n'));\n`;
  const paquet = (dossier, nomPaquet, lanceur) =>
    écrire(`${dossier}/package.json`, JSON.stringify({ name: nomPaquet, private: true, type: 'module', scripts: { test: `node ${lanceur} node --test`, typecheck: 'node -e 0' } }));
  paquet('packages/gardes', 'f-gardes', './lanceur.mjs');
  écrire('packages/gardes/g.test.mjs', note('garde'));
  paquet('packages/core', 'f-core', '../gardes/lanceur.mjs');
  écrire('packages/core/a.test.mjs', note('coeur'));
  paquet('apps/hebergement', 'f-hebergement', '../../packages/gardes/lanceur.mjs');
  écrire('apps/hebergement/h.test.mjs', note('hebergement'));
  écrire('docs/a.md', 'Un document.\n');
  écrire('.gitignore', 'node_modules\n');
  const env = environnement({ TEMOIN_314: témoin });
  const git = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: dépôt, env, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', distant], { env });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('remote', 'add', 'origin', distant);
  git('push', '-q', 'origin', 'main');
  git('fetch', '-q', 'origin');
  execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, dépôt], { env });
  git('checkout', '-q', '-b', branche);
  écrire('docs/a.md', 'Un document, corrigé.\n');
  git('commit', '-q', '--no-verify', '-am', 'documentation seule');
  const joués = () => readFileSync(témoin, 'utf8').split('\n').filter(Boolean).sort();
  const vider = () => writeFileSync(témoin, '');
  const tester = async (dossier, seuil = '2') => {
    vider();
    const r = await lancer('pnpm', ['--dir', join(dépôt, dossier), 'run', 'test', seuil], { cwd: dépôt, env });
    return { ...r, joués: joués() };
  };
  /** Les attestations du dépôt, avec leur commit : une écriture change la liste. */
  const attestations = () => git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/attestations/');
  return { dépôt, env, git, tester, joués, vider, attestations };
}

/** Un scénario joué une fois, que plusieurs tests lisent. */
const unefois = (f) => {
  let p;
  return () => (p ??= f());
};

// Une documentation seule : la branche atteste la garde, puis la tête détachée de ce commit se lance.
const détachée = unefois(async () => {
  const f = dépôtInventé('detachee', 'codage/990-doc');
  const branche = { coeur: await f.tester('packages/core'), garde: await f.tester('packages/gardes') };
  const garde2 = await f.tester('packages/gardes');
  const avant = f.attestations();
  f.git('checkout', '-q', '--detach');
  const d = {
    coeur: await f.tester('packages/core'),
    garde: await f.tester('packages/gardes'),
    hebergement: await f.tester('apps/hebergement'),
    coeur3: await f.tester('packages/core', '3'),
  };
  return { branche, garde2, avant, d, après: f.attestations() };
});

// La livraison (pré-push) d'une documentation seule.
const livraison = unefois(async () => {
  const B = 'codage/988-doc';
  const f = dépôtInventé('livraison', B);
  f.vider();
  const sha = f.git('rev-parse', 'HEAD');
  const push = await lancer('sh', ['.githooks/livraison.sh', 'push', `refs/heads/${B}`, sha, `refs/heads/${B}`, '0'.repeat(40), 'origin'], { cwd: f.dépôt, env: f.env });
  return { ...push, joués: f.joués() };
});

describe('#314 · une documentation seule, dans un dépôt inventé', { concurrency: true }, () => {
  test('[niveau 1] point 1 · sur une tête détachée, l’attestation de la branche n’est pas lue, et rien ne s’atteste', async () => {
    const s = await détachée();
    assert.notEqual(s.avant, '', 'la branche a attesté la garde');
    assert.deepEqual(s.garde2.joués, [], `sur la branche, la garde attestée se saute\n${s.garde2.sortie}`);
    assert.deepEqual(s.d.garde.joués, ['garde'], `tête détachée : l’attestation de la branche n’est pas lue\n${s.d.garde.sortie}`);
    assert.equal(s.après, s.avant, 'rien ne s’atteste sur une tête détachée');
  });

  test('[niveau 1] point 2 · sur une tête détachée, la garde et l’hébergement se jouent', async () => {
    const { d } = await détachée();
    for (const quoi of ['garde', 'hebergement']) {
      assert.equal(d[quoi].code, 0, d[quoi].sortie);
      assert.deepEqual(d[quoi].joués, [quoi], d[quoi].sortie);
    }
  });

  test('[niveau 3] points 1 et 2 · à la main, sur la branche comme sur une tête détachée, le cœur se saute sur la base commune avec main, et le lancement le dit', async () => {
    const s = await détachée();
    for (const [où, r] of [['branche', s.branche.coeur], ['tête détachée', s.d.coeur]]) {
      assert.equal(r.code, 0, r.sortie);
      assert.deepEqual(r.joués, [], `${où}\n${r.sortie}`);
      assert.match(r.sortie, /cœur, seuil 2 : vert — 0 joué\(s\), 1 sauté\(s\) \(1 couvert\(s\) par la base commune avec main\)\./, `${où}\n${r.sortie}`);
    }
    assert.match(s.d.coeur.sortie, /aucune branche extraite : seul se saute ce que couvre la base commune avec main/, s.d.coeur.sortie);
  });

  test('[niveau 1] point 3 · sur une tête détachée, au seuil 3 du tag, la base commune ne couvre rien', async () => {
    const { d } = await détachée();
    assert.equal(d.coeur3.code, 0, d.coeur3.sortie);
    assert.deepEqual(d.coeur3.joués, ['coeur'], d.coeur3.sortie);
  });

  test('[niveau 1] point 2 · la livraison (pré-push) d’une documentation seule joue la garde et l’hébergement, et eux seuls', async () => {
    const push = await livraison();
    assert.equal(push.code, 0, push.sortie);
    assert.deepEqual(push.joués, ['garde', 'hebergement'], push.sortie);
  });

  test('[niveau 3] point 2 · la livraison d’une documentation seule dit ce qu’elle retient, et pourquoi elle ne joue pas le cœur', async () => {
    const push = await livraison();
    assert.match(push.sortie, /la livraison retient garde hebergement/, push.sortie);
    assert.match(push.sortie, /cœur : non joué — rien de ce qu'il lit n'a changé depuis main/, push.sortie);
  });
});
