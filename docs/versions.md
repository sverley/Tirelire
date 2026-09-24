# Versions

Une version garantit un usage (description, section « Usages ») sur un ensemble de cibles
(`docs/cibles.md`). Elle naît d'une case « prioritaire » de la matrice des cibles. Elle se termine
quand le parcours de son usage (I3, `docs/gardes.md`) est vert sur chacune de ses cibles et que le
porteur a fait ses vérifications manuelles ; elle se publie alors par le tag de son nom (D83). Une
version livrée ne régresse pas : le parcours de son usage reste vert sur ses cibles à chaque PR.

Sur GitHub, un jalon du même nom regroupe toutes les tâches nécessaires à la version, quel que soit
leur chantier ; c'est la version qui ordonne leur traitement (D87). Les tâches restent sur GitHub :
ce catalogue ne les liste pas. Un chantier (`docs/chantiers/`) est une capacité : il sert une ou
plusieurs versions.

Une entrée donne l'usage, les cibles, le critère de fin et le tag.

## v1 · Budget seul sur la webapp

- **Usage** · U1 · Budget seul.
- **Cibles** · Webapp · Chromium sur Android ; Webapp · Chromium sur ordinateur.
- **Fin** · le parcours U1 d'I3 (`packages/core/test/parcours-u1.test.ts`) est vert, et le porteur a
  fait `VM-I3-u1-parcours` sur chacune des deux cibles.
- **Tag** · `v1`.
