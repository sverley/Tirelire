# Chantier 4 · Un plan de virements permanents lié au budget, dont les évolutions se proposent

Issue : #48.

## Intention

> 4. l'appli propose un plan de virement permanent en lien avec le budget (les liens sont perennes, si un budget évolue, on doit "proposer et jamais faire de manière cachée" (invariant) des évolutions du plan

L'application propose un plan de virements permanents lié au budget, d'un lien durable. Quand le budget évolue, elle propose les évolutions du plan et n'en fait jamais aucune de manière cachée : le porteur en fait un invariant (I10).

## Contraintes

Des fondements :

- **I10** : le budget et les flux ne changent que sur une validation ; calculer le plan ne modifie
  rien ; quand le budget évolue, chaque écart avec un ordre enregistré se signale, ancien et nouveau
  montant, sans le réécrire. C'est le cœur du chantier.
- **Principe 4.1, U2** : l'utilisateur pose ses ordres lui-même chez sa banque, l'application n'y a
  pas accès. Elle ne connaît un ordre que parce que l'utilisateur en valide la mise en place ; il est
  alors enregistré avec sa ventilation sur les tirelires.
- **Principe 1.2** : le plan n'évolue que sur un changement de fond.
- **Principe 1.4, D60** : le rattrapage n'entre jamais dans un ordre permanent ; une dépense trop
  proche se signale par le montant qui manquera, en plus des ordres calculés sur la période complète.
- **I3** : U2 tient seul, sans import ; U1 lit le plan de virements sans jamais avoir à valider un
  ordre.
- **I4** : un ordre par compte d'accueil par défaut ; le diviser est une souplesse sur demande.
- **I11** : ce que l'assistant fait des ordres se fait et se modifie aussi hors assistant.
- **I2, D19** : une tirelire répartie sur plusieurs comptes partage sa dotation entre leurs ordres,
  sans l'exiger deux fois.
- **I5, C9** : les ordres à poser et leurs évolutions se trouvent depuis l'accueil, se lisent et se
  recopient sur un téléphone de 375 px.
- **C2** : recopier un libellé ou un montant garde une voie qui ne dépend d'aucune capacité propre à
  une plateforme.
- **C8, I8** : un ordre enregistré est un fait synchronisé ; deux instances à des versions
  différentes ne le perdent ni ne le dédoublent.
- **Chantier 2, D43** : ce que l'assistant propose vient de l'exemple, ses virements compris, et
  n'entre dans le projet qu'à la validation finale de l'assistant. Un ordre proposé par l'assistant
  ne s'enregistre qu'à cette validation.
- **D53, D60** : l'exemple garde de quoi démontrer le plan ; il porte un ordre enregistré en écart
  avec le budget, au-delà du pas d'arrondi, et doit en démontrer aussi la ventilation.

Propres au chantier :

- Ce que le budget demande se recalcule et ne se stocke pas ; ce que l'utilisateur a validé — le
  montant de l'ordre chez la banque et sa ventilation — s'enregistre, et rien ne le réécrit (D57,
  D60).
- Un ordre que le budget ne demande plus est signalé, jamais supprimé d'office : il continue de virer
  tant que personne n'y a touché (D60).

## Hypothèses

1. L'application ne voit jamais la banque : un ordre enregistré est ce que l'utilisateur déclare
   avoir posé. Seul l'import (chantier 6) peut confirmer qu'il vire ; sans import, le plan le tient
   pour exact.
2. L'ordre enregistré porte sa ventilation sur les tirelires qu'il sert, en parts librement
   choisies (D27, D60) : fixes, un montant, ou flottantes, un pourcentage ou la part restante. Les
   parts flottantes se recalculent sur le montant constaté ; l'écart d'une part fixe avec ce que le
   budget demande se propose comme toute évolution. 24 septembre 2026, à la question de ce
   qu'« enregistrés avec leur ventilation » demande :

   > H2 : les ventilations sont assez libres. Elles peuvent être fixes ou flottantes. Quand elles sont flottantes, elles peuvent être en pourcentage ou la part "restante"

3. Le lien entre budget et ordre est pérenne parce qu'il tient aux comptes et aux tirelires, pas à
   leurs noms ni à un montant : renommer, ajouter ou retirer un besoin, déplacer une tirelire ne
   rompt pas le lien, et fait au plus naître une proposition. Le libellé déjà posé chez la banque
   reste celui enregistré.
4. Un changement de fond (principe 1.2) est un écart qui dépasse le pas d'arrondi de l'ordre
   enregistré, dans un sens comme dans l'autre : en deçà, rien ne se propose (D60). Validé par le
   porteur le 24 septembre 2026 : « H4 ok ».
5. Proposer, c'est laisser choisir : accepter, c'est enregistrer le nouveau montant ou la nouvelle
   ventilation une fois l'ordre modifié chez la banque ; ne pas accepter est légitime (D20), l'écart
   reste lisible sans bloquer. Une évolution d'ordre se calcule sur les données de l'utilisateur :
   ce n'est pas une proposition au sens du chantier 2, qui vient de l'exemple (son hypothèse 1). Sa
   forme hors du Plan se tranchera avec la question que le chantier 2 pose sur les propositions hors
   de l'assistant, dont la piste du porteur est d'ouvrir la partie concernée de l'assistant.
6. Sans ordre enregistré, le plan qui change n'est pas une action cachée : c'est un résultat
   recalculé (I10). Le signaler reste à évaluer.
7. Deux sources proposent un ordre : le plan, qui propose ce que le budget demande ; l'assistant,
   qui propose l'ordre de l'exemple (chantier 2). Suivre l'exemple jusqu'au bout enregistre l'ordre
   de l'exemple, écart compris, et le plan en propose aussitôt l'évolution : c'est la démonstration
   que l'exemple porte (D53, D60).

## Cibles

- **Webapp · Chromium sur Android** : active ; c'est là que le porteur utilise l'application, et
  d'où un ordre se recopie vers l'application de sa banque.
- **Webapp · Chromium sur ordinateur** : active.
- **Relais PHP seul** : sans objet ; il transporte les ordres enregistrés comme toute donnée (I8),
  sans travail propre au chantier.
- Toutes les autres : hors du chantier.

## Usages

- **U2** : l'usage du chantier. De la base vide : budget, ordres proposés par le plan ou, depuis
  l'exemple, par l'assistant, mise en place validée, ordres enregistrés avec leur ventilation, puis
  évolutions proposées quand le budget change.
- **U1** : partage la proposition du plan de virements, le virement à faire du parcours U1 ; le
  chantier ne lui ajoute aucune étape.
- **U3** : s'appuie sur la ventilation d'un plan non validé ; le rapprochement relève du chantier 6.
- **U4** : un plan tiré des opérations (chantier 8) garde le même lien au budget.
- **U5** : sans objet, ni tirelire ni budget.
