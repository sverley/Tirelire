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
- Avant de pousser : `pnpm typecheck && pnpm test && pnpm build`. Les crochets en font l'essentiel :
  typecheck et tests du cœur, puis tests unitaires de la garde, au commit (moins de 20 s) ;
  typecheck complet et build au push. La CI joue tout, amorçage et harnais d'audit compris (D62).
- Commits : un lot ou une décision par commit, message en français, corps explicatif.
- Simon lit surtout sur téléphone : réponses courtes, en prose, une question à la fois.

## Méthode de travail

- **L'issue définit le besoin, la PR définit la solution.**
- **Audit d'une PR.** Partir de l'issue. Si le besoin n'est pas clair ou appelle des questions, les
  poser et les consigner dans l'issue. Une fois le besoin explicite, éditer l'issue au début du
  travail pour la marquer en cours avec sa branche (titre préfixé `[audit en cours · <branche>]`),
  puis écrire les harnais qui contrôlent le résultat dans la branche de la PR associée. **En audit,
  ne jamais toucher au code** : seulement la documentation et les harnais.
  Il s'en tient aux « Fait quand » et aux erreurs plausibles par accident : une forme exotique ou un
  contournement se note dans la PR, sans devenir un harnais rouge (D62).
- **Codage d'une PR.** Les questions de développement et les décisions techniques se consignent en
  commentaires dans la discussion de la PR.
- **Un `git worktree` par session** (audit, codage), pour que deux sessions ne partagent jamais un
  répertoire de travail (voir #22).
- **Choix techniques.** Une cible de distribution, une technologie ou un outil est un choix
  technique : il se consigne dans une issue de besoin, une par cible identifiée, jamais dans la
  description du projet ni dans les invariants. Il se traite le moment venu, au regard des
  invariants et de `docs/contraintes.md`.
- **Étiquettes GitHub.** `besoin` (issue qui définit un besoin), `cible` (cible de distribution),
  `harnais`, `objectif` (objectif du projet) ; `U1` à `U5`, `I…` et `C…` renvoient aux usages, invariants et contraintes qu'une
  issue sert.
- **Harnais et vérifications manuelles (objectif primaire #58, D61).** Chaque invariant et chaque
  contrainte est gardé par un harnais tant que c'est possible. Ce qui ne se programme pas fait
  l'objet, dans la PR, d'une demande explicite de vérification manuelle, faite avant tout merge :
  pour les invariants et contraintes que la PR touche, et pour ceux qui semblent hors de sa portée
  mais dont le lien pourrait être masqué. Dans le doute, on demande. Un agent peut préparer
  l'analyse d'une vérification ; seul un développeur humain la valide.
  - La correspondance se tient dans `docs/gardes.md`. Ajouter ou renommer un invariant, une
    contrainte ou un harnais met ce document à jour dans la même PR : `pnpm test` échoue sinon.
  - Toute PR remplit la section « Invariants et contraintes » de son modèle ;
    `node packages/gardes/cli.mjs demander --base <branche cible>` la prépare, consignes du registre
    recopiées, l'analyse reste à écrire. La vérification « Vérifications manuelles » reste rouge tant qu'une vérification
    demandée n'est pas analysée et validée.
  - Un agent ne coche jamais « Validée » sans une autorisation explicite de Simon pour cette
    vérification ; quand il la coche, il cite l'autorisation dans un commentaire de la PR. Il ne
    retire pas une garde pour faire passer une PR, et ne fusionne jamais une PR dont la vérification
    « Vérifications manuelles » est rouge.
  - Un test qui a besoin d'un outil (navigateur, PHP, `lftp`…) peut se sauter en local s'il manque,
    mais échoue quand `TIRELIRE_STRICT` est posé, comme en CI ; la CI installe ses outils.
  - Le crochet de pré-commit tient en moins de 20 s : l'amorçage et les harnais d'audit tournent en
    CI, pas au commit (D62).
  - Une validation vaut pour le code validé : un commit qui modifie le code, ou un changement de
    branche cible, l'annule et la vérification décoche la case ; documentation et harnais se
    modifient sans l'annuler. Une case décochée par la vérification ne se recoche qu'aux mêmes
    conditions ; sinon l'agent signale dans la PR que la validation est à refaire.
- **Dépendances.** Elles se tiennent à deux endroits, toujours d'accord : la section « Dépendances »
  de l'issue et les liens GitHub « bloquée par ». Qui recalcule l'une met l'autre à jour.
