/**
 * Amorçage de #112, écrit par la session d'audit du 15 septembre 2026.
 *
 * #112 constate qu'un amorçage peut rougir **par construction** une fois fusionnée la PR qu'il
 * jugeait : ses lectures qui se comparent à la base de la PR perdent leur point de référence, et le
 * rouge qui en sort ne se distingue plus d'un vrai rouge. Le porteur a tranché la voie 3 le
 * 15 septembre : garder ce qui vaut pour toujours, retirer ce qui n'avait de sens que pendant la PR.
 *
 * Ce que ce fichier juge, en boîte noire, sans rien supposer de la forme retenue :
 *
 *   1. les amorçages qui lisent la base de la PR sortent le même verdict avec et sans
 *      `TIRELIRE_STRICT`, et ce verdict est vert ;
 *   2. le terme retiré par #107 reste absent du dépôt — la garantie que #112 demande de ne pas
 *      perdre en faisant le ménage ;
 *   3. ce qui est retiré est dit : une entrée nouvelle du journal des décisions nomme #112, la
 *      comparaison à la base, et ce qu'elle cesse de vérifier.
 *
 * Périmètre volontairement étroit sur la première lecture. Le « Fait quand » de #112 parle de
 * `pnpm amorcage` entier ; rejouer tout le dossier dans les deux modes coûte 136 s par passage sur
 * la machine de la session, pour un signal que l'atelier de la CI donne déjà en mode strict. La
 * lecture vise donc la famille en cause — celles qui lisent la base — et le reste du dossier
 * continue d'être jugé par l'atelier. Si plus aucun amorçage ne lit la base, la lecture le dit et
 * passe : la famille a disparu, il n'y a plus rien à garder de ce côté.
 *
 * Ce fichier est lui-même dans le champ de ses trois lectures : il s'exclut donc partout, et
 * n'écrit jamais le terme retiré en toutes lettres — il le compose, comme le fait l'amorçage de
 * #107. Une occurrence en clair ici rendrait la deuxième lecture rouge à jamais.
 *
 * Témoins. Les trois fonctions qui jugent sont pures et éprouvées sur des textes fabriqués : une
 * sortie de `node --test` dont on tire le nombre de rouges, une prose qui garde le terme retiré,
 * un journal des décisions où l'entrée manque, est muette, ou dit ce qu'il faut. Le reste lit une
 * configuration exacte, où un témoin n'ajouterait rien (D62).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER = 'amorcage';
const CE_FICHIER = 'amorcages-apres-fusion.test.mjs';
const RELIRE = "l'amorçage de #112 est à relire";
const DECISIONS = 'docs/decisions.md';

/** La dernière décision écrite avant #112 : ce qui vient après est l'entrée que #112 attend. */
const DERNIERE_DECISION = 69;

/** Le terme retiré par #107, composé pour que ce fichier ne le contienne pas. */
const MOTIF_RETIRE = ['m[', 'ée', ']ta[- ]?', 'harnais'].join('');
const retire = () => new RegExp(MOTIF_RETIRE, 'i');

/** Ce qui trahit une lecture comparée à la base de la PR. */
const LIT_LA_BASE = /merge-base|GITHUB_BASE_REF/;

/** Fichiers dont seul le chemin se lit : leur contenu n'est pas du texte. */
const BINAIRES = /\.(png|jpe?g|webp|gif|ico|svgz|pdf|jks|keystore|apk|aab|sqlite|zip|gz|woff2?|ttf|otf|bin)$/i;

// ─── Lire le dépôt ────────────────────────────────────────────────────────────────────────────

/**
 * L'environnement des processus fils : sans `GIT_*` hérité du crochet, qui ferait lire un autre
 * dépôt ; sans `NODE_TEST_CONTEXT`, que `node --test` refuse en cascade ; et **sans
 * `TIRELIRE_STRICT`**, que la CI pose pour tout le passage — sinon le mode « sans strict » n'en
 * serait pas un.
 */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([cle]) => !/^GIT_/.test(cle) && cle !== 'NODE_TEST_CONTEXT' && cle !== 'TIRELIRE_STRICT'),
);

function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: DEPOT, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

const lire = (chemin) => readFileSync(join(DEPOT, chemin), 'utf8');
const fichiersSuivis = () => (git('ls-files', '-z') ?? '').split('\0').filter(Boolean);

