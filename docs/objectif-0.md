# Ce que l'objectif 0 doit produire

Base de travail, écrite le 14 septembre 2026 à partir de la discussion avec le porteur. Elle décrit
**ce que le projet doit devenir**, pas ce qu'il est : la plupart de ce qui suit reste à bâtir, par
#95, #96 et les chantiers listés dans #58.

Ce document est **transitoire par construction**. Chaque partie a un endroit où elle atterrira — un
catalogue, `CLAUDE.md`, le code de la garde — et il disparaît quand tout y est. En attendant, il fait
le lien ; il ne fait pas autorité contre les documents du porteur
([`description-projet.md`](description-projet.md)) ni contre [`glossaire.md`](glossaire.md).

## Pourquoi

Ce que le projet se promet est **mesurable**, et **mesuré**. Chaque invariant a son harnais, ou sa
mesure faite par un humain quand elle ne se programme pas. Aucune livraison ne se fusionne sans que
ces mesures soient faites et lisibles dans la PR.

L'objectif est **structurel** : il ne livre rien à l'utilisateur, donc il est à finir vite et à ne pas
faire grossir.

## Le vocabulaire

Il est dans [`glossaire.md`](glossaire.md), gardé : besoin — organisationnel, fonctionnel, d'outil,
de documentation —, harnais comme terme générique, garde, tests, amorçages, documentation simple.

## Les catalogues

Huit ensembles, chacun disant à quoi il se subordonne.

| Catalogue | Ce qu'il contient | Qui l'édite |
|---|---|---|
| Description du projet | les paroles du porteur, mot pour mot | le porteur seul |
| Principes | ce qu'on poursuit, ce qui borne ; non mesurable | le porteur seul |
| Invariants | la déclinaison **mesurable** d'un principe, d'une règle, d'un usage ou d'une contrainte | pas au détour d'un développement |
| Usages | des mises en application qui éclairent un choix | pas au détour d'un développement |
| Contraintes | ce que l'environnement impose ; **portée : toutes les cibles par défaut** | pas au détour d'un développement |
| Cibles | webapp, relais PHP (APK de côté) ; borne le champ des agents | pas au détour d'un développement |
| Règles | comment le projet se conduit | une PR, sous conformité et validation |
| Décisions | comment le produit est fait | une PR, sous conformité |

**Subordination.** Une décision se conforme aux invariants, aux contraintes et aux règles ; elle n'a
aucun pouvoir sur eux. Une règle se conforme aux principes et aux autres règles ; si elle les heurte,
elle **propose les amendements** qui rétablissent la cohérence — obligation, pas impasse.

**La source d'un invariant n'est jamais une décision** : un invariant engage tout le projet, une
décision non. Une décision qui paraît en fonder un contient un principe qu'on n'a pas extrait. Ce qui
découle d'une décision et se mesure relève des **tests**.

**Priorité.** Aucun usage n'est retiré d'un catalogue ; ce qu'on traite se dit par une décision de
priorité, sur un couple usage et cible. Aujourd'hui : **construction d'un budget ex nihilo (U1),
cible webapp**. Ne pas traiter un usage est légitime ; rendre un usage impossible ne l'est pas.

## Ni journal, ni date

Les catalogues se lisent sans notion de temps : on n'empile pas, on **amende** dès qu'une entrée
nouvelle crée une incohérence. Pas de renvoi du genre « relevé par… », pas d'historique daté dans le
texte : l'historique appartient à git.

**Application rétroactive.** Une règle ou une décision vaut pour tout l'existant. Ses harnais peuvent
rougir sur du code déjà là : ces rouges deviennent des issues, et n'empêchent pas de poser la règle.
La PR qui la code ne se fusionne pas sans que ses **amorçages** soient verts — le rouge toléré est
celui du produit existant, jamais celui qui dirait que la règle n'a pas été livrée.

## Le fonctionnement : deux agents par besoin

Écrit dans `CLAUDE.md` (D68). En bref : l'auditeur passe en premier — atomicité, découpage, « Fait
quand » vérifiable, harnais, PR et sa description. Le codeur reçoit une PR cadrée et un harnais rouge,
ne lit pas le harnais, code depuis sa lecture du besoin, ne modifie jamais la PR, et rend compte en
commentaire, honnêtement et brièvement, de ce qui appelle une validation humaine. Le verdict vient des
crochets et de la CI. Un harnais global n'est exigible que sur une tâche atomique.

L'**intervention humaine fait partie du harnais** : c'est la part que le codage ne peut pas trancher.
Ce n'est pas un niveau de plus.

## La garde

