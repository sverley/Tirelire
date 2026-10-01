#!/bin/sh
# Livraison de Tirelire (#121, #232, #237, #264, #266) : la pré-fusion, le pré-push et la demande
# jugent l'état commis.
#
#   livraison.sh fusion
#       `pre-merge-commit`, et `pre-commit` pendant une fusion (conflit) : juge l'index.
#   livraison.sh push <ref locale> <sha local> <ref distante> <sha distant> [<dépôt distant>]
#       une ligne du pré-push : juge le commit poussé ; le dépôt distant reçoit l'attestation.
#   livraison.sh demande [--navigateur]
#       la demande du codeur ou de l'auditeur (`pnpm livraison --navigateur`, #264) : juge le dernier
#       commit de la branche comme un premier push et, avec `--navigateur`, y joue aussi les tests
#       navigateur de non-régression ; l'attestation part sur `origin`.
#
# 1. Arbre jugé. L'index (fusion) ou le commit (push, demande), jamais la copie de travail : les tests
#    tournent sur place si la copie est identique à cet arbre, sinon dans une extraction à part
#    (`extraire.mjs`), dont les dépendances pointent vers celles du clone.
# 2. Nature du besoin (#121). Les fichiers modifiés des deux côtés depuis la base commune — celle du
#    dernier push de la branche, ou de `main` à un premier push et à la demande — sont comparés à
#    `packages/gardes/chemins-ignores` de l'arbre jugé (syntaxe de `.gitignore`) : un fichier listé
#    est fonctionnel (les ensembles de ses paquets, et l'interface sans navigateur), un fichier absent
#    est organisationnel (la garde). Les deux peuvent se cumuler. Le harnais du besoin se joue toujours.
# 3. Empreintes (`attestation.mjs plan`, #266). Chaque ensemble de tests — garde, cœur, relais,
#    hébergement, interface sans navigateur, interface dans le navigateur, harnais du besoin — a une
#    empreinte : l'état, dans l'arbre jugé, des chemins qu'il lit (`packages/gardes/attestation.mjs`,
#    `ENSEMBLES`). Parmi ceux que la nature du besoin retient, il ne se joue pas si elle est déjà
#    trouvée verte, à un seuil au moins égal — par l'attestation locale ou distante de la branche,
#    écrite par l'outillage à la livraison ou à la demande, dans cette session ou dans une autre —, ou
#    si elle est celle de la base commune avec `main` : rien de ce qu'il lit n'a changé. Un ensemble
#    qui se joue est dit, avec son seuil et son verdict ; un ensemble qui ne se joue pas l'est aussi,
#    avec sa raison. Ce que la livraison ne joue pas, la CI le joue au Ready s'il n'est pas vert sur
#    son empreinte.
# 4. Seuil 2 (#232 : les tests de niveau 0 à 2), le moins cher d'abord :
#    - le typecheck des paquets dont un ensemble se joue ; rouge, rien d'autre ne se joue ;
#    - puis les tests sans navigateur, et le harnais du besoin qui ne vit pas dans le navigateur ;
#    - puis, seulement si tout cela est vert, les tests navigateur : le harnais du besoin qui vit dans
#      le navigateur (`apps/web/test/navigateur/`) et, sur demande seulement, la non-régression dans
#      le navigateur ; sans demande, elle est laissée au Ready, et la livraison le dit. Un harnais du
#      besoin rouge qui ne bloque pas ne les retient pas.
# 5. Harnais du besoin (`harnais-du-besoin.sh` : le fichier de l'auditeur, qui porte le numéro de
#    l'issue). Joué à part, en entier (seuil 4), quelle que soit sa finalité. Il bloque si ce qui
#    arrive (commits absents de `main` et de la branche d'arrivée) touche autre chose que le harnais
#    et la documentation (`**/test/**`, `**/*.test.*`, `docs/**`, `**/*.md`) ; sinon son verdict
#    s'affiche. La non-régression bloque toujours.
# 6. Sous-branche (`<branche>--codeur`, `<branche>--auditeur`) : non-régression seule, sans attestation.
# 7. Bilan et attestation (#237, #266) : chaque ensemble est dit — joué, à quel seuil, avec quel
#    verdict, ou pourquoi il ne l'est pas. Les ensembles joués verts s'ajoutent à l'attestation
#    locale (`attestation.mjs bilan`) ; un ensemble rouge, ou dont un test s'est sauté faute d'outil,
#    n'y entre pas. Une livraison verte l'envoie sur `<branche>--attestation` (`attestation.mjs
#    envoyer`), même quand rien ne s'est rejoué. La CI la lit pour ne jouer que le manque (D83). Une
#    branche `…--attestation` n'est jamais jugée.
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
[ "$mode" = demande ] && niveau=demande

