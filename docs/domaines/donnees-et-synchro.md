# Domaine · Données et synchro

Le stockage local, les migrations, le fichier d'état, la sauvegarde, la synchronisation et son
relais. Le premier incrément du socle, `v0 · Données sûres` (`docs/versions.md`), en porte
l'essentiel.

## Intention

Les principes 5, 5.1 et 5.2 de la description : les données restent chez l'utilisateur, en local ;
elles se synchronisent entre sessions, plateformes et personnes qui partagent les clés ; un relais
ne garde que des paquets chiffrés, temporairement. Le protocole vit dans `docs/synchronisation.md`,
l'organisation du code dans `docs/architecture.md`.

## Analyse

La synchronisation n'est exigée par aucune version d'usage définie ; elle se conçoit dans le socle
et se code dans la première version qui l'exerce (D87). Ce que le fichier doit garantir dès qu'il
porte de vraies données, pour qu'elle vienne sans migration cassante, est dans D58.

**Contraintes.** I7 : rien ne sort sans relais, et seulement chiffré avec lui. I8 : les instances qui
partagent les clés convergent sans perte, en direct comme par un relais. C2 : aucune voie ne dépend
d'une capacité propre à une plateforme — lire un QR code se fait surtout sur Chrome Android, le
copier-coller vaut partout. C3 : le relais se sert en HTTPS. C5 : un fichier exporté est aussi une
sauvegarde, et se rouvre sur un autre appareil. C6 : rien ne compte sur l'arrière-plan ; deux
instances ne s'échangent en direct qu'ouvertes ensemble. C8 : des instances de versions différentes
se rencontrent.

**Hypothèses.** L'usage projeté par le porteur, le 9 septembre 2026 :

> Il faut chercher la bonne solution en comparant et en se projetant sur un usage de 2 modification du plan par ans, un import par mois des opérations avec les classifications et un calcul des écarts et virements à réaliser (sans écriture je pense). Et une synchronisation ou 2 par mois entre 2 ou 3 appareils

Un foyer partage les clés ; ses appareils sont égaux, sans droits.

**Cibles.** Les webapps sur Chromium, Android et ordinateur, et le relais PHP livré avec le site.
Le relais Node et les autres cibles viendront sans changer le fichier.

**Usages.** Aucun n'exige la synchronisation ; tous la portent, par les mêmes lignes et les mêmes
règles. U5 importe le même relevé sur deux appareils ; U1 et U2 construisent le budget sur l'un et le
lisent sur l'autre ; U3 et U4 lient des opérations et des flux venus d'un autre appareil ; tous
restaurent une sauvegarde, parfois sur un appareil neuf.
