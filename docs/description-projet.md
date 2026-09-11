# Description du projet

Le texte du porteur du projet, conservé **mot pour mot**, sans correction ni reformulation : seuls
ses retours à la ligne sont devenus des paragraphes. **Il fait foi.** Les invariants
([`invariants.md`](invariants.md)) en sont tirés ; s'ils s'en écartent, ce sont eux qu'on corrige.

Ce texte ne se reformule pas. Seul le porteur le complète ou le corrige, avec ses propres mots,
datés ; ce qu'il retire reste visible, barré.

## 11 septembre 2026

Donné à l'ouverture de l'issue #29.

> L'esprit de l'application est d'aider les particuliers à gérer leur budget avec plusieurs comptes.
>
> on doit accompagner un utilisateur à créer un budget facilement à partir de l'assistant puis lui proposer la mise en place de virement permanent qu'il doit faire manuellement (on n'a pas accès au virement). S'il valide ces mises en place, alors ces virements doivent être enregistrés dans l'appli avec leur ventilation sur les tirelires.
>
> Mais l'autre aspect (non traité ici mais qui compte) est que l'appli doit aussi servir à reconstruire un budget à partir de l'historique des opérations ce qui implique un lien entre les opérations et les flux enregistrés s'ils sont validés par l'utilisateur. Dans ce cas il ne peut pas y avoir de ventilation prévue, elle doit être arbitrée.
>
> Le dernier cas est un utilisateur qui a fait un budget mais sans valider les virements et qui importe ses opérations. Là, on peut l'aider à rapprocher le virement et on peut utiliser la ventilation prévue.
>
> L'application doit pouvoir servir a simplement construire un budget et une ventilation mais sans suivi ni importation.
>
> Inversement, elle peut servir uniquement à importer des opérations et faire de la classifications et analyses de catégories sans tirelires et budget.
>
> Elle doit toujours rester simple pour les utilisateurs mais souple et configurable pour les usages avancée.
>
> Elle doit inciter à utiliser toutes les fonctionnalités en les rendant accessibles et attrayantes (claires et efficaces).
>
> La catégorisation des opérations doit être aisée (peu de clique)
>
> La notion de "Tirelire" est une notion de "livre de compte" tenu sur un ou plusieurs comptes bancaires permettant de connaitre la quantité d'argent disponible pour un usage particulier. Les comptes peuvent accueillir plusieurs tirelires.
>
> L'appli doit avoir plusieurs forme de distribution : webserver, app Android (et apple à terme). Les données ne doivent pas être stockées sur un serveur mais en local. On doit prévoir une synchronisation entre session et les plateformes.
>
> Cette description doit être consignée cote doc du dépôt (voir si c'est pas déjà le cas) comme invariants, pas comme décision. Les décision doivent être prise au regard des invariants

## 11 septembre 2026 · synchronisation

Réponse au point 1 de l'issue #29 (relais).

> Le projet permet la synchronisation pair a pair des instances ~~d'un même utilisateur~~. La mise en relation des instances se fait via un partage de qrcode (mode simple et complètement automatique) ou un processus sans besoin d'appareil photo (2 sessions ordinateur). on permet ensuite un stockage temporaire des paquets sur une instances web de l'appli servant de serveur relai (retirer la notion de privé) pour permettre une synchronisation asynchrone. Cette possibilité doit être proposée à l'utilisateur lors de sa première mis en lien de deux sessions avec un avertissement concernant le dépôt de données chiffrées sur le serveur.

Correction du porteur, le même jour :

> J'ai trop réduit le verbatim en ne pensant qu'à un utilisateur, on peut prévoir une synchronisation agnostique tant qu'il y a partage des clés de chiffrement.

## 11 septembre 2026 · distribution du relais

Réponse à la question 2 de l'issue #31, qui proposait de retirer le relais autonome (`apps/relay`).

> Non, il faut le porter en cible de distribution. Il fait partie d'une release pour qu'un utilisateur puisse le mettre en place sur un serveur sans mettre l'appli web entiere
>
> Mais il doit utiliser le même code, ce n'est que sa distribution qui est proposée seule en plus d'embarquée dans la distribution web