nul() { case $1 in '' | *[!0]*) return 1 ;; *) return 0 ;; esac; }
dit() { echo "$niveau : $*"; }

travail=$(mktemp -d) || exit 1
trap 'rm -rf "$travail"' EXIT
trap 'exit 130' INT TERM
journaux="$travail/journaux"
mkdir -p "$journaux" || exit 1
: >"$journaux/lances"
main=''
git rev-parse -q --verify 'refs/remotes/origin/main^{commit}' >/dev/null && main=refs/remotes/origin/main

# ─── Lecture de git : tout ce qui dépend de l'index ou du dépôt se lit ici ───────────────────────
sous='' demande_nav=non commit=- depot=''
case $mode in
  fusion)
    # Têtes fusionnées : MERGE_HEAD pendant un conflit ; pendant `pre-merge-commit`, git ne l'a pas
    # encore écrit et les nomme dans l'environnement (`GITHEAD_<sha>`).
    tetes=$(env | sed -n 's/^GITHEAD_\([0-9a-f]\{40,64\}\)=.*/\1/p' | while read -r t; do
      git cat-file -e "$t^{commit}" 2>/dev/null && echo "$t"
    done)
    if [ -z "$tetes" ] && git rev-parse -q --verify MERGE_HEAD >/dev/null; then
      tetes=$(cat "$(git rev-parse --git-path MERGE_HEAD)")
    fi
    [ -n "$tetes" ] || { dit "aucune fusion en cours"; exit 0; }
    arbre=$(git write-tree) || exit 1
    branche=$(git symbolic-ref --short -q HEAD) || branche=''
    [ "$branche" = main ] && surmain=1 || surmain=''
    git remote get-url origin >/dev/null 2>&1 && depot=origin
    # Base commune de main et de l'arbre fusionné (HEAD et les têtes).
    # shellcheck disable=SC2086
    hbase=$([ -n "$main" ] && git merge-base "$main" HEAD $tetes 2>/dev/null) || hbase=''
    # Les fichiers modifiés des deux côtés depuis leur base commune : la nature du besoin.
    # shellcheck disable=SC2086
    base=$(git merge-base --octopus HEAD $tetes 2>/dev/null) || base=''
    {
      [ -n "$base" ] && for t in HEAD $tetes; do git diff --name-only --no-renames "$base" "$t"; done
    } | sort -u >"$travail/modifies"
    # shellcheck disable=SC2086
    git log --no-merges --no-renames --format= --name-only $tetes --not HEAD $main >"$travail/entrants" || exit 1
    surplace=''
    git diff --quiet && [ -z "$(git ls-files --others --exclude-standard | head -n 1)" ] && surplace=1
    ;;
  push | demande)
    if [ "$mode" = push ]; then
      lsha=${2:-} rref=${3:-} rsha=${4:-} depot=${5:-}
      case $rref in refs/heads/*) ;; *) exit 0 ;; esac
      nul "$lsha" && exit 0
      branche=${rref#refs/heads/}
      # L'attestation voyage sur sa propre branche : rien à y juger.
      case $branche in *--attestation) exit 0 ;; esac
    else
      case ${1:-} in
        '') ;;
        --navigateur) demande_nav=oui ;;
        *) echo "usage : livraison.sh demande [--navigateur]" >&2; exit 2 ;;
      esac
      branche=$(git symbolic-ref --short -q HEAD) || { dit "aucune branche extraite : rien à juger" >&2; exit 2; }
      lsha=$(git rev-parse HEAD) || exit 1
      git remote get-url origin >/dev/null 2>&1 && depot=origin
      # Jugé comme au premier push de la branche : tout ce qu'elle apporte depuis `main` (#264).
      rsha=''
    fi
    commit=$lsha
    case $branche in *--codeur | *--auditeur) sous=1 ;; esac
    arbre=$(git rev-parse "$lsha^{tree}") || exit 1
    distant=''
    nul "$rsha" || { git cat-file -e "$rsha^{commit}" 2>/dev/null && distant=$rsha; }
    [ "$branche" = main ] && surmain=1 || surmain=''
    hbase=$([ -n "$main" ] && git merge-base "$main" "$lsha" 2>/dev/null) || hbase=''
    # Les fichiers modifiés depuis le dernier push de la branche, ou depuis `main` : la nature du besoin.
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
    # shellcheck disable=SC2086
    git log --no-merges --no-renames --format= --name-only "$lsha" --not $distant $main >"$travail/entrants" || exit 1
    surplace=''
    git diff --quiet "$lsha" -- && [ -z "$(git ls-files --others --exclude-standard | head -n 1)" ] && surplace=1
    ;;
  *)
    echo "usage : livraison.sh fusion | push <ref locale> <sha local> <ref distante> <sha distant> [<dépôt distant>] | demande [--navigateur]" >&2
    exit 2
    ;;
esac

# Le code qui arrive : un fichier hors du harnais et de la documentation.
code=$(grep -Ev '(^|/)test/|\.test\.[^/]+$|^docs/|\.md$|^$' "$travail/entrants" | sort -u | head -n 3 | tr '\n' ' ')

# Harnais du besoin.
: >"$journaux/harnais.txt"
if [ -n "$surmain" ]; then
  dit "sur main, tout test est non-régression (aucun harnais du besoin)"
elif [ -z "$main" ]; then
  dit "origin/main introuvable (git fetch origin main) : tout test est non-régression"
elif [ -z "$hbase" ]; then
  dit "aucune base commune avec origin/main : tout test est non-régression"
elif [ -z "$sous" ]; then
  git -c core.quotePath=false diff --name-only --no-renames --diff-filter=AM "$hbase" "$arbre" -- |
    grep -E '\.test\.[^/]+$' >"$travail/candidats"
  # shellcheck source=harnais-du-besoin.sh
  . "$crochets/harnais-du-besoin.sh"
  [ -n "$branche" ] || branche=$(branche_du_besoin)
  harnais_retenus "$travail/candidats" "$journaux/harnais.txt" "$arbre:" "$branche" || exit 1
fi
git ls-tree -r --name-only "$arbre" >"$travail/fichiers" || exit 1
git cat-file -p "$arbre:packages/gardes/chemins-ignores" >"$travail/chemins-ignores" 2>/dev/null || : >"$travail/chemins-ignores"

# Les empreintes vertes de la branche, puis ce qui se joue (#264).
echo '[]' >"$travail/verts"
attester=''
if [ -z "$sous" ] && [ -z "$surmain" ] && [ -n "$branche" ]; then
  attester=1
  # shellcheck disable=SC2086 # sans dépôt distant, l'argument manque
  dit "$(node "$crochets/attestation.mjs" verts "$branche" "$travail/verts" $depot 2>&1)"
fi
node "$crochets/attestation.mjs" plan "$arbre" 2 "$travail/verts" "$journaux/harnais.txt" "${hbase:--}" "$demande_nav" "$travail/plan" "$niveau" || exit 1
# Ce qui couvre chaque lancement, fichier par fichier (#302) : le lanceur y saute ce qui est vert sur
# son empreinte, et dit ce qu'il joue et ce qu'il saute.
node "$crochets/attestation.mjs" couverture "$arbre" "$travail/verts" "$journaux/harnais.txt" "${hbase:--}" "$travail/couverture" || exit 1
joue() { awk -F '\t' -v id="$1" '$1 == id && $2 == 1 { ok = 1 } END { exit !ok }' "$travail/plan"; }

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
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_OBJECT_DIRECTORY GIT_COMMON_DIR GIT_QUARANTINE_PATH GIT_REFLOG_ACTION
# Les têtes de cette fusion ne doivent pas passer pour celles d'une fusion lancée par un test.
for v in $(env | sed -n 's/^\(GITHEAD_[0-9a-f]*\)=.*/\1/p'); do unset "$v"; done

