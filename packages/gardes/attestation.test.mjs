/**
 * Tests de #237 : la livraison atteste ce qu'elle a joué, la CI ne joue que le manque (D83).
 *
 * **Au niveau 1** — principe 10.1 et D83 (« aucun job sauté ne peut laisser fusionner ce qu'un job
 * joué aurait rougi ») : la CI ne saute que ce que l'attestation couvre, sur l'arbre même qu'elle
 * teste ; le seuil 1 se joue toujours au Ready ; une branche qui ne contient pas le dernier `main`
 * est à mettre à jour, et la commande échoue avant toute étape de tests ; après la fusion, seul un
 * arbre trouvé vert au Ready saute ses tests ; au tag `v*`, rien ne se saute ; une PR qui change
 * ce que les tests navigateur lisent (point 9) les fait jouer.
 *
 * **Au niveau 2** — le cas nominal de la décision, dont l'échec ne coûterait que de la CI : la
 * livraison verte écrit son attestation et l'envoie avec le push ; la CI la lit, et le lanceur saute
 * ce qu'elle couvre en le disant ; une PR qui ne change que des chemins que les tests navigateur ne
 * lisent pas, ou la garde, les saute sans attestation (point 9).
 *
 * `node:test` n'a pas de `test.fails` : l'échec attendu d'un témoin tient dans une assertion
 * (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
  avecLesChemins,
  ciblesDesArguments,
  couvertureApresFusion,
  couvertureAuReady,
  couvre,
  etatDuStatut,
  lireLAttestation,
  lireLesLancements,
  navigateurInutile,
  texteDeLAttestation,
} from './attestation.mjs';
import { RACINE } from './gardes.mjs';
import { commande, jouer } from './workflow-a-blanc.mjs';

const CI = '.github/workflows/ci.yml';
const lireFichier = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

/** Une attestation de livraison : garde et interface au seuil 2, un harnais du besoin dans la garde. */
function attestation({ navigateur = true, harnais = 'vert', arbre = A } = {}) {
  const joues = [
    `non-regression\tpackages/gardes\t2\t0\tnouveau.test.mjs`,
    `non-regression\tapps/web\t2\t${navigateur ? 1 : 0}\t`,
    `harnais\tpackages/gardes\t4\t0\tnouveau.test.mjs`,
    `typecheck\tapps/web\t-\t0\t`,
  ].join('\n');
  const { ensembles, typecheck } = lireLesLancements(joues);
  const texte = texteDeLAttestation({ arbre, seuil: 2, navigateur, branche: 'codage/999-essai', harnais, ensembles, typecheck, date: '2026-09-28T00:00:00Z' });
  return lireLAttestation(texte, arbre).attestation;
}

const demande = (d) => ({ arbre: A, dossier: 'packages/gardes', seuil: 2, navigateur: false, cibles: [], nomme: false, ...d });
/** Les demandes de la CI au Ready (`ci.yml`) : seuil 1, tests navigateur au seuil 2, harnais du besoin. */
const SEUIL_1 = (dossier) => demande({ dossier, seuil: 1 });
const NAVIGATEUR = demande({ dossier: 'apps/web', seuil: 2, navigateur: true, cibles: ['test/navigateur'] });
const HARNAIS = demande({ seuil: 4, navigateur: true, cibles: ['nouveau.test.mjs'] });

function environnement(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'NODE_TEST_CONTEXT' || k.startsWith('VITEST') || k.startsWith('GIT_') || k === 'TIRELIRE_SEUIL') delete env[k];
  return { ...env, ...extra };
}

let dossierTemporaire;
const temporaire = () => (dossierTemporaire ??= mkdtempSync(join(tmpdir(), 'attestation-237-')));
after(() => {
  if (dossierTemporaire) rmSync(dossierTemporaire, { recursive: true, force: true });
});

