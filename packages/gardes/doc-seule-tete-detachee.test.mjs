/**
 * Tests du codeur de #314 (D83) : « Une documentation seule ne rejoue que la garde, même sur une tête
 * détachée ». Tous de niveau 4 : l'auditeur choisit parmi eux le harnais.
 *
 * - Au Ready, la décision sans git : une documentation seule n'est pas couverte par `main` pour la
 *   garde et l'hébergement, qui lisent tout le dépôt ; elle l'est pour les autres ensembles.
 * - Le lanceur et la livraison dans un petit dépôt inventé : une garde, un cœur et un hébergement en
 *   `node --test`, chaque test notant son passage dans `TEMOIN_314`.
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

describe('[niveau 4] #314 · au Ready, une documentation seule', () => {
  const avant = lireLesEntrees(execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], { cwd: RACINE, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
  const main = { commit: 'm'.repeat(40), empreintes: empreintes(avant) };
  /** Ce que `main` couvre au Ready quand seuls ces chemins changent. */
  const couverts = (...chemins) => {
    const apres = avant.map((x) => (chemins.includes(x.chemin) ? { ...x, objet: '0'.repeat(40) } : x));
    const c = couvertureAuReady({ arbre: 'a', empreintes: empreintes(apres), main });
    return Object.keys(c.ensembles).sort();
  };

  test('[niveau 4] point 2 · un document de docs/ : ni la garde ni l’hébergement ne sont couverts, les autres ensembles sans navigateur le sont', () => {
    assert.ok(avant.some((x) => x.chemin === 'docs/roles/auditeur.md'), 'le document existe');
    assert.deepEqual(couverts('docs/roles/auditeur.md'), ['coeur', 'interface', 'relais']);
  });

  test('[niveau 4] points 2 et 6 · `docs/decisions.md` compris : l’interface sans navigateur ne lit plus rien de docs/', () => {
    assert.deepEqual(couverts('docs/decisions.md'), ['coeur', 'interface', 'relais']);
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
  const tester = async (dossier) => {
    vider();
    const r = await lancer('pnpm', ['--dir', join(dépôt, dossier), 'run', 'test', '2'], { cwd: dépôt, env });
    return { ...r, joués: joués() };
  };
  const attestations = () => git('for-each-ref', '--format=%(refname)', 'refs/attestations/');
  return { dépôt, env, git, tester, joués, vider, attestations };
}

describe('[niveau 4] #314 · une documentation seule, dans un dépôt inventé', { concurrency: true }, () => {
  test('[niveau 4] points 1 et 2 · sur une tête détachée, le cœur se saute sur la base commune avec main et le dit ; la garde et l’hébergement se jouent ; rien ne s’atteste', async () => {
    const f = dépôtInventé('detachee', 'codage/990-doc');
    f.git('checkout', '-q', '--detach');
    const coeur = await f.tester('packages/core');
    assert.equal(coeur.code, 0, coeur.sortie);
    assert.deepEqual(coeur.joués, [], coeur.sortie);
    assert.match(coeur.sortie, /aucune branche extraite : seul se saute ce que couvre la base commune avec main/, coeur.sortie);
    assert.match(coeur.sortie, /cœur : sauté\(s\) — rien de ce qu'il lit n'a changé depuis main \([0-9a-f]{10}\) : a\.test\.mjs/, coeur.sortie);
    for (const [dossier, quoi] of [['packages/gardes', 'garde'], ['apps/hebergement', 'hebergement']]) {
      const r = await f.tester(dossier);
      assert.equal(r.code, 0, r.sortie);
      assert.deepEqual(r.joués, [quoi], r.sortie);
    }
    assert.equal(f.attestations(), '', 'rien ne s’atteste sur une tête détachée');
  });

  test('[niveau 4] point 1 · sur une tête détachée, l’attestation de la branche n’est pas lue', async () => {
    const f = dépôtInventé('lue', 'codage/989-doc');
    const surLaBranche = await f.tester('packages/gardes');
    assert.deepEqual(surLaBranche.joués, ['garde'], surLaBranche.sortie);
    assert.notEqual(f.attestations(), '', 'la branche a attesté la garde');
    assert.deepEqual((await f.tester('packages/gardes')).joués, [], 'sur la branche, la garde attestée se saute');
    f.git('checkout', '-q', '--detach');
    const détachée = await f.tester('packages/gardes');
    assert.deepEqual(détachée.joués, ['garde'], détachée.sortie);
  });

  test('[niveau 4] point 2 · la livraison (pré-push) d’une documentation seule retient la garde et l’hébergement, et dit pourquoi elle ne joue pas le cœur', async () => {
    const B = 'codage/988-doc';
    const f = dépôtInventé('livraison', B);
    f.vider();
    const sha = f.git('rev-parse', 'HEAD');
    const push = await lancer('sh', ['.githooks/livraison.sh', 'push', `refs/heads/${B}`, sha, `refs/heads/${B}`, '0'.repeat(40), 'origin'], { cwd: f.dépôt, env: f.env });
    assert.equal(push.code, 0, push.sortie);
    assert.deepEqual(f.joués(), ['garde', 'hebergement'], push.sortie);
    assert.match(push.sortie, /la livraison retient garde hebergement/, push.sortie);
    assert.match(push.sortie, /cœur : non joué — rien de ce qu'il lit n'a changé depuis main/, push.sortie);
  });
});
