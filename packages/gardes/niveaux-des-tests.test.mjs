/**
 * Harnais d'audit de #232 : l'outil de test joue chaque test à son niveau, qui dit le risque pris à
 * ne pas le jouer (D83). Écrit par l'auditeur de #232, repris par #243 : la règle des harnais, qui
 * vérifie la garde elle-même, est passée dans les tests de la garde (`gardes.test.mjs`, D81).
 *
 * **Le contrat** (D83). Un test porte son niveau, de 0 à 4, par la marque `[niveau N]` dans son
 * titre, sinon dans celui de la suite la plus proche qui l'englobe ; sans marque, il est de niveau 2.
 * L'outil de test prend un seuil en entrée (`pnpm test [N]`, 2 sans entrée) et ne joue que les tests
 * de niveau N ou moins ; les tests navigateur ne se jouent qu'avec l'option `--navigateur`. Un test
 * appelé nommément se joue quel que soit son niveau.
 *
 * **Au niveau 1** — ce qui, tombé sans qu'on le voie, laisserait découvrir un rouge après la fusion
 * (principe 10.1) : dans chaque ensemble, au seuil 1, les tests de niveau 0 et 1 se jouent, et eux
 * seuls ; l'interface, avec et sans l'option navigateur ; `ci.yml`, joué à blanc, vérifie au seuil 1,
 * active les tests navigateur au seuil 2, joue le harnais du besoin dans une étape bloquante, et ne
 * publie qu'après le seuil 3 au tag `v*`.
 *
 * **Au niveau 2** — des cas de D83, l'usage restant possible s'ils tombaient : le seuil par défaut,
 * les seuils 2 et 4 et l'appel nommé, dans la garde et le cœur ; les crochets, rejoués dans une copie
 * du dépôt (pré-commit au seuil 0, livraison au seuil 2, harnais du besoin en entier, besoin
 * fonctionnel qui fait jouer l'interface).
 *
 * Chaque lancement ne part qu'au premier test qui l'attend : au seuil 1, la copie du dépôt des
 * crochets ne se fait pas. `node:test` n'a pas de `test.fails` : l'échec attendu d'un témoin tient
 * dans une assertion (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { RACINE } from './gardes.mjs';
import { commande, jouer } from './workflow-a-blanc.mjs';

const DÉFAUT = 2;

const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');

// ─── Un fichier de test inventé, qui porte chaque niveau (points 1 à 4, 8) ───────────────────────

/** Chaque test, son titre et le niveau qu'il porte (le sien, celui de sa suite, ou le défaut). */
const FIXTURE = Object.freeze([
  { id: 'n0', titre: 'n0 [niveau 0]', niveau: 0 },
  { id: 'n1', titre: 'n1 [niveau 1]', niveau: 1 },
  { id: 'n2', titre: 'n2 [niveau 2]', niveau: 2 },
  { id: 'n3', titre: 'n3 [niveau 3]', niveau: 3 },
  { id: 'n4', titre: 'n4 [niveau 4]', niveau: 4 },
  { id: 's', titre: 's sans marque', niveau: 2 },
  { id: 'g3', titre: 'g3 hérite de sa suite', niveau: 3, suite: 'groupe [niveau 3]' },
  { id: 'g4', titre: 'g4 [niveau 4]', niveau: 4, suite: 'groupe [niveau 3]' },
  { id: 'g0', titre: 'g0 [niveau 0]', niveau: 0, suite: 'groupe [niveau 3]' },
  { id: 'gs', titre: 'gs hérite du défaut', niveau: 2, suite: 'groupe sans marque' },
]);
const TOUT = FIXTURE.map((t) => t.id).sort();

