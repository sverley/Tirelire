/**
 * Les branches d'une PR fermée (#264, D83) : à la fermeture d'une PR, fusionnée ou non,
 * `<tête>--attestation`, et `<tête>--codeur` et `<tête>--auditeur` s'il y en a, sont supprimées du
 * dépôt, par leur nom exact, jamais par préfixe ; la tête elle-même n'est pas touchée. Chacune est
 * nommée avec son dernier commit, pour qu'elle puisse être recréée
 * (`git push origin <commit>:refs/heads/<branche>`).
 *
 *   node branches-fermees.mjs fermeture [<tête>] les branches de la PR fermée dont la tête est <tête>,
 *                                                lue sinon dans l'événement (`GITHUB_EVENT_PATH`)
 *   node branches-fermees.mjs orphelines         toute branche `…--attestation`, `…--codeur` ou
 *                                                `…--auditeur` sans PR ouverte de sa tête
 *
 * Lit `GH_TOKEN` et `GH_REPO` (propriétaire/dépôt) ; écrit aussi dans `GITHUB_STEP_SUMMARY` s'il est
 * donné. N'appelle que l'API de GitHub : rien ne s'exécute ni ne s'extrait d'une PR.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SUFFIXES = Object.freeze(['--attestation', '--codeur', '--auditeur']);

/** La tête d'une branche `<tête>--attestation|codeur|auditeur`, ou `null`. */
export function teteDe(branche) {
  const s = SUFFIXES.find((x) => branche.endsWith(x) && branche.length > x.length);
  return s ? branche.slice(0, -s.length) : null;
}

/** Les branches de la PR dont la tête est `tete`, parmi `branches` : les noms exacts, rien d'autre. */
export function branchesDeLaTete(tete, branches) {
  const noms = new Set(SUFFIXES.map((s) => `${tete}${s}`));
  return branches.filter((b) => noms.has(b.nom));
}

/** Les branches `…--attestation|codeur|auditeur` dont la tête n'a aucune PR ouverte. */
export function orphelines(branches, tetesOuvertes) {
  const ouvertes = new Set(tetesOuvertes);
  return branches.filter((b) => {
    const t = teteDe(b.nom);
    return t !== null && !ouvertes.has(t);
  });
}

/** Encode un nom de branche pour une adresse de l'API ; `/` reste un séparateur. */
const encoder = (nom) => nom.split('/').map(encodeURIComponent).join('/');

export function client({ jeton, depot, api = 'https://api.github.com', appeler = fetch }) {
  const entetes = { Authorization: `Bearer ${jeton}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  async function appel(methode, chemin) {
    const r = await appeler(chemin.startsWith('http') ? chemin : `${api}/repos/${depot}/${chemin}`, { method: methode, headers: entetes });
    return { statut: r.status, donnees: r.status === 204 || !r.ok ? null : await r.json(), texte: r.ok ? '' : await r.text(), suivant: /<([^>]+)>;\s*rel="next"/.exec(r.headers?.get?.('link') ?? '')?.[1] };
  }
  async function* pages(chemin) {
    let url = `${chemin}${chemin.includes('?') ? '&' : '?'}per_page=100`;
    while (url) {
      const r = await appel('GET', url);
      if (r.statut === 404) return;
      if (!r.donnees) throw new Error(`GET ${url} : ${r.statut} ${r.texte}`);
      yield* r.donnees;
      url = r.suivant;
    }
  }
  /** Les branches dont le nom commence par `prefixe` (lecture par préfixe ; suppression par nom exact). */
  async function branches(prefixe = '') {
    const liste = [];
    for await (const ref of pages(`git/matching-refs/heads/${encoder(prefixe)}`)) liste.push({ nom: ref.ref.replace(/^refs\/heads\//, ''), commit: ref.object?.sha });
    return liste;
  }
  /** Les têtes des PR ouvertes, venues de ce dépôt. */
  async function tetesOuvertes() {
    const tetes = [];
    for await (const pr of pages('pulls?state=open')) if (!pr.head?.repo?.full_name || pr.head.repo.full_name === depot) tetes.push(pr.head.ref);
    return tetes;
  }
  /** Supprime la branche de ce nom exact ; rend `supprimée` ou `disparue`, ou lève une erreur. */
  async function supprimer(nom) {
    const r = await appel('DELETE', `git/refs/heads/${encoder(nom)}`);
    if (r.statut === 204 || r.statut === 200) return 'supprimée';
    if (r.statut === 404 || r.statut === 422) return 'disparue avant sa suppression';
    throw new Error(`DELETE ${nom} : ${r.statut} ${r.texte}`);
  }
  return { branches, tetesOuvertes, supprimer };
}

/** Supprime ces branches, chacune nommée avec son dernier commit ; rend les lignes du compte rendu. */
async function supprimerToutes(gh, liste) {
  const lignes = [];
  for (const b of liste) lignes.push(`- \`${b.nom}\` : ${await gh.supprimer(b.nom)}, dernier commit \`${b.commit}\``);
  return lignes;
}

/** À la fermeture d'une PR : ses branches, par leur nom exact. */
export async function fermeture(gh, tete) {
  const liste = branchesDeLaTete(tete, await gh.branches(`${tete}--`));
  const lignes = await supprimerToutes(gh, liste);
  return [`Branches de la PR fermée (tête \`${tete}\`, qui n'est pas touchée) :`, ...(lignes.length ? lignes : ['- aucune'])];
}

/** Les branches qui traînent sans PR ouverte de leur tête. */
export async function orphelinesDuDepot(gh) {
  const liste = orphelines(await gh.branches(), await gh.tetesOuvertes());
  const lignes = await supprimerToutes(gh, liste);
  return ['Branches `…--attestation`, `…--codeur` et `…--auditeur` sans PR ouverte de leur tête :', ...(lignes.length ? lignes : ['- aucune'])];
}

/**
 * La tête de la PR fermée, lue dans l'événement `pull_request_target` ; `null` pour une PR venue d'un
 * autre dépôt, dont les branches ne sont pas ici.
 */
export function teteDeLEvenement(evenement, depot) {
  const tete = evenement?.pull_request?.head;
  if (!tete?.ref) return null;
  if (tete.repo?.full_name && tete.repo.full_name !== depot) return null;
  return tete.ref;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, donnee] = process.argv.slice(2);
  const { GH_TOKEN: jeton, GH_REPO: depot, GITHUB_STEP_SUMMARY: resume, GITHUB_EVENT_PATH: fichierEvenement } = process.env;
  let tete = donnee;
  if (mode === 'fermeture' && !tete && fichierEvenement) {
    tete = teteDeLEvenement(JSON.parse(readFileSync(fichierEvenement, 'utf8')), depot);
    if (tete === null) {
      console.log("PR venue d'un autre dépôt, ou sans tête : aucune branche à supprimer ici.");
      process.exit(0);
    }
  }
  if (!jeton || !depot || !(mode === 'orphelines' || (mode === 'fermeture' && tete))) {
    console.error('usage : GH_TOKEN=… GH_REPO=propriétaire/dépôt node branches-fermees.mjs fermeture [<tête>] | orphelines');
    process.exit(2);
  }
  const gh = client({ jeton, depot });
  const lignes = mode === 'fermeture' ? await fermeture(gh, tete) : await orphelinesDuDepot(gh);
  console.log(lignes.join('\n'));
  if (resume) appendFileSync(resume, `### ${lignes[0]}\n\n${lignes.slice(1).join('\n')}\n`);
}
