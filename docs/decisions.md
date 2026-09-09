# Journal des décisions

Chaque décision est datée, motivée, et dit ce qu'elle implique dans le code. Pour en changer une,
ajouter une entrée qui la remplace plutôt que réécrire l'ancienne.

## D01 · 2026-09-06 · Deux niveaux de comptabilité

Les **comptes** sont le réel bancaire (solde importé) ; les **tirelires** sont des sous-comptes
comptables hébergés sur un compte. Invariant : pour chaque compte, solde bancaire = somme des
tirelires hébergées + non affecté. Les soldes de tirelires ne sont jamais stockés, toujours
reconstruits (`balances.ts`).

## D02 · 2026-09-06 · Période budgétaire de paie à paie

Le compte principal porte un `payDay` ; la période va de ce jour au jour précédent du mois suivant, nommée
d'après le mois qui contient son milieu (28 août → 27 septembre = « septembre »). `payDay = 1`
redonne le mois calendaire. Conséquence vérifiée par les tests : une échéance du 15 octobre a deux
virements devant elle (28 août et 28 septembre), donc le rattrapage se lisse sur deux périodes.

## D03 · 2026-09-06 · Année budgétaire à date configurable

`settings.budgetYearStart = { month, day }`. Sert aux budgets annuels et aux bilans. Les provisions
gardent leur propre ancrage (`periodicity.anchorDate`), indépendant.

## D04 · 2026-09-06 · Relevé du compte principal seul, comptes tiers saisis à la main

Seul le compte principal est importé au départ (les autres comptes peuvent l'être plus tard sans changer le
modèle : un compte passe de `third` à `holding`/`principal`). Un **compte tiers** est un compte réel
non importé ; ses opérations utiles au plan sont saisies à la main et créent un **solde à régler**
avec le compte principal, présenté comme virement ponctuel dans le plan (`settlementBalance`). Réglages par
compte tiers : seuil de règlement, sens autorisé.

## D05 · 2026-09-06 · Report des budgets au cas par cas

`tirelire.rollover` : `none` (remise à zéro), `unlimited`, `capped { months }`. Défaut proposé
dans l'interface : remise à zéro sur le compte principal, report ailleurs (l'argent y est physiquement).
Un budget hébergé sur le compte principal est « financé virtuellement » (réservation, pas de virement).

## D06 · 2026-09-06 · Ordre de financement quand la marge est négative

