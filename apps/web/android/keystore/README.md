# Clés de signature

`tirelire-test.jks` est une **clé de test** (mot de passe `tirelire-test`, alias `tirelire`),
volontairement versionnée pour que toutes les versions de test construites par l'intégration
continue aient la même signature : on peut alors mettre à jour l'application sur le téléphone
sans la désinstaller.

Elle ne doit **jamais** servir à une publication sur un store. Pour une vraie version,
définir dans les secrets GitHub du dépôt :

- `ANDROID_KEYSTORE_BASE64` : le fichier `.jks` encodé en base64 (`base64 -w0 ma-cle.jks`)
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`

Le workflow les utilise automatiquement quand ils existent.
