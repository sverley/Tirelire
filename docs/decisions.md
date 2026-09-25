# Décisions

Les décisions du porteur, en deux parties, comme les principes de la
[description du projet](description-projet.md) : **le produit**, comment il est fait ; **le
travail**, la méthode et les rôles. Même autorité, même cohérence : une décision ne contrevient
jamais à un principe ni à une autre décision (principe 9.1), elle respecte les invariants
([`invariants.md`](invariants.md)) et les contraintes ([`contraintes.md`](contraintes.md)). Si un
besoin semble exiger le contraire, la question se pose d'abord dans une issue.

Chaque décision dit ce qu'elle implique, et pourquoi l'hypothèse qu'elle écarte ne tenait pas. Pour
en changer une, on l'amende : pas d'entrée qui en remplace une autre, pas de renvoi à ce qu'elle
remplace. Les identifiants sont ceux des entrées, sans date ; l'historique appartient à git. Les
numéros retirés ne se réemploient pas.

## Le produit

### D01 · Deux niveaux de comptabilité

Les **comptes** sont le réel bancaire (solde importé) ; les **tirelires** sont des sous-comptes
comptables hébergés sur un compte. Invariant : pour chaque compte, solde bancaire = somme des
tirelires hébergées + non affecté. Les soldes de tirelires ne sont jamais stockés, toujours
reconstruits (`balances.ts`).

### D02 · Période budgétaire de paie à paie

Le compte principal porte un `payDay` ; la période va de ce jour au jour précédent du mois suivant, nommée
d'après le mois qui contient son milieu (28 août → 27 septembre = « septembre »). `payDay = 1`
redonne le mois calendaire. Conséquence vérifiée par les tests : une échéance du 15 octobre a deux
virements devant elle (28 août et 28 septembre), donc le rattrapage se lisse sur deux périodes.

Ce que l'hypothèse du mois calendaire cachait : beaucoup de salaires tombent entre le 27 et le
dernier jour du mois, et les prélèvements du début de mois suivent. Un budget calé sur le mois civil
compte alors deux salaires certains mois, et zéro le mois suivant.

### D03 · Année budgétaire à date configurable

`settings.budgetYearStart = { month, day }`. Sert aux budgets annuels et aux bilans. Les provisions
gardent leur propre ancrage (`periodicity.anchorDate`), indépendant.

### D04 · Relevé du compte principal seul, comptes tiers saisis à la main

Seul le compte principal est importé au départ (les autres comptes peuvent l'être plus tard sans changer le
modèle : un compte passe de `third` à `holding`/`principal`). Un **compte tiers** est un compte réel
non importé ; ses opérations utiles au plan sont saisies à la main et créent un **solde à régler**
avec le compte principal, présenté comme virement ponctuel dans le plan (`settlementBalance`). Réglages par
compte tiers : seuil de règlement, sens autorisé.

Ce que l'hypothèse du relevé unique cachait : un budget placé sur un autre compte, avec sa propre
carte, dépense hors du relevé du principal ; et sans le relevé d'un livret, rien ne dit que le virement
est arrivé ni que l'échéance a été payée depuis le bon compte.

### D05 · Report des budgets au cas par cas

`tirelire.rollover` : `none` (remise à zéro), `unlimited`, `capped { months }`. Défaut proposé
dans l'interface : remise à zéro sur le compte principal, report ailleurs (l'argent y est physiquement).
Un budget hébergé sur le compte principal est « financé virtuellement » (réservation, pas de virement).

Ce que l'hypothèse de la remise à zéro cachait : deux philosophies. Budget strict, le non-dépensé
retourne au non affecté ; budget cumulatif, le reliquat reste dans la tirelire et le dépassement se
rattrape. Pour une tirelire hébergée ailleurs, seul le cumulatif est cohérent : l'argent est
physiquement là.

### D06 · Ordre de financement quand la marge est négative

Chaque tirelire a une `priority` (petit = financé d'abord ; défauts : provision 10, budget 20,
objectif 30). Les planchers (rattrapage d'une provision) sont servis avant tout le reste, puis le
demandé dans l'ordre des priorités. Le plan dit quelles lignes sont réduites ou non financées.

Ce que l'hypothèse « il y a toujours assez » cachait : le mois où les revenus ne couvrent pas les
charges, les provisions, l'épargne et les budgets, quelqu'un doit céder. L'épargne se décale ; une
échéance de provision, non.

### D07 · Application JavaScript portable : PWA Svelte + Capacitor

Un seul code : PWA (installable, servie comme fichiers statiques par un serveur privé) emballée
avec Capacitor pour Android. Cœur en TypeScript pur (`packages/core`) sans dépendance à
l'interface. Interface Svelte 5 (`apps/web`). Choix du framework jugé secondaire tant que le
cœur reste indépendant.

### D08 · Stockage : tables SQLite, un état

Les tables SQLite (sql.js en WebAssembly, persisté dans IndexedDB, exportable en un fichier)
sont la vérité, et le fichier n'est qu'un état : chaque ligne porte l'horloge de sa dernière
écriture, et rien ne garde ce qu'elle a remplacé (D58). Suppressions logiques (`deletedAt`) ; ce
qui se recalcule ne se stocke pas. Le journal d'événements comme stockage, les CRDT génériques et
la blockchain ont été examinés et écartés (`docs/synchronisation.md`).

### D09 · Deux familles d'identifiants

Opérations importées : clé déterministe `op_` + SHA-256(compte, date, montant, libellé
normalisé, rang parmi les identiques du jour) → identiques sur tous les appareils, fusion sans
conflit. Tout ce que l'utilisateur crée : UUID v7. Les exports bancaires n'ayant ni heure ni
identifiant de transaction, un **détecteur de doublons probables** (même compte, même montant,
±3 jours, libellé proche) compense les changements de libellé ou de date entre sources
(Linxo ↔ banque, attente ↔ comptabilisé).

Ce que l'hypothèse de l'import propre cachait : les exports bancaires se chevauchent, les libellés
changent d'un export à l'autre, certaines banques exportent les opérations en attente. Sans
déduplication, chaque import double les dépenses.

### D10 · Ventilation : lignes catégorie + tirelire

Une opération est ventilée en une ou plusieurs lignes (`Allocation`), chacune portant **une
catégorie et une tirelire** ; l'opération simple a une seule ligne. `allocation.amount` est
une part du montant de l'opération, dans son signe. Effet sur la tirelire : le montant pour une
dépense ou un revenu ; pour un virement interne, +montant côté compte hôte de la tirelire,
−montant côté compte de départ (`allocationEffect`).

Ce que l'hypothèse d'une catégorie par opération cachait : un passage en grande surface mêle
alimentation, vêtements et cadeau ; un virement à un livret alimente trois provisions à la fois.

### D11 · Un virement permanent par couple de comptes, libellé « TIRELIRE … »

Le plan propose un ordre permanent du compte principal vers chaque compte d'accueil qui héberge des
tirelires (D21), avec un libellé à recopier chez la banque, dérivé du nom du compte cible
(`transferLabel`). À l'import, une opération dont le libellé contient ce libellé est reconnue comme
un virement vers ce compte (`matchTirelireTransfers`), puis ventilée sur ses tirelires (D60).

### D12 · Pointage prudent

Un flux prévu est pointé automatiquement seulement si le montant est exact (ou dans la tolérance
avec libellé reconnu) et que le flux n'est pas marqué variable ; sinon c'est une proposition à
confirmer. Une occurrence d'un flux n'est pointée qu'une fois. Les flux dont la fenêtre est
passée sans opération remontent en « attendus, non reçus ».

Ce que l'hypothèse du pointage exact cachait : un prélèvement du 5 passe le 7 quand le 5 tombe un
samedi, une facture varie, un salaire varie avec les heures supplémentaires, et deux abonnements
peuvent avoir le même montant. Trop strict, rien n'est reconnu ; trop lâche, c'est la mauvaise
opération qui est pointée.

### D13 · Nom de code « Tirelire »

Une tirelire par objectif, chacune avec son solde. Le nom public se décidera plus tard.

### D16 · Synchronisation : protocole unique, transports interchangeables

`sync.ts` : hello / request / changes / done / bye. Chaque instance annonce au `hello` ce qu'elle
sait des autres ; l'autre lui envoie les lignes plus récentes (D58). Transports : fichier, direct
WebRTC à signalisation manuelle, relais privé chiffré (Node, ou PHP servi avec le site). Wi‑Fi
Direct et Bluetooth demanderaient un module natif Capacitor.

### D18 · Numéro de compte mémorisé sur le compte, indépendant du profil d'import

`Account.accountNumber` (facultatif, saisi dans le panneau Comptes ou mémorisé depuis l'import)
porte le numéro de compte ou l'IBAN, comparé après normalisation (espaces et ponctuation
retirés, casse uniforme) et tolérant qu'un export ne donne que les derniers chiffres
(`matchAccountByNumber`, `importer.ts`). À la lecture d'un fichier multi-comptes, une valeur de
la colonne compte qui correspond à un numéro déjà mémorisé pré-remplit la correspondance —
y compris avec un profil nouvellement détecté, contrairement à `profile.accountMap` qui ne vaut
que pour ce profil. Une case à cocher propose de mémoriser une nouvelle valeur sur le compte
choisi ; décision explicite, jamais un écrasement silencieux.

### D19 · Tirelire répartie sur plusieurs comptes

Une tirelire n'est plus hébergée par un compte : elle porte une **répartition par compte**,
reconstruite depuis les ventilations, jamais stockée. Deux invariants au lieu d'un : la somme des
composantes d'une tirelire fait son solde ; la somme des composantes portées par un compte plus
le non affecté fait le solde bancaire. Une composante peut être **négative** — une dépense consomme
la tirelire là où elle sort, même si l'argent dort ailleurs (taxe foncière prélevée sur le compte principal,
provisionnée sur le livret). Un virement interne au sein d'une même tirelire déplace une composante
vers une autre sans changer le solde. Remplace l'hébergement de D01 et de D05 : `balances.ts` rend
un vecteur, plus un scalaire, et `Tirelire.accountId` disparaît au profit d'un placement voulu (D20).

Ce que l'hypothèse « une tirelire vit sur un compte » cachait : une même réserve peut dormir sur
plusieurs comptes, et le suivi par objectif doit rester indépendant du compte qui héberge l'argent.

### D20 · Placement voulu et écart

Chaque tirelire déclare **où son argent devrait dormir**. L'écart entre position réelle et position
voulue produit des propositions de virement dans le plan : jamais une correction d'office, jamais un
blocage. Laisser un écart est légitime — un revenu arrive, on provisionnera plus tard — donc le plan
doit pouvoir présenter un écart comme « à surveiller » plutôt que « à faire ». Le compte principal est un lieu
de stockage comme un autre, à durée de séjour courte : aucune règle particulière ne lui est attachée.

### D21 · Virement groupé à ventilation prévue

Les écarts vers un même compte cible donnent un **virement permanent unique**, enregistré comme flux
attendu avec la ventilation que l'utilisateur a validée (D60). À l'import, la ligne bancaire est
reconnue par montant et libellé (D11), et sa ventilation proposée. Ce que les parts de cette
ventilation n'absorbent pas — montant constaté différent du prévu, permanent posé il y a six mois,
besoins qui ont bougé — se répartit par l'ordre de financement de D06, planchers d'abord puis
priorités, plutôt qu'un prorata qui saupoudrerait. L'écart retourne dans les positions de tirelires
et se représente au tour suivant.

### D22 · Trois états d'une opération, la vérité est ce qui est verrouillé

