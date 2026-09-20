#!/usr/bin/env bash
# Vérifie qu'un hébergement sert bien Tirelire : la page d'accueil, la réécriture du relais,
# le refus d'un salon invalide, la protection du dossier de données, la redirection HTTPS.
# Toutes les vérifications sont jouées, puis le bilan ; sortie non nulle si l'une a échoué.
#
#   ADRESSE_SITE=https://exemple.tld bash apps/hebergement/verifier.sh
set -uo pipefail

: "${ADRESSE_SITE:?adresse du site manquante}"
base="${ADRESSE_SITE%/}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echecs=0

# Affiche le code HTTP, le type de contenu et le début du corps — de quoi reconnaître
# une page de parking, une erreur 404 ou une réécriture inactive sans lire les journaux.
sonder() {
  local url="$1" fichier="$2"
  curl -sS -L --max-time 20 --retry 2 --retry-delay 3 \
    -o "$tmp/$fichier" -w '%{http_code} %{content_type} %{url_effective}' "$url" 2>"$tmp/$fichier.err" \
    || echo "000 (connexion impossible : $(tr -d '\n' <"$tmp/$fichier.err"))"
}

verifier() {
  local intitule="$1" attendu="$2" obtenu="$3"
  if [ "$attendu" = "$obtenu" ]; then
    echo "  ✓ $intitule"
  else
    echo "  ✗ $intitule — attendu « $attendu », obtenu « $obtenu »"
    echecs=$((echecs + 1))
  fi
}

echo "Vérification de $base"
echo

echo "Page d'accueil ($base/)"
accueil="$(sonder "$base/" accueil.html)"
echo "  réponse : $accueil"
code_accueil="${accueil%% *}"
verifier "répond 200" 200 "$code_accueil"
if [ -s "$tmp/accueil.html" ]; then
  echo "  début du corps : $(head -c 200 "$tmp/accueil.html" | tr '\n' ' ')"
  if grep -qi 'tirelire' "$tmp/accueil.html"; then
    echo "  ✓ la page est bien celle de Tirelire"
  else
    echo "  ✗ la page ne parle pas de Tirelire (page de parking ou mauvais dossier ?)"
    echecs=$((echecs + 1))
  fi
fi
echo

echo "Relais, réécriture .htaccess ($base/r/<salon>)"
relais="$(sonder "$base/r/verification-ci-0000?site=ci&after=0" relais.json)"
echo "  réponse : $relais"
verifier "répond 200" 200 "${relais%% *}"
echo "  début du corps : $(head -c 200 "$tmp/relais.json" | tr '\n' ' ')"
if grep -q '"records"' "$tmp/relais.json"; then
  echo "  ✓ le relais répond en JSON"
else
  echo "  ✗ pas de JSON du relais (réécriture inactive, ou PHP non exécuté ?)"
  echecs=$((echecs + 1))
fi
echo

echo "Salon invalide ($base/r/x)"
invalide="$(sonder "$base/r/x" invalide.json)"
echo "  réponse : $invalide"
verifier "refusé par 400" 400 "${invalide%% *}"
echo

echo "Dossier de données ($base/donnees/)"
donnees="$(sonder "$base/donnees/" donnees.html)"
echo "  réponse : $donnees"
code_donnees="${donnees%% *}"
if [ "$code_donnees" = "200" ]; then
  echo "  ✗ le dossier des paquets de synchronisation est servi : le .htaccess n'est pas pris en compte"
  echecs=$((echecs + 1))
else
  echo "  ✓ non servi"
fi
echo

if [ "${base#https://}" != "$base" ]; then
  echo "Redirection HTTPS"
  # Sans -L : on veut le premier code, pas la page finale. Un site qui ne redirige plus répond 200
  # en clair, ce qui contredit C3 ; le script doit alors échouer comme les autres vérifications.
  redirection="$(curl -sS -o /dev/null --max-time 20 --retry 2 --retry-delay 3 -w '%{http_code} %{redirect_url}' "http://${base#https://}/" 2>"$tmp/redirection.err" || echo "000 (connexion impossible : $(tr -d '\n' <"$tmp/redirection.err"))")"
  echo "  réponse : $redirection"
  code_redirection="${redirection%% *}"
  cible_redirection="${redirection#* }"
  case "$code_redirection" in
    30[1278])
      if [ "${cible_redirection#https://}" != "$cible_redirection" ]; then
        echo "  ✓ redirige vers HTTPS"
      else
        echo "  ✗ redirige ailleurs qu'en HTTPS — « $cible_redirection »"
        echecs=$((echecs + 1))
      fi
      ;;
    *)
      echo "  ✗ ne redirige pas HTTP vers HTTPS — code « $code_redirection »"
      echecs=$((echecs + 1))
      ;;
  esac
  echo
fi

if [ "$echecs" -eq 0 ]; then
  echo "Tout est en place."
else
  echo "$echecs vérification(s) en échec."
fi
exit $((echecs > 0))
