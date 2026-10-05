# Décisions

Les décisions du porteur sur **le produit** : comment il est fait. Celles sur **le travail**, la
méthode et les rôles, sont dans [`methodes.md`](methodes.md), qui dit aussi ce qui vaut pour les
deux catalogues : leur autorité, leur cohérence, leurs identifiants communs.

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
virements devant elle (28 août et 28 septembre) : c'est sur ces deux périodes que se répartit un
lissage décidé (D88).

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
objectif 30). Les planchers (ce qu'une échéance demande, lissage décidé compris, D88) sont servis
avant tout le reste, puis le demandé dans l'ordre des priorités. Le plan dit quelles lignes sont
réduites ou non financées.

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

Opérations importées : clé déterministe `op_` + les 16 premiers hexadécimaux d'un SHA-256(compte,
date, montant, libellé normalisé, rang parmi les identiques du jour) → identiques sur tous les
appareils, fusion sans conflit. Le rang n'entre que dans la clé et ne se garde pas. Soixante-quatre
bits suffisent largement à l'usage projeté, un import par mois : sur cent mille opérations, le risque
que deux clés se confondent reste inférieur à un sur un milliard. Tout ce que l'utilisateur crée : UUID v7. Les exports bancaires n'ayant ni heure ni
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
confirmer. Ce que la sélection du flux ne reconnaît pas — son compte, son motif de libellé, sa
tolérance de montant, la fenêtre de ses occurrences (D24) — n'est ni pointé ni proposé. Une
occurrence d'un flux se désigne par son flux et sa date (D88), et n'est pointée qu'une fois. Les
flux dont la fenêtre est passée sans opération remontent en « attendus, non reçus ».

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
de flux**, qui reste la mise en correspondance avec une échéance attendue — une reprise, au sens de
D88, de l'opération prévue que désignent le flux et sa date — et ne change aucun état à lui seul ;
les deux sens du mot ne doivent plus cohabiter dans le code ni dans l'interface. Ce qu'un flux
reprend devient *rapproché* parce que le flux, un automatisme, le classe, et *verrouillé* si le flux
le demande (D24).

Ce que l'hypothèse de la donnée propre cachait : une opération importée, une opération saisie et une
opération corrigée n'ont pas la même autorité ; sans état, la synchronisation écrase la correction
par l'import.

### D23 · Règles : sélection, action, rang

Une règle a une **sélection** (libellé, montant, compte, date, période de validité) et une **action**
dont chaque champ est facultatif : catégorie, tirelire, ventilation, état. L'état prend quatre
valeurs — *Verrouiller*, *Rapprocher*, *Ne rien faire*, *Déverrouiller* — la dernière indisponible
dans une règle. Défauts : *Rapprocher* pour une règle déterministe, *Ne rien faire* pour une règle
contextuelle ou bayésienne ; un flux (D24) *Rapproche* ce qu'il reprend, et le *Verrouille* s'il le
demande, portant alors toute sa classification. Le **rang** est l'index dans la liste ; les règles
s'appliquent du rang le plus élevé au rang 1, chaque champ renseigné écrasant la valeur posée par
une règle moins prioritaire, les champs vides laissant en place. Pas de détection de conflit : le
rang tranche. Aperçu obligatoire avant validation, montrant l'avant et l'après sur les opérations concernées. Les règles ne sont pas
de la vérité, ce sont des automatismes ; elles s'exportent avec leurs périodes de validité, ce qui
les rend rejouables dans l'ordre chronologique sur un historique importé. Conséquence à traiter dans
l'interface : avec *Ne rien faire*, une opération peut porter une classification tout en restant non
traitée — « rien dessus » et « quelque chose que personne n'a regardé » doivent se distinguer.

### D24 · Un flux est un automatisme

Un flux prévu est un automatisme doté d'une récurrence (D88) : sa sélection, la seule — son compte,
son motif de libellé, sa tolérance de montant et la fenêtre de ses occurrences (D12) —, reconnaît
l'opération qui réalise chaque occurrence, qui la reprend ; ses actions, facultatives, la classent :
sa ventilation, que l'opération prend si elle n'en a pas, et le verrouillage, s'il le demande. Aucun
automatisme n'est engendré à part d'un flux : une opération que sa sélection ne reconnaît pas n'est
ni reprise ni classée par lui. Modifier le flux ne réécrit aucune opération déjà reprise : elle a
pris, en le reprenant, ce que le flux lui donnait, et le moteur d'automatismes repart de ce que la
reprise a établi (D33).

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
inconnu d'avance, donc un flux à montant variable peut classer et verrouiller ce qu'il reprend (D24).
Une ventilation qui dépendrait du contexte — solde d'une tirelire, état du plan — sort de ce cadre :
elle est une aide, et son résultat doit être figé sur l'opération au moment où il est produit.
Remplace la ventilation de D10, dont « une catégorie et une tirelire par ligne » reste valable.
Une ligne de ventilation est une sous-opération (D88), qui peut à son tour en contenir.

### D28 · Tirelire sans type, besoins multiples

