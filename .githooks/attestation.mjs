/**
 * L'attestation de la livraison (#237, D83), côté git : la produire, l'envoyer, la lire en CI. Les
 * décisions sont dans `packages/gardes/attestation.mjs`.
 *
 *   node attestation.mjs ecrire <arbre> <journaux> <branche> <navigateur : oui|non>
 *       `livraison.sh`, quand la livraison est verte : écrit l'attestation de l'arbre jugé, un commit
 *       sans parent dont l'arbre est celui attesté et le message l'attestation, sous la référence
 *       locale `refs/attestations/<arbre>`. Seul l'outillage l'appelle ; aucune session ne l'écrit.
 *   node attestation.mjs envoyer <dépôt distant> <arbre> <branche>
 *       `livraison.sh`, au pré-push : si l'arbre poussé a son attestation, l'envoie avec le push,
 *       sur la branche `<branche>--attestation`, qu'elle remplace. Un échec se dit sans bloquer : la
 *       CI jouera alors tout.
 *   node attestation.mjs ready <tête> <branche> <main> <sortie> [<résumé>]
 *       La CI au Ready : si la tête de la PR ne contient pas `<main>`, la branche est à mettre à
 *       jour, et la commande échoue sans rien jouer. Sinon elle lit l'attestation de la branche et, si
 *       elle vise l'arbre de la tête, écrit dans `<sortie>` ce que la CI peut sauter.
 *   node attestation.mjs apres-fusion <commit> <dépôt GitHub> <sortie> [<résumé>]
 *       La CI sur `main` : si l'arbre arrivé est celui d'une tête de PR dont le statut « Toute la CI
 *       sur ce commit » est vert, écrit dans `<sortie>` que les tests se sautent. Lit l'API par `gh`.
 *
 * `<sortie>` est le fichier que la CI passe à `pnpm test --attestation` ; sans attestation, il n'est
 * pas écrit, et tout se joue. `<résumé>` reçoit, en plus de la sortie standard, ce que la CI saute.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STATUT_DU_READY,
  couvertureApresFusion,
  couvertureAuReady,
  lireLAttestation,
  lireLesLancements,
  resume,
  texteDeLAttestation,
} from '../packages/gardes/attestation.mjs';

const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
const essaie = (f) => {
  try {
    return f();
  } catch {
    return null;
  }
};
const lire = (f) => essaie(() => readFileSync(f, 'utf8')) ?? '';
const REF = (arbre) => `refs/attestations/${arbre}`;
const BRANCHE_D_ATTESTATION = (branche) => `${branche}--attestation`;

/** Écrit la couverture pour la CI, et dit ce qu'elle permet de sauter. */
function conclure(couverture, sortie, fichierResume, titre) {
  rmSync(sortie, { force: true });
  if (couverture) writeFileSync(sortie, `${JSON.stringify(couverture, null, 2)}\n`);
  const lignes = resume(couverture);
  for (const l of lignes) console.log(l);
  if (fichierResume) appendFileSync(fichierResume, `### ${titre}\n\n${lignes.join('\n')}\n`);
}

const [commande, ...args] = process.argv.slice(2);

