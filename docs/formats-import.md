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

## Fichier OFX (`.ofx`, `.qfx`)

Lu pour ce qu'il contient, quelle que soit l'extension : l'utilisateur ne décrit rien (pas de profil, de colonne, de format de date, d'encodage ni de séparateur).

- **Forme.** Version 1 : un en-tête `OFXHEADER:100` suivi de balises dont la valeur n'est pas fermée (`<TRNAMT>-76.00`). Version 2 : du XML, toutes les balises fermées. Les deux se lisent de la même façon, balise fermée ou non. Encodage UTF-8 ou Windows-1252 / ISO-8859-1, reconnu seul ; les entités (`&amp;`, `&lt;`, `&gt;`…) se décodent, les blancs autour d'une valeur se retirent.
- **Un ou plusieurs relevés.** Un fichier porte un relevé de compte bancaire (`STMTRS`) ou de carte (`CCSTMTRS`), ou plusieurs. Chaque compte du fichier est reconnu par son numéro (`ACCTID`) et se rattache à un compte de l'application comme celui d'un CSV multi-comptes (D18) : prérempli quand un compte porte ce numéro mémorisé, ignoré sinon, jusqu'au choix de l'utilisateur, avec la case qui propose de mémoriser le numéro.
- **Ce qui se lit d'une opération (`STMTTRN`).**
  - la date : `DTUSER`, la date de l'opération, quand elle est présente (comme la « Date transaction » du CSV de la banque), sinon `DTPOSTED` ; le jour écrit dans le fichier, ses huit premiers chiffres, sans décalage d'heure ni de fuseau ;
  - le montant : `TRNAMT`, signé, au centime exact, la virgule décimale valant le point ;
  - le libellé : `NAME`, à défaut le `NAME` de `PAYEE`, à défaut `MEMO` ; le libellé complet : `MEMO`, quand il est présent et diffère du libellé.
- **Une autre devise.** Un relevé dont la devise déclarée (`CURDEF`) n'est pas l'euro ne s'importe pas : son compte se montre avec sa devise et ne se rattache à aucun compte. Sans devise déclarée, le relevé vaut en euros.
- **Ce qui ne se lit pas.** Une opération dont la date ou le montant est illisible est comptée et listée avec la raison, comme une ligne illisible d'un CSV ; les autres s'importent. Un fichier reconnu comme OFX sans aucun relevé de compte ou de carte lisible (tronqué, réponse d'erreur de la banque, relevé de titres seul) est refusé par un message.
- **Ce qui s'ignore.** L'identifiant de transaction de la banque (`FITID`), le type (`TRNTYPE`), les numéros de chèque et de référence, la date de disponibilité, les soldes du relevé et toute catégorie : l'OFX n'en suggère aucune.
- **Identité.** Comme celle d'un CSV : la clé de D09, calculée de la même façon quelle que soit la source. L'identifiant de transaction ne sert pas ; à contenu égal, un OFX et un CSV donnent les mêmes opérations. Une même opération venue de deux sources différentes relève du rapprochement des sources, pas de la clé.
- **Aucun profil.** L'import d'un OFX n'enregistre aucun profil d'import.

## Linxo (historique)

À documenter au premier fichier : encodage, colonnes, ventilation par compte, catégories Linxo à importer comme suggestion.