if [ "$juge" != "$racine" ]; then
  node "$crochets/extraire.mjs" "$racine" "$juge" || exit 1
  dit "copie de travail différente de l'arbre jugé : tests joués sur une extraction"
fi

# ─── Nature du besoin : ce que la livraison retient, parmi ce que les empreintes n'ont pas sauté ──
classe="$travail/classe"
git init -q "$classe" || exit 1
cp "$travail/chemins-ignores" "$classe/.git/info/exclude"
git -C "$classe" check-ignore --no-index --stdin <"$travail/modifies" >"$travail/fonctionnels" 2>/dev/null
grep -vxF -f "$travail/fonctionnels" "$travail/modifies" | grep -v '^$' >"$travail/organisationnels"
retenus=''
grep -Eo '^(apps|packages)/[^/]+' "$travail/fonctionnels" | sort -u >"$travail/touches"
[ -s "$travail/organisationnels" ] && retenus="$retenus garde"
if [ -s "$travail/fonctionnels" ]; then
  retenus="$retenus interface"
  for p in $(grep -Eo '^(apps|packages)/[^/]+/' "$travail/fonctionnels" | sed 's#/$##' | sort -u); do
    case $p in packages/core) retenus="$retenus coeur" ;; apps/relay) retenus="$retenus relais" ;; apps/hebergement) retenus="$retenus hebergement" ;; esac
  done
