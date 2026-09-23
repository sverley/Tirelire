# Porteur

Le porteur du projet. Ses paroles font foi (principe 7) ; il valide, et la fusion vaut validation
(principe 11, D82).

Il lit le compte rendu du codeur et la vérification de l'auditeur, et passe la PR en Ready. Toute la
CI tourne, et la version de dev s'assemble depuis le dernier commit de la branche. Il fait ses
vérifications manuelles sur la version de dev — l'aperçu en recette, s'il le veut, par sa case —,
puis fusionne au vert ; la fusion ferme l'issue. Si la CI rougit ou si une vérification échoue, il le
dit en commentaire, avec le journal d'erreur ou son constat, repasse la PR en brouillon, et la boucle
reprend.
