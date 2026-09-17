#!/bin/sh
# Livraison de Tirelire (#121, D76) : la pré-fusion et le pré-push jugent l'état commis.
#
#   livraison.sh fusion
#       `pre-merge-commit`, et `pre-commit` pendant une fusion (conflit) : juge l'index.
#   livraison.sh push <ref locale> <sha local> <ref distante> <sha distant>
#       une ligne du pré-push : juge le commit poussé.
#
# 1. Arbre jugé. L'index (fusion) ou le commit poussé, jamais la copie de travail : les tests
#    tournent sur place si la copie est identique à cet arbre, sinon dans une extraction à part
#    (`extraire.mjs`), dont les dépendances pointent vers celles du clone.
# 2. Nature du besoin. Les fichiers modifiés des deux côtés depuis la base commune sont comparés à
#    `packages/gardes/chemins-ignores` de l'arbre jugé (syntaxe de `.gitignore`) : un fichier listé
#    est fonctionnel, un fichier absent est organisationnel. Les deux peuvent se cumuler.
# 3. Sélection (hors tests navigateur, laissés à la CI) :
#    - fonctionnel : typecheck et tests headless des paquets touchés, tests headless de
#      l'interface ; objectif 30 s ;
#    - organisationnel : tests de la garde et tous les amorçages ; objectif 45 s.
#    Une sélection qui dépasse son objectif de plus de 20 % le dit, sans bloquer.
# 4. Harnais du besoin : les fichiers `*.test.*` que la branche ajoute ou modifie depuis sa base
#    commune avec `origin/main` (D75). Joué à part, quelle que soit sa finalité, hors objectif.
#    Il bloque si ce qui arrive (commits absents de `main` et de la branche d'arrivée) touche autre
#    chose que le harnais et la documentation (`**/test/**`, `**/*.test.*`, `docs/**`, `**/*.md`) ;
#    sinon son verdict s'affiche. La non-régression bloque toujours.
# 5. Sous-branche (`<branche>--codeur`, `<branche>--auditeur`) : non-régression seule.
# 6. Un arbre vérifié est noté dans `tirelire-arbres-verifies`, sous le dossier commun de git, avec
#    l'état de son harnais : le pré-push ne rejoue pas un arbre noté.
# Limite : une résolution de fusion qui ajoute du code (commit de fusion) ne compte pas comme code
# qui arrive ; la CI la juge.
set -u

mode=${1:-}
[ $# -gt 0 ] && shift
crochets=$(cd "$(dirname "$0")" && pwd) || exit 1
racine=$(git rev-parse --show-toplevel) || exit 1
cd "$racine" || exit 1
niveau=livraison
[ "$mode" = fusion ] && niveau=pré-fusion
[ "$mode" = push ] && niveau=pré-push

nul() { case $1 in '' | *[!0]*) return 1 ;; *) return 0 ;; esac; }
dit() { echo "$niveau : $*"; }

travail=$(mktemp -d) || exit 1
trap 'rm -rf "$travail"' EXIT
trap 'exit 130' INT TERM
journaux="$travail/journaux"
mkdir -p "$journaux" || exit 1
commun=$(cd "$(git rev-parse --git-common-dir)" && pwd) || exit 1
registre="$commun/tirelire-arbres-verifies"
main=''
git rev-parse -q --verify 'refs/remotes/origin/main^{commit}' >/dev/null && main=refs/remotes/origin/main

