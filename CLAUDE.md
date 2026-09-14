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
- Lire `docs/decisions.md` avant de modifier le modèle, le plan, le dépôt ou la synchro ; toute
  décision nouvelle y est ajoutée, datée, sans réécrire les anciennes.
- Cœur (`packages/core`) sans dépendance à Svelte ni au navigateur ; tout calcul y est testé
  (vitest, `pnpm test`). L'interface (`apps/web`) ne fait qu'afficher et saisir.
- Montants en centimes entiers signés ; dates `AAAA-MM-JJ` ; `deletedAt` au lieu de supprimer ;
  jamais stocker ce qui se recalcule (soldes, plan, soldes à régler).
- Écritures uniquement via `LedgerStore.upsert/remove/setSetting` (journal de changements).
- Aucune donnée bancaire réelle dans le dépôt ; exemples et tests sur données inventées.
- Avant de pousser : `pnpm typecheck && pnpm test && pnpm build`. Les crochets en font l'essentiel :
  typecheck et tests du cœur, puis tests de la garde, au commit (moins de 30 s, D66) ;
  typecheck complet et build au push. La CI joue tout ce qui garde un comportement ; les
  méta-harnais s'appellent par `pnpm meta` (D62, D65).
- Commits : un lot ou une décision par commit, message en français, corps explicatif.
- Simon lit surtout sur téléphone : réponses courtes, en prose, une question à la fois.

## Méthode de travail

- **Le vocabulaire est celui de [`docs/glossaire.md`](docs/glossaire.md)** : besoin, harnais,
  garde, tests, amorçages. Il commande qui écrit un harnais, où il vit et quand il est joué.
- **L'issue définit le besoin, la PR définit la solution.**
- **Deux agents par besoin, et l'auditeur passe en premier (D68).** La confiance envers le codeur
  n'est pas présumée : un agent écrit le harnais du besoin, un autre code le besoin.
  - **L'auditeur d'abord.** Il juge si le besoin tient en une tâche ou se décline en sous-tâches,
    écrit le « Fait quand » de façon vérifiable, code le harnais, ouvre la PR et en rédige la
    description, ses consignes et les analyses des vérifications manuelles.
  - **Le codeur ensuite**, dans une PR déjà cadrée, avec un harnais déjà en place : il pousse des
    commits sur la branche et **ne modifie jamais la PR** — ni sa description, ni ses consignes, ni
    ses analyses, ni ses cases. Tout ce qu'il a à dire passe par des commentaires : il signale,
    propose, questionne, et attend que l'auditeur corrige ou que le porteur tranche. Il ne découpe
    pas le besoin et n'écrit pas l'attendu.
  - **Le codeur ne lit pas le harnais.** Il code depuis sa propre lecture du besoin, jamais depuis
    les attentes du harnais : sinon il écrit ce qu'il faut pour passer, et le harnais ne vérifie plus
    rien. Il ne va pas le chercher non plus : il code, commet, pousse, et le verdict lui vient des
    crochets de pré-commit et de pré-push, puis de la CI — et, pour un besoin de règle, du workflow
    des méta-harnais. Un échec lui revient avec son message, ce qui suffit ; il n'ouvre pas le code du
    harnais pour y trouver la réponse. Un verdict qu'il ne comprend pas se discute en commentaire ;
    l'auditeur corrige le harnais, ou précise le besoin dans l'issue. Corollaire : l'issue doit
    suffire à coder, et les crochets doivent faire le nécessaire.
  - **Le codeur rend compte de ce qui appelle une validation humaine**, en commentaire : pour chaque
    vérification manuelle demandée, ce que ses modifications changent, ce qu'elles ne touchent pas,
    et ce qui reste à constater de visu. C'est lui qui sait ce qu'il a fait ; personne ne doit le
    déduire de la diff. **Honnête et concis** : les écarts pris et ce qu'il n'a pas pu vérifier
    autant que ce qui marche, et rien d'autre — ni plaidoyer, ni rapport exhaustif. Ce compte rendu
    nourrit l'analyse de l'auditeur, il ne s'y substitue pas, et ne vaut jamais validation.
  - **Un harnais n'est exigible que sur une tâche atomique**, celle qu'une session peut mener
    entièrement. Une tâche qui a des sous-tâches est vérifiée par les leurs ; son harnais global
    s'écrit quand elles sont vertes, jamais avant. Un rouge qui dure cesse d'être un signal.
  - **Si le besoin est une règle**, le codeur code la garde et le harnais de la garde ; l'auditeur
    code le **méta-harnais** qui juge ce travail (D65).
  - **L'intervention humaine fait partie du harnais**, ce n'est pas un niveau de plus : c'est la part
    que le codage ne peut pas trancher. L'auditeur l'écrit, le porteur la valide.
