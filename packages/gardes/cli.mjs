#!/usr/bin/env node
/**
 * Ligne de commande de la garde (#58).
 *
 *   node packages/gardes/cli.mjs couverture
 *   node packages/gardes/cli.mjs demander [--base origin/main] [--ids I7,C3] [--auteur agent]
 *   node packages/gardes/cli.mjs pr [--base <ref>] [--tete <ref>] [--pr <n> | --issue <n> | --corps-fichier <chemin>]
 *
 * `demander` prépare la section « Invariants et contraintes » que l'auditeur écrit dans l'issue,
 * d'après les fichiers modifiés depuis la base. `pr` lit cette section dans l'issue que la PR ferme
 * (`--pr`, par « Close #n »), dans l'issue donnée (`--issue`), dans un fichier, ou dans la variable
 * CORPS ; les deux premiers passent par `gh`, avec son jeton. Aucune case : la
 * fusion vaut validation (#168). La base vaut `origin/main` quand elle n'est pas donnée et existe.
 *
 * Avec `--tete`, `pr` juge le contenu de ce commit — registre, documents, fichiers modifiés depuis la
 * base — quel que soit l'arbre d'où la garde s'exécute : elle le lit par git, sans l'extraire ni rien
 * en exécuter (#159). En CI, c'est ainsi que la garde de la base juge la PR. Le commit se cherche dans
 * le dépôt du répertoire courant, puis dans celui de la garde, où il est récupéré s'il manque. Sans
 * `--tete`, `pr` juge la copie de travail, fichiers non commis compris : l'oubli se voit en local
 * avant le passage en Ready.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { DOCUMENTS, RACINE, issuesFermees, lireRegistre, preparerSection, resumePr, verifierCouverture, verifierCouvertureA, verifierPr } from './gardes.mjs';

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
  }
  process.exit(resultat.aCorriger.length ? 1 : 0);
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

/** Le corps d'une issue ou d'une PR, par `gh` : son jeton, son dépôt (`GH_REPO` ou le clone). */
function corpsGitHub(genre, numero) {
  try {
    return execFileSync('gh', [genre, 'view', String(numero), '--json', 'body', '--jq', '.body'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`lecture de ${genre === 'pr' ? 'la PR' : "l'issue"} #${numero} par \`gh\` impossible (${String(e.stderr || e.message).trim()}) ; donner la section par --corps-fichier.`);
  }
}

/** La section à juger : celle de l'issue que la PR ferme, d'une issue donnée, d'un fichier, ou CORPS. */
function sectionAJuger() {
  const fichier = option('corps-fichier');
  if (fichier) return readFileSync(fichier, 'utf8');
  let issue = option('issue');
  const numeroPr = option('pr');
  if (!issue && numeroPr) {
    const fermees = issuesFermees(corpsGitHub('pr', numeroPr));
    if (fermees.length !== 1) {
      throw new Error(`la PR #${numeroPr} ${fermees.length ? `ferme ${fermees.length} issues (${fermees.map((n) => `#${n}`).join(', ')})` : 'ne ferme aucune issue'} : une issue, une PR, citée par « Close #n ».`);
    }
    issue = fermees[0];
  }
  if (issue) {
    console.log(`Section lue dans l'issue #${issue}.`);
    return corpsGitHub('issue', issue);
  }
  return process.env.CORPS ?? '';
}

function pr() {
  const teteDonnee = option('tete');
  const juge = teteDonnee ? commitJuge(teteDonnee) : { depot: RACINE, sha: 'HEAD' };
  const existe = (ref) => {
    try {
      gitDans(juge.depot, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
      return true;
    } catch {
      return false;
    }
  };
  const base = option('base') ?? (existe('origin/main') ? 'origin/main' : undefined);
  const couvert = teteDonnee ? verifierCouvertureA(juge.sha, juge.depot) : verifierCouverture();
  const corps = sectionAJuger();
  const fichiers = base ? noms(gitDans(juge.depot, 'diff', '-z', '--name-only', `${base}...${juge.sha}`)) : [];
  if (!teteDonnee) fichiers.push(...noms(git('diff', '-z', '--name-only', 'HEAD')), ...noms(git('ls-files', '-z', '--others', '--exclude-standard')));
  const resultat = verifierPr({
    entrees: couvert.entrees,
    entreesAvant: base ? registreA(base, juge.depot) : new Map(),
    corps,
    fichiersModifies: [...new Set(fichiers)],
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