# ─── Lecture de git : tout ce qui dépend de l'index ou du dépôt se lit ici ───────────────────────
sous=''
case $mode in
  fusion)
    # Têtes fusionnées : MERGE_HEAD pendant un conflit ; pendant `pre-merge-commit`, git ne l'a pas
    # encore écrit et les nomme dans l'environnement (`GITHEAD_<sha>`).
    tetes=$(env | sed -n 's/^GITHEAD_\([0-9a-f]\{40,64\}\)=.*/\1/p')
    if [ -z "$tetes" ] && git rev-parse -q --verify MERGE_HEAD >/dev/null; then
      tetes=$(cat "$(git rev-parse --git-path MERGE_HEAD)")
    fi
    [ -n "$tetes" ] || { dit "aucune fusion en cours"; exit 0; }
    arbre=$(git write-tree) || exit 1
    # shellcheck disable=SC2086 # une tête par mot
    base=$(git merge-base --octopus HEAD $tetes 2>/dev/null) || base=''
    arrivee=HEAD
    [ "$(git symbolic-ref --short -q HEAD)" = main ] && surmain=1 || surmain=''
    # Base du harnais : la base commune de main et de l'arbre fusionné (HEAD et les têtes).
    # shellcheck disable=SC2086
    hbase=$([ -n "$main" ] && git merge-base "$main" HEAD $tetes 2>/dev/null) || hbase=''
    {
      [ -n "$base" ] && for t in HEAD $tetes; do git diff --name-only --no-renames "$base" "$t"; done
    } | sort -u >"$travail/modifies"
    # shellcheck disable=SC2086
    git log --no-merges --no-renames --format= --name-only $tetes --not HEAD $main >"$travail/entrants" || exit 1
    surplace=''
    git diff --quiet && [ -z "$(git ls-files --others --exclude-standard | head -n 1)" ] && surplace=1
    ;;
  push)
    lref=${1:-} lsha=${2:-} rref=${3:-} rsha=${4:-}
    case $rref in refs/heads/*) ;; *) exit 0 ;; esac
    nul "$lsha" && exit 0
    nom=${rref#refs/heads/}
    case $nom in *--codeur | *--auditeur) sous=1 ;; esac
    arbre=$(git rev-parse "$lsha^{tree}") || exit 1
    distant=''
    nul "$rsha" || { git cat-file -e "$rsha^{commit}" 2>/dev/null && distant=$rsha; }
    etat=$( [ -f "$registre" ] && awk -v a="$arbre" '$1 == a { e = $2 } END { print e }' "$registre")
    [ "$nom" = main ] && surmain=1 || surmain=''
    hbase=$([ -n "$main" ] && git merge-base "$main" "$lsha" 2>/dev/null) || hbase=''
    if [ -n "$distant" ]; then
      base=$(git merge-base "$distant" "$lsha" 2>/dev/null) || base=''
    else
      base=$hbase
    fi
    {
      if [ -n "$base" ]; then
        git diff --name-only --no-renames "$base" "$lsha"
        [ -n "$distant" ] && git diff --name-only --no-renames "$base" "$distant"
      else
        git ls-tree -r --name-only "$lsha"
      fi
    } | sort -u >"$travail/modifies"
    git log --no-merges --no-renames --format= --name-only "$lsha" --not $distant $main >"$travail/entrants" || exit 1
    surplace=''
    git diff --quiet "$lsha" -- && [ -z "$(git ls-files --others --exclude-standard | head -n 1)" ] && surplace=1
    ;;
  *)
    echo "usage : livraison.sh fusion | push <ref locale> <sha local> <ref distante> <sha distant>" >&2
    exit 2
    ;;
esac

# Le code qui arrive : un fichier hors du harnais et de la documentation.
code=$(grep -Ev '(^|/)test/|\.test\.[^/]+$|^docs/|\.md$|^$' "$travail/entrants" | sort -u | head -n 3 | tr '\n' ' ')

if [ "$mode" = push ] && [ -n "$etat" ]; then
  if [ -n "$sous" ] || [ "$etat" = vert ] || [ -z "$code" ]; then
    dit "arbre déjà vérifié ($etat), rien à rejouer — $nom"
    exit 0
  fi
  echo "✗ $niveau : cet arbre a été vérifié avec le harnais du besoin rouge, et le push apporte du code ($code)." >&2
  echo "pré-push refusé — $nom." >&2
  exit 1
fi

# Harnais du besoin (D75).
: >"$journaux/harnais.txt"
if [ -n "$surmain" ]; then
  dit "sur main, tout test est non-régression (aucun harnais du besoin)"
elif [ -z "$main" ]; then
  dit "origin/main introuvable (git fetch origin main) : tout test est non-régression"
elif [ -z "$hbase" ]; then
  dit "aucune base commune avec origin/main : tout test est non-régression"
else
  git -c core.quotePath=false diff --name-only --no-renames --diff-filter=AM "$hbase" "$arbre" -- |
    grep -E '\.test\.[^/]+$' >"$journaux/harnais.txt"
fi
git ls-tree -r --name-only "$arbre" >"$travail/fichiers" || exit 1
git cat-file -p "$arbre:packages/gardes/chemins-ignores" >"$travail/chemins-ignores" 2>/dev/null || : >"$travail/chemins-ignores"

# Arbre jugé : sur place, ou extrait à part.
if [ -n "$surplace" ]; then
  juge=$racine
else
  juge="$travail/arbre"
  mkdir -p "$juge" || exit 1
  GIT_INDEX_FILE="$travail/index" git read-tree "$arbre" &&
    GIT_INDEX_FILE="$travail/index" git checkout-index -a --prefix="$juge/" || exit 1
fi

# Git est lu : les tests ne doivent plus rien en hériter.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_OBJECT_DIRECTORY GIT_COMMON_DIR GIT_QUARANTINE_PATH

if [ "$juge" != "$racine" ]; then
  node "$crochets/extraire.mjs" "$racine" "$juge" || exit 1
  dit "copie de travail différente de l'arbre jugé : tests joués sur une extraction"
fi

# ─── Nature du besoin ──────────────────────────────────────────────────────────────────────────────
classe="$travail/classe"
git init -q "$classe" || exit 1
cp "$travail/chemins-ignores" "$classe/.git/info/exclude"
git -C "$classe" check-ignore --no-index --stdin <"$travail/modifies" >"$travail/fonctionnels" 2>/dev/null
grep -vxF -f "$travail/fonctionnels" "$travail/modifies" | grep -v '^$' >"$travail/organisationnels"
fonc='' org=''
[ -s "$travail/fonctionnels" ] && fonc=1
[ -s "$travail/organisationnels" ] && org=1

if ! command -v pnpm >/dev/null 2>&1; then
  echo "$niveau : pnpm introuvable, les tests ne peuvent pas être joués." >&2
  exit 1
fi

# Garde-fou : un amorçage qui pousse dans une copie du dépôt relance une livraison, qui rejouerait les
# amorçages, dont lui-même. Une livraison ne rejoue donc pas un amorçage qu'un processus parent est
# déjà en train de jouer (son nom figure dans la ligne de commande d'un ancêtre).
ps -o args= -p $$ >/dev/null 2>&1 && {
  pid=$$
  while [ "${pid:-0}" -gt 1 ]; do
    for mot in $(ps -o args= -p "$pid" 2>/dev/null); do
      case $mot in amorcage/*.test.mjs | */amorcage/*.test.mjs) echo "amorcage/${mot##*/}" ;; esac
    done
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
  done
} | sort -u >"$travail/amorcages-parents"
[ -f "$travail/amorcages-parents" ] || : >"$travail/amorcages-parents"
sans_parents() {
  grep -vxF -f "$travail/amorcages-parents"
}
[ -s "$travail/amorcages-parents" ] &&
  dit "livraison imbriquée : $(wc -l <"$travail/amorcages-parents" | tr -d ' ') amorçage(s) déjà joué(s) par un processus parent, non rejoué(s)"

