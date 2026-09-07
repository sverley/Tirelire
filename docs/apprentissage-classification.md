# Classification apprenante des opérations (étude, 7 septembre 2026)

Question : peut-on trier les opérations (catégorie, enveloppe, ventilation) sans les prendre une
par une ? D'abord en **cherchant** des opérations et en **classant la sélection** d'un coup, en
gardant la recherche comme règle ; ensuite en laissant l'application **apprendre** des
ventilations déjà faites, y compris par **Bayes naïf** en plus des filtres déterministes.

Réponse courte : **oui, et c'est petit.** Un prototype de 450 lignes dans le cœur
(`packages/core/src/learning.ts`, 12 tests) couvre les trois étages ; le modèle bayésien se
reconstruit en quelques millisecondes à partir des ventilations confirmées et n'a rien à stocker
ni à synchroniser. La valeur est très inégale entre les étages : la **mémoire des libellés**
(déterministe, gratuite) fera l'essentiel ; Bayes n'apporte que sur les libellés jamais vus, et
doit rester une proposition à confirmer.

## 1. Ce qui existe

- `Rule` : un motif regex, une catégorie et/ou une enveloppe, une priorité. Appliquée à
  l'import, première règle qui matche, **une seule ligne** de ventilation. Créée depuis la fiche
  d'une opération (« créer une règle pour les prochaines semblables », motif proposé par
  `suggestPattern`).
- La vue Opérations a une **recherche texte** (`includes` sur libellé + détails) qui ne sert qu'à
  afficher : rien ne s'applique à la liste filtrée, et la recherche ne devient pas une règle.
- `suggestedCategory` (catégorie Linxo ou banque) est importée mais **inutilisée**.
- Une ventilation en plusieurs lignes ne s'apprend ni ne se rejoue.

## 2. Trois étages, du plus sûr au plus incertain

| Étage | Quand | Précision attendue | Écrit sans confirmer ? |
| --- | --- | --- | --- |
| **1. Recherche → sélection → classement** | l'utilisateur cherche, vérifie la liste, classe tout | ce que l'utilisateur a vu | oui (c'est lui qui agit) ; la recherche devient une règle si demandé |
| **2. Mémoire des libellés** | libellé normalisé déjà ventilé, même signe | ~100 % (l'exception : même marchand, usage différent) | proposition pré-cochée, à confirmer d'un geste — ou automatique si Simon préfère (voir §5) |
| **3. Bayes naïf** | libellé nouveau, mots ou source en commun avec du connu | 80-90 % sur les cas où il parle ; se tait sinon | **jamais** |

Les règles existantes (regex) s'intercalent entre 1 et 2 : elles restent le seul automatisme
déterministe qui écrit à l'import.

### Étage 1 : la recherche devient une requête, la requête devient une règle

`parseQuery` lit la barre de recherche : `carrefour market -drive >20 <150 -` donne termes
obligatoires (ET), terme exclu, bornes sur |montant| en euros, signe (`+` crédits, `-` débits) ;
`"vir sepa recu"` garde l'expression. `queryMatches` applique la requête à une opération (libellé
normalisé + libellé + détails, sans accent ni casse) ; c'est **la même fonction** pour afficher la
liste et pour rejouer une règle, donc ce que Simon voit à l'écran est exactement ce que la règle
attrapera.

`classifySelection(ledger, ops, gabarit)` écrit la ventilation sur toute la sélection, remplace
les lignes existantes (marquées `deletedAt`) et passe les `pending` en `categorized`. Les
virements internes appariés sont laissés tranquilles.

Une **règle** deviendrait alors : `query` (structurée) + `lines` (gabarit de ventilation) au lieu
de `pattern` + une catégorie. Le regex reste possible comme terme avancé. Le gabarit permet
enfin les règles ventilées (« loyer perçu : 7/8 loyer, 1/8 charges »).

### Étage 2 : mémoire des libellés

`recallByLabel` cherche les opérations passées de même `normalizedLabel` et de même signe, prend
le gabarit majoritaire (la plus récente départage). C'est le cas le plus fréquent en pratique :
un relevé de particulier est fait de marchands récurrents dont le libellé normalisé (sans numéro
de carte ni date) est stable. Aucun réglage, aucune règle à écrire : classer une fois suffit.

### Étage 3 : Bayes naïf

Jetons d'une opération (`featuresOf`) : mots du libellé normalisé (hors mots vides bancaires :
CARTE, PRLV, SEPA…), bigrammes voisins, signe, **ordre de grandeur** du montant (puissance de
dix), compte, et `source:<catégorie Linxo>` — cette dernière est un jeton très fort et enfin
exploité. Classe = **gabarit de ventilation** (`templateKey`), ce qui apprend d'un coup catégorie,
enveloppe et parts.

Modèle de Bernoulli avec lissage de Laplace, seuls les jetons présents pèsent (un libellé court ne
dit rien par ses absences). `classify` rend les classes triées par probabilité a posteriori.
`suggestAllocation` ne propose que si probabilité ≥ 0,8, écart avec la deuxième ≥ 0,5 et classe
vue ≥ 2 fois ; sinon silence. Le modèle n'est **pas stocké** : `trainClassifier(ledger)` en
quelques millisecondes pour quelques milliers d'opérations, sur chaque appareil, donc rien à
synchroniser et aucune nouvelle table. Un choix d'utilisateur (confirmer une proposition) est
une ventilation ordinaire dans `allocations`, ce qui ré-entraîne le modèle au passage.

