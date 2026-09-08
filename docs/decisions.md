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
