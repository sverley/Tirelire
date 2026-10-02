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
│   ├── src/balances.ts     positions reconstruites (composantes par compte, besoins, dotations, demande d'une période répartie par placement, non affecté, solde à régler, état d'une tirelire)
│   ├── src/plan.ts         plan de période : croisière, lissage décidé, rattrapage d'un déficit, priorités, virements
│   ├── src/forecast.ts     solde prévu d'une période à venir : opérations prévues en mémoire, mouvements et origines, manque
│   ├── src/shortfall.ts    manque d'une échéance, proposition de lissage, réponse (lissage retenu ou refus)
│   ├── src/csv.ts          décodage et parseur CSV
│   ├── src/importer.ts     profils d'import, lecture des lignes, clés, doublons
│   ├── src/matching.ts     virements internes, virements par compte, reprise (sélection des flux, saisies reprises, corrections), pipeline
│   ├── src/automations.ts  moteur d'automatismes, aperçu, actions groupées
│   ├── src/suboperations.ts  sous-opérations à tous les niveaux : parts par division, lignes comptées avec ce qui vaut pour elles, sous-opérations vivantes
│   ├── src/edit.ts         édition manuelle : verrouillage, division à parts d'un niveau, à tout niveau
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
| `PlannedFlow` | revenu, charge fixe, échéance payée par une tirelire, virement attendu ; périodicité ; sa seule sélection (compte, motif, tolérance, fenêtre, D24) ; verrouiller ce qu'il reprend | UUID v7 |
| `Operation` | ligne de relevé (`imported`) ou saisie (`manual`) ; état (non traitée / rapprochée / verrouillée) ; transfert ; ce qu'elle reprend (D88) : une opération prévue, désignée par son flux et sa date (`plannedFlowId`, `plannedDate`), ou une saisie (`resumedOperationId`) | clé déterministe ou UUID v7 |
| `SubOperation` | sous-opération (D88) : part (fixe, pourcentage, variable) du niveau qui la contient — l'opération, ou une sous-opération (`parentId`) —, catégorie, tirelire, renflouement, date propre (une part de lissage) ; se divise à son tour, sans limite de niveaux | UUID v7 |
| `ShortfallAnswer` | réponse au manque d'une échéance (D88, #184) : besoin, date de l'échéance, saisie du lissage retenu (absente pour un refus) ; une par échéance | `reponse:<besoin>:<date>` |
| `Automation` | sélection + action à champs facultatifs + rang (clé triable) + validité | UUID v7 |
| `ImportProfile` | colonnes, formats, correspondance des comptes | UUID v7 |
| `Device` (branche sync) | appareil et personne | siteId |
| `Settings` | coussin du compte principal, seuil de virement, siteId | clé/valeur |

Montants en centimes entiers signés (négatif = débit). Dates `AAAA-MM-JJ`. Suppression = `deletedAt`.
Dans le fichier, chaque table et chaque colonne porte le nom du domaine, la propriété en snake_case
(`tirelires`, `tirelire_id`, `planned_date`) ; le libellé normalisé d'une opération se recalcule
à la lecture (D58).

## Conventions de signe

- `operation.amount` : signe bancaire du compte porteur.
- Sous-opération : une part du niveau qui la contient (fixe, pourcentage du montant de ce niveau, ou
  variable = le reste, une par division), résolue par `resolveShares`, dans le signe de
  l'opération. Ce qu'elle ne porte pas (catégorie, tirelire, renflouement), elle le prend du niveau
  qui la contient, de proche en proche.
- Tout ce qui lit la ventilation lit les **lignes comptées** (`countedLines`, `linesByOperation`) :
  les sous-opérations qui ne se divisent plus, et le reste d'une division que ses parts ne couvrent
  pas, qui garde ce qui vaut pour le niveau divisé ; leur somme est le montant de l'opération, si
  bien qu'aucun euro ne compte deux fois. Une ligne sans tirelire reste sur le compte réel : c'est
  le non affecté (D29).
- Effet sur la tirelire (`lineEffects`, D19) : le montant d'une ligne comptée sur le compte de
  l'opération ; pour un virement interne, aussi son opposé sur le compte de contrepartie — la
  composante se déplace, le solde ne bouge pas.
- Solde à régler d'un compte tiers (`settlementBalance`) : positif = le compte principal lui doit.

