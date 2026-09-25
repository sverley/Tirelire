# Harnais du besoin (#127, #121, #232), définition commune aux crochets et à la CI : le fichier de
# test que l'auditeur nomme dans l'issue et qui porte le numéro de l'issue. Parmi les fichiers de
# test (`*.test.*`) que la branche ajoute ou modifie depuis sa base commune avec `origin/main`, index
# compris, c'est celui dont les trois premières lignes disent « Harnais d'audit de #<numéro> », le
# numéro étant celui du nom de la branche (`audit/232-…` → 232 ; sans numéro, tout
# « Harnais d'audit de #<n> ») : les crochets le reconnaissent sans lire l'issue. Les autres fichiers de test de la branche, ceux du
# codeur compris, et tout autre test sont la non-régression : ils se jouent à leur niveau.
#
# harnais_du_besoin FICHIER : écrit la liste dans FICHIER, un chemin par ligne depuis la racine du
# dépôt. Sur `main`, sans `origin/main` ou sans base commune, la liste est vide (tout est
# non-régression : un oubli fait jouer plus de vérifications, jamais moins), et la raison s'affiche
# sur la sortie standard. À appeler avant de retirer GIT_INDEX_FILE de l'environnement.
#
# harnais_retenus ENTREE SORTIE SOURCE BRANCHE : garde de la liste ENTREE les fichiers qui portent le
# numéro de BRANCHE, lus dans SOURCE (`:` pour l'index, `<arbre>:` pour un arbre), et l'écrit dans
# SORTIE. La livraison s'en sert sur l'arbre qu'elle juge.
#
# Exécuté (`sh .githooks/harnais-du-besoin.sh --jouer`), il joue le harnais du besoin en entier, au
# seuil 4, dans le paquet de chaque fichier, et sort en échec si l'un rougit : c'est l'étape de la CI
# au Ready. Sans harnais du besoin, il le dit et sort en succès.

# Nom de la branche : celle qui est extraite, sinon celle de la PR en CI.
branche_du_besoin() {
  git symbolic-ref --short -q HEAD 2>/dev/null || printf '%s\n' "${GITHUB_HEAD_REF:-}"
}

# Numéro d'issue d'un nom de branche : le premier nombre qui ouvre un de ses segments.
numero_du_besoin() {
  printf '%s\n' "$1" | tr '/' '\n' | sed -n 's/^\([0-9][0-9]*\).*/\1/p' | head -n 1
}

harnais_retenus() {
  : >"$2" || return 1
  hr_numero=$(numero_du_besoin "$4")
  hr_motif="harnais d.{1,3}audit de #${hr_numero:-[0-9][0-9]*}([^0-9]|\$)"
  while IFS= read -r hr_f; do
    [ -n "$hr_f" ] || continue
    if git cat-file -p "$3$hr_f" 2>/dev/null | head -n 3 | grep -qiE "$hr_motif"; then
      printf '%s\n' "$hr_f" >>"$2"
    fi
  done <"$1"
  return 0
}

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
    grep -E '\.test\.[^/]+$' >"$1.candidats"
  harnais_retenus "$1.candidats" "$1" : "$(branche_du_besoin)"
  rm -f "$1.candidats"
  return 0
}

if [ "${1:-}" = --jouer ]; then
  set -u
  hdb_racine=$(git rev-parse --show-toplevel) || exit 1
  cd "$hdb_racine" || exit 1
  hdb_liste=$(mktemp) || exit 1
  trap 'rm -f "$hdb_liste"' EXIT
  harnais_du_besoin "$hdb_liste" || exit 1
  if [ ! -s "$hdb_liste" ]; then
    echo "harnais du besoin : aucun fichier de test de la branche ne porte le numéro de son issue ($(branche_du_besoin))."
    exit 0
  fi
  hdb_code=0
  for hdb_d in $(grep -Eo '^(apps|packages)/[^/]+/' "$hdb_liste" | sed 's#/$##' | sort -u); do
    hdb_fichiers=$(grep -E "^$hdb_d/" "$hdb_liste" | sed "s#^$hdb_d/##" | tr '\n' ' ')
    echo "harnais du besoin, en entier (seuil 4) — $hdb_d : $hdb_fichiers"
    # shellcheck disable=SC2086 # un fichier par mot
    pnpm --dir "$hdb_d" run test 4 $hdb_fichiers || hdb_code=1
  done
  hdb_autres=$(grep -Ev '^(apps|packages)/[^/]+/' "$hdb_liste" | tr '\n' ' ')
  if [ -n "$hdb_autres" ]; then
    echo "harnais du besoin hors de tout paquet, qui ne peut pas être joué : $hdb_autres" >&2
    hdb_code=1
  fi
  exit $hdb_code
fi
