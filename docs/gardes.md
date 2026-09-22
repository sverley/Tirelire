# Gardes des invariants et des contraintes

Chaque invariant ([`invariants.md`](invariants.md)) et chaque contrainte
([`contraintes.md`](contraintes.md)) est gardé par un harnais tant que c'est possible. Ce qui ne se
programme pas devient une vérification manuelle : demandée dans l'issue du besoin, constatée par le
porteur sur la version de dev après le passage en Ready de la PR, qui vaut validation, avant la
fusion. Ce document tient la correspondance ; `packages/gardes` le relit.

Le vocabulaire est celui de [`glossaire.md`](glossaire.md).

## Ce qui est vérifié

- **À chaque `pnpm test`**, donc dans la CI : chaque identifiant des deux documents a son entrée ici,
  gardée par un harnais qui existe et tourne, une vérification manuelle décrite, ou un renvoi vers
  des entrées elles-mêmes gardées. Un identifiant ajouté sans garde fait échouer les tests, un
  harnais renommé aussi. Un titre ou un élément de liste qui s'ouvre sur un identifiant sans en avoir
  la forme est refusé plutôt qu'ignoré. Un test que nomme une ligne `Harnais` doit tourner dans l'un
  des fichiers cités : mis en commentaire, désactivé, seulement prévu, ou dans une suite désactivée,
  il compte comme absent. Chaque ligne `Harnais` cite son témoin rouge, ou porte « à faire » avec
  son issue. Un test qui se saute faute d'outil compte comme un test qui tourne, parce qu'en CI
  `TIRELIRE_STRICT` rend l'outil obligatoire.
- **Dans chaque lanceur local** : un harnais joué en local ne sort pas de la machine. Le script
  `test` de chaque paquet précharge `packages/gardes/sans-sortie.mjs`.
- **Au passage en Ready de chaque PR**, par le job « Validation » : la section « Invariants et
  contraintes » de l'issue que la PR ferme (`Close #n`) déclare les identifiants touchés et ceux dont
  le lien pourrait être masqué ; un fichier modifié qui répond aux `Chemins` d'une entrée impose de la
  déclarer, et la garde rougit en nommant l'entrée manquante ; chaque vérification manuelle des
  entrées déclarées, et chaque garde retirée de ce document, figure dans la section avec sa consigne
  recopiée. Tant qu'il manque quelque chose, le job est rouge. Aucune case : le passage en Ready est
  la validation du porteur, rien ne l'enregistre, et tout changement ensuite de la PR ou de l'issue la
  renvoie en brouillon. La même vérification se joue en local, avant le Ready :
  `node packages/gardes/cli.mjs pr --issue <n>` (ou `--corps-fichier`), sur les fichiers modifiés
  depuis `origin/main`, copie de travail comprise.
- **La garde qui juge une PR est celle de `main`.** Le job « Validation » exécute la garde et le
  workflow de `main`, la branche par défaut, quelle que soit la base de la PR ; il juge le contenu de la PR : ce
  registre, les documents et les fichiers modifiés, tels que la PR les porte, et la section de
  l'issue qu'elle ferme. Il les lit par git dans le commit de la PR, sans l'extraire, et l'issue par
  l'API, avec le jeton du job : rien de la PR ne s'installe ni ne s'exécute, et ses permissions sont
  en lecture seule. Une PR qui modifie `packages/gardes/**` ou `.github/workflows/validation.yml` ne
  change donc pas le verdict rendu sur elle-même. Quand la garde de la
  base ne sait pas lire ce que la PR propose — ce registre absent, ou d'un format qu'elle ne
  reconnaît pas —, le job est rouge et le dit : c'est au porteur de trancher. `pnpm test`, lui, joue
  la garde que la PR propose.
- **La déclaration se lit comme GitHub l'affiche.** Les blocs de code et les commentaires HTML ne
  comptent pas ; les identifiants se lisent sans tenir compte de la casse ; une plage (`U1 à U3`)
  déclare chacun de ceux qu'elle couvre.
- **Ce que la garde ne vérifie pas** : qu'une règle ou une décision nouvelle ne contredit ni les
  autres, ni les documents fondateurs. C'est un jugement, et il revient à l'auditeur (`CLAUDE.md`).

## Écrire une entrée

Le titre commence par l'identifiant (`## I7 · …`, `### U1 · …`, `## C3 · …`) ; seul l'identifiant
compte, et un titre qui s'ouvre sur un identifiant sous une autre forme est refusé. Viennent ensuite, au choix :