**Deux emplois, à ne pas confondre** : garantir que ce qu'elle garde n'est pas altéré, et garantir que
le contenu de ce qu'elle garde est respecté.

**Elle tient les catalogues, tous** : elle les lit, et elle les écrit. L'édition passe par un verbe de
l'outil, pas par l'éditeur de texte — pas de service web ni d'API. Chaque catalogue a sa conduite :
ajouter une décision vérifie sa conformité, gère son identifiant et propose une promotion s'il y a
lieu ; ajouter une règle applique la garde à la règle elle-même ; et ainsi de suite par rang.

**Ce que l'écriture apporte** : l'identifiant est attribué, donc la collision devient impossible au
lieu d'être constatée après coup ; la forme produite est **canonique**, donc une modification faite à
la main se voit. En cas d'altération, on **rejoue l'édition par l'outil**.

**Elle signale, elle ne décide pas** de sa propre évolution. Au même passage que le contrôle de
conformité, elle imprime ce qui ressemble à une promotion — une décision qui dit « toujours » ou
« jamais », une décision qui en amende plusieurs, un incident sans règle ni harnais. L'auditeur juge.
Un seul cas est **refusé**, parce qu'il est exact : un invariant qui nomme une décision pour source.

**Rapprochement flou, puis lecture sémantique.** Ces signaux sont grossiers : une décision peut dire
la même chose qu'un principe sans en employer les mots. La garde compare donc chaque entrée aux
entrées des rangs supérieurs, et entre entrées d'un même rang pour les doublons. La comparaison est
lexicale et déterministe — texte normalisé (minuscules, accents, mots vides retirés), n‑grammes de
mots et de caractères, proximité par recouvrement, distance d'édition sur les intitulés — donc sans
dépendance, sans réseau, et reproductible d'une exécution à l'autre.

Elle rend une liste courte, ordonnée, qui nomme le score : « cette décision ressemble à tel principe,
à telle règle ». **La lecture sémantique, c'est la session qui la fait** : l'agent lit la liste et
juge si le rapprochement est un reclassement. La garde n'embarque donc aucun modèle, ce qui la garde
déterministe et jouable hors ligne, et respecte le partage — elle signale, l'auditeur décide.

Les seuils se règlent, et rien de tout cela n'est bloquant : seul le cas exact ci-dessus l'est. Un
rapprochement écarté se note dans la PR, pour ne pas revenir à chaque exécution.

**La garde exécutée est toujours celle de `main`** ; son résultat porte sur le code courant. En
lecture comme en écriture.

**La faire évoluer**, en deux membres :

- **ajouter**, en respectant la garde en place : aucun de ses harnais ne rougit, rien de plus n'est
  demandé ; les rouges nouveaux sont ceux de l'application rétroactive ;
- **modifier un comportement** : des harnais de la garde rougissent.

Deux invariants de la garde valent dans tous les cas : tout changement de son comportement est
**validé manuellement**, et **expliqué puis justifié en commentaire de la PR**. La validation porte sur
le couple — ce qui rougit, et ce que la PR a changé dans le harnais lui-même.

**Se protéger d'un désarmement.** Toute modification du contenu gardé, décisions exceptées, exige une
validation humaine, portée par une vérification **jugée depuis `main`** qu'une PR ne peut pas
désarmer : le workflow est pris dans la branche de base, il ne lit que des noms de fichiers et du
texte, et ses propres chemins figurent parmi ceux qu'il surveille. Trou résiduel connu : sur l'offre
gratuite, aucune vérification n'est obligatoire avant fusion ; une fusion malgré un rouge ouvre une
alerte (#62).

## La sortie de l'objectif 0

L'objectif est atteint quand, ensemble :

1. les huit catalogues existent, chacun disant à quoi il se subordonne, et le tri est fait — ce qui ne
   se mesure pas est un principe, le reste est un invariant avec sa source et sa mesure ;
2. l'outil de garde est fonctionnel sur tous : il lit, il écrit, il attribue les identifiants, il
   refuse le cas exact, il signale les promotions ;
3. tous les documents qui la constituent sont à jour de ce fonctionnement, et le vocabulaire du dépôt
   est celui du glossaire ;
4. chaque invariant a son harnais, ou sa mesure manuelle décrite ; aucune dette n'est masquée ;
5. la vérification jugée depuis `main` est en place ;
6. la chaîne se démontre : un harnais qui sait rougir, une PR qui demande ses vérifications, une
   validation lisible, une alerte si l'on passe outre ;
7. ce document a disparu, chaque partie ayant rejoint son catalogue, `CLAUDE.md` ou le code.

Tant que l'un manque, l'objectif reste ouvert. Le suivi est dans #58.
