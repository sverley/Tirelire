/**
 * Amorçage de #107, écrit par la session d'audit du 15 septembre 2026.
 *
 * #107 est un renommage : le glossaire, arrêté par le porteur le 14 septembre, nomme « amorçages »
 * les harnais qui jugent le codage des harnais de la garde, et le dépôt emploie encore l'ancien mot.
 * La livraison attendue ne change **aucun comportement** — c'est cela qu'il faut constater, et pas
 * seulement que le mot ait changé. Deux lectures portent le jugement, depuis #112 :
 *
 *   1. l'ancien mot a disparu de tout le dépôt, chemins compris ;
 *   2. ce qui déclenchait quoi déclenche toujours la même chose : script, workflow, motifs de la
 *      garde, crochet de pré-commit, workspace pnpm — et le dossier renommé est à sa place.
 *
 * Allégé par #112 des lectures qui comparaient à la base de la PR (D70) : « le dossier des amorçages
 * est en place » perd sa comparaison des fichiers à la base et garde ce qui se constate sur l'arbre ;
 * la comparaison des titres de test disparaît, avec ses aides et son témoin. Elles vérifiaient
 * qu'aucun amorçage n'ait été perdu, ajouté ou renommé pendant #107, et qu'aucune assertion n'ait
 * bougé au passage. Ce n'est plus utile : #107 est fusionné et relu, son diff est figé dans
 * l'historique, et une perte d'amorçage postérieure relève de la PR qui la porterait.
 *
 * Ce fichier est lui-même dans le champ du balayage : il n'écrit donc **jamais l'ancien mot en
 * toutes lettres**, il le compose là où il en a besoin. Une occurrence en clair ici rendrait la
 * première lecture rouge à jamais, et la prose dit « l'ancien mot » pour la même raison.
 *
 * Témoin. La lecture qui juge — le balayage du mot — est une fonction pure, éprouvée sur des textes
 * fabriqués : une prose qui garde l'ancien mot doit être vue, une prose renommée doit passer. Les
 * autres vérifications lisent une configuration exacte — un script, un fichier présent ou absent :
 * un témoin n'y ajouterait rien (D62, garder la garde simple). Seule exception, depuis l'audit de
 * #113 : le script `amorcage` n'est plus lu mot pour mot, un préchargement y étant admis (D71) ; le
 * prédicat partagé qui le lit a ses témoins dans l'amorçage de #82.
 *
 * Plus rien ici ne lit l'historique git : l'amorçage rend le même verdict sur un clone court, et
 * `TIRELIRE_STRICT` ne change plus rien à ce qu'il dit.
 *
 * Périmètre. La sortie des quatre tests de besoins produit hors de `packages/gardes` a été sortie de
 * #107 par le porteur : elle retirerait ces tests du crochet de pré-commit, donc elle changerait un
 * comportement. La dernière lecture garde cette frontière.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appelleDirectementLesAmorcages } from './test/copie-du-depot.mjs';

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELIRE = "l'amorçage de #107 est à relire";

/** L'ancien mot, composé pour que ce fichier ne le contienne pas : accent ou non, tiret ou non. */
const MOTIF_ANCIEN = ['m[', 'ée', ']ta[- ]?', 'harnais'].join('');
const ancien = (drapeaux = 'i') => new RegExp(MOTIF_ANCIEN, drapeaux);

const ANCIEN_DOSSIER = ['meta', 'harnais'].join('-');
const DOSSIER = 'amorcage';
const ANCIEN_WORKFLOW = `.github/workflows/${ANCIEN_DOSSIER}.yml`;
const WORKFLOW = `.github/workflows/${DOSSIER}.yml`;

/** Le seul fichier que #107 renomme à l'intérieur du dossier : son nom disait son rang, pas son rôle. */
const AVANT = `${DOSSIER}.test.mjs`;
const APRES = 'livraison-de-la-garde.test.mjs';

