# Prompt de reprise

À coller tel quel au début d'une nouvelle session (avec accès au dépôt GitHub `Sigmun/Tirelire`).

---

Tu reprends le projet **Tirelire** (dépôt `github.com/Sigmun/Tirelire`) : une application de
comptes de famille en TypeScript — cœur pur dans `packages/core`, PWA Svelte 5 dans `apps/web`,
emballage Android Capacitor dans `apps/web/android`, relais de synchronisation dans `apps/relay`
(branche `feature/sync-p2p`). Langue de travail : français, y compris code, commentaires,
commits et interface.

Avant toute chose, lis dans cet ordre : `README.md`, `docs/decisions.md` (D01 à D17, à respecter
ou à remplacer par une nouvelle entrée datée), `docs/architecture.md`, puis
`docs/analyse-du-besoin.html` si tu as besoin du raisonnement d'origine. `CLAUDE.md` à la racine
résume les conventions.

État au 6 septembre 2026 :

- Lots A (plan), B (import et rapprochement), C (bilan et calibrage) faits sur `main`, 55 tests
  verts, build OK, scénarios navigateur joués. Échange de changements par fichier sur `main`.
- Branche `feature/sync-p2p` : WebRTC à signalisation manuelle (QR / copier-coller), relais privé
  chiffré, table `devices`. Testée entre deux navigateurs, pas encore fusionnée dans `main`.
- CI (`.github/workflows/ci.yml`) : tests, build web, APK signé avec la clé de test, release
  `latest` à chaque push sur `main`, release nommée sur tag `v*`. **La partie Gradle n'a jamais
  tourné** (téléchargements Android bloqués dans la session précédente) : le premier run de CI
  est le vrai test ; corrige le workflow ou `apps/web/android` si besoin.
- Hooks git via simple-git-hooks (`pnpm install` les pose).

Premières actions attendues :

1. Vérifier que `main` et `feature/sync-p2p` sont bien sur GitHub (sinon les pousser depuis le
   bundle fourni), puis lancer le workflow et **faire passer la construction de l'APK**.
2. Ouvrir une pull request `feature/sync-p2p` → `main` avec résumé et points d'attention
   (`docs/synchronisation.md`), la fusionner si les tests passent.
3. Demander à Simon un export Linxo (à ne jamais versionner) pour figer un profil d'import
   Linxo dans `importer.ts` (aujourd'hui : profil générique détecté depuis les en-têtes).

Chantiers suivants, par valeur décroissante : compactage du journal de changements une fois
tous les pairs à jour ; import du second compte (les enfants) comme comptes d'accueil ou tiers
selon ce que Simon décide ; onboarding guidé (créer pivot, enveloppes, flux à partir d'un premier
import) ; tests d'interface (Playwright) dans la CI ; module natif Capacitor si le WebRTC local
ne suffit pas.

Règles de travail : ne jamais committer de données bancaires réelles (`*.csv`, `*.sqlite`
ignorés) ; tester avec `pnpm test`, `pnpm typecheck`, `pnpm build` avant de pousser ; commits
en français, un lot ou une décision par commit ; toute décision nouvelle va dans
`docs/decisions.md`. Simon travaille surtout depuis son téléphone : réponses concises, en prose,
et une question à la fois.

---
