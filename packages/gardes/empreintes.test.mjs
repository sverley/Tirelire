/**
 * Tests de #266 : chaque ensemble de tests a son empreinte, et rien ne se rejoue sur du code inchangé
 * (D83). Le travail conservé de #264 (`927a4ae`) en est le départ.
 *
 * **Au niveau 1** — principe 10.1 et D83 (« aucun job sauté ne peut laisser fusionner ce qu'un job
 * joué aurait rougi ») : l'empreinte de chaque ensemble change avec tout fichier qu'il lit, un chemin
 * oublié de la liste compris (point 1) ; un ensemble ne se saute que vert sur la même empreinte, à un
 * seuil au moins égal (point 2) ; un ensemble rouge, ou dont un test s'est sauté faute d'outil, n'est
 * pas vert (point 3) ; au Ready, sur `main` et au tag, rien ne se saute hors d'une empreinte verte à un
 * seuil au moins égal, et au tag, aucune ne l'est au seuil 3 (point 4).
 *
 * **Au niveau 2** — le cas nominal, dont l'échec ne coûterait que du temps : ce qui a tourné vert ne se
 * rejoue pas — au crochet suivant, dans une autre session, au Ready, seuil 1 compris, sur `main` ;
 * une empreinte verte se garde d'un push à l'autre ; les tests navigateur demandés et joués verts ne
 * se rejouent pas en CI sur la même empreinte (points 2, 4 à 6).
 *
 * **Au niveau 3** — le dégradé : ce que chaque moment dit, pour chaque ensemble (point 7).
 *
 * Les livraisons se jouent dans un petit dépôt factice, avec les crochets et la garde du dépôt.
 * `node:test` n'a pas de `test.fails` : l'échec attendu d'un témoin tient dans une assertion
 * (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
  ENSEMBLES,
  HARNAIS,
  SANS_DEMANDE,
  SEUIL_DE_MAIN,
  TOUS,
  couvertureApresFusion,
  couvertureAuReady,
  couvre,
  empreinteDe,
  empreinteDuHarnais,
  empreintes,
  ensemblesDeLaDemande,
  fusionner,
  lireLAttestation,
  lit,
  nomDe,
  planifier,
  resume,
  texteDeLAttestation,
  verdictDuLancement,
} from './attestation.mjs';
import { RACINE } from './gardes.mjs';
import { commande, jouer } from './workflow-a-blanc.mjs';

const lireFichier = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');
const CI = '.github/workflows/ci.yml';
const ATTESTATION_MJS = join(RACINE, '.githooks/attestation.mjs');

// ─── Des arbres inventés ────────────────────────────────────────────────────────────────────────

/** Les chemins du dépôt, sans git : l'extraction de la livraison n'a pas de `.git`. */
function cheminsDuDepot() {
  const liste = [];
  const parcourir = (rel) => {
    for (const e of readdirSync(join(RACINE, rel), { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'build', '.gradle'].includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) parcourir(r);
      else liste.push(r);
    }
  };
  parcourir('');
  return liste;
}

/** Des entrées d'arbre pour ces chemins ; `versions` change l'objet d'un chemin. */
const entrees = (chemins, versions = {}) => chemins.map((chemin) => ({ mode: '100644', objet: `${chemin}#${versions[chemin] ?? 0}`, chemin }));

/** Des chemins qui représentent chaque partie du dépôt. */
const TYPES = [
  'package.json', 'pnpm-lock.yaml', 'tsconfig.base.json', 'README.md', '.gitignore', 'nouveau/fichier.txt',
  'docs/decisions.md', 'docs/gardes.md', '.github/workflows/ci.yml', '.githooks/livraison.sh',
  'packages/gardes/lanceur.mjs', 'packages/gardes/gardes.mjs', 'packages/gardes/gardes.test.mjs', 'packages/gardes/dev/outil.dev.mjs',
  'packages/core/src/plan.ts', 'packages/core/test/plan.test.ts', 'packages/core/package.json',
  'apps/relay/server.mjs', 'apps/relay/README.md', 'apps/hebergement/apercu.sh', 'apps/hebergement/serveur/relais.php',
  'apps/web/src/App.svelte', 'apps/web/index.html', 'apps/web/package.json', 'apps/web/vitest.config.ts', 'apps/web/vite.config.ts',
  'apps/web/test/harnais.ts', 'apps/web/test/stockage.test.ts', 'apps/web/test/navigateur/acces.test.ts',
];

/** Ce que chaque ensemble lit, et ce qu'il ne lit pas, parmi `TYPES` (point 1). */
const RACINE_LUE = ['package.json', 'pnpm-lock.yaml', 'tsconfig.base.json', 'nouveau/fichier.txt'];
const LANCEUR = ['packages/gardes/lanceur.mjs', 'packages/gardes/gardes.mjs'];
const LUS = {
  garde: TYPES,
  coeur: [...RACINE_LUE, ...LANCEUR, 'packages/core/src/plan.ts', 'packages/core/test/plan.test.ts', 'packages/core/package.json'],
  relais: [...RACINE_LUE, ...LANCEUR, 'apps/relay/server.mjs'],
  hebergement: TYPES,
  interface: [...RACINE_LUE, ...LANCEUR, 'docs/decisions.md', 'packages/core/src/plan.ts', 'apps/web/src/App.svelte', 'apps/web/vitest.config.ts', 'apps/web/test/harnais.ts', 'apps/web/test/stockage.test.ts'],
  navigateur: [...RACINE_LUE, 'packages/core/src/plan.ts', 'apps/web/src/App.svelte', 'apps/web/vite.config.ts', 'apps/web/test/harnais.ts', 'apps/web/test/navigateur/acces.test.ts'],
};
const NON_LUS = {
  garde: [],
  coeur: ['docs/decisions.md', 'README.md', '.github/workflows/ci.yml', '.githooks/livraison.sh', 'apps/web/src/App.svelte', 'apps/relay/server.mjs', 'packages/gardes/gardes.test.mjs', 'packages/gardes/dev/outil.dev.mjs'],
  relais: ['docs/decisions.md', 'apps/relay/README.md', 'packages/core/src/plan.ts', 'apps/web/src/App.svelte', 'apps/hebergement/apercu.sh', 'packages/gardes/gardes.test.mjs'],
  hebergement: [],
  interface: ['docs/gardes.md', 'README.md', '.gitignore', '.github/workflows/ci.yml', 'apps/relay/server.mjs', 'apps/hebergement/serveur/relais.php', 'apps/web/test/navigateur/acces.test.ts', 'packages/gardes/gardes.test.mjs'],
  // La liste du point 9 de #237.
  navigateur: ['docs/decisions.md', '.github/workflows/ci.yml', '.githooks/livraison.sh', 'packages/gardes/lanceur.mjs', 'apps/hebergement/apercu.sh', 'apps/relay/server.mjs', 'README.md', 'apps/relay/README.md', '.gitignore'],
};

