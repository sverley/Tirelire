# Prompt de reprise

À coller tel quel au début d'une nouvelle session (avec accès au dépôt GitHub `sverley/Tirelire`).

---

Tu reprends le projet **Tirelire** (dépôt `github.com/sverley/Tirelire`) : une application de
comptes de famille en TypeScript — cœur pur dans `packages/core`, PWA Svelte 5 dans `apps/web`,
emballage Android Capacitor dans `apps/web/android`, relais de synchronisation dans `apps/relay`.
Langue de travail : français, y compris code, commentaires, commits et interface.

Avant toute chose, lis dans cet ordre : `README.md`, `docs/decisions.md` (**D01 à D34**),
`docs/architecture.md`, puis `docs/analyse-du-besoin.html` si tu as besoin du raisonnement
d'origine. `CLAUDE.md` à la racine résume les conventions. **`docs/plan-sessions.md` dit quoi
faire ensuite, dans quel ordre, et à quoi on reconnaît qu'un lot est fini** : commence par là.

## État au 7 septembre 2026

L'alignement du code sur les décisions D19 à D28 est **fait** sur `main`, en cinq commits (lots 0
à 4), avec 102 tests verts, typecheck et build OK. Ce qui a changé :

- **Enveloppes** : plus de compte hôte ni de type. Une enveloppe est un pot à solde unique réparti
  sur les comptes (`envelopeComponents`, composantes négatives comprises), qui déclare un placement
  voulu et porte des besoins (`needs` : récurrent, échéance, objectif) avec leurs priorités. Les
  deux invariants de D19 sont testés.
- **Opérations** : trois états (non traitée, rapprochée, verrouillée), « ponctuelle » devenue un
  attribut, ventilation à parts (fixe, pourcentage, variable). Toute écriture manuelle passe par
  `edit.ts` et verrouille.
- **Règles** (`rules.ts`) : sélection + action à champs facultatifs + rang triable, rejouées du
  rang le plus élevé au rang 1 sur les opérations non verrouillées, aperçu avant/après, actions
  groupées avec déverrouillage, inférence de filtre depuis une sélection, règles engendrées par
  les flux et archivées par période de validité.
- **Virements** : un permanent par couple de comptes, enregistrable comme flux attendu avec sa
  ventilation prévue ; à montant différent, la répartition rejoue l'ordre de financement.
- **Migrations** (`migration.ts`) : versions 1 → 4, écrites par `upsert` donc propagées par le
  journal, idempotentes, testées sur un journal écrit au modèle 1. Lancées à l'ouverture du dépôt.

Décisions ajoutées en cours de route, à lire avant de toucher au modèle : **D29** (report par
libération), **D30** (colonnes dépréciées et version de modèle), **D31** (rang = clé triable),
**D32** (enveloppe par défaut d'une catégorie), **D33** (le moteur part de ce que l'import a
établi), **D34** (la migration verrouille ce que rien ne reproduit), **D36** (le filtre de
recherche est la sélection d'une règle).

## Ce qui reste

Un audit du 7 septembre a montré que le modèle et le moteur sont au niveau des décisions, mais
que l'interface ne l'est pas : le moteur de règles ne tourne qu'à l'import, aucun écran ne permet
de créer ou d'ordonner une règle, le filtre des Opérations n'a rien à voir avec la sélection d'une
règle (D36), et le seuil de D20 n'est réglable nulle part. `docs/plan-sessions.md` découpe la
suite en lots 6 à 11, à prendre dans l'ordre : le lot 6 (filtrer, agir, régler) et le lot 7
(écran Règles) débloquent le reste.

Restent aussi :

1. **Rejouer les scénarios navigateur** : l'interface a beaucoup bougé (Enveloppes, Plan,
   Opérations, Flux, Bilan) et n'a aucun test automatisé — c'est le lot 9.
2. **Branches non fusionnées**, toutes en retard sur `main` et à décider avec Simon :
   `feature/connecteur-banque` (Enable Banking), `feature/assistant-configuration`
   (**obsolète** : elle crée des enveloppes typées, à refaire plutôt qu'à rebaser),
   `etude/apprentissage-classification`, `etude/synchronisation-bancaire`. La première porte
   un « D18 » qui entre en collision avec celui de `main` : à renuméroter à partir de D37.
   (`feature/serveur-web` a été rebasée, renumérotée D35 et fusionnée le 7 septembre.)
4. **Export Linxo** de Simon, à ne jamais versionner, pour figer un profil d'import.
5. Chantiers suivants : compactage du journal de changements ; import du second compte (les
   enfants) ; onboarding guidé, qui s'appuiera sur l'inférence de filtre (D26) ; tests
   d'interface Playwright dans la CI.

## Accès GitHub

Normalement la session reçoit ses droits parce que le dépôt lui est rattaché. Le jeton d'accès
personnel qui figurait dans la version précédente de ce document **doit être considéré comme
compromis** (il a circulé en clair) : demander à Simon de le révoquer s'il ne l'a pas fait.

## Règles de travail

Ne jamais committer de données bancaires réelles (`*.csv`, `*.sqlite` ignorés). Tester avec
`pnpm test`, `pnpm typecheck`, `pnpm build` avant de pousser. Commits en français, un lot ou une
décision par commit. Toute décision nouvelle va dans `docs/decisions.md`, datée, en remplacement
plutôt qu'en réécriture. Simon travaille surtout depuis son téléphone : réponses concises, en
prose, et **une seule question à la fois**.

---
