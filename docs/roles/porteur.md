# Porteur

Le porteur du projet. Ses paroles font foi (principe 7) ; il valide, et la fusion vaut validation
(principe 11, D82).

Il lit le compte rendu du codeur et la vérification de l'auditeur, et passe la PR en Ready. La CI y
joue le seuil 1, puis le harnais du besoin et les tests navigateur de niveau 2, qui ne partent que si
le reste est vert ; le seuil 2 hors navigateur a été joué avant, par la livraison et par l'auditeur,
dont la vérification dit s'il a demandé les tests navigateur, et pourquoi (D83). Une branche qui ne
contient pas le dernier `main` y est dite à mettre à jour, et rien d'autre ne se joue. Chaque
ensemble de tests a son empreinte, l'état des chemins qu'il lit, et chaque fichier de test la
sienne, ce qu'il lit : son ensemble sans les autres fichiers de test, plus lui-même (D83). La CI
saute, seuil 1 compris, un fichier de test déjà trouvé vert sur son empreinte — par l'outillage de
la branche, qui l'atteste à chaque lancement des tests, d'un push et d'une session à l'autre —, ou
sur celle de son ensemble — par la CI sur une tête précédente verte au Ready, ou parce que la PR ne
change rien de ce que lit son ensemble —, et
dit, pour chaque ensemble, ce qu'elle saute et pourquoi ; après la
fusion, un ensemble vert au Ready sur la même empreinte, ou inchangé depuis le premier parent, ne
rejoue pas ses tests (D83, « Les empreintes »). La version de dev
s'assemble depuis le dernier commit de la branche. À la fermeture de la PR, fusionnée ou non, ses
branches `<tête>--attestation` (et `--codeur`, `--auditeur` s'il y en a) sont supprimées, chacune
nommée avec son dernier commit dans le résumé du workflow `branches.yml`. Il fait ses vérifications manuelles sur la
version de dev — l'aperçu en recette, s'il le veut, par sa case —, puis fusionne au vert ; la fusion
ferme l'issue. Si la CI rougit ou si une vérification échoue, il le dit en commentaire, avec le
journal d'erreur ou son constat, repasse la PR en brouillon, et la boucle reprend.

Quand il le veut, `pnpm test 4 --navigateur` joue toute la chaîne, diagnostic compris. La
publication d'une version, par son tag, joue le seuil 3, tests navigateur compris, et ne publie que
s'il est vert (D83, D87).

Lui seul publie une version (D83) : il pousse le tag d'une version numérotée, ou déclenche à la main
une version forcée du dernier commit de `main` (Actions → « Version forcée » → Run workflow, sans
autre saisie). Son nom : le dernier numéro de version publié, un tiret, puis le hash court du commit
— `v0.2-1a2b3c4` après `v0.2`, `v0.0-…` tant qu'aucune version numérotée n'est publiée. Elle ne pose
son tag qu'après le seuil 3 vert, et ne se publie pas sur un commit qui porte déjà une version.