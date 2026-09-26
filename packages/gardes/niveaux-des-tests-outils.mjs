/**
 * Outils partagés des deux fichiers de #232 (#243) : `niveaux-des-tests.test.mjs`, harnais de la
 * garde, de niveau 1, et `niveaux-des-tests-seuils.test.js`, son second fichier, de niveaux 2 et 3,
 * hors des harnais de la garde (D81). Ce module ne déclare aucun test : il lit les niveaux, joue un
 * fichier de test inventé par l'exécuteur de chaque paquet, rejoue les crochets dans une copie du
 * dépôt, et joue `ci.yml` à blanc. Chaque lancement ne part qu'au premier test qui l'attend.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { RACINE, lireRegistre, temoinRouge, testNomme } from './gardes.mjs';
import { commande, jouer } from './workflow-a-blanc.mjs';


const NIVEAUX = Object.freeze([0, 1, 2, 3, 4]);
const MARQUE = /\[niveau ([0-4])\]/;
const DÉFAUT = 2;

const lire = (chemin) => readFileSync(join(RACINE, chemin), 'utf8').replace(/\r\n?/g, '\n');

// ─── Lire le niveau d'un test dans son fichier, sans l'exécuter ──────────────────────────────────

/** Commentaires effacés, intérieurs des chaînes et des expressions régulières masqués. */
function masquer(s) {
  const sortie = s.split('');
  const chaines = new Map();
  const effacer = (a, b) => {
    for (let k = a; k < b && k < s.length; k++) if (sortie[k] !== '\n') sortie[k] = ' ';
  };
  let dernier = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') {
      const fin = s.indexOf('\n', i);
      effacer(i, fin < 0 ? s.length : fin);
      i = fin < 0 ? s.length : fin;
    } else if (c === '/' && s[i + 1] === '*') {
      const fin = s.indexOf('*/', i + 2);
      effacer(i, fin < 0 ? s.length : fin + 2);
      i = fin < 0 ? s.length : fin + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length && s[j] !== c && (c === '`' || s[j] !== '\n')) {
        if (s[j] === '\\') j += 2;
        else if (c === '`' && s[j] === '$' && s[j + 1] === '{') {
          let p = 1;
          for (j += 2; j < s.length && p; j++) p += s[j] === '{' ? 1 : s[j] === '}' ? -1 : 0;
        } else j++;
      }
      chaines.set(i, s.slice(i + 1, j));
      effacer(i + 1, j);
      i = j + 1;
      dernier = 'a';
    } else if (c === '/' && ('(,=:[!&|?{};+-*%<>~^'.includes(dernier) || /\b(?:return|typeof|case|in|of)\s*$/.test(s.slice(Math.max(0, i - 10), i)))) {
      let j = i + 1;
      let classe = false;
      while (j < s.length && s[j] !== '\n' && (classe || s[j] !== '/')) {
        if (s[j] === '\\') j++;
        else if (s[j] === '[') classe = true;
        else if (s[j] === ']') classe = false;
        j++;
      }
      effacer(i + 1, j);
      i = j + 1;
      dernier = 'a';
    } else {
      if (!/\s/.test(c)) dernier = c;
      i++;
    }
  }
  return { masque: sortie.join(''), chaines };
}

function fermante(masque, ouvrante) {
  let p = 0;
  for (let i = ouvrante; i < masque.length; i++) {
    if ('([{'.includes(masque[i])) p++;
    else if (')]}'.includes(masque[i]) && --p === 0) return i;
  }
  return masque.length;
}

/**
 * Les appels de test d'un fichier (suites comprises) et leur niveau : marque du test, sinon de la
 * suite la plus proche qui l'englobe, sinon 2. Une suite porte aussi la liste de ses tests.
 */
