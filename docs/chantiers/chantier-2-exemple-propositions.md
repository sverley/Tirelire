# Chantier 2 · L'exemple embarqué génère les propositions de l'application

Issue : #46.

## Intention

> 2. L'exemple embarqué sert à génération des propositions dans l'appli (comptes, flux, tirelire, catégories).

Les propositions de l'application — comptes, flux, tirelires, catégories — viennent de l'exemple embarqué.

## Contraintes

Des catalogues (`docs/invariants.md`, `docs/contraintes.md`, `docs/decisions.md`) :

- **Principe 4, I10** : une proposition ne devient rien d'elle-même ; ce qu'elle crée se voit et se
  corrige.
- **I3** : les propositions ne lient aucun usage à un autre. En U5, des catégories proposées ne
  créent ni n'exigent de tirelire.
- **I4** : le parcours simple se franchit sans remplir un champ ; les propositions le servent sans
  l'alourdir.
- **I8** : deux instances nées chacune avec leur compte principal n'en ont qu'un après
  synchronisation.
- **I11** : ce que l'assistant crée se retrouve et se modifie hors de l'assistant.
- **C9** : les propositions se lisent et se choisissent sur 375 px, au doigt.
- **D43, D53** : aucune proposition n'a de contenu propre ; l'exemple garde de quoi démontrer le
  plan.
- **D84** : l'exemple reste inventé.

Propres au chantier, paroles du porteur du 24 septembre 2026 :

- Les aides des champs viennent de l'exemple, et un parcours qui s'y tient reproduit l'exemple :

  > les aides doivent être alimentées par des valeurs de l'exemple afin qu'en fin de parcours d'un
  > assistant en utilisant les aides, on finisse sur une base de données équivalente à l'exeple
  > embarqué.

- Les propositions sont présentes dans l'assistant, pas dans le projet, jusqu'à la validation
  finale ; quitter l'assistant avant la fin n'enregistre rien :

  > L'assistant inclus des propositions d'office mais elle ne sont pas d'office dans le projet.
  > Elles ne seront ajoutées qu'à la fin de l'assistant une fois validées

- Tout ce que l'exemple porte se propose, opérations exceptées : comptes, y compris un compte clos
  ou celui d'un tiers, flux, tirelires et leurs besoins, catégories, versions datées :

  > L'assistant propose tout ce qui constitue l'exemple. On verra si ça alourdi de manière inutile
  > plus tard

- Le compte principal n'est pas une proposition : il existe dans toute base, même vide ; l'assistant
  en propose seulement les informations :

  > le compte principale est obligatoire, il est donc existant en toute circonstance. l'assistant
  > permet simplement de renseigner des infos utiles

- Un ajout à l'exemple devient une proposition sans autre écriture.

Ces paroles amendent D40 (compte principal créé à la première réponse), D43 (propositions touchées
une à une), D46 (lignes écrites dans le projet dès l'arrivée sur l'étape) et D51 (seule la version
en vigueur se propose). L'avertissement de D41 sur l'absence de compte principal n'a plus d'objet.

## Hypothèses

1. Une proposition est un contenu offert pour créer ou renseigner un compte, un flux, une tirelire
   avec ses besoins, ou une catégorie, que l'utilisateur garde, corrige ou retire. Ce qui se calcule
   sur ses propres données n'en est pas une : cible suggérée de la revue, rapprochement proposé
   d'une opération, motif d'automatisme, catégorie donnée par la banque.
2. Un seul exemple, en français, pour un foyer. Si l'application devait proposer selon un profil ou
   une langue, l'hypothèse tomberait.
3. Les objets se proposent avec leurs liens : une catégorie avec sa tirelire, une échéance avec son
   flux, une tirelire avec son placement. Le sens d'« équivalente » — identifiants, dates décalées
   au jour du parcours — et la place des automatismes relèvent du chantier 5.
4. Hors de l'assistant, la façon de proposer n'est pas tranchée. Piste du porteur, 24 septembre
   2026 :

   > Je dirais a priori que l'appli pourrait ouvrir l'assistant (peut-etre que la partie
   > concernée) pour proposer des évolutions.

## Cibles

- **Webapp · Chromium sur Android** : active, prioritaire.
- **Webapp · Chromium sur ordinateur** : active.
- **Relais PHP seul** : sans objet.
- Toutes les autres : hors du chantier. Le contenu vient du cœur, qui ne dépend d'aucune cible.

## Usages

- **U1** d'abord (principe 2.1) : les propositions rendent facile un budget construit ex nihilo ;
  le chantier 3 en dépend. Le parcours U1 d'I3 n'en dépend pas.
- **U2** : les mêmes propositions ; les virements de l'exemple se proposent comme flux.
- **U5** : des catégories proposées qui servent sans tirelire.
- **U3, U4** : non concernés.

Le chantier 5 vérifie de bout en bout ce que ce chantier fournit : l'assistant parcouru sans rien
changer reproduit l'exemple.
