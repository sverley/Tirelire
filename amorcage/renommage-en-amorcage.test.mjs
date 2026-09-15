/**
 * Amorçage de #107, écrit par la session d'audit du 15 septembre 2026.
 *
 * #107 est un renommage : le glossaire, arrêté par le porteur le 14 septembre, nomme « amorçages »
 * les harnais qui jugent le codage des harnais de la garde, et le dépôt emploie encore l'ancien mot.
 * La livraison attendue ne change **aucun comportement** — c'est cela qu'il faut constater, et pas
 * seulement que le mot ait changé. Trois lectures portent le jugement :
 *
 *   1. l'ancien mot a disparu de tout le dépôt, chemins compris ;
 *   2. les harnais du dossier renommé ont gardé leurs assertions, ce qui se lit en comparant leurs
 *      titres de test à ceux de la base de la PR, aux mots renommés près ;
 *   3. ce qui déclenchait quoi déclenche toujours la même chose : script, workflow, motifs de la
 *      garde, crochet de pré-commit, workspace pnpm.
 *
 * Ce fichier est lui-même dans le champ du balayage : il n'écrit donc **jamais l'ancien mot en
 * toutes lettres**, il le compose là où il en a besoin. Une occurrence en clair ici rendrait la
 * première lecture rouge à jamais, et la prose dit « l'ancien mot » pour la même raison.
 *
 * Témoins. Les deux lectures qui jugent (le balayage du mot, la comparaison des titres) sont des
 * fonctions pures, éprouvées sur des textes fabriqués : une prose qui garde l'ancien mot doit être
 * vue, une prose renommée doit passer, un titre réécrit au-delà du renommage doit être vu. Les
 * autres vérifications lisent une configuration exacte — un script mot pour mot, un fichier présent
 * ou absent : un témoin n'y ajouterait rien (D62, garder la garde simple).
 *
 * Comparaison à la base : elle demande l'historique, que le workflow du dossier pose déjà
 * (`fetch-depth: 0`). Sans historique — clone court, copie sans `.git` — le test le dit et passe,
 * sauf si `TIRELIRE_STRICT` est posé, où il échoue plutôt que de se taire.
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

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELIRE = "l'amorçage de #107 est à relire";
const STRICT = Boolean(process.env.TIRELIRE_STRICT);

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

/** Ce fichier : ajouté par la branche d'audit, il peut manquer à la base sans que rien ne cloche. */
const CE_FICHIER = 'renommage-en-amorcage.test.mjs';

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

/**
 * Le commit de base de la PR, où l'ancien dossier existe encore : la référence de l'événement en CI,
 * sinon `main`. `null` si l'historique ne remonte pas jusque-là.
 */
function baseDeLaPr() {
  const refs = [process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`, 'origin/main', 'main'].filter(Boolean);
  for (const ref of refs) {
    const tete = git('rev-parse', '--verify', `${ref}^{commit}`)?.trim();
    if (!tete) continue;
    const base = git('merge-base', 'HEAD', tete)?.trim() || tete;
    if (fichiersDuDossierA(base).length) return base;
  }
  return null;
}

/** Les fichiers de l'ancien dossier à un commit donné, chemins relatifs au dossier. */
const fichiersDuDossierA = (commit) =>
  (git('ls-tree', '-r', '--name-only', commit, '--', `${ANCIEN_DOSSIER}/`) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((chemin) => chemin.slice(ANCIEN_DOSSIER.length + 1));

/** Dit pourquoi une comparaison ne s'est pas faite, et laisse passer — sauf en mode strict. */
function sansHistorique(quoi, t) {
  const message = `sans historique git, ${quoi} ne se fait pas ; la CI pose « fetch-depth: 0 » pour cela`;
  if (STRICT) assert.fail(message);
  t.diagnostic(message);
}

// ─── Les deux lectures qui jugent ─────────────────────────────────────────────────────────────

/** Les numéros de ligne où l'ancien mot subsiste, vide si le texte est propre. */
function lignesFautives(texte) {
  const motif = ancien('i');
  return texte
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((ligne, i) => (motif.test(ligne) ? i + 1 : 0))
    .filter(Boolean);
}

/** Les titres des `test(...)` d'un fichier, dans leur ordre d'écriture. */
function titresDe(texte) {
  const titres = [];
  const motif = /^test\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/gm;
  for (const trouve of texte.matchAll(motif)) titres.push(trouve[2]);
  return titres;
}

/**
 * Un titre ramené à ce que #107 ne doit pas toucher : sans accents, sans les mots que le renommage
 * remplace, sans le nom du script ni celui du fichier renommé. Deux titres qui ne diffèrent que par
 * le renommage se ramènent ainsi au même texte ; toute autre réécriture ressort.
 */
const sansLesMotsRenommes = (titre) =>
  titre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(new RegExp(`${MOTIF_ANCIEN}(?:e?s)?`, 'gi'), ' ')
    .replace(/amorcages?/g, ' ')
    .replace(/livraison-de-la-garde/g, ' ')
    .replace(/\bmeta\b/g, ' ')
    .replace(/[\s/]+/g, ' ')
    .trim();

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

test('#107 · le dossier des amorçages est en place, avec les mêmes fichiers', (t) => {
  assert.ok(existsSync(join(DEPOT, DOSSIER)), `le dossier ${DOSSIER}/ n'existe pas`);
  assert.ok(!existsSync(join(DEPOT, ANCIEN_DOSSIER)), "l'ancien dossier est toujours là : le renommage n'est pas fait, ou il a été copié");
  assert.ok(existsSync(join(DEPOT, DOSSIER, APRES)), `${DOSSIER}/${APRES} manque : le fichier renommé par #107`);
  assert.ok(!existsSync(join(DEPOT, DOSSIER, AVANT)), `${DOSSIER}/${AVANT} est toujours là : son nom disait son rang, pas son rôle`);

  const base = baseDeLaPr();
  if (!base) return sansHistorique('la comparaison des fichiers du dossier', t);
  const attendus = fichiersDuDossierA(base)
    .map((fichier) => (fichier === AVANT ? APRES : fichier))
    .filter((fichier) => fichier !== CE_FICHIER);
  const livres = fichiersSuivis()
    .filter((chemin) => chemin.startsWith(`${DOSSIER}/`))
    .map((chemin) => chemin.slice(DOSSIER.length + 1))
    .filter((fichier) => fichier !== CE_FICHIER);
  assert.deepEqual(livres.sort(), attendus.sort(), 'le dossier renommé ne contient plus les mêmes fichiers : un amorçage a été perdu, ajouté ou renommé au passage');
});

