# Tirelire — conventions pour les sessions d'assistant

- Langue : français partout (code, commentaires, commits, interface, docs).
- Lire `docs/description-projet.md` avant tout : le texte du porteur, mot pour mot, qui fait foi.
  Il ne se reformule pas ; seul le porteur le complète ou le corrige, avec ses mots, datés, ce qu'il
  retire restant barré.
- Lire ensuite `docs/invariants.md` : ce que le produit doit rester, tiré de la description. Une décision se prend au
  regard des invariants ; une demande qui en contredit un devient une question dans l'issue, pas
  une décision.
- Lire aussi `docs/contraintes.md` : ce que les plateformes imposent à une application multiplateforme
  qui doit rester simple ; tout choix technique la respecte.
- Lire `docs/decisions.md` avant de modifier le modèle, le plan, le dépôt ou la synchro : comment le
  produit est fait, et pourquoi. Une décision nouvelle y entre en amendant ce qu'elle remplace, sans
  date ni renvoi ; les règles de travail ne s'y écrivent pas, elles sont ici.
- Cœur (`packages/core`) sans dépendance à Svelte ni au navigateur ; tout calcul y est testé
  (vitest, `pnpm test`). L'interface (`apps/web`) ne fait qu'afficher et saisir.
- Montants en centimes entiers signés ; dates `AAAA-MM-JJ` ; `deletedAt` au lieu de supprimer ;
  jamais stocker ce qui se recalcule (soldes, plan, soldes à régler).
- Écritures uniquement via `LedgerStore.upsert/remove/setSetting` (journal de changements).
- **Aucune donnée bancaire réelle dans le dépôt.** Les fichiers bancaires servent à vérifier l'import
  en local et ne se versionnent jamais (`*.csv`, `*.sqlite` ignorés) ; exemples et tests sur données
  inventées.
- **Signature des APK de test** : `apps/web/android/keystore/tirelire-test.jks` (mot de passe
  `tirelire-test`) signe les APK de test, pour que les mises à jour s'installent par-dessus. Jamais
  pour un magasin ; des secrets `ANDROID_KEYSTORE_*` la remplacent en CI.
- **Livraison.** Un push sur `main` construit et dépose le site. L'APK et les releases ne sortent
  qu'à un tag `v*` : le job le plus lourd ne tourne plus à chaque fusion.
- **Crochets.** Une session commence, dans son propre clone, par `pnpm install && pnpm crochets`.
  `pnpm crochets` active les crochets suivis de `.githooks/` et pose `merge.ff false` ; les
  crochets joués sont ceux de la branche extraite, et `pnpm install` n'y touche pas.
