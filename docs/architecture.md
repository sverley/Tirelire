# Architecture

## Vue d'ensemble

```
Tirelire/
├── packages/core/          cœur TypeScript pur (aucune dépendance à l'interface)
│   ├── src/model.ts        types du modèle, Ledger en mémoire, alive(), états de validité (D56)
│   ├── src/dates.ts        dates civiles AAAA-MM-JJ sans fuseau
│   ├── src/periods.ts      périodes de paie, périodicités
│   ├── src/money.ts        centimes : parsing et formatage français
│   ├── src/ids.ts          uuidv7, normalizeLabel, operationKey (`op_` + 16 hexadécimaux)
│   ├── src/balances.ts     positions reconstruites (composantes par compte, besoins, dotations, position simulée d'une période à venir, non affecté, solde à régler, état d'une tirelire)
│   ├── src/plan.ts         plan de période : croisière / rattrapage, priorités, virements
│   ├── src/csv.ts          décodage et parseur CSV
│   ├── src/importer.ts     profils d'import, lecture des lignes, clés, doublons
│   ├── src/matching.ts     virements internes, virements par compte, rapprochement de flux, pipeline
│   ├── src/automations.ts  moteur d'automatismes, aperçu, actions groupées, automatismes issus des flux
│   ├── src/edit.ts         édition manuelle : verrouillage, ventilation à parts
│   ├── src/review.ts       bilan par catégorie, calibrage, provisions prévu vs payé
│   ├── src/hlc.ts          horloge logique hybride
│   ├── src/schema.ts       définition des tables aux noms du domaine, colonnes obligatoires et énumérées (une source pour SQL, lecture, écriture, échange), format du fichier
│   ├── src/store.ts        dépôt sql.js : état daté par ligne, refus d'une ligne incohérente, réception et conflits, refus d'un autre format
│   ├── src/sync.ts         synchronisation par delta d'état, paquets par fichier et par relais
│   └── src/example.ts      jeu de données de l'analyse
├── apps/web/               PWA Svelte 5 + Vite
│   ├── src/lib/db.ts       ouverture du dépôt, persistance IndexedDB
│   ├── src/lib/state.svelte.ts  état réactif (ledger, asOf, plan dérivé, vue)
│   ├── src/lib/platform.ts     navigateur vs Android (enregistrer / partager un fichier)
│   ├── src/lib/FiltreEtat.svelte  interrupteurs de visibilité par état des écrans de cartes (D56)
│   ├── src/views/*.svelte  Plan, Operations, Import, Review, More, Accounts, Tirelires, Flows, Entries, Settings
│   └── android/            projet Capacitor (icônes, signature, versions par variables d'environnement)
├── apps/relay/             relais HTTP minimal (Node), paquets chiffrés
├── apps/hebergement/       site pour hébergement mutualisé : PWA + relais PHP, .htaccess, .ovhconfig, assembleur, dépôt FTP
├── docs/                   analyse, décisions, formats d'import, synchronisation, hébergement web, reprise
└── .github/workflows/ci.yml  tests, build web, APK, releases
```

## Modèle (résumé)

| Objet | Rôle | Identité |
|---|---|---|
| `Account` | compte réel : `principal`, `holding` (accueil), `third` (tiers, saisi à la main) ; ouverture et clôture datées (D56) | UUID v7 |
| `Tirelire` | pot à solde unique, réparti sur les comptes ; déclare un placement voulu | UUID v7 |
| `Need` | besoin porté par une tirelire : `recurring`, `dueDate`, `goal` ; priorité | UUID v7 |
| `Category` | classement des dépenses / revenus ; peut consommer un budget | UUID v7 |
| `PlannedFlow` | revenu, charge fixe, échéance payée par une tirelire, virement attendu ; périodicité, fenêtre, tolérance, motif | UUID v7 |
| `Operation` | ligne de relevé (`imported`) ou saisie (`manual`) ; état (non traitée / rapprochée / verrouillée) ; transfert ; flux rapproché | clé déterministe ou UUID v7 |
| `Allocation` | ligne de ventilation : catégorie + tirelire + part (fixe, pourcentage, variable) | UUID v7 |
| `Automation` | sélection + action à champs facultatifs + rang (clé triable) + validité | UUID v7 |
| `ImportProfile` | colonnes, formats, correspondance des comptes | UUID v7 |
| `Device` (branche sync) | appareil et personne | siteId |
| `Settings` | coussin du compte principal, seuil de virement, siteId | clé/valeur |

