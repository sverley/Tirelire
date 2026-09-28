/**
 * #274 · Le nom d'une version forcée, et le refus de publier.
 *
 * Une version forcée publie le dernier commit de `main`, d'un déclenchement manuel
 * (`.github/workflows/version-forcee.yml`, qui appelle `ci.yml`). Son nom : le dernier numéro de
 * version publié, un tiret, puis le hash court du commit — `v0.2-1a2b3c4` si la dernière version
 * numérotée est `v0.2` ; `v0.0` tant qu'aucune n'est publiée. Est numérotée une version dont le tag
 * est `v` suivi de nombres séparés par des points, sans rien d'autre ; une version forcée ne l'est
 * pas et ne sert jamais de base. Les versions numérotées restent posées à la main par le porteur :
 * ce nom n'en est jamais une (D83, « Livraison »).
 *
 * Rien ne se publie si le déclenchement ne vise pas `main`, ou si le commit porte déjà une version,
 * forcée ou numérotée : un tag `v*`, ce que `ci.yml` publie.
 *
 * En ligne de commande, dans la CI : `node packages/gardes/version-forcee.mjs nom`. Lit `GITHUB_REF`,
 * `GITHUB_SHA` et les tags du clone (toute l'histoire, tags compris) ; écrit `nom=<tag>` dans
 * `GITHUB_OUTPUT` et le constat dans `GITHUB_STEP_SUMMARY` ; sur un refus, dit pourquoi et sort en
 * erreur. Ne pose aucun tag : c'est le job « Étiquette de la version », après le seuil 3 vert.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Une version numérotée : `v` suivi de nombres séparés par des points, sans rien d'autre. */
export const NUMÉROTÉE = /^v\d+(?:\.\d+)*$/;
/** Une version, forcée ou numérotée : tout tag `v*`, ce que `ci.yml` publie. */
export const VERSION = /^v/;
/** La base tant qu'aucune version numérotée n'est publiée. */
export const BASE_INITIALE = 'v0.0';
/** La seule référence d'où une version forcée se publie. */
export const MAIN = 'refs/heads/main';
/** Longueur du hash court. */
export const COURT = 7;

const nombres = (tag) => tag.slice(1).split('.').map(Number);

/** Compare deux versions numérotées, nombre par nombre ; `v0.2` et `v0.2.0` sont égales. */
export function comparer(a, b) {
  const [x, y] = [nombres(a), nombres(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Le dernier numéro de version publié : la plus haute version numérotée ; `v0.0` s'il n'y en a pas. */
export function base(tags) {
  const numérotées = tags.filter((t) => NUMÉROTÉE.test(t));
  return numérotées.length ? numérotées.reduce((a, b) => (comparer(b, a) > 0 ? b : a)) : BASE_INITIALE;
}

/** Le nom de la version forcée du commit `sha`, parmi les tags du dépôt. */
export function nomDeLaVersionForcée(tags, sha) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha ?? '')) throw new Error(`hash de commit illisible : « ${sha} »`);
  const nom = `${base(tags)}-${sha.slice(0, COURT).toLowerCase()}`;
  // Une version numérotée n'est jamais créée ici : elle reste au porteur.
  if (NUMÉROTÉE.test(nom)) throw new Error(`« ${nom} » serait une version numérotée`);
  return nom;
}

/**
 * Publier ou non : `{ nom }`, ou `{ refus }` qui dit pourquoi.
 * - `ref` : la référence du déclenchement ; seule `refs/heads/main` publie ;
 * - `sha` : le commit ;
 * - `tags` : tous les tags du dépôt ;
 * - `tagsDuCommit` : ceux que porte le commit.
 */
export function décider({ ref, sha, tags, tagsDuCommit }) {
  if (ref !== MAIN) return { refus: `une version forcée se publie depuis le dernier commit de main ; ce déclenchement vise « ${ref} »` };
  const versions = tagsDuCommit.filter((t) => VERSION.test(t));
  if (versions.length) return { refus: `le commit ${sha.slice(0, COURT)} porte déjà une version (${versions.join(', ')}) : rien ne se publie` };
  return { nom: nomDeLaVersionForcée(tags, sha) };
}

/** Les tags du clone, et ceux que porte le commit. */
export function lireLesTags(sha, cwd = process.cwd()) {
  const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
  return { tags: git('tag', '--list'), tagsDuCommit: git('tag', '--points-at', sha) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode] = process.argv.slice(2);
  const { GITHUB_REF: ref, GITHUB_SHA: sha, GITHUB_OUTPUT: sortie, GITHUB_STEP_SUMMARY: résumé } = process.env;
  const écrire = (fichier, texte) => fichier && appendFileSync(fichier, texte);
  if (mode !== 'nom') {
    console.error('usage : node packages/gardes/version-forcee.mjs nom (lit GITHUB_REF et GITHUB_SHA)');
    process.exit(2);
  }
  const d = décider({ ref, sha, ...lireLesTags(sha) });
  if (d.refus) {
    console.log(`::error title=Version forcée refusée::${d.refus}`);
    écrire(résumé, `### Version forcée refusée\n\n${d.refus}.\n`);
    process.exit(1);
  }
  console.log(`version forcée : ${d.nom}, sur ${sha}`);
  écrire(sortie, `nom=${d.nom}\n`);
  écrire(résumé, `### Version forcée : \`${d.nom}\`\n\nLe commit \`${sha}\` de main, pas encore publié. Le tag ne se pose qu'après le seuil 3 vert.\n`);
}
