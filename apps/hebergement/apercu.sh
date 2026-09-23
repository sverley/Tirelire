#!/usr/bin/env bash
# Aperçu d'une PR sur l'instance de recette (#141) : le site de la PR vit dans
# <TIRELIRE_DEV_FTP_DOSSIER>/pr-<NUMERO>, servi à <TIRELIRE_DEV_SITE_URL>/pr-<NUMERO>/, construit
# pour la base /pr-<NUMERO>/ : la recette est la racine d'un sous-domaine.
#
#   bash apps/hebergement/apercu.sh reglages   # vérifie les réglages, affiche adresse=… de l'aperçu
#   bash apps/hebergement/apercu.sh deposer    # dépose SOURCE par deposer.sh, dans ce sous-dossier seul
#   bash apps/hebergement/apercu.sh retirer    # supprime ce sous-dossier entier, paquets du relais compris
#
# Environnement : NUMERO (numéro de la PR), TIRELIRE_DEV_FTP_DOSSIER, TIRELIRE_DEV_SITE_URL (un secret :
# l'adresse de recette ne se lit pas depuis le dépôt, #156) ; pour
# comparaison, TIRELIRE_FTP_DOSSIER (défaut www, comme la production) et TIRELIRE_SITE_URL ;
# SOURCE pour deposer ; l'accès FTP comme deposer.sh (HOTE, UTILISATEUR, MOTDEPASSE, PROTOCOLE,
# VERIFIER_CERTIFICAT).
#
# La recette n'a aucune valeur par défaut : une variable manquante, ou qui vaut celle de la
# production, arrête tout avant le moindre transfert, en la nommant. Les identifiants FTP sont ceux
# de la production (D37) : rien ne se dépose ni ne se supprime ailleurs que dans <dossier>/pr-<n>.
set -euo pipefail

ici="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
action="${1:-}"

arreter() {
  echo "Aperçu : $*" >&2
  echo "Aperçu : rien n'est déposé ni supprimé." >&2
  exit 1
}

case "$action" in
  reglages | deposer | retirer) ;;
  *) arreter "action « $action » inconnue : reglages, deposer ou retirer." ;;
esac

# --- Numéro de la PR ---------------------------------------------------------------------------
NUMERO="${NUMERO:-}"
if ! [[ "$NUMERO" =~ ^[1-9][0-9]{0,8}$ ]]; then
  arreter "NUMERO « $NUMERO » n'est pas un numéro de PR (entier positif)."
fi

# --- Dossier FTP de la recette -----------------------------------------------------------------
# Forme de comparaison : sans « ./ » ni « / » en tête, sans « / » en queue.
cle_dossier() {
  local d="$1"
  while [[ "$d" == ./* || "$d" == /* ]]; do d="${d#./}"; d="${d#/}"; done
  while [[ "$d" == */ ]]; do d="${d%/}"; done
  [ "$d" = "." ] && d=""
  printf '%s' "$d"
}

DEV_DOSSIER="${TIRELIRE_DEV_FTP_DOSSIER:-}"
PROD_DOSSIER="${TIRELIRE_FTP_DOSSIER:-www}"
if [ -z "$DEV_DOSSIER" ]; then
  arreter "TIRELIRE_DEV_FTP_DOSSIER manque : le dossier FTP de la recette n'a pas de valeur par défaut."
fi
if ! [[ "$DEV_DOSSIER" =~ ^[A-Za-z0-9._/-]+$ ]] || [[ "/$DEV_DOSSIER/" == */../* ]]; then
  arreter "TIRELIRE_DEV_FTP_DOSSIER « $DEV_DOSSIER » : seuls lettres, chiffres, « . », « _ », « - » et « / » sont admis, sans « .. »."
fi
cle_dev="$(cle_dossier "$DEV_DOSSIER")"
cle_prod="$(cle_dossier "$PROD_DOSSIER")"
if [ -z "$cle_dev" ]; then
  arreter "TIRELIRE_DEV_FTP_DOSSIER « $DEV_DOSSIER » désigne la racine FTP : il faut le dossier servi par la recette."
fi
if [ "$cle_dev" = "$cle_prod" ]; then
  arreter "TIRELIRE_DEV_FTP_DOSSIER vaut le dossier de la production (TIRELIRE_FTP_DOSSIER, « $PROD_DOSSIER »)."
fi

DOSSIER_APERCU="${DEV_DOSSIER%/}"
while [[ "$DOSSIER_APERCU" == */ ]]; do DOSSIER_APERCU="${DOSSIER_APERCU%/}"; done
DOSSIER_APERCU="$DOSSIER_APERCU/pr-$NUMERO"
cle_apercu="$cle_dev/pr-$NUMERO"
# Le seul chemin que ce script touche : <dossier>/pr-<n>, qui ne contient pas la production.
if ! [[ "$DOSSIER_APERCU" =~ ^[A-Za-z0-9._/-]+/pr-[1-9][0-9]*$ ]]; then
  arreter "chemin d'aperçu inattendu « $DOSSIER_APERCU »."
