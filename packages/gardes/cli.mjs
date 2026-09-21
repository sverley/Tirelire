#!/usr/bin/env node
/**
 * Ligne de commande de la garde (#58, D61).
 *
 *   node packages/gardes/cli.mjs couverture
 *   node packages/gardes/cli.mjs demander [--base origin/main] [--ids I7,C3] [--auteur agent]
 *   node packages/gardes/cli.mjs pr --base <ref> [--tete <ref>] [--corps-fichier <chemin>]
 *
 * `demander` prépare la section « Invariants et contraintes » d'une PR d'après les fichiers modifiés
 * depuis la base ; l'analyse reste à écrire. `pr` lit la description dans la variable CORPS si aucun
 * fichier n'est donné ; une case cochée vaut validation.
 *
 * Avec `--tete`, `pr` juge le contenu de ce commit — registre, documents, fichiers modifiés depuis la
 * base — quel que soit l'arbre d'où la garde s'exécute : elle le lit par git, sans l'extraire ni rien
 * en exécuter (#159). En CI, c'est ainsi que la garde de la base juge la PR. Le commit se cherche dans
 * le dépôt du répertoire courant, puis dans celui de la garde, où il est récupéré s'il manque. Sans
 * `--tete`, `pr` juge la copie de travail.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { DOCUMENTS, RACINE, lireRegistre, preparerSection, resumePr, verifierCouverture, verifierCouvertureA, verifierPr } from './gardes.mjs';

const [commande, ...args] = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const gitDans = (depot, ...a) => execFileSync('git', a, { cwd: depot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const git = (...a) => gitDans(RACINE, ...a);
const noms = (sortie) => sortie.split('\0').filter(Boolean);
const registreA = (ref, depot = RACINE) => {
  try {
    return lireRegistre(gitDans(depot, 'show', `${ref}:${DOCUMENTS.gardes}`)).entrees;
  } catch {
    return new Map(); // la base n'a pas encore de registre
  }
};
const annotation = (texte) => texte.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

function couverture() {
  const { problemes, entrees } = verifierCouverture();
  if (problemes.length) {
    console.error(`Garde incomplète :\n${problemes.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
  }
  let harnais = 0;
  let manuelles = 0;
  let renvois = 0;
  for (const e of entrees.values()) {
    if (e.harnais.length) harnais++;
    else if (e.verifications.length) manuelles++;
    else renvois++;
  }
  console.log(`${entrees.size} invariants, usages et contraintes gardés : ${harnais} avec au moins un harnais, ${manuelles} par vérification manuelle seule, ${renvois} par renvoi.`);
}

function demander() {
  const base = option('base') ?? 'origin/main';
  const fichiers = new Set([
    ...noms(git('diff', '-z', '--name-only', `${base}...HEAD`)),
    ...noms(git('diff', '-z', '--name-only', 'HEAD')),
    ...noms(git('ls-files', '-z', '--others', '--exclude-standard')),
  ]);
  const { entrees } = verifierCouverture();
  console.log(
    preparerSection({
      entrees,
      entreesAvant: registreA(base),
      fichiersModifies: [...fichiers],
      ids: (option('ids') ?? '').split(/[\s,]+/).filter(Boolean),
    }),
  );
}

function rendre(resultat) {
  const bilan = resumePr(resultat);
  console.log(bilan);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${bilan}\n`);
  if (process.env.GITHUB_ACTIONS) {
    for (const p of resultat.aCorriger) console.log(`::error title=À corriger::${annotation(p)}`);
    for (const p of resultat.enAttente) console.log(`::error title=Validation humaine attendue::${annotation(p)}`);
  }
  process.exit(resultat.aCorriger.length || resultat.enAttente.length ? 1 : 0);
}

/** Le commit, résolu, et le dépôt qui le contient : celui du répertoire courant, sinon celui de la garde. */
function commitJuge(ref) {
  const resoudre = (depot) => {
    try {
      return { depot: gitDans(depot, 'rev-parse', '--show-toplevel').trim(), sha: gitDans(depot, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`).trim() };
    } catch {
      return null;
    }
  };
  const trouve = resoudre(process.cwd()) ?? resoudre(RACINE);
  if (trouve) return trouve;
  try {
    git('fetch', '--quiet', '--no-tags', 'origin', ref); // tête d'un fork, ou que sa branche ne porte plus ; avec le jeton du job
  } catch {
    // le message ci-dessous suffit
  }
  const recupere = resoudre(RACINE);
  if (recupere) return recupere;
  throw new Error(`le commit à juger (${ref}) est introuvable, même après \`git fetch origin ${ref}\` : la garde le lit par git, sans l'extraire.`);
}

function pr() {
  const base = option('base');
  const teteDonnee = option('tete');
  const juge = teteDonnee ? commitJuge(teteDonnee) : { depot: RACINE, sha: 'HEAD' };
  const couvert = teteDonnee ? verifierCouvertureA(juge.sha, juge.depot) : verifierCouverture();
  const fichierCorps = option('corps-fichier');
  const corps = fichierCorps ? readFileSync(fichierCorps, 'utf8') : (process.env.CORPS ?? '');
  const resultat = verifierPr({
    entrees: couvert.entrees,
    entreesAvant: base ? registreA(base, juge.depot) : new Map(),
    corps,
    fichiersModifies: base ? noms(gitDans(juge.depot, 'diff', '-z', '--name-only', `${base}...${juge.sha}`)) : [],
  });
  resultat.aCorriger.unshift(...couvert.problemes.map((p) => `Couverture : ${p}`));
  rendre(resultat);
}

const commandes = { couverture, demander, pr };
if (!commandes[commande]) {
  process.exit(2);
}
Promise.resolve()
  .then(() => commandes[commande]())
  .catch((e) => {
  // Rouge, et dit pourquoi : sur une PR, la garde de la base qui ne sait pas juger ce que la PR propose (#159).
  const message = `La garde ne sait pas juger : ${e?.message ?? e}`;
  console.error(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=La garde ne sait pas juger::${annotation(message)}`);
  process.exit(1);
});