function source(exécuteur, nom, entête) {
  const module = exécuteur === 'vitest' ? 'vitest' : 'node:test';
  const lignes = [
    ...(entête ? [`// ${entête}`] : []),
    "import { appendFileSync } from 'node:fs';",
    `import { describe, test } from '${module}';`,
    `const note = (id) => { if (process.env.NIVEAUX_TEMOIN) appendFileSync(process.env.NIVEAUX_TEMOIN, '${nom}:' + id + '\\n'); };`,
  ];
  const suites = new Map();
  for (const t of FIXTURE) {
    const ligne = `test(${JSON.stringify(t.titre)}, () => { note('${t.id}'); });`;
    if (!t.suite) lignes.push(ligne);
    else suites.set(t.suite, [...(suites.get(t.suite) ?? []), `  ${ligne}`]);
  }
  for (const [s, l] of suites) lignes.push(`describe(${JSON.stringify(s)}, () => {`, ...l, '});');
  return `${lignes.join('\n')}\n`;
}

/** Un test de niveau 1 écrit dans une boucle, qui en engendre deux, dans le fichier navigateur inventé. */
const BOUCLE = "for (const k of [1, 2]) test(`b${k} [niveau 1]`, () => { note('b' + k); });\n";
/** Tests écrits du fichier navigateur inventé : la boucle compte pour un (#232, point 3). */
const NAVIGATEUR_ÉCRITS = FIXTURE.length + 1;

/** Ce qu'un seuil doit jouer : les tests de ce niveau ou moins. */
const attendus = (seuil) => FIXTURE.filter((t) => t.niveau <= seuil).map((t) => t.id).sort();

const PAQUETS = Object.freeze({
  cœur: { dossier: 'packages/core', exécuteur: 'vitest' },
  interface: { dossier: 'apps/web', exécuteur: 'vitest' },
  garde: { dossier: 'packages/gardes', exécuteur: 'node' },
  relais: { dossier: 'apps/relay', exécuteur: 'node' },
  hébergement: { dossier: 'apps/hebergement', exécuteur: 'node' },
});

/** L'environnement d'un lancement : sans seuil hérité, sans contexte de test ni de git. */
function environnement(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'NODE_TEST_CONTEXT' || k.startsWith('VITEST') || k.startsWith('GIT_')) delete env[k];
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = String(v);
  return env;
}

// Quatre lancements à la fois au plus : la CI a peu de cœurs.
let actifs = 0;
const attente = [];
function lancer(cmd, args, options) {
  return new Promise((fini) => {
    const go = () => {
      actifs++;
      const début = Date.now();
      const p = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
      let sortie = '';
      p.stdout.on('data', (d) => (sortie += d));
      p.stderr.on('data', (d) => (sortie += d));
      p.on('close', (code) => {
        actifs--;
        attente.shift()?.();
        fini({ code, sortie, ms: Date.now() - début });
      });
    };
    if (actifs < 4) go();
    else attente.push(go);
  });
}


/** Dossier jetable, créé au premier lancement : un fichier dont aucun test ne se joue n'en crée pas. */
let dossierTemporaire;
const temporaire = () => (dossierTemporaire ??= mkdtempSync(join(tmpdir(), 'niveaux-232-')));
const dossiersVitest = [];
let compteur = 0;

