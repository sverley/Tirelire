# Format du fichier Tirelire (dépôt SQLite)

Ce document décrit le fichier que l'application ouvre, pour qu'on puisse en fabriquer un hors de
l'application — reprendre un budget tenu ailleurs (chantier 3) — sans lire le code. Il sert qui
fabrique un fichier pour la webapp sur Chromium, Android et ordinateur ; le relais PHP n'est pas
concerné. L'utilisateur, lui, n'en a pas besoin : l'application écrit ce fichier toute seule.

Il ne dit pas ce qui fait refuser un fichier ni ce que l'ouverture complète : D58, dans
`docs/decisions.md`, en tient la liste, et la commande `verifier-fichier` (section « Vérifier un
fichier ») rend le verdict sur la machine, chaque problème nommé. Un test de `packages/core` confronte
les tableaux de colonnes, de réglages et de clés de `meta` au format, joue l'exemple minimal et
recalcule la clé d'exemple : ce document ne vieillit pas en silence.

Les mots sont ceux du glossaire (`docs/glossaire.md`).

## Ce qu'est le fichier

Le fichier est une base SQLite, un **état** (D58) : des tables, une ligne par fait, et rien qui
garde ce qu'une ligne a remplacé. Il porte :

- les tables du format, décrites ci-dessous : `accounts`, `tirelires`, `needs`, `categories`,
  `planned_flows`, `operations`, `sub_operations`, `shortfall_answers`, `automations`, `devices`,
  `import_profiles` ;
- `settings`, les réglages du foyer ;
- `meta`, qui dit que c'est un fichier Tirelire et de quelle version du format.

Chaque table du format porte en plus une colonne `hlc`, l'horloge de la ligne ; `settings` aussi
(voir « Les conventions »).

Ce que ce document ne décrit pas fait refuser le fichier : une table ou une colonne hors de ce qui
suit, une clé de `meta` autre que celles de la table `meta`. Un fichier s'ouvre en entier ou il
est refusé ; l'application n'en écarte jamais une partie.

### La version du format

La version du format décrite ici est **8** : `meta` la porte sous la clé `format_version`, écrite
comme le texte `8`, avec le marqueur `format` valant `tirelire` (table `meta`). Avant `v1`, le
format peut changer d'une version à la suivante sans migration, et un fichier d'une autre version est
refusé en le disant (D30, D91) : ce document décrit la version 8, et un test le tient juste.

## Les conventions

Chacune est dite ici une fois ; les tableaux de colonnes n'y renvoient que par le type.

- **Montants** : des entiers en centimes, signés (D89). Sur une opération et sur un flux prévu,
  positif = crédit du compte, négatif = débit. Un solde d'ouverture est dans le même sens : positif
  si le compte ou la tirelire est approvisionné. Un montant n'a jamais de décimale.
- **Dates** : un texte `AAAA-MM-JJ`, un jour qui existe au calendrier (`2026-09-15`), sans heure ni
  fuseau.
- **Horodatages** : un texte `AAAA-MM-JJTHH:MM:SS.mmmZ`, en UTC, tel que l'écrit
  `Date.prototype.toISOString` (`2026-09-15T08:30:00.000Z`). Seules deux colonnes en portent :
  `deleted_at` et `devices.last_seen`.
- **Booléens** : l'entier `0` ou `1`.
- **Suppression logique** : rien ne disparaît physiquement. Une ligne supprimée reste dans la table,
  sa colonne `deleted_at` posée à l'horodatage de la suppression ; une ligne vivante a `deleted_at`
  vide. Le compte principal ne se supprime pas.
- **L'horloge de chaque ligne** : `hlc` est l'horloge logique hybride de la dernière écriture de la
  ligne, qui porte l'instance qui l'a écrite (D58) — `AAAAAAAAAAAAA:CCCC:instance`, treize chiffres
  de millisecondes, quatre hexadécimaux de compteur, puis l'identifiant de l'instance. Elle décide,
  à la synchronisation, de la ligne la plus récente. **Un fichier fabriqué peut la laisser vide** :
  colonne absente, `NULL` ou texte vide. L'instance qui l'ouvre date alors la ligne, et la ligne
  devient une ligne de cette instance. Une horloge présente qui ne se lit pas fait refuser le fichier.
- **Les deux familles d'identifiants** (D09) : tout ce que l'utilisateur crée porte un UUID v7 ; une
  opération importée d'un relevé porte une clé déterministe, `op_` suivi de 16 hexadécimaux (section
  « La clé d'une opération importée »). **Le fichier admet comme identifiant d'une ligne créée tout
  texte non vide, unique dans sa table** : l'application écrit des UUID v7, mais un fichier fabriqué
  peut en choisir d'autres, comme les identifiants lisibles de l'exemple minimal. Deux identifiants
  de ligne sont imposés : celui du compte principal, `acc-principal`, et celui d'une réponse à un
  manque, `reponse:<besoin>:<échéance>` ; dans `settings`, la clé est le nom du réglage.

## Les tables

Chaque table est décrite par un tableau de ses colonnes, dans l'ordre. Les colonnes du tableau :

- **Type** : le type SQLite de la colonne, `TEXT` ou `INTEGER`.
- **Obligatoire** : `oui` si la colonne ne se laisse jamais vide.
- **Peut manquer** : `oui` si un fichier fabriqué peut ne pas avoir la colonne du tout, ce qui vaut
  vide ; `non` si elle doit y être.
- **Origine** : qui écrit la colonne, dans les mots de D58. **Saisie** : l'utilisateur la renseigne.
  **Importée** : elle vient d'une ligne de relevé. **Établie** : l'application la pose d'elle-même.
- **Valeurs admises** : la liste des valeurs d'une colonne énumérée ou booléenne ; pour une date ou
  un horodatage, sa forme ; pour une colonne JSON, le nom de sa forme, décrite plus bas.
