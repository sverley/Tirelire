# Cibles

Les cibles de distribution de Tirelire (principe 6 de la
[description du projet](description-projet.md)) : ce que chacune est, ce qui la construit et la
livre, et son état. Ce catalogue est la référence : il tient sans les issues. Il borne le champ des
agents de codage et de distribution (`docs/roles/`).

## Comment il sert

- **État** : `active` (le travail la vise, la CI la construit depuis `main`, I9), `de côté` (le code
  existe, on n'y touche pas) ou `plus tard` (rien n'est fait, rien ne se fait pour elle).
- **Étiquettes** : `cible:webapp`, `cible:relais`, `cible:apk`, `cible:ios`, sur les issues et les
  PR, plusieurs possibles. Sans étiquette, une issue vaut pour toutes les cibles actives.
- **Ni jalon ni issue par cible** : un jalon est une échéance et se ferme, une issue se ferme ; une
  cible reste. Une cible change d'état ici, à la demande du porteur.
- **Chantiers** : une case « prioritaire » de la matrice qu'aucune issue ne couvre donne un chantier,
  étiqueté de sa cible. La matrice repère les trous ; elle ne découpe pas le travail — les chantiers
  restent des besoins produit. Elle se relit : aucun outil ne la vérifie.

Une entrée donne, sur sa ligne **Construction**, les commandes entre accents graves qui la
construisent.

## Webapp · Chromium sur Android

- **Ce qu'elle est** : l'application web (PWA), ouverte ou installée depuis Chrome sur Android.
  C'est là que le porteur l'utilise surtout.
- **État** : active
- **Construction** : `pnpm build`, `pnpm --filter @tirelire/hebergement assembler`
- **Livraison** : le site assemblé (PWA, relais PHP, réglages du serveur) se dépose par FTP sur
  l'hébergement mutualisé à chaque push sur `main` (D35, D37).
- **Étiquette** : `cible:webapp`

## Webapp · Chromium sur ordinateur

- **Ce qu'elle est** : la même application web, dans Chrome ou Edge sur ordinateur, ouverte ou
  installée.
- **État** : active
- **Construction** : `pnpm build`, `pnpm --filter @tirelire/hebergement assembler`
- **Livraison** : le même site que la webapp sur Android.
- **Étiquette** : `cible:webapp`

## Webapp · Firefox sur ordinateur

- **Ce qu'elle est** : l'application web dans Firefox, qui n'installe pas d'application web.
- **État** : plus tard
- **Construction** : celle de la webapp.
- **Étiquette** : `cible:webapp`

## Webapp · Safari sur ordinateur

- **Ce qu'elle est** : l'application web dans Safari sur macOS.
- **État** : plus tard
- **Construction** : celle de la webapp.
- **Étiquette** : `cible:webapp`

## Webapp · Safari sur iPhone et iPad

- **Ce qu'elle est** : l'application web dans Safari sur iOS et iPadOS, ajoutée ou non à l'écran
  d'accueil (C4).
- **État** : plus tard
- **Construction** : celle de la webapp.
- **Étiquette** : `cible:webapp`

## Relais PHP seul

- **Ce qu'elle est** : le relais de synchronisation (I8), seul, sur un serveur web existant qui sert
  du PHP ; il ne porte aucun usage.
- **État** : active
- **Construction** : `pnpm --filter @tirelire/hebergement assembler`
- **Livraison** : `apps/hebergement/serveur/relais.php`, déposé avec le site ; à recopier tel quel
  sur un autre serveur.
- **Étiquette** : `cible:relais`

## APK Android

- **Ce qu'elle est** : l'application emballée par Capacitor, installée hors magasin (C7).
- **État** : de côté
- **Construction** : `./gradlew --no-daemon assembleRelease`, seulement à un tag `v*`.
- **Livraison** : l'APK signé de test, publié dans la release du tag.
- **Étiquette** : `cible:apk`

## Application Apple

- **Ce qu'elle est** : une application native pour iPhone et iPad.
- **État** : plus tard
- **Construction** : aucune.
- **Étiquette** : `cible:ios`

## Relais Node

- **Ce qu'elle est** : le relais de `apps/relay`, publié dans une release pour qui a un serveur Node.
- **État** : plus tard
- **Construction** : aucune.
- **Étiquette** : `cible:relais`

## Fichier HTML unique

- **Ce qu'elle est** : l'application en un seul fichier, à ouvrir d'un double-clic (C3).
- **État** : plus tard
- **Construction** : aucune.

## Application de bureau

- **Ce qu'elle est** : une application installée sur Windows, macOS ou Linux.
- **État** : plus tard
- **Construction** : aucune.

Les deux dernières n'ont pas d'étiquette : elle se crée quand la cible devient active.

## Matrice usages × cibles

Les usages sont ceux de la description. Seules les cibles actives portent une priorité ; toute case
d'une cible de côté ou à venir vaut « à venir ». Le relais PHP ne porte aucun usage : « sans objet »
partout (il sert I8).

| Usage | Webapp · Chromium sur Android | Webapp · Chromium sur ordinateur | Relais PHP seul |
|---|---|---|---|
| U1 · Budget seul | **prioritaire** | **prioritaire** | sans objet |
| U2 · Budget et virements permanents | à venir | à venir | sans objet |
| U3 · Budget sans virements validés, puis import | à venir | à venir | sans objet |
| U4 · Budget reconstruit depuis l'historique | à venir | à venir | sans objet |
| U5 · Import seul | à venir | à venir | sans objet |