/** Un petit dépôt : `main`, puis une branche ; rend ses commandes git. */
function petitDépôt(nom) {
  const dépôt = join(temporaire(), nom);
  mkdirSync(dépôt, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: dépôt, env: environnement(), encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Tests 237');
  git('config', 'user.email', 'tests@exemple.invalid');
  git('config', 'commit.gpgsign', 'false');
  return { dépôt, git };
}

const ATTESTATION_MJS = join(RACINE, '.githooks/attestation.mjs');
const attester = (cwd, ...args) => spawnSync('node', [ATTESTATION_MJS, ...args], { cwd, env: environnement(), encoding: 'utf8' });

/**
 * La CI au Ready sur une branche qui change `fichier` depuis `main`, sans attestation : rend le code
 * de sortie et la couverture écrite pour `pnpm test`, ou `null`.
 */
function readySur(nom, fichier) {
  const { dépôt, git } = petitDépôt(nom);
  writeFileSync(join(dépôt, 'a.txt'), '1\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'codage/999-essai');
  mkdirSync(dirname(join(dépôt, fichier)), { recursive: true });
  writeFileSync(join(dépôt, fichier), 'changé\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'branche');
  const sortie = join(dépôt, 'attestation.json');
  const r = attester(dépôt, 'ready', git('rev-parse', 'HEAD'), 'codage/999-essai', 'main', sortie);
  const couverture = existsSync(sortie) ? JSON.parse(readFileSync(sortie, 'utf8')) : null;
  return { ...r, couverture, arbre: git('rev-parse', 'HEAD^{tree}') };
}

/** Point 9 : des chemins que les tests navigateur lisent, ou qui ne sont pas dans la liste. */
const LUS_PAR_LE_NAVIGATEUR = ['apps/web/src/App.svelte', 'apps/web/test/navigateur/acces.test.ts', 'packages/core/src/plan.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.base.json', 'apps/web/vite.config.ts'];
/** Point 9 : des chemins qu'ils ne lisent pas, ou la garde. */
const NON_LUS = ['docs/decisions.md', '.github/workflows/ci.yml', '.githooks/livraison.sh', 'packages/gardes/lanceur.mjs', 'apps/hebergement/apercu.sh', 'apps/relay/relais.php', 'README.md', 'apps/web/README.md', '.gitignore'];

// La CI jouée à blanc.
const auReady = {
  github: { event_name: 'pull_request', ref: 'refs/pull/237/merge', event: { action: 'ready_for_review', pull_request: { number: 237, draft: false, head: { sha: A } } } },
  vars: {},
  secrets: {},
  inputs: {},
};
const surMain = { github: { event_name: 'push', ref: 'refs/heads/main', event: {} }, vars: {}, secrets: {}, inputs: {} };
const auTag = { github: { event_name: 'push', ref: 'refs/tags/v1.0.0', event: {} }, vars: {}, secrets: {}, inputs: {} };
const joués = (ctx) => jouer(lireFichier(CI), ctx).flatMap((job) => job.joués.map((é) => ({ job, é, c: commande(é) })));
const deTests = (c) => /\bpnpm\b[^\n]*\btest\b|harnais-du-besoin/.test(c);
const laisseÉchouer = (job, é) => /^ +(?:- )?continue-on-error:\s*true/m.test(é.texte) || /^ {4}continue-on-error:\s*true/m.test(job.lignes.join('\n'));

describe('[niveau 1] #237, principe 10.1 · la CI ne saute que ce que la livraison a joué sur cet arbre', () => {
  test('sans attestation, ou pour un autre arbre, tout se joue', () => {
    const c = couvertureAuReady(attestation());
    assert.equal(couvre(null, NAVIGATEUR).couvert, false, 'sans attestation, les tests navigateur se jouent');
    assert.equal(couvre(c, { ...NAVIGATEUR, arbre: B }).couvert, false, "une attestation d'un autre arbre ne couvre rien");
    assert.equal(lireLAttestation(texteDeLAttestation({ ...attestation(), arbre: A }), B).attestation, undefined, "une attestation portée par un autre arbre que le sien ne se lit pas");
  });

  test('au Ready, le seuil 1 se joue toujours, même couvert par la livraison', () => {
    const c = couvertureAuReady(attestation());
    for (const d of ['packages/gardes', 'apps/web']) assert.equal(couvre(c, SEUIL_1(d)).couvert, false, `${d} : le seuil 1 se joue toujours au Ready (point 3)`);
  });

  test("les tests navigateur se jouent si la livraison n'avait pas de navigateur", () => {
    assert.equal(couvre(couvertureAuReady(attestation({ navigateur: false })), NAVIGATEUR).couvert, false);
  });

  test('le harnais du besoin se rejoue s’il était rouge à la livraison, ou s’il n’en faisait pas partie', () => {
    assert.equal(couvre(couvertureAuReady(attestation({ harnais: 'rouge' })), HARNAIS).couvert, false, 'harnais rouge à la livraison : il se rejoue');
    assert.equal(couvre(couvertureAuReady(attestation()), { ...HARNAIS, cibles: ['autre.test.mjs'] }).couvert, false, "un fichier que l'attestation ne nomme pas se joue");
    // Le paquet en entier, harnais rouge : ses fichiers du harnais n'ont pas été joués verts.
    assert.equal(couvre(couvertureAuReady(attestation({ harnais: 'rouge' })), demande({ seuil: 2 })).couvert, false);
  });

  test('un paquet que la livraison n’a pas joué, un seuil plus haut, un appel nommé : tout se joue', () => {
    const c = couvertureAuReady(attestation());
    assert.equal(couvre(c, demande({ dossier: 'packages/core', seuil: 2 })).couvert, false, 'paquet non joué');
    assert.equal(couvre(c, demande({ dossier: 'apps/web', seuil: 3 })).couvert, false, 'seuil au-delà de 2');
    assert.equal(couvre(c, { ...HARNAIS, nomme: true }).couvert, false, 'appel nommé');
  });

  test('après la fusion, seul un arbre trouvé vert au Ready saute ses tests', () => {
    assert.equal(couvertureApresFusion(A, []), null, 'aucune tête');
    assert.equal(couvertureApresFusion(A, [{ sha: B, arbre: B, statut: 'success' }]), null, 'tête verte, mais autre arbre');
    for (const statut of ['failure', 'pending', null]) assert.equal(couvertureApresFusion(A, [{ sha: B, arbre: A, statut }]), null, `statut ${statut}`);
    assert.equal(couvre(couvertureApresFusion(A, [{ sha: B, arbre: A, statut: 'success' }]), demande({ arbre: B, seuil: 1 })).couvert, false, 'fichier pour un autre arbre que celui extrait');
  });

  test('le statut lu après la fusion est « Toute la CI sur ce commit », et lui seul', () => {
    assert.equal(etatDuStatut([{ context: 'autre', state: 'success' }]), null, 'un autre statut vert ne vaut pas le vert du Ready');
    assert.equal(etatDuStatut([{ context: 'autre', state: 'success' }, { context: 'Toute la CI sur ce commit', state: 'failure' }]), 'failure');
    assert.equal(etatDuStatut(null), null);
  });

  test('point 9 · une PR qui change l’interface, le cœur ou la racine hors *.md et .gitignore fait jouer les tests navigateur', () => {
    for (const f of LUS_PAR_LE_NAVIGATEUR) {
      assert.equal(navigateurInutile([f]), false, `${f} : lu par les tests navigateur, ils se jouent`);
      assert.equal(navigateurInutile(['docs/decisions.md', f]), false, `docs/decisions.md et ${f} : ils se jouent`);
      const c = avecLesChemins(null, { arbre: A, fichiers: [f], base: 'main', toujours: 1 });
      assert.equal(couvre(c, NAVIGATEUR).couvert, false, `${f} : sans attestation, les tests navigateur ne se sautent pas`);
    }
    const r = readySur('interface-touchee', 'apps/web/src/App.svelte');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(couvre(r.couverture, { ...NAVIGATEUR, arbre: r.arbre }).couvert, false, `apps/web touché : la CI au Ready ne doit pas sauter les tests navigateur\n${r.stdout}`);
  });

  test('point 9 · la règle des chemins ne saute que les tests navigateur : ni le seuil 1, ni le harnais du besoin', () => {
    const c = avecLesChemins(null, { arbre: A, fichiers: NON_LUS, base: 'main', toujours: 1 });
    assert.equal(couvre(c, SEUIL_1('apps/web')).couvert, false, 'le seuil 1 se joue');
    assert.equal(couvre(c, HARNAIS).couvert, false, 'le harnais du besoin se joue');
    assert.equal(couvre({ ...c, toujours: -1 }, demande({ dossier: 'apps/web', seuil: 2 })).couvert, false, "l'interface headless se joue");
    assert.equal(couvre(c, { ...NAVIGATEUR, arbre: B }).couvert, false, 'pour un autre arbre, rien ne se saute');
  });

  test('témoin rouge · une règle qui prendrait tout `packages/` ou toute la racine sauterait les tests navigateur à tort', () => {
    const laxiste = (fichiers) => fichiers.every((f) => f.startsWith('packages/') || !f.includes('/') || NON_LUS.includes(f));
    assert.ok(LUS_PAR_LE_NAVIGATEUR.some((f) => laxiste([f])), 'témoin : cette règle devrait sauter un chemin lu par les tests navigateur');
    assert.ok(LUS_PAR_LE_NAVIGATEUR.every((f) => !navigateurInutile([f])), 'la règle du point 9 ne le fait pas');
  });

  test('au Ready, une branche qui ne contient pas le dernier main est à mettre à jour : échec, et rien d’écrit', () => {
    const { dépôt, git } = petitDépôt('pas-a-jour');
    writeFileSync(join(dépôt, 'a.txt'), '1\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'codage/999-essai');
    writeFileSync(join(dépôt, 'b.txt'), '1\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'branche');
    const tête = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');
    writeFileSync(join(dépôt, 'a.txt'), '2\n');
    git('commit', '-q', '-am', 'main avance');
    git('checkout', '-q', 'codage/999-essai');
    const sortie = join(dépôt, 'attestation.json');
    writeFileSync(sortie, '{}');
    const r = attester(dépôt, 'ready', tête, 'codage/999-essai', 'main', sortie);
    assert.notEqual(r.status, 0, `une branche qui ne contient pas le dernier main doit faire échouer l'étape (point 2)\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /à mettre à jour/, 'le message dit « à mettre à jour »');
    assert.equal(existsSync(sortie), false, "rien ne doit rester à passer à `pnpm test`");
  });

  test('au Ready, l’étape qui vérifie la branche et lit l’attestation bloque, avant toute étape de tests', () => {
    const liste = joués(auReady);
    const i = liste.findIndex(({ c }) => /attestation\.mjs ready\b/.test(c));
    assert.ok(i >= 0, `${CI} : au Ready, aucune étape ne lance \`attestation.mjs ready\` (points 2 et 3)`);
    assert.ok(!laisseÉchouer(liste[i].job, liste[i].é), `${CI} : l'étape de la branche à jour ne doit pas se laisser échouer (point 2)`);
    const avant = liste.findIndex(({ job, c }) => job === liste[i].job && deTests(c));
    assert.ok(avant > i, `${CI} : au Ready, une étape de tests passe avant la vérification de la branche (point 2)`);
    const seuil1 = liste.filter(({ c }) => /\bpnpm test 1\b/.test(c));
    assert.ok(seuil1.length, `${CI} : au Ready, le seuil 1 ne se joue plus ; le test est à relire`);
    for (const { job, é, c } of seuil1) {
      assert.doesNotMatch(c, /--attestation/, `${CI} : au Ready, le seuil 1 se joue toujours, sans attestation (point 3)`);
      assert.ok(!laisseÉchouer(job, é), `${CI} : au Ready, le seuil 1 ne doit pas se laisser échouer`);
    }
  });

  test('au tag v*, rien ne se saute : aucune étape ne lit d’attestation', () => {
    const liste = joués(auTag);
    assert.ok(liste.some(({ c }) => /\bpnpm test 3\b/.test(c)), `${CI} : au tag v*, le seuil 3 ne se joue plus ; le test est à relire`);
    const lisent = liste.filter(({ c }) => /attestation/.test(c)).map(({ é }) => é.lignes[0].trim());
    assert.deepEqual(lisent, [], `${CI} : au tag v*, une étape lit une attestation (point 5)`);
  });

  test('témoin rouge · une couverture qui ignorerait l’arbre, le seuil 1 ou le navigateur ferait rougir ces tests', () => {
    const c = couvertureAuReady(attestation({ navigateur: false }));
    const laxiste = (cc, d) => ({ couvert: cc.ensembles.some((e) => e.dossier === d.dossier) });
    assert.equal(laxiste(c, SEUIL_1('apps/web')).couvert, true, 'témoin : une décision qui ne regarde que le paquet sauterait le seuil 1');
    assert.equal(laxiste(c, NAVIGATEUR).couvert, true, 'témoin : elle sauterait aussi les tests navigateur non joués');
    assert.equal(laxiste(c, { ...NAVIGATEUR, arbre: B }).couvert, true, "témoin : et ceux d'un autre arbre");
  });
});

describe('[niveau 2] #237 · la livraison atteste, la CI saute ce qui est couvert', () => {
  test('ce que l’attestation couvre se saute : tests navigateur, harnais vert, paquet joué au seuil 2', () => {
    const c = couvertureAuReady(attestation());
    assert.equal(couvre(c, NAVIGATEUR).couvert, true, 'les tests navigateur joués à la livraison se sautent');
    assert.equal(couvre(c, HARNAIS).couvert, true, 'le harnais du besoin vert se saute');
    assert.equal(couvre(c, demande({ seuil: 2 })).couvert, true, 'le paquet joué au seuil 2, harnais vert, se saute au seuil 2');
    assert.equal(couvre(couvertureApresFusion(A, [{ sha: B, arbre: A, statut: 'success' }]), SEUIL_1('packages/core')).couvert, true, 'sur main, un arbre vert au Ready saute tout');
  });

  test('point 9 · une PR qui ne change que des chemins que les tests navigateur ne lisent pas, ou la garde, les saute sans attestation', () => {
    for (const f of NON_LUS) {
      const c = avecLesChemins(null, { arbre: A, fichiers: [f], base: 'main', toujours: 1 });
      assert.equal(couvre(c, NAVIGATEUR).couvert, true, `${f} : les tests navigateur se sautent`);
    }
    assert.equal(couvre(avecLesChemins(couvertureAuReady(attestation({ navigateur: false })), { arbre: A, fichiers: NON_LUS, base: 'main', toujours: 1 }), NAVIGATEUR).couvert, true, 'avec une attestation sans navigateur aussi');
    const r = readySur('docs-seuls', 'docs/decisions.md');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const d = couvre(r.couverture, { ...NAVIGATEUR, arbre: r.arbre });
    assert.equal(d.couvert, true, `docs seuls : la CI au Ready saute les tests navigateur\n${r.stdout}`);
    assert.match(r.stdout, /Tests navigateur sautés/, 'et le dit');
  });

  test('les cibles d’un lancement : ses arguments, hors options et valeurs d’options', () => {
    assert.deepEqual(ciblesDesArguments(['--reporter=json', '--exclude', 'x.test.ts', 'test/navigateur/', './a.test.mjs']), ['test/navigateur', 'a.test.mjs']);
  });

  test('en CI, chaque lancement des tests reçoit le fichier de l’attestation, sauf le seuil 1 au Ready', () => {
    for (const [nom, ctx] of [['au Ready', auReady], ['sur main', surMain]]) {
      const tests = joués(ctx).filter(({ c }) => deTests(c) && !(ctx === auReady && /\bpnpm test 1\s*$/m.test(c)));
      assert.ok(tests.length, `${CI} : ${nom}, aucune étape de tests`);
      for (const { é, c } of tests) assert.match(c, /--attestation\s+\S/, `${CI} : ${nom}, « ${é.lignes[0].trim()} » ne passe pas l'attestation (point 6)`);
    }
    assert.ok(joués(surMain).some(({ c }) => /attestation\.mjs apres-fusion\b/.test(c)), `${CI} : sur main, aucune étape ne cherche si l'arbre a été trouvé vert au Ready (point 4)`);
  });

  test('une livraison verte atteste l’arbre, l’envoie avec le push, et la CI saute ce qu’elle couvre', () => {
    // Un dépôt tel que la copie de travail le porte, sans ses tests, et son dépôt distant.
    const dépôt = join(temporaire(), 'depot');
    const distant = join(temporaire(), 'distant.git');
    const env = environnement({ TIRELIRE_NAV: process.execPath });
    const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim();
    const suivis = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: RACINE, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const f of suivis) {
      if (/\.test\.[^/]+$|(^|\/)test\//.test(f) || f.startsWith('apps/web/android/') || /(^|\/)\.niveaux-232-/.test(f) || !existsSync(join(RACINE, f))) continue;
      mkdirSync(dirname(join(dépôt, f)), { recursive: true });
      cpSync(join(RACINE, f), join(dépôt, f));
    }
    git(temporaire(), 'init', '-q', '--bare', '-b', 'main', distant);
    git(dépôt, 'init', '-q', '-b', 'main');
    git(dépôt, 'config', 'user.name', 'Tests 237');
    git(dépôt, 'config', 'user.email', 'tests@exemple.invalid');
    git(dépôt, 'config', 'commit.gpgsign', 'false');
    const note = "import { appendFileSync } from 'node:fs';\nimport { test } from 'node:test';\nconst note = (id) => { if (process.env.TEMOIN_237) appendFileSync(process.env.TEMOIN_237, id + '\\n'); };\n";
    writeFileSync(join(dépôt, 'packages/gardes/ancien.test.mjs'), `${note}test('ancien [niveau 1]', () => note('ancien'));\n`);
    git(dépôt, 'add', '-A');
    git(dépôt, 'commit', '-q', '--no-verify', '-m', 'base');
    git(dépôt, 'remote', 'add', 'origin', distant);
    git(dépôt, 'push', '-q', '--no-verify', 'origin', 'main');
    git(dépôt, 'fetch', '-q', 'origin');
    const BRANCHE = 'codage/997-attestation';
    git(dépôt, 'checkout', '-q', '-b', BRANCHE);
    execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, dépôt], { env });
    writeFileSync(join(dépôt, 'packages/gardes/nouveau.test.mjs'), `// Harnais d'audit de #997 : un besoin inventé.\n${note}test('nouveau [niveau 4]', () => note('nouveau'));\n`);
    git(dépôt, 'add', 'packages/gardes/nouveau.test.mjs');
    git(dépôt, 'commit', '-q', '--no-verify', '-m', 'besoin #997');
    const sha = git(dépôt, 'rev-parse', 'HEAD');
    const arbre = git(dépôt, 'rev-parse', 'HEAD^{tree}');

    // La livraison, comme le pré-push la lance, avec le dépôt distant.
    const l = spawnSync('sh', ['.githooks/livraison.sh', 'push', `refs/heads/${BRANCHE}`, sha, `refs/heads/${BRANCHE}`, '0'.repeat(40), 'origin'], { cwd: dépôt, env, encoding: 'utf8' });
    assert.equal(l.status, 0, `livraison refusée\n${l.stdout}${l.stderr}`);
    const porte = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/heads/${BRANCHE}--attestation`], { cwd: distant, env, encoding: 'utf8' }).stdout.trim();
    assert.ok(porte, `aucune attestation envoyée sur ${BRANCHE}--attestation (point 1)\n${l.stdout}${l.stderr}`);
    assert.equal(git(distant, 'rev-parse', `${porte}^{tree}`), arbre, "l'attestation envoyée porte l'arbre vérifié (point 1)");
    const { attestation: a } = lireLAttestation(git(distant, 'log', '-1', '--format=%B', porte), arbre);
    assert.ok(a, "l'attestation envoyée se lit");
    assert.equal(a.seuil, 2, 'seuil attesté');
    assert.equal(a.navigateur, true, 'navigateur présent (TIRELIRE_NAV)');
    assert.equal(a.harnais, 'vert', 'harnais du besoin vert');
    assert.deepEqual(a.ensembles.find((e) => e.sorte === 'harnais'), { sorte: 'harnais', dossier: 'packages/gardes', seuil: 4, navigateur: false, fichiers: ['nouveau.test.mjs'] }, 'harnais du besoin attesté');
    assert.deepEqual(a.ensembles.find((e) => e.sorte === 'non-regression'), { sorte: 'non-regression', dossier: 'packages/gardes', seuil: 2, navigateur: false, exclus: ['nouveau.test.mjs'] }, 'ensemble joué attesté');

    // La branche arrive sur le distant ; la CI la lit, au Ready, sur l'arbre de la tête.
    git(dépôt, 'push', '-q', '--no-verify', 'origin', BRANCHE);
    const ci = join(temporaire(), 'ci');
    git(temporaire(), 'clone', '-q', '--branch', BRANCHE, distant, ci);
    execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, ci], { env });
    const fichier = join(temporaire(), 'attestation.json');
    const r = attester(ci, 'ready', sha, BRANCHE, 'origin/main', fichier);
    assert.equal(r.status, 0, `lecture de l'attestation en CI\n${r.stdout}${r.stderr}`);
    assert.ok(existsSync(fichier), `la CI n'a rien écrit à passer à \`pnpm test\`\n${r.stdout}`);

    const témoin = join(temporaire(), 'temoin');
    const pnpmTest = (...a) => {
      writeFileSync(témoin, '');
      const p = spawnSync('pnpm', ['--dir', join(ci, 'packages/gardes'), 'run', 'test', ...a], { cwd: ci, env: { ...env, TEMOIN_237: témoin }, encoding: 'utf8' });
      return { ...p, notés: readFileSync(témoin, 'utf8').split('\n').filter(Boolean) };
    };
    const harnais = pnpmTest('4', '--navigateur', '--attestation', fichier, 'nouveau.test.mjs');
    assert.equal(harnais.status, 0, harnais.stdout + harnais.stderr);
    assert.deepEqual(harnais.notés, [], 'le harnais du besoin, vert à la livraison, se saute');
    assert.match(harnais.stdout, /attestation : sauté/, 'le lanceur dit ce qu’il saute et pourquoi (point 3)');
    const seuil1 = pnpmTest('1', '--attestation', fichier);
    assert.equal(seuil1.status, 0, seuil1.stdout + seuil1.stderr);
    assert.deepEqual(seuil1.notés, ['ancien'], 'le seuil 1 se joue toujours au Ready');
  });
});