const change = (id, chemins, chemin) => empreinteDe(id, entrees(chemins)) !== empreinteDe(id, entrees(chemins, { [chemin]: 1 }));

const E = (graine) => Object.fromEntries(TOUS.map((id) => [id, createHash('sha256').update(`${graine}${id}`).digest('hex')]));
const vert = (ensemble, empreinte, seuil, extra = {}) => ({ ensemble, empreinte, seuil, par: 'pré-push', commit: 'c'.repeat(40), date: '2026-09-28T00:00:00Z', ...extra });
const A = 'f'.repeat(40);
const demande = (dossier, extra = {}) => ({ arbre: A, dossier, seuil: 1, navigateur: false, cibles: [], nomme: false, ...extra });
const NAVIGATEUR = demande('apps/web', { seuil: 2, navigateur: true, cibles: ['test/navigateur'] });
const PAQUETS = ['packages/gardes', 'packages/core', 'apps/relay', 'apps/hebergement', 'apps/web'];

let dossierTemporaire;
const temporaire = () => (dossierTemporaire ??= mkdtempSync(join(tmpdir(), 'empreintes-266-')));
after(() => {
  if (dossierTemporaire) rmSync(dossierTemporaire, { recursive: true, force: true });
});

function environnement(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'NODE_TEST_CONTEXT' || k.startsWith('VITEST') || k.startsWith('GIT_') || k === 'TIRELIRE_SEUIL' || k === 'TIRELIRE_STRICT') delete env[k];
  return { ...env, GIT_AUTHOR_NAME: 'Tests 266', GIT_AUTHOR_EMAIL: 'tests@exemple.invalid', GIT_COMMITTER_NAME: 'Tests 266', GIT_COMMITTER_EMAIL: 'tests@exemple.invalid', ...extra };
}
const gitDans = (cwd, env = environnement()) => (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd, env, encoding: 'utf8' }).trim();

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

/** Un bilan de crochet sur des journaux inventés : rend l'attestation locale écrite, et ce qui a été dit. */
function bilanSur(nom, lancements, seuil = 2) {
  const dépôt = join(temporaire(), nom);
  const journaux = join(dépôt, 'journaux');
  mkdirSync(journaux, { recursive: true });
  const git = gitDans(dépôt);
  git('init', '-q', '-b', 'main');
  const e = E(nom);
  const ids = Object.keys(lancements);
  writeFileSync(join(dépôt, 'plan'), `${ids.map((id) => `${id}\t1\t${seuil}\t${e[id]}\t`).join('\n')}\n`);
  writeFileSync(join(journaux, 'lances'), `${ids.map((id) => `${id}\t${id}\t${lancements[id].sorte}`).join('\n')}\n`);
  for (const [id, { code, journal = '', rapport }] of Object.entries(lancements)) {
    writeFileSync(join(journaux, `${id}.code`), `${code}\n`);
    writeFileSync(join(journaux, `${id}.log`), journal);
    if (rapport) writeFileSync(join(journaux, `${id}.rapport`), JSON.stringify(rapport));
  }
  writeFileSync(join(dépôt, 'verts'), '[]');
  const dit = execFileSync('node', [ATTESTATION_MJS, 'bilan', join(dépôt, 'plan'), journaux, 'pré-push', 'a'.repeat(40), 'b'.repeat(40), 'codage/999-bilan', join(dépôt, 'verts'), '--enregistrer'], { cwd: dépôt, env: environnement(), encoding: 'utf8' });
  return { e, dit, attestation: lireLAttestation(git('log', '-1', '--format=%B', 'refs/attestations/codage/999-bilan')).attestation };
}
/** Un rapport vitest : `[ancêtres, titre, statut]` par test. */
const rapportVitest = (tests) => ({ testResults: [{ assertionResults: tests.map(([ancestorTitles, title, status]) => ({ ancestorTitles, title, status })) }] });

// La CI jouée à blanc.
const PR = { number: 1, draft: false, head: { ref: 'codage/1-x', sha: 'a'.repeat(40) } };
const AU_READY = { github: { event_name: 'pull_request', ref: 'refs/pull/1/merge', repository: 'sverley/Tirelire', head_ref: 'codage/1-x', event: { action: 'ready_for_review', pull_request: PR } }, vars: {}, secrets: {}, inputs: {} };
const SUR_MAIN = { github: { event_name: 'push', ref: 'refs/heads/main', repository: 'sverley/Tirelire', event: {} }, vars: {}, secrets: {}, inputs: {} };
const AU_TAG = { github: { event_name: 'push', ref: 'refs/tags/v1.0.0', repository: 'sverley/Tirelire', event: {} }, vars: {}, secrets: {}, inputs: {} };
const lancementsDeTests = (ctx) =>
  jouer(lireFichier(CI), ctx)
    .find((j) => j.nom === 'test')
    .joués.map(commande)
    .flatMap((c) => c.split('\n'))
    .filter((l) => /\bpnpm\b.*\btest\b|harnais-du-besoin\.sh --jouer/.test(l));

// ─── Niveau 1 ───────────────────────────────────────────────────────────────────────────────────

