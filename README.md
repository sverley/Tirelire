# Tirelire

Comptes de la famille : enveloppes budgétaires hébergées sur des comptes réels, provisions
pour les charges annuelles, objectifs d'épargne, plan de virements mensuels, comptes tiers
saisis à la main, et (lot B) rapprochement avec les relevés bancaires.

Nom de code. Analyse du besoin et décisions : [`docs/analyse-du-besoin.html`](docs/analyse-du-besoin.html).

## Structure

- `packages/core` — le cœur, en TypeScript pur, sans dépendance à l'interface :
  modèle, périodes de paie et année budgétaire, calcul du plan (croisière / rattrapage,
  financement par priorité, virements par compte et par enveloppe, règlements avec les
  comptes tiers), soldes reconstruits, dépôt SQLite (sql.js) avec journal de changements
  chaîné par empreinte et horloge logique hybride, prêt pour la synchronisation.
- `apps/web` — l'interface, PWA en Svelte 5 + Vite. Les données restent dans le
  navigateur (SQLite en WebAssembly, persisté dans IndexedDB), exportables en un fichier.
- `docs` — analyse du besoin, journal des décisions, architecture, formats d'import, prompt de reprise.

## Démarrer

```sh
pnpm install
pnpm test          # tests du cœur (vitest)
pnpm dev           # interface sur http://localhost:5173 (accessible sur le réseau local)
pnpm build         # apps/web/dist : fichiers statiques à servir sur un serveur privé
```

Dans l'interface, « Charger l'exemple » (écran d'accueil ou Réglages) installe le jeu de
données de l'analyse pour voir le plan tout de suite.

## Lots

- **A · Plan** (fait) : comptes, enveloppes, flux prévus, saisie manuelle, plan de période.
- **B · Import et pointage** (fait) : profils d'import CSV/Excel (banque multi-comptes, Linxo,
  générique), déduplication, doublons probables, virements internes, pointage des flux prévus
  avec propositions, ventilation, flux attendus non reçus.
- **C · Budgets et calibrage** (fait) : règles de classement créées depuis le tri, bilan par
  catégorie et par période, moyennes glissantes 3/6/12, cibles suggérées, provisions prévu vs payé.
- **Synchronisation** : paquets de changements par fichier sur `main` ; direct WebRTC (QR code)
  et relais privé chiffré sur la branche `feature/sync-p2p` (voir `docs/synchronisation.md`).

## Conventions

- Montants en centimes (entiers), dates `AAAA-MM-JJ` sans fuseau.
- Jamais de suppression physique : `deletedAt`.
- Ce qui se recalcule ne se stocke pas (soldes, plan, soldes à régler).
- Aucun fichier bancaire réel dans le dépôt.

## Android

L'application Android est le même code web emballé avec Capacitor (`apps/web/android`).

- À chaque push sur `main`, l'intégration continue construit l'APK et le publie dans la
  release GitHub **« Dernière version de test »** (tag `latest`, fichier `tirelire-latest.apk`).
  Installer l'APK sur le téléphone (autoriser les sources inconnues), puis chaque nouvelle
  version s'installe par-dessus la précédente : même clé de test (voir
  `apps/web/android/keystore/README.md`).
- Un tag `vX.Y.Z` produit une release nommée, avec notes générées.
- Pour une vraie clé de publication : renseigner les secrets `ANDROID_KEYSTORE_*` (voir le même README).

En local (Android Studio ou SDK installé) : `pnpm build && cd apps/web && npx cap sync android && npx cap open android`.

## Hooks git

`pnpm install` installe les hooks (simple-git-hooks) : `pre-commit` vérifie les types et lance
les tests du cœur ; `pre-push` construit l'application. Pour passer outre ponctuellement :
`git commit --no-verify`.
