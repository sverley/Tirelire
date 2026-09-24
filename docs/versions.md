# Versions

Le travail est tiré et ordonné par les versions (D87). Une version garantit un usage (description,
section « Usages ») sur un ensemble de cibles (`docs/cibles.md`) ; elle naît d'une case
« prioritaire » de la matrice des cibles. La première, `v0 · Socle commun`, ne garantit aucun
usage : elle intègre les contraintes structurelles de tous les usages et de toutes les cibles
actives, avant qu'une version d'usage ne s'appuie dessus.

Une version se termine quand son critère de fin est atteint et que le porteur a fait ses
vérifications manuelles ; elle se publie alors par le tag de son nom (D83). Une version livrée ne
régresse pas : le parcours de son usage, ou les harnais de son socle, restent verts à chaque PR.

Sur GitHub, un jalon du même nom regroupe toutes les tâches nécessaires à la version, quel que soit
leur domaine (D86) ; c'est la version qui ordonne leur traitement. Les tâches restent sur GitHub :
ce catalogue ne les liste pas.

Une entrée donne l'usage, les cibles, le critère de fin et le tag.

## v0 · Socle commun

- **Usage** · aucun : les contraintes structurelles de tous les usages.
- **Cibles** · les cibles actives : Webapp · Chromium sur Android ; Webapp · Chromium sur
  ordinateur ; Relais PHP seul.
- **Contraintes intégrées** · données locales et leur persistance (I7, C4), sauvegarde (C5),
  synchronisation et instances à des versions différentes (I8, C8), distribution et installation
  (I9, C1, C2), adresse sûre (C3).
- **Fin** · les harnais et vérifications manuelles d'I7, I8, I9, C4, C5 et C8 sont tenus sur ces
  cibles, et les issues de conception de la version sont fermées.
- **Tag** · `v0`.

## v1 · Budget seul sur la webapp

- **Usage** · U1 · Budget seul.
- **Cibles** · Webapp · Chromium sur Android ; Webapp · Chromium sur ordinateur.
- **Fin** · le parcours U1 d'I3 (`packages/core/test/parcours-u1.test.ts`) est vert, et le porteur a
  fait `VM-I3-u1-parcours` sur chacune des deux cibles.
- **Tag** · `v1`.
