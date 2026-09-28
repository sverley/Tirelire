#!/bin/sh
# Livraison de Tirelire (#121, #232, #264) : la pré-fusion, le pré-push et la demande jugent l'état
# commis.
#
#   livraison.sh fusion
#       `pre-merge-commit`, et `pre-commit` pendant une fusion (conflit) : juge l'index.
#   livraison.sh push <ref locale> <sha local> <ref distante> <sha distant> [<dépôt distant>]
#       une ligne du pré-push : juge le commit poussé ; le dépôt distant reçoit l'attestation.
#   livraison.sh demande [--navigateur]
#       la demande du codeur ou de l'auditeur (`pnpm livraison --navigateur`, #264) : juge le dernier
#       commit de la branche comme le pré-push, même s'il a déjà été vérifié, et, avec
#       `--navigateur`, y joue aussi les tests navigateur de non-régression ; `origin` reçoit
#       l'attestation.
#
# 1. Arbre jugé. L'index (fusion) ou le commit (push, demande), jamais la copie de travail : les tests
#    tournent sur place si la copie est identique à cet arbre, sinon dans une extraction à part
#    (`extraire.mjs`), dont les dépendances pointent vers celles du clone.
# 2. Nature du besoin. Les fichiers modifiés des deux côtés depuis la base commune sont comparés à
#    `packages/gardes/chemins-ignores` de l'arbre jugé (syntaxe de `.gitignore`) : un fichier listé
#    est fonctionnel, un fichier absent est organisationnel. Les deux peuvent se cumuler.
# 3. Sélection, au seuil 2 (#232 : les tests de niveau 0 à 2) :
#    - fonctionnel : typecheck et tests des paquets touchés, tests de l'interface sans navigateur ;
#      durée attendue 40 s (mesurée le 25/09) ;
#    - organisationnel : tests de la garde ; durée attendue 45 s.
#    Les tests navigateur de non-régression (`apps/web/test/navigateur/`) ne se jouent que sur
#    demande (`demande --navigateur`, 270 s de plus, mesurés le 25/09) ; sans elle, navigateur présent
#    ou non, ils sont laissés au Ready, et la livraison le dit (#264, point 6).
#    Une sélection qui dépasse sa durée attendue de plus de 20 % le dit, sans bloquer.
#    Le moins cher d'abord (#264, point 5), en trois paliers : le typecheck ; puis les tests sans
#    navigateur et le harnais du besoin hors de `apps/web/test/navigateur/` ; puis, seulement si les
#    deux premiers sont verts, les tests navigateur — le harnais du besoin qui vit dans le navigateur,
#    et la non-régression demandée. Un harnais du besoin rouge qui ne bloque pas ne les retient pas.
#    Sinon ils ne se jouent pas, et la livraison le dit.
# 4. Harnais du besoin (`harnais-du-besoin.sh` : le fichier de l'auditeur, qui porte le numéro de
#    l'issue). Joué à part, en entier (seuil 4), quelle que soit sa finalité, hors durée attendue.
#    Il bloque si ce qui arrive (commits absents de `main` et de la branche d'arrivée) touche autre
#    chose que le harnais et la documentation (`**/test/**`, `**/*.test.*`, `docs/**`, `**/*.md`) ;
#    sinon son verdict s'affiche. La non-régression bloque toujours.
# 5. Sous-branche (`<branche>--codeur`, `<branche>--auditeur`) : non-régression seule.
# 6. Un arbre vérifié est noté dans `tirelire-arbres-verifies`, sous le dossier commun de git, avec
#    l'état de son harnais : le pré-push ne rejoue pas un arbre noté ; la demande le rejoue.
# 7. Attestation (#237) : une livraison verte, hors sous-branche, atteste ce qu'elle a joué sur
#    l'arbre — seuil, ensembles joués, harnais du besoin et son état, navigateur présent ou non —
#    (`attestation.mjs ecrire`), et le pré-push l'envoie avec le push, sur `<branche>--attestation`
#    (`attestation.mjs envoyer`), même pour un arbre déjà vérifié ; la demande l'envoie sur `origin`.
#    La CI la lit pour ne jouer que le manque (D83) : les tests navigateur demandés et joués verts ne
#    s'y rejouent pas sur le même arbre. Une branche `…--attestation` n'est jamais jugée.
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
commun=$(cd "$(git rev-parse --git-common-dir)" && pwd) || exit 1
registre="$commun/tirelire-arbres-verifies"
main=''
git rev-parse -q --verify 'refs/remotes/origin/main^{commit}' >/dev/null && main=refs/remotes/origin/main

