# Porteur

Le porteur du projet. Ses paroles font foi (principe 7) ; il valide, et la fusion vaut validation
(principe 11, D82).

Il lit le compte rendu du codeur et la vérification de l'auditeur, et passe la PR en Ready. La CI y
joue le seuil 1 et les tests navigateur de niveau 2 ; le seuil 2 a été joué avant, par la livraison
et par l'auditeur, dont la vérification dit s'il avait un navigateur (D83). La version de dev
s'assemble depuis le dernier commit de la branche. Il fait ses vérifications manuelles sur la
version de dev — l'aperçu en recette, s'il le veut, par sa case —, puis fusionne au vert ; la fusion
ferme l'issue. Si la CI rougit ou si une vérification échoue, il le dit en commentaire, avec le
journal d'erreur ou son constat, repasse la PR en brouillon, et la boucle reprend.

Quand il le veut, `pnpm test 4 --navigateur` joue toute la chaîne, diagnostic compris. La
publication d'une version, par son tag, joue le seuil 3, tests navigateur compris, et ne publie que
s'il est vert (D83, D87).