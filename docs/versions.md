# Versions

Le travail est tiré et ordonné par les versions (D87). Une version garantit un usage (description,
section « Usages ») sur un ensemble de cibles (`docs/cibles.md`) ; elle se travaille quand sa case
de la matrice des cibles devient « prioritaire », et peut être prévue avant. Le socle, lui, ne
garantit aucun usage : il intègre les contraintes structurelles de tous les usages et de toutes les
cibles actives, par incréments, chacun placé juste avant la première version d'usage qui l'exerce
(D87). Le premier est `v0 · Données sûres`.

Une version se termine quand son critère de fin est atteint et que le porteur a fait ses
vérifications manuelles ; elle se publie alors par le tag de son nom (D83). Une version livrée ne
régresse pas : ce que son critère de fin tient vert le reste à chaque PR.

Sur GitHub, un jalon du même nom regroupe toutes les tâches nécessaires à la version, quel que soit
leur domaine (D86) ; c'est la version qui ordonne leur traitement. Les tâches restent sur GitHub :
ce catalogue ne les liste pas.

Une entrée donne l'usage, les cibles, le critère de fin et le tag. L'ordre des entrées est l'ordre de
travail : une version prévue attend que les précédentes soient publiées (D87).

## v0 · Données sûres

- **Usage** · aucun : ce qu'une version d'usage qui porte de vraies données ne peut éviter d'avoir
  avant elle.
- **Cibles** · Webapp · Chromium sur Android ; Webapp · Chromium sur ordinateur : les cibles
  actives où ses contraintes s'exercent.
- **Contraintes intégrées** · données locales (I7), leur persistance (C4), leur sauvegarde (C5), le
  fichier d'état (D58).
- **Fin** · les harnais et vérifications manuelles d'I7, C4 et C5 sont tenus sur ces cibles ; les
  issues de conception de la version sont fermées, et ce qu'elles demandent de vérifier est tenu —
  pour la synchro, ce qui la garde possible en attendant son codage réel.
- **Tag** · `v0`.

## v1 · Budget seul sur la webapp

- **Usage** · U1 · Budget seul.
- **Cibles** · Webapp · Chromium sur Android ; Webapp · Chromium sur ordinateur.
- **Fin** · le parcours U1 d'I3 (`packages/core/test/parcours-u1.test.ts`) est vert, et le porteur a
  fait `VM-I3-u1-parcours` sur chacune des deux cibles.
- **Tag** · `v1`.

## v2 · Budget et virements permanents

- **Usage** · U2 · Budget et virements permanents.
- **Cibles** · Webapp · Chromium sur Android ; Webapp · Chromium sur ordinateur.
- **Fin** · le parcours U2 d'I3 (`packages/core/test/parcours-u2.test.ts`) est vert, et le porteur a
  fait `VM-I3-u2-ordres` sur chacune des deux cibles.
- **Tag** · `v2`.

## v3 · Budget puis import

- **Usage** · U3 · Budget sans virements validés, puis import.
- **Cibles** · Webapp · Chromium sur Android ; Webapp · Chromium sur ordinateur.
- **Fin** · le parcours U3 d'I3 est vert — son harnais reste à bâtir (dette d'I3 au registre), et le
  porteur a fait `VM-I3-u3-rapprochement` sur chacune des deux cibles.
- **Tag** · `v3`.

## v4 · Budget reconstruit

- **Usage** · U4 · Budget reconstruit depuis l'historique.
- **Cibles** · Webapp · Chromium sur Android ; Webapp · Chromium sur ordinateur.
- **Fin** · le parcours U4 d'I3 est vert — son harnais reste à bâtir (dette d'I3 au registre), et le
  porteur a fait `VM-I3-u4-reconstruction` sur chacune des deux cibles.
- **Tag** · `v4`.

## v5 · Import seul

- **Usage** · U5 · Import seul.
- **Cibles** · Webapp · Chromium sur Android ; Webapp · Chromium sur ordinateur.
- **Fin** · le parcours U5 d'I3 (`packages/core/test/parcours-u5.test.ts`) est vert, et le porteur a
  fait `VM-I3-u5-sans-tirelire` sur chacune des deux cibles.
- **Tag** · `v5`.
