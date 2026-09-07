# Relais Tirelire

Serveur minuscule (Node ≥ 20, aucune dépendance) qui stocke des paquets de changements
**chiffrés côté client** par salon. Il ne peut pas lire les données.

```sh
PORT=8787 TIRELIRE_RELAY_DATA=/var/lib/tirelire node server.mjs
```

Dans l'application : Plus → Synchronisation → Relais : adresse du serveur, identifiant de
salon (secret, généré une fois et partagé entre les appareils du foyer) et phrase de
chiffrement (jamais envoyée). Chaque appareil pousse ses changements et tire ceux des autres.

Derrière un reverse proxy HTTPS de préférence (Caddy, nginx). Aucun compte : le salon est
la clé d'accès, la phrase de chiffrement la clé de lecture.
