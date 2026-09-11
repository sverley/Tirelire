# Tirelire — conventions pour les sessions d'assistant

- Langue : français partout (code, commentaires, commits, interface, docs).
- Lire `docs/description-projet.md` avant tout : le texte du porteur, mot pour mot, qui fait foi.
  Il ne se reformule pas ; seul le porteur le complète ou le corrige, avec ses mots, datés, ce qu'il
  retire restant barré.
- Lire ensuite `docs/invariants.md` : ce que le produit doit rester, tiré de la description. Une décision se prend au
  regard des invariants ; une demande qui en contredit un devient une question dans l'issue, pas
  une décision.
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

## Méthode de travail

- **L'issue définit le besoin, la PR définit la solution.**
- **Audit d'une PR.** Partir de l'issue. Si le besoin n'est pas clair ou appelle des questions, les
  poser et les consigner dans l'issue. Une fois le besoin explicite, éditer l'issue au début du
  travail pour la marquer en cours avec sa branche (titre préfixé `[audit en cours · <branche>]`),
  puis écrire les harnais qui contrôlent le résultat dans la branche de la PR associée. **En audit,
  ne jamais toucher au code** : seulement la documentation et les harnais.
- **Codage d'une PR.** Les questions de développement et les décisions techniques se consignent en
  commentaires dans la discussion de la PR.
- **Un `git worktree` par session** (audit, codage), pour que deux sessions ne partagent jamais un
  répertoire de travail (voir #22).
