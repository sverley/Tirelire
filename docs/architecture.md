# Architecture

## Vue d'ensemble

```
Tirelire/
├── packages/core/          cœur TypeScript pur (aucune dépendance à l'interface)
│   ├── src/model.ts        types du modèle, Ledger en mémoire, alive()
│   ├── src/dates.ts        dates civiles AAAA-MM-JJ sans fuseau
│   ├── src/periods.ts      périodes de paie, année budgétaire, périodicités
│   ├── src/money.ts        centimes : parsing et formatage français
│   ├── src/ids.ts          uuidv7, normalizeLabel, operationKey
│   ├── src/balances.ts     soldes reconstruits (enveloppes, comptes, non affecté, solde à régler)
│   ├── src/plan.ts         plan de période : croisière / rattrapage, priorités, virements
│   ├── src/csv.ts          décodage et parseur CSV
│   ├── src/importer.ts     profils d'import, lecture des lignes, clés, doublons
│   ├── src/matching.ts     virements internes, virements TIRELIRE, pointage, règles, pipeline
│   ├── src/review.ts       bilan par catégorie, calibrage, provisions prévu vs payé
│   ├── src/hlc.ts          horloge logique hybride
│   ├── src/schema.ts       définition des tables (une source pour SQL, lecture, écriture, journal)
│   ├── src/store.ts        dépôt sql.js : upsert/remove journalisés, applyRemote, chaîne d'empreintes
│   ├── src/sync.ts         protocole de synchronisation, paquets par fichier
│   └── src/example.ts      jeu de données de l'analyse
├── packages/banque/        connecteur bancaire Node (Enable Banking, DSP2) → CSV/JSON d'import
│   ├── src/jwt.ts          jeton d'application RS256
│   ├── src/enable-banking.ts  client minimal (banques, autorisation, session, opérations paginées)
│   ├── src/conversion.ts   opérations → ParsedRow → CSV reconnu par l'écran d'import
│   ├── src/sg.ts           profil Société Générale (particuliers)
│   └── src/cli.ts          banques | connecter | comptes | operations (état hors dépôt)
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
| `Envelope` | sous-compte comptable : `provision`, `goal`, `budget` ; hébergée sur un compte | UUID v7 |
| `Category` | classement des dépenses / revenus ; peut consommer un budget | UUID v7 |
| `PlannedFlow` | revenu, charge fixe, échéance payée par une enveloppe, virement attendu ; périodicité, fenêtre, tolérance, motif | UUID v7 |
| `Operation` | ligne de relevé (`imported`) ou saisie (`manual`) ; statut ; transfert ; flux pointé | clé déterministe ou UUID v7 |
| `Allocation` | ligne de ventilation : catégorie + enveloppe + montant | UUID v7 |
| `Rule` | motif → catégorie / enveloppe | UUID v7 |
| `ImportProfile` | colonnes, formats, correspondance des comptes | UUID v7 |
| `Device` (branche sync) | appareil et personne | siteId |
| `Settings` | année budgétaire, coussin, siteId | clé/valeur |

Montants en centimes entiers signés (négatif = débit). Dates `AAAA-MM-JJ`. Suppression = `deletedAt`.

## Conventions de signe

- `operation.amount` : signe bancaire du compte porteur.
- `allocation.amount` : part de l'opération, même signe.
- Effet sur l'enveloppe (`allocationEffect`) : `amount` pour une dépense/un revenu ; pour un
  virement interne, `+amount` si l'opération est lue côté compte hôte de l'enveloppe, `−amount` sinon.
- Solde à régler d'un compte tiers (`settlementBalance`) : positif = le pivot lui doit.

## Calcul du plan (`computePlan`)

1. Période contenant `asOf` ; revenus et charges fixes = occurrences des flux dans la période.
2. Par enveloppe : solde à `asOf`, croisière, rattrapage, demandé = max, plancher = rattrapage
   (provision) ou 0.
3. Financement : planchers par priorité, puis demandé par priorité, jusqu'à épuisement de
   revenus − charges fixes.
4. Virements par compte hors pivot : un ordre par enveloppe (permanent = croisière financée,
   exceptionnel = surplus), règlement des comptes tiers, surplus des comptes d'accueil.
5. Marge = revenus − charges fixes − financé ; avertissements (coussin, réductions, règlements bloqués).

## Pipeline d'import (`runPipeline`)

lecture (profil) → clés et doublons (`prepareImport`) → insertion → virements internes appariés
→ virements TIRELIRE → pointage automatique des flux sûrs → règles → file de tri (interface).

## Dépôt et synchronisation

`LedgerStore` (sql.js) : `upsert` journalise chaque colonne modifiée avec un HLC et une empreinte
chaînée ; `applyRemote` n'écrase une cellule que si l'horodatage reçu est plus récent
(`cell_versions`), conserve les entrées reçues pour les relayer, vérifie les empreintes.
`sync.ts` : protocole symétrique par curseurs, transport abstrait ; fichier JSON sur `main`,
WebRTC et relais sur `feature/sync-p2p`.

## Vérification

- `pnpm test` : 55 tests vitest sur le cœur (périodes, plan, soldes, dépôt, fusion, import, rapprochement, bilan, sync) ; test du relais sur la branche.
- `pnpm typecheck`, `pnpm build`.
- Scénarios navigateur joués avec Playwright pendant le développement (exemple → import CSV → tri → bilan ; synchronisation WebRTC et relais entre deux contextes).
