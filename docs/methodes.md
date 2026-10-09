# Méthodes

Les décisions du porteur sur **le travail** : la méthode et les rôles. Celles sur **le produit**
sont dans [`decisions.md`](decisions.md) ; les deux catalogues se partagent les identifiants. Même
autorité, même cohérence : une décision ne contrevient jamais à un principe ni à une autre décision,
de l'un ou l'autre catalogue (principe 9.1), elle respecte les invariants
([`invariants.md`](invariants.md)) et les contraintes ([`contraintes.md`](contraintes.md)). Si un
besoin semble exiger le contraire, la question se pose d'abord dans une issue.

Chaque décision dit ce qu'elle implique, et pourquoi l'hypothèse qu'elle écarte ne tenait pas. Pour
en changer une, on l'amende : pas d'entrée qui en remplace une autre, pas de renvoi à ce qu'elle
remplace. Les identifiants sont ceux des entrées, sans date ; l'historique appartient à git. Une
décision nouvelle prend le numéro qui suit le plus grand des deux catalogues ; les numéros retirés
ne se réemploient pas.

### D77 · Les documents fondateurs, et ce qui fait foi

Les documents fondateurs : `docs/description-projet.md` (les paroles du porteur, ouvertes par ses
sections « Principes » et « Usages »), `docs/glossaire.md`, les catalogues — `docs/invariants.md`,
`docs/contraintes.md`, `docs/cibles.md`, `docs/decisions.md`, `docs/methodes.md`,
`docs/gardes.md` (le registre : chaque invariant et chaque contrainte, avec son harnais ou sa
vérification manuelle) — les documents des
domaines, `docs/domaines/`, le catalogue des versions, `docs/versions.md`, et les descriptifs des rôles, `docs/roles/`. Un document fondateur est
forcément un fichier Markdown de `docs/` : un document d'un autre format (HTML, par exemple) ne l'est jamais, et ce qu'il porte de fondateur se
reprend dans un Markdown. Tout Markdown de `docs/` n'est pas fondateur pour autant : la liste est
celle-ci.

La description fait foi (principe 7) : elle ne se reformule pas ; ce que le porteur y corrige est
daté, et ce qu'il retire reste barré. Les principes et les usages y vivent, dans leurs
sections dédiées, en listes numérotées du plus général au plus précis ; aucun autre document ne les
recopie. Les paroles conservées suivent le glossaire : quand un terme change, la citation est amendée
au terme nouveau, avec l'accord du porteur, demandé à chaque renommage.

Les documents fondateurs sont tels qu'ils sont : on ne les restructure pas ; on les corrige quand une
PR les touche, et seulement là. `CLAUDE.md` n'est pas source de vérité : il renvoie aux documents
fondateurs et ne contredit jamais les fondamentaux.

### D78 · Des ensembles cohérents, une information à un seul endroit

- **Une décision nouvelle s'écrit dans son catalogue**, `decisions.md` pour le produit,
  `methodes.md` pour le travail, en une entrée, sans date ni renvoi à ce qu'elle remplace :
  on amende l'entrée ancienne. Qu'elle ne contredise ni les autres ni les fondamentaux se vérifie en
  relisant (architecte, auditeur) ; la garde n'en serait pas capable. Les tests qu'elle rougit
  suivent le principe 9.3.
- **Une information ne se duplique pas.** Elle vit à un seul endroit ; les autres y renvoient.
- **Un document ne compte pas ce que le code produit.** Un nombre qui résulte du code sans être un
  fondement du projet — le nombre de tests, par exemple — vit dans l'outil qui le produit
  (`pnpm test`, la garde) ; le document n'en porte pas. Ce qui vit dans les documents se compte
  librement, et un nombre accompagné de la liste qu'il compte reste : il en fait partie et lève les
  ambiguïtés, à condition de compter juste.
- **Le projet tient sans ses issues.** Elles servent à le conduire ; une issue reste ouverte tant
  qu'elle est cohérente avec les catalogues, et c'est le catalogue qui fait référence.
- **Une issue, une PR, une fusion.** Ce qui en déborde est une nouvelle issue, ouverte avant la
  fusion ; rien ne reste dans un fil qui va se fermer.
- **Pas d'outil nouveau sans issue produit qui l'exige.** Une PR qui n'améliore que la garde, les
  crochets ou la CI ne s'ouvre pas sans que le porteur l'ait demandée.

### D79 · Un invariant se prouve ; une décision n'en porte un que si sa valeur est permanente

Un invariant quantifie une mesure (principe 9.2) et se prouve par un harnais ou, quand aucun test ne
peut la trancher, par une vérification manuelle. Une décision ne porte un invariant que si elle pose
une valeur que tout le projet doit respecter en permanence ; sinon elle se prouve par ses tests (le
produit) ou par la relecture (le travail).

### D80 · Quatre rôles

