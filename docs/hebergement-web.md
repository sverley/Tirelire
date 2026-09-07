# Tirelire sur un hébergement web mutualisé

Tirelire n'a pas besoin de serveur applicatif : toute la logique tourne dans le navigateur et
les données restent sur chaque appareil (IndexedDB). Un hébergement web classique — Apache +
PHP, comme les offres « Hébergement web » d'OVHcloud, sans VPS — suffit donc pour :

1. **servir la PWA** (fichiers statiques), installable depuis le navigateur du téléphone comme
   depuis un ordinateur ;
2. **héberger le relais de synchronisation** (`relais.php`), qui stocke des paquets chiffrés
   côté client et ne peut pas les lire — même contrat que le relais Node de `apps/relay`.

Node.js n'est pas disponible sur l'hébergement mutualisé OVHcloud (seulement sur les offres
Cloud Web et les VPS) ; le relais est donc réécrit en PHP, sans dépendance.

## Contenu du dossier `apps/hebergement`

| Fichier | Rôle |
|---|---|
| `serveur/relais.php` | le relais : `POST /r/<salon>` dépose un paquet, `GET /r/<salon>?site=&after=` rend ceux des autres appareils |
| `serveur/.htaccess` | HTTPS forcé, réécriture `/r/<salon>` → `relais.php`, types MIME (`.wasm`, `.webmanifest`), cache, dossiers interdits |
| `serveur/.ovhconfig` | PHP 8.3 sur conteneur `stable64` (à garder, ou à fusionner avec un `.ovhconfig` existant à la racine) |
| `serveur/donnees/` | un fichier `<salon>.jsonl` par salon, jamais servi (`Require all denied`) |
| `serveur/relais.config.exemple.php` | pour déplacer `donnees` hors du dossier web (recommandé quand on a accès au dossier parent de `www`) |
| `assembler.mjs` | construit la PWA avec le bon préfixe et produit `dist/` et `tirelire-hebergement.zip` |
| `relais.test.mjs` | vérifie le relais PHP avec le serveur intégré de PHP (sauté si `php` est absent) |

## Installer

1. Récupérer `tirelire-hebergement.zip` dans la release `latest` (construite pour la racine
   d'un domaine ou sous-domaine), ou l'assembler soi-même pour un sous-dossier :
   `TIRELIRE_BASE=/tirelire/ pnpm --filter @tirelire/hebergement assembler`.
2. Déposer le contenu de `dist/` par FTP/SFTP dans `www/` (ou `www/tirelire/`). Les fichiers
   `.htaccess` et `.ovhconfig` sont cachés : vérifier qu'ils sont bien transférés.
3. Activer le certificat SSL (Let's Encrypt, inclus chez OVHcloud) : la PWA et le service
   worker exigent HTTPS.
4. Ouvrir l'adresse, puis « Plus → Synchronisation → Par un serveur privé » : l'adresse du
   relais est proposée d'office (le site lui-même) ; générer un salon, choisir une phrase de
   chiffrement, et reporter les deux sur les autres appareils du foyer.

Le premier déploiement est le vrai test des règles `.htaccess` (réécriture et HTTPS) : elles
sont écrites pour Apache 2.4 tel que configuré chez OVHcloud, mais n'ont été vérifiées ici
qu'avec le serveur intégré de PHP.

## Mises à jour

À chaque push sur `main`, la CI produit l'archive et la joint à la release `latest`. Si les
secrets `OVH_FTP_HOST`, `OVH_FTP_USER`, `OVH_FTP_PASSWORD` (et, facultatif, `OVH_FTP_DIR`,
défaut `www/`) existent dans le dépôt, elle dépose aussi `dist/` par FTPS, sans jamais toucher
à `donnees/` ni à `relais.config.php`. La variable de dépôt `TIRELIRE_BASE` fixe le
sous-dossier. Le service worker met les appareils à jour au chargement suivant.

## Sécurité et limites

- Le salon est la clé d'accès (identifiant aléatoire de 24 caractères), la phrase de
  chiffrement la clé de lecture ; le serveur ne connaît que des blobs AES-GCM. Ne pas
  publier l'adresse du site avec le salon.
- Rien ne limite le nombre de salons ni la taille des fichiers : l'hébergement est privé, on
  compte sur le fait que le salon reste secret. Un compactage viendra avec celui du journal
  de changements (voir `docs/synchronisation.md`).
- Écriture sous verrou `flock` : deux appareils qui poussent en même temps n'obtiennent
  jamais le même `id`.
- Les données de Tirelire ne sont **pas** sur le serveur : perdre l'hébergement ne perd rien,
  sauf les paquets pas encore tirés par un autre appareil. La sauvegarde reste l'export de la
  base depuis l'application.