Chaque tirelire a une `priority` (petit = financé d'abord ; défauts : provision 10, budget 20,
objectif 30). Les planchers (rattrapage d'une provision) sont servis avant tout le reste, puis le
demandé dans l'ordre des priorités. Le plan dit quelles lignes sont réduites ou non financées.

## D07 · 2026-09-06 · Application JavaScript portable : PWA Svelte + Capacitor

Un seul code : PWA (installable, servie comme fichiers statiques par un serveur privé) emballée
avec Capacitor pour Android. Cœur en TypeScript pur (`packages/core`) sans dépendance à
l'interface. Interface Svelte 5 (`apps/web`). Choix du framework jugé secondaire tant que le
cœur reste indépendant.

## D08 · 2026-09-06 · Stockage option D : tables SQLite + journal de changements

Les tables SQLite (sql.js en WebAssembly, persisté dans IndexedDB, exportable en un fichier)
sont la vérité. Chaque écriture laisse une trace *(table, ligne, colonne, valeur, horloge
logique hybride, appareil)* dans `changes`, chaînée par empreinte SHA-256 par appareil
(`store.ts`). Fusion colonne par colonne, la plus récente gagne ; suppressions logiques
(`deletedAt`) ; ce qui se recalcule ne se stocke pas. Le journal d'événements comme *stockage*
(option B), les CRDT génériques (C) et la blockchain ont été examinés et écartés (voir
`analyse-du-besoin.html` §11).

## D09 · 2026-09-06 · Deux familles d'identifiants

Opérations importées : clé déterministe `op_` + SHA-256(compte, date, montant, libellé
normalisé, rang parmi les identiques du jour) → identiques sur tous les appareils, fusion sans
conflit. Tout ce que l'utilisateur crée : UUID v7. Les exports bancaires n'ayant ni heure ni
identifiant de transaction, un **détecteur de doublons probables** (même compte, même montant,
±3 jours, libellé proche) compense les changements de libellé ou de date entre sources
(Linxo ↔ banque, attente ↔ comptabilisé).

## D10 · 2026-09-06 · Ventilation : lignes catégorie + tirelire

Une opération est ventilée en une ou plusieurs lignes (`Allocation`), chacune portant **une
catégorie et une tirelire** ; l'opération simple a une seule ligne. `allocation.amount` est
une part du montant de l'opération, dans son signe. Effet sur la tirelire : le montant pour une
dépense ou un revenu ; pour un virement interne, +montant côté compte hôte de la tirelire,
−montant côté compte de départ (`allocationEffect`).

## D11 · 2026-09-06 · Un virement permanent par tirelire, libellé « TIRELIRE … »

Le plan propose un ordre permanent par tirelire hébergée hors principal, avec un libellé dérivé du
nom de la tirelire (`transferLabel`). À l'import, une opération dont le libellé contient ce
libellé est reconnue comme virement vers cette tirelire (`matchTirelireTransfers`). Un virement
groupé reste possible : il se ventile à la main sur plusieurs tirelires.

## D12 · 2026-09-06 · Pointage prudent

Un flux prévu est pointé automatiquement seulement si le montant est exact (ou dans la tolérance
avec libellé reconnu) et que le flux n'est pas marqué variable ; sinon c'est une proposition à
confirmer. Une occurrence d'un flux n'est pointée qu'une fois. Les flux dont la fenêtre est
passée sans opération remontent en « attendus, non reçus ».

## D13 · 2026-09-06 · Nom de code « Tirelire »

Une tirelire par objectif, chacune avec son solde. Le nom public se décidera plus tard.

## D14 · 2026-09-06 · Clé de signature de test versionnée

`apps/web/android/keystore/tirelire-test.jks` (mot de passe `tirelire-test`) signe les APK de
test pour que les mises à jour s'installent par-dessus. Jamais pour un store ; des secrets
`ANDROID_KEYSTORE_*` la remplacent en CI.

## D15 · 2026-09-06 · Livraison automatique

À chaque push sur `main` : tests, build web, APK publié dans la release `latest`. Tag `v*` :
release nommée. Hooks git : typecheck + tests du cœur avant commit, build avant push.

## D16 · 2026-09-06 · Synchronisation : protocole unique, transports interchangeables

`sync.ts` : hello / request / changes / done / bye, curseur par pair, relais des changements de
tiers. Transports : fichier (main), WebRTC à signalisation manuelle et relais privé chiffré
(branche `feature/sync-p2p`). Wi‑Fi Direct et Bluetooth demanderaient un module natif Capacitor.

## D17 · 2026-09-06 · Aucune donnée réelle dans le dépôt

Les fichiers bancaires servent à vérifier l'import localement et ne sont jamais versionnés
(`*.csv`, `*.sqlite` ignorés). Les exemples et tests utilisent des données inventées.

## D18 · 2026-09-07 · Numéro de compte mémorisé sur le compte, indépendant du profil d'import

`Account.accountNumber` (facultatif, saisi dans le panneau Comptes ou mémorisé depuis l'import)
porte le numéro de compte ou l'IBAN, comparé après normalisation (espaces et ponctuation
retirés, casse uniforme) et tolérant qu'un export ne donne que les derniers chiffres
(`matchAccountByNumber`, `importer.ts`). À la lecture d'un fichier multi-comptes, une valeur de
la colonne compte qui correspond à un numéro déjà mémorisé pré-remplit la correspondance —
y compris avec un profil nouvellement détecté, contrairement à `profile.accountMap` qui ne vaut
que pour ce profil. Une case à cocher propose de mémoriser une nouvelle valeur sur le compte
choisi ; décision explicite, jamais un écrasement silencieux.

## D19 · 2026-09-07 · Tirelire répartie sur plusieurs comptes

Une tirelire n'est plus hébergée par un compte : elle porte une **répartition par compte**,
reconstruite depuis les ventilations, jamais stockée. Deux invariants au lieu d'un : la somme des
composantes d'une tirelire fait son solde ; la somme des composantes portées par un compte plus
le non affecté fait le solde bancaire. Une composante peut être **négative** — une dépense consomme
la tirelire là où elle sort, même si l'argent dort ailleurs (taxe foncière prélevée sur le compte principal,
provisionnée sur le livret). Un virement interne au sein d'une même tirelire déplace une composante
vers une autre sans changer le solde. Remplace l'hébergement de D01 et de D05 : `balances.ts` rend
un vecteur, plus un scalaire, et `Tirelire.accountId` disparaît au profit d'un placement voulu (D20).

## D20 · 2026-09-07 · Placement voulu et écart