# ─── Lancements ────────────────────────────────────────────────────────────────────────────────────
dans() { grep -E "^$1/" "$journaux/harnais.txt" | sed "s#^$1/##"; }
vitest_de() { grep -q '"test": *"vitest' "$juge/$1/package.json" 2>/dev/null; }
lance() { # nom dossier commande…
  nom=$1 dossier=$2
  shift 2
  (cd "$juge/$dossier" && "$@" >"$journaux/$nom.log" 2>&1; echo $? >"$journaux/$nom.code") &
}
rapports_node() { echo "--test-reporter=tap" "--test-reporter-destination=stdout" "--test-reporter=$crochets/rapport-node.mjs" "--test-reporter-destination=$journaux/$1.rapport"; }
lances=''
ajoute() { lances="$lances $1"; }

# Non-régression d'un paquet de tests, sans ses fichiers du harnais du besoin.
non_regression() { # nom dossier
  nom=$1 dossier=$2
  if vitest_de "$dossier"; then
    set -- --passWithNoTests --reporter=default --reporter=json "--outputFile.json=$journaux/$nom.rapport"
    [ "$dossier" = packages/core ] && set -- "$@" --no-isolate
    [ "$dossier" = apps/web ] && set -- "$@" --exclude 'test/navigateur/**'
    for f in $(dans "$dossier"); do set -- "$@" --exclude "$f"; done
    lance "$nom" "$dossier" pnpm run test "$@"
    ajoute "$nom:$dossier:vitest"
  else
    if [ -n "$(dans "$dossier")" ]; then
      liste=$(grep -E "^$dossier/[^/]*\\.test\\.[cm]?js$" "$travail/fichiers" | grep -vxF -f "$journaux/harnais.txt" | sed "s#^$dossier/##")
      [ -n "$liste" ] || { dit "$nom : aucun test hors du harnais du besoin"; return 0; }
      # shellcheck disable=SC2046,SC2086
      lance "$nom" "$dossier" pnpm run test $(rapports_node "$nom") $liste
    else
      # shellcheck disable=SC2046
      lance "$nom" "$dossier" pnpm run test $(rapports_node "$nom")
    fi
    ajoute "$nom:$dossier:node"
  fi
}

typecheck() { # nom dossier
  lance "$1" "$2" pnpm run typecheck
  ajoute "$1:$2:typecheck"
}

