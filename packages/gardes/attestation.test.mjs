/**
 * Harnais d'audit de #237, composé par #285 parmi les tests du codeur (D83) : un test qui porte
 * sa propre marque est retenu à ce niveau ; les autres restent au niveau 4.
 *
 * Tests de #237 : la livraison atteste ce qu'elle a joué, la CI ne joue que le manque (D83). Depuis
 * #266, l'attestation porte l'empreinte de chaque ensemble trouvé vert, et le seuil 1 du Ready se
 * saute lui aussi sur une empreinte verte ; ce que #266 ajoute a ses propres tests
 * (`empreintes.test.mjs`).
 *
 * **Qu'aucun rouge ne fusionne** — principe 10.1 et D83 (« aucun job sauté ne peut laisser
 * fusionner ce qu'un job joué aurait rougi ») : la CI ne saute que ce que l'attestation couvre, sur
 * l'arbre même qu'elle teste ; au Ready, un ensemble qui n'est pas vert sur son empreinte se joue,
 * seuil 1 compris ; une branche qui ne contient pas le dernier `main` est à mettre à jour, et la
 * commande échoue avant toute étape de tests ; après la fusion, seul un ensemble trouvé vert au
 * Ready, ou inchangé depuis le premier parent, saute ses tests ; au tag `v*`, rien ne se saute ;
 * une PR qui change ce que les tests navigateur lisent (point 9) les fait jouer.
 *
 * **Le cas nominal de la décision**, dont l'échec ne coûterait que de la CI : la livraison verte
 * écrit son attestation et l'envoie avec le push ; la CI la lit, et le lanceur saute ce qu'elle
 * couvre en le disant, seuil 1 compris ; une PR qui ne change que des chemins que les tests
 * navigateur ne lisent pas, ou la garde, les saute sans attestation (point 9).
 *
 * `node:test` n'a pas de `test.fails` : l'échec attendu d'un témoin tient dans une assertion
 * (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
  TOUS,
  ciblesDesArguments,
  couvertureApresFusion,
  couvertureAuReady,
  couvre,
  empreinteDe,
  etatDuStatut,
  lireLAttestation,
  lit,
  texteDeLAttestation,
} from './attestation.mjs';
import { RACINE } from './gardes.mjs';
import { commande, jouer } from './workflow-a-blanc.mjs';

const CI = '.github/workflows/ci.yml';
const lireFichier = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
/** Des empreintes inventées, une par ensemble. */
const E = (graine) => Object.fromEntries(TOUS.map((id) => [id, createHash('sha256').update(`${graine}${id}`).digest('hex')]));
const EA = E('a');

/** Une attestation de livraison : garde et interface au seuil 2, un harnais du besoin dans la garde, les tests navigateur s'ils ont été demandés. */
function attestation({ navigateur = true, harnais = 'vert' } = {}) {
  const verts = [
    { ensemble: 'garde', empreinte: EA.garde, seuil: 2, par: 'pré-push', commit: A },
    { ensemble: 'interface', empreinte: EA.interface, seuil: 2, par: 'pré-push', commit: A },
    ...(navigateur ? [{ ensemble: 'navigateur', empreinte: EA.navigateur, seuil: 2, par: 'demande', commit: A }] : []),
    ...(harnais === 'vert' ? [{ ensemble: 'harnais', empreinte: EA.harnais, seuil: 4, par: 'pré-push', commit: A }] : []),
  ];
  return lireLAttestation(texteDeLAttestation({ branche: 'codage/999-essai', verts })).attestation;
}
const auReadyDe = (a, extra = {}) => couvertureAuReady({ arbre: A, empreintes: EA, verts: a.verts, harnais: ['packages/gardes/nouveau.test.mjs'], ...extra });

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
/** Les empreintes de tous les ensembles d'un arbre de ces chemins ; `change` : un chemin changé. */
const arbreDe = (chemins, change) => chemins.map((chemin) => ({ mode: '100644', objet: chemin === change ? 'changé' : 'base', chemin }));
/**
 * Les tests navigateur se sautent-ils quand seul `fichier` change depuis un `main` que la nuit a trouvé
 * vert ? (#307 : `main` ne les couvre plus de lui-même, la nuit si.)
 */