Chaque tirelire déclare **où son argent devrait dormir**. L'écart entre position réelle et position
voulue produit des propositions de virement dans le plan : jamais une correction d'office, jamais un
blocage. Laisser un écart est légitime — un revenu arrive, on provisionnera plus tard — donc le plan
doit pouvoir présenter un écart comme « à surveiller » plutôt que « à faire ». Le compte principal est un lieu
de stockage comme un autre, à durée de séjour courte : aucune règle particulière ne lui est attachée.

## D21 · 2026-09-07 · Virement groupé à ventilation prévue

Les écarts vers un même compte cible donnent un **virement permanent unique**, avec sa ventilation
calculée d'avance et enregistrée comme flux attendu. À l'import, la ligne bancaire est reconnue par
montant et libellé, et sa ventilation proposée. Si le montant constaté diffère du prévu — permanent
posé il y a six mois, besoins qui ont bougé — la répartition rejoue l'ordre de financement de D06,
planchers d'abord puis priorités, plutôt qu'un prorata qui saupoudrerait. L'écart retourne dans les
positions de tirelires et se represente au tour suivant. Le libellé de D11 devient un libellé par
couple de comptes, plus un libellé par tirelire.

## D22 · 2026-09-07 · Trois états d'une opération, la vérité est ce qui est verrouillé

