# Description du projet

Le texte du porteur du projet, conservé **mot pour mot**, sans correction ni reformulation : seuls
ses retours à la ligne sont devenus des paragraphes. **Il fait foi.** Les invariants
([`invariants.md`](invariants.md)) en sont tirés ; s'ils s'en écartent, ce sont eux qu'on corrige.

Ce texte ne se reformule pas. Seul le porteur le complète ou le corrige, avec ses propres mots,
datés ; ce qu'il retire reste visible, barré.

## 6 septembre 2026 · le besoin d'origine

Repris de l'analyse du besoin du 6 septembre, supprimée depuis : seuls les documents Markdown de
`docs/` font foi. Ces deux passages sont les seuls qu'aucun autre document ne portait.

> Tu veux un outil qui fasse trois choses, dans cet ordre : **planifier** (à partir des revenus, des
> charges périodiques, des objectifs d'épargne et des budgets, en déduire combien virer chaque mois
> vers chaque compte), **tenir des soldes par objectif** (chaque provision, chaque objectif
> d'épargne, chaque budget a son propre compteur, indépendamment du compte bancaire qui l'héberge),
> et **vérifier** (importer les relevés, reconnaître automatiquement les opérations prévues, classer
> le reste par catégorie et comparer au budget).

Une partie de cela existe déjà : Actual Budget fait les tirelires, le report, l'import CSV avec règles
et dédoublonnage ; Firefly III couvre le multi-comptes et les règles de catégorisation ; YNAB est la
référence payante de la méthode. Ce qu'aucun ne fait, et qui est le cœur du projet :

> **déduire les virements permanents par compte réel à partir des tirelires qui y sont hébergées**,
> avec le rattrapage d'échéance, et vérifier au pointage que le virement a bien eu lieu.

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

## 11 septembre 2026 · objectifs