# ─── Lecture de git : tout ce qui dépend de l'index ou du dépôt se lit ici ───────────────────────
sous='' demande_nav=''
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
  push | demande)
    if [ "$mode" = push ]; then
      lsha=${2:-} rref=${3:-} rsha=${4:-} depot=${5:-}
      case $rref in refs/heads/*) ;; *) exit 0 ;; esac
      nul "$lsha" && exit 0
      nom=${rref#refs/heads/}
    else
      case ${1:-} in
        '') ;;
        --navigateur) demande_nav=1 ;;
        *) echo "usage : livraison.sh demande [--navigateur]" >&2; exit 2 ;;
      esac
      nom=$(git symbolic-ref --short -q HEAD) || { dit "aucune branche extraite : rien à juger" >&2; exit 2; }
      lsha=$(git rev-parse HEAD) || exit 1
      depot=''
      git remote get-url origin >/dev/null 2>&1 && depot=origin
      # Jugé comme au premier push de la branche : tout ce qu'elle change depuis `main`.
      rsha=''
    fi
    poussee=$nom # `nom` sert aussi aux lancements
    # L'attestation voyage sur sa propre branche : rien à y juger.
    case $nom in *--attestation) exit 0 ;; esac
    case $nom in *--codeur | *--auditeur) sous=1 ;; esac
    arbre=$(git rev-parse "$lsha^{tree}") || exit 1
    distant=''
    nul "$rsha" || { git cat-file -e "$rsha^{commit}" 2>/dev/null && distant=$rsha; }
    etat=$( [ "$mode" = push ] && [ -f "$registre" ] && awk -v a="$arbre" '$1 == a { e = $2 } END { print e }' "$registre")
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
    echo "usage : livraison.sh fusion | push <ref locale> <sha local> <ref distante> <sha distant> [<dépôt distant>] | demande [--navigateur]" >&2
    exit 2
    ;;
esac

# Le code qui arrive : un fichier hors du harnais et de la documentation.
code=$(grep -Ev '(^|/)test/|\.test\.[^/]+$|^docs/|\.md$|^$' "$travail/entrants" | sort -u | head -n 3 | tr '\n' ' ')

# L'attestation de l'arbre poussé part avec le push (#237), hors sous-branche.
envoie_attestation() {
  [ "$mode" != fusion ] && [ -n "$depot" ] && [ -z "$sous" ] && [ -z "$surmain" ] || return 0
  dit "$(node "$crochets/attestation.mjs" envoyer "$depot" "$arbre" "$poussee" 2>&1)"
}

if [ "$mode" = push ] && [ -n "$etat" ]; then
  if [ -n "$sous" ] || [ "$etat" = vert ] || [ -z "$code" ]; then
    dit "arbre déjà vérifié ($etat), rien à rejouer — $nom"
    envoie_attestation
    exit 0
  fi
  echo "✗ $niveau : cet arbre a été vérifié avec le harnais du besoin rouge, et le push apporte du code ($code)." >&2
  echo "pré-push refusé — $nom." >&2
  exit 1
fi

# Harnais du besoin.
: >"$journaux/harnais.txt"
if [ -n "$surmain" ]; then
  dit "sur main, tout test est non-régression (aucun harnais du besoin)"
elif [ -z "$main" ]; then
  dit "origin/main introuvable (git fetch origin main) : tout test est non-régression"
elif [ -z "$hbase" ]; then
  dit "aucune base commune avec origin/main : tout test est non-régression"
else
  git -c core.quotePath=false diff --name-only --no-renames --diff-filter=AM "$hbase" "$arbre" -- |
    grep -E '\.test\.[^/]+$' >"$travail/candidats"
  # shellcheck source=harnais-du-besoin.sh
  . "$crochets/harnais-du-besoin.sh"
  if [ "$mode" = fusion ]; then branche=$(branche_du_besoin); else branche=$nom; fi
  harnais_retenus "$travail/candidats" "$journaux/harnais.txt" "$arbre:" "$branche" || exit 1
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
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_OBJECT_DIRECTORY GIT_COMMON_DIR GIT_QUARANTINE_PATH GIT_REFLOG_ACTION
# Les têtes de cette fusion ne doivent pas passer pour celles d'une fusion lancée par un test.
for v in $(env | sed -n 's/^\(GITHEAD_[0-9a-f]*\)=.*/\1/p'); do unset "$v"; done

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