describe('[niveau 1] #266, principe 10.1 · un ensemble ne se saute que vert sur la même empreinte', () => {
  test('point 1 · chaque ensemble a une empreinte, que change tout fichier qu’il lit, et tout fichier qu’aucune liste n’écarte', () => {
    for (const { id } of ENSEMBLES) {
      for (const f of LUS[id]) assert.ok(change(id, TYPES, f), `${id} : ${f} est lu, son changement doit changer l'empreinte`);
      for (const f of NON_LUS[id]) assert.ok(!change(id, TYPES, f), `${id} : ${f} n'est pas lu, son changement ne doit pas changer l'empreinte`);
    }
    // Sur le dépôt lui-même : tout fichier que la liste n'écarte pas change l'empreinte, un fichier
    // ajouté aussi ; un fichier écarté ne la change pas.
    const depot = [...cheminsDuDepot(), 'un/chemin/que/personne/ne/connait.bin'];
    for (const { id } of ENSEMBLES) {
      for (const f of depot) assert.equal(change(id, depot, f), lit(id, f), `${id} : ${f} ${lit(id, f) ? 'est lu mais ne change pas' : "n'est pas lu mais change"} l'empreinte`);
      assert.notEqual(empreinteDe(id, entrees(depot)), empreinteDe(id, entrees([...depot, 'encore/un.txt'])), `${id} : un fichier ajouté hors des listes doit changer l'empreinte`);
      for (const f of ['pnpm-lock.yaml', 'package.json']) assert.ok(lit(id, f), `${id} : ${f} est lu par tous`);
    }
    for (const id of ['interface', 'navigateur']) assert.ok(lit(id, 'packages/core/src/plan.ts'), `${id} : le cœur est lu par l'interface`);
  });

  test('point 1 · chaque chemin écarté l’est avec sa raison ; la liste des tests navigateur est celle du point 9 de #237', () => {
    for (const e of ENSEMBLES) {
      for (const { motifs, raison } of e.ecartes) {
        assert.ok(motifs.length, `${e.id} : un écart sans motif`);
        assert.ok(String(raison ?? '').trim().length > 20, `${e.id} : ${motifs.join(', ')} écarté(s) sans raison dite`);
      }
    }
    const navigateur = ENSEMBLES.find((e) => e.id === 'navigateur').ecartes.flatMap((x) => x.motifs).sort();
    assert.deepEqual(navigateur, ['*.md', '.github/', '.githooks/', '.gitignore', 'apps/hebergement/', 'apps/relay/', 'docs/', 'packages/gardes/'].sort(), 'la liste du point 9 de #237, telle quelle');
  });

  test('point 1 · le harnais du besoin : ses fichiers, et ce que lit l’ensemble de leur paquet', () => {
    const f = ['packages/gardes/nouveau.test.mjs'];
    const base = entrees([...TYPES, ...f]);
    const h = empreinteDuHarnais(f, base);
    assert.equal(empreinteDuHarnais([], base), null, 'sans harnais, pas d’empreinte');
    assert.notEqual(empreinteDuHarnais(f, entrees([...TYPES, ...f], { 'packages/gardes/nouveau.test.mjs': 1 })), h, 'le fichier du harnais changé change son empreinte');
    assert.notEqual(empreinteDuHarnais(f, entrees([...TYPES, ...f], { 'docs/decisions.md': 1 })), h, 'ce que lit la garde changé change l’empreinte d’un harnais de la garde');
    assert.notEqual(empreinteDuHarnais([...f, 'packages/gardes/autre.test.mjs'], entrees([...TYPES, ...f, 'packages/gardes/autre.test.mjs'])), h, 'un fichier de plus change l’empreinte');
    const web = ['apps/web/test/navigateur/besoin.test.ts'];
    const hw = empreinteDuHarnais(web, entrees([...TYPES, ...web]));
    assert.notEqual(empreinteDuHarnais(web, entrees([...TYPES, ...web], { 'packages/core/src/plan.ts': 1 })), hw, 'un harnais dans le navigateur lit le cœur');
  });

  test('point 2 · une empreinte jamais trouvée verte, ou seulement à un seuil plus bas, se joue ; celle de main ne saute jamais le harnais', () => {
    const e = E('a');
    const plan = (verts, references = []) => Object.fromEntries(planifier({ empreintes: e, seuil: 2, verts, references, harnais: ['packages/gardes/h.test.mjs'] }).map((p) => [p.id, p.jouer]));
    for (const id of ['garde', 'coeur', 'relais', 'hebergement', 'interface', 'harnais']) {
      assert.equal(plan([])[id], true, `${id} : jamais vert, il se joue`);
      assert.equal(plan([vert(id, e[id], id === 'harnais' ? 3 : 1)])[id], true, `${id} : vert à un seuil plus bas, il se joue`);
      assert.equal(plan([vert(id, E('b')[id], 4)])[id], true, `${id} : vert sur une autre empreinte, il se joue`);
      assert.equal(plan([vert(id === 'coeur' ? 'interface' : 'coeur', e[id], 4)])[id], true, `${id} : l'empreinte verte d'un autre ensemble ne compte pas`);
      assert.equal(plan([], [{ empreintes: e, seuil: 1, raison: 'main' }])[id], true, `${id} : une référence qui ne couvre que le seuil 1 ne saute pas le seuil 2`);
    }
    assert.equal(plan([], [{ empreintes: e, seuil: SEUIL_DE_MAIN, raison: 'main' }]).harnais, true, "le harnais du besoin ne se saute jamais sur l'empreinte de main");
    const navigateur = planifier({ empreintes: e, seuil: 2, navigateur: true, verts: [vert('navigateur', e.navigateur, 1)] }).find((p) => p.id === 'navigateur');
    assert.equal(navigateur.jouer, true, 'tests navigateur demandés, verts au seuil 1 seulement : ils se jouent');
  });

  test('point 3 · un ensemble rouge, ou dont un test s’est sauté faute d’outil, n’est pas compté vert', () => {
    const { e, dit, attestation } = bilanSur('bilan', {
      garde: { sorte: 'node', code: 0, journal: 'ok 1 - a\nseuil 2 : 0 test(s) écarté(s), de niveau supérieur à 2.\n' },
      coeur: { sorte: 'vitest', code: 1, journal: 'FAIL\n', rapport: rapportVitest([[[], 'b', 'failed']]) },
      relais: { sorte: 'node', code: 0, journal: 'ok 1 - c # SKIP php absent\n' },
      hebergement: { sorte: 'vitest', code: 0, rapport: rapportVitest([[[], 'd [niveau 1]', 'passed'], [['suite [niveau 3]'], 'écarté par le seuil', 'skipped']]) },
      interface: { sorte: 'vitest', code: 0, rapport: rapportVitest([[[], 'e', 'passed'], [['I7 [niveau 1]'], 'sans navigateur', 'skipped']]) },
      navigateur: { sorte: 'vitest', code: 0, journal: 'ok\n' },
    });
    assert.ok(attestation, `aucune attestation écrite\n${dit}`);
    assert.deepEqual(attestation.verts.map((v) => v.ensemble).sort(), ['garde', 'hebergement'], `seuls les ensembles verts, sans test sauté faute d'outil, entrent dans l'attestation\n${dit}`);
    assert.ok(attestation.verts.every((v) => v.empreinte === e[v.ensemble] && v.seuil === 2), 'chacun sur son empreinte, au seuil joué');
  });

  test('point 3 · un test sauté faute d’outil se reconnaît, sous vitest comme sous node:test ; un test écarté par le seuil non', () => {
    const v = (tests, seuil = 2) => verdictDuLancement({ code: '0', sorte: 'vitest', rapport: rapportVitest(tests), seuil }).etat;
    assert.equal(v([[['suite [niveau 1]'], 'navigateur absent', 'skipped']]), 'sauté', 'sauté au niveau 1, sous le seuil 2');
    assert.equal(v([[['suite'], 'sans marque', 'skipped']]), 'sauté', 'sans marque, de niveau 2 : sauté sous le seuil 2');
    assert.equal(v([[['suite [niveau 3]'], 'écarté', 'skipped'], [[], 'x', 'passed']]), 'vert', 'un test de niveau 3 écarté par le seuil 2 ne compte pas');
    assert.equal(v([[['suite [niveau 3]'], 'navigateur absent', 'skipped']], 4), 'sauté', 'au seuil 4, tout test sauté compte');
    assert.equal(verdictDuLancement({ code: '0', sorte: 'vitest', rapport: null, seuil: 2 }).etat, 'illisible', 'sans rapport lisible, pas de vert');
    assert.equal(verdictDuLancement({ code: '0', sorte: 'node', journal: 'ok 1 - relais PHP # SKIP php absent\n', seuil: 2 }).etat, 'sauté');
    assert.equal(verdictDuLancement({ code: '0', sorte: 'node', journal: 'ok 1 - relais PHP\n# skipped 0\n', seuil: 2 }).etat, 'vert', 'le compte « # skipped 0 » du TAP n’est pas un test sauté');
    assert.equal(verdictDuLancement({ code: '1', sorte: 'node', journal: 'ok 1\n', seuil: 2 }).etat, 'rouge');
  });

  test('point 4 · au Ready, seuil 1 compris, un ensemble ne se saute que vert sur son empreinte à un seuil au moins égal', () => {
    const e = E('r');
    const aucun = couvertureAuReady({ arbre: A, empreintes: e, main: { commit: 'd'.repeat(40), empreintes: E('m') } });
    for (const d of PAQUETS) assert.equal(couvre(aucun, demande(d)).couvert, false, `${d} : jamais vert, changé depuis main, son seuil 1 se joue`);
    const auSeuil0 = couvertureAuReady({ arbre: A, empreintes: e, verts: ENSEMBLES.map((x) => vert(x.id, e[x.id], 0)) });
    for (const d of PAQUETS) assert.equal(couvre(auSeuil0, demande(d)).couvert, false, `${d} : vert au seuil 0 seulement, son seuil 1 se joue`);
    const tête = couvertureAuReady({ arbre: A, empreintes: e, tetes: [{ sha: 't'.repeat(40), statut: 'pending', empreintes: e }] });
    for (const d of PAQUETS) assert.equal(couvre(tête, demande(d)).couvert, false, `${d} : une tête dont la CI n'a pas fini verte ne couvre rien`);
    assert.equal(couvre(couvertureAuReady({ arbre: A, empreintes: e, verts: [vert('navigateur', e.navigateur, 2)] }), { ...NAVIGATEUR, arbre: 'e'.repeat(40) }).couvert, false, 'pour un autre arbre, rien ne se saute');
  });

  test('point 4 · sur main, un ensemble ne se saute que sur l’empreinte d’une tête verte au Ready ou du premier parent', () => {
    const e = E('m');
    const sans = couvertureApresFusion({ arbre: A, empreintes: e, tetes: [{ sha: 't'.repeat(40), statut: 'failure', empreintes: e }], parent: { commit: 'p'.repeat(40), empreintes: E('x') } });
    for (const d of PAQUETS) assert.equal(couvre(sans, demande(d)).couvert, false, `${d} : tête rouge au Ready, premier parent différent : il se joue`);
    const tete = couvertureApresFusion({ arbre: A, empreintes: e, tetes: [{ sha: 't'.repeat(40), statut: 'success', empreintes: { ...E('x'), coeur: e.coeur } }] });
    assert.equal(couvre(tete, demande('apps/web')).couvert, false, 'interface sur une autre empreinte que la tête verte : jouée');
    assert.equal(couvre(tete, demande('packages/core', { seuil: 2 })).couvert, false, 'une tête verte au Ready ne couvre le cœur qu’au seuil 1');
    assert.equal(sans.ensembles.harnais, undefined, 'le harnais du besoin ne se joue pas sur main : rien à sauter');
  });

  test('point 4 · au tag, rien ne se saute : aucune empreinte verte n’atteint le seuil 3', () => {
    const e = E('t');
    const tout = couvertureAuReady({ arbre: A, empreintes: e, verts: TOUS.map((id) => vert(id, e[id], 2)), tetes: [{ sha: 't'.repeat(40), statut: 'success', empreintes: e }], main: { commit: 'm'.repeat(40), empreintes: e } });
    for (const d of PAQUETS) assert.equal(couvre(tout, demande(d, { seuil: 3, navigateur: true })).couvert, false, `${d} : vert au seuil 2 au plus, le seuil 3 se joue`);
    assert.ok(SEUIL_DE_MAIN < 3, "l'empreinte de main ne compte verte qu'en deçà du seuil du tag");
    const l = lancementsDeTests(AU_TAG);
    assert.ok(l.some((c) => /\bpnpm test 3\b/.test(c)), `au tag, le seuil 3 se joue\n${l.join('\n')}`);
    assert.ok(l.some((c) => /\btest 3 --navigateur\b.*test\/navigateur/.test(c)), `au tag, les tests navigateur se jouent au seuil 3\n${l.join('\n')}`);
    for (const c of l) assert.doesNotMatch(c, /--attestation/, `au tag, aucun lancement ne lit d’empreintes : « ${c.trim()} »`);
  });

  test('témoin rouge · une empreinte du seul paquet, une décision sans seuil ou un verdict sans les tests sautés feraient rougir ces tests', () => {
    const duPaquet = (id, chemin) => chemin.startsWith(`${ENSEMBLES.find((x) => x.id === id).dossier}/`);
    assert.ok(Object.entries(LUS).some(([id, fs]) => fs.some((f) => !duPaquet(id, f))), 'témoin : une empreinte du seul paquet laisserait passer un fichier lu ailleurs (pnpm-lock.yaml, le cœur pour l’interface)');
    const laxiste = (verts, id, empreinte) => verts.some((v) => v.ensemble === id && v.empreinte === empreinte);
    const e = E('t');
    assert.equal(laxiste([vert('coeur', e.coeur, 0)], 'coeur', e.coeur), true, 'témoin : une décision sans seuil sauterait le cœur vert au seuil 0 seulement');
    assert.equal(planifier({ empreintes: e, seuil: 2, verts: [vert('coeur', e.coeur, 0)] }).find((p) => p.id === 'coeur').jouer, true, 'la décision de #266 le joue');
    const verdictLaxiste = (code) => (String(code) === '0' ? 'vert' : 'rouge');
    assert.equal(verdictLaxiste(0), 'vert', 'témoin : un verdict qui ne lirait que le code de sortie compterait vert un test sauté faute d’outil');
    assert.equal(verdictDuLancement({ code: '0', sorte: 'node', journal: 'ok 1 - x # SKIP outil absent\n', seuil: 2 }).etat, 'sauté', 'le verdict de #266 le lit');
  });
});