test('#107 · les amorçages gardent leurs assertions : mêmes titres, aux mots renommés près', (t) => {
  const base = baseDeLaPr();
  if (!base) return sansHistorique('la comparaison des titres de test', t);
  const ecarts = [];
  for (const fichier of fichiersDuDossierA(base)) {
    if (!fichier.endsWith('.test.mjs')) continue;
    const livre = fichier === AVANT ? APRES : fichier;
    if (livre === CE_FICHIER) continue;
    const texteAvant = git('show', `${base}:${ANCIEN_DOSSIER}/${fichier}`);
    if (texteAvant === null) {
      ecarts.push(`${fichier} · illisible à la base`);
      continue;
    }
    if (!existsSync(join(DEPOT, DOSSIER, livre))) {
      ecarts.push(`${livre} · manquant après le renommage`);
      continue;
    }
    const avant = titresDe(texteAvant).map(sansLesMotsRenommes);
    const apres = titresDe(lire(`${DOSSIER}/${livre}`)).map(sansLesMotsRenommes);
    if (avant.length !== apres.length) {
      ecarts.push(`${livre} · ${avant.length} tests avant, ${apres.length} après`);
      continue;
    }
    avant.forEach((titre, i) => {
      if (titre !== apres[i]) ecarts.push(`${livre} · titre ${i + 1} : « ${titre} » devenu « ${apres[i]} »`);
    });
  }
  assert.deepEqual(ecarts, [], `des assertions ont bougé, alors que #107 ne déplace que des chemins :\n  ${ecarts.join('\n  ')}`);
});

test('#107 · témoin : un titre réécrit au-delà du renommage est vu, un titre seulement renommé passe', () => {
  const exemple = ['m', 'éta-', 'harnais'].join('');
  assert.equal(
    sansLesMotsRenommes(`#82 · le crochet de pré-commit ne joue pas les ${exemple}`),
    sansLesMotsRenommes('#82 · le crochet de pré-commit ne joue pas les amorçages'),
    `la comparaison voit une différence là où seul le mot change : ${RELIRE}`,
  );
  assert.equal(
    sansLesMotsRenommes(`#82 · « pnpm meta » appelle node --test sur ${exemple.replace('é', 'e')}/`),
    sansLesMotsRenommes('#82 · « pnpm amorcage » appelle node --test sur amorcage/'),
    `la comparaison voit une différence là où seuls le script et le dossier changent : ${RELIRE}`,
  );
  assert.notEqual(
    sansLesMotsRenommes('#82 · le crochet de pré-commit ne joue pas les amorçages'),
    sansLesMotsRenommes('#82 · le crochet de pré-commit joue les amorçages'),
    `la comparaison ne mord pas sur un titre réécrit : ${RELIRE}`,
  );
});

test('#107 · « pnpm amorcage » joue le dossier, toujours hors du chemin courant', () => {
  const paquet = JSON.parse(lire('package.json'));
  assert.equal(paquet.scripts.amorcage, `node --test ${DOSSIER}/*.test.mjs`, "le script « amorcage » n'appelle pas node --test sur le dossier");
  assert.equal(paquet.scripts.meta, undefined, 'le script « meta » est toujours là : le renommage est à moitié fait');
  assert.equal(paquet.scripts.test, 'pnpm -r test', `scripts.test a changé de forme, alors que #107 ne touche à rien : ${paquet.scripts.test}`);

  const globs = lire('pnpm-workspace.yaml')
    .split('\n')
    .filter((ligne) => /^\s*-\s+\S/.test(ligne))
    .map((ligne) => ligne.trim().replace(/^-\s+/, ''));
  const fautif = globs.find((glob) => glob === DOSSIER || glob.startsWith(`${DOSSIER}/`) || ['*', '**', '**/*'].includes(glob));
  assert.equal(fautif, undefined, `le glob « ${fautif} » du workspace atteindrait ${DOSSIER}/, qui rentrerait dans « pnpm test »`);

  const crochet = paquet['simple-git-hooks']?.['pre-commit'] ?? '';
  assert.ok(crochet, `aucun crochet de pré-commit dans package.json : ${RELIRE}`);
  assert.ok(!new RegExp(`\\bpnpm ${DOSSIER}\\b|${DOSSIER}/`).test(crochet), `le crochet de pré-commit joue les amorçages, que D65 en sort : ${crochet}`);
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
