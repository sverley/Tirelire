# Tirelire

Comptes de la famille : des tirelires réparties sur les comptes réels, portant leurs besoins
(charges récurrentes, échéances, objectifs), un plan de virements mensuels, des comptes tiers
saisis à la main, l'import des relevés et un moteur de règles pour les classer.

Nom de code. Description du projet, qui fait foi : [`docs/description-projet.md`](docs/description-projet.md) ;
ce que le produit doit rester : [`docs/invariants.md`](docs/invariants.md) ;
ce que les plateformes imposent : [`docs/contraintes.md`](docs/contraintes.md) ;
ce qui les garde : [`docs/gardes.md`](docs/gardes.md) ;
le vocabulaire, du produit comme du travail : [`docs/glossaire.md`](docs/glossaire.md) ;
les choix de mise en œuvre : [`docs/decisions.md`](docs/decisions.md).

Seuls les fichiers Markdown de `docs/` sont fondateurs.

## Structure

- `packages/core` — le cœur, en TypeScript pur, sans dépendance à l'interface :
  modèle, périodes de paie, calcul du plan (croisière / rattrapage, financement par priorité des
  besoins, écarts de placement, virements par couple de comptes, règlements avec les comptes
  tiers), positions reconstruites par compte, moteur de règles et actions groupées, dépôt SQLite
  (sql.js) avec journal de changements chaîné par empreinte et horloge logique hybride.
