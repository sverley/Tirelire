# Description du projet

Le texte du porteur du projet, conservé **mot pour mot**, sans correction ni reformulation : seuls
ses retours à la ligne sont devenus des paragraphes. **Il fait foi.** Les invariants
([`invariants.md`](invariants.md)) en sont tirés ; s'ils s'en écartent, ce sont eux qu'on corrige.

Ce texte ne se reformule pas. Seul le porteur le complète ou le corrige, avec ses propres mots,
datés ; ce qu'il retire reste visible, barré.

## Principes

Validés par le porteur le 23 septembre 2026 (#162), tels quels : « oui » ; 9, 9.1, 9.2 et 11.1 dans
les formulations qu'il a validées le même jour. Du plus général au plus précis.

### Le produit

1. L'application aide les particuliers à gérer leur budget réparti sur plusieurs comptes.
   1. Son cœur : établir sur le long terme, pour chaque compte, les virements permanents qui remplissent les tirelires qu'il héberge, puis vérifier au pointage qu'ils ont eu lieu.
   2. Le plan n'évolue que sur un changement de fond.
   3. Le plan s'appuie sur ce que les tirelires contiennent réellement : seules les données enregistrées servent, jamais une hypothèse. Il signale un risque à venir sans supposer ce qui n'est pas tracé.
   4. Quand une dépense est enregistrée trop près de sa date pour être épargnée à temps, l'application avertit du montant qui manquera, en plus des virements permanents calculés sur la période complète.
   5. Elle planifie, tient un solde par tirelire et vérifie.
2. Chaque usage se suffit à lui-même : construire un budget sans import, importer et classer sans budget, reconstruire un budget depuis l'historique, rapprocher des opérations d'un budget.
   1. L'usage prioritaire est la construction d'un budget ex nihilo.
3. Elle reste simple pour tous, souple et configurable pour les usages avancés.
   1. Chaque fonctionnalité est accessible et attrayante : claire et efficace.
   2. Catégoriser une opération demande peu de clics.
4. L'application propose, l'utilisateur décide : rien ne se fait de manière cachée.
   1. L'utilisateur met en place ses virements lui-même, dans sa banque ; une fois validés dans l'application, ils sont enregistrés avec leur ventilation.
   2. Quand le budget ou le train de vie évolue, elle propose d'adapter l'autre.
   3. Ce qu'un assistant fait fait aussi partie de la vie de l'application.
   4. Une opération n'est liée à un flux que si l'utilisateur le valide ; sans ventilation prévue, il l'arbitre.
5. Les données restent chez l'utilisateur : en local, jamais stockées sur un serveur.
   1. Elles se synchronisent entre sessions, plateformes et personnes qui partagent les clés de chiffrement.
   2. Un relais ne garde que des paquets chiffrés, temporairement, et l'utilisateur en est averti à la première mise en lien.
6. Elle se distribue sur plusieurs plateformes : web, Android, Apple à terme.

### Le travail

7. Les paroles du porteur font foi ; lui seul les complète ou les corrige.
8. Le besoin s'analyse avant les solutions.
9. Les catalogues sont des ensembles cohérents, sans date : une décision s'applique à tout moment, rétroactivement.
   1. Une décision ne contrevient jamais à un principe ni à une autre décision.
   2. Un invariant est la valeur mesurable d'un principe ou d'une décision, à laquelle on se réfère pour valider une mesure.
   3. Un changement peut rendre des tests rouges : ils deviennent une dette de cette évolution, suivie dans une issue.
10. Ce qu'un test peut vérifier, un test le vérifie ; la documentation simple n'en a pas besoin.
    1. La CI cherche le bon compromis entre son coût et la stabilité : assez de tests pour qu'un rouge ne se découvre pas après la fusion, pas au point de ralentir le travail.
11. Celui qui vérifie n'est pas celui qui code ; le porteur valide, et la fusion vaut validation.
    1. L'architecte, le codeur et l'auditeur lisent le besoin chacun de son côté : c'est la confrontation de leurs lectures qui fait avancer, pas le forçage de l'un par l'autre.
12. La garde reste simple et peu coûteuse ; elle ne décide pas de sa propre évolution, et tout changement de son comportement est validé par le porteur.

## Usages

Les usages du principe 2, dans les paroles du porteur du 11 septembre 2026 (#29) ; seuls
l'identifiant et le titre sont ajoutés. U1, l'usage prioritaire (principe 2.1), vient en tête.

1. **U1 · Budget seul.** « L'application doit pouvoir servir a simplement construire un budget et une ventilation mais sans suivi ni importation. »
2. **U2 · Budget et virements permanents.** « on doit accompagner un utilisateur à créer un budget facilement à partir de l'assistant puis lui proposer la mise en place de virement permanent qu'il doit faire manuellement (on n'a pas accès au virement). S'il valide ces mises en place, alors ces virements doivent être enregistrés dans l'appli avec leur ventilation sur les tirelires. »
3. **U3 · Budget sans virements validés, puis import.** « Le dernier cas est un utilisateur qui a fait un budget mais sans valider les virements et qui importe ses opérations. Là, on peut l'aider à rapprocher le virement et on peut utiliser la ventilation prévue. »
4. **U4 · Budget reconstruit depuis l'historique.** « Mais l'autre aspect (non traité ici mais qui compte) est que l'appli doit aussi servir à reconstruire un budget à partir de l'historique des opérations ce qui implique un lien entre les opérations et les flux enregistrés s'ils sont validés par l'utilisateur. Dans ce cas il ne peut pas y avoir de ventilation prévue, elle doit être arbitrée. »
5. **U5 · Import seul.** « Inversement, elle peut servir uniquement à importer des opérations et faire de la classifications et analyses de catégories sans tirelires et budget. »

## 6 septembre 2026 · le besoin d'origine

Repris de l'analyse du besoin du 6 septembre, supprimée depuis : seuls les documents Markdown de
`docs/` font foi. Ces deux passages sont les seuls qu'aucun autre document ne portait ; ils ne sont
pas du porteur (voir ci-dessous).

> ~~Tu veux un outil qui fasse trois choses, dans cet ordre : **planifier** (à partir des revenus, des charges périodiques, des objectifs d'épargne et des budgets, en déduire combien virer chaque mois vers chaque compte), **tenir des soldes par objectif** (chaque provision, chaque objectif d'épargne, chaque budget a son propre compteur, indépendamment du compte bancaire qui l'héberge), et **vérifier** (importer les relevés, reconnaître automatiquement les opérations prévues, classer le reste par catégorie et comparer au budget).~~

Une partie de cela existe déjà : Actual Budget fait les tirelires, le report, l'import CSV avec règles
et dédoublonnage ; Firefly III couvre le multi-comptes et les règles de catégorisation ; YNAB est la
référence payante de la méthode. Ce qu'aucun ne fait, et qui est le cœur du projet :

> ~~**déduire les virements permanents par compte réel à partir des tirelires qui y sont hébergées**, avec le rattrapage d'échéance, et vérifier au pointage que le virement a bien eu lieu.~~

Barrées par le porteur le 23 septembre 2026 (#162) : ces deux citations sont la reformulation d'un
agent, pas ses paroles. Le principe 1 et ses déclinaisons les remplacent.

> Cette phrase n'est pas de moi, il faut qu'elle soit claire pour etre validée

## 11 septembre 2026

Donné à l'ouverture de l'issue #29.

> L'esprit de l'application est d'aider les particuliers à gérer leur budget avec plusieurs comptes.

Les cinq paragraphes suivants, sur les usages, sont dans la section « Usages ».

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

## 11 septembre 2026 · chantiers

Extrait des chantiers du projet : la ligne que le porteur marque « invariant ». Les dix chantiers
sont suivis en issues (#45 à #54).

> 4. l'appli propose un plan de virement permanent en lien avec le budget (les liens sont perennes, si un budget évolue, on doit "proposer et jamais faire de manière cachée" (invariant) des évolutions du plan

## 11 septembre 2026 · assistants et vie de l'application

Extrait : le paragraphe que le porteur marque « Invariant ». Les deux assistants qu'il envisage sont
suivis en chantiers (#55, #56).

> Invariant : Tout ce qui est fait dans les assistants doit faire partie aussi de la vie de l'app. Un train de vie évolue, le budget doit proposer des adaptations. Le budget évolue, l'app doit proposer de changmeent de comportement à reproduire coté banque ou train de vie.

## 13 et 14 septembre 2026 · organisation, garde et catalogues

Paroles du porteur en discussion, sur la conduite du projet plutôt que sur le produit. Elles fondent
les catalogues (#96), leur séparation (#95) et l'ordre auditeur-codeur (#91).

### Le glossaire

> Un besoin a un sens générique. ce besoin peut être organisationnel (regles, invariants, usages, principes, description projet, fichier agent type CLAUDE.md), un besoin fonctionnel (produit final), un besoin d'outil, de documentation...
> Un harnais est un terme générique pour parler d'un ensemble de test qui vérifie que le code généré répond au besoin générique
> La garde est un outil qui garde la description projet, les principes, les invariants, les usages, les cibles, les règles. tous les catalogues hormis les cibles, qu'en penses-tu ? C'est un ensemble de harnais qui garantit qu'un besoin organisationnel qui a été codé ne sera pas trahi. Elle peut se garder elle-meme : un harnais de la garde ne doit pas produire un résultat qui contredit la garde.
> Les tests sont les harnais des besoins fonctionnels et d'outils
> La documentation simple (au sens non organisationnelle) n'a pas besoin de harnais
> ~~Les harnais qui verifient le codage d'un besoin organisationnel, qu'il ait produit une garde ou non, sont nommées "amorçages". Ils n'ont pas besoin d'etre joués autrement qu'en cas de codage dans la garde et ce qu'elle garde.~~

Retiré par le porteur le 19 septembre 2026 :

> On retire tout le concept d'amorçage.

### Les catalogues, et ce qui les distingue

> Pour le projet, on pose des regles/principes généraux et qui permettent à la fois de "poser comment répondre à une question", "quels buts poursuivre" et de "mettre des limites incontournables". Il y a des invariants qui sont issues de ces regles et qui viennent de choix arbitraires, des contraintes qui viennent de l'environnement/plateforme et découlent souvent des regles, des décisions qui sont prises pendant les discussions d'un codage ou d'un harnais et qui ne doivent jamais contrevenir aux principes. Enfin, il y a des usages qui guident les choix en proposant des mises en application afin d'évaluer les conséquences des options

> Par contre, je vois que tu consignes des décisions concernant les règles comme les décisions qui concernent le produit. Elles n'ont pas le meme roles ni la meme valeur : une decision ne doit pas contrevenir aux regles. Une regle qui contrevient aux regles doit proposer des modifications des regles existantes. L'un travail au niveau organisationnel, l'autre au niveau produit

> prends la définition au sens génie logiciel : un invariant est mesurable. Je pense qu'on se trompe de mot. Les invariants sont le produits d'une décision, d'une regles, d'un usage ou meme d'un principes qui alimente le résultat de harnais qui peuvent mesurer ces invariants. ~~Je pense qu'il faut un catalogue de principes séparés du catalogue d'invariants.~~ ~~ll faut un catalogue de regles séparé du catalogue de decisions.~~ il faut un catalogue ~~d'usage et~~ de contraintes.

Corrigé par le porteur le 22 septembre 2026 :

> En effet, je me suis trompé. Les principes vivent dans la description, dans une section dédiée. Pas besoin de catalogue pour eux.

> Non, les usages vont dans une section dédiée dans la description après les principes, mais les cibles sont dans un catalogues

> ~~Un invariant est la déclinaison chiffrée d'un principe ou d'une règle, pas d'une decision car il impacte tout le projet~~

Barré par le porteur le 23 septembre 2026 (#162), parce qu'elle contredit le principe 9.2 qu'il a
validé le même jour, à la question « Veux-tu que je la barre ? » :

> Oui

> les principes font partie de la description du projet, il sont de moi.

Sur le catalogue de règles séparé, le porteur avait répondu le 22 septembre 2026 (#161) :

> ~~Toujours vrai~~

Corrigé par le porteur le 23 septembre 2026 (#162) :

> Non, j'ai fait une erreur. Les regles au sens actuel sont organisationnelles. Elles décrivent des méthodes à respecter. Les decisions sont fonctionnelles, elle décrivent le fonctionnement du produit. Le comportement décrit les rôles et ce qui est attendus de chaque rôle.
> Il y a une réflexion structurelle à mener. Je souhaitait ce découpage pour que les decisions ne puissent pas être en contraction avec les regles. Mais puisque c'est aussi vrai pour les regles envers les regles (idem pour les decisions), je ne sais pas s'il est encore utile de faire cette différenciation. Est-ce qu'on ne décrit pas le concept sémantique des exigences d'un projet ? Où les exigences sont ailleurs ?

> Je pense que décision et méthodes sont décidées par moi, elles suivent la meme autorité et ordonnent à tout le projet. Pourquoi les différencier ? Par contre, les rôles peuvent avoir un descriptif dédié qui servira de prompt. La question de savoir si toutes les decisions, fonctionnelles ou organisationnelles, ont un invariants se pose. Tout en sachant qu'un invariant quantifie une mesure mais cette mesure n'est pas nécessairement programmable (tous les invariants n'ont pas forcément un harnais autre qu'une validation manuelle)

> Ok, le catalogue des decisions est docs/decisions.md

### Ni journal, ni date : des ensembles cohérents

> on ne doit pas parler de journal de regles, usages, invariants... il n'y a aucune notion temporelle qui doit rentrer en compte dans le résultat de l'application de ceux-ci. On maintient des ensembles cohérents et on les amende si une nouvelle entrée crée une incohérence

> idem, l'application d'une décision doit être retroactivement. Les harnais de cette nouvelle regle peuvent d'ailleurs créer des voyants rouges sur le code actuel. Ces voyant nécessiteront une issue (ou plusieurs) pour être corrigés au regard de la nouvelle regle. Mais cette regle peut être posée meme si elle crée des voyants rouges

> ~~par contre, pour être fusionnée, la PR de codage de cette regle doit avoir ses amorçages verts, quand elle en a~~

Retiré par le porteur le 19 septembre 2026 :

> On retire tout le concept d'amorçage.

> Et attention, une decision n'est pas "datée dans son intention". Une règle s'applique à tout moment. Si elle change, c'est rétroactif

### Cibles, portée des contraintes, priorité des usages

> je valide le catalogue de cible : il permettra de réduire explcitement les champs d'application des agents de codage et de distribution. Aujourd'hui, on a webapp et relayphp (on met APK de coté). Les contraintes se déclinent par leur portée : par defaut, elles concernent toutes les cibles. Elle sont restreintes si besoin

> Le principe reste I3. D57 est plutot ce qui en découle en appliquant une priorité d'usage. Donc peut-être qu'a l'instar des cibles, les usages pourraient être priorisés par des décisions (plutot que omis des catalogues). Une décision disant "On ne traite que l'Usage U1 pour la cible webapp" qui sera ensuite amendée le moment voulu

> oui on consigne avec une précision : la priorité reste l'usage de construction d'un buget exnihilo

### La garde tient les catalogues

> ~~il est important qu'elle ne decide pas de sa propre evolution, mais est-il envisageable qu'elle propose une evolution en proposant des services de gestions des catalogues (plutot qu'une edition direct) afin de pouvoir detecter si une decision pourrait être une regle ?~~

> ~~quand je parle de service, je ne parle pas d'API. Le service peut-etre rendu par la garde elle-meme puisque qu'on lui demande dans tous le scas de s'assurer qu'une décision est conforme~~

> ~~Je veux que ce soit la garde qui ajoute/edite/retire un item dans les catalogues, mais pas via un service web et API, seulement via l'appel à l'outil. Ainsi, les catalogues sont tous gardés (non altérables si on les compare à leur etat git), et les editions de chacun ne font pas forcément les memes chose : ajouter une decision ne fait que verifier que la decsion est conforme et proposer si besoin de la promouvoir comme regle ou usage ou invariant, tout en gérant les ID, ajouter une regles fera appliquer la garde sur la regle elle-meme et ainsi de suite. Si on modifie des choses qui modifie le resultat de la garde, alors on vérifie ses amorçages, s'il y en a, et on demande une validation humaine (mais ca, c'est un invariant de la garde, il va donc s'appliquer de facto sur tout appel à la garde)~~

Retirées par le porteur le 22 septembre 2026, avec la simplification du 19 (les deux premières menaient à la troisième) :

> Retiré par simplification

> ~~en cas d'altération, on rejoue l'edition par l'outil.~~ Bien sur, il faut aussi coder que la modification du contenu de la garde hormis les decisions doivent declencher dans le workflow une validation manuelle pour eviter un agent qui modifierait l'invariant garantissant ce comportement

Retiré par le porteur le 22 septembre 2026 (la première phrase seulement) :

> Tombe de facto

> donc la garde executer est celle de main (toujours) mais son résultat s'applique sur le code courant. Je préfere ce découpage

> Si la garde doit être modifiée, elle doit :
> soit le faire en respectant la garde en place (ajout) => OK
> soit modifier un comportement en place => KO => Validation manuelle avec détaille des harnais de la garde qui rougissent

> dans tous les cas, un changement de comportement de la garde doit être validé manuellement (invariant) et le changement doit être expliqué et justifié en commentaire de la PR (invariant)

Modérées par le porteur le 21 septembre 2026, dans #150 : la validation manuelle que demandent
« Si la garde doit être modifiée… », « dans tous les cas… » et la seconde phrase de « en cas
d'altération… » est le passage en Ready. Voir, plus bas, « Il y a un problème de dénomination… » (section « Brouillon, Ready et
validation »).

### L'auditeur et le codeur

Le 14 septembre, dans #91.

> je ne fais pas confiance au codeur. Aussi, quand un besoin est défini (que ce soit une règle ou une fonctionnalité), je veux un agent qui code le harnais du besoin pour vérifier que le codeur va bien répondre au besoin et un agent qui code le besoin.

> c'est l'auditeur qui ouvre une PR. C'est donc l'auditeur d'un besoin qui évalue si le besoin doit se décliner en une ou plusieurs taches. Le codeur ne fait que coder le besoin dont le harnais est déjà en place

Modérées par le porteur les 21 et 22 septembre 2026 : ces deux paroles valent pour le produit ; la
documentation et la garde n'ont pas de harnais par défaut. Voir, plus bas, « Non. La garde peut être
modifiée sans harnais… » (#150) et « il faut modéré le propos… » (section « La place des harnais »).

> le codeur ne doit pas modifier une PR. Mais il peut mettre des commentaires

> Le codeur doit aussi justifier dans un commentaire ce qu'il a fait comme modification qui nécessitent un validation humaine

> le codeur doit être honnête et concis dans son rapport de modifications nécessitant une validation humaine

> il faut ajouter que le codeur ne doit pas regarder le harnais ~~(ou amorçage)~~ pour coder le besoin. il doit le faire depuis sa propre interprétation depuis le besoin

Retiré par le porteur le 19 septembre 2026 :

> On retire tout le concept d'amorçage.

> ~~oui, le codeur s'en remet à la CI.~~ il est censé y avoir des hook-precommit et pre-push pour faire le nécessaire

Retiré par le porteur le 21 septembre 2026, dans #150 (la première phrase seulement) :

> Je en suis pas convaincu par une petite CI. Restons sur les tests locaux en mode auditeur/codeur

> une PR fusionnée doit fermer automatiquement l'issue (le besoin) qu'elle couvre. Si une discussion née, soit cette discussion est bloquante pour la PR et elle fait partie de la PR, soit elle est non-bloquante et fait l'objet d'une nouvelle issue avant la fusion

> un harnais ne doit être codé que si on a une tache atomique. Si une tache contient des sous-taches, on ne peut pas imposer un harnais global tant que les sous-taches ne sont pas faites et vertes

## 15 septembre 2026 · les paroles suivent le glossaire

Tranché à l'occasion de #107 et de sa PR #108, qui réécrivait deux phrases du porteur à la suite d'un
renommage.

> je préfère amender mes paroles afin de maintenir un glossaire cohérent

## Du 19 au 22 septembre 2026 · la simplification

Paroles du porteur en discussion, du 19 au 22 septembre. Elles fondent la méthode de travail
d'aujourd'hui (`CLAUDE.md`) : la simplification du 19 septembre, puis le circuit brouillon–Ready de
#150.

### Simplifier le processus

> On est allé beaucoup trop loin. Il faut simplifier tout le processus. On retire tout le concept d'amorçage. On peut garder la garde mais elle ne doit pas alourdir trop, plutôt aider à ne pas dévier des documents fondateurs un projet (description, glossaire, catalogues). On va s'appuyer sur un processus de développement à 2 agents bien définis : l'auditeur et le codeur. On va mettre des instructions précises pour les cadrer afin de pouvoir avancer sur le projet et non pas sur des outils.

> On peut terminer les restructurations si elles aident et vont vers la simplicité

> 104 : l'ajout ou la modification d'une règle doit se faire en vérifiant (session auditeur) que ces modifications ne sont pas contraires ni aux autres, ni aux fondamentaux du projet

> 131 et 133 sont dûes au manque de crédit github. Il faut vraiment simplifier et réduire le coût CI.

### Le vocabulaire et les documents fondateurs

> Non, on retient compte principal et non compte pivot

> C'est un document HTML. Seul les md doivent être de la documentation fondatrice. Il faut réintégrer ce que ce document contient qui ne serait pas dans les doc fondateurs.

> Il faut refaire l'analyse du besoin avant d'analyser les solutions.

### Brouillon, Ready et validation

Le 21 septembre, dans #150.

> Oui, tout changement de la pr et issue revient en draft car l'analyse du besoin peut en être changé

> La CI devient simple : tout changement (édit, comment, commit) fait passer en draft

> Il faudra que le passage de Draft à Ready assemble une version web de dev

> non, depuis la pr avant commit mais une fois en Ready. On economise la CI en etant en Draft.

> Non. La garde peut être modifiée sans harnais (raison de l'abandon de l'amorçage). Seuls des cas complexes de test dans la garde pourraient nécessité un harnais dédié à la modification de la garde.
> Il ne faut pas confondre la vérification que le travail demandé est conforme aux attentes et ne contrevient pas aux fondamentaux, et la validation des modifications dont la responsabilité revient au porteur en passant une pr en ready

> Je en suis pas convaincu par une petite CI. Restons sur les tests locaux en mode auditeur/codeur

> Non, malgré la disparition de la case, si la description de la PR ou de l'issue change, il faut invalider tout validation er repasse en draft

> En ajoutant un commentaire pour indiquer le passage en draft pour nouvelle validation

> Il y a un problème de dénomination : une validation au sens précédent du terme était une action manuelle (quand nécessaire) de la part de l'auteur pour indiquer qu'il était d'accord avec les modifications de la pr, notamment quand celles xi touchaient la garde ou les fichiers gardés.
> Pour alléger le processus, je propose que l'action de validation soit le passage en ready d'une pr. Or, une fois ce passage en ready, qui déclenche la CI, il peut y avoir des modifications sur le fil de la PR (édition, commentaires, commit) ou de l'issue rattachée par "Close #ID". Je veux que n'importe quelles de ces modifications fasse repasser la pr en draft

### La place des harnais

La parole du 14 septembre (#58, #84), puis celle du 22 septembre qui la modère.

> Non, si un harnais peut être codé, il doit l'être

> il faut modéré le propos avec les evolutions méthodologiques récentes : « si un harnais peut être codé, il doit l'être » reste vrai pour le produit. La garde doit restée simple et peu couteuse et c'est le travers dans lequel nous sommes tombés précédemment. Bilan : beaucoup de temps perdu sur la création d'un outil dans l'outil. Au final, le concept reste bon, on doit en garder l'essentiel mais on doit réussir à juger ce qui mérite d'aller dans une garde de ce qui peut être vérifier par analyse de code. Dans tous les cas, les harnais de la garde (amorcage) n'ont plus leur place sauf si le codage du test allant dans la garde est complexe.

### Le besoin, pas la solution

Le 22 septembre, dans #170.

> on perd souvent du temps car l'analyse de l'auditeur est "trop" précise pour le codeur. Il faut que l'auditeur propose une analyse de besoin qui permette au codeur d'avoir son interprétation. C'est la confrontation des interprétations qui accelere le developpement, pas le forcage d'un agent par un autre

### Le coût de la CI et la stabilité

Le 22 septembre, dans #173, repris par #170.

> Il faut que le compromis reste bon entre coût de CI et stabilité du développement. Si sauter un test qui devient rouge après le merge oblige a relancer tout un tour de review/code, on est perdant. Mais si les tests sont trop lourds et lents, on n'avance pas

## 22 et 23 septembre 2026 · principes, cibles, invariants, validation

Paroles du porteur dans #162, #168, #175 et #176. Elles fondent les sections « Principes » et
« Usages » ci-dessus, le catalogue des cibles ([`cibles.md`](cibles.md)), la forme des invariants et
la validation par la fusion.

### Les principes

> Il faut en faire des points clairs, simples et explicites sous forme d'une liste. On peut les numéroter en esseyant de la faire par lien hiérarchique ou en tout cas des plus généraux aux plus précis

### Les invariants

> Oui, les invariants sont des valeurs mesurables auxquelles on doit pouvoir se référer pour valider une mesure

> Est-ce que les invariants ne devraient pas permettre de mesurer les regles plutôt que les principes ? Et les principes sont décliner en 1 ou plusieurs regles ? Ou est-ce trop complexe ?

> Alors faut-il des invariants pour les decisions ?

> Ok on part la dessus

> I5/I6 semblent optimistes, non ? Il faut peut-être acter un invariant plus lache et enregistrer la visée finale pour la suite ?

### Les cibles

> Afin de rester simple et efficace, et sachant que le nombre de cibles sera faible (webapp, relai seul, apk, iPhone), quelle solution faut-il privilégier pour gérer les cibles qui croisées aux usages et aux contraintes devraient permettre de déterminer des chantiers à atteindre

> Attention, il faudra sûrement faire une matrice de couverture mais tout ne doit pas être fait selon ce point de vue.

> Non, je valide cette construction

> non, traitons les navigateurs comme des cibles pour la webapp

### Le plan

> 1.1 : non, le plan peut soulever un risque à venir mais il est possible que la tirelire contienne de quoi payer. Le plan est établi sur le long terme. Il peut évoluer mais si des changements de fond se présentent. L'enregistrement d'une nouvelle dépense à une date "trop" proche pour être combler avertit l'utilisateur, qu'en plus des virements permanents à mettre en place sur la période complète, du montant non épargné par le manque de temps.

> le plan peut utiliser les informations des tirelires mais ne doit pas faire d'hypothèses. Seules les données réellement tracées doivent servir

> 9. un changement peut faire créer des tests rouges qu'il faudra traiter comme une dette de l'évolution

### La validation et l'aperçu

Dans #168, à la question d'un signal sans blocage plutôt que d'une protection payante : « 2 ». Puis :

> Mais je ne veux pas écrire validé alors qu'il me suffit de cliquer sur merge

Dans #175 :

> Mais je voulais que la CI d'une pr ne déploie pas automatiquement sur le FTP. Je voulais que ce déploiement soit nécessairement une action manuelle

> Une case dans la description ?

Dans #176, sur le retour du dépôt en privé :

> Non, le dépôt va repasser privé des que le quota sera revenu pour la CI

Puis, parmi les voies proposées, la troisième (identifiants FTP au niveau du dépôt, risque accepté) : « 3 ».

### La méthode

> Consigner dans une pr ne sert a rien, elle est fermée au merge

### Pendant le codage de #162

Réponses du porteur aux questions du codeur, le 23 septembre.

> La description est gardée normalement. La garde doit pouvoir constater un écart sur le fichier et donc possiblement les usages. pourquoi la garde aurait besoin de savoir lire les usages ?

> #Regle : Il ne faut dupliquer d'informations

> oui, le plan est un résultat. Le budget et les flux doivent nécessiter la validation de l'utilisateur.

> Non, l'auditeur est là pour vérifier que le besoin et les fondamentaux sont respectés par la codeur. Le codeur a sa compréhension sa besoin et peut demander des modifications du besoin (issue) au porteur pour clairifer un point qui n'a pas ete traté pas le codeur

> Les issues peuvent rester tant qu'elles sont en cohérences avec les catalogues. Elles servent à la gestion pratique du projet mais le projet doit tenir sans elles

### Décisions, méthodes et rôles

Paroles du porteur du 23 septembre, dans #162.

> I11, on rétabli. Pour ce que j'ai demandé pour les principes et les usages qui vont dans la description, il faut en faire un invariant, non ?

> Il faut stocker les regles de fonctionnement que j'ai pu enoncer dans le catalogue des regles. Mais il leur faut un invariants en face ?
> #Regle: le document CLAUDE.md n'est pas source de vérité. Il ne doit jamais contrevenir aux fondamentaux.

> Non, on reste dans la meme pr, on est en train de traiter les principes et les regles

> ~~En fait, je veux différencier les regles (fonctionnel), les decisions (projet) et les comportement (agent).~~

Les paroles qui corrigent le catalogue de règles séparé sont citées sous la parole du 13–14 septembre
qu'elles barrent.

> A moins que tu aies une bonne raison de garder séparée les decisions et méthodes

> Il faut ajouter un rôle : architecte qui analyse un besoin et défini ses spécifications. C'est aujourd'hui réalisé par la première phase de l'auditeur mais je voudrais que l'auditeur soit vraiment réduit à coder le harnais si nécessaire et vérifier le codage. L'analyse du besoin doit être indépendante.
> Pour le reste je valide les changements décidés maintenant qui vont engendrer un nouveau tour dans cette issue et pr

> Il faudra aussi modifier les instructions dans le projet Claude.la pour se référer aux roles

> En effet, il faut ajouter cette méthode au rôle de l'auditeur. Mais l'auditeur ajoute ses retours pour relancer un tour au codeur dans la PR si besoin.

### Les chantiers

> Les sous issues peuvent servir plusieurs chantiers ou aucun. Dans ce cas, il faut les tagguer en outillage, nouvelle fonctionnalité, idée, etc.

> Les chantiers doivent être définis dans docs/chantiers/ avec descriptifs des intentions globales, des contraintes, hypothèses, cibles, usages. C'est la seule vérité. Le système github a des tickets reflétant ces chantiers. L'architecte de chaque chantier sera en charge de définir les spec à partir du document (ça sera le produit de l'issue) et suivra l'évolution de toutes les sous issue permettant la réalisation du chantier. Les sous issues restent au niveau github (pas dans le document). Consigne ce fonctionnement dans le rôle de l'architecte et les decisions dans leur catalogue

> Ouvre une issue pour rédiger les documents définissant globalement les chantiers

> On écrit des lettres d'intention. On peut définir les cibles et usages et contraintes si elles font parties de l'intention. C'est la session architecte du chantier concerné qui fera l'analyse approfondie

> Je ne te demande pas d'écrire ces lettres, ça sera le codeur. Je te demande de définir 191 avec cette description

> Non, il s'agissait du chantier 3 et non 1

### Les versions

> je me demande s'il ne faut pas retravailler le découpage des chantiers pour qu'ils soient orientés par un usage x cible (la fin d'un chantier garantie l'usage décrit dans une cible). J'ai peur que le découpage actuel permette des choix qui ne prennent pas assez en compte l'ensemble des processus d'un usage. Mais en meme temps, si on oriente sur un usage, le risque est de faire des choix qui ne prennent pas assez en compte les autres usages. Propose des solutions en confrontant les gains avec les cout d'une restructuration projet.

> finalement, un usage sur une cible peut devenir une version.

> et C afin de dissocier le concept de Chantier du concept de Version (sinon, c'est la meme chose)

> il faut ensuite que les taches soient rattachées à des chantiers mais leur ordre de traitement est résolu au regard de la version qui regroupe les taches nécessaire pour y parvenir

### Le modèle de PR

> quand il ne faut editer que de la documentation, il n'est pas nécessaire de coder un harnais. Dans ce cas, c'est le codeur qui ouvre le PR. Or il ne respecte pas les formats (notamment le "Close ") donc les test sont rouges. Il faut corriger le role du codeur pour que l'auditeur et le codeur utilise le meme template de pr

### Les versions tirent le travail, les domaines l'organisent

> je n'aime pas notre découpage de chantier. Je pense qu'il faut découper les chantiers en bloc fonctionnel : budget / flux / operations / comptes / tirelire / categories / synchro / io / bilan / plan. Fais la liste exhaustive des bloc fonctionnel

> je voyais un découpage fonctionnel comme des workpackage d'un projet (appelé ici chantier), avec un besoin de cohérence entre les tache qu'il regroupe, et une approche de production tirée par les usages x cibles afin de choisir l'ordre de traitement

> mais est-ce utile et efficient ?

> ma crainte, et elle doit être confronter aux propositions, est qu'à se focaliser sur les versions (qui sont des usages), on oublie dans les choix des problématique pour d'autres usages. Mais peut etre est-ce la vie des versions : poser le probleme quand on augmente les fonctionnalités

> On se rapproche beaucoup de ce qu'on e j'avais construit avec les chantiers : 0 pour l'outillage, 1 pour la partie commune puis une déclinaison par usage. Mais ok pour simplifier en restant sur un découpage tirée par les usages et en commençant par un bl c commun permettant l'intégration des contraintes structurelles  de tous les usages et cibles

> Oui parfait

> Oui 1. Et comme tous les chantiers n'avaient pas été analysés, il faut prendre en compte les disparités de traitements. Certains domaines devront peut-être être documentés par la meme occasion

> Non, domaine est transverse et non un but ou une ligne d'une version. C'est une catégorie.

> Il faut de la cohérence globale du projet

> Il faut aussi prévoir un certain étalement des tâches. Il ne faut pas que la v0 soit énorme à coder sans avoir la possibilité de confronter les choix aux usages

> Ok

> la fin d'une version est le croisement d'une cible et d'un usage

> Non sinon elle se fermera avant d'être codé.

> En fait, si, elle doit être traitée dans le jalon v0 pour inclure ce qui doit être vérifié en attendant le codage réel

> oui, construit les versions jusqu'a v5.
> si tu analyses le contenue des issues, et au regard du changement de structuration du projet orientée "version", je pense que beaucoup d'issue peuvent aller dans des versions qui a l'époque du traitement de l'issue n'existaient pas (donc aucune référence)

## 25 septembre 2026 · les niveaux des tests

### Des niveaux de harnais

> il faut poser une methodo complémentaire au niveau des harnais pour réduire l'impact de leur temps d'éxecution. J'imagine 4 niveaux (à discuter) de harnais : ceux qui doivent tourner à chaque commit (toujours rapides, plutot dédiés à la tache en cours ou dont leur validation est importante en permacence), ceux qui doivent tourner à chaque merge (rapide aussi mais plus larges. Ils doivent assurer un premier niveau de retrocompatibilité et de conformité), ceux qui ne tournent que avant la prod pour etre plus complets sur la retrocompatibilité et enfin ceux hors CI qui servent lors du codage pour les besoins de vérification locales et qui peuvent être appelés quand on veut faire tourner la chaine de test complete (explicitement). Qu'en dis-tu ? Trop de niveau ?

> point 1 : ok
> point 2 : le découpage actuel dont tu parles est au niveau de la CI. Je parle moi d'un découpage inférieur au niveau des harnais eux-memes et de la suite de test (npm tests). les harnais de la garde ont un niveau commun 2. Mais il faut bien voir que pendant le dev d'un besoin, les harnais de ce besoin doivent pouvoir tourner quelques soit leur niveau pour que le codeur et l'auditeur puissent analyser le comportement du code

> il y a confusion. Un harnais porte plusieurs tests. Ce sont ces tests que je veux hierarchiser pour que l'execution d'un harnais soit variable en fonction du niveau de verification demandée

> quelle différence entre harnais de la garde et harnais du registre ?

> pour moi, même si leur cible de controle differe, ils servent le meme but : s'assurer que les principes et regles ne sont pas enfreints. Ils doivent être traités de la meme maniere. On peut cependant prévoir que certains tests de ces 2 type de harnais puissent etre de niveau 1 ou de niveau 3, meme si la majorité devra être de niveau 2

> ok. Les regles des harnais doivent être codées en harnais de la garde

> renome les niveaux de tests avec les usage des loglevel : DEBUG (diagnostic détaillé), INFO (événements normaux), WARN (problème potentiel), ERROR (erreur nécessitant une intervention) et FATAL (défaillance critique pouvant arrêter le système).

> c'est parfait, et l'outil de test prend le testlevel en input

### Le risque de ne pas jouer un test

> Attention, le temps d'execution d'un test NE PEUT PAS etre un critere de choix de sa severité. Si un test est necessaire à vérifier que l'app ne va pas terminer en FATAL, il doit être classé comme tel. C'est ensuite au porteur de proposer une solution pour éviter qu'il ne déborde en temps

> le critere de choix doit plutot etre défini comme présenté : on réfléchi la criticité du test comme la criticité d'un message de log

> c'est donc la similitude avec loglevel qui ne fonctionne pas. Il faut renommer les niveau de test pour mieux correspondre au besoin : il faut porter l'idée du risque de ne pas les jouer ces tests à un moment. Un test de niveau 0 est un test qui couvre un besoin avec un risque trop grave s'il n'est pas satisfait à tout moment (0 risque toléré), un test de niveau maximum est un test qui sert au debug (0 risque pris à ne pas le faire tourner). Est-ce que cette vision basée risque est plus appropriée ?

> mais ton classement traite du moment joué (que j'ai déjà proposé). Or on cherche un critère par niveau pour explicité le risque pris à ne pas jouer un test. Savoir quand on tolere ce risque est une autre question.

> j'ai peur que cette echelle ne ventile pas suffisamment les tests. vois ce qu'elle donne sur l'exitant

> on peut tester comme ça. Il faut un moyen assez fiable et reproductible de classer la crititicité d'un test au regard de son besoin. Ensuite, le niveau 4 n'existe pas car les auditeurs et codeur ne pouvaient pas enregistrer des tests dans les harnais sans qu'ils soient joués après à tous les coups.

> par définition, les tests de la garde et du registre sont 0 ou 1. Je ne vois pas de cas où un niveau supérieur serait nécessaire

> ready 1. L'auditeur aura fait tourner 2 avant. Livraison 2.

### Les tests de diagnostic

> on peut éditer les roles du codeur et de l'auditeur afin qu'ils puissent créer des tests necessaires au debug/analyse classifier comme tel. Il faut gérer la contradiction avec l'interdiction faite au codeur de lire le harnais. Propose une solution

> parfait

### Le coût de la CI

> 3. il faut limiter le cout CI. Peut-on prévoir 2 en pre-push ?

> attends, je ne suis pas sur de bien voir les etapes dans github. Dans une PR, on peut avoir plusieurs branches. Quel hook n'est joué que lors de la fusion de la PR sur [main] ou sur sa branche désignée, et pas quand des branches de la PR sont fusionnées dans la PR ?

> je souhaite pouvoir faire la différence entre les fusions manuelles et la CI sur github. le but étant de réduire le cout CI, on peut jouer sur les hook et sur les scripts CI pour garantir que tout sera bien joué avant d'arriver sur main

> ok

### La forme normale d'un harnais

Sur la proposition de l'auditeur de #197 de sortir les tests de niveau 0 et 1 d'un harnais dans un
fichier à part, que le registre citerait en entier, sans les instantanés ni la sonde de diagnostic :

> oui

### L'entrée du seuil

> non, le contrat par varieble d'environnement me semble mauvais

> pnpm test [N] où N est facultatif (2 par defaut comme avant). Attention, légère modification du besoin par l'architecte à prendre en compte

> les tests navigateur coutent tres cher, il faut une option dans pnpm test pour les activer dans 232

Sur le compte des tests navigateur écartés, juste sur ce qu'il mesure — fichiers et tests écrits —
plutôt qu'un nombre exact de tests engendrés, qui demanderait de lancer le navigateur :

> ok pour cette lecture
