# Tirelire — conventions pour les sessions d'assistant

- Langue : français partout (code, commentaires, commits, interface, docs).
- Lire `docs/decisions.md` avant de modifier le modèle, le plan, le dépôt ou la synchro ; toute
  décision nouvelle y est ajoutée, datée, sans réécrire les anciennes.
- Cœur (`packages/core`) sans dépendance à Svelte ni au navigateur ; tout calcul y est testé
  (vitest, `pnpm test`). L'interface (`apps/web`) ne fait qu'afficher et saisir.
- Montants en centimes entiers signés ; dates `AAAA-MM-JJ` ; `deletedAt` au lieu de supprimer ;
  jamais stocker ce qui se recalcule (soldes, plan, soldes à régler).
- Écritures uniquement via `LedgerStore.upsert/remove/setSetting` (journal de changements).
- Aucune donnée bancaire réelle dans le dépôt ; exemples et tests sur données inventées.
- Avant de pousser : `pnpm typecheck && pnpm test && pnpm build` (les hooks le font).
- Commits : un lot ou une décision par commit, message en français, corps explicatif.
- Simon lit surtout sur téléphone : réponses courtes, en prose, une question à la fois.
