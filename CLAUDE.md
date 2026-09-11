# Tirelire — conventions pour les sessions d'assistant

- Langue : français partout (code, commentaires, commits, interface, docs).
- Lire `docs/description-projet.md` avant tout : le texte du porteur, mot pour mot, qui fait foi.
  Il ne se reformule pas ; seul le porteur le complète ou le corrige, avec ses mots, datés, ce qu'il
  retire restant barré.
- Lire ensuite `docs/invariants.md` : ce que le produit doit rester, tiré de la description. Une décision se prend au
  regard des invariants ; une demande qui en contredit un devient une question dans l'issue, pas
  une décision.
- Lire aussi `docs/contraintes.md` : ce que les plateformes imposent à une application multiplateforme
  qui doit rester simple ; tout choix technique la respecte.
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
- **Issue en cours.** Une session qui prend une issue (objectif, audit ou codage) lui pose
  l'étiquette `en cours` dès le début du travail ; le titre ne s'édite jamais pour cela. L'étiquette
  est retirée d'elle-même à la fermeture de l'issue (`.github/workflows/etiquette-en-cours.yml`).
- **Objectif.** Méta-analyse, en chef de projet : analyser les besoins (issues) et les dépendances
  qui mènent à l'objectif, sur la documentation seulement, sans analyser le code. Si l'objectif
  n'est pas assez clair, poser la question et la consigner dans la discussion de l'issue d'objectif.
  En fin d'objectif, consigner les nouvelles fonctionnalités dans la documentation du dépôt, par une
  PR.
- **Audit d'une PR.** Partir de l'issue. Si le besoin n'est pas clair ou appelle des questions, les
  poser et les consigner dans l'issue. Une fois le besoin explicite, indiquer la branche de travail
  dans le corps de l'issue, puis écrire les harnais qui contrôlent le résultat dans la branche de la
  PR associée. **En audit, ne jamais toucher au code** : seulement la documentation et les harnais.
- **Codage d'une PR.** Les questions de développement et les décisions techniques se consignent en
  commentaires dans la discussion de la PR.
- **Un `git worktree` par session** (audit, codage), pour que deux sessions ne partagent jamais un
  répertoire de travail (voir #22).
- **Sessions Claude Chat.** Regrouper les commandes en peu d'appels d'outils, pour ne pas atteindre
  trop vite les limites d'usage.
- **Choix techniques.** Une cible de distribution, une technologie ou un outil est un choix
  technique : il se consigne dans une issue de besoin, une par cible identifiée, jamais dans la
  description du projet ni dans les invariants. Il se traite le moment venu, au regard des
  invariants et de `docs/contraintes.md`.
- **Étiquettes GitHub.** `besoin` (issue qui définit un besoin), `cible` (cible de distribution),
  `harnais`, `objectif` (objectif du projet) ; `U1` à `U5`, `I…` et `C…` renvoient aux usages, invariants et contraintes qu'une
  issue sert.
- **Harnais et vérifications manuelles (objectif primaire #58).** Chaque invariant et chaque
  contrainte est gardé par un harnais tant que c'est possible. Ce qui ne se programme pas fait
  l'objet, dans la PR, d'une demande explicite de vérification manuelle, faite avant tout merge :
  pour les invariants et contraintes que la PR touche, et pour ceux qui semblent hors de sa portée
  mais dont le lien pourrait être masqué. Dans le doute, on demande. Un agent peut préparer
  l'analyse d'une vérification ; seul un développeur humain la valide.
- **Dépendances.** Elles se tiennent à deux endroits, toujours d'accord : la section « Dépendances »
  de l'issue et les liens GitHub « bloquée par ». Qui recalcule l'une met l'autre à jour.