*Non traitée* (aucune règle ne l'a vue), *rapprochée* (classée par une règle, reprise à chaque
passage, malléable), *verrouillée* (plus aucune règle ne l'atteint). Est vérité — donc stocké et
synchronisé — ce qui est verrouillé. Toute modification manuelle d'une opération la verrouille :
c'est la modification qui change l'état, pas l'ouverture de l'éditeur. Seul l'utilisateur
déverrouille, à l'unité ou par action groupée (D26). Renomme le pointage de D12 en **rapprochement
de flux**, qui reste la mise en correspondance avec une échéance attendue et ne change aucun état
à lui seul ; les deux sens du mot ne doivent plus cohabiter dans le code ni dans l'interface.

Ce que l'hypothèse de la donnée propre cachait : une opération importée, une opération saisie et une
opération corrigée n'ont pas la même autorité ; sans état, la synchronisation écrase la correction
par l'import.

### D23 · Règles : sélection, action, rang

Une règle a une **sélection** (libellé, montant, compte, date, période de validité) et une **action**
dont chaque champ est facultatif : catégorie, tirelire, ventilation, état. L'état prend quatre
valeurs — *Verrouiller*, *Rapprocher*, *Ne rien faire*, *Déverrouiller* — la dernière indisponible
dans une règle. Défauts : *Rapprocher* pour une règle déterministe, *Ne rien faire* pour une règle
contextuelle ou bayésienne, *Verrouiller* pour une règle issue d'un flux du budget et portant toute
la classification. Le **rang** est l'index dans la liste ; les règles s'appliquent du rang le plus
élevé au rang 1, chaque champ renseigné écrasant la valeur posée par une règle moins prioritaire,
les champs vides laissant en place. Pas de détection de conflit : le rang tranche. Aperçu obligatoire
avant validation, montrant l'avant et l'après sur les opérations concernées. Les règles ne sont pas
de la vérité, ce sont des automatismes ; elles s'exportent avec leurs périodes de validité, ce qui
les rend rejouables dans l'ordre chronologique sur un historique importé. Conséquence à traiter dans
l'interface : avec *Ne rien faire*, une opération peut porter une classification tout en restant non
traitée — « rien dessus » et « quelque chose que personne n'a regardé » doivent se distinguer.

### D24 · Un flux peut engendrer une règle

Un flux prévu engendre optionnellement une règle déterministe. Modifier le flux **archive** la règle
en lui posant une fin de validité et en crée une nouvelle : les opérations déjà classées ne sont pas
réécrites, puisqu'aucune règle nouvelle ne les sélectionne.

### D25 · Abandon de l'année budgétaire

Remplace D03. Pour un particulier, le budget évolue au fil de la vie — salaire, activité en cours
d'année, achat, investissement — et aucune date d'arrêté n'a de sens. Les provisions gardent leur
ancrage propre (`periodicity.anchorDate`) ; les bilans se lisent sur un horizon glissant. Une
comparaison entre deux périodes doit signaler quand la profondeur d'historique disponible diffère,
plutôt que de laisser croire à une baisse de dépenses.

### D26 · Action groupée

Un filtre de recherche, une sélection ajustable à la main — tout sélectionner ou désélectionner sur
les opérations visibles, plus la sélection individuelle — et les mêmes actions qu'une règle **plus
*Déverrouiller***. Ne se conserve pas et ne se rejoue pas : seuls ses effets restent dans les
opérations. Aperçu avant application, avec l'avant et l'après. Chemin inverse également : une
sélection manuelle peut proposer un filtre qui tente de la reproduire, et donc engendrer une règle.
C'est la porte d'entrée vers les règles pour qui n'en écrirait jamais.

### D27 · Ventilation à parts, dont une part variable

Une ligne de ventilation porte un **montant fixe**, un **pourcentage** du montant de l'opération, ou
la part **variable** — calculée, égale au montant de l'opération moins les autres lignes. Toute
opération a par défaut une ligne unique variable, qui prend donc l'intégralité du montant ; ajouter
des lignes la réduit d'autant, jusqu'à zéro, jamais en négatif. Une seule ligne variable par
ventilation. La ventilation ne dépend que de l'opération : le rejeu reste déterministe même à montant
inconnu d'avance, donc un flux à montant variable peut engendrer une règle verrouillante. Une
ventilation qui dépendrait du contexte — solde d'une tirelire, état du plan — sort de ce cadre :
elle est une aide, et son résultat doit être figé sur l'opération au moment où il est produit.
Remplace la ventilation de D10, dont « une catégorie et une tirelire par ligne » reste valable.

### D28 · Tirelire sans type, besoins multiples

Une tirelire est un pot à **solde unique** portant un ou plusieurs **besoins** : récurrent (tant par
période, avec le report de D05), à échéance (un montant pour une date, rattrapage lissé sur les
virements restants), ou objectif (un montant sans date). Le besoin de financement de la période est
leur somme. Les priorités et planchers de D06 portent désormais sur les besoins, pas sur les
tirelires : une même tirelire « Charges » sert ainsi le plancher de la taxe foncière avant son
courant. Remplace la typologie provision / budget / objectif de D06, qui devient une typologie de
besoins, et `Tirelire.kind` disparaît. Le **regroupement de tirelires est écarté** : les totaux
passent par l'arbre des catégories, et le seul apport propre d'un groupe — arbitrer une masse commune
entre ses membres — s'obtient en fusionnant les tirelires plutôt qu'en les coiffant.

### D29 · Dotation calculée, virements neutres, report par libération

Précise D06, D19 et D20 et remplace la part de D05 sur le « financement virtuel ». Chaque besoin
(D28) est **doté** au début de chaque période de ce qu'il demande — croisière ou rattrapage —
sous forme de composante calculée sur le compte principal (ou sur le compte de placement s'il n'y a pas de
principal), jamais stockée. Un virement interne ventilé sur une tirelire **ne change pas son solde** :
il déplace une composante d'un compte vers un autre ; le solde ne bouge que par les dotations, les
revenus ventilés et les dépenses. Le financement par priorité de D06 devient une **lecture** : le
plan dit ce que les revenus de la période couvrent et signale les lignes réduites ; la dotation,
elle, est acquise, et le non affecté du compte principal dit si l'argent y est. Le report reste une propriété
de la tirelire (`rollover`) : en fin de période, pour `none` tout solde positif au-delà de la
réserve des besoins non récurrents (somme de leurs cibles) est **libéré** vers le non affecté du
compte de placement ; pour `capped` c'est ce qui dépasse la réserve plus N croisières. Libération
calculée, datée du dernier jour de la période, comptée comme composante négative. Les deux
invariants de D19 tiennent puisque dotations et libérations sont des composantes comme les autres.
Le solde d'une tirelire s'attribue à ses besoins dans l'ordre des priorités (un besoin à échéance
retient jusqu'à sa cible, un objectif jusqu'à la sienne, le récurrent prend le reste) ; un déficit
pèse sur le premier besoin récurrent avec report, sinon sur le premier besoin.

### D30 · Version du format, et ce qu'une version inconnue devient

Le fichier et chaque paquet de synchronisation portent leur format et sa version (D58). Une
version que l'application ne lit pas est refusée en le disant, sans rien ouvrir, écrire ni
effacer : l'utilisateur garde le fichier tel quel et choisit la suite (C1, C8). Une migration
s'écrit quand une version publiée l'exige, et seulement alors : elle lit l'ancienne version et
écrit la nouvelle, et une colonne retirée d'un format publié n'est plus lue qu'à cette occasion.
Tolérer l'écart entre deux instances de versions différentes se décide à part (C8).

### D31 · Rang d'une règle = clé triable

Précise D23. Le rang est stocké comme **chaîne triable** (`rank`, ordre lexicographique, générée
entre deux voisins à l'insertion ou au déplacement), pas comme index entier : deux appareils qui
réordonnent en même temps ne produisent pas de doublons destructeurs, et une égalité se tranche par
l'identifiant. L'interface montre une liste ordonnée, rang 1 en tête, sans exposer la clé. Les
règles s'appliquent de la fin de la liste vers le rang 1.

### D32 · Tirelire par défaut d'une catégorie

`Category.tirelireId` survit à D28 comme **tirelire par défaut** : quand une règle ou une action
pose une catégorie sans tirelire, la ventilation prend la tirelire par défaut de la catégorie. Ce
n'est qu'un raccourci de saisie, pas un lien comptable.

### D33 · Le moteur de règles part de ce que l'import a établi

D23 fait repartir les règles de zéro à chaque passage sur les opérations non verrouillées, pour
que retirer une règle défasse ce qu'elle avait posé. Mais le rapprochement de flux (D12, D22) et
l'appariement des virements internes ne sont pas des règles, et un moteur qui repart vraiment de
rien les efface aussitôt posés — le pipeline se défait lui-même.

Le calcul part donc de ce que l'import a établi : une opération rapprochée d'un flux ou appariée
en virement interne est *rapprochée*, avec la ventilation que cette étape lui a donnée ; les
autres partent vierges et non traitées. Les règles écrivent par-dessus, champ par champ, selon
D23. Retirer une règle rend l'opération à cet état d'import, pas à rien.

Conséquence : un flux qui engendre une règle (D24) et le rapprochement de ce même flux disent la
même chose, ce qui est cohérent — la règle verrouille et gagne, le rapprochement reste la trace
de l'échéance servie.

### D34 · Une classification que rien ne reproduit est verrouillée d'office à la migration

Corrige la migration 2 → 3 décidée au lot 2. Puisque le moteur de D23 recalcule tout ce qui n'est
pas verrouillé, une opération *rapprochée* que plus aucune règle ne sélectionne perd sa
classification au premier passage. C'est la conséquence assumée de D22 pour ce que les règles
produisent — mais l'historique d'avant D23 n'a pas été produit par des règles : il a été saisi.
Le laisser en *rapproché* ne le rendrait pas malléable, cela le détruirait.

À la migration, une opération qui portait une ventilation devient donc **verrouillée** : dans
l'ancien modèle, rien ne la reproduisait, elle était de la vérité de fait. Celles qui n'en
portaient pas gardent leur état de traitement. Verrouiller de trop se défait en une action groupée
(D26) ; effacer ne se défait pas.

Vaut pour la migration seule. Une opération classée par une règle après D23 reste rapprochée et
donc reprise à chaque passage, comme D22 le prévoit.
### D35 · Version « serveur web » = PWA statique + relais PHP sur hébergement mutualisé

Pour être utilisable depuis un hébergement web mutualisé (OVHcloud sans VPS : Apache, PHP,
pas de Node ni de processus persistant), l'application ne change pas de modèle : les données
restent sur les appareils (D08), le serveur ne fait que servir les fichiers de la PWA et
relayer des paquets chiffrés. `apps/hebergement` fournit `relais.php` (même contrat que
`apps/relay/server.mjs`, fichiers `.jsonl` sous verrou), `.htaccess`, `.ovhconfig` et un
assembleur qui construit la PWA avec un préfixe d'adresse (`vite --base`). L'adresse du site
est proposée d'office comme relais. Une version « serveur de vérité » (comptes utilisateurs,
base MySQL, logique côté serveur) a été écartée : elle contredirait D07/D08, imposerait une
authentification et retirerait le fonctionnement hors ligne. Livraison : archive jointe aux
releases, dépôt FTPS automatique si des secrets `OVH_FTP_*` existent.

### D36 · Le filtre de recherche est la sélection d'une règle

L'écran Opérations offrait un filtre pauvre (état, compte, période, texte libre) sans rapport avec
la sélection d'une règle, et proposait de *deviner* un filtre à partir des lignes cochées. C'est le
chemin le plus long vers une règle, et il part d'une approximation alors que l'utilisateur vient
d'exprimer exactement ce qu'il voulait.

Le filtre de recherche porte donc les champs de `RuleSelection` — motif de libellé, compte, montant
minimum et maximum, dates — et rien d'autre. Les critères propres à la consultation (état,
période courante) restent à côté et ne partent jamais dans une règle. Le bloc d'action porte les
champs de `RuleAction` et reste visible sans rien cocher.

Trois gestes en découlent, du même écran : appliquer aux lignes cochées, appliquer à tout ce que
le filtre retourne, ou en faire une règle — auquel cas le filtre est repris tel quel, sans
inférence. L'inférence de D26 sert le chemin inverse, quand on part de lignes cochées sans avoir
su écrire le filtre : elle propose un filtre, qui reste modifiable avant d'être enregistré.

### D37 · Dépôt du site par lftp, sans supprimer ce qui vit sur le serveur

Le dépôt sur l'hébergement (D35) se fait avec `lftp` dans `apps/hebergement/deposer.sh`, appelé
par la CI et utilisable à la main, plutôt qu'avec une action tierce : un seul outil pour FTPS et
SFTP, secrets qui ne sortent pas du script, comportement testable. Le script est vérifié contre
un vrai serveur FTP local (`deposer.test.mjs`). Deux règles : les fichiers d'entrée
(`index.html`, `sw.js`, `registerSW.js`, `manifest.webmanifest`) partent en dernier, pour qu'on
ne charge jamais une page pointant vers des ressources absentes ; `donnees/*.jsonl` et
`relais.config.php` sont exclus de l'envoi **et** du nettoyage, car ils appartiennent au serveur.
Le nettoyage des anciens fichiers est facultatif (`TIRELIRE_FTP_NETTOYER`) et désactivé par
défaut : un appareil pas encore rechargé demande encore les fragments de la version précédente.
Un aperçu de PR fait exception, et lui seul (`apercu.sh`) : son sous-dossier de recette se supprime
entier à la fermeture de la PR, paquets du relais compris, et seul un chemin
`<dossier>/pr-<numéro>` peut l'être ; la production ne change pas.
### D38 · Le placement voulu est une répartition, pas un compte

Corrige une simplification faite au lot 1 : D20 avait été implémentée avec un compte de placement
unique, ce qui contredit l'esprit de D19 — une tirelire est répartie sur plusieurs comptes, donc
elle doit pouvoir vouloir l'être.

Le placement est une liste de composantes voulues, une par compte, chacune portant une **part** au
sens de D27 : un montant fixe, un pourcentage du solde de la tirelire, ou le reste. Au plus une
composante « reste » ; en son absence, ce qui dépasse est réputé vouloir rester où il se trouve.
« 1 200 € sur le livret, le reste sur le compte principal » et « 70 % sur le livret, le reste sur le compte principal »
s'écrivent donc de la même façon qu'une ventilation.

