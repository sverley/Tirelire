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

Compte réel qui suit un **solde à régler** avec le compte principal (D04) : compte joint, compte
personnel d'un membre du foyer, espèces. Ce n'est pas un genre de compte, mais un réglage, que le
compte soit importé ou saisi à la main ; ses opérations font ce solde (D45).

## Tirelire

Un livre de compte : une somme réservée à un usage précis, avec son propre solde. Elle se répartit
sur un ou plusieurs comptes réels, chaque part étant une **composante** ; un compte réel héberge les
composantes de plusieurs tirelires (D19, I2). Son solde se lit comme celui d'un compte : c'est un
compte virtuel, et une étiquette exclusive des sous-opérations (D88).

## Besoin

Ce à quoi sert une tirelire : elle en porte un ou plusieurs, sur un solde unique (D28). Quatre
genres : **récurrent**, tant par période (un **budget**) ; **à échéance**, un montant pour une date
(une **provision**) ; **objectif**, un montant sans date ; **versement**, une part que la tirelire
verse au budget au lieu de le consommer (D48). Chaque besoin a sa **croisière** et sa priorité (D06,
D28). À ne pas confondre avec le besoin au sens du travail (partie « Le travail »).

## Croisière

Le montant par période d'un besoin, en régime établi : son montant réparti sur les périodes de sa
périodicité, ou, pour un objectif, sa mensualité déclarée. C'est la base de sa **dotation** (D29).

## Non affecté

Ce qui reste d'un compte réel une fois retirées les composantes qu'il héberge. Calculé, jamais saisi :
pour chaque compte, solde bancaire = composantes hébergées + non affecté (I2). C'est un solde, à une
date : il se lit dans le **suivi**, jamais comme un montant de la période (D96).

## Dotation

Ce que le budget compte d'un besoin, chaque période : sa croisière, plus la part d'un lissage décidé ;
pour un versement, sa part déclarée (D29, D48). Elle ne dépend d'aucun solde : ce que le réel en dit —
une provision qui a déjà sa cible, un objectif atteint, une réserve qui ne tiendra pas — devient une
proposition d'ajustement, que l'utilisateur valide ou refuse (D96).

## Provision

Un besoin à échéance (D28) : une charge plurimensuelle ou annuelle — taxe foncière, assurance auto,
vacances —, pour laquelle sa tirelire accumule ; elle se vide à l'échéance et repart. Sa croisière
est la charge répartie sur sa périodicité ; ce qui ne sera pas réuni à temps s'annonce comme un
**manque**, et ne se répartit sur les périodes restantes que par un **lissage** décidé par
l'utilisateur (D88).

## Objectif

Un besoin objectif (D28) : un montant à réunir sans échéance de vidage, ou avec une cible
lointaine — épargne de précaution, projet.

## Budget

Un besoin récurrent (D28) : tant par période pour une dépense courante — alimentation, essence,
sorties. Ce qu'on fait du reliquat se règle par tirelire (D05). À ne pas confondre avec **le
budget**, la partie de l'application qui déclare les montants de chaque période (D96).

## Charge fixe

Prélèvement ou virement régulier de montant connu — loyer, crédit, abonnements. Ce n'est pas une
tirelire : c'est un flux prévu, directement sur un compte.

## Automatisme

Une sélection et une action, appliquées sans geste aux opérations que la sélection retient (D23,
D39) : l'action classe — catégorie, tirelire, ventilation — et peut poser l'état, *classée* ou
*verrouillée* (D22). Un automatisme classe ; il ne rapproche pas : seul un flux rapproche (D24). Un
flux est un automatisme au sens du concept (**flux prévu**).

## Flux prévu

Un automatisme au sens du concept — une sélection, une action (D24) —, doté d'une récurrence : la
représentation abstraite d'opérations attendues : salaire, loyer perçu, prélèvement, virement
interne, échéance de provision. Décrit par un montant, une périodicité, une date et une tolérance.
Sa récurrence produit les **opérations prévues**, sa représentation concrète, calculées à chaque
lecture ; sa sélection, la seule — son compte, son motif de libellé, sa tolérance de montant et la
fenêtre de ses occurrences —, reconnaît l'opération bancaire qui réalise chacune, qui la
**rapproche** (D12, D24, D88) ; son action la ventile et la classe. Il s'enregistre à part des
automatismes, avec cette sélection à lui : seule son action a la forme de celle d'un automatisme
(D24). Un flux de virement du compte principal vers un compte d'accueil est un **ordre permanent**
(D57, D60).

## Opération

Un montant, une date, un compte. **Bancaire** : une ligne de relevé importée ; **saisie** : une
ligne entrée à la main, passée ou future ; **prévue** : une ligne produite par un flux, calculée,
jamais enregistrée, désignée par son flux et sa date. Un flux n'est pas une opération, mais un
automatisme qui en produit. Elle contient des **sous-opérations**, peut en **rapprocher** une autre,
et est reconnue comme virement interne ou en attente de tri (D88).

## Sous-opération

Une part d'une opération ; les sous-opérations d'une opération s'additionnent jusqu'à son montant —
sauf celles d'un lissage —, sur autant de niveaux qu'on veut. Elles la **ventilent** entre
tirelires, catégories ou personnes, ou la divisent dans le temps (**lissage**) (D88). Le
**rapprochement** n'en est pas une : c'est l'opération qui le porte.

