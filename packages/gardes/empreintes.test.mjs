/**
 * Tests de #264 : les tests lourds ne tournent qu'une fois, au bon moment, et rien ne se rejoue sur du
 * code inchangé (D83).
 *
 * **Au niveau 1** — principe 10.1 et D83 (« aucun job sauté ne peut laisser fusionner ce qu'un job
 * joué aurait rougi ») : l'empreinte de chaque ensemble change avec tout fichier qu'il lit, un
 * chemin oublié de la liste compris ; un ensemble ne se saute que vert sur la même empreinte, à un
 * seuil au moins égal ; un ensemble rouge, ou dont un test s'est sauté faute d'outil, n'est pas vert ;
 * au Ready, le seuil 1 se joue toujours ; sur `main`, rien ne se saute hors d'une tête verte au Ready
 * ou du premier parent.
 *
 * **Au niveau 2** — le cas nominal de la décision, dont l'échec ne coûterait que du temps : une
 * empreinte verte se garde d'un push et d'une session à l'autre ; la livraison joue le typecheck,
 * puis les tests sans navigateur, puis les tests navigateur sur demande seulement ; demandés et verts,
 * ils sont attestés et la CI ne les rejoue pas ; les branches d'une PR fermée sont supprimées par leur
 * nom exact.
 *
 * **Au niveau 3** — le dégradé : ce que chaque moment dit (point 9).
 *
 * `node:test` n'a pas de `test.fails` : l'échec attendu d'un témoin tient dans une assertion
 * (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
  ENSEMBLES,
  HARNAIS,
  SANS_DEMANDE,
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
  planifier,
  resume,
  texteDeLAttestation,
} from './attestation.mjs';
import { branchesDeLaTete, client, fermeture, orphelines, orphelinesDuDepot, teteDe, teteDeLEvenement } from './branches-fermees.mjs';
import { RACINE } from './gardes.mjs';
import { commande, jouer } from './workflow-a-blanc.mjs';

const lireFichier = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');

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
  'packages/gardes/lanceur.mjs', 'packages/gardes/gardes.test.mjs',
  'packages/core/src/plan.ts', 'packages/core/test/plan.test.ts', 'packages/core/package.json',
  'apps/relay/server.mjs', 'apps/relay/README.md', 'apps/hebergement/apercu.sh', 'apps/hebergement/serveur/relais.php',
  'apps/web/src/App.svelte', 'apps/web/index.html', 'apps/web/package.json', 'apps/web/vitest.config.ts', 'apps/web/vite.config.ts',
  'apps/web/test/harnais.ts', 'apps/web/test/stockage.test.ts', 'apps/web/test/navigateur/acces.test.ts',
];

/** Ce que chaque ensemble lit, et ce qu'il ne lit pas, parmi `TYPES` (point 1). */
const LUS = {
  garde: ['package.json', 'pnpm-lock.yaml', 'nouveau/fichier.txt', 'docs/decisions.md', 'docs/gardes.md', 'README.md', '.github/workflows/ci.yml', '.githooks/livraison.sh', 'packages/gardes/lanceur.mjs', 'apps/web/package.json', 'apps/web/vitest.config.ts', 'packages/core/package.json'],
  coeur: ['package.json', 'pnpm-lock.yaml', 'tsconfig.base.json', 'nouveau/fichier.txt', 'packages/core/src/plan.ts', 'packages/core/test/plan.test.ts'],
  relais: ['package.json', 'pnpm-lock.yaml', 'nouveau/fichier.txt', 'apps/relay/server.mjs'],
  hebergement: TYPES,
  interface: ['package.json', 'pnpm-lock.yaml', 'tsconfig.base.json', 'nouveau/fichier.txt', 'docs/decisions.md', 'packages/core/src/plan.ts', 'apps/web/src/App.svelte', 'apps/web/test/harnais.ts', 'apps/web/test/stockage.test.ts'],
  navigateur: ['package.json', 'pnpm-lock.yaml', 'tsconfig.base.json', 'nouveau/fichier.txt', 'packages/core/src/plan.ts', 'apps/web/src/App.svelte', 'apps/web/vite.config.ts', 'apps/web/test/harnais.ts', 'apps/web/test/navigateur/acces.test.ts'],
};
const NON_LUS = {
  garde: ['packages/core/src/plan.ts', 'apps/web/src/App.svelte', 'apps/relay/server.mjs', 'apps/hebergement/apercu.sh'],
  coeur: ['docs/decisions.md', 'README.md', '.github/workflows/ci.yml', '.githooks/livraison.sh', 'packages/gardes/lanceur.mjs', 'apps/web/src/App.svelte', 'apps/relay/server.mjs'],
  relais: ['docs/decisions.md', 'apps/relay/README.md', 'packages/core/src/plan.ts', 'apps/web/src/App.svelte', 'apps/hebergement/apercu.sh', 'packages/gardes/lanceur.mjs'],
  hebergement: [],
  interface: ['docs/gardes.md', 'README.md', '.gitignore', '.github/workflows/ci.yml', 'apps/relay/server.mjs', 'apps/hebergement/serveur/relais.php', 'apps/web/test/navigateur/acces.test.ts', 'packages/gardes/lanceur.mjs'],
  // La liste du point 9 de #237.
  navigateur: ['docs/decisions.md', '.github/workflows/ci.yml', '.githooks/livraison.sh', 'packages/gardes/lanceur.mjs', 'apps/hebergement/apercu.sh', 'apps/relay/server.mjs', 'README.md', 'apps/relay/README.md', '.gitignore'],
};

