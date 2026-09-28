/**
 * Tests de #264 (réduit le 28/09 aux parties A et C) : les tests navigateur au Ready, le moins cher
 * d'abord, et les branches d'une PR fermée (D83). Depuis #266, ce qui se joue suit les empreintes :
 * le seuil 1 du Ready se saute sur une empreinte verte, et ce que #266 ajoute a ses tests
 * (`empreintes.test.mjs`).
 *
 * **Au niveau 1** — D83 (« aucun job sauté ne peut laisser fusionner ce qu'un job joué aurait
 * rougi », « au tag, rien ne se saute ») : au tag, rien ne se saute.
 *
 * **Au niveau 2** — les règles de #264, dont l'erreur ne coûterait que du temps ou une branche à
 * recréer : la livraison joue le typecheck, puis les tests sans navigateur, et les tests navigateur
 * sur demande seulement, après le reste ; demandés et verts, ils sont attestés et la CI ne les rejoue
 * pas sur le même arbre ; à la fermeture d'une PR, ses branches sont supprimées par leur nom exact.
 *
 * **Au niveau 3** — le dégradé : ce que chaque moment dit (point 9).
 *
 * Les livraisons se jouent dans un petit dépôt factice, une fois chacune (`mémo`), et servent aux
 * tests des niveaux 2 et 3.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { lireLAttestation } from './attestation.mjs';
import { branchesDeLaTete, client, fermeture, orphelines, orphelinesDuDepot, teteDe, teteDeLEvenement } from './branches-fermees.mjs';
import { RACINE } from './gardes.mjs';
import { commande, jouer } from './workflow-a-blanc.mjs';

const lireFichier = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');
const CI = '.github/workflows/ci.yml';
const WORKFLOW_BRANCHES = '.github/workflows/branches.yml';
const ATTESTATION_MJS = join(RACINE, '.githooks/attestation.mjs');
const FAUTE_DE_DEMANDE = /interface dans le navigateur : non joué — tests navigateur de non-régression laissés au Ready faute de demande/;
const PALIER_ROUGE = /tests navigateur non joués : un test sans navigateur, palier moins cher, a rougi/;

let dossierTemporaire;
const temporaire = () => (dossierTemporaire ??= mkdtempSync(join(tmpdir(), 'tests-lourds-264-')));
after(() => {
  if (dossierTemporaire) rmSync(dossierTemporaire, { recursive: true, force: true });
});
const mémo = (f) => {
  let p;
  return () => (p ??= f());
};

function environnement(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'NODE_TEST_CONTEXT' || k.startsWith('VITEST') || k.startsWith('GIT_') || k === 'TIRELIRE_SEUIL') delete env[k];
  return { ...env, GIT_AUTHOR_NAME: 'Tests 264', GIT_AUTHOR_EMAIL: 'tests@exemple.invalid', GIT_COMMITTER_NAME: 'Tests 264', GIT_COMMITTER_EMAIL: 'tests@exemple.invalid', ...extra };
}
const gitDans = (cwd, env) => (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd, env, encoding: 'utf8' }).trim();

/** Lance une commande ; rend `{ code, sortie }`, sorties mêlées. */
function lancer(cmd, args, options) {
  return new Promise((fini) => {
    const p = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    p.stdout.on('data', (d) => (sortie += d));
    p.stderr.on('data', (d) => (sortie += d));
    p.on('close', (code) => fini({ code, sortie }));
  });
}

// ─── Un dépôt factice, tel que la livraison le juge ────────────────────────────────────────────

/**
 * Les crochets et la garde du dépôt, un cœur et une garde en `node --test`, une interface en vitest
 * avec un test navigateur ; chaque test et chaque typecheck note son passage, avec l'heure, dans le
 * fichier `TEMOIN_264`. Rend ses commandes.
 */
