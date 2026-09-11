# Invariants du produit

Ce que Tirelire doit rester, quelles que soient les solutions retenues. Les invariants sont tirés de
la description du projet ([`description-projet.md`](description-projet.md)), le texte du porteur
conservé mot pour mot : c'est elle qui fait foi, et un invariant qui s'en écarterait se corrige
d'après elle. Les invariants disent **quoi** et **pour qui** ; les décisions
([`decisions.md`](decisions.md)) disent **comment**, et se prennent au regard des invariants.

- Une décision ne contredit pas un invariant. Si un besoin semble l'exiger, la question se pose
  d'abord dans une issue.
- Un invariant ne change pas au détour d'un développement : il change à la demande du porteur du
  projet, par une entrée datée dans l'historique en bas de ce document.
- Ce que les plateformes imposent n'est pas un invariant mais une contrainte
  ([`contraintes.md`](contraintes.md)) ; un choix technique, cible de distribution comprise, se
  consigne dans une issue.
- Un invariant ne nomme ni modèle, ni écran, ni technique, sauf quand la description du projet
  l'impose : le reste est un choix, donc une décision.

## I1 · Aider un particulier à tenir un budget sur plusieurs comptes

Tirelire aide les particuliers à gérer leur budget quand leur argent est réparti sur plusieurs
comptes bancaires.

## I2 · Une tirelire est un livre de compte

Une tirelire est un livre de compte tenu sur un ou plusieurs comptes bancaires. Elle dit combien
d'argent est disponible pour un usage particulier. Un compte peut accueillir plusieurs tirelires.
Une tirelire n'est donc pas un compte bancaire : c'est une comptabilité tenue par-dessus les
comptes.

## I3 · Chaque usage tient seul

L'application sert à chacun des usages suivants. Aucun n'est le préalable d'un autre, aucun n'est
le mode dégradé d'un autre. Un usage que l'application n'outille pas encore compte autant que les
autres : aucune décision ne doit le rendre impossible.

- **U1 · Budget seul.** Construire un budget et sa ventilation, sans suivi ni import.
- **U2 · Budget et virements permanents.** L'assistant accompagne l'utilisateur pour créer
  facilement un budget, puis lui propose la mise en place de virements permanents. L'application
  n'a pas accès aux virements : l'utilisateur les crée lui-même chez sa banque. S'il valide leur
  mise en place, ces virements sont enregistrés dans l'application avec leur ventilation sur les
  tirelires.
- **U3 · Budget sans virements validés, puis import.** L'utilisateur a fait un budget sans valider
  les virements, puis importe ses opérations. L'application l'aide à rapprocher les virements
  constatés, et peut reprendre la ventilation prévue par le budget.
- **U4 · Budget reconstruit depuis l'historique.** L'utilisateur reconstruit un budget à partir de
  l'historique de ses opérations. Cela suppose de relier les opérations aux flux enregistrés, sous
  validation de l'utilisateur. Il n'existe alors aucune ventilation prévue : elle est arbitrée par
  l'utilisateur.
- **U5 · Import seul.** Importer des opérations pour les classer et analyser les catégories, sans
  tirelire ni budget.

## I4 · Simple par défaut, souple sur demande

L'application reste toujours simple pour ses utilisateurs, et souple et configurable pour les
usages avancés. Ce qui sert un usage avancé ne complique pas l'usage simple.

## I5 · Inciter à tout utiliser

L'application incite à utiliser toutes ses fonctions en les rendant accessibles et attrayantes :
claires et efficaces. Une fonction difficile à trouver ou à comprendre ne tient pas cet invariant.

## I6 · Catégoriser en peu de clics

Classer les opérations par catégorie est aisé et demande peu de clics.

## I7 · Les données restent en local

Les données sont stockées en local, sur les appareils, et non sur un serveur.
Distribuer l'application par un serveur web (I9) n'y déroge pas : le serveur sert l'application,
pas les données. Une seule exception : le stockage temporaire de paquets chiffrés sur un relais,
pour la synchronisation asynchrone (I8), que l'utilisateur accepte après avoir été averti.

## I8 · Synchroniser de pair à pair les instances qui partagent les clés

Les instances se synchronisent de pair à pair. La synchronisation ne dépend pas de l'utilisateur :
elle vaut entre toutes les instances qui partagent les clés de chiffrement, qu'il s'agisse des
sessions et des plateformes d'une même personne ou des appareils de plusieurs personnes.

- **Mise en relation.** Deux instances se relient par le partage d'un QR code, en mode simple et
  complètement automatique, ou par un processus qui ne demande pas d'appareil photo, entre deux
  sessions sur ordinateur.
- **Synchronisation asynchrone.** Une fois les instances reliées, une instance web de
  l'application peut servir de serveur relais : elle stocke temporairement les paquets, pour que
  des instances qui ne sont pas connectées en même temps se synchronisent. Ce relais n'est pas
  présenté comme privé.
- **Consentement averti.** Cette possibilité est proposée à l'utilisateur lors de sa première
  mise en lien de deux sessions, avec un avertissement : des données chiffrées seront déposées sur
  le serveur.

## I9 · Plusieurs distributions

L'application se distribue par un serveur web et en application Android, et à terme sur Apple.

## I10 · Proposer, et ne jamais faire de manière cachée

Le plan de virements permanents reste lié au budget, durablement. Quand le budget évolue,
l'application propose les évolutions du plan qui en découlent ; elle n'en fait jamais aucune de
manière cachée.

## I11 · Les assistants font partie de la vie de l'application

Un assistant guide ; il ne fait rien que l'application ne fasse aussi, en dehors de lui, tout au
long de son usage.

- **Rien de réservé aux assistants.** Ce qu'un assistant crée reste vivant dans l'application, et
  ce qu'il fait se retrouve dans l'usage courant.
- **Le train de vie évolue : le budget propose des adaptations.**
- **Le budget évolue : l'application propose les changements de comportement à reproduire**, côté
  banque (les virements permanents, I10) ou côté train de vie.

---

## Historique

- **2026-09-11** · Création, d'après la [description du projet](description-projet.md)
  (issue #29). Une partie était déjà portée par des décisions (D19, D21, D35, D40, D57) ; elle
  en est extraite pour que les décisions s'y réfèrent. Les écarts relevés entre décisions et
  invariants sont consignés dans l'issue.
- **2026-09-11** · I7 et I8 précisés d'après le complément de la description du projet sur la
  synchronisation (point 1 de l'issue #29) : pair à pair, mise en relation par QR code ou sans
  appareil photo, relais web temporaire proposé avec un avertissement.
- **2026-09-11** · I8 élargi d'après la correction du porteur : la synchronisation ne se limite pas
  à un même utilisateur, elle vaut entre les instances qui partagent les clés de chiffrement.
- **2026-09-11** · La distribution du relais, un temps ajoutée à I8 et I9, en est retirée : les cibles
  de distribution sont des choix techniques, suivis en issues (#32, #33, #34, #35, #36, #37), et les contraintes des
  plateformes sont consignées dans [`contraintes.md`](contraintes.md).
- **2026-09-11** · I10 ajouté d'après les objectifs du porteur (objectif 4, #48).
- **2026-09-11** · I11 ajouté d'après le porteur : les assistants font partie de la vie de
  l'application (#55, #56, #57).