Les mêmes règles qu'avant s'appliquent ensuite : l'écart entre position réelle et position voulue
nourrit le plan, « à faire » au-dessus du seuil, « à surveiller » en dessous, jamais corrigé
d'office. Une tirelire sans placement déclaré ne produit aucun écart : elle est bien là où elle est.

### D39 · Une règle s'appelle un automatisme, et se crée depuis la recherche

Le mot « règle » laissait croire à une contrainte ; ce sont des automatismes, qu'on ajoute et
retire sans cérémonie. Renommage dans l'interface comme dans le code (`Automation`, table
`automations`).

Conséquence directe de D36 : il n'y a pas d'un côté une recherche et de l'autre un formulaire
d'automatisme, mais un seul écran. On cherche avec les champs d'une sélection, on ajoute des
actions à appliquer à ce que la recherche retourne, on applique tout de suite si on veut, et
« Enregistrer » transforme le couple recherche + actions en automatisme. Créer un automatisme
n'est donc jamais un geste à part : c'est garder une recherche qu'on vient de faire.

### D40 · L'assistant construit un budget, il ne configure pas des objets

Le premier assistant reprenait les écrans de configuration étape par étape : créer un compte, puis
une tirelire, puis un besoin. Il demandait donc de connaître le modèle avant de pouvoir s'en
servir — exactement ce qu'un nouvel arrivant ne sait pas.

L'assistant pose désormais des questions de budget, et en déduit les objets. « Qu'est-ce qui rentre,
et quand ? » écrit le jour de paie et des flux de revenu ; « qu'est-ce qui part tout seul au même
montant ? » écrit des charges fixes ; « sur quoi voulez-vous vous tenir à un montant ? » écrit une
tirelire et un besoin récurrent ; « qu'est-ce qui ne tombe pas tous les mois ? » — le cœur du
sujet — écrit une tirelire, un besoin à échéance et le flux attendu à la date, en montrant tout de
suite le montant à mettre de côté par période. Les mots « tirelire », « besoin » et « flux » ne
sont jamais demandés à l'utilisateur, seulement expliqués.

Le **compte principal est créé en silence** à la première réponse : il existe toujours, le faire
saisir n'apprend rien. Les autres comptes sont **proposés en fin de parcours et jamais imposés** —
un budget entier tient sans eux (une tirelire sans placement déclaré ne produit aucun écart, D38).
S'ils existent, l'assistant demande seulement où chaque réserve devrait dormir, ce qui remplit le
placement de D38 sans exposer les parts.

L'assistant ne remplace pas les écrans de configuration : il amène à un budget qui se lit dans le
plan, puis renvoie vers Configuration pour ce qu'il ne couvre pas volontairement (besoins multiples
sur une tirelire, priorités, ventilations, catégories).

