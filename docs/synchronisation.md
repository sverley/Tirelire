# Synchronisation entre appareils (branche `feature/sync-p2p`)

Trois transports, un seul protocole (`packages/core/src/sync.ts`) :

| Transport | Où | Serveur | État |
|---|---|---|---|
| Paquet de changements (fichier JSON) | Réglages | aucun | sur `main` |
| Direct WebRTC, signalisation par QR code ou copier-coller | Plus → Synchronisation | aucun (un STUN public pour sortir du réseau local) | cette branche, testé entre deux navigateurs |
| Relais privé (`apps/relay`), paquets chiffrés AES-GCM côté client | Plus → Synchronisation | le tien, Node sans dépendance | cette branche, testé de bout en bout |

## Protocole

Symétrique, quatre messages : `hello` (identité), `request` (curseur = dernier `seq` connu du pair),
`changes` (entrées du journal après ce curseur, sans celles qui viennent du demandeur), `done`, puis
`bye` (position finale du journal, car il a grandi des entrées reçues). Les entrées d'un troisième
appareil sont relayées ; chacune est identifiée par son empreinte, donc les recouvrements sont
sans effet. Une cellule n'est écrasée que par un changement plus récent (horloge logique hybride).

## Multi-utilisateur

Chaque appareil s'enregistre dans la table synchronisée `devices` (nom, personne). Le journal
porte l'identifiant d'appareil sur chaque changement : on sait donc qui a modifié quoi. Il n'y a
pas de droits : tous les appareils du foyer sont égaux.

## Limites connues

- Wi‑Fi Direct et Bluetooth restent hors de portée d'une PWA ; ils demanderaient un module natif Capacitor.
- Le scan de QR code repose sur `BarcodeDetector` (Chrome Android) ; ailleurs, copier-coller.
- Le journal de changements n'est jamais purgé ; une commande de compactage viendra quand la synchro sera stabilisée.
