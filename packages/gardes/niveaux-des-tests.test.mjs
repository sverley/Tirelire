/**
 * Harnais d'audit de #232 : chaque test a un niveau de vérification ; les règles des harnais sont
 * gardées. Écrit par l'auditeur.
 *
 * **Le contrat**, proposé par l'auditeur et accepté par le porteur dans #232 (« c'est parfait »), les
 * niveaux renommés à la manière des journaux :
 *
 * - un test déclare son niveau dans son titre, par la marque `[FATAL]`, `[ERROR]`, `[WARN]`,
 *   `[INFO]` ou `[DEBUG]` ; la marque du test l'emporte, sinon celle de la suite la plus proche qui
 *   l'englobe (`describe`) ; sans marque, il est ERROR. Le niveau se lit donc dans le fichier, sans
 *   l'exécuter ;
 * - l'outil de test prend le niveau en entrée, par la variable `TIRELIRE_VERIFICATION` : au seuil X,
 *   `pnpm test` (et le script `test` de chaque paquet) ne joue que les tests de niveau X et plus
 *   graves, et dit combien il en écarte, sur une ligne qui parle d'« écarté(s) ». Sans entrée, le
 *   seuil est ERROR. DEBUG n'entre dans aucune chaîne ;
 * - un test s'appelle nommément par le filtre de nom de son exécuteur : `-t` de vitest,
 *   `--test-name-pattern` de `node --test`. C'est la lecture de l'auditeur du point 4.
 *
 * Ce que ce fichier vérifie, point par point du « Fait quand » :
 *
 * - 1 à 4 et 8 : un fichier de test inventé, qui porte chaque niveau, est joué par l'exécuteur de
 *   chaque ensemble — cœur et interface (vitest, interface dans le navigateur comprise), garde,
 *   relais et hébergement (`node --test`) — à chaque seuil, et nommément ; chaque test joué se note
 *   dans un fichier témoin. Le cœur et la garde font la matrice complète ; l'interface, le relais et
 *   l'hébergement, un seuil chacun (WARN) ;
 * - 5 et 9 (crochets) : dans une copie du dépôt, sans ses tests, un test déjà sur `main` (la
 *   non-régression) et un test que la branche ajoute (le harnais du besoin, définition de D83) sont
 *   joués par le vrai pré-commit, puis par la vraie livraison (pré-push) ;
 * - 6, 7 et 9 (CI) : `ci.yml` est joué à blanc (`workflow-a-blanc.mjs`) au passage en Ready et au
 *   tag `v*` ;
 * - 10 : les règles des harnais, sur le dépôt réel, chacune avec son témoin rouge.
 *
 * Ce qui reste à la relecture : les durées attendues de la livraison (6), l'exécution « en entier »
 * du harnais du besoin au Ready (9 : le fichier constate seulement qu'une étape bloquante le joue,
 * par sa définition commune), les documents (11, 12).
 *
 * Niveau de ses tests, choisi comme la criticité d'un message de journal (le porteur, #232) : si ce
 * test échoue, quel message l'outil écrirait-il ? Ici, chaque échec dit que la chaîne de vérification
 * ne tient plus ce que D83 lui demande — des tests joués ou écartés à tort, un harnais du besoin
 * tronqué, une publication non vérifiée, une règle des harnais qui ne mord plus : une erreur qui
 * demande une intervention, ERROR, le défaut, sans marque. Aucun n'est une défaillance critique qui
 * arrêterait le système (FATAL), ni un simple problème potentiel (WARN). La durée d'un test n'entre
 * jamais dans ce choix : un test trop long est au porteur à traiter, pas à déclasser.
 *
 * Aujourd'hui, aucun test n'a de niveau : tout se joue, DEBUG compris. Les points 1 à 9 sont donc
 * rouges ; les règles du point 10 sont vertes sur le dépôt, et leurs témoins rouges échouent comme
 * attendu. `node:test` n'a pas de `test.fails` : l'échec attendu d'un témoin tient dans une assertion
 * (docs/gardes.md, #66).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { RACINE, lireRegistre, testNomme } from './gardes.mjs';
import { commande, interpoler, jouer } from './workflow-a-blanc.mjs';

const VARIABLE = 'TIRELIRE_VERIFICATION';
/** Du moins grave au plus grave. */
const NIVEAUX = Object.freeze(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
const gravité = (n) => NIVEAUX.indexOf(n);
const MARQUE = /\[(FATAL|ERROR|WARN|INFO|DEBUG)\]/;
const DÉFAUT = 'ERROR';

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

/** Les tests d'un fichier et leur niveau : marque du test, sinon de la suite la plus proche, sinon ERROR. */
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
  const niveau = (a) => {
    const propre = a.titre.match(MARQUE)?.[1];
    if (propre) return propre;
    const parents = appels.filter((b) => b.suite && b !== a && b.ouvrante < a.ouvrante && a.ouvrante < b.fin).sort((x, y) => y.ouvrante - x.ouvrante);
    for (const p of parents) {
      const n = p.titre.match(MARQUE)?.[1];
      if (n) return n;
    }
    return DÉFAUT;
  };
  const englobés = (s) => appels.filter((a) => !a.suite && s.ouvrante < a.ouvrante && a.ouvrante < s.fin);
  return appels.map((a) => ({ titre: a.titre, suite: a.suite, niveau: niveau(a), tests: a.suite ? englobés(a).map((t) => ({ titre: t.titre, niveau: niveau(t) })) : undefined }));
}