- **Désigne** : pour une référence, la table dont la colonne porte l'identifiant d'une ligne ;
  cette ligne doit être dans le fichier.

### Table `accounts`

Les comptes réels que le budget suit : le compte principal, les comptes d'accueil, les comptes tiers
(glossaire). Le compte principal naît avec toute base ; un fichier fabriqué peut le renseigner. Une
contrainte de la table, `accounts.principal` : le genre `principal` et l'identifiant `acc-principal`
vont ensemble, et la ligne du compte principal n'a pas de `deleted_at`.

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | oui | non | établie | texte | — | Identifiant du compte. |
| `name` | TEXT | oui | non | saisie | texte | — | Nom du compte. |
| `kind` | TEXT | oui | non | saisie | `principal`, `courant`, `epargne` | — | Nature du compte et rien d'autre (D45). `principal` : le compte par lequel tout transite, un seul ; `epargne` : livret, PEL, assurance-vie, qui héberge des tirelires ; `courant` : tout autre compte courant. |
| `bank` | TEXT | non | oui | saisie | texte | — | La banque. |
| `account_number` | TEXT | non | oui | saisie | texte | — | Numéro de compte ou IBAN, qui sert à attribuer à ce compte les lignes d'un relevé (D18). |
| `opening_balance` | INTEGER | oui | non | saisie | entier | — | Solde du compte à `opening_date`, en centimes. |
| `opening_date` | TEXT | oui | non | saisie | date `AAAA-MM-JJ` | — | Date du solde d'ouverture : on peut commencer à suivre un compte ouvert depuis dix ans. |
| `tracks_settlement` | INTEGER | non | oui | saisie | `0`, `1` | — | Suivre un solde à régler avec le compte principal (D04, D45) : un compte tiers. |
| `settlement_threshold` | INTEGER | non | oui | saisie | entier | — | En dessous de ce montant, en centimes, aucun virement de règlement n'est proposé. |
| `settlement_direction` | TEXT | non | oui | saisie | `both`, `toThird`, `fromThird` | — | Sens autorisé des virements de règlement : dans les deux sens, vers le compte tiers, ou depuis lui. |
| `active_from` | TEXT | non | oui | saisie | date `AAAA-MM-JJ` | — | Ouverture réelle du compte (D56), distincte de `opening_date`. |
| `active_to` | TEXT | non | oui | saisie | date `AAAA-MM-JJ` | — | Clôture réelle du compte (D56) : clore n'est pas supprimer, le compte garde ses opérations. |
| `deleted_at` | TEXT | non | oui | établie | horodatage `AAAA-MM-JJTHH:MM:SS.mmmZ` | — | Suppression logique. |
| `hlc` | TEXT | non | oui | établie | horloge | — | L'horloge de la ligne. |

### Table `tirelires`

Les tirelires : chacune est une somme réservée à un usage précis, avec son propre solde, répartie sur
un ou plusieurs comptes réels (glossaire). Les besoins qui la font vivre sont dans `needs`.

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | oui | non | établie | texte | — | Identifiant de la tirelire. |
| `name` | TEXT | oui | non | saisie | texte | — | Nom de la tirelire. |
| `placement` | TEXT | oui | non | saisie | JSON, forme « placement » | — | Où l'argent de la tirelire devrait dormir (D20, D38) : une répartition entre comptes. Une liste vide ne produit aucun écart. |
| `opening_balance` | INTEGER | oui | non | saisie | entier | — | Solde de la tirelire à `opening_date`, en centimes, réputé sur le premier compte du placement. |
| `opening_date` | TEXT | oui | non | saisie | date `AAAA-MM-JJ` | — | Date du solde d'ouverture. |
| `rollover` | TEXT | non | oui | saisie | JSON, forme « report » | — | Sort de l'excédent en fin de période (D05, D29). Absent, le report est illimité. |
| `deleted_at` | TEXT | non | oui | établie | horodatage `AAAA-MM-JJTHH:MM:SS.mmmZ` | — | Suppression logique. |
| `hlc` | TEXT | non | oui | établie | horloge | — | L'horloge de la ligne. |

### Table `needs`

Les besoins qu'une tirelire porte (D28) : ce qu'elle doit financer, et à quel rythme. Une tirelire
en porte plusieurs.

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | oui | non | établie | texte | — | Identifiant du besoin. |
| `tirelire_id` | TEXT | oui | non | saisie | texte | `tirelires` | La tirelire qui porte le besoin. |
| `kind` | TEXT | oui | non | saisie | `recurring`, `dueDate`, `goal`, `payout` | — | `recurring` : un montant par période ; `dueDate` : un montant pour chaque échéance du rythme ; `goal` : une mensualité jusqu'à une cible facultative ; `payout` : une tirelire à l'envers, qui verse une dotation au budget (D48). |
| `name` | TEXT | non | oui | saisie | texte | — | Libellé du besoin (« Taxe foncière ») ; sans lui, le nom de la tirelire. |
| `amount` | INTEGER | non | oui | saisie | entier | — | En centimes. `recurring` : le montant par période ; `dueDate` : le montant de l'échéance ; `goal` : la cible, facultative ; `payout` : le montant versé pour la périodicité. |
| `periodicity` | TEXT | non | oui | saisie | JSON, forme « rythme » | — | `recurring` : 1 (mensuel) ou 12 (annuel) avec ancrage ; `dueDate` : l'échéance (intervalle et ancrage) (D47). |
| `monthly_amount` | INTEGER | non | oui | saisie | entier | — | `goal` : la mensualité, en centimes. |
| `priority` | INTEGER | oui | non | saisie | entier | — | Ordre de financement : le plus petit est servi en premier. |
| `active_from` | TEXT | non | oui | saisie | date `AAAA-MM-JJ` | — | Premier jour de validité du besoin (D50), bornes incluses. |
| `active_to` | TEXT | non | oui | saisie | date `AAAA-MM-JJ` | — | Dernier jour de validité du besoin (D50). |
| `deleted_at` | TEXT | non | oui | établie | horodatage `AAAA-MM-JJTHH:MM:SS.mmmZ` | — | Suppression logique. |
| `hlc` | TEXT | non | oui | établie | horloge | — | L'horloge de la ligne. |