const change = (id, chemins, chemin) => empreinteDe(id, entrees(chemins)) !== empreinteDe(id, entrees(chemins, { [chemin]: 1 }));

const E = (graine) => Object.fromEntries(TOUS.map((id) => [id, createHash('sha256').update(`${graine}${id}`).digest('hex')]));
const vert = (ensemble, empreinte, seuil, extra = {}) => ({ ensemble, empreinte, seuil, par: 'pré-push', commit: 'c'.repeat(40), date: '2026-09-28T00:00:00Z', ...extra });

let dossierTemporaire;
const temporaire = () => (dossierTemporaire ??= mkdtempSync(join(tmpdir(), 'empreintes-264-')));
after(() => {
  if (dossierTemporaire) rmSync(dossierTemporaire, { recursive: true, force: true });
});

function environnement(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'NODE_TEST_CONTEXT' || k.startsWith('VITEST') || k.startsWith('GIT_') || k === 'TIRELIRE_SEUIL') delete env[k];
  return { ...env, GIT_AUTHOR_NAME: 'Tests 264', GIT_AUTHOR_EMAIL: 'tests@exemple.invalid', GIT_COMMITTER_NAME: 'Tests 264', GIT_COMMITTER_EMAIL: 'tests@exemple.invalid', ...extra };
}
const gitDans = (cwd, env = environnement()) => (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd, env, encoding: 'utf8' }).trim();
const ATTESTATION_MJS = join(RACINE, '.githooks/attestation.mjs');

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

// ─── Niveau 1 ───────────────────────────────────────────────────────────────────────────────────