Une tirelire est un pot à **solde unique** portant un ou plusieurs **besoins** : récurrent (tant par
période, avec le report de D05), à échéance (un montant pour une date ; ce qui ne sera pas réuni à
temps s'annonce comme un manque, et ne se lisse que sur décision de l'utilisateur, D88), ou objectif
(un montant sans date). Le besoin de financement de la période est
leur somme. Les priorités et planchers de D06 portent désormais sur les besoins, pas sur les
tirelires : une même tirelire « Charges » sert ainsi le plancher de la taxe foncière avant son
courant. Remplace la typologie provision / budget / objectif de D06, qui devient une typologie de
besoins, et `Tirelire.kind` disparaît. Le **regroupement de tirelires est écarté** : les totaux
passent par l'arbre des catégories, et le seul apport propre d'un groupe — arbitrer une masse commune
entre ses membres — s'obtient en fusionnant les tirelires plutôt qu'en les coiffant.

### D29 · Dotation calculée, virements neutres, report par libération

Précise D06, D19 et D20 et remplace la part de D05 sur le « financement virtuel ». Chaque besoin
(D28) est **doté** au début de chaque période de ce qu'il demande — sa croisière, plus la part d'un
lissage décidé (D88), ou le rattrapage d'un déficit —
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
effacer : l'utilisateur garde le fichier tel quel et choisit la suite (C1, C8).

La liberté du format vaut pour les bêtas (D91). Avant `v1`, la première version publique, une
version publiée peut refuser un fichier d'un format antérieur en le disant, sans migration : un
changement de format passe par une nouvelle version du format, l'ancienne est refusée comme une
version inconnue, et le code ne garde rien d'elle — ni colonne retirée, ni table laissée pour un pair
en arrière, ni étape de migration, ni synonyme d'une valeur ancienne. À partir de `v1`, toute
version lit les formats publiés depuis `v1` : un changement de format fournit une migration ou reste
rétrocompatible. Une migration s'écrit quand un format publié depuis `v1` l'exige, et seulement
alors : elle lit l'ancienne version et écrit la nouvelle, et une colonne retirée d'un tel format
n'est plus lue qu'à cette occasion. Tolérer l'écart entre deux instances de versions différentes se
décide à part (C8).

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

Le calcul part donc de ce que l'import a établi : une opération qui en reprend une autre (D88) ou
appariée en virement interne est *rapprochée*, avec la ventilation que cette étape lui a donnée ;
les autres partent vierges et non traitées. Les règles écrivent par-dessus, champ par champ, selon
D23. Retirer une règle rend l'opération à cet état d'import, pas à rien.

Conséquence : un flux n'a pas de règle à lui à côté de sa reprise (D24) ; ce qu'il reprend garde la
ventilation qu'il lui a donnée, et un flux qui verrouille le met hors d'atteinte des règles (D22).

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
et quand ? » prépare le jour de paie et des flux de revenu ; « qu'est-ce qui part tout seul au même
montant ? » prépare des charges fixes ; « sur quoi voulez-vous vous tenir à un montant ? » prépare une
tirelire et un besoin récurrent ; « qu'est-ce qui ne tombe pas tous les mois ? » — le cœur du
sujet — prépare une tirelire, un besoin à échéance et le flux attendu à la date, en montrant tout de
suite le montant à mettre de côté par période. Les mots « tirelire », « besoin » et « flux » ne
sont jamais demandés à l'utilisateur, seulement expliqués.

**L'assistant n'écrit dans le projet qu'à sa validation.** Ce qu'il montre — les propositions
présentes d'office, les lignes que l'utilisateur ajoute, corrige ou retire, les informations du compte
principal, les autres comptes, le placement des réserves — est préparé dans l'assistant, qui lit le
projet avec cette préparation dessus. Tant que l'assistant n'est pas validé, la base, les écrans
ordinaires, le plan et la synchronisation restent ce qu'ils étaient à son ouverture. Le résumé se
termine par une validation explicite, qui fait entrer dans le projet exactement ce que l'assistant
montre, en une seule suite d'écritures sans attente entre elles : l'application ne conserve le projet
qu'après la dernière, et une validation interrompue ne laisse pas une partie du budget sans le reste.
Quitter l'assistant sans valider n'enregistre rien : ce qui y est préparé s'y retrouve en y revenant
tant que l'application reste ouverte, et un rechargement ou une fermeture le perd. Le résumé le dit :
rien n'est enregistré avant la validation. C'est I10 dans l'assistant : le budget et les flux ne
changent que sur une validation de l'utilisateur.

Le **compte principal existe dès la naissance de la base**, même vide, avant tout assistant, sous la
même identité sur toutes les instances (D58) : l'assistant ne le crée pas, il en renseigne les
informations — nom, solde, date d'ouverture —, écrites avec le reste à la validation, et ce qui est
renseigné l'emporte sur le défaut à la synchronisation. Le faire saisir n'apprend rien. Les autres comptes sont **proposés en fin de parcours et jamais imposés** —
un budget entier tient sans eux (une tirelire sans placement déclaré ne produit aucun écart, D38).
S'ils existent, l'assistant demande où dort chaque tirelire, ce qui remplit le placement de D38
sans exposer les parts.

L'assistant ne remplace pas les écrans de configuration : une fois validé, il amène à un budget qui
se lit dans le plan, puis renvoie vers Configuration pour ce qu'il ne couvre pas volontairement (ventilations).
Il propose les besoins multiples d'une tirelire et les priorités de l'exemple, qui se modifient
ensuite dans Configuration, et les catégories de l'exemple, avec leur tirelire par défaut (D32) et les
flux qui les portent : une catégorie se garde sans tirelire (I3).