*Non traitée* (aucune règle ne l'a vue), *rapprochée* (classée par une règle, reprise à chaque
passage, malléable), *verrouillée* (plus aucune règle ne l'atteint). Est vérité — donc stocké et
synchronisé — ce qui est verrouillé. Toute modification manuelle d'une opération la verrouille :
c'est la modification qui change l'état, pas l'ouverture de l'éditeur. Seul l'utilisateur
déverrouille, à l'unité ou par action groupée (D26). Renomme le pointage de D12 en **rapprochement
de flux**, qui reste la mise en correspondance avec une échéance attendue et ne change aucun état
à lui seul ; les deux sens du mot ne doivent plus cohabiter dans le code ni dans l'interface.

## D23 · 2026-09-07 · Règles : sélection, action, rang

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

## D24 · 2026-09-07 · Un flux peut engendrer une règle

Un flux prévu engendre optionnellement une règle déterministe. Modifier le flux **archive** la règle
en lui posant une fin de validité et en crée une nouvelle : les opérations déjà classées ne sont pas
réécrites, puisqu'aucune règle nouvelle ne les sélectionne.

## D25 · 2026-09-07 · Abandon de l'année budgétaire

Remplace D03. Pour un particulier, le budget évolue au fil de la vie — salaire, activité en cours
d'année, achat, investissement — et aucune date d'arrêté n'a de sens. Les provisions gardent leur
ancrage propre (`periodicity.anchorDate`) ; les bilans se lisent sur un horizon glissant. Une
comparaison entre deux périodes doit signaler quand la profondeur d'historique disponible diffère,
plutôt que de laisser croire à une baisse de dépenses.

## D26 · 2026-09-07 · Action groupée

Un filtre de recherche, une sélection ajustable à la main — tout sélectionner ou désélectionner sur
les opérations visibles, plus la sélection individuelle — et les mêmes actions qu'une règle **plus
*Déverrouiller***. Ne se conserve pas et ne se rejoue pas : seuls ses effets restent dans les
opérations. Aperçu avant application, avec l'avant et l'après. Chemin inverse également : une
sélection manuelle peut proposer un filtre qui tente de la reproduire, et donc engendrer une règle.
C'est la porte d'entrée vers les règles pour qui n'en écrirait jamais.

## D27 · 2026-09-07 · Ventilation à parts, dont une part variable

Une ligne de ventilation porte un **montant fixe**, un **pourcentage** du montant de l'opération, ou
la part **variable** — calculée, égale au montant de l'opération moins les autres lignes. Toute
opération a par défaut une ligne unique variable, qui prend donc l'intégralité du montant ; ajouter
des lignes la réduit d'autant, jusqu'à zéro, jamais en négatif. Une seule ligne variable par
ventilation. La ventilation ne dépend que de l'opération : le rejeu reste déterministe même à montant
inconnu d'avance, donc un flux à montant variable peut engendrer une règle verrouillante. Une
ventilation qui dépendrait du contexte — solde d'une tirelire, état du plan — sort de ce cadre :
elle est une aide, et son résultat doit être figé sur l'opération au moment où il est produit.
Remplace la ventilation de D10, dont « une catégorie et une tirelire par ligne » reste valable.

## D28 · 2026-09-07 · Tirelire sans type, besoins multiples

Une tirelire est un pot à **solde unique** portant un ou plusieurs **besoins** : récurrent (tant par
période, avec le report de D05), à échéance (un montant pour une date, rattrapage lissé sur les
virements restants), ou objectif (un montant sans date). Le besoin de financement de la période est
leur somme. Les priorités et planchers de D06 portent désormais sur les besoins, pas sur les
tirelires : une même tirelire « Charges » sert ainsi le plancher de la taxe foncière avant son
courant. Remplace la typologie provision / budget / objectif de D06, qui devient une typologie de
besoins, et `Tirelire.kind` disparaît. Le **regroupement de tirelires est écarté** : les totaux
passent par l'arbre des catégories, et le seul apport propre d'un groupe — arbitrer une masse commune
entre ses membres — s'obtient en fusionnant les tirelires plutôt qu'en les coiffant.

## D29 · 2026-09-07 · Dotation calculée, virements neutres, report par libération

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

## D30 · 2026-09-07 · Colonnes dépréciées et version de modèle

Une colonne retirée du modèle n'est jamais supprimée du schéma : elle est marquée **dépréciée**
dans `schema.ts`, ignorée à la lecture et à l'écriture locale, mais toujours acceptée par
`applyRemote`, pour qu'un appareil non migré puisse encore envoyer son journal (D08). Une
**version de modèle** (`meta.model_version`) déclenche à l'ouverture une migration locale
idempotente qui lit les colonnes dépréciées et écrit les nouvelles via `upsert`, donc journalisées
et propagées ; deux appareils qui migrent chacun produisent les mêmes valeurs, la fusion colonne par
colonne converge. Le compactage du journal, plus tard, purgera les colonnes dépréciées.

## D31 · 2026-09-07 · Rang d'une règle = clé triable

Précise D23. Le rang est stocké comme **chaîne triable** (`rank`, ordre lexicographique, générée
entre deux voisins à l'insertion ou au déplacement), pas comme index entier : deux appareils qui
réordonnent en même temps ne produisent pas de doublons destructeurs, et une égalité se tranche par
l'identifiant. L'interface montre une liste ordonnée, rang 1 en tête, sans exposer la clé. Les
règles s'appliquent de la fin de la liste vers le rang 1.

## D32 · 2026-09-07 · Tirelire par défaut d'une catégorie

`Category.tirelireId` survit à D28 comme **tirelire par défaut** : quand une règle ou une action
pose une catégorie sans tirelire, la ventilation prend la tirelire par défaut de la catégorie. Ce
n'est qu'un raccourci de saisie, pas un lien comptable.

## D33 · 2026-09-07 · Le moteur de règles part de ce que l'import a établi

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

## D34 · 2026-09-07 · Une classification que rien ne reproduit est verrouillée d'office à la migration

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
## D35 · 2026-09-07 · Version « serveur web » = PWA statique + relais PHP sur hébergement mutualisé

Pour être utilisable depuis un hébergement web mutualisé (OVHcloud sans VPS : Apache, PHP,
pas de Node ni de processus persistant), l'application ne change pas de modèle : les données
restent sur les appareils (D08), le serveur ne fait que servir les fichiers de la PWA et
relayer des paquets chiffrés. `apps/hebergement` fournit `relais.php` (même contrat que
`apps/relay/server.mjs`, fichiers `.jsonl` sous verrou), `.htaccess`, `.ovhconfig` et un
assembleur qui construit la PWA avec un préfixe d'adresse (`vite --base`). L'adresse du site
est proposée d'office comme relais. Une version « serveur de vérité » (comptes utilisateurs,
base MySQL, logique côté serveur) a été écartée : elle contredirait D07/D08, imposerait une
authentification et retirerait le fonctionnement hors ligne. Livraison : archive jointe aux
releases, dépôt FTPS automatique si des secrets `OVH_FTP_*` existent (D15).

## D36 · 2026-09-07 · Le filtre de recherche est la sélection d'une règle

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

## D37 · 2026-09-07 · Dépôt du site par lftp, sans supprimer ce qui vit sur le serveur

Le dépôt sur l'hébergement (D35) se fait avec `lftp` dans `apps/hebergement/deposer.sh`, appelé
par la CI et utilisable à la main, plutôt qu'avec une action tierce : un seul outil pour FTPS et
SFTP, secrets qui ne sortent pas du script, comportement testable. Le script est vérifié contre
un vrai serveur FTP local (`deposer.test.mjs`). Deux règles : les fichiers d'entrée
(`index.html`, `sw.js`, `registerSW.js`, `manifest.webmanifest`) partent en dernier, pour qu'on
ne charge jamais une page pointant vers des ressources absentes ; `donnees/*.jsonl` et
`relais.config.php` sont exclus de l'envoi **et** du nettoyage, car ils appartiennent au serveur.
Le nettoyage des anciens fichiers est facultatif (`TIRELIRE_FTP_NETTOYER`) et désactivé par
défaut : un appareil pas encore rechargé demande encore les fragments de la version précédente.
## D38 · 2026-09-07 · Le placement voulu est une répartition, pas un compte

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

## D39 · 2026-09-07 · Une règle s'appelle un automatisme, et se crée depuis la recherche

Le mot « règle » laissait croire à une contrainte ; ce sont des automatismes, qu'on ajoute et
retire sans cérémonie. Renommage dans l'interface comme dans le code (`Automation`, table
`automations`).