describe('[niveau 1] #264, principe 10.1 · un ensemble ne se saute que vert sur la même empreinte', () => {
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
    }
  });

  test('point 1 · chaque chemin écarté l’est avec sa raison', () => {
    for (const e of ENSEMBLES) {
      for (const { motifs, raison } of e.ecartes) {
        assert.ok(motifs.length, `${e.id} : un écart sans motif`);
        assert.ok(String(raison ?? '').trim().length > 20, `${e.id} : ${motifs.join(', ')} écarté(s) sans raison dite`);
      }
    }
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

  test('point 2 · une empreinte jamais trouvée verte, ou seulement à un seuil plus bas, se joue', () => {
    const e = E('a');
    const plan = (verts, references = []) => Object.fromEntries(planifier({ empreintes: e, seuil: 2, verts, references, harnais: ['packages/gardes/h.test.mjs'] }).map((p) => [p.id, p.jouer]));
    for (const id of ['garde', 'coeur', 'relais', 'hebergement', 'interface', 'harnais']) {
      assert.equal(plan([])[id], true, `${id} : jamais vert, il se joue`);
      assert.equal(plan([vert(id, e[id], id === 'harnais' ? 3 : 1)])[id], true, `${id} : vert à un seuil plus bas, il se joue`);
      assert.equal(plan([vert(id, E('b')[id], 4)])[id], true, `${id} : vert sur une autre empreinte, il se joue`);
      assert.equal(plan([vert(id === 'coeur' ? 'interface' : 'coeur', e[id], 4)])[id], true, `${id} : l'empreinte verte d'un autre ensemble ne compte pas`);
    }
    assert.equal(plan([], [{ empreintes: e, seuil: 3, raison: 'main' }]).harnais, true, "le harnais du besoin ne se saute jamais sur l'empreinte de main");
    const navigateur = planifier({ empreintes: e, seuil: 2, navigateur: true, verts: [vert('navigateur', e.navigateur, 1)] }).find((p) => p.id === 'navigateur');
    assert.equal(navigateur.jouer, true, 'tests navigateur demandés, verts au seuil 1 seulement : ils se jouent');
  });

  test('point 3 · un ensemble rouge, ou dont un test s’est sauté faute d’outil, n’est pas compté vert', () => {
    const dépôt = join(temporaire(), 'bilan');
    mkdirSync(dépôt, { recursive: true });
    const git = gitDans(dépôt);
    git('init', '-q', '-b', 'main');
    const journaux = join(dépôt, 'journaux');
    mkdirSync(journaux);
    const e = E('p');
    const ids = ['garde', 'coeur', 'relais', 'hebergement', 'interface'];
    writeFileSync(join(dépôt, 'plan'), `${ids.map((id) => `${id}\t1\t2\t${e[id]}\t`).join('\n')}\n`);
    writeFileSync(join(journaux, 'lances'), `${ids.map((id) => `${id}\t${id}`).join('\n')}\n`);
    const lancement = (id, code, journal, rapport) => {
      writeFileSync(join(journaux, `${id}.code`), `${code}\n`);
      writeFileSync(join(journaux, `${id}.log`), journal);
      if (rapport) writeFileSync(join(journaux, `${id}.rapport`), JSON.stringify(rapport));
    };
    const vitest = (statuts) => ({ testResults: [{ assertionResults: statuts.map((status) => ({ status })) }] });
    lancement('garde', 0, 'ok 1 - a\nseuil 2 : 0 test(s) écarté(s), de niveau supérieur à 2.\n');
    lancement('coeur', 1, 'not ok 1 - b\n', vitest(['failed', 'passed']));
    lancement('relais', 0, 'ok 1 - c # SKIP php absent\n');
    lancement('hebergement', 0, 'seuil 2 : 1 test(s) écarté(s), de niveau supérieur à 2.\n', vitest(['passed', 'skipped', 'skipped']));
    lancement('interface', 0, 'seuil 2 : 2 test(s) écarté(s), de niveau supérieur à 2.\n', vitest(['passed', 'skipped', 'skipped']));
    writeFileSync(join(dépôt, 'verts'), '[]');
    const r = execFileSync('node', [ATTESTATION_MJS, 'bilan', join(dépôt, 'plan'), journaux, 'pré-push', 'a'.repeat(40), 'b'.repeat(40), 'codage/999-bilan', join(dépôt, 'verts'), '--enregistrer'], { cwd: dépôt, env: environnement(), encoding: 'utf8' });
    const { attestation } = lireLAttestation(git('log', '-1', '--format=%B', 'refs/attestations/codage/999-bilan'));
    assert.ok(attestation, `aucune attestation écrite\n${r}`);
    assert.deepEqual(attestation.verts.map((v) => v.ensemble).sort(), ['garde', 'interface'], `seuls les ensembles verts, sans test sauté faute d'outil, entrent dans l'attestation (point 3)\n${r}`);
    assert.ok(attestation.verts.every((v) => v.empreinte === e[v.ensemble] && v.seuil === 2), 'chacun sur son empreinte, au seuil joué');
  });

  test('point 4 · au Ready, le seuil 1 se joue toujours, en entier, même tout vert', () => {
    const e = E('r');
    const verts = TOUS.map((id) => vert(id, e[id], 4));
    const c = couvertureAuReady({ arbre: 'f'.repeat(40), empreintes: e, verts, main: { commit: 'm'.repeat(40), empreintes: e }, harnais: [] });
    for (const dossier of ['packages/gardes', 'packages/core', 'apps/relay', 'apps/hebergement', 'apps/web']) {
      assert.equal(couvre(c, { arbre: 'f'.repeat(40), dossier, seuil: 1, navigateur: false, cibles: [], nomme: false }).couvert, false, `${dossier} : au Ready, le seuil 1 se joue toujours (point 4)`);
    }
    assert.equal(couvre(c, { arbre: 'f'.repeat(40), dossier: 'apps/web', seuil: 2, navigateur: true, cibles: ['test/navigateur'], nomme: false }).couvert, true, 'au-delà du seuil 1, le point 2 s’applique');
  });

  test('point 4 · sur main, un ensemble ne se saute que sur l’empreinte d’une tête verte au Ready ou du premier parent', () => {
    const e = E('m');
    const demande = (dossier, extra = {}) => ({ arbre: 'f'.repeat(40), dossier, seuil: 1, navigateur: false, cibles: [], nomme: false, ...extra });
    const sans = couvertureApresFusion({ arbre: 'f'.repeat(40), empreintes: e, tetes: [{ sha: 't'.repeat(40), statut: 'failure', empreintes: e }], parent: { commit: 'p'.repeat(40), empreintes: E('x') } });
    assert.equal(couvre(sans, demande('packages/core')).couvert, false, 'tête rouge au Ready, premier parent différent : le cœur se joue');
    const tete = couvertureApresFusion({ arbre: 'f'.repeat(40), empreintes: e, tetes: [{ sha: 't'.repeat(40), statut: 'success', empreintes: { ...E('x'), coeur: e.coeur } }] });
    assert.equal(couvre(tete, demande('packages/core')).couvert, true, 'cœur sur l’empreinte d’une tête verte au Ready : sauté');
    assert.equal(couvre(tete, demande('apps/web')).couvert, false, 'interface sur une autre empreinte : jouée');
    const parent = couvertureApresFusion({ arbre: 'f'.repeat(40), empreintes: e, parent: { commit: 'p'.repeat(40), empreintes: { ...E('x'), navigateur: e.navigateur } } });
    assert.equal(couvre(parent, demande('apps/web', { seuil: 2, navigateur: true, cibles: ['test/navigateur'] })).couvert, true, 'navigateur inchangé depuis le premier parent : sauté');
    assert.equal(parent.ensembles.harnais, undefined, 'le harnais du besoin ne s’y joue pas, rien à sauter');
  });

  test('point 7 · des tests navigateur verts au seuil 1, ou sur une autre empreinte, ne couvrent pas le Ready', () => {
    const e = E('n');
    const nav = { arbre: 'f'.repeat(40), dossier: 'apps/web', seuil: 2, navigateur: true, cibles: ['test/navigateur'], nomme: false };
    assert.equal(couvre(couvertureAuReady({ arbre: 'f'.repeat(40), empreintes: e, verts: [vert('navigateur', e.navigateur, 1)] }), nav).couvert, false);
    assert.equal(couvre(couvertureAuReady({ arbre: 'f'.repeat(40), empreintes: e, verts: [vert('navigateur', E('o').navigateur, 2)] }), nav).couvert, false);
    assert.equal(couvre(couvertureAuReady({ arbre: 'f'.repeat(40), empreintes: e, verts: [vert('navigateur', e.navigateur, 2)] }), { ...nav, arbre: 'e'.repeat(40) }).couvert, false, 'pour un autre arbre, rien ne se saute');
    assert.equal(couvre(couvertureAuReady({ arbre: 'f'.repeat(40), empreintes: e, tetes: [{ sha: 't'.repeat(40), statut: 'pending', empreintes: e }] }), nav).couvert, false, 'une tête dont la CI n’a pas fini verte ne couvre rien');
  });

  test('témoin rouge · une empreinte qui ne regarderait que le paquet, ou une décision qui ignorerait le seuil, ferait rougir ces tests', () => {
    const duPaquet = (id, chemin) => chemin.startsWith(`${ENSEMBLES.find((x) => x.id === id).dossier}/`);
    assert.ok(Object.entries(LUS).some(([id, fs]) => fs.some((f) => !duPaquet(id, f))), 'témoin : une empreinte du seul paquet laisserait passer un fichier lu ailleurs (pnpm-lock.yaml, le cœur pour l’interface)');
    const laxiste = (verts, id, empreinte) => verts.some((v) => v.ensemble === id && v.empreinte === empreinte);
    const e = E('t');
    assert.equal(laxiste([vert('coeur', e.coeur, 0)], 'coeur', e.coeur), true, 'témoin : une décision sans seuil sauterait le cœur vert au seuil 0 seulement');
    assert.equal(planifier({ empreintes: e, seuil: 2, verts: [vert('coeur', e.coeur, 0)] }).find((p) => p.id === 'coeur').jouer, true, 'la décision de #264 le joue');
  });
});