## Calcul du plan (`computePlan`)

0. Deux dates (D52) : `asOf`, la période regardée, et `today`, jusqu'où les soldes sont connus.
   Pour une période à venir, le plan montre le **solde prévu** (`computeForecast`, `forecast.ts`,
   D88) de chaque compte réel et de chaque tirelire à la fin de la période : le solde réel à
   `today`, plus les opérations saisies à une date future et les opérations prévues qui comptent
   jusque-là. Les opérations prévues des flux (virements permanents enregistrés compris) s'ajoutent
   en mémoire au grand livre (`withPlannedOperations`), et les soldes se lisent avec les fonctions
   de `balances.ts` ; les dotations d'une tirelire (D29) y comptent comme des opérations prévues sur
   elle. Ce qui compte se décide par `flowOccurrencesThatCount` (`matching.ts`) : une occurrence
   reprise — son flux et sa date, `Operation.plannedFlowId` et `plannedDate` — ne compte plus ; sur un compte suivi, une occurrence dont la
   fenêtre (D12) est passée sans reprise non plus ; sur un compte sans suivi, chaque occurrence
   compte à sa date. Le même calcul fait le bloc « Attendus, non reçus » (`missingFlows`), seul
   endroit où une occurrence non reçue se signale. Un virement proposé mais non enregistré n'a pas
   de flux et ne compte pas. Les lignes d'une période à venir et leurs écarts de placement (étapes
   2 à 4) se calculent sur ce même grand livre prévu : la dotation qu'une tirelire reçoit dans son
   solde prévu est celle que sa ligne demande. Les occurrences de l'ordre permanent (étape 5) et le
   non affecté du compte principal se lisent sur le grand livre reçu. Chaque mouvement porte son
   origine (flux, dotation, libération, saisie…) ; un solde prévu négatif est un **manque**, daté
   et chiffré au point le plus bas de la période. Rien ne s'enregistre (I10). La période où l'on
   lit se lit sur le réel.