# ─── Lancements ────────────────────────────────────────────────────────────────────────────────────
dans() { grep -E "^$1/" "$journaux/harnais.txt" | sed "s#^$1/##"; }
vitest_de() { grep -q '"test": *"[^"]*vitest' "$juge/$1/package.json" 2>/dev/null; }
# Un navigateur est-il là (`apps/web/test/harnais.ts`) ? Il ne décide pas de ce qui se joue (#264,
# point 6) : sans lui, les tests navigateur s'abstiennent, et l'attestation ne les couvre pas.
navigateur() {
  for c in "${TIRELIRE_NAV:-}" "${CHROME_BIN:-}" "${CHROME_PATH:-}" "${PUPPETEER_EXECUTABLE_PATH:-}" \
    /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser \
    /opt/google/chrome/chrome '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; do
    [ -n "$c" ] && [ -e "$c" ] && return 0
  done
  return 1
}
if navigateur; then present=1; else present=0; fi
lance() { # nom dossier commande…
  nom=$1 dossier=$2
  shift 2
  (cd "$juge/$dossier" && "$@" >"$journaux/$nom.log" 2>&1; echo $? >"$journaux/$nom.code") &
}
# Ce que la livraison lance, pour son attestation (#237) : sorte, dossier, seuil, navigateur, fichiers.
note() { printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$(echo $5 | tr ' ' ',')" >>"$journaux/joues"; }
rapports_node() { echo "--test-reporter=tap" "--test-reporter-destination=stdout" "--test-reporter=$crochets/rapport-node.mjs" "--test-reporter-destination=$journaux/$1.rapport"; }
rapports_vitest() { echo "--reporter=default" "--reporter=json" "--outputFile.json=$journaux/$1.rapport"; }
lances=''
palier=''
ajoute() { lances="$lances $1"; palier="$palier ${1%%:*}"; }
# Un lancement du palier a-t-il rougi ?
rouge() { for n in "$@"; do [ "$(cat "$journaux/$n.code" 2>/dev/null)" = 0 ] || return 0; done; return 1; }

# Non-régression d'un paquet de tests, au seuil 2, sans ses fichiers du harnais du besoin ni les
# tests navigateur, qui ont leur palier (`navigateur_non_regression`).
non_regression() { # nom dossier
  nom=$1 dossier=$2
  if vitest_de "$dossier"; then
    # shellcheck disable=SC2046
    set -- 2 --passWithNoTests $(rapports_vitest "$nom")
    [ "$dossier" = packages/core ] && set -- "$@" --no-isolate
    note non-regression "$dossier" 2 0 "$(dans "$dossier")"
    for f in $(dans "$dossier"); do set -- "$@" --exclude "$f"; done
    lance "$nom" "$dossier" pnpm run test "$@"
    ajoute "$nom:$dossier:vitest"
  else
    note non-regression "$dossier" 2 0 "$(dans "$dossier")"
    if [ -n "$(dans "$dossier")" ]; then
      liste=$(grep -E "^$dossier/[^/]*\\.test\\.[cm]?js$" "$travail/fichiers" | grep -vxF -f "$journaux/harnais.txt" | sed "s#^$dossier/##")
      [ -n "$liste" ] || { dit "$nom : aucun test hors du harnais du besoin"; return 0; }
      # shellcheck disable=SC2046,SC2086
      lance "$nom" "$dossier" pnpm run test 2 $(rapports_node "$nom") $liste
    else
      # shellcheck disable=SC2046
      lance "$nom" "$dossier" pnpm run test 2 $(rapports_node "$nom")
    fi
    ajoute "$nom:$dossier:node"
  fi
}

# Les tests navigateur de non-régression de l'interface, au seuil 2, sur demande seulement.
navigateur_non_regression() {
  note non-regression apps/web 2 "$present" "$(dans apps/web)"
  # shellcheck disable=SC2046
  set -- 2 --navigateur --passWithNoTests $(rapports_vitest navigateur)
  for f in $(dans apps/web); do set -- "$@" --exclude "$f"; done
  lance navigateur apps/web pnpm run test "$@" test/navigateur
  ajoute "navigateur:apps/web:vitest"
}

typecheck() { # nom dossier
  note typecheck "$2" - 0 ''
  lance "$1" "$2" pnpm run typecheck
  ajoute "$1:$2:typecheck"
}

# Le harnais du besoin d'un paquet, en entier (seuil 4) : ses fichiers hors du navigateur (`sans`), ou
# ceux de `apps/web/test/navigateur/` (`nav`).
harnais() { # dossier sans|nav
  d=$1
  if [ "$2" = nav ]; then liste=$(dans "$d" | grep '^test/navigateur/'); n="harnais-$(basename "$d")-navigateur"
  else liste=$(dans "$d" | grep -v '^test/navigateur/'); n="harnais-$(basename "$d")"; fi
  [ -n "$liste" ] && [ -f "$juge/$d/package.json" ] || return 0
  if vitest_de "$d"; then
    if [ "$2" = nav ]; then note harnais "$d" 4 "$present" "$liste"; else note harnais "$d" 4 0 "$liste"; fi
    # shellcheck disable=SC2046,SC2086
    lance "$n" "$d" pnpm run test 4 $([ "$2" = nav ] && echo --navigateur) $(rapports_vitest "$n") $liste
    harnais_lances="$harnais_lances $n:$d:vitest"
  else
    note harnais "$d" 4 0 "$liste"
    # shellcheck disable=SC2046,SC2086
    lance "$n" "$d" pnpm run test 4 $(rapports_node "$n") $liste
    harnais_lances="$harnais_lances $n:$d:node"
  fi
}

bloque=affiche
if [ -n "$sous" ]; then
  :
elif [ -n "$code" ]; then
  bloque=bloque
  dit "ce qui arrive apporte du code ($code) : le harnais du besoin bloque"
else
  dit "ce qui arrive n'apporte que du harnais ou de la documentation : le harnais du besoin s'affiche sans bloquer"
fi

debut=$(date +%s)
selection=''
attendue=0
paquets=''
[ -n "$fonc" ] && paquets=$(grep -Eo '^(apps|packages)/[^/]+/' "$travail/fonctionnels" | sed 's#/$##' | sort -u)
interface=''
if [ -n "$fonc" ] || [ -n "$demande_nav" ]; then
  attendue=$((attendue + 40)) interface='interface sans navigateur'
fi
if [ -n "$demande_nav" ]; then
  attendue=$((attendue + 270)) interface='interface sans et dans le navigateur, sur demande'
fi
[ -n "$fonc" ] && selection="fonctionnel ($(echo $paquets | tr ' ' ',') ; $interface)"
[ -z "$fonc" ] && [ -n "$demande_nav" ] && selection="demande des tests navigateur ($interface)"
if [ -n "$org" ]; then
  attendue=$((attendue + 45))
  selection="${selection:+$selection + }organisationnel (garde)"
fi
[ -n "$selection" ] || selection="aucun fichier modifié"
dit "besoin $selection"

# Palier 1 : le typecheck des paquets touchés.
for p in $paquets; do
  [ -f "$juge/$p/package.json" ] && typecheck "typecheck-$(basename "$p")" "$p"
done
wait
retenu=''
# shellcheck disable=SC2086
[ -n "$palier" ] && rouge $palier && retenu="le typecheck, palier moins cher, a rougi"
# Palier 2 : les tests sans navigateur, et le harnais du besoin hors du navigateur.
harnais_lances=''
palier=''
if [ -z "$retenu" ]; then
  for p in $paquets; do
    [ -f "$juge/$p/package.json" ] && [ "$p" != apps/web ] && non_regression "$(basename "$p")" "$p"
  done
  { [ -n "$fonc" ] || [ -n "$demande_nav" ]; } && non_regression interface apps/web
  [ -n "$org" ] && non_regression garde packages/gardes
  if [ -z "$sous" ] && [ -s "$journaux/harnais.txt" ]; then
    for d in $(grep -Eo '^(apps|packages)/[^/]+/' "$journaux/harnais.txt" | sed 's#/$##' | sort -u); do harnais "$d" sans; done
    autres=$(grep -Ev '^(apps|packages)/[^/]+/' "$journaux/harnais.txt" | tr '\n' ' ')
    [ -z "$autres" ] || dit "harnais du besoin hors de tout paquet, non joué : $autres"
  elif [ -n "$sous" ] && [ -s "$journaux/harnais.txt" ]; then
    dit "push vers une sous-branche : le harnais du besoin n'est pas joué"
  fi
  wait
  hl=$(for l in $harnais_lances; do echo "${l%%:*}"; done | tr '\n' ' ')
  # shellcheck disable=SC2086
  if [ -n "$palier" ] && rouge $palier; then
    retenu="un test sans navigateur, palier moins cher, a rougi"
  elif [ "$bloque" = bloque ] && [ -n "$hl" ] && rouge $hl; then
    retenu="le harnais du besoin, qui bloque, a rougi hors du navigateur"
  fi
fi
# Palier 3 : les tests navigateur, seulement si les deux premiers sont verts.
harnais_nav=''
[ -z "$sous" ] && grep -q '^apps/web/test/navigateur/' "$journaux/harnais.txt" && harnais_nav=1
if [ -n "$retenu" ]; then
  { [ -n "$demande_nav" ] || [ -n "$harnais_nav" ]; } && dit "tests navigateur non joués : $retenu"
else
  [ -n "$demande_nav" ] && navigateur_non_regression
  [ -n "$harnais_nav" ] && harnais apps/web nav
  wait
fi
if [ -z "$demande_nav" ]; then
  dit "tests navigateur de non-régression non joués : laissés au Ready faute de demande (pnpm livraison --navigateur)"
elif [ "$present" = 0 ]; then
  dit "aucun navigateur (TIRELIRE_NAV, CHROME_BIN…) : les tests navigateur demandés se sont abstenus, et restent au Ready"
fi
[ -n "$harnais_nav" ] && [ "$present" = 0 ] && dit "aucun navigateur : le harnais du besoin dans le navigateur s'est abstenu, et reste à la CI"
duree=$(($(date +%s) - debut))
if [ "$attendue" -gt 0 ] && [ $((duree * 10)) -gt $((attendue * 12)) ]; then
  dit "la sélection a pris $duree s, au-delà de sa durée attendue de $attendue s (+20 %) — sans bloquer"
fi

# shellcheck disable=SC2086 # les lancements n'ont pas d'espace
TIRELIRE_NIVEAU=$niveau TIRELIRE_HARNAIS=$bloque node "$crochets/verdict.mjs" "$juge" "$journaux" "$debut" $lances $harnais_lances
verdict=$?
if [ -n "$retenu" ] && [ "$verdict" -eq 0 ]; then
  echo "✗ $niveau : $retenu." >&2
  verdict=1
fi
if [ "$verdict" -eq 0 ] && [ -z "$sous" ]; then
  echo "$arbre $(cat "$journaux/harnais.etat" 2>/dev/null || echo vert)" >>"$registre"
  if [ "$present" = 1 ]; then nav=oui; else nav=non; fi
  [ "$mode" != fusion ] && branche=$poussee
  dit "$(node "$crochets/attestation.mjs" ecrire "$arbre" "$journaux" "${branche:-$(git symbolic-ref --short -q HEAD)}" "$nav" 2>&1)"
  envoie_attestation
fi
exit "$verdict"