### Table `categories`

Les catégories qui classent les sous-opérations, en arbre.

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | oui | non | établie | texte | — | Identifiant de la catégorie. |
| `name` | TEXT | oui | non | saisie | texte | — | Nom de la catégorie. |
| `parent_id` | TEXT | non | oui | saisie | texte | `categories` | La catégorie qui la contient ; vide pour une catégorie de premier niveau. Une catégorie n'est pas son propre ancêtre. |
| `tirelire_id` | TEXT | non | oui | saisie | texte | `tirelires` | Tirelire par défaut de la catégorie (D32). |
| `nature` | TEXT | oui | non | saisie | `expense`, `income` | — | Dépense ou revenu. |
| `deleted_at` | TEXT | non | oui | établie | horodatage `AAAA-MM-JJTHH:MM:SS.mmmZ` | — | Suppression logique. |
| `hlc` | TEXT | non | oui | établie | horloge | — | L'horloge de la ligne. |

### Table `planned_flows`

Les flux prévus (glossaire) : des opérations attendues — salaire, charge fixe, échéance de provision,
virement interne —, décrites par un montant, un rythme et une sélection qui reconnaît l'opération
bancaire qui réalise chaque occurrence (D12, D24), et une action, celle d'un automatisme, qui la
classe (D24). Un flux de virement du compte principal vers un compte d'accueil est un ordre
permanent (D57, D60). Une contrainte de la table, `planned_flows.action` : l'état de l'action vaut
`reconcile` ou `lock`, jamais `none` ni `unlock`, et l'action ne porte pas `oneOff` (D22, D23).

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | oui | non | établie | texte | — | Identifiant du flux. |
| `name` | TEXT | oui | non | saisie | texte | — | Nom du flux. |
| `kind` | TEXT | oui | non | saisie | `income`, `fixedCharge`, `dueDate`, `transfer` | — | `income` : un revenu attendu ; `fixedCharge` : un prélèvement ou virement fixe, non couvert par une tirelire ; `dueDate` : une échéance payée depuis une tirelire ; `transfer` : un virement interne attendu entre deux comptes suivis. |
| `amount` | INTEGER | oui | non | saisie | entier | — | Montant signé, en centimes : positif = crédit sur `account_id`, négatif = débit. Sur un ordre permanent, ce qu'il exécute chez la banque. |
| `account_id` | TEXT | oui | non | saisie | texte | `accounts` | Le compte du flux. |
| `counterpart_account_id` | TEXT | non | oui | saisie | texte | `accounts` | `transfer` : le compte de contrepartie. |
| `periodicity` | TEXT | oui | non | saisie | JSON, forme « rythme » | — | Le rythme des occurrences (D47). |
| `date_window_days` | INTEGER | oui | non | saisie | entier | — | Fenêtre de ses occurrences, en jours autour de la date attendue (D12). |
| `amount_tolerance` | TEXT | non | oui | saisie | JSON, forme « tolérance » | — | Tolérance sur le montant de l'opération qui réalise une occurrence. |
| `label_pattern` | TEXT | non | oui | saisie | texte | — | Motif de libellé, une expression régulière insensible à la casse ; sans lui, aucun libellé n'est reconnu. |
| `variable` | INTEGER | non | oui | saisie | `0`, `1` | — | Montant variable : tolérance large, jamais repris sans confirmation (D12). |
| `active_from` | TEXT | non | oui | saisie | date `AAAA-MM-JJ` | — | Premier jour de validité du flux. |
| `active_to` | TEXT | non | oui | saisie | date `AAAA-MM-JJ` | — | Dernier jour de validité du flux. |
| `action` | TEXT | non | oui | saisie | JSON, forme « action » | — | Ce que le flux fait de l'opération qui reprend une occurrence (D24) : sa catégorie, sa tirelire — celle qu'une échéance vide —, sa ventilation, son état. |
| `kept` | TEXT | non | oui | saisie | JSON, forme « garde » | — | Sur un ordre permanent gardé tel quel (#205, D20) : ce que le budget demandait au geste. Absent : l'écart de l'ordre est à faire. |
| `deleted_at` | TEXT | non | oui | établie | horodatage `AAAA-MM-JJTHH:MM:SS.mmmZ` | — | Suppression logique. |
| `hlc` | TEXT | non | oui | établie | horloge | — | L'horloge de la ligne. |

### Table `operations`

Les opérations : un montant, une date, un compte. Une ligne de relevé importée, ou une saisie à la
main, passée ou future. Les opérations prévues, produites par les flux, ne sont jamais enregistrées
(glossaire). Les colonnes d'une opération sont importées, saisies ou établies (D58) ; le libellé
normalisé ne se stocke pas, il se recalcule à la lecture. Une contrainte de la table,
`operations.reprise` : `planned_flow_id` et `planned_date` vont ensemble, et une opération en reprend
au plus une autre (D88). Les colonnes d'une opération saisie à la main sont toutes saisies.

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | oui | non | établie | texte | — | Identifiant de l'opération : la clé `op_…` d'une opération importée, un UUID v7 d'une saisie. |
| `account_id` | TEXT | oui | non | importée ou saisie | texte | `accounts` | Le compte de l'opération. |
| `origin` | TEXT | oui | non | établie | `imported`, `manual` | — | Comment la ligne est née ; elle ne se lit pas dans la forme de l'identifiant (D58). |
| `date` | TEXT | oui | non | importée ou saisie | date `AAAA-MM-JJ` | — | Date de l'opération. |
| `label` | TEXT | oui | non | importée ou saisie | texte | — | Libellé de l'opération, tel que la source le donne. |
| `details` | TEXT | non | oui | importée ou saisie | texte | — | Libellé complet fourni par la banque, quand il diffère du libellé. |
| `amount` | INTEGER | oui | non | importée ou saisie | entier | — | Montant signé, en centimes : négatif = débit du compte. |
| `state` | TEXT | oui | non | établie | `untreated`, `reconciled`, `locked` | — | État de traitement (D22) : `untreated`, qu'aucun automatisme n'a vue ; `reconciled`, classée par un automatisme, reprise à chaque passage ; `locked`, de la vérité, qu'aucun automatisme ne réécrit. |
| `one_off` | INTEGER | non | oui | saisie | `0`, `1` | — | Dépense exceptionnelle : comptée dans les soldes, exclue des moyennes du bilan. |
| `suggested_category` | TEXT | non | oui | importée ou saisie | texte | — | La catégorie que propose la source (banque, Linxo), à confirmer. |
| `planned_flow_id` | TEXT | non | oui | établie | texte | `planned_flows` | L'opération prévue reprise (D88), désignée par son flux… |
| `planned_date` | TEXT | non | oui | établie | date `AAAA-MM-JJ` | — | … et par sa date. |
| `resumed_operation_id` | TEXT | non | oui | établie | texte | `operations` | La saisie reprise (D88) : l'opération qui annonçait le même mouvement. |
| `transfer_account_id` | TEXT | non | oui | établie | texte | `accounts` | Virement interne : le compte de contrepartie. |
| `transfer_operation_id` | TEXT | non | oui | établie | texte | `operations` | Virement interne : l'opération de contrepartie. |
| `deleted_at` | TEXT | non | oui | établie | horodatage `AAAA-MM-JJTHH:MM:SS.mmmZ` | — | Suppression logique. |
| `hlc` | TEXT | non | oui | établie | horloge | — | L'horloge de la ligne. |

Pour une opération importée, un fichier fabriqué écrit `origin` `imported`, `state` `untreated` et
l'identifiant que calcule la section « La clé d'une opération importée ».

### Table `sub_operations`

Les sous-opérations (glossaire, D88) : les parts d'une opération, sur autant de niveaux qu'on veut.
Elles la ventilent entre tirelires et catégories, ou la divisent dans le temps (lissage). Une
sous-opération est saisie par l'utilisateur ou établie à sa place par un automatisme ; le fichier ne
les distingue pas. Ce qu'une sous-opération ne porte pas — catégorie, tirelire, renflouement —, elle
le prend du niveau qui la contient. Une opération sans aucune sous-opération vaut une sous-opération
variable sans classement.

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | oui | non | établie | texte | — | Identifiant de la sous-opération. |
| `operation_id` | TEXT | oui | non | saisie ou établie | texte | `operations` | L'opération dont elle fait partie, à tout niveau. |
| `parent_id` | TEXT | non | oui | saisie ou établie | texte | `sub_operations` | La sous-opération qui la contient, de la même opération ; vide, c'est l'opération elle-même. |
| `category_id` | TEXT | non | oui | saisie ou établie | texte | `categories` | La catégorie de la part. |
| `tirelire_id` | TEXT | non | oui | saisie ou établie | texte | `tirelires` | La tirelire de la part. |
| `share` | TEXT | oui | non | saisie ou établie | JSON, forme « part » | — | La part, dans le niveau qui la contient (D27). |
| `replenishment` | TEXT | non | oui | saisie | `internal`, `external` | — | La sous-opération renfloue la tirelire (D49) : `internal`, l'argent était déjà chez le foyer ; `external`, un cadeau, un remboursement, une vente. |
| `date` | TEXT | non | oui | établie | date `AAAA-MM-JJ` | — | Date propre d'une part de lissage (D88) : elle compte à cette date dans la tirelire et la catégorie, alors que le compte réel bouge à la date de l'opération. |
| `deleted_at` | TEXT | non | oui | établie | horodatage `AAAA-MM-JJTHH:MM:SS.mmmZ` | — | Suppression logique. |
| `hlc` | TEXT | non | oui | établie | horloge | — | L'horloge de la ligne. |

### Table `shortfall_answers`

Les réponses de l'utilisateur au manque d'une échéance (glossaire, D88) : une par échéance, qui garde
soit le lissage retenu, soit le refus. Une contrainte de la table, `shortfall_answers.id` :
l'identifiant d'une réponse est `reponse:<besoin>:<échéance>`, avec l'identifiant du besoin et la date
de l'échéance, si bien que deux instances qui répondent à la même échéance écrivent la même ligne.

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | oui | non | établie | `reponse:<besoin>:<échéance>` | — | Identifiant de la réponse. |
| `need_id` | TEXT | oui | non | établie | texte | `needs` | Le besoin dont l'échéance manque. |
| `due_date` | TEXT | oui | non | établie | date `AAAA-MM-JJ` | — | Date de l'échéance à laquelle la réponse répond. |
| `operation_id` | TEXT | non | oui | établie | texte | `operations` | La saisie du lissage retenu ; vide pour un refus. |
| `deleted_at` | TEXT | non | oui | établie | horodatage `AAAA-MM-JJTHH:MM:SS.mmmZ` | — | Suppression logique. |
| `hlc` | TEXT | non | oui | établie | horloge | — | L'horloge de la ligne. |

### Table `automations`

Les automatismes de classement (glossaire, D23) : une sélection et une action, appliquées sans geste
aux opérations que la sélection retient. Les flux prévus, qui sont aussi des automatismes, sont dans
`planned_flows`.

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | oui | non | établie | texte | — | Identifiant de l'automatisme. |
| `name` | TEXT | non | oui | saisie | texte | — | Nom de l'automatisme. |
| `selection` | TEXT | oui | non | saisie | JSON, forme « sélection » | — | Les opérations qu'il retient : tous les critères renseignés doivent être remplis (D23, D36). |
| `action` | TEXT | oui | non | saisie | JSON, forme « action » | — | Ce qu'il fait des opérations retenues (D23). |
| `rank` | TEXT | oui | non | saisie | texte | — | Clé de rang triable (D31) : les automatismes s'appliquent de la clé la plus grande à la plus petite dans l'ordre lexicographique, l'identifiant départageant les égalités. |
| `valid_from` | TEXT | non | oui | saisie | date `AAAA-MM-JJ` | — | Premier jour des opérations que l'automatisme peut retenir. |
| `valid_to` | TEXT | non | oui | saisie | date `AAAA-MM-JJ` | — | Dernier jour des opérations que l'automatisme peut retenir : archivé, il ne sélectionne plus rien après. |
| `deleted_at` | TEXT | non | oui | établie | horodatage `AAAA-MM-JJTHH:MM:SS.mmmZ` | — | Suppression logique. |
| `hlc` | TEXT | non | oui | établie | horloge | — | L'horloge de la ligne. |

### Table `devices`

Les appareils connus du foyer (glossaire, « Instance ») ; l'identifiant d'un appareil est celui de son
instance. Un fichier fabriqué n'a rien à y écrire.

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | oui | non | établie | texte | — | Identifiant de l'instance de l'appareil. |
| `name` | TEXT | oui | non | saisie | texte | — | Nom de l'appareil. |
| `user` | TEXT | non | oui | saisie | texte | — | Prénom ou nom de la personne qui l'utilise. |
| `last_seen` | TEXT | non | oui | établie | horodatage `AAAA-MM-JJTHH:MM:SS.mmmZ` | — | Dernière fois que l'appareil a été vu. |
| `deleted_at` | TEXT | non | oui | établie | horodatage `AAAA-MM-JJTHH:MM:SS.mmmZ` | — | Suppression logique. |
| `hlc` | TEXT | non | oui | établie | horloge | — | L'horloge de la ligne. |

### Table `import_profiles`

Les profils d'import : comment lire un relevé CSV d'une source — l'encodage, le séparateur, les
colonnes, le format des dates (`docs/formats-import.md` décrit les relevés).

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | oui | non | établie | texte | — | Identifiant du profil. |
| `name` | TEXT | oui | non | saisie | texte | — | Nom du profil. |
| `source` | TEXT | oui | non | saisie | `bank`, `linxo`, `other` | — | La source du relevé, pour la date de bascule et les doublons entre sources. |
| `encoding` | TEXT | oui | non | saisie | `auto`, `utf-8`, `windows-1252` | — | L'encodage du relevé. |
| `delimiter` | TEXT | oui | non | saisie | `auto`, `;`, `,`, `<tabulation>`, `\|` | — | Le séparateur du relevé ; `<tabulation>` est le caractère tabulation. |
| `header_row` | INTEGER | oui | non | saisie | entier | — | Indice, à partir de 0, de la ligne d'en-tête ; les lignes avant sont ignorées. |
| `columns` | TEXT | oui | non | saisie | JSON, forme « colonnes » | — | Quelle colonne du relevé porte quoi. |
| `date_format` | TEXT | oui | non | saisie | `DMY`, `YMD`, `MDY` | — | L'ordre jour, mois, année des dates du relevé. |
| `debit_positive` | INTEGER | non | oui | saisie | `0`, `1` | — | Quand débit et crédit sont en colonnes séparées : le débit est-il exprimé en positif ? |
| `account_map` | TEXT | oui | non | saisie | JSON, forme « comptes » | — | Valeur de la colonne compte du relevé → compte de Tirelire. |
| `account_id` | TEXT | non | oui | saisie | texte | `accounts` | Le compte cible quand le relevé n'a pas de colonne compte. |
| `deleted_at` | TEXT | non | oui | établie | horodatage `AAAA-MM-JJTHH:MM:SS.mmmZ` | — | Suppression logique. |
| `hlc` | TEXT | non | oui | établie | horloge | — | L'horloge de la ligne. |

### Table `settings`

Les réglages du foyer, une ligne par clé (section « Les réglages »). Elle se synchronise, comme les
tables du format. Sa colonne `hlc` suit la même convention.

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `key` | TEXT | oui | non | saisie | la clé d'un réglage | — | Le nom du réglage ; unique dans la table. |
| `value` | TEXT | non | oui | saisie | JSON | — | La valeur du réglage, en JSON (`28`). Vide, le réglage prend sa valeur par défaut. |
| `hlc` | TEXT | non | oui | établie | horloge | — | L'horloge de la ligne. |

### Table `meta`

Le marqueur et la version du format. Elle ne se synchronise pas et ne porte que les deux clés
ci-dessous. Elle ne peut pas manquer : sans elle, le fichier n'est pas reconnu comme un fichier
Tirelire. Ses deux colonnes, `key` et `value`, doivent y être : une table `meta` à laquelle l'une manque
fait refuser le fichier, la colonne nommée.

| Colonne | Type | Obligatoire | Peut manquer | Origine | Valeurs admises | Désigne | Sens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `key` | TEXT | oui | non | établie | `format`, `format_version` | — | Le nom de la clé ; unique dans la table. |
| `value` | TEXT | non | non | établie | texte | — | Sa valeur : sans elle, la clé ne dit rien et le fichier n'est pas reconnu. |

| Clé de `meta` | Valeur | Sens |
| --- | --- | --- |
| `format` | `tirelire` | Le marqueur : ce qui distingue un dépôt Tirelire de toute autre base. |
| `format_version` | `8` | La version du format que ce document décrit, écrite comme le texte `8`. |

## Les formes JSON

Une colonne JSON se lit comme un objet, une liste ou une table. Une forme n'admet aucun champ qui ne
soit pas listé. Dans les tableaux, `[]` désigne chaque élément d'une liste et `{}` la valeur associée
à chaque clé d'une table ; « Seulement si » dit quand un champ n'existe que pour une valeur du champ
qui choisit la forme. Chaque forme est suivie d'exemples que l'application accepte dans sa colonne.
Les identifiants qu'une forme porte désignent une ligne présente du fichier, comme une colonne.

### Forme « part »

La part d'une sous-opération dans le niveau qui la contient, ou d'un compte dans un placement (D27,
D38) : un montant fixe, un pourcentage du montant du niveau, ou la part variable, le reste, jamais
négatif. Une seule part variable par ventilation, et par placement. Colonne : `sub_operations.share`,
et le champ `share` des formes « placement » et « action ».

| Champ | Obligatoire | Forme | Désigne | Seulement si |
| --- | --- | --- | --- | --- |
| `kind` | oui | `fixed`, `percent` ou `variable` | — | — |
| `amount` | oui | montant entier en centimes, dans le signe de l'opération | — | `kind = fixed` |
| `pct` | oui | nombre : 50 est la moitié | — | `kind = percent` |

```json
{ "kind": "fixed", "amount": 12000 }
```

```json
{ "kind": "percent", "pct": 25 }
```

```json
{ "kind": "variable" }
```

### Forme « placement »

Le placement d'une tirelire : une composante par compte. Colonne : `tirelires.placement`.

| Champ | Obligatoire | Forme | Désigne | Seulement si |
| --- | --- | --- | --- | --- |
| `[].accountId` | oui | identifiant d'un compte | `accounts` | — |
| `[].share` | oui | forme « part » : la part du solde de la tirelire qui devrait se trouver sur ce compte | — | — |

```json
[{ "accountId": "acc-livret", "share": { "kind": "variable" } }]
```

```json
[
  { "accountId": "acc-livret", "share": { "kind": "fixed", "amount": 50000 } },
  { "accountId": "acc-principal", "share": { "kind": "variable" } }
]
```

### Forme « report »

Ce que devient l'excédent d'une tirelire en fin de période. Colonne : `tirelires.rollover`.

| Champ | Obligatoire | Forme | Désigne | Seulement si |
| --- | --- | --- | --- | --- |
| `mode` | oui | `none`, `unlimited` ou `capped` | — | — |
| `months` | oui | nombre entier de mois, au moins 0 | — | `mode = capped` |

```json
{ "mode": "none" }
```

```json
{ "mode": "capped", "months": 3 }
```

### Forme « rythme »

Un rythme (D47) : tous les `interval` `unit`, à partir de la date d'ancrage. Colonnes :
`needs.periodicity` et `planned_flows.periodicity`.

| Champ | Obligatoire | Forme | Désigne | Seulement si |
| --- | --- | --- | --- | --- |
| `interval` | oui | nombre entier d'au moins 1 : le nombre d'unités entre deux occurrences | — | — |
| `unit` | oui | `day`, `week`, `month` ou `year` | — | — |
| `anchorDate` | oui | date `AAAA-MM-JJ` d'une occurrence | — | — |

```json
{ "interval": 1, "unit": "month", "anchorDate": "2026-10-05" }
```

### Forme « tolérance »

La tolérance sur le montant d'un flux : un écart absolu, un écart en pourcentage, ou les deux.
Colonne : `planned_flows.amount_tolerance`.

| Champ | Obligatoire | Forme | Désigne | Seulement si |
| --- | --- | --- | --- | --- |
| `abs` | non | montant entier en centimes | — | — |
| `pct` | non | nombre : 5 est cinq pour cent | — | — |

```json
{ "abs": 500, "pct": 5 }
```

### Forme « sélection »

Les opérations qu'un automatisme retient : tous les critères renseignés doivent être remplis.
Colonne : `automations.selection`. L'objet vide retient toute opération.

| Champ | Obligatoire | Forme | Désigne | Seulement si |
| --- | --- | --- | --- | --- |
| `labelPattern` | non | texte : une expression régulière, insensible à la casse | — | — |
| `accountId` | non | identifiant d'un compte | `accounts` | — |
| `amountMin` | non | montant entier en centimes, dans le signe de l'opération | — | — |
| `amountMax` | non | montant entier en centimes, dans le signe de l'opération | — | — |
| `dateFrom` | non | date `AAAA-MM-JJ` | — | — |
| `dateTo` | non | date `AAAA-MM-JJ` | — | — |

```json
{ "labelPattern": "CARREFOUR", "accountId": "acc-principal", "amountMax": -1 }
```

### Forme « garde »

Le choix de garder un ordre permanent tel quel (#205, D20) : ce que le budget demandait au moment du
geste. Colonne : `planned_flows.kept`.

| Champ | Obligatoire | Forme | Désigne | Seulement si |
| --- | --- | --- | --- | --- |
| `amount` | oui | montant entier en centimes : le montant mensuel demandé, `0` pour un ordre que le budget ne demandait plus | — | — |
| `parts` | non | objet : par tirelire qui a une part fixe dans l'ordre, la part demandée | — | — |
| `parts{}` | oui | montant entier en centimes | — | — |

```json
{ "amount": 30000, "parts": { "tirelire-taxe": 10000 } }
```

### Forme « action »

Ce qu'un automatisme fait des opérations retenues (D23) ; chaque champ est facultatif, et `allocation`
remplace la ventilation entière par une division, dont une seule part est variable (D27). Colonnes :
`automations.action`, et `planned_flows.action`, où l'état ne vaut que `reconcile` ou `lock` et où
`oneOff` n'existe pas (contrainte `planned_flows.action`).

| Champ | Obligatoire | Forme | Désigne | Seulement si |
| --- | --- | --- | --- | --- |
| `categoryId` | non | identifiant d'une catégorie | `categories` | — |
| `tirelireId` | non | identifiant d'une tirelire | `tirelires` | — |
| `allocation` | non | liste de parts | — | — |
| `allocation[].categoryId` | non | identifiant d'une catégorie | `categories` | — |
| `allocation[].tirelireId` | non | identifiant d'une tirelire | `tirelires` | — |
| `allocation[].share` | oui | forme « part » | — | — |
| `oneOff` | non | vrai ou faux (le booléen JSON, pas `0` ni `1`) | — | — |
| `state` | non | `lock`, `reconcile`, `none` ou `unlock` : l'effet sur l'état de l'opération (D22, D23) | — | — |

```json
{ "categoryId": "cat-courses", "tirelireId": "tir-alimentation", "state": "reconcile" }
```

```json
{ "allocation": [{ "tirelireId": "tir-vacances", "share": { "kind": "fixed", "amount": -5000 } }] }
```

### Forme « colonnes »

Quelle colonne du relevé porte quoi, par le nom de son en-tête. Colonne : `import_profiles.columns`.
`date` et `label` sont les deux seules obligatoires ; le montant se lit dans `amount`, ou dans
`debit` et `credit`.

| Champ | Obligatoire | Forme | Désigne | Seulement si |
| --- | --- | --- | --- | --- |
| `date` | oui | texte : l'en-tête de la colonne de date | — | — |
| `valueDate` | non | texte : l'en-tête de la colonne de date de valeur | — | — |
| `label` | oui | texte : l'en-tête de la colonne de libellé | — | — |
| `fullLabel` | non | texte : l'en-tête de la colonne de libellé complet | — | — |
| `amount` | non | texte : l'en-tête de la colonne de montant signé | — | — |
| `debit` | non | texte : l'en-tête de la colonne de débit | — | — |
| `credit` | non | texte : l'en-tête de la colonne de crédit | — | — |
| `account` | non | texte : l'en-tête de la colonne de compte | — | — |
| `category` | non | texte : l'en-tête de la colonne de catégorie | — | — |
| `subCategory` | non | texte : l'en-tête de la colonne de sous-catégorie | — | — |

```json
{ "date": "Date", "label": "Libellé", "amount": "Montant" }
```

### Forme « comptes »

La table des comptes d'un profil d'import : la valeur que le relevé porte dans sa colonne compte, et
le compte de Tirelire qu'elle désigne. Colonne : `import_profiles.account_map`. Elle peut être vide.

| Champ | Obligatoire | Forme | Désigne | Seulement si |
| --- | --- | --- | --- | --- |
| `{}` | oui | identifiant d'un compte, pour chaque valeur de colonne compte | `accounts` | — |

```json
{ "FR76 3000 1234": "acc-principal", "FR76 3000 5678": "acc-livret" }
```

## Les réglages

La table `settings` porte les réglages du foyer, qui se synchronisent. Chaque réglage est une ligne :
sa clé, sa valeur en JSON, son horloge. Un réglage absent prend sa valeur par défaut ; sa valeur
attendue et son défaut sont :

| Réglage | Valeur attendue | Défaut | Sens |
| --- | --- | --- | --- |
| `periodStartDay` | un jour du mois, de 1 à 31 | `1` | Le jour où commence la période budgétaire (D44) ; `1` redonne le mois calendaire. |
| `principalCushion` | un montant entier en centimes | `0` | Le coussin à laisser en non affecté sur le compte principal. |
| `transferThreshold` | un montant entier en centimes | `1000` | En dessous, un écart de placement est « à surveiller » plutôt qu'« à faire ». |
| `orderRounding` | un montant entier positif en centimes | `1000` | Le pas d'arrondi d'un ordre permanent (D60) ; `0` propose le montant au centime près. |

Ce qui décrit une instance — son identité, son horloge, ce qu'elle sait des autres, les secrets et
curseurs du relais — n'est pas dans le fichier : l'application le garde à côté (D58). Un réglage qui en
décrit une, comme `siteId`, fait refuser le fichier, et tout réglage hors de ce tableau aussi.

**Ce qui se synchronise** : les tables du format et `settings`, ligne par ligne, la plus récente
gagnant (D58). **Ce qui ne voyage pas** : `meta`, qui ne dit que le format et sa version.

## La clé d'une opération importée

Une opération importée d'un relevé a pour identifiant une clé calculée, qui ne dépend que du relevé
(D09) : deux instances qui importent le même relevé sur le même compte écrivent la même ligne. Sa
recette :

1. **Les entrées**, dans cet ordre : l'identifiant du compte (`acc-principal`) ; la date de l'opération
   (`2026-09-15`) ; le montant en centimes signés, écrit en décimal sans espace (`-5430`) ; le libellé
   normalisé ; le rang.
2. **Le libellé** est celui de la colonne de libellé du relevé, ou, s'il est vide, celui de la colonne
   de libellé complet — celui qu'on range dans `label`, jamais le libellé normalisé.
3. **La normalisation du libellé**, dans cet ordre : décomposer les caractères accentués (NFD) et
   retirer les marques combinantes (U+0300 à U+036F) ; passer en majuscules ; remplacer par un espace
   chaque date `\b\d{2}[\/.-]\d{2}(?:[\/.-]\d{2,4})?\b`, chaque `\b(?:CARTE|CB|CARD)\s*[X*]+\d{2,}\b`,
   chaque `\bX\d{4}\b` et chaque `\b\d{6,}[A-Z]?\b` ; remplacer par un espace chaque suite de
   caractères hors de `A-Z`, `0-9` et l'espace ; réduire les espaces à un seul ; retirer ceux des
   extrémités.
4. **Le rang** parmi les opérations identiques du jour : sur le relevé importé d'un seul tenant, les
   lignes qui ont le même compte, la même date, le même montant et le même libellé normalisé se
   numérotent 0, 1, 2… dans l'ordre où le relevé les donne. Il n'entre que dans la clé et ne se garde
   pas : aucune colonne ne le porte.
5. **L'encodage** : les cinq entrées, sous la forme de texte décrite ci-dessus, se concatènent dans
   l'ordre, séparées par le caractère U+001F (séparateur d'unité), et le texte se code en UTF-8.
6. **Le hachage** : SHA-256 de ces octets.
7. **La troncature** : les 16 premiers hexadécimaux du condensé, en minuscules, préfixés de `op_`.

Exemple : une ligne de relevé, sur le compte `acc-principal`, importée avec la colonne `Libellé` pour
libellé.

```csv
Date;Libellé;Montant
15/09/2026;CARTE X2009 CARREFOUR MARKET 12/09;-54,30
```

Le libellé normalisé est `CARREFOUR MARKET` ; la ligne est la première de son espèce.

- Compte : `acc-principal`
- Rang : `0`
- Clé : `op_80faca5193193b26`

**Ce que la clé garantit** : calculée ainsi, c'est celle qu'aurait la même ligne importée par
l'application sur le même compte ; l'importer de nouveau la reconnaît comme déjà présente et l'ignore.

**Une opération importée dont l'identifiant n'a pas été calculé ainsi** s'ouvre sans refus : le format
n'exige de l'identifiant d'une opération que d'être un texte non vide et unique. Mais l'application ne
la reconnaît pas comme déjà présente quand elle importe le même relevé : elle compte la ligne comme
nouvelle, ou la propose comme doublon probable (même compte, même montant, à trois jours près,
libellé proche, D09) pour que l'utilisateur tranche. Deux instances qui importent ce relevé n'écrivent
pas la même ligne que celle du fichier.

## Un exemple minimal

Ce script, collé dans `sqlite3` sur un fichier vide, donne un fichier que l'application ouvre. Son plan
propose un virement permanent de 50,00 € vers le compte d'accueil « Livret A », ventilé sur la
tirelire « Vacances ». Il ne porte que ce que ce plan demande : le marqueur du format, un compte
d'accueil, une tirelire placée sur lui, un besoin qui lui demande 50,00 € par période. Le compte
principal naît à l'ouverture ; les réglages prennent leurs défauts ; aucune horloge n'est écrite, et
l'instance qui ouvre date les lignes. Le plan se lit à une date postérieure à celles d'ouverture.

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
INSERT INTO meta (key, value) VALUES ('format', 'tirelire'), ('format_version', '8');

CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, opening_balance INTEGER NOT NULL, opening_date TEXT NOT NULL);
INSERT INTO accounts (id, name, kind, opening_balance, opening_date) VALUES ('acc-livret', 'Livret A', 'epargne', 0, '2026-10-01');

