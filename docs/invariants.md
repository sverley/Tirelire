# Invariants du produit

Ce que Tirelire doit rester, quelles que soient les solutions retenues. Les invariants disent
**quoi** et **pour qui** ; les décisions ([`decisions.md`](decisions.md)) disent **comment**, et se
prennent au regard des invariants.

- Une décision ne contredit pas un invariant. Si un besoin semble l'exiger, la question se pose
  d'abord dans une issue.
- Un invariant ne change pas au détour d'un développement : il change à la demande du porteur du
  projet, par une entrée datée dans l'historique en bas de ce document.
- Un invariant ne nomme ni modèle, ni écran, ni technique : ce sont des choix, donc des décisions.

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

Les données sont stockées en local, sur les appareils de l'utilisateur, et non sur un serveur.
Distribuer l'application par un serveur web (I9) n'y déroge pas : le serveur sert l'application,
pas les données.

## I8 · Synchroniser sessions et plateformes

Les données se synchronisent entre les sessions et entre les plateformes d'un même utilisateur.

## I9 · Plusieurs distributions

L'application se distribue par un serveur web et en application Android, et à terme sur Apple.

---

## Historique

- **2026-09-11** · Création, d'après la description du produit donnée par le porteur du projet
  (issue #29). Une partie était déjà portée par des décisions (D19, D21, D35, D40, D57) ; elle
  en est extraite pour que les décisions s'y réfèrent. Les écarts relevés entre décisions et
  invariants sont consignés dans l'issue.