// ─── Les règles des harnais (point 10) ───────────────────────────────────────────────────────────

const TRANCHE = new Set(['ERROR', 'FATAL']);

/**
 * Les manquements d'un harnais aux règles de #232 : aucun test INFO ni DEBUG ; au moins un test
 * ERROR ou FATAL, et, quand le registre nomme un test, ce test-là (ou, pour une suite, l'un des
 * siens) est ERROR ou FATAL : c'est lui qui tranche ce que le harnais garde (principe 10.1).
 */
function manquements(source, { fichier, nommé = null } = {}) {
  const tout = niveauxDesTests(source);
  const tests = tout.filter((t) => !t.suite);
  const m = [];
  for (const t of tests) if (t.niveau === 'INFO' || t.niveau === 'DEBUG') m.push(`${fichier} : « ${t.titre} » est ${t.niveau} ; un harnais n'a aucun test INFO ni DEBUG.`);
  if (nommé) {
    const cible = tout.find((t) => t.titre === nommé);
    if (cible) {
      const tranchants = cible.suite ? cible.tests.filter((t) => TRANCHE.has(t.niveau)) : TRANCHE.has(cible.niveau) ? [cible] : [];
      if (!tranchants.length) m.push(`${fichier} : « ${nommé} », que le registre nomme, n'est ni ERROR ni FATAL (${cible.suite ? 'aucun de ses tests' : cible.niveau}).`);
    }
  } else if (!tests.some((t) => TRANCHE.has(t.niveau))) {
    m.push(`${fichier} : aucun test ERROR ni FATAL ; chaque harnais en garde au moins un, celui qui tranche ce qu'il garde.`);
  }
  return m;
}

