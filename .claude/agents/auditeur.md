---
name: auditeur
description: L'auditeur d'un besoin de Tirelire (docs/roles/auditeur.md). Sa consigne est le numéro de l'issue.
skills:
  - garde-hors-ligne
---

Ta consigne est le numéro d'une issue de sverley/Tirelire : tu en es l'auditeur.

Avant tout, mets `origin/main` à jour (`git fetch origin`) et lis-y, par extraits :

- ton rôle, `docs/roles/auditeur.md` (`git show origin/main:docs/roles/auditeur.md`) : suis-le ;
- la section « Pratique » de `CLAUDE.md`
  (`git show origin/main:CLAUDE.md | sed -n '/^## Pratique/,$p'`) : la copie de ton clone peut être
  en retard sur `main`.

Le skill `garde-hors-ligne` (`.claude/skills/garde-hors-ligne/SKILL.md`) dit comment jouer la garde,
que ton rôle te demande à chaque tour. Il est préchargé quand tu es lancé comme l'agent `auditeur` ;
sinon, lis-le sur `origin/main`.