/** Joue le fichier inventé par l'exécuteur d'un paquet ; rend les tests joués, triés, et la sortie. */
async function jouerFixture(nomPaquet, { seuil, nommé, navigateur = false } = {}) {
  const { dossier, exécuteur } = PAQUETS[nomPaquet];
  const nom = `${nomPaquet}-${seuil ?? 'sans-seuil'}${nommé ? '-nomme' : ''}${navigateur ? '-nav' : ''}-${++compteur}`;
  const témoin = join(temporaire(), `${nom}.temoin`);
  writeFileSync(témoin, '');
  let args;
  if (exécuteur === 'vitest') {
    // Dans le paquet, pour que `vitest` s'y résolve, mais hors de ses `include` : un lancement
    // parallèle du paquet ne le ramasse pas.
    const relatif = `.niveaux-232-${process.pid}-${compteur}`;
    const racine = join(RACINE, dossier, relatif);
    dossiersVitest.push(racine);
    mkdirSync(join(racine, 'test', 'navigateur'), { recursive: true });
    writeFileSync(join(racine, 'test', 'niveaux.test.ts'), source('vitest', nom));
    // L'interface dans le navigateur : même exécuteur, son propre dossier.
    // Plus un test écrit dans une boucle, qui en engendre deux : écrit une fois, il compte pour un.
    if (nomPaquet === 'interface') writeFileSync(join(racine, 'test', 'navigateur', 'niveaux.test.ts'), source('vitest', `${nom}-navigateur`) + BOUCLE);
    args = ['--dir', relatif, ...(nommé ? ['-t', nommé] : [])];
  } else {
    const fichier = join(temporaire(), `${nom}.test.mjs`);
    writeFileSync(fichier, source('node', nom));
    args = [...(nommé ? [`--test-name-pattern=${nommé}`] : []), fichier];
  }
  const entrée = [...(seuil === undefined ? [] : [String(seuil)]), ...(navigateur ? ['--navigateur'] : [])];
  const r = await lancer('pnpm', ['--dir', join(RACINE, dossier), 'run', 'test', ...entrée, ...args], {
    cwd: RACINE,
    env: environnement({ NIVEAUX_TEMOIN: témoin }),
  });
  const notés = readFileSync(témoin, 'utf8').split('\n').filter(Boolean);
  const par = (préfixe) => notés.filter((l) => l.startsWith(`${préfixe}:`)).map((l) => l.slice(préfixe.length + 1)).sort();
  // L'interface joue deux fichiers inventés, headless et navigateur : l'écart se compte sur les deux.
  return { ...r, joués: par(nom), navigateur: par(`${nom}-navigateur`), fichiers: nomPaquet === 'interface' && navigateur ? 2 : 1 };
}

const mémo = (f) => {
  let p;
  return () => (p ??= f());
};

const scénarios = {};
for (const paquet of ['garde', 'cœur']) {
  scénarios[`${paquet}:défaut`] = mémo(() => jouerFixture(paquet));
  for (const s of [2, 4]) scénarios[`${paquet}:${s}`] = mémo(() => jouerFixture(paquet, { seuil: s }));
  // Le motif ne porte ni espace ni caractère que pnpm ou le shell réécrit : l'appel nommé ne dépend que
  // de l'exécuteur (#243, point 5). « n4 » ne se trouve que dans le titre « n4 [niveau 4] ».
  scénarios[`${paquet}:nommé`] = mémo(() => jouerFixture(paquet, { nommé: NOMMÉ }));
}
for (const paquet of Object.keys(PAQUETS)) scénarios[`${paquet}:1`] = mémo(() => jouerFixture(paquet, { seuil: 1 }));
scénarios['interface:1+nav'] = mémo(() => jouerFixture('interface', { seuil: 1, navigateur: true }));

/** L'écart se compte et se dit : une ligne qui parle d'écarté(s) porte le nombre attendu. */
const ditLÉcart = (sortie, nombre) => sortie.split('\n').some((l) => /écart/i.test(l) && new RegExp(`(?<!\\d)${nombre}(?!\\d)`).test(l));

function constater(r, seuil, étiquette) {
  const attendu = attendus(seuil);
  assert.equal(r.code, 0, `${étiquette} : le lancement échoue\n${r.sortie.slice(-2000)}`);
  assert.deepEqual(r.joués, attendu, `${étiquette} : au seuil ${seuil}, seuls les tests de niveau ${seuil} ou moins se jouent ; sans marque, un test est de niveau 2, sinon celui de sa suite (#232, points 1 et 3)`);
  const écartés = (FIXTURE.length - attendu.length) * r.fichiers;
  if (écartés) assert.ok(ditLÉcart(r.sortie, écartés), `${étiquette} : ${écartés} test(s) écarté(s) au seuil ${seuil}, à compter et à dire sur une ligne qui parle d'« écarté(s) » (#232, point 3)\n${r.sortie.slice(-1500)}`);
}

// ─── Les crochets : pré-commit et livraison (points 5, 6 et 9) ───────────────────────────────────

/**
 * Une copie du dépôt tel que la copie de travail le porte, sans ses tests : un test déjà sur `main`
 * (`ancien`, la non-régression), puis un test que la branche ajoute (`nouveau`, le harnais du
 * besoin). Le pré-commit juge l'index, la livraison le commit poussé.
 */
