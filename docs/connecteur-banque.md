# Connecteur bancaire : mode d'emploi

Lit les opérations d'un compte via Enable Banking (DSP2) et les écrit dans un CSV que l'écran
d'import de Tirelire reconnaît sans réglage. Contexte et choix : `docs/synchronisation-bancaire.md`,
décision D18. Tout ce qui est décrit ici se passe sur un serveur ou un ordinateur de Simon, jamais
dans l'application ni dans le dépôt.

## 1. Côté Enable Banking (une fois)

1. Créer un compte sur https://enablebanking.com, puis dans le panneau de contrôle une
   **application** en environnement **production**. À la création, télécharger la clé privée
   (`.pem`) : elle n'est fournie qu'une fois. Noter l'identifiant d'application.
2. Déclarer au moins une **URL de retour** (`redirect_url`). Pour l'essai, n'importe quelle page
   que l'on sait reconnaître suffit (par exemple `https://tirelire.invalid/retour`) : le
   navigateur y sera renvoyé avec `?code=…` et la commande demande de coller cette adresse.
3. Activer l'application en mode restreint : « Activate by linking accounts », en liant
   **tous** les comptes que l'on veut lire (un compte non lié est invisible même après
   consentement).

## 2. Côté serveur

Prérequis : Node 22.18 ou plus (types TypeScript retirés à la volée) et pnpm.

```
export TIRELIRE_EB_APP_ID=… 
export TIRELIRE_EB_CLE=/chemin/prive/app.pem
pnpm --filter @tirelire/banque cli banques        # liste des banques françaises et durée max de consentement
pnpm --filter @tirelire/banque cli connecter      # Société Générale par défaut ; --banque "Boursorama" sinon
pnpm --filter @tirelire/banque cli operations --tout
```

`connecter` affiche une adresse à ouvrir dans un navigateur (pas une WebView) ; on
s'authentifie chez la banque, on valide dans son application, puis on colle l'adresse de
retour. La session est enregistrée dans `~/.tirelire-banque/session.json` (dossier modifiable
par `TIRELIRE_BANQUE_DIR`, avec un `config.json` optionnel `{ "appId", "cle", "redirectUrl" }`).

`operations` écrit `~/.tirelire-banque/operations-AAAAMMJJ.csv` (ou `--sortie`, ou `--json` pour
des `ParsedRow` bruts). Par défaut : 90 derniers jours, opérations comptabilisées seulement ;
`--tout` demande l'historique le plus long (à lancer dans l'heure qui suit `connecter`, après
quoi la plupart des banques ne servent plus que 90 jours) ; `--attente` inclut les opérations
en attente ; `--compte IBAN` limite à un compte.

Le CSV s'importe ensuite dans Tirelire comme un export de banque (colonne « Compte » = IBAN,
à faire correspondre au compte Tirelire dans le profil d'import).

## 3. Limites à connaître

- Consentement à renouveler avant `valid_until` (180 jours en général) : `comptes` l'affiche ;
  passé ce délai ou en cas d'`EXPIRED_SESSION`, relancer `connecter`.
- Sans en-têtes PSU (cas de la ligne de commande), la banque tolère environ 4 récupérations par
  jour ; au-delà, erreur 429, réessayer quelques heures plus tard.
- Société Générale : validation par notification dans L'Appli SG, sans retour automatique vers
  le navigateur ; revenir soi-même sur l'onglet pour récupérer l'adresse de retour.
- Le mode restreint n'est pas contractuel ; l'import CSV manuel reste le repli.

## 4. Suite prévue

Point d'entrée dans `apps/relay` pour que la PWA demande « les opérations depuis telle date » et
les importe avec l'aperçu habituel ; rappel de renouvellement du consentement ; puis BoursoBank.