Deux ancrages sont imposés par le moteur et figés par `test/assistant.test.ts` : une tirelire est
ouverte au **début de la période en cours** (`tirelireTimeline` ne démarre qu'à la première période
entièrement postérieure à l'ouverture) et un flux est ancré sur sa **dernière occurrence déjà
passée** (`nextOccurrence` ne remonte jamais avant l'ancrage). Sans cela, un budget tout juste saisi
s'affiche vide, ce qui était le cas de la première version.

### D41 · Le compte pivot s'appelle le compte principal

« Pivot » décrivait un rôle dans un raisonnement comptable, pas un objet que quelqu'un possède.
Personne n'a de compte pivot ; tout le monde a un compte principal. Renommage partout où un humain
lit : interface, types, variables, commentaires, documentation (`AccountKind = 'principal'`,
`principalCushion`, `principalUnallocated`, avertissement `principalOverdrawn`). L'avertissement
d'absence de compte principal n'existe plus : le compte principal existe dans toute base (D40).

Le rôle ne change pas : c'est le compte par lequel tout transite, celui dont le relevé est importé,
celui qui porte le jour de paie (D02) et qui reçoit les dotations (D29). D04 reste vraie, avec le
mot corrigé.

Le fichier dit le même mot : le genre du compte vaut `principal` et le réglage du coussin
s'appelle `principalCushion`, sans autre valeur lue à leur place (D30, D58).

### D42 · Une enveloppe s'appelle une tirelire, jusque dans le stockage

Le mot « enveloppe » venait de la méthode budgétaire dont l'application s'inspire ; il ne disait rien
à qui découvrait l'écran, et l'application s'appelle déjà Tirelire (D13). Une tirelire, tout le monde
voit ce que c'est : on y met de côté, on la casse le jour venu. Renommage dans l'interface, les types
(`Tirelire`), les propriétés (`tirelireId`), les fonctions (`tirelireBalance`, `tirelireComponents`,
`tirelireTimeline`) et la documentation.

Ce que le mot désigne est inchangé : le pot à solde unique de D28, porteur de besoins, réparti sur
des comptes (D19) avec un placement voulu (D38).

Le stockage dit le même mot : la table `tirelires`, les colonnes `tirelire_id` (D58). Le nom d'une
colonne est celui de sa propriété, en snake_case, sans exception : un fichier se lit, et se fabrique
depuis l'extérieur, avec le vocabulaire de l'écran.

La règle générale qui en découle : **le stockage parle le vocabulaire du domaine.** Avant la
première version publiée, un renommage du domaine descend jusque dans le fichier, par une nouvelle
version du format (D30) ; après, il se pèse contre la migration qu'il demande.

### D43 · L'assistant propose, et ce qu'il propose vient de l'exemple

D40 a remplacé les écrans de configuration par des questions, mais laissait devant chaque question un
formulaire vide. « Qu'est-ce qui ne tombe pas tous les mois ? » est une bonne question à laquelle on
ne répond bien qu'en voyant des réponses : on reconnaît sa taxe foncière dans une liste, on ne la
retrouve pas de mémoire devant un champ vide.

Chaque étape offre donc des **propositions** : touchez-en une, elle remplit le formulaire, que vous
corrigez avant d'ajouter. Rien n'est ajouté d'office dans le projet (D40), et ce qui a été ajouté reste **modifiable sur
place** — nom, montant, jour, date d'échéance, compte, report — sans passer par un écran d'édition.

Ces propositions n'ont **aucun contenu propre** : elles sont une lecture du jeu d'exemple
(`suggestions.ts` dérive `example.ts`, et `test/suggestions.test.ts` échoue si une proposition
apparaît ailleurs). Étoffer l'exemple — ce que le lot 8 prévoit déjà — enrichit l'assistant du même
geste, et les deux ne peuvent pas diverger. En contrepartie l'exemple porte une seconde
responsabilité : ses libellés sont lus par quelqu'un qui découvre l'application, et ses montants sont
les ordres de grandeur qu'on lui propose.

**Les aides des champs viennent de l'exemple, comme les propositions.** Le texte qu'un champ vide
montre quand il propose une valeur — « Salaire », « 3 400,00 » — est la valeur de ce champ dans une
ligne de l'exemple : aucun écran ne l'écrit en dur. Dans l'assistant, toutes les aides d'un formulaire
d'ajout viennent d'une même ligne, celle que le premier raccourci restant de l'étape apporterait, à
défaut la première ligne de l'exemple de l'étape ; ajouter une ligne dont chaque champ porte la
valeur de son aide fait ce que fait le raccourci de cette ligne. Hors de l'assistant — Comptes,
Tirelires, Flux prévus, Catégories, Saisie —, les aides d'un formulaire viennent d'une même ligne de
l'exemple du même genre, et un champ que l'exemple ne renseigne pas n'a pas d'aide qui en invente une.
Un texte qui nomme le champ ou son formulaire sans proposer de valeur (« Nom du compte », « Banque »,
« FR76 … ») reste permis. Un test échoue si une aide qui propose une valeur n'est pas celle que
l'exemple désigne.

**Rouvrir l'assistant ne doit rien casser.** Les propositions ne s'offrent que sur un projet vierge —
aucune tirelire, aucun besoin, aucun flux, aucun compte en plus du principal. Les opérations ne
comptent pas : un relevé peut avoir été importé avant que le budget existe. L'état est figé à
l'ouverture de l'assistant, sinon la première ligne ajoutée ferait disparaître les propositions
suivantes. Sur un projet existant, l'assistant part de son contenu, et ce qu'il y change n'entre aussi
qu'à la validation (D40). Dans le même esprit, la saisie du solde ne retouche pas la date d'ouverture du compte, qui
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
calendaire » — au lieu de le demander à froid avant que le moindre revenu existe. Sur un projet
vierge (D43), il arrive d'office au jour de l'exemple, celui de son plus gros revenu — le salaire du
28 — dès son ouverture : les étapes qui datent du début de la période en cours, à commencer par les
comptes, le datent de la période qui commence ce jour-là, et « La période commence le » le montre à
l'étape des revenus. « Suivre le mois calendaire » reste proposé ; « commencer au jour de ma paie »
l'est dès que le jour du plus gros revenu n'est plus celui où la période commence.

Le vocabulaire suit : `payPeriodContaining` devient `budgetPeriodContaining`, et le paramètre
`payDay` devient `startDay` dans tout le cœur. Un compte ne porte aucun jour de paie.

Remplace la partie de D02 qui situait le jour de paie sur le compte ; tout le reste de D02 — la
période de paie à paie, son nom pris au mois de son milieu, les périodes sur lesquelles un lissage
décidé se répartit — est inchangé.

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
genre casse désormais la compilation. Et le fichier **refuse un genre hors de son énumération**
(D58) : une valeur périmée ne s'écrit plus, ni localement ni reçue d'une autre instance.

### D46 · Des lignes déjà là, pas des pastilles à cliquer

D43 offrait les propositions sous forme de pastilles qui remplissaient un formulaire vide : il fallait
en toucher une, relire le formulaire, valider, recommencer. Un geste par ligne, pour un budget qui en
compte vingt.

Les raccourcis restent, mais **ils créent la ligne** au lieu de remplir un formulaire à valider. Et
sur un projet vierge, l'assistant les **applique tous d'entrée** : les lignes sont déjà là, dans
l'assistant, à l'arrivée sur l'étape — elles n'entrent dans le projet qu'à la validation (D40) —, on
corrige ce qui ne va pas et on supprime ce qui ne concerne pas le foyer.
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

Répartir une dotation sur des périodes, en revanche, a besoin d'un équivalent en mois (`monthsOf`),
forcément approché pour les jours et les semaines. L'approximation est acceptable là où elle sert — répartir une dotation sur des
périodes — et n'est jamais employée pour dater une occurrence, qui reste du calendrier exact.

Dans l'interface, revenus et charges portent « tous les [N] [unité] », modifiable sur la ligne comme
le reste. Les tirelires gardent le mois : un besoin s'exprime naturellement par période budgétaire,
et rien ne demandait autre chose.

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
porte deux « Salaire » et deux « Alimentation ». Les flux — revenus et charges fixes — se proposent
avec **toutes leurs versions**, chacune avec ses dates : le salaire qui change se lit comme deux
lignes du même nom, chacune disant sa date de validité, et se retire une ligne à la fois ; un
raccourci apporte le flux avec toutes ses versions, et disparaît dès qu'un flux du même nom existe
(D46). Les besoins se proposent de même avec **toutes leurs versions**, chacune avec ses dates,
sous la tirelire qui les porte : l'alimentation qui change se lit comme deux lignes de cette
tirelire, chacune disant sa date de validité. Ils reprennent aussi le nom du besoin quand il en porte
un, la tirelire ne suffisant plus à les distinguer dès qu'elle en porte deux.

**Un défaut trouvé en chemin, corrigé ici.** `replaceWith`, côté interface, écrivait les tables une
par une et avait **oublié `needs`** ainsi que `periodStartDay`. Charger l'exemple donnait donc des
tirelires sans aucun besoin et un mois calendaire à la place du 28 — le plan s'affichait vide, ce
qui ne se voyait dans aucun test parce que le test du dépôt écrit l'exemple avec sa propre boucle. La fonction parcourt maintenant
`LEDGER_KEYS`, et un test garde cette liste alignée sur le grand livre. Ajouter une table au modèle
ne peut plus laisser une de ces boucles en arrière ; c'est exactement le genre d'écart que le lot 9
(tests d'interface) est censé attraper, et qu'il attrapera mieux.

### D52 · Une période à venir se lit en solde prévu

Précise D20 et D29 ; son calcul est celui de D88. Le plan a deux dates : `asOf`, la période qu'on
regarde, et `today`, la date jusqu'à laquelle les soldes bancaires sont connus (par défaut `asOf` ;
l'interface y passe sa **date de lecture**).

Jusqu'à `today`, les écarts de placement se lisent sur le réel : si un virement des mois passés n'a
pas été fait, l'argent est encore sur le compte principal et le plan doit le réclamer — c'est la
raison d'être du « complément exceptionnel » de D21. Au-delà, le plan montre le **solde prévu** des
comptes et des tirelires (D88) : le réel à la date de lecture, plus les opérations saisies à une
date future et les opérations prévues qui comptent jusque-là, chacune affichée avec son origine. Il
ne suppose rien (principe 1.3) : une opération prévue se calcule depuis un flux enregistré et se
montre comme prévue (D88). Il dit aussi ce que chaque tirelire
demande pour la période — sa dotation (D29) — et ce qu'il faut virer pour elle : cette dotation,
répartie comme son placement la veut (`periodDemand`), calculée sur le seul solde de la tirelire,
qui ne dépend d'aucun virement (D29).

Invariant tenu par les tests : pour une période à venir, ce qu'on vire vers un compte d'accueil vaut
exactement ce que les tirelires placées là demandent pour cette période ; dans la période où l'on
lit, moins le non affecté qu'on en rapatrie. Sans lui, le bloc « Virements à faire » recalculerait
l'écart depuis la position réelle du jour pendant que le bloc « Tirelires » simulerait période par
période, et les deux se contrediraient dès la période suivante (sur l'exemple : 700 € demandés contre
1 400 € virés en octobre). Aucun virement n'est tenu pour exécuté sans le dire : un virement permanent
enregistré compte à sa date parce que son flux le prévoit, se montre comme une opération prévue, et,
sur un compte suivi, cesse de compter s'il n'arrive pas dans sa fenêtre (D12, D88).

La question « ce virement a-t-il eu lieu ? » se lit sur les opérations : une opération prévue est
reprise par l'opération bancaire qui la réalise, attendue dans sa fenêtre, ou attendue non reçue
(D12), et le plan de sa période la montre. Sans suivi des opérations (U1), rien ne se confronte : les
opérations prévues comptent à leur date, et rien n'est dit manquant. Commencer à importer n'ajoute
que ces lectures du réel ; ni les besoins, ni les virements permanents proposés ne changent.

Côté interface, les deux dates cessent d'être la même variable. `app.asOf` est la date de lecture :
elle appartient à toute l'application, l'en-tête la montre, et c'est elle qui dit jusqu'où les
soldes sont connus. La période regardée n'est plus qu'un curseur de l'écran Plan : la parcourir ne
déplace plus la date de lecture de tous les écrans — ce qui, depuis que `main` prévient quand on ne
lit pas au jour même, affichait « lecture à une autre date » au moindre clic sur une période — et la
période où l'on lit s'affiche à la date de lecture plutôt qu'à son premier jour. Le jeu d'exemple,
daté de septembre 2026, se lit donc à sa date : ses périodes suivantes restent des périodes à venir
quelle que soit la date du jour.

Ce qui se lit sur le réel — non affecté du compte principal, soldes à régler des comptes tiers,
surplus des comptes d'accueil — se lit dans la période où l'on lit, à la date de lecture. Pour une
période à venir, c'est le solde prévu qui parle : un solde prévu négatif est un **manque** (D88), sur
un compte comme sur une tirelire.

### D53 · Une échéance montre sa provision, et l'exemple garde ses besoins

Reprise du signalement « le jeu d'exemple ne contient aucun besoin ». Le défaut
principal n'existe plus : depuis D50 et D51, chaque tirelire de `example.ts` porte au moins un besoin, et la marge du
plan de la période en cours est positive, mais inférieure à ce qu'il demande (`exemple-complet.test.ts`).
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

Un audit d'ergonomie relit des feuilles de style et donne un avis. Ces cinq-là se mesurent, donc
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
  sur toute instance qui importe le même relevé sur le même compte ; le compte principal, qui naît
  d'office avec toute base (D40), et les réglages ont la même partout.
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
domaine : la table `tirelires` et les colonnes `tirelire_id` (D42), la table `automations` (D39) ; aucun
nom de table ni de colonne ne dit « enveloppe » ni « règle », et un même nom désigne la même chose
d'une table à l'autre — `rank` n'est que la clé triable d'un automatisme (D31). Il ne porte ni
colonne dépréciée, ni table laissée pour un pair en arrière, ni version du modèle à côté de celle du
format : `FORMAT_VERSION` seule dit le format, et le code n'a aucune migration (D30). La clé d'une
opération importée (D09) est `op_` + 16 hexadécimaux. L'écriture par ligne entière autorise
`NOT NULL` et `CHECK` : une colonne obligatoire est `NOT NULL`, une colonne énumérée porte un
`CHECK` nommé `table.colonne`, et le cœur vérifie la même chose avant d'écrire, localement comme à la
réception, si bien qu'une ligne incohérente est refusée sans rien écrire, en nommant la table et la
colonne. Les références et les autres invariants sont vérifiés par une fonction du cœur, qui sert
aussi à l'ouverture d'un fichier étranger. Un fichier que l'utilisateur ouvre — une restauration, un
fichier fabriqué hors de l'application — passe par cette vérification entière ; celui que
l'application tient déjà, rouvert au démarrage, ne passe que par le contrôle du format, chaque
écriture l'ayant vérifié ligne par ligne. S'y complète ce que l'application pose d'elle-même pour
ses propres lignes : une table absente vaut une table vide, une colonne facultative absente vaut
vide, un réglage absent prend sa valeur par défaut, le compte principal absent naît (D40), une ligne
sans horloge reçoit une horloge de l'instance qui ouvre. Tout le reste le fait refuser, sans rien
ouvrir, écrire ni effacer (D30) : une table ou une colonne hors du format ; une valeur qui ne tient
pas dans sa colonne — obligatoire, énumération, booléen, entier, date, horodatage, JSON et sa forme,
dont une seule part variable par ventilation et par placement (D27, D38) ; un identifiant répété ;
une colonne, ou un identifiant dans une colonne JSON — le placement d'une tirelire, la sélection et
l'action d'un automatisme, la table des comptes d'un profil d'import —, qui désigne une ligne absente
du fichier ; une horloge qui ne se lit pas ; un second compte
principal ; un réglage hors du format ou qui décrit une instance. Rien n'avertit seulement : un
fichier s'ouvre ou il est refusé, car l'ouvrir en écartant des lignes cacherait ce qui manque
(principe 4). Le refus nomme le premier problème — la table, la ligne, la colonne — et dit combien
d'autres il y a ; la commande `verifier-fichier` du cœur rend le même verdict hors de l'interface,
sur la machine, chaque problème nommé. Le format est documenté dans
`docs/format-depot-sqlite.md` pour pouvoir être fabriqué depuis l'extérieur.

Chaque colonne d'une opération est importée, saisie ou établie, et rien ne s'y stocke qui se
recalcule (D89). Importées : `account_id`, `date`, `label`, `details`, `amount` et
`suggested_category`, la catégorie que propose la source. Saisie : `one_off`, et toutes les
colonnes d'une opération saisie à la main. `origin` dit comment la ligne est née ; il ne se lit pas
dans la forme de l'identifiant, qui n'est qu'une identité (D09). Six colonnes établies sont
gardées : `state`, que posent l'import, les automatismes ou l'utilisateur (D22) ; `planned_flow_id`
et `planned_date`, l'opération prévue reprise, désignée par son flux et sa date, ou
`resumed_operation_id`, la saisie reprise, que la reprise établit (D88) ; `transfer_account_id` et
`transfer_operation_id`, que la reconnaissance des virements établit. Elles ne se recalculent pas à
l'identique : la reprise et la reconnaissance des virements dépendent des flux et des opérations du
jour où elles ont eu lieu, une proposition confirmée ou un verrouillage est une décision de
l'utilisateur (D12, D22), et le moteur d'automatismes repart de ce qu'elles établissent (D33). Le
libellé normalisé, lui, se déduit du libellé seul (`normalizeLabel`) : il ne se stocke pas, il se
recalcule à la lecture du fichier. Le rang parmi les identiques du jour n'entre que dans la clé
(D09).

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
et pourrait renaître sans que rien ne l'attrape. Vitest et jsdom y entrent, avec des tests sur
`revealed` (il amène le panneau au rendu suivant, en `block: 'nearest'` pour déplacer le moins
possible, sans animation quand le mouvement est réduit) et des tests de structure qui figent, sur
les cinq écrans — Comptes, Tirelires, Catégories, Flux prévus et Saisie —, les trois conditions dont dépend la correction : le formulaire est un `{#snippet}`,
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
répartit ainsi en entier. Le flux ne fige pas de montants tirés du plan au moment de
l'enregistrement : ce ne serait pas une ventilation choisie.

Un virement saisi à la main est un flux déclaré comme un autre : il n'est pas pris pour l'ordre
permanent, que le plan ne compare qu'à un flux dérivé, et rien ne le réécrit (D57).

Ce que le budget demande comme ordre permanent est **la somme des dotations mensuelles** des
tirelires placées sur ce compte, quoi qu'il ait déjà été viré dans la période — c'est un régime, pas
un reste à faire. Comparer l'ordre au reste à virer (`PlanTransfer.standing`) allumait l'alerte le
lendemain de chaque virement. Quatre cas s'en déduisent, et sont tenus par le harnais : un objectif
atteint sort de la somme (il ne demande plus rien, D06) ; une échéance déjà provisionnée y reste
(elle sera dépensée, l'épargne reprend juste après) ; un besoin versant (D48) n'y entre pas, il rend
de l'argent ; une tirelire placée sur deux comptes partage sa dotation entre eux (D19) au lieu de
l'exiger deux fois. Un lissage décidé n'en fait jamais partie (D88) : un ordre permanent ne se règle
pas sur l'exceptionnel. L'écran l'affiche comme une somme, dépliable par « Détail » — c'est là que viendra
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

L'assistant propose l'ordre permanent de l'exemple comme un ordre déjà posé chez la banque, là où il
demande où dort chaque tirelire, à côté de ce que son budget demande pour ce compte ; l'utilisateur
le garde, en corrige le montant ou le retire, et il ne s'enregistre qu'à la validation de
l'assistant.

Ce que cela ne couvre pas encore : l'application ne sait pas préparer l'ordre chez la banque
(virement SEPA, QR code).

### D61 · Deux catégories d'une même nature ne portent pas le même nom

Parmi les catégories vivantes d'une même nature, deux ne portent pas le même nom. Les noms se
comparent sans tenir compte de la casse, des accents ni des espaces autour ; une catégorie supprimée
ne compte plus (`findCategoryByName`, `model.ts`). L'écran Catégories refuse le doublon, à la
création comme au renommage ; une catégorie créée à la volée depuis les écrans Opérations ou Saisie
reprend celle qui existe déjà au lieu d'en créer une seconde. L'assistant tient la règle avec ces
trois écrans (#212) : son étape Catégories refuse le doublon, à l'ajout comme au renommage, et le
raccourci d'une catégorie disparaît dès qu'une catégorie de même nature et de même nom existe (D46).

À la question « `findCategoryByName` […] empêche deux catégories du même nom pour une même nature,
sans tenir compte de la casse, des accents ni des espaces autour, les catégories supprimées
ignorées. […] Aucun document fondateur n'écrit ce besoin : l'écrire, ou retirer le code et ses
tests par une nouvelle issue ? », le porteur a répondu : « on le garde ».

Ce que l'hypothèse d'un nom libre cachait : taper « alimentation » en classant une opération, quand
« Alimentation » existe, créerait une seconde catégorie, et le Bilan compterait en deux lignes ce qui
en fait une.

Ce que cela ne couvre pas encore : deux instances qui créent chacune « Santé » avant de se
synchroniser gardent les deux, puisque la synchronisation fusionne les lignes par identifiant (D58) ;
un fichier fabriqué dehors peut aussi en porter deux, que son ouverture ne refuse pas.

### D85 · L'outil parle français et vouvoie

L'outil parle français à l'utilisateur et le vouvoie, partout où il s'adresse à lui : écrans,
boutons, messages, aides, documentation qui lui est destinée ; le tutoiement n'y a pas cours.

### D88 · Opérations, sous-opérations, étiquettes : un modèle, un calcul

Précise D57, sous le principe 13 (#291).

**Le budget et le plan.** Le budget se construit de manière générique, sans date ; le plan lit les
écarts entre opérations, flux, tirelires et comptes. Un flux est la représentation abstraite
d'opérations à venir ; ses opérations prévues en sont la représentation concrète, toujours cohérentes
avec lui.

**L'opération.** Une opération a un montant, une date et un compte. Elle est **bancaire** (importée),
**saisie** (à la main, passée ou future ; un lissage décidé en est une) ou **prévue** (produite par
un flux). Un flux n'est pas une opération : sans date ni montant total, c'est un automatisme qui en
génère. Un automatisme est une sélection et des actions (D23, D39) ; celui d'un flux a en plus une
récurrence, qui produit les opérations prévues, une par occurrence, et sa sélection, la seule,
reconnaît l'opération bancaire qui réalise chacune (D24). Les opérations bancaires et saisies s'enregistrent, avec ce que l'utilisateur décide sur elles ; une opération prévue se calcule depuis
son flux à chaque lecture, ne s'enregistre jamais, et se désigne par son flux et sa date. C'est la
règle de D57 : se fige ce que la banque a fait et ce que l'utilisateur a validé, jamais une photo de
ce que le budget prévoit. Une opération prévue n'est pas une hypothèse : calculée depuis un flux
enregistré et affichée comme prévue, elle lit sous sa forme concrète une donnée enregistrée, le flux,
et le principe 1.3 tient. Tous les calculs se font sur la base lue en mémoire : une opération prévue
s'ajoute aux autres au moment de compter.

**Les sous-opérations.** Une opération contient des sous-opérations, sur autant de niveaux qu'on
veut ; leurs montants s'additionnent jusqu'au sien. Un seul concept couvre :

- la **ventilation** (D10, D27) : diviser un montant entre tirelires, catégories ou personnes ; la
  **répartition** entre personnes est une ventilation par la personne ;
- le **lissage** : diviser un montant dans le temps, en sous-opérations datées, énumérées et
  enregistrées ; un flux fait de même sans total ni fin, et ses opérations prévues, produites par sa
  récurrence, se calculent ;
- la **reprise** : une opération en reprend une autre qui désigne le même mouvement. L'opération
  bancaire reprend la saisie qui l'annonçait, ou l'opération prévue qu'elle réalise — le
  rapprochement de flux de D12 et D22 ; une saisie reprend l'opération prévue qu'elle corrige ; une
  saisie de zéro, l'opération prévue qui n'aura pas lieu. L'opération reprise ne compte plus : celle
  qui la reprend compte à sa place, pour son propre montant, et l'écart entre les deux reste visible.
  La reprise est automatique quand un automatisme la permet, celui d'un flux compris (D12),
  validée par l'utilisateur sinon (principe 4.4).

**Les étiquettes.** Une étiquette classe une sous-opération. Le compte réel, la tirelire, la catégorie
et la personne sont des étiquettes **exclusives** : une seule valeur par sous-opération ; en porter
plusieurs, c'est diviser le montant, et une somme par valeur ne compte jamais deux fois le même euro.
Les étiquettes **libres** ne sont pas exclusives : autant qu'on veut, sans diviser le montant ; chacune
compte le montant entier. Une sous-opération à qui il manque une étiquette sur un axe prend celle de
l'opération qui la contient, de proche en proche ; une ventilation posée à un niveau vaut, en
proportion, pour tout ce qu'il contient, sauf là où un niveau plus bas pose la sienne. Dans une
reprise, l'opération qui reprend garde ce qui a été décidé sur elle (l'état verrouillé de D22) et
prend, sinon, la ventilation de l'opération reprise ; leurs étiquettes libres s'ajoutent.

**Le compte et la tirelire.** Une tirelire est un compte virtuel, placé sur des comptes réels (D19,
D38) : son solde se lit comme celui d'un compte, somme de ce qui y est inscrit. « Compte virtuel » dit
comment son solde se lit, pas comment elle se stocke. Une sous-opération sans tirelire reste sur son
compte réel : c'est le non affecté (D29). Comptes et tirelires se lisent en solde, qui s'accumule ;
catégories et personnes, en totaux sur une période.

**La personne.** Une personne du foyer ou du groupe est une donnée partagée par tous ceux qui ont les
clés, pas un utilisateur identifié. Un revenu porte sa personne ; une dépense commune se répartit par
défaut à parts égales entre les personnes concernées, et chaque opération se répartit librement. Un
compte peut avoir une personne pour titulaire : ce qu'il paie, elle l'a payé. Ce qu'une personne a
payé, moins ce qu'elle supporte, dit ce qu'elle doit ou ce qu'on lui doit ; un remboursement entre
personnes est un virement entre comptes, pas une dépense.

**Le solde prévu et le manque.** Le solde prévu d'un compte ou d'une tirelire à une date est son solde
réel à la date de lecture, plus les opérations saisies à une date future et les opérations prévues
qui comptent jusqu'à cette date ; les dotations d'une
tirelire (D29) y comptent comme des opérations prévues sur elle. Sur un compte suivi (il porte des
opérations importées), une opération prévue dont la fenêtre (D12) est passée sans reprise cesse de
compter, et se signale « attendue, non reçue ». Sur un compte sans suivi (U1), rien ne se confronte :
ses opérations prévues comptent à leur date. Un **manque** est un solde prévu négatif à une date : la
dépense trop proche du principe 1.4 comme l'opération attendue qui n'arrive pas se lisent par ce même
calcul. Le plan d'une période à venir montre le solde prévu des comptes et des tirelires, avec les
opérations prévues qui le font (D52).

**Le lissage.** Un lissage est une décision : l'application en propose un, calculé depuis le manque ;
l'utilisateur l'accepte, le modifie ou le refuse. Accepté, il s'enregistre comme une opération divisée
en sous-opérations datées, qui comptent comme des dotations. Rien ne se lisse d'office. Le refus
s'enregistre aussi : la réponse, lissage retenu ou refus, est une par échéance, désignée par le besoin
et la date de l'échéance ; tant qu'elle existe, la proposition ne revient pas, et le manque qui
resterait se signale toujours. Un refus n'est pas une opération : il ne paraît ni dans les opérations,
ni dans le bilan, ni dans un solde. Une sous-opération datée compte à sa date dans la tirelire et la
catégorie qui valent pour elle ; le compte réel bouge à la date de l'opération. Une part de lissage
passe ainsi, à sa date, du non affecté du compte à la tirelire, sans changer le solde du compte (I2) ;
elle n'est ni une dépense ni un revenu (#184).

**Plusieurs instances.** Des groupes différents — un couple, une colocation, des amis en vacances
(U6 à U8) — partagent chacun leurs données par leurs clés. Un même navigateur doit pouvoir tenir
plusieurs instances, chacune avec ses clés ; l'application n'en tient qu'une aujourd'hui (`DB_NAME`,
`apps/web/src/lib/db.ts`). Le partage de certaines opérations seulement, pour une gestion
individuelle, reste pour la suite.

**Ce qui ne change pas.** Ce qui se fige (D57) ; l'ordre permanent, somme des croisières, et ce qui se
recalcule, qui ne se stocke pas (D60) ; les fenêtres et tolérances de la reprise (D12) ; les états
d'une opération (D22) ; le rattrapage d'un déficit (D29).

### D89 · Le cœur calcule, l'interface affiche ; ce qui se stocke

- Cœur (`packages/core`) sans dépendance à Svelte ni au navigateur ; tout calcul y est testé
  (vitest, `pnpm test`). L'interface (`apps/web`) ne fait qu'afficher et saisir.
- Montants en centimes entiers signés ; dates `AAAA-MM-JJ` ; `deletedAt` au lieu de supprimer ;
  jamais stocker ce qui se recalcule (soldes, plan, soldes à régler). Écritures locales uniquement
  via `LedgerStore.upsert/remove/setSetting`, qui datent la ligne entière (D58) ; ce qui vient d'une
  autre instance passe par `LedgerStore.receive`.
- L'exemple livré dans l'application est inventé : aucune donnée bancaire réelle.

### D91 · Des bêtas, puis le verrou du format

Un numéro de version porte une promesse. Les versions `v0.x`, socle et versions d'usage, sont des
**bêtas** : publiées par leur tag et utilisables, elles laissent le format du fichier libre de
changer d'une version à la suivante sans migration (D30), et le disent à l'utilisateur avant qu'il y
mette de vraies données (C4, C5). `v1` est la **première version publique** : elle pose le
**verrou** du format — à partir d'elle, tout changement de format fournit une migration ou reste
rétrocompatible (D30). Elle vient quand ce qui fait bouger le format a été exercé : son entrée dans
`docs/versions.md` le nomme.
