# Domaine · Application

L'installation, les mises à jour, la version affichée, l'hébergement, et l'ergonomie commune à tous
les écrans. Reprend la lettre et l'analyse de l'ancien chantier 1 (#45).

## Intention

> 1. priorité à la webapp

(11 septembre 2026, sur la webapp prioritaire et Safari :)

> Non, on se base sur chromium dans les harnais donc on ne cible que chromium pour le moment

(11 septembre 2026, sur l'APK pendant cette priorité, parole retirée le 24 septembre :)

> ~~tant que ça peut compiler, on maintient la prod. Ca evite de choisir des solutions qui ne passeraient pas en apk. Mais on ne fait pas d'analyse de ce qui se passe vraiment cote app APK.~~

(24 septembre 2026 :)

> On retire la production de l'apk de ce chantier.

L'application web est la distribution prioritaire, sur les navigateurs Chromium : ce qui se livre se
livre et se vérifie d'abord là.

## Contraintes

Des catalogues (`docs/contraintes.md` et, pour I9, `docs/invariants.md`), telles qu'elles
s'appliquent à une webapp qui porte de vraies données :

- **C3** : l'instance de référence, la recette et le relais se servent en HTTPS.
- **C4** : les données tiennent à l'adresse ; tant que la persistance n'est pas demandée, Chrome
  peut les effacer faute de place.
- **C5** : une webapp qui porte de vraies données n'en a aucune copie ailleurs ; la sauvegarde doit
  être évidente.
- **C6, C8** : la webapp ne synchronise qu'ouverte, et deux instances peuvent tourner à des versions
  différentes.
- **C9** : elle se conçoit d'abord pour Chrome sur un téléphone de 375 px.
- **C1, C2** : l'installation proposée par Chrome ne demande aucun geste technique ; ce qui n'existe
  que dans Chromium (installation, lecture de QR code) garde une voie équivalente pour les cibles à
  venir.
- **I9** : aucun travail sur une autre distribution ne bloque la construction de la webapp.

Propres au domaine :

- Chromium seulement, sur Android et sur ordinateur, comme les harnais navigateur (parole du
  11 septembre, citée dans l'intention).
- L'adresse de l'instance de référence vient d'une variable GitHub, jamais écrite en dur.
  11 septembre 2026, à la question « tirelire.sim-dev.eu est-elle l'instance de référence
  définitive ? » :

  > oui surement mais pas de stockage en dur. On maintient par Variables github

- L'adresse de référence ne change pas sans que l'utilisateur puisse reprendre ses données :
  conséquence de C4, puisque les données restent attachées à l'ancienne adresse.

## Hypothèses

1. Le Chromium des harnais se comporte comme Chrome sur Android et sur ordinateur pour ce qui compte
   ici : stockage, service worker, installation. Si un écart apparaît, les harnais ne suffisent plus
   et la vérification sur un vrai téléphone prend le relais.
2. L'hébergement mutualisé sert le site en HTTPS et exécute le relais PHP (D35). S'il changeait, la
   livraison du site et du relais serait à revoir.
3. Une seule instance de référence porte les données des utilisateurs. Si son adresse changeait, les
   données resteraient à l'ancienne (C4) : sauvegarde et synchronisation seraient la seule voie pour
   les reprendre.
4. Chrome accorde la persistance du stockage à une webapp qui la demande, au moins une fois
   installée. Sinon, l'effacement reste un risque à signaler plutôt qu'à empêcher.

## Cibles

- **Webapp · Chromium sur Android** : active, prioritaire ; c'est là que le porteur utilise
  l'application.
- **Webapp · Chromium sur ordinateur** : active.
- **Relais PHP seul** : active, livré avec le site ; le domaine le porte parce qu'il fait partie de
  la distribution web.
- Toutes les autres, APK Android comprise : hors du domaine ; il ne les vise pas.

## Usages

Le domaine ne porte aucun usage en propre : c'est là que tous se livrent et se vérifient. Il les
sert tous à la même condition, une webapp qui garde de vraies données : persistantes (C4),
sauvegardées (C5), à une version connue (C8). D'après la matrice de `docs/cibles.md`, U1 est le
premier servi sur les deux cibles Chromium ; U1 lui-même relève de la version v1 et du domaine budget et tirelires.