fi
if [ "$cle_prod" = "$cle_apercu" ] || [[ "$cle_prod" == "$cle_apercu"/* ]] || [ -z "$cle_prod" ]; then
  arreter "le dossier de la production (TIRELIRE_FTP_DOSSIER, « $PROD_DOSSIER ») serait dans « $DOSSIER_APERCU »."
fi

# --- Adresse de la recette ---------------------------------------------------------------------
# Forme de comparaison : schéma et hôte en minuscules, sans « / » en queue.
cle_adresse() {
  local a="${1%%\?*}"
  a="${a%%#*}"
  while [[ "$a" == */ ]]; do a="${a%/}"; done
  local schema="${a%%://*}" reste="${a#*://}"
  local hote="${reste%%/*}" chemin=""
  [[ "$reste" == */* ]] && chemin="/${reste#*/}"
  printf '%s://%s%s' "${schema,,}" "${hote,,}" "$chemin"
}
origine() {
  local c
  c="$(cle_adresse "$1")"
  local schema="${c%%://*}" reste="${c#*://}"
  printf '%s://%s' "$schema" "${reste%%/*}"
}

DEV_URL="${TIRELIRE_DEV_SITE_URL:-}"
# L'adresse de recette ne s'écrit dans aucun journal (#156). GitHub masque le secret tel qu'il est
# saisi ; on masque aussi ses autres formes (hôte seul, minuscules, sans « / » final), que curl ou
# ce script pourraient écrire. Les commandes de masquage valent pour tout le reste du job.
if [ -n "$DEV_URL" ] && [ "${GITHUB_ACTIONS:-}" = true ]; then
  masque_hote="${DEV_URL#*://}"
  masque_hote="${masque_hote%%[/?#]*}"
  for forme in "$DEV_URL" "$(cle_adresse "$DEV_URL")" "$masque_hote" "${masque_hote,,}" "${masque_hote%%:*}"; do
    [ -n "$forme" ] && echo "::add-mask::$forme" >&2
  done
fi
PROD_URL="${TIRELIRE_SITE_URL:-}"
if [ -z "$DEV_URL" ]; then
  arreter "TIRELIRE_DEV_SITE_URL manque : l'adresse de la recette n'a pas de valeur par défaut."
fi
# C3 : une application web se sert en HTTPS, ou depuis la machine elle-même. Racine d'un domaine :
# l'aperçu est construit pour /pr-<n>/, il ne marcherait pas plus bas.
if ! [[ "$DEV_URL" =~ ^https://[^/?#]+/?$ || "$DEV_URL" =~ ^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?/?$ ]]; then
  arreter "TIRELIRE_DEV_SITE_URL doit être une adresse https:// de racine de (sous-)domaine, sans chemin (C3)."
fi
if [ -n "$PROD_URL" ]; then
  if [ "$(cle_adresse "$DEV_URL")" = "$(cle_adresse "$PROD_URL")" ]; then
    arreter "TIRELIRE_DEV_SITE_URL vaut l'adresse de la production (TIRELIRE_SITE_URL)."
  fi
  if [ "$(origine "$DEV_URL")" = "$(origine "$PROD_URL")" ]; then
    arreter "TIRELIRE_DEV_SITE_URL a la même origine que la production (TIRELIRE_SITE_URL) : les aperçus partageraient son stockage navigateur (C4)."
  fi
fi

ADRESSE="$(cle_adresse "$DEV_URL")/pr-$NUMERO/"

case "$action" in
  reglages)
    echo "adresse=$ADRESSE"
    ;;

  deposer)
    # deposer.sh retombe sur « www » sans DOSSIER : on le fixe toujours, et sans nettoyage (D37).
    # L'adresse n'est pas écrite : le sous-dossier suffit à situer l'aperçu (#156).
    echo "Aperçu de la PR #$NUMERO : dépôt dans « $DOSSIER_APERCU », servi au sous-dossier pr-$NUMERO/ de la recette."
    env -u NETTOYER DOSSIER="$DOSSIER_APERCU" NETTOYER=non bash "$ici/deposer.sh"
    ;;

  retirer)
    : "${HOTE:?adresse du serveur manquante}"
    : "${UTILISATEUR:?utilisateur manquant}"
    : "${MOTDEPASSE:?mot de passe manquant}"
    HOTE="${HOTE#*://}"
    HOTE="${HOTE##*@}"
    HOTE="${HOTE%%/*}"
    [ -n "$HOTE" ] || arreter "adresse du serveur vide après nettoyage."
    PROTOCOLE="${PROTOCOLE:-ftps}"
    VERIF=yes
    [ "${VERIFIER_CERTIFICAT:-oui}" = "non" ] && VERIF=no
    SSL=true
    [ "$PROTOCOLE" = "ftp" ] && SSL=false

    script="$(mktemp)"
    trap 'rm -f "$script"' EXIT
    umask 077
    # « cls -d » échoue si le dossier n'existe pas : rien à retirer, ce n'est pas une erreur.
    # « ftp:list-options -a » : les fichiers cachés (.htaccess) doivent partir avec le dossier.
    cat > "$script" <<SCRIPT
set cmd:fail-exit yes
set net:max-retries 3
set net:timeout 20
set ftp:ssl-force $SSL
set ftp:ssl-protect-data true
set ftp:list-options -a
set ssl:verify-certificate $VERIF
set sftp:auto-confirm yes
open -u "$UTILISATEUR","$MOTDEPASSE" $PROTOCOLE://$HOTE
cls -d "$DOSSIER_APERCU" || exit 0
rm -r "$DOSSIER_APERCU"
bye
SCRIPT
    echo "Aperçu de la PR #$NUMERO : retrait de « $DOSSIER_APERCU », paquets du relais compris."
    lftp -f "$script"
    echo "Terminé : « $DOSSIER_APERCU » n'existe plus sur le serveur."
    ;;
esac
