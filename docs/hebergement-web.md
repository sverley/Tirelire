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
| `verifier.sh` | vérifie un site en ligne (accueil, relais, protections, commit servi) ; la CI de production publie son diagnostic |
| `apercu.sh` | aperçu d'une PR sur l'instance de recette : dépôt dans `<dossier>/pr-<numéro>`, retrait à la fermeture |
| `case-apercu.sh` | la case de l'aperçu dans la description d'une PR : son état, et ce qu'elle dit du commit en ligne (#175) |

## Installer

1. Récupérer `tirelire-hebergement.zip` dans la dernière release (tag `v*`, construite pour la racine
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

À chaque push sur `main`, la CI assemble le site et le **dépose par FTP** si les secrets sont
renseignés ; à un tag `v*`, elle joint `tirelire-hebergement.zip` à la release, avec l'APK. Sans secrets, le job de dépôt le dit dans son résumé et ne fait rien
d'autre : l'archive reste téléchargeable.

### Secrets à créer (Paramètres du dépôt → Environments → `depot-ftp`)

Les identifiants FTP vivent dans l'environnement `depot-ftp`, pas au niveau du dépôt : c'est ce qui
les met hors de portée du code d'une PR (#155). Créer l'environnement ; dans *Deployment branches and
tags*, choisir *Selected branches and tags* et n'ajouter que la branche `main` ; y créer les trois
secrets ci-dessous (*Environment secrets*), puis supprimer ceux du même nom au niveau du dépôt. Tant
que ce n'est pas fait, les jobs qui déclarent l'environnement tournent encore, mais sans cette
protection.

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
| `TIRELIRE_SITE_URL` | aucun | adresse publique vérifiée après chaque dépôt ; sans elle, le site est déposé mais pas vérifié en ligne |

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

La CI vérifie ensuite le site en ligne avec `apps/hebergement/verifier.sh` : la page d'accueil
répond et parle bien de Tirelire, `/r/<salon>` répond `200` en JSON (donc la réécriture
`.htaccess` fonctionne et PHP s'exécute), un salon invalide est refusé (`400`), le dossier
`donnees/` n'est pas servi, et `http://` redirige vers `https://`. Avec `COMMIT_ATTENDU`, il
vérifie aussi que la page d'accueil porte ce commit (`<meta name="tirelire-commit">`, posée par
l'assembleur quand `TIRELIRE_COMMIT` est donnée). Toutes les vérifications sont
jouées, jamais interrompues à la première : en cas d'échec, le diagnostic complet (codes HTTP,
types de contenu, début des réponses) est publié en commentaire du commit, lisible depuis un
téléphone. Le même script se lance à la main :

```sh
ADRESSE_SITE=https://tirelire.sim-dev.eu bash apps/hebergement/verifier.sh
```

L'entrée manuelle du workflow (onglet Actions → *Lancer le workflow*) propose `essai-a-blanc`,
qui liste ce qui serait transféré sans rien envoyer, et `ignorer`, qui saute le dépôt.

À la main, sans la CI :

```sh
pnpm --filter @tirelire/hebergement assembler
HOTE=ftp.clusterXXX.hosting.ovh.net UTILISATEUR=moncompte MOTDEPASSE=… \
  bash apps/hebergement/deposer.sh
```

Le service worker met les appareils à jour au chargement suivant.

## Aperçu de chaque PR sur l'instance de recette

Une PR a son aperçu quand le porteur le demande (#175) : le site du dernier commit de sa branche,
construit pour le sous-dossier `pr-<numéro>` d'une instance de recette, déposé par
`apercu.sh deposer` dans `<TIRELIRE_DEV_FTP_DOSSIER>/pr-<numéro>`, puis vérifié en ligne par
`verifier.sh`, commit servi compris. La fermeture de la PR (fusion ou abandon) supprime ce
sous-dossier entier, paquets du relais compris (`apercu.sh retirer`), sans tests ni build.
L'adresse de recette ne s'écrit nulle part en clair dans le dépôt, et le diagnostic d'un dépôt reste
dans le journal de la CI.

La demande est une case de la description de la PR, « Aperçu du dernier commit en recette »,
qu'ajoutent le modèle de PR et, s'il manque, le passage en Ready (`pret.yml`) ; elle est tenue par
`apps/hebergement/case-apercu.sh`. Sans elle cochée, rien n'est jamais déposé, et les agents ne la
cochent jamais. Au passage en Ready, rien ne se dépose : `apercu.yml` attend seulement toute la CI
(`ci.yml` et `validation.yml`) sur le dernier commit, termine le statut « Toute la CI sur ce commit »
et, si l'une rougit, le dit en commentaire. Quand le porteur coche la case, `depot-apercu.yml`
vérifie, sans attendre, que la PR est prête et que ces deux workflows ont fini au vert sur le dernier
commit (#169), avec le site assemblé, et que la case a été cochée par le propriétaire du dépôt.
Sinon rien n'est déposé, la case redevient vide, et un
commentaire de la PR dit pourquoi, avec le lien de l'exécution en cause. Après le dépôt, la case dit
quel commit est en ligne : cochée tant que c'est le dernier commit, décochée dès qu'un commit arrive
(`suivi.yml`) ou si le dépôt échoue (l'aperçu en ligne est alors dit incertain, et un commentaire
donne le lien du journal). Cocher ou décocher la case n'est pas un changement de la PR (#168).
Aucun réglage du dépôt n'est à ajouter : l'environnement `depot-ftp` et les variables de recette
restent ceux d'avant.

Le code de la PR et les identifiants ne se croisent jamais (#155). `ci.yml`, lu dans la branche,
assemble le site de la PR sans identifiant ni réglage de recette, et le garde en artefact
(`apercu-pr-<numéro>`). `depot-apercu.yml`, lu sur `main` (`pull_request_target`), vérifie cette exécution et le reste de la CI,
reprend l'artefact et le dépose, dans un job de l'environnement `depot-ftp` qui n'extrait que `main`
et n'exécute rien de la PR : les scripts de dépôt qui tournent, et donc le bornage à
`<dossier>/pr-<numéro>`, sont ceux de `main`, que la PR les modifie ou non. Le retrait se fait de
même. Une PR qui modifie `apercu.yml`, `depot-apercu.yml` ou ces scripts n'en voit l'effet qu'une fois fusionnée.

Sur une PR, le site ne s'assemble qu'une fois par passage, dans `ci.yml` (job « Assemblage de
l'aperçu de la PR ») : pour le sous-dossier `pr-<numéro>`, sans lire les réglages de la recette. Il
se construit donc même quand ces réglages manquent ; seul le dépôt n'a pas lieu. L'assemblage pour la racine, son artefact
et sa publication restent à `main`, aux tags `v*` et au lancement manuel (#153).

La recette est une origine distincte de la production (un sous-domaine, en HTTPS) : les aperçus y
partagent un même stockage navigateur, jamais celui de la production. Chaque aperçu enregistre son
service worker sur la portée de son sous-dossier. Le `robots.txt` de la racine de la recette se pose à
la main ; aucun job n'y touche.

Mêmes secrets `OVH_FTP_*` que la production, dans le même environnement `depot-ftp`, et deux variables (onglet *Variables*), sans valeur par
défaut :

| Variable | Rôle |
|---|---|
| `TIRELIRE_DEV_SITE_URL` | adresse de la recette, en `https://`, racine d'un sous-domaine ; chaque aperçu est servi à `<adresse>/pr-<numéro>/` |
| `TIRELIRE_DEV_FTP_DOSSIER` | dossier FTP que la recette sert (sa racine déclarée dans *Multisite*) |

Si l'une manque, ou vaut son équivalent de production (`TIRELIRE_FTP_DOSSIER`, `www` par défaut ;
`TIRELIRE_SITE_URL`, adresse ou origine), `apercu.sh` s'arrête avant tout transfert et nomme la
variable en cause. Il ne dépose ni ne supprime rien ailleurs que dans `<dossier>/pr-<numéro>`.

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