function niveauxDesTests(source) {
  const { masque, chaines } = masquer(String(source));
  const appels = [];
  for (const m of masque.matchAll(/(?<![\w$.])(describe|suite|it|test)((?:\s*\.\s*[A-Za-z]+)*)\s*\(/g)) {
    if (/\bfunction\s*$/.test(masque.slice(Math.max(0, m.index - 12), m.index))) continue;
    let ouvrante = m.index + m[0].length - 1;
    let fin = fermante(masque, ouvrante);
    const premier = (o) => o + 1 + masque.slice(o + 1).match(/^\s*/)[0].length;
    const curry = !chaines.has(premier(ouvrante)) && masque.slice(fin + 1).match(/^\s*\(/);
    if (curry) {
      ouvrante = fin + curry[0].length;
      fin = fermante(masque, ouvrante);
    }
    const titre = chaines.get(premier(ouvrante));
    if (titre === undefined) continue;
    appels.push({ titre: titre.replace(/\s+/g, ' ').trim(), suite: m[1] === 'describe' || m[1] === 'suite', ouvrante, fin });
  }
  const parents = (a) => appels.filter((b) => b.suite && b !== a && b.ouvrante < a.ouvrante && a.ouvrante < b.fin).sort((x, y) => y.ouvrante - x.ouvrante);
  const marque = (a) => (MARQUE.test(a.titre) ? Number(a.titre.match(MARQUE)[1]) : undefined);
  const niveau = (a) => marque(a) ?? parents(a).map(marque).find((n) => n !== undefined) ?? DÉFAUT;
  return appels.map((a) => ({
    titre: a.titre,
    suite: a.suite,
    niveau: niveau(a),
    tests: a.suite ? appels.filter((t) => !t.suite && a.ouvrante < t.ouvrante && t.ouvrante < a.fin).map((t) => ({ titre: t.titre, niveau: niveau(t) })) : undefined,
    parents: parents(a).map((p) => ({ titre: p.titre, niveau: niveau(p) })),
  }));
}

// ─── La règle des harnais (point 10) ─────────────────────────────────────────────────────────────

const GARDÉ = (n) => n === 0 || n === 1;

/**
 * Les manquements d'un harnais de la garde ou du registre : un test hors des niveaux 0 et 1. Sans
 * nom, la règle vaut pour tout le fichier ; avec des noms (le test que nomme la ligne `Harnais`, et
 * son témoin), pour ces tests, leurs suites et, quand un nom désigne une suite, tous ses tests.
 */
function manquements(source, { fichier, noms = [] } = {}) {
  const tout = niveauxDesTests(source);
  const hors = (t) => `${fichier} : « ${t.titre} » est de niveau ${t.niveau} ; un test d'un harnais de la garde ou du registre est de niveau 0 ou 1 (#232, point 10).`;
  if (!noms.length) return tout.filter((t) => !t.suite && !GARDÉ(t.niveau)).map(hors);
  const vus = new Map();
  for (const nom of noms) {
    for (const a of tout.filter((t) => t.titre === nom)) {
      for (const t of [a, ...a.parents, ...(a.tests ?? [])]) if (!GARDÉ(t.niveau)) vus.set(t.titre, hors(t));
    }
  }
  return [...vus.values()];
}

/** Les harnais de la garde (fichiers entiers) et du registre (selon la portée de chaque ligne `Harnais`). */
function harnais() {
  const liste = [];
  const { entrees } = lireRegistre(lire('docs/gardes.md'));
  for (const e of entrees.values()) {
    for (const h of e.harnais) {
      const nommé = testNomme(h.description);
      const témoin = temoinRouge(h.description)?.nom;
      const noms = nommé ? [nommé, ...(témoin ? [témoin] : [])] : [];
      for (const c of h.chemins.filter((c) => /\.test\.[cm]?[jt]s$/.test(c) && existsSync(join(RACINE, c)))) liste.push({ fichier: c, noms, source: e.id });
    }
  }
  const gardes = execFileSync('git', ['ls-files', 'packages/gardes/*.test.mjs'], { cwd: RACINE, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of gardes) if (existsSync(join(RACINE, f))) liste.push({ fichier: f, noms: [], source: 'garde' });
  return liste;
}

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
  for (const s of NIVEAUX) scénarios[`${paquet}:${s}`] = mémo(() => jouerFixture(paquet, { seuil: s }));
  // Le motif ne porte ni espace ni caractère que pnpm ou le shell réécrit : l'appel nommé ne dépend que
  // de l'exécuteur (#243, point 5). « n4 » ne se trouve que dans le titre « n4 [niveau 4] ».
  scénarios[`${paquet}:nommé`] = mémo(() => jouerFixture(paquet, { nommé: NOMMÉ }));
}
for (const paquet of ['interface', 'relais', 'hébergement']) scénarios[`${paquet}:1`] = mémo(() => jouerFixture(paquet, { seuil: 1 }));
for (const paquet of ['interface', 'garde', 'cœur']) scénarios[`${paquet}:1+nav`] = mémo(() => jouerFixture(paquet, { seuil: 1, navigateur: true }));

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
export const NOMMÉ = 'n4';

/** Efface ce que les lancements ont laissé : dossiers inventés des paquets vitest, dossier jetable. */
export function nettoyer() {
  for (const d of dossiersVitest) rmSync(d, { recursive: true, force: true });
  dossiersVitest.length = 0;
  if (dossierTemporaire) rmSync(dossierTemporaire, { recursive: true, force: true });
  dossierTemporaire = undefined;
}

export {
  BRANCHE,
  CI,
  DÉFAUT,
  FIXTURE,
  NAVIGATEUR_ÉCRITS,
  NIVEAUX,
  PAQUETS,
  TOUT,
  attendus,
  auReady,
  auTag,
  commande,
  constater,
  crochets,
  déplier,
  harnais,
  jouer,
  laisseÉchouer,
  lire,
  manquements,
  niveauxDesTests,
  publie,
  scénarios,
  source,
  étapesDeTests,
};
