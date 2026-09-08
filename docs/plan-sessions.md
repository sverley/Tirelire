# Plan des sessions suivantes

Écrit le 7 septembre 2026, après l'alignement du code sur D19–D34 et l'audit qui a suivi. Ce
document dit quoi faire dans quel ordre, et à quoi on reconnaît que c'est fait. Un lot par
session, ou moins si la session est courte : mieux vaut un lot fini qu'un lot commencé.

## Ce que l'audit a montré

Le modèle et le moteur sont au niveau des décisions ; l'interface ne l'est pas. Concrètement :
le moteur de règles ne tourne qu'à l'import, il n'existe aucun écran pour créer ou ordonner une
règle, le filtre de l'écran Opérations n'a rien à voir avec la sélection d'une règle, le bloc
d'action est caché derrière deux clics, et le seuil de placement de D20 n'est réglable nulle part.
Rien de tout cela n'est couvert par un test d'interface, ce qui est précisément ce qui a laissé
passer l'écart.

Les lots ci-dessous corrigent cela dans l'ordre de ce qui débloque le reste.

---

## Lot 6 · Filtrer, agir, régler — écran Opérations (D36, D26, D27) — **fait le 7 septembre**

Livré : la recherche porte les champs d'une sélection d'automatisme (libellé littéral ou expression
régulière, compte, fourchette de montants, dates), le bloc d'actions est visible sans rien cocher
et s'applique aux lignes cochées ou à tout le résultat, l'aperçu est permanent, et *Enregistrer
l'automatisme* reprend la recherche telle quelle. Le placement voulu d'une enveloppe est devenu une
répartition (D38) et « règle » s'appelle « automatisme » (D39).

Reste de ce lot, à faire : la ventilation à parts dans le bloc d'actions (aujourd'hui catégorie,
enveloppe, ponctuelle et état seulement).

## Lot 6 bis · Ancien contenu du lot 6, pour mémoire

Le cœur du problème. Un seul écran doit permettre de chercher, d'agir en masse, et de transformer
la recherche en règle sans rien ressaisir.

- Panneau de filtre repliable portant **exactement** les champs de `RuleSelection` : motif de
  libellé (champ texte, avec une case « expression régulière » et sinon une recherche littérale
  échappée), compte, montant minimum et maximum, date de début et de fin.
- À côté, séparés visuellement, les critères de consultation qui ne partent jamais dans une
  règle : état, période courante, tri.
- Compteur permanent : « N opérations correspondent », mis à jour à la frappe.
- Bloc d'action **toujours visible**, portant les champs de `RuleAction` : catégorie, enveloppe,
  ventilation à parts (au moins une ligne fixe plus le reste), ponctuelle, état — chaque champ
  pouvant rester à « ne pas toucher ».
- Aperçu avant/après affiché en continu, pas dans une boîte de dialogue (`previewRules`,
  `applyBulkAction` en mode lecture).
- Trois boutons : *Appliquer aux lignes cochées*, *Appliquer aux N résultats*, *En faire une règle*
  — ce dernier reprenant le filtre tel quel.
- Le bouton *Deviner un filtre* reste pour le chemin inverse : à partir des lignes cochées,
  `inferSelection` remplit le panneau de filtre, que l'on corrige avant d'enregistrer.

**Fait quand** : depuis une base importée, on peut taper « CASINO », voir le nombre d'opérations
concernées, choisir catégorie et enveloppe, lire l'aperçu, appliquer aux résultats, puis créer
l'automatisme correspondant sans ressaisir le filtre.

---

## Lot 7 · Écran Règles (D23, D24, D31)

Aujourd'hui les règles se voient en bas du Bilan, en lecture seule.

- Écran dédié, accessible depuis Configuration : liste ordonnée par rang décroissant, avec ce que
  chaque règle sélectionne et ce qu'elle pose, en clair.
- Réordonnancement par *monter / descendre*, appuyé sur `rankBetween` — jamais un index.
- Création et modification complètes : nom, sélection, action, période de validité.
- Règles issues d'un flux (D24) signalées comme telles, non modifiables sauf leur rang, avec un
  renvoi vers le flux ; les règles archivées repliées dans une section à part.