const BRANCHE = 'audit/999-besoin-invente';
const BRANCHE_FONCTIONNELLE = 'audit/998-besoin-fonctionnel';
const crochets = mémo(async () => {
  const dépôt = join(temporaire(), 'depot');
  const git = (...a) => execFileSync('git', a, { cwd: dépôt, env: environnement(), encoding: 'utf8' }).trim();
  const suivis = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: RACINE, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of suivis) {
    if (/\.test\.[^/]+$|(^|\/)test\//.test(f) || f.startsWith('apps/web/android/') || /(^|\/)\.niveaux-232-/.test(f) || !existsSync(join(RACINE, f))) continue;
    mkdirSync(dirname(join(dépôt, f)), { recursive: true });
    cpSync(join(RACINE, f), join(dépôt, f));
  }
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Harnais 232');
  git('config', 'user.email', 'harnais@exemple.invalid');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dépôt, 'packages/gardes/ancien.test.mjs'), source('node', 'ancien'));
  mkdirSync(join(dépôt, 'apps/web/test/navigateur'), { recursive: true });
  writeFileSync(join(dépôt, 'apps/web/test/ancien-web.test.ts'), source('vitest', 'web'));
  writeFileSync(join(dépôt, 'apps/web/test/navigateur/ancien-nav.test.ts'), source('vitest', 'nav'));
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', BRANCHE);
  execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, dépôt], { env: environnement() });
  writeFileSync(join(dépôt, 'packages/gardes/nouveau.test.mjs'), source('node', 'nouveau', "Harnais d'audit de #999 : un besoin inventé."));
  writeFileSync(join(dépôt, 'packages/gardes/codeur.test.mjs'), source('node', 'codeur'));
  git('add', 'packages/gardes/nouveau.test.mjs', 'packages/gardes/codeur.test.mjs');

  const témoinCommit = join(temporaire(), 'pre-commit.temoin');
  writeFileSync(témoinCommit, '');
  const préCommit = await lancer('sh', ['.githooks/pre-commit'], { cwd: dépôt, env: environnement({ NIVEAUX_TEMOIN: témoinCommit }) });
  git('commit', '-q', '--no-verify', '-m', 'besoin #999');
  const sha = git('rev-parse', 'HEAD');

  const témoinPush = join(temporaire(), 'pre-push.temoin');
  writeFileSync(témoinPush, '');
  const livraison = await lancer('sh', ['.githooks/livraison.sh', 'push', `refs/heads/${BRANCHE}`, sha, `refs/heads/${BRANCHE}`, '0'.repeat(40)], {
    cwd: dépôt,
    env: environnement({ NIVEAUX_TEMOIN: témoinPush }),
  });
  const lu = (f) => {
    const l = readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const de = (n) => l.filter((x) => x.startsWith(`${n}:`)).map((x) => x.slice(n.length + 1)).sort();
    return { ancien: de('ancien'), nouveau: de('nouveau'), codeur: de('codeur'), web: de('web'), nav: de('nav') };
  };

  // Un besoin fonctionnel : le relais touché, la livraison joue l'interface (#232, point 6).
  git('checkout', '-q', '-b', BRANCHE_FONCTIONNELLE, 'main');
  writeFileSync(join(dépôt, 'apps/relay/README.md'), `${readFileSync(join(dépôt, 'apps/relay/README.md'), 'utf8')}\nUne ligne de plus.\n`);
  git('commit', '-q', '--no-verify', '-am', 'besoin fonctionnel #998');
  const témoinFonctionnel = join(temporaire(), 'pre-push-fonctionnel.temoin');
  writeFileSync(témoinFonctionnel, '');
  const fonctionnel = await lancer('sh', ['.githooks/livraison.sh', 'push', `refs/heads/${BRANCHE_FONCTIONNELLE}`, git('rev-parse', 'HEAD'), `refs/heads/${BRANCHE_FONCTIONNELLE}`, '0'.repeat(40)], {
    cwd: dépôt,
    env: environnement({ NIVEAUX_TEMOIN: témoinFonctionnel }),
  });
  return { préCommit: { ...préCommit, ...lu(témoinCommit) }, livraison: { ...livraison, ...lu(témoinPush) }, fonctionnel: { ...fonctionnel, ...lu(témoinFonctionnel) } };
});

