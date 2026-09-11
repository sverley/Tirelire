# Contraintes du projet

Ce que les plateformes imposent à Tirelire parce qu'elle est à la fois multiplateforme (I9), locale
(I7), synchronisée de pair à pair (I8) et simple pour tout le monde (I4). Ce ne sont pas des
invariants, puisque le produit ne les choisit pas, ni des décisions, puisqu'elles ne tranchent
rien : ce sont des faits, que toute décision et tout choix technique respectent. Les choix qui en
découlent, cibles de distribution comprises, se discutent dans des issues.

Les navigateurs et les systèmes évoluent : ce document décrit l'état connu au 11 septembre 2026.
Une contrainte se revérifie avant de fonder une décision, et se corrige ici, datée, quand elle
change.

## C1 · Aucun geste technique pour l'utilisateur

Installer, mettre à jour, sauvegarder et synchroniser ne demandent ni ligne de commande, ni serveur
à lancer, ni réglage réseau, ni adresse technique à saisir. Une voie qui l'exige peut exister pour
un usage avancé, jamais comme seule voie. Exemple écarté : servir un dossier en local pour ouvrir
l'application sur un ordinateur.

*Découle de I4.*

## C2 · L'essentiel ne dépend d'aucune capacité propre à une plateforme

Les capacités varient d'un navigateur et d'un système à l'autre : lecture d'un QR code par la page
(surtout Chrome Android), installation d'une application web (proposée par Chrome et Edge, cachée
dans le menu Partager sur iPhone et iPad, absente de certains navigateurs), Wi‑Fi Direct et
Bluetooth (hors de portée d'une application web). Un usage ou la synchronisation peut profiter
d'une capacité propre à une plateforme, mais garde partout une voie équivalente : c'est la raison
du processus sans appareil photo d'I8.

*Découle de I3, I8, I9.*

## C3 · Une application web se sert depuis une adresse sûre

Service worker (hors ligne, installation), chiffrement du navigateur et caméra exigent HTTPS, ou
`localhost`. Une page ouverte directement depuis un fichier n'a pas de service worker, et Chrome
comme Edge y refusent les modules JavaScript et le WebAssembly chargés à part : une version à
ouvrir d'un double-clic devrait tout embarquer dans la page. Une page en HTTPS ne peut pas appeler
un service en HTTP : un relais se sert en HTTPS.

*Découle de I7, I8, I9.*

## C4 · Les données d'un navigateur tiennent à son adresse, et peuvent s'effacer

Un navigateur range les données par adresse (protocole, domaine, port) : la même application
ouverte à une autre adresse part vide. Ces données disparaissent si l'utilisateur vide son
navigateur ou désinstalle l'application, si le navigateur manque de place et que l'application
n'a pas demandé à les rendre persistantes, et, sur Safari, après sept jours d'utilisation sans
visite tant que l'application n'est pas ajoutée à l'écran d'accueil.

*Découle de I7, I9.*

## C5 · Sans serveur, aucune sauvegarde n'est implicite

Rien ne garde de copie des données hors des appareils. Perdre un appareil, vider le navigateur ou
désinstaller l'application efface tout ce qui n'a été ni synchronisé avec un autre appareil ni
exporté. La sauvegarde doit donc être évidente, sans supposer que l'utilisateur y pense.

*Découle de I4, I7.*

## C6 · Une application web ne compte pas sur l'arrière-plan

Une application web ne peut pas compter sur un travail en arrière-plan : elle synchronise pendant
qu'elle est ouverte. Deux instances ne se synchronisent en direct que si elles sont ouvertes en
même temps ; c'est ce qui rend utile le relais temporaire d'I8.

*Découle de I8, I9.*

## C7 · Hors magasin, les systèmes alertent ou bloquent

Installer une application native hors d'un magasin demande un geste que C1 exclut pour le grand
public : autoriser les sources inconnues sur Android, comme pour l'APK de test aujourd'hui ; passer
outre un avertissement de sécurité sur Windows ou macOS pour un logiciel non signé. iOS n'installe
pratiquement que depuis l'App Store, des magasins alternatifs n'existant que dans l'Union
européenne. Distribuer simplement une application native passe par un magasin (compte développeur
payant, revue) ou par une signature payante ; une application web installée depuis une instance
n'a aucune de ces barrières.

*Découle de I4, I9.*

## C8 · Les instances ne sont pas toutes à la même version

Une application web se met à jour à sa prochaine ouverture, une application de magasin après
revue et au rythme de chaque appareil, un fichier téléchargé jamais tout seul. Des instances
synchronisées tournent donc avec des versions différentes : ce qu'elles échangent doit tolérer cet
écart, ou le signaler clairement sans rien perdre.

*Découle de I4, I8, I9.*

## C9 · Une seule interface, du téléphone à l'ordinateur

La même application se lit sur un téléphone de 375 px de large, au doigt, et sur un ordinateur, à
la souris et au clavier. Cibles tactiles, formulaires visibles sans chercher, catégorisation en
peu de gestes se conçoivent d'abord pour le plus petit écran.

*Découle de I4, I5, I6, I9.*