1. Période contenant `asOf` ; revenus et charges fixes = occurrences des flux dans la période.
2. Par besoin (D28) : part du solde de la tirelire qui lui revient (ordre des priorités), croisière,
   rattrapage d'un déficit, dotation. Une échéance demande sa croisière plus la part d'un lissage
   décidé datée dans la période, et rien d'autre ; son plancher est ce qu'elle demande (D06, D88).
   Rien ne se lisse d'office : ce qui ne sera pas réuni à temps est un **manque**, le solde prévu
   négatif de la tirelire à la date de l'échéance (`dueDateShortfalls`), annoncé avec la proposition
   de le lisser tant que l'échéance n'a pas de réponse (#184).
3. Lecture du financement (D06) : planchers par priorité, puis dotations, dans la limite de
   revenus − charges fixes. Une dotation reste acquise même non couverte ; le plan le dit.
4. Écarts de placement (D20) : composantes hors du compte de placement, marquées « à faire »
   au-dessus du seuil, « à surveiller » en dessous. Sur une période à venir, l'écart est la seule
   demande de la période, répartie par placement sur le solde de la tirelire (`periodDemand`, D52) :
   ni position lue, ni virement supposé fait.
5. Virements : un par couple de comptes (D21), détaillé par tirelire, plus règlements des tiers
   et surplus des comptes d'accueil dans la période où l'on lit ; avec suivi des opérations, les
   occurrences de l'ordre permanent dans la période, lues sur son flux (`flowOccurrences`, D12).
6. Marge = revenus − charges fixes − financé ; avertissements (coussin, réductions, règlements bloqués).

## États d'une opération (D22)

`untreated` (aucune règle ne l'a vue) → `reconciled` (posée par une règle ou par l'import, reprise
à chaque passage) → `locked` (vérité, plus aucune règle ne l'atteint). Toute modification manuelle
verrouille (`edit.ts`) ; seul l'utilisateur déverrouille, à l'unité ou par action groupée.

## Moteur d’automatismes (`automations.ts`, D23)

Les règles se rejouent du rang le plus élevé au rang 1 sur les opérations non verrouillées : chaque
champ renseigné écrase, les champs vides laissent en place, le rang tranche. Le calcul repart de ce
que l'import a établi (D33), jamais de rien. `previewRules` donne l'avant/après sans écrire ;
`applyBulkAction` fait la même chose sur une sélection, avec en plus le déverrouillage (D26). Une
règle ou une action groupée qui écrit la ventilation la remplace à tous ses niveaux par une seule
division ; une ventilation que l'import a établie et qu'aucune règle n'écrit reste entière.

## Sous-opérations (D88)

Une opération se divise en sous-opérations (`SubOperation`, table `sub_operations`), chacune
pouvant se diviser à son tour, sur autant de niveaux qu'on veut. Une sous-opération est vivante si
elle n'est pas supprimée et que chaque niveau qui la contient l'est aussi (`liveSubOperations`).
`editDivision` remplace une division, celle de l'opération ou d'une sous-opération, verrouille
l'opération (D22), n'écrit que les sous-opérations qui changent et retire, avec une sous-opération,
tout ce qu'elle contient. À la réception (`LedgerStore.receive`), une sous-opération restée sous un
niveau retiré par une autre instance est retirée à son tour, datée de la suppression de ce niveau.

## Reprise (D88)

Une opération en reprend au plus une autre : une opération prévue, désignée par son flux et sa date
(`plannedFlowId`, `plannedDate`), ou une saisie (`resumedOperationId`) ; le fichier refuse le reste
(`operations.reprise`). L'opération reprise ne compte plus : les soldes, réels et prévus, et les
totaux lisent `countedOperations` (`model.ts`), par `indexLedger` et `accountBalance` ; une
occurrence reprise sort du solde prévu et d'« Attendus, non reçus » (`flowOccurrences`).

- La sélection d'un flux, la seule (D24, `proposeMatches`) : compte, motif de libellé, tolérance de
  montant, fenêtre de ses occurrences ; automatique selon D12, proposée sinon. Une occurrence
  qu'une saisie corrige ou masque se reprend par cette saisie.
- `applyMatch` : la reprise d'une occurrence (ou de la saisie qui la corrige), rapprochée,
  verrouillée si le flux le demande (`PlannedFlow.locks`), avec la ventilation du flux si
  l'opération n'en a pas — rejouée par l'ordre de financement pour un virement permanent dérivé.
- `entryCandidates`, `resumeEntry` : les saisies non reprises du même compte et du même sens, les
  plus proches en date puis en montant, reprises sur validation, avec leur ventilation.
- `correctPlannedOperation` : corriger une opération prévue, ou la masquer (montant nul), par une
  saisie verrouillée qui la reprend ; un virement corrigé a ses deux côtés.
- `resumptionOf` dit ce qu'une opération reprend et l'écart ; `undoResumption` défait la reprise.

## Pipeline d'import (`runPipeline`)

lecture (profil) → clés et doublons (`prepareImport`) → insertion → virements internes appariés
→ virements par compte (libellé TIRELIRE, ventilés par l'ordre de financement) → reprise
automatique des occurrences sûres (D12) → moteur de règles → file de tri (interface).

## Dépôt et synchronisation

`LedgerStore` (sql.js) : le fichier est un état (D58). `upsert`, `remove` et `setSetting`
réécrivent la ligne entière avec une nouvelle horloge ; `receive` fusionne des lignes venues d'une
autre instance, la plus récente gagne, et rend l'écartée d'un conflit sans la garder. Ce qui décrit l'instance
(`InstanceState`) n'est pas dans le fichier : `apps/web/src/lib/db.ts` le garde à côté.
`sync.ts` : protocole symétrique par delta d'état, transport abstrait ; fichier JSON, WebRTC,
relais Node (`apps/relay`) et relais PHP servi avec la PWA (`apps/hebergement`). Détail :
`docs/synchronisation.md`.

## Vérification

- `pnpm test` : les tests vitest du cœur (périodes, plan, positions et invariants, besoins,
  report, états et filtre, dépôt, fusion, import, rapprochement, règles, ventilation à parts,
  bilan, sync, sous-opérations), plus les gardes de navigateur de `apps/web/test/navigateur/`, sur le harnais commun
  `apps/web/test/harnais.ts`.
- `pnpm typecheck`, `pnpm build`.
- Scénarios navigateur joués avec Playwright pendant le développement (exemple → import CSV → tri → bilan ; synchronisation WebRTC et relais entre deux contextes).