fi
[ "$demande_nav" = oui ] && retenus="$retenus interface"
nature=''
[ -s "$travail/fonctionnels" ] && nature="fonctionnel ($(grep -Eo '^(apps|packages)/[^/]+' "$travail/fonctionnels" | sort -u | tr '\n' ',' | sed 's/,$//'))"
[ -s "$travail/organisationnels" ] && nature="${nature:+$nature + }organisationnel"
dit "besoin ${nature:-sans fichier modifié} : la livraison retient${retenus:- rien d'autre que le harnais du besoin}"
for id in garde coeur relais hebergement interface; do
  case " $retenus " in *" $id "*) continue ;; esac
  joue "$id" || continue
  awk -F '\t' -v OFS='\t' -v id="$id" '$1 == id { $2 = 0 } { print }' "$travail/plan" >"$travail/plan.n" && mv "$travail/plan.n" "$travail/plan"
  case $id in coeur) n='cœur' ;; hebergement) n='hébergement' ;; interface) n='interface sans navigateur' ;; *) n=$id ;; esac
  dit "$n : non joué — ce qui arrive ne le fait pas jouer à la livraison (packages/gardes/chemins-ignores) ; au Ready, la CI le joue s'il n'est pas vert sur son empreinte."
done

if ! command -v pnpm >/dev/null 2>&1; then
  echo "$niveau : pnpm introuvable, les tests ne peuvent pas être joués." >&2
  exit 1
fi

# ─── Lancements ────────────────────────────────────────────────────────────────────────────────────
dans() { grep -E "^$1/" "$journaux/harnais.txt" | sed "s#^$1/##"; }
vitest_de() { grep -q '"test": *"[^"]*vitest' "$juge/$1/package.json" 2>/dev/null; }
lance() { # nom dossier commande…
  nom=$1 dossier=$2
  shift 2
  (cd "$juge/$dossier" && "$@" >"$journaux/$nom.log" 2>&1; echo $? >"$journaux/$nom.code") &
}
rapports_node() { echo "--test-reporter=tap" "--test-reporter-destination=stdout" "--test-reporter=$crochets/rapport-node.mjs" "--test-reporter-destination=$journaux/$1.rapport"; }
rapports_vitest() { echo "--reporter=default" "--reporter=json" "--outputFile.json=$journaux/$1.rapport"; }
# Ce qui couvre le lancement, et le bilan de ses fichiers, que lit `attestation.mjs bilan` (#302).
couvert() { echo "--attestation" "$travail/couverture" "--bilan" "$journaux/$1.bilan"; }
lances=''
ajoute() { # ensemble nom dossier lanceur : pour le verdict, et pour le bilan de l'ensemble
  lances="$lances $2:$3:$4"
  printf '%s\t%s\t%s\n' "$1" "$2" "$4" >>"$journaux/lances"
}
# Un de ces lancements a-t-il rougi ?
rouge() { for n in "$@"; do [ "$(cat "$journaux/$n.code" 2>/dev/null)" = 0 ] || return 0; done; return 1; }
DOSSIERS='garde:packages/gardes coeur:packages/core relais:apps/relay hebergement:apps/hebergement interface:apps/web navigateur:apps/web'
dossier_de() { for p in $DOSSIERS; do [ "${p%%:*}" = "$1" ] && echo "${p#*:}"; done; }
harnais_nav() { grep -q '^apps/web/test/navigateur/' "$journaux/harnais.txt"; }

