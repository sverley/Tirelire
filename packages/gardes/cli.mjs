#!/usr/bin/env node
/**
 * Ligne de commande de la garde (#58, D61).
 *
 *   node packages/gardes/cli.mjs couverture
 *   node packages/gardes/cli.mjs demander [--base origin/main] [--ids I7,C3] [--auteur agent]
 *   node packages/gardes/cli.mjs pr --base <ref> [--tete <ref>] [--corps-fichier <chemin>]
 *   node packages/gardes/cli.mjs pr --github
 *   node packages/gardes/cli.mjs alerte --github
 *
 * `demander` prépare la section « Invariants et contraintes » d'une PR d'après les fichiers modifiés
 * depuis la base ; l'analyse reste à écrire. `pr` lit la description dans la variable CORPS si aucun
 * fichier n'est donné ; hors GitHub, une case cochée y compte comme validée. `pr --github` est la
 * vérification des PR : il lit l'événement de GitHub Actions, enregistre les validations cochées et
 * décoche celles qu'une modification postérieure annule (#61). Le bilan va dans le résumé de GitHub
 * Actions quand il y en a un ; la sortie est en erreur tant qu'il reste à corriger ou à valider.
 * `alerte --github` est la garde de #62 : elle lit le même fichier d'événement et ouvre une issue
 * quand une PR a été fusionnée sans vérification verte, ou quand `main` a reçu un push direct.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { DOCUMENTS, RACINE, fichiersDepuisValidation, lireRegistre, preparerSection, resumePr, verifierCouverture, verifierPr } from './gardes.mjs';
import { alerter } from './alerte.mjs';
import { verifierPrSurGithub } from './github.mjs';

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
      auteur: option('auteur') ?? 'agent',
      date: new Date().toISOString().slice(0, 10),
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

/** Un appel à l'API du dépôt, avec le jeton du workflow. `fetch` global : les harnais le remplacent. */
function requete(depot) {
  return async (methode, chemin, donnees) => {
    const reponse = await fetch(`https://api.github.com/repos/${depot}${chemin}`, {
      method: methode,
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(donnees ? { 'Content-Type': 'application/json' } : {}),
      },
      body: donnees ? JSON.stringify(donnees) : undefined,
    });
    if (!reponse.ok) throw new Error(`${methode} ${chemin} : ${reponse.status} ${(await reponse.text()).slice(0, 160)}`);
    return reponse.json();
  };
}

function apiGithub() {
  const appel = requete(process.env.GITHUB_REPOSITORY);
  return {
    lirePr: (n) => appel('GET', `/pulls/${n}`),
    lireCommentaires: async (n) => {
      const tous = [];
      for (let page = 1; ; page++) {
        const lot = await appel('GET', `/issues/${n}/comments?per_page=100&page=${page}`);
        tous.push(...lot);
        if (lot.length < 100) return tous;
      }
    },
    commenter: (n, body) => appel('POST', `/issues/${n}/comments`, { body }),
    modifierDescription: (n, body) => appel('PATCH', `/pulls/${n}`, { body }),
  };
}

async function pr() {
  const couvert = verifierCouverture();
  const problemes = couvert.problemes.map((p) => `Couverture : ${p}`);
  if (args.includes('--github')) {
    const evenement = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const { base, head, body } = evenement.pull_request;
    const entreesAvant = registreA(base.sha);
    const fichiersModifies = noms(git('diff', '-z', '--name-only', `${base.sha}...${head.sha}`));
    let resultat;
    try {
      resultat = await verifierPrSurGithub({
        evenement, api: apiGithub(), entrees: couvert.entrees, entreesAvant, fichiersModifies,
        fichiersDepuis: (ancienne, t) => fichiersDepuisValidation({ ancienne, base: base.sha, tete: t }),
      });
    } catch (e) {
      resultat = verifierPr({ entrees: couvert.entrees, entreesAvant, corps: body ?? '', fichiersModifies, validations: { tete: head.sha, cible: base.ref, horodatages: [] } });
      resultat.aCorriger.push(`La vérification n'a pas pu lire ou écrire la PR sur GitHub : ${e.message}`);
    }
    resultat.aCorriger.unshift(...problemes);
    return rendre(resultat);
  }
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
  resultat.aCorriger.unshift(...problemes);
  rendre(resultat);
}

/**
 * Ce que la garde de #62 lit et écrit sur GitHub. `/actions/runs` se lit aussi bien avec le jeton du
 * workflow qu'avec un jeton personnel, contrairement à `check-runs` (403 constaté pendant l'audit) :
 * il passe en premier, l'autre reste un recours. Les issues se relisent sans filtre d'étiquette, pour
 * que l'alerte se retrouve même si son étiquette a disparu — la recherche, elle, indexe trop tard
 * pour un rejeu.
 */
function apiAlerte() {
  const appel = requete(process.env.GITHUB_REPOSITORY);
  return {
    courses: async (sha) => {
      try {
        const r = await appel('GET', `/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100`);
        if (r.workflow_runs?.length) return r.workflow_runs;
      } catch {
        /* recours ci-dessous */
      }
      try {
        return (await appel('GET', `/commits/${sha}/check-runs?per_page=100`)).check_runs ?? [];
      } catch {
        return []; // ni l'un ni l'autre ne se lit : la vérification est tenue pour absente, donc rouge
      }
    },
    prsDuCommit: async (sha) => {
      try {
        return await appel('GET', `/commits/${sha}/pulls?per_page=100`);
      } catch {
        return [];
      }
    },
    issues: async () => {
      const tous = [];
      for (let page = 1; page <= 10; page++) {
        const lot = await appel('GET', `/issues?state=all&per_page=100&page=${page}`);
        tous.push(...lot);
        if (lot.length < 100) break;
      }
      return tous;
    },
    ouvrir: async (donnees) => {
      try {
        return await appel('POST', '/issues', donnees);
      } catch (e) {
        if (!donnees.labels?.length) throw e;
        // L'alerte compte plus que son étiquette : une étiquette inconnue ne la fait pas taire.
        return appel('POST', '/issues', { ...donnees, labels: [] });
      }
    },
  };
}

async function alerte() {
  if (!args.includes('--github')) {
    console.error('Usage : node packages/gardes/cli.mjs alerte --github');
    process.exit(2);
  }
  const evenement = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const r = await alerter({ evenement, nom: process.env.GITHUB_EVENT_NAME, api: apiAlerte() });

  let bilan;
  if (!r.alerte) bilan = `Rien à signaler : ${r.motif}.`;
  else if (r.deja) bilan = `Déjà signalé par #${r.deja.number} — ${r.alerte.titre} : ${r.motif}.`;
  else bilan = `Alerte ouverte #${r.ouverte.number} — ${r.alerte.titre} : ${r.motif}.`;
  console.log(bilan);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${bilan}\n`);
  if (r.alerte && process.env.GITHUB_ACTIONS) console.log(`::error title=Fusion non vérifiée::${annotation(bilan)}`);

  // Rouge quand il y a eu à signaler, rejeu compris : l'issue est le signal, la couleur le répète.
  process.exit(r.alerte ? 1 : 0);
}

const commandes = { couverture, demander, pr, alerte };
if (!commandes[commande]) {
  console.error('Usage : node packages/gardes/cli.mjs couverture | demander [--base <ref>] [--ids I7,C3] | pr --base <ref> [--tete <ref>] [--corps-fichier <chemin>] | pr --github | alerte --github');
  process.exit(2);
}
Promise.resolve(commandes[commande]()).catch((e) => {
  console.error(e);
  process.exit(1);
});