- Par règle : nombre d'opérations touchées et aperçu de quelques-unes.
- **Bouton « Rejouer les règles »**, et rejeu automatique après toute création ou modification de
  règle. C'est le manque le plus grave relevé par l'audit : le moteur existe et ne tourne pas.

**Fait quand** : créer une règle depuis cet écran change immédiatement des opérations, et remonter
une règle d'un cran change le résultat quand deux règles se disputent une opération.

---

## Lot 8 · Rendre visibles les décisions déjà prises

- Réglages : seuil de virement (`transferThreshold`, D20) et coussin du pivot, avec une phrase
  disant à quoi chacun sert.
- Plan : distinguer nettement « à faire » et « à surveiller », montrer le libellé attendu du
  virement permanent et l'état du flux enregistré.
- Enveloppes : rendre les besoins multiples évidents (ajouter un second besoin doit être un geste
  offert, pas découvert), priorité modifiable, et afficher la répartition réelle par compte même
  quand elle est conforme au placement voulu.
- Opérations : montrer les parts d'une ventilation dans la liste, pas seulement dans l'éditeur.
- **Jeu d'exemple étoffé** : une enveloppe portant deux besoins, une enveloppe au placement
  réparti sur deux comptes (D38), deux ou trois automatismes dont un issu d'un flux, une opération
  ventilée en parts, un compte tiers avec un solde à régler. Les chiffres sont à choisir avec soin :
  plusieurs tests encodent cet exemple, et chacun doit rester justifié par une décision. Sans
  cela, l'application paraît identique à l'ancienne quand on la découvre.

**Fait quand** : charger l'exemple suffit à voir, sans rien créer, ce que D19 à D28 ont changé.

---

## Lot 9 · Tests d'interface Playwright dans la CI

À faire avant d'ajouter des fonctionnalités neuves : c'est l'absence de ces tests qui a permis à
l'écart de passer inaperçu jusqu'à l'installation sur le téléphone.

- Scénarios : import d'un CSV inventé ; filtre → action groupée → règle → rejeu ; création d'une
  enveloppe à deux besoins et lecture du plan ; ouverture d'un dépôt écrit sous un modèle ancien
  (migration) ; export puis réimport du fichier.
- Intégrés au workflow, sur navigateur sans affichage, avec capture d'écran en cas d'échec.

**Fait quand** : casser volontairement une vue fait échouer la CI.

---

## Lot 10 · Onboarding guidé — **fait le 8 septembre (D40)**

Livré : l'assistant construit un budget à partir de questions simples (revenus et jour de paie,
charges fixes, budgets courants, dépenses non mensuelles, épargne), en déduit enveloppes, besoins et
flux, et n'impose aucun compte — le compte principal est créé en silence, les autres sont proposés en
fin de parcours avec le placement des réserves. La branche `feature/assistant-configuration` est
abandonnée (elle créait des enveloppes typées) ; l'assistant a été refait sur le modèle actuel.

Reste à faire sur ce chantier : partir d'un **premier import** plutôt que d'une page blanche —
proposer charges fixes et budgets à partir des opérations récurrentes détectées, en s'appuyant sur
l'inférence de sélection (D26).

---

## Lot 11 · Dette et branches

- Décider avec Simon du sort de `feature/connecteur-banque` (Enable Banking) et des deux branches
  `etude/`. La première porte un « D18 » en collision avec celui de `main` : renuméroter à partir
  de D39. (`feature/serveur-web` a été fusionnée le 7 septembre, renumérotée D35.)
- Compactage du journal de changements une fois tous les pairs à jour.
- Import du second compte (les enfants) comme compte d'accueil ou tiers.
- Profil d'import Linxo, dès que Simon fournit un export (à ne jamais versionner).

---

## Règle de conduite pour ces sessions

Une décision qui ne se voit pas dans l'interface n'est pas livrée. À la fin de chaque lot, décrire
en une phrase le geste que Simon peut faire et qu'il ne pouvait pas faire avant ; s'il n'y en a
pas, le lot n'est pas fini.
