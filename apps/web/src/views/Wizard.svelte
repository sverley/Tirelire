<!--
  Assistant de configuration (D40) : construire un budget en répondant à des questions simples,
  pas en remplissant les écrans de configuration. Chaque réponse prépare les objets du modèle
  (tirelires, besoins, flux prévus) sans que l'utilisateur ait à connaître ces mots.
  L'assistant n'écrit dans le projet qu'à sa validation, au résumé : jusque-là il lit et écrit son
  brouillon (`app.assistantLedger`, `app.assistantUpsert`…), jamais le projet. Quitter l'assistant
  sans valider n'enregistre rien.
  Le compte principal existe dans toute base : l'assistant en renseigne les informations, il ne le
  crée pas ; les autres comptes sont proposés, jamais imposés.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import Manque from '../lib/Manque.svelte';
  import { ACCOUNT_KINDS, UNITS, money, periodicityLabel, shortDate, centsToInput, inputToCents, openAccounts, validityBadge, validityLabel } from '../lib/format';
  import {
    activeAt,
    alive,
    addDays,
    divideCents,
    dateInMonth,
    dueDateShortfalls,
    shortfallsForPeriod,
    parseDate,
    todayISO,
    daysInMonth,
    budgetPeriodContaining,
    needName,
    nextOccurrence,
    budgetSuggestions,
    findCategoryByName,
    suggestedCategory,
    suggestedFlow,
    suggestedNeed,
    suggestedTirelire,
    suggestedOrder,
    monthsOf,
    DEFAULT_PRIORITY,
    DEFAULT_MAIN_ACCOUNT,
    MAIN_ACCOUNT_ID,
    type Account,
    type PeriodUnit,
    type AccountKind,
    type SettlementDirection,
    type Category,
    type CategoryNature,
    type CategorySuggestion,
    type Cents,
    type FlowSuggestion,
    type OrderSuggestion,
    type TirelireSuggestion,
    type Tirelire,
    type Need,
    type PlannedFlow,
  } from '@tirelire/core';
  import {
    aideCategorie,
    aideCompte,
    aideCourant,
    aideEpargne,
    aideFlux,
    aideBesoin,
    aidePeriodique,
    montantAide,
    montantDeLaTirelire,
    parNom,
    recopieBesoin,
    recopieCategorie,
    recopieCompte,
    recopieCourant,
    recopieEpargne,
    recopieFlux,
    recopiePeriodique,
    versionMontree,
    type FluxPropose,
  } from '../lib/aides';

  type Step = 'intro' | 'income' | 'fixed' | 'everyday' | 'periodic' | 'savings' | 'categories' | 'accounts' | 'summary';

  const STEPS: Array<{ id: Step; label: string }> = [
    { id: 'intro', label: 'Le principe' },
    { id: 'accounts', label: 'Comptes' },
    { id: 'income', label: 'Revenus' },
    { id: 'fixed', label: 'Charges fixes' },
    { id: 'everyday', label: 'Budgets' },
    { id: 'periodic', label: 'Pas tous les mois' },
    { id: 'savings', label: 'Épargne' },
    { id: 'categories', label: 'Catégories' },
    { id: 'summary', label: 'Résumé' },
  ];

  /**
   * Le brouillon : ce que l'assistant prépare, tenu par l'application. On y retrouve, en revenant, ce
   * qui a été préparé et l'étape où l'on s'était arrêté ; il n'entre dans le projet qu'à la validation.
   */
  const brouillon = app.ouvrirAssistant();

  let step = $state<Step>(untrack(() => brouillon.etape as Step));
  const stepIndex = $derived(STEPS.findIndex((s) => s.id === step));
  /** Le budget est validé : il est entré dans le projet, et l'assistant n'a plus rien à préparer. */
  let valide = $state(false);
  let erreurValidation = $state('');

  const accounts = $derived(alive(app.assistantLedger.accounts));
  const tirelires = $derived(alive(app.assistantLedger.tirelires));
  const needs = $derived(alive(app.assistantLedger.needs));
  const flows = $derived(alive(app.assistantLedger.plannedFlows));
  const categories = $derived(alive(app.assistantLedger.categories));
  const principal = $derived(accounts.find((a) => a.kind === 'principal'));
  const otherAccounts = $derived(accounts.filter((a) => a.kind !== 'principal'));
  /** Les comptes des menus : un compte clos n'en fait plus partie (D56) ; il reste listé à l'étape Comptes. */
  const comptesOuverts = $derived(openAccounts(accounts, app.asOf));
  const incomes = $derived(flows.filter((f) => f.kind === 'income'));
  const fixedCharges = $derived(flows.filter((f) => f.kind === 'fixedCharge'));
  const tirelireById = (id: string) => tirelires.find((e) => e.id === id);
  const plan = $derived(app.assistantPlan);
  const totals = $derived(plan.totals);
  /**
   * Ce que le Plan de la période en cours annoncera une fois l'assistant validé : ses annonces, et ses
   * échéances en manque, lues comme le Plan les lit (`Plan.svelte`) mais sur ce que l'assistant montre.
   * Le résumé les dit toutes : rien ne se cache (principe 4), et il ne dit « Tout est finançable » que
   * si le Plan n'en annonce aucune.
   */
  const manques = $derived(shortfallsForPeriod(dueDateShortfalls(app.assistantLedger, app.asOf), plan.period, app.asOf));
  const nbAnnonces = $derived(plan.warnings.length + manques.length);

  /**
   * Ancrage d'un flux sur le jour `day` : la dernière occurrence à cette date qui soit déjà
   * passée. L'ancrage étant la *première* occurrence (`nextOccurrence` ne remonte jamais avant),
   * l'ancrer dans le futur ferait disparaître le revenu de la période en cours.
   */
  function lastDayOnOrBefore(day: number): string {
    const today = todayISO();
    const { y, m } = parseDate(today);
    const clamp = (yy: number, mm: number) => dateInMonth(yy, mm, Math.min(Math.max(1, day), daysInMonth(yy, mm)));
    const here = clamp(y, m);
    if (here <= today) return here;
    return m === 1 ? clamp(y - 1, 12) : clamp(y, m - 1);
  }
  /**
   * Date d'ouverture d'une tirelire : le début de la période en cours. La chronologie ne
   * démarre qu'à la première période entièrement postérieure à l'ouverture ; ouvrir « aujourd'hui »
   * priverait donc le budget de sa toute première période.
   */
  const periodStart = () => budgetPeriodContaining(app.asOf, Number(startDay) || 1).start;
  const perPeriod = (amount: Cents, months: number) => divideCents(amount, Math.max(1, months));

  /**
   * Le compte principal existe dans toute base, sous la même identité partout (D40, D58) :
   * l'assistant ne le crée jamais, il y rattache ce qu'il écrit et en renseigne les informations.
   */
  function mainAccountId(): string {
    return principal?.id ?? MAIN_ACCOUNT_ID;
  }

  function goStep(s: Step) {
    catLigneError = '';
    catError = '';
    step = s;
    brouillon.etape = s;
    semer(s);
  }
  function next() {
    if (stepIndex < STEPS.length - 1) goStep(STEPS[stepIndex + 1]!.id);
  }
  function prev() {
    if (stepIndex > 0) goStep(STEPS[stepIndex - 1]!.id);
  }

  // --- Début de la période budgétaire : un choix du foyer, pas un champ de compte (D44) ---
  // Valeur initiale volontairement figée : le champ est ensuite piloté par la saisie.
  let startDay = $state(untrack(() => String(app.assistantLedger.settings.periodStartDay)));
  function saveStartDay() {
    const d = Math.min(31, Math.max(1, Number(startDay) || 1));
    startDay = String(d);
    if (app.assistantLedger.settings.periodStartDay !== d) app.assistantSetSetting('periodStartDay', d);
    recalerLesClotures();
  }
  /** Jour du plus gros revenu déclaré : ce que l'assistant propose comme début de période. */
  const jourDuRevenu = $derived.by(() => {
    const principal = [...incomes].sort((a, b) => b.amount - a.amount)[0];
    return principal ? parseDate(principal.periodicity.anchorDate).d : undefined;
  });

  // --- Revenus ---
  /**
   * Les champs du formulaire d'ajout d'un flux. Le nom et le montant se saisissent, et leur aide est
   * un texte indicatif ; les autres champs, tant qu'on n'y a pas touché (`undefined`), prennent la
   * valeur de la ligne d'aide (#214) : une liste, un nombre ne montrent pas de texte indicatif.
   */
  type SaisieDeFlux = { name: string; amount: string; interval?: string | undefined; unit?: PeriodUnit | undefined; day?: string | undefined; accountId?: string | undefined };
  let inc = $state<SaisieDeFlux>({ name: '', amount: '' });
  let incError = $state('');
  function creerRevenu(nom: string, montant: number, interval: number, unit: PeriodUnit, jour: number, compte?: string) {
    const row: PlannedFlow = {
      id: app.newId(),
      name: nom,
      kind: 'income',
      amount: montant,
      accountId: compte || mainAccountId(),
      periodicity: { interval, unit, anchorDate: lastDayOnOrBefore(jour) },
      dateWindowDays: 5,
    };
    app.assistantUpsert('plannedFlows', row);
  }
  function addIncome() {
    const amount = inputToCents(inc.amount);
    if (!inc.name.trim()) return void (incError = 'Donnez un nom à cette rentrée d’argent.');
    if (amount === undefined || amount <= 0) return void (incError = 'Indiquez un montant, en positif.');
    const interval = Math.max(1, Number(evRevenu.interval) || 1);
    const jour = Number(evRevenu.day) || 1;
    // Une ligne dont chaque champ porte la valeur de son aide fait ce que fait le raccourci de cette ligne (#214).
    const ligne = aideRevenu;
    if (ligne && recopieFlux({ name: inc.name.trim(), amount, interval, unit: evRevenu.unit, day: jour, accountId: evRevenu.accountId }, ligne, compteDuFlux(ligne.version))) {
      appliquerRevenu(ligne.ligne);
      inc = { name: '', amount: '' };
    } else {
      creerRevenu(inc.name.trim(), amount, interval, evRevenu.unit, jour, evRevenu.accountId);
      inc = { ...inc, name: '', amount: '' };
    }
    incError = '';
  }

  // --- Charges fixes : montant fixe, tous les mois, sans réserve à constituer ---
  let fix = $state<SaisieDeFlux>({ name: '', amount: '' });
  let fixError = $state('');
  function creerCharge(nom: string, montant: number, interval: number, unit: PeriodUnit, jour: number, compte?: string) {
    const row: PlannedFlow = {
      id: app.newId(),
      name: nom,
      kind: 'fixedCharge',
      amount: -montant,
      accountId: compte || mainAccountId(),
      periodicity: { interval, unit, anchorDate: lastDayOnOrBefore(jour) },
      dateWindowDays: 5,
    };
    app.assistantUpsert('plannedFlows', row);
  }
  function addFixed() {
    const amount = inputToCents(fix.amount);
    if (!fix.name.trim()) return void (fixError = 'Donnez un nom à cette charge.');
    if (amount === undefined || amount <= 0) return void (fixError = 'Indiquez un montant, en positif.');
    const interval = Math.max(1, Number(evCharge.interval) || 1);
    const jour = Number(evCharge.day) || 1;
    const ligne = aideCharge;
    if (ligne && recopieFlux({ name: fix.name.trim(), amount, interval, unit: evCharge.unit, day: jour, accountId: evCharge.accountId }, ligne, compteDuFlux(ligne.version))) {
      appliquerCharge(ligne.ligne);
      fix = { name: '', amount: '' };
    } else {
      creerCharge(fix.name.trim(), amount, interval, evCharge.unit, jour, evCharge.accountId);
      fix = { ...fix, name: '', amount: '' };
    }
    fixError = '';
  }

  // --- Budgets courants : une tirelire + un besoin récurrent ---
  /** Le report se coche ou se décoche ; tant qu'on n'y a pas touché (`undefined`), il est celui de la ligne d'aide (#214). */
  let day = $state<{ name: string; amount: string; keep?: boolean | undefined }>({ name: '', amount: '' });
  let dayError = $state('');
  function creerCourant(nom: string, montant: number, garde: boolean) {
    const tirelireId = app.newId();
    app.assistantUpsert('tirelires', {
      id: tirelireId,
      name: nom,
      placement: [],
      openingBalance: 0,
      openingDate: periodStart(),
      rollover: { mode: garde ? 'unlimited' : 'none' },
    } satisfies Tirelire);
    app.assistantUpsert('needs', {
      id: app.newId(),
      tirelireId,
      kind: 'recurring',
      amount: montant,
      periodicity: { interval: 1, unit: 'month' as const, anchorDate: periodStart() },
      priority: DEFAULT_PRIORITY.recurring,
    } satisfies Need);
  }
  function addEveryday() {
    const amount = inputToCents(day.amount);
    if (!day.name.trim()) return void (dayError = 'Donnez un nom à ce budget.');
    if (amount === undefined || amount <= 0) return void (dayError = 'Indiquez un montant par période.');
    const ligne = aideBudget;
    if (ligne && recopieCourant({ name: day.name.trim(), amount, keep: gardeBudget }, ligne)) {
      appliquerTirelire(ligne.ligne);
      day = { name: '', amount: '' };
    } else {
      creerCourant(day.name.trim(), amount, gardeBudget);
      day = { name: '', amount: '', keep: day.keep };
    }
    dayError = '';
  }
  // --- Un besoin de plus sur une tirelire de l'étape (D28) : un nom et un montant par période ---
  /** Le besoin de l'exemple dont viennent les aides du formulaire : « Cours de piano », 45,00 (#344, #214). */
  const aideBesoinAjoute = aideBesoin();
  /** La saisie et l'erreur du formulaire d'ajout de chaque carte, par tirelire. */
  let ajoutBesoin = $state<Record<string, { name: string; amount: string; error: string }>>({});
  const saisieDuBesoin = (t: Tirelire) => ajoutBesoin[t.id] ?? { name: '', amount: '', error: '' };
  /**
   * Ajoute un besoin par période à la tirelire : en vigueur dès la période en cours, sans date de fin,
   * avec la priorité par défaut. Un formulaire qui recopie ses aides fait ce que fait le raccourci du
   * besoin de l'exemple, date de début comprise (#214).
   */
  function addNeedTo(t: Tirelire) {
    const s = saisieDuBesoin(t);
    const nom = s.name.trim();
    const montant = inputToCents(s.amount);
    if (!nom) return void (ajoutBesoin[t.id] = { ...s, error: 'Donnez un nom à ce besoin.' });
    if (montant === undefined || montant <= 0) return void (ajoutBesoin[t.id] = { ...s, error: 'Indiquez un montant par période, en positif.' });
    if (aideBesoinAjoute && recopieBesoin({ name: nom, amount: montant }, aideBesoinAjoute)) {
      app.assistantUpsert('needs', suggestedNeed(aideBesoinAjoute.ligne, { id: app.newId(), tirelireId: t.id }));
    } else {
      app.assistantUpsert('needs', {
        id: app.newId(),
        tirelireId: t.id,
        kind: 'recurring',
        name: nom,
        amount: montant,
        periodicity: { interval: 1, unit: 'month' as const, anchorDate: periodStart() },
        priority: DEFAULT_PRIORITY.recurring,
      } satisfies Need);
    }
    ajoutBesoin[t.id] = { name: '', amount: '', error: '' };
  }

  // --- Dépenses qui ne tombent pas tous les mois : tirelire + besoin à échéance + flux ---
  /** Le rythme, l'échéance, le compte et le prélèvement, tant qu'on n'y a pas touché (`undefined`), sont ceux de la ligne d'aide (#214). */
  let per = $state<{ name: string; amount: string; months?: string | undefined; dueDate?: string | undefined; withFlow?: boolean | undefined; accountId?: string | undefined }>({ name: '', amount: '' });
  let perError = $state('');
  const perPreview = $derived.by(() => {
    const a = inputToCents(per.amount);
    return a === undefined || a <= 0 ? undefined : perPeriod(a, Number(evEcheance.months) || 1);
  });
  function creerPeriodique(nom: string, montant: number, mois: number, echeance: string, compte?: string, avecFlux = true) {
    const tirelireId = app.newId();
    app.assistantUpsert('tirelires', {
      id: tirelireId,
      name: nom,
      placement: [],
      openingBalance: 0,
      openingDate: periodStart(),
      rollover: { mode: 'unlimited' },
    } satisfies Tirelire);
    app.assistantUpsert('needs', {
      id: app.newId(),
      tirelireId,
      kind: 'dueDate',
      amount: montant,
      periodicity: { interval: mois, unit: 'month' as const, anchorDate: echeance },
      priority: DEFAULT_PRIORITY.dueDate,
    } satisfies Need);
    if (avecFlux) {
      app.assistantUpsert('plannedFlows', {
        id: app.newId(),
        name: nom,
        kind: 'dueDate',
        amount: -montant,
        accountId: compte || mainAccountId(),
        tirelireId,
        periodicity: { interval: mois, unit: 'month' as const, anchorDate: echeance },
        dateWindowDays: 7,
      } satisfies PlannedFlow);
    }
  }
  function addPeriodic() {
    const amount = inputToCents(per.amount);
    if (!per.name.trim()) return void (perError = 'Donnez un nom à cette dépense.');
    if (amount === undefined || amount <= 0) return void (perError = 'Indiquez le montant de la facture.');
    const echeance = evEcheance.dueDate;
    if (!echeance) return void (perError = 'Indiquez la date de la prochaine échéance.');
    const mois = Math.max(1, Number(evEcheance.months) || 1);
    const ligne = aideEcheance;
    if (ligne && recopiePeriodique({ name: per.name.trim(), amount, months: mois, dueDate: echeance, withFlow: evEcheance.withFlow, accountId: evEcheance.accountId }, ligne, compteNommeOuPrincipal(ligne.accountName))) {
      appliquerTirelire(ligne.ligne);
      per = { name: '', amount: '' };
    } else {
      creerPeriodique(per.name.trim(), amount, mois, echeance, evEcheance.accountId, evEcheance.withFlow);
      per = { ...per, name: '', amount: '', dueDate: undefined };
    }
    perError = '';
  }

  // --- Épargne : tirelire + besoin objectif ---
  let sav = $state({ name: '', monthly: '', target: '' });
  let savError = $state('');
  const savPreview = $derived.by(() => {
    const m = inputToCents(sav.monthly);
    const t = inputToCents(sav.target);
    if (m === undefined || m <= 0 || t === undefined || t <= 0) return undefined;
    return Math.ceil(t / m);
  });
  function creerEpargne(nom: string, mensuel: number, cible?: number) {
    const tirelireId = app.newId();
    app.assistantUpsert('tirelires', {
      id: tirelireId,
      name: nom,
      placement: [],
      openingBalance: 0,
      openingDate: periodStart(),
      rollover: { mode: 'unlimited' },
    } satisfies Tirelire);
    app.assistantUpsert('needs', {
      id: app.newId(),
      tirelireId,
      kind: 'goal',
      monthlyAmount: mensuel,
      priority: DEFAULT_PRIORITY.goal,
      ...(cible !== undefined && cible > 0 ? { amount: cible } : {}),
    } satisfies Need);
  }
  function addSavings() {
    const monthly = inputToCents(sav.monthly);
    if (!sav.name.trim()) return void (savError = 'Donnez un nom à cet objectif.');
    if (monthly === undefined || monthly <= 0) return void (savError = 'Indiquez combien mettre de côté par période.');
    const cible = inputToCents(sav.target);
    const ligne = aideObjectif;
    if (ligne && recopieEpargne({ name: sav.name.trim(), monthly, target: cible }, ligne)) appliquerTirelire(ligne.ligne);
    else creerEpargne(sav.name.trim(), monthly, cible);
    sav = { name: '', monthly: '', target: '' };
    savError = '';
  }

  // --- Comptes complémentaires (facultatif) et placement des réserves ---
  /** Natures proposées, hors compte principal. Typée : un genre renommé casse la compilation. */
  const NATURES: Array<Exclude<AccountKind, 'principal'>> = ['courant', 'epargne'];
  /** Le sens autorisé des virements de règlement d'un compte tiers, en clair. */
  const SENS_DE_REGLEMENT: Record<SettlementDirection, string> = {
    both: 'dans les deux sens',
    toThird: 'du compte principal vers ce compte seulement',
    fromThird: 'de ce compte vers le compte principal seulement',
  };
  /** Le type se choisit ; tant qu'on n'y a pas touché (`undefined`), il est celui de la ligne d'aide (#214). Un solde laissé vide est un solde nul. */
  let acc = $state<{ name: string; kind?: Exclude<AccountKind, 'principal'> | undefined; balance: string }>({ name: '', balance: '' });
  let accError = $state('');
  function addAccount() {
    if (!acc.name.trim()) return void (accError = 'Donnez un nom à ce compte.');
    const openingBalance = acc.balance.trim() ? inputToCents(acc.balance) : 0;
    if (openingBalance === undefined) return void (accError = 'Solde invalide.');
    const ligne = aideDeCompte;
    if (ligne && recopieCompte({ name: acc.name.trim(), kind: typeDeCompte, balance: openingBalance }, ligne)) {
      appliquerCompte(ligne.ligne);
    } else {
      const row: Account = {
        id: app.newId(),
        name: acc.name.trim(),
        kind: typeDeCompte,
        openingBalance,
        openingDate: todayISO(),
      };
      app.assistantUpsert('accounts', row);
    }
    acc = { name: '', balance: '' };
    accError = '';
  }
  /** Placement voulu d'une tirelire (D38) : tout sur un compte, ou rien de déclaré. */
  function setPlacement(e: Tirelire, accountId: string) {
    const placement = accountId ? [{ accountId, share: { kind: 'variable' as const } }] : [];
    app.assistantUpsert('tirelires', { ...e, placement });
  }
  /**
   * Retire un compte de l'assistant, et ce qui ne tient que par lui : la part du placement d'une
   * tirelire qui y dort — elle n'a plus de placement, et ne produit aucun écart (D38) — et l'ordre
   * permanent qui en part ou y arrive.
   */
  function retirerCompte(a: Account) {
    app.assistantRemove('accounts', a.id);
    for (const t of tirelires) {
      if (t.placement.some((p) => p.accountId === a.id)) {
        app.assistantUpsert('tirelires', { ...t, placement: t.placement.filter((p) => p.accountId !== a.id) });
      }
    }
    for (const f of ordres) {
      if (f.accountId === a.id || f.counterpartAccountId === a.id) app.assistantRemove('plannedFlows', f.id);
    }
  }

  // --- Ordres permanents déjà posés chez la banque (D60) : ce qu'ils exécutent est un fait, le seul montant qui s'enregistre ---
  const ordres = $derived(flows.filter((f) => f.kind === 'transfer' && f.origin === 'derived'));
  const nomDuCompte = (id?: string) => accounts.find((a) => a.id === id)?.name ?? '';
  /** Ce que le budget de l'assistant demande comme ordre permanent vers ce compte (D60) : un calcul, relu à chaque lecture. */
  const demandeVers = (accountId?: string) => app.assistantPlan.transfers.find((t) => t.accountId === accountId)?.permanent ?? 0;

  /**
   * Les propositions ne s'offrent que sur un projet vierge (D43), tel qu'il était à l'ouverture de
   * l'assistant : l'état est figé dans le brouillon, sinon la première ligne préparée ferait
   * disparaître les propositions suivantes. Sur un projet existant, l'assistant part de son contenu.
   */
  const projetVierge = brouillon.projetVierge;

  // --- Propositions (D43) : elles ne se présentent que dans l'assistant, rien n'entre d'office dans le projet (D40) ---
  // Les raccourcis sont toujours offerts : l'interface ne change pas d'un projet à l'autre (D46).
  // Flux et besoins se proposent avec toutes leurs versions, chacune avec ses dates, quelle que soit
  // la date de lecture (D51) : seul le montant d'un raccourci suit la version en vigueur.
  const propositions = budgetSuggestions();
  /** Un raccourci déjà repris disparaît : on ne propose pas ce qui existe déjà. */
  const dejaPris = (nom: string) => flows.some((f) => f.name === nom) || tirelires.some((t) => t.name === nom);
  // Un flux proposé (`FluxPropose`) : toutes ses versions, regroupées par leur nom dans l'ordre de
  // l'exemple (`parNom`). Un raccourci apporte le flux avec toutes ses versions, et disparaît dès
  // qu'un flux du même nom existe (D46, D51).
  /** Le montant que montre le raccourci d'un flux : celui de la version en vigueur à la date de lecture, à défaut la première. */
  const montantDuRaccourci = (g: FluxPropose) => versionMontree(g, app.asOf).amount;
  const restantsRevenus = $derived(parNom(propositions.incomes).filter((g) => !dejaPris(g.name)));
  const restantsCharges = $derived(parNom(propositions.charges).filter((g) => !dejaPris(g.name)));
  /** L'étape où se lit un besoin : celle de son genre. */
  type EtapeTirelire = 'everyday' | 'periodic' | 'savings';
  const GENRE_DE_L_ETAPE: Record<EtapeTirelire, Need['kind']> = { everyday: 'recurring', periodic: 'dueDate', savings: 'goal' };
  /** L'étape d'une tirelire proposée : celle de ses besoins — une échéance d'abord, puis un objectif, sinon un budget. */
  const etapeDe = (p: TirelireSuggestion): EtapeTirelire =>
    p.needs.some((n) => n.kind === 'dueDate') ? 'periodic' : p.needs.some((n) => n.kind === 'goal') ? 'savings' : 'everyday';
  /** Les tirelires d'une étape : celles qui y ont un besoin, chacune avec ses besoins de ce genre, dans l'ordre où ils sont venus. */
  function parTirelire(etape: EtapeTirelire): Array<{ t: Tirelire; besoins: Need[] }> {
    const genre = GENRE_DE_L_ETAPE[etape];
    return tirelires
      .map((t) => ({ t, besoins: needs.filter((n) => n.tirelireId === t.id && n.kind === genre) }))
      .filter((x) => x.besoins.length > 0);
  }
  const tirelireCourantes = $derived(parTirelire('everyday'));
  const tirelirePeriodiques = $derived(parTirelire('periodic'));
  const tirelireEpargnes = $derived(parTirelire('savings'));
  const restantesTirelires = (etape: EtapeTirelire) => propositions.tirelires.filter((x) => etapeDe(x) === etape && !dejaPris(x.name));
  const restantsCourants = $derived(restantesTirelires('everyday'));
  const restantsPeriodiques = $derived(restantesTirelires('periodic'));
  const restantsEpargnes = $derived(restantesTirelires('savings'));
  // Le montant que montre le raccourci d'une tirelire (`montantDeLaTirelire`) : celui de son besoin en vigueur à la date de lecture, à défaut le premier.
  /** Le compte du même nom, ici ; le compte principal se désigne par l'absence de nom. */
  const compteNomme = (nom: string) => accounts.find((a) => a.name === nom)?.id;
  /** Un ordre de l'exemple ne se propose que si ses deux comptes sont ici, et qu'aucun flux ne porte déjà son nom (D46). */
  const restantsOrdres = $derived(
    propositions.orders.filter((o) => !dejaPris(o.name) && suggestedOrder(o, { id: '', principalId: mainAccountId(), compte: compteNomme }) !== undefined),
  );
  /** Un compte dont le nom existe déjà n'est plus proposé : les comptes se reconnaissent à leur nom (D46). */
  const restantsComptes = $derived(propositions.accounts.filter((x) => !accounts.some((a) => a.name === x.name)));
  /** Une catégorie de même nature et de même nom n'est plus proposée : une catégorie se reconnaît à sa nature et à son nom (D46, D61). */
  const restantesCategories = $derived(propositions.categories.filter((p) => !findCategoryByName(categories, p.name, p.nature)));

  // --- Aides des champs (#214) : ce que les champs vides d'un formulaire d'ajout laissent lire ---
  // Elles viennent de l'exemple (`../lib/aides`), d'une même ligne par formulaire : celle que le
  // premier raccourci restant de l'étape apporterait, ou, quand il n'en reste aucun, la première
  // ligne de l'exemple de cette étape. Un champ qui ne montre pas de texte indicatif — liste, case,
  // date, nombre — prend la valeur de cette ligne tant qu'on n'y a pas touché ; et ajouter une ligne
  // dont chaque champ porte la valeur de son aide fait ce que fait le raccourci de cette ligne.
  const toutesLesTirelires = (etape: EtapeTirelire) => propositions.tirelires.filter((x) => etapeDe(x) === etape);
  const aideRevenu = $derived(aideFlux(restantsRevenus, parNom(propositions.incomes), app.asOf));
  const aideCharge = $derived(aideFlux(restantsCharges, parNom(propositions.charges), app.asOf));
  const aideBudget = $derived(aideCourant(restantsCourants, toutesLesTirelires('everyday'), app.asOf));
  const aideEcheance = $derived(aidePeriodique(restantsPeriodiques, toutesLesTirelires('periodic'), app.asOf));
  const aideObjectif = $derived(aideEpargne(restantsEpargnes, toutesLesTirelires('savings'), app.asOf));
  const aideDeCategorie = $derived(aideCategorie(restantesCategories, propositions.categories));
  const aideDeCompte = $derived(aideCompte(restantsComptes, propositions.accounts));
  /** Le compte que l'exemple donne à une ligne, ici : celui du même nom, à défaut le compte principal (D40). */
  const compteNommeOuPrincipal = (nom?: string) => (nom ? compteNomme(nom) : undefined) ?? mainAccountId();
  /** Ce que montrent les champs sans texte indicatif d'un flux : ce qu'on y a posé, sinon la valeur de la ligne d'aide. */
  const evRevenu = $derived({
    interval: inc.interval ?? String(aideRevenu?.interval ?? 1),
    unit: inc.unit ?? aideRevenu?.unit ?? ('month' as PeriodUnit),
    day: inc.day ?? String(aideRevenu?.day ?? 1),
    accountId: inc.accountId ?? compteNommeOuPrincipal(aideRevenu?.version.accountName),
  });
  const evCharge = $derived({
    interval: fix.interval ?? String(aideCharge?.interval ?? 1),
    unit: fix.unit ?? aideCharge?.unit ?? ('month' as PeriodUnit),
    day: fix.day ?? String(aideCharge?.day ?? 5),
    accountId: fix.accountId ?? compteNommeOuPrincipal(aideCharge?.version.accountName),
  });
  const gardeBudget = $derived(day.keep ?? aideBudget?.keep ?? false);
  const evEcheance = $derived({
    months: per.months ?? String(aideEcheance?.months ?? 12),
    dueDate: per.dueDate ?? aideEcheance?.dueDate ?? '',
    withFlow: per.withFlow ?? aideEcheance?.withFlow ?? true,
    accountId: per.accountId ?? compteNommeOuPrincipal(aideEcheance?.accountName),
  });
  const natureDeCategorie = $derived.by((): CategoryNature => cat.nature ?? aideDeCategorie?.nature ?? 'expense');
  const typeDeCompte = $derived<Exclude<AccountKind, 'principal'>>(acc.kind ?? aideDeCompte?.kind ?? 'courant');

  // Ce que fait un clic sur un raccourci : créer la ligne, dans l'assistant.
  /**
   * Le compte d'un flux proposé : celui que l'exemple dit, quand il n'est pas le principal et qu'il
   * existe ici ; sinon le compte principal (D40).
   */
  const compteDuFlux = (p: FlowSuggestion) =>
    (p.accountName ? accounts.find((a) => a.name === p.accountName)?.id : undefined) ?? mainAccountId();
  /** Une version d'un flux de l'exemple, avec tout ce que l'exemple en dit : bornes, fenêtre, tolérance, motif, montant variable. */
  const appliquerVersion = (p: FlowSuggestion, genre: 'income' | 'fixedCharge') =>
    app.assistantUpsert('plannedFlows', suggestedFlow(p, genre, { id: app.newId(), accountId: compteDuFlux(p) }));
  const appliquerRevenu = (g: FluxPropose) => g.versions.forEach((p) => appliquerVersion(p, 'income'));
  const appliquerCharge = (g: FluxPropose) => g.versions.forEach((p) => appliquerVersion(p, 'fixedCharge'));
  /**
   * Une tirelire de l'exemple, avec ce que l'exemple en dit : tous ses besoins, son reliquat, ce
   * qui y est déjà mis de côté, son placement si le compte est ici, et le prélèvement qu'attend
   * chacune de ses échéances. Ouverte au début de la période en cours (D40).
   */
  function appliquerTirelire(p: TirelireSuggestion) {
    const cree = suggestedTirelire(p, {
      id: app.newId(),
      newId: () => app.newId(),
      openingDate: periodStart(),
      principalId: mainAccountId(),
      compte: compteNomme,
    });
    app.assistantUpsert('tirelires', cree.tirelire);
    for (const n of cree.needs) app.assistantUpsert('needs', n);
    for (const f of cree.flows) app.assistantUpsert('plannedFlows', f);
  }
  /** L'ordre de l'exemple, déjà posé chez la banque : il s'enregistre à la validation, comme ce que la banque exécute (D60). */
  function appliquerOrdre(p: OrderSuggestion) {
    const f = suggestedOrder(p, { id: app.newId(), principalId: mainAccountId(), compte: compteNomme });
    if (f) app.assistantUpsert('plannedFlows', f);
  }
  /**
   * Une catégorie de l'exemple, avec ses liens vers ce qui existe ici, par noms (D46) : sa tirelire
   * par défaut quand une tirelire porte le nom que l'exemple dit — sinon elle se garde sans (D32, I3) —,
   * et chaque flux que l'exemple lui donne : le flux de même nom et de même genre, quand il n'a pas
   * déjà une catégorie, que celle posée l'emporte.
   */
  function appliquerCategorie(p: CategorySuggestion) {
    const id = app.newId();
    const tirelire = p.tirelireName === undefined ? undefined : tirelires.find((t) => t.name === p.tirelireName);
    app.assistantUpsert('categories', suggestedCategory(p, { id, ...(tirelire ? { tirelireId: tirelire.id } : {}) }));
    for (const lie of p.flows) {
      for (const f of flows.filter((x) => x.name === lie.name && x.kind === lie.kind && x.categoryId === undefined)) {
        app.assistantUpsert('plannedFlows', { ...f, categoryId: id });
      }
    }
  }
  /**
   * La clôture d'un compte clos de l'exemple : la veille du premier jour de la période en cours, de
   * sorte qu'il ne pèse rien sur le plan (D56). La période commence au jour que l'assistant retient
   * — il se choisit à l'étape des revenus, après l'étape Comptes qui sème le compte.
   */
  const clotureDeLExemple = () => addDays(periodStart(), -1);
  /**
   * Recale la clôture des comptes clos que l'assistant a lui-même créés sur le début de période qu'il
   * retient maintenant : à chaque changement de ce jour, et à la validation, de sorte que ce qui entre
   * dans le projet est la veille du premier jour de la période retenue, quel que soit le moment où le
   * compte a été semé. L'assistant ne donne pas de clôture lui-même : un compte clos qu'il a créé,
   * absent du projet, porte celle de l'exemple ; un compte clos du projet n'est jamais touché.
   */
  function recalerLesClotures() {
    const veille = clotureDeLExemple();
    const duProjet = new Set(app.ledger.accounts.map((a) => a.id));
    for (const a of accounts) {
      if (a.activeTo !== undefined && !duProjet.has(a.id) && a.activeTo !== veille) {
        app.assistantUpsert('accounts', { ...a, activeTo: veille });
      }
    }
  }
  /**
   * Un compte de l'exemple, avec ce que l'exemple en dit : son solde, le suivi de son solde à régler
   * s'il est tiers, sa clôture s'il est clos. Les réglages se modifient ensuite depuis Comptes (I11).
   */
  const appliquerCompte = (p: (typeof propositions.accounts)[number]) => {
    const debut = periodStart();
    app.assistantUpsert('accounts', {
      id: app.newId(),
      name: p.name,
      kind: p.kind,
      openingBalance: p.balance,
      openingDate: debut,
      ...(p.settlement
        ? { tracksSettlement: true, settlementThreshold: p.settlement.threshold, settlementDirection: p.settlement.direction }
        : {}),
      ...(p.closed ? { activeTo: clotureDeLExemple() } : {}),
    } satisfies Account);
  };
  /**
   * Le compte principal arrive avec ce que l'exemple en dit, là où il reste à renseigner : un nom ou
   * un solde que l'utilisateur a déjà posés ne sont pas remplacés (D43 : rouvrir l'assistant ne doit
   * rien casser). Même règle que le solde saisi : « à renseigner » se lit à la date d'ouverture.
   */
  const appliquerPrincipal = (p: typeof propositions.mainAccount) => {
    if (!principal) return;
    const nomAFaire = principal.name === DEFAULT_MAIN_ACCOUNT.name;
    const soldeAFaire = principal.openingDate === DEFAULT_MAIN_ACCOUNT.openingDate;
    if (!nomAFaire && !soldeAFaire) return;
    app.assistantUpsert('accounts', {
      ...principal,
      ...(nomAFaire ? { name: p.name } : {}),
      ...(soldeAFaire ? { openingBalance: p.balance, openingDate: periodStart() } : {}),
    });
  };

  /**
   * Projet vierge : on présente d'office tous les raccourcis de l'étape, dans l'assistant — comme si
   * l'utilisateur les avait touchés un par un —, il n'a plus qu'à corriger et retrancher. Une seule
   * fois par étape : sans cette mémoire, tout supprimer les ferait repousser au retour sur l'étape.
   * La mémoire est celle du brouillon : elle se retrouve en revenant dans l'assistant.
   */
  function semer(etape: Step) {
    if (!projetVierge || brouillon.semees.includes(etape)) return;
    brouillon.semees.push(etape);
    if (etape === 'accounts') {
      appliquerPrincipal(propositions.mainAccount);
      restantsComptes.forEach(appliquerCompte);
    }
    if (etape === 'income') restantsRevenus.forEach(appliquerRevenu);
    if (etape === 'fixed') restantsCharges.forEach(appliquerCharge);
    if (etape === 'everyday') restantsCourants.forEach(appliquerTirelire);
    if (etape === 'periodic') restantsPeriodiques.forEach(appliquerTirelire);
    if (etape === 'savings') restantsEpargnes.forEach(appliquerTirelire);
    // Les catégories viennent après les flux et les tirelires, vers lesquels elles se lient (D32).
    if (etape === 'categories') restantesCategories.forEach(appliquerCategorie);
    // L'ordre se propose là où l'assistant demande où dort chaque tirelire : au résumé.
    if (etape === 'summary') restantsOrdres.forEach(appliquerOrdre);
  }

  // --- Édition en place de ce qui a été ajouté ---
  function editFlowName(f: PlannedFlow, v: string) {
    if (v.trim() && v.trim() !== f.name) app.assistantUpsert('plannedFlows', { ...f, name: v.trim() });
  }
  /** Le signe est porté par le genre du flux, pas par la saisie : on la prend en valeur absolue. */
  function editFlowAmount(f: PlannedFlow, v: string) {
    const c = inputToCents(v);
    if (c === undefined) return;
    const signe = f.kind === 'income' ? Math.abs(c) : -Math.abs(c);
    if (signe !== f.amount) app.assistantUpsert('plannedFlows', { ...f, amount: signe });
  }
  /** Rythme non mensuel : l'ancrage porte la date entière, dont toutes les occurrences découlent. */
  function editFlowDate(f: PlannedFlow, v: string) {
    if (v && v !== f.periodicity.anchorDate) app.assistantUpsert('plannedFlows', { ...f, periodicity: { ...f.periodicity, anchorDate: v } });
  }
  function editFlowStep(f: PlannedFlow, champ: 'interval' | 'unit', v: string) {
    const actuel = f.periodicity;
    const suivant =
      champ === 'interval'
        ? { ...actuel, interval: Math.max(1, Number(v) || 1) }
        : { ...actuel, unit: v as PeriodUnit };
    if (suivant.interval === actuel.interval && suivant.unit === actuel.unit) return;
    app.assistantUpsert('plannedFlows', { ...f, periodicity: { ...suivant, anchorDate: f.periodicity.anchorDate } });
  }
  function editFlowAccount(f: PlannedFlow, v: string) {
    if (v && v !== f.accountId) app.assistantUpsert('plannedFlows', { ...f, accountId: v });
  }
  function editFlowDay(f: PlannedFlow, v: string) {
    const d = Math.min(31, Math.max(1, Number(v) || 1));
    const { y, m } = parseDate(f.periodicity.anchorDate);
    const anchorDate = dateInMonth(y, m, Math.min(d, daysInMonth(y, m)));
    if (anchorDate !== f.periodicity.anchorDate) {
      app.assistantUpsert('plannedFlows', { ...f, periodicity: { ...f.periodicity, anchorDate } });
    }
  }
  function editTirelireName(t: Tirelire, v: string) {
    if (v.trim() && v.trim() !== t.name) app.assistantUpsert('tirelires', { ...t, name: v.trim() });
  }
  /** Le nom propre d'un besoin, quand il en porte un (« Cours de piano ») ; vidé, le besoin reprend celui de sa tirelire. */
  function editNeedOwnName(n: Need, v: string) {
    const nom = v.trim();
    if (nom === (n.name ?? '')) return;
    const { name: _ancien, ...sans } = n;
    app.assistantUpsert('needs', nom ? { ...n, name: nom } : sans);
  }
  /** Ce qui y est déjà mis de côté : le solde d'ouverture de la tirelire, réputé sur le premier compte de son placement. */
  function editOpeningBalance(t: Tirelire, v: string) {
    const c = inputToCents(v);
    if (c === undefined || c < 0 || c === t.openingBalance) return;
    app.assistantUpsert('tirelires', { ...t, openingBalance: c });
  }
  function editNeedAmount(n: Need, v: string) {
    const c = inputToCents(v);
    if (c === undefined || c < 0) return;
    const champ = n.kind === 'goal' ? 'monthlyAmount' : 'amount';
    if (n[champ] !== c) app.assistantUpsert('needs', { ...n, [champ]: c });
  }
  function editNeedTarget(n: Need, v: string) {
    const c = inputToCents(v);
    if (c === undefined || c < 0) return;
    if (n.amount !== c) app.assistantUpsert('needs', { ...n, amount: c });
  }
  function editNeedDueDate(n: Need, v: string) {
    if (!v || !n.periodicity || v === n.periodicity.anchorDate) return;
    app.assistantUpsert('needs', { ...n, periodicity: { ...n.periodicity, anchorDate: v } });
  }
  function editRollover(t: Tirelire, keep: boolean) {
    app.assistantUpsert('tirelires', { ...t, rollover: { mode: keep ? 'unlimited' : 'none' } });
  }
  /** Les prélèvements attendus pour les échéances d'une tirelire : ses flux d'échéance (D40). */
  const prelevementsDe = (t: Tirelire) => flows.filter((f) => f.kind === 'dueDate' && f.tirelireId === t.id);
  /** Attendre un prélèvement pour une échéance, ou ne plus l'attendre : le flux d'échéance se crée ou se retire. */
  function editPrelevement(t: Tirelire, n: Need, attendu: boolean) {
    if (!attendu) return prelevementsDe(t).forEach(removeFlow);
    if (prelevementsDe(t).length || !n.periodicity) return;
    app.assistantUpsert('plannedFlows', {
      id: app.newId(),
      name: t.name,
      kind: 'dueDate',
      amount: -(n.amount ?? 0),
      accountId: mainAccountId(),
      tirelireId: t.id,
      periodicity: { ...n.periodicity },
      dateWindowDays: 7,
    } satisfies PlannedFlow);
  }

  /** Modification d'un compte, champ par champ, enregistrée à la volée. */
  function editAccount(a: Account, champ: 'name' | 'bank' | 'accountNumber', v: string) {
    const valeur = v.trim();
    if (valeur === (a[champ] ?? '')) return;
    app.assistantUpsert('accounts', { ...a, [champ]: valeur || undefined });
  }
  function editAccountKind(a: Account, v: string) {
    if (v !== a.kind) app.assistantUpsert('accounts', { ...a, kind: v as AccountKind });
  }
  /**
   * Le solde saisi est celui du début de la période. La date d'ouverture n'est jamais retouchée —
   * elle cale les soldes d'un compte déjà importé —, sauf celle que le compte principal porte à sa
   * naissance, qui dit « à renseigner » : le solde saisi la renseigne au début de la période.
   */
  function editAccountBalance(a: Account, v: string) {
    const c = inputToCents(v);
    if (c === undefined || c === a.openingBalance) return;
    const openingDate = a.id === MAIN_ACCOUNT_ID && a.openingDate === DEFAULT_MAIN_ACCOUNT.openingDate ? periodStart() : a.openingDate;
    app.assistantUpsert('accounts', { ...a, openingBalance: c, openingDate });
  }
  /**
   * Le coussin du compte principal (D41) : un réglage du foyer, préparé dans le brouillon comme le
   * début de période — l'assistant le propose avec celui de l'exemple sur un projet vierge, et il
   * n'entre dans le projet qu'à la validation, où Réglages le montre.
   */
  const coussin = $derived(app.assistantLedger.settings.principalCushion);
  function editCoussin(v: string) {
    const c = inputToCents(v);
    if (c === undefined || c < 0 || c === coussin) return;
    app.assistantSetSetting('principalCushion', c);
  }

  function removeFlow(f: PlannedFlow) {
    app.assistantRemove('plannedFlows', f.id);
  }
  /**
   * Retire une tirelire, avec tous ses besoins et les prélèvements attendus pour ses échéances. Les
   * catégories dont elle était la tirelire par défaut la perdent et se gardent sans (D32, I3).
   */
  function removeTirelire(t: Tirelire) {
    for (const f of flows.filter((f) => f.tirelireId === t.id)) app.assistantRemove('plannedFlows', f.id);
    for (const n of needs.filter((n) => n.tirelireId === t.id)) app.assistantRemove('needs', n.id);
    for (const c of categories.filter((c) => c.tirelireId === t.id)) {
      const { tirelireId: _retiree, ...sans } = c;
      app.assistantUpsert('categories', sans);
    }
    app.assistantRemove('tirelires', t.id);
  }

  // --- Catégories : celles de l'exemple, avec leurs liens (D32), modifiables sur place ---
  const NATURES_DE_CATEGORIE: Array<{ nature: CategoryNature; titre: string; vide: string }> = [
    { nature: 'expense', titre: 'Dépenses', vide: 'Aucune catégorie de dépense pour l’instant.' },
    { nature: 'income', titre: 'Revenus', vide: 'Aucune catégorie de revenu pour l’instant.' },
  ];
  /** La nature se choisit ; tant qu'on n'y a pas touché (`undefined`), elle est celle de la ligne d'aide (#214). */
  let cat = $state<{ name: string; nature?: CategoryNature | undefined }>({ name: '' });
  /** Ce qu'un geste sur une ligne de catégorie refuse (renommer en doublon, retirer un parent), et pourquoi. Chaque refus s'efface au geste suivant de l'étape, et quand on la quitte. */
  let catLigneError = $state('');
  let catError = $state('');
  /**
   * Deux catégories de même nature ne portent pas le même nom (D61) : le message dit laquelle existe
   * déjà. `sauf` est la catégorie qu'on renomme, qui ne fait pas doublon avec elle-même (« santé » pour « Santé »).
   */
  const doublonDe = (nom: string, nature: CategoryNature, sauf?: string) => {
    const existante = findCategoryByName(categories.filter((x) => x.id !== sauf), nom, nature);
    return existante ? `Une catégorie « ${existante.name} » existe déjà pour cette nature.` : '';
  };
  /** Ce que l'étape dit d'une catégorie : sa catégorie parente, sa tirelire par défaut et les flux qui la portent, une fois chacun. */
  function detailDe(c: Category): string {
    const parties: string[] = [];
    const parent = c.parentId ? categories.find((x) => x.id === c.parentId)?.name : undefined;
    if (parent) parties.push(`Dans « ${parent} »`);
    const tirelire = c.tirelireId ? tirelireById(c.tirelireId)?.name : undefined;
    if (tirelire) parties.push(`Tirelire par défaut : ${tirelire}`);
    const portes = [...new Set(flows.filter((f) => f.categoryId === c.id).map((f) => f.name))];
    if (portes.length) parties.push(`Flux : ${portes.join(', ')}`);
    return parties.join(' · ');
  }
  /** Renomme une catégorie ; un nom vide ou déjà pris par une catégorie de même nature est refusé, et le champ reprend le nom d'avant. */
  function editCategoryName(c: Category, champ: HTMLInputElement) {
    catError = '';
    const nom = champ.value.trim();
    const refus = !nom ? 'Le nom est obligatoire.' : nom === c.name ? '' : doublonDe(nom, c.nature, c.id);
    if (refus || nom === c.name) {
      champ.value = c.name;
      catLigneError = refus;
      return;
    }
    catLigneError = '';
    app.assistantUpsert('categories', { ...c, name: nom });
  }
  /** Retire une catégorie, et elle ne reste sur aucun flux. Une catégorie qui en porte d'autres ne se retire pas, comme dans Catégories. */
  function removeCategory(c: Category) {
    catError = '';
    const enfants = categories.filter((x) => x.parentId === c.id).length;
    if (enfants) return void (catLigneError = `« ${c.name} » a ${enfants} sous-catégorie(s) : détachez-les ou retirez-les d’abord.`);
    for (const f of flows.filter((f) => f.categoryId === c.id)) {
      const { categoryId: _retiree, ...sans } = f;
      app.assistantUpsert('plannedFlows', sans);
    }
    app.assistantRemove('categories', c.id);
    catLigneError = '';
  }
  function addCategory() {
    catLigneError = '';
    const nom = cat.name.trim();
    if (!nom) return void (catError = 'Donnez un nom à cette catégorie.');
    const nature = natureDeCategorie;
    const refus = doublonDe(nom, nature);
    if (refus) return void (catError = refus);
    const ligne = aideDeCategorie;
    if (ligne && recopieCategorie({ name: nom, nature }, ligne)) {
      appliquerCategorie(ligne.ligne);
      cat = { name: '' };
    } else {
      app.assistantUpsert('categories', { id: app.newId(), name: nom, nature } satisfies Category);
      cat = { ...cat, name: '' };
    }
    catError = '';
  }
  /** Retire un besoin d'une tirelire qui en porte d'autres ; le dernier emporte la tirelire. */
  function removeNeed(n: Need) {
    const t = tirelireById(n.tirelireId);
    if (t && !needs.some((x) => x.tirelireId === n.tirelireId && x.id !== n.id)) return removeTirelire(t);
    app.assistantRemove('needs', n.id);
  }

  /**
   * La validation : seul geste qui écrit dans le projet, et il y écrit tout ce que l'assistant montre
   * (D40). Refusée en cours de route, elle le dit et garde le brouillon : valider de nouveau écrit ce
   * qui manque.
   */
  function valider() {
    try {
      recalerLesClotures();
      app.validerAssistant();
      valide = true;
      erreurValidation = '';
    } catch (err) {
      erreurValidation = `L’enregistrement s’est arrêté : ${err instanceof Error ? err.message : String(err)} Vos réponses sont toujours là : validez de nouveau pour enregistrer ce qui manque.`;
    }
  }
