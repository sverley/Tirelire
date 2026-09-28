#!/usr/bin/env bash
# Dépôt du site assemblé sur un hébergement web, par FTPS ou SFTP (lftp).
# Utilisé par la CI (dépôt en production à la publication d'une version, et, par `apercu.sh`, sur la
# recette) et utilisable à la main :
#
#   HOTE=ftp.clusterXXX.hosting.ovh.net UTILISATEUR=moncompte MOTDEPASSE=… \
#   SOURCE=apps/hebergement/dist bash apps/hebergement/deposer.sh
#
# Variables : HOTE, UTILISATEUR, MOTDEPASSE (obligatoires) ; SOURCE (défaut apps/hebergement/dist),
# DOSSIER (défaut www), PROTOCOLE (ftps | sftp | ftp), VERIFIER_CERTIFICAT (oui | non),
# NETTOYER (non | oui : supprime du serveur ce qui n'est plus dans le site), BLANC (1 = essai à blanc),
# GARDER (motifs lftp, séparés par des espaces, de ce qui vit dans le dossier sans venir du site et
# que le dépôt ne touche jamais, nettoyage compris : à la racine de la recette, les aperçus et le
# robots.txt, #233).
set -euo pipefail

: "${HOTE:?adresse du serveur manquante}"
: "${UTILISATEUR:?utilisateur manquant}"
: "${MOTDEPASSE:?mot de passe manquant}"
# L'adresse est acceptée telle qu'on la copie de l'hébergeur : un schéma (« ftp://… »), un
# utilisateur en tête ou un chemin en queue sont retirés, seul le nom d'hôte (et son port) sert.
HOTE_BRUT="$HOTE"
HOTE="${HOTE#*://}"
HOTE="${HOTE##*@}"
HOTE="${HOTE%%/*}"
if [ "$HOTE" != "$HOTE_BRUT" ]; then
  echo "Adresse du serveur ramenée à « $HOTE »."
fi
if [ -z "$HOTE" ]; then
  echo "Adresse du serveur vide après nettoyage de « $HOTE_BRUT »." >&2
  exit 1
fi

SOURCE="${SOURCE:-apps/hebergement/dist}"
DOSSIER="${DOSSIER:-www}"
PROTOCOLE="${PROTOCOLE:-ftps}"
VERIFIER_CERTIFICAT="${VERIFIER_CERTIFICAT:-oui}"
NETTOYER="${NETTOYER:-non}"
BLANC="${BLANC:-}"

if ! { [ -f "$SOURCE/index.html" ] && [ -f "$SOURCE/relais.php" ] && [ -f "$SOURCE/.htaccess" ]; }; then
  echo "« $SOURCE » ne ressemble pas au site assemblé (index.html, relais.php, .htaccess)." >&2
  exit 1
fi

# Ce qui vit sur le serveur et ne doit jamais être écrasé ni supprimé :
# les paquets de synchronisation des appareils et la configuration locale du relais.
EXCLUSIONS='--exclude-glob donnees/*.jsonl --exclude-glob relais.config.php'
# Et ce que l'appelant désigne (GARDER), exclu de même, à l'envoi comme au nettoyage. `read` ne
# développe pas les motifs : ils arrivent tels quels à lftp.
read -r -a garder <<< "${GARDER:-}"
for motif in "${garder[@]}"; do
  if [[ "$motif" == *[!]A-Za-z0-9._*/[-]* ]]; then
    echo "GARDER : motif « $motif » refusé (lettres, chiffres et « . _ - / * [ ] » seulement)." >&2
    exit 1
  fi
  EXCLUSIONS="$EXCLUSIONS --exclude-glob $motif"
done
# Fichiers d'entrée : montés en dernier pour qu'aucun visiteur ne charge un index.html
# qui pointerait vers des ressources pas encore transférées.
ENTREE='--exclude-glob index.html --exclude-glob sw.js --exclude-glob registerSW.js --exclude-glob manifest.webmanifest'
SUPPRESSION=''
if [ "$NETTOYER" = "oui" ]; then SUPPRESSION='--delete'; fi
ESSAI=''
if [ -n "$BLANC" ]; then ESSAI='--dry-run'; fi
VERIF=yes
if [ "$VERIFIER_CERTIFICAT" = "non" ]; then VERIF=no; fi
SSL=true
# Sans chiffrement : réservé aux tests locaux (voir deposer.test.mjs).
if [ "$PROTOCOLE" = "ftp" ]; then SSL=false; fi

script="$(mktemp)"
trap 'rm -f "$script"' EXIT
umask 077
cat > "$script" <<SCRIPT
set cmd:fail-exit yes
set net:max-retries 3
set net:timeout 20
set ftp:ssl-force $SSL
set ftp:ssl-protect-data true
set ssl:verify-certificate $VERIF
set sftp:auto-confirm yes
set mirror:parallel-transfer-count 3
open -u "$UTILISATEUR","$MOTDEPASSE" $PROTOCOLE://$HOTE
mirror --reverse --continue --no-perms --verbose $ESSAI $EXCLUSIONS $ENTREE "$SOURCE" "$DOSSIER"
mirror --reverse --continue --no-perms --verbose $ESSAI $SUPPRESSION $EXCLUSIONS "$SOURCE" "$DOSSIER"
bye
SCRIPT

echo "Dépôt de « $SOURCE » vers $PROTOCOLE://$HOTE/$DOSSIER${ESSAI:+ (essai à blanc)}…"
lftp -f "$script"