Constat du prototype : avec un montant en tranches fines (base 2), le montant **brouillait** plus
qu'il n'aidait sur peu d'exemples (23 € chez Carrefour ressemblait à la pharmacie). En puissance
de dix, il sépare salaire / courses / café sans casser le reste. Bayes est sensible à ce genre
de détail ; il faut un jeu de données réel pour régler jetons et seuils.

### Évaluation intégrée

`evaluate(ledger)` fait une validation « un contre tous » : chaque opération ventilée est prédite
sans elle-même. Sortie : retrouvées par la mémoire (justes / fausses), proposées par Bayes
(justes / fausses), silencieuses. Cela permet d'afficher dans l'application « sur vos 1 240
opérations, l'apprentissage en aurait retrouvé 1 050, proposé 90 dont 84 justes » et de régler les
seuils **sur les vraies données de Simon, sans les versionner**. Sur les données inventées des
tests, la mémoire retrouve 100 % des récurrents et Bayes classe correctement « CARREFOUR CITY »
à partir de « CARREFOUR MARKET / DRIVE » ; sur le petit exemple livré (4 opérations), il donne
0,57 à sa meilleure hypothèse et se tait, ce qui est le comportement voulu.

## 3. Alternatives écartées

| Approche | Verdict |
| --- | --- |
| **Plus proche voisin** (similarité de libellé, trigrammes ou Jaccard) | Très bon sur les libellés bancaires, mais la mémoire exacte en couvre déjà le gros ; à envisager comme étage 2 bis si les libellés varient (Linxo réécrit parfois). Peut coexister avec Bayes. |
| Régression logistique, petit réseau | Plus précis avec beaucoup de données ; ici quelques centaines d'exemples, pas de bibliothèque, gain non démontré. Bayes naïf est le meilleur rapport précision / code / explicabilité (on peut montrer « à cause des mots CARREFOUR et DRIVE »). |
| LLM (local ou distant) | Hors-ligne d'abord, données bancaires privées, coût : non. |
| Stocker le modèle et le synchroniser | Inutile (recalcul instantané) et contraire à « ce qui se recalcule ne se stocke pas ». |
| Apprendre les montants fixes dans les ventilations (« toujours 100 € de charges, le reste loyer ») | Le gabarit à parts proportionnelles est faux dès que le loyer change. Extension possible : ligne `fixed: Cents` détectée quand le montant absolu de la ligne est identique sur tous les exemples. Non fait dans le prototype. |

## 4. Impact sur le modèle et l'interface

Cœur : `learning.ts` (fait, prototype). Modèle : `Rule` gagne `query: Query` et `lines:
Template` (colonnes JSON) ; `pattern`, `categoryId`, `envelopeId` restent lus pour compatibilité
et migrent en `query.terms` / `lines`. Pas d'autre table.

Interface (à faire) :

- Opérations : la barre de recherche accepte la syntaxe ; un bouton « Classer les N affichées »
  ouvre la ventilation (catégorie, enveloppe, parts) avec une case « garder comme règle ».
- Liste « à trier » : chaque opération arrive **pré-remplie** par la mémoire ou Bayes, avec la
  source (« déjà vu 6 fois », « ressemble à… 87 % ») ; valider = un geste, changer = le choix
  normal. Un bouton « valider toutes les propositions de la mémoire » traite le lot.
- Import : le rapport ajoute « retrouvées » et « proposées » à côté de « classées par une règle ».
- Réglages ou Bilan : la sortie de `evaluate` et les trois seuils.

## 5. Questions pour Simon

1. La mémoire des libellés écrit-elle **directement** à l'import (comme une règle), ou reste-t-elle
   une proposition à confirmer ? Le prototype propose ; l'écriture directe irait dans l'esprit de
   D12 (pointage prudent) seulement si le libellé a été vu ≥ 2 fois avec la même ventilation.
2. Une règle créée depuis une recherche doit-elle **reclasser le passé** (tout ce que la recherche
   affiche) ou seulement les prochaines importations ? Le prototype fait les deux séparément.
3. Un export Linxo (jamais versionné) servira à mesurer avec `evaluate` et à régler les seuils
   avant de brancher l'interface.

## 6. Plan si l'étude est retenue

- **Lot D1 — recherche et classement en lot** : syntaxe dans la vue Opérations, bouton « classer
  les affichées », règles structurées avec gabarit, migration des règles regex. Environ une
  session.
- **Lot D2 — propositions** : mémoire puis Bayes dans la liste à trier, validation en lot,
  rapport d'import, écran d'évaluation. Environ une session, après mesure sur données réelles.
- **D2 bis, si besoin** : plus proche voisin sur libellés variables ; lignes à montant fixe.

## Décisions proposées (à copier dans `docs/decisions.md` si retenues)

**D18 · Classement par recherche et règles structurées.** Une règle est une requête (`Query`) et
un gabarit de ventilation (`Template`) ; la même fonction `queryMatches` sert à l'affichage et à
la règle. Une sélection affichée peut être classée d'un coup (`classifySelection`).

**D19 · Apprentissage sans stockage.** Les propositions viennent d'abord de la mémoire des
libellés (même libellé normalisé, même signe), puis d'un Bayes naïf sur les jetons de l'opération
et la catégorie de la source ; le modèle se reconstruit à chaque chargement et n'est jamais stocké
ni synchronisé. Bayes ne fait que proposer ; seuls les règles et (selon la réponse à la question 1)
la mémoire écrivent sans confirmation. Les seuils se règlent sur `evaluate`.