// ─── Niveau 2 : ce qui a tourné ne se rejoue pas ───────────────────────────────────────────────

/**
 * Un petit dépôt, tel que la livraison le juge : les crochets et la garde du dépôt, un cœur et une
 * garde en `node --test`, une interface en vitest avec un test navigateur ; chaque test et chaque
 * typecheck note son passage dans le fichier `TEMOIN_266`. Rend ses commandes.
 */
function dépôtFactice(nom) {
  const dépôt = join(temporaire(), nom);
  const distant = join(temporaire(), `${nom}.git`);
  const témoin = join(temporaire(), `${nom}.temoin`);
  writeFileSync(témoin, '');
  for (const f of readdirSync(join(RACINE, '.githooks'))) cpSync(join(RACINE, '.githooks', f), join(dépôt, '.githooks', f));
  for (const f of readdirSync(join(RACINE, 'packages/gardes'))) if (/\.mjs$|^package\.json$/.test(f) && !/\.test\.mjs$/.test(f)) cpSync(join(RACINE, 'packages/gardes', f), join(dépôt, 'packages/gardes', f));
  const écrire = (f, texte) => {
    mkdirSync(dirname(join(dépôt, f)), { recursive: true });
    writeFileSync(join(dépôt, f), texte);
  };
  const note = (quoi) => `import { appendFileSync, readFileSync } from 'node:fs';\nconst note = () => appendFileSync(process.env.TEMOIN_266, ${JSON.stringify(quoi)} + ' ' + (performance.timeOrigin + performance.now()) + '\\n');\n`;
  écrire('typecheck.mjs', "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.TEMOIN_266, `typecheck-${process.argv[2]} ${performance.timeOrigin + performance.now()}\\n`);\n");
  écrire('packages/gardes/package.json', JSON.stringify({ name: 'f-gardes', private: true, type: 'module', scripts: { test: 'node ./lanceur.mjs node --test', typecheck: 'node ../../typecheck.mjs garde' } }));
  écrire('packages/gardes/g.test.mjs', `${note('garde')}import { test } from 'node:test';\ntest('g [niveau 0]', note);\n`);
  écrire('packages/core/package.json', JSON.stringify({ name: 'f-core', private: true, type: 'module', scripts: { test: 'node ../gardes/lanceur.mjs node --test', typecheck: 'node ../../typecheck.mjs coeur' } }));
  écrire('packages/core/lib.mjs', 'export const un = 1;\n');
  écrire('packages/core/c.test.mjs', `${note('coeur')}import { test } from 'node:test';\ntest('c [niveau 1]', note);\n`);
  écrire('apps/web/package.json', JSON.stringify({ name: 'f-web', private: true, type: 'module', scripts: { test: 'node ../../packages/gardes/lanceur.mjs vitest run', typecheck: 'node ../../typecheck.mjs web' } }));
  écrire('apps/web/etat.txt', 'vert\n');
  écrire('apps/web/test/w.test.mjs', `${note('interface')}import { test } from 'vitest';\ntest('w [niveau 1]', () => { note(); if (readFileSync(new URL('../etat.txt', import.meta.url), 'utf8').trim() === 'rouge') throw new Error('rouge'); });\n`);
  écrire('apps/web/test/navigateur/n.test.mjs', `${note('navigateur')}import { test } from 'vitest';\ntest('n [niveau 2]', note);\n`);
  écrire('docs/a.md', 'Un document.\n');
  écrire('.gitignore', 'node_modules\n');
  const env = environnement({ TEMOIN_266: témoin, TIRELIRE_NAV: process.execPath });
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
  const tests = () => notes().filter((x) => !x.quoi.startsWith('typecheck-')).map((x) => x.quoi).sort();
  const vider = () => writeFileSync(témoin, '');
  const livrer = (...args) => lancer('sh', ['.githooks/livraison.sh', ...args], { cwd: dépôt, env });
  const tête = (branche) => {
    try {
      return execFileSync('git', ['rev-parse', '-q', '--verify', `refs/heads/${branche}`], { cwd: distant, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '0'.repeat(40);
    }
  };
  /** Le pré-push, puis le push lui-même s'il est vert. */
  const pousser = async (branche) => {
    const r = await livrer('push', `refs/heads/${branche}`, git('rev-parse', 'HEAD'), `refs/heads/${branche}`, tête(branche), 'origin');
    if (r.code === 0) git('push', '-q', '--no-verify', 'origin', `HEAD:refs/heads/${branche}`);
    return r;
  };
  const attestationDistante = (branche) => {
    const c = execFileSync('git', ['rev-parse', '-q', '--verify', `refs/heads/${branche}--attestation`], { cwd: distant, env, encoding: 'utf8' }).trim();
    return lireLAttestation(execFileSync('git', ['log', '-1', '--format=%B', c], { cwd: distant, env, encoding: 'utf8' })).attestation;
  };
  /** La CI au Ready sur la tête poussée : un clone du distant, les empreintes vertes, chaque paquet au seuil 1 et le navigateur au seuil 2. */
  const ready = async (branche, nom) => {
    const ci = join(temporaire(), `${nom}-ci`);
    execFileSync('git', ['clone', '-q', '--branch', branche, distant, ci], { env });
    execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, ci], { env });
    const couverture = join(temporaire(), `${nom}-ci.json`);
    const dit = execFileSync('node', [ATTESTATION_MJS, 'ready', gitDans(ci, env)('rev-parse', 'HEAD'), branche, 'origin/main', couverture], { cwd: ci, env, encoding: 'utf8' });
    vider();
    const sorties = [dit];
    for (const p of ['packages/gardes', 'packages/core', 'apps/web']) sorties.push((await lancer('pnpm', ['--dir', join(ci, p), 'run', 'test', '1', '--attestation', couverture], { cwd: ci, env })).sortie);
    sorties.push((await lancer('pnpm', ['--dir', join(ci, 'apps/web'), 'run', 'test', '2', '--navigateur', '--attestation', couverture, 'test/navigateur'], { cwd: ci, env })).sortie);
    return { joués: tests(), sortie: sorties.join('\n'), couverture: JSON.parse(readFileSync(couverture, 'utf8')) };
  };
  return { dépôt, distant, env, git, écrire, tests, vider, livrer, pousser, attestationDistante, ready };
}