- `Chemins :` suivi de motifs entre accents graves (`*` dans un dossier, `**` à travers les
  dossiers) : modifier un fichier qui y répond impose de déclarer l'entrée. C'est un plancher,
  volontairement étroit ; l'auditeur ajoute ce qu'il ne voit pas.
- Une ligne `Harnais` : un ou plusieurs chemins entre accents graves, un tiret cadratin, puis ce que
  le harnais garde. Pour un test précis, son nom vient en tête, entre guillemets, comme « positions
  et soldes (D19, D29) » pour I2 : c'est alors ce test, titre d'un `describe`, d'un `it` ou d'un
  `test` écrit en toutes lettres, qui doit exister et tourner dans l'un des fichiers cités, et non
  le seul fichier (tranché dans #59). Elle se termine par le témoin rouge, dans la même phrase ou
  dans la suite renfoncée : `Témoin rouge : « nom du test »` s'il existe, tourne, et échoue sur une
  version cassée du besoin ; `Témoin rouge : à bâtir (#123)` sinon, avec le numéro de l'issue qui le
  doit. Une ligne `Harnais` sans l'un ou l'autre est refusée (#66).
- Une ligne `Vérification manuelle` : un identifiant `VM-<entrée>-<nom>`, un tiret cadratin, puis ce
  qu'on fait, sur quoi, et ce qu'on doit constater. La consigne se proportionne à la PR : une
  PR qui ne touche que des tests, de l'outillage ou de la documentation ne déclenche ni manipulation
  de l'application ni construction de l'APK ; le compte rendu du codeur dit pourquoi l'application
  n'est pas atteinte.
- Une ligne `Couvert par` : des identifiants, un tiret cadratin, puis pourquoi. Déclarer l'entrée
  demande alors aussi les vérifications des entrées citées.
- Une ligne `À bâtir` : un harnais prévu (#38). Il ne garde rien tant qu'il n'existe pas ; une
  vérification manuelle tient sa place.

Retirer une vérification manuelle ou un harnais reste possible, mais l'issue de la PR qui le fait le
liste sous « Vérifications manuelles » (`VM-…` pour une vérification, `C9 · chemin` pour un
harnais), constaté et validé comme le reste.

## I1 · Aider un particulier à tenir un budget sur plusieurs comptes

- **Couvert par** · I2, I3 — la raison d'être se garde à travers la tirelire tenue sur plusieurs
  comptes et les cinq usages.

## I2 · Une tirelire est un livre de compte

Chemins : `packages/core/src/balances.ts`, `packages/core/src/model.ts`

- **Harnais** · `packages/core/test/plan.test.ts` — « positions et soldes (D19, D29) » : une
  tirelire répartie sur plusieurs comptes, son solde égal à la somme de ses composantes, le solde
  bancaire égal aux composantes portées plus le non-affecté.
  Témoin rouge : « témoin rouge · un solde de tirelire qui ne compte que son compte de placement »
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
  Témoin rouge : « témoin rouge · un budget ouvert aujourd’hui et ancré sur une occurrence à venir »
- **Harnais** · `packages/core/test/parcours-u1.test.ts` — « parcours U1 · de la base vide au plan, sans une seule opération » :
  d'une base vide, le budget écrit comme l'application l'écrit puis relu après redémarrage ; le plan
  de la période en cours se lit en entier — dotations, lissage de l'échéance, marge, virement à
  faire — et le bilan ne fabrique aucun observé, sans une seule opération.
  Témoin rouge : « témoin rouge · un plan dont les dotations viennent de ce que les opérations montrent »
- **Vérification manuelle** · `VM-U1-parcours` — Sur une base vide, construire un budget avec
  l'assistant jusqu'au plan sans importer de relevé : aucun écran ne bloque ni n'insiste pour
  importer, et le plan se lit.

### U2 · Budget et virements permanents

- **Harnais** · `packages/core/test/flux-derives-besoin.test.ts` — le virement permanent enregistre
  le montant de l'ordre chez la banque ; sa ventilation se recalcule, et un écart avec le budget se
  signale sans rien réécrire (#14, D60).
  Témoin rouge : « témoin rouge · un ordre permanent qui mémorise sa ventilation au lieu de la recalculer »
- **Harnais** · `apps/web/test/navigateur/flux-derives-plan.test.ts` — à 375 px, l'écran Plan enregistre
  l'ordre, qui survit au rechargement.
  Témoin rouge : « témoin rouge · un Plan qui réécrit l’ordre au lieu d’enregistrer le fait bancaire »
- **Harnais** · `packages/core/test/parcours-u2.test.ts` — « parcours U2 · du budget aux ordres permanents enregistrés avec leur ventilation » :
  d'une base vide au plan, l'ordre proposé n'est écrit que si l'utilisateur le valide (I10), puis il
  survit au redémarrage comme fait bancaire — un par couple de comptes, libellé à recopier — et le
  plan lit sa ventilation sans jamais la figer.
  Témoin rouge : « témoin rouge · un ordre validé qui ne laisse aucune trace dans la base »
- **Vérification manuelle** · `VM-U2-ordres` — Construire un budget, puis valider la mise en place
  des virements permanents proposés : chaque ordre est enregistré, et sa ventilation sur les
  tirelires se lit dans le plan.

### U3 · Budget sans virements validés, puis import

- **Harnais** · `packages/core/test/import.test.ts` — « rapprochement » : virements « TIRELIRE … »
  reconnus et répartis par l'ordre de financement (D21), flux rapprochés quand libellé et montant
  concordent.
  Témoin rouge : « témoin rouge · un virement reconnu versé en entier à une seule tirelire »
- **Vérification manuelle** · `VM-U3-rapprochement` — Construire un budget sans valider les
  virements, puis importer un relevé inventé qui les contient : l'application propose de les
  rapprocher et reprend la ventilation prévue par le budget.
- **À bâtir** · le parcours complet, du budget sans virements validés au rapprochement de l'import (#40).

### U4 · Budget reconstruit depuis l'historique

- **Harnais** · `packages/core/test/review.test.ts` — bilans par catégorie et des provisions tirés
  des opérations ; une proposition d'ajustement ne s'applique jamais seule.
  Témoin rouge : « témoin rouge · un bilan qui compte les dépenses ponctuelles dans la moyenne »
- **Vérification manuelle** · `VM-U4-reconstruction` — Sans budget, importer un historique inventé
  et reconstruire un budget depuis les opérations : chaque lien entre une opération et un flux se
  valide, rien ne s'applique sans accord, et la ventilation est demandée, jamais supposée.
- **À bâtir** · le parcours complet, des opérations importées au budget reconstruit (#16).

### U5 · Import seul

- **Harnais** · `packages/core/test/import.test.ts` — lecture des relevés, doublons exacts et
  probables.
  Témoin rouge : « témoin rouge · un import qui ne cherche les doublons que dans le fichier »
- **Harnais** · `packages/core/test/automations.test.ts` — moteur de règles de classement.
  Témoin rouge : « témoin rouge · un moteur de règles qui applique les rangs à l’envers »
- **Harnais** · `packages/core/test/parcours-u5.test.ts` — « parcours U5 · du relevé importé au bilan par catégorie, sans aucune tirelire » :
  d'une base vide, un relevé inventé importé, des catégories et des automatismes, le classement
  appliqué et relu après redémarrage ; le bilan par catégorie se lit et le plan ne réclame rien,
  sans qu'aucune tirelire, aucun besoin ni aucun budget n'existe jamais.
  Témoin rouge : « témoin rouge · un bilan qui ne compte que les opérations rattachées à une tirelire »
- **Vérification manuelle** · `VM-U5-sans-tirelire` — Sur une base vide, importer un relevé
  inventé, classer ses opérations et lire l'analyse par catégorie sans jamais créer de tirelire ni
  de budget : aucun écran ne l'exige, aucun ne reste vide faute d'en avoir.

## I4 · Simple par défaut, souple sur demande

Chemins : `apps/web/src/views/Wizard.svelte`

- **Harnais** · `apps/web/test/navigateur/assistant-simple.test.ts` — « parcours simple · de la base vide au plan, sans un seul réglage avancé » :
  d'une base vide, l'assistant s'ouvre depuis l'accueil en deux gestes au plus, chaque étape se
  franchit par son seul bouton primaire — aucun champ rempli, aucune liste dépliée, aucun détour par
  la Configuration — et le Plan qui suit dote des tirelires et réserve un montant non nul.
  Témoin rouge : « témoin rouge · un parcours simple qui exige un réglage pour avancer »
- **Vérification manuelle** · `VM-I4-simple` — Suivre l'usage simple que la PR touche (assistant,
  plan, saisie, import) : il aboutit sans ouvrir de réglage avancé, et ce que la PR ajoute pour un
  usage avancé reste replié ou hors de ce chemin.

## I5 · Inciter à tout utiliser

Chemins : `apps/web/src/App.svelte`, `apps/web/src/views/More.svelte`

- **Harnais** · `apps/web/test/navigateur/acces-fonctions.test.ts` — « inventaire des fonctions · chacune atteinte, nommée, et amorcée à vide » :
  l'inventaire couvre tous les écrans que le shell sait afficher ; chacun s'atteint depuis l'accueil
  en deux gestes au plus, par un point d'entrée qui le nomme et dit à quoi il sert ; et, sur une base
  vide, chaque écran porte son amorce — le bouton qui le remplit, ou l'écran par où commencer.
  Témoin rouge : « témoin rouge · une fonction sans point d entrée depuis l accueil »
- **Vérification manuelle** · `VM-I5-acces` — Pour chaque fonction que la PR ajoute ou déplace :
  dire d'où on l'atteint et en combien de gestes depuis l'accueil, et vérifier qu'un écran vide
  qu'elle touche dit ce qui le remplirait.

## I6 · Catégoriser en peu de clics

Chemins : `packages/core/src/automations.ts`, `apps/web/src/views/Operations.svelte`

Objectif du porteur (#71, 13 septembre 2026), depuis l'écran Opérations, l'opération sous les yeux :
**2 gestes** pour catégoriser une opération et **3 gestes** avec une sous-catégorie ; automatiser
toutes les opérations semblables coûte un geste de plus, soit **3 gestes** et **4 gestes**. Un geste
est une frappe sur un bouton ou une ligne, un choix dans une liste, une case cochée.

Le harnais mesure à l'objectif plus **1 geste** de marge, accordée par le porteur : il fait échouer
à 4, 5, 5 et 6 gestes. Mesure du 13 septembre 2026 : 3, 3, 4 et 4 gestes — l'objectif de 2 reste
devant le produit, et le seuil interdit la hausse.

- **Harnais** · `packages/core/test/automations.test.ts` — une règle classe toutes les opérations
  semblables, se rejoue sans effet de bord, et son aperçu ne modifie rien.
  Témoin rouge : « témoin rouge · un aperçu de règle qui enregistre la règle d’essai »
- **Harnais** · `apps/web/test/navigateur/gestes-classement.test.ts` — « gestes de classement · catégoriser une opération, puis toutes les semblables » :
  le compte des gestes mesuré dans le navigateur, sur les quatre cas de l'objectif ci-dessus, chacun
  comparé à son seuil ; une opération remise à zéro par le harnais avant chaque mesure, et la
  sous-catégorie créée par l'interface.
  Témoin rouge : « témoin rouge · un classement qui coûte un geste de plus que le seuil »
- **Vérification manuelle** · `VM-I6-gestes` — Compter les gestes pour classer une opération
  importée, puis toutes les opérations semblables ; écrire les deux nombres dans le compte rendu du
  codeur et signaler toute hausse par rapport à `main`.

## I7 · Les données restent en local

Chemins : `packages/core/src/sync.ts`, `apps/web/src/lib/db.ts`, `apps/web/src/lib/relay.ts`, `apps/web/src/lib/webrtc.ts`, `apps/relay/**`, `apps/hebergement/serveur/**`

- **Harnais** · `apps/web/test/navigateur/donnees-locales.test.ts` — « un parcours complet sans synchronisation
  ne fait sortir aucune donnée de l’appareil » : l'exemple chargé, un aller-retour par Opérations,
  Bilan, l'import d'un relevé inventé et l'export du fichier SQLite ne fait partir aucune requête
  réseau.
  Témoin rouge : « témoin rouge · une requête réseau partie pendant un parcours sans synchronisation »
- **Harnais** · `apps/web/test/navigateur/donnees-locales.test.ts` — « avec un relais renseigné, seuls des
  paquets chiffrés partent, et seulement après le remplissage et le clic explicites » : remplir
  l'adresse, le salon et la phrase puis cliquer sur « Synchroniser maintenant » vaut l'acceptation,
  avertissement compris (tranché avec le porteur le 13 septembre 2026) ; rien ne part avant, et ce
  qui part ensuite ne porte que `site`, `upTo`, `iv`, `blob`, `blob` ne se relisant pas comme du
  JSON en clair.
  Témoin rouge : « témoin rouge · un paquet envoyé au relais dont le contenu se relit en clair »

## I8 · Synchroniser de pair à pair les instances qui partagent les clés

Chemins : `packages/core/src/sync.ts`, `packages/core/src/store.ts`, `packages/core/src/hlc.ts`, `apps/web/src/lib/relay.ts`, `apps/web/src/lib/webrtc.ts`, `apps/web/src/views/Sync.svelte`, `apps/relay/**`, `apps/hebergement/serveur/**`

- **Harnais** · `packages/core/test/sync.test.ts` — deux puis trois appareils convergent par le
  protocole, les changements d'un tiers sont relayés, l'échange par fichier est idempotent.
  Témoin rouge : « témoin rouge · un échange par fichier qui repart toujours de zéro »
- **Harnais** · `packages/core/test/store.test.ts` — « fusion entre deux appareils » : champs
  modifiés en concurrence, le plus récent gagne, une empreinte fausse est refusée.
  Témoin rouge : « témoin rouge · une fusion qui réécrit la ligne entière au lieu de la colonne »
- **Harnais** · `apps/relay/server.test.mjs`, `apps/hebergement/relais.test.mjs` — relais Node et
  PHP : dépôt, puis retrait filtré par appareil.
  Témoin rouge : « témoin rouge · un relais qui rend à chaque appareil ce qu’il a lui-même déposé »
- **Vérification manuelle** · `VM-I8-deux-instances` — Relier deux instances par QR code, puis deux
  sessions d'ordinateur sans appareil photo ; modifier des deux côtés : elles convergent en direct,
  puis par le relais quand elles ne sont pas ouvertes ensemble, et l'avertissement sur le dépôt de
  données chiffrées paraît à la première mise en lien.
- **À bâtir** · deux instances en direct et par relais, y compris entre deux personnes (#31).

## I9 · Plusieurs distributions

Chemins : `.github/workflows/ci.yml`, `package.json`, `pnpm-lock.yaml`, `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/capacitor.config.ts`, `apps/web/android/**`, `apps/hebergement/assembler.mjs`

- **Harnais** · `.github/workflows/ci.yml`, `packages/gardes/distributions.test.mjs` — au passage
  en Ready de chaque PR, le web et le site d'hébergement se construisent ; l'APK Android ne se construit qu'à un tag
  `v*`, jamais sur une PR ni à une fusion : l'application web est la distribution prioritaire
  (#45), et rien d'une autre distribution ne la bloque. Un fichier de workflow ne pouvant pas accueillir de test, le harnais le lit
  (tranché dans #69).
  Témoin rouge : « témoin rouge · une CI qui construit l'APK sur chaque PR et le site d'hébergement seulement après fusion »
- **Vérification manuelle** · `VM-I9-apk` — Si la PR touche la construction de l'application (ses
  dépendances, Vite, Capacitor, le projet Android, les jobs de la CI qui construisent ou publient) :
  construire l'APK depuis la branche en local (`pnpm build`, `npx cap sync android`, puis
  `./gradlew assembleRelease` dans `apps/web/android`). Sinon, et notamment si elle ne touche que des
  tests, de l'outillage ou de la documentation : dire dans le compte rendu du codeur pourquoi la construction
  n'est pas atteinte, et ce qui dépend de ce qu'elle change. L'APK n'est vérifié que par sa
  construction : son comportement réel n'est pas analysé tant que la priorité va à l'application
  web (#45). Ne pas poser de tag `v*` depuis la branche : il publierait une release.

## I10 · Proposer, et ne jamais faire de manière cachée

Chemins : `packages/core/src/plan.ts`

- **Harnais** · `packages/core/test/flux-derives-besoin.test.ts` — un budget qui monte ou baisse
  fait dire au plan l'ancien montant de l'ordre et le nouveau ; un ordre qui diverge est signalé,
  jamais réécrit.
  Témoin rouge : « témoin rouge · un plan qui réécrit l’ordre chez la banque au lieu de le signaler »
- **Vérification manuelle** · `VM-I10-propositions` — Faire évoluer le budget (monter, baisser,
  retirer un besoin) : le plan propose chaque évolution d'ordre qui en découle, et aucun ordre
  enregistré ne change sans validation.
- **À bâtir** · #48.

## I11 · Les assistants font partie de la vie de l'application

Chemins : `apps/web/src/views/Wizard.svelte`, `apps/web/src/views/Tirelires.svelte`,
`apps/web/src/views/Flows.svelte`, `apps/web/src/views/Accounts.svelte`,
`packages/core/src/suggestions.ts`

- **Harnais** · `apps/web/test/navigateur/assistant-equivalent.test.ts` — sur un projet vierge, chaque étape de
  l'assistant qui sème une ligne (compte, revenu, charge fixe, budget courant, échéance, épargne) a
  cette ligne retrouvée dans l'écran de configuration ordinaire correspondant (Comptes, Flux
  prévus, Tirelires), avec un bouton d'édition (« Modifier », ou « Placer » pour une tirelire semée
  sans placement — même formulaire) qui ouvre un champ éditable portant ce même nom.
  Témoin rouge : « témoin rouge · une ligne créée par l’assistant introuvable hors assistant »
- **Vérification manuelle** · `VM-I11-hors-assistant` — Pour une étape d'assistant que la PR ajoute
  et que le harnais ci-dessus ne couvre pas encore (nouvel assistant hors de « Construire mon
  budget », #55/#56), ou pour l'adaptation proposée quand le train de vie ou le budget évolue (#17,
  #48, #57) : retrouver le même geste hors de l'assistant, dans l'usage courant, et constater que
  ce que l'assistant a créé se modifie ensuite depuis les écrans ordinaires.
- **À bâtir** · #55, #56 ; adaptations proposées quand le train de vie ou le budget évoluent (#17,
  #48, #57).

## C1 · Aucun geste technique pour l'utilisateur

Chemins : `apps/web/src/**/*.svelte`, `apps/web/src/**/*.ts`, `apps/web/index.html`,
`apps/web/vite.config.ts`

- **Harnais** · `apps/web/test/c1-sans-geste-technique.test.ts` — « aucun fichier de apps/web/src ne
  porte un des motifs interdits » : les textes de l'interface, `.svelte` et `.ts` — un message se
  fabrique aussi dans un module — ne portent aucune des formes concrètes d'un geste technique
  (commande, terminal, adresse locale…).
  Témoin rouge : « témoin rouge · un texte d’interface qui invite à ouvrir un terminal »
- **Harnais** · `apps/web/test/c1-sans-geste-technique.test.ts` — « ni index.html ni le manifeste de
  vite.config.ts ne portent un des motifs interdits » : le titre de la page, et du manifeste PWA le
  nom, le nom court et la description — ce que le système écrit sous l'icône — s'affichent sans
  passer par `src`.
  Témoin rouge : « témoin rouge · un manifeste dont la description fait ouvrir un terminal »
- **Vérification manuelle** · `VM-C1-sans-geste` — Relire les textes que la PR ajoute à
  l'interface et à la documentation destinée à l'utilisateur : installer, mettre à jour,
  sauvegarder et synchroniser ne demandent ni commande, ni serveur à lancer, ni réglage réseau, ni
  adresse technique, sauf en voie avancée à côté d'une voie simple. Le harnais ci-dessus n'attrape
  que des motifs concrets, et ne lit que l'application elle-même — interface, page d'accueil,
  manifeste : la documentation destinée à l'utilisateur et l'esprit de C1 (une voie avancée
  tolérée, jamais seule) restent à la revue.

## C2 · L'essentiel ne dépend d'aucune capacité propre à une plateforme

Chemins : `apps/web/src/**/*.svelte`, `apps/web/src/**/*.ts`

- **Harnais** · `apps/web/test/c2-parcours-sans-camera.test.ts` — « aucun fichier essentiel ne fait
  appel à la caméra ou au QR code, hors Sync.svelte et webrtc.ts » : la caméra et le QR code ne
  servent qu'à la mise en relation directe (I8), jamais dans les cinq usages.
  Témoin rouge : « témoin rouge · un écran essentiel qui dépend de BarcodeDetector »
- **Vérification manuelle** · `VM-C2-equivalent` — Pour chaque capacité propre à une plateforme
  que la PR utilise (caméra, QR code, installation, partage, fichiers) : suivre le même parcours
  sans elle, sur un ordinateur sans caméra ou un navigateur qui ne l'offre pas, et constater qu'il
  aboutit.

## C3 · Une application web se sert depuis une adresse sûre

Chemins : `apps/web/src/lib/relay.ts`, `apps/web/vite.config.ts`, `apps/relay/**`, `apps/hebergement/**`, `.github/workflows/**`

- **Harnais** · `apps/hebergement/verifier.sh`, `apps/hebergement/verifier.test.mjs` — après chaque
  dépôt depuis `main`, le site en ligne redirige HTTP vers HTTPS, et le script échoue sinon (#78).
  La redirection se constate sur le site réel, par le script ; le harnais garde ce dont ce constat
  dépend — que le script sonde bien l'adresse en `http://`, relève où elle mène, et compte son échec
  (tranché dans #69, complété par #78).
  Témoin rouge : « témoin rouge · un script de vérification qui ne sonde plus l’adresse en http:// »
- **Harnais** · `apps/hebergement/apercu.test.mjs` — « #155 · les identifiants FTP restent hors de
  portée du code des PR » : tout job qui lit `secrets.OVH_FTP_*` déclare un environnement ; s'il
  peut tourner pour une PR, son workflow est lu sur `main` (`pull_request_target`), et il n'extrait
  que `main`, n'installe ni n'assemble rien, et reçoit le site en artefact ; un job de
  `pull_request_target` qui exécute le code de la PR n'a ni cache ni permission en écriture (#155).
  Lit les workflows comme le reste du fichier (#141). Ne constate pas la règle de l'environnement
  sur GitHub : c'est `VM-C3-depot-main`.
  Témoin rouge : « témoin rouge · un aperçu qui dépose avec des identifiants que le code de la PR peut atteindre »
- **Vérification manuelle** · `VM-C3-https` — Si la PR touche l'application ou le relais : donner à
  l'application un relais en `http://` hors de `localhost`, constater qu'elle le refuse ou le signale,
  et que la PR ne fait rien charger en HTTP. Si elle ne touche que des tests, de l'outillage ou de la
  documentation : dire dans le compte rendu du codeur pourquoi ni l'application ni le relais ne sont atteints.
- **Vérification manuelle** · `VM-C3-depot-main` — Si la PR touche un workflow qui lit
  `secrets.OVH_FTP_*`, `apps/hebergement/apercu.sh` ou `apps/hebergement/deposer.sh` : dans
  Settings → Environments, constater que l'environnement déclaré par ces jobs n'admet que `main` et
  porte les secrets `OVH_FTP_*`, qu'ils n'existent plus au niveau du dépôt ; sur l'aperçu de la PR,
  constater que le dépôt a tourné avec les scripts de `main` et reste dans `<dossier>/pr-<numéro>`
  (#155).
- **À bâtir** · le refus ou le signalement d'un relais en HTTP (besoin #67, harnais #38).

## C4 · Les données d'un navigateur tiennent à son adresse, et peuvent s'effacer

Analyse (audit #73, 13 septembre 2026) : la partie de C4 que #42 doit encore construire — demander
`navigator.storage.persist()` et dire si elle est obtenue — n'existe pas dans le code
(`apps/web/src/lib/db.ts` ne l'appelle pas). Un harnais ne peut garder un comportement qui n'existe
pas : coder son témoin rouge demanderait de coder le comportement lui-même, ce qui sort de l'audit
(#73 ne touche pas au code produit). Le harnais revient donc à #42, qui construit la demande de
persistance et son harnais dans la même PR ; la ligne « À bâtir » ci-dessous le porte tant que #42
n'est pas fusionnée, la vérification manuelle gardant la part déjà en place (les données déjà
écrites survivent).

Chemins : `apps/web/src/lib/db.ts`, `apps/web/vite.config.ts`, `apps/hebergement/assembler.mjs`

- **Vérification manuelle** · `VM-C4-effacement` — Dans l'application web sur Chromium (la
  distribution vérifiée, #45 ; ni l'APK ni Safari ne se vérifient ici) : ouvrir la version de la
  branche là où celle de `main` a des données, même adresse et même navigateur, et constater
  qu'elles sont toujours là. Si la PR change l'adresse, le chemin de base ou le nom de la base
  locale, l'utilisateur est prévenu et guidé pour les reprendre. Ce que Safari efface après sept
  jours sans visite ne se constate pas ici : #37 le porte, avec le reste de la cible Apple.
- **À bâtir** · la demande de persistance du stockage (#42).

## C5 · Sans serveur, aucune sauvegarde n'est implicite

Chemins : `apps/web/src/lib/db.ts`, `apps/web/src/views/Settings.svelte`

- **Harnais** · `packages/core/test/store.test.ts` — « survit à un export / réouverture » : le
  fichier exporté se rouvre à l'identique.
  Témoin rouge : « témoin rouge · une sauvegarde qui rejoue les tables et en oublie une »
- **Vérification manuelle** · `VM-C5-sauvegarde` — Depuis l'accueil, trouver comment sauvegarder
  sans le chercher ; exporter, vider le navigateur, réimporter le fichier : tout revient.
- **À bâtir** · l'absence de sauvegarde récente signalée (#41).

## C6 · Une application web ne compte pas sur l'arrière-plan

- **Couvert par** · I8 — la synchronisation directe entre instances ouvertes ensemble, et le relais
  pour les autres, sont la réponse à C6.

## C7 · Hors magasin, les systèmes alertent ou bloquent

Analyse (audit #73, 13 septembre 2026) : ce que C7 garde — l'avertissement ou le blocage qu'un
système affiche à l'installation d'une application native hors magasin — est un fait de l'appareil
et du système d'exploitation de qui installe, pas du code du dépôt ; aucun test lancé en CI n'ouvre
un vrai Android, Windows ou macOS pour constater l'écran qu'ils affichent. C'est pour cela que #38
la range dans les contraintes gardées « à la revue, quand une cible native est traitée » plutôt que
par un harnais : la revue reste manuelle tant qu'une cible native n'est pas traitée (#36, #37), et
le redevient à chaque cible nouvelle.

Chemins : `apps/web/android/**`, `apps/web/capacitor.config.ts`

- **Vérification manuelle** · `VM-C7-installation` — Si la PR touche une cible native ou sa
  distribution : écrire le geste d'installation qu'elle demande sur chaque système concerné, et
  vérifier qu'une voie sans ce geste reste offerte, l'application web installée depuis une
  instance, tant qu'aucun magasin n'est en place.

## C8 · Les instances ne sont pas toutes à la même version

Chemins : `packages/core/src/schema.ts`, `packages/core/src/migration.ts`, `packages/core/src/model.ts`, `packages/core/src/store.ts`, `packages/core/src/sync.ts`

- **Harnais** · `packages/core/test/store.test.ts` — « migration du modèle (D30) » : un champ
  réécrit par un pair non migré reste compris, et la migration est idempotente.
  Témoin rouge : « témoin rouge · une lecture qui rend les anciens genres tels quels »
- **Harnais** · `packages/core/test/flux-derives-besoin.test.ts` — une vieille photo de ventilation
  écrite par un pair non migré est ignorée.
  Témoin rouge : « témoin rouge · une vieille photo de pair non migré prise pour la ventilation »
- **Vérification manuelle** · `VM-C8-deux-versions` — Si la PR change le schéma, le modèle ou le
  protocole : synchroniser une instance construite depuis `main` avec une instance de la branche,
  dans les deux sens, en modifiant des deux côtés : rien ne se perd, ou l'écart est signalé
  clairement.
- **À bâtir** · #43.

## C9 · Une seule interface, du téléphone à l'ordinateur

Chemins : `apps/web/src/**/*.svelte`, `apps/web/src/app.css`

- **Harnais** · `apps/web/test/navigateur/mise-en-page.test.ts` — à 320 et 375 px, le document ne défile pas
  en largeur et aucun libellé ne recouvre son montant (D54).
  Témoin rouge : « témoin rouge · une page dont une ligne insécable déborde de l’écran »
- **Harnais** · `apps/web/test/navigateur/ergonomie.test.ts` — cibles de 44 px, texte de 12 px, contraste de
  4,5:1, aucun champ caché sous la barre d'onglets (D55).
  Témoin rouge : « témoin rouge · un écran aux cibles de 20 px et au texte gris pâle »
- **Harnais** · `apps/web/test/panneaux-edition.test.ts`, `apps/web/test/revealed.test.ts` — un
  formulaire s'ouvre sous la ligne qu'il modifie et vient dans le champ de vision.
  Témoin rouge : « témoin rouge · un panneau écrit en tête de document, hors extrait et sans titre »
- **Harnais** · `apps/web/test/navigateur/panneaux-nommes.test.ts` — un panneau d'édition nomme ce qu'il
  modifie, lisible à 375 px (D59).
  Témoin rouge : « témoin rouge · un panneau intitulé « Modifier » tout court, qui suit la frappe »
- **Vérification manuelle** · `VM-C9-telephone` — Sur un vrai téléphone, dans l'application web
  ouverte ou installée depuis Chrome sur Android (la distribution prioritaire, #45 ; l'APK ne se
  vérifie pas) : les écrans que la PR touche restent lisibles et atteignables au pouce, bord à bord,
  clavier logiciel ouvert, avec les polices du système.
- **Vérification manuelle** · `VM-C9-ordinateur` — Sur un ordinateur à grand écran, à la souris
  puis au clavier seul : les écrans que la PR touche s'utilisent sans geste tactile.
- **À bâtir** · étendre les gardes à la souris, au clavier et au grand écran (#38).
