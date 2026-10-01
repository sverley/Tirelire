# Tests navigateur de l'issue (#307), définition commune à la livraison et à la CI : les fichiers de
# tests navigateur (`apps/web/test/navigateur/*.test.*`) que la branche ajoute ou modifie depuis sa
# base commune avec `origin/main`, hors harnais du besoin (`harnais-du-besoin.sh`), qui se joue à
# part. Ils se jouent pendant toute la PR — à chaque livraison et au Ready —, en entier (seuil 4),
# sauf chaque fichier vert sur son empreinte ; les tests navigateur de non-régression, eux, se jouent
# la nuit, sur `main` (`nuit.yml`). Une seule définition, ici, pour la livraison et la CI : la
# livraison la source (`livraison.sh`), et l'applique aux fichiers de l'arbre qu'elle juge ; la CI,
# à ceux de l'index.
#
# tests_de_l_issue_parmi CANDIDATS HARNAIS SORTIE : parmi les fichiers de test que la branche ajoute
# ou modifie (CANDIDATS, un chemin par ligne depuis la racine), ceux de `apps/web/test/navigateur/`
# qui ne sont pas dans HARNAIS ; écrit la liste dans SORTIE.
#
# tests_de_l_issue FICHIER : écrit la liste dans FICHIER, lue dans l'index ; vide sur `main`, sans
# `origin/main` ou sans base commune.
#
# Exécuté (`sh .githooks/tests-de-l-issue.sh --jouer [--attestation <fichier>]`), il les joue dans
# `apps/web`, au seuil 4, tests navigateur activés, et sort en échec si l'un rougit : c'est l'étape de
# la CI au Ready. `--attestation` passe le fichier au lanceur (#302) : un fichier vert sur son
# empreinte n'est pas rejoué, et le lanceur le dit. Sans test navigateur de l'issue, il le dit et sort
# en succès.

# Les fonctions du harnais du besoin, sans ses arguments : exécuté avec `--jouer`, il le jouerait.
# Sourcé par la livraison, le dossier des crochets est le sien (`$crochets`).
tdi_args="${1:-} ${2:-} ${3:-}"
set --
# shellcheck source=harnais-du-besoin.sh
. "${crochets:-$(dirname "$0")}/harnais-du-besoin.sh"
# shellcheck disable=SC2086 # les arguments n'ont pas d'espace
set -- $tdi_args

tests_de_l_issue_parmi() {
  grep -E '^apps/web/test/navigateur/.*\.test\.[^/]+$' "$1" | grep -vxF -f "$2" >"$3"
  return 0
}

tests_de_l_issue() {
  : >"$1" || return 1
  [ "$(git symbolic-ref --short -q HEAD)" = main ] && return 0
  git rev-parse -q --verify 'refs/remotes/origin/main^{commit}' >/dev/null || return 0
  tdi_base=$(git merge-base HEAD origin/main 2>/dev/null) || return 0
  git -c core.quotePath=false diff --cached --name-only --no-renames --diff-filter=AM "$tdi_base" -- |
    grep -E '\.test\.[^/]+$' >"$1.candidats"
  harnais_du_besoin "$1.harnais" >/dev/null || return 1
  tests_de_l_issue_parmi "$1.candidats" "$1.harnais" "$1"
  rm -f "$1.candidats" "$1.harnais"
  return 0
}

if [ "${1:-}" = --jouer ]; then
  set -u
  tdi_attestation=''
  [ "${2:-}" = --attestation ] && tdi_attestation=${3:-}
  tdi_racine=$(git rev-parse --show-toplevel) || exit 1
  cd "$tdi_racine" || exit 1
  tdi_liste=$(mktemp) || exit 1
  trap 'rm -f "$tdi_liste"' EXIT
  tests_de_l_issue "$tdi_liste" || exit 1
  if [ ! -s "$tdi_liste" ]; then
    echo "tests navigateur de l'issue : la branche n'ajoute ni ne modifie aucun fichier de apps/web/test/navigateur/, hors harnais du besoin."
    exit 0
  fi
  tdi_fichiers=$(sed 's#^apps/web/##' "$tdi_liste" | tr '\n' ' ')
  echo "tests navigateur de l'issue, en entier (seuil 4) : $tdi_fichiers"
  # shellcheck disable=SC2086 # un fichier par mot
  if [ -n "$tdi_attestation" ]; then
    pnpm --dir apps/web run test 4 --navigateur --attestation "$tdi_attestation" $tdi_fichiers
  else
    pnpm --dir apps/web run test 4 --navigateur $tdi_fichiers
  fi
fi
