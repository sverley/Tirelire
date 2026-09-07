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
