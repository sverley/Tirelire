/**
 * Amorçage de #113, écrit par la session d'audit du 15 septembre 2026.
 *
 * #113 ouvre un second axe à côté de celui du glossaire : non plus ce qu'un harnais garde, mais ce
 * qu'il lit, et donc où il peut s'exécuter. Le porteur a tranché le 15 septembre, dans le fil de
 * #113 : ce que le harnais lit le situe, et l'axe situe une commande (Q2, Q5) ; le local est
 * prioritaire ; le réseau interdit en local est celui qui sort de la machine (Q6) ; la garde tient
 * la règle en continu (Q3).
 *
 * Ce que ce fichier juge, en boîte noire, sans rien supposer de la forme retenue par le codeur :
 *
 *   1. l'en-tête de chaque workflow situe chacun de ses jobs, nommé par son identifiant entre
 *      accents graves, par l'un des trois libellés du « Fait quand » ; un job qui lance
 *      `pnpm test` ou `pnpm amorcage` lit des fichiers suivis, un job qui lance une commande
 *      `--github` ou `verifier.sh` lit hors d'eux, et `etiquette-en-cours.yml` est hors harnais ;
 *   2. une entrée du journal des décisions nomme #113 et écrit l'axe et la règle du travail local ;
 *   3. un harnais joué en local qui tente une connexion hors de la machine fait échouer son
 *      lanceur, même s'il intercepte l'erreur, et l'échec nomme l'hôte visé. Les lanceurs jugés
 *      sont le script `test` de chaque paquet du workspace — ceux qu'appellent `pnpm test` et le
 *      crochet de pré-commit — et `pnpm amorcage` ; `fetch` et `node:http` sont sondés séparément ;
 *   4. la boucle locale reste permise sur ces mêmes lanceurs ;
 *   5. le harnais que le codeur écrit sur sa garde, `gardes.test.mjs`, cite #113.
 *
 * Sondes. Le dépôt est copié une fois (fichiers suivis et non ignorés, comme les autres
 * amorçages), ses `node_modules` liés à ceux du dépôt, les autres amorçages retirés de la copie.
 * Chaque sonde y est posée, jouée par la commande qu'une personne taperait, filtrée par son nom,
 * puis retirée. L'environnement des lanceurs est nettoyé de `NODE_OPTIONS`, `NODE_TEST_CONTEXT` et
 * `TIRELIRE_STRICT` : une garde qui ne tiendrait que par l'environnement de ce fichier ne compte
 * pas. La sonde de sortie vise 192.0.2.10 (TEST-NET-1, RFC 5737, jamais routé) et intercepte toute
 * erreur : sans garde, elle passe, qu'il y ait un réseau ou non. Elle vise le port 80 : `fetch`
 * refuse d'emblée les ports de sa liste noire (le 9 en est), et la sonde ne tenterait alors rien.
 * L'adresse est composée à
 * l'exécution, pour qu'un extrait de code affiché par le lanceur ne la fasse pas apparaître à la
 * place du message de la garde.
 *
 * Hors programme (D62), à lire dans la PR : le budget de 30 s du crochet (D66), le sens inchangé
 * de « garde » et de « workflow », la prose de la décision au-delà de ses mots.
 *
 * Aucune lecture ne compare à la base de la PR (D70) : tout ce qui est lu ici reste vrai après la
 * fusion.
 *
 * Témoins. La lecture des en-têtes est pure et éprouvée sur des en-têtes fabriqués. Les sondes de
 * sortie ont le leur : la sonde de boucle locale, jouée par le même lanceur, doit passer — sans
 * quoi leur échec ne prouverait rien.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(DEPOT, '.github', 'workflows');
const HOTE = '192.0.2.10';
const NOM_SONDE = 'sonde-reseau-113';

// ─── 1. Les en-têtes des workflows ──────────────────────────────────────────────────────────────

const HORS_HARNAIS = 'hors harnais';
const HORS_SUIVIS = 'lit hors des fichiers suivis';
const SUIVIS = 'lit des fichiers suivis';

const LIBELLES = [
  [HORS_HARNAIS, /\bhors[ -]harnais\b/i],
  [HORS_SUIVIS, /\b(?:lit|lisent)\s+hors\s+des\s+fichiers\s+suivis\b/i],
  [SUIVIS, /\b(?:lit|lisent)\s+(?:que\s+|seulement\s+|uniquement\s+)?des\s+fichiers\s+suivis\b/i],
];

const placesDans = (texte) => LIBELLES.filter(([, motif]) => motif.test(texte)).map(([place]) => place);

/** Le commentaire de tête : lignes `#` et vides, la ligne `name:` tolérée, jusqu'à la première clé. */
function enTete(source) {
  const lignes = [];
  for (const ligne of source.split(/\r?\n/)) {
    if (/^\s*#/.test(ligne)) lignes.push(ligne.replace(/^\s*#\s?/, ''));
    else if (!ligne.trim()) lignes.push('');
    else if (/^name\s*:/.test(ligne)) continue;
    else break;
  }
  return lignes;
}

/** Paragraphes et puces du commentaire de tête. */
function blocs(lignes) {
  const res = [];
  let courant = [];
  const clore = () => {
    if (courant.length) res.push(courant.join(' '));
    courant = [];
  };
  for (const ligne of lignes) {
    if (!ligne.trim()) { clore(); continue; }
    if (/^\s*[-*]\s+/.test(ligne)) clore();
    courant.push(ligne.trim());
  }
  clore();
  return res;
}

/** Les jobs d'un workflow : identifiant et corps. */
function jobsDe(source) {
  const lignes = source.split(/\r?\n/);
  const debut = lignes.findIndex((l) => /^jobs\s*:/.test(l));
  if (debut < 0) return [];
  const jobs = [];
  let retrait = null;
  let courant = null;
  for (const ligne of lignes.slice(debut + 1)) {
    if (/^[^\s#]/.test(ligne)) break;
    if (!ligne.trim() || /^\s*#/.test(ligne)) { if (courant) courant.corps += `${ligne}\n`; continue; }
    const r = ligne.match(/^\s*/)[0].length;
    if (retrait === null) retrait = r;
    const cle = r === retrait && /^\s*([A-Za-z0-9_-]+)\s*:/.exec(ligne);
    if (cle) { courant = { id: cle[1], corps: '' }; jobs.push(courant); continue; }
    if (courant) courant.corps += `${ligne}\n`;
  }
  return jobs;
}

/** La place qu'un job doit porter d'après ce qu'il lance, quand elle se déduit. */
function placeAttendue(fichier, corps) {
  if (fichier === 'etiquette-en-cours.yml') return HORS_HARNAIS;
  if (/--github\b|verifier\.sh\b/.test(corps)) return HORS_SUIVIS;
  if (/\bpnpm\b[^\n]*\s(?:test|amorcage)\b/.test(corps)) return SUIVIS;
  return null;
}

/** Les écarts d'un workflow : job non situé, situé deux fois, ou situé à tort. */
function ecartsDuWorkflow(fichier, source) {
  const paragraphes = blocs(enTete(source));
  const ecarts = [];
  for (const { id, corps } of jobsDe(source)) {
    const marque = `\`${id}\``;
    const places = new Set();
    for (const bloc of paragraphes) {
      if (!bloc.includes(marque)) continue;
      const phrases = bloc.split(/[.;](?=\s|$)/).filter((p) => p.includes(marque));
      let trouvees = phrases.flatMap(placesDans);
      if (!trouvees.length) trouvees = placesDans(bloc);
      for (const p of trouvees) places.add(p);
    }
    if (!places.size) {
      ecarts.push(`${fichier} · job ${marque} : l'en-tête ne le situe pas (« ${SUIVIS} », « ${HORS_SUIVIS} » ou « ${HORS_HARNAIS} »)`);
      continue;
    }
    if (places.size > 1) {
      ecarts.push(`${fichier} · job ${marque} : l'en-tête lui donne plusieurs places (${[...places].join(', ')}) ; une phrase ou une puce par place`);
      continue;
    }
    const attendue = placeAttendue(fichier, corps);
    const [place] = places;
    if (attendue && place !== attendue) {
      ecarts.push(`${fichier} · job ${marque} : situé « ${place} », alors que ce qu'il lance le place « ${attendue} »`);
    }
  }
  return ecarts;
}

describe('témoins de la lecture des en-têtes', () => {
  const corps = `on: push\njobs:\n  test:\n    steps:\n      - run: pnpm test\n  livrer:\n    steps:\n      - run: pnpm build\n`;

  test('un en-tête qui situe chaque job passe', () => {
    const source = `name: X\n\n# Le job \`test\` lit des fichiers suivis.\n# - \`livrer\` est hors harnais.\n${corps}`;
    assert.deepEqual(ecartsDuWorkflow('x.yml', source), []);
  });

  test('un job absent de l’en-tête est signalé', () => {
    const source = `name: X\n# Le job \`test\` lit des fichiers suivis.\n${corps}`;
    const ecarts = ecartsDuWorkflow('x.yml', source);
    assert.equal(ecarts.length, 1);
    assert.match(ecarts[0], /`livrer` : l'en-tête ne le situe pas/);
  });

  test('« hors des fichiers suivis » ne compte pas pour « des fichiers suivis »', () => {
    const source = `# \`test\` lit hors des fichiers suivis.\n# \`livrer\` : hors harnais.\n${corps}`;
    assert.deepEqual(ecartsDuWorkflow('x.yml', source), [
      "x.yml · job `test` : situé « lit hors des fichiers suivis », alors que ce qu'il lance le place « lit des fichiers suivis »",
    ]);
  });

  test('deux places dans une même phrase sont refusées, deux phrases d’une puce non', () => {
    const ambigu = `# \`test\` et \`livrer\` : l'un lit des fichiers suivis, l'autre est hors harnais.\n${corps}`;
    assert.equal(ecartsDuWorkflow('x.yml', ambigu).length, 2);
    const net = `# - \`test\` lit des fichiers suivis ; \`livrer\` est hors harnais.\n${corps}`;
    assert.deepEqual(ecartsDuWorkflow('x.yml', net), []);
  });

  test('un commentaire placé après `on:` n’est pas l’en-tête', () => {
    const source = `name: X\non: push\n# \`test\` lit des fichiers suivis. \`livrer\` est hors harnais.\njobs:\n  test:\n    steps: []\n  livrer:\n    steps: []\n`;
    assert.equal(ecartsDuWorkflow('x.yml', source).length, 2);
  });
});

test('chaque workflow situe chacun de ses jobs sur l’axe de ce qu’il lit', () => {
  const fichiers = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort();
  assert.ok(fichiers.length, 'aucun workflow trouvé');
  const ecarts = fichiers.flatMap((f) => ecartsDuWorkflow(f, readFileSync(join(WORKFLOWS, f), 'utf8')));
  assert.deepEqual(ecarts, [], `workflows mal situés :\n${ecarts.join('\n')}`);
});

// ─── 2. La décision ─────────────────────────────────────────────────────────────────────────────

test('une entrée du journal des décisions nomme #113 et écrit l’axe et la règle du travail local', () => {
  const journal = readFileSync(join(DEPOT, 'docs', 'decisions.md'), 'utf8');
  const entrees = journal.split(/^## /m).filter((e) => /^D\d+\b/.test(e) && /#113\b/.test(e));
  assert.ok(entrees.length, 'aucune entrée de docs/decisions.md ne nomme #113');
  const texte = entrees.join('\n');
  const manques = [
    ['ce qu’un harnais lit : des fichiers suivis ou non', /fichiers suivis/i],
    ['l’axe situe une commande', /\bcommandes?\b/i],
    ['le local est prioritaire', /priorit(?:é|aire)/i],
    ['le réseau interdit est celui qui sort de la machine', /(?:hors de|sort\w* de) la machine/i],
    ['la boucle locale reste permise', /boucle locale/i],
    ['la règle vaut pour les crochets', /crochet/i],
    ['la règle vaut pour `pnpm test`', /pnpm test\b/],
    ['la règle vaut pour `pnpm amorcage`', /pnpm amorcage\b/],
  ].filter(([, motif]) => !motif.test(texte)).map(([quoi]) => quoi);
  assert.deepEqual(manques, [], `l'entrée de #113 ne dit pas :\n${manques.join('\n')}`);
});

test('le harnais de la garde, gardes.test.mjs, cite #113', () => {
  const source = readFileSync(join(DEPOT, 'packages', 'gardes', 'gardes.test.mjs'), 'utf8');
  assert.match(source, /#113\b/, 'packages/gardes/gardes.test.mjs ne cite pas #113');
});

// ─── 3 et 4. Les sondes ─────────────────────────────────────────────────────────────────────────

const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([cle]) =>
    !/^GIT_/.test(cle) && !['NODE_OPTIONS', 'NODE_TEST_CONTEXT', 'TIRELIRE_STRICT'].includes(cle)),
);

/** `pnpm`, celui qui joue ce fichier quand il y en a un. */
function pnpm(args, cwd) {
  const chemin = process.env.npm_execpath;
  const [cmd, avant] = chemin && /pnpm/.test(chemin) && /\.[cm]?js$/.test(chemin)
    ? [process.execPath, [chemin]]
    : ['pnpm', []];
  const r = spawnSync(cmd, [...avant, ...args], { cwd, env: ENV, encoding: 'utf8', timeout: 300_000 });
  return { code: r.status ?? 1, sortie: `${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}` };
}

const CORPS_SONDES = {
  fetch: `
async function sonde() {
  const hote = [192, 0, 2, 10].join('.');
  try { await fetch('http://' + hote + ':80/', { signal: AbortSignal.timeout(400) }); } catch {}
}`,
  http: `
async function sonde() {
  const hote = [192, 0, 2, 10].join('.');
  await new Promise((fin) => {
    try {
      const requete = http.get({ host: hote, port: 80, path: '/', timeout: 400 }, (r) => { r.resume(); fin(); });
      requete.on('timeout', () => requete.destroy());
      requete.on('error', () => fin());
      requete.on('close', () => fin());
    } catch { fin(); }
  });
}`,
  boucle: `
async function sonde() {
  const serveur = http.createServer((q, r) => r.end('ok'));
  await new Promise((fin) => serveur.listen(0, '127.0.0.1', fin));
  const port = serveur.address().port;
  try {
    const reponse = await fetch('http://127.0.0.1:' + port + '/', { headers: { connection: 'close' } });
    if ((await reponse.text()) !== 'ok') throw new Error('réponse inattendue de la boucle locale');
    await new Promise((fin, echec) => {
      http.get({ host: 'localhost', family: 4, port, agent: false }, (r) => { r.resume(); r.on('end', fin); })
        .on('error', echec);
    });
  } finally {
    serveur.closeAllConnections?.();
    await new Promise((fin) => serveur.close(() => fin()));
  }
}`,
};

const sourceSonde = (lanceur, genre) =>
  `import { test } from '${lanceur === 'vitest' ? 'vitest' : 'node:test'}';\nimport http from 'node:http';\n${CORPS_SONDES[genre]}\n\ntest('sonde de #113 : ${genre}', async () => { await sonde(); });\n`;

/** Les lanceurs à juger : le script `test` de chaque paquet, puis `pnpm amorcage`. */
function lanceurs() {
  const liste = [];
  for (const dossier of ['packages', 'apps']) {
    for (const nom of readdirSync(join(DEPOT, dossier)).sort()) {
      const manifeste = join(DEPOT, dossier, nom, 'package.json');
      if (!existsSync(manifeste)) continue;
      const paquet = JSON.parse(readFileSync(manifeste, 'utf8'));
      const script = paquet.scripts?.test;
      if (!script) continue;
      const genre = /\bvitest\b/.test(script) ? 'vitest' : /\bnode\b.*--test\b/.test(script) ? 'node' : null;
      liste.push({
        titre: `${paquet.name} (${script})`,
        genre,
        fichier: genre === 'vitest' ? join(dossier, nom, 'test', `${NOM_SONDE}.test.ts`) : join(dossier, nom, `${NOM_SONDE}.test.mjs`),
        args: ['--filter', paquet.name, 'test', genre === 'vitest' ? NOM_SONDE : `${NOM_SONDE}.test.mjs`],
      });
    }
  }
  liste.push({ titre: 'pnpm amorcage', genre: 'node', fichier: join('amorcage', `${NOM_SONDE}.test.mjs`), args: ['amorcage'] });
  return liste;
}

let copie = null;
function copierDepot() {
  if (copie) return copie;
  copie = mkdtempSync(join(tmpdir(), 'tirelire-lecture-locale-'));
  const liste = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: DEPOT, env: ENV, encoding: 'utf8',
  }).split('\0').filter(Boolean);
  for (const fichier of liste) {
    const source = join(DEPOT, fichier);
    if (!existsSync(source)) continue;
    mkdirSync(dirname(join(copie, fichier)), { recursive: true });
    cpSync(source, join(copie, fichier));
  }
  for (const dossier of ['.', ...['packages', 'apps'].flatMap((d) => readdirSync(join(DEPOT, d)).map((n) => join(d, n)))]) {
    const modules = join(DEPOT, dossier, 'node_modules');
    if (existsSync(modules) && existsSync(join(copie, dossier))) symlinkSync(modules, join(copie, dossier, 'node_modules'), 'dir');
  }
  for (const f of readdirSync(join(copie, 'amorcage'))) if (/\.test\.mjs$/.test(f)) rmSync(join(copie, 'amorcage', f));
  return copie;
}
after(() => { if (copie) rmSync(copie, { recursive: true, force: true }); });

function jouerSonde(lanceur, genre) {
  const racine = copierDepot();
  const chemin = join(racine, lanceur.fichier);
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, sourceSonde(lanceur.genre, genre));
  try {
    return pnpm(lanceur.args, racine);
  } finally {
    rmSync(chemin, { force: true });
  }
}

const fin = (sortie) => sortie.trim().split('\n').slice(-25).join('\n');

for (const lanceur of lanceurs()) {
  describe(`lanceur ${lanceur.titre}`, () => {
    test('le lanceur est reconnu', () => {
      assert.ok(lanceur.genre, `${lanceur.titre} : ni vitest ni node --test, la sonde ne sait pas s'y poser`);
    });
    if (!lanceur.genre) return;

    test('la boucle locale reste permise', () => {
      const { code, sortie } = jouerSonde(lanceur, 'boucle');
      assert.equal(code, 0, `${lanceur.titre} : la sonde de boucle locale échoue\n${fin(sortie)}`);
    });

    for (const genre of ['fetch', 'http']) {
      test(`une connexion hors de la machine par ${genre}, même interceptée, fait échouer le lanceur en nommant l’hôte`, () => {
        const { code, sortie } = jouerSonde(lanceur, genre);
        assert.notEqual(code, 0, `${lanceur.titre} : la sonde ${genre} a visé ${HOTE} et le lanceur passe\n${fin(sortie)}`);
        assert.ok(sortie.includes(HOTE), `${lanceur.titre} : le lanceur échoue sans nommer ${HOTE}\n${fin(sortie)}`);
      });
    }
  });
}