/** Les harnais du registre (fichiers de test que citent les lignes `Harnais`) et ceux de la garde. */
function harnais() {
  const liste = [];
  const { entrees } = lireRegistre(lire('docs/gardes.md'));
  for (const e of entrees.values()) {
    for (const h of e.harnais) {
      for (const c of h.chemins.filter((c) => /\.test\.[cm]?[jt]s$/.test(c) && existsSync(join(RACINE, c)))) {
        liste.push({ fichier: c, nommé: testNomme(h.description), source: `${e.id}` });
      }
    }
  }
  const gardes = execFileSync('git', ['ls-files', 'packages/gardes/*.test.mjs'], { cwd: RACINE, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of gardes) if (existsSync(join(RACINE, f))) liste.push({ fichier: f, nommé: null, source: 'garde' });
  return liste;
}

test('#232 · le niveau se lit dans le fichier : marque du test, sinon de la suite qui l’englobe, sinon ERROR', () => {
  const lus = Object.fromEntries(niveauxDesTests(source('node', 'lecture')).filter((t) => !t.suite).map((t) => [t.titre.split(' ')[0], t.niveau]));
  assert.deepEqual(lus, Object.fromEntries(FIXTURE.map((t) => [t.id, t.niveau])));
});

test('#232 · les harnais du registre et de la garde n’ont aucun test INFO ni DEBUG, et chacun a un test ERROR ou FATAL', () => {
  const liste = harnais();
  assert.ok(liste.some((h) => h.source !== 'garde'), 'aucun harnais du registre trouvé : le harnais de #232 est à relire');
  const m = liste.flatMap((h) => manquements(lire(h.fichier), h));
  assert.deepEqual(m, [], `règles des harnais (#232) :\n${m.join('\n')}`);
});

const harnaisSain = `
describe('garde [FATAL]', () => { it('tient', () => {}); });
test('tranche', () => {});
test('rétrocompatibilité [WARN]', () => {});
`;

test('témoin vert · un harnais FATAL, ERROR et WARN respecte les règles', () => {
  assert.deepEqual(manquements(harnaisSain, { fichier: 'sain' }), []);
  assert.deepEqual(manquements(harnaisSain, { fichier: 'sain', nommé: 'tranche' }), []);
});

test('témoin rouge · un harnais qui porte un test INFO', () => {
  assert.equal(manquements(`${harnaisSain}\ntest('détail [INFO]', () => {});`, { fichier: 'rouge' }).length, 1);
});

test('témoin rouge · un harnais qui porte un test DEBUG, par sa suite', () => {
  assert.equal(manquements(`${harnaisSain}\ndescribe('diagnostic [DEBUG]', () => { it('trace', () => {}); });`, { fichier: 'rouge' }).length, 1);
});

test('témoin rouge · un harnais dont aucun test n’est ERROR ni FATAL', () => {
  assert.equal(manquements(`describe('tout [WARN]', () => { it('a', () => {}); it('b', () => {}); });`, { fichier: 'rouge' }).length, 1);
});

test('témoin rouge · un test nommé au registre qui n’est que WARN', () => {
  assert.equal(manquements(harnaisSain, { fichier: 'rouge', nommé: 'rétrocompatibilité [WARN]' }).length, 1);
});

// ─── Un fichier de test inventé, qui porte chaque niveau (points 1 à 4, 8) ───────────────────────

/** Chaque test, son titre et le niveau qu'il déclare (ou reçoit de sa suite, ou du défaut). */
const FIXTURE = Object.freeze([
  { id: 'f', titre: 'f [FATAL]', niveau: 'FATAL' },
  { id: 'e', titre: 'e [ERROR]', niveau: 'ERROR' },
  { id: 'w', titre: 'w [WARN]', niveau: 'WARN' },
  { id: 'i', titre: 'i [INFO]', niveau: 'INFO' },
  { id: 'd', titre: 'd [DEBUG]', niveau: 'DEBUG' },
  { id: 's', titre: 's sans marque', niveau: 'ERROR' },
  { id: 'gw', titre: 'gw hérite de sa suite', niveau: 'WARN', suite: 'groupe [WARN]' },
  { id: 'gd', titre: 'gd [DEBUG]', niveau: 'DEBUG', suite: 'groupe [WARN]' },
  { id: 'gf', titre: 'gf [FATAL]', niveau: 'FATAL', suite: 'groupe [WARN]' },
  { id: 'gs', titre: 'gs hérite du défaut', niveau: 'ERROR', suite: 'groupe sans marque' },
]);

function source(exécuteur, nom) {
  const module = exécuteur === 'vitest' ? 'vitest' : 'node:test';
  const lignes = [
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

/** Ce qu'un seuil doit jouer : les tests de ce niveau et plus graves, jamais DEBUG. */
const attendus = (seuil) => FIXTURE.filter((t) => t.niveau !== 'DEBUG' && gravité(t.niveau) >= gravité(seuil)).map((t) => t.id).sort();

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
  for (const k of Object.keys(env)) if (k === VARIABLE || k === 'NODE_TEST_CONTEXT' || k.startsWith('VITEST') || k.startsWith('GIT_')) delete env[k];
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
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

const temporaire = mkdtempSync(join(tmpdir(), 'niveaux-232-'));
const dossiersVitest = [];
let compteur = 0;

/** Joue le fichier inventé par l'exécuteur d'un paquet ; rend les tests joués, triés, et la sortie. */
async function jouerFixture(nomPaquet, { seuil, nommé } = {}) {
  const { dossier, exécuteur } = PAQUETS[nomPaquet];
  const nom = `${nomPaquet}-${seuil ?? 'sans-seuil'}${nommé ? '-nomme' : ''}-${++compteur}`;
  const témoin = join(temporaire, `${nom}.temoin`);
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
    if (nomPaquet === 'interface') writeFileSync(join(racine, 'test', 'navigateur', 'niveaux.test.ts'), source('vitest', `${nom}-navigateur`));
    args = ['--dir', relatif, ...(nommé ? ['-t', nommé] : [])];
  } else {
    const fichier = join(temporaire, `${nom}.test.mjs`);
    writeFileSync(fichier, source('node', nom));
    args = [...(nommé ? [`--test-name-pattern=${nommé}`] : []), fichier];
  }
  const r = await lancer('pnpm', ['--dir', join(RACINE, dossier), 'run', 'test', ...args], {
    cwd: RACINE,
    env: environnement({ [VARIABLE]: seuil, NIVEAUX_TEMOIN: témoin }),
  });
  const notés = readFileSync(témoin, 'utf8').split('\n').filter(Boolean);
  const par = (préfixe) => notés.filter((l) => l.startsWith(`${préfixe}:`)).map((l) => l.slice(préfixe.length + 1)).sort();
  return { ...r, joués: par(nom), navigateur: par(`${nom}-navigateur`) };
}

const mémo = (f) => {
  let p;
  return () => (p ??= f());
};

const SEUILS = ['FATAL', 'ERROR', 'WARN', 'INFO'];
const scénarios = {};
for (const paquet of ['garde', 'cœur']) {
  scénarios[`${paquet}:défaut`] = mémo(() => jouerFixture(paquet));
  for (const s of SEUILS) scénarios[`${paquet}:${s}`] = mémo(() => jouerFixture(paquet, { seuil: s }));
  scénarios[`${paquet}:nommé`] = mémo(() => jouerFixture(paquet, { nommé: '^d \\[DEBUG\\]$' }));
}
for (const paquet of ['interface', 'relais', 'hébergement']) scénarios[`${paquet}:WARN`] = mémo(() => jouerFixture(paquet, { seuil: 'WARN' }));

/** L'écart se compte et se dit : une ligne qui parle d'écarté(s) porte le nombre attendu. */
function ditLÉcart(sortie, nombre) {
  return sortie.split('\n').some((l) => /écart/i.test(l) && new RegExp(`(?<!\\d)${nombre}(?!\\d)`).test(l));
}

function constater(r, seuil, étiquette) {
  const attendu = attendus(seuil);
  assert.equal(r.code, 0, `${étiquette} : le lancement échoue\n${r.sortie.slice(-2000)}`);
  assert.deepEqual(r.joués, attendu, `${étiquette} : au seuil ${seuil}, seuls les tests ${seuil} et plus graves se jouent, jamais DEBUG (#232, points 1, 3, 4)`);
  const écartés = FIXTURE.length - attendu.length;
  assert.ok(ditLÉcart(r.sortie, écartés), `${étiquette} : ${écartés} test(s) écarté(s) au seuil ${seuil}, à compter et à dire sur une ligne qui parle d'« écarté(s) » (#232, point 3)\n${r.sortie.slice(-1500)}`);
}

for (const paquet of ['garde', 'cœur']) {
  const exécuteur = PAQUETS[paquet].exécuteur === 'vitest' ? 'vitest' : 'node --test';
  test(`#232 · ${paquet} (${exécuteur}) : sans niveau en entrée, le seuil est ERROR`, async () => {
    constater(await scénarios[`${paquet}:défaut`](), DÉFAUT, `${paquet}, sans ${VARIABLE}`);
  });
  for (const s of SEUILS) {
    test(`#232 · ${paquet} (${exécuteur}) : au seuil ${s}, les tests ${s} et plus graves, DEBUG jamais`, async () => {
      constater(await scénarios[`${paquet}:${s}`](), s, `${paquet}, ${VARIABLE}=${s}`);
    });
  }
  test(`#232 · ${paquet} (${exécuteur}) : un test DEBUG appelé nommément se joue, seul`, async () => {
    const r = await scénarios[`${paquet}:nommé`]();
    assert.equal(r.code, 0, `${paquet}, appel nommé : le lancement échoue\n${r.sortie.slice(-2000)}`);
    assert.deepEqual(r.joués, ['d'], `${paquet} : « d [DEBUG] », appelé par le filtre de nom de son exécuteur, se joue, et lui seul (#232, point 4)`);
  });
}

for (const paquet of ['interface', 'relais', 'hébergement']) {
  const exécuteur = PAQUETS[paquet].exécuteur === 'vitest' ? 'vitest' : 'node --test';
  test(`#232 · ${paquet} (${exécuteur}) : l'ensemble respecte le seuil, ici WARN`, async () => {
    const r = await scénarios[`${paquet}:WARN`]();
    constater(r, 'WARN', `${paquet}, ${VARIABLE}=WARN`);
    if (paquet === 'interface') assert.deepEqual(r.navigateur, attendus('WARN'), `interface dans le navigateur : au seuil WARN, seuls les tests WARN et plus graves (#232, point 1)`);
  });
}

// ─── Les crochets : pré-commit et livraison (points 5 et 9) ──────────────────────────────────────

/**
 * Une copie du dépôt tel que la copie de travail le porte, sans ses tests : un test déjà sur `main`
 * (`ancien`, la non-régression), puis un test que la branche ajoute (`nouveau`, le harnais du
 * besoin). Le pré-commit juge l'index, la livraison le commit poussé.
 */
const crochets = mémo(async () => {
  const dépôt = join(temporaire, 'depot');
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
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'besoin');
  execFileSync('node', [join(RACINE, '.githooks/extraire.mjs'), RACINE, dépôt], { env: environnement() });
  writeFileSync(join(dépôt, 'packages/gardes/nouveau.test.mjs'), source('node', 'nouveau'));
  git('add', 'packages/gardes/nouveau.test.mjs');

  const témoinCommit = join(temporaire, 'pre-commit.temoin');
  writeFileSync(témoinCommit, '');
  const préCommit = await lancer('sh', ['.githooks/pre-commit'], { cwd: dépôt, env: environnement({ NIVEAUX_TEMOIN: témoinCommit }) });
  git('commit', '-q', '--no-verify', '-m', 'besoin');
  const sha = git('rev-parse', 'HEAD');

  const témoinPush = join(temporaire, 'pre-push.temoin');
  writeFileSync(témoinPush, '');
  const livraison = await lancer('sh', ['.githooks/livraison.sh', 'push', 'refs/heads/besoin', sha, 'refs/heads/besoin', '0'.repeat(40)], {
    cwd: dépôt,
    env: environnement({ NIVEAUX_TEMOIN: témoinPush }),
  });
  const lu = (f) => {
    const l = readFileSync(f, 'utf8').split('\n').filter(Boolean);
    const de = (n) => l.filter((x) => x.startsWith(`${n}:`)).map((x) => x.slice(n.length + 1)).sort();
    return { ancien: de('ancien'), nouveau: de('nouveau') };
  };
  return { préCommit: { ...préCommit, ...lu(témoinCommit) }, livraison: { ...livraison, ...lu(témoinPush) } };
});

const TOUT = FIXTURE.map((t) => t.id).sort();

test('#232 · le pré-commit vérifie au seuil FATAL les paquets touchés, dans son budget de 5 s', async () => {
  const { préCommit: r } = await crochets();
  assert.equal(r.code, 0, `pré-commit refusé\n${r.sortie.slice(-2000)}`);
  assert.deepEqual(r.ancien, attendus('FATAL'), 'pré-commit : la non-régression du paquet touché se joue au seuil FATAL (#232, point 5)');
  assert.ok(r.ms < 5000, `pré-commit : ${r.ms} ms, au-delà de son budget de 5 s (#232, point 5)`);
});

test('#232 · le pré-commit joue le harnais du besoin en entier, DEBUG compris', async () => {
  const { préCommit: r } = await crochets();
  assert.deepEqual(r.nouveau, TOUT, 'pré-commit : le harnais du besoin se joue en entier, tous niveaux, DEBUG compris (#232, point 9)');
});

test('#232 · la livraison vérifie au seuil ERROR, et joue le harnais du besoin en entier', async () => {
  const { livraison: r } = await crochets();
  assert.equal(r.code, 0, `livraison (pré-push) refusée\n${r.sortie.slice(-2000)}`);
  assert.deepEqual(r.ancien, attendus('ERROR'), 'livraison : la non-régression se joue au seuil ERROR (#232, point 6)');
  assert.deepEqual(r.nouveau, TOUT, 'livraison : le harnais du besoin se joue en entier, DEBUG compris (#232, point 9)');
});

// ─── La CI, jouée à blanc (points 6, 7 et 9) ─────────────────────────────────────────────────────

const CI = '.github/workflows/ci.yml';
const scripts = JSON.parse(lire('package.json')).scripts ?? {};

/** La commande d'une étape, les scripts `pnpm <script>` de la racine dépliés d'un niveau. */
function déplier(texte) {
  let t = texte;
  for (const m of texte.matchAll(/\bpnpm\s+(?:run\s+)?([\w:.-]+)/g)) if (scripts[m[1]]) t += `\n${scripts[m[1]]}`;
  return t;
}
const joueLesTests = (é) => /\bpnpm\s+(?:-r\s+|--recursive\s+)?(?:run\s+)?test\b/.test(déplier(commande(é)));

/** Un bloc `env:` à ce renfoncement : clé → valeur, interpolée. */
function envDe(lignes, motif, ctx) {
  const i = lignes.findIndex((l) => motif.test(l));
  if (i < 0) return {};
  const colonne = lignes[i].search(/\S/) + (/^\s*- /.test(lignes[i]) ? 2 : 0);
  const env = {};
  for (const l of lignes.slice(i + 1)) {
    if (!l.trim() || l.trim().startsWith('#')) continue;
    if (l.search(/\S/) <= colonne) break;
    const m = l.match(/^\s*([A-Za-z_][\w]*)\s*:\s*(.*)$/);
    if (m) env[m[1]] = interpoler(m[2], ctx);
  }
  return env;
}

/** Le seuil d'une étape qui joue les tests : en ligne, puis l'étape, le job, le workflow ; ERROR sinon. */
function seuilDe(yaml, job, é, ctx) {
  const enLigne = déplier(commande(é)).match(new RegExp(`\\b${VARIABLE}=["']?([A-Z]+)`))?.[1];
  if (enLigne) return enLigne;
  const tête = yaml.split('\n');
  const workflow = envDe(tête.slice(0, tête.findIndex((l) => /^jobs:\s*$/.test(l))), /^env:\s*$/, ctx);
  const duJob = envDe(job.lignes, /^ {4}env:\s*$/, ctx);
  const deLÉtape = envDe(é.lignes, /^(?: {6}- | {8})env:\s*$/, ctx);
  return deLÉtape[VARIABLE] || duJob[VARIABLE] || workflow[VARIABLE] || DÉFAUT;
}

const auReady = {
  github: { event_name: 'pull_request', ref: 'refs/pull/232/merge', event: { action: 'ready_for_review', pull_request: { number: 232, draft: false, head: { sha: 'a'.repeat(40) } } } },
  vars: {},
  secrets: {},
  inputs: {},
};
const auTag = { github: { event_name: 'push', ref: 'refs/tags/v1.0.0', event: {} }, vars: {}, secrets: {}, inputs: {} };

const étapesDeTests = (yaml, ctx, échoue) =>
  jouer(yaml, ctx, échoue).flatMap((job) => job.joués.filter(joueLesTests).map((é) => ({ job, é, seuil: seuilDe(yaml, job, é, ctx) })));
const publie = (é) => /uses:\s*softprops\/action-gh-release@|deposer\.sh/.test(é.texte);

test('#232 · au Ready, la CI vérifie au seuil ERROR', () => {
  const yaml = lire(CI);
  const tests = étapesDeTests(yaml, auReady);
  assert.ok(tests.length, `${CI} : aucune étape ne joue les tests au passage en Ready`);
  for (const t of tests) assert.equal(t.seuil, 'ERROR', `${CI} : au Ready, « ${t.job.nom} » joue les tests au seuil ${t.seuil}, attendu ERROR (#232, point 6)`);
});

test('#232 · au Ready, une étape bloquante joue le harnais du besoin, par sa définition commune', () => {
  const yaml = lire(CI);
  const joués = jouer(yaml, auReady).flatMap((job) => job.joués.map((é) => ({ job, é })));
  const harnais = joués.filter(({ é }) => /harnais-du-besoin/.test(déplier(commande(é))));
  assert.ok(harnais.length, `${CI} : au Ready, aucune étape ne joue le harnais du besoin (définition de D83, \`.githooks/harnais-du-besoin.sh\`) (#232, point 9)`);
  for (const { job, é } of harnais) assert.ok(!/^ +(?:- )?continue-on-error:\s*true/m.test(é.texte) && !/^ {4}continue-on-error:\s*true/m.test(job.lignes.join('\n')), `${CI} : le harnais du besoin, dans « ${job.nom} », ne doit pas se laisser échouer (#232, point 9)`);
});

test('#232 · au tag v*, la CI vérifie au seuil WARN avant de publier', () => {
  const yaml = lire(CI);
  const warn = étapesDeTests(yaml, auTag).filter((t) => gravité(t.seuil) <= gravité('WARN') && t.seuil !== 'DEBUG');
  assert.ok(warn.length, `${CI} : au tag v*, aucune étape ne joue les tests au seuil WARN (#232, point 7)`);
  assert.ok(jouer(yaml, auTag).some((job) => job.joués.some(publie)), `${CI} : au tag v*, rien ne publie ; le harnais de #232 est à relire`);
  const rouges = new Set(warn.map((t) => t.é.texte));
  const publiéQuandMême = jouer(yaml, auTag, (é) => rouges.has(é.texte)).filter((job) => job.joués.some(publie)).map((j) => j.nom);
  assert.deepEqual(publiéQuandMême, [], `${CI} : au tag v*, un rouge au seuil WARN doit empêcher de publier (#232, point 7)`);
});

// ─── Lancements en parallèle, nettoyage ──────────────────────────────────────────────────────────

// Tout part d'avance ; chaque test attend le sien, et un lancement en échec ne rougit que ses tests.
before(() => {
  for (const s of [...Object.values(scénarios), crochets]) s().catch(() => {});
});

after(() => {
  for (const d of dossiersVitest) rmSync(d, { recursive: true, force: true });
  rmSync(temporaire, { recursive: true, force: true });
});
