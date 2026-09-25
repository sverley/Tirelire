# Synchronisation entre appareils

Quatre transports, un seul protocole (`packages/core/src/sync.ts`) :

| Transport | Où | Serveur | État |
|---|---|---|---|
| Paquet (fichier JSON) | Réglages | aucun | sur `main` |
| Direct WebRTC, signalisation par QR code ou copier-coller | Plus → Synchronisation | aucun (un STUN public pour sortir du réseau local) | sur `main`, testé entre deux navigateurs |
| Relais privé (`apps/relay`), paquets chiffrés AES-GCM côté client | Plus → Synchronisation | le tien, Node sans dépendance | sur `main`, testé de bout en bout |
| Même relais en PHP (`apps/hebergement`), servi avec la PWA par un hébergement mutualisé | Plus → Synchronisation (adresse proposée d'office) | hébergement web Apache + PHP, sans VPS | sur `main`, testé avec le serveur intégré de PHP (voir `docs/hebergement-web.md`) |

## Protocole

S## Protocole

Le fichier est un état (D58) : chaque ligne porte l'horloge logique de sa dernière écriture, qui
nomme l'instance qui l'a faite. Chaque instance sait, pour chaque autre, la plus grande horloge
qu'elle en a vue.

Symétrique, cinq messages, chacun portant le format et sa version : `hello` (identité et ce que
l'instance sait), `request`, `changes` (les lignes plus récentes que ce que l'autre a annoncé, et ce
que l'émetteur sait), `done`, puis `bye`. Une ligne s'écrit entière et la plus récente gagne,
suppression logique comprise ; renvoyer une ligne déjà connue est sans effet. Ce qu'un appareil a
reçu d'un troisième fait partie de son état et se propage avec lui.

Les paquets par fichier et les dépôts au relais portent en plus ce qu'ils supposent connu du
destinataire : celui-ci n'en apprend ce que savait l'émetteur que s'il le savait déjà compléter ;
sinon il applique les lignes, et un autre échange comblera le reste. Le relais ne reçoit que
`site`, `iv` et `blob` : le paquet est chiffré avant de partir.

Un message ou un paquet d'un autre format arrête l'échange en le disant, avant toute écriture.

## Conflits

Une ligne modifiée des deux côtés sans que l'un ait vu la version de l'autre : les deux instances
retiennent la plus récente, et chacune garde l'écartée, hors synchronisation, pour la montrer
(écran Synchronisation, bandeau ailleurs) jusqu'à ce que l'utilisateur l'ait vue.

## Ce qui reste à l'instance

Son identité, son horloge, ce qu'elle sait des autres, les curseurs et secrets du relais ne sont pas
dans le fichier : l'application les garde à côté, dans IndexedDB ou le stockage du navigateur. Un
fichier exporté puis ouvert ailleurs y devient une autre instance ; restauré sur la même, il en garde
l'identité et redéduit de ses lignes ce qu'il sait, ce qui ne perd rien de ce que les autres ont reçu.

## Multi-utilisateur

Chaque appareil s'enregistre dans la table synchronisée `devices` (nom, personne). Chaque ligne
porte l'appareil de sa dernière écriture : on sait qui a modifié quoi en dernier. Il n'y a pas de
droits : tous les appareils du foyer sont égaux.

## Limites connues

- Wi‑Fi Direct et Bluetooth restent hors de portée d'une PWA ; ils demanderaient un module natif Capacitor.
- Le scan de QR code repose sur `BarcodeDetector` (Chrome Android) ; ailleurs, copier-coller.
- Le relais garde les dépôts sans les purger ; un appareil qui les manquerait les retrouve par un
  échange direct ou par fichier.
- L'historique des valeurs remplacées n'est pas gardé (D58).
