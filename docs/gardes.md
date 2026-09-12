# Gardes des invariants et des contraintes

Objectif primaire (#58, D61). Chaque invariant ([`invariants.md`](invariants.md)) et chaque
contrainte ([`contraintes.md`](contraintes.md)) est gardé par un harnais tant que c'est possible. Ce
qui ne se programme pas devient une vérification manuelle : demandée dans la PR, analysée par un
développeur ou un agent, validée par un développeur humain avant la fusion. Ce document tient la
correspondance ; `packages/gardes` le relit.

## Ce qui est vérifié

- **À chaque `pnpm test`**, donc avant chaque commit et dans la CI : chaque identifiant des deux
  documents a son entrée ici, gardée par un harnais qui existe, une vérification manuelle décrite
  ou un renvoi vers des entrées elles-mêmes gardées. Un invariant, un usage ou une contrainte ajouté
  sans garde fait échouer les tests, un harnais renommé aussi. Un titre, ou un élément de liste en
  gras ou en italique, qui s'ouvre sur un identifiant sans en avoir la forme (`## I7 · …`,
  `- **U1 · ….**`, `## C3 · …`) est refusé plutôt qu'ignoré. Un test que nomme une ligne `Harnais`
  doit exister et tourner dans l'un des fichiers cités : mis en commentaire, désactivé (`.skip`),
  seulement prévu (`.todo`), dans une suite désactivée, ou suite sans test actif, il compte comme
  absent (#59).
  Un test qui se saute faute d'outil compte comme un test qui tourne, parce qu'en CI
  `TIRELIRE_STRICT` rend l'outil obligatoire : un harnais du registre qui se saute sous condition
  sans lire cette variable est refusé, comme une CI dont l'étape `pnpm test` ne la pose plus.
- **Sur chaque PR**, par la vérification « Vérifications manuelles » : la description déclare les
  identifiants touchés et ceux dont le lien pourrait être masqué ; un fichier modifié qui répond aux
  `Chemins` d'une entrée impose de la déclarer ; chaque vérification manuelle des entrées déclarées,
  et chaque garde retirée de ce document, figure dans la description avec son analyse et une case
  « Validée » cochée par un développeur humain. Une vérification manuelle y recopie sa consigne, mot
  pour mot, après le tiret cadratin : qui valide la lit dans la PR (#60). Tant qu'il en manque une, ou
  qu'une consigne diffère, la vérification est rouge.
- **La déclaration se lit comme GitHub l'affiche** (#60). Les blocs de code et les commentaires HTML
  ne comptent pas ; une déclaration se poursuit à la ligne jusqu'à une ligne vide, une puce, un titre
  ou l'autre étiquette ; les identifiants se lisent sans tenir compte de la casse, et une plage
  (`U1 à U3`, `U1–U3`) déclare chacun de ceux qu'elle couvre. Une section ou une ligne en double, ou
  une plage qui mêle deux familles, est refusée plutôt que devinée.
- **Une validation vaut pour le code validé** (#61). Cocher « Validée » l'enregistre, dans un
  commentaire que seule la vérification écrit, avec la tête de la PR et sa branche cible. Un commit
  qui modifie le code, y compris en résolvant un conflit, ou un changement de branche cible l'annulent :
  la case se décoche, un commentaire dit pourquoi, et la vérification redevient rouge. La
  documentation (`docs/**`, `**/*.md`) et les harnais (`**/test/**`, `**/*.test.*`) se modifient sans
  l'annuler, comme l'analyse ; une fusion de la branche cible sans conflit non plus.

Préparer la section d'une PR : `node packages/gardes/cli.mjs demander --base origin/main`, puis
écrire l'analyse. Faire le point : `node packages/gardes/cli.mjs couverture`.

## Écrire une entrée

Le titre commence par l'identifiant (`## I7 · …`, `### U1 · …`, `## C3 · …`) ; seul l'identifiant
compte, et un titre qui s'ouvre sur un identifiant sous une autre forme est refusé. Viennent ensuite, au choix :

- `Chemins :` suivi de motifs entre accents graves (`*` dans un dossier, `**` à travers les
  dossiers) : modifier un fichier qui y répond impose de déclarer l'entrée. C'est un plancher,
  volontairement étroit ; l'analyse ajoute ce qu'il ne voit pas.
- Une ligne `Harnais` : un ou plusieurs chemins entre accents graves, un tiret cadratin, puis ce que
  le harnais garde. Pour un test précis, son nom vient en tête, entre guillemets, comme « positions
  et soldes (D19, D29) » pour I2 : c'est alors ce test, titre d'un `describe`, d'un `it` ou d'un
  `test` écrit en toutes lettres, qui doit exister et tourner dans l'un des fichiers cités, et non
  le seul fichier (tranché dans #59).
- Une ligne `Vérification manuelle` : un identifiant `VM-<entrée>-<nom>`, un tiret cadratin, puis ce
  qu'on fait, sur quoi, et ce qu'on doit constater. La consigne se proportionne à la PR (D62) : une
  PR qui ne touche que des tests, de l'outillage ou de la documentation ne déclenche ni manipulation
  de l'application ni construction de l'APK ; son analyse dit pourquoi l'application n'est pas atteinte.
- Une ligne `Couvert par` : des identifiants, un tiret cadratin, puis pourquoi. Déclarer l'entrée
  demande alors aussi les vérifications des entrées citées.
- Une ligne `À bâtir` : un harnais prévu (#38). Il ne garde rien tant qu'il n'existe pas ; une
  vérification manuelle tient sa place.

Retirer une vérification manuelle ou un harnais reste possible, mais la PR qui le fait le liste sous
« Vérifications manuelles » (`VM-…` pour une vérification, `C9 · chemin` pour un harnais), analysé
et validé comme le reste.

## I1 · Aider un particulier à tenir un budget sur plusieurs comptes

- **Couvert par** · I2, I3 — la raison d'être se garde à travers la tirelire tenue sur plusieurs
  comptes et les cinq usages.

## I2 · Une tirelire est un livre de compte

Chemins : `packages/core/src/balances.ts`, `packages/core/src/model.ts`

- **Harnais** · `packages/core/test/plan.test.ts` — « positions et soldes (D19, D29) » : une
  tirelire répartie sur plusieurs comptes, son solde égal à la somme de ses composantes, le solde
  bancaire égal aux composantes portées plus le non-affecté.
- **À bâtir** · un même cas où un compte porte plusieurs tirelires et une tirelire se répartit sur
  plusieurs comptes (#38).

## I3 · Chaque usage tient seul

- **Couvert par** · U1, U2, U3, U4, U5 — chaque usage a sa garde, ci-dessous.
- **Vérification manuelle** · `VM-I3-independance` — Relire ce que la PR rend obligatoire (étape,
  écran, donnée) : aucun usage n'en exige un autre, comme importer pour budgéter ou créer une
  tirelire pour classer, et aucun n'est présenté comme la version réduite d'un autre.

### U1 · Budget seul

- **Harnais** · `packages/core/test/assistant.test.ts` — « budget construit par l'assistant
  (D40) » : sans aucune opération, le budget se voit dès la période en cours.
- **Vérification manuelle** · `VM-U1-parcours` — Sur une base vide, construire un budget avec
  l'assistant jusqu'au plan sans importer de relevé : aucun écran ne bloque ni n'insiste pour
  importer, et le plan se lit.
- **À bâtir** · le parcours complet sans aucune opération (#15).

### U2 · Budget et virements permanents

- **Harnais** · `packages/core/test/flux-derives-besoin.test.ts` — le virement permanent enregistre
  le montant de l'ordre chez la banque ; sa ventilation se recalcule, et un écart avec le budget se
  signale sans rien réécrire (#14, D60).
- **Harnais** · `apps/web/test/flux-derives-plan.test.ts` — à 375 px, l'écran Plan enregistre
  l'ordre, qui survit au rechargement.
- **Vérification manuelle** · `VM-U2-ordres` — Construire un budget, puis valider la mise en place
  des virements permanents proposés : chaque ordre est enregistré, et sa ventilation sur les
  tirelires se lit dans le plan.
- **À bâtir** · des ordres validés depuis l'assistant, enregistrés avec leur ventilation (#13).

### U3 · Budget sans virements validés, puis import

- **Harnais** · `packages/core/test/import.test.ts` — « rapprochement » : virements « TIRELIRE … »
  reconnus et répartis par l'ordre de financement (D21), flux rapprochés quand libellé et montant
  concordent.
- **Vérification manuelle** · `VM-U3-rapprochement` — Construire un budget sans valider les
  virements, puis importer un relevé inventé qui les contient : l'application propose de les
  rapprocher et reprend la ventilation prévue par le budget.
- **À bâtir** · #40.

### U4 · Budget reconstruit depuis l'historique

- **Harnais** · `packages/core/test/review.test.ts` — bilans par catégorie et des provisions tirés
  des opérations ; une proposition d'ajustement ne s'applique jamais seule.
- **Vérification manuelle** · `VM-U4-reconstruction` — Sans budget, importer un historique inventé
  et reconstruire un budget depuis les opérations : chaque lien entre une opération et un flux se
  valide, rien ne s'applique sans accord, et la ventilation est demandée, jamais supposée.
- **À bâtir** · #16.

### U5 · Import seul

- **Harnais** · `packages/core/test/import.test.ts` — lecture des relevés, doublons exacts et
  probables.
- **Harnais** · `packages/core/test/automations.test.ts` — moteur de règles de classement.
- **Vérification manuelle** · `VM-U5-sans-tirelire` — Sur une base vide, importer un relevé
  inventé, classer ses opérations et lire l'analyse par catégorie sans jamais créer de tirelire ni
  de budget : aucun écran ne l'exige, aucun ne reste vide faute d'en avoir.
- **À bâtir** · #39.

## I4 · Simple par défaut, souple sur demande

- **Vérification manuelle** · `VM-I4-simple` — Suivre l'usage simple que la PR touche (assistant,
  plan, saisie, import) : il aboutit sans ouvrir de réglage avancé, et ce que la PR ajoute pour un
  usage avancé reste replié ou hors de ce chemin.
- **À bâtir** · l'assistant mène jusqu'au plan sans ouvrir de réglage avancé (#38).

## I5 · Inciter à tout utiliser

- **Vérification manuelle** · `VM-I5-acces` — Pour chaque fonction que la PR ajoute ou déplace :
  dire d'où on l'atteint et en combien de gestes depuis l'accueil, et vérifier qu'un écran vide
  qu'elle touche dit ce qui le remplirait.
- **À bâtir** · l'inventaire des fonctions et de leur point d'entrée (#38).

## I6 · Catégoriser en peu de clics

Chemins : `packages/core/src/automations.ts`, `apps/web/src/views/Operations.svelte`

- **Harnais** · `packages/core/test/automations.test.ts` — une règle classe toutes les opérations
  semblables, se rejoue sans effet de bord, et son aperçu ne modifie rien.
- **Vérification manuelle** · `VM-I6-gestes` — Compter les gestes pour classer une opération
  importée, puis toutes les opérations semblables ; écrire les deux nombres dans l'analyse et
  signaler toute hausse par rapport à `main`.
- **À bâtir** · le même compte, automatisé ; objectif chiffré à fixer par le porteur (#38).

## I7 · Les données restent en local

Chemins : `packages/core/src/sync.ts`, `apps/web/src/lib/db.ts`, `apps/web/src/lib/relay.ts`, `apps/web/src/lib/webrtc.ts`, `apps/relay/**`, `apps/hebergement/serveur/**`

- **Vérification manuelle** · `VM-I7-reseau` — Outils de développement ouverts sur l'onglet
  Réseau, suivre un parcours complet sans synchronisation (exemple, budget, import d'un relevé
  inventé, export) : rien ne part hors des fichiers de l'application. Avec le relais, seuls des
  paquets chiffrés partent, et seulement après l'avertissement.
- **À bâtir** · la même observation dans un navigateur piloté (#38).

## I8 · Synchroniser de pair à pair les instances qui partagent les clés

Chemins : `packages/core/src/sync.ts`, `packages/core/src/store.ts`, `packages/core/src/hlc.ts`, `apps/web/src/lib/relay.ts`, `apps/web/src/lib/webrtc.ts`, `apps/web/src/views/Sync.svelte`, `apps/relay/**`, `apps/hebergement/serveur/**`

- **Harnais** · `packages/core/test/sync.test.ts` — deux puis trois appareils convergent par le
  protocole, les changements d'un tiers sont relayés, l'échange par fichier est idempotent.
- **Harnais** · `packages/core/test/store.test.ts` — « fusion entre deux appareils » : champs
  modifiés en concurrence, le plus récent gagne, une empreinte fausse est refusée.
- **Harnais** · `apps/relay/server.test.mjs`, `apps/hebergement/relais.test.mjs` — relais Node et
  PHP : dépôt, puis retrait filtré par appareil.
- **Vérification manuelle** · `VM-I8-deux-instances` — Relier deux instances par QR code, puis deux
  sessions d'ordinateur sans appareil photo ; modifier des deux côtés : elles convergent en direct,
  puis par le relais quand elles ne sont pas ouvertes ensemble, et l'avertissement sur le dépôt de
  données chiffrées paraît à la première mise en lien.
- **À bâtir** · deux instances en direct et par relais, y compris entre deux personnes (#31).

## I9 · Plusieurs distributions

Chemins : `.github/workflows/ci.yml`, `package.json`, `pnpm-lock.yaml`, `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/capacitor.config.ts`, `apps/web/android/**`, `apps/hebergement/assembler.mjs`

- **Harnais** · `.github/workflows/ci.yml` — sur chaque PR, le web et le site d'hébergement se
  construisent ; l'APK Android ne se construit qu'après fusion sur `main`.
- **Vérification manuelle** · `VM-I9-apk` — Si la PR touche la construction de l'application (ses
  dépendances, Vite, Capacitor, le projet Android, les jobs de la CI qui construisent ou publient) :
  construire l'APK depuis la branche en local (`pnpm build`, `npx cap sync android`, puis
  `./gradlew assembleRelease` dans `apps/web/android`). Sinon, et notamment si elle ne touche que des
  tests, de l'outillage ou de la documentation (D62) : dire dans l'analyse pourquoi la construction
  n'est pas atteinte, et ce qui dépend de ce qu'elle change. Ne pas lancer « CI et livraison » à la
  main sur la branche : sa publication déplacerait la release `latest`.
- **À bâtir** · construire l'APK sur chaque PR, sans rien publier (#38).

## I10 · Proposer, et ne jamais faire de manière cachée

Chemins : `packages/core/src/plan.ts`

- **Harnais** · `packages/core/test/flux-derives-besoin.test.ts` — un budget qui monte ou baisse
  fait dire au plan l'ancien montant de l'ordre et le nouveau ; un ordre qui diverge est signalé,
  jamais réécrit.
- **Vérification manuelle** · `VM-I10-propositions` — Faire évoluer le budget (monter, baisser,
  retirer un besoin) : le plan propose chaque évolution d'ordre qui en découle, et aucun ordre
  enregistré ne change sans validation.
- **À bâtir** · #48.

## I11 · Les assistants font partie de la vie de l'application

Chemins : `apps/web/src/views/Wizard.svelte`, `packages/core/src/suggestions.ts`

- **Vérification manuelle** · `VM-I11-hors-assistant` — Pour chaque étape d'assistant que la PR
  ajoute ou modifie : retrouver le même geste hors de l'assistant, dans l'usage courant, et
  constater que ce que l'assistant a créé se modifie ensuite depuis les écrans ordinaires.
- **À bâtir** · #55, #56 ; adaptations proposées quand le train de vie ou le budget évoluent (#17,
  #48, #57).

## C1 · Aucun geste technique pour l'utilisateur

- **Vérification manuelle** · `VM-C1-sans-geste` — Relire les textes que la PR ajoute à
  l'interface et à la documentation destinée à l'utilisateur : installer, mettre à jour,
  sauvegarder et synchroniser ne demandent ni commande, ni serveur à lancer, ni réglage réseau, ni
  adresse technique, sauf en voie avancée à côté d'une voie simple.

## C2 · L'essentiel ne dépend d'aucune capacité propre à une plateforme

Chemins : `apps/web/src/lib/platform.ts`, `apps/web/src/views/Sync.svelte`

- **Vérification manuelle** · `VM-C2-equivalent` — Pour chaque capacité propre à une plateforme
  que la PR utilise (caméra, QR code, installation, partage, fichiers) : suivre le même parcours
  sans elle, sur un ordinateur sans caméra ou un navigateur qui ne l'offre pas, et constater qu'il
  aboutit.
- **À bâtir** · les parcours essentiels sans caméra ni lecture de QR code (#38).

## C3 · Une application web se sert depuis une adresse sûre

Chemins : `apps/web/src/lib/relay.ts`, `apps/web/vite.config.ts`, `apps/relay/**`, `apps/hebergement/**`

- **Harnais** · `apps/hebergement/verifier.sh` — après chaque dépôt depuis `main`, le site en ligne
  redirige HTTP vers HTTPS.
- **Vérification manuelle** · `VM-C3-https` — Si la PR touche l'application ou le relais : donner à
  l'application un relais en `http://` hors de `localhost`, constater qu'elle le refuse ou le signale,
  et que la PR ne fait rien charger en HTTP. Si elle ne touche que des tests, de l'outillage ou de la
  documentation (D62) : dire dans l'analyse pourquoi ni l'application ni le relais ne sont atteints.
- **À bâtir** · le refus ou le signalement d'un relais en HTTP (besoin #67, harnais #38).

## C4 · Les données d'un navigateur tiennent à son adresse, et peuvent s'effacer

Chemins : `apps/web/src/lib/db.ts`, `apps/web/vite.config.ts`, `apps/hebergement/assembler.mjs`

- **Vérification manuelle** · `VM-C4-effacement` — Ouvrir la version de la branche là où celle de
  `main` a des données, même adresse et même navigateur : elles sont toujours là. Si la PR change
  l'adresse, le chemin de base ou le nom de la base locale, l'utilisateur est prévenu et guidé pour
  les reprendre. Sur Safari iPhone, noter si le stockage est déclaré persistant.
- **À bâtir** · la demande de persistance du stockage (#42).

## C5 · Sans serveur, aucune sauvegarde n'est implicite

Chemins : `apps/web/src/lib/db.ts`, `apps/web/src/views/Settings.svelte`

- **Harnais** · `packages/core/test/store.test.ts` — « survit à un export / réouverture » : le
  fichier exporté se rouvre à l'identique.
- **Vérification manuelle** · `VM-C5-sauvegarde` — Depuis l'accueil, trouver comment sauvegarder
  sans le chercher ; exporter, vider le navigateur, réimporter le fichier : tout revient.
- **À bâtir** · l'absence de sauvegarde récente signalée (#41).

## C6 · Une application web ne compte pas sur l'arrière-plan

- **Couvert par** · I8 — la synchronisation directe entre instances ouvertes ensemble, et le relais
  pour les autres, sont la réponse à C6.

## C7 · Hors magasin, les systèmes alertent ou bloquent

Chemins : `apps/web/android/**`, `apps/web/capacitor.config.ts`

- **Vérification manuelle** · `VM-C7-installation` — Si la PR touche une cible native ou sa
  distribution : écrire le geste d'installation qu'elle demande sur chaque système concerné, et
  vérifier qu'une voie sans ce geste reste offerte, l'application web installée depuis une
  instance, tant qu'aucun magasin n'est en place.

## C8 · Les instances ne sont pas toutes à la même version

Chemins : `packages/core/src/schema.ts`, `packages/core/src/migration.ts`, `packages/core/src/model.ts`, `packages/core/src/store.ts`, `packages/core/src/sync.ts`

- **Harnais** · `packages/core/test/store.test.ts` — « migration du modèle (D30) » : un champ
  réécrit par un pair non migré reste compris, et la migration est idempotente.
- **Harnais** · `packages/core/test/flux-derives-besoin.test.ts` — une vieille photo de ventilation
  écrite par un pair non migré est ignorée.
- **Vérification manuelle** · `VM-C8-deux-versions` — Si la PR change le schéma, le modèle ou le
  protocole : synchroniser une instance construite depuis `main` avec une instance de la branche,
  dans les deux sens, en modifiant des deux côtés : rien ne se perd, ou l'écart est signalé
  clairement.
- **À bâtir** · #43.

## C9 · Une seule interface, du téléphone à l'ordinateur

Chemins : `apps/web/src/**/*.svelte`, `apps/web/src/app.css`

- **Harnais** · `apps/web/test/mise-en-page.test.ts` — à 320 et 375 px, le document ne défile pas
  en largeur et aucun libellé ne recouvre son montant (D54).
- **Harnais** · `apps/web/test/ergonomie.test.ts` — cibles de 44 px, texte de 12 px, contraste de
  4,5:1, aucun champ caché sous la barre d'onglets (D55).
- **Harnais** · `apps/web/test/panneaux-edition.test.ts`, `apps/web/test/revealed.test.ts` — un
  formulaire s'ouvre sous la ligne qu'il modifie et vient dans le champ de vision.
- **Harnais** · `apps/web/test/panneaux-nommes.test.ts` — un panneau d'édition nomme ce qu'il
  modifie, lisible à 375 px (D59).
- **Vérification manuelle** · `VM-C9-telephone` — Sur un vrai téléphone, dans l'application
  installée : les écrans que la PR touche restent lisibles et atteignables au pouce, bord à bord,
  clavier logiciel ouvert, avec les polices du système.
- **Vérification manuelle** · `VM-C9-ordinateur` — Sur un ordinateur à grand écran, à la souris
  puis au clavier seul : les écrans que la PR touche s'utilisent sans geste tactile.
- **À bâtir** · étendre les gardes à la souris, au clavier et au grand écran (#38).