Conséquence directe de D36 : il n'y a pas d'un côté une recherche et de l'autre un formulaire
d'automatisme, mais un seul écran. On cherche avec les champs d'une sélection, on ajoute des
actions à appliquer à ce que la recherche retourne, on applique tout de suite si on veut, et
« Enregistrer » transforme le couple recherche + actions en automatisme. Créer un automatisme
n'est donc jamais un geste à part : c'est garder une recherche qu'on vient de faire.

## D40 · 2026-09-08 · L'assistant construit un budget, il ne configure pas des objets

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

## D41 · 2026-09-08 · Le compte pivot s'appelle le compte principal

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

## D42 · 2026-09-08 · Une enveloppe s'appelle une tirelire ; le stockage garde ses noms

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

**Sur la réécriture du journal.** D41 et D42 sont les seules décisions dont l'application a consisté à
retoucher les entrées antérieures : le vocabulaire y a été remplacé partout, ainsi que dans
`analyse-du-besoin.html`. La règle « ajouter une entrée plutôt que réécrire l'ancienne » porte sur le
*contenu* d'une décision, et aucun contenu n'a changé — laisser deux vocabulaires cohabiter aurait
rendu le journal illisible, ce qu'aucune décision ne gagne. Le détail des mots remplacés se lit dans
le commit de renommage.

## D43 · 2026-09-08 · L'assistant propose, et ce qu'il propose vient de l'exemple

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

**Complément (8 septembre) — l'étape Comptes.** Elle expliquait longuement ce qu'elle allait faire au
lieu de le montrer. Trois corrections : le texte tient en deux phrases et dit ce que l'étape attend —
des **comptes bancaires réels**, ceux dont on reçoit un relevé, et non des catégories de budget ; le
**compte principal y apparaît**, matérialisé à l'arrivée sur l'étape plutôt que créé au premier
enregistrement, avec ses champs modifiables sur place (nom, banque, numéro ou IBAN, solde actuel), ce
qui rend inutile la question du solde posée plus loin ; et le bandeau de totaux du budget — revenus,
charges, reste à vivre — disparaît de cette étape, qui ne parle pas du budget.

## D44 · 2026-09-08 · La date de paie appartient au flux ; le début de période est un choix

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

## D45 · 2026-09-08 · Le genre d'un compte dit sa nature, pas comment on le remplit

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

**Correctif (8 septembre) — un remplacement muet.** Le passage à D45 a d'abord échoué en silence : le
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

## D46 · 2026-09-08 · Des lignes déjà là, pas des pastilles à cliquer

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

## D47 · 2026-09-08 · Un rythme se compte dans l'unité qui lui convient

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

## D48 · 2026-09-08 · Une tirelire peut verser au budget au lieu de le consommer

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

## D49 · 2026-09-08 · Un renflouement est un symptôme, pas un mouvement à ranger

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

## D50 · 2026-09-08 · Un besoin a une période de validité

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

## D51 · 2026-09-08 · Les dates de validité se voient, et l'exemple les porte

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

## D52 · 2026-09-08 · Une période à venir suppose exécuté le plan des périodes précédentes

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

## D53 · 2026-09-08 · Une échéance montre sa provision, et l'exemple garde ses besoins

Reprise du signalement « le jeu d'exemple ne contient aucun besoin » (8 septembre). Le défaut
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
## D54 · 2026-09-08 · Un nombre garde sa police, pas son insécabilité

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

## D55 · 2026-09-09 · Des seuils tactiles mesurés, pas relus

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

## D56 · 2026-09-09 · Un écran de cartes se filtre par état

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
