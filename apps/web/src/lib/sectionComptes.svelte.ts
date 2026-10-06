/**
 * La section Comptes (#362, règle des sections, D94) : la ligne d'un compte et sa correction sur
 * place, la ligne qui dit qu'un compte est tiers ou clos, le retrait d'un compte, les raccourcis
 * de l'exemple (D46), le formulaire d'ajout avec ses aides (#214) et le garnissage d'un projet
 * vierge — écrits une fois, ici, pour chaque endroit qui les emploie.
 *
 * Ce qui change d'un endroit à l'autre se donne à la construction, et rien d'autre : la destination
 * des écritures (le brouillon de l'assistant, #210, ou le projet) et le coussin du compte principal,
 * un réglage du foyer qui s'écrit au même endroit. Le garnissage d'office ne se fait que sur demande
 * de l'endroit (`garnir`), que l'assistant seul fait, sur un projet vierge (D46). Le texte
 * d'explication et les champs montrés sont ceux du composant (`SectionComptes.svelte`) et de
 * l'endroit qui l'emploie.
 */
import {
  DEFAULT_MAIN_ACCOUNT,
  MAIN_ACCOUNT_ID,
  addDays,
  alive,
  budgetSuggestions,
  type Account,
  type AccountKind,
  type Cents,
  type Id,
  type ISODate,
  type Ledger,
  type LedgerKey,
  type SettlementDirection,
} from '@tirelire/core';
import { inputToCents } from './format';
import { aideCompte, recopieCompte } from './aides';

/** Où la section lit et écrit : le brouillon de l'assistant, ou le projet. */
export interface DestinationDesComptes {
  readonly ledger: Ledger;
  upsert<K extends LedgerKey>(key: K, row: Ledger[K][number]): void;
  remove(key: LedgerKey, id: string): void;
  newId(): Id;
  readonly asOf: ISODate;
  /** Le début de la période en cours : la date du solde que l'exemple donne à un compte, et de la clôture d'un compte clos. */
  periodStart(): ISODate;
  /** Le compte principal, sous la même identité partout (D40, D58). */
  mainAccountId(): Id;
  /** Le coussin du compte principal (D41) : un réglage du foyer, écrit là où la section écrit. */
  readonly coussin: Cents;
  setCoussin(c: Cents): void;
}

/** Les genres proposés pour un autre compte que le principal. Typée : un genre renommé casse la compilation. */
export const NATURES_DE_COMPTE: Array<Exclude<AccountKind, 'principal'>> = ['courant', 'epargne'];
/** Le sens autorisé des virements de règlement d'un compte tiers, en clair. */
export const SENS_DE_REGLEMENT: Record<SettlementDirection, string> = {
  both: 'dans les deux sens',
  toThird: 'du compte principal vers ce compte seulement',
  fromThird: 'de ce compte vers le compte principal seulement',
};

export type PropositionDeCompte = ReturnType<typeof budgetSuggestions>['accounts'][number];
export type PropositionDuPrincipal = ReturnType<typeof budgetSuggestions>['mainAccount'];

export class SectionComptes {
  readonly #d: DestinationDesComptes;
  constructor(destination: DestinationDesComptes) {
    this.#d = destination;
  }