- Avant de pousser, en brouillon : le codeur ne joue lui-même que `pnpm typecheck` et le harnais du
  besoin ; l'auditeur vérifie en local ce qu'il relit. Aucune CI ne tourne en brouillon. Les crochets
  font leur part, sur la copie de travail. Au commit, en moins de 5 s : les tests des paquets que touchent
  les fichiers indexés — cœur ; garde ; relais ; hébergement —, et rien pour la seule documentation. Au pré-commit, la non-régression bloque le
  commit ; le harnais du besoin (les fichiers de test que la branche ajoute ou modifie depuis sa base
  commune avec `origin/main`) est joué, et le pré-commit ne fait qu'en afficher le verdict, sans
  bloquer, sauf une erreur de syntaxe ; c'est la livraison qui le bloque. `--no-verify` est un contournement, qu'aucune
  consigne ne propose. À la livraison (pré-fusion et pré-push), sur l'état commis : la nature du
  besoin se lit par `packages/gardes/chemins-ignores` — fonctionnel (typecheck et tests headless des
  paquets touchés et de l'interface, 30 s) ou organisationnel (garde, 45 s) —, les tests
  navigateur (`apps/web/test/navigateur/`) restent à la CI, et le harnais du besoin est joué à part et
  bloque quand du code arrive. La CI ne joue qu'au passage en Ready d'une PR, une fois par passage,
  en mode strict, tous les harnais et la garde : typecheck, `pnpm test`, build, version de dev ; un
  outil manquant y fait échouer le job.
- Un harnais joué en local ne lit que des fichiers suivis et ne sort pas de la machine : la
  boucle locale est permise, le reste fait échouer le lanceur. Chaque workflow situe ses jobs dans
  son en-tête : « lit des fichiers suivis », « lit hors des fichiers suivis » ou « hors harnais ».
- Commits : un lot ou une décision par commit, message en français, corps explicatif.
- Simon lit surtout sur téléphone : réponses courtes, en prose, une question à la fois.

## Méthode de travail

Le projet avance sur le produit. La garde aide à ne pas dévier des documents fondateurs ; elle ne fait
rien d'autre.

### Les documents fondateurs

`docs/description-projet.md` (les paroles du porteur), `docs/glossaire.md`, et les catalogues :
`docs/invariants.md`, `docs/contraintes.md`, `docs/decisions.md`, `docs/gardes.md` (le registre :
chaque invariant et chaque contrainte, avec son harnais ou sa vérification manuelle).

Un document fondateur est forcément un fichier Markdown de `docs/` : un document d'un autre format
(HTML, par exemple) ne l'est jamais, et ce qu'il porte de fondateur se reprend dans un Markdown. Tout
Markdown de `docs/` n'est pas fondateur pour autant : la liste est celle ci-dessus.

Les paroles conservées suivent le glossaire : quand un terme change, la citation de la description
est amendée au terme nouveau, avec l'accord du porteur, demandé à chaque renommage.

Ils sont tels qu'ils sont. On ne les restructure pas ; on les corrige quand une PR les touche, et
seulement là.

### La garde

Un seul outil, `packages/gardes`, testé par des tests ordinaires dans `pnpm test`. Il vérifie trois
choses, et rien de plus :

1. chaque invariant et chaque contrainte a une entrée au registre, avec un harnais qui existe ou une
   vérification manuelle décrite ;
2. une PR qui modifie un document fondateur, ou un fichier qu'une entrée du registre nomme, a l'entrée
   déclarée dans la section « Invariants et contraintes » de l'issue qu'elle ferme (`Close #n`) ;
   sinon elle est rouge, et la garde nomme l'entrée manquante ;
3. chaque vérification manuelle des entrées déclarées figure dans cette section, sa consigne
   recopiée, sans case : la validation est le « Validé » du porteur.

Il tourne en CI au passage en Ready de chaque PR, et à la demande en local
(`node packages/gardes/cli.mjs pr --issue <n>`, sur les fichiers modifiés depuis `origin/main`). En
CI, la garde qui juge est celle de `main`, avec le workflow de `main` ; ce qu'elle juge est le contenu
de la PR — registre, documents, fichiers modifiés —, qu'elle lit par git sans rien exécuter de la PR,
et la section de l'issue, lue par l'API avec le jeton du job, en lecture. Une PR qui modifie la garde
ne change donc pas son propre verdict ; ses tests, eux, jouent la garde qu'elle propose. Pas de
crochet lent, pas d'alerte. Cinq workflows, pour qu'aucune exécution ne montre sautés les jobs
qu'une autre joue : `ci.yml` (tests, version de dev, livraison), `validation.yml` (la garde),
`apercu.yml` (dépôt de l'aperçu au vert de `ci.yml` et `validation.yml`, et retrait),
`validation-porteur.yml` (le « Validé » du porteur et son annulation) et `fin.yml` (« en cours »
quitte l'issue à sa fermeture).

### Vérification et validation

Deux actes, qui ne se confondent pas :

- **la vérification**, par l'auditeur : le travail est conforme à ce que l'issue demande, et ne
  contrevient ni aux autres entrées de son catalogue, ni aux fondamentaux du projet. Il l'écrit dans
  la PR ;
- **la validation**, par le porteur : il la donne par un commentaire « Validé » sur la PR, seul dans
  le commentaire. **Les agents n'écrivent jamais « Validé »**, ni sur une PR, ni ailleurs. La
  validation se lit dans le statut « Validé par le porteur » du dernier commit, qui n'est posé que si
  toute la CI y a fini au vert. C'est un signal : rien ne bloque techniquement la fusion, et le
  porteur ne fusionne qu'une PR dont la validation est en cours. Tout changement ensuite —
  commit, édition, commentaire, revue, sur la PR ou sur l'issue qu'elle ferme, de qui que ce soit,
  porteur compris — l'annule : le statut passe en échec, l'étiquette « validée » quitte la PR et
  l'issue, et un commentaire sur la PR dit pourquoi. Un nouveau « Validé » la redonne.

Le brouillon ne joue aucun rôle dans la validation : il n'économise que la CI. Une PR s'ouvre en
brouillon ; le porteur la passe en Ready à la main, ce qui lance toute la CI et assemble la version de
dev depuis le dernier commit de la branche. Un commit sur une PR prête ne relance pas la CI, et la PR le dit en
commentaire : le porteur la repasse en brouillon puis en Ready pour la rejouer.

Pour le produit, un harnais qui peut être codé doit l'être. La garde, elle, reste simple et peu
coûteuse : ce qui peut se vérifier par analyse de code — une relecture, une recherche — n'y va pas ;
seul y va ce qui le mérite, ce qu'une relecture ou une recherche ne suffit pas à tenir.

La documentation et la garde se modifient sans harnais par défaut : l'auditeur vérifie en relisant.
Un harnais dédié ne s'écrit que pour un cas de test complexe dans la garde. Un changement de
comportement de la garde est expliqué et justifié en commentaire de la PR, par le compte rendu du
codeur : il nomme les tests de la garde de `main` qui rougissent avec la garde proposée, et ceux qu'il
modifie ; la validation du porteur le couvre.

### Un besoin, deux agents

Une issue définit le besoin. Deux sessions y travaillent, l'une après l'autre, sur la même branche.
Le besoin s'analyse avant les solutions : une solution ne se discute qu'une fois le besoin écrit.

#### L'auditeur

Il passe en premier. Il ne code jamais le produit.

1. Lire l'issue et les documents fondateurs. Si le besoin n'est pas clair, poser les questions dans
   l'issue et s'arrêter.
2. Décider si le besoin tient en une tâche. Sinon, ouvrir les sous-issues, une par tâche, et
   s'arrêter : chaque sous-issue aura son propre auditeur.
3. Écrire dans l'issue un « Fait quand » vérifiable : des phrases qu'un test peut trancher.
4. Créer la branche, poser l'étiquette « en cours », écrire le harnais — un test qui rougit
   aujourd'hui et verdira quand le besoin sera couvert ; aucun par défaut pour la documentation ni
   pour la garde. Un seul fichier de test par issue, sauf raison dite.
5. Écrire dans l'issue la section « Invariants et contraintes » : les entrées du registre touchées,
   et pour chacune la vérification manuelle attendue, sans case (`node packages/gardes/cli.mjs
   demander` la prépare). Ouvrir la PR en brouillon : `Close #n`, rien d'autre.
6. Répondre aux commentaires du codeur : corriger le harnais ou préciser l'issue. Vérifier son
   travail en local, garde comprise (`node packages/gardes/cli.mjs pr --issue <n>`).
7. Si le besoin ajoute ou modifie une règle, une décision ou un invariant, vérifier avant d'ouvrir
   la PR qu'il ne contredit ni les autres entrées de son catalogue, ni les documents fondateurs —
   description, glossaire, invariants, contraintes. Écrire dans la PR ce qui a été comparé et
   pourquoi cela tient. Une contradiction ne se code pas : elle devient une question dans l'issue.

Sa vérification s'écrit dans la PR, sans rapport à part : le compte rendu est celui du codeur.

#### Le codeur

Il passe en second, sur la PR ouverte par l'auditeur.

1. Lire l'issue et les documents fondateurs. **Ne pas lire le harnais.** Coder depuis sa propre
   lecture du besoin.
2. Coder sur la branche, commettre, pousser. En brouillon, le verdict est local : `pnpm typecheck` et
   le harnais du besoin, rien d'autre.
3. Ne jamais modifier la PR : ni description, ni état de brouillon, ni harnais. Ne jamais modifier un document
   fondateur, sauf si l'issue le demande.
4. Quand le typecheck et le harnais sont verts, écrire un seul commentaire : ce qui appelle une
   validation humaine — pour
   chaque vérification manuelle demandée, ce que ses modifications changent et ce qui reste à
   constater. Honnête et court. Puis s'arrêter.
5. Si le harnais paraît faux ou le besoin impossible, le dire en commentaire et s'arrêter.

Il ne passe jamais la PR en Ready et n'écrit jamais « Validé ». Il n'ouvre pas d'issue.

#### Le porteur

Il lit le commentaire du codeur et passe la PR en Ready. Toute la CI tourne, et la version de dev
s'assemble depuis le dernier commit de la branche. Il fait ses vérifications manuelles sur la version
de dev, écrit « Validé » sur la PR, puis fusionne au vert ; la fusion ferme l'issue. Si la CI rougit
ou si une vérification échoue, il le dit en commentaire, avec le journal d'erreur ou son constat,
repasse la PR en brouillon, et la boucle reprend.

### Trois règles communes

- **Une issue, une PR, une fusion.** Ce qui en déborde est une nouvelle issue, ouverte avant la
  fusion ; rien ne reste dans un fil qui va se fermer.
- **Une règle ou une décision nouvelle s'écrit dans son catalogue**, en une entrée, sans date ni
  renvoi à ce qu'elle remplace : on amende l'entrée ancienne. C'est l'auditeur qui vérifie qu'elle
  ne contredit ni les autres, ni les fondamentaux du projet ; la garde ne le vérifie pas, elle n'en
  serait pas capable. Si la règle rougit du code existant, le rouge devient une issue.
- **Pas d'outil nouveau sans issue produit qui l'exige.** Une PR qui n'améliore que la garde, les
  crochets ou la CI ne s'ouvre pas sans que le porteur l'ait demandée.