</script>

{#snippet enTeteTirelire(t: Tirelire, reliquat: boolean)}
  <!-- La tirelire : son nom, ce qui y est déjà mis de côté, son reliquat ; ses besoins suivent. -->
  <div class="ligne-tirelire">
    <input class="nom" value={t.name} aria-label="Nom de la tirelire" onchange={(e) => editTirelireName(t, e.currentTarget.value)} />
    <label class="deja small">Déjà de côté
      <input class="mt" value={centsToInput(t.openingBalance)} inputmode="decimal" onchange={(e) => editOpeningBalance(t, e.currentTarget.value)} />
    </label>
    {#if reliquat}
      <label class="garde small" title="Garder ce qui n'a pas été dépensé">
        <input type="checkbox" checked={t.rollover?.mode !== 'none'} onchange={(e) => editRollover(t, e.currentTarget.checked)} /> garder
      </label>
    {/if}
    <button class="btn small danger" title="Retirer cette tirelire" onclick={() => removeTirelire(t)}>×</button>
  </div>
{/snippet}

{#snippet quoi(n: Need, seul: string)}
  <!-- Un besoin qui porte son nom le montre, modifiable : c'est un besoin de la tirelire (D28). -->
  {#if n.name !== undefined}
    <input class="besoin" value={n.name} aria-label="Nom du besoin" onchange={(e) => editNeedOwnName(n, e.currentTarget.value)} />
  {:else}
    <span class="quoi muted small">{seul}</span>
  {/if}
{/snippet}

{#snippet suiteBesoin(n: Need, besoins: Need[])}
  {#if besoins.length > 1}
    <button class="btn small danger" title="Retirer ce besoin" onclick={() => removeNeed(n)}>×</button>
  {:else}
    <span></span>
  {/if}
  {#if validityLabel(n)}
    <!-- Une ligne que l'exemple borne le dit, avec sa date : deux versions d'un besoin sont deux lignes (D51). -->
    <p class="muted small suite">
      {#if validityBadge(n, app.asOf)}<span class="pill dim">{validityBadge(n, app.asOf)}</span> {/if}{validityLabel(n)}
    </p>
  {/if}
{/snippet}

<p class="small">
  <a href="#top" onclick={(e) => { e.preventDefault(); if (!app.back()) app.switchTab('more'); }}>‹ Retour</a>
</p>
<h1>Construire mon budget</h1>

{#if !valide}
  <div class="wizard-steps">
    {#each STEPS as s, i (s.id)}
      <button class="wstep" class:active={s.id === step} class:done={i < stepIndex} onclick={() => goStep(s.id)}>{s.label}</button>
    {/each}
  </div>
{/if}

{#if !valide && step !== 'intro' && step !== 'accounts'}
  <div class="stats">
    <div class="stat"><div class="v num pos">{money(totals.incomes)}</div><div class="k">Revenus par période</div></div>
    <div class="stat"><div class="v num">{money(-totals.fixedCharges)}</div><div class="k">Charges fixes</div></div>
    <div class="stat"><div class="v num">{money(totals.requested)}</div><div class="k">À mettre de côté</div></div>
    <div class="stat"><div class="v num {totals.margin < 0 ? 'neg' : 'pos'}">{money(totals.margin)}</div><div class="k">Reste à vivre</div></div>
  </div>
{/if}

{#if step === 'intro'}
  <div class="card accent">
    <h2 style="margin-top:0">Le problème que Tirelire résout</h2>
    <p>
      Certaines dépenses ne tombent pas tous les mois : l'assurance, les impôts, les vacances. Le mois
      où elles arrivent, le compte pique du nez — alors que la dépense était prévisible.
    </p>
    <p>
      Une <strong>tirelire</strong> est une réserve pour une de ces dépenses. Vous mettez un peu de côté
      à chaque paie, et l'argent est là le jour venu. Tirelire calcule combien : une facture de 1 200 €
      par an, c'est 100 € par mois. L'argent ne bouge pas de votre compte — la tirelire dit seulement
      quelle part est déjà réservée, et ce qui reste vraiment disponible.
    </p>
    <p class="muted small">
      Les questions qui suivent préparent ce budget : il n’est enregistré que lorsque vous le validez,
      à la fin. Rien n’est définitif : tout se modifie ensuite dans Configuration, et vous pouvez
      sauter une étape qui ne vous concerne pas.
    </p>
    <div class="actions" style="margin-bottom:0">
      <button class="btn primary" onclick={next}>Commencer</button>
    </div>
  </div>
{:else if step === 'income'}
  <h2>Qu'est-ce qui rentre, et quand ?</h2>
  <p class="muted small">
    Déclarez ce qui rentre, avec la date à laquelle ça tombe. Le montant se saisit en positif.
  </p>

  <h3>Rentrées d'argent</h3>
  <div class="tete tete-flux" class:avec-compte={comptesOuverts.length > 1}><span>Quoi ?</span><span class="d">Combien</span><span>Le</span><span>Tous les</span><span>Unité</span>{#if comptesOuverts.length > 1}<span>Compte</span>{/if}<span></span></div>
  {#each incomes as f (f.id)}
    <div class="card ligne ligne-flux" class:avec-compte={comptesOuverts.length > 1}>
      <input class="nom" value={f.name} onchange={(e) => editFlowName(f, e.currentTarget.value)} />
      <input class="mt" value={centsToInput(Math.abs(f.amount))} inputmode="decimal" onchange={(e) => editFlowAmount(f, e.currentTarget.value)} />
      {#if f.periodicity.unit === 'month' && f.periodicity.interval === 1}
        <input class="jour" type="number" min="1" max="31" value={parseDate(f.periodicity.anchorDate).d} onchange={(e) => editFlowDay(f, e.currentTarget.value)} />
      {:else}
        <input class="date" type="date" value={f.periodicity.anchorDate} onchange={(e) => editFlowDate(f, e.currentTarget.value)} title="Première échéance ; les suivantes en découlent" />
      {/if}
      <input class="jour" type="number" min="1" value={f.periodicity.interval} onchange={(e) => editFlowStep(f, 'interval', e.currentTarget.value)} />
      <select class="unite" value={f.periodicity.unit} onchange={(e) => editFlowStep(f, 'unit', e.currentTarget.value)}>
        {#each Object.entries(UNITS) as [u, l]}<option value={u}>{f.periodicity.interval > 1 ? l.pluriel : l.un}</option>{/each}
      </select>
      {#if comptesOuverts.length > 1}
        <select class="cpt" value={f.accountId} onchange={(e) => editFlowAccount(f, e.currentTarget.value)}>
          {#each openAccounts(accounts, app.asOf, f.accountId) as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      {/if}
      <button class="btn small danger" onclick={() => removeFlow(f)}>×</button>
      {#if f.periodicity.unit !== 'month' || f.periodicity.interval !== 1}
        <p class="muted small suite">Prochaine : {shortDate(nextOccurrence(f.periodicity, app.asOf))}</p>
      {/if}
      {#if validityLabel(f)}
        <!-- Une ligne que l'exemple borne le dit, avec sa date : deux versions d'un flux sont deux lignes du même nom (D51). -->
        <p class="muted small suite">
          {#if validityBadge(f, app.asOf)}<span class="pill dim">{validityBadge(f, app.asOf)}</span> {/if}{validityLabel(f)}
        </p>
      {/if}
    </div>
  {/each}
  {#if restantsRevenus.length}
    <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
    <div class="propositions">
      {#each restantsRevenus as p (p.name)}
        <button class="prop" onclick={() => appliquerRevenu(p)}>
          <span class="n">+ {p.name}</span><span class="v num">{money(montantDuRaccourci(p))}</span>
        </button>
      {/each}
    </div>
  {/if}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addIncome(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={inc.name} placeholder={aideRevenu?.name} /></label>
      <label class="f">Combien ? <input bind:value={inc.amount} inputmode="decimal" placeholder={aideRevenu ? montantAide(aideRevenu.amount) : undefined} /></label>
      <label class="f">Tous les <input type="number" min="1" value={evRevenu.interval} oninput={(e) => (inc.interval = e.currentTarget.value)} /></label>
      <label class="f">Unité
        <select value={evRevenu.unit} onchange={(e) => (inc.unit = e.currentTarget.value as PeriodUnit)}>
          {#each Object.entries(UNITS) as [u, l]}<option value={u}>{Number(evRevenu.interval) > 1 ? l.pluriel : l.un}</option>{/each}
        </select>
      </label>
      <label class="f">Vers le (jour) <input type="number" min="1" max="31" value={evRevenu.day} oninput={(e) => (inc.day = e.currentTarget.value)} /></label>
        {#if comptesOuverts.length > 1}
          <label class="f">Sur quel compte ?
            <select value={evRevenu.accountId} onchange={(e) => (inc.accountId = e.currentTarget.value)}>
              {#each comptesOuverts as a}<option value={a.id}>{a.name}</option>{/each}
            </select>
          </label>
        {/if}
    </div>
    {#if incError}<div class="err">{incError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter</button></div>
  </form>

  <h3>Découpage du budget</h3>
  <p class="muted small">
    Une période budgétaire n'est pas forcément le mois calendaire. Beaucoup de foyers la font
    commencer au jour de leur paie, pour savoir si l'argent tient jusqu'à la prochaine.
  </p>
  <div class="propositions">
    {#if jourDuRevenu !== undefined && Number(startDay) !== jourDuRevenu}
      <button class="prop" onclick={() => { startDay = String(jourDuRevenu); saveStartDay(); }}>
        <span class="n">Commencer au jour de ma paie</span><span class="v num">le {jourDuRevenu}</span>
      </button>
    {/if}
    {#if Number(startDay) !== 1}
      <button class="prop" onclick={() => { startDay = '1'; saveStartDay(); }}>
        <span class="n">Suivre le mois calendaire</span><span class="v num">le 1er</span>
      </button>
    {/if}
  </div>
  <form class="edit" onsubmit={(e) => { e.preventDefault(); saveStartDay(); }}>
    <div class="grid">
      <label class="f">La période commence le (jour) <input type="number" min="1" max="31" bind:value={startDay} onchange={saveStartDay} /></label>
    </div>
  </form>

{:else if step === 'fixed'}
  <h2>Qu'est-ce qui part tout seul, au même montant ?</h2>
  <p class="muted small">
    Loyer, abonnements, mensualités : le montant est connu et il part chaque mois. Pas besoin de
    réserve — il suffit que le plan sache que cet argent est déjà engagé.
  </p>
  <h3>Charges fixes</h3>
  <div class="tete tete-flux" class:avec-compte={comptesOuverts.length > 1}><span>Quoi ?</span><span class="d">Combien</span><span>Le</span><span>Tous les</span><span>Unité</span>{#if comptesOuverts.length > 1}<span>Compte</span>{/if}<span></span></div>
  {#each fixedCharges as f (f.id)}
    <div class="card ligne ligne-flux" class:avec-compte={comptesOuverts.length > 1}>
      <input class="nom" value={f.name} onchange={(e) => editFlowName(f, e.currentTarget.value)} />
      <input class="mt" value={centsToInput(Math.abs(f.amount))} inputmode="decimal" onchange={(e) => editFlowAmount(f, e.currentTarget.value)} />
      {#if f.periodicity.unit === 'month' && f.periodicity.interval === 1}
        <input class="jour" type="number" min="1" max="31" value={parseDate(f.periodicity.anchorDate).d} onchange={(e) => editFlowDay(f, e.currentTarget.value)} />
      {:else}
        <input class="date" type="date" value={f.periodicity.anchorDate} onchange={(e) => editFlowDate(f, e.currentTarget.value)} title="Première échéance ; les suivantes en découlent" />
      {/if}
      <input class="jour" type="number" min="1" value={f.periodicity.interval} onchange={(e) => editFlowStep(f, 'interval', e.currentTarget.value)} />
      <select class="unite" value={f.periodicity.unit} onchange={(e) => editFlowStep(f, 'unit', e.currentTarget.value)}>
        {#each Object.entries(UNITS) as [u, l]}<option value={u}>{f.periodicity.interval > 1 ? l.pluriel : l.un}</option>{/each}
      </select>
      {#if comptesOuverts.length > 1}
        <select class="cpt" value={f.accountId} onchange={(e) => editFlowAccount(f, e.currentTarget.value)}>
          {#each openAccounts(accounts, app.asOf, f.accountId) as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      {/if}
      <button class="btn small danger" onclick={() => removeFlow(f)}>×</button>
      {#if f.periodicity.unit !== 'month' || f.periodicity.interval !== 1}
        <p class="muted small suite">Prochaine : {shortDate(nextOccurrence(f.periodicity, app.asOf))}</p>
      {/if}
      {#if validityLabel(f)}
        <p class="muted small suite">
          {#if validityBadge(f, app.asOf)}<span class="pill dim">{validityBadge(f, app.asOf)}</span> {/if}{validityLabel(f)}
        </p>
      {/if}
    </div>
  {/each}
  {#if restantsCharges.length}
    <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
    <div class="propositions">
      {#each restantsCharges as p (p.name)}
        <button class="prop" onclick={() => appliquerCharge(p)}>
          <span class="n">+ {p.name}</span><span class="v num">{money(montantDuRaccourci(p))}</span>
        </button>
      {/each}
    </div>
  {/if}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addFixed(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={fix.name} placeholder={aideCharge?.name} /></label>
      <label class="f">Combien ? <input bind:value={fix.amount} inputmode="decimal" placeholder={aideCharge ? montantAide(aideCharge.amount) : undefined} /></label>
      <label class="f">Tous les <input type="number" min="1" value={evCharge.interval} oninput={(e) => (fix.interval = e.currentTarget.value)} /></label>
      <label class="f">Unité
        <select value={evCharge.unit} onchange={(e) => (fix.unit = e.currentTarget.value as PeriodUnit)}>
          {#each Object.entries(UNITS) as [u, l]}<option value={u}>{Number(evCharge.interval) > 1 ? l.pluriel : l.un}</option>{/each}
        </select>
      </label>
      <label class="f">Vers le (jour) <input type="number" min="1" max="31" value={evCharge.day} oninput={(e) => (fix.day = e.currentTarget.value)} /></label>
        {#if comptesOuverts.length > 1}
          <label class="f">Sur quel compte ?
            <select value={evCharge.accountId} onchange={(e) => (fix.accountId = e.currentTarget.value)}>
              {#each comptesOuverts as a}<option value={a.id}>{a.name}</option>{/each}
            </select>
          </label>
        {/if}
    </div>
    {#if fixError}<div class="err">{fixError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter</button></div>
  </form>
{:else if step === 'everyday'}
  <h2>Sur quoi voulez-vous vous tenir à un montant ?</h2>
  <p class="muted small">
    Courses, essence, restaurants : le montant varie, mais vous voulez vous fixer une limite par
    période et voir ce qu'il en reste. C'est une tirelire qui se remplit à chaque paie.
  </p>
  <h3>Budgets par période</h3>
  <div class="tete tete-courant"><span>Quoi ?</span><span class="d">Par période</span><span></span><span></span></div>
  {#each tirelireCourantes as { t, besoins } (t.id)}
    <div class="card tirelire">
      {@render enTeteTirelire(t, true)}
      {#each besoins as n (n.id)}
        <div class="ligne ligne-courant">
          {@render quoi(n, 'Par période')}
          <input class="mt" value={centsToInput(n.amount ?? 0)} inputmode="decimal" aria-label="Par période" onchange={(e) => editNeedAmount(n, e.currentTarget.value)} />
          <span class="vide"></span>
          {@render suiteBesoin(n, besoins)}
        </div>
      {/each}
      <!-- Un besoin de plus sur cette tirelire (D28) : un nom et un montant par période. -->
      <form class="ajout-besoin" onsubmit={(e) => { e.preventDefault(); addNeedTo(t); }}>
        <input class="besoin-nom" aria-label="Nom du besoin à ajouter" value={saisieDuBesoin(t).name} placeholder={aideBesoinAjoute?.name} oninput={(e) => (ajoutBesoin[t.id] = { ...saisieDuBesoin(t), name: e.currentTarget.value })} />
        <input class="mt" aria-label="Montant par période du besoin à ajouter" inputmode="decimal" value={saisieDuBesoin(t).amount} placeholder={aideBesoinAjoute ? montantAide(aideBesoinAjoute.amount) : undefined} oninput={(e) => (ajoutBesoin[t.id] = { ...saisieDuBesoin(t), amount: e.currentTarget.value })} />
        <button class="btn small" type="submit">Ajouter un besoin</button>
        {#if saisieDuBesoin(t).error}<div class="err">{saisieDuBesoin(t).error}</div>{/if}
      </form>
    </div>
  {/each}
  {#if restantsCourants.length}
    <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
    <div class="propositions">
      {#each restantsCourants as p (p.name)}
        <button class="prop" onclick={() => appliquerTirelire(p)}>
          <span class="n">+ {p.name}</span><span class="v num">{money(montantDeLaTirelire(p, app.asOf))}</span>
        </button>
      {/each}
    </div>
  {/if}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addEveryday(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={day.name} placeholder={aideBudget?.name} /></label>
      <label class="f">Combien par période ? <input bind:value={day.amount} inputmode="decimal" placeholder={aideBudget ? montantAide(aideBudget.amount) : undefined} /></label>
      <label class="f check"><input type="checkbox" checked={gardeBudget} onchange={(e) => (day.keep = e.currentTarget.checked)} /> Garder ce qui n'a pas été dépensé</label>
    </div>
    {#if dayError}<div class="err">{dayError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter</button></div>
  </form>
{:else if step === 'periodic'}
  <h2>Qu'est-ce qui ne tombe pas tous les mois ?</h2>
  <p class="muted small">
    C'est ici que les tirelires servent vraiment. Donnez le montant de la facture et sa date : Tirelire
    répartit la somme sur les paies qui restent d'ici là, et vous n'aurez pas de mauvaise surprise.
  </p>
  <h3>Dépenses à échéance</h3>
  <div class="tete tete-echeance"><span>Quoi ?</span><span class="d">Montant</span><span>Prochaine échéance</span><span></span></div>
  {#each tirelirePeriodiques as { t, besoins } (t.id)}
    <div class="card tirelire">
      {@render enTeteTirelire(t, false)}
      {#each besoins as n (n.id)}
        <div class="ligne ligne-echeance">
          {@render quoi(n, 'La facture')}
          <input class="mt" value={centsToInput(n.amount ?? 0)} inputmode="decimal" aria-label="Montant" onchange={(e) => editNeedAmount(n, e.currentTarget.value)} />
          <input class="date" type="date" value={n.periodicity?.anchorDate ?? todayISO()} aria-label="Prochaine échéance" onchange={(e) => editNeedDueDate(n, e.currentTarget.value)} />
          {@render suiteBesoin(n, besoins)}
          <p class="muted small suite">
            {money(perPeriod(n.amount ?? 0, n.periodicity ? monthsOf(n.periodicity) : 12))} à mettre de côté par mois.
          </p>
        </div>
      {/each}
      <!-- L'étape dit, pour chaque échéance, si un prélèvement y est attendu (D40). -->
      <label class="prelevement small">
        <input type="checkbox" checked={prelevementsDe(t).length > 0} onchange={(e) => editPrelevement(t, besoins[0]!, e.currentTarget.checked)} />
        {#if prelevementsDe(t).length}
          Prélèvement attendu : {#each prelevementsDe(t) as f, i (f.id)}{i ? ', ' : ''}« {f.name} », {money(Math.abs(f.amount))} sur {nomDuCompte(f.accountId)}{/each}
        {:else}
          Aucun prélèvement attendu
        {/if}
      </label>
    </div>
  {/each}
  {#if restantsPeriodiques.length}
    <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
    <div class="propositions">
      {#each restantsPeriodiques as p (p.name)}
        <button class="prop" onclick={() => appliquerTirelire(p)}>
          <span class="n">+ {p.name}</span><span class="v num">{money(montantDeLaTirelire(p, app.asOf))}</span>
        </button>
      {/each}
    </div>
  {/if}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addPeriodic(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={per.name} placeholder={aideEcheance?.name} /></label>
      <label class="f">Montant de la facture <input bind:value={per.amount} inputmode="decimal" placeholder={aideEcheance ? montantAide(aideEcheance.amount) : undefined} /></label>
      <label class="f">Elle revient tous les <input type="number" min="1" value={evEcheance.months} oninput={(e) => (per.months = e.currentTarget.value)} /> mois</label>
      <label class="f">Prochaine échéance <input type="date" value={evEcheance.dueDate} oninput={(e) => (per.dueDate = e.currentTarget.value)} /></label>
        {#if comptesOuverts.length > 1}
          <label class="f">Sur quel compte ?
            <select value={evEcheance.accountId} onchange={(e) => (per.accountId = e.currentTarget.value)}>
              {#each comptesOuverts as a}<option value={a.id}>{a.name}</option>{/each}
            </select>
          </label>
        {/if}
      <label class="f check"><input type="checkbox" checked={evEcheance.withFlow} onchange={(e) => (per.withFlow = e.currentTarget.checked)} /> Attendre le prélèvement à cette date</label>
    </div>
    {#if perPreview !== undefined}
      <p class="small" style="margin:0">
        Soit <strong>{money(perPreview)}</strong> à mettre de côté par mois.
      </p>
    {/if}
    {#if perError}<div class="err">{perError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter</button></div>
  </form>
{:else if step === 'savings'}
  <h2>Que voulez-vous mettre de côté ?</h2>
  <p class="muted small">
    Une épargne sans date : vous décidez du montant par période, et la cible si vous en avez une.
    Elle passe après le reste — c'est ce qui est financé en dernier quand le mois est serré.
  </p>
  <h3>Objectifs d'épargne</h3>
  <div class="tete tete-epargne"><span>Quoi ?</span><span class="d">Par période</span><span class="d">Cible</span><span></span></div>
  {#each tirelireEpargnes as { t, besoins } (t.id)}
    <div class="card tirelire">
      {@render enTeteTirelire(t, false)}
      {#each besoins as n (n.id)}
        <div class="ligne ligne-epargne">
          {@render quoi(n, 'Par période, et la cible')}
          <input class="mt" value={centsToInput(n.monthlyAmount ?? 0)} inputmode="decimal" aria-label="Par période" onchange={(e) => editNeedAmount(n, e.currentTarget.value)} />
          <input class="mt" value={n.amount ? centsToInput(n.amount) : ''} inputmode="decimal" placeholder="cible" aria-label="Cible" onchange={(e) => editNeedTarget(n, e.currentTarget.value)} />
          {@render suiteBesoin(n, besoins)}
        </div>
      {/each}
    </div>
  {/each}
  {#if restantsEpargnes.length}
    <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
    <div class="propositions">
      {#each restantsEpargnes as p (p.name)}
        <button class="prop" onclick={() => appliquerTirelire(p)}>
          <span class="n">+ {p.name}</span><span class="v num">{money(montantDeLaTirelire(p, app.asOf))}</span>
        </button>
      {/each}
    </div>
  {/if}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addSavings(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={sav.name} placeholder={aideObjectif?.name} /></label>
      <label class="f">Combien par période ? <input bind:value={sav.monthly} inputmode="decimal" placeholder={aideObjectif ? montantAide(aideObjectif.monthly) : undefined} /></label>
      <label class="f">Cible (facultatif) <input bind:value={sav.target} inputmode="decimal" placeholder={aideObjectif?.target !== undefined ? montantAide(aideObjectif.target) : undefined} /></label>
    </div>
    {#if savPreview !== undefined}
      <p class="small" style="margin:0">Cible atteinte en <strong>{savPreview} périodes</strong>.</p>
    {/if}
    {#if savError}<div class="err">{savError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter</button></div>
  </form>
{:else if step === 'categories'}
  <h2>Comment classer vos dépenses et vos rentrées ?</h2>
  <p class="muted small">
    Une catégorie dit à quoi sert une opération : les courses, le loyer, un salaire. Elle classe vos
    opérations sans demander de tirelire ; gardez celles qui vous parlent, renommez ou retirez les autres.
  </p>
  {#each NATURES_DE_CATEGORIE as g (g.nature)}
    <h3>{g.titre}</h3>
    {#each categories.filter((c) => c.nature === g.nature) as c (c.id)}
      {@const detail = detailDe(c)}
      <div class="card ligne ligne-categorie">
        <input class="nom" value={c.name} aria-label="Nom de la catégorie" onchange={(e) => editCategoryName(c, e.currentTarget)} />
        <button class="btn small danger" title="Retirer cette catégorie" onclick={() => removeCategory(c)}>×</button>
        {#if detail}<p class="muted small suite">{detail}</p>{/if}
      </div>
    {:else}
      <p class="muted small">{g.vide}</p>
    {/each}
  {/each}
  {#if catLigneError}<div class="err">{catLigneError}</div>{/if}
  {#if restantesCategories.length}
    <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
    <div class="propositions">
      {#each restantesCategories as p (p.nature + p.name)}
        <button class="prop" onclick={() => appliquerCategorie(p)}>
          <span class="n">+ {p.name}</span><span class="v">{p.nature === 'income' ? 'revenu' : 'dépense'}</span>
        </button>
      {/each}
    </div>
  {/if}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addCategory(); }}>
    <div class="grid">
      <label class="f">Nom de la catégorie <input bind:value={cat.name} placeholder={aideDeCategorie?.name} /></label>
      <label class="f">Nature
        <select value={natureDeCategorie} onchange={(e) => (cat.nature = e.currentTarget.value as CategoryNature)}>
          {#each NATURES_DE_CATEGORIE as g}<option value={g.nature}>{g.nature === 'expense' ? 'Dépense' : 'Revenu'}</option>{/each}
        </select>
      </label>
    </div>
    {#if catError}<div class="err">{catError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter une catégorie</button></div>
  </form>
{:else if step === 'accounts'}
  <h2>Vos comptes en banque</h2>
  <p class="muted small">
    Uniquement des comptes bancaires réels — ceux dont vous recevez un relevé. Le compte principal
    est celui par lequel tout transite ; les autres sont facultatifs.
  </p>

  <div class="tete tete-compte"><span>Nom du compte</span><span>Banque</span><span>Numéro ou IBAN</span><span class="d">Solde actuel</span><span>Type</span><span></span></div>

  {#if principal}
    <div class="ligne-compte principal">
      <input value={principal.name} onchange={(e) => editAccount(principal, 'name', e.currentTarget.value)} />
      <input value={principal.bank ?? ''} placeholder="Banque" onchange={(e) => editAccount(principal, 'bank', e.currentTarget.value)} />
      <input value={principal.accountNumber ?? ''} placeholder="FR76 …" onchange={(e) => editAccount(principal, 'accountNumber', e.currentTarget.value)} />
      <input class="mt" value={centsToInput(principal.openingBalance)} inputmode="decimal" onchange={(e) => editAccountBalance(principal, e.currentTarget.value)} />
      <span class="pill">principal</span>
      <span></span>
      <label class="coussin">
        <span class="muted small">Coussin : montant minimum à laisser en non affecté ; le plan avertit si la marge passe en dessous.</span>
        <input class="mt" value={centsToInput(coussin)} inputmode="decimal" aria-label="Coussin du compte principal" onchange={(e) => editCoussin(e.currentTarget.value)} />
      </label>
    </div>
  {/if}

  {#each otherAccounts as a (a.id)}
    <div class="ligne-compte">
      <input value={a.name} placeholder="Nom du compte" onchange={(e) => editAccount(a, 'name', e.currentTarget.value)} />
      <input value={a.bank ?? ''} placeholder="Banque" onchange={(e) => editAccount(a, 'bank', e.currentTarget.value)} />
      <input value={a.accountNumber ?? ''} placeholder="FR76 …" onchange={(e) => editAccount(a, 'accountNumber', e.currentTarget.value)} />
      <input class="mt" value={centsToInput(a.openingBalance)} inputmode="decimal" onchange={(e) => editAccountBalance(a, e.currentTarget.value)} />
      <select value={a.kind} onchange={(e) => editAccountKind(a, e.currentTarget.value)}>
        {#each NATURES as k}<option value={k}>{ACCOUNT_KINDS[k]}</option>{/each}
      </select>
      <button class="btn small danger" title="Retirer ce compte" onclick={() => retirerCompte(a)}>×</button>
      <!-- Ce que l'étape dit du compte : tiers (suivi d'un solde à régler) ou clos. Ces réglages se modifient depuis Comptes (I11). -->
      {#if a.tracksSettlement || validityBadge(a, app.asOf)}
        <p class="muted small suite">
          {#if a.tracksSettlement}
            <span class="pill">tiers</span> Solde à régler avec le compte principal{a.settlementThreshold ? ` dès ${money(a.settlementThreshold)}` : ''}, {SENS_DE_REGLEMENT[a.settlementDirection ?? 'both']}.
          {/if}
          {#if validityBadge(a, app.asOf)}
            <span class="pill dim">{validityBadge(a, app.asOf)}</span> {validityLabel(a)}
          {/if}
        </p>
      {/if}
    </div>
  {/each}

  {#if restantsComptes.length}
    <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
    <div class="propositions">
      {#each restantsComptes as p (p.name)}
        <button class="prop" onclick={() => appliquerCompte(p)}>
          <span class="n">+ {p.name}</span><span class="v num">{money(p.balance)}</span>
        </button>
      {/each}
    </div>
  {/if}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addAccount(); }}>
    <div class="grid">
      <label class="f">Nom du compte <input bind:value={acc.name} placeholder={aideDeCompte?.name} /></label>
      <label class="f">Type
        <select value={typeDeCompte} onchange={(e) => (acc.kind = e.currentTarget.value as Exclude<AccountKind, 'principal'>)}>
          {#each NATURES as k}<option value={k}>{ACCOUNT_KINDS[k]}</option>{/each}
        </select>
      </label>
      <label class="f">Solde actuel <input bind:value={acc.balance} inputmode="decimal" placeholder={aideDeCompte ? montantAide(aideDeCompte.balance) : undefined} /></label>
    </div>
    {#if accError}<div class="err">{accError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter un compte</button></div>
  </form>

{:else if step === 'summary'}
  <h2>{valide ? 'Votre budget est enregistré' : 'Votre budget'}</h2>
  {#if !valide}
    <div class="card">
      <p style="margin:0">
        <strong>Rien n’est encore enregistré.</strong> Votre budget n’entre dans l’application que
        lorsque vous le validez ci-dessous. Si vous fermez ou rechargez l’application avant, ce que
        vous avez préparé ici est perdu.
      </p>
    </div>
  {/if}
  <p class="muted small">
    Période du {shortDate(plan.period.start)} au {shortDate(plan.period.end)} : ce que le Plan dira de cette
    période une fois votre budget validé.
  </p>
  {#if nbAnnonces === 0}
    <div class="card accent">
      <p style="margin:0">
        Tout est finançable, et il vous reste <strong>{money(totals.margin)}</strong> par période une fois
        les réserves mises de côté.
      </p>
    </div>
  {:else}
    <div class="card warn">
      <p style="margin:0">
        <strong>Le plan annonce {nbAnnonces} point{nbAnnonces > 1 ? 's' : ''} à regarder.</strong> Ce n'est pas
        une erreur de votre part : c'est exactement ce que l'application est là pour montrer. Baissez un
        budget, étalez une échéance, ou mettez une épargne en attente.
      </p>
    </div>
  {/if}

  <div class="card">
    <div class="row"><div class="label">Revenus prévus</div><div class="num pos">{money(totals.incomes)}</div></div>
    <div class="row"><div class="label">Charges fixes</div><div class="num">{money(totals.fixedCharges)}</div></div>
    <div class="row"><div class="label">Dotations demandées ({needs.filter((n) => activeAt(n, app.asOf)).length})</div><div class="num">{money(totals.requested)}</div></div>
    <div class="row"><div class="label">Couvert par les revenus</div><div class="num">{money(totals.funded)}</div></div>
    {#if plan.warnings.some((w) => w.code === 'principalOverdrawn')}
      <div class="row"><div class="label">Non affecté sur le compte principal</div><div class="num neg">{money(totals.principalUnallocated)}</div></div>
    {/if}
    <div class="row total"><div class="label">Marge{totals.cushion ? ` (coussin ${money(totals.cushion)})` : ''}</div><div class="num {totals.margin < 0 ? 'neg' : 'pos'}">{money(totals.margin)}</div></div>
  </div>

  {#if plan.warnings.length}
    <div class="warnings">
      {#each plan.warnings as w}
        <div>{w.message}</div>
      {/each}
    </div>
  {/if}

  {#if manques.length}
    <h3>Échéances en manque</h3>
    <p class="muted small">Ce qui ne sera pas réuni à temps par les virements permanents. Rien ne se lisse sans vous : le Plan vous propose de lisser, une fois votre budget validé.</p>
    <div class="card warn">
      {#each manques as m (m.needId + m.dueDate)}
        <Manque manque={m} repondre={false} />
      {/each}
    </div>
  {/if}

  {#if !valide && comptesOuverts.length > 1 && tirelires.length}
    <h3>Où dort chaque tirelire ?</h3>
    <p class="muted small">Le compte où son argent est mis de côté. Laissez « Peu importe » si vous ne savez pas : ça se change à tout moment.</p>
    {#each tirelires as e (e.id)}
      <div class="card">
        <div class="row">
          <div class="label"><strong>{e.name}</strong></div>
          <select onchange={(ev) => setPlacement(e, (ev.currentTarget as HTMLSelectElement).value)}>
            <option value="" selected={e.placement.length === 0}>Peu importe</option>
            {#each openAccounts(accounts, app.asOf, e.placement[0]?.accountId) as a}
              <option value={a.id} selected={e.placement[0]?.accountId === a.id}>{a.name}</option>
            {/each}
          </select>
        </div>
      </div>
    {/each}
  {/if}

  {#if !valide && (ordres.length || restantsOrdres.length)}
    <h3>Vos virements permanents déjà en place</h3>
    <p class="muted small">
      Un virement que vous avez déjà programmé chez votre banque. Indiquez ce qu'il vire vraiment : le
      plan le compare à ce que votre budget demande, et vous dit quand le modifier.
    </p>
    {#each ordres as f (f.id)}
      <div class="card ordre">
        <div class="row">
          <div class="label">
            <strong>{f.name}</strong>
            <div class="muted small">
              {f.periodicity.unit === 'month' && f.periodicity.interval === 1 ? `Le ${parseDate(f.periodicity.anchorDate).d} de chaque mois` : periodicityLabel(f.periodicity)},
              de {nomDuCompte(f.accountId)} vers {nomDuCompte(f.counterpartAccountId)}{f.labelPattern ? ` · libellé « ${f.labelPattern} »` : ''}.
            </div>
          </div>
          <input class="mt" value={centsToInput(Math.abs(f.amount))} inputmode="decimal" aria-label="Ce que la banque vire" onchange={(e) => editFlowAmount(f, e.currentTarget.value)} />
          <button class="btn small danger" title="Retirer ce virement" onclick={() => removeFlow(f)}>×</button>
        </div>
        <p class="muted small" style="margin:4px 0 0">
          Votre budget demande <strong class="num">{money(demandeVers(f.counterpartAccountId))}</strong> par mois pour {nomDuCompte(f.counterpartAccountId)}.
        </p>
      </div>
    {/each}
    {#if restantsOrdres.length}
      <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
      <div class="propositions">
        {#each restantsOrdres as p (p.name)}
          <button class="prop" onclick={() => appliquerOrdre(p)}>
            <span class="n">+ {p.name}</span><span class="v num">{money(p.amount)}</span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}

  {#if valide}
    <h3>Et maintenant</h3>
    <p class="muted small">
      Le Plan détaille période par période ce qu'il faut mettre de côté et les virements à faire.
      Dans Configuration, vous pouvez affiner ce que l'assistant a créé : les besoins de chaque
      tirelire et leurs priorités de financement, la ventilation des dépenses par catégorie. L'import d'un relevé
      rapprochera ensuite vos opérations réelles de ce budget.
    </p>
    <div class="actions">
      <button class="btn primary" onclick={() => app.switchTab('plan')}>Voir le plan</button>
      <button class="btn" onclick={() => app.switchTab('more')}>Configuration</button>
      <button class="btn" onclick={() => app.switchTab('import')}>Importer un relevé</button>
    </div>
  {:else}
    {#if erreurValidation}<div class="err">{erreurValidation}</div>{/if}
    <div class="actions">
      <button class="btn" onclick={prev}>‹ Précédent</button>
      <button class="btn primary" onclick={valider}>Valider mon budget</button>
    </div>
  {/if}
{/if}

{#if step !== 'summary'}
  <div class="actions">
    {#if stepIndex > 0}<button class="btn" onclick={prev}>‹ Précédent</button>{/if}
    <button class="btn primary" onclick={next}>{step === 'intro' ? 'Commencer' : 'Suivant'} ›</button>
  </div>
{/if}
