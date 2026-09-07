# Formats d'import (notes pour le lot B)

Aucune donnée réelle ici : seulement la forme des fichiers.

## Export direct de la banque (CSV)

- Encodage **ISO-8859-1**, fins de ligne CRLF, séparateur `;`, point-virgule final sur chaque ligne.
- En-tête :
  `Date transaction;Date comptabilisation;Num Compte;Libellé Compte;Libellé opération;Libellé complet;Catégorie;Sous-Catégorie;Montant;Pointée;`
- Dates `JJ/MM/AAAA`. Les deux dates sont presque toujours égales ; la date de transaction fait foi.
- **Plusieurs comptes dans le même fichier** (colonne `Num Compte` / `Libellé Compte`) : le profil d'import doit ventiler par compte, comme pour Linxo. Si le compte Tirelire porte déjà ce numéro (`Account.accountNumber`, D18), la correspondance est proposée automatiquement, y compris pour un nouveau profil.
- Montant signé à virgule décimale (`-76,00`).
- Deux libellés : court (`CARTE X1234 02/09 SUPERMARCHE …`, `VIR PERM …`, `PRELEVEMENT EUROPEEN DE: …`) et complet (avec références, mandats, motifs).
  Le libellé court sert à la clé et au rapprochement de flux ; le complet est conservé pour l'affichage.
- `Catégorie` / `Sous-Catégorie` : catégorisation de la banque, à importer comme **catégorie suggérée** (pas toujours juste).
  Les libellés « Mouvements internes débiteurs / créditeurs » signalent des virements internes.
- `Pointée` : `Oui` / `Non` (pointage côté banque, sans rapport avec notre rapprochement).
- Préfixes de libellé utiles pour les règles : `VIR PERM` (virements permanents), `PRELEVEMENT EUROPEEN`, `ECHEANCE PRET`, `VIR RECU`, `VIR INST`, `CARTE …`.

## Linxo (historique)

À documenter au premier fichier : encodage, colonnes, ventilation par compte, catégories Linxo à importer comme suggestion.
