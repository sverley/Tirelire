/**
 * La section Revenus et charges fixes (#364, règle des sections, D94) : pour chacun des deux genres,
 * la ligne d'un flux et sa correction sur place — nom, montant, jour ou date de la première
 * occurrence, « Tous les », unité, compte (D47) — ; son retrait ; les raccourcis de l'exemple, chacun
 * avec toutes ses versions et sa sélection (D46, D51) ; le formulaire d'ajout avec ses aides (#214) ;
 * le garnissage d'un projet vierge ; et le texte qui explique ce genre de flux — écrits une fois, ici,
 * pour les étapes Revenus et Charges fixes de l'assistant et l'écran Flux prévus.
 *
 * Ce qui change d'un endroit à l'autre se donne à la construction, et rien d'autre : la destination
 * des écritures (le brouillon de l'assistant, #210, ou le projet). Le garnissage d'office ne se fait
 * que sur demande de l'endroit (`garnir`), que l'assistant seul fait, sur un projet vierge (D46). Les
 * champs avancés du formulaire d'ajout (`avancees`) ne servent qu'à l'endroit qui les montre (D59) ;
 * le texte d'explication, affiché ou replié, et le rangement des lignes sont ceux du composant
 * (`SectionRevenusCharges.svelte`) et de l'endroit qui l'emploie.
 */
import {
  alive,
  budgetSuggestions,
  dateInMonth,
  daysInMonth,
  parseDate,
  suggestedFlow,
  todayISO,
  type FlowAction,
  type FlowSuggestion,
  type Id,
  type ISODate,
  type Ledger,
  type LedgerKey,
  type PeriodUnit,
  type PlannedFlow,
} from '@tirelire/core';
import { aideFlux, montantAide, parNom, recopieFlux, versionMontree, type AideFlux, type FluxPropose } from './aides';
import { inputToCents, openAccounts } from './format';

/** Où la section lit et écrit : le brouillon de l'assistant, ou le projet. */
export interface DestinationDesFlux {
  readonly ledger: Ledger;
  upsert<K extends LedgerKey>(key: K, row: Ledger[K][number]): void;
  remove(key: LedgerKey, id: string): void;
  newId(): Id;
  readonly asOf: ISODate;
  /** Le compte principal, sous la même identité partout (D40, D58) : il reçoit ce qui n'a pas d'autre compte. */
  mainAccountId(): Id;
}

/** Les deux genres de la section. */
export type GenreDeFlux = 'income' | 'fixedCharge';

/** Ce que la section dit de chaque genre : le titre de ses lignes dans l'assistant, le texte qui l'explique, ses refus. Typée : un genre renommé casse la compilation. */
export const GENRES_DE_FLUX: Record<GenreDeFlux, { titre: string; explication: string; sansNom: string; jourParDefaut: number }> = {
  income: {
    titre: "Rentrées d'argent",
    explication: 'Déclarez ce qui rentre, avec la date à laquelle ça tombe. Le montant se saisit en positif.',
    sansNom: 'Donnez un nom à cette rentrée d’argent.',
    jourParDefaut: 1,
  },
  fixedCharge: {
    titre: 'Charges fixes',
    explication:
      'Loyer, abonnements, mensualités : le montant est connu et il part chaque mois. Pas besoin de réserve — il suffit que le plan sache que cet argent est déjà engagé.',
    sansNom: 'Donnez un nom à cette charge.',
    jourParDefaut: 5,
  },
};

/**
 * Les champs du formulaire d'ajout. Le nom et le montant se saisissent, et leur aide est un texte
 * indicatif ; les autres champs, tant qu'on n'y a pas touché (`undefined`), prennent la valeur de la
 * ligne d'aide (#214) : une liste, un nombre ne montrent pas de texte indicatif.
 */
export type SaisieDeFlux = { name: string; amount: string; interval?: string | undefined; unit?: PeriodUnit | undefined; day?: string | undefined; accountId?: string | undefined };

/**
 * Les champs avancés du formulaire d'ajout, là où l'endroit les montre (D59). Un champ texte (tolérance
 * en euros, motif) se saisit, et montre l'aide ; une liste, un nombre, une date ou une case, tant
 * qu'on n'y a pas touché (`undefined`), prend la valeur de la ligne d'aide, et rien quand l'exemple ne
 * la renseigne pas (D43, #214).
 */