Deux ancrages sont imposés par le moteur et figés par `test/assistant.test.ts` : une tirelire est
ouverte au **début de la période en cours** (`tirelireTimeline` ne démarre qu'à la première période
entièrement postérieure à l'ouverture) et un flux est ancré sur sa **dernière occurrence déjà
passée** (`nextOccurrence` ne remonte jamais avant l'ancrage). Sans cela, un budget tout juste saisi
s'affiche vide, ce qui était le cas de la première version.

### D41 · Le compte pivot s'appelle le compte principal

« Pivot » décrivait un rôle dans un raisonnement comptable, pas un objet que quelqu'un possède.
Personne n'a de compte pivot ; tout le monde a un compte principal. Renommage partout où un humain
lit : interface, types, variables, commentaires, documentation (`AccountKind = 'principal'`,
`principalCushion`, `principalUnallocated`, avertissements `noPrincipal` et `principalOverdrawn`).

Le rôle ne change pas : c'est le compte par lequel tout transite, celui dont le relevé est importé,
celui qui porte le jour de paie (D02) et qui reçoit les dotations (D29). D04 reste vraie, avec le
mot corrigé.

Deux valeurs stockées portaient le mot — le genre du compte et la clé du coussin. La migration
5 → 6 les réécrit (`migrateTo6`), et la lecture accepte `pivot` comme synonyme de `principal`
pour qu'un appareil resté en arrière, qui réécrirait l'ancienne valeur, ne rende pas le compte
méconnaissable (D08, D30).

### D42 · Une enveloppe s'appelle une tirelire ; le stockage garde ses noms

Le mot « enveloppe » venait de la méthode budgétaire dont l'application s'inspire ; il ne disait rien
à qui découvrait l'écran, et l'application s'appelle déjà Tirelire (D13). Une tirelire, tout le monde
voit ce que c'est : on y met de côté, on la casse le jour venu. Renommage dans l'interface, les types
(`Tirelire`), les propriétés (`tirelireId`), les fonctions (`tirelireBalance`, `tirelireComponents`,
`tirelireTimeline`) et la documentation.

Ce que le mot désigne est inchangé : le pot à solde unique de D28, porteur de besoins, réparti sur
des comptes (D19) avec un placement voulu (D38).

En revanche **les noms de tables et de colonnes ne bougent pas** : la table reste `envelopes`, les
colonnes restent `envelope_id`. Le journal de changements porte ces noms (D08) ; les renommer
obligerait à déprécier et migrer chaque colonne (D30) et casserait la fusion avec un pair non migré,
pour un gain nul puisque personne ne les lit. `schema.ts` sépare donc explicitement la propriété
TypeScript du nom SQL (`cAs`), ce que le schéma permettait déjà sans que ce soit utilisé.

La règle générale qui en découle : **le domaine se renomme librement, le stockage ne se renomme que
s'il faut aussi changer la donnée.**

### D43 · L'assistant propose, et ce qu'il propose vient de l'exemple

D40 a remplacé les écrans de configuration par des questions, mais laissait devant chaque question un
formulaire vide. « Qu'est-ce qui ne tombe pas tous les mois ? » est une bonne question à laquelle on
ne répond bien qu'en voyant des réponses : on reconnaît sa taxe foncière dans une liste, on ne la
retrouve pas de mémoire devant un champ vide.

Chaque étape offre donc des **propositions** : touchez-en une, elle remplit le formulaire, que vous
corrigez avant d'ajouter. Rien n'est ajouté d'office, et ce qui a été ajouté reste **modifiable sur
place** — nom, montant, jour, date d'échéance, compte, report — sans passer par un écran d'édition.

Ces propositions n'ont **aucun contenu propre** : elles sont une lecture du jeu d'exemple
(`suggestions.ts` dérive `example.ts`, et `test/suggestions.test.ts` échoue si une proposition
apparaît ailleurs). Étoffer l'exemple — ce que le lot 8 prévoit déjà — enrichit l'assistant du même
geste, et les deux ne peuvent pas diverger. En contrepartie l'exemple porte une seconde
responsabilité : ses libellés sont lus par quelqu'un qui découvre l'application, et ses montants sont
les ordres de grandeur qu'on lui propose.

**Rouvrir l'assistant ne doit rien casser.** Les propositions ne s'offrent que sur un projet vierge —
aucune tirelire, aucun besoin, aucun flux, aucun compte en plus du principal. Les opérations ne
comptent pas : un relevé peut avoir été importé avant que le budget existe. L'état est figé à
l'ouverture de l'assistant, sinon la première ligne ajoutée ferait disparaître les propositions
suivantes. Dans le même esprit, la saisie du solde ne retouche pas la date d'ouverture du compte, qui
cale les soldes d'un compte déjà importé.

**Les comptes passent en tête du parcours**, juste après le principe. Ils restent facultatifs — tout
est réputé sur le compte principal si l'on passe l'étape — mais les déclarer d'abord permet ensuite
d'attribuer chaque revenu et chaque prélèvement au bon compte, ce qui était impossible quand
l'étape venait en dernier. La question du placement des réserves, elle, ne peut pas se poser avant
qu'il existe des réserves : elle a migré à l'inverse, vers le résumé.

**L'étape Comptes.** Elle expliquait longuement ce qu'elle allait faire au
lieu de le montrer. Trois corrections : le texte tient en deux phrases et dit ce que l'étape attend —
des **comptes bancaires réels**, ceux dont on reçoit un relevé, et non des catégories de budget ; le
**compte principal y apparaît**, matérialisé à l'arrivée sur l'étape plutôt que créé au premier
enregistrement, avec ses champs modifiables sur place (nom, banque, numéro ou IBAN, solde actuel), ce
qui rend inutile la question du solde posée plus loin ; et le bandeau de totaux du budget — revenus,
charges, reste à vivre — disparaît de cette étape, qui ne parle pas du budget.

### D44 · La date de paie appartient au flux ; le début de période est un choix

D02 faisait porter un `payDay` au compte principal. C'était deux erreurs en une.

D'abord, **un compte vit avec ou sans paie** : la date à laquelle un salaire tombe n'est pas une
propriété du compte qui le reçoit, et un foyer sans salaire n'en a pas moins un compte. Cette date
existe déjà, et au bon endroit : c'est l'ancrage de la périodicité du flux de revenu
(`PlannedFlow.periodicity.anchorDate`). La faire vivre une seconde fois sur le compte, c'était
inviter les deux à diverger.

Ensuite, **le découpage du budget est un choix d'analyse**, pas une conséquence mécanique de la paie.
On peut être payé le 28 et vouloir raisonner en mois calendaire, ou l'inverse. Le jour de début de
période devient donc le réglage `settings.periodStartDay` (défaut `1`, qui redonne le mois
calendaire), et l'écran Réglages l'expose avec sa raison d'être. L'assistant le **propose** à partir
du jour du plus gros revenu déclaré — « commencer au jour de ma paie » ou « suivre le mois
calendaire » — au lieu de le demander à froid avant que le moindre revenu existe.

Le vocabulaire suit : `payPeriodContaining` devient `budgetPeriodContaining`, et le paramètre
`payDay` devient `startDay` dans tout le cœur. La colonne `accounts.pay_day` reste déclarée et
dépréciée (D30) ; la migration 6 → 7 reprend la valeur du compte principal telle quelle, pour que les
périodes ne se décalent pas au premier lancement.

Remplace la partie de D02 qui situait le jour de paie sur le compte ; tout le reste de D02 — la
période de paie à paie, son nom pris au mois de son milieu, le lissage du rattrapage — est inchangé.

### D45 · Le genre d'un compte dit sa nature, pas comment on le remplit

`AccountKind` mélangeait deux choses : ce qu'est le compte, et la façon dont ses opérations y
entrent. `third` — « compte tiers, saisi à la main » — refusait de fait l'import à un compte, alors
que rien ne l'empêche : l'import sait déjà attribuer chaque ligne à un compte, soit par son numéro
(D18) soit par le compte choisi pour le fichier entier, et les deux existaient déjà dans l'écran
d'import, qui écartait pourtant ces comptes de ses listes.

Les genres deviennent donc `principal`, `courant` et `epargne` — trois natures de compte bancaire
réel. Ce qui relevait du comportement passe dans un drapeau indépendant, `tracksSettlement` : suivre
un solde à régler avec le compte principal (D04). Un compte joint peut ainsi être importé *et* porter
un solde à régler, ou l'un sans l'autre — combinaisons qu'un genre unique interdisait.

Dans l'interface, le choix du type se réduit à deux options sans texte d'aide (« Compte courant »,
« Épargne ») ; le suivi d'un solde à régler devient une case à cocher dans l'écran Comptes, avec ses
réglages de seuil et de sens. L'import ne filtre plus aucun compte.

Migration 7 → 8 : `third` devient `courant` avec `tracksSettlement`, `holding` devient `epargne`.

Corrige aussi une scorie de D42 : le renommage automatique avait laissé un identifiant de travail,
`tirelliresById_TMP`, mal orthographié et jamais rétabli. Il devient `tireliresById`. Le typage ne
pouvait pas le voir — il était cohérent partout — ce qui rappelle qu'un renommage mécanique demande
une relecture, pas seulement une compilation.

**Un remplacement muet.** Le passage à D45 a d'abord échoué en silence : le
`sed` de renommage ne visait que les apostrophes simples, si bien que les valeurs HTML
`<option value="holding">` et `value="third"` de l'assistant y ont survécu, et le remplacement de
texte censé les corriger n'a rien trouvé — sans rien signaler. Le typage ne pouvait pas le voir : une
valeur d'`<option>` est une chaîne comme une autre. L'écran restait donc en français d'avant et, plus
grave, écrivait des genres périmés.

Deux garde-fous en découlent. Le select de l'assistant est **engendré** à partir d'une liste typée
(`Array<Exclude<AccountKind, 'principal'>>`), comme le faisait déjà l'écran Comptes : renommer un
genre casse désormais la compilation. Et la lecture d'un compte **traduit les anciens genres**
(`pivot`, `holding`, `third`), comme D41 le faisait déjà pour le seul `pivot` — sauf en lecture
brute, sinon les migrations ne verraient plus la valeur qu'elles doivent interpréter.

### D46 · Des lignes déjà là, pas des pastilles à cliquer

D43 offrait les propositions sous forme de pastilles qui remplissaient un formulaire vide : il fallait
en toucher une, relire le formulaire, valider, recommencer. Un geste par ligne, pour un budget qui en
compte vingt.

Les raccourcis restent, mais **ils créent la ligne** au lieu de remplir un formulaire à valider. Et
sur un projet vierge, l'assistant les **applique tous d'entrée** : les lignes existent déjà à
l'arrivée sur l'étape, on corrige ce qui ne va pas et on supprime ce qui ne concerne pas le foyer.
C'est le mouvement naturel — reconnaître et retrancher — plutôt que se souvenir et saisir.

L'interface, elle, ne change pas d'un projet à l'autre : les raccourcis sont toujours offerts, et
chacun disparaît dès qu'une ligne du même nom existe. Sur un projet vierge ils sont donc tous
consommés d'emblée et la rangée est vide ; à la réouverture de l'assistant sur un budget existant,
il ne reste que ceux qui manquent — de quoi ajouter un oubli sans repartir de zéro. L'application
automatique n'a lieu qu'une fois par étape et par session : sans cette mémoire, tout supprimer les
ferait repousser au retour sur l'étape. Et elle ne concerne qu'un projet vierge au sens de D43, donc
un budget existant n'est jamais garni tout seul.

Chaque liste reçoit un **en-tête de colonnes** et un sous-titre ; les charges fixes n'en avaient
aucun, ce qui les faisait paraître étrangères aux revenus juste au-dessus. En-têtes et lignes
partagent la même grille CSS, faute de quoi ils se désalignent au premier changement de largeur.
Sous 640 px la grille se replie et l'en-tête s'efface, les champs portant alors leur propre libellé.

L'écran des comptes suit la même forme : une ligne par compte au lieu d'une carte à quatre champs
étiquetés, le type devenant un menu modifiable sur la ligne. Cinq comptes tenaient sur deux écrans ;
ils tiennent dans un tiers.

### D47 · Un rythme se compte dans l'unité qui lui convient

`Periodicity` ne connaissait que `intervalMonths`. Le mois va bien à un loyer ou à une taxe, mais
il ne sait pas dire « toutes les deux semaines » — or beaucoup de revenus tombent ainsi, et aucune
combinaison de mois entiers ne l'approche : quatorze jours ne sont pas un demi-mois, et l'écart
dérive de plusieurs jours en un an.

Le rythme devient donc `{ interval, unit, anchorDate }` avec `unit` parmi jour, semaine, mois et
année. `nextOccurrence` traite les deux familles séparément : jours et semaines par un quotient de
jours, puisque leur pas est de longueur fixe ; mois et années par le calendrier, en repartant
toujours de l'ancrage pour ne pas dériver quand un mois est plus court (31 → 30 → 30…).

Le lissage, lui, a besoin d'un équivalent en mois (`monthsOf`), forcément approché pour les jours
et les semaines. L'approximation est acceptable là où elle sert — répartir une dotation sur des
périodes — et n'est jamais employée pour dater une occurrence, qui reste du calendrier exact.

Dans l'interface, revenus et charges portent « tous les [N] [unité] », modifiable sur la ligne comme
le reste. Les tirelires gardent le mois : un besoin s'exprime naturellement par période budgétaire,
et rien ne demandait autre chose.

`intervalMonths` reste lu mais n'est plus jamais écrit (`stepOf`) ; la migration 8 → 9 convertit
besoins et flux. Un rythme envoyé par un appareil non migré garde donc son sens, ce qu'un test
vérifie.

### D48 · Une tirelire peut verser au budget au lieu de le consommer

Certains revenus tombent par à-coups sur trois ou quatre mois puis cessent — une saison touristique,
une récolte — alors que le foyer, lui, dépense toute l'année. Les prévoir comme des flux datés est
sans espoir : ni la date ni le montant de chaque encaissement ne sont connus. Et sans rien, le plan
annonce une marge énorme en août puis un déficit dix mois durant, pour un foyer qui va très bien.

C'est une tirelire à l'envers. L'argent arrive et s'affecte à une tirelire de saison, dont le solde
gonfle ; un besoin de genre **`payout`** en verse ensuite une part au budget à chaque période. Le
montant se déclare pour la périodicité — l'année, en général, parce que c'est ainsi qu'on raisonne
sur une saison — et se répartit sur les périodes.

Trois choix, pris pour éviter des pièges :

- Un **genre de besoin distinct**, pas un montant négatif sur un besoin ordinaire. Le négatif
  traverserait mal l'ordre de financement et le rattrapage, et rendrait tous les calculs ambigus.
- Le versement **apporte des fonds au lieu d'en demander** : `fundByPriority` écrête à zéro et ne
  saurait pas traiter une demande négative, donc les versements sont réglés à part et leur total
  s'ajoute à ce que les autres besoins se partagent. D'où leur priorité par défaut à `0`.
- Une réserve épuisée **avertit sans creuser** : on ne verse jamais plus que la tirelire ne porte,
  et le plan signale (`payoutShort`) que le rythme annoncé n'est plus tenu. Réduire le train de vie
  ou puiser ailleurs reste une décision du foyer, pas de l'application.

Le reste vient sans travail : le virement depuis un livret se propose déjà par l'écart de placement
(D20, D38), et le Bilan sait comparer une dotation à la réalité observée, donc le calibrage annuel
du versement se lit là où se lit déjà celui des provisions.

Les **intérêts d'un compte d'épargne ne relèvent pas de ce mécanisme**, malgré la ressemblance : ils
restent sur le compte au lieu d'alimenter le budget, et un livret ne s'épuise pas — l'avertissement
d'épuisement n'aurait aucun sens. Ce sont des opérations qu'on affecte à leur arrivée, et qu'on peut
anticiper, si on y tient, par un flux de revenu annuel `variable` sur le compte d'épargne.

**Ancrage des rythmes non mensuels.** Le quantième affiché sur une ligne suffisait tant que tout
était mensuel ; il ne dit pas dans quel mois tombe un revenu annuel ni un semestriel. La ligne montre
donc un quantième pour un rythme mensuel, et la date entière sinon — l'ancrage étant la première
occurrence, tout le reste s'en déduit — avec un rappel de la prochaine occurrence, qu'une date
d'ancrage seule ne donne pas.

### D49 · Un renflouement est un symptôme, pas un mouvement à ranger

Ramener de l'argent dans une tirelire est **par définition ce que le plan sert à éviter** : si tout
est correctement provisionné, l'argent n'a pas besoin d'être ramené. Un renflouement dit donc quelque
chose — la dotation était sous-évaluée, ou la dépense n'était pas prévue du tout. Le traiter comme un
simple virement à classer perdrait cette information ; le compter la rend exploitable.

Ce n'est ni un revenu ni un besoin : rien de nouveau côté flux. C'est une **qualification portée par
la ventilation** (`Allocation.replenishment`), qui distingue deux origines, parce qu'elles ne disent
pas la même chose : `internal`, l'argent était déjà chez nous et change de tirelire — la répartition
était mauvaise, le patrimoine est inchangé ; `external`, un cadeau, un remboursement, une vente — le
foyer a été sauvé du dehors, et le budget permanent ne peut pas compter dessus.

Deux usages en découlent.

**Le bilan les écarte de ses moyennes.** Sans cela un cadeau de 300 € gonflerait le revenu moyen et
un virement interne compterait deux fois, si bien que le renflouement masquerait le problème qu'il
révèle. Un test compare les moyennes avec et sans : elles doivent être identiques.

**Le bilan s'en sert pour proposer un réajustement.** Ce qu'il a fallu ramener, réparti sur la
fenêtre observée, mesure directement ce qui manquait à la dotation — plus directement qu'aucun autre
signal, puisque c'est le montant que la réalité a réclamé. `reviewReplenishments` le donne, et
l'écran Bilan l'affiche à côté de la dotation actuelle.

**Rien n'est corrigé d'office.** Un renflouement peut être un accident isolé qu'il ne faut surtout
pas inscrire dans le budget permanent ; distinguer l'accident du manque durable demande de savoir ce
qui s'est passé, ce que l'application ignore. Elle compte et propose, le foyer décide — c'est la même
ligne qu'en D06 et D29.

Reste à voir sur des données réelles si la distinction interne/externe mérite des traitements
différents dans le calibrage ; elle est enregistrée dès maintenant pour que l'historique existe le
jour où l'on tranchera.

### D50 · Un besoin a une période de validité

Un flux prévu sait déjà se dater (`activeFrom` / `activeTo`, D23, D24) ; un besoin, non. Or c'est le
besoin qui porte le budget, et un budget change au fil de la vie — c'est exactement ce que D25
constatait en abandonnant l'année budgétaire. Une provision pour charges se réajuste d'un montant à
l'autre au fil des régularisations ; un salaire change ; un enfant commence le piano et une ligne
apparaît en cours d'année ; un crédit se termine et sa ligne disparaît. Une reprise de données sur
plusieurs années en fait apparaître une poignée de versions successives, et il faut savoir les
distinguer.

Modifier le montant en place serait une **réécriture du passé**. D29 rend les dotations calculées et
jamais stockées : `tirelireTimeline` rejoue toutes les périodes depuis l'ouverture de la tirelire, si
bien qu'un montant changé aujourd'hui redoterait janvier de l'an dernier au montant d'aujourd'hui.
Les soldes de tirelires, les écarts de placement et les cibles du Bilan seraient tous recalculés
contre un budget qui n'était pas celui de la période. Une comparaison entre deux périodes n'aurait
plus de sens, ce que D25 demandait précisément d'éviter.

`Need.activeFrom` et `Need.activeTo` s'ajoutent donc, de même sens que sur un flux, bornes incluses.
Changer un budget, c'est **clore l'ancien besoin et en ouvrir un nouveau**, jamais éditer le montant.

Un besoin s'applique à une période s'il est en vigueur **le premier jour** de celle-ci — le jour où
la dotation est acquise (D29). Une seule date, pas un chevauchement au prorata : une dotation est un
tout, et un budget qui changerait en cours de période attend la suivante.

Conséquences dans le cœur : `tirelireTimeline` ne dote que les besoins actifs et ne calcule la
libération que sur eux ; la croisière qui borne la part permanente d'un virement (D21) ne compte que
les actifs ; `recurringPerPeriod` prend une date, sans quoi un budget clos l'an dernier servirait
encore de cible ; `reviewProvisions` restreint les échéances à la fenêtre de validité du besoin.
Aucune migration : un besoin sans dates est en vigueur depuis toujours, ce qui est le cas de tous
ceux déjà écrits.

Ce que cela ne couvre pas encore : l'interface n'expose pas ces dates, et l'assistant crée toujours
des besoins sans bornes. Tant que ce n'est pas fait, seule une reprise de données peut versionner un
budget — ce qui suffit au premier import, pas à l'usage courant.

### D51 · Les dates de validité se voient, et l'exemple les porte

D50 a donné aux besoins une période de validité, et se terminait en constatant ce qui manquait :
« l'interface n'expose pas ces dates », si bien que seule une reprise de données pouvait versionner
un budget. Une décision qui ne se voit pas dans l'interface n'est pas livrée. Cette entrée finit le
travail sur trois plans.

**L'écran Tirelires expose les dates et offre le geste.** Le formulaire d'un besoin porte
« en vigueur à partir du » et « jusqu'au », la description dit la période, et un besoin hors de sa
validité s'affiche en retrait avec une pastille — *clos* ou *à venir* — au lieu de se confondre avec
le budget du jour. Les besoins en vigueur remontent en tête de la tirelire.

Surtout, un bouton **Réviser** fait le geste de D50 en une fois : il clôt le besoin à la fin de la
période en cours, en ouvre une copie au début de la suivante, et ouvre l'éditeur sur celle-ci. La
coupure tombe à la frontière de période parce qu'une dotation est un tout (D29) ; laisser saisir la
date à la main invitait à couper au milieu, ce que le moteur arrondit ensuite sans le dire. Éditer
un montant en place reste possible — c'est le bon geste quand on corrige une faute de frappe — mais
ce n'est plus le geste offert.

**L'écran Flux dit la même chose des siens.** Les deux champs y existaient depuis D23 sans que la
liste montre jamais leur effet : un crédit terminé s'y lisait comme un crédit en cours.

**Le jeu d'exemple porte des changements datés.** Il n'en avait aucun : on ne pouvait donc ni voir
ni tester ce que produit un budget qui change, sinon en fabriquant des données à la main. Il en
porte maintenant six, choisis pour couvrir les quatre formes que prend un changement — une révision
déjà faite, une révision à venir, une ligne qui apparaît, une ligne qui s'arrête :

- *Divers et sorties* passé de 300 à 250 € au 28 août : la version close se lit encore et ne dote
  plus rien ;
- *Alimentation* de 900 à 950 € à partir de la période de novembre ;
- *Cours de piano*, besoin qui apparaît en novembre sur une tirelire qui n'en portait qu'un (D28) ;
- *Salaire* de 3 400 à 3 550 € à la paie de novembre (flux clos, successeur daté) ;
- *Crédit immobilier* dont la dernière échéance tombe le 5 décembre ;
- *Épargne de précaution* qui reprend la mensualité libérée, 300 → 800 €, à partir de janvier.

Tous sont placés **hors de la période en cours** : le plan du 6 septembre reste celui de l'analyse,
au centime près, et les tests qui l'encodent n'ont pas bougé. C'est en avançant de période en
période qu'on les voit prendre effet — ce que l'écran Plan permet déjà (deux périodes en arrière,
trois en avant). `test/exemple-dates.test.ts` fige ce qu'on doit voir à chaque période, et échoue
aussi bien si l'un de ces changements disparaît que s'il déborde sur la période en cours.

**Les propositions de l'assistant prennent une date.** L'exemple étant leur seule source (D43), il
porte désormais deux « Alimentation » et deux « Salaire » ; `budgetSuggestions(asOf)` ne retient que
la version en vigueur, sinon l'assistant offrirait deux lignes de même nom sans dire laquelle
prendre. Elles reprennent aussi le nom du besoin quand il en porte un, la tirelire ne suffisant plus
à les distinguer dès qu'elle en porte deux.

**Deux défauts trouvés en chemin, corrigés ici.**

`syncFlowAutomations` (D24) ne savait pas reconnaître la règle en cours d'un flux **daté** : elle
cherchait une règle sans `validTo`, or un flux qui porte `activeTo` en pose une dès la création.
Chaque passage créait donc une règle de plus au lieu de remplacer la précédente, et l'archivage
n'avait jamais lieu. Une règle est désormais en cours tant que sa fin de validité n'est que celle du
flux lui-même. Aucun test ne pouvait le voir : aucun flux de l'exemple n'était daté.

`replaceWith`, côté interface, écrivait les tables une par une et avait **oublié `needs`** ainsi que
`periodStartDay`. Charger l'exemple donnait donc des tirelires sans aucun besoin et un mois
calendaire à la place du 28 — le plan s'affichait vide, ce qui ne se voyait dans aucun test parce
que le test du dépôt écrit l'exemple avec sa propre boucle. La fonction parcourt maintenant
`LEDGER_KEYS`, et un test garde cette liste alignée sur le grand livre. Ajouter une table au modèle
ne peut plus laisser une de ces boucles en arrière ; c'est exactement le genre d'écart que le lot 9
(tests d'interface) est censé attraper, et qu'il attrapera mieux.

### D52 · Une période à venir suppose exécuté le plan des périodes précédentes

Précise D20 et D29. Le plan a maintenant deux dates : `asOf`, la période qu'on regarde, et
`today`, la date jusqu'à laquelle les soldes bancaires sont connus (par défaut `asOf`, donc
tout appelant à deux arguments garde le comportement d'avant ; l'interface y passe sa **date de
lecture**).

Jusqu'à `today`, les écarts de placement se lisent sur le réel : si un virement des mois passés
n'a pas été fait, l'argent est encore sur le compte principal et le plan doit le réclamer — c'est
la raison d'être du « complément exceptionnel » de D21. Au-delà, il n'y a plus de relevé à lire,
et le plan **suppose exécutés les virements qu'il a lui-même proposés** pour les périodes
précédentes (`plannedComponents`) : ce qui a été doté avant la période affichée est à son
placement voulu, seule la dotation de la période attend encore sur le compte de dotation.

Conséquence, et invariant tenu par les tests : pour une période donnée, ce qu'on vire vers un
compte d'accueil vaut exactement ce que les tirelires placées là demandent pour cette période,
moins le non affecté qu'on en rapatrie. Sans cela, le bloc « Virements à faire » recalculait
l'écart depuis la position réelle du jour — dotations des périodes antérieures comprises,
puisque rien ne les avait virées — pendant que le bloc « Tirelires » simulait période par
période. Les deux se contredisaient dès la période suivante et l'écart grossissait de période en
période (sur l'exemple : 700 € demandés contre 1 400 € virés en octobre, 550 € contre 1 950 € en
novembre, où une tirelire « en avance » ne demandait plus rien mais faisait toujours virer 300 €).

Côté interface, les deux dates cessent d'être la même variable. `app.asOf` est la date de lecture :
elle appartient à toute l'application, l'en-tête la montre, et c'est elle qui dit jusqu'où les
soldes sont connus. La période regardée n'est plus qu'un curseur de l'écran Plan : la parcourir ne
déplace plus la date de lecture de tous les écrans — ce qui, depuis que `main` prévient quand on ne
lit pas au jour même, affichait « lecture à une autre date » au moindre clic sur une période — et
la période où l'on lit s'affiche à la date de lecture plutôt qu'à son premier jour. Le jeu
d'exemple, daté de septembre 2026, se lit donc à sa date : ses périodes suivantes restent des
périodes à venir quelle que soit la date du jour.

Même raison pour ce qui se lit sur le réel — non affecté du compte principal, soldes à régler
des comptes tiers, surplus des comptes d'accueil : sur une période à venir, ils se lisent à la
dernière date connue, pas à une date inventée. L'alerte « le non affecté est négatif » ne se
déclenche donc plus sur une position simulée, où elle finissait par apparaître à toutes les
périodes lointaines. Projeter le solde du compte principal demanderait de dérouler revenus et
charges période après période : ce n'est pas ce que le plan fait, et il ne le prétend plus.

### D53 · Une échéance montre sa provision, et l'exemple garde ses besoins

Reprise du signalement « le jeu d'exemple ne contient aucun besoin ». Le défaut
principal n'existe plus : depuis D50 et D51, `example.ts` porte treize besoins, chacune des neuf
tirelires en a au moins un, et le plan de la période en cours demande 2 350 € pour 630 € de marge.
Rien n'était à corriger de ce côté. Restaient les deux points que le même signalement soulevait
en second, et qui tenaient toujours.

**La garde manquait.** Aucun test ne disait que l'exemple doit *démontrer* l'application ; ceux qui
existent vérifient le moteur, ligne par ligne et chiffre par chiffre, et passeraient tous si les
besoins disparaissaient à nouveau. `test/exemple-complet.test.ts` fige donc les propriétés que
l'exemple doit garder quoi qu'on retouche à ses montants : une tirelire ne reste pas muette, le plan
de la période en cours a des lignes et un total réservé non nul, les trois genres de besoin sont
représentés dont deux échéances, aucune tirelire en déficit n'est laissée sans rattrapage, et la
marge reste inférieure au demandé — au-delà, l'ordre de financement de D06 ne se voit plus.

**Le rattachement ne se voyait pas.** Une échéance a deux faces : le besoin qui la provisionne, sur
une tirelire, et le flux qui la paie le jour venu, sur un compte. Le modèle les relie depuis
toujours (`PlannedFlow.tirelireId`), mais l'écran Flux taisait la tirelire et l'écran Tirelires
ignorait le flux, si bien qu'une échéance sans provision se lisait comme une échéance provisionnée.
`needForDueDateFlow` et `dueDateFlowForNeed` font les deux lectures dans le cœur — par la tirelire,
sans identifiant supplémentaire, en retenant la version en vigueur à la date lue puisqu'une tirelire
porte plusieurs besoins (D28) et plusieurs versions du même (D50). Les deux écrans les affichent, et
disent aussi le manque : « aucune tirelire ne la provisionne », « aucun flux ne paie cette
échéance ».

Au passage, trois restes du renommage de D42 (« l'tirelire ») dans deux libellés d'interface et un
titre de test.
### D54 · Un nombre garde sa police, pas son insécabilité

La classe `.num` de l'interface faisait deux choses à la fois : donner aux chiffres la police à
chasse fixe et les tabular figures, et **interdire le retour à la ligne**. Le second rôle était
inutile et nuisible.

Inutile, parce qu'un montant est déjà insécable par sa seule écriture : `formatCents` sépare les
milliers par une espace fine insécable (U+202F) et pose une espace insécable (U+00A0) devant le
symbole. « 1 200,00 € » ne se coupe jamais tout seul, `white-space` ou non.

Nuisible, parce que `.num` n'habille pas que des montants isolés. Elle habille aussi des lignes
composées — « retenu 900,00 € · croisière 100,00 € · demandé 150,00 € » — que `.row .label .sub`
passe en `display: block` ; des libellés de virement (« TIRELIRE COMPTE DE MARIE ») ; des
identifiants d'appareil. Chacun devenait une boîte insécable plus large que l'écran. Le débordement
d'une boîte en `overflow: visible` remonte jusqu'à la zone défilable du document : sur un écran de
375 px, l'écran Plan de l'exemple mesurait 462 px. La barre d'onglets, en `position: fixed`, prend
sur mobile la largeur du bloc conteneur ainsi élargi ; ses cinq onglets s'étalaient sur 462 px et le
cinquième, « Plus », sortait de la fenêtre — toute la Configuration hors d'atteinte du doigt.

Désormais : `.num` ne porte que la police et les chiffres alignés, plus `overflow-wrap: anywhere`
pour qu'un identifiant sans espace se coupe au lieu de dépasser. Ce dernier point fait aussi tomber
la largeur minimale d'une colonne de nombres à un caractère : elle se laisse comprimer au lieu de
pousser la page.

Deux règles de ligne complètent l'affaire. `.row .label` reçoit la même coupure — sans elle, un mot
un peu long (« foncière ») dépassait de sa boîte comprimée et se superposait au montant voisin. Et
sa base flex passe de 0 à 50 % : avec une base nulle, un nombre composé (« 100,00 € + 50,00 € ce
mois ») prenait toute la largeur disponible et laissait littéralement 0 px au libellé.

Le tableau (`td.n`, `th.n`) garde son `white-space: nowrap` : il vit dans `.tbl`, qui défile
horizontalement pour lui seul et ne déborde donc sur personne.

**Garde** : `apps/web/test/mise-en-page.test.ts` construit le site, le sert, charge l'exemple dans
un vrai navigateur à 320 et 375 px et vérifie que `scrollWidth` ne dépasse pas `clientWidth`,
qu'aucun libellé ne recouvre le montant de sa ligne, et qu'aucun onglet ne sort de la fenêtre.
Le harnais est `puppeteer-core` sur un Chrome déjà installé plutôt que Playwright, qui télécharge
son propre navigateur : il n'y en avait pas moyen dans la session où le défaut a été corrigé. Le
test s'abstient faute de navigateur, sauf si `TIRELIRE_NAV_STRICT` est posé — ce que fait la CI,
pour qu'une garde muette ne passe pas pour une garde verte.

### D55 · Des seuils tactiles mesurés, pas relus

Un audit d'ergonomie relit des feuilles de style et donne un avis. Ces quatre-là se mesurent, donc
elles deviennent des gardes plutôt que des avis, dans le harnais posé par D54.

**Les seuils.** Une cible tactile fait au moins 44 px de côté — Material en demande 48, Apple 44 ;
on prend le moins-disant pour ne pas gonfler des listes déjà denses. Un bouton destructif se tient à
12 px au moins de son voisin : le pouce qui rate « Modifier » ne doit pas supprimer. Aucun texte ne
descend sous 12 px. Aucun texte courant ne descend sous 4,5:1 de contraste sur son fond effectif,
3:1 pour le grand texte, comme le prévoit le critère AA de WCAG 2.1. Et un champ qu'on vient
d'atteindre ne se retrouve pas sous une barre fixe : la garde le met au point, l'amène à l'écran
comme le navigateur le ferait, puis demande à `elementFromPoint` ce qui occupe son centre.

**Ce que les gardes ont trouvé.** Tous les boutons de liste faisaient 27 px de haut, le « × » de
suppression 33 px de large, le chevron de retour 15 px. Le gris des sous-titres — celui qui porte
« retenu · croisière · demandé », les dates, les libellés de compte — donnait 3,93:1 sur blanc. Les
pastilles, les onglets et les en-têtes de tableau étaient en 11 px. Les pastilles « rattrapage » et
« en avance » tombaient à 4,01:1 et 4,42:1 sur leur propre fond. Et deux champs du formulaire de
tirelire, sur un écran réduit à 380 px de haut comme le fait un clavier logiciel, restaient sous la
barre d'onglets après mise au point.

**Ce qui change.** `--muted` passe à `#5f6b65` (5,6:1), `--warn` à `#9e4722`, `--good` à `#2c7549`.
`.btn` reçoit 44 px de côté minimum, `.btn.small` le garde en restant plus étroit et plus petit de
texte. Les pastilles, onglets et en-têtes passent en 12 px. Les groupes de boutons de fin de ligne
prennent la classe `.actions`, dont l'écart passe de 8 à 12 px. `html` reçoit un
`scroll-padding` haut et bas, pour que tout défilement programmé — mise au point d'un champ,
ouverture d'un panneau d'édition — dépose sa cible entre les deux barres et non dessous ; le bas de
page leur réserve 76 px au lieu de 64.

**Ce que ces gardes ne mesurent pas**, faute de pouvoir le faire dans un navigateur de bureau : les
marges du bord à bord Android, le vrai clavier logiciel, le rendu des polices système, le sélecteur
de fichier. Cela reste à vérifier sur l'appareil.

La plomberie commune — trouver un navigateur, construire et servir le site, ouvrir l'exemple — passe
dans `apps/web/test/harnais.ts`, dont la garde de D54 se sert désormais aussi.

### D56 · Un écran de cartes se filtre par état

Trois écrans de Configuration listent des cartes : Comptes, Tirelires, Flux prévus. Depuis D50 et
D51, ces listes portent des lignes qui ne concernent pas le jour même — la version close d'un budget
révisé, son successeur daté, un crédit qui s'arrête en décembre, un besoin qui apparaît en novembre.
Elles se lisent en retrait, avec une pastille, mais elles occupent la place, et sur un téléphone la
place est ce qui manque : neuf tirelires portant chacune deux ou trois besoins font défiler
longtemps pour retrouver le budget d'aujourd'hui. Une liste qui grandit avec l'histoire du foyer ne
peut pas rester une liste qu'on parcourt en entier.

**L'état se calcule une fois, dans le cœur.** `activeAt` répondait par oui ou par non, ce qui suffit
au plan mais pas à l'affichage : « non » recouvre deux situations opposées, ce qui est fini et ce qui
n'a pas commencé. `validityState` rend donc `closed`, `active` ou `upcoming`, et `activeAt` s'écrit
sur elle. `stateShown` et `countStates` complètent le nécessaire du filtre. La pastille de D51
n'est plus un second calcul de dates dans l'interface : elle nomme l'état que le cœur a donné.

**Les comptes reçoivent les deux mêmes dates que les flux et les besoins.** Sans elles, le filtre
n'aurait rien à lire sur cet écran, et l'issue demandait les trois. Elles répondent surtout à un
geste réel que le modèle ne savait pas rendre : fermer un livret. La seule manière de le faire
sortir des listes était de le supprimer, ce qui emporte aussi son passé — or ses opérations tiennent
les soldes et les bilans des périodes où il vivait. Clore n'est pas supprimer : un compte clos garde
tout, il quitte seulement les listes et les menus du jour. `activeFrom` / `activeTo` ne se
confondent pas avec `openingDate`, qui date le solde initial : on commence souvent à suivre un
compte ouvert depuis dix ans.

**Une tirelire n'a pas de dates ; son état se lit sur ses besoins** (`tirelireValidityState`) : en
vigueur dès qu'un seul l'est, à venir si tous attendent, close si tous sont finis. Deux réserves,
qui toutes deux protègent contre l'oubli d'argent. Une tirelire au solde non nul reste en vigueur
quels que soient ses besoins — le dernier besoin s'éteint souvent avant que le pot soit vidé, et la
ranger dans les closes ferait disparaître de l'écran de l'argent qui existe. Une tirelire sans aucun
besoin reste en vigueur aussi : elle ne demande rien au plan, l'écran le dit déjà, mais rien ne
permet de la dire terminée.

**Un interrupteur par état, pas un choix unique, et le fini part rangé.** La lecture courante
demande deux états sur trois — ce qui vit et ce qui vient — qu'un choix exclusif aurait obligé à
atteindre par un « tout » ramenant aussi le passé. Chaque état a donc son bouton, indépendant des
autres : `active` et `upcoming` allumés au départ, `closed` éteint.

Masquer par défaut demandait de lever l'objection qui avait d'abord fait choisir « tout » : un écran
qui cache sans le dire se lit comme un écran cassé, et D51 venait justement de rendre lisible la
version close d'un budget révisé. La forme retenue y répond mieux qu'un défaut prudent — le bouton
d'un état masqué **reste affiché, éteint, avec son compte**. « Clos 1 » se voit, dit qu'une ligne est
rangée, et se rallume d'un doigt ; un menu déroulant sur « Tout » ne montrait rien de tel. La barre
apparaît donc dès qu'elle sert : plusieurs états représentés, ou un état représenté qui est masqué.
Sur un budget qui n'a rien de clos ni d'à venir, elle n'occupe aucune hauteur. Un état sans aucune
ligne n'a pas de bouton, et quand tout se trouve masqué la liste le dit et compte ce qu'elle range.

Les interrupteurs sont **propres à chaque écran** : ni réglage partagé, ni mémoire d'une visite à
l'autre. Comptes, Tirelires et Flux ne se lisent pas dans le même but, et un réglage global aurait
imposé à l'un ce que l'autre venait de demander.

Sur l'écran Tirelires, le filtre agit aux deux niveaux : une tirelire est retenue si son propre état
est allumé **ou** si l'un de ses besoins l'est, et seuls les besoins allumés s'affichent. Sans la
seconde branche, allumer « Clos » ne montrerait rien — le budget clos d'hier vit sur une tirelire
bien en vigueur. Quand le filtre vide une carte de ses besoins, la ligne le dit et compte ceux qu'il
range.

**Ce que la clôture d'un compte ne fait pas.** Le plan continue de calculer les écarts de placement
à partir des placements déclarés : il n'a pas appris à lire les dates d'un compte, et une tirelire
qui vise un compte clos produira donc encore un virement. Ajouter cette lecture au plan demanderait
de décider ce que devient l'argent qui y dort, ce qui est une autre décision. En attendant, deux
garde-fous d'interface : les menus ne proposent plus un compte clos — en gardant celui qu'une ligne
existante désigne déjà, sans quoi le menu s'ouvrirait vide et l'enregistrement suivant effacerait le
compte sans le dire — et la carte d'un compte clos affiche ce qui le retient encore : « compte clos,
encore désigné par : Vacances, Assurance habitation ».

**L'exemple porte le cas**, comme D51 l'a fait pour les dates de validité : un « Livret jeune »
clos le 30 juin, vidé, jamais désigné, donc sans un centime d'effet sur le plan — un test le
vérifie. Sans lui, l'écran Comptes de l'exemple n'aurait montré aucun filtre, et la fonction serait
restée invisible au chargement.

**Gardes.** `packages/core/test/etats.test.ts` fige les trois états et leurs bornes, les deux
réserves de l'état d'une tirelire, et le fait que l'exemple porte les trois états sur les trois
écrans. `apps/web/test/filtre-etat.test.ts` charge l'exemple dans un vrai navigateur à 375 px, va
sur chacun des trois écrans et vérifie l'état de départ des interrupteurs, que le clos part rangé
sans que son bouton disparaisse, et que chaque interrupteur montre ou masque ce qu'il annonce sans
toucher aux autres — même harnais que la garde de mise en page (D54), et même abstention faute de
Chrome, sauf en intégration continue.

### D57 · Deux sens de lecture, et le budget d'abord

L'application est **d'abord une aide à la construction d'un budget**, et doit rester entièrement
utile sans jamais importer un relevé. Le lien avec la banque vient ensuite, et sert à confronter le
budget au réel. Les deux sens de lecture sont de premier rang, aucun n'est un mode dégradé :

- **Sens descendant** — on décrit ce qu'on veut : des tirelires, leurs besoins, où leur argent doit
  dormir. L'application en **déduit** les flux, les dotations et les virements. Rien de tout cela ne
  se saisit à la main : ce sont des conséquences, recalculées quand le budget change.
- **Sens ascendant** — on importe ses opérations et on reconstruit le budget après coup, par
  analyse et constat : ce qu'on dépense vraiment, à quel rythme, sur quoi. L'application propose,
  l'utilisateur arbitre — les propositions ne deviennent jamais des décisions toutes seules.

Conséquence sur ce qui est stocké. Un flux **déclaré** (un salaire, un loyer, une échéance connue)
est un fait : il appartient à l'utilisateur, rien ne le réécrit. Un flux **dérivé** du budget (un
virement permanent) naît d'un calcul : ce que le budget demande se recalcule à chaque changement du
budget, et l'application signale ce qui a bougé, plutôt que d'attendre qu'on pense à appuyer sur un
bouton. Une fois sa mise en place validée, ce que l'utilisateur a posé chez sa banque et la
ventilation qu'il a choisie sont à lui : rien ne les réécrit, l'application en propose l'évolution
(D60, I10). Les deux sortes de flux doivent être distinguables dans le modèle comme à l'écran.

Ce qui se fige, c'est ce que la banque a fait — les opérations — et ce que l'utilisateur a validé,
jamais une photo de ce que le budget prévoit : une photo cesse d'être vraie sans que rien ne le
dise.

### D58 · Le fichier est un état : pas de journal, une horloge par ligne

Un journal de changements ne sert qu'à la synchronisation, et fait grossir le fichier avec les
gestes plutôt qu'avec les données : chaque reclassement s'y ajoute sans que rien ne s'efface, et
tout le fichier se réécrit dans IndexedDB à chaque correction. À l'usage projeté du domaine
(`docs/domaines/donnees-et-synchro.md`), c'est le poids du fichier qui compte, pas l'historique.

Le fichier SQLite est donc un **état** : les tables, plus une colonne `hlc` par ligne (horloge
logique hybride, qui porte l'appareil), `settings` compris. Fusion par ligne entière, la plus
récente gagne, `deleted_at` inclus. Synchronisation par delta d'état : chaque instance sait, pour
chaque autre, la plus grande horloge qu'elle en a vue ; au `hello` les pairs l'échangent, chacun
envoie les lignes plus récentes que ce que l'autre sait, et le relais entre appareils qui ne se
croisent pas est gratuit puisque l'état d'un pair contient ce qu'il a reçu des autres. Un paquet
déposé ou échangé par fichier dit aussi ce qu'il suppose connu : il n'apprend à qui le reçoit que ce
que celui-ci savait déjà compléter. Le protocole et les transports de D16 restent ; seul le contenu
des paquets change.

Une ligne modifiée des deux côtés sans que l'un ait vu la version de l'autre est un **conflit** :
les deux instances retiennent la même version, la plus récente, et la synchronisation qui le
détecte montre à l'utilisateur la ligne, la version retenue et l'écartée (I10, principe 4). Une
suppression contre une modification en est un. Le conflit est résolu sans être gardé, ni dans le
fichier ni à côté : c'est au protocole de ne pas en laisser passer un sans le montrer. Ce qu'on abandonne : l'historique des valeurs
remplacées — un « annuler » futur passera par un journal séparé, régénérable pour le présent, qui
ne touchera pas à ce format — et la preuve de chaîne, superflue pour un foyer sur relais chiffré.
La granularité par cellule a été chiffrée et écartée : elle alourdit chaque ligne pour des
conflits que l'usage ne produit pas.

Ce que la synchronisation exige du fichier, pour toutes les tables et sans structure propre à un
usage (I3) :

- **Une ligne a la même identité sur toutes les instances.** Une opération importée a celle de D09
  sur toute instance qui importe le même relevé sur le même compte ; le compte principal, qu'il naisse
  d'office ou par l'assistant, et les réglages ont la même partout.
- **Chaque écriture se date et se garde.** Chaque ligne porte l'horloge de sa dernière écriture et
  l'instance qui l'a faite ; une suppression est une écriture : rien d'une ligne synchronisable ne
  disparaît physiquement. Une ligne réécrite ne laisse rien d'elle dans le fichier.
- **Ce qui décrit une instance reste à l'instance.** Son identité, son horloge, ce qu'elle sait des
  autres, les secrets et curseurs du relais et ce qui ne concerne qu'elle ne voyagent ni par la
  synchronisation ni dans un fichier : l'application les garde à côté du fichier. Deux instances ouvertes depuis le même fichier sont deux
  instances, qui convergent sans perte ; un fichier restauré garde l'identité de l'instance qui le
  restaure, sans rien croire savoir de plus que ses lignes, si bien que synchroniser ne perd rien de
  ce que les autres ont reçu entre-temps.
- **Le format se dit.** Le fichier et chaque paquet portent leur format et sa version ; un format
  inconnu est refusé sans rien perdre ni écrire (D30, C8).

Le format d'état ne reprend pas celui du journal : le produit n'a pas encore d'utilisateur, et un
fichier au format du journal est refusé comme tout format inconnu. Le format parle le vocabulaire du
domaine : `envelopes` → `tirelires`, `envelope_id` → `tirelire_id` (D42), `makes_rule` →
`makes_automation` (D39), et les deux sens de `rank` se séparent ; les colonnes dépréciées et les
migrations disparaissent, `MODEL_VERSION` repart à 1. La clé d'une opération importée (D09) se
raccourcit à `op_` + 16 hexadécimaux. L'écriture par ligne entière autorise `NOT NULL` et `CHECK` ;
les références et les autres invariants sont vérifiés par une fonction du cœur, qui sert aussi à
l'ouverture d'un fichier étranger. Le format est documenté dans `docs/format-depot-sqlite.md` pour
pouvoir être fabriqué depuis l'extérieur.

### D59 · Un panneau d'édition nomme ce qu'il modifie, et un harnais garde la règle

Le correctif de placement avait laissé passer, sur les cinq écrans de Configuration, un formulaire écrit **avant** la
liste : il s'insérait en haut du document, quel que soit l'endroit d'où l'on venait de cliquer.
Mesuré sur la version en ligne : liste des tirelires déroulée jusqu'en bas (`scrollY = 1102`),
« Ajouter un besoin » sur la dernière tirelire ouvrait un panneau dont le
`getBoundingClientRect().top` valait −1133 px, sans que la page défile. Rien ne bougeait à l'écran :
le bouton passait pour mort. Le commit `00991be` a corrigé le placement en faisant de chaque
formulaire un `{#snippet}` rendu au point d'usage, attaché à sa ligne et ramené dans le champ de
vision par `revealed`. Cette entrée finit le travail sur les deux points qu'il laissait ouverts.

**Le panneau nomme ce qu'il modifie.** L'adjacence le suggère, elle ne le dit pas — et le panneau
des besoins affichait un simple `Besoin`, alors qu'une tirelire peut en porter plusieurs (D28) et
qu'on peut ouvrir le panneau depuis trois boutons différents. Chaque formulaire porte donc une ligne
de titre : « Ajouter un compte », « Modifier le compte — Carte enfants »,
« Modifier le besoin « Cours de piano » — Enfants et loisirs », « Réviser le besoin — … ». Le titre
est **figé à l'ouverture** plutôt que lu depuis le champ « Nom » du formulaire, sinon il suivrait la
frappe et se déferait à mesure qu'on corrige le nom.

**`apps/web` a un harnais de test.** Il n'en avait aucun ; le défaut a donc pu naître, être corrigé,
et pourrait renaître sans que rien ne l'attrape. Vitest et jsdom y entrent, avec trois tests sur
`revealed` (il amène le panneau au rendu suivant, en `block: 'nearest'` pour déplacer le moins
possible, sans animation quand le mouvement est réduit) et quinze tests de structure qui figent, sur
les cinq écrans, les trois conditions dont dépend la correction : le formulaire est un `{#snippet}`,
il porte `attached` et `use:revealed`, il porte un titre figé. Vérifié en remettant le
`Flows.svelte` d'avant la correction : les trois échouent.

**Ce que ce harnais ne fait pas.** jsdom exécute le code d'un composant mais ne met rien en page :
la garde est structurelle, jamais géométrique. Le rendu à 375 px, le débordement et la position
réelle d'un panneau se mesurent dans un navigateur. `main` sait le faire depuis D55 : `harnais.ts`
construit le site, le sert et le pilote. La mesure du panneau — ouvrir « Ajouter un besoin » sur la
dernière tirelire à 375 px et vérifier qu'il tombe dans la fenêtre — a sa place là, et reste à
écrire. Aucun composant n'étant monté ici, ce harnais n'a besoin ni du plugin Svelte ni d'un
environnement jsdom global : seul `revealed.test.ts` le demande, par son en-tête.

**Deux voies écartées, et pourquoi.** La *feuille modale* — le formulaire en superposition, avec
focus, Échap et retour exact au point de départ — traitait le même défaut plus rigoureusement, mais
elle cache la liste pendant la saisie : on ne corrige plus un montant en voyant ceux d'à côté. Elle
ajoutait aussi une couche dont le comportement avec le clavier virtuel d'Android n'était pas
vérifiable dans la session. L'édition sur place étant déjà fusionnée et éprouvée sur le téléphone,
la remplacer aurait coûté plus qu'elle ne rapportait. Le *focus automatique sur le premier champ*
est écarté pour la même raison de terrain : sur un téléphone, il ouvre le clavier au moment même où
`revealed` fait défiler, et les deux se battent pour la position de la page.

**Un doute levé.** Cette entrée a d'abord annoncé qu'Annuler ne ramenait pas d'où l'on était parti,
le panneau disparaissant et la suite de la liste remontant de sa hauteur. C'est faux, et l'usage l'a
tranché : le panneau s'ouvre *sous* sa ligne, donc tout ce qui est au-dessus — la ligne elle-même et
le bouton qu'on vient de presser — ne bouge pas d'un pixel à la fermeture. Seule la suite de la
liste remonte, et on ne la regardait pas. Il n'y a rien à corriger de ce côté.

### D60 · Deux montants pour un virement permanent, un seul se stocke

Applique D57 au virement permanent, le seul flux dérivé du budget.

Un ordre permanent porte deux montants de nature différente, et les confondre casse quelque chose
dans les deux sens :

- **Ce que le budget demande** est un calcul. Il ne se stocke pas — ce qui se recalcule ne se stocke
  jamais — il se relit à chaque lecture du plan (`PlanTransfer.permanent`). Rien n'est donc à mettre
  à jour, et aucun bouton n'est à penser à appuyer : un besoin ajouté, une échéance passée, une
  priorité changée se voient au tour suivant sans autre geste.
- **Ce que l'ordre exécute chez la banque** est un fait du monde réel. L'application ne peut ni le
  connaître ni le changer, et elle en a pourtant besoin — avec sa tolérance — pour reconnaître la
  ligne à l'import. C'est le seul des deux qui s'enregistre : le `amount` d'un `PlannedFlow` dont
  `origin` vaut `derived`.

Faire suivre le montant enregistré au budget aurait cassé la reconnaissance dès le mois où le budget
bouge, alors que l'ordre bancaire, lui, n'avait pas changé. Le bouton de l'écran Plan ne disparaît
donc pas : il change de sens. Il figeait un calcul, il **enregistre un fait** — « mon ordre vers le
Livret A est désormais à 700 € ». Le plan compare les deux : `PlanTransfer.bankOrder` porte le
montant enregistré et l'écart, et l'avertissement `bankOrderDrift` dit lequel est à aller changer,
et où. Le plan n'évolue que sur un changement de fond (principe 1.2) : un écart ne se propose que
s'il dépasse le pas d'arrondi des ordres (`settings.orderRounding`), dans un sens comme dans
l'autre ; un pas nul fait proposer tout écart. Un ordre que le budget ne demande plus est signalé
quel que soit son montant, plutôt que supprimé en douce : il continue de virer chez la banque tant
que personne n'y a touché.

**La ventilation de l'ordre est un choix de l'utilisateur**, enregistré avec l'ordre quand il en
valide la mise en place (principe 4.1). Elle s'écrit en parts, comme celle d'une opération (D27) :
une part **fixe** est un montant ; une part **flottante** est un pourcentage du montant viré, ou la
part variable, qui prend le reste, au plus une. L'application en propose une à la validation, que
l'utilisateur modifie librement. Les parts flottantes se recalculent sur le montant constaté ; une
part fixe ne suit pas le budget, et son écart avec ce que le budget demande pour sa tirelire se
propose comme celui du montant, au-delà du même pas, sans être réécrit (I10). À l'import, ce que les
parts n'absorbent pas se répartit par l'ordre de financement au jour de l'opération (D06, D21),
planchers d'abord (`distributeTransfer`, `matching.ts`) ; un ordre sans ventilation enregistrée se
répartit ainsi en entier. `PlannedFlow.plannedAllocation` reste une colonne dépréciée (D30) : ce
qu'elle figeait, des montants tirés du plan au moment de l'enregistrement, n'est pas une ventilation
choisie.

Un virement saisi à la main est un flux déclaré comme un autre : il n'est pas pris pour l'ordre
permanent, que le plan ne compare qu'à un flux dérivé, et rien ne le réécrit (D57).

Ce que le budget demande comme ordre permanent est **la somme des dotations mensuelles** des
tirelires placées sur ce compte, quoi qu'il ait déjà été viré dans la période — c'est un régime, pas
un reste à faire. Comparer l'ordre au reste à virer (`PlanTransfer.standing`) allumait l'alerte le
lendemain de chaque virement. Quatre cas s'en déduisent, et sont tenus par le harnais : un objectif
atteint sort de la somme (il ne demande plus rien, D06) ; une échéance déjà provisionnée y reste
(elle sera dépensée, l'épargne reprend juste après) ; un besoin versant (D48) n'y entre pas, il rend
de l'argent ; une tirelire placée sur deux comptes partage sa dotation entre eux (D19) au lieu de
l'exiger deux fois. Le rattrapage n'en fait jamais partie : un ordre permanent ne se règle pas sur
l'exceptionnel. L'écran l'affiche comme une somme, dépliable par « Détail » — c'est là que viendra
la division d'un virement en plusieurs ordres (issue #25).

Un ordre déjà enregistré garde son ancrage quand on corrige son montant : le déplacer ferait perdre
la reconnaissance des virements déjà passés. Un ordre nouveau s'ancre sur la période en cours, et
non sur celle qu'on regarde — le Plan se feuillette, et un ordre enregistré en lisant décembre vire
dès ce mois-ci.

Le jeu d'exemple porte l'ordre, et le porte **décalé** : la banque vire 600 €, le budget en demande
650, si bien que le plan du 6 septembre montre les deux montants côte à côte sans qu'on ait rien à
saisir — un ordre déjà juste n'aurait rien appris. L'écart grandit encore en janvier, quand
l'épargne de précaution reprend la mensualité du crédit (D51). Aucune opération ne lui correspond :
l'exemple n'importe aucun relevé, et lui en donner une retrancherait 600 € de ce que le plan
demande, alors que ce plan est celui de l'analyse au centime près.

Ce que cela ne couvre pas encore : l'application ne sait pas préparer l'ordre chez la banque
(virement SEPA, QR code), et l'assistant ne le propose pas encore.

## Le travail

### D77 · Les documents fondateurs, et ce qui fait foi

Les documents fondateurs : `docs/description-projet.md` (les paroles du porteur, ouvertes par ses
sections « Principes » et « Usages »), `docs/glossaire.md`, les catalogues — `docs/invariants.md`,
`docs/contraintes.md`, `docs/cibles.md`, `docs/decisions.md`, `docs/gardes.md` (le registre : chaque
invariant et chaque contrainte, avec son harnais ou sa vérification manuelle) — les documents des
domaines, `docs/domaines/`, le catalogue des versions, `docs/versions.md`, et les descriptifs des rôles, `docs/roles/`. Un document fondateur est
forcément un fichier Markdown de `docs/` : un document d'un autre format (HTML, par exemple) ne l'est jamais, et ce qu'il porte de fondateur se
reprend dans un Markdown. Tout Markdown de `docs/` n'est pas fondateur pour autant : la liste est
celle-ci.

La description fait foi (principe 7) : elle ne se reformule pas ; ce que le porteur y corrige est
daté, et ce qu'il retire reste barré. Les principes et les usages y vivent, dans leurs
sections dédiées, en listes numérotées du plus général au plus précis ; aucun autre document ne les
recopie. Les paroles conservées suivent le glossaire : quand un terme change, la citation est amendée
au terme nouveau, avec l'accord du porteur, demandé à chaque renommage.

Les documents fondateurs sont tels qu'ils sont : on ne les restructure pas ; on les corrige quand une
PR les touche, et seulement là. `CLAUDE.md` n'est pas source de vérité : il renvoie aux documents
fondateurs et ne contredit jamais les fondamentaux.

### D78 · Des ensembles cohérents, une information à un seul endroit

- **Une décision nouvelle s'écrit ici**, en une entrée, sans date ni renvoi à ce qu'elle remplace :
  on amende l'entrée ancienne. Qu'elle ne contredise ni les autres ni les fondamentaux se vérifie en
  relisant (architecte, auditeur) ; la garde n'en serait pas capable. Les tests qu'elle rougit
  suivent le principe 9.3.
- **Une information ne se duplique pas.** Elle vit à un seul endroit ; les autres y renvoient.
- **Le projet tient sans ses issues.** Elles servent à le conduire ; une issue reste ouverte tant
  qu'elle est cohérente avec les catalogues, et c'est le catalogue qui fait référence.
- **Une issue, une PR, une fusion.** Ce qui en déborde est une nouvelle issue, ouverte avant la
  fusion ; rien ne reste dans un fil qui va se fermer.
- **Pas d'outil nouveau sans issue produit qui l'exige.** Une PR qui n'améliore que la garde, les
  crochets ou la CI ne s'ouvre pas sans que le porteur l'ait demandée.

### D79 · Un invariant se prouve ; une décision n'en porte un que si sa valeur est permanente

Un invariant quantifie une mesure (principe 9.2) et se prouve par un harnais ou, quand aucun test ne
peut la trancher, par une vérification manuelle. Une décision ne porte un invariant que si elle pose
une valeur que tout le projet doit respecter en permanence ; sinon elle se prouve par ses tests (le
produit) ou par la relecture (le travail).

### D80 · Quatre rôles

Un besoin passe par quatre rôles, chacun décrit dans `docs/roles/`, en un texte qui sert de prompt :
l'**architecte** analyse le besoin et pose ses spécifications, et suit une version jusqu'à sa
publication sans spécifier ses tâches ; l'**auditeur** code le harnais s'il le faut et vérifie le
codage ; le **codeur** code ; le **porteur** valide. L'analyse du besoin est indépendante de
l'audit : l'architecte et l'auditeur sont deux sessions distinctes. Un descriptif de rôle dit ce que
le rôle fait, dans quel ordre ; il renvoie à ce catalogue pour les décisions qu'il applique.

### D81 · La garde

Un seul outil, `packages/gardes`, testé par des tests ordinaires dans `pnpm test`. Il vérifie trois
choses, et rien de plus :

1. chaque invariant et chaque contrainte a une entrée au registre, avec un harnais qui existe ou une
   vérification manuelle décrite ;
2. une PR qui modifie un document fondateur, ou un fichier qu'une entrée du registre nomme, a l'entrée
   déclarée dans la section « Invariants et contraintes » de l'issue qu'elle ferme (`Close #n`) ;
   sinon elle est rouge, et la garde nomme l'entrée manquante ;
3. chaque vérification manuelle des entrées déclarées figure dans cette section, sa consigne
   recopiée, sans case : la fusion vaut validation.

Il tourne en CI au passage en Ready de chaque PR, et à la demande en local
(`node packages/gardes/cli.mjs pr --issue <n>`, sur les fichiers modifiés depuis `origin/main`). En
CI, la garde qui juge est celle de `main`, avec le workflow de `main` ; ce qu'elle juge est le contenu
de la PR — registre, documents, fichiers modifiés —, qu'elle lit par git sans rien exécuter de la PR,
et la section de l'issue, lue par l'API avec le jeton du job, en lecture. Une PR qui modifie la garde
ne change donc pas son propre verdict ; ses tests, eux, jouent la garde qu'elle propose. Pas de
crochet lent, pas d'alerte.

Pour le produit, un harnais qui peut être codé doit l'être (principe 10). Pour la garde (principe
12), ce qui peut se vérifier par analyse de code — une relecture, une recherche — n'y va pas ; seul y
va ce qui le mérite. La documentation et la garde se modifient sans harnais par
défaut : l'auditeur vérifie en relisant. Un harnais dédié ne s'écrit que pour un cas de test complexe
dans la garde. Un changement de comportement de la garde est expliqué et justifié dans le compte
rendu du codeur : il nomme les tests de la garde de `main` qui rougissent avec la garde proposée, et
ceux qu'il modifie ; la validation du porteur le couvre.

### D82 · Vérifier, valider : brouillon, Ready, aperçu

Deux actes, qui ne se confondent pas : **la vérification**, par l'auditeur — le travail est conforme à
ce que l'issue demande, et ne contrevient ni aux autres entrées de son catalogue, ni aux
fondamentaux ; il l'écrit dans la PR — et **la validation**, par le porteur, par la fusion, sans
autre geste (principe 11). Rien ne la bloque techniquement (dépôt privé, offre gratuite) : c'est
au porteur de ne fusionner qu'au vert.

Une PR s'ouvre en brouillon, avec le corps du modèle `.github/pull_request_template.md` — `Close #n`
et la case de l'aperçu, rien d'autre —, qui que ce soit qui l'ouvre : l'auditeur, ou le codeur quand
le besoin n'a pas de harnais (D81). Une PR ouverte par l'API ne reçoit pas le modèle : il se
recopie. Le brouillon n'économise que la CI. Le porteur la passe en Ready à la main, ce qui lance
toute la CI et assemble la version de dev depuis le dernier commit de la branche. À côté du bouton
de fusion, le statut « Toute la CI sur ce commit » dit si toute la CI a tourné au vert sur le
dernier commit. Un changement après le Ready est signalé par un commentaire de la PR, sans rien
bloquer : un commit (la CI n'a pas tourné sur lui, le statut passe en échec, et le porteur repasse
la PR en brouillon puis en Ready pour la rejouer), une édition de la PR, hors cases cochées ou
décochées, ou une édition de l'issue qu'elle ferme. Les commentaires ne sont pas signalés.

**La case de l'aperçu** (#175). Rien n'est déposé sur la recette sans une action du porteur : il
coche, dans la description de la PR, la case « Aperçu du dernier commit en recette ». Le dépôt n'a
lieu que si la PR est prête et toute sa CI verte sur le dernier commit ; sinon la case se décoche et
un commentaire dit pourquoi ; de même si elle est cochée par un autre que le propriétaire du dépôt.
Cochée, elle dit que l'aperçu en ligne est celui du dernier commit. **Les agents ne cochent jamais
cette case**, et ne la décochent pas non plus : elle est au porteur et aux workflows.

### D83 · Crochets, CI et workflows

- **Crochets.** Une session commence, dans son propre clone, par `pnpm install && pnpm crochets`.
  `pnpm crochets` active les crochets suivis de `.githooks/` et pose `merge.ff false` ; les
  crochets joués sont ceux de la branche extraite, et `pnpm install` n'y touche pas.
- **En brouillon**, le codeur ne joue lui-même que `pnpm typecheck` et le harnais du besoin ;
  l'auditeur vérifie en local ce qu'il relit. Aucune CI ne tourne en brouillon. Les crochets font
  leur part, sur la copie de travail. Au commit, en moins de 5 s : les tests des paquets que touchent
  les fichiers indexés — cœur ; garde ; relais ; hébergement —, et rien pour la seule documentation.
  Au pré-commit, la non-régression bloque le commit ; le harnais du besoin (les fichiers de test que
  la branche ajoute ou modifie depuis sa base commune avec `origin/main`) est joué, et le pré-commit
  ne fait qu'en afficher le verdict, sans bloquer, sauf une erreur de syntaxe ; c'est la livraison
  qui le bloque. `--no-verify` est un contournement, qu'aucune consigne ne propose. À la livraison
  (pré-fusion et pré-push), sur l'état commis : la nature du besoin se lit par
  `packages/gardes/chemins-ignores` — fonctionnel (typecheck et tests headless des paquets touchés et
  de l'interface, 30 s) ou organisationnel (garde, 45 s) —, les tests navigateur
  (`apps/web/test/navigateur/`) restent à la CI, et le harnais du besoin est joué à part et bloque
  quand du code arrive.
- **La CI** ne joue qu'au passage en Ready d'une PR, une fois par passage, en mode strict, tous les
  harnais et la garde : typecheck, `pnpm test`, build, version de dev ; un outil manquant y fait
  échouer le job. Sept workflows : `ci.yml` (tests, version de dev, livraison), `validation.yml` (la
  garde), `apercu.yml` (attente et statut de toute la CI au Ready, retrait de l'aperçu),
  `depot-apercu.yml` (dépôt de l'aperçu quand le porteur coche sa case), `pret.yml` (les repères
  d'une PR prête, case de l'aperçu et étiquette « touche un workflow » comprises), `suivi.yml` (un
  changement après le Ready, signalé) et `fin.yml` (« en cours » quitte l'issue à sa fermeture).
- **Aucun job sauté ne peut laisser fusionner ce qu'un job joué aurait rougi.** Un rouge découvert
  après la fusion (#149) relance tout un tour de relecture et de code ; un job sauté qui ne décide pas
  de la fusion, et dont le rouge éventuel reste visible ailleurs, ne coûte rien et reste permis (les
  exécutions d'`apercu.yml` et de `depot-apercu.yml` en montrent). Ne rien sauter de ce qui décide de
  la fusion, ne pas alourdir ce qui n'en décide pas (principe 10.1).
- **Workflows.** Un agent ne crée ni ne modifie aucun workflow (`.github/workflows/`,
  `.github/actions/`), sauf quand l'issue le demande. Dépôt privé sur l'offre gratuite, les
  identifiants FTP sont au niveau du dépôt : un workflow qu'une branche ajoute les lit dès son premier
  `push`, avant toute PR (#176, risque accepté par le porteur). Au Ready, une PR qui en touche un
  porte l'étiquette « touche un workflow » (`pret.yml`).
- Un harnais joué en local ne lit que des fichiers suivis et ne sort pas de la machine : la boucle
  locale est permise, le reste fait échouer le lanceur. Chaque workflow situe ses jobs dans son
  en-tête : « lit des fichiers suivis », « lit hors des fichiers suivis » ou « hors harnais ».
- **Livraison.** Un push sur `main` construit et dépose le site. L'APK et les releases ne sortent
  qu'à un tag `v*` : le job le plus lourd ne tourne plus à chaque fusion. Un tag publie une version
  (D87) et porte son nom (`docs/versions.md`).

### D84 · Le code, les données et les commits

- Cœur (`packages/core`) sans dépendance à Svelte ni au navigateur ; tout calcul y est testé
  (vitest, `pnpm test`). L'interface (`apps/web`) ne fait qu'afficher et saisir.
- Montants en centimes entiers signés ; dates `AAAA-MM-JJ` ; `deletedAt` au lieu de supprimer ;
  jamais stocker ce qui se recalcule (soldes, plan, soldes à régler). Écritures locales uniquement
  via `LedgerStore.upsert/remove/setSetting`, qui datent la ligne entière (D58) ; ce qui vient d'une
  autre instance passe par `LedgerStore.receive`.
- **Aucune donnée bancaire réelle dans le dépôt.** Les fichiers bancaires servent à vérifier l'import
  en local et ne se versionnent jamais (`*.csv`, `*.sqlite` ignorés) ; exemples et tests sur données
  inventées.
- **Signature des APK de test** : `apps/web/android/keystore/tirelire-test.jks` (mot de passe
  `tirelire-test`) signe les APK de test, pour que les mises à jour s'installent par-dessus. Jamais
  pour un magasin ; des secrets `ANDROID_KEYSTORE_*` la remplacent en CI.
- Commits : un lot ou une décision par commit, message en français, corps explicatif.

### D85 · La langue, et la lecture sur téléphone

Français partout : code, commentaires, commits, interface, documents. Le porteur lit surtout sur
téléphone : réponses courtes, en prose, une question à la fois.

### D86 · Des domaines, des issues de conception

Un domaine est un bloc fonctionnel du produit : budget et tirelires ; plan et flux ; opérations ;
rapprochement et bilan ; données et synchro ; assistant et exemple ; application. C'est une
catégorie transverse des tâches : ni un but, ni une ligne d'une version, ni une unité de travail ; le
travail est tiré et ordonné par les versions (D87). Chaque tâche du produit
porte l'étiquette de son ou de ses domaines ; une tâche hors produit porte celle de sa nature
(« outillage », « nouvelle fonctionnalité », « idée »…).

Un domaine a un document dans `docs/domaines/` : son intention, avec les paroles du porteur qui la
fondent, et son analyse — contraintes, hypothèses, cibles, usages — quand elle existe. Il ne liste ni
tâches, ni ordre, ni état.

Une réflexion d'ensemble sur un domaine se mène dans une **issue de conception**, par un architecte,
en pensant aux cinq usages ; son produit va dans les décisions et dans l'analyse du domaine. Les
choix réversibles se reprennent au fil des versions ; les choix structurels, qui engagent tous les
usages et toutes les cibles, se posent avant, dans le socle (`v0`).

Chaque spécification porte une ligne « Usages » : ce que la tâche fait à U1, U2, U3, U4 et U5 —
sert, indifférent, ou à surveiller. C'est ce qui garde les autres usages dans le regard quand une
version en sert un seul.

### D87 · Une version : un usage garanti sur des cibles

Une version garantit un usage sur un ensemble de cibles ; elle naît d'une case « prioritaire » de la
matrice des cibles et se définit dans `docs/versions.md` : son usage, ses cibles, son critère de
fin, son tag. La fin d'une version d'usage est le croisement d'une cible et d'un usage : le parcours
de son usage (I3) vert sur chacune de ses cibles, et les vérifications manuelles du porteur ; le tag
de son nom la publie (D83). Une version livrée ne régresse pas : ce que son critère de fin tient
vert le reste à chaque PR.

Le socle ne garantit aucun usage : il intègre les contraintes structurelles de tous les usages et de
toutes les cibles actives — données, sauvegarde, synchronisation, versions d'instances,
distribution. Il s'étale en incréments, dont le premier est `v0` : un incrément ne contient que ce
qu'aucune version d'usage ne peut éviter d'avoir avant elle, et se place juste avant la première
version d'usage qui l'exerce, pour que ses choix se confrontent aussitôt à un usage réel. Une
contrainte structurelle se conçoit tôt, dans une issue de conception, pour ne fermer aucune porte ;
elle se code dans la première version qui l'exerce. Le socle est l'exception à la fin par le
croisement d'une cible et d'un usage : son entrée énumère ses contraintes, et son critère de fin
porte sur leurs harnais et vérifications manuelles, sur ses issues de conception, et sur ce qu'elles
demandent de vérifier en attendant le codage réel de ce qu'elles conçoivent.

Le travail est tiré par les versions : une tâche appartient au jalon de la version qui en a besoin,
quel que soit son domaine (D86), et son ordre de traitement se résout dans cette version. Sur GitHub,
un jalon du même nom que la version regroupe ces tâches ; son architecte les ordonne
(`docs/roles/architecte.md`, « Suivre une version »).