// ─── La CI, jouée à blanc (points 7, 8 et 9) ─────────────────────────────────────────────────────

const CI = '.github/workflows/ci.yml';
const scripts = JSON.parse(lire('package.json')).scripts ?? {};

/** La commande d'une étape, les scripts `pnpm <script>` de la racine dépliés d'un niveau. */
function déplier(texte) {
  let t = texte;
  for (const m of texte.matchAll(/\bpnpm\s+(?:run\s+)?([\w:.-]+)/g)) if (m[1] !== 'test' && scripts[m[1]]) t += `\n${scripts[m[1]]}`;
  return t;
}
/** `pnpm test [N]`, options de pnpm comprises (`-r`, `--dir <paquet>`, `--filter <paquet>`). */
const PNPM_TEST = /\bpnpm\b(?:\s+(?:-r|--recursive|(?:--dir|-C|--filter|-F)\s+\S+))*\s+(?:run\s+)?test\b(?:\s+([0-4])\b)?/;

/** Chaque lancement des tests dans une étape : son seuil (2 sans argument), et s'il vise les tests navigateur. */
const lancements = (é) =>
  déplier(commande(é))
    .split('\n')
    .filter((l) => PNPM_TEST.test(l))
    .map((l) => ({ seuil: l.match(PNPM_TEST)[1] === undefined ? DÉFAUT : Number(l.match(PNPM_TEST)[1]), navigateur: /(?:^|\s)--navigateur(?:\s|$)/.test(l) }));

const auReady = {
  github: { event_name: 'pull_request', ref: 'refs/pull/232/merge', event: { action: 'ready_for_review', pull_request: { number: 232, draft: false, head: { sha: 'a'.repeat(40) } } } },
  vars: {},
  secrets: {},
  inputs: {},
};
const auTag = { github: { event_name: 'push', ref: 'refs/tags/v1.0.0', event: {} }, vars: {}, secrets: {}, inputs: {} };

const étapesDeTests = (yaml, ctx) => jouer(yaml, ctx).flatMap((job) => job.joués.flatMap((é) => lancements(é).map((l) => ({ job, é, ...l }))));
const publie = (é) => /uses:\s*softprops\/action-gh-release@|deposer\.sh/.test(é.texte);
const laisseÉchouer = (job, é) => /^ +(?:- )?continue-on-error:\s*true/m.test(é.texte) || /^ {4}continue-on-error:\s*true/m.test(job.lignes.join('\n'));

/** Motif de l'appel nommé : il ne désigne que « n4 [niveau 4] » dans le fichier inventé. */
const NOMMÉ = 'n4';

/** Efface ce que les lancements ont laissé : dossiers inventés des paquets vitest, dossier jetable. */
function nettoyer() {
  for (const d of dossiersVitest) rmSync(d, { recursive: true, force: true });
  dossiersVitest.length = 0;
  if (dossierTemporaire) rmSync(dossierTemporaire, { recursive: true, force: true });
  dossierTemporaire = undefined;
}

/** Les lancements de chaque suite ; chacune ne lance que les siens. */
const LANCEMENTS_1 = [...Object.keys(PAQUETS).map((p) => `${p}:1`), 'interface:1+nav'];
const LANCEMENTS_2 = ['garde', 'cœur'].flatMap((p) => [`${p}:défaut`, `${p}:2`, `${p}:4`, `${p}:nommé`]);

// ─── Les tests ───────────────────────────────────────────────────────────────────────────────────