## Rapprochement

Le lien entre deux opérations qui désignent le même mouvement. L'opération bancaire rapproche
l'opération prévue qu'elle réalise, désignée par son flux et sa date, ou une saisie : celle qui
annonçait le même mouvement, ou celle qui corrige ou masque cette opération prévue ; une saisie
rapproche l'opération prévue qu'elle corrige, ou, de zéro, qu'elle masque. Une opération en rapproche
au plus une autre, et n'est rapprochée qu'une fois. L'opération rapprochée ne compte plus : celle qui
la rapproche compte à sa place, pour son propre montant, et l'écart entre les deux reste visible
(D12, D88). Le lien est porté par l'opération qui rapproche, pas par une sous-opération. Il est
automatique quand la sélection d'un flux le permet et que le candidat se distingue — entre les flux qui
retiennent l'opération, comme entre les opérations qui se disputent une occurrence, aucun autre n'a une
note élevée et proche de la sienne, ni la même (D12) —, validé par l'utilisateur sinon (principe 4.4).
À ne pas confondre avec l'état *classée* d'une opération (D22).

## Appariement

Le lien entre les deux côtés d'un virement interne, un débit et un crédit de deux comptes suivis : chacun
désigne l'autre, de sorte que le virement ne compte qu'une fois (D88). Il se fait sans confirmation
seulement quand la destination du virement est connue — un compte que l'utilisateur a désigné, ou que
reconnaît le libellé d'un ordre enregistré vers lui (D11) —, et se propose sinon. À ne pas confondre avec
le **rapprochement**, le lien entre deux opérations qui désignent le même mouvement.

## Série

Ce que l'historique montre d'un flux qui n'existe pas encore : des opérations de même compte, même sens
et même motif qui se suivent à un écart régulier. Elle se constate, elle ne se devine pas ; elle propose
un flux (D95). Ce n'est pas une **récurrence**, la règle d'un flux, qui produit ses opérations prévues
(D88).

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
acceptée, modifiée ou refusée par l'utilisateur. Acceptée, c'est une saisie de montant nul divisée
en sous-opérations datées ; acceptée ou refusée, elle laisse une **réponse**. Rien ne se lisse
d'office (D88).

## Réponse

La réponse de l'utilisateur à une proposition de l'application, enregistrée avec ce à quoi elle
répond, pour que la proposition ne revienne pas tant que cela ne change pas de fond (principe 1.2).
Elle a deux formes, et une troisième ne s'invente pas (principe 13) : la réponse au manque d'une
échéance, lissage retenu ou refus, désignée par le besoin et la date de l'échéance (D88) ; l'ordre
permanent gardé tel quel, avec ce que le budget en demandait au geste (D60).

## Solde prévu

Le solde d'un compte ou d'une tirelire à une date : le solde réel à la date de lecture, plus les
opérations saisies à une date future et les opérations prévues qui comptent jusque-là (D88).

## Manque

Un solde prévu négatif à une date (D88). Une opération « attendue, non reçue » (D12) n'en est pas un :
elle cesse de compter dans le solde prévu, qui peut alors en montrer un.

## Suivi

La partie de l'application qui lit le réel à une date : soldes réels et prévus des comptes et des
tirelires, non affecté, manques, attendus non reçus, virements tirés du réel — complément
exceptionnel, à rapatrier, écarts entre comptes, règlements —, et les propositions d'ajustement qu'il
en tire. Il vit dans le Bilan (D96). À ne pas confondre avec un compte **suivi**, qui porte des
opérations importées (D88).

## Instance

La copie d'un jeu de données sur un appareil ; les instances qui partagent les mêmes clés se
synchronisent (I8). Un navigateur doit pouvoir en tenir plusieurs, de jeux différents (D88).

## Période budgétaire

L'intervalle sur lequel se lit un budget : de date de paie à date de paie, ou le mois calendaire
(D02).

# Le travail

## Besoin

Terme générique. Un besoin est :

- **organisationnel** — décisions du travail (`docs/methodes.md`), invariants, usages, principes,
  description du projet, descriptifs de rôle, fichiers d'agent comme `CLAUDE.md` ;
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
dessus (`docs/invariants.md`). À ne pas confondre avec l'**objectif**, un genre de besoin (partie
« Le produit »).

## Harnais

Terme générique : l'ensemble de tests qui vérifie que le code produit répond au besoin. Selon le
besoin qu'il garde, un harnais est la **garde** ou des **tests**.

## Garde

L'outil qui aide à ne pas dévier des documents fondateurs : description du projet, glossaire,
invariants, contraintes, décisions, méthodes, registre. Elle vérifie trois choses (D81) et rien de
plus.

Elle a deux emplois, à ne pas confondre : garantir que ce qu'elle garde n'est pas altéré, et garantir
que le contenu de ce qu'elle garde est respecté.

Elle est testée par des tests ordinaires, dans `pnpm test`, comme tout code.

## Tests

Les harnais des besoins fonctionnels et d'outil.

## Documentation simple

La documentation non organisationnelle n'a pas de harnais.