debut=$(date +%s)
selection=''
objectif=0
if [ -n "$fonc" ]; then
  objectif=$((objectif + 30))
  paquets=$(grep -Eo '^(apps|packages)/[^/]+/' "$travail/fonctionnels" | sed 's#/$##' | sort -u)
  for p in $paquets; do
    [ -f "$juge/$p/package.json" ] || continue
    n=$(basename "$p")
    typecheck "typecheck-$n" "$p"
    [ "$p" = apps/web ] || non_regression "$n" "$p"
  done
  non_regression interface apps/web
  selection="fonctionnel ($(echo $paquets | tr ' ' ',') ; interface headless)"
fi
if [ -n "$org" ]; then
  objectif=$((objectif + 45))
  non_regression garde packages/gardes
  liste=$(grep -E '^amorcage/[^/]*\.test\.mjs$' "$travail/fichiers" | grep -vxF -f "$journaux/harnais.txt" | sans_parents)
  if [ -n "$liste" ]; then
    # shellcheck disable=SC2046,SC2086
    lance amorçages . node --import ./packages/gardes/sans-sortie.mjs --test $(rapports_node amorçages) $liste
    ajoute "amorçages:amorcage:node"
  fi
  selection="${selection:+$selection + }organisationnel (garde, amorçages)"
fi
[ -n "$selection" ] || selection="aucun fichier modifié"
dit "besoin $selection"
wait
duree=$(($(date +%s) - debut))
if [ "$objectif" -gt 0 ] && [ $((duree * 10)) -gt $((objectif * 12)) ]; then
  dit "la sélection a pris $duree s, au-delà de son objectif de $objectif s (+20 %) — sans bloquer"
fi

# ─── Harnais du besoin, joué à part ────────────────────────────────────────────────────────────────
harnais_lances=''
if [ -z "$sous" ] && [ -s "$journaux/harnais.txt" ]; then
  for d in packages/core apps/web; do
    liste=$(dans "$d")
    [ -n "$liste" ] || continue
    n="harnais-$(basename "$d")"
    # shellcheck disable=SC2086
    lance "$n" "$d" pnpm run test --reporter=default --reporter=json "--outputFile.json=$journaux/$n.rapport" $liste
    harnais_lances="$harnais_lances $n:$d:vitest"
  done
  for d in $(grep -Eo '^(apps|packages)/[^/]+/' "$journaux/harnais.txt" | sed 's#/$##' | sort -u); do
    case $d in packages/core | apps/web) continue ;; esac
    [ -f "$juge/$d/package.json" ] || continue
    n="harnais-$(basename "$d")"
    # shellcheck disable=SC2046,SC2086
    lance "$n" "$d" pnpm run test $(rapports_node "$n") $(dans "$d")
    harnais_lances="$harnais_lances $n:$d:node"
  done
  liste=$(grep -E '^amorcage/' "$journaux/harnais.txt" | sans_parents)
  if [ -n "$liste" ]; then
    # shellcheck disable=SC2046,SC2086
    lance harnais-amorçages . node --import ./packages/gardes/sans-sortie.mjs --test $(rapports_node harnais-amorçages) $liste
    harnais_lances="$harnais_lances harnais-amorçages:amorcage:node"
  fi
  autres=$(grep -Ev '^(apps|packages)/[^/]+/|^amorcage/' "$journaux/harnais.txt" | tr '\n' ' ')
  [ -z "$autres" ] || dit "harnais du besoin hors de tout paquet, non joué : $autres"
  wait
elif [ -n "$sous" ] && [ -s "$journaux/harnais.txt" ]; then
  dit "push vers une sous-branche : le harnais du besoin n'est pas joué"
fi

bloque=affiche
if [ -n "$sous" ]; then
  :
elif [ -n "$code" ]; then
  bloque=bloque
  dit "ce qui arrive apporte du code ($code) : le harnais du besoin bloque"
else
  dit "ce qui arrive n'apporte que du harnais ou de la documentation : le harnais du besoin s'affiche sans bloquer"
fi

# shellcheck disable=SC2086 # les lancements n'ont pas d'espace
TIRELIRE_NIVEAU=$niveau TIRELIRE_HARNAIS=$bloque node "$crochets/verdict.mjs" "$juge" "$journaux" "$debut" $lances $harnais_lances
verdict=$?
if [ "$verdict" -eq 0 ] && [ -z "$sous" ]; then
  echo "$arbre $(cat "$journaux/harnais.etat" 2>/dev/null || echo vert)" >>"$registre"
fi
exit "$verdict"