/** Les amorçages du dossier, celui-ci mis à part. */
const amorcages = () =>
  readdirSync(join(DEPOT, DOSSIER))
    .filter((fichier) => fichier.endsWith('.test.mjs') && fichier !== CE_FICHIER)
    .sort();

// ─── Les trois fonctions qui jugent ───────────────────────────────────────────────────────────

/** Le nombre de rouges annoncé par une sortie de `node --test`, `null` si elle ne l'annonce pas. */
function rougesDe(sortie) {
  const trouve = sortie.match(/^# fail (\d+)$/m);
  return trouve ? Number(trouve[1]) : null;
}

/** Les numéros de ligne où le terme retiré subsiste, vide si le texte est propre. */
function lignesFautives(texte) {
  const motif = retire();
  return texte
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((ligne, i) => (motif.test(ligne) ? i + 1 : 0))
    .filter(Boolean);
}

/** Les entrées du journal des décisions postérieures à un numéro donné, titre et corps réunis. */
function entreesApres(journal, numero) {
  const entrees = [];
  let courante = null;
  for (const ligne of journal.replace(/\r\n?/g, '\n').split('\n')) {
    const titre = ligne.match(/^##\s+D(\d+)\s+·\s*(.*)$/);
    if (titre) {
      courante = { numero: Number(titre[1]), texte: [titre[2]] };
      entrees.push(courante);
      continue;
    }
    if (/^##\s/.test(ligne)) courante = null;
    else if (courante) courante.texte.push(ligne);
  }
  return entrees
    .filter((entree) => entree.numero > numero)
    .map((entree) => ({ numero: entree.numero, texte: entree.texte.join('\n') }));
}

/** Ce qui manque à une entrée pour dire le retrait de #112 ; vide si elle le dit. */
function manquesDe(texte) {
  const manques = [];
  if (!/#112\b/.test(texte)) manques.push('elle ne cite pas #112');
  if (!/\bbase\b/i.test(texte)) manques.push('elle ne parle pas de la comparaison à la base');
  if (!/amor[çc]age/i.test(texte)) manques.push('elle ne parle pas des amorçages');
  if (!/retir|supprim|sans objet|ne v[ée]rifie plus|p[ée]rim/i.test(texte)) manques.push("elle ne dit pas ce qui n'est plus vérifié");
  return manques;
}

// ─── 1 · Le verdict des lectures périssables ──────────────────────────────────────────────────

/** Joue un amorçage et rend son nombre de rouges, dans l'un ou l'autre mode. */
function verdict(fichier, strict) {
  const env = strict ? { ...ENV, TIRELIRE_STRICT: '1' } : ENV;
  const joue = spawnSync(process.execPath, ['--test', join(DOSSIER, fichier)], {
    cwd: DEPOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const rouges = rougesDe(`${joue.stdout ?? ''}${joue.stderr ?? ''}`);
  assert.notEqual(rouges, null, `${fichier} ne dit pas son nombre de rouges :\n${(joue.stderr || joue.stdout || '').slice(-2000)}`);
  return rouges;
}

test('#112 · les amorçages qui lisent la base de la PR sont verts, dans les deux modes', (t) => {
  const familles = amorcages().filter((fichier) => LIT_LA_BASE.test(lire(`${DOSSIER}/${fichier}`)));
  if (!familles.length) {
    t.diagnostic("aucun amorçage ne lit la base de la PR : la famille périssable a disparu du dossier");
    return;
  }
  const ecarts = [];
  for (const fichier of familles) {
    const souple = verdict(fichier, false);
    const strict = verdict(fichier, true);
    if (souple !== strict) ecarts.push(`${fichier} · ${souple} rouge(s) sans TIRELIRE_STRICT, ${strict} avec : le mode change le verdict`);
    else if (strict) ecarts.push(`${fichier} · ${strict} rouge(s) dans les deux modes, alors que la PR qu'il jugeait est fusionnée`);
  }
  assert.deepEqual(
    ecarts,
    [],
    `des amorçages rougissent par construction, et un rouge permanent ne se distingue plus d'un vrai rouge :\n  ${ecarts.join('\n  ')}`,
  );
});

test('#112 · témoin : le nombre de rouges se lit dans la sortie de node --test', () => {
  assert.equal(rougesDe('# pass 7\n# fail 2\n# cancelled 0\n'), 2, `la lecture du verdict ne voit pas un rouge annoncé : ${RELIRE}`);
  assert.equal(rougesDe('# pass 9\n# fail 0\n'), 0, `la lecture du verdict ne voit pas un passage vert : ${RELIRE}`);
  assert.equal(rougesDe('node: command not found\n'), null, `la lecture du verdict invente un verdict là où il n'y en a pas : ${RELIRE}`);
});

// ─── 2 · Ce que le ménage ne doit pas emporter ────────────────────────────────────────────────

test('#112 · le terme retiré par #107 reste absent du dépôt, chemins compris', () => {
  const fichiers = fichiersSuivis();
  assert.ok(fichiers.length > 50, `git ne liste pas les fichiers du dépôt : ${RELIRE}`);
  const fautifs = [];
  for (const chemin of fichiers) {
    if (chemin === `${DOSSIER}/${CE_FICHIER}`) continue;
    if (retire().test(chemin)) {
      fautifs.push(`${chemin} · le chemin lui-même`);
      continue;
    }
    if (BINAIRES.test(chemin)) continue;
    let texte;
    try {
      texte = lire(chemin);
    } catch {
      continue; // suivi par git mais retiré de l'arbre de travail
    }
    if (texte.includes('\0')) continue;
    const lignes = lignesFautives(texte);
    if (lignes.length) fautifs.push(`${chemin} · lignes ${lignes.join(', ')}`);
  }
  assert.deepEqual(fautifs, [], `le terme retiré par #107 est revenu :\n  ${fautifs.join('\n  ')}`);
});

test('#112 · témoin : une prose qui garde le terme retiré est vue, une prose renommée passe', () => {
  const exemple = ['m', 'éta-', 'harnais'].join('');
  assert.deepEqual(lignesFautives(`les ${exemple}s vivent ici\n`), [1], `le balayage ne mord pas sur le terme retiré : ${RELIRE}`);
  assert.deepEqual(lignesFautives('les amorçages vivent ici\n'), [], `le balayage mord sur le mot du glossaire : ${RELIRE}`);
  assert.ok(retire().test(`${exemple.replace('é', 'e')}/x.test.mjs`), `le balayage ne voit pas le terme retiré dans un chemin : ${RELIRE}`);
});

// ─── 3 · Ce qui est retiré se dit ─────────────────────────────────────────────────────────────

test("#112 · une décision nouvelle dit ce que le retrait cesse de vérifier", () => {
  const entrees = entreesApres(lire(DECISIONS), DERNIERE_DECISION);
  assert.ok(
    entrees.length,
    `aucune entrée après D${DERNIERE_DECISION} dans ${DECISIONS} : le retrait de lectures ne laisse aucune trace de ce qui n'est plus vérifié (#112)`,
  );
  const manquesParEntree = entrees.map((entree) => ({ numero: entree.numero, manques: manquesDe(entree.texte) }));
  const dit = manquesParEntree.find(({ manques }) => !manques.length);
  assert.ok(
    dit,
    `aucune entrée nouvelle ne dit le retrait de #112 :\n  ${manquesParEntree
      .map(({ numero, manques }) => `D${numero} · ${manques.join(' ; ')}`)
      .join('\n  ')}`,
  );
});

test("#112 · témoin : une entrée muette est vue, une entrée qui dit le retrait passe", () => {
  const journal = (corps) => `## D69 · 2026-09-15 · Avant\n\nrien.\n\n## D70 · 2026-09-16 · Après\n\n${corps}\n`;
  assert.deepEqual(entreesApres(journal('x'), 69).map((e) => e.numero), [70], `la lecture du journal ne voit pas l'entrée nouvelle : ${RELIRE}`);
  assert.deepEqual(entreesApres(journal('x'), 70), [], `la lecture du journal compte une entrée déjà écrite : ${RELIRE}`);
  assert.ok(manquesDe('une entrée qui ne dit rien').length, `la lecture accepte une entrée muette : ${RELIRE}`);
  assert.deepEqual(
    manquesDe("#112 · les lectures d'un amorçage comparées à la base sont retirées à la fusion"),
    [],
    `la lecture refuse une entrée qui dit le retrait : ${RELIRE}`,
  );
});
