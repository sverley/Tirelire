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
| `deposer.sh` | dépôt du site par FTPS ou SFTP (`lftp`), utilisé par la CI et à la main |
| `deposer.test.mjs` | vérifie le dépôt contre un vrai serveur FTP local (sauté si `lftp` ou `pyftpdlib` manquent) |

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

## Mises à jour et dépôt automatique

À chaque push sur `main`, la CI assemble le site, le **dépose par FTP** si les secrets sont
renseignés, et joint `tirelire-hebergement.zip` à la release `latest` (par le job de publication,
qui attend aussi l'APK). Sans secrets, le job de dépôt le dit dans son résumé et ne fait rien
d'autre : l'archive reste téléchargeable.

### Secrets à créer (Paramètres du dépôt → Secrets and variables → Actions → *Secrets*)

| Secret | Valeur | Où la trouver |
|---|---|---|
| `OVH_FTP_HOST` | `ftp.clusterXXX.hosting.ovh.net` (un `ftp://` ou un chemin collé par mégarde sont retirés) | espace client OVHcloud → Hébergements → *FTP - SSH* |
| `OVH_FTP_USER` | l'utilisateur FTP (souvent le nom de l'hébergement) | même onglet |
| `OVH_FTP_PASSWORD` | son mot de passe | à (re)définir depuis le même onglet |

Le mot de passe ne doit contenir ni guillemet double ni barre oblique inverse (il est passé tel
quel à `lftp`). Un utilisateur FTP dédié, limité au dossier du site, est préférable au compte
principal.

### Réglages facultatifs (mêmes écrans, onglet *Variables*)

| Variable | Défaut | Rôle |
|---|---|---|
| `TIRELIRE_BASE` | `/` | sous-dossier d'installation (`/tirelire/` par exemple) |
| `TIRELIRE_FTP_DOSSIER` | `www` | dossier distant (`www/tirelire` pour un sous-dossier) |
| `TIRELIRE_FTP_PROTOCOLE` | `ftps` | `ftps` (FTP chiffré, port 21) ou `sftp` (port 22) |
| `TIRELIRE_FTP_VERIFIER_CERTIFICAT` | `oui` | passer à `non` seulement si le certificat du serveur FTP ne correspond pas à son nom |
| `TIRELIRE_FTP_NETTOYER` | `non` | `oui` supprime du serveur les fichiers absents du site (les anciens fragments restent utiles aux appareils pas encore rechargés) |
| `TIRELIRE_SITE_URL` | `https://tirelire.sim-dev.eu` | adresse publique vérifiée après chaque dépôt ; à changer pour une autre installation |

Le dossier visé (`TIRELIRE_FTP_DOSSIER`) doit être celui qu'un domaine sert vraiment. Chez
OVHcloud, la racine FTP contient `www`, racine du domaine principal ; tout autre dossier n'est
servi que s'il est déclaré comme racine d'un domaine ou sous-domaine dans l'onglet *Multisite* de
l'hébergement. Un transfert peut donc réussir sans que le site soit visible : c'est ce que
`TIRELIRE_SITE_URL` permet de détecter tout de suite.

### Ce que fait le dépôt

`apps/hebergement/deposer.sh` (lancé par la CI, utilisable aussi à la main) transfère avec `lftp`
en deux passes : d'abord tout sauf `index.html`, `sw.js`, `registerSW.js` et
`manifest.webmanifest`, puis ces fichiers d'entrée — ainsi personne ne charge une page qui
pointerait vers des ressources pas encore montées. Sont **toujours** exclus, à l'envoi comme au
nettoyage : `donnees/*.jsonl` (les paquets de synchronisation des appareils) et
`relais.config.php` (la configuration locale du relais).

Si `TIRELIRE_SITE_URL` est renseignée, la CI vérifie ensuite en ligne : la page d'accueil
répond, `/r/<salon>` répond `200` (donc la réécriture `.htaccess` fonctionne), un salon invalide
est refusé (`400`) et le dossier `donnees/` n'est pas servi.

L'entrée manuelle du workflow (onglet Actions → *Lancer le workflow*) propose `essai-a-blanc`,
qui liste ce qui serait transféré sans rien envoyer, et `ignorer`, qui saute le dépôt.

À la main, sans la CI :

```sh
pnpm --filter @tirelire/hebergement assembler
HOTE=ftp.clusterXXX.hosting.ovh.net UTILISATEUR=moncompte MOTDEPASSE=… \
  bash apps/hebergement/deposer.sh
```

Le service worker met les appareils à jour au chargement suivant.

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
