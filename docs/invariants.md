# Invariants du produit

Les valeurs mesurables des principes et des décisions (principe 9.2 de la
[description du projet](description-projet.md), qui fait foi). Chacun cite ce qu'il décline et
énonce sa **valeur**, que son harnais fait échouer au-delà ; s'il y a lieu, sa **visée**,
sans harnais qui échoue dessus. Son harnais, ou sa vérification manuelle, est au registre
([`gardes.md`](gardes.md)). Une décision n'en porte un que selon D79 ; une contrainte est dans
[`contraintes.md`](contraintes.md), une cible dans [`cibles.md`](cibles.md).

## I2 · Une tirelire est un livre de compte

Décline le principe 1.5.

**Valeur** : pour chaque compte, à tout instant, solde bancaire = somme des tirelires qu'il héberge
+ non affecté, au centime près. Le solde d'une tirelire répartie sur plusieurs comptes est la somme
de ses composantes, au centime près.

## I3 · Chaque usage tient seul

Décline le principe 2, pour chacun des usages de la description.

**Valeur** : chaque usage s'accomplit de bout en bout sur une base vide, sans aucune donnée propre à
un autre usage.

## I4 · Simple par défaut, souple sur demande

Décline le principe 3.

**Valeur** : le parcours simple va de la base vide au plan sans un seul réglage avancé — chaque étape
se franchit par son seul bouton primaire, sans champ à remplir, sans liste à déplier, sans détour par
la Configuration.

## I5 · Inciter à tout utiliser

Décline le principe 3.1.

**Valeur** : chaque fonction s'atteint depuis l'accueil en 2 gestes au plus, par un point d'entrée qui
la nomme, et chaque écran porte, sur une base vide, ce qui le remplirait.

## I6 · Catégoriser en peu de clics

Décline le principe 3.2. Depuis l'écran Opérations, l'opération sous les yeux ; un geste est une
frappe sur un bouton ou une ligne, un choix dans une liste, une case cochée.

**Valeur** : catégoriser une opération en 3 gestes au plus, 4 avec une sous-catégorie ; automatiser
toutes les opérations semblables en 4 gestes au plus, 5 avec une sous-catégorie.

**Visée** : 2, 3, 3 et 4 gestes.

## I7 · Les données restent en local

Décline le principe 5.

**Valeur** : sans relais renseigné, aucune requête ne sort de l'appareil avec des données ; avec un
relais, seuls des paquets chiffrés sortent, et seulement après l'acceptation explicite de
l'utilisateur. Servir l'application par un serveur web n'y déroge pas : le serveur sert
l'application, pas les données.

## I8 · Synchroniser les instances qui partagent les clés

Décline les principes 5.1 et 5.2.

**Valeur** : deux ou trois instances qui partagent les clés de chiffrement convergent vers le même
état, sans perte, en direct comme par un relais ; le relais ne rend à un appareil que ce que les
autres ont déposé. La durée de garde des paquets sur le relais reste à fixer (#31).

## I9 · Plusieurs distributions

Décline le principe 6.

**Valeur** : chaque cible active du catalogue ([`cibles.md`](cibles.md)) se construit depuis `main`, à
chaque push, et aucune cible de côté ou à venir ne bloque sa construction.

## I10 · Proposer, et ne jamais faire de manière cachée

Décline les principes 4 et 4.2.

**Valeur** : le budget et les flux ne changent que sur une validation de l'utilisateur ; le plan en
est le résultat, recalculé, et le calculer ne modifie rien. Quand le budget évolue, chaque écart
avec un ordre permanent enregistré se signale, avec l'ancien montant et le nouveau, sans le réécrire.

## I11 · Les assistants font partie de la vie de l'application

Décline le principe 4.3.

**Valeur** : tout ce qu'une étape d'assistant crée ou fait se fait et se modifie aussi hors
assistant.