function dépôtFactice(nom) {
  const dépôt = join(temporaire(), nom);
  const distant = join(temporaire(), `${nom}.git`);
  const témoin = join(temporaire(), `${nom}.temoin`);
  writeFileSync(témoin, '');
  for (const f of readdirSync(join(RACINE, '.githooks'))) cpSync(join(RACINE, '.githooks', f), join(dépôt, '.githooks', f));
  for (const f of readdirSync(join(RACINE, 'packages/gardes'))) {
    if (/\.mjs$|^package\.json$|^chemins-ignores$/.test(f) && !/\.test\.mjs$/.test(f)) cpSync(join(RACINE, 'packages/gardes', f), join(dépôt, 'packages/gardes', f));
  }
  const écrire = (f, texte) => {
    mkdirSync(dirname(join(dépôt, f)), { recursive: true });
    writeFileSync(join(dépôt, f), texte);
  };
  const note = (quoi) => `import { appendFileSync, readFileSync } from 'node:fs';\nconst note = () => appendFileSync(process.env.TEMOIN_264, ${JSON.stringify(quoi)} + ' ' + (performance.timeOrigin + performance.now()) + '\\n');\n`;
  écrire('typecheck.mjs', "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.TEMOIN_264, `typecheck-${process.argv[2]} ${performance.timeOrigin + performance.now()}\\n`);\n");
  écrire('packages/gardes/package.json', JSON.stringify({ name: 'f-gardes', private: true, type: 'module', scripts: { test: 'node ./lanceur.mjs node --test', typecheck: 'node ../../typecheck.mjs garde' } }));
  écrire('packages/gardes/g.test.mjs', `${note('garde')}import { test } from 'node:test';\ntest('g [niveau 1]', note);\n`);
  écrire('packages/core/package.json', JSON.stringify({ name: 'f-core', private: true, type: 'module', scripts: { test: 'node ../gardes/lanceur.mjs node --test', typecheck: 'node ../../typecheck.mjs coeur' } }));
  écrire('packages/core/lib.mjs', 'export const un = 1;\n');
  écrire('packages/core/c.test.mjs', `${note('coeur')}import { test } from 'node:test';\ntest('c [niveau 1]', note);\n`);
  écrire('apps/web/package.json', JSON.stringify({ name: 'f-web', private: true, type: 'module', scripts: { test: 'node ../../packages/gardes/lanceur.mjs vitest run', typecheck: 'node ../../typecheck.mjs web' } }));
  écrire('apps/web/etat.txt', 'vert\n');
  écrire('apps/web/test/w.test.mjs', `${note('interface')}import { test } from 'vitest';\ntest('w [niveau 1]', () => { note(); if (readFileSync(new URL('../etat.txt', import.meta.url), 'utf8').trim() === 'rouge') throw new Error('rouge'); });\n`);
  écrire('apps/web/test/navigateur/n.test.mjs', `${note('navigateur')}import { test } from 'vitest';\ntest('n [niveau 2]', note);\n`);
  écrire('docs/a.md', 'Un document.\n');
  écrire('.gitignore', 'node_modules\n');
  // Un navigateur « présent » : sa présence ne doit rien décider de ce qui se joue (point 6).
  const env = environnement({ TEMOIN_264: témoin, TIRELIRE_NAV: process.execPath });
  const git = gitDans(dépôt, env);
  git('init', '-q', '-b', 'main');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', distant], { env });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('remote', 'add', 'origin', distant);
  git('push', '-q', 'origin', 'main');
  git('fetch', '-q', 'origin');
  execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, dépôt], { env });
  const notes = () => readFileSync(témoin, 'utf8').split('\n').filter(Boolean).map((l) => ({ quoi: l.split(' ')[0], t: Number(l.split(' ')[1]) }));
  const vider = () => writeFileSync(témoin, '');
  const livrer = (...args) => lancer('sh', ['.githooks/livraison.sh', ...args], { cwd: dépôt, env });
  const pousser = (branche) => livrer('push', `refs/heads/${branche}`, git('rev-parse', 'HEAD'), `refs/heads/${branche}`, '0'.repeat(40), 'origin');
  const attestationDistante = (branche) => {
    const c = execFileSync('git', ['rev-parse', '-q', '--verify', `refs/heads/${branche}--attestation`], { cwd: distant, env, encoding: 'utf8' }).trim();
    return lireLAttestation(execFileSync('git', ['log', '-1', '--format=%B', c], { cwd: distant, env, encoding: 'utf8' })).attestation;
  };
  return { dépôt, distant, env, git, écrire, notes, vider, livrer, pousser, attestationDistante };
}