/** Les quatre tests de besoins produit, qui restent dans `packages/gardes` : #107 ne les déplace pas. */
const TESTS_PRODUIT = [
  'distributions.test.mjs',
  'simplicite-acces-gestes.test.mjs',
  'usages-de-bout-en-bout.test.mjs',
  'contraintes-c1-c2-c4-c7.test.mjs',
];

/** Fichiers dont seul le chemin se lit : leur contenu n'est pas du texte. */
const BINAIRES = /\.(png|jpe?g|webp|gif|ico|svgz|pdf|jks|keystore|apk|aab|sqlite|zip|gz|woff2?|ttf|otf|bin)$/i;

// ─── Lire le dépôt et son historique ──────────────────────────────────────────────────────────

// Rien du crochet git ni de la CI n'atteint ces lectures : un GIT_DIR hérité ferait lire un autre dépôt.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([cle]) => !/^GIT_/.test(cle)));

/** Une commande git dans le dépôt, `null` si elle échoue (objet absent, clone court, pas un dépôt). */
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

// ─── La lecture qui juge ──────────────────────────────────────────────────────────────────────

/** Les numéros de ligne où l'ancien mot subsiste, vide si le texte est propre. */
function lignesFautives(texte) {
  const motif = ancien('i');
  return texte
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((ligne, i) => (motif.test(ligne) ? i + 1 : 0))
    .filter(Boolean);
}

// ─── Ce que #107 demande ──────────────────────────────────────────────────────────────────────