// ─── Niveau 2 : le moins cher d'abord, le navigateur au Ready ──────────────────────────────────

/**
 * Un petit dépôt, tel que la livraison le juge : les crochets et la garde du dépôt, un cœur et une
 * garde en `node --test`, une interface en vitest avec un test navigateur ; chaque test et chaque
 * typecheck note son passage dans le fichier `TEMOIN_264`. Rend ses commandes.
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
  const note = (quoi) => `import { appendFileSync, readFileSync, existsSync } from 'node:fs';\nconst note = () => appendFileSync(process.env.TEMOIN_264, ${JSON.stringify(quoi)} + ' ' + (performance.timeOrigin + performance.now()) + '\\n');\n`;
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
  const env = environnement({ TEMOIN_264: témoin });
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
  const pousser = async (branche, avant = '0'.repeat(40)) => livrer('push', `refs/heads/${branche}`, git('rev-parse', 'HEAD'), `refs/heads/${branche}`, avant, 'origin');
  const attestationDistante = (branche) => {
    const c = execFileSync('git', ['rev-parse', '-q', '--verify', `refs/heads/${branche}--attestation`], { cwd: distant, env, encoding: 'utf8' }).trim();
    return lireLAttestation(execFileSync('git', ['log', '-1', '--format=%B', c], { cwd: distant, env, encoding: 'utf8' })).attestation;
  };
  return { dépôt, distant, env, git, écrire, notes, vider, livrer, pousser, attestationDistante };
}

describe('[niveau 2] #264 · le moins cher d’abord, le navigateur au Ready, rien de rejoué sur du code inchangé', { concurrency: true }, () => {
  test('point 2 · une empreinte verte se garde d’un push à l’autre : un push de documentation ne rejoue que ce qui la lit', () => {
    const avant = entrees(TYPES);
    const apres = entrees([...TYPES, 'docs/nouveau.md']);
    const verts = ENSEMBLES.map((e) => vert(e.id, empreinteDe(e, avant), 2));
    const joués = planifier({ empreintes: empreintes(apres), seuil: 2, verts }).filter((p) => p.jouer).map((p) => p.id);
    assert.deepEqual(joués, ['garde', 'hebergement'], 'un push de documentation ne rejoue que la garde et l’hébergement, qui la lisent');
    const gardés = fusionner(verts, [vert('garde', empreinteDe('garde', apres), 2, { date: '2026-09-29T00:00:00Z' })]);
    for (const v of verts) assert.ok(gardés.some((g) => g.ensemble === v.ensemble && g.empreinte === v.empreinte), `${v.ensemble} : l'empreinte verte d'avant se garde`);
    const { attestation } = lireLAttestation(texteDeLAttestation({ branche: 'codage/999-x', verts: gardés }));
    assert.equal(attestation.verts.length, gardés.length, 'l’attestation porte toutes les empreintes vertes');
  });

  test('point 2 · ce qu’une session a trouvé vert, une autre le lit par le dépôt distant', () => {
    const base = join(temporaire(), 'sessions');
    const distant = join(base, 'distant.git');
    mkdirSync(base, { recursive: true });
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', distant], { env: environnement() });
    const session = (nom) => {
      const d = join(base, nom);
      execFileSync('git', ['clone', '-q', distant, d], { env: environnement() });
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
    writeFileSync(join(a.d, 'j', 'lances'), 'coeur\tcoeur\n');
    writeFileSync(join(a.d, 'j', 'coeur.code'), '0\n');
    writeFileSync(join(a.d, 'j', 'coeur.log'), 'ok\n');
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

  test('points 5 à 7 · la livraison joue le typecheck, puis les tests sans navigateur ; le navigateur sur demande seulement, attesté, et la CI ne le rejoue pas', async () => {
    const f = dépôtFactice('livraison');
    const B = 'codage/998-livraison';
    f.git('checkout', '-q', '-b', B);
    f.écrire('packages/core/lib.mjs', 'export const un = 2;\n');
    f.git('commit', '-q', '-am', 'cœur');
    const premier = await f.pousser(B);
    assert.equal(premier.code, 0, `premier push refusé\n${premier.sortie}`);
    let n = f.notes();
    const tc = n.filter((x) => x.quoi.startsWith('typecheck-'));
    const tests = n.filter((x) => !x.quoi.startsWith('typecheck-'));
    assert.deepEqual(tc.map((x) => x.quoi).sort(), ['typecheck-coeur', 'typecheck-web'], `le typecheck des paquets dont un ensemble se joue\n${premier.sortie}`);
    assert.deepEqual(tests.map((x) => x.quoi).sort(), ['coeur', 'interface'], `le cœur et l'interface sans navigateur se jouent ; la garde, inchangée depuis main, et le navigateur, sans demande, non (points 2 et 6)\n${premier.sortie}`);
    assert.ok(Math.max(...tc.map((x) => x.t)) <= Math.min(...tests.map((x) => x.t)), `le typecheck se joue avant les tests (point 5)\n${JSON.stringify(n)}`);
    assert.match(premier.sortie, new RegExp(SANS_DEMANDE), 'la livraison dit qu’elle laisse les tests navigateur au Ready');
    const a1 = f.attestationDistante(B);
    assert.deepEqual(a1.verts.map((v) => `${v.ensemble}:${v.seuil}`).sort(), ['coeur:2', 'interface:2'], 'l’attestation envoyée porte ce qui a été joué vert');

    // Un push qui ne change que la documentation : rien de ce que lisent le cœur et l'interface.
    const avant = f.git('rev-parse', 'HEAD');
    f.écrire('docs/a.md', 'Un document, corrigé.\n');
    f.git('commit', '-q', '-am', 'documentation');
    f.vider();
    const doc = await f.pousser(B, avant);
    assert.equal(doc.code, 0, doc.sortie);
    n = f.notes().filter((x) => !x.quoi.startsWith('typecheck-')).map((x) => x.quoi);
    assert.deepEqual(n, ['garde'], `un push de documentation ne rejoue que la garde, qui la lit (point 2)\n${doc.sortie}`);
    const a2 = f.attestationDistante(B);
    for (const v of a1.verts) assert.ok(a2.verts.some((w) => w.ensemble === v.ensemble && w.empreinte === v.empreinte), `${v.ensemble} : son empreinte verte se garde d'un push à l'autre`);

    // La demande des tests navigateur : joués après le reste, attestés, et la CI ne les rejoue pas.
    f.vider();
    const d = await f.livrer('demande', '--navigateur');
    assert.equal(d.code, 0, d.sortie);
    n = f.notes();
    assert.deepEqual(n.filter((x) => !x.quoi.startsWith('typecheck-')).map((x) => x.quoi), ['navigateur'], `la demande joue les tests navigateur, et rien de ce qui est déjà vert (point 7)\n${d.sortie}`);
    const a3 = f.attestationDistante(B);
    assert.ok(a3.verts.some((v) => v.ensemble === 'navigateur' && v.seuil === 2), 'les tests navigateur demandés et verts sont attestés sur leur empreinte');

    f.git('push', '-q', 'origin', B);
    const ci = join(temporaire(), 'livraison-ci');
    execFileSync('git', ['clone', '-q', '--branch', B, f.distant, ci], { env: f.env });
    execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, ci], { env: f.env });
    const couverture = join(temporaire(), 'livraison-ci.json');
    const r = execFileSync('node', [ATTESTATION_MJS, 'ready', f.git('rev-parse', 'HEAD'), B, 'origin/main', couverture], { cwd: ci, env: f.env, encoding: 'utf8' });
    f.vider();
    const nav = await lancer('pnpm', ['--dir', join(ci, 'apps/web'), 'run', 'test', '2', '--navigateur', '--attestation', couverture, 'test/navigateur'], { cwd: ci, env: f.env });
    assert.equal(nav.code, 0, nav.sortie);
    assert.deepEqual(f.notes().map((x) => x.quoi), [], `au Ready, les tests navigateur attestés sur la même empreinte ne se rejouent pas (point 7)\n${r}\n${nav.sortie}`);
    assert.match(nav.sortie, /attestation : sauté/, 'et le lanceur le dit');
  });

  test('point 5 · un test sans navigateur rouge retient les tests navigateur demandés', async () => {
    const f = dépôtFactice('rouge');
    f.git('checkout', '-q', '-b', 'codage/997-rouge');
    f.écrire('apps/web/etat.txt', 'rouge\n');
    f.git('commit', '-q', '-am', 'rouge');
    const d = await f.livrer('demande', '--navigateur');
    assert.notEqual(d.code, 0, `la demande devait être refusée\n${d.sortie}`);
    const n = f.notes().map((x) => x.quoi);
    assert.ok(n.includes('interface'), `l'interface sans navigateur s'est jouée\n${d.sortie}`);
    assert.ok(!n.includes('navigateur'), `les tests navigateur ne partent pas après un rouge sans navigateur (point 5)\n${d.sortie}`);
    assert.match(d.sortie, /tests navigateur non joués : un test sans navigateur, palier moins cher, a rougi/, 'et la demande le dit (point 9)');
  });

  test('point 7 · une tête de la branche verte au Ready couvre les tests navigateur au Ready suivant, sur la même empreinte', () => {
    const e = E('v');
    const nav = { arbre: 'f'.repeat(40), dossier: 'apps/web', seuil: 2, navigateur: true, cibles: ['test/navigateur'], nomme: false };
    const c = couvertureAuReady({ arbre: 'f'.repeat(40), empreintes: e, tetes: [{ sha: 't'.repeat(40), statut: 'success', empreintes: { ...E('w'), navigateur: e.navigateur } }] });
    assert.equal(couvre(c, nav).couvert, true);
    assert.equal(couvre(c, { ...nav, navigateur: false, cibles: [], seuil: 2 }).couvert, false, 'la même tête ne couvre l’interface sans navigateur qu’au seuil 1');
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

// ─── Les branches, à la fermeture d'une PR ─────────────────────────────────────────────────────

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

const WORKFLOW_BRANCHES = '.github/workflows/branches.yml';

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
    const PR = (merged) => ({ number: 1, draft: false, merged, head: { ref: TÊTE, sha: 'a'.repeat(40), repo: { full_name: 'sverley/Tirelire' } } });
    const ctx = (event_name, event, ref = 'refs/heads/main') => ({ github: { event_name, ref, repository: 'sverley/Tirelire', event }, vars: {}, secrets: {}, inputs: {} });
    for (const merged of [true, false]) {
      const étapes = jouer(yaml, ctx('pull_request_target', { action: 'closed', pull_request: PR(merged) })).flatMap((j) => j.joués.map(commande));
      assert.ok(étapes.some((c) => /branches-fermees\.mjs fermeture\b/.test(c)), `fermeture ${merged ? 'fusionnée' : 'sans fusion'} : les branches de la PR sont supprimées`);
    }
    const surMain = jouer(yaml, ctx('push', {})).flatMap((j) => j.joués.map(commande));
    assert.ok(surMain.some((c) => /branches-fermees\.mjs orphelines\b/.test(c)), 'à son arrivée sur main, les branches qui traînent sont supprimées');
    assert.match(yaml, /paths:\s*\[?'?\.github\/workflows\/branches\.yml/, 'sur main, il ne tourne qu’à sa propre arrivée ou à la main');
    for (const [, ref] of yaml.matchAll(/^\s+ref:\s*(.+)$/gm)) assert.equal(ref.trim(), 'main', 'le job n’extrait que main');
  });
});

// ─── Niveau 3 : ce que chaque moment dit ───────────────────────────────────────────────────────

describe('[niveau 3] #264, point 9 · ce que chaque moment dit, pour chaque ensemble', () => {
  test('un crochet dit pourquoi il ne joue pas : empreinte verte (par qui, sur quoi, à quel seuil), inchangé depuis main, faute de demande', () => {
    const e = E('d');
    const plan = planifier({ empreintes: e, seuil: 2, verts: [vert('coeur', e.coeur, 2)], references: [{ empreintes: { relais: e.relais }, seuil: 3, raison: "rien de ce qu'il lit n'a changé depuis main (1234567890)" }] });
    const raison = (id) => plan.find((p) => p.id === id).raison;
    assert.match(raison('coeur'), /trouvée verte par pré-push, sur le commit c{10}, au seuil 2/);
    assert.match(raison('relais'), /depuis main/);
    assert.equal(raison('navigateur'), SANS_DEMANDE);
    assert.equal(raison('harnais'), 'aucun harnais du besoin');
  });

  test('la CI dit, pour chaque ensemble, ce qu’elle saute et pourquoi, et que le seuil 1 se joue toujours au Ready', () => {
    const e = E('c');
    const lignes = resume(couvertureAuReady({ arbre: 'f'.repeat(40), empreintes: e, verts: [vert('navigateur', e.navigateur, 2)], harnais: [] }));
    assert.match(lignes[0], /seuil 1 se joue toujours/);
    for (const { nom } of ENSEMBLES) assert.ok(lignes.some((l) => l.startsWith(`- ${nom} :`)), `${nom} : la CI n'en dit rien`);
    assert.ok(lignes.some((l) => /interface dans le navigateur : sauté jusqu'au seuil 2 — empreinte trouvée verte/.test(l)));
  });

  test('le workflow des tests dit ce que chaque passage a joué, et au tag que rien ne se saute', () => {
    const yaml = lireFichier('.github/workflows/ci.yml');
    const étape = yaml.split('\n      - ').find((é) => é.startsWith('name: Ce que ce passage a joué'));
    assert.ok(étape, 'aucune étape ne dit ce que le passage a joué');
    assert.match(étape, /if: always\(\)/, 'elle se joue même après un rouge');
    for (const quoi of ['typecheck', 'garde, cœur, relais, hébergement, interface sans navigateur', 'harnais du besoin', 'interface dans le navigateur', 'palier moins cher', 'au tag, rien ne se saute']) {
      assert.ok(étape.includes(quoi), `l'étape ne dit rien de « ${quoi} »`);
    }
  });
});