- **Découpage et fusion (D63).** Un objectif se découpe en sous-issues avant tout codage ; l'issue
  d'objectif ne porte jamais de code elle-même.
  - **Une sous-issue, une PR, une fusion.** Une sous-issue est taillée pour être fusionnable seule ;
    une PR qui en porterait plusieurs se découpe avant d'être ouverte.
  - **Un besoin découvert en route devient une sous-issue** du même objectif et attend sa propre PR.
    Il ne rejoint la branche en cours que s'il rend la PR courante fausse.
  - **Une issue se ferme à la fusion**, jamais à la fin du codage : une issue fermée veut dire que
    la garantie est sur `main`. La fermeture est **automatique** : la description de la PR porte
    `Close #<numéro>` pour le besoin qu'elle couvre, et personne ne ferme une issue à la main.
  - **Une discussion née en cours de PR se range avant la fusion** (D68) : soit elle est bloquante,
    et ce qu'elle décide entre dans la PR ; soit elle ne l'est pas, et elle devient une issue, ouverte
    avant la fusion. Rien ne se fusionne en laissant une question pendante dans un fil : une question
    sans issue est une question perdue.
  - **Un objectif permanent ne se ferme pas** ; il se tient par ses gardes, pas par sa fermeture.
- **Issue en cours.** Une session qui prend une issue (objectif, audit ou codage) lui pose
  l'étiquette `en cours` dès le début du travail ; le titre ne s'édite jamais pour cela. L'étiquette
  est retirée d'elle-même à la fermeture de l'issue (`.github/workflows/etiquette-en-cours.yml`).
- **Objectif.** Méta-analyse, en chef de projet : analyser les besoins (issues) et les dépendances
  qui mènent à l'objectif, sur la documentation seulement, sans analyser le code. Si l'objectif
  n'est pas assez clair, poser la question et la consigner dans la discussion de l'issue d'objectif.
  En fin d'objectif, consigner les nouvelles fonctionnalités dans la documentation du dépôt, par une
  PR.
- **Audit d'un besoin.** Partir de l'issue. Si le besoin n'est pas clair ou appelle des questions, les
  poser et les consigner dans l'issue. Une fois le besoin explicite, indiquer la branche de travail
  dans le corps de l'issue, puis écrire les harnais qui contrôlent le résultat dans la branche de la
  PR associée. **En audit, ne jamais toucher au code** : seulement la documentation et les harnais.
  Il s'en tient aux « Fait quand » et aux erreurs plausibles par accident : une forme exotique ou un
  contournement se note dans la PR, sans devenir un harnais rouge (D62).
- **Où poser le harnais qu'on écrit** (D65). Deux questions : qui l'écrit, et pour quel besoin. Le
  harnais d'un besoin produit va auprès de ce qu'il garde (`packages/core/test`, `apps/web/test`,
  `apps/relay`, `apps/hebergement`), ou dans `packages/gardes` s'il n'appartient à aucune
  application. Le harnais que le codeur écrit sur la garde va dans `packages/gardes/gardes.test.mjs`.
  Le harnais qu'un auditeur écrit sur une règle est un **méta-harnais** : il va dans `meta-harnais/`,
  hors du workspace, s'appelle par `pnpm meta`, et ne tourne de lui-même que sur une PR qui touche
  aux règles. Il ne va jamais dans `pnpm test`.
- **Codage d'un besoin.** Le harnais est déjà là et rouge ; le travail consiste à le faire passer
  au vert sans le modifier. Les questions de développement et les décisions techniques se consignent
  en commentaires dans la discussion de la PR, jamais dans sa description.
