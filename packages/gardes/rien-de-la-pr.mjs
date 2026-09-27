/**
 * Un workflow déclenché par `pull_request_target` n'exécute rien de la PR (#248, D83 « Workflows ») :
 * il tourne avec les droits du dépôt et ses secrets, et lit la PR comme une donnée — description,
 * cases, fichiers lus par git ou par l'API —, sans jamais mettre son arbre à la place de celui de
 * `main`.
 *
 * Lecture statique, par renfoncement (`workflow-a-blanc.mjs`) : dans un tel workflow, chaque étape de
 * chaque job est lue, quel que soit l'événement qui la fait tourner. Une extraction est :
 * - `actions/checkout` avec une `ref` autre que `main`, ou un `repository` ; sans `ref`, GitHub
 *   extrait la branche par défaut, `main`, la version même du workflow ;
 * - une commande qui met un autre arbre à la place de celui extrait (`git checkout`, `git switch`,
 *   `git worktree`…, `gh pr checkout`), quelle que soit la référence visée : aucun workflow n'en a
 *   besoin pour lire la PR.
 * Hors d'atteinte de cette lecture : un fichier de la PR lu par git puis passé à un interpréteur
 * (`git show <tête>:script | sh`), qui l'exécuterait sans l'extraire.
 */
import { commande, étapes, jobs } from './workflow-a-blanc.mjs';

const sansCommentaire = (l) => l.replace(/(^|\s)#.*$/, '');
const sansGuillemets = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');

/** Le workflow est-il déclenché par `pull_request_target` ? Lu dans ce qui précède `jobs:`. */
export function déclenchéParPullRequestTarget(yaml) {
  return yaml
    .replace(/\r\n?/g, '\n')
    .split(/\njobs:\s*\n/)[0]
    .split('\n')
    .map(sansCommentaire)
    .some((l) => /\bpull_request_target\b/.test(l));
}

const REF_DE_MAIN = /^(?:main|refs\/heads\/main)$/;
const CHANGE_L_ARBRE = /\bgit\b[^\n;&|]*?\s(checkout|switch|restore|reset|worktree|read-tree|stash|apply|am|cherry-pick|rebase|merge|pull)\b|\bgh\s+pr\s+checkout\b/;

/** Ce qu'une étape extrait d'autre que `main` : une liste de raisons, vide si rien. */
function extractions(étape) {
  const c = commande(étape);
  const raisons = [];
  if (/^\s*(?:- )?\s*uses:\s*['"]?actions\/checkout@/m.test(c)) {
    for (const [, v] of c.matchAll(/^\s+ref:\s*(.*)$/gm)) {
      const ref = sansGuillemets(sansCommentaire(v));
      if (!REF_DE_MAIN.test(ref)) raisons.push(`actions/checkout extrait « ${ref} », pas main`);
    }
    for (const [, v] of c.matchAll(/^\s+repository:\s*(.*)$/gm)) {
      raisons.push(`actions/checkout extrait le dépôt « ${sansGuillemets(sansCommentaire(v))} »`);
    }
  }
  for (const l of c.split('\n').map(sansCommentaire)) {
    const m = l.match(CHANGE_L_ARBRE);
    if (m) raisons.push(`« ${m[0].trim()} » mettrait un autre arbre à la place de main`);
  }
  return raisons;
}

/**
 * Les extractions d'un workflow déclenché par `pull_request_target`, une par ligne
 * (`<fichier> : job « <nom> » : <raison>`) ; vide pour un autre workflow, ou s'il n'extrait rien.
 */
export function extractionsSurPullRequestTarget(fichier, yaml) {
  const texte = yaml.replace(/\r\n?/g, '\n');
  if (!déclenchéParPullRequestTarget(texte)) return [];
  const écarts = [];
  for (const job of jobs(texte).values()) {
    for (const é of étapes(job.lignes)) {
      for (const r of extractions(é)) écarts.push(`${fichier} : job « ${job.nom} » : ${r}`);
    }
  }
  return écarts;
}