/**
 * Une branche qui touche le cœur : un premier push, un push de documentation, la demande des tests
 * navigateur, un second push de documentation, puis le Ready sur sa tête. Joué une fois.
 */
let parcours;
const parcoursDuCoeur = () =>
  (parcours ??= (async () => {
    const f = dépôtFactice('parcours');
    const B = 'codage/998-parcours';
    const r = {};
    f.git('checkout', '-q', '-b', B);
    f.écrire('packages/core/lib.mjs', 'export const un = 2;\n');
    f.git('commit', '-q', '-am', 'cœur');
    r.premier = { ...(await f.pousser(B)), joués: f.tests(), attestation: f.attestationDistante(B) };
    const documentation = async (texte) => {
      f.vider();
      f.écrire('docs/a.md', texte);
      f.git('commit', '-q', '-am', 'documentation');
      return { ...(await f.pousser(B)), joués: f.tests(), attestation: f.attestationDistante(B) };
    };
    r.doc = await documentation('Un document, corrigé.\n');
    f.vider();
    r.demande = { ...(await f.livrer('demande', '--navigateur')), joués: f.tests(), attestation: f.attestationDistante(B) };
    r.doc2 = await documentation('Un document, corrigé deux fois.\n');
    r.ready = await f.ready(B, 'parcours');
    return r;
  })());

