# Domaine · Données et synchro

Le stockage local, les migrations, le fichier d'état, la sauvegarde, la synchronisation et son
relais. Aucun ancien chantier ne le portait ; pas encore d'analyse. C'est le cœur de la version
`v0 · Socle commun` (`docs/versions.md`).

## Intention

Les principes 5, 5.1 et 5.2 de la description : les données restent chez l'utilisateur, en local ;
elles se synchronisent entre sessions, plateformes et personnes qui partagent les clés ; un relais
ne garde que des paquets chiffrés, temporairement. Le protocole vit dans `docs/synchronisation.md`,
l'organisation du code dans `docs/architecture.md`.
