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
- `docs` — analyse, formats d'import.

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
- **B · Import et pointage** : profils d'import (banque, Linxo), déduplication, doublons
  probables, transferts internes, pointage des flux prévus, ventilation, alertes.
- **C · Budgets et calibrage** : règles de catégorisation, file de tri, budget vs réel par
  période, moyennes glissantes, suggestions de cibles.
- Plus tard : synchronisation entre appareils (fichier d'échange, serveur privé, WebRTC).

## Conventions

- Montants en centimes (entiers), dates `AAAA-MM-JJ` sans fuseau.
- Jamais de suppression physique : `deletedAt`.
- Ce qui se recalcule ne se stocke pas (soldes, plan, soldes à régler).
- Aucun fichier bancaire réel dans le dépôt.