Extrait des objectifs du projet : la ligne que le porteur marque « invariant ». Les dix objectifs
sont suivis en issues (#45 à #54).

> 4. l'appli propose un plan de virement permanent en lien avec le budget (les liens sont perennes, si un budget évolue, on doit "proposer et jamais faire de manière cachée" (invariant) des évolutions du plan

## 11 septembre 2026 · assistants et vie de l'application

Extrait : le paragraphe que le porteur marque « Invariant ». Les deux assistants qu'il envisage sont
suivis en objectifs (#55, #56).

> Invariant : Tout ce qui est fait dans les assistants doit faire partie aussi de la vie de l'app. Un train de vie évolue, le budget doit proposer des adaptations. Le budget évolue, l'app doit proposer de changmeent de comportement à reproduire coté banque ou train de vie.

## 13 et 14 septembre 2026 · organisation, garde et catalogues

Paroles du porteur en discussion, sur la conduite du projet plutôt que sur le produit. Elles fondent
les catalogues (#96) et leur séparation (#95). Ce qui touche à l'ordre auditeur-codeur est déjà cité
dans D68 et n'est pas repris ici.

### Le glossaire

> Un besoin a un sens générique. ce besoin peut être organisationnel (regles, invariants, usages, principes, description projet, fichier agent type CLAUDE.md), un besoin fonctionnel (produit final), un besoin d'outil, de documentation...
> Un harnais est un terme générique pour parler d'un ensemble de test qui vérifie que le code généré répond au besoin générique
> La garde est un outil qui garde la description projet, les principes, les invariants, les usages, les cibles, les règles. tous les catalogues hormis les cibles, qu'en penses-tu ? C'est un ensemble de harnais qui garantit qu'un besoin organisationnel qui a été codé ne sera pas trahi. Elle peut se garder elle-meme : un harnais de la garde ne doit pas produire un résultat qui contredit la garde.
> Les tests sont les harnais des besoins fonctionnels et d'outils
> La documentation simple (au sens non organisationnelle) n'a pas besoin de harnais
> Les harnais qui verifient le codage d'un besoin organisationnel, qu'il ait produit une garde ou non, sont nommées "amorçages". Ils n'ont pas besoin d'etre joués autrement qu'en cas de codage dans la garde et ce qu'elle garde.

### Les catalogues, et ce qui les distingue

> Pour le projet, on pose des regles/principes généraux et qui permettent à la fois de "poser comment répondre à une question", "quels buts poursuivre" et de "mettre des limites incontournables". Il y a des invariants qui sont issues de ces regles et qui viennent de choix arbitraires, des contraintes qui viennent de l'environnement/plateforme et découlent souvent des regles, des décisions qui sont prises pendant les discussions d'un codage ou d'un harnais et qui ne doivent jamais contrevenir aux principes. Enfin, il y a des usages qui guident les choix en proposant des mises en application afin d'évaluer les conséquences des options

> Par contre, je vois que tu consignes des décisions concernant les règles comme les décisions qui concernent le produit. Elles n'ont pas le meme roles ni la meme valeur : une decision ne doit pas contrevenir aux regles. Une regle qui contrevient aux regles doit proposer des modifications des regles existantes. L'un travail au niveau organisationnel, l'autre au niveau produit

> prends la définition au sens génie logiciel : un invariant est mesurable. Je pense qu'on se trompe de mot. Les invariants sont le produits d'une décision, d'une regles, d'un usage ou meme d'un principes qui alimente le résultat de harnais qui peuvent mesurer ces invariants. Je pense qu'il faut un catalogue de principes séparés du catalogue d'invariants. ll faut un catalogue de regles séparé du catalogue de decisions. il faut un catalogue d'usage et de contraintes.

> Un invariant est la déclinaison chiffrée d'un principe ou d'une règle, pas d'une decision car il impacte tout le projet

> les principes font partie de la description du projet, il sont de moi.

### Ni journal, ni date : des ensembles cohérents

> on ne doit pas parler de journal de regles, usages, invariants... il n'y a aucune notion temporelle qui doit rentrer en compte dans le résultat de l'application de ceux-ci. On maintient des ensembles cohérents et on les amende si une nouvelle entrée crée une incohérence

> idem, l'application d'une décision doit être retroactivement. Les harnais de cette nouvelle regle peuvent d'ailleurs créer des voyants rouges sur le code actuel. Ces voyant nécessiteront une issue (ou plusieurs) pour être corrigés au regard de la nouvelle regle. Mais cette regle peut être posée meme si elle crée des voyants rouges

> par contre, pour être fusionnée, la PR de codage de cette regle doit valider ses amorçages

> Et attention, une decision n'est pas "datée dans son intention". Une règle s'applique à tout moment. Si elle change, c'est rétroactif

### Cibles, portée des contraintes, priorité des usages

> je valide le catalogue de cible : il permettra de réduire explcitement les champs d'application des agents de codage et de distribution. Aujourd'hui, on a webapp et relayphp (on met APK de coté). Les contraintes se déclinent par leur portée : par defaut, elles concernent toutes les cibles. Elle sont restreintes si besoin

> Le principe reste I3. D57 est plutot ce qui en découle en appliquant une priorité d'usage. Donc peut-être qu'a l'instar des cibles, les usages pourraient être priorisés par des décisions (plutot que omis des catalogues). Une décision disant "On ne traite que l'Usage U1 pour la cible webapp" qui sera ensuite amendée le moment voulu

> oui on consigne avec une précision : la priorité reste l'usage de construction d'un buget exnihilo

### La garde tient les catalogues

> il est important qu'elle ne decide pas de sa propre evolution, mais est-il envisageable qu'elle propose une evolution en proposant des services de gestions des catalogues (plutot qu'une edition direct) afin de pouvoir detecter si une decision pourrait être une regle ?

> quand je parle de service, je ne parle pas d'API. Le service peut-etre rendu par la garde elle-meme puisque qu'on lui demande dans tous le scas de s'assurer qu'une décision est conforme

> Je veux que ce soit la garde qui ajoute/edite/retire un item dans les catalogues, mais pas via un service web et API, seulement via l'appel à l'outil. Ainsi, les catalogues sont tous gardés (non altérables si on les compare à leur etat git), et les editions de chacun ne font pas forcément les memes chose : ajouter une decision ne fait que verifier que la decsion est conforme et proposer si besoin de la promouvoir comme regle ou usage ou invariant, tout en gérant les ID, ajouter une regles fera appliquer la garde sur la regle elle-meme et ainsi de suite. Si on modifie des choses qui modifie le resultat de la garde, alors on vérifie l'amorcage et on demande une validation humaine (mais ca, c'est un invariant de la garde, il va donc s'appliquer de facto sur tout appel à la garde)

> en cas d'altération, on rejoue l'edition par l'outil. Bien sur, il faut aussi coder que la modification du contenu de la garde hormis les decisions doivent declencher dans le workflow une validation manuelle pour eviter un agent qui modifierait l'invariant garantissant ce comportement

> donc la garde executer est celle de main (toujours) mais son résultat s'applique sur le code courant. Je préfere ce découpage

> Si la garde doit être modifiée, elle doit :
> soit le faire en respectant la garde en place (ajout) => OK
> soit modifier un comportement en place => KO => Validation manuelle avec détaille des harnais de la garde qui rougissent

> dans tous les cas, un changement de comportement de la garde doit être validé manuellement (invariant) et le changement doit être expliqué et justifié en commentaire de la PR (invariant)