function navigateurSautéSiSeul(fichier) {
  const chemins = [...new Set([...LUS_PAR_LE_NAVIGATEUR, ...NON_LUS, fichier])];
  const main = { navigateur: empreinteDe('navigateur', arbreDe(chemins)) };
  const tête = { navigateur: empreinteDe('navigateur', arbreDe(chemins, fichier)) };
  const nuit = { ensemble: 'navigateur', empreinte: main.navigateur, seuil: 2, par: 'la nuit', commit: B };
  return couvre(couvertureAuReady({ arbre: A, empreintes: tête, verts: [nuit], main: { commit: B, empreintes: main } }), NAVIGATEUR).couvert;
}

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

describe('[niveau 4] #237, principe 10.1 · la CI ne saute que ce que la livraison a joué sur cet arbre', () => {
  test('sans attestation, ou pour un autre arbre, tout se joue', () => {
    const c = auReadyDe(attestation());
    assert.equal(couvre(null, NAVIGATEUR).couvert, false, 'sans attestation, les tests navigateur se jouent');
    assert.equal(couvre(c, { ...NAVIGATEUR, arbre: B }).couvert, false, "une attestation d'un autre arbre ne couvre rien");
    assert.equal(lireLAttestation('Attestation de livraison de l’arbre ' + A).attestation, undefined, "une attestation d'une autre forme ne se lit pas");
  });

  test('au Ready, le seuil 1 d’un ensemble qui n’est pas vert sur son empreinte se joue (#266, point 4)', () => {
    const c = auReadyDe(attestation());
    for (const d of ['packages/core', 'apps/relay', 'apps/hebergement']) assert.equal(couvre(c, SEUIL_1(d)).couvert, false, `${d} : jamais vert sur son empreinte, son seuil 1 se joue au Ready`);
    const ailleurs = couvertureAuReady({ arbre: A, empreintes: EA, verts: [{ ensemble: 'garde', empreinte: E('b').garde, seuil: 2, par: 'pré-push', commit: A }] });
    assert.equal(couvre(ailleurs, SEUIL_1('packages/gardes')).couvert, false, 'la garde verte sur une autre empreinte : son seuil 1 se joue');
  });

  test("les tests navigateur se jouent si la livraison ne les a pas joués verts sur cette empreinte", () => {
    assert.equal(couvre(auReadyDe(attestation({ navigateur: false })), NAVIGATEUR).couvert, false);
  });

  test('le harnais du besoin se rejoue s’il était rouge à la livraison, ou s’il n’en faisait pas partie', () => {
    assert.equal(couvre(auReadyDe(attestation({ harnais: 'rouge' })), HARNAIS).couvert, false, 'harnais rouge à la livraison : il se rejoue');
    assert.equal(couvre(auReadyDe(attestation()), { ...HARNAIS, cibles: ['autre.test.mjs'] }).couvert, false, "un fichier que l'attestation ne nomme pas se joue");
  });

  test('un paquet que la livraison n’a pas joué, un seuil plus haut, un appel nommé : tout se joue', () => {
    const c = auReadyDe(attestation());
    assert.equal(couvre(c, demande({ dossier: 'packages/core', seuil: 2 })).couvert, false, 'paquet non joué');
    assert.equal(couvre(c, demande({ dossier: 'apps/web', seuil: 3 })).couvert, false, 'seuil au-delà de 2');
    assert.equal(couvre(c, { ...HARNAIS, nomme: true }).couvert, false, 'appel nommé');
  });

  test('après la fusion, seul un ensemble trouvé vert au Ready saute ses tests', () => {
    const après = (tetes) => couvertureApresFusion({ arbre: A, empreintes: EA, tetes });
    assert.equal(couvre(après([]), SEUIL_1('packages/core')).couvert, false, 'aucune tête');
    assert.equal(couvre(après([{ sha: B, statut: 'success', empreintes: E('b') }]), SEUIL_1('packages/core')).couvert, false, 'tête verte, mais autres empreintes');
    for (const statut of ['failure', 'pending', null]) assert.equal(couvre(après([{ sha: B, statut, empreintes: EA }]), SEUIL_1('packages/core')).couvert, false, `statut ${statut}`);
    assert.equal(couvre(après([{ sha: B, statut: 'success', empreintes: EA }]), demande({ arbre: B, seuil: 1 })).couvert, false, 'fichier pour un autre arbre que celui extrait');
  });

  test('[niveau 1] le statut lu après la fusion est « Toute la CI sur ce commit », et lui seul', () => {
    assert.equal(etatDuStatut([{ context: 'autre', state: 'success' }]), null, 'un autre statut vert ne vaut pas le vert du Ready');
    assert.equal(etatDuStatut([{ context: 'autre', state: 'success' }, { context: 'Toute la CI sur ce commit', state: 'failure' }]), 'failure');
    assert.equal(etatDuStatut(null), null);
  });

  test('point 9 · une PR qui change l’interface, le cœur ou la racine hors *.md et .gitignore fait jouer les tests navigateur', () => {
    for (const f of LUS_PAR_LE_NAVIGATEUR) {
      assert.equal(lit('navigateur', f), true, `${f} : lu par les tests navigateur`);
      assert.equal(navigateurSautéSiSeul(f), false, `${f} : sans attestation, les tests navigateur ne se sautent pas`);
    }
    const r = readySur('interface-touchee', 'apps/web/src/App.svelte');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(couvre(r.couverture, { ...NAVIGATEUR, arbre: r.arbre }).couvert, false, `apps/web touché : la CI au Ready ne doit pas sauter les tests navigateur\n${r.stdout}`);
  });

  test('point 9, étendu à chaque ensemble (#266) · l’empreinte de main ne saute jamais le harnais du besoin, ni un autre arbre', () => {
    const c = couvertureAuReady({ arbre: A, empreintes: EA, main: { commit: B, empreintes: EA }, harnais: ['packages/gardes/nouveau.test.mjs'] });
    assert.equal(couvre(c, HARNAIS).couvert, false, 'le harnais du besoin se joue');
    assert.equal(couvre(c, { ...NAVIGATEUR, arbre: B }).couvert, false, 'pour un autre arbre, rien ne se saute');
    assert.equal(couvre(couvertureAuReady({ arbre: A, empreintes: EA, main: { commit: B, empreintes: E('b') } }), SEUIL_1('apps/web')).couvert, false, 'une interface changée depuis main se joue, seuil 1 compris');
  });

  test('témoin rouge · une règle qui prendrait tout `packages/` ou toute la racine sauterait les tests navigateur à tort', () => {
    const laxiste = (fichiers) => fichiers.every((f) => f.startsWith('packages/') || !f.includes('/') || NON_LUS.includes(f));
    assert.ok(LUS_PAR_LE_NAVIGATEUR.some((f) => laxiste([f])), 'témoin : cette règle devrait sauter un chemin lu par les tests navigateur');
    assert.ok(LUS_PAR_LE_NAVIGATEUR.every((f) => lit('navigateur', f)), 'la liste du point 9 ne le fait pas');
  });

  test('[niveau 1] au Ready, une branche qui ne contient pas le dernier main est à mettre à jour : échec, et rien d’écrit', () => {
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

  test('[niveau 1] au Ready, l’étape qui vérifie la branche et lit l’attestation bloque, avant toute étape de tests', () => {
    const liste = joués(auReady);
    const i = liste.findIndex(({ c }) => /attestation\.mjs ready\b/.test(c));
    assert.ok(i >= 0, `${CI} : au Ready, aucune étape ne lance \`attestation.mjs ready\` (points 2 et 3)`);
    assert.ok(!laisseÉchouer(liste[i].job, liste[i].é), `${CI} : l'étape de la branche à jour ne doit pas se laisser échouer (point 2)`);
    const avant = liste.findIndex(({ job, c }) => job === liste[i].job && deTests(c));
    assert.ok(avant > i, `${CI} : au Ready, une étape de tests passe avant la vérification de la branche (point 2)`);
    const seuil1 = liste.filter(({ c }) => /\bpnpm test 1\b/.test(c));
    assert.ok(seuil1.length, `${CI} : au Ready, le seuil 1 ne se joue plus ; le test est à relire`);
    for (const { job, é } of seuil1) assert.ok(!laisseÉchouer(job, é), `${CI} : au Ready, le seuil 1 ne doit pas se laisser échouer`);
  });

  test('au tag v*, rien ne se saute : aucune étape ne lit d’attestation', () => {
    const liste = joués(auTag);
    assert.ok(liste.some(({ c }) => /\bpnpm test 3\b/.test(c)), `${CI} : au tag v*, le seuil 3 ne se joue plus ; le test est à relire`);
    const lisent = liste.filter(({ c }) => /attestation/.test(c)).map(({ é }) => é.lignes[0].trim());
    assert.deepEqual(lisent, [], `${CI} : au tag v*, une étape lit une attestation (point 5)`);
  });

  test('témoin rouge · une couverture qui ignorerait l’arbre, le seuil ou l’ensemble ferait rougir ces tests', () => {
    const c = auReadyDe(attestation({ navigateur: false }));
    const laxiste = (cc, d) => ({ couvert: Object.keys(cc.ensembles).some((id) => (d.dossier === 'apps/web' ? ['interface', 'navigateur'] : ['garde']).includes(id)) });
    assert.equal(laxiste(c, NAVIGATEUR).couvert, true, 'témoin : une décision qui ne regarde que le paquet sauterait les tests navigateur non joués');
    assert.equal(laxiste(c, { ...NAVIGATEUR, arbre: B }).couvert, true, "témoin : et ceux d'un autre arbre");
    assert.equal(laxiste(c, demande({ dossier: 'apps/web', seuil: 3 })).couvert, true, 'témoin : et l’interface au seuil 3, verte au seuil 2 seulement');
    assert.equal(couvre(c, NAVIGATEUR).couvert, false, 'la décision de #266 les joue');
    assert.equal(couvre(c, demande({ dossier: 'apps/web', seuil: 3 })).couvert, false);
  });
});

describe('[niveau 4] #237 · la livraison atteste, la CI saute ce qui est couvert', () => {
  test('ce que l’attestation couvre se saute : tests navigateur demandés, harnais vert, paquet joué au seuil 2', () => {
    const c = auReadyDe(attestation());
    assert.equal(couvre(c, NAVIGATEUR).couvert, true, 'les tests navigateur joués verts sur la même empreinte se sautent');
    assert.equal(couvre(c, HARNAIS).couvert, true, 'le harnais du besoin vert se saute');
    assert.equal(couvre(c, demande({ seuil: 2 })).couvert, true, 'la garde jouée au seuil 2 se saute au seuil 2');
    for (const d of ['packages/gardes', 'apps/web']) assert.equal(couvre(c, SEUIL_1(d)).couvert, true, `${d} : vert au seuil 2 sur son empreinte, son seuil 1 se saute au Ready (#266, point 4)`);
    assert.equal(couvre(couvertureApresFusion({ arbre: A, empreintes: EA, tetes: [{ sha: B, statut: 'success', empreintes: EA }] }), SEUIL_1('packages/core')).couvert, true, 'sur main, un ensemble vert au Ready sur la même empreinte se saute');
  });

  test('[niveau 3] point 9 · une PR qui ne change que des chemins que les tests navigateur ne lisent pas, ou la garde, les saute sans attestation', () => {
    for (const f of NON_LUS) assert.equal(navigateurSautéSiSeul(f), true, `${f} : les tests navigateur se sautent`);
    const r = readySur('docs-seuls', 'docs/decisions.md');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // #307 : au Ready, la non-régression dans le navigateur ne se joue plus, elle se joue la nuit.
    assert.match(r.stdout, /interface dans le navigateur : non-régression non jouée — les tests navigateur de non-régression se jouent la nuit/, `docs seuls : la CI au Ready le dit\n${r.stdout}`);
  });

  test('les cibles d’un lancement : ses arguments, hors options et valeurs d’options', () => {
    assert.deepEqual(ciblesDesArguments(['--reporter=json', '--exclude', 'x.test.ts', 'test/navigateur/', './a.test.mjs']), ['test/navigateur', 'a.test.mjs']);
  });

  test('en CI, chaque lancement des tests reçoit le fichier des empreintes, seuil 1 du Ready compris (#266)', () => {
    for (const [nom, ctx] of [['au Ready', auReady], ['sur main', surMain]]) {
      const tests = joués(ctx).filter(({ c }) => deTests(c));
      assert.ok(tests.length, `${CI} : ${nom}, aucune étape de tests`);
      for (const { é, c } of tests) assert.match(c, /--attestation\s+\S/, `${CI} : ${nom}, « ${é.lignes[0].trim()} » ne passe pas l'attestation (point 6)`);
    }
    assert.ok(joués(surMain).some(({ c }) => /attestation\.mjs apres-fusion\b/.test(c)), `${CI} : sur main, aucune étape ne cherche les empreintes vertes au Ready (point 4)`);
  });

  test('une livraison verte atteste les empreintes, l’envoie avec le push, et la CI saute ce qu’elle couvre', () => {
    // Un dépôt tel que la copie de travail le porte, sans ses tests, et son dépôt distant.
    const dépôt = join(temporaire(), 'depot');
    const distant = join(temporaire(), 'distant.git');
    const env = environnement();
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

    // La livraison, comme le pré-push la lance, avec le dépôt distant.
    const l = spawnSync('sh', ['.githooks/livraison.sh', 'push', `refs/heads/${BRANCHE}`, sha, `refs/heads/${BRANCHE}`, '0'.repeat(40), 'origin'], { cwd: dépôt, env, encoding: 'utf8' });
    assert.equal(l.status, 0, `livraison refusée\n${l.stdout}${l.stderr}`);
    const porte = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/heads/${BRANCHE}--attestation`], { cwd: distant, env, encoding: 'utf8' }).stdout.trim();
    assert.ok(porte, `aucune attestation envoyée sur ${BRANCHE}--attestation (point 1)\n${l.stdout}${l.stderr}`);
    const { attestation: a } = lireLAttestation(git(distant, 'log', '-1', '--format=%B', porte));
    assert.ok(a, "l'attestation envoyée se lit");
    assert.deepEqual(
      a.verts.map((v) => `${v.ensemble}:${v.seuil}`).sort(),
      ['garde:2', 'harnais:4', 'hebergement:2'],
      `la garde et l'hébergement, que retient un besoin organisationnel (#314), joués au seuil 2, et le harnais du besoin vert, en entier (point 1)\n${l.stdout}`,
    );

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
    const pnpmTest = (...args) => {
      writeFileSync(témoin, '');
      const p = spawnSync('pnpm', ['--dir', join(ci, 'packages/gardes'), 'run', 'test', ...args], { cwd: ci, env: { ...env, TEMOIN_237: témoin }, encoding: 'utf8' });
      return { ...p, notés: readFileSync(témoin, 'utf8').split('\n').filter(Boolean) };
    };
    const harnais = pnpmTest('4', '--navigateur', '--attestation', fichier, 'nouveau.test.mjs');
    assert.equal(harnais.status, 0, harnais.stdout + harnais.stderr);
    assert.deepEqual(harnais.notés, [], `le harnais du besoin, vert à la livraison, se saute\n${r.stdout}\n${harnais.stdout}`);
    assert.match(harnais.stdout, /attestation : sauté/, 'le lanceur dit ce qu’il saute et pourquoi (point 3)');
    const seuil1 = pnpmTest('1', '--attestation', fichier);
    assert.equal(seuil1.status, 0, seuil1.stdout + seuil1.stderr);
    assert.deepEqual(seuil1.notés, [], `la garde, verte au seuil 2 sur son empreinte, ne rejoue pas son seuil 1 au Ready (#266, point 4)\n${seuil1.stdout}`);
    assert.match(seuil1.stdout, /attestation : sauté, seuil 1/, 'et le lanceur le dit');
  });
});
