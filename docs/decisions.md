# Journal des décisions

Chaque décision est datée, motivée, et dit ce qu'elle implique dans le code. Pour en changer une,
ajouter une entrée qui la remplace plutôt que réécrire l'ancienne.

## D01 · 2026-09-06 · Deux niveaux de comptabilité

Les **comptes** sont le réel bancaire (solde importé) ; les **enveloppes** sont des sous-comptes
comptables hébergés sur un compte. Invariant : pour chaque compte, solde bancaire = somme des
enveloppes hébergées + non affecté. Les soldes d'enveloppes ne sont jamais stockés, toujours
reconstruits (`balances.ts`).

## D02 · 2026-09-06 · Période budgétaire de paie à paie

Le pivot porte un `payDay` ; la période va de ce jour au jour précédent du mois suivant, nommée
d'après le mois qui contient son milieu (28 août → 27 septembre = « septembre »). `payDay = 1`
redonne le mois calendaire. Conséquence vérifiée par les tests : une échéance du 15 octobre a deux
virements devant elle (28 août et 28 septembre), donc le rattrapage se lisse sur deux périodes.

## D03 · 2026-09-06 · Année budgétaire à date configurable

`settings.budgetYearStart = { month, day }`. Sert aux budgets annuels et aux bilans. Les provisions
gardent leur propre ancrage (`periodicity.anchorDate`), indépendant.

## D04 · 2026-09-06 · Relevé du pivot seul, comptes tiers saisis à la main

Seul le pivot est importé au départ (les autres comptes peuvent l'être plus tard sans changer le
modèle : un compte passe de `third` à `holding`/`pivot`). Un **compte tiers** est un compte réel
non importé ; ses opérations utiles au plan sont saisies à la main et créent un **solde à régler**
avec le pivot, présenté comme virement ponctuel dans le plan (`settlementBalance`). Réglages par
compte tiers : seuil de règlement, sens autorisé.

## D05 · 2026-09-06 · Report des budgets au cas par cas

`envelope.rollover` : `none` (remise à zéro), `unlimited`, `capped { months }`. Défaut proposé
dans l'interface : remise à zéro sur le pivot, report ailleurs (l'argent y est physiquement).
Un budget hébergé sur le pivot est « financé virtuellement » (réservation, pas de virement).

## D06 · 2026-09-06 · Ordre de financement quand la marge est négative