CREATE TABLE tirelires (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, placement TEXT NOT NULL, opening_balance INTEGER NOT NULL, opening_date TEXT NOT NULL);
INSERT INTO tirelires (id, name, placement, opening_balance, opening_date) VALUES ('tir-vacances', 'Vacances', '[{"accountId":"acc-livret","share":{"kind":"variable"}}]', 0, '2026-10-01');

CREATE TABLE needs (id TEXT PRIMARY KEY NOT NULL, tirelire_id TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER, priority INTEGER NOT NULL);
INSERT INTO needs (id, tirelire_id, kind, amount, priority) VALUES ('bes-vacances', 'tir-vacances', 'recurring', 5000, 20);
```

## Vérifier un fichier

La commande `verifier-fichier` du cœur rend, sur la machine, le verdict que l'application rendrait à
l'ouverture du fichier, chaque problème nommé, sans rien écrire ni rien envoyer :

```sh
sqlite3 mon-budget.sqlite < exemple.sql
pnpm --dir packages/core run verifier-fichier mon-budget.sqlite
```

Un chemin relatif se lit depuis le dossier d'où la commande est appelée. Le code de sortie est `0` si
le fichier s'ouvre, `1` s'il est refusé, `2` si la commande est mal appelée ou si le fichier ne se lit
pas sur le disque.

Un fichier qui s'ouvre le dit, puis nomme ce que l'ouverture complète, un complément par ligne. Voici
ce que rend l'exemple minimal :

```text
mon-budget.sqlite : s’ouvre. Complété à l’ouverture :
  - table categories absente : ouverte vide
  - table planned_flows absente : ouverte vide
  - table operations absente : ouverte vide
  - table sub_operations absente : ouverte vide
  - table shortfall_answers absente : ouverte vide
  - table automations absente : ouverte vide
  - table devices absente : ouverte vide
  - table import_profiles absente : ouverte vide
  - table settings absente : ouverte vide
  - colonne accounts.bank absente : vide
  - colonne accounts.account_number absente : vide
  - colonne accounts.tracks_settlement absente : vide
  - colonne accounts.settlement_threshold absente : vide
  - colonne accounts.settlement_direction absente : vide
  - colonne accounts.active_from absente : vide
  - colonne accounts.active_to absente : vide
  - colonne accounts.deleted_at absente : vide
  - colonne tirelires.rollover absente : vide
  - colonne tirelires.deleted_at absente : vide
  - colonne needs.name absente : vide
  - colonne needs.periodicity absente : vide
  - colonne needs.monthly_amount absente : vide
  - colonne needs.active_from absente : vide
  - colonne needs.active_to absente : vide
  - colonne needs.deleted_at absente : vide
  - 3 ligne(s) sans horloge : datée(s) par l’instance qui ouvre
  - compte principal absent : il naît à son défaut
```

Chaque ligne à tiret dit ce que l'application pose d'elle-même : une table du format absente, ouverte
vide ; une colonne facultative absente, vide ; les lignes sans horloge, que l'instance qui ouvre
date ; le compte principal, absent, qui naît à son défaut. « Rien à compléter. » signifie que le
fichier est tel que l'application l'aurait écrit.

Un fichier refusé dit combien de problèmes il a, puis chacun, en nommant la table, la ligne et la
colonne. Voici le même fichier, auquel on ajoute un réglage hors de ses bornes (`periodStartDay` va de
1 à 31) :

```sql
CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT);
INSERT INTO settings (key, value) VALUES ('periodStartDay', '40');
```

```text
mon-budget.sqlite : refusé. 1 problème(s) :
  - table settings, ligne « periodStartDay », colonne value : settings « periodStartDay » vaut 40, qui n’est pas un jour du mois, de 1 à 31.
```