describe('[niveau 1] D83, principe 10.1 · au Ready, la CI joue tout ce qui garde une promesse (#232)', () => {
  // Tout part d'avance ; chaque test attend le sien, et un lancement en échec ne rougit que ses tests.
  before(() => {
    for (const l of LANCEMENTS_1) scénarios[l]().catch(() => {});
  });
  after(nettoyer);

  for (const [paquet, { exécuteur }] of Object.entries(PAQUETS)) {
    if (paquet === 'interface') continue;
    const nom = exécuteur === 'vitest' ? 'vitest' : 'node --test';
    test(`${paquet} (${nom}) : au seuil 1, les tests de niveau 1 ou moins`, async () => {
      constater(await scénarios[`${paquet}:1`](), 1, `${paquet}, \`pnpm test 1\``);
    });
  }

  test('interface (vitest) : sans l’option, les tests navigateur sont écartés, et la sortie dit ce qu’elle compte', async () => {
    const r = await scénarios['interface:1']();
    assert.equal(r.code, 0, `interface, \`pnpm test 1\` : le lancement échoue\n${r.sortie.slice(-2000)}`);
    assert.deepEqual(r.joués, attendus(1), 'interface headless : au seuil 1, seuls les tests de niveau 1 ou moins (#232, points 1 et 3)');
    assert.deepEqual(r.navigateur, [], 'interface dans le navigateur : sans `--navigateur`, aucun test navigateur ne se joue (#232, point 3)');
    const lignes = r.sortie.split('\n');
    assert.ok(lignes.some((l) => /navigateur/i.test(l) && /écart/i.test(l)), `interface : sans \`--navigateur\`, la sortie dit que les tests navigateur sont écartés (#232, point 3)\n${r.sortie.slice(-1500)}`);
    // La ligne dit ce qu'elle compte : des fichiers et des tests écrits, sans les exécuter ; la
    // boucle compte pour un. Qu'elle ne présente pas ce nombre comme celui des tests exécutés reste
    // à la relecture.
    assert.ok(
      lignes.some((l) => /navigateur/i.test(l) && /écart/i.test(l) && /fichier/i.test(l) && /écrit/i.test(l) && new RegExp(`(?<!\\d)${NAVIGATEUR_ÉCRITS}(?!\\d)`).test(l)),
      `interface : sans \`--navigateur\`, la ligne dit ce qu'elle compte — des fichiers et des tests écrits : ici ${NAVIGATEUR_ÉCRITS} tests écrits, la boucle comptant pour un (#232, point 3)\n${lignes.filter((l) => /navigateur/i.test(l)).join('\n')}`,
    );
  });

  test('interface (vitest) : avec l’option, les tests navigateur se jouent au seuil', async () => {
    const r = await scénarios['interface:1+nav']();
    constater(r, 1, 'interface, `pnpm test 1 --navigateur`');
    assert.deepEqual(r.navigateur, [...attendus(1), 'b1', 'b2'].sort(), 'interface dans le navigateur : avec `--navigateur`, au seuil 1, seuls les tests de niveau 1 ou moins (#232, points 1 et 3)');
  });

  test('témoin rouge · un seuil 1 qui laisse de côté un test de niveau 0 ou 1 fait échouer le constat', () => {
    for (const oublié of attendus(1)) {
      const joués = attendus(1).filter((id) => id !== oublié);
      const écartés = FIXTURE.length - joués.length;
      const r = { code: 0, joués, fichiers: 1, sortie: `seuil 1 : ${écartés} test(s) écarté(s), de niveau supérieur à 1.` };
      assert.throws(() => constater(r, 1, 'témoin'), /seuls les tests de niveau 1 ou moins/, `« ${oublié} » laissé de côté au seuil 1 passerait inaperçu`);
    }
  });

  // La CI, jouée à blanc.

  test('au Ready, la CI vérifie au seuil 1, et active les tests navigateur au seuil 2', () => {
    const tests = étapesDeTests(lire(CI), auReady);
    const suite = tests.filter((t) => !t.navigateur);
    assert.ok(suite.length, `${CI} : aucune étape ne joue les tests au passage en Ready`);
    for (const t of suite) assert.equal(t.seuil, 1, `${CI} : au Ready, « ${t.job.nom} » joue les tests au seuil ${t.seuil}, attendu 1 (#232, point 7)`);
    const navigateur = tests.filter((t) => t.navigateur && t.seuil === 2 && !laisseÉchouer(t.job, t.é));
    assert.ok(navigateur.length, `${CI} : au Ready, aucune étape bloquante n'active les tests navigateur (\`--navigateur\`) au seuil 2 (#232, point 7)`);
  });

  test('au Ready, une étape bloquante joue le harnais du besoin, par sa définition commune', () => {
    const joués = jouer(lire(CI), auReady).flatMap((job) => job.joués.map((é) => ({ job, é })));
    const harnais = joués.filter(({ é }) => /harnais-du-besoin/.test(déplier(commande(é))));
    assert.ok(harnais.length, `${CI} : au Ready, aucune étape ne joue le harnais du besoin (définition de D83, \`.githooks/harnais-du-besoin.sh\`) (#232, point 9)`);
    for (const { job, é } of harnais) assert.ok(!laisseÉchouer(job, é), `${CI} : le harnais du besoin, dans « ${job.nom} », ne doit pas se laisser échouer (#232, point 9)`);
  });

  test('au tag v*, la CI vérifie au seuil 3, tests navigateur activés, avant de publier', () => {
    const yaml = lire(CI);
    const tag = étapesDeTests(yaml, auTag);
    const au3 = tag.filter((t) => t.seuil >= 3);
    assert.ok(au3.length, `${CI} : au tag v*, aucune étape ne joue les tests au seuil 3 (#232, point 8)`);
    assert.ok(au3.some((t) => t.navigateur), `${CI} : au tag v*, les tests au seuil 3 activent les tests navigateur (\`--navigateur\`) (#232, point 8)`);
    assert.ok(jouer(yaml, auTag).some((job) => job.joués.some(publie)), `${CI} : au tag v*, rien ne publie ; le harnais de #232 est à relire`);
    const rouges = new Set(au3.map((t) => t.é.texte));
    const publiéQuandMême = jouer(yaml, auTag, (é) => rouges.has(é.texte)).filter((job) => job.joués.some(publie)).map((j) => j.nom);
    assert.deepEqual(publiéQuandMême, [], `${CI} : au tag v*, un rouge au seuil 3 doit empêcher de publier (#232, point 8)`);
  });

  test('témoin rouge · une CI qui vérifie au seuil 0 au Ready, ou joue le harnais du besoin sans bloquer', () => {
    const yaml = lire(CI);
    assert.match(yaml, /pnpm test 1\b/, `${CI} : le témoin cherche « pnpm test 1 » ; il est à relire`);
    const au0 = étapesDeTests(yaml.replace(/pnpm test 1\b/g, 'pnpm test 0'), auReady).filter((t) => !t.navigateur);
    assert.ok(au0.some((t) => t.seuil !== 1), 'témoin : au seuil 0, le test du seuil 1 au Ready devrait échouer');
    const étape = jouer(yaml, auReady).flatMap((job) => job.joués.map((é) => ({ job, é }))).find(({ é }) => /harnais-du-besoin/.test(déplier(commande(é))));
    assert.ok(étape, `${CI} : le témoin cherche l'étape du harnais du besoin ; il est à relire`);
    const lâche = { ...étape.é, texte: `${étape.é.texte.replace(/\n*$/, '')}\n        continue-on-error: true\n` };
    assert.ok(laisseÉchouer(étape.job, lâche), 'témoin : un harnais du besoin qui se laisse échouer devrait rougir le test du Ready');
  });
});

