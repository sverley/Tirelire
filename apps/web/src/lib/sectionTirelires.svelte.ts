/**
 * La section Tirelires (#361, règle des sections, D94) : la carte d'une tirelire et ses lignes de besoin,
 * leur correction sur place, l'ajout d'un besoin à une tirelire, le formulaire d'ajout d'une
 * tirelire avec ses aides (#214), les raccourcis de l'exemple (D46) et le garnissage d'un projet
 * vierge — écrits une fois, ici, pour chaque endroit qui les emploie.
 *
 * Ce qui change d'un endroit à l'autre se donne à la construction, et rien d'autre : la destination
 * des écritures (le brouillon de l'assistant, #210, ou le projet). Le garnissage d'office ne se fait
 * que sur demande de l'endroit (`garnir`), que l'assistant seul fait, sur un projet vierge (D46). Le
 * texte d'explication, les champs montrés et le rangement des cartes sont ceux du composant
 * (`SectionTirelires.svelte`) et de l'endroit qui l'emploie.
 */
import {
  DEFAULT_PRIORITY,
  alive,
  flowTirelire,
  budgetSuggestions,
  suggestedNeed,
  suggestedTirelire,
  type Id,
  type ISODate,
  type Ledger,
  type LedgerKey,
  type Need,
  type PlannedFlow,
  type Tirelire,
  type TirelireSuggestion,
} from '@tirelire/core';
import { inputToCents } from './format';
import { aideBesoin, aideCourant, aideEpargne, aidePeriodique, recopieBesoin, recopieCourant, recopieEpargne, recopiePeriodique } from './aides';

/** Où la section lit et écrit : le brouillon de l'assistant, ou le projet. */
export interface Destination {
  readonly ledger: Ledger;
  upsert<K extends LedgerKey>(key: K, row: Ledger[K][number]): void;
  remove(key: LedgerKey, id: string): void;
  newId(): Id;
  readonly asOf: ISODate;
  /** La date d'ouverture d'une tirelire et l'ancrage d'un besoin par période : le début de la période en cours. */
  periodStart(): ISODate;
  /** Le compte principal, où se rattache ce que rien d'autre ne place. */
  mainAccountId(): Id;
}

/** Le genre de besoin d'une étape de la section : budgets par période, échéances, objectifs. */
export type GenreDeLaSection = 'everyday' | 'periodic' | 'savings';
export const GENRE_DU_BESOIN: Record<GenreDeLaSection, Need['kind']> = { everyday: 'recurring', periodic: 'dueDate', savings: 'goal' };

/** Le genre d'une tirelire proposée : celui de ses besoins — une échéance d'abord, puis un objectif, sinon un budget. */
export const genreDe = (p: TirelireSuggestion): GenreDeLaSection =>
  p.needs.some((n) => n.kind === 'dueDate') ? 'periodic' : p.needs.some((n) => n.kind === 'goal') ? 'savings' : 'everyday';

type SaisieCourant = { name: string; amount: string; keep?: boolean | undefined };
type SaisiePeriodique = { name: string; amount: string; months?: string | undefined; dueDate?: string | undefined; withFlow?: boolean | undefined; accountId?: string | undefined };
type SaisieEpargne = { name: string; monthly: string; target: string };

export class SectionTirelires {
  readonly #d: Destination;
  constructor(destination: Destination) {
    this.#d = destination;
  }