  // --- Lecture ---
  get accounts() {
    return alive(this.#d.ledger.accounts);
  }
  get principal() {
    return this.accounts.find((a) => a.kind === 'principal');
  }
  get otherAccounts() {
    return this.accounts.filter((a) => a.kind !== 'principal');
  }
  get asOf() {
    return this.#d.asOf;
  }
  get coussin() {
    return this.#d.coussin;
  }
  /** Un compte est dit tiers s'il suit un solde à régler (D45) ; la ligne dit alors ce suivi. */
  readonly estTiers = (a: Account) => !!a.tracksSettlement;

  // --- Raccourcis de l'exemple (D43, D46) : toujours offerts ; un raccourci déjà repris disparaît ---
  readonly propositions = budgetSuggestions();
  /** Un compte dont le nom existe déjà n'est plus proposé : les comptes se reconnaissent à leur nom (D46). */
  get restantes() {
    return this.propositions.accounts.filter((x) => !this.accounts.some((a) => a.name === x.name));
  }
  /** Les comptes de l'exemple, avec ce que l'exemple en dit : son solde, le suivi de son solde à régler s'il est tiers, sa clôture s'il est clos. */
  readonly appliquer = (p: PropositionDeCompte) => {
    this.#d.upsert('accounts', {
      id: this.#d.newId(),
      name: p.name,
      kind: p.kind,
      openingBalance: p.balance,
      openingDate: this.#d.periodStart(),
      ...(p.settlement
        ? { tracksSettlement: true, settlementThreshold: p.settlement.threshold, settlementDirection: p.settlement.direction }
        : {}),
      ...(p.closed ? { activeTo: this.clotureDeLExemple() } : {}),
    } satisfies Account);
  };
  /**
   * La clôture d'un compte clos de l'exemple : la veille du premier jour de la période en cours, de
   * sorte qu'il ne pèse rien sur le plan (D56).
   */
  clotureDeLExemple = () => addDays(this.#d.periodStart(), -1);
  /**
   * Le compte principal arrive avec ce que l'exemple en dit, là où il reste à renseigner : un nom ou
   * un solde que l'utilisateur a déjà posés ne sont pas remplacés (D43 : rouvrir l'assistant ne doit
   * rien casser). Même règle que le solde saisi : « à renseigner » se lit à la date d'ouverture.
   */
  appliquerPrincipal(p: PropositionDuPrincipal) {
    const principal = this.principal;
    if (!principal) return;
    const nomAFaire = principal.name === DEFAULT_MAIN_ACCOUNT.name;
    const soldeAFaire = principal.openingDate === DEFAULT_MAIN_ACCOUNT.openingDate;
    if (!nomAFaire && !soldeAFaire) return;
    this.#d.upsert('accounts', {
      ...principal,
      ...(nomAFaire ? { name: p.name } : {}),
      ...(soldeAFaire ? { openingBalance: p.balance, openingDate: this.#d.periodStart() } : {}),
    });
  }
  /** Le garnissage d'office : le compte principal renseigné, chaque raccourci restant repris. L'endroit décide s'il le fait (D46). */
  garnir() {
    this.appliquerPrincipal(this.propositions.mainAccount);
    this.restantes.forEach(this.appliquer);
  }

  // --- Aide du formulaire d'ajout (#214) ---
  get aide() {
    return aideCompte(this.restantes, this.propositions.accounts);
  }
  /** Le type se choisit ; tant qu'on n'y a pas touché (`undefined`), il est celui de la ligne d'aide (#214). Un solde laissé vide est un solde nul. */
  saisie = $state<{ name: string; kind?: Exclude<AccountKind, 'principal'> | undefined; balance: string }>({ name: '', balance: '' });
  saisieError = $state('');
  get typeSaisi(): Exclude<AccountKind, 'principal'> {
    return this.saisie.kind ?? this.aide?.kind ?? 'courant';
  }
  ajouter(aujourdhui: ISODate) {
    if (!this.saisie.name.trim()) return void (this.saisieError = 'Donnez un nom à ce compte.');
    const openingBalance = this.saisie.balance.trim() ? inputToCents(this.saisie.balance) : 0;
    if (openingBalance === undefined) return void (this.saisieError = 'Solde invalide.');
    const ligne = this.aide;
    const kind = this.typeSaisi;
    if (ligne && recopieCompte({ name: this.saisie.name.trim(), kind, balance: openingBalance }, ligne)) {
      this.appliquer(ligne.ligne);
    } else {
      this.#d.upsert('accounts', { id: this.#d.newId(), name: this.saisie.name.trim(), kind, openingBalance, openingDate: aujourdhui } satisfies Account);
    }
    this.saisie = { name: '', balance: '' };
    this.saisieError = '';
  }

  // --- Correction sur place : champ par champ, écrite à la volée ---
  /** Ce qu'un geste sur une ligne refuse, dit sous la liste jusqu'au geste suivant. */
  ligneError = $state('');
  #ecrire(row: Account) {
    try {
      this.#d.upsert('accounts', row);
      this.ligneError = '';
    } catch (err) {
      this.ligneError = err instanceof Error ? err.message : String(err);
    }
  }
  editAccount(a: Account, champ: 'name' | 'bank' | 'accountNumber', v: string) {
    const valeur = v.trim();
    if (valeur === (a[champ] ?? '')) return;
    this.#ecrire({ ...a, [champ]: valeur || undefined });
  }
  editAccountKind(a: Account, v: string) {
    if (v !== a.kind) this.#ecrire({ ...a, kind: v as AccountKind });
  }
  /**
   * Le solde saisi est celui du début de la période. La date d'ouverture n'est jamais retouchée —
   * elle cale les soldes d'un compte déjà importé —, sauf celle que le compte principal porte à sa
   * naissance, qui dit « à renseigner » : le solde saisi la renseigne au début de la période.
   */
  editAccountBalance(a: Account, v: string) {
    const c = inputToCents(v);
    if (c === undefined || c === a.openingBalance) return;
    const openingDate = a.id === MAIN_ACCOUNT_ID && a.openingDate === DEFAULT_MAIN_ACCOUNT.openingDate ? this.#d.periodStart() : a.openingDate;
    this.#ecrire({ ...a, openingBalance: c, openingDate });
  }
  /** Le coussin du compte principal (D41) : le même réglage que Réglages, écrit où la section écrit. */
  editCoussin(v: string) {
    const c = inputToCents(v);
    if (c === undefined || c < 0 || c === this.coussin) return;
    this.#d.setCoussin(c);
  }

  /**
   * Retire un compte, et ce qui ne tient que par lui : la part du placement d'une tirelire qui y
   * dort — elle n'a plus de placement, et ne produit aucun écart (D38) — et l'ordre permanent qui en
   * part ou y arrive. Le compte principal ne se retire jamais (D40). Le geste « × » est celui de
   * l'assistant ; l'écran Comptes garde sa suppression, confirmée.
   */
  retirer(a: Account) {
    if (a.kind === 'principal') return;
    this.#d.remove('accounts', a.id);
    for (const t of alive(this.#d.ledger.tirelires)) {
      if (t.placement.some((p) => p.accountId === a.id)) {
        this.#d.upsert('tirelires', { ...t, placement: t.placement.filter((p) => p.accountId !== a.id) });
      }
    }
    for (const f of alive(this.#d.ledger.plannedFlows)) {
      if (f.kind === 'transfer' && f.origin === 'derived' && (f.accountId === a.id || f.counterpartAccountId === a.id)) this.#d.remove('plannedFlows', f.id);
    }
  }
}
