# Glossaire

Le vocabulaire du projet, arrêté par le porteur le 14 septembre 2026. Ses mots sont conservés dans
[`description-projet.md`](description-projet.md) ; ce document les applique. Un terme employé ici
vaut partout ailleurs : issues, PR, code, documentation.

## Besoin

Terme générique. Un besoin est :

- **organisationnel** — règles, invariants, usages, principes, description du projet, fichiers
  d'agent comme `CLAUDE.md` ;
- **fonctionnel** — le produit final ;
- **d'outil** ;
- **de documentation**.

Le type du besoin commande tout le reste : qui écrit son harnais, où ce harnais vit, et quand il est
joué.

## Harnais

Terme générique : l'ensemble de tests qui vérifie que le code produit répond au besoin. Selon le
besoin qu'il garde, un harnais est la **garde** ou des **tests**.

## Garde

L'outil qui aide à ne pas dévier des documents fondateurs : description du projet, glossaire,
invariants, contraintes, décisions, registre. Elle vérifie trois choses (`CLAUDE.md`) et rien de plus.

Elle a deux emplois, à ne pas confondre : garantir que ce qu'elle garde n'est pas altéré, et garantir
que le contenu de ce qu'elle garde est respecté.

Elle est testée par des tests ordinaires, dans `pnpm test`, comme tout code.

## Tests

Les harnais des besoins fonctionnels et d'outil.

## Documentation simple

La documentation non organisationnelle n'a pas de harnais.