/** Une branche qui change le cœur, poussée ; puis la demande des tests navigateur ; puis le Ready. */
const livraisonVerte = mémo(async () => {
  const f = dépôtFactice('vert');
  const B = 'codage/998-vert';
  f.git('checkout', '-q', '-b', B);
  f.écrire('packages/core/lib.mjs', 'export const un = 2;\n');
  f.git('commit', '-q', '-am', 'cœur');
  const push = await f.pousser(B);
  const notesPush = f.notes();
  f.vider();
  const demande = await f.livrer('demande', '--navigateur');
  const notesDemande = f.notes();
  const attestation = f.attestationDistante(B);
  // Le Ready : la CI lit l'attestation de l'arbre de la tête, et joue les tests navigateur au seuil 2.
  f.git('push', '-q', 'origin', B);
  const ci = join(temporaire(), 'vert-ci');
  execFileSync('git', ['clone', '-q', '--branch', B, f.distant, ci], { env: f.env });
  execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, ci], { env: f.env });
  const couverture = join(temporaire(), 'vert-ci.json');
  const ready = execFileSync('node', [ATTESTATION_MJS, 'ready', f.git('rev-parse', 'HEAD'), B, 'origin/main', couverture], { cwd: ci, env: f.env, encoding: 'utf8' });
  f.vider();
  const nav = await lancer('pnpm', ['--dir', join(ci, 'apps/web'), 'run', 'test', '2', '--navigateur', '--attestation', couverture, 'test/navigateur'], { cwd: ci, env: f.env });
  return { push, notesPush, demande, notesDemande, attestation, ready, nav, notesReady: f.notes() };
});

/** La demande des tests navigateur sur une interface rouge sans navigateur. */
const demandeRouge = mémo(async () => {
  const f = dépôtFactice('rouge');
  f.git('checkout', '-q', '-b', 'codage/997-rouge');
  f.écrire('apps/web/etat.txt', 'rouge\n');
  f.git('commit', '-q', '-am', 'rouge');
  const d = await f.livrer('demande', '--navigateur');
  return { ...d, notes: f.notes() };
});

const tests = (n) => n.filter((x) => !x.quoi.startsWith('typecheck-'));
const typechecks = (n) => n.filter((x) => x.quoi.startsWith('typecheck-'));

// ─── La CI, jouée à blanc ───────────────────────────────────────────────────────────────────────

const PR = { number: 1, draft: false, head: { ref: 'codage/1-x', sha: 'a'.repeat(40) } };
const AU_READY = { github: { event_name: 'pull_request', ref: 'refs/pull/1/merge', repository: 'sverley/Tirelire', head_ref: 'codage/1-x', event: { action: 'ready_for_review', pull_request: PR } }, vars: {}, secrets: {}, inputs: {} };
const AU_TAG = { github: { event_name: 'push', ref: 'refs/tags/v1.0.0', repository: 'sverley/Tirelire', event: {} }, vars: {}, secrets: {}, inputs: {} };
const étapesDuTest = (ctx, échoue) => jouer(lireFichier(CI), ctx, échoue).find((j) => j.nom === 'test').joués.map(commande);
const lancementsDeTests = (étapes) => étapes.flatMap((c) => c.split('\n')).filter((l) => /\bpnpm\b.*\btest\b|harnais-du-besoin\.sh --jouer/.test(l));
const NAVIGATEUR_CI = /--navigateur .*test\/navigateur/;

// ─── Niveau 1 : au Ready, le seuil 1 ; au tag, rien ne se saute ─────────────────────────────────

describe('[niveau 1] #264, D83 · au tag, rien ne se saute', () => {
  test('au tag, le seuil 3 se joue tests navigateur compris, et aucune étape ne lit d’attestation', () => {
    const l = lancementsDeTests(étapesDuTest(AU_TAG));
    assert.ok(l.some((c) => /\bpnpm test 3\b/.test(c)), `au tag, le seuil 3 se joue\n${l.join('\n')}`);
    assert.ok(l.some((c) => /\btest 3 --navigateur\b.*test\/navigateur/.test(c)), `au tag, les tests navigateur se jouent au seuil 3\n${l.join('\n')}`);
    for (const c of l) assert.doesNotMatch(c, /--attestation/, `au tag, rien ne se saute : « ${c.trim()} »`);
  });
});