describe('[niveau 2] D83 · les seuils, l’appel nommé et les crochets (#232)', () => {
  before(() => {
    for (const l of LANCEMENTS_2) scénarios[l]().catch(() => {});
    crochets().catch(() => {});
  });
  after(nettoyer);

  describe('le seuil et l’appel nommé, dans la garde et le cœur', () => {
    for (const paquet of ['garde', 'cœur']) {
      const exécuteur = PAQUETS[paquet].exécuteur === 'vitest' ? 'vitest' : 'node --test';
      test(`${paquet} (${exécuteur}) : sans seuil en entrée, le seuil est 2`, async () => {
        constater(await scénarios[`${paquet}:défaut`](), DÉFAUT, `${paquet}, \`pnpm test\` sans seuil`);
      });
      for (const s of [2, 4]) {
        test(`${paquet} (${exécuteur}) : au seuil ${s}, les tests de niveau ${s} ou moins`, async () => {
          constater(await scénarios[`${paquet}:${s}`](), s, `${paquet}, \`pnpm test ${s}\``);
        });
      }
      test(`${paquet} (${exécuteur}) : un test de niveau 4 appelé nommément se joue, seul`, async () => {
        const r = await scénarios[`${paquet}:nommé`]();
        assert.equal(r.code, 0, `${paquet}, appel nommé : le lancement échoue\n${r.sortie.slice(-2000)}`);
        assert.deepEqual(r.joués, ['n4'], `${paquet} : « n4 [niveau 4] », appelé par le filtre de nom de son exécuteur (motif « ${NOMMÉ} ») au seuil par défaut, se joue, et lui seul (#232, point 4)\n${r.sortie.slice(-1500)}`);
      });
    }
  });

  describe('les crochets : pré-commit et livraison', () => {
    test('le pré-commit vérifie au seuil 0 les paquets touchés', async () => {
      const { préCommit: r } = await crochets();
      assert.equal(r.code, 0, `pré-commit refusé\n${r.sortie.slice(-2000)}`);
      assert.deepEqual(r.ancien, attendus(0), 'pré-commit : la non-régression du paquet touché se joue au seuil 0 (#232, point 5)');
    });

    test('le pré-commit joue le harnais du besoin en entier, et les autres tests de la branche à leur niveau', async () => {
      const { préCommit: r } = await crochets();
      assert.deepEqual(r.nouveau, TOUT, 'pré-commit : le harnais du besoin — le fichier qui porte le numéro de l’issue — se joue en entier, niveau 4 compris (#232, point 9)');
      assert.deepEqual(r.codeur, attendus(0), 'pré-commit : un autre fichier de test que la branche ajoute n’est pas le harnais du besoin ; il se joue à son niveau, au seuil 0 (#232, point 9)');
    });

    test('la livraison vérifie au seuil 2, et joue le harnais du besoin en entier, lui seul', async () => {
      const { livraison: r } = await crochets();
      assert.equal(r.code, 0, `livraison (pré-push) refusée\n${r.sortie.slice(-2000)}`);
      assert.deepEqual(r.ancien, attendus(2), 'livraison : la non-régression se joue au seuil 2 (#232, point 6)');
      assert.deepEqual(r.nouveau, TOUT, 'livraison : le harnais du besoin — le fichier qui porte le numéro de l’issue — se joue en entier, niveau 4 compris (#232, point 9)');
      assert.deepEqual(r.codeur, attendus(2), 'livraison : un autre fichier de test que la branche ajoute n’est pas le harnais du besoin ; il se joue à son niveau, au seuil 2 (#232, point 9)');
    });

    test('la livraison d’un besoin fonctionnel vérifie l’interface au seuil 2, tests navigateur compris quand un navigateur est là', async () => {
      const { fonctionnel: r } = await crochets();
      assert.equal(r.code, 0, `livraison (pré-push) d'un besoin fonctionnel refusée\n${r.sortie.slice(-2000)}`);
      assert.deepEqual(r.web, attendus(2), 'livraison : les tests headless de l’interface se jouent au seuil 2 (#232, point 6)');
      if (r.nav.length) assert.deepEqual(r.nav, attendus(2), 'livraison : avec un navigateur, les tests navigateur se jouent au seuil 2 (#232, point 6)');
      else assert.ok(r.sortie.split('\n').some((l) => /navigateur/i.test(l)), `livraison : sans navigateur, elle le dit et laisse les tests navigateur à la CI (#232, point 6)\n${r.sortie.slice(-1500)}`);
    });
  });
});