describe('[niveau 2] #266, points 2 et 4 à 6 · ce qui a tourné ne se rejoue pas', { concurrency: true }, () => {
  test('point 2 · au premier push, seuls se jouent les ensembles dont l’empreinte a changé depuis main, et ils sont attestés', async () => {
    const { premier } = await parcoursDuCoeur();
    assert.equal(premier.code, 0, premier.sortie);
    assert.deepEqual(premier.joués, ['coeur', 'garde', 'interface'], `le cœur, l'interface qui le lit, et la garde qui lit tout ; ni le navigateur sans demande, ni rien d'inchangé depuis main\n${premier.sortie}`);
    assert.deepEqual(premier.attestation.verts.map((v) => `${v.ensemble}:${v.seuil}`).sort(), ['coeur:2', 'garde:2', 'interface:2'], 'l’attestation envoyée porte ce qui a été joué vert');
  });

  test('points 2 et 6 · un push qui ne change que la documentation ne rejoue que ce qui la lit, et garde les empreintes vertes d’avant', async () => {
    const { premier, doc } = await parcoursDuCoeur();
    assert.equal(doc.code, 0, doc.sortie);
    assert.deepEqual(doc.joués, ['garde'], `un push de documentation ne rejoue que la garde, qui la lit\n${doc.sortie}`);
    for (const v of premier.attestation.verts) assert.ok(doc.attestation.verts.some((w) => w.ensemble === v.ensemble && w.empreinte === v.empreinte), `${v.ensemble} : son empreinte verte se garde d'un push à l'autre`);
  });

  test('point 5 · la demande des tests navigateur ne joue qu’eux, et les atteste sur leur empreinte', async () => {
    const { demande: d } = await parcoursDuCoeur();
    assert.equal(d.code, 0, d.sortie);
    assert.deepEqual(d.joués, ['navigateur'], `la demande ne rejoue rien de ce qui est déjà vert\n${d.sortie}`);
    assert.ok(d.attestation.verts.some((v) => v.ensemble === 'navigateur' && v.seuil === 2), 'les tests navigateur demandés et verts sont attestés sur leur empreinte');
  });

  test('points 4 et 5 · au Ready, après un push de documentation, rien ne se rejoue : seuil 1 compris, et les tests navigateur demandés', async () => {
    const { doc2, ready } = await parcoursDuCoeur();
    assert.equal(doc2.code, 0, doc2.sortie);
    assert.deepEqual(ready.joués, [], `au Ready, chaque ensemble vert sur son empreinte se saute, seuil 1 compris (point 4), et les tests navigateur demandés, sur un autre arbre mais la même empreinte (point 5)\n${ready.sortie}`);
    for (const id of ['garde', 'coeur', 'interface', 'navigateur']) assert.ok(ready.couverture.ensembles[id]?.seuil >= 1, `${id} : couvert au Ready`);
  });

  test('point 2 · ce qu’une session a trouvé vert, une autre le lit par le dépôt distant', () => {
    const base = join(temporaire(), 'sessions');
    const distant = join(base, 'distant.git');
    mkdirSync(base, { recursive: true });
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', distant], { env: environnement() });
    const session = (nom) => {
      const d = join(base, nom);
      execFileSync('git', ['clone', '-q', distant, d], { env: environnement(), stdio: 'ignore' });
      return { d, git: gitDans(d) };
    };
    const a = session('a');
    writeFileSync(join(a.d, 'x.txt'), '1');
    a.git('add', '-A');
    a.git('commit', '-q', '-m', 'x');
    a.git('push', '-q', 'origin', 'main');
    const e = E('s');
    writeFileSync(join(a.d, 'plan'), `coeur\t1\t2\t${e.coeur}\t\n`);
    mkdirSync(join(a.d, 'j'));
    writeFileSync(join(a.d, 'j', 'lances'), 'coeur\tcoeur\tnode\n');
    writeFileSync(join(a.d, 'j', 'coeur.code'), '0\n');
    writeFileSync(join(a.d, 'j', 'coeur.log'), 'ok 1 - c\n');
    writeFileSync(join(a.d, 'verts'), '[]');
    const node = (cwd, ...args) => execFileSync('node', [ATTESTATION_MJS, ...args], { cwd, env: environnement(), encoding: 'utf8' });
    node(a.d, 'bilan', join(a.d, 'plan'), join(a.d, 'j'), 'pré-push', 'a'.repeat(40), '-', 'codage/999-s', join(a.d, 'verts'), '--enregistrer');
    node(a.d, 'envoyer', 'origin', 'codage/999-s');
    const b = session('b');
    const sortie = join(b.d, 'verts.json');
    const dit = node(b.d, 'verts', 'codage/999-s', sortie, 'origin');
    const lus = JSON.parse(readFileSync(sortie, 'utf8'));
    assert.ok(lus.some((v) => v.ensemble === 'coeur' && v.empreinte === e.coeur && v.seuil === 2), `l'autre session lit l'empreinte verte du cœur\n${dit}`);
  });

  test('point 6 · l’attestation réunit les empreintes vertes d’un push et d’une session à l’autre, sans en perdre', () => {
    const avant = entrees(TYPES);
    const apres = entrees([...TYPES, 'docs/nouveau.md']);
    const verts = ENSEMBLES.map((e) => vert(e.id, empreinteDe(e, avant), 2));
    const joués = planifier({ empreintes: empreintes(apres), seuil: 2, verts }).filter((p) => p.jouer).map((p) => p.id);
    assert.deepEqual(joués, ['garde', 'hebergement'], 'un push de documentation ne rejoue que la garde et l’hébergement, qui la lisent');
    const gardés = fusionner(verts, [vert('garde', empreinteDe('garde', apres), 2, { date: '2026-09-29T00:00:00Z' })]);
    for (const v of verts) assert.ok(gardés.some((g) => g.ensemble === v.ensemble && g.empreinte === v.empreinte), `${v.ensemble} : l'empreinte verte d'avant se garde`);
    const { attestation } = lireLAttestation(texteDeLAttestation({ branche: 'codage/999-x', verts: gardés }));
    assert.equal(attestation.verts.length, gardés.length, 'l’attestation porte toutes les empreintes vertes');
    assert.equal(fusionner([vert('coeur', E('z').coeur, 1)], [vert('coeur', E('z').coeur, 2)])[0].seuil, 2, 'une empreinte trouvée verte à deux seuils garde le plus haut');
  });

  test('point 4 · au Ready, une tête de la branche verte au Ready, ou main, couvre ce qu’elle a joué ; sur main, une tête verte ou le premier parent', () => {
    const e = E('v');
    const c = couvertureAuReady({ arbre: A, empreintes: e, tetes: [{ sha: 't'.repeat(40), statut: 'success', empreintes: { ...E('w'), navigateur: e.navigateur, coeur: e.coeur } }], main: { commit: 'm'.repeat(40), empreintes: { ...E('w'), relais: e.relais } } });
    assert.equal(couvre(c, NAVIGATEUR).couvert, true, 'tests navigateur verts au Ready sur une tête précédente');
    assert.equal(couvre(c, demande('packages/core')).couvert, true, 'cœur vert au seuil 1 sur une tête précédente');
    assert.equal(couvre(c, demande('apps/relay', { seuil: 2 })).couvert, true, 'relais inchangé depuis main');
    const après = couvertureApresFusion({ arbre: A, empreintes: e, tetes: [{ sha: 't'.repeat(40), statut: 'success', empreintes: { ...E('x'), coeur: e.coeur } }], parent: { commit: 'p'.repeat(40), empreintes: { ...E('x'), navigateur: e.navigateur } } });
    assert.equal(couvre(après, demande('packages/core')).couvert, true, 'sur main, cœur sur l’empreinte d’une tête verte au Ready');
    assert.equal(couvre(après, NAVIGATEUR).couvert, true, 'sur main, navigateur inchangé depuis le premier parent');
  });

  test('point 4 · en CI, au Ready et sur main, chaque lancement des tests lit les empreintes vertes, seuil 1 compris', () => {
    for (const [nom, ctx] of [['au Ready', AU_READY], ['sur main', SUR_MAIN]]) {
      const l = lancementsDeTests(ctx);
      assert.ok(l.some((c) => /\bpnpm test 1\b/.test(c)), `${nom} : le seuil 1 se lance\n${l.join('\n')}`);
      for (const c of l) assert.match(c, /--attestation\s+\S/, `${nom} : « ${c.trim()} » ne lit pas les empreintes vertes`);
    }
  });

  test('le lanceur reconnaît les ensembles de chaque lancement', () => {
    const d = (dossier, navigateur, cibles) => ensemblesDeLaDemande({ dossier, navigateur, cibles }, ['packages/gardes/h.test.mjs', 'apps/web/test/navigateur/h.test.ts']);
    assert.deepEqual(d('packages/core', false, []), ['coeur']);
    assert.deepEqual(d('apps/web', false, []), ['interface']);
    assert.deepEqual(d('apps/web', true, []), ['interface', 'navigateur']);
    assert.deepEqual(d('apps/web', true, ['test/navigateur']), ['navigateur']);
    assert.deepEqual(d('apps/web', true, ['test/navigateur/h.test.ts']), [HARNAIS.id]);
    assert.deepEqual(d('packages/gardes', true, ['h.test.mjs']), [HARNAIS.id]);
    assert.equal(d('ailleurs', false, []), null);
  });
});