# Non-régression d'un ensemble, au seuil 2, sans ses fichiers du harnais du besoin.
non_regression() { # ensemble dossier
  id=$1 dossier=$2
  [ -f "$juge/$dossier/package.json" ] || { echo "$dossier n'a pas de paquet dans cet arbre" >"$journaux/$id.retenu"; return 0; }
  if vitest_de "$dossier"; then
    # shellcheck disable=SC2046
    set -- 2 $(couvert "$id") --passWithNoTests $(rapports_vitest "$id")
    [ "$dossier" = packages/core ] && set -- "$@" --no-isolate
    [ "$id" = navigateur ] && set -- "$@" --navigateur test/navigateur
    for f in $(dans "$dossier"); do set -- "$@" --exclude "$f"; done
    lance "$id" "$dossier" pnpm run test "$@"
    ajoute "$id" "$id" "$dossier" vitest
  elif [ -n "$(dans "$dossier")" ]; then
    liste=$(grep -E "^$dossier/[^/]*\\.test\\.[cm]?js$" "$travail/fichiers" | grep -vxF -f "$journaux/harnais.txt" | sed "s#^$dossier/##")
    [ -n "$liste" ] || { echo "aucun test hors du harnais du besoin" >"$journaux/$id.retenu"; return 0; }
    # shellcheck disable=SC2046,SC2086
    lance "$id" "$dossier" pnpm run test 2 $(couvert "$id") $(rapports_node "$id") $liste
    ajoute "$id" "$id" "$dossier" node
  else
    # shellcheck disable=SC2046
    lance "$id" "$dossier" pnpm run test 2 $(couvert "$id") $(rapports_node "$id")
    ajoute "$id" "$id" "$dossier" node
  fi
}

# Harnais du besoin d'un paquet, en entier (seuil 4) : ses fichiers sans navigateur, ou ceux du navigateur.
harnais() { # dossier sans|nav
  d=$1
  if [ "$2" = nav ]; then liste=$(dans "$d" | grep '^test/navigateur/'); n="harnais-$(basename "$d")-navigateur"
  else liste=$(dans "$d" | grep -v '^test/navigateur/'); n="harnais-$(basename "$d")"; fi
  [ -n "$liste" ] && [ -f "$juge/$d/package.json" ] || return 0
  if vitest_de "$d"; then
    # shellcheck disable=SC2046,SC2086
    lance "$n" "$d" pnpm run test 4 $(couvert "$n") $([ "$2" = nav ] && echo --navigateur) $(rapports_vitest "$n") $liste
    ajoute harnais "$n" "$d" vitest
  else
    # shellcheck disable=SC2046,SC2086
    lance "$n" "$d" pnpm run test 4 $(couvert "$n") $(rapports_node "$n") $liste
    ajoute harnais "$n" "$d" node
  fi
}

bloque=affiche
if [ -n "$sous" ]; then
  :
elif [ -n "$code" ]; then
  bloque=bloque
  [ -s "$journaux/harnais.txt" ] && dit "ce qui arrive apporte du code ($code) : le harnais du besoin bloque"
elif [ -s "$journaux/harnais.txt" ]; then
  dit "ce qui arrive n'apporte que du harnais ou de la documentation : le harnais du besoin s'affiche sans bloquer"
fi
autres=$(grep -Ev '^(apps|packages)/[^/]+/' "$journaux/harnais.txt" | tr '\n' ' ')
[ -z "$autres" ] || dit "harnais du besoin hors de tout paquet, non joué : $autres"