test("#107 · l'ancien mot a disparu du dépôt, chemins compris", () => {
  const fichiers = fichiersSuivis();
  assert.ok(fichiers.length > 50, `git ne liste pas les fichiers du dépôt : ${RELIRE}`);
  const fautifs = [];
  for (const chemin of fichiers) {
    if (ancien('i').test(chemin)) {
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
  assert.deepEqual(fautifs, [], `l'ancien mot est encore là :\n  ${fautifs.join('\n  ')}`);
});

test("#107 · témoin : une prose qui garde l'ancien mot est vue, une prose renommée passe", () => {
  const exemple = ['m', 'éta-', 'harnais'].join('');
  assert.deepEqual(lignesFautives(`les ${exemple}s vivent ici\n`), [1], `le balayage ne mord pas sur l'ancien mot : ${RELIRE}`);
  assert.deepEqual(lignesFautives('les amorçages vivent ici\n'), [], `le balayage mord sur le mot du glossaire : ${RELIRE}`);
  assert.ok(ancien('i').test(`${exemple.replace('é', 'e')}/x.test.mjs`), `le balayage ne voit pas l'ancien mot dans un chemin : ${RELIRE}`);
});

test('#107 · le dossier des amorçages est en place', () => {
  assert.ok(existsSync(join(DEPOT, DOSSIER)), `le dossier ${DOSSIER}/ n'existe pas`);
  assert.ok(!existsSync(join(DEPOT, ANCIEN_DOSSIER)), "l'ancien dossier est toujours là : le renommage n'est pas fait, ou il a été copié");
  assert.ok(existsSync(join(DEPOT, DOSSIER, APRES)), `${DOSSIER}/${APRES} manque : le fichier renommé par #107`);
  assert.ok(!existsSync(join(DEPOT, DOSSIER, AVANT)), `${DOSSIER}/${AVANT} est toujours là : son nom disait son rang, pas son rôle`);
});

test('#107 · « pnpm amorcage » joue le dossier, toujours hors du chemin courant', () => {
  const paquet = JSON.parse(lire('package.json'));
  // Assoupli par l'audit de #113 : un préchargement `--import` est admis (D71) ; le prédicat a ses
  // témoins dans l'amorçage de #82.
  assert.ok(appelleDirectementLesAmorcages(paquet.scripts.amorcage, DOSSIER), `le script « amorcage » n'appelle pas node --test sur le dossier : ${paquet.scripts.amorcage}`);
  assert.equal(paquet.scripts.meta, undefined, 'le script « meta » est toujours là : le renommage est à moitié fait');
  assert.equal(paquet.scripts.test, 'pnpm -r test', `scripts.test a changé de forme, alors que #107 ne touche à rien : ${paquet.scripts.test}`);

  const globs = lire('pnpm-workspace.yaml')
    .split('\n')
    .filter((ligne) => /^\s*-\s+\S/.test(ligne))
    .map((ligne) => ligne.trim().replace(/^-\s+/, ''));
  const fautif = globs.find((glob) => glob === DOSSIER || glob.startsWith(`${DOSSIER}/`) || ['*', '**', '**/*'].includes(glob));
  assert.equal(fautif, undefined, `le glob « ${fautif} » du workspace atteindrait ${DOSSIER}/, qui rentrerait dans « pnpm test »`);

  // Depuis #120 (D73), le crochet est suivi dans .githooks ; un motif de chemin qui cite le dossier pour
  // choisir les tests de la garde n'est pas un lancement.
  const preCommit = join(DEPOT, '.githooks', 'pre-commit');
  const crochet = existsSync(preCommit) ? readFileSync(preCommit, 'utf8') : '';
  assert.ok(crochet, `aucun crochet de pré-commit dans .githooks : ${RELIRE}`);
  const lancement = new RegExp(`\\bpnpm\\s+(run\\s+)?${DOSSIER}\\b|\\bnode\\b[^\\n]*--test[^\\n]*\\b${DOSSIER}/`);
  assert.ok(!lancement.test(crochet), `le crochet de pré-commit joue les amorçages, que D65 en sort : ${crochet}`);
});

test('#107 · le workflow renommé garde son déclenchement', () => {
  assert.ok(existsSync(join(DEPOT, WORKFLOW)), `${WORKFLOW} n'existe pas`);
  assert.ok(!existsSync(join(DEPOT, ANCIEN_WORKFLOW)), "l'ancien workflow est toujours là");
  const texte = lire(WORKFLOW);
  assert.match(texte, /workflow_dispatch/, "le workflow n'est plus appelable à la main");
  const declenchement = texte.match(/pull_request:\s*\n\s*paths:\s*\n(?:\s*-\s*.+\n?)+/);
  assert.notEqual(declenchement, null, "le workflow n'a plus de « paths » sous « pull_request » : il tournerait sur toute PR");
  assert.match(declenchement[0], new RegExp(`${DOSSIER}/`), "les chemins qui déclenchent le workflow ne citent plus le dossier des amorçages");
  assert.match(texte, new RegExp(`pnpm ${DOSSIER}|node --test ${DOSSIER}/`), "le workflow ne lance plus les amorçages sous leur nouveau nom");
});

test('#107 · la garde connaît le nouveau chemin, et sa couverture tient', () => {
  assert.match(lire('packages/gardes/gardes.mjs'), new RegExp(`${DOSSIER}/\\*\\*`), "les motifs de la garde ne citent plus le dossier des amorçages : le plancher des chemins gardés a changé");
  const couverture = spawnSync(process.execPath, ['packages/gardes/cli.mjs', 'couverture'], { cwd: DEPOT, env: ENV, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(couverture.status, 0, `la couverture ne passe plus après le renommage :\n${couverture.stdout ?? ''}${couverture.stderr ?? ''}`);
});

test("#107 · les tests de besoins produit n'ont pas bougé : ce besoin ne fait que renommer", () => {
  const absents = TESTS_PRODUIT.filter((fichier) => !existsSync(join(DEPOT, 'packages/gardes', fichier)));
  assert.deepEqual(absents, [], `des tests de besoins produit ont quitté packages/gardes, ce qui les sortirait du crochet de pré-commit : ${absents.join(', ')} — cette sortie a son issue, hors de #107`);
});