// ─── Niveau 2 : le moins cher d'abord, le navigateur au Ready ───────────────────────────────────

describe('[niveau 2] #264, points 5 à 8 · le moins cher d’abord, les tests navigateur au Ready ou sur demande', () => {
  test('point 6 · la livraison ne joue pas les tests navigateur de non-régression sans demande, navigateur présent', async () => {
    const r = await livraisonVerte();
    assert.equal(r.push.code, 0, r.push.sortie);
    assert.deepEqual(tests(r.notesPush).map((x) => x.quoi).sort(), ['coeur', 'interface'], `le cœur et l'interface sans navigateur se jouent, pas les tests navigateur\n${r.push.sortie}`);
  });

  test('point 5 · à la livraison, le typecheck se joue avant les tests', async () => {
    const r = await livraisonVerte();
    const tc = typechecks(r.notesPush);
    assert.ok(tc.length > 0, `le typecheck du paquet touché se joue\n${r.push.sortie}`);
    assert.ok(Math.max(...tc.map((x) => x.t)) <= Math.min(...tests(r.notesPush).map((x) => x.t)), JSON.stringify(r.notesPush));
  });

  test('points 5 et 7 · demandés, les tests navigateur se jouent après le typecheck et les tests sans navigateur', async () => {
    const r = await livraisonVerte();
    assert.equal(r.demande.code, 0, r.demande.sortie);
    const nav = r.notesDemande.filter((x) => x.quoi === 'navigateur');
    assert.equal(nav.length, 1, `la demande joue les tests navigateur\n${r.demande.sortie}`);
    // Depuis #266, ce qui est déjà vert sur son empreinte ne se rejoue pas : ce qui se joue d'autre à
    // ce moment, s'il y en a, part avant.
    const autres = r.notesDemande.filter((x) => x.quoi !== 'navigateur');
    assert.ok(autres.every((x) => x.t <= nav[0].t), `ils partent après le reste\n${JSON.stringify(r.notesDemande)}`);
  });

  test('point 5 · un test sans navigateur rouge retient les tests navigateur demandés', async () => {
    const r = await demandeRouge();
    assert.notEqual(r.code, 0, `la demande devait être refusée\n${r.sortie}`);
    const n = r.notes.map((x) => x.quoi);
    assert.ok(n.includes('interface'), `l'interface sans navigateur s'est jouée\n${r.sortie}`);
    assert.ok(!n.includes('navigateur'), `les tests navigateur ne partent pas après un rouge sans navigateur\n${r.sortie}`);
  });

  test('point 7 · demandés et verts, les tests navigateur sont attestés sur leur empreinte (#266), et la CI ne les y rejoue pas', async () => {
    const r = await livraisonVerte();
    assert.ok(r.attestation.verts.some((v) => v.ensemble === 'navigateur' && v.seuil === 2), `l'attestation envoyée couvre les tests navigateur\n${JSON.stringify(r.attestation)}`);
    assert.equal(r.nav.code, 0, r.nav.sortie);
    assert.deepEqual(r.notesReady.map((x) => x.quoi), [], `au Ready, les tests navigateur attestés sur le même arbre ne se rejouent pas\n${r.ready}\n${r.nav.sortie}`);
  });

  test('point 5 · en CI, les tests navigateur suivent le typecheck, le seuil 1 et le harnais, et ne partent pas après un rouge', () => {
    const c = étapesDuTest(AU_READY);
    const i = (motif) => c.findIndex((x) => motif.test(x));
    const nav = i(NAVIGATEUR_CI);
    assert.ok(nav > i(/pnpm typecheck/) && nav > i(/pnpm test 1\b/) && nav > i(/harnais-du-besoin\.sh --jouer/), c.join('\n---\n'));
    for (const rouge of [/pnpm typecheck/, /pnpm test 1\b/, /harnais-du-besoin\.sh --jouer/]) {
      const joués = étapesDuTest(AU_READY, (é) => rouge.test(commande(é)));
      assert.ok(!joués.some((x) => NAVIGATEUR_CI.test(x)), `après un rouge de « ${rouge.source} », les tests navigateur ne partent pas`);
    }
  });

  test('points 7 et 8 · la demande passe par une commande et ses arguments, écrite dans les rôles', () => {
    assert.equal(JSON.parse(lireFichier('package.json')).scripts.livraison, 'sh .githooks/livraison.sh demande');
    for (const rôle of ['codeur', 'auditeur']) assert.match(lireFichier(`docs/roles/${rôle}.md`), /`pnpm livraison --navigateur`/, rôle);
    assert.match(lireFichier('docs/roles/auditeur.md'), /`pnpm test 2` : rien n'en est sauté/);
  });
});

// ─── Niveau 2 : les branches, à la fermeture d'une PR ───────────────────────────────────────────

function apiDeBranches(branches, prs = []) {
  const d = { branches: branches.map((nom, i) => ({ nom, commit: String(i + 1).repeat(40).slice(0, 40) })), supprimées: [] };
  const json = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
  async function appeler(url, { method }) {
    const chemin = decodeURIComponent(new URL(url).pathname.replace(/^\/repos\/o\/r\//, ''));
    let m;
    if (method === 'GET' && (m = /^git\/matching-refs\/heads\/(.*)$/.exec(chemin))) {
      return json(d.branches.filter((b) => b.nom.startsWith(m[1])).map((b) => ({ ref: `refs/heads/${b.nom}`, object: { sha: b.commit } })));
    }
    if (method === 'GET' && chemin === 'pulls') return json(prs.map((ref) => ({ head: { ref, repo: { full_name: 'o/r' } } })));
    if (method === 'DELETE' && (m = /^git\/refs\/heads\/(.*)$/.exec(chemin))) {
      const i = d.branches.findIndex((b) => b.nom === m[1]);
      if (i < 0) return new Response('absente', { status: 422 });
      d.supprimées.push(d.branches.splice(i, 1)[0].nom);
      return new Response(null, { status: 204 });
    }
    return new Response('inconnu', { status: 404 });
  }
  return { d, gh: client({ jeton: 'j', depot: 'o/r', appeler }) };
}

describe('[niveau 2] #264, points 10 et 11 · les branches, à la fermeture d’une PR', () => {
  const TÊTE = 'codage/264-tests';
  const VOISINES = [TÊTE, `${TÊTE}-bis--attestation`, `${TÊTE}--attestation-2`, `codage/2640-tests--attestation`, `x/${TÊTE}--attestation`, 'main'];

  test('point 10 · à la fermeture, les trois branches de la tête, par leur nom exact ; ni la tête, ni une voisine', async () => {
    const { d, gh } = apiDeBranches([...VOISINES, `${TÊTE}--attestation`, `${TÊTE}--codeur`, `${TÊTE}--auditeur`]);
    const lignes = await fermeture(gh, TÊTE);
    assert.deepEqual(d.supprimées.sort(), [`${TÊTE}--attestation`, `${TÊTE}--auditeur`, `${TÊTE}--codeur`], 'les trois branches de la PR fermée, et elles seules');
    assert.deepEqual(d.branches.map((b) => b.nom).sort(), [...VOISINES].sort(), 'la tête et les branches voisines restent');
    for (const nom of d.supprimées) assert.ok(lignes.some((l) => l.includes(nom) && /dernier commit `[0-9]{40}`/.test(l)), `${nom} : nommée avec son dernier commit`);
    assert.deepEqual(branchesDeLaTete(TÊTE, VOISINES.map((nom) => ({ nom }))), [], 'aucune voisine ne passe pour une branche de la PR');
  });

  test('point 11 · les branches sans PR ouverte de leur tête sont supprimées ; celles d’une PR ouverte restent', async () => {
    const restent = ['main', 'codage/246-tests-interface', 'codage/246-tests-interface--attestation', 'codage/245-tests-coeur--attestation'];
    const partent = ['131--auditeur', 'audit/131-ci-filet-final--auditeur', 'audit/232-niveaux-des-tests--codeur', 'codage/244-tests-hebergement-relais--attestation'];
    const { d, gh } = apiDeBranches([...restent, ...partent, 'audit/131-ci-filet-final'], ['codage/246-tests-interface', 'codage/245-tests-coeur']);
    const lignes = await orphelinesDuDepot(gh);
    assert.deepEqual(d.supprimées.sort(), [...partent].sort(), lignes.join('\n'));
    for (const nom of partent) assert.ok(lignes.some((l) => l.includes(nom) && /dernier commit `[0-9]{40}`/.test(l)), `${nom} : nommée avec son dernier commit`);
    assert.ok(d.branches.some((b) => b.nom === 'audit/131-ci-filet-final'), 'une tête n’est jamais touchée');
    assert.deepEqual(orphelines([{ nom: '--attestation' }, { nom: 'a--codeurs' }], []), [], 'un nom qui n’a que le suffixe, ou un suffixe voisin, n’est pas visé');
    assert.equal(teteDe('a/b--auditeur'), 'a/b');
  });

  test('point 10 · la tête se lit dans l’événement ; une PR venue d’un autre dépôt ne touche rien ici', () => {
    assert.equal(teteDeLEvenement({ pull_request: { head: { ref: TÊTE, repo: { full_name: 'o/r' } } } }, 'o/r'), TÊTE);
    assert.equal(teteDeLEvenement({ pull_request: { head: { ref: TÊTE, repo: { full_name: 'autre/r' } } } }, 'o/r'), null);
  });

  test('points 10 et 11 · le workflow tourne à chaque fermeture, fusionnée ou non, et à son arrivée sur main, en n’extrayant que main', () => {
    const yaml = lireFichier(WORKFLOW_BRANCHES);
    const pr = (merged) => ({ number: 1, draft: false, merged, head: { ref: TÊTE, sha: 'a'.repeat(40), repo: { full_name: 'sverley/Tirelire' } } });
    const ctx = (event_name, event, ref = 'refs/heads/main') => ({ github: { event_name, ref, repository: 'sverley/Tirelire', event }, vars: {}, secrets: {}, inputs: {} });
    for (const merged of [true, false]) {
      const étapes = jouer(yaml, ctx('pull_request_target', { action: 'closed', pull_request: pr(merged) })).flatMap((j) => j.joués.map(commande));
      assert.ok(étapes.some((c) => /branches-fermees\.mjs fermeture\b/.test(c)), `fermeture ${merged ? 'fusionnée' : 'sans fusion'} : les branches de la PR sont supprimées`);
    }
    const surMain = jouer(yaml, ctx('push', {})).flatMap((j) => j.joués.map(commande));
    assert.ok(surMain.some((c) => /branches-fermees\.mjs orphelines\b/.test(c)), 'à son arrivée sur main, les branches qui traînent sont supprimées');
    assert.match(yaml, /paths:\s*\[?'?\.github\/workflows\/branches\.yml/, 'sur main, il ne tourne qu’à sa propre arrivée ou à la main');
    for (const [, ref] of yaml.matchAll(/^\s+ref:\s*(.+)$/gm)) assert.equal(ref.trim(), 'main', 'le job n’extrait que main');
  });
});

// ─── Niveau 3 : ce que chaque moment dit ───────────────────────────────────────────────────────

describe('[niveau 3] #264, point 9 · chaque moment qui ne joue pas les tests navigateur dit pourquoi', () => {
  test('la livraison sans demande les dit laissés au Ready faute de demande', async () => {
    assert.match((await livraisonVerte()).push.sortie, FAUTE_DE_DEMANDE);
  });

  test('la livraison dit qu’un palier moins cher rouge les a retenus', async () => {
    assert.match((await demandeRouge()).sortie, PALIER_ROUGE);
  });

  test('la CI dit qu’ils sont couverts par l’attestation', async () => {
    assert.match((await livraisonVerte()).nav.sortie, /attestation : sauté/);
  });

  test('le workflow des tests dit ce que chaque passage a joué, et au tag que rien ne se saute', () => {
    const étape = lireFichier(CI).split('\n      - ').find((é) => é.startsWith('name: Ce que ce passage a joué'));
    assert.ok(étape, 'aucune étape ne dit ce que le passage a joué');
    assert.match(étape, /if: always\(\)/, 'elle se joue même après un rouge');
    for (const quoi of ['typecheck', 'harnais du besoin', 'interface dans le navigateur', 'palier moins cher', 'couvre', "rien de ce qu'elle lit n'a changé", 'au tag, rien ne se saute']) {
      assert.ok(étape.includes(quoi), `l'étape ne dit rien de « ${quoi} »`);
    }
  });
});