if (commande === 'ecrire') {
  const [arbre, journaux, branche, nav] = args;
  const { ensembles, typecheck } = lireLesLancements(lire(join(journaux, 'joues')));
  const avecHarnais = lire(join(journaux, 'harnais.txt')).trim() !== '';
  const harnais = !avecHarnais ? 'aucun' : lire(join(journaux, 'harnais.etat')).trim() === 'vert' ? 'vert' : 'rouge';
  const message = texteDeLAttestation({ arbre, seuil: 2, navigateur: nav === 'oui', branche, harnais, ensembles, typecheck, date: new Date().toISOString() });
  // L'outillage signe : l'attestation n'est l'œuvre de personne.
  const identite = { GIT_AUTHOR_NAME: 'Livraison Tirelire', GIT_AUTHOR_EMAIL: 'livraison@tirelire.invalid' };
  const env = { ...process.env, ...identite, GIT_COMMITTER_NAME: identite.GIT_AUTHOR_NAME, GIT_COMMITTER_EMAIL: identite.GIT_AUTHOR_EMAIL };
  const commit = git(['commit-tree', arbre, '-F', '-'], { input: message, env });
  git(['update-ref', REF(arbre), commit]);
  console.log(`attestation de l'arbre ${arbre.slice(0, 10)} écrite : seuil 2, navigateur ${nav === 'oui' ? 'présent' : 'absent'}, harnais du besoin ${harnais}.`);
} else if (commande === 'envoyer') {
  const [distant, arbre, branche] = args;
  if (!essaie(() => git(['rev-parse', '-q', '--verify', REF(arbre)]))) {
    console.log(`aucune attestation locale de l'arbre ${arbre.slice(0, 10)} : la CI jouera tout.`);
  } else {
    try {
      git(['push', '-q', distant, `+${REF(arbre)}:refs/heads/${BRANCHE_D_ATTESTATION(branche)}`]);
      console.log(`attestation de l'arbre ${arbre.slice(0, 10)} envoyée (${BRANCHE_D_ATTESTATION(branche)}).`);
    } catch (e) {
      console.log(`attestation de l'arbre ${arbre.slice(0, 10)} non envoyée, la CI jouera tout : ${String(e.stderr || e.message).trim().split('\n').at(-1)}`);
    }
  }
} else if (commande === 'ready') {
  const [tete, branche, main, sortie, fichierResume] = args;
  const titre = 'Attestation de la livraison';
  if (!essaie(() => (git(['merge-base', '--is-ancestor', main, tete]), true))) {
    rmSync(sortie, { force: true });
    const m = `Branche à mettre à jour : ${tete.slice(0, 10)} ne contient pas le dernier main (${git(['rev-parse', '--short=10', main])}). Rien d'autre ne se joue ; mettez la branche à jour, puis repassez la PR en Ready.`;
    console.log(`::error title=Branche à mettre à jour::${m}`);
    if (fichierResume) appendFileSync(fichierResume, `### ${titre}\n\n${m}\n`);
    process.exit(1);
  }
  const arbre = git(['rev-parse', `${tete}^{tree}`]);
  const extrait = git(['rev-parse', 'HEAD^{tree}']);
  let couverture = null;
  let raison = '';
  if (extrait !== arbre) raison = `l'arbre extrait (${extrait.slice(0, 10)}) n'est pas celui de la tête (${arbre.slice(0, 10)})`;
  else {
    let erreur = '';
    try {
      git(['fetch', '-q', 'origin', `refs/heads/${BRANCHE_D_ATTESTATION(branche)}`]);
    } catch (e) {
      erreur = String(e.stderr || e.message).trim().split('\n').at(-1);
    }
    if (erreur) raison = `aucune attestation lue sur ${BRANCHE_D_ATTESTATION(branche)} (${erreur})`;
  }
  if (!raison && !couverture) {
    const porte = git(['rev-parse', 'FETCH_HEAD^{tree}']);
    const lu = porte === arbre ? lireLAttestation(git(['log', '-1', '--format=%B', 'FETCH_HEAD']), porte) : { raison: `la dernière attestation vise l'arbre ${porte.slice(0, 10)}, pas celui de la tête` };
    if (lu.attestation) couverture = couvertureAuReady(lu.attestation);
    else raison = lu.raison;
  }
  if (raison) console.log(`Pas d'attestation utilisable : ${raison}.`);
  conclure(couverture, sortie, fichierResume, titre);
} else if (commande === 'apres-fusion') {
  const [commit, depot, sortie, fichierResume] = args;
  const arbre = git(['rev-parse', `${commit}^{tree}`]);
  const gh = (chemin, jq) => execFileSync('gh', ['api', `repos/${depot}/${chemin}`, '--jq', jq], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // Les têtes possibles : les parents fusionnés du commit, et la tête des PR qui l'ont apporté.
  const parents = git(['rev-list', '--parents', '-n', '1', commit]).split(' ').slice(2);
  const prs = (essaie(() => gh(`commits/${commit}/pulls`, '.[].head.sha')) ?? '').split('\n').filter(Boolean);
  const tetes = [...new Set([...parents, ...prs])].map((sha) => ({
    sha,
    arbre: essaie(() => git(['rev-parse', `${sha}^{tree}`])) ?? essaie(() => gh(`git/commits/${sha}`, '.tree.sha')),
    statut: essaie(() => gh(`commits/${sha}/status`, `.statuses[] | select(.context == "${STATUT_DU_READY}") | .state`)),
  }));
  const couverture = couvertureApresFusion(arbre, tetes);
  if (!couverture) console.log(`Arbre ${arbre.slice(0, 10)} : aucune tête de PR de cet arbre n'a été trouvée verte au Ready (${tetes.map((t) => `${t.sha.slice(0, 7)} ${t.statut ?? 'sans statut'}`).join(', ') || 'aucune tête'}) : les tests se rejouent.`);
  conclure(couverture, sortie, fichierResume, 'Arbre vérifié au Ready');
} else {
  console.error('usage : attestation.mjs ecrire | envoyer | ready | apres-fusion …');
  process.exit(2);
}
