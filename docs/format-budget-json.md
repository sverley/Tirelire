# Format du budget JSON

Aucune donnée réelle ici : seulement la forme du fichier, et l'exemple inventé de l'application (D84).

Le budget JSON est un **format d'échange** du budget, sans ses opérations : comptes, tirelires et
leurs besoins, flux prévus — ordres permanents enregistrés compris —, catégories et réglages du
budget. Ce n'est pas un second stockage : le fichier SQLite reste la vérité (D08, D58), et le budget
JSON entre par l'assistant (#366, #367). Il ne porte ni opération, ni sous-opération, ni réponse à un
manque, ni automatisme, ni profil d'import, ni ce qui décrit une instance (`siteId`, les appareils).
Le format est libre de changer jusqu'à `v1`, comme celui du fichier (D30, D91) : une version que
l'application ne lit pas est refusée en le disant.

## Forme générale

Un objet JSON, encodé en UTF-8 :

| Clé | Obligatoire | Forme |
| --- | --- | --- |
| `format` | oui | `"tirelire-budget"` |
| `version` | oui | `1`, la seule version lue aujourd'hui |
| `accounts`, `tirelires`, `needs`, `categories`, `planned_flows` | non | une liste de lignes ; absente, la table n'apporte rien |
| `settings` | non | un objet, une clé par réglage ; un réglage absent ne change pas |

Aucune autre clé n'est acceptée. Les noms de tables et de colonnes sont ceux du fichier SQLite
(D42, D58). Chaque valeur s'écrit en JSON natif :

- **montant** : un nombre entier de centimes, signé (`-60000` pour −600,00 €) ;
- **date** : un texte `AAAA-MM-JJ` qui existe au calendrier ;
- **booléen** : `true` ou `false` ;
- **objet JSON** (placement, report, rythme, tolérance) : un objet ou une liste, pas un texte ;
- une colonne facultative absente ou `null` reste vide.

## Les identifiants et les références

Chaque ligne a un identifiant (`id`), une chaîne choisie par qui écrit le fichier, unique dans sa
table ; il se garde tel quel dans le projet. Les lignes se désignent par ces identifiants : le besoin
sa tirelire (`tirelire_id`), le flux son compte (`account_id`), sa tirelire, son compte de
contrepartie et sa catégorie, le placement ses comptes (`accountId`), la catégorie sa parente et sa
tirelire par défaut. Une référence désigne une ligne du JSON ou une ligne déjà dans le projet.

Le **compte principal** du JSON, le seul de genre `principal`, renseigne le compte principal du
projet au lieu d'en créer un second (D40) : quel que soit son identifiant dans le JSON, il devient
`acc-principal`, et ce qui le désigne dans le JSON désigne le compte principal du projet.

## La lecture, tout ou rien

Le budget passe par la même vérification qu'un fichier ouvert (D58) : valeurs obligatoires,
énumérations, montants en centimes entiers, dates, forme des objets JSON, une seule part variable par
placement, références, identifiants répétés, un seul compte principal. Une seule faute refuse le
tout ; le refus nomme le premier problème — la table, la ligne, la colonne — et dit combien d'autres
il y a. Rien d'un budget refusé n'est retenu.

**Réimporter.** Une ligne dont l'identifiant existe déjà dans le projet le remplace ; une ligne du
projet absente du JSON reste. Importer deux fois le même JSON donne le même projet qu'une fois.

## Les tables

### `accounts`

Les comptes bancaires du foyer.

| Colonne | Obligatoire | Forme et sens |
| --- | --- | --- |
| `id` | oui | identifiant de la ligne |
| `name` | oui | texte : le nom du compte |
| `kind` | oui | `principal`, `courant` ou `epargne` ; un seul `principal` |
| `bank` | non | texte : la banque |
| `account_number` | non | texte : numéro de compte ou IBAN, qui sert à reconnaître le compte à l'import |
| `opening_balance` | oui | montant : le solde à la date d'ouverture |
| `opening_date` | oui | date : celle du solde initial |
| `tracks_settlement` | non | booléen : suivre un solde à régler avec le compte principal (D04, D45) |
| `settlement_threshold` | non | montant : en dessous, aucun virement de règlement n'est proposé |
| `settlement_direction` | non | `both`, `toThird` ou `fromThird` : le sens permis des règlements |
| `active_from` | non | date : ouverture réelle du compte (D56) |
| `active_to` | non | date : clôture réelle du compte (D56) |

