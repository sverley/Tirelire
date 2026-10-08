# Tirelire — pour les sessions d'assistant

Ce fichier n'est pas source de vérité : il renvoie aux documents fondateurs et ne les contredit
jamais (D77). Travail en français.

- Les documents fondateurs (D77) : `docs/description-projet.md` — ses principes et ses usages —, le
  glossaire et les catalogues : `docs/invariants.md`, `docs/contraintes.md`, `docs/cibles.md`,
  `docs/decisions.md`, `docs/methodes.md`, `docs/gardes.md` ; les documents des domaines,
  `docs/domaines/` ; le catalogue des versions, `docs/versions.md`. Ce que chaque session en lit
  d'abord est dans son rôle : l'architecte les lit tous ; le codeur et l'auditeur, l'issue, le
  glossaire et ce que l'issue cite.
- La méthode est dans `docs/methodes.md`.
- Chaque session tient un seul rôle, donné dans le premier message avec son objet, et décrit dans
  `docs/roles/` : `architecte.md`, `auditeur.md`, `codeur.md`, `porteur.md`. Commence par ce
  fichier, puis par ce que ton rôle te fait lire.
- Les sessions sont autorisées, et même tenues, à accéder au dépôt et à le modifier pour les
  besoins de leur tâche — issue, branche, commits, PR, commentaires, passage en Ready pour
  l'architecte —, sans en demander l'autorisation au porteur (#403).
- Sois précis et vérifie tes paroles, pour ne pas entrer dans une spirale de complications née des
  approximations : cite les documents au lieu de les résumer, nomme chaque chose par ce qu'elle fait
  et non par l'endroit où elle est rangée, et relis chaque affirmation contre sa source avant de
  l'écrire.

## Pratique

La façon de travailler dans l'environnement des sessions (porteur, #403). L'architecte la recopie
telle quelle dans la consigne des agents qu'il lance (`docs/roles/architecte.md`, étape 7).

- Réduis le nombre d'appels d'outils : combine-les quand c'est possible.
- Lis par extraits — documents, code, diffs, fils de l'issue et de la PR — et, d'un tour à l'autre,
  seulement ce qui a changé. Écris les sorties longues (installation, tests, crochets) dans un
  fichier, et n'en lis que le verdict et ce qui échoue.
- Réponses claires et courtes ; une question à la fois.
- Utilise un git worktree par branche, pour ne pas mêler les sessions ; un worktree déjà présent
  pour la branche se reprend et se met à jour.
- Dans un clone ou un worktree neuf, avant le premier commit : `pnpm install`, puis `pnpm crochets`.
- Toute PR s'ouvre en brouillon avec le corps de `.github/pull_request_template.md` (« Close #n »
  et la case de l'aperçu).
- Accès au dépôt : vérifie d'abord celui que la session a déjà, par
  `gh api repos/sverley/Tirelire` ; ne rattache sverley/Tirelire via l'intégration GitHub que si
  cet appel échoue, une seule fois, avec l'accès en écriture (« push »), puis clone-le. N'utilise
  jamais de jeton collé.
- `gh api` (REST) fonctionne ; GraphQL ne fonctionne pas (ni `gh issue view`, ni `gh pr view`, ni
  `gh api graphql`). Pour un commentaire : `-F body=@fichier`. Pour passer une PR en Ready :
  `gh api -X POST repos/sverley/Tirelire/pulls/<n>/ccr/ready_for_review` ; pour la remettre en
  brouillon : `…/pulls/<n>/ccr/convert_to_draft`. `PATCH …/pulls/<n>` avec `draft=false` est
  ignoré sans erreur.
- Écris chaque fichier (corps d'issue, commentaire) dans une commande à part, avant celle qui
  l'envoie ; une écriture sur GitHub par commande.
- Tests navigateur (crochets au push, `pnpm livraison`) : le navigateur est
  `TIRELIRE_NAV=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` ; `/usr/bin/chromium-browser`
  ne se lance pas ici. Si ce chemin ne répond plus, cherche le Chromium présent sous
  `/opt/pw-browsers/`.
- Si tu lances un agent (codeur, auditeur), rapporte dans ton commentaire de tour, sur la PR, le
  nombre de tokens que l'outil rend à sa fin.
- Ne cite pas Claude dans les commits ni dans aucun texte que tu consignes ou déposes sur internet
  ou sur GitHub. Ne fais pas mention de ce que l'outil ajoute tout seul.
- Travaille seulement dans le conteneur cloud de la session : n'utilise ni les fichiers, ni le
  navigateur, ni l'écran de l'ordinateur du porteur, même si Claude Desktop est ouvert.