Chaque enveloppe a une `priority` (petit = financé d'abord ; défauts : provision 10, budget 20,
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

## D10 · 2026-09-06 · Ventilation : lignes catégorie + enveloppe

Une opération est ventilée en une ou plusieurs lignes (`Allocation`), chacune portant **une
catégorie et une enveloppe** ; l'opération simple a une seule ligne. `allocation.amount` est
une part du montant de l'opération, dans son signe. Effet sur l'enveloppe : le montant pour une
dépense ou un revenu ; pour un virement interne, +montant côté compte hôte de l'enveloppe,
−montant côté compte de départ (`allocationEffect`).

## D11 · 2026-09-06 · Un virement permanent par enveloppe, libellé « TIRELIRE … »

Le plan propose un ordre permanent par enveloppe hébergée hors pivot, avec un libellé dérivé du
nom de l'enveloppe (`transferLabel`). À l'import, une opération dont le libellé contient ce
libellé est reconnue comme virement vers cette enveloppe (`matchEnvelopeTransfers`). Un virement
groupé reste possible : il se ventile à la main sur plusieurs enveloppes.

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

## D19 · 2026-09-07 · Enveloppe répartie sur plusieurs comptes

Une enveloppe n'est plus hébergée par un compte : elle porte une **répartition par compte**,
reconstruite depuis les ventilations, jamais stockée. Deux invariants au lieu d'un : la somme des
composantes d'une enveloppe fait son solde ; la somme des composantes portées par un compte plus
le non affecté fait le solde bancaire. Une composante peut être **négative** — une dépense consomme
l'enveloppe là où elle sort, même si l'argent dort ailleurs (taxe foncière prélevée sur le pivot,
provisionnée sur le livret). Un virement interne au sein d'une même enveloppe déplace une composante
vers une autre sans changer le solde. Remplace l'hébergement de D01 et de D05 : `balances.ts` rend
un vecteur, plus un scalaire, et `Envelope.accountId` disparaît au profit d'un placement voulu (D20).

## D20 · 2026-09-07 · Placement voulu et écart

Chaque enveloppe déclare **où son argent devrait dormir**. L'écart entre position réelle et position
voulue produit des propositions de virement dans le plan : jamais une correction d'office, jamais un
blocage. Laisser un écart est légitime — un revenu arrive, on provisionnera plus tard — donc le plan
doit pouvoir présenter un écart comme « à surveiller » plutôt que « à faire ». Le pivot est un lieu
de stockage comme un autre, à durée de séjour courte : aucune règle particulière ne lui est attachée.

## D21 · 2026-09-07 · Virement groupé à ventilation prévue

Les écarts vers un même compte cible donnent un **virement permanent unique**, avec sa ventilation
calculée d'avance et enregistrée comme flux attendu. À l'import, la ligne bancaire est reconnue par
montant et libellé, et sa ventilation proposée. Si le montant constaté diffère du prévu — permanent
posé il y a six mois, besoins qui ont bougé — la répartition rejoue l'ordre de financement de D06,
planchers d'abord puis priorités, plutôt qu'un prorata qui saupoudrerait. L'écart retourne dans les
positions d'enveloppes et se represente au tour suivant. Le libellé de D11 devient un libellé par
couple de comptes, plus un libellé par enveloppe.

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
dont chaque champ est facultatif : catégorie, enveloppe, ventilation, état. L'état prend quatre
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
ventilation qui dépendrait du contexte — solde d'une enveloppe, état du plan — sort de ce cadre :
elle est une aide, et son résultat doit être figé sur l'opération au moment où il est produit.
Remplace la ventilation de D10, dont « une catégorie et une enveloppe par ligne » reste valable.

## D28 · 2026-09-07 · Enveloppe sans type, besoins multiples

Une enveloppe est un pot à **solde unique** portant un ou plusieurs **besoins** : récurrent (tant par
période, avec le report de D05), à échéance (un montant pour une date, rattrapage lissé sur les
virements restants), ou objectif (un montant sans date). Le besoin de financement de la période est
leur somme. Les priorités et planchers de D06 portent désormais sur les besoins, pas sur les
enveloppes : une même enveloppe « Charges » sert ainsi le plancher de la taxe foncière avant son
courant. Remplace la typologie provision / budget / objectif de D06, qui devient une typologie de
besoins, et `Envelope.kind` disparaît. Le **regroupement d'enveloppes est écarté** : les totaux
passent par l'arbre des catégories, et le seul apport propre d'un groupe — arbitrer une masse commune
entre ses membres — s'obtient en fusionnant les enveloppes plutôt qu'en les coiffant.

## D29 · 2026-09-07 · Dotation calculée, virements neutres, report par libération

Précise D06, D19 et D20 et remplace la part de D05 sur le « financement virtuel ». Chaque besoin
(D28) est **doté** au début de chaque période de ce qu'il demande — croisière ou rattrapage —
sous forme de composante calculée sur le pivot (ou sur le compte de placement s'il n'y a pas de
pivot), jamais stockée. Un virement interne ventilé sur une enveloppe **ne change pas son solde** :
il déplace une composante d'un compte vers un autre ; le solde ne bouge que par les dotations, les
revenus ventilés et les dépenses. Le financement par priorité de D06 devient une **lecture** : le
plan dit ce que les revenus de la période couvrent et signale les lignes réduites ; la dotation,
elle, est acquise, et le non affecté du pivot dit si l'argent y est. Le report reste une propriété
de l'enveloppe (`rollover`) : en fin de période, pour `none` tout solde positif au-delà de la
réserve des besoins non récurrents (somme de leurs cibles) est **libéré** vers le non affecté du
compte de placement ; pour `capped` c'est ce qui dépasse la réserve plus N croisières. Libération
calculée, datée du dernier jour de la période, comptée comme composante négative. Les deux
invariants de D19 tiennent puisque dotations et libérations sont des composantes comme les autres.
Le solde d'une enveloppe s'attribue à ses besoins dans l'ordre des priorités (un besoin à échéance
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

## D32 · 2026-09-07 · Enveloppe par défaut d'une catégorie

`Category.envelopeId` survit à D28 comme **enveloppe par défaut** : quand une règle ou une action
pose une catégorie sans enveloppe, la ventilation prend l'enveloppe par défaut de la catégorie. Ce
n'est qu'un raccourci de saisie, pas un lien comptable.
