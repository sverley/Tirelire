# Porteur

Le porteur du projet. Ses paroles font foi (principe 7) ; il valide, et la fusion vaut validation
(principe 11, D82).

Il lit le compte rendu du codeur et la vérification de l'auditeur, et passe la PR en Ready. La CI y
joue le seuil 1, toujours en entier, puis le harnais du besoin et les tests navigateur de niveau 2,
qui ne partent que si le reste est vert ; le seuil 2 hors navigateur a été joué avant, par la
livraison et par l'auditeur, dont la vérification dit s'il a demandé les tests navigateur (D83). Une
branche qui ne contient pas le dernier `main` y est dite à mettre à jour, et rien d'autre ne se
joue. Au-delà du seuil 1, la CI saute ce qui est vert sur son empreinte — par l'attestation de la
branche, par une tête de la branche verte à un Ready précédent, ou parce que `main` a la même — et
dit, pour chaque ensemble, ce qu'elle a joué ou sauté, et pourquoi ; après la fusion, un ensemble
vert au Ready sur la même empreinte ne rejoue pas ses tests. À la fermeture de la PR, ses branches
`<tête>--attestation` (et `--codeur`, `--auditeur` s'il y en a) sont supprimées, chacune nommée avec
son dernier commit dans le résumé du workflow `branches.yml`. La version de dev
s'assemble depuis le dernier commit de la branche. Il fait ses vérifications manuelles sur la
version de dev — l'aperçu en recette, s'il le veut, par sa case —, puis fusionne au vert ; la fusion
ferme l'issue. Si la CI rougit ou si une vérification échoue, il le dit en commentaire, avec le
journal d'erreur ou son constat, repasse la PR en brouillon, et la boucle reprend.

Quand il le veut, `pnpm test 4 --navigateur` joue toute la chaîne, diagnostic compris. La
publication d'une version, par son tag, joue le seuil 3, tests navigateur compris, et ne publie que
s'il est vert (D83, D87).