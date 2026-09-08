<!--
  Assistant de configuration (D40) : construire un budget en répondant à des questions simples,
  pas en remplissant les écrans de configuration. Chaque réponse crée les objets du modèle
  (tirelires, besoins, flux prévus) sans que l'utilisateur ait à connaître ces mots.
  Le compte principal est créé en silence ; les autres comptes sont proposés, jamais imposés.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { ACCOUNT_KINDS, money, shortDate, centsToInput, inputToCents } from '../lib/format';
  import {
    alive,
    divideCents,
    dateInMonth,
    parseDate,
    todayISO,
    daysInMonth,
    budgetPeriodContaining,
    needName,
    budgetSuggestions,
    nextDueDate,
    DEFAULT_PRIORITY,
    type Account,
    type AccountKind,
    type Cents,
    type Tirelire,
    type Need,
    type PlannedFlow,
  } from '@tirelire/core';

  type Step = 'intro' | 'income' | 'fixed' | 'everyday' | 'periodic' | 'savings' | 'accounts' | 'summary';

  const STEPS: Array<{ id: Step; label: string }> = [
    { id: 'intro', label: 'Le principe' },
    { id: 'accounts', label: 'Comptes' },
    { id: 'income', label: 'Revenus' },
    { id: 'fixed', label: 'Charges fixes' },
    { id: 'everyday', label: 'Budgets' },
    { id: 'periodic', label: 'Pas tous les mois' },
    { id: 'savings', label: 'Épargne' },
    { id: 'summary', label: 'Résumé' },
  ];

  let step = $state<Step>('intro');
  const stepIndex = $derived(STEPS.findIndex((s) => s.id === step));

  /** Intervalles proposés, en mois. */
  const INTERVALS = [
    { months: 1, label: 'Tous les mois' },
    { months: 2, label: 'Tous les 2 mois' },
    { months: 3, label: 'Tous les 3 mois' },
    { months: 6, label: 'Tous les 6 mois' },
    { months: 12, label: 'Une fois par an' },
  ];

  const accounts = $derived(alive(app.ledger.accounts));
  const tirelires = $derived(alive(app.ledger.tirelires));
  const needs = $derived(alive(app.ledger.needs));
  const flows = $derived(alive(app.ledger.plannedFlows));
  const principal = $derived(accounts.find((a) => a.kind === 'principal'));
  const otherAccounts = $derived(accounts.filter((a) => a.kind !== 'principal'));
  const incomes = $derived(flows.filter((f) => f.kind === 'income'));
  const fixedCharges = $derived(flows.filter((f) => f.kind === 'fixedCharge'));
  const tirelireById = (id: string) => tirelires.find((e) => e.id === id);
  const needsOfKind = (k: Need['kind']) => needs.filter((n) => n.kind === k);
  const everydayNeeds = $derived(needsOfKind('recurring'));
  const periodicNeeds = $derived(needsOfKind('dueDate'));
  const savingsNeeds = $derived(needsOfKind('goal'));
  const totals = $derived(app.plan.totals);

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
  const periodStart = () => budgetPeriodContaining(app.asOf, Number(payDay) || 1).start;
  const perPeriod = (amount: Cents, months: number) => divideCents(amount, Math.max(1, months));

  /**
   * Le compte principal existe toujours : s'il n'a jamais été créé, on le crée en silence
   * plutôt que de faire remplir un formulaire de compte pour commencer un budget.
   */
  function ensureMainAccount(): string {
    if (principal) return principal.id;
    const row: Account = {
      id: app.newId(),
      name: 'Compte principal',
      kind: 'principal',
      openingBalance: 0,
      openingDate: periodStart(),
    };
    app.upsert('accounts', row);
    return row.id;
  }

  function goStep(s: Step) {
    step = s;
    semer(s);
  }
  $effect(() => {
    if (step === 'accounts') ensureMainAccount();
  });
  function next() {
    if (stepIndex < STEPS.length - 1) goStep(STEPS[stepIndex + 1]!.id);
  }
  function prev() {
    if (stepIndex > 0) goStep(STEPS[stepIndex - 1]!.id);
  }

  // --- Début de la période budgétaire : un choix du foyer, pas un champ de compte (D44) ---
  // Valeur initiale volontairement figée : le champ est ensuite piloté par la saisie.
  let payDay = $state(untrack(() => String(app.ledger.settings.periodStartDay)));
  function savePayDay() {
    const d = Math.min(31, Math.max(1, Number(payDay) || 1));
    payDay = String(d);
    if (app.ledger.settings.periodStartDay !== d) app.setSetting('periodStartDay', d);
  }
  /** Jour du plus gros revenu déclaré : ce que l'assistant propose comme début de période. */
  const jourDuRevenu = $derived.by(() => {
    const principal = [...incomes].sort((a, b) => b.amount - a.amount)[0];
    return principal ? parseDate(principal.periodicity.anchorDate).d : undefined;
  });

  // --- Revenus ---
  let inc = $state({ name: '', amount: '', months: 1, day: '1', accountId: '' });
  let incError = $state('');
  function creerRevenu(nom: string, montant: number, mois: number, jour: number, compte?: string) {
    const row: PlannedFlow = {
      id: app.newId(),
      name: nom,
      kind: 'income',
      amount: montant,
      accountId: compte || ensureMainAccount(),
      periodicity: { intervalMonths: mois, anchorDate: lastDayOnOrBefore(jour) },
      dateWindowDays: 5,
    };
    app.upsert('plannedFlows', row);
  }
  function addIncome() {
    const amount = inputToCents(inc.amount);
    if (!inc.name.trim()) return void (incError = 'Donne un nom à cette rentrée d’argent.');
    if (amount === undefined || amount <= 0) return void (incError = 'Indique un montant, en positif.');
    creerRevenu(inc.name.trim(), amount, inc.months, Number(inc.day) || 1, inc.accountId);
    inc = { name: '', amount: '', months: inc.months, day: inc.day, accountId: inc.accountId };
    incError = '';
  }

  // --- Charges fixes : montant fixe, tous les mois, sans réserve à constituer ---
  let fix = $state({ name: '', amount: '', months: 1, day: '5', accountId: '' });
  let fixError = $state('');
  function creerCharge(nom: string, montant: number, mois: number, jour: number, compte?: string) {
    const row: PlannedFlow = {
      id: app.newId(),
      name: nom,
      kind: 'fixedCharge',
      amount: -montant,
      accountId: compte || ensureMainAccount(),
      periodicity: { intervalMonths: mois, anchorDate: lastDayOnOrBefore(jour) },
      dateWindowDays: 5,
    };
    app.upsert('plannedFlows', row);
  }
  function addFixed() {
    const amount = inputToCents(fix.amount);
    if (!fix.name.trim()) return void (fixError = 'Donne un nom à cette charge.');
    if (amount === undefined || amount <= 0) return void (fixError = 'Indique un montant, en positif.');
    creerCharge(fix.name.trim(), amount, fix.months, Number(fix.day) || 1, fix.accountId);
    fix = { name: '', amount: '', months: fix.months, day: fix.day, accountId: fix.accountId };
    fixError = '';
  }

  // --- Budgets courants : une tirelire + un besoin récurrent ---
  let day = $state({ name: '', amount: '', keep: false });
  let dayError = $state('');
  function creerCourant(nom: string, montant: number, garde: boolean) {
    const tirelireId = app.newId();
    app.upsert('tirelires', {
      id: tirelireId,
      name: nom,
      placement: [],
      openingBalance: 0,
      openingDate: periodStart(),
      rollover: { mode: garde ? 'unlimited' : 'none' },
    } satisfies Tirelire);
    app.upsert('needs', {
      id: app.newId(),
      tirelireId,
      kind: 'recurring',
      amount: montant,
      periodicity: { intervalMonths: 1, anchorDate: periodStart() },
      priority: DEFAULT_PRIORITY.recurring,
    } satisfies Need);
  }
  function addEveryday() {
    const amount = inputToCents(day.amount);
    if (!day.name.trim()) return void (dayError = 'Donne un nom à ce budget.');
    if (amount === undefined || amount <= 0) return void (dayError = 'Indique un montant par période.');
    creerCourant(day.name.trim(), amount, day.keep);
    day = { name: '', amount: '', keep: day.keep };
    dayError = '';
  }
  // --- Dépenses qui ne tombent pas tous les mois : tirelire + besoin à échéance + flux ---
  let per = $state({ name: '', amount: '', months: 12, dueDate: '', withFlow: true, accountId: '' });
  let perError = $state('');
  const perPreview = $derived.by(() => {
    const a = inputToCents(per.amount);
    return a === undefined || a <= 0 ? undefined : perPeriod(a, per.months);
  });
  function creerPeriodique(nom: string, montant: number, mois: number, echeance: string, compte?: string, avecFlux = true) {
    const tirelireId = app.newId();
    app.upsert('tirelires', {
      id: tirelireId,
      name: nom,
      placement: [],
      openingBalance: 0,
      openingDate: periodStart(),
      rollover: { mode: 'unlimited' },
    } satisfies Tirelire);
    app.upsert('needs', {
      id: app.newId(),
      tirelireId,
      kind: 'dueDate',
      amount: montant,
      periodicity: { intervalMonths: mois, anchorDate: echeance },
      priority: DEFAULT_PRIORITY.dueDate,
    } satisfies Need);
    if (avecFlux) {
      app.upsert('plannedFlows', {
        id: app.newId(),
        name: nom,
        kind: 'dueDate',
        amount: -montant,
        accountId: compte || ensureMainAccount(),
        tirelireId,
        periodicity: { intervalMonths: mois, anchorDate: echeance },
        dateWindowDays: 7,
      } satisfies PlannedFlow);
    }
  }
  function addPeriodic() {
    const amount = inputToCents(per.amount);
    if (!per.name.trim()) return void (perError = 'Donne un nom à cette dépense.');
    if (amount === undefined || amount <= 0) return void (perError = 'Indique le montant de la facture.');
    if (!per.dueDate) return void (perError = 'Indique la date de la prochaine échéance.');
    creerPeriodique(per.name.trim(), amount, per.months, per.dueDate, per.accountId, per.withFlow);
    per = { name: '', amount: '', months: per.months, dueDate: '', withFlow: per.withFlow, accountId: per.accountId };
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
    app.upsert('tirelires', {
      id: tirelireId,
      name: nom,
      placement: [],
      openingBalance: 0,
      openingDate: periodStart(),
      rollover: { mode: 'unlimited' },
    } satisfies Tirelire);
    app.upsert('needs', {
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
    if (!sav.name.trim()) return void (savError = 'Donne un nom à cet objectif.');
    if (monthly === undefined || monthly <= 0) return void (savError = 'Indique combien mettre de côté par période.');
    creerEpargne(sav.name.trim(), monthly, inputToCents(sav.target));
    sav = { name: '', monthly: '', target: '' };
    savError = '';
  }

  // --- Comptes complémentaires (facultatif) et placement des réserves ---
  /** Natures proposées, hors compte principal. Typée : un genre renommé casse la compilation. */
  const NATURES: Array<Exclude<AccountKind, 'principal'>> = ['courant', 'epargne'];
  let acc = $state({ name: '', kind: 'courant' as Exclude<AccountKind, 'principal'>, balance: '0,00' });
  let accError = $state('');
  function addAccount() {
    if (!acc.name.trim()) return void (accError = 'Donne un nom à ce compte.');
    const openingBalance = inputToCents(acc.balance);
    if (openingBalance === undefined) return void (accError = 'Solde invalide.');
    ensureMainAccount();
    const row: Account = {
      id: app.newId(),
      name: acc.name.trim(),
      kind: acc.kind,
      openingBalance,
      openingDate: todayISO(),
    };
    app.upsert('accounts', row);
    acc = { name: '', kind: 'courant', balance: '0,00' };
    accError = '';
  }
  /** Placement voulu d'une tirelire (D38) : tout sur un compte, ou rien de déclaré. */
  function setPlacement(e: Tirelire, accountId: string) {
    const placement = accountId ? [{ accountId, share: { kind: 'variable' as const } }] : [];
    app.upsert('tirelires', { ...e, placement });
  }
  const reserveTirelires = $derived(
    tirelires.filter((e) => needs.some((n) => n.tirelireId === e.id && n.kind !== 'recurring')),
  );

  /**
   * Les propositions ne s'offrent que sur un projet vide (D43). Les opérations ne comptent pas :
   * un relevé peut avoir été importé avant que le budget existe. L'état est figé à l'ouverture de
   * l'assistant, sinon la première ligne ajoutée ferait disparaître les propositions suivantes.
   */
  const projetVierge = untrack(
    () =>
      alive(app.ledger.tirelires).length === 0 &&
      alive(app.ledger.needs).length === 0 &&
      alive(app.ledger.plannedFlows).length === 0 &&
      alive(app.ledger.accounts).filter((a) => a.kind !== 'principal').length === 0,
  );

  // --- Propositions (D43) : elles remplissent le formulaire, elles n'ajoutent rien d'office ---
  const propositions = projetVierge
    ? budgetSuggestions()
    : { incomes: [], charges: [], everyday: [], periodic: [], savings: [] };
  /** Une proposition déjà reprise disparaît de la liste : on ne propose pas ce qui est fait. */
  const dejaPris = (nom: string) =>
    flows.some((f) => f.name === nom) || tirelires.some((t) => t.name === nom);
  const cents = (c: number) => (c / 100).toFixed(2).replace('.', ',');

  /**
   * Étapes déjà garnies. Semer à l'entrée de l'étape, une seule fois : sans cette mémoire,
   * supprimer toutes les lignes les ferait repousser au retour sur l'étape.
   */
  const semees = new Set<Step>();
  function semer(etape: Step) {
    if (!projetVierge || semees.has(etape)) return;
    semees.add(etape);
    if (etape === 'income') for (const p of propositions.incomes) creerRevenu(p.name, p.amount, p.intervalMonths, p.day);
    if (etape === 'fixed') for (const p of propositions.charges) creerCharge(p.name, p.amount, p.intervalMonths, p.day);
    if (etape === 'everyday') for (const p of propositions.everyday) creerCourant(p.name, p.amount, p.keep);
    if (etape === 'periodic')
      for (const p of propositions.periodic)
        creerPeriodique(p.name, p.amount, p.intervalMonths, nextDueDate(p.month, p.day, app.asOf));
    if (etape === 'savings') for (const p of propositions.savings) creerEpargne(p.name, p.monthly, p.target);
  }

  // --- Édition en place de ce qui a été ajouté ---
  function editFlowName(f: PlannedFlow, v: string) {
    if (v.trim() && v.trim() !== f.name) app.upsert('plannedFlows', { ...f, name: v.trim() });
  }
  /** Le signe est porté par le genre du flux, pas par la saisie : on la prend en valeur absolue. */
  function editFlowAmount(f: PlannedFlow, v: string) {
    const c = inputToCents(v);
    if (c === undefined) return;
    const signe = f.kind === 'income' ? Math.abs(c) : -Math.abs(c);
    if (signe !== f.amount) app.upsert('plannedFlows', { ...f, amount: signe });
  }
  function editFlowAccount(f: PlannedFlow, v: string) {
    if (v && v !== f.accountId) app.upsert('plannedFlows', { ...f, accountId: v });
  }
  function editFlowDay(f: PlannedFlow, v: string) {
    const d = Math.min(31, Math.max(1, Number(v) || 1));
    const { y, m } = parseDate(f.periodicity.anchorDate);
    const anchorDate = dateInMonth(y, m, Math.min(d, daysInMonth(y, m)));
    if (anchorDate !== f.periodicity.anchorDate) {
      app.upsert('plannedFlows', { ...f, periodicity: { ...f.periodicity, anchorDate } });
    }
  }
  function editNeedName(n: Need, v: string) {
    const t = tirelireById(n.tirelireId);
    if (t && v.trim() && v.trim() !== t.name) app.upsert('tirelires', { ...t, name: v.trim() });
  }
  function editNeedAmount(n: Need, v: string) {
    const c = inputToCents(v);
    if (c === undefined || c < 0) return;
    const champ = n.kind === 'goal' ? 'monthlyAmount' : 'amount';
    if (n[champ] !== c) app.upsert('needs', { ...n, [champ]: c });
  }
  function editNeedTarget(n: Need, v: string) {
    const c = inputToCents(v);
    if (c === undefined || c < 0) return;
    if (n.amount !== c) app.upsert('needs', { ...n, amount: c });
  }
  function editNeedDueDate(n: Need, v: string) {
    if (!v || !n.periodicity || v === n.periodicity.anchorDate) return;
    app.upsert('needs', { ...n, periodicity: { ...n.periodicity, anchorDate: v } });
  }
  function editRollover(n: Need, keep: boolean) {
    const t = tirelireById(n.tirelireId);
    if (t) app.upsert('tirelires', { ...t, rollover: { mode: keep ? 'unlimited' : 'none' } });
  }

  /** Modification d'un compte, champ par champ, enregistrée à la volée. */
  function editAccount(a: Account, champ: 'name' | 'bank' | 'accountNumber', v: string) {
    const valeur = v.trim();
    if (valeur === (a[champ] ?? '')) return;
    ensureMainAccount();
    app.upsert('accounts', { ...a, [champ]: valeur || undefined });
  }
  function editAccountKind(a: Account, v: string) {
    if (v !== a.kind) app.upsert('accounts', { ...a, kind: v as AccountKind });
  }
  /** La date d'ouverture n'est jamais retouchée : elle cale les soldes d'un compte déjà importé. */
  function editAccountBalance(a: Account, v: string) {
    const c = inputToCents(v);
    if (c === undefined || c === a.openingBalance) return;
    app.upsert('accounts', { ...a, openingBalance: c });
  }

  function removeFlow(f: PlannedFlow) {
    app.remove('plannedFlows', f.id);
  }
  /** Retire un besoin et la tirelire qui le portait si elle n'en a plus d'autre. */
  function removeNeed(n: Need) {
    const others = needs.filter((x) => x.tirelireId === n.tirelireId && x.id !== n.id);
    for (const f of flows.filter((f) => f.tirelireId === n.tirelireId)) app.remove('plannedFlows', f.id);
    app.remove('needs', n.id);
    if (others.length === 0) app.remove('tirelires', n.tirelireId);
  }
</script>

<p class="small">
  <a href="#top" onclick={(e) => { e.preventDefault(); if (!app.back()) app.switchTab('more'); }}>‹ Retour</a>
</p>
<h1>Construire mon budget</h1>

<div class="wizard-steps">
  {#each STEPS as s, i (s.id)}
    <button class="wstep" class:active={s.id === step} class:done={i < stepIndex} onclick={() => goStep(s.id)}>{s.label}</button>
  {/each}
</div>

{#if step !== 'intro' && step !== 'accounts'}
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
      Les questions qui suivent construisent ce budget. Rien n'est définitif : tout se modifie ensuite
      dans Configuration, et vous pouvez sauter une étape qui ne vous concerne pas.
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
  <div class="tete tete-flux" class:avec-compte={accounts.length > 1}><span>Quoi ?</span><span class="d">Combien</span><span>Le</span>{#if accounts.length > 1}<span>Compte</span>{/if}<span></span></div>
  {#each incomes as f (f.id)}
    <div class="card ligne ligne-flux" class:avec-compte={accounts.length > 1}>
      <input class="nom" value={f.name} onchange={(e) => editFlowName(f, e.currentTarget.value)} />
      <input class="mt" value={centsToInput(Math.abs(f.amount))} inputmode="decimal" onchange={(e) => editFlowAmount(f, e.currentTarget.value)} />
      <input class="jour" type="number" min="1" max="31" value={parseDate(f.periodicity.anchorDate).d} onchange={(e) => editFlowDay(f, e.currentTarget.value)} />
      {#if accounts.length > 1}
        <select class="cpt" value={f.accountId} onchange={(e) => editFlowAccount(f, e.currentTarget.value)}>
          {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      {/if}
      <button class="btn small danger" onclick={() => removeFlow(f)}>×</button>
    </div>
  {/each}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addIncome(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={inc.name} placeholder="Salaire" /></label>
      <label class="f">Combien ? <input bind:value={inc.amount} inputmode="decimal" placeholder="2 400,00" /></label>
      <label class="f">À quelle fréquence ?
        <select bind:value={inc.months}>{#each INTERVALS as i}<option value={i.months}>{i.label}</option>{/each}</select>
      </label>
      <label class="f">Vers le (jour) <input type="number" min="1" max="31" bind:value={inc.day} /></label>
        {#if accounts.length > 1}
          <label class="f">Sur quel compte ?
            <select bind:value={inc.accountId}>
              {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
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
    {#if jourDuRevenu !== undefined && Number(payDay) !== jourDuRevenu}
      <button class="prop" onclick={() => { payDay = String(jourDuRevenu); savePayDay(); }}>
        <span class="n">Commencer au jour de ma paie</span><span class="v num">le {jourDuRevenu}</span>
      </button>
    {/if}
    {#if Number(payDay) !== 1}
      <button class="prop" onclick={() => { payDay = '1'; savePayDay(); }}>
        <span class="n">Suivre le mois calendaire</span><span class="v num">le 1er</span>
      </button>
    {/if}
  </div>
  <form class="edit" onsubmit={(e) => { e.preventDefault(); savePayDay(); }}>
    <div class="grid">
      <label class="f">La période commence le (jour) <input type="number" min="1" max="31" bind:value={payDay} onchange={savePayDay} /></label>
    </div>
  </form>

{:else if step === 'fixed'}
  <h2>Qu'est-ce qui part tout seul, au même montant ?</h2>
  <p class="muted small">
    Loyer, abonnements, mensualités : le montant est connu et il part chaque mois. Pas besoin de
    réserve — il suffit que le plan sache que cet argent est déjà engagé.
  </p>
  <h3>Charges fixes</h3>
  <div class="tete tete-flux" class:avec-compte={accounts.length > 1}><span>Quoi ?</span><span class="d">Combien</span><span>Le</span>{#if accounts.length > 1}<span>Compte</span>{/if}<span></span></div>
  {#each fixedCharges as f (f.id)}
    <div class="card ligne ligne-flux" class:avec-compte={accounts.length > 1}>
      <input class="nom" value={f.name} onchange={(e) => editFlowName(f, e.currentTarget.value)} />
      <input class="mt" value={centsToInput(Math.abs(f.amount))} inputmode="decimal" onchange={(e) => editFlowAmount(f, e.currentTarget.value)} />
      <input class="jour" type="number" min="1" max="31" value={parseDate(f.periodicity.anchorDate).d} onchange={(e) => editFlowDay(f, e.currentTarget.value)} />
      {#if accounts.length > 1}
        <select class="cpt" value={f.accountId} onchange={(e) => editFlowAccount(f, e.currentTarget.value)}>
          {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      {/if}
      <button class="btn small danger" onclick={() => removeFlow(f)}>×</button>
    </div>
  {/each}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addFixed(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={fix.name} placeholder="Loyer" /></label>
      <label class="f">Combien ? <input bind:value={fix.amount} inputmode="decimal" placeholder="750,00" /></label>
      <label class="f">À quelle fréquence ?
        <select bind:value={fix.months}>{#each INTERVALS as i}<option value={i.months}>{i.label}</option>{/each}</select>
      </label>
      <label class="f">Vers le (jour) <input type="number" min="1" max="31" bind:value={fix.day} /></label>
        {#if accounts.length > 1}
          <label class="f">Sur quel compte ?
            <select bind:value={fix.accountId}>
              {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
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
  <div class="tete tete-courant"><span>Quoi ?</span><span class="d">Par période</span><span>Reliquat</span><span></span></div>
  {#each everydayNeeds as n (n.id)}
    <div class="card ligne ligne-courant">
      <input class="nom" value={needName(n, tirelireById(n.tirelireId))} onchange={(e) => editNeedName(n, e.currentTarget.value)} />
      <input class="mt" value={centsToInput(n.amount ?? 0)} inputmode="decimal" onchange={(e) => editNeedAmount(n, e.currentTarget.value)} />
      <label class="garde small" title="Garder ce qui n'a pas été dépensé">
        <input type="checkbox" checked={tirelireById(n.tirelireId)?.rollover?.mode !== 'none'} onchange={(e) => editRollover(n, e.currentTarget.checked)} /> garder
      </label>
      <button class="btn small danger" onclick={() => removeNeed(n)}>×</button>
    </div>
  {/each}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addEveryday(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={day.name} placeholder="Courses" /></label>
      <label class="f">Combien par période ? <input bind:value={day.amount} inputmode="decimal" placeholder="500,00" /></label>
      <label class="f check"><input type="checkbox" bind:checked={day.keep} /> Garder ce qui n'a pas été dépensé</label>
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
  {#each periodicNeeds as n (n.id)}
    <div class="card">
      <div class="ligne ligne-echeance">
        <input class="nom" value={needName(n, tirelireById(n.tirelireId))} onchange={(e) => editNeedName(n, e.currentTarget.value)} />
        <input class="mt" value={centsToInput(n.amount ?? 0)} inputmode="decimal" onchange={(e) => editNeedAmount(n, e.currentTarget.value)} />
        <input class="date" type="date" value={n.periodicity?.anchorDate ?? todayISO()} onchange={(e) => editNeedDueDate(n, e.currentTarget.value)} />
        <button class="btn small danger" onclick={() => removeNeed(n)}>×</button>
      </div>
      <p class="muted small" style="margin:4px 0 0">
        {money(perPeriod(n.amount ?? 0, n.periodicity?.intervalMonths ?? 12))} à mettre de côté par mois.
      </p>
    </div>
  {/each}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addPeriodic(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={per.name} placeholder="Assurance auto" /></label>
      <label class="f">Montant de la facture <input bind:value={per.amount} inputmode="decimal" placeholder="1 200,00" /></label>
      <label class="f">Elle revient
        <select bind:value={per.months}>{#each INTERVALS.filter((i) => i.months > 1) as i}<option value={i.months}>{i.label}</option>{/each}</select>
      </label>
      <label class="f">Prochaine échéance <input type="date" bind:value={per.dueDate} /></label>
        {#if accounts.length > 1}
          <label class="f">Sur quel compte ?
            <select bind:value={per.accountId}>
              {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
            </select>
          </label>
        {/if}
      <label class="f check"><input type="checkbox" bind:checked={per.withFlow} /> Attendre le prélèvement à cette date</label>
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
  {#each savingsNeeds as n (n.id)}
    <div class="card ligne ligne-epargne">
      <input class="nom" value={needName(n, tirelireById(n.tirelireId))} onchange={(e) => editNeedName(n, e.currentTarget.value)} />
      <input class="mt" value={centsToInput(n.monthlyAmount ?? 0)} inputmode="decimal" onchange={(e) => editNeedAmount(n, e.currentTarget.value)} />
      <input class="mt" value={n.amount ? centsToInput(n.amount) : ''} inputmode="decimal" placeholder="cible" onchange={(e) => editNeedTarget(n, e.currentTarget.value)} />
      <button class="btn small danger" onclick={() => removeNeed(n)}>×</button>
    </div>
  {/each}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addSavings(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={sav.name} placeholder="Vacances" /></label>
      <label class="f">Combien par période ? <input bind:value={sav.monthly} inputmode="decimal" placeholder="150,00" /></label>
      <label class="f">Cible (facultatif) <input bind:value={sav.target} inputmode="decimal" placeholder="1 800,00" /></label>
    </div>
    {#if savPreview !== undefined}
      <p class="small" style="margin:0">Cible atteinte en <strong>{savPreview} périodes</strong>.</p>
    {/if}
    {#if savError}<div class="err">{savError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter</button></div>
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
      <button class="btn small danger" title="Retirer ce compte" onclick={() => app.remove('accounts', a.id)}>×</button>
    </div>
  {/each}

  <form class="edit" onsubmit={(e) => { e.preventDefault(); addAccount(); }}>
    <div class="grid">
      <label class="f">Nom du compte <input bind:value={acc.name} placeholder="Livret A" /></label>
      <label class="f">Type
        <select bind:value={acc.kind}>
          {#each NATURES as k}<option value={k}>{ACCOUNT_KINDS[k]}</option>{/each}
        </select>
      </label>
      <label class="f">Solde actuel <input bind:value={acc.balance} inputmode="decimal" /></label>
    </div>
    {#if accError}<div class="err">{accError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter un compte</button></div>
  </form>

{:else if step === 'summary'}
  <h2>Votre budget</h2>
  {#if totals.margin < 0}
    <div class="card warn">
      <p style="margin:0">
        Il manque <strong>{money(-totals.margin)}</strong> par période pour tout financer. Ce n'est pas
        une erreur de votre part : c'est exactement ce que l'application est là pour montrer. Baissez un
        budget, étalez une échéance, ou mettez une épargne en attente.
      </p>
    </div>
  {:else}
    <div class="card accent">
      <p style="margin:0">
        Tout est finançable, et il vous reste <strong>{money(totals.margin)}</strong> par période une fois
        les réserves mises de côté.
      </p>
    </div>
  {/if}

  <div class="card">
    <div class="row"><div class="label">Rentrées d'argent</div><div class="num pos">{money(totals.incomes)}</div></div>
    <div class="row"><div class="label">Charges fixes</div><div class="num">{money(-totals.fixedCharges)}</div></div>
    <div class="row"><div class="label">Réserves à constituer ({needs.length})</div><div class="num">{money(-totals.requested)}</div></div>
    <div class="row total"><div class="label">Reste à vivre</div><div class="num {totals.margin < 0 ? 'neg' : 'pos'}">{money(totals.margin)}</div></div>
  </div>

  {#if otherAccounts.length && reserveTirelires.length}
    <h3>Où doit dormir chaque réserve ?</h3>
    <p class="muted small">Laissez sur le compte principal si vous ne savez pas : ça se change à tout moment.</p>
    {#each reserveTirelires as e (e.id)}
      <div class="card">
        <div class="row">
          <div class="label"><strong>{e.name}</strong></div>
          <select onchange={(ev) => setPlacement(e, (ev.currentTarget as HTMLSelectElement).value)}>
            <option value="" selected={e.placement.length === 0}>Peu importe</option>
            {#each accounts as a}
              <option value={a.id} selected={e.placement[0]?.accountId === a.id}>{a.name}</option>
            {/each}
          </select>
        </div>
      </div>
    {/each}
  {/if}

  <h3>Et maintenant</h3>
  <p class="muted small">
    Le Plan détaille période par période ce qu'il faut mettre de côté et les virements à faire.
    Dans Configuration, vous pouvez affiner ce que l'assistant a créé : plusieurs besoins sur une même
    tirelire, priorités de financement, ventilation des dépenses par catégorie. L'import d'un relevé
    rapprochera ensuite vos opérations réelles de ce budget.
  </p>
  <div class="actions">
    <button class="btn primary" onclick={() => app.switchTab('plan')}>Voir le plan</button>
    <button class="btn" onclick={() => app.switchTab('more')}>Configuration</button>
    <button class="btn" onclick={() => app.switchTab('import')}>Importer un relevé</button>
  </div>
{/if}

{#if step !== 'summary'}
  <div class="actions">
    {#if stepIndex > 0}<button class="btn" onclick={prev}>‹ Précédent</button>{/if}
    <button class="btn primary" onclick={next}>{step === 'intro' ? 'Commencer' : 'Suivant'} ›</button>
  </div>
{/if}
