# Domaine · Opérations

Les comptes, l'import des relevés, les opérations et leurs états, la ventilation, les catégories, les
automatismes et la classification apprise. Reprend les lettres des anciens chantiers 9 et 10 (#53,
#54) ; pas encore d'analyse. Les formats d'import vivent dans `docs/formats-import.md`.

## Intention

### Automatiser la classification (ancien chantier 9)

> 9. l'app doit permettre une automatisation des classifications des opérations (l'exemple doit porter ces automatismes)

La classification des opérations s'automatise, et l'exemple embarqué porte ses automatismes.

### Une classification apprise (ancien chantier 10)

> 10. l'app doit proposer des classifications intelligentes basées sur un apprentissage (l'apprentissage initial se fait sur l'exemple). L'application des automatismes (prioritaires) et de la classification intelligente par defaut doit permettre de reconstruire les classifications de l'exemple.

L'application propose des classifications apprises, à partir de l'exemple. Les automatismes d'abord, puis la classification apprise, retrouvent les classifications de l'exemple.
