# Harnais du besoin (#127, D75), définition commune avec #121 : les fichiers de test (`*.test.*`)
# que la branche ajoute ou modifie depuis sa base commune avec `origin/main`, index compris, pour
# que le harnais pas encore commis en fasse partie. Tout autre test est la non-régression.
#
# harnais_du_besoin FICHIER : écrit la liste dans FICHIER, un chemin par ligne depuis la racine du
# dépôt. Sur `main`, sans `origin/main` ou sans base commune, la liste est vide (tout est
# non-régression : un oubli fait jouer plus de vérifications, jamais moins), et la raison s'affiche
# sur la sortie standard. À appeler avant de retirer GIT_INDEX_FILE de l'environnement.
harnais_du_besoin() {
  : >"$1" || return 1
  if [ "$(git symbolic-ref --short -q HEAD)" = main ]; then
    echo "sur main, tout test est non-régression (aucun harnais du besoin)"
    return 0
  fi
  if ! git rev-parse -q --verify 'refs/remotes/origin/main^{commit}' >/dev/null; then
    echo "origin/main introuvable (git fetch origin main) : tout test est non-régression"
    return 0
  fi
  if ! hdb_base=$(git merge-base HEAD origin/main 2>/dev/null); then
    echo "aucune base commune avec origin/main : tout test est non-régression"
    return 0
  fi
  git -c core.quotePath=false diff --cached --name-only --no-renames --diff-filter=AM "$hdb_base" -- |
    grep -E '\.test\.[^/]+$' >"$1"
  return 0
}
