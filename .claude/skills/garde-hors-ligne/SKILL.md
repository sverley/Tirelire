---
name: garde-hors-ligne
description: Joue la garde hors ligne (node packages/gardes/cli.mjs pr) sur le corps de l'issue d'un besoin de Tirelire, lu en entier par l'API REST. À charger quand le rôle demande de jouer la garde, au codeur comme à l'auditeur.
---

# Jouer la garde hors ligne

Ce skill dit comment ; ce que le rôle fait du verdict est dans `docs/roles/` (codeur, étape 2 ;
auditeur, étape 3), et ce que la garde juge, dans D81 (`docs/methodes.md`).

La garde juge le corps de l'issue tel qu'il est sur GitHub, en entier, jamais un commentaire.

1. **Lis le corps par l'API REST**, dans un fichier hors du dépôt (le dossier temporaire de la
   session) : la garde compte pour modifié tout fichier non suivi du worktree.

       gh api repos/sverley/Tirelire/issues/<n> --jq .body > <fichier>

   Ne passe pas par `pr --issue <n>` ni par `pr --pr <n>` : ils lisent par `gh issue view` et
   `gh pr view`, qui ne fonctionnent pas ici (« Pratique » de `CLAUDE.md`).
2. **Joue-la depuis le worktree de la branche**, `origin/main` à jour : elle juge les fichiers
   modifiés depuis `origin/main`, copie de travail comprise.

       git fetch origin
       node packages/gardes/cli.mjs pr --corps-fichier <fichier>

   La variable `CORPS`, qui porte le texte du corps, remplace `--corps-fichier`.
3. **Lis le verdict** : code de sortie 0 au vert ; au rouge, 1, et la sortie ouvre « À corriger »
   et nomme chaque point.
