# Glossaire

Le vocabulaire du projet. Ses mots sont conservés dans
[`description-projet.md`](description-projet.md) ; ce document les applique. Un terme employé ici
vaut partout ailleurs : issues, PR, code, documentation.

Deux parties : **le produit**, ce dont l'application parle ; **le travail**, ce dont les sessions
parlent.

# Le produit


Ces définitions viennent de l'analyse du besoin du 6 septembre 2026, corrigées du modèle d'aujourd'hui
(D19, I2 : une tirelire se répartit sur plusieurs comptes).

## Compte principal

Le compte bancaire réel par lequel transitent tous les flux : revenus en entrée, prélèvements,
dépenses courantes et virements sortants.

## Compte d'accueil

Tout autre compte réel — livret, compte secondaire, PEL, assurance-vie — qui reçoit des virements du
compte principal et héberge une ou plusieurs composantes de tirelires.

## Compte tiers

Compte réel dont on n'importe pas le relevé : compte secondaire, compte personnel d'un membre du
foyer, espèces. Ses opérations utiles au plan sont saisies à la main et créent un solde à régler avec
le compte principal (D04).

## Tirelire

Un livre de compte : une somme réservée à un usage précis, avec son propre solde. Elle se répartit
sur un ou plusieurs comptes réels, chaque part étant une **composante** ; un compte réel héberge les
composantes de plusieurs tirelires (D19, I2).

## Non affecté

Ce qui reste d'un compte réel une fois retirées les composantes qu'il héberge. Calculé, jamais saisi :
pour chaque compte, solde bancaire = composantes hébergées + non affecté (I2).

## Provision

Tirelire qui accumule pour payer une charge plurimensuelle ou annuelle — taxe foncière, assurance
auto, vacances. Elle se vide à l'échéance et repart. Sa dotation n'est pas la charge divisée par
douze : c'est ce qui reste à réunir, réparti sur les périodes restantes, ce qui rattrape un retard
et absorbe un changement de montant.

## Objectif

Tirelire qui accumule sans échéance de vidage, ou avec une cible lointaine : épargne de précaution,
projet.

## Budget

Tirelire de dépense courante à horizon d'une période : alimentation, essence, sorties. Ce qu'on fait
du reliquat se règle par tirelire (D05).

## Charge fixe

Prélèvement ou virement régulier de montant connu — loyer, crédit, abonnements. Ce n'est pas une
tirelire : c'est un flux prévu, directement sur un compte.

## Flux prévu

Toute opération attendue : salaire, loyer perçu, prélèvement, virement interne, échéance de
provision. Décrit par un montant, une périodicité, une date et une tolérance.

## Opération

Une ligne de relevé bancaire importée, ou saisie à la main. Elle est pointée sur un flux prévu,
ventilée en catégories et tirelires, reconnue comme virement interne, ou en attente de tri.

## Période budgétaire

L'intervalle sur lequel se lit un budget : de date de paie à date de paie, ou le mois calendaire
(D02).

# Le travail

## Besoin

Terme générique. Un besoin est :

- **organisationnel** — règles, invariants, usages, principes, description du projet, fichiers
  d'agent comme `CLAUDE.md` ;
- **fonctionnel** — le produit final ;
- **d'outil** ;
- **de documentation**.

Le type du besoin commande tout le reste : qui écrit son harnais, où ce harnais vit, et quand il est
joué.

## Cible

Une forme sous laquelle l'application se distribue — une webapp sur tel navigateur, le relais seul,
l'APK… —, active, de côté ou à venir, au catalogue `docs/cibles.md`.

## Harnais

Terme générique : l'ensemble de tests qui vérifie que le code produit répond au besoin. Selon le
besoin qu'il garde, un harnais est la **garde** ou des **tests**.

## Garde

L'outil qui aide à ne pas dévier des documents fondateurs : description du projet, glossaire,
invariants, contraintes, décisions, registre. Elle vérifie trois choses (`CLAUDE.md`) et rien de plus.

Elle a deux emplois, à ne pas confondre : garantir que ce qu'elle garde n'est pas altéré, et garantir
que le contenu de ce qu'elle garde est respecté.

Elle est testée par des tests ordinaires, dans `pnpm test`, comme tout code.

## Tests

Les harnais des besoins fonctionnels et d'outil.

## Documentation simple

La documentation non organisationnelle n'a pas de harnais.
