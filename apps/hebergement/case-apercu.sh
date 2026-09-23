#!/usr/bin/env bash
# La case de l'aperçu dans la description d'une PR (#175). Lit la description sur l'entrée standard.
#
# Une seule ligne, reconnue à sa marque `<!-- apercu:<commit en ligne> -->` :
#   - [ ] Aperçu du dernier commit en recette — en ligne : `abc1234`, pas le dernier commit (`def5678`) <!-- apercu:abc… -->
# Cochée, elle dit que l'aperçu en ligne est celui du dernier commit. Le porteur la coche pour
# demander le dépôt ; les workflows la décochent quand ce n'est pas (ou plus) vrai.
#
#   etat                      → coche | vide | absente
#   en-ligne                  → le commit en ligne, vide si aucun
#   rafraichir <tête>         → ajoute la ligne si elle manque ; décoche si le commit en ligne n'est plus la tête
#   refusee <tête>            → décoche, sans rien changer à ce qui est en ligne
#   deposee <commit> <tête>   → le commit déposé est en ligne ; cochée s'il est la tête
#   echec <commit> <tête>     → le dépôt de ce commit a échoué : ce qui est en ligne est incertain
# Les quatre derniers écrivent la description modifiée sur la sortie standard.
set -euo pipefail

MARQUE='<!-- apercu:'
mode="${1:-}"
corps="$(tr -d '\r')"
ligne="$(printf '%s\n' "$corps" | grep -F -m1 -- "$MARQUE" || true)"
court() { printf '%s' "${1::7}"; }

etat() {
  if [ -z "$ligne" ]; then echo absente
  elif printf '%s' "$ligne" | grep -qE '^[[:space:]]*[-*][[:space:]]+\[[xX]\]'; then echo coche
  else echo vide; fi
}
en_ligne() { printf '%s' "$ligne" | sed -nE 's/.*<!-- apercu:([0-9a-f]*) -->.*/\1/p'; }

# $1 : coche | vide (voulu) ; $2 : commit en ligne (vide : aucun) ; $3 : tête ; $4 : texte imposé
ecrire() {
  local voulu="$1" sha="$2" tete="$3" en="${4:-}" boite='[ ]'
  if [ -z "$en" ]; then
    if [ -z "$sha" ]; then en='rien'
    elif [ "$sha" = "$tete" ]; then en="\`$(court "$sha")\`, le dernier commit"
    else en="\`$(court "$sha")\`, pas le dernier commit (\`$(court "$tete")\`)"; fi
  fi
  [ "$voulu" = coche ] && [ -n "$sha" ] && [ "$sha" = "$tete" ] && boite='[x]'
  local nouvelle="- $boite Aperçu du dernier commit en recette — en ligne : $en $MARQUE$sha -->"
  if [ -n "$ligne" ]; then
    printf '%s\n' "$corps" | NOUVELLE="$nouvelle" awk -v m="$MARQUE" '!fait && index($0, m) { print ENVIRON["NOUVELLE"]; fait = 1; next } { print }'
  elif [ -n "$corps" ]; then
    printf '%s\n\n%s\n' "$corps" "$nouvelle"
  else
    printf '%s\n' "$nouvelle"
  fi
}

case "$mode" in
  etat) etat ;;
  en-ligne) en_ligne; echo ;;
  rafraichir) ecrire "$(etat)" "$(en_ligne)" "${2:?tête}" ;;
  refusee) ecrire vide "$(en_ligne)" "${2:?tête}" ;;
  deposee) ecrire coche "${2:?commit}" "${3:?tête}" ;;
  echec) ecrire vide '' "${3:?tête}" "incertain, le dépôt de \`$(court "${2:?commit}")\` a échoué" ;;
  *) echo "usage : case-apercu.sh etat|en-ligne|rafraichir|refusee|deposee|echec …" >&2; exit 2 ;;
esac
