/**
 * La version que la page exécute (#142) : fixée à la construction, jamais lue ailleurs, pour que ce
 * qui s'affiche soit le code qui tourne et non la dernière version disponible.
 *
 * Les sortes de builds sont celles de D83 : une version publiée par son tag (`v0.0`), une version
 * forcée (`v0.0-8f3df4a`), `main` à la racine de la recette, une PR dans `pr-<numéro>` ; à quoi
 * s'ajoute la construction locale, qui le dit sans inventer de numéro.
 */

export type VersionConstruite =
  | { sorte: 'publiee'; nom: string }
  | { sorte: 'forcee'; nom: string }
  | { sorte: 'main'; commit: string }
  | { sorte: 'branche'; branche: string; commit: string }
  | { sorte: 'apercu'; pr: number; commit: string }
  | { sorte: 'locale'; commit?: string };

/** Une version numérotée : `v` suivi de nombres séparés par des points (`version-forcee.mjs`). */
const NUMEROTEE = /^v\d+(?:\.\d+)*$/;
/** Une version forcée : une version numérotée, un tiret, le hash court du commit (D83). */
const FORCEE = /^v\d+(?:\.\d+)*-[0-9a-f]{7,40}$/;
const COMMIT = /^[0-9a-f]{7,40}$/i;
const COURT = 7;

const court = (commit: string): string => commit.slice(0, COURT).toLowerCase();

/** Le nom d'une version, publiée ou forcée ; `undefined` si ce n'en est pas un. */
function version(nom: string): VersionConstruite | undefined {
  if (NUMEROTEE.test(nom)) return { sorte: 'publiee', nom };
  if (FORCEE.test(nom)) return { sorte: 'forcee', nom };
  return undefined;
}

/**
 * La version d'une construction, d'après son environnement :
 * - `TIRELIRE_VERSION` : le nom d'une version, publiée ou forcée, que la CI passe quand la référence
 *   construite ne le porte pas (une version forcée se construit depuis `main`) ;
 * - dans la CI (`GITHUB_ACTIONS`) : un tag `v*` est une version publiée ; une PR
 *   (`refs/pull/<numéro>/…`), son aperçu, au commit `TIRELIRE_COMMIT` (la tête de la branche) ou
 *   `GITHUB_SHA` ; `main`, la version de développement de la recette ; une autre branche, son nom ;
 * - ailleurs : une construction locale, avec son commit s'il se lit (`commitLocal`).
 */
export function versionConstruite(
  env: Record<string, string | undefined>,
  commitLocal: () => string | undefined = () => undefined,
): VersionConstruite {
  const explicite = env.TIRELIRE_VERSION?.trim();
  if (explicite) {
    const v = version(explicite);
    if (!v) throw new Error(`TIRELIRE_VERSION « ${explicite} » n'est le nom d'aucune version (v0.0, v0.0-8f3df4a).`);
    return v;
  }
  if (env.GITHUB_ACTIONS === 'true') {
    const ref = env.GITHUB_REF ?? '';
    const commit = [env.TIRELIRE_COMMIT, env.GITHUB_SHA].find((c) => c && COMMIT.test(c));
    if (ref.startsWith('refs/tags/')) {
      const v = version(ref.slice('refs/tags/'.length));
      if (v) return v;
    }
    const pr = /^refs\/pull\/([1-9][0-9]*)\//.exec(ref);
    if (pr && commit) return { sorte: 'apercu', pr: Number(pr[1]), commit: court(commit) };
    if (ref === 'refs/heads/main' && commit) return { sorte: 'main', commit: court(commit) };
    if (ref.startsWith('refs/heads/') && commit) return { sorte: 'branche', branche: ref.slice('refs/heads/'.length), commit: court(commit) };
  }
  const local = commitLocal();
  return local && COMMIT.test(local) ? { sorte: 'locale', commit: court(local) } : { sorte: 'locale' };
}

/** Ce que l'application dit de sa version. */
export function texteVersion(v: VersionConstruite): string {
  switch (v.sorte) {
    case 'publiee':
      return `Tirelire ${v.nom}`;
    case 'forcee':
      return `Tirelire ${v.nom} (version forcée)`;
    case 'main':
      return `Tirelire, version de développement : main, commit ${v.commit}`;
    case 'branche':
      return `Tirelire, version de développement : branche ${v.branche}, commit ${v.commit}`;
    case 'apercu':
      return `Tirelire, version de développement : aperçu de la PR n° ${v.pr}, commit ${v.commit}`;
    case 'locale':
      return `Tirelire, construction locale sans numéro de version${v.commit ? ` (commit ${v.commit})` : ''}`;
  }
}

declare const __TIRELIRE_VERSION__: VersionConstruite | undefined;

/** La version de ce code, fixée à sa construction (`vite.config.ts`). */
export const VERSION: VersionConstruite = typeof __TIRELIRE_VERSION__ === 'undefined' ? { sorte: 'locale' } : __TIRELIRE_VERSION__;
