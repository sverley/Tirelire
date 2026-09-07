# Synchronisation automatique avec la banque (étude, 7 septembre 2026)

Question : Tirelire peut-il récupérer les opérations tout seul, comme Linxo ou Bankin', plutôt
que par export CSV ? Réponse courte : **oui, gratuitement pour nos propres comptes, via un
agrégateur DSP2 en mode « production restreinte »**, à condition d'accepter un petit service
qui détient une clé d'accès. L'import CSV reste le socle ; le connecteur est une couche au-dessus.

## 1. Le cadre : DSP2

Depuis 2019, toute banque européenne expose une API « information de compte » (AIS). Elle n'est
accessible qu'aux prestataires agréés (ACPR en France, avec certificats eIDAS), ou à ceux qui
passent par un agrégateur agréé. Tirelire ne sera jamais agréée : on passe par un agrégateur,
c'est lui qui porte l'agrément. Linxo et Bankin' sont eux-mêmes des agrégateurs (Linxo Connect,
Bridge), doublés de scraping pour les banques mal couvertes.

## 2. Les options

| Option | Coût | Verdict |
| --- | --- | --- |
| **Enable Banking, production restreinte** | 0 € | **Retenue pour l'essai.** Compte développeur sans contrat ni KYB ; l'application n'accède qu'aux comptes que l'on a soi-même liés (liste blanche). Couvre les grandes banques françaises (BNP, Crédit Agricole, Société Générale, Boursorama…). |
| Powens (ex-Budget Insight), Bridge (ex-Bankin'), Linxo Connect, Tink | contrat, tarif au volume, minimum mensuel | Outils pour entreprises ; hors de proportion pour une famille. |
| GoCardless Bank Account Data (ex-Nordigen) | était gratuit | **Fermé aux nouvelles inscriptions** depuis 2026, en cours d'extinction. |
| Scraping maison (woob) | 0 € | À écarter : casse à chaque refonte du site, l'authentification forte le rend quasi impossible, et la banque l'interdit. |
| Notifications banque (SMS, mail) | 0 € | Trop pauvres (pas de libellé complet, pas de solde). |
| Export CSV manuel (existant) | 0 € | Reste le socle et le repli si l'agrégateur change sa politique, comme Nordigen l'a fait. |

## 3. Ce que donne Enable Banking, concrètement

- **Authentification de l'application** : JWT signé RS256 avec la clé privée de l'application
  (durée max 24 h, un nouveau jeton par requête si l'on veut). Cette clé donne accès à tous les
  comptes liés : elle ne doit pas être dans la PWA (un fichier JavaScript est extractible).
- **Consentement** : `POST /auth` renvoie une URL ; l'utilisateur s'authentifie chez sa banque
  (redirection vers l'appli de la banque sur mobile, pas de WebView), revient sur une URL de
  retour avec un `code`, que l'on échange contre une **session**. Validité maximale fixée par la
  banque, **180 jours** pour la plupart : il faut refaire le parcours deux fois par an, et
  l'application doit prévenir avant l'échéance.
- **Comptes** : chaque compte porte un `identification_hash` stable d'une session à l'autre
  (l'IBAN aussi), ce qui donne la correspondance compte banque → compte Tirelire.
- **Opérations** : `GET /accounts/{id}/transactions` avec pagination par `continuation_key`.
  Champs : date de comptabilisation, date de valeur, montant signé, libellé(s), statut `BOOK`
  (comptabilisée) ou `PDNG` (en attente), et surtout `entry_reference`, identifiant **stable par
  compte** pour les opérations comptabilisées. Première récupération : historique long possible
  (stratégie `longest`) dans l'heure qui suit le consentement ; ensuite la plupart des banques
  limitent à **90 jours**.
- **Rythme** : en arrière-plan (sans en-têtes PSU), les banques tolèrent en général **4 appels
  par jour** ; un rafraîchissement déclenché par l'utilisateur n'est pas compté.
- **Réserve** : le mode restreint n'est pas contractuel ; Enable Banking peut le fermer. D'où
  l'import CSV conservé.

## 4. Ce que ça change dans Tirelire

Presque rien dans le cœur : `prepareImport(ledger, rows: ParsedRow[], profile)` est déjà
indépendant de la source. Un connecteur produit des `ParsedRow` ; la clé `op_` (D09), la
déduplication et les doublons probables, le pointage prudent (D12) et la reconnaissance des
virements « TIRELIRE … » (D11) s'appliquent tels quels.

Trois ajustements à prévoir :

1. **`externalRef` sur `ParsedRow` et `Operation`** : l'`entry_reference` de la banque. Quand il
   est présent, la déduplication devient exacte (plus besoin du détecteur ±3 jours entre deux
   synchronisations). Le détecteur reste utile entre connecteur et anciens CSV.
2. **Opérations `PDNG`** : ne pas les importer (leur libellé et leur date changent à la
   comptabilisation), ou les montrer à part comme « en attente à la banque » sans clé ni effet
   sur les enveloppes. Choix à faire ; le plus simple est de les ignorer.
3. **Un nouveau `source: 'connector'`** dans `ImportProfile`, avec la date de bascule pour ne
   pas re-dédoublonner tout l'historique CSV.

## 5. Où tourne le connecteur

La clé privée et la session doivent vivre sur un serveur. On en a déjà un : `apps/relay`
(branche `feature/sync-p2p`), serveur privé de Simon. Deux architectures :

- **A. Le relais interroge la PWA** : la PWA demande au relais « donne-moi les opérations depuis
  telle date » ; le relais appelle Enable Banking et renvoie des `ParsedRow` ; la PWA fait
  l'import comme avec un CSV, en montrant l'aperçu. Simple, l'utilisateur garde la main, pas de
  chiffrement supplémentaire (le relais ne voit que ce qu'il vient de recevoir de la banque).
- **B. Le connecteur est un pair de synchronisation** : le relais tourne un cron (≤ 4 fois par
  jour), importe lui-même et émet des `changes` (D08, D16) comme un appareil « banque ». Plus
  automatique, mais le relais doit détenir la clé de chiffrement du grand livre et rejouer la
  logique d'import côté serveur ; contraire à l'esprit « relais aveugle » de la branche p2p.

Recommandation : **A d'abord**, avec un bouton « Rafraîchir depuis la banque » et, plus tard,
un rafraîchissement automatique à l'ouverture de l'application. B seulement si l'on veut des
opérations importées sans ouvrir Tirelire.

La PWA seule (clé stockée dans IndexedDB, appels directs) éviterait tout serveur, mais l'API est
prévue serveur à serveur (CORS non garanti) et la clé serait lisible sur chaque appareil. À
n'envisager que si le relais s'avère trop lourd à héberger.

## 6. Plan d'essai (une demi-journée, puis décision D18)

1. Simon crée un compte sur enablebanking.com, une application **production**, génère la paire
   de clés, et **lie ses comptes** (liste blanche) ; vérifier que sa banque est dans la liste
   des ASPSP français et qu'elle donne ≥ 90 jours d'historique.
2. Script Node de preuve dans `apps/relay/connecteur/` : JWT, `POST /auth`, page de retour,
   `POST /sessions`, `GET /accounts`, `GET /transactions` → fichier JSON de `ParsedRow`.
   Aucune donnée réelle versionnée (`*.json` du connecteur ignorés).
3. Comparer 90 jours de connecteur avec l'export banque ou Linxo de la même période : clés
   `op_` identiques ? libellés identiques ? (si les libellés diffèrent, la clé diffère, et il
   faut choisir la source de vérité pour la période de recouvrement).
4. Si concluant : entrée D18 dans `decisions.md`, puis lot « connecteur » : `externalRef`,
   `source: 'connector'`, point d'entrée dans le relais, écran de rafraîchissement avec aperçu,
   rappel de renouvellement du consentement.

## 7. Questions ouvertes pour Simon

- Quelle est la banque du pivot (et celle des comptes des enfants) ? Tout dépend de sa couverture.
- Accepte-t-il qu'un serveur à lui détienne une clé qui lit ses relevés ? Sinon, on reste au CSV.
- Suffit-il d'un rafraîchissement à l'ouverture de l'application, ou faut-il du vrai
  arrière-plan (architecture B) ?