### `tirelires`

| Colonne | Obligatoire | Forme et sens |
| --- | --- | --- |
| `id` | oui | identifiant de la ligne |
| `name` | oui | texte : le nom de la tirelire |
| `placement` | oui | liste de `{ "accountId": <compte>, "share": <part> }` : où l'argent est placé (D38) ; une part est `{ "kind": "fixed", "amount": <montant> }`, `{ "kind": "percent", "pct": <nombre> }` ou `{ "kind": "variable" }`, une seule variable |
| `opening_balance` | oui | montant : le solde de la tirelire à son ouverture |
| `opening_date` | oui | date : celle de ce solde |
| `rollover` | non | objet : le report d'une période à l'autre, `{ "mode": "none" }`, `{ "mode": "unlimited" }` ou `{ "mode": "capped", "months": <entier> }` ; absent, illimité |

### `needs`

Les besoins d'une tirelire.

| Colonne | Obligatoire | Forme et sens |
| --- | --- | --- |
| `id` | oui | identifiant de la ligne |
| `tirelire_id` | oui | la tirelire qui porte le besoin |
| `kind` | oui | `recurring` (un montant par rythme), `dueDate` (une échéance à provisionner), `goal` (un objectif, une mensualité) ou `payout` (une tirelire qui verse au budget, D48) |
| `name` | non | texte : le nom du besoin |
| `amount` | non | montant : celui du besoin, ou la cible d'un objectif |
| `periodicity` | non | rythme `{ "interval": <entier ≥ 1>, "unit": "day" \| "week" \| "month" \| "year", "anchorDate": <date> }` (D47) |
| `monthly_amount` | non | montant : la mensualité d'un objectif |
| `priority` | oui | entier : l'ordre de financement, le plus petit servi en premier (D06) |
| `active_from` | non | date : début de validité (D50) |
| `active_to` | non | date : fin de validité (D50) |

### `categories`

| Colonne | Obligatoire | Forme et sens |
| --- | --- | --- |
| `id` | oui | identifiant de la ligne |
| `name` | oui | texte : le nom de la catégorie |
| `parent_id` | non | la catégorie parente, sans cycle |
| `tirelire_id` | non | la tirelire par défaut des opérations de cette catégorie |
| `nature` | oui | `expense` ou `income` |

### `planned_flows`

Les flux prévus : revenus, charges fixes, échéances et virements, dont les ordres permanents
enregistrés.

| Colonne | Obligatoire | Forme et sens |
| --- | --- | --- |
| `id` | oui | identifiant de la ligne |
| `name` | oui | texte : le nom du flux |
| `kind` | oui | `income`, `fixedCharge`, `dueDate` ou `transfer` |
| `amount` | oui | montant signé : positif crédite `account_id`, négatif le débite ; pour un ordre permanent, ce que la banque exécute (D60) |
| `account_id` | oui | le compte du flux |
| `tirelire_id` | non | la tirelire qu'une échéance vide |
| `counterpart_account_id` | non | le compte de contrepartie d'un virement |
| `category_id` | non | la catégorie du flux |
| `periodicity` | oui | rythme, comme pour `needs` |
| `date_window_days` | oui | entier : la fenêtre, en jours, autour de la date attendue (D12) |
| `amount_tolerance` | non | objet `{ "abs": <montant>, "pct": <nombre> }`, chaque clé facultative |
| `label_pattern` | non | texte : expression régulière qui reconnaît le libellé à l'import |
| `variable` | non | booléen : un montant variable, jamais repris sans confirmation (D12) |
| `active_from` | non | date : début de validité |
| `active_to` | non | date : fin de validité |
| `locks` | non | booléen : verrouiller l'opération reprise (D22, D24) |
| `origin` | non | `declared` (absent vaut déclaré) ou `derived` : un ordre permanent enregistré, dérivé du budget (D57, D60) |

### `settings`

Les réglages du budget, un objet. `siteId` décrit une instance et est refusé (D58).

