# Les chantiers

Un document par chantier, dans ce dossier : c'est la seule vérité du chantier (D86). Sur GitHub, une
issue étiquetée « chantier » le reflète, renvoie à ce document et porte ses sous-issues ; le
document ne les liste pas.

Un document naît en **lettre d'intention** : les paroles du porteur qui fondent le chantier, citées
mot pour mot, et ce qu'elles demandent, en une ou deux phrases. Elle ne nomme des cibles, des usages
ou des contraintes que s'ils font partie de l'intention ; elle ne porte ni hypothèse, ni analyse, ni
sous-issue, ni ordre, ni état. La session d'architecte du chantier y ajoute ensuite l'analyse
approfondie — contraintes, hypothèses, cibles, usages —, avec l'accord du porteur
(`docs/roles/architecte.md`).

Un document se nomme `chantier-<n>-<intitulé-court>.md`. La lettre d'intention suit ce modèle :

```markdown
# Chantier <n> · <intitulé>

Issue : #<numéro>.

## Intention

> Les paroles du porteur qui fondent le chantier, mot pour mot.

Ce qu'elles demandent, en une ou deux phrases.
```

L'analyse approfondie ajoute, sous l'intention, les sections « Contraintes », « Hypothèses »,
« Cibles » et « Usages ».