// ─── Niveau 3 : ce que chaque moment dit ───────────────────────────────────────────────────────

describe('[niveau 3] #266, point 7 · chaque moment dit, pour chaque ensemble, ce qu’il a joué ou pourquoi il ne l’a pas joué', () => {
  test('la livraison dit chaque ensemble : joué, à quel seuil, avec quel verdict ; ou non joué, et pourquoi', async () => {
    const { premier, doc, demande: d } = await parcoursDuCoeur();
    for (const nom of ['cœur', 'interface sans navigateur', 'garde']) assert.match(premier.sortie, new RegExp(`pré-push : ${nom} : joué au seuil 2 : vert\\.`), `${nom}\n${premier.sortie}`);
    assert.match(premier.sortie, /pré-push : relais : non joué — rien de ce qu'il lit n'a changé depuis main \([0-9a-f]{10}\)\./, premier.sortie);
    assert.ok(premier.sortie.includes(`pré-push : interface dans le navigateur : non joué — ${SANS_DEMANDE}.`), premier.sortie);
    assert.match(premier.sortie, /pré-push : harnais du besoin : non joué — aucun harnais du besoin\./);
    assert.match(doc.sortie, /pré-push : cœur : non joué — empreinte trouvée verte par pré-push, sur le commit [0-9a-f]{10}, au seuil 2\./, doc.sortie);
    assert.match(d.sortie, /demande : interface dans le navigateur : joué au seuil 2 : vert\./, d.sortie);
  });

  test('le pré-commit dit chaque ensemble, et qu’il ne joue jamais l’interface', async () => {
    const f = dépôtFactice('pre-commit');
    f.git('checkout', '-q', '-b', 'codage/996-pre-commit');
    f.écrire('packages/gardes/outil.mjs', 'export const x = 1;\n');
    f.git('add', '-A');
    const r = await lancer('sh', ['.githooks/pre-commit'], { cwd: f.dépôt, env: f.env });
    assert.equal(r.code, 0, r.sortie);
    assert.match(r.sortie, /pré-commit : garde : joué au seuil 0 : vert\./, r.sortie);
    assert.match(r.sortie, /pré-commit : cœur : non joué — /, r.sortie);
    assert.match(r.sortie, /pré-commit : interface sans navigateur : non joué — /, r.sortie);
    assert.match(r.sortie, /pré-commit : interface dans le navigateur : non joué — /, r.sortie);
  });

  test('la CI dit, pour chaque ensemble, ce qu’elle saute et pourquoi : par qui, sur quel commit, à quel seuil', () => {
    const e = E('c');
    const lignes = resume(couvertureAuReady({ arbre: A, empreintes: e, verts: [vert('navigateur', e.navigateur, 2, { par: 'demande' })], main: { commit: 'd'.repeat(40), empreintes: { ...E('z'), relais: e.relais } }, harnais: [] }));
    for (const id of TOUS) assert.ok(lignes.some((l) => l.startsWith(`- ${nomDe(id)} :`)), `${id} : la CI n'en dit rien\n${lignes.join('\n')}`);
    assert.ok(lignes.some((l) => /interface dans le navigateur : sauté jusqu'au seuil 2 — empreinte trouvée verte par demande, sur le commit c{10}, au seuil 2/.test(l)), lignes.join('\n'));
    assert.ok(lignes.some((l) => /relais : sauté jusqu'au seuil 2 — rien de ce qu'il lit n'a changé depuis main \(d{10}\)/.test(l)), lignes.join('\n'));
    assert.ok(lignes.some((l) => /cœur : se joue — aucune empreinte verte/.test(l)), lignes.join('\n'));
    const main = resume(couvertureApresFusion({ arbre: A, empreintes: e, parent: { commit: 'p'.repeat(40), empreintes: e } }));
    assert.ok(main.some((l) => /garde : sauté jusqu'au seuil 2 — rien de ce qu'il lit n'a changé depuis le premier parent/.test(l)), main.join('\n'));
  });

  test('le workflow des tests dit ce que chaque passage a joué, et au tag que rien ne se saute', () => {
    const étape = lireFichier(CI).split('\n      - ').find((é) => é.startsWith('name: Ce que ce passage a joué'));
    assert.ok(étape, 'aucune étape ne dit ce que le passage a joué');
    assert.match(étape, /if: always\(\)/, 'elle se joue même après un rouge');
    for (const quoi of ['typecheck', 'garde, cœur, relais, hébergement, interface sans navigateur', 'harnais du besoin', 'interface dans le navigateur', 'empreinte verte', 'au tag, rien ne se saute']) {
      assert.ok(étape.includes(quoi), `l'étape ne dit rien de « ${quoi} »`);
    }
  });
});