Un besoin passe par quatre rôles, chacun décrit dans `docs/roles/`, en un texte qui sert de prompt :
l'**architecte** analyse le besoin et pose ses spécifications, et suit une version jusqu'à sa
publication sans spécifier ses tâches ; le **codeur** code, avec les tests dont il a besoin, et
ouvre la PR ; l'**auditeur** vérifie le codage et compose le harnais parmi les tests du codeur,
quitte à les compléter (#283) ; le **porteur** valide. L'analyse du besoin est indépendante de
l'audit : l'architecte et l'auditeur sont deux sessions distinctes ; l'auditeur complète dans
l'issue ce que l'architecte a manqué, sans retirer ni réécrire ce qu'il a écrit (#286). Un
descriptif de rôle dit ce que le rôle fait, dans quel ordre ; il renvoie aux catalogues pour les
décisions qu'il applique.

L'issue définit le besoin ; la PR porte la solution et son avancement. Ce qui définit le besoin —
une question, une hypothèse du codeur, un ajout de l'auditeur — s'écrit dans l'issue. Le codeur n'y
inscrit une hypothèse et ne poursuit que si elle lui semble très probable : l'auditeur vérifie
qu'elle est fondée et juste. Sinon, il soumet ses hypothèses à l'architecte, qui les tranche dans
l'issue. L'auditeur ne prend jamais d'hypothèse. Le compte rendu du codeur, la vérification de
l'auditeur et ses retours s'écrivent dans la PR. Ce qu'une session rend en fin de session, à qui
l'a lancée, y renvoie sans le reprendre : une information à un seul endroit (D78). Seule exception :
l'auditeur transmet aussi ses retours en direct à l'architecte, en plus de les consigner dans
l'issue et la PR quand il y en a (porteur, 05/10).

### D81 · La garde

Un seul outil, `packages/gardes`, testé par des tests ordinaires dans `pnpm test`. Il vérifie trois
choses, et rien de plus :

1. chaque invariant et chaque contrainte a une entrée au registre, avec un harnais qui existe ou une
   vérification manuelle décrite ;
2. une PR qui modifie un document fondateur, ou un fichier qu'une entrée du registre nomme, a l'entrée
   déclarée dans la section « Invariants et contraintes » de l'issue qu'elle ferme (`Close #n`) ;
   sinon elle est rouge, et la garde nomme l'entrée manquante et, dans le même passage, ses
   vérifications manuelles (#328) ;
3. chaque vérification manuelle des entrées déclarées figure dans cette section, sa consigne
   recopiée, sans case : la fusion vaut validation.

Il tourne en CI au passage en Ready de chaque PR, et à la demande en local, hors ligne, sur le corps
de l'issue donné en fichier ou en texte (`node packages/gardes/cli.mjs pr --corps-fichier <fichier>`,
ou la variable `CORPS`), sur les fichiers modifiés depuis `origin/main` (#349). De l'issue, il ne lit
que le corps, jamais ses commentaires. En CI, la garde qui juge est celle de `main`, avec le workflow
de `main` ; ce qu'elle juge est le contenu
de la PR — registre, documents, fichiers modifiés —, qu'elle lit par git sans rien exécuter de la PR,
et la section de l'issue, lue par l'API avec le jeton du job, en lecture. Une PR qui modifie la garde
ne change donc pas son propre verdict ; ses tests, eux, jouent la garde qu'elle propose. Pas de
crochet lent, pas d'alerte.

Pour le produit, un harnais qui peut être codé doit l'être (principe 10). Pour la garde (principe
12), ce qui peut se vérifier par analyse de code — une relecture, une recherche — n'y va pas ; seul y
va ce qui le mérite. La documentation et la garde se modifient sans harnais par
défaut : l'auditeur vérifie en relisant. Un harnais dédié ne s'écrit que pour un cas de test complexe
dans la garde. Un changement de comportement de la garde est expliqué et justifié dans le compte
rendu du codeur : il nomme les tests de la garde de `main` qui rougissent avec la garde proposée, et
ceux qu'il modifie ; la validation du porteur le couvre.

Un besoin d'outillage qui ne change qu'un réglage ou un texte — une heure, un déclenchement, une
condition, un message, un nom — se vérifie comme la documentation (#382) : l'architecte le dit dans
l'issue, après la ligne « Usages », par « Vérification : relecture », et son « Fait quand » ne
demande alors aucun test ; le codeur n'écrit pas de test, l'auditeur pas de harnais, et rien ne
s'ajoute aux tests de la garde ; l'auditeur relit le diff et joue la garde hors ligne, sans
`pnpm test 2` (D92). Un auditeur qui juge qu'un test le mérite le dit dans la PR, et le porteur
tranche. Un test qui recopie un réglage ne vérifie que la recopie : il est une seconde place pour la
même valeur (D78), et rougit à chaque changement voulu (05ede00, qui a changé l'heure de la nuit).

Les tests de la garde sont ceux qui vérifient la garde elle-même : ses trois vérifications et la
règle des harnais ; ils vivent dans `packages/gardes/gardes.test.mjs`. Eux et les harnais du registre
servent le même but — que les principes et les règles ne soient pas enfreints — et se traitent de la
même manière : tout leur test est de niveau 0 ou 1 (D83), témoins compris, donc joué à chaque fusion,
sauf sur une empreinte déjà trouvée verte à un seuil au moins égal (D83, « Les empreintes ») ; un
harnais du registre qui vit dans le navigateur (`apps/web/test/navigateur/`) est joué chaque nuit, sur
`main`, et non à chaque fusion, comme toute la non-régression dans le navigateur (D83, porteur, #307).
Quand une ligne `Harnais` nomme un test, la règle vaut pour ce test, sa suite et son témoin ; quand
elle cite un fichier, pour tout le fichier. Les tests de la garde et les harnais du registre
n'accueillent donc jamais de test de niveau 4. La règle est un test de la garde, pas une logique de
l'outil ; tout ce qui y entre se jouant à chaque fusion, hors empreinte verte, la garde reste petite
(principe 12).

Tout autre test, même rangé dans `packages/gardes`, appartient au harnais d'un besoin, ou au codeur
qui l'a écrit pour ses propres besoins, et se joue par `pnpm test`, à son niveau (D83) : un test se
range selon le besoin qu'il vérifie, jamais selon ce que son fichier regarde, ni selon l'extension ou l'en-tête de ce fichier. Seuls les tests de
développement de fonctions de la garde, qui ne servent qu'à la développer, sont mis à part : ils
vivent dans `packages/gardes/dev/`, en fichiers `*.dev.mjs`, hors de `pnpm test` ; tests du
codeur, ils sont de niveau 4 (D83), et se jouent à la main, par la commande des rôles du codeur et
de l'auditeur, par qui développe une fonction de la garde et par l'auditeur qui la vérifie.

Un harnais du registre a une forme normale : un fichier de tests de niveau 0 et 1, que le registre
cite en entier, et, s'il le faut, un second fichier, hors registre, pour les tests de niveau 2 à 4
du même besoin. Les données lourdes (instantanés, jeux d'essai) vont dans des
fichiers de données, que seuls les tests qui en ont besoin chargent.

### D82 · Vérifier, valider : brouillon, Ready, aperçu

Deux actes, qui ne se confondent pas : **la vérification**, par l'auditeur — le travail est conforme à
ce que l'issue demande, et ne contrevient ni aux autres entrées de son catalogue, ni aux
fondamentaux ; il l'écrit dans la PR — et **la validation**, par le porteur, par la fusion, sans
autre geste (principe 11). Rien ne la bloque techniquement (dépôt privé, offre gratuite) : c'est
au porteur de ne fusionner qu'au vert.

Le codeur ouvre la PR en brouillon (D80), avec le corps du modèle
`.github/pull_request_template.md` — `Close #n` et la case de l'aperçu, rien d'autre. Une PR ouverte
par l'API ne reçoit pas le modèle : il se recopie. Le brouillon n'économise que la CI. L'architecte la passe en Ready en fin de cycle, après avoir
vérifié, avec les retours du codeur et de l'auditeur et un diff, que le besoin a bien été codé
(porteur, #401), jamais tant que le travail n'est pas terminé — une question ouverte, un nouveau
tour ; le passage en Ready lance
toute la CI et assemble la version de dev depuis le dernier commit de la branche. À côté du bouton
de fusion, le statut « Toute la CI sur ce commit » dit si toute la CI a tourné au vert sur le
dernier commit. Un changement après le Ready est signalé par un commentaire de la PR, sans rien
bloquer : un commit (la CI n'a pas tourné sur lui, le statut passe en échec, et l'architecte repasse
la PR en brouillon puis en Ready pour la rejouer, aux mêmes conditions ; porteur, #401), une édition de la PR, hors cases cochées ou
décochées, ou une édition de l'issue qu'elle ferme. Les commentaires ne sont pas signalés.

**La case de l'aperçu** (#175). Rien n'est déposé sur la recette sans une action du porteur : il
coche, dans la description de la PR, la case « Aperçu du dernier commit en recette ». Le dépôt n'a
lieu que si la PR est prête et toute sa CI verte sur le dernier commit ; sinon la case se décoche et
un commentaire dit pourquoi ; de même si elle est cochée par un autre que le propriétaire du dépôt.
Cochée, elle dit que l'aperçu en ligne est celui du dernier commit. **Les agents ne cochent jamais
cette case**, et ne la décochent pas non plus : elle est au porteur et aux workflows.

### D83 · Crochets, CI et workflows

- **Niveaux des tests.** Le niveau d'un test dit le risque pris à ne pas le jouer, sans rien dire du
  moment où on le joue. Il se choisit par le besoin que couvre le test, jamais par sa durée : si un
  test de niveau 0 déborde en temps, c'est au porteur de proposer une solution. On pose dans l'ordre
  ces questions sur le besoin couvert, chacune supposant qu'il cesse d'être satisfait sans que
  personne le voie ; la première réponse « oui » donne le niveau :
  - **0 · l'irréparable** — après correction du code, les données de l'utilisateur resteraient-elles
    perdues, altérées ou sorties de l'appareil, ou un secret exposé ?
  - **1 · une promesse tombe** — un usage de la description, un principe, un invariant ou une contrainte ne
    serait-il plus tenu ? L'appui est un identifiant : un test nommé au registre, ou qui vérifie un
    de ces énoncés tel qu'il est écrit.
  - **2 · un cas est faux** — une règle, métier ou de la garde, donnerait-elle un résultat faux ou
    refuserait-elle à tort, l'usage restant possible ? C'est le cas d'une décision, nominal comme
    limite.
  - **3 · le dégradé** — le résultat resterait-il juste, mais obtenu moins bien : plus de gestes,
    moins lisible, moins accessible, un message moins clair ?
  - **4 · rien de garanti** — sinon : un diagnostic, un détail que rien ne garantit, un contrôle du
    harnais lui-même. Il permet de garder un test sans qu'il soit joué à chaque fois.

  Départage : on nomme d'abord le besoin couvert (phrase du « Fait quand », entrée du registre,
  décision) ; deux tests du même besoin ont le même niveau ; un témoin rouge prend le niveau de ce
  qu'il garde ; dans le doute, le plus critique. Un codeur ne fait pas de test de niveau inférieur
  à 4 (porteur, #283) : il écrit ses tests pour ses propres besoins ; seul l'auditeur donne un autre
  niveau, aux tests qu'il retient dans le harnais du besoin, et un test du codeur qu'il ne retient
  pas reste au niveau 4. Un test existant que le codeur adapte garde son niveau. Chaque test déclare
  son niveau par la marque `[niveau N]` dans son titre, ou dans celui d'une suite qui l'englobe, la
  plus proche l'emportant.
  Un test sans marque, ni sur lui ni sur une suite qui l'englobe, fait échouer `pnpm test` dès le
  seuil 1, qui le nomme (#236) ; jusqu'à ce qu'il en reçoive une, l'outil de test le joue au niveau
  2. Le niveau se lit ainsi dans le fichier, sans l'exécuter.

  L'outil de test prend un seuil N en entrée — `pnpm test N`, ou `pnpm --dir <paquet> run test N`,
  2 sans entrée — et ne joue, dans tous les ensembles (cœur, interface headless et dans le
  navigateur, garde, relais, hébergement), que les tests de niveau N ou moins ; ce qu'il écarte, il
  le compte et le dit. Les tests navigateur (`apps/web/test/navigateur/`), qui coûtent cher, ne se
  jouent que si l'option `--navigateur` les active, après le seuil (`pnpm test 2 --navigateur`) ;
  sans elle, ils sont écartés, et comptés tels qu'ils sont écrits dans leurs fichiers, sans être
  exécutés : un test écrit dans une boucle compte pour un, et la sortie dit ce qu'elle compte, pour
  que ce nombre ne passe pas pour celui des tests exécutés. Tout lancement saute chaque fichier de
  test vert sur son empreinte, et le dit (voir « Les empreintes ») ; l'option
  `--attestation <fichier>`, que seules la CI et la livraison passent, lui donne ce qui couvre le
  lancement, et sans elle il le lit lui-même : l'attestation de la branche extraite et sa base
  commune avec `main` ; sur une tête détachée ou une sous-branche, cette base commune seule ; sur
  `main`, rien (#314).
  Aucune variable d'environnement ne change ce qui se
  joue : tout passe par les arguments. Un test appelé nommément (`-t` de vitest,
  `--test-name-pattern` de `node --test`) se joue quel que soit son niveau. Le script `test` de
  chaque paquet passe par `packages/gardes/lanceur.mjs`. Les seuils des moments :

  | Moment | Seuil |
  |---|---|
  | Pré-commit | 0 sur les paquets touchés, plus le harnais du besoin en entier ; sans tests navigateur ; sauf ce qui est vert sur son empreinte |
  | Livraison (pré-fusion, pré-push) | 2, sans les tests navigateur de non-régression, plus les tests navigateur de l'issue en entier ; sauf ce qui est vert sur son empreinte |
  | Demande des tests navigateur (`pnpm livraison --navigateur`) | 2, tests navigateur compris, et ceux de l'issue en entier ; sauf ce qui est vert sur son empreinte |
  | Vérification de l'auditeur, avant le Ready | 2, sans les tests navigateur sauf sa demande ; sauf ce qui est vert sur son empreinte |
  | CI au Ready | 1, plus le harnais du besoin et les tests navigateur de l'issue, en entier ; sauf ce qui est vert sur son empreinte, seuil 1 compris |
  | CI après la fusion, sur `main` | 1, sans tests navigateur ; sauf ce qui est vert au Ready sur la même empreinte, ou inchangé depuis le premier parent |
  | Chaque nuit, sur le dernier commit de `main` | 2, la suite entière, tests navigateur compris ; sauf ce qu'une nuit a trouvé vert sur son empreinte |
  | Publication d'une version (tag `v*`, poussé ou d'une version forcée) | 3, tests navigateur activés ; rien ne se saute |
  | Demande explicite (`pnpm test 4`) | 4, avec ou sans tests navigateur selon l'option ; sauf ce qui est vert sur son empreinte |

  Les tests de développement de fonctions de la garde (D81) ne se jouent à aucun de ces moments :
  hors de `pnpm test`, ils se jouent à la main. Aucun autre ensemble n'a de tests joués à la main.

- **Le harnais du besoin** est le ou les fichiers de l'auditeur — son harnais et, s'il y en a un,
  son second fichier éventuel (D81) —, et eux seuls : l'auditeur les nomme dans l'issue (« Harnais :
  chemins »), à côté de la branche, et inscrit dans les trois premières lignes de chacun « Harnais
  d'audit de #<n> », le numéro de l'issue, que porte aussi le nom de la branche (`codage/<n>-…`) :
  les crochets et la CI les reconnaissent ainsi sans lire l'issue (`.githooks/harnais-du-besoin.sh`,
  définition commune). Il se joue en entier, niveau 4 compris, à chaque moment, sauf vert sur la même
  empreinte (voir « Les empreintes ») ; rouge, il se rejoue toujours. Les autres fichiers
  de test que la branche ajoute ou modifie, ceux du codeur compris, n'en font pas partie : ils se
  jouent à leur niveau.
- **Les empreintes** (#266). Chaque ensemble de tests — garde, cœur, relais, hébergement, interface
  sans navigateur, interface dans le navigateur, harnais du besoin — a une empreinte : l'état, dans
  l'arbre jugé, des chemins qu'il lit. Elle couvre tout le dépôt, sauf les chemins que la liste de
  l'ensemble écarte (`ENSEMBLES`, `packages/gardes/attestation.mjs`), chacun avec sa raison :
  l'ensemble ne le lit pas, ou ce qu'il en lit est vérifié par ce qui se joue quand il change. Un
  chemin oublié de la liste fait jouer plus, jamais moins : tout fichier qu'elle n'écarte pas change
  l'empreinte. La garde et l'hébergement lisent tout le dépôt. Une PR qui ne change que
  des fichiers de `docs/` ne rejoue donc que la garde et l'hébergement, à tout lancement à
  la main, sur la branche comme sur une tête détachée, à la livraison et au Ready, `docs/decisions.md`
  compris : ce qui confronte une décision au code se joue dans l'ensemble de la garde, qui lit tout le dépôt ; le lancement dit, pour chaque autre ensemble, qu'il le saute et pourquoi (#314). Pour les tests navigateur, la liste
  est celle du point 9 de #237 : `docs/`, `.github/`, `.githooks/`, `packages/gardes/`,
  `apps/hebergement/`, `apps/relay/`, les fichiers `*.md` et `.gitignore`. La garde y figure : les
  tests navigateur la lisent par leur lanceur, mais l'interface sans navigateur, qui la lit par le
  même lanceur, et la garde, qui lit tout, se rejouent quand elle change. Le harnais du besoin a
  pour empreinte ses fichiers et ce que lisent les ensembles de leurs paquets.

  Ce qui se saute se décide fichier de test par fichier de test (#302). Un fichier de test a son
  empreinte, celle de ce qu'il lit (#304) : ce que lit son ensemble, sans les fichiers de test autres
  que lui, plus lui-même. Un fichier de test ne lit pas les autres — aucun n'en importe un autre, ce
  que vérifie un test de la garde —, et un fichier de test modifié se rejoue lui-même. Dans la garde
  et l'hébergement, dont les tests lisent les autres fichiers de test, c'est l'empreinte de
  l'ensemble. Modifier un fichier de test ne fait donc rejouer que lui, et modifier un autre fichier
  que lit l'ensemble fait rejouer tous ses fichiers. Un fichier ne se rejoue pas sur une empreinte
  déjà trouvée verte, à un seuil au moins égal : pour lui seul, sur la sienne, par tout lancement de
  l'outil de test hors CI sur la branche (voir « L'attestation ») ; ou, sur celle de son ensemble,
  pour tout son ensemble, par l'outillage sur
  la branche — à la livraison ou à la demande du codeur ou de l'auditeur, dans cette session ou dans
  une autre (chaque session a son clone, voir « Crochets ») —, ou par la CI sur une tête de la
  branche dont toute la CI a fini verte au Ready. L'empreinte qu'a l'ensemble sur la base commune de
  la branche avec `main` compte aussi comme verte, pour tous ses fichiers, jusqu'au seuil 2 : la
  branche ne change rien de ce qu'il lit ; sauf pour l'interface dans le navigateur, que rien ne joue
  avant la fusion (#307) : ni `main`, ni le premier parent, ni une tête verte au Ready ne la disent
  verte. Cette base se calcule depuis la tête extraite, branche ou non : sur une tête détachée, comme
  sur une sous-branche, un lancement de l'outil de test sans `--attestation` saute ce qu'elle couvre,
  sans y lire l'attestation d'aucune branche ni y rien attester ; sur `main`, rien ne se saute
  (#314). Dans un lancement du harnais du besoin, seul ce qui couvre
  le harnais, ou le fichier lui-même, couvre un de ses fichiers. Aucun moment ne fait exception
  (porteur, 28/09 : « si l'empreinte est verte, on ne joue pas les tests, c'est universel ») : au
  Ready, le seuil 1 non plus ; la vérification de l'auditeur non plus (porteur, 01/10, #302). Un
  lancement par nom de test (`-t`, `--test-name-pattern`) se joue toujours : c'est la voie pour
  rejouer exprès. Sur `main`, un ensemble ne
  se rejoue pas si son empreinte est celle qu'il a sur la tête d'une PR dont toute la CI a fini verte
  au Ready, ou sur le premier parent du commit arrivé. N'est pas vert sur son empreinte un ensemble
  dont un test a rougi, ou s'est sauté faute d'outil : il se rejoue au moment suivant qui le prévoit.
  Au tag et pour une version forcée, rien ne se saute : ils se jouent au seuil 3, que la base
  commune avec `main` ne couvre pas, et le lanceur n'y lit aucune attestation — la CI ne lui passe
  pas `--attestation`. Un fichier joué
  en entier est pourtant attesté au seuil 4, et un lancement à la main au seuil 3 ou 4 le saute.
  Chaque moment —
  pré-commit, pré-fusion, pré-push, demande, CI au Ready, CI sur `main`, tag — dit, pour chaque
  ensemble, s'il l'a joué, à quel seuil et avec quel verdict, ou pourquoi il ne l'a pas joué :
  empreinte trouvée verte (par qui, sur quel commit ou arbre, à quel seuil), ou rien de ce qu'il lit
  n'a changé depuis `main` ou depuis le premier parent ; au tag, que rien ne se saute. Chaque
  lancement de l'outil de test dit en plus, pour chaque ensemble, les fichiers qu'il joue et ceux
  qu'il saute, avec ce qui les couvre : par qui, sur quel arbre ou quel commit, à quel seuil.
- **L'attestation** (#237, #266, #302) porte les empreintes trouvées vertes par l'outillage. Elle se
  produit à tout lancement de l'outil de test hors CI — à la main (`pnpm test N`,
  `pnpm --dir <paquet> run test N [fichiers]`), vérification de l'auditeur comprise, au pré-commit, à
  la livraison (pré-fusion, pré-push), à la demande —, sur une branche qui n'est ni `main` ni une
  sous-branche, par l'outillage (le lanceur, `.githooks/attestation.mjs`) : aucune session ne
  l'écrit. Y entre chaque fichier de test dont tous les tests de niveau N ou moins ont tourné et fini
  verts : le fichier, son ensemble, le seuil N — 4 si aucun de ses tests n'a été écarté —, et son
  empreinte (voir « Les empreintes ») calculée sur le contenu joué, copie de travail comprise. N'y entrent ni
  un fichier dont un test a rougi, ou s'est sauté faute d'outil, ni rien d'un ensemble dont un
  fichier lu a changé pendant le lancement ; un lancement par nom de test n'atteste rien. La
  livraison et la demande y ajoutent chaque ensemble joué vert. Une empreinte calculée sur la copie
  de travail n'est retrouvée, à la livraison ou en CI, que si le contenu poussé est le même ; sinon
  tout se rejoue : une erreur fait rejouer plus, jamais moins. Elle se garde d'un push et d'une
  session à l'autre : un push ne retire pas les empreintes vertes d'un push précédent. Le pré-push et la demande l'envoient sur
  la branche `<branche>--attestation`, qui n'est jamais jugée et disparaît à la fermeture de la PR.
  Le risque visé est l'erreur, pas la fraude. Au Ready, la CI lit l'attestation, les têtes de la
  branche vertes au Ready et l'empreinte de `main`, et saute ce qui est vert sur son empreinte ; sans
  attestation — une PR rouverte, dont l'attestation a disparu, par exemple —, ce que la table prévoit,
  hors ce qui est inchangé depuis `main` ou vert au Ready sur une tête précédente.
- **Le navigateur au minimum** (porteur, #413 : « Minimise au maximum les tests avec navigateur »).
  Un test ne passe par le navigateur que pour ce qui n'existe que dans un navigateur : une mesure de
  mise en page à une largeur d'écran (C9), une capacité du navigateur — stockage persistant,
  installation, presse-papiers, mise à jour du site —, ou un harnais du registre qui le demande
  (D79). Tout le reste — un calcul, une donnée, un texte, ce qu'un écran montre ou enregistre — se
  vérifie sans navigateur, au cœur ou par les tests de l'interface sans navigateur. L'issue le dit,
  après la ligne « Usages » : « Navigateur : » suivi des seuls points qui en demandent un, ou
  « Navigateur : aucun », qui vaut quand elle ne dit rien. Le codeur n'écrit de test navigateur que
  pour ces points ; l'auditeur n'en compose pas d'autre, et s'il juge qu'un autre point en demande
  un, il le dit dans la PR, et le porteur tranche. Un test navigateur existant qu'un changement casse
  s'adapte, sans en ajouter un autre. Un test navigateur coûte à l'écrire, à le rejouer en entier à
  chaque push de la PR qui ajoute ou modifie son fichier, et à l'adapter quand un écran change : du
  1er au 9 octobre, les codeurs en ont ajouté 19 fichiers, environ 115 tests.
- **Les tests navigateur la nuit ; ceux de l'issue, pendant toute la PR** (#264, #307, #383). Les tests
  navigateur de non-régression — tout fichier de `apps/web/test/navigateur/` qui n'est pas un test de
  l'issue, harnais du registre compris — ne se jouent ni avant la fusion ni à la CI d'une fusion sur
  `main` : ni à la livraison, ni au Ready, ni après la fusion ; ils ne décident d'aucune fusion
  (porteur, #307 : « main ne part pas en prod, mais en preview »). Chaque nuit, `nuit.yml` joue la
  suite entière au seuil 2 — chaque ensemble : garde, cœur, relais, hébergement, interface sans
  navigateur, interface dans le navigateur — sur le dernier commit de `main`, sauf chaque ensemble ou
  fichier vert sur son empreinte (#383) : le résumé de l'exécution dit, pour chaque ensemble, ce qui
  s'est joué et ce qui s'est sauté, et pourquoi ; une nuit où rien de ce que lit la suite n'a changé
  ne joue rien, et le dit ; ce qu'une nuit trouve vert vaut pour les nuits suivantes, tant que ce
  qu'il lit ne change pas (l'attestation de la nuit, sur la branche `attestation-de-la-nuit`, écrite
  par l'outillage). Une nuit rouge se signale sans qu'on la cherche, quel que soit l'ensemble où elle
  rougit : une issue s'ouvre, ou se complète si celle d'une nuit précédente
  est encore ouverte ; elle nomme les fichiers rouges et le commit de `main` jugé ; la nuit verte qui
  suit le dit dans cette issue. Une nuit rouge ne bloque aucune fusion ; une régression peut rester
  sur la recette jusqu'à la nuit et sa correction, et la production reste gardée par le tag, qui
  rejoue tout. Les tests navigateur de l'issue — les fichiers de tests navigateur que sa PR ajoute
  ou modifie, et le harnais du besoin quand il vit dans le navigateur — se jouent pendant toute la
  PR : à chaque livraison (pré-push, pré-fusion) et au Ready, en entier, niveau 4 compris, sauf
  chaque fichier vert sur son empreinte (définition commune : `.githooks/tests-de-l-issue.sh`, et
  `harnais-du-besoin.sh` pour le harnais) ; hors harnais, ils sont de la non-régression, qui bloque,
  et ne s'attestent que fichier par fichier. Le codeur, si l'issue le requiert (#316), ou
  l'auditeur, sur demande justifiée ou pour une mesure, peut demander toute la non-régression dans le
  navigateur par `pnpm livraison --navigateur`, qui juge le dernier commit de
  la branche comme un premier push, tests navigateur compris ; verts, ils sont attestés sur leur
  empreinte et l'attestation part sur `origin`. Le compte rendu du codeur et la vérification de l'auditeur disent s'ils les ont
  demandés, et pourquoi. Un lancement des tests navigateur ne construit le site qu'une fois, quel
  que soit le nombre de fichiers qui l'ouvrent (#302) ; chaque fichier garde son serveur, donc son
  origine, et son navigateur. À chaque moment qui joue le typecheck, il se joue avant les tests ; les
  tests navigateur — de non-régression demandée, ou de l'issue — ne
  partent que si le typecheck et les tests sans navigateur de ce moment ont fini verts ; un harnais
  du besoin rouge qui ne bloque pas ne les retient pas. Chaque moment qui ne joue pas les tests
  navigateur dit pourquoi : joués la nuit faute de demande, palier moins cher rouge, empreinte
  trouvée verte, ou rien de ce qu'ils lisent n'a changé ; au tag, il dit que rien ne se saute.
- **Crochets.** Une session commence, dans son propre clone, par `pnpm install && pnpm crochets`.
  `pnpm crochets` active les crochets suivis de `.githooks/` et pose `merge.ff false` ; les
  crochets joués sont ceux de la branche extraite, et `pnpm install` n'y touche pas.
- **En brouillon**, le codeur ne joue lui-même que `pnpm typecheck`, ses propres tests, à la main,
  le harnais du besoin s'il existe, la garde à chaque tour, avant son compte rendu (#349), et, s'il
  modifie une fonction de la garde, ses
  tests de développement (D81) — pas la suite : l'auditeur déplacera et modifiera ses tests en
  composant le harnais (#316) ; l'auditeur vérifie en local ce qu'il relit, au seuil 2 avant le Ready, hors
  tests navigateur sauf sa demande. Aucune CI ne tourne en brouillon. Les crochets
  font leur part, sur la copie de travail. Au commit, en moins de 5 s : les
  tests de niveau 0 des paquets que touchent les fichiers indexés — cœur ; garde ; relais ;
  hébergement —, et rien pour la seule documentation, sauf ce qui est vert sur son empreinte. Au pré-commit, la non-régression bloque le
  commit ; le harnais du besoin est joué à part, en entier, hors budget, et le pré-commit ne fait
  qu'en afficher le verdict, sans bloquer, sauf une erreur de syntaxe ; c'est la livraison qui le
  bloque. `--no-verify` est un contournement, qu'aucune consigne ne propose. À la
  livraison (pré-fusion et pré-push), sur l'état commis, au seuil 2 : la nature du besoin se lit par
  `packages/gardes/chemins-ignores` — fonctionnel (typecheck et tests des paquets touchés et de
  l'interface sans navigateur, 30 s ; 630 s de plus avec les tests navigateur demandés, et 80 s plus
  25 s par fichier pour ceux de l'issue) ou organisationnel (garde, 50 s, et hébergement, 5 s, qui
  lisent tout le dépôt, #314) —, mesurés sur 2 cœurs comme
  la CI (#307), et de ce qu'elle retient ne se joue que ce qui n'est pas vert sur
  son empreinte (voir « Les empreintes ») ; ce qu'elle ne retient pas, la CI le joue au Ready s'il
  n'est pas vert sur son empreinte. Les tests navigateur de non-régression
  (`apps/web/test/navigateur/`) se jouent la nuit sauf demande, et la livraison le dit ; ceux de
  l'issue se jouent en entier ; le harnais du besoin est joué à part, en entier, et bloque quand du
  code arrive.
- **La CI** ne joue qu'au passage en Ready d'une PR, une fois par passage, en mode strict, les
  harnais et la garde : typecheck, `pnpm test 1`, le harnais du besoin en entier, tests navigateur
  activés, puis les tests navigateur de l'issue en entier, qui ne partent que si le reste est vert,
  build, version de dev ; un outil manquant y fait échouer le job.
  Elle vérifie d'abord que la tête de la PR contient le dernier `main` : sinon la branche est à
  mettre à jour, le job échoue et rien d'autre ne se joue. Elle ne joue que le manque : ce qui est
  vert sur son empreinte se saute, seuil 1 compris, et elle dit ce qu'elle saute et pourquoi. Avant
  toute fusion, les niveaux 0 à 2 ont donc été joués, par la livraison et par l'auditeur — hors tests
  navigateur de non-régression, joués la nuit, sauf demande —, et chaque ensemble sans navigateur a été
  trouvé vert au seuil 1 au moins sur son empreinte finale. Onze workflows : `nuit.yml` (la suite
  entière au seuil 2, chaque nuit, sur `main`, et l'issue d'une nuit rouge), `ci.yml` (tests, version de dev, livraison), `version-forcee.yml` (la version forcée, que le porteur déclenche à la main ; elle appelle `ci.yml`), `validation.yml` (la
  garde), `apercu.yml` (attente et statut de toute la CI au Ready, retrait de l'aperçu),
  `depot-apercu.yml` (dépôt de l'aperçu quand le porteur coche sa case), `pret.yml` (les repères
  d'une PR prête, case de l'aperçu et étiquette « touche un workflow » comprises), `suivi.yml` (un
  changement après le Ready, signalé), `fin.yml` (« en cours » quitte l'issue à sa fermeture),
  `nettoyage.yml` (le pied « Generated by Claude Code » quitte la PR fusionnée et les issues
  qu'elle ferme, et chaque semaine tout le projet) et `branches.yml` (à la fermeture d'une PR,
  fusionnée ou non, `<tête>--attestation`, et `<tête>--codeur` et `<tête>--auditeur` s'il y en a,
  supprimées par leur nom exact, jamais par préfixe, chacune nommée avec son dernier commit ; la
  tête n'est pas touchée ; à son arrivée sur `main` et à la main, celles qui traînent sans PR ouverte
  de leur tête).
- **Aucun job sauté ne peut laisser fusionner ce qu'un job joué aurait rougi.** Un fichier de test,
  ou un ensemble, ne se saute que vert sur la même empreinte, jamais s'il a rougi ou s'est sauté
  faute d'outil, et un chemin oublié de sa liste fait jouer plus. Un rouge découvert
  après la fusion (#149) relance tout un tour de relecture et de code ; un job sauté qui ne décide pas
  de la fusion, et dont le rouge éventuel reste visible ailleurs, ne coûte rien et reste permis (les
  exécutions d'`apercu.yml` et de `depot-apercu.yml` en montrent). Ne rien sauter de ce qui décide de
  la fusion, ne pas alourdir ce qui n'en décide pas (principe 10.1). Les tests navigateur de
  non-régression ne décident plus de la fusion (porteur, #307) : la règle ne vaut plus pour eux ; un
  rouge que la nuit découvre relance un tour de code, comme un rouge découvert après la fusion.
- **Workflows.** Un agent ne crée ni ne modifie aucun workflow (`.github/workflows/`,
  `.github/actions/`), sauf quand l'issue le demande. Un workflow déclenché par
  `pull_request_target` tourne avec les droits du dépôt et ses secrets : il n'exécute rien de la PR ;
  il peut en lire les données — description, cases, fichiers lus par git ou par l'API —, jamais
  extraire sa tête ni sa référence de fusion (#248). Dépôt privé sur l'offre gratuite, les
  identifiants FTP sont au niveau du dépôt : un workflow qu'une branche ajoute les lit dès son premier
  `push`, avant toute PR (#176, risque accepté par le porteur). Au Ready, une PR qui en touche un
  porte l'étiquette « touche un workflow » (`pret.yml`).
- Un harnais joué en local ne lit que des fichiers suivis et ne sort pas de la machine : la boucle
  locale est permise, le reste fait échouer le lanceur. Chaque workflow situe ses jobs dans son
  en-tête : « lit des fichiers suivis », « lit hors des fichiers suivis » ou « hors harnais ».
- **Livraison.** Un push sur `main` construit le site et le dépose à la racine de la recette : la
  version de développement, vérifiée en ligne. Un ensemble dont l'empreinte, dans le commit arrivé,
  est celle qu'il a sur une tête de PR que toute la CI a trouvée verte au Ready — le statut « Toute la
  CI sur ce commit » —, ou sur le premier parent, ne rejoue pas ses tests ; les autres les
  rejouent ; les aperçus (`pr-<numéro>`), le `robots.txt` posé à
  la main et les paquets du relais y restent en place, et chaque aperçu reste servi par lui-même. La
  production ne suit que les versions publiées : seul un tag `v*` la dépose ; ni un push sur `main`,
  ni le lancement manuel de `ci.yml` ne la touchent. L'APK et les releases ne sortent qu'à un tag
  `v*` : le job le plus lourd ne tourne plus à chaque fusion. Un tag publie une version (D87) et porte
  son nom (`docs/versions.md`) ; ses tests se jouent au seuil 3, tests navigateur activés, avant de
  publier et de déposer en production.
- **Seul le porteur publie une version** (#274). Il pousse le tag d'une version numérotée — `v`
  suivi de nombres séparés par des points, sans rien d'autre —, ou déclenche à la main, sans autre
  saisie, une **version forcée** du dernier commit de `main` (`version-forcee.yml`). Aucun agent ne
  pousse un tag `v*` ni ne déclenche une publication. La version forcée se joue comme un tag poussé :
  le seuil 3, tests navigateur compris, sans rien sauter ; seulement s'il est vert, son tag est posé
  sur ce commit, puis le site est déposé en production et vérifié en ligne, l'APK est construit et
  la release publiée avec `tirelire-hebergement.zip`, et avec l'APK s'il est construit : un échec de
  la construction de l'APK ne retient pas la release, et le résumé de l'exécution dit qu'elle sort
  sans APK. Si quelque chose rougit avant le tag, aucun tag n'est posé, rien n'est publié, et le
  déclenchement dit ce qui a rougi. Son nom : le dernier numéro de version publié, un tiret, puis le
  hash court du commit — `v0.2-1a2b3c4` si la dernière version numérotée est `v0.2`, `v0.0-…` tant
  qu'aucune n'est publiée. Une version forcée n'est pas numérotée et ne sert jamais de base ; le
  déclenchement ne crée jamais une version numérotée. Un commit qui porte déjà une version, forcée
  ou numérotée, ne se republie pas, et le déclenchement le dit.

### D84 · Le dépôt et les commits

- **Aucune donnée bancaire réelle dans le dépôt.** Les fichiers bancaires servent à vérifier
  l'import en local et ne se versionnent jamais (`*.csv`, `*.sqlite` ignorés) ; les tests portent
  sur des données inventées.
- **Signature des APK de test** : `apps/web/android/keystore/tirelire-test.jks` (mot de passe
  `tirelire-test`) signe les APK de test, pour que les mises à jour s'installent par-dessus. Jamais
  pour un magasin ; des secrets `ANDROID_KEYSTORE_*` la remplacent en CI.
- Commits : un lot ou une décision par commit, corps explicatif ; leur langue suit D90.

### D86 · Des domaines, des issues de conception

Un domaine est un bloc fonctionnel du produit : budget et tirelires ; plan et flux ; opérations ;
rapprochement et bilan ; données et synchro ; assistant et exemple ; application. C'est une
catégorie transverse des tâches : ni un but, ni une ligne d'une version, ni une unité de travail ; le
travail est tiré et ordonné par les versions (D87). Chaque tâche du produit
porte l'étiquette de son ou de ses domaines ; une tâche hors produit porte celle de sa nature
(« outillage », « nouvelle fonctionnalité », « idée »…).

Un domaine a un document dans `docs/domaines/` : son intention, avec les paroles du porteur qui la
fondent, et son analyse — contraintes, hypothèses, cibles, usages — quand elle existe. Il ne liste ni
tâches, ni ordre, ni état.

Une réflexion d'ensemble sur un domaine se mène dans une **issue de conception**, par un architecte,
en pensant à tous les usages ; son produit va dans les décisions et dans l'analyse du domaine. Les
choix réversibles se reprennent au fil des versions ; les choix structurels, qui engagent tous les
usages et toutes les cibles, se posent avant, dans le socle (`v0.0`).

Chaque spécification porte une ligne « Usages » : ce que la tâche fait à chaque usage de la
description, U1 à U8 —
sert, indifférent, ou à surveiller. C'est ce qui garde les autres usages dans le regard quand une
version en sert un seul.

### D87 · Une version : un usage garanti sur des cibles

Une version garantit un usage sur un ensemble de cibles ; elle se définit dans `docs/versions.md` :
son usage, ses cibles, son critère de fin, son tag. Une version se travaille quand sa case de la
matrice des cibles devient « prioritaire » ; elle peut être prévue avant, et l'ordre du catalogue
est l'ordre de travail : une version prévue attend que les précédentes soient publiées. La fin d'une
version d'usage est le croisement d'une cible et d'un usage : le parcours de son usage (I3) vert sur
chacune de ses cibles, et les vérifications manuelles du porteur ; le tag de son nom la publie
(D83). Une version livrée ne régresse pas : ce que son critère de fin tient vert le reste à chaque
PR.

Le socle ne garantit aucun usage : il intègre les contraintes structurelles de tous les usages et de
toutes les cibles actives — données, sauvegarde, synchronisation, versions d'instances,
distribution. Il s'étale en incréments, dont le premier est `v0.0` : un incrément ne contient que ce
qu'aucune version d'usage ne peut éviter d'avoir avant elle, et se place juste avant la première
version d'usage qui l'exerce, pour que ses choix se confrontent aussitôt à un usage réel. Une
contrainte structurelle se conçoit tôt, dans une issue de conception, pour ne fermer aucune porte ;
elle se code dans la première version qui l'exerce. Le socle est l'exception à la fin par le
croisement d'une cible et d'un usage : son entrée énumère ses contraintes, et son critère de fin
porte sur leurs harnais et vérifications manuelles, sur ses issues de conception, et sur ce qu'elles
demandent de vérifier en attendant le codage réel de ce qu'elles conçoivent.

Ce que promet un numéro de version, bêta ou publique, est dans D91.

Le travail est tiré par les versions : une tâche appartient au jalon de la version qui en a besoin,
quel que soit son domaine (D86), et son ordre de traitement se résout dans cette version. Sur GitHub,
un jalon du même nom que la version regroupe ces tâches ; son architecte les ordonne
(`docs/roles/architecte.md`, « Suivre une version »).

### D90 · La langue du travail, et la lecture sur téléphone

Français partout dans le travail : code, commentaires, commits, documents ; ce que l'outil dit à
l'utilisateur suit D85. Le porteur lit surtout sur téléphone : réponses courtes, en prose, une
question à la fois.

### D92 · Économie des sessions

Une session coûte ce qu'elle lit et ce qu'elle rejoue ; le compromis entre le coût et la stabilité
que le principe 10.1 demande à la CI vaut pour elle (#351).

- **Lire par extraits.** Le code, les diffs, les fils de l'issue et de la PR se lisent par extraits,
  en cherchant ce que la tâche demande, comme les documents fondateurs (#333). D'un tour à l'autre,
  une session ne lit que ce qui a changé depuis son dernier passage : les nouveaux commentaires, le
  diff depuis le dernier commit qu'elle a vu.
- **Les sorties longues dans un fichier.** Les sorties longues — installation, tests, crochets —
  s'écrivent dans un fichier, dont la session ne lit que le verdict et ce qui échoue.
- **L'audit d'un besoin sans code.** Pour un besoin sans code, l'audit est la relecture et la garde
  hors ligne, sans `pnpm test 2` (D81). Il en va de même d'un besoin d'outillage qui ne change qu'un
  réglage ou un texte — une heure, un déclenchement, une condition, un message, un nom —, que
  l'issue dit par « Vérification : relecture » : l'auditeur relit le diff et joue la garde hors
  ligne ; le codeur n'y écrit pas de test, l'auditeur pas de harnais, et rien ne s'ajoute aux tests
  de la garde (D81, #382). Un test qui recopie un réglage ne vérifie que la recopie : il est une
  seconde place pour la même valeur (D78), et rougit à chaque changement voulu (05ede00). Ce que la
  livraison a attesté ne se rejoue pas : le lanceur dit ce qu'il saute (D83, « Les empreintes »).
- **La documentation de l'architecte.** Une documentation codée en direct par l'architecte reste
  chez lui : il reprend lui-même les retours de l'auditeur, sans session de codeur. L'auditeur la
  vérifie : celui qui vérifie n'est pas celui qui code (principe 11).
- **Des écrits proportionnés.** Le compte rendu du codeur et la vérification de l'auditeur se
  proportionnent : le relevé phrase par phrase du « Fait quand » pour ce qu'un test tranche ; pour
  une documentation, quelques lignes.

L'hypothèse écartée, tout lire en entier et tout rejouer pour ne rien manquer, ne tenait pas : le
tour de #349, une modification de documentation, a coûté environ 340 000 tokens à trois sessions,
qui relisaient fils et sorties en entier et rejouaient `pnpm test 2`, puis un second tour de deux
sessions pour deux phrases.
