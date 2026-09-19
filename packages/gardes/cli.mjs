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
 * quand une PR a été fusionnée sans vérification verte, ou quand `main` a reçu un push direct.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { DOCUMENTS, RACINE, lireRegistre, preparerSection, resumePr, verifierCouverture, verifierPr } from './gardes.mjs';

const [commande, ...args] = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const git = (...a) => execFileSync('git', a, { cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const noms = (sortie) => sortie.split('\0').filter(Boolean);
const registreA = (ref) => {
  try {
    return lireRegistre(git('show', `${ref}:${DOCUMENTS.gardes}`)).entrees;
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

function pr() {
  const couvert = verifierCouverture();
  const base = option('base');
  const tete = option('tete') ?? 'HEAD';
  const fichierCorps = option('corps-fichier');
  const corps = fichierCorps ? readFileSync(fichierCorps, 'utf8') : (process.env.CORPS ?? '');
  const resultat = verifierPr({
    entrees: couvert.entrees,
    entreesAvant: base ? registreA(base) : new Map(),
    corps,
    fichiersModifies: base ? noms(git('diff', '-z', '--name-only', `${base}...${tete}`)) : [],
  });
  resultat.aCorriger.unshift(...couvert.problemes.map((p) => `Couverture : ${p}`));
  rendre(resultat);
}

const commandes = { couverture, demander, pr };
if (!commandes[commande]) {
  process.exit(2);
}
Promise.resolve(commandes[commande]()).catch((e) => {
  console.error(e);
  process.exit(1);
});