Montants en centimes entiers signés (négatif = débit). Dates `AAAA-MM-JJ`. Suppression = `deletedAt`.
Dans le fichier, chaque table et chaque colonne porte le nom du domaine, la propriété en snake_case
(`tirelires`, `tirelire_id`, `makes_automation`) ; le libellé normalisé d'une opération se recalcule
à la lecture (D58).

## Conventions de signe

- `operation.amount` : signe bancaire du compte porteur.
- `allocation` : une part de l'opération (fixe, pourcentage, ou variable = le reste), résolue par
  `resolveShares`, dans le signe de l'opération.
- Effet sur la tirelire (`allocationEffects`, D19) : le montant sur le compte de l'opération ; pour
  un virement interne, aussi son opposé sur le compte de contrepartie — la composante se déplace,
  le solde ne bouge pas.
- Solde à régler d'un compte tiers (`settlementBalance`) : positif = le compte principal lui doit.

## Calcul du plan (`computePlan`)

0. Deux dates (D52) : `asOf`, la période regardée, et `today`, jusqu'où les soldes sont connus.
   Au-delà de `today`, le plan cesse de lire le réel et suppose exécutés les virements qu'il a
   proposés pour les périodes précédentes.
1. Période contenant `asOf` ; revenus et charges fixes = occurrences des flux dans la période.
2. Par besoin (D28) : part du solde de la tirelire qui lui revient (ordre des priorités), croisière,
   rattrapage, dotation = max, plancher = rattrapage d'une échéance.
3. Lecture du financement (D06) : planchers par priorité, puis dotations, dans la limite de
   revenus − charges fixes. Une dotation reste acquise même non couverte ; le plan le dit.
4. Écarts de placement (D20) : composantes hors du compte de placement, marquées « à faire »
   au-dessus du seuil, « à surveiller » en dessous. Sur une période à venir, la position est celle
   que le plan simule (`plannedComponents`, D52), sans quoi il redemanderait à chaque période ce
   qu'il a déjà demandé aux précédentes.
5. Virements : un par couple de comptes (D21), détaillé par tirelire, plus règlements des tiers
   et surplus des comptes d'accueil.
6. Marge = revenus − charges fixes − financé ; avertissements (coussin, réductions, règlements bloqués).

## États d'une opération (D22)

`untreated` (aucune règle ne l'a vue) → `reconciled` (posée par une règle ou par l'import, reprise
à chaque passage) → `locked` (vérité, plus aucune règle ne l'atteint). Toute modification manuelle
verrouille (`edit.ts`) ; seul l'utilisateur déverrouille, à l'unité ou par action groupée.

## Moteur d’automatismes (`automations.ts`, D23)

Les règles se rejouent du rang le plus élevé au rang 1 sur les opérations non verrouillées : chaque
champ renseigné écrase, les champs vides laissent en place, le rang tranche. Le calcul repart de ce
que l'import a établi (D33), jamais de rien. `previewRules` donne l'avant/après sans écrire ;
`applyBulkAction` fait la même chose sur une sélection, avec en plus le déverrouillage (D26).

## Pipeline d'import (`runPipeline`)

lecture (profil) → clés et doublons (`prepareImport`) → insertion → virements internes appariés
→ virements par compte (libellé TIRELIRE, ventilés par l'ordre de financement) → rapprochement
automatique des flux sûrs → moteur de règles → file de tri (interface).

## Dépôt et synchronisation

`LedgerStore` (sql.js) : le fichier est un état (D58). `upsert`, `remove` et `setSetting`
réécrivent la ligne entière avec une nouvelle horloge ; `receive` fusionne des lignes venues d'une
autre instance, la plus récente gagne, et rend l'écartée d'un conflit sans la garder. Ce qui décrit l'instance
(`InstanceState`) n'est pas dans le fichier : `apps/web/src/lib/db.ts` le garde à côté.
`sync.ts` : protocole symétrique par delta d'état, transport abstrait ; fichier JSON, WebRTC,
relais Node (`apps/relay`) et relais PHP servi avec la PWA (`apps/hebergement`). Détail :
`docs/synchronisation.md`.

## Vérification

- `pnpm test` : 174 tests vitest sur le cœur (périodes, plan, positions et invariants, besoins,
  report, états et filtre, dépôt, fusion, import, rapprochement, règles, ventilation à parts,
  bilan, sync), plus trois gardes de navigateur sur le harnais commun `apps/web/test/harnais.ts`
  (mise en page mobile, ergonomie au doigt, filtre d'état).
- `pnpm typecheck`, `pnpm build`.
- Scénarios navigateur joués avec Playwright pendant le développement (exemple → import CSV → tri → bilan ; synchronisation WebRTC et relais entre deux contextes).