- **Un `git worktree` par session** (audit, codage), pour que deux sessions ne partagent jamais un
  répertoire de travail (voir #22).
- **Sessions Claude Chat.** Regrouper les commandes en peu d'appels d'outils, pour ne pas atteindre
  trop vite les limites d'usage.
- **Choix techniques.** Une cible de distribution, une technologie ou un outil est un choix
  technique : il se consigne dans une issue de besoin, une par cible identifiée, jamais dans la
  description du projet ni dans les invariants. Il se traite le moment venu, au regard des
  invariants et de `docs/contraintes.md`.
- **Étiquettes GitHub.** `besoin` (issue qui définit un besoin), `cible` (cible de distribution),
  `harnais`, `objectif` (objectif du projet) ; `U1` à `U5`, `I…` et `C…` renvoient aux usages, invariants et contraintes qu'une
  issue sert.
- **Harnais et vérifications manuelles (objectif primaire #58, D61).** Chaque invariant et chaque
  contrainte est gardé par un harnais tant que c'est possible. Ce qui ne se programme pas fait
  l'objet, dans la PR, d'une demande explicite de vérification manuelle, faite avant tout merge :
  pour les invariants et contraintes que la PR touche, et pour ceux qui semblent hors de sa portée
  mais dont le lien pourrait être masqué. Dans le doute, on demande. Un agent peut préparer
  l'analyse d'une vérification ; seul un développeur humain la valide.
  - La correspondance se tient dans `docs/gardes.md`. Ajouter ou renommer un invariant, une
    contrainte ou un harnais met ce document à jour dans la même PR : `pnpm test` échoue sinon.
  - Toute PR remplit la section « Invariants et contraintes » de son modèle ;
    `node packages/gardes/cli.mjs demander --base <branche cible>` la prépare, consignes du registre
    recopiées, l'analyse reste à écrire. La vérification « Vérifications manuelles » reste rouge tant qu'une vérification
    demandée n'est pas analysée et validée.
  - Un agent ne coche jamais « Validée » sans une autorisation explicite de Simon pour cette
    vérification ; quand il la coche, il cite l'autorisation dans un commentaire de la PR. Il ne
    retire pas une garde pour faire passer une PR, et ne fusionne jamais une PR dont la vérification
    « Vérifications manuelles » est rouge.
  - **Une règle nouvelle ne contredit pas les règles primaires (#64).** Changer une règle reste
    libre : une PR ajoute une décision, en remplace une par une entrée nouvelle, fait évoluer la
    garde ou ces règles-ci. Ce qui se vérifie, c'est que la règle nouvelle ne contredit pas les
    **règles primaires** — les invariants et usages (`docs/invariants.md`), les contraintes
    (`docs/contraintes.md`) et la garde de l'objectif primaire (#58, D61). Une PR qui modifie
    `docs/decisions.md`, `docs/description-projet.md`, `docs/invariants.md`, `docs/contraintes.md`,
    ce fichier, ou la garde (son code, ses harnais, son registre `docs/gardes.md`, sa vérification,
    le modèle de PR) se voit demander `VM-regles-primaires` :
    l'analyse nomme les règles primaires touchées et dit pourquoi la règle nouvelle ne les contredit
    pas ; un développeur humain valide avant la fusion. Une contradiction ne se tranche pas dans la
    PR : elle devient une question dans une issue.
  - **Une modification de la garde dit ce qui la couvre (#89).** Une PR qui touche la garde — son
    code, `gardes.test.mjs`, les méta-harnais, `docs/gardes.md`, `verifications.yml`, le modèle de
    PR — se voit demander `VM-garde-couverture`, sans condition et en plus de `VM-regles-primaires` :
    l'analyse nomme ce que la PR change dans la garde et, pour chaque changement, le harnais qui le
    couvre (`packages/gardes/gardes.test.mjs`, un méta-harnais) ou la raison pour laquelle il ne se
    programme pas (D62) ; un développeur humain valide. La consigne se proportionne à la PR : une PR
    qui n'ajoute qu'un test le dit, et c'est tout. Les deux clés restent distinctes : contredire une
    règle primaire et laisser un changement sans garde sont deux défauts différents.
  - **La description du projet et les invariants ne changent qu'à la demande du porteur.** Une PR
    qui modifie `docs/description-projet.md` ou `docs/invariants.md` porte, dans la section
    « Invariants et contraintes », une ligne « Accord du porteur : … » — lien ou citation datée de
    son accord explicite. La garde la lit et reste rouge tant qu'elle manque ou reste vide ;
    `demander` la prépare pour ces PR et pour elles seules.
  - **Aucune fusion au rouge, aucun push direct (#62).** La règle vaut pour tout le monde, agents
    comme porteur : tout changement de `main` passe par une PR dont la vérification « Vérifications
    manuelles » est verte, et un push direct sur `main` vaut fusion non vérifiée, puisqu'aucune
    vérification ne l'a relu. L'offre gratuite ne permet pas de l'empêcher : la règle se signale
    après coup. Le workflow « Alerte de fusion non vérifiée » ouvre aussitôt une issue étiquetée
    `alerte`, qui nomme la PR ou le commit et dit ce qui manquait ; elle se ferme à la main, une fois
    les vérifications refaites ou le passage assumé.
  - Un test qui a besoin d'un outil (navigateur, PHP, `lftp`…) peut se sauter en local s'il manque,
    mais échoue quand `TIRELIRE_STRICT` est posé, comme en CI ; la CI installe ses outils.
  - Un harnais du registre cite son témoin rouge (les mêmes assertions rejouées sur une version
    volontairement cassée du besoin, qui doit échouer) ou porte « à faire » avec le numéro de son
    issue ; la couverture échoue sinon, en le nommant, comme pour un témoin rouge cité qui n'existe
    pas. Un témoin rouge qui se met à passer fait échouer `pnpm test`, l'outil de test tenant
    l'échec attendu (`test.fails` avec vitest, une assertion qui attend l'échec avec `node:test`) —
    la couverture ne le voit pas (#66).
  - Le crochet de pré-commit tient en moins de 30 s (D66) : les méta-harnais (D65) tournent en
    CI, pas au commit (D62).
  - Une validation vaut pour le code validé : un commit qui modifie le code, ou un changement de
    branche cible, l'annule et la vérification décoche la case ; documentation et harnais se
    modifient sans l'annuler. Une case décochée par la vérification ne se recoche qu'aux mêmes
    conditions ; sinon l'agent signale dans la PR que la validation est à refaire.
- **Dépendances.** Elles se tiennent à deux endroits, toujours d'accord : la section « Dépendances »
  de l'issue et les liens GitHub « bloquée par ». Qui recalcule l'une met l'autre à jour.