export type SaisieAvancee = {
  categoryId?: string | undefined;
  dateWindowDays?: string | undefined;
  toleranceAbs?: string | undefined;
  tolerancePct?: string | undefined;
  labelPattern?: string | undefined;
  activeFrom?: string | undefined;
  activeTo?: string | undefined;
  variable?: boolean | undefined;
  locks?: boolean | undefined;
};
/** Ce que montrent les champs avancés : ce qu'on y a posé, sinon la valeur de la ligne d'aide. */
export type ValeursAvancees = {
  categoryId: string;
  dateWindowDays: string;
  toleranceAbs: string;
  tolerancePct: string;
  labelPattern: string;
  activeFrom: string;
  activeTo: string;
  variable: boolean;
  locks: boolean;
};

const vide = (): Record<GenreDeFlux, SaisieDeFlux> => ({ income: { name: '', amount: '' }, fixedCharge: { name: '', amount: '' } });

export class SectionRevenusCharges {
  readonly #d: DestinationDesFlux;
  constructor(destination: DestinationDesFlux) {
    this.#d = destination;
  }

  // --- Lecture ---
  get flows(): PlannedFlow[] {
    return alive(this.#d.ledger.plannedFlows);
  }
  get accounts() {
    return alive(this.#d.ledger.accounts);
  }
  get tirelires() {
    return alive(this.#d.ledger.tirelires);
  }
  /** Les comptes des menus : un compte clos n'en fait plus partie (D56). */
  get comptesOuverts() {
    return openAccounts(this.accounts, this.#d.asOf);
  }
  /** Les comptes qu'offre le menu d'une ligne : les ouverts, et celui qu'elle désigne déjà (D56). */
  readonly comptesDeLaLigne = (f: PlannedFlow) => openAccounts(this.accounts, this.#d.asOf, f.accountId);
  get asOf(): ISODate {
    return this.#d.asOf;
  }
  /** Les flux d'un genre, dans l'ordre où la destination les porte : une ligne corrigée ne change pas de place. */
  readonly deGenre = (genre: GenreDeFlux) => this.flows.filter((f) => f.kind === genre);

  // --- Raccourcis de l'exemple (D43, D46, D51) : toujours offerts ; un raccourci déjà repris disparaît ---
  // Un flux proposé (`FluxPropose`) : toutes ses versions, regroupées par leur nom dans l'ordre de
  // l'exemple. Un raccourci apporte le flux avec toutes ses versions, chacune avec ses dates, quelle
  // que soit la date de lecture : seul le montant qu'il montre suit la version en vigueur.
  readonly propositions = budgetSuggestions();
  readonly #exemple: Record<GenreDeFlux, FluxPropose[]> = { income: parNom(this.propositions.incomes), fixedCharge: parNom(this.propositions.charges) };
  /** Toutes les lignes de l'exemple d'un genre. */
  readonly exemple = (genre: GenreDeFlux): FluxPropose[] => this.#exemple[genre];
  /** Un raccourci déjà repris disparaît : on ne propose pas ce qui existe déjà. */
  readonly dejaPris = (nom: string) => this.flows.some((f) => f.name === nom) || this.tirelires.some((t) => t.name === nom);
  readonly restants = (genre: GenreDeFlux): FluxPropose[] => this.#exemple[genre].filter((g) => !this.dejaPris(g.name));
  /** Le montant que montre le raccourci d'un flux : celui de la version en vigueur à la date de lecture, à défaut la première. */
  readonly montantDuRaccourci = (g: FluxPropose) => versionMontree(g, this.#d.asOf).amount;
  /** Le compte du même nom, ici ; le compte principal se désigne par l'absence de nom. */
  readonly compteNomme = (nom: string) => this.accounts.find((a) => a.name === nom)?.id;
  /** Le compte que l'exemple donne à une ligne, ici : celui du même nom, à défaut le compte principal (D40). */
  readonly compteNommeOuPrincipal = (nom?: string) => (nom ? this.compteNomme(nom) : undefined) ?? this.#d.mainAccountId();
  /** Le compte d'un flux proposé : celui que l'exemple dit, quand il n'est pas le principal et qu'il existe ici ; sinon le compte principal (D40). */
  readonly compteDuFlux = (p: FlowSuggestion) => this.compteNommeOuPrincipal(p.accountName);
  /** Une version d'un flux de l'exemple, avec tout ce que l'exemple en dit : bornes, fenêtre, tolérance, motif, montant variable. */
  readonly #appliquerVersion = (p: FlowSuggestion, genre: GenreDeFlux) =>
    this.#d.upsert('plannedFlows', suggestedFlow(p, genre, { id: this.#d.newId(), accountId: this.compteDuFlux(p) }));
  /** Ce que fait un raccourci : le flux, avec toutes ses versions. */
  readonly appliquer = (g: FluxPropose, genre: GenreDeFlux) => g.versions.forEach((p) => this.#appliquerVersion(p, genre));
  /** Le garnissage d'office : chaque raccourci restant du genre repris. L'endroit décide s'il le fait (D46). */
  garnir(genre: GenreDeFlux) {
    this.restants(genre).forEach((g) => this.appliquer(g, genre));
  }

  // --- Formulaire d'ajout et ses aides (#214) ---
  saisies = $state<Record<GenreDeFlux, SaisieDeFlux>>(vide());
  avancees = $state<Record<GenreDeFlux, SaisieAvancee>>({ income: {}, fixedCharge: {} });
  erreurs = $state<Record<GenreDeFlux, string>>({ income: '', fixedCharge: '' });
  /**
   * La ligne d'où viennent toutes les aides du formulaire d'un genre (D43) : celle que le premier
   * raccourci restant apporterait, ou, quand il n'en reste aucun, la première ligne de l'exemple de ce genre.
   */
  readonly aide = (genre: GenreDeFlux): AideFlux | undefined => aideFlux(this.restants(genre), this.#exemple[genre], this.#d.asOf);
  /** L'aide du montant, comme on le saisit. */
  readonly aideDuMontant = (genre: GenreDeFlux): string | undefined => {
    const a = this.aide(genre);
    return a ? montantAide(a.amount) : undefined;
  };
  /** Ce que montrent les champs sans texte indicatif : ce qu'on y a posé, sinon la valeur de la ligne d'aide. */
  readonly valeurs = (genre: GenreDeFlux) => {
    const s = this.saisies[genre];
    const a = this.aide(genre);
    return {
      interval: s.interval ?? String(a?.interval ?? 1),
      unit: s.unit ?? a?.unit ?? ('month' as PeriodUnit),
      day: s.day ?? String(a?.day ?? GENRES_DE_FLUX[genre].jourParDefaut),
      accountId: s.accountId ?? this.compteNommeOuPrincipal(a?.version.accountName),
    };
  };
  /** Les aides des champs avancés qui montrent un texte indicatif : la tolérance en euros et le motif de la ligne d'aide, quand elle en a. */
  readonly aidesAvancees = (genre: GenreDeFlux): { toleranceAbs: string | undefined; labelPattern: string | undefined } => {
    const v = this.aide(genre)?.version;
    return { toleranceAbs: v?.amountTolerance?.abs !== undefined ? montantAide(v.amountTolerance.abs) : undefined, labelPattern: v?.labelPattern };
  };
  /** Ce que montrent les champs avancés (D59) : ce qu'on y a posé, sinon la valeur de la ligne d'aide. */
  readonly valeursAvancees = (genre: GenreDeFlux): ValeursAvancees => {
    const s = this.avancees[genre];
    const v = this.aide(genre)?.version;
    return {
      categoryId: s.categoryId ?? '',
      dateWindowDays: s.dateWindowDays ?? String(v?.dateWindowDays ?? 5),
      toleranceAbs: s.toleranceAbs ?? '',
      tolerancePct: s.tolerancePct ?? (v?.amountTolerance?.pct !== undefined ? String(v.amountTolerance.pct) : ''),
      labelPattern: s.labelPattern ?? '',
      activeFrom: s.activeFrom ?? v?.activeFrom ?? '',
      activeTo: s.activeTo ?? v?.activeTo ?? '',
      variable: s.variable ?? !!v?.variable,
      locks: s.locks ?? false,
    };
  };
  /** Rouvre le formulaire d'un genre vide, ses champs revenus à la ligne d'aide. */
  vider(genre: GenreDeFlux) {
    this.saisies[genre] = { name: '', amount: '' };
    this.avancees[genre] = {};
    this.erreurs[genre] = '';
  }

  /**
   * Les champs avancés recopient ceux de la ligne d'aide : aucune catégorie ni aucun verrouillage, que
   * l'exemple ne donne pas ; un champ texte vide, ou qui porte son aide ; les autres, la valeur de la ligne.
   */
  #recopieAvancee(genre: GenreDeFlux, a: AideFlux): boolean {
    const v = this.valeursAvancees(genre);
    const x = a.version;
    const texte = (saisi: string, aide: string | undefined) => saisi.trim() === '' || saisi.trim() === aide;
    const pct = v.tolerancePct.trim() === '' ? undefined : Number(v.tolerancePct);
    return (
      v.categoryId === '' &&
      !v.locks &&
      Number(v.dateWindowDays) === x.dateWindowDays &&
      (v.toleranceAbs.trim() === '' || inputToCents(v.toleranceAbs) === x.amountTolerance?.abs) &&
      pct === x.amountTolerance?.pct &&
      texte(v.labelPattern, x.labelPattern) &&
      v.activeFrom === (x.activeFrom ?? '') &&
      v.activeTo === (x.activeTo ?? '') &&
      v.variable === !!x.variable
    );
  }

  /**
   * Ajoute le flux saisi, du genre du formulaire. Une ligne dont chaque champ porte la valeur de son
   * aide fait ce que fait le raccourci de cette ligne, versions et sélection comprises (#214) ; sinon,
   * le flux saisi, avec les champs avancés quand l'endroit les montre (`avances`). Rend vrai s'il est ajouté.
   */
  ajouter(genre: GenreDeFlux, avances = false): boolean {
    const s = this.saisies[genre];
    const amount = inputToCents(s.amount);
    if (!s.name.trim()) return void (this.erreurs[genre] = GENRES_DE_FLUX[genre].sansNom), false;
    if (amount === undefined || amount <= 0) return void (this.erreurs[genre] = 'Indiquez un montant, en positif.'), false;
    const ev = this.valeurs(genre);
    const interval = Math.max(1, Number(ev.interval) || 1);
    const jour = Number(ev.day) || 1;
    const ligne = this.aide(genre);
    if (
      ligne &&
      recopieFlux({ name: s.name.trim(), amount, interval, unit: ev.unit, day: jour, accountId: ev.accountId }, ligne, this.compteDuFlux(ligne.version)) &&
      (!avances || this.#recopieAvancee(genre, ligne))
    ) {
      this.appliquer(ligne.ligne, genre);
      this.saisies[genre] = { name: '', amount: '' };
    } else {
      const row: PlannedFlow = {
        id: this.#d.newId(),
        name: s.name.trim(),
        kind: genre,
        amount: genre === 'income' ? amount : -amount,
        accountId: ev.accountId || this.#d.mainAccountId(),
        periodicity: { interval, unit: ev.unit, anchorDate: lastDayOnOrBefore(jour) },
        dateWindowDays: 5,
      };
      if (avances) {
        const refus = completerAvecLesChampsAvances(row, this.valeursAvancees(genre));
        if (refus) return void (this.erreurs[genre] = refus), false;
      }
      this.#d.upsert('plannedFlows', row);
      this.saisies[genre] = { ...s, name: '', amount: '' };
    }
    this.erreurs[genre] = '';
    return true;
  }

  // --- La ligne : correction sur place (D43, D47), retrait ---
  renommer(f: PlannedFlow, v: string) {
    if (v.trim() && v.trim() !== f.name) this.#d.upsert('plannedFlows', { ...f, name: v.trim() });
  }
  /** Le signe est porté par le genre du flux, pas par la saisie : on la prend en valeur absolue. */
  changerMontant(f: PlannedFlow, v: string) {
    const c = inputToCents(v);
    if (c === undefined) return;
    const signe = f.kind === 'income' ? Math.abs(c) : -Math.abs(c);
    if (signe !== f.amount) this.#d.upsert('plannedFlows', { ...f, amount: signe });
  }
  /** Rythme non mensuel : l'ancrage porte la date entière, dont toutes les occurrences découlent. */
  changerDate(f: PlannedFlow, v: string) {
    if (v && v !== f.periodicity.anchorDate) this.#d.upsert('plannedFlows', { ...f, periodicity: { ...f.periodicity, anchorDate: v } });
  }
  changerRythme(f: PlannedFlow, champ: 'interval' | 'unit', v: string) {
    const actuel = f.periodicity;
    const suivant = champ === 'interval' ? { ...actuel, interval: Math.max(1, Number(v) || 1) } : { ...actuel, unit: v as PeriodUnit };
    if (suivant.interval === actuel.interval && suivant.unit === actuel.unit) return;
    this.#d.upsert('plannedFlows', { ...f, periodicity: { ...suivant, anchorDate: f.periodicity.anchorDate } });
  }
  changerCompte(f: PlannedFlow, v: string) {
    if (v && v !== f.accountId) this.#d.upsert('plannedFlows', { ...f, accountId: v });
  }
  changerJour(f: PlannedFlow, v: string) {
    const d = Math.min(31, Math.max(1, Number(v) || 1));
    const { y, m } = parseDate(f.periodicity.anchorDate);
    const anchorDate = dateInMonth(y, m, Math.min(d, daysInMonth(y, m)));
    if (anchorDate !== f.periodicity.anchorDate) this.#d.upsert('plannedFlows', { ...f, periodicity: { ...f.periodicity, anchorDate } });
  }
  /** Retire le flux. `confirmer` est l'accord que l'endroit demande avant : l'écran Flux prévus le demande, l'assistant non. */
  retirer(f: PlannedFlow, confirmer: () => boolean = () => true) {
    if (confirmer()) this.#d.remove('plannedFlows', f.id);
  }
}

/**
 * Ancrage d'un flux sur le jour `day` : la dernière occurrence à cette date qui soit déjà passée.
 * L'ancrage étant la *première* occurrence (`nextOccurrence` ne remonte jamais avant), l'ancrer dans
 * le futur ferait disparaître le revenu de la période en cours.
 */
export function lastDayOnOrBefore(day: number): string {
  const today = todayISO();
  const { y, m } = parseDate(today);
  const clamp = (yy: number, mm: number) => dateInMonth(yy, mm, Math.min(Math.max(1, day), daysInMonth(yy, mm)));
  const here = clamp(y, m);
  if (here <= today) return here;
  return m === 1 ? clamp(y - 1, 12) : clamp(y, m - 1);
}

/** Les champs avancés d'un flux (D59), tels que les formulaires de l'écran les montrent : des textes, des cases. */
export type ChampsAvancesDuFlux = ValeursAvancees;

/**
 * Pose sur le flux ce que disent ses champs avancés (D59) : fenêtre, tolérances, motif, dates de
 * validité, montant variable, et, dans son action (D24), la catégorie et le verrouillage — les parts
 * de l'action restent telles qu'elles sont (#393, point 11). Un champ vide retire ce qu'il portait.
 * Rend le refus, quand un motif de libellé n'est pas une expression régulière ; rien sinon.
 */
export function completerAvecLesChampsAvances(row: PlannedFlow, v: ChampsAvancesDuFlux): string {
  const motif = v.labelPattern.trim();
  if (motif) {
    try {
      new RegExp(motif, 'i');
    } catch {
      return 'Motif de libellé invalide (expression régulière).';
    }
  }
  const tolAbs = inputToCents(v.toleranceAbs);
  const tolPct = v.tolerancePct.trim() ? Number(v.tolerancePct) : undefined;
  row.dateWindowDays = Math.max(0, Number(v.dateWindowDays) || 0);
  delete row.amountTolerance;
  if (tolAbs !== undefined || tolPct !== undefined) row.amountTolerance = { ...(tolAbs !== undefined ? { abs: tolAbs } : {}), ...(tolPct !== undefined ? { pct: tolPct } : {}) };
  delete row.labelPattern;
  if (motif) row.labelPattern = motif;
  delete row.variable;
  if (v.variable) row.variable = true;
  delete row.activeFrom;
  if (v.activeFrom) row.activeFrom = v.activeFrom;
  delete row.activeTo;
  if (v.activeTo) row.activeTo = v.activeTo;
  const action: FlowAction = { ...row.action };
  if (v.categoryId) action.categoryId = v.categoryId;
  else delete action.categoryId;
  if (v.locks) action.state = 'lock';
  else delete action.state;
  delete row.action;
  if (Object.keys(action).length) row.action = action;
  return '';
}
