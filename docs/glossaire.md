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
composantes de plusieurs tirelires (D19, I2). Son solde se lit comme celui d'un compte : c'est un
compte virtuel, et une étiquette exclusive des sous-opérations (D88).

## Non affecté

Ce qui reste d'un compte réel une fois retirées les composantes qu'il héberge. Calculé, jamais saisi :
pour chaque compte, solde bancaire = composantes hébergées + non affecté (I2).

## Provision

Tirelire qui accumule pour payer une charge plurimensuelle ou annuelle — taxe foncière, assurance
auto, vacances. Elle se vide à l'échéance et repart. Sa dotation est sa croisière, la charge
répartie sur sa périodicité ; ce qui ne sera pas réuni à temps s'annonce comme un **manque**, et ne
se répartit sur les périodes restantes que par un **lissage** décidé par l'utilisateur (D88).

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

La représentation abstraite d'opérations attendues : salaire, loyer perçu, prélèvement, virement
interne, échéance de provision. Décrit par un montant, une périodicité, une date et une tolérance.
Il produit les **opérations prévues**, sa représentation concrète, calculées à chaque lecture (D88).

## Opération

Un montant, une date, un compte. **Bancaire** : une ligne de relevé importée ; **saisie** : une ligne
entrée à la main, passée ou future ; **prévue** : une ligne produite par un flux, calculée, jamais
enregistrée. Un flux n'est pas une opération, mais la règle qui produit des opérations prévues. Elle contient des **sous-opérations**, peut en reprendre une autre, et est reconnue
comme virement interne ou en attente de tri (D88).

## Sous-opération

Une part d'une opération ; les sous-opérations d'une opération s'additionnent jusqu'à son montant,
sur autant de niveaux qu'on veut. Elles la **ventilent** entre tirelires, catégories ou personnes, la
divisent dans le temps (**lissage**), ou **reprennent** une autre opération qui désigne le
même mouvement : le rapprochement d'une opération bancaire, la correction d'une opération prévue, son
masquage (D88).

## Étiquette

Ce qui classe une sous-opération. **Exclusive** — compte réel, tirelire, catégorie, personne : une
seule valeur ; en porter plusieurs, c'est diviser le montant. **Libre** : autant qu'on veut, sans
diviser le montant. Une sous-opération à qui il en manque une prend celle de l'opération qui la
contient (D88).

## Personne

Un membre du foyer ou du groupe, commun à tous ceux qui ont les clés ; pas un utilisateur identifié.
Une étiquette exclusive : un revenu porte sa personne, une dépense commune se répartit entre les
personnes concernées, à parts égales par défaut. Un compte peut l'avoir pour titulaire (D88).

## Lissage

La décision de répartir un manque sur des périodes : proposée par l'application, calculée, puis
acceptée, modifiée ou refusée par l'utilisateur. Acceptée, c'est une opération divisée en
sous-opérations datées. Rien ne se lisse d'office (D88).

## Solde prévu

Le solde d'un compte ou d'une tirelire à une date : le solde réel à la date de lecture, plus les
opérations saisies à une date future et les opérations prévues qui comptent jusque-là (D88).

## Manque

Un solde prévu négatif à une date (D88). Une opération « attendue, non reçue » (D12) n'en est pas un :
elle cesse de compter dans le solde prévu, qui peut alors en montrer un.

## Instance

La copie d'un jeu de données sur un appareil ; les instances qui partagent les mêmes clés se
synchronisent (I8). Un navigateur doit pouvoir en tenir plusieurs, de jeux différents (D88).

## Période budgétaire

L'intervalle sur lequel se lit un budget : de date de paie à date de paie, ou le mois calendaire
(D02).

# Le travail

## Besoin

Terme générique. Un besoin est :

- **organisationnel** — décisions du travail, invariants, usages, principes, description du
  projet, descriptifs de rôle, fichiers d'agent comme `CLAUDE.md` ;
- **fonctionnel** — le produit final ;
- **d'outil** ;
- **de documentation**.

Le type du besoin commande tout le reste : qui écrit son harnais, où ce harnais vit, et quand il est
joué.

## Domaine

Un bloc fonctionnel du produit — budget et tirelires, plan et flux, opérations, rapprochement et
bilan, données et synchro, assistant et exemple, application —, décrit dans `docs/domaines/` (D86).
Une catégorie transverse des tâches : une tâche porte l'étiquette de son ou de ses domaines. Ce
n'est ni un but, ni une ligne d'une version, ni une unité de travail : le travail est tiré par les
**versions**.

## Cible

Une forme sous laquelle l'application se distribue — une webapp sur tel navigateur, le relais seul,
l'APK… —, active, de côté ou à venir, au catalogue `docs/cibles.md`.

## Version

Un usage garanti sur un ensemble de cibles, défini dans `docs/versions.md` (D87). Elle se termine
quand le parcours de l'usage est vert sur ses cibles, et se publie par un tag ; le socle, sans
usage, s'étale en incréments placés avant les versions qui les exercent, le premier étant `v0.0`.
Sur GitHub, un jalon du même nom regroupe ses tâches, quel que soit leur domaine : c'est elle qui
ordonne leur traitement.

## Visée

La valeur qu'un invariant vise au-delà de sa **valeur**, celle qu'il tient : aucun harnais n'échoue
dessus (`docs/invariants.md`). À ne pas confondre avec l'**objectif**, une tirelire (partie « Le
produit »).

## Harnais

Terme générique : l'ensemble de tests qui vérifie que le code produit répond au besoin. Selon le
besoin qu'il garde, un harnais est la **garde** ou des **tests**.

## Garde

L'outil qui aide à ne pas dévier des documents fondateurs : description du projet, glossaire,
invariants, contraintes, décisions, registre. Elle vérifie trois choses (D81) et rien de plus.

Elle a deux emplois, à ne pas confondre : garantir que ce qu'elle garde n'est pas altéré, et garantir
que le contenu de ce qu'elle garde est respecté.

Elle est testée par des tests ordinaires, dans `pnpm test`, comme tout code.

## Tests

Les harnais des besoins fonctionnels et d'outil.

## Documentation simple

La documentation non organisationnelle n'a pas de harnais.
