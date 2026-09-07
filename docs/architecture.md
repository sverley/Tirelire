# Architecture

## Vue d'ensemble

```
Tirelire/
├── packages/core/          cœur TypeScript pur (aucune dépendance à l'interface)
│   ├── src/model.ts        types du modèle, Ledger en mémoire, alive()
│   ├── src/dates.ts        dates civiles AAAA-MM-JJ sans fuseau
│   ├── src/periods.ts      périodes de paie, périodicités
│   ├── src/money.ts        centimes : parsing et formatage français
│   ├── src/ids.ts          uuidv7, normalizeLabel, operationKey
│   ├── src/balances.ts     positions reconstruites (composantes par compte, besoins, dotations, non affecté, solde à régler)
│   ├── src/plan.ts         plan de période : croisière / rattrapage, priorités, virements
│   ├── src/csv.ts          décodage et parseur CSV
│   ├── src/importer.ts     profils d'import, lecture des lignes, clés, doublons
│   ├── src/matching.ts     virements internes, virements par compte, rapprochement de flux, pipeline
│   ├── src/rules.ts        moteur de règles, aperçu, actions groupées, règles issues des flux
│   ├── src/edit.ts         édition manuelle : verrouillage, ventilation à parts
│   ├── src/migration.ts    migrations du modèle (versions 1 → 4)
│   ├── src/review.ts       bilan par catégorie, calibrage, provisions prévu vs payé
│   ├── src/hlc.ts          horloge logique hybride
│   ├── src/schema.ts       définition des tables (une source pour SQL, lecture, écriture, journal)
│   ├── src/store.ts        dépôt sql.js : upsert/remove journalisés, applyRemote, chaîne d'empreintes
│   ├── src/sync.ts         protocole de synchronisation, paquets par fichier
│   └── src/example.ts      jeu de données de l'analyse
├── apps/web/               PWA Svelte 5 + Vite
│   ├── src/lib/db.ts       ouverture du dépôt, persistance IndexedDB
│   ├── src/lib/state.svelte.ts  état réactif (ledger, asOf, plan dérivé, vue)
│   ├── src/lib/platform.ts     navigateur vs Android (enregistrer / partager un fichier)
│   ├── src/views/*.svelte  Plan, Operations, Import, Review, More, Accounts, Envelopes, Flows, Entries, Settings
│   └── android/            projet Capacitor (icônes, signature, versions par variables d'environnement)
├── apps/relay/             (branche feature/sync-p2p) relais HTTP minimal, paquets chiffrés
├── docs/                   analyse, décisions, formats d'import, synchronisation, reprise
└── .github/workflows/ci.yml  tests, build web, APK, releases
```

## Modèle (résumé)

| Objet | Rôle | Identité |
|---|---|---|
| `Account` | compte réel : `pivot`, `holding` (accueil), `third` (tiers, saisi à la main) | UUID v7 |
| `Envelope` | pot à solde unique, réparti sur les comptes ; déclare un placement voulu | UUID v7 |
| `Need` | besoin porté par une enveloppe : `recurring`, `dueDate`, `goal` ; priorité | UUID v7 |
| `Category` | classement des dépenses / revenus ; peut consommer un budget | UUID v7 |
| `PlannedFlow` | revenu, charge fixe, échéance payée par une enveloppe, virement attendu ; périodicité, fenêtre, tolérance, motif | UUID v7 |
| `Operation` | ligne de relevé (`imported`) ou saisie (`manual`) ; état (non traitée / rapprochée / verrouillée) ; transfert ; flux rapproché | clé déterministe ou UUID v7 |
| `Allocation` | ligne de ventilation : catégorie + enveloppe + part (fixe, pourcentage, variable) | UUID v7 |
| `Rule` | sélection + action à champs facultatifs + rang (clé triable) + validité | UUID v7 |
| `ImportProfile` | colonnes, formats, correspondance des comptes | UUID v7 |
| `Device` (branche sync) | appareil et personne | siteId |
| `Settings` | coussin du pivot, seuil de virement, siteId | clé/valeur |

Montants en centimes entiers signés (négatif = débit). Dates `AAAA-MM-JJ`. Suppression = `deletedAt`.

## Conventions de signe

- `operation.amount` : signe bancaire du compte porteur.
- `allocation` : une part de l'opération (fixe, pourcentage, ou variable = le reste), résolue par
  `resolveShares`, dans le signe de l'opération.
- Effet sur l'enveloppe (`allocationEffects`, D19) : le montant sur le compte de l'opération ; pour
  un virement interne, aussi son opposé sur le compte de contrepartie — la composante se déplace,
  le solde ne bouge pas.
- Solde à régler d'un compte tiers (`settlementBalance`) : positif = le pivot lui doit.

## Calcul du plan (`computePlan`)

1. Période contenant `asOf` ; revenus et charges fixes = occurrences des flux dans la période.
2. Par besoin (D28) : part du solde de l'enveloppe qui lui revient (ordre des priorités), croisière,
   rattrapage, dotation = max, plancher = rattrapage d'une échéance.
3. Lecture du financement (D06) : planchers par priorité, puis dotations, dans la limite de
   revenus − charges fixes. Une dotation reste acquise même non couverte ; le plan le dit.
4. Écarts de placement (D20) : composantes hors du compte de placement, marquées « à faire »
   au-dessus du seuil, « à surveiller » en dessous.
5. Virements : un par couple de comptes (D21), détaillé par enveloppe, plus règlements des tiers
   et surplus des comptes d'accueil.
6. Marge = revenus − charges fixes − financé ; avertissements (coussin, réductions, règlements bloqués).

## États d'une opération (D22)

`untreated` (aucune règle ne l'a vue) → `reconciled` (posée par une règle ou par l'import, reprise
à chaque passage) → `locked` (vérité, plus aucune règle ne l'atteint). Toute modification manuelle
verrouille (`edit.ts`) ; seul l'utilisateur déverrouille, à l'unité ou par action groupée.

## Moteur de règles (`rules.ts`, D23)

Les règles se rejouent du rang le plus élevé au rang 1 sur les opérations non verrouillées : chaque
champ renseigné écrase, les champs vides laissent en place, le rang tranche. Le calcul repart de ce
que l'import a établi (D33), jamais de rien. `previewRules` donne l'avant/après sans écrire ;
`applyBulkAction` fait la même chose sur une sélection, avec en plus le déverrouillage (D26).

## Pipeline d'import (`runPipeline`)

lecture (profil) → clés et doublons (`prepareImport`) → insertion → virements internes appariés
→ virements par compte (libellé TIRELIRE, ventilés par l'ordre de financement) → rapprochement
automatique des flux sûrs → moteur de règles → file de tri (interface).

## Dépôt et synchronisation

`LedgerStore` (sql.js) : `upsert` journalise chaque colonne modifiée avec un HLC et une empreinte
chaînée ; `applyRemote` n'écrase une cellule que si l'horodatage reçu est plus récent
(`cell_versions`), conserve les entrées reçues pour les relayer, vérifie les empreintes.
`sync.ts` : protocole symétrique par curseurs, transport abstrait ; fichier JSON sur `main`,
WebRTC et relais sur `feature/sync-p2p`.

## Vérification

- `pnpm test` : 102 tests vitest sur le cœur (périodes, plan, positions et invariants, besoins,
  report, dépôt, migrations, fusion, import, rapprochement, règles, ventilation à parts, bilan, sync).
- `pnpm typecheck`, `pnpm build`.
- Scénarios navigateur joués avec Playwright pendant le développement (exemple → import CSV → tri → bilan ; synchronisation WebRTC et relais entre deux contextes).
