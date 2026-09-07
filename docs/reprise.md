# Prompt de reprise — alignement du code sur les décisions D19 à D28

À coller tel quel au début d'une nouvelle session (avec accès au dépôt GitHub `sverley/Tirelire`).

---

Tu reprends le projet **Tirelire** (dépôt `github.com/sverley/Tirelire`) : une application de
comptes de famille en TypeScript — cœur pur dans `packages/core`, PWA Svelte 5 dans `apps/web`,
emballage Android Capacitor dans `apps/web/android`, relais de synchronisation dans `apps/relay`
(branche `feature/sync-p2p`). Langue de travail : français, y compris code, commentaires, commits
et interface.

Avant toute chose, lis dans cet ordre : `README.md`, `docs/decisions.md` (**D01 à D28**),
`docs/architecture.md`, puis `docs/analyse-du-besoin.html` si tu as besoin du raisonnement
d'origine. `CLAUDE.md` à la racine résume les conventions.

## Ce qui a changé et pourquoi cette session existe

Les décisions **D19 à D28**, prises le 7 septembre 2026, ont été discutées et écrites mais **le code
n'a pas encore bougé** : il implémente toujours le modèle D01–D18. Ta mission est de mesurer puis de
résorber cet écart. Elles touchent le modèle de données, pas seulement l'interface, donc le travail
n'est pas cosmétique.

Résumé de l'écart attendu, à vérifier plutôt qu'à croire :

- **D19** : une enveloppe n'a plus un compte hôte mais une répartition par compte, avec composantes
  négatives autorisées. `Envelope.accountId` disparaît, `balances.ts` doit rendre un vecteur, et le
  second invariant (par compte) doit être testé aussi bien que le premier.
- **D20** : chaque enveloppe déclare un placement voulu ; l'écart au réel alimente le plan sans
  jamais être corrigé d'office.
- **D21** : un virement permanent unique par couple de comptes, à ventilation calculée d'avance ;
  répartition du montant constaté par l'ordre de financement de D06. Revoir `transferLabel` et
  `matchEnvelopeTransfers` (`matching.ts`), qui raisonnent aujourd'hui par enveloppe.
- **D22** : trois états d'opération (non traitée / rapprochée / verrouillée) ; la vérité est ce qui
  est verrouillé. Le mot « pointage » de D12 devient « rapprochement de flux » : renommer partout,
  y compris tests et interface, sans laisser cohabiter les deux sens.
- **D23, D24, D26** : moteur de règles (sélection, action à champs facultatifs, rang unique,
  application du rang le plus élevé au rang 1), règles engendrées par les flux et archivées par
  période de validité, actions groupées manuelles. Rien de tout cela n'existe aujourd'hui.
- **D25** : supprimer `settings.budgetYearStart` et tout ce qui en dépend.
- **D27** : ventilation à parts (fixe, pourcentage, variable), avec ligne variable unique par défaut
  sur toute opération. Retoucher le modèle `Allocation` et `allocationEffect`.
- **D28** : l'enveloppe perd son type (`Envelope.kind`) et porte des besoins multiples ; les
  priorités de D06 se posent sur les besoins.

## Première action attendue

Ne refactore rien avant d'avoir produit un **rapport d'écart** : pour chaque décision D19 à D28, ce
que fait le code aujourd'hui, ce qu'il faudrait changer, les fichiers touchés, une estimation de
risque. Propose ensuite un découpage en lots livrables indépendamment, du plus structurant au plus
cosmétique, et **fais valider le découpage par Simon avant d'écrire du code**. Si une décision se
révèle inapplicable ou contradictoire avec une autre à l'épreuve du code, ne la contourne pas
silencieusement : signale-la et propose une entrée `D29…` qui la remplace.

Attends-toi à ce que la migration des données existantes soit un sujet à part entière : le journal
de changements de D08 contient des lignes écrites sous l'ancien modèle.

## État du dépôt au 7 septembre 2026

- `main` : lots A (plan), B (import et rapprochement), C (bilan et calibrage), plus le panneau de
  catégories et le numéro de compte mémorisable (D18). 64 tests dans `packages/core/test`. Ces tests
  encodent l'ancien modèle : beaucoup devront changer, c'est normal, mais chaque changement de test
  doit être justifié par une décision, jamais par la commodité.
- Cœur (`packages/core/src`) : `balances.ts`, `plan.ts`, `matching.ts`, `review.ts`, `importer.ts`,
  `periods.ts`, `model.ts`, `schema.ts`, `store.ts`, `sync.ts`, `csv.ts`, `dates.ts`, `hlc.ts`,
  `ids.ts`, `money.ts`.
- Branches non fusionnées, toutes en retard sur `main` : `feature/sync-p2p` (WebRTC à signalisation
  manuelle, relais chiffré, table `devices`), `feature/serveur-web`, `feature/connecteur-banque`,
  `feature/assistant-configuration`, `etude/apprentissage-classification`,
  `etude/synchronisation-bancaire`. Décider avec Simon lesquelles rebaser ou abandonner **avant** le
  refactor : après, elles seront très coûteuses à récupérer.
- CI (`.github/workflows/ci.yml`) : tests, build web, APK signé avec la clé de test, release
  `latest` à chaque push sur `main`, release nommée sur tag `v*`. Vérifier que la construction de
  l'APK passe.
- Hooks git via simple-git-hooks (`pnpm install` les pose).
- Toujours en attente : un export Linxo de Simon, à ne jamais versionner, pour figer un profil
  d'import dans `importer.ts`.

Chantiers suivants, après l'alignement : compactage du journal de changements une fois tous les
pairs à jour ; import du second compte (les enfants) ; onboarding guidé, qui devra s'appuyer sur
l'inférence de filtre depuis une sélection (D26) ; tests d'interface Playwright dans la CI.

## Règles de travail

Ne jamais committer de données bancaires réelles (`*.csv`, `*.sqlite` ignorés). Tester avec
`pnpm test`, `pnpm typecheck`, `pnpm build` avant de pousser. Commits en français, un lot ou une
décision par commit. Toute décision nouvelle va dans `docs/decisions.md`, datée, en remplacement
plutôt qu'en réécriture. Simon travaille surtout depuis son téléphone : réponses concises, en prose,
et **une seule question à la fois**.

---