debut=$(date +%s)
# Durée attendue de ce qui se joue (mesurée le 25/09) : 40 s pour les paquets fonctionnels et
# l'interface sans navigateur, 270 s de plus pour les tests navigateur demandés, 45 s pour la garde.
# Un dépassement de plus de 20 % se dit, sans bloquer ; le harnais du besoin est hors durée attendue.
attendue=0
{ joue coeur || joue relais || joue hebergement || joue interface; } && attendue=$((attendue + 40))
joue navigateur && attendue=$((attendue + 270))
joue garde && attendue=$((attendue + 45))
# Palier 1 : le typecheck des paquets touchés (fonctionnels) dont un ensemble se joue ; la garde n'en
# a pas à la livraison (#121). La CI le rejoue toujours.
for p in $DOSSIERS; do [ "${p%%:*}" != garde ] && joue "${p%%:*}" && grep -qxF "${p#*:}" "$travail/touches" && echo "${p#*:}"; done | sort -u >"$travail/paquets"
typechecks=''
while read -r d; do
  [ -f "$juge/$d/package.json" ] || continue
  n="typecheck-$(basename "$d")"
  lance "$n" "$d" pnpm run typecheck
  lances="$lances $n:$d:typecheck"
  typechecks="$typechecks $n"
done <"$travail/paquets"
wait
retenu=''
# shellcheck disable=SC2086
[ -n "$typechecks" ] && rouge $typechecks && retenu="le typecheck, palier moins cher, a rougi"

if [ -z "$retenu" ]; then
  # Palier 2 : les tests sans navigateur, et le harnais du besoin qui ne vit pas dans le navigateur.
  for id in garde coeur relais hebergement interface; do
    joue "$id" && non_regression "$id" "$(dossier_de "$id")"
  done
  if joue harnais; then
    for d in $(grep -Eo '^(apps|packages)/[^/]+' "$journaux/harnais.txt" | sort -u); do harnais "$d" sans; done
  fi
  wait
  nr=$(awk -F '\t' '$1 != "harnais" { print $2 }' "$journaux/lances" | tr '\n' ' ')
  ha=$(awk -F '\t' '$1 == "harnais" { print $2 }' "$journaux/lances" | tr '\n' ' ')
  # shellcheck disable=SC2086
  if [ -n "$nr" ] && rouge $nr; then
    retenu="un test sans navigateur, palier moins cher, a rougi"
  elif [ "$bloque" = bloque ] && [ -n "$ha" ] && rouge $ha; then
    retenu="le harnais du besoin, qui bloque, a rougi sans navigateur"
  fi
  # Palier 3 : les tests navigateur, seulement si tout le reste est vert.
  if [ -z "$retenu" ]; then
    joue navigateur && non_regression navigateur apps/web
    joue harnais && harnais_nav && harnais apps/web nav
    wait
  else
    joue navigateur && echo "$retenu" >"$journaux/navigateur.retenu"
    if joue harnais && harnais_nav; then
      printf 'harnais\t%s\tvitest\n' harnais-web-navigateur >>"$journaux/lances"
      echo retenu >"$journaux/harnais-web-navigateur.code"
      echo "$retenu" >"$journaux/harnais-web-navigateur.retenu"
    fi
  fi
else
  for id in garde coeur relais hebergement interface navigateur harnais; do joue "$id" && echo "$retenu" >"$journaux/$id.retenu"; done
fi
if [ -n "$retenu" ] && { joue navigateur || { joue harnais && harnais_nav; }; }; then
  dit "tests navigateur non joués : $retenu"
fi

# shellcheck disable=SC2086 # les lancements n'ont pas d'espace
duree=$(($(date +%s) - debut))
if [ "$attendue" -gt 0 ] && [ $((duree * 10)) -gt $((attendue * 12)) ]; then
  dit "la sélection a pris $duree s, au-delà de sa durée attendue de $attendue s (+20 %) — sans bloquer"
fi
TIRELIRE_NIVEAU=$niveau TIRELIRE_HARNAIS=$bloque node "$crochets/verdict.mjs" "$juge" "$journaux" "$debut" $lances
verdict=$?
node "$crochets/attestation.mjs" bilan "$travail/plan" "$journaux" "$niveau" "$arbre" "$commit" "${branche:-?}" "$travail/verts" ${attester:+--enregistrer}
if [ "$verdict" -eq 0 ] && [ -n "$attester" ] && [ -n "$depot" ] && [ "$mode" != fusion ]; then
  dit "$(node "$crochets/attestation.mjs" envoyer "$depot" "$branche" 2>&1)"
fi
exit "$verdict"