| Clé | Obligatoire | Forme et sens |
| --- | --- | --- |
| `periodStartDay` | non | entier de 1 à 31 : le jour où commence la période (D44) |
| `principalCushion` | non | montant : le coussin à laisser sur le compte principal |
| `transferThreshold` | non | montant : en dessous, un écart de placement est « à surveiller » (D20) |
| `orderRounding` | non | montant positif : le pas d'arrondi des ordres permanents (D60) |

## Exemple complet

Le budget de l'exemple embarqué, sans ses opérations. Lu sur un projet vierge, il donne au 6 septembre
2026 le plan de l'exemple privé de ses opérations.

```json
{
  "format": "tirelire-budget",
  "version": 1,
  "accounts": [
    {
      "id": "acc-principal",
      "name": "Compte courant",
      "kind": "principal",
      "opening_balance": 234000,
      "opening_date": "2026-08-27"
    },
    {
      "id": "acc-livret",
      "name": "Livret A",
      "kind": "epargne",
      "opening_balance": 481500,
      "opening_date": "2026-08-27"
    },
    {
      "id": "acc-enfants",
      "name": "Carte enfants",
      "kind": "courant",
      "opening_balance": 0,
      "opening_date": "2026-08-27",
      "tracks_settlement": true,
      "settlement_threshold": 1000,
      "settlement_direction": "both"
    },
    {
      "id": "acc-marie",
      "name": "Compte de Marie",
      "kind": "courant",
      "opening_balance": 0,
      "opening_date": "2026-08-27",
      "tracks_settlement": true,
      "settlement_threshold": 1000,
      "settlement_direction": "both"
    },
    {
      "id": "acc-livret-jeune",
      "name": "Livret jeune",
      "kind": "epargne",
      "opening_balance": 0,
      "opening_date": "2026-08-27",
      "active_to": "2026-06-30"
    }
  ],
  "tirelires": [
    {
      "id": "env-tf",
      "name": "Taxe foncière",
      "placement": [
        {
          "accountId": "acc-livret",
          "share": {
            "kind": "variable"
          }
        }
      ],
      "opening_balance": 90000,
      "opening_date": "2026-08-27"
    },
    {
      "id": "env-auto",
      "name": "Assurance auto",
      "placement": [
        {
          "accountId": "acc-livret",
          "share": {
            "kind": "variable"
          }
        }
      ],
      "opening_balance": 30000,
      "opening_date": "2026-08-27"
    },
    {
      "id": "env-vac",
      "name": "Vacances",
      "placement": [
        {
          "accountId": "acc-livret",
          "share": {
            "kind": "variable"
          }
        }
      ],
      "opening_balance": 40000,
      "opening_date": "2026-08-27"
    },
    {
      "id": "env-precaution",
      "name": "Épargne de précaution",
      "placement": [
        {
          "accountId": "acc-livret",
          "share": {
            "kind": "variable"
          }
        }
      ],
      "opening_balance": 320000,
      "opening_date": "2026-08-27"
    },
    {
      "id": "env-alim",
      "name": "Alimentation",
      "placement": [
        {
          "accountId": "acc-principal",
          "share": {
            "kind": "variable"
          }
        }
      ],
      "opening_balance": 0,
      "opening_date": "2026-08-28",
      "rollover": {
        "mode": "none"
      }
    },
    {
      "id": "env-essence",
      "name": "Essence",
      "placement": [
        {
          "accountId": "acc-principal",
          "share": {
            "kind": "variable"
          }
        }
      ],
      "opening_balance": 0,
      "opening_date": "2026-08-28",
      "rollover": {
        "mode": "none"
      }
    },
    {
      "id": "env-divers",
      "name": "Divers et sorties",
      "placement": [
        {
          "accountId": "acc-principal",
          "share": {
            "kind": "variable"
          }
        }
      ],
      "opening_balance": 0,
      "opening_date": "2026-08-28",
      "rollover": {
        "mode": "none"
      }
    },
    {
      "id": "env-enfants",
      "name": "Enfants et loisirs",
      "placement": [
        {
          "accountId": "acc-enfants",
          "share": {
            "kind": "variable"
          }
        }
      ],
      "opening_balance": 0,
      "opening_date": "2026-08-28",
      "rollover": {
        "mode": "unlimited"
      }
    },
    {
      "id": "env-sante",
      "name": "Santé",
      "placement": [
        {
          "accountId": "acc-principal",
          "share": {
            "kind": "variable"
          }
        }
      ],
      "opening_balance": 0,
      "opening_date": "2026-08-28",
      "rollover": {
        "mode": "none"
      }
    }
  ],
  "needs": [
    {
      "id": "need-tf",
      "tirelire_id": "env-tf",
      "kind": "dueDate",
      "amount": 120000,
      "periodicity": {
        "interval": 12,
        "unit": "month",
        "anchorDate": "2026-10-15"
      },
      "priority": 10
    },
    {
      "id": "need-auto",
      "tirelire_id": "env-auto",
      "kind": "dueDate",
      "amount": 60000,
      "periodicity": {
        "interval": 12,
        "unit": "month",
        "anchorDate": "2027-03-05"
      },
      "priority": 10
    },
    {
      "id": "need-vac",
      "tirelire_id": "env-vac",
      "kind": "dueDate",
      "amount": 240000,
      "periodicity": {
        "interval": 12,
        "unit": "month",
        "anchorDate": "2027-07-01"
      },
      "priority": 10
    },
    {
      "id": "need-essence",
      "tirelire_id": "env-essence",
      "kind": "recurring",
      "amount": 20000,
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-08-28"
      },
      "priority": 20
    },
    {
      "id": "need-enfants",
      "tirelire_id": "env-enfants",
      "kind": "recurring",
      "amount": 20000,
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-08-28"
      },
      "priority": 20
    },
    {
      "id": "need-sante",
      "tirelire_id": "env-sante",
      "kind": "recurring",
      "amount": 10000,
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-08-28"
      },
      "priority": 20
    },
    {
      "id": "need-divers-avant",
      "tirelire_id": "env-divers",
      "kind": "recurring",
      "amount": 30000,
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-01-28"
      },
      "priority": 40,
      "active_to": "2026-08-27"
    },
    {
      "id": "need-divers",
      "tirelire_id": "env-divers",
      "kind": "recurring",
      "amount": 25000,
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-08-28"
      },
      "priority": 40,
      "active_from": "2026-08-28"
    },
    {
      "id": "need-alim",
      "tirelire_id": "env-alim",
      "kind": "recurring",
      "amount": 90000,
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-08-28"
      },
      "priority": 20,
      "active_to": "2026-10-27"
    },
    {
      "id": "need-alim-apres",
      "tirelire_id": "env-alim",
      "kind": "recurring",
      "amount": 95000,
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-10-28"
      },
      "priority": 20,
      "active_from": "2026-10-28"
    },
    {
      "id": "need-piano",
      "tirelire_id": "env-enfants",
      "kind": "recurring",
      "name": "Cours de piano",
      "amount": 4500,
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-10-28"
      },
      "priority": 20,
      "active_from": "2026-10-28"
    },
    {
      "id": "need-precaution",
      "tirelire_id": "env-precaution",
      "kind": "goal",
      "amount": 600000,
      "monthly_amount": 30000,
      "priority": 30,
      "active_to": "2026-12-27"
    },
    {
      "id": "need-precaution-apres",
      "tirelire_id": "env-precaution",
      "kind": "goal",
      "amount": 1200000,
      "monthly_amount": 80000,
      "priority": 30,
      "active_from": "2026-12-28"
    }
  ],
  "categories": [
    {
      "id": "cat-salaire",
      "name": "Salaire",
      "nature": "income"
    },
    {
      "id": "cat-loyer",
      "name": "Loyer perçu",
      "nature": "income"
    },
    {
      "id": "cat-alloc",
      "name": "Allocations",
      "nature": "income"
    },
    {
      "id": "cat-alim",
      "name": "Alimentation",
      "tirelire_id": "env-alim",
      "nature": "expense"
    },
    {
      "id": "cat-sante",
      "name": "Santé",
      "tirelire_id": "env-sante",
      "nature": "expense"
    },
    {
      "id": "cat-enfants",
      "name": "Enfants",
      "tirelire_id": "env-enfants",
      "nature": "expense"
    },
    {
      "id": "cat-logement",
      "name": "Logement",
      "nature": "expense"
    },
    {
      "id": "cat-assurance",
      "name": "Assurances",
      "nature": "expense"
    },
    {
      "id": "cat-abos",
      "name": "Abonnements",
      "nature": "expense"
    },
    {
      "id": "cat-transfert",
      "name": "Virement interne",
      "nature": "expense"
    }
  ],
  "planned_flows": [
    {
      "id": "flow-salaire",
      "name": "Salaire",
      "kind": "income",
      "amount": 340000,
      "account_id": "acc-principal",
      "category_id": "cat-salaire",
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-08-28"
      },
      "date_window_days": 3,
      "amount_tolerance": {
        "pct": 10
      },
      "label_pattern": "VIR(EMENT)? .*SALAIRE",
      "variable": true,
      "active_to": "2026-10-27"
    },
    {
      "id": "flow-salaire-apres",
      "name": "Salaire",
      "kind": "income",
      "amount": 355000,
      "account_id": "acc-principal",
      "category_id": "cat-salaire",
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-10-28"
      },
      "date_window_days": 3,
      "amount_tolerance": {
        "pct": 10
      },
      "label_pattern": "VIR(EMENT)? .*SALAIRE",
      "variable": true,
      "active_from": "2026-10-28"
    },
    {
      "id": "flow-loyer",
      "name": "Loyer locatif",
      "kind": "income",
      "amount": 70000,
      "account_id": "acc-principal",
      "category_id": "cat-loyer",
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-09-05"
      },
      "date_window_days": 5,
      "label_pattern": "LOYER"
    },
    {
      "id": "flow-caf",
      "name": "Allocations",
      "kind": "income",
      "amount": 10000,
      "account_id": "acc-principal",
      "category_id": "cat-alloc",
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-09-05"
      },
      "date_window_days": 5,
      "label_pattern": "CAF"
    },
    {
      "id": "flow-credit",
      "name": "Crédit immobilier",
      "kind": "fixedCharge",
      "amount": -95000,
      "account_id": "acc-principal",
      "category_id": "cat-logement",
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-09-05"
      },
      "date_window_days": 3,
      "label_pattern": "ECHEANCE PRET",
      "active_to": "2026-12-05"
    },
    {
      "id": "flow-assur-hab",
      "name": "Assurance habitation",
      "kind": "fixedCharge",
      "amount": -4500,
      "account_id": "acc-principal",
      "category_id": "cat-assurance",
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-09-10"
      },
      "date_window_days": 3
    },
    {
      "id": "flow-internet",
      "name": "Internet et mobiles",
      "kind": "fixedCharge",
      "amount": -7500,
      "account_id": "acc-principal",
      "category_id": "cat-abos",
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-09-12"
      },
      "date_window_days": 3
    },
    {
      "id": "flow-electricite",
      "name": "Électricité",
      "kind": "fixedCharge",
      "amount": -15000,
      "account_id": "acc-principal",
      "category_id": "cat-logement",
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-09-15"
      },
      "date_window_days": 4,
      "amount_tolerance": {
        "pct": 30
      },
      "variable": true
    },
    {
      "id": "flow-vir-livret",
      "name": "Virement Livret A",
      "kind": "transfer",
      "amount": -60000,
      "account_id": "acc-principal",
      "counterpart_account_id": "acc-livret",
      "periodicity": {
        "interval": 1,
        "unit": "month",
        "anchorDate": "2026-08-28"
      },
      "date_window_days": 5,
      "amount_tolerance": {
        "pct": 20
      },
      "label_pattern": "TIRELIRE LIVRET A",
      "origin": "derived"
    },
    {
      "id": "flow-tf",
      "name": "Taxe foncière (prélèvement)",
      "kind": "dueDate",
      "amount": -120000,
      "account_id": "acc-principal",
      "tirelire_id": "env-tf",
      "periodicity": {
        "interval": 12,
        "unit": "month",
        "anchorDate": "2026-10-15"
      },
      "date_window_days": 5,
      "label_pattern": "DGFIP|TAXE FONC"
    }
  ],
  "settings": {
    "periodStartDay": 28,
    "principalCushion": 60000,
    "transferThreshold": 1000,
    "orderRounding": 1000
  }
}
```
