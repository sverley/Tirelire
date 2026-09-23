# Invariants du produit

Un invariant est la valeur mesurable d'un principe ou d'une règle (principe 9.2 de la
[description du projet](description-projet.md)) : la valeur à laquelle on se réfère pour valider une
mesure. Les principes et les usages vivent dans la description, qui fait foi ; un invariant qui s'en
écarterait se corrige d'après elle. Ce qui ne se mesure pas reste principe, sans entrée ici.

- Chaque invariant cite le principe ou la règle qu'il décline, et énonce sa **valeur** : ce que le
  produit tient, et au-delà de quoi son harnais échoue. S'il y a lieu, il écrit à côté son
  **objectif** : visé, sans harnais qui échoue dessus.
- Son entrée au registre ([`gardes.md`](gardes.md)) porte le harnais qui mesure la valeur, ou la
  vérification manuelle quand aucun test ne peut la trancher. Un harnais qui, à sa valeur,
  rougirait le code existant devient une issue produit, et le registre le dit.
- Une décision n'a pas d'invariant : elle est locale, s'amende, et se vérifie par les tests du
  produit. Une décision qui imposerait une valeur à tout le projet est une règle ou un principe
  déguisé. Une décision ne contredit pas un invariant ; si un besoin semble l'exiger, la question se
  pose d'abord dans une issue.
- Ce que les plateformes imposent est une contrainte ([`contraintes.md`](contraintes.md)) ; les
  cibles de distribution ont leur catalogue ([`cibles.md`](cibles.md)).
- Un invariant ne nomme ni modèle, ni écran, ni technique, sauf quand la description l'impose : le
  reste est un choix, donc une décision.
- Les invariants forment un ensemble cohérent, sans date : un invariant s'amende à la demande du
  porteur, et s'applique aussitôt, rétroactivement.

## I2 · Une tirelire est un livre de compte

Décline le principe 1.5.

**Valeur** : pour chaque compte, à tout instant, solde bancaire = somme des tirelires qu'il héberge
+ non affecté, au centime près. Le solde d'une tirelire répartie sur plusieurs comptes est la somme
de ses composantes, au centime près.

## I3 · Chaque usage tient seul

Décline le principe 2. Les usages sont définis dans la section « Usages » de la description.

**Valeur** : chacun des cinq usages s'accomplit de bout en bout sur une base vide, sans aucune donnée
propre à un autre usage.

- **U1 · Budget seul.** De la base vide au plan de la période en cours, sans une seule opération.
- **U2 · Budget et virements permanents.** De la base vide aux ordres permanents validés et
  enregistrés avec leur ventilation, sans une seule opération importée.
- **U3 · Budget sans virements validés, puis import.** D'un budget sans ordre validé à un relevé
  importé dont les virements sont rapprochés, avec la ventilation prévue.
- **U4 · Budget reconstruit depuis l'historique.** D'opérations importées sans budget à un budget
  reconstruit, chaque lien validé par l'utilisateur, aucune ventilation supposée.
- **U5 · Import seul.** D'un relevé importé au bilan par catégorie, sans qu'aucune tirelire, aucun
  besoin ni aucun budget n'existe.

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

**Objectif** : 2, 3, 3 et 4 gestes.

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

**Valeur** : aucune modification d'un ordre permanent enregistré sans une validation de
l'utilisateur ; quand le budget évolue, chaque écart entre l'ordre enregistré et le plan se signale,
avec l'ancien montant et le nouveau.

## I11 · Les assistants font partie de la vie de l'application

Décline le principe 4.3.

**Valeur** : tout ce qu'une étape d'assistant crée se retrouve, sous le même nom, dans l'écran
ordinaire correspondant, et s'y modifie hors de l'assistant.
