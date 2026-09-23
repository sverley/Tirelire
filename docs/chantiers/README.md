# Les chantiers

Un document par chantier, dans ce dossier : c'est la seule vérité du chantier (D86). Sur GitHub, une
issue étiquetée « chantier » le reflète, renvoie à ce document et porte ses sous-issues ; le
document ne les liste pas.

Un document s'écrit à la première session de l'architecte du chantier, à partir de son issue et des
paroles du porteur, qui le valide (`docs/roles/architecte.md`). Il se nomme
`chantier-<n>-<intitulé-court>.md` et suit ce modèle :

```markdown
# Chantier <n> · <intitulé>

Issue : #<numéro>.

## Intentions globales
Ce que le chantier doit rendre possible, dans les mots du porteur.

## Contraintes
Ce qui le borne : contraintes du catalogue (`docs/contraintes.md`) et limites propres.

## Hypothèses
Ce que le chantier tient pour acquis, et qui le remettrait en cause s'il tombait.

## Cibles
Les cibles du catalogue (`docs/cibles.md`) où il se livre et se vérifie.

## Usages
Les usages de la description qu'il sert.
```