  // --- Lecture ---
  get accounts() {
    return alive(this.#d.ledger.accounts);
  }
  get tirelires() {
    return alive(this.#d.ledger.tirelires);
  }
  get needs() {
    return alive(this.#d.ledger.needs);
  }
  get flows() {
    return alive(this.#d.ledger.plannedFlows);
  }
  get categories() {
    return alive(this.#d.ledger.categories);
  }
  get asOf() {
    return this.#d.asOf;
  }
  nomDuCompte = (id?: string) => this.accounts.find((a) => a.id === id)?.name ?? '';
  /** Le compte du même nom, ici ; le compte principal se désigne par l'absence de nom. */
  compteNomme = (nom: string) => this.accounts.find((a) => a.name === nom)?.id;
  /** Le compte que l'exemple donne à une ligne, ici : celui du même nom, à défaut le compte principal (D40). */
  compteNommeOuPrincipal = (nom?: string) => (nom ? this.compteNomme(nom) : undefined) ?? this.#d.mainAccountId();

  /** Les tirelires d'un genre : celles qui en ont un besoin, chacune avec ses besoins de ce genre, dans l'ordre où ils sont venus. */
  parTirelire(genre: GenreDeLaSection): Array<{ t: Tirelire; besoins: Need[] }> {
    const kind = GENRE_DU_BESOIN[genre];
    const needs = this.needs;
    return this.tirelires.map((t) => ({ t, besoins: needs.filter((n) => n.tirelireId === t.id && n.kind === kind) })).filter((x) => x.besoins.length > 0);
  }
  /** Les prélèvements attendus pour les échéances d'une tirelire : ses flux d'échéance (D40). */
  prelevementsDe = (t: Tirelire) => this.flows.filter((f) => f.kind === 'dueDate' && flowTirelire(f) === t.id);

  // --- Raccourcis de l'exemple (D43, D46) : toujours offerts ; un raccourci déjà repris disparaît ---
  readonly propositions = budgetSuggestions();
  dejaPris = (nom: string) => this.flows.some((f) => f.name === nom) || this.tirelires.some((t) => t.name === nom);
  toutesLesTirelires = (genre: GenreDeLaSection) => this.propositions.tirelires.filter((x) => genreDe(x) === genre);
  restantes = (genre: GenreDeLaSection) => this.toutesLesTirelires(genre).filter((x) => !this.dejaPris(x.name));

  /**
   * Une tirelire de l'exemple, avec ce que l'exemple en dit : tous ses besoins, son reliquat, ce
   * qui y est déjà mis de côté, son placement si le compte est ici, et le prélèvement qu'attend
   * chacune de ses échéances. Ouverte au début de la période en cours (D40).
   */
  appliquer = (p: TirelireSuggestion) => {
    const d = this.#d;
    const cree = suggestedTirelire(p, { id: d.newId(), newId: () => d.newId(), openingDate: d.periodStart(), principalId: d.mainAccountId(), compte: this.compteNomme });
    d.upsert('tirelires', cree.tirelire);
    for (const n of cree.needs) d.upsert('needs', n);
    this.derniereEcheance = cree.needs.filter((n) => n.kind === 'dueDate').at(-1)?.id;
    for (const f of cree.flows) d.upsert('plannedFlows', f);
  };
  /** Le garnissage d'office : chaque raccourci restant du genre, repris. L'endroit décide s'il le fait (D46). */
  garnir(genre: GenreDeLaSection) {
    this.restantes(genre).forEach(this.appliquer);
  }

  // --- Aides des formulaires d'ajout (#214) ---
  get aideBudget() {
    return aideCourant(this.restantes('everyday'), this.toutesLesTirelires('everyday'), this.asOf);
  }
  get aideEcheance() {
    return aidePeriodique(this.restantes('periodic'), this.toutesLesTirelires('periodic'), this.asOf);
  }
  get aideObjectif() {
    return aideEpargne(this.restantes('savings'), this.toutesLesTirelires('savings'), this.asOf);
  }
  readonly aideBesoinAjoute = aideBesoin();

  /**
   * La dernière échéance que la section ou son endroit vient d'enregistrer : l'endroit qui annonce un
   * manque tout de suite (#184) la lit, et l'efface quand l'annonce est fermée.
   */
  derniereEcheance = $state<Id | undefined>(undefined);

  // --- Saisies des formulaires d'ajout : elles se gardent d'une étape à l'autre ---
  /** Le report se coche ou se décoche ; tant qu'on n'y a pas touché (`undefined`), il est celui de la ligne d'aide (#214). */
  day = $state<SaisieCourant>({ name: '', amount: '' });
  dayError = $state('');
  /** Le rythme, l'échéance, le compte et le prélèvement, tant qu'on n'y a pas touché (`undefined`), sont ceux de la ligne d'aide (#214). */
  per = $state<SaisiePeriodique>({ name: '', amount: '' });
  perError = $state('');
  sav = $state<SaisieEpargne>({ name: '', monthly: '', target: '' });
  savError = $state('');
  /** La saisie et l'erreur du formulaire d'ajout d'un besoin, par tirelire. */
  ajoutBesoin = $state<Record<string, { name: string; amount: string; error: string }>>({});
  saisieDuBesoin = (t: Tirelire) => this.ajoutBesoin[t.id] ?? { name: '', amount: '', error: '' };

  get gardeBudget() {
    return this.day.keep ?? this.aideBudget?.keep ?? false;
  }
  get evEcheance() {
    const a = this.aideEcheance;
    return {
      months: this.per.months ?? String(a?.months ?? 12),
      dueDate: this.per.dueDate ?? a?.dueDate ?? '',
      withFlow: this.per.withFlow ?? a?.withFlow ?? true,
      accountId: this.per.accountId ?? this.compteNommeOuPrincipal(a?.accountName),
    };
  }

  // --- Création ---
  #nouvelleTirelire(nom: string, garde: boolean): Id {
    const id = this.#d.newId();
    this.#d.upsert('tirelires', { id, name: nom, placement: [], openingBalance: 0, openingDate: this.#d.periodStart(), rollover: { mode: garde ? 'unlimited' : 'none' } } satisfies Tirelire);
    return id;
  }
  #creerCourant(nom: string, montant: number, garde: boolean) {
    const tirelireId = this.#nouvelleTirelire(nom, garde);
    this.#d.upsert('needs', {
      id: this.#d.newId(),
      tirelireId,
      kind: 'recurring',
      amount: montant,
      periodicity: { interval: 1, unit: 'month' as const, anchorDate: this.#d.periodStart() },
      priority: DEFAULT_PRIORITY.recurring,
    } satisfies Need);
  }
  #creerPeriodique(nom: string, montant: number, mois: number, echeance: string, compte?: string, avecFlux = true) {
    const tirelireId = this.#nouvelleTirelire(nom, true);
    const besoinId = this.#d.newId();
    this.derniereEcheance = besoinId;
    this.#d.upsert('needs', {
      id: besoinId,
      tirelireId,
      kind: 'dueDate',
      amount: montant,
      periodicity: { interval: mois, unit: 'month' as const, anchorDate: echeance },
      priority: DEFAULT_PRIORITY.dueDate,
    } satisfies Need);
    if (avecFlux) {
      this.#d.upsert('plannedFlows', {
        id: this.#d.newId(),
        name: nom,
        kind: 'dueDate',
        amount: -montant,
        accountId: compte || this.#d.mainAccountId(),
        action: { tirelireId },
        periodicity: { interval: mois, unit: 'month' as const, anchorDate: echeance },
        dateWindowDays: 7,
      } satisfies PlannedFlow);
    }
  }
  #creerEpargne(nom: string, mensuel: number, cible?: number) {
    const tirelireId = this.#nouvelleTirelire(nom, true);
    this.#d.upsert('needs', {
      id: this.#d.newId(),
      tirelireId,
      kind: 'goal',
      monthlyAmount: mensuel,
      priority: DEFAULT_PRIORITY.goal,
      ...(cible !== undefined && cible > 0 ? { amount: cible } : {}),
    } satisfies Need);
  }

  addEveryday(): boolean {
    const day = this.day;
    const amount = inputToCents(day.amount);
    if (!day.name.trim()) { this.dayError = 'Donnez un nom à ce budget.'; return false; }
    if (amount === undefined || amount <= 0) { this.dayError = 'Indiquez un montant par période.'; return false; }
    const ligne = this.aideBudget;
    const garde = this.gardeBudget;
    if (ligne && recopieCourant({ name: day.name.trim(), amount, keep: garde }, ligne)) {
      this.appliquer(ligne.ligne);
      this.day = { name: '', amount: '' };
    } else {
      this.#creerCourant(day.name.trim(), amount, garde);
      this.day = { name: '', amount: '', keep: day.keep };
    }
    this.dayError = '';
    return true;
  }
  addPeriodic(): boolean {
    const per = this.per;
    const amount = inputToCents(per.amount);
    if (!per.name.trim()) { this.perError = 'Donnez un nom à cette dépense.'; return false; }
    if (amount === undefined || amount <= 0) { this.perError = 'Indiquez le montant de la facture.'; return false; }
    const ev = this.evEcheance;
    const echeance = ev.dueDate;
    if (!echeance) { this.perError = 'Indiquez la date de la prochaine échéance.'; return false; }
    const mois = Math.max(1, Number(ev.months) || 1);
    const ligne = this.aideEcheance;
    if (ligne && recopiePeriodique({ name: per.name.trim(), amount, months: mois, dueDate: echeance, withFlow: ev.withFlow, accountId: ev.accountId }, ligne, this.compteNommeOuPrincipal(ligne.accountName))) {
      this.appliquer(ligne.ligne);
      this.per = { name: '', amount: '' };
    } else {
      this.#creerPeriodique(per.name.trim(), amount, mois, echeance, ev.accountId, ev.withFlow);
      this.per = { ...per, name: '', amount: '', dueDate: undefined };
    }
    this.perError = '';
    return true;
  }
  addSavings(): boolean {
    const sav = this.sav;
    const monthly = inputToCents(sav.monthly);
    if (!sav.name.trim()) { this.savError = 'Donnez un nom à cet objectif.'; return false; }
    if (monthly === undefined || monthly <= 0) { this.savError = 'Indiquez combien mettre de côté par période.'; return false; }
    const cible = inputToCents(sav.target);
    const ligne = this.aideObjectif;
    if (ligne && recopieEpargne({ name: sav.name.trim(), monthly, target: cible }, ligne)) this.appliquer(ligne.ligne);
    else this.#creerEpargne(sav.name.trim(), monthly, cible);
    this.sav = { name: '', monthly: '', target: '' };
    this.savError = '';
    return true;
  }
  /**
   * Un besoin par période de plus sur la tirelire (D28, #344) : en vigueur dès la période en cours,
   * sans date de fin, avec la priorité par défaut. Un formulaire qui recopie ses aides fait ce que
   * fait le raccourci du besoin de l'exemple, date de début comprise (#214).
   */
  addNeedTo(t: Tirelire) {
    const s = this.saisieDuBesoin(t);
    const nom = s.name.trim();
    const montant = inputToCents(s.amount);
    if (!nom) return void (this.ajoutBesoin[t.id] = { ...s, error: 'Donnez un nom à ce besoin.' });
    if (montant === undefined || montant <= 0) return void (this.ajoutBesoin[t.id] = { ...s, error: 'Indiquez un montant par période, en positif.' });
    const aide = this.aideBesoinAjoute;
    if (aide && recopieBesoin({ name: nom, amount: montant }, aide)) {
      this.#d.upsert('needs', suggestedNeed(aide.ligne, { id: this.#d.newId(), tirelireId: t.id }));
    } else {
      this.#d.upsert('needs', {
        id: this.#d.newId(),
        tirelireId: t.id,
        kind: 'recurring',
        name: nom,
        amount: montant,
        periodicity: { interval: 1, unit: 'month' as const, anchorDate: this.#d.periodStart() },
        priority: DEFAULT_PRIORITY.recurring,
      } satisfies Need);
    }
    this.ajoutBesoin[t.id] = { name: '', amount: '', error: '' };
  }

  // --- Correction sur place ---
  editTirelireName(t: Tirelire, v: string) {
    if (v.trim() && v.trim() !== t.name) this.#d.upsert('tirelires', { ...t, name: v.trim() });
  }
  /** Le nom propre d'un besoin, quand il en porte un (« Cours de piano ») ; vidé, le besoin reprend celui de sa tirelire. */
  editNeedOwnName(n: Need, v: string) {
    const nom = v.trim();
    if (nom === (n.name ?? '')) return;
    const { name: _ancien, ...sans } = n;
    this.#d.upsert('needs', nom ? { ...n, name: nom } : sans);
  }
  /** Ce qui y est déjà mis de côté : le solde d'ouverture de la tirelire, réputé sur le premier compte de son placement. */
  editOpeningBalance(t: Tirelire, v: string) {
    const c = inputToCents(v);
    if (c === undefined || c < 0 || c === t.openingBalance) return;
    this.#d.upsert('tirelires', { ...t, openingBalance: c });
  }
  editNeedAmount(n: Need, v: string) {
    const c = inputToCents(v);
    if (c === undefined || c < 0) return;
    const champ = n.kind === 'goal' ? 'monthlyAmount' : 'amount';
    if (n[champ] !== c) this.#d.upsert('needs', { ...n, [champ]: c });
  }
  editNeedTarget(n: Need, v: string) {
    const c = inputToCents(v);
    if (c === undefined || c < 0) return;
    if (n.amount !== c) this.#d.upsert('needs', { ...n, amount: c });
  }
  editNeedDueDate(n: Need, v: string) {
    if (!v || !n.periodicity || v === n.periodicity.anchorDate) return;
    this.#d.upsert('needs', { ...n, periodicity: { ...n.periodicity, anchorDate: v } });
  }
  editRollover(t: Tirelire, keep: boolean) {
    this.#d.upsert('tirelires', { ...t, rollover: { mode: keep ? 'unlimited' : 'none' } });
  }
  /** Attendre un prélèvement pour une échéance, ou ne plus l'attendre : le flux d'échéance se crée ou se retire. */
  editPrelevement(t: Tirelire, n: Need, attendu: boolean) {
    if (!attendu) return this.prelevementsDe(t).forEach((f) => this.#d.remove('plannedFlows', f.id));
    if (this.prelevementsDe(t).length || !n.periodicity) return;
    this.#d.upsert('plannedFlows', {
      id: this.#d.newId(),
      name: t.name,
      kind: 'dueDate',
      amount: -(n.amount ?? 0),
      accountId: this.#d.mainAccountId(),
      action: { tirelireId: t.id },
      periodicity: { ...n.periodicity },
      dateWindowDays: 7,
    } satisfies PlannedFlow);
  }

  // --- Retrait ---
  /**
   * Retire une tirelire, avec tous ses besoins et les prélèvements attendus pour ses échéances. Les
   * catégories dont elle était la tirelire par défaut la perdent et se gardent sans (D32, I3).
   */
  removeTirelire(t: Tirelire) {
    const d = this.#d;
    for (const f of this.prelevementsDe(t)) d.remove('plannedFlows', f.id);
    for (const n of this.needs.filter((n) => n.tirelireId === t.id)) d.remove('needs', n.id);
    for (const c of this.categories.filter((c) => c.tirelireId === t.id)) {
      const { tirelireId: _retiree, ...sans } = c;
      d.upsert('categories', sans);
    }
    d.remove('tirelires', t.id);
  }
  /** Retire un besoin d'une tirelire qui en porte d'autres ; le dernier emporte la tirelire. */
  removeNeed(n: Need) {
    const t = this.tirelires.find((e) => e.id === n.tirelireId);
    if (t && !this.needs.some((x) => x.tirelireId === n.tirelireId && x.id !== n.id)) return this.removeTirelire(t);
    this.#d.remove('needs', n.id);
  }
}