- `packages/gardes` — la garde du chantier primaire (#58) : chaque invariant et chaque
  contrainte a son harnais ou sa vérification manuelle (`pnpm test`), et l'issue de chaque PR déclare les siennes.
- `apps/web` — l'interface, PWA en Svelte 5 + Vite. Les données restent dans le
  navigateur (SQLite en WebAssembly, persisté dans IndexedDB), exportables en un fichier.
- `docs` — description du projet, invariants du produit, contraintes du projet, analyse du besoin, journal des décisions, architecture, formats d'import, prompt de reprise.

## Démarrer

```sh
pnpm install
pnpm test          # tests du cœur (vitest) + garde de mise en page mobile si un Chrome est installé
pnpm dev           # interface sur http://localhost:5173 (accessible sur le réseau local)
pnpm build         # apps/web/dist : fichiers statiques à servir sur un serveur privé
pnpm --filter @tirelire/hebergement assembler   # apps/hebergement/dist : site + relais PHP pour hébergement mutualisé
```

Dans l'interface, « Charger l'exemple » (écran d'accueil ou Réglages) installe le jeu de
données de l'analyse pour voir le plan tout de suite.

## Lots

- **A · Plan** (fait) : comptes, tirelires, flux prévus, saisie manuelle, plan de période.
- **B · Import et rapprochement** (fait) : profils d'import CSV/Excel (banque multi-comptes, Linxo,
  générique), déduplication, doublons probables, virements internes, rapprochement des flux prévus
  avec propositions, ventilation, flux attendus non reçus.
- **C · Budgets et calibrage** (fait) : règles de classement créées depuis le tri, bilan par
  catégorie et par période, moyennes glissantes 3/6/12, cibles suggérées, provisions prévu vs payé.
- **Synchronisation** : paquets de changements par fichier, direct WebRTC (QR code) et relais
  privé chiffré (voir `docs/synchronisation.md`).
- **Hébergement web mutualisé** : la PWA et son relais en PHP à déposer par FTP sur un
  hébergement Apache + PHP (OVHcloud sans VPS), dépôt FTP automatique dès que les secrets
  `OVH_FTP_*` existent dans le dépôt, archive `tirelire-hebergement.zip` jointe aux
  releases (voir `docs/hebergement-web.md`).

## Conventions

- Montants en centimes (entiers), dates `AAAA-MM-JJ` sans fuseau.
- Jamais de suppression physique : `deletedAt`.
- Ce qui se recalcule ne se stocke pas (positions, dotations, plan, soldes à régler).
- La vérité est ce qui est verrouillé ; le reste, les règles le reprennent.
- Aucun fichier bancaire réel dans le dépôt.

## Android

L'application Android est le même code web emballé avec Capacitor (`apps/web/android`).

- L'application web est la distribution prioritaire (#45) : chaque chantier s'y livre et s'y
  vérifie, sur Chrome, avant d'être porté ailleurs. L'APK n'est vérifié que par sa construction.
- Un tag `vX.Y.Z` construit l'APK et produit une release nommée, avec notes générées ; rien ne se
  construit pour Android à un push ni sur une PR.
- Installer l'APK sur le téléphone (autoriser les sources inconnues) ; chaque nouvelle version
  s'installe par-dessus la précédente : même clé de test (voir `apps/web/android/keystore/README.md`).
- Pour une vraie clé de publication : renseigner les secrets `ANDROID_KEYSTORE_*` (voir le même README).

En local (Android Studio ou SDK installé) : `pnpm build && cd apps/web && npx cap sync android && npx cap open android`.

## Crochets git

Les crochets sont des scripts suivis dans `.githooks/`. Ils s'activent une fois par clone, après
`pnpm install` (qui n'y touche pas) :

```sh
pnpm crochets   # core.hooksPath = .githooks, merge.ff = false
```

Les crochets joués sont alors ceux de la branche extraite, dans chaque worktree. Ce que joue chaque
niveau :

- **pré-commit**, moins de 5 s, sur la copie de travail : les tests des paquets que touchent les
  fichiers du commit — cœur ; garde ou règles (décisions, description du projet, invariants,
  contraintes, `CLAUDE.md`) ; relais ; hébergement. Rien pour la seule
  documentation, l'interface ou la configuration. Parmi ces tests, la **non-régression** bloque :
  un test existant en échec refuse le commit. Le **harnais du besoin** — les fichiers de test que la
  branche ajoute ou modifie depuis sa base commune avec `origin/main` — est joué, et le crochet en
  affiche le verdict sans bloquer ; c'est la livraison qui le bloque. Seule une erreur de
  syntaxe dans un harnais refuse le commit ; un import introuvable est affiché à part, avec le module
  qui manque. Sur `main`, ou sans `origin/main`, tout test est non-régression. Un script de
  test absent fait échouer le crochet ; un outil manquant (PHP, `lftp`…) fait sauter le test qui en
  a besoin, avec un message.
- **pré-fusion** (`pre-merge-commit`, et le pré-commit pendant un conflit) et **pré-push** : la
  livraison, jugée sur l'état commis — l'index ou le commit poussé, jamais la copie de travail.
  - La nature du besoin se lit aux fichiers modifiés des deux côtés, comparés à
    `packages/gardes/chemins-ignores` : **fonctionnel** (typecheck et tests headless des paquets
    touchés, tests headless de l'interface ; objectif 30 s) ou **organisationnel** (garde et tous les
    garde ; objectif 45 s), ou les deux. Les tests navigateur (`apps/web/test/navigateur/`)
    restent à la CI. Un dépassement de plus de 20 % s'affiche, sans bloquer.
  - Le harnais du besoin est toujours joué, à part et hors objectif. Il **bloque** quand ce qui arrive
    apporte du code (un fichier hors de `**/test/**`, `**/*.test.*`, `docs/**`, `**/*.md`) ; sinon
    son verdict s'affiche. La non-régression bloque toujours.
  - Le pré-push ne rejoue pas un arbre déjà vérifié à la fusion. Un push vers une sous-branche
    (`<branche>--codeur`, `<branche>--auditeur`) ne joue que la non-régression.
- **CI** : au passage en Ready de chaque PR, jamais en brouillon, typecheck, tests (navigateur compris), build, en mode strict
  (`TIRELIRE_STRICT`) : un outil manquant fait échouer le job.

`git commit --no-verify` est un contournement : il fait sauter la non-régression avec le
reste, et aucune consigne ne le propose. Un harnais rouge ne le justifie pas : il ne bloque pas le
commit.
