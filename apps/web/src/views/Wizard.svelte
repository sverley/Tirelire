<!--
  Assistant de configuration (D40) : construire un budget en répondant à des questions simples,
  pas en remplissant les écrans de configuration. Chaque réponse crée les objets du modèle
  (enveloppes, besoins, flux prévus) sans que l'utilisateur ait à connaître ces mots.
  Le compte principal est créé en silence ; les autres comptes sont proposés, jamais imposés.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { money, shortDate, inputToCents } from '../lib/format';
  import {
    alive,
    divideCents,
    dateInMonth,
    parseDate,
    todayISO,
    daysInMonth,
    payPeriodContaining,
    needName,
    DEFAULT_PRIORITY,
    type Account,
    type Cents,
    type Envelope,
    type Need,
    type PlannedFlow,
  } from '@tirelire/core';

  type Step = 'intro' | 'income' | 'fixed' | 'everyday' | 'periodic' | 'savings' | 'accounts' | 'summary';

  const STEPS: Array<{ id: Step; label: string }> = [
    { id: 'intro', label: 'Le principe' },
    { id: 'income', label: 'Revenus' },
    { id: 'fixed', label: 'Charges fixes' },
    { id: 'everyday', label: 'Budgets' },
    { id: 'periodic', label: 'Pas tous les mois' },
    { id: 'savings', label: 'Épargne' },
    { id: 'accounts', label: 'Comptes' },
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
  const envelopes = $derived(alive(app.ledger.envelopes));
  const needs = $derived(alive(app.ledger.needs));
  const flows = $derived(alive(app.ledger.plannedFlows));
  const pivot = $derived(accounts.find((a) => a.kind === 'pivot'));
  const otherAccounts = $derived(accounts.filter((a) => a.kind !== 'pivot'));
  const incomes = $derived(flows.filter((f) => f.kind === 'income'));
  const fixedCharges = $derived(flows.filter((f) => f.kind === 'fixedCharge'));
  const envelopeById = (id: string) => envelopes.find((e) => e.id === id);
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
   * Date d'ouverture d'une enveloppe : le début de la période en cours. La chronologie ne
   * démarre qu'à la première période entièrement postérieure à l'ouverture ; ouvrir « aujourd'hui »
   * priverait donc le budget de sa toute première période.
   */
  const periodStart = () => payPeriodContaining(app.asOf, Number(payDay) || 1).start;
  const perPeriod = (amount: Cents, months: number) => divideCents(amount, Math.max(1, months));

  /**
   * Le compte principal existe toujours : s'il n'a jamais été créé, on le crée en silence
   * plutôt que de faire remplir un formulaire de compte pour commencer un budget.
   */
  function ensureMainAccount(): string {
    if (pivot) return pivot.id;
    const row: Account = {
      id: app.newId(),
      name: 'Compte principal',
      kind: 'pivot',
      openingBalance: 0,
      openingDate: todayISO(),
      payDay: Number(payDay) || 1,
    };
    app.upsert('accounts', row);
    return row.id;
  }

  function goStep(s: Step) {
    step = s;
  }
  function next() {
    if (stepIndex < STEPS.length - 1) goStep(STEPS[stepIndex + 1]!.id);
  }
  function prev() {
    if (stepIndex > 0) goStep(STEPS[stepIndex - 1]!.id);
  }

  // --- Jour de paie : définit la période budgétaire (D02) ---
  // Valeur initiale volontairement figée : le champ est ensuite piloté par la saisie.
  let payDay = $state(untrack(() => String(pivot?.payDay ?? 1)));
  let mainBalance = $state(untrack(() => (pivot ? (pivot.openingBalance / 100).toFixed(2).replace('.', ',') : '')));
  function savePayDay() {
    const d = Math.min(31, Math.max(1, Number(payDay) || 1));
    payDay = String(d);
    const id = ensureMainAccount();
    const a = alive(app.ledger.accounts).find((x) => x.id === id);
    if (a && a.payDay !== d) app.upsert('accounts', { ...a, payDay: d });
  }
  function saveMainBalance() {
    const c = inputToCents(mainBalance);
    if (c === undefined) return;
    const id = ensureMainAccount();
    const a = alive(app.ledger.accounts).find((x) => x.id === id);
    if (a && a.openingBalance !== c) app.upsert('accounts', { ...a, openingBalance: c, openingDate: periodStart() });
  }

  // --- Revenus ---
  let inc = $state({ name: '', amount: '', months: 1, day: '1' });
  let incError = $state('');
  function addIncome() {
    const amount = inputToCents(inc.amount);
    if (!inc.name.trim()) return void (incError = 'Donne un nom à cette rentrée d’argent.');
    if (amount === undefined || amount <= 0) return void (incError = 'Indique un montant, en positif.');
    const accountId = ensureMainAccount();
    const row: PlannedFlow = {
      id: app.newId(),
      name: inc.name.trim(),
      kind: 'income',
      amount,
      accountId,
      periodicity: { intervalMonths: inc.months, anchorDate: lastDayOnOrBefore(Number(inc.day) || 1) },
      dateWindowDays: 5,
    };
    app.upsert('plannedFlows', row);
    inc = { name: '', amount: '', months: inc.months, day: inc.day };
    incError = '';
  }

  // --- Charges fixes : montant fixe, tous les mois, sans réserve à constituer ---
  let fix = $state({ name: '', amount: '', months: 1, day: '5' });
  let fixError = $state('');
  function addFixed() {
    const amount = inputToCents(fix.amount);
    if (!fix.name.trim()) return void (fixError = 'Donne un nom à cette charge.');
    if (amount === undefined || amount <= 0) return void (fixError = 'Indique un montant, en positif.');
    const accountId = ensureMainAccount();
    const row: PlannedFlow = {
      id: app.newId(),
      name: fix.name.trim(),
      kind: 'fixedCharge',
      amount: -amount,
      accountId,
      periodicity: { intervalMonths: fix.months, anchorDate: lastDayOnOrBefore(Number(fix.day) || 1) },
      dateWindowDays: 5,
    };
    app.upsert('plannedFlows', row);
    fix = { name: '', amount: '', months: fix.months, day: fix.day };
    fixError = '';
  }

  // --- Budgets courants : une enveloppe + un besoin récurrent ---
  let day = $state({ name: '', amount: '', keep: false });
  let dayError = $state('');
  function addEveryday() {
    const amount = inputToCents(day.amount);
    if (!day.name.trim()) return void (dayError = 'Donne un nom à ce budget.');
    if (amount === undefined || amount <= 0) return void (dayError = 'Indique un montant par période.');
    const envelopeId = app.newId();
    const envelope: Envelope = {
      id: envelopeId,
      name: day.name.trim(),
      placement: [],
      openingBalance: 0,
      openingDate: periodStart(),
      rollover: { mode: day.keep ? 'unlimited' : 'none' },
    };
    const need: Need = {
      id: app.newId(),
      envelopeId,
      kind: 'recurring',
      amount,
      periodicity: { intervalMonths: 1, anchorDate: periodStart() },
      priority: DEFAULT_PRIORITY.recurring,
    };
    app.upsert('envelopes', envelope);
    app.upsert('needs', need);
    day = { name: '', amount: '', keep: day.keep };
    dayError = '';
  }

  // --- Dépenses qui ne tombent pas tous les mois : enveloppe + besoin à échéance + flux ---
  let per = $state({ name: '', amount: '', months: 12, dueDate: '', withFlow: true });
  let perError = $state('');
  const perPreview = $derived.by(() => {
    const a = inputToCents(per.amount);
    return a === undefined || a <= 0 ? undefined : perPeriod(a, per.months);
  });
  function addPeriodic() {
    const amount = inputToCents(per.amount);
    if (!per.name.trim()) return void (perError = 'Donne un nom à cette dépense.');
    if (amount === undefined || amount <= 0) return void (perError = 'Indique le montant de la facture.');
    if (!per.dueDate) return void (perError = 'Indique la date de la prochaine échéance.');
    const envelopeId = app.newId();
    const envelope: Envelope = {
      id: envelopeId,
      name: per.name.trim(),
      placement: [],
      openingBalance: 0,
      openingDate: periodStart(),
      rollover: { mode: 'unlimited' },
    };
    const need: Need = {
      id: app.newId(),
      envelopeId,
      kind: 'dueDate',
      amount,
      periodicity: { intervalMonths: per.months, anchorDate: per.dueDate },
      priority: DEFAULT_PRIORITY.dueDate,
    };
    app.upsert('envelopes', envelope);
    app.upsert('needs', need);
    if (per.withFlow) {
      const flow: PlannedFlow = {
        id: app.newId(),
        name: per.name.trim(),
        kind: 'dueDate',
        amount: -amount,
        accountId: ensureMainAccount(),
        envelopeId,
        periodicity: { intervalMonths: per.months, anchorDate: per.dueDate },
        dateWindowDays: 7,
      };
      app.upsert('plannedFlows', flow);
    }
    per = { name: '', amount: '', months: per.months, dueDate: '', withFlow: per.withFlow };
    perError = '';
  }

  // --- Épargne : enveloppe + besoin objectif ---
  let sav = $state({ name: '', monthly: '', target: '' });
  let savError = $state('');
  const savPreview = $derived.by(() => {
    const m = inputToCents(sav.monthly);
    const t = inputToCents(sav.target);
    if (m === undefined || m <= 0 || t === undefined || t <= 0) return undefined;
    return Math.ceil(t / m);
  });
  function addSavings() {
    const monthly = inputToCents(sav.monthly);
    if (!sav.name.trim()) return void (savError = 'Donne un nom à cet objectif.');
    if (monthly === undefined || monthly <= 0) return void (savError = 'Indique combien mettre de côté par période.');
    const target = inputToCents(sav.target);
    const envelopeId = app.newId();
    const envelope: Envelope = {
      id: envelopeId,
      name: sav.name.trim(),
      placement: [],
      openingBalance: 0,
      openingDate: periodStart(),
      rollover: { mode: 'unlimited' },
    };
    const need: Need = {
      id: app.newId(),
      envelopeId,
      kind: 'goal',
      monthlyAmount: monthly,
      priority: DEFAULT_PRIORITY.goal,
      ...(target !== undefined && target > 0 ? { amount: target } : {}),
    };
    app.upsert('envelopes', envelope);
    app.upsert('needs', need);
    sav = { name: '', monthly: '', target: '' };
    savError = '';
  }

  // --- Comptes complémentaires (facultatif) et placement des réserves ---
  let acc = $state({ name: '', kind: 'holding' as 'holding' | 'third', balance: '0,00' });
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
      ...(acc.kind === 'third' ? { settlementThreshold: 1000, settlementDirection: 'both' as const } : {}),
    };
    app.upsert('accounts', row);
    acc = { name: '', kind: 'holding', balance: '0,00' };
    accError = '';
  }
  /** Placement voulu d'une enveloppe (D38) : tout sur un compte, ou rien de déclaré. */
  function setPlacement(e: Envelope, accountId: string) {
    const placement = accountId ? [{ accountId, share: { kind: 'variable' as const } }] : [];
    app.upsert('envelopes', { ...e, placement });
  }
  const reserveEnvelopes = $derived(
    envelopes.filter((e) => needs.some((n) => n.envelopeId === e.id && n.kind !== 'recurring')),
  );

  function removeFlow(f: PlannedFlow) {
    app.remove('plannedFlows', f.id);
  }
  /** Retire un besoin et l'enveloppe qui le portait si elle n'en a plus d'autre. */
  function removeNeed(n: Need) {
    const others = needs.filter((x) => x.envelopeId === n.envelopeId && x.id !== n.id);
    for (const f of flows.filter((f) => f.envelopeId === n.envelopeId)) app.remove('plannedFlows', f.id);
    app.remove('needs', n.id);
    if (others.length === 0) app.remove('envelopes', n.envelopeId);
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

{#if step !== 'intro'}
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
      Une <strong>enveloppe</strong> est une réserve pour une de ces dépenses. Vous mettez un peu de côté
      à chaque paie, et l'argent est là le jour venu. Tirelire calcule combien : une facture de 1 200 €
      par an, c'est 100 € par mois. L'argent ne bouge pas de votre compte — l'enveloppe dit seulement
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
    Le jour de paie découpe le budget : une période va d'une paie à la veille de la suivante, plutôt
    que du 1<sup>er</sup> au 31. C'est ce qui permet de savoir si l'argent tient jusqu'à la prochaine rentrée.
  </p>
  <form class="edit" onsubmit={(e) => { e.preventDefault(); savePayDay(); saveMainBalance(); }}>
    <div class="grid">
      <label class="f">Jour de paie <input type="number" min="1" max="31" bind:value={payDay} onchange={savePayDay} /></label>
      <label class="f">Ce qu'il y a sur le compte aujourd'hui <input bind:value={mainBalance} inputmode="decimal" placeholder="1 250,00" onchange={saveMainBalance} /></label>
    </div>
  </form>

  <h3>Rentrées d'argent</h3>
  {#each incomes as f (f.id)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{f.name}</strong>
          <span class="sub">{INTERVALS.find((i) => i.months === f.periodicity.intervalMonths)?.label ?? `tous les ${f.periodicity.intervalMonths} mois`} · vers le {shortDate(f.periodicity.anchorDate).slice(0, -5)}</span>
        </div>
        <div class="num pos">{money(f.amount)}</div>
        <button class="btn small danger" onclick={() => removeFlow(f)}>×</button>
      </div>
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
    </div>
    {#if incError}<div class="err">{incError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter</button></div>
  </form>
{:else if step === 'fixed'}
  <h2>Qu'est-ce qui part tout seul, au même montant ?</h2>
  <p class="muted small">
    Loyer, abonnements, mensualités : le montant est connu et il part chaque mois. Pas besoin de
    réserve — il suffit que le plan sache que cet argent est déjà engagé.
  </p>
  {#each fixedCharges as f (f.id)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{f.name}</strong>
          <span class="sub">{INTERVALS.find((i) => i.months === f.periodicity.intervalMonths)?.label ?? `tous les ${f.periodicity.intervalMonths} mois`} · vers le {shortDate(f.periodicity.anchorDate).slice(0, -5)}</span>
        </div>
        <div class="num">{money(f.amount)}</div>
        <button class="btn small danger" onclick={() => removeFlow(f)}>×</button>
      </div>
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
    </div>
    {#if fixError}<div class="err">{fixError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter</button></div>
  </form>
{:else if step === 'everyday'}
  <h2>Sur quoi voulez-vous vous tenir à un montant ?</h2>
  <p class="muted small">
    Courses, essence, restaurants : le montant varie, mais vous voulez vous fixer une limite par
    période et voir ce qu'il en reste. C'est une enveloppe qui se remplit à chaque paie.
  </p>
  {#each everydayNeeds as n (n.id)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{needName(n, envelopeById(n.envelopeId))}</strong>
          <span class="sub">{envelopeById(n.envelopeId)?.rollover?.mode === 'unlimited' ? 'ce qui reste est reporté' : 'repart à zéro chaque période'}</span>
        </div>
        <div class="num">{money(n.amount ?? 0)}</div>
        <button class="btn small danger" onclick={() => removeNeed(n)}>×</button>
      </div>
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
    C'est ici que les enveloppes servent vraiment. Donnez le montant de la facture et sa date : Tirelire
    répartit la somme sur les paies qui restent d'ici là, et vous n'aurez pas de mauvaise surprise.
  </p>
  {#each periodicNeeds as n (n.id)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{needName(n, envelopeById(n.envelopeId))}</strong>
          <span class="sub">
            {money(n.amount ?? 0)} le {shortDate(n.periodicity?.anchorDate ?? todayISO())} ·
            {money(perPeriod(n.amount ?? 0, n.periodicity?.intervalMonths ?? 12))} à mettre de côté par mois
          </span>
        </div>
        <button class="btn small danger" onclick={() => removeNeed(n)}>×</button>
      </div>
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
  {#each savingsNeeds as n (n.id)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{needName(n, envelopeById(n.envelopeId))}</strong>
          <span class="sub">{money(n.monthlyAmount ?? 0)} par période{n.amount ? ` · cible ${money(n.amount)}` : ''}</span>
        </div>
        <button class="btn small danger" onclick={() => removeNeed(n)}>×</button>
      </div>
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
  <h2>Avez-vous d'autres comptes ? <span class="pill">facultatif</span></h2>
  <p class="muted small">
    Le budget ci-dessus fonctionne sans rien déclarer de plus : tout est réputé sur votre compte
    principal. Si vos réserves dorment ailleurs — un livret, par exemple — dites-le, et Tirelire vous
    dira quel virement faire pour que l'argent soit là où vous le voulez.
  </p>
  {#each otherAccounts as a (a.id)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{a.name}</strong> <span class="pill">{a.kind === 'holding' ? 'épargne' : 'compte tiers'}</span>
          <span class="sub">solde de départ {money(a.openingBalance)}</span>
        </div>
        <button class="btn small danger" onclick={() => app.remove('accounts', a.id)}>×</button>
      </div>
    </div>
  {/each}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); addAccount(); }}>
    <div class="grid">
      <label class="f">Nom <input bind:value={acc.name} placeholder="Livret A" /></label>
      <label class="f">Type
        <select bind:value={acc.kind}>
          <option value="holding">Compte d'épargne (il héberge des réserves)</option>
          <option value="third">Compte tiers (suivi à la main)</option>
        </select>
      </label>
      <label class="f">Solde actuel <input bind:value={acc.balance} inputmode="decimal" /></label>
    </div>
    {#if accError}<div class="err">{accError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter</button></div>
  </form>

  {#if otherAccounts.length && reserveEnvelopes.length}
    <h3>Où doit dormir chaque réserve ?</h3>
    <p class="muted small">Laissez sur le compte principal si vous ne savez pas : ça se change à tout moment.</p>
    {#each reserveEnvelopes as e (e.id)}
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

  <h3>Et maintenant</h3>
  <p class="muted small">
    Le Plan détaille période par période ce qu'il faut mettre de côté et les virements à faire.
    Dans Configuration, vous pouvez affiner ce que l'assistant a créé : plusieurs besoins sur une même
    enveloppe, priorités de financement, ventilation des dépenses par catégorie. L'import d'un relevé
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
