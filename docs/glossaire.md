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
besoin qu'il garde, un harnais est une **garde**, des **tests**, ou un **amorçage**.

## Garde

L'outil qui garde les catalogues : description du projet, principes, invariants, usages, contraintes,
cibles, règles et décisions. C'est un ensemble de harnais qui garantit qu'un besoin organisationnel,
une fois codé, ne sera pas trahi.

Elle a deux emplois, à ne pas confondre : garantir que ce qu'elle garde n'est pas altéré, et garantir
que le contenu de ce qu'elle garde est respecté.

Elle se garde elle-même : un harnais de la garde ne doit pas produire un résultat qui contredit la
garde.

## Tests

Les harnais des besoins fonctionnels et d'outil.

## Amorçages

Les harnais qui vérifient le codage d'un besoin organisationnel, qu'une garde ait été codée,
modifiée ou non. Une règle peut se coder par la seule prose, sans que le codeur change le
comportement de la garde : son codage a quand même son amorçage.

Un amorçage ne se confond pas avec la garde : la garde tient les catalogues dans la durée,
l'amorçage juge un codage donné, celui d'un besoin organisationnel précis. Les amorçages n'ont pas
à être joués autrement qu'en cas de codage dans la garde, ou dans ce qu'elle garde.

## Documentation simple

La documentation non organisationnelle n'a pas de harnais.
