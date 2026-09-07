<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, shortDate, centsToInput, inputToCents, ACCOUNT_KINDS, ENVELOPE_KINDS, periodicityLabel } from '../lib/format';
  import {
    alive,
    indexLedger,
    envelopeBalance,
    nextOccurrence,
    DEFAULT_PRIORITY,
    type Account,
    type AccountKind,
    type SettlementDirection,
    type Envelope,
    type EnvelopeKind,
    type PlannedFlow,
  } from '@tirelire/core';

  type Step = 'intro' | 'pivot' | 'accounts' | 'envelopes' | 'goals' | 'income' | 'charges' | 'summary';
  const STEPS: Array<{ id: Step; label: string }> = [
    { id: 'intro', label: 'Bienvenue' },
    { id: 'pivot', label: 'Pivot' },
    { id: 'accounts', label: 'Comptes' },
    { id: 'envelopes', label: 'Enveloppes' },
    { id: 'goals', label: 'Objectifs' },
    { id: 'income', label: 'Revenus' },
    { id: 'charges', label: 'Charges' },
    { id: 'summary', label: 'Résumé' },
  ];

  let step = $state<Step>('intro');
  const stepIndex = $derived(STEPS.findIndex((s) => s.id === step));

  const idx = $derived(indexLedger(app.ledger));
  const accounts = $derived(alive(app.ledger.accounts));
  const pivot = $derived(accounts.find((a) => a.kind === 'pivot'));
  const others = $derived(accounts.filter((a) => a.kind !== 'pivot'));
  const envelopes = $derived(alive(app.ledger.envelopes));
  const provisionsAndBudgets = $derived(envelopes.filter((e) => e.kind !== 'goal'));
  const provisions = $derived(envelopes.filter((e) => e.kind === 'provision'));
  const goals = $derived(envelopes.filter((e) => e.kind === 'goal'));
  const flows = $derived(alive(app.ledger.plannedFlows));
  const incomeFlows = $derived(flows.filter((f) => f.kind === 'income'));
  const chargeFlows = $derived(flows.filter((f) => f.kind === 'fixedCharge' || f.kind === 'dueDate'));

  function canGo(s: Step): boolean {
    return s === 'intro' || s === 'pivot' || !!pivot;
  }
  function go(s: Step) {
    if (canGo(s)) step = s;
  }
  function next() {
    if (stepIndex < STEPS.length - 1) go(STEPS[stepIndex + 1]!.id);
  }
  function prev() {
    if (stepIndex > 0) step = STEPS[stepIndex - 1]!.id;
  }
  function defaultHost(): string {
    return others.find((a) => a.kind === 'holding')?.id ?? pivot?.id ?? '';
  }

  // --- Pivot ---
  let pivotForm = $state({ name: '', bank: '', openingBalance: '0,00', openingDate: app.asOf, payDay: '1' });
  let pivotEditing = $state(false);
  let pivotError = $state('');

  function startPivotEdit() {
    if (!pivot) return;
    pivotForm = { name: pivot.name, bank: pivot.bank ?? '', openingBalance: centsToInput(pivot.openingBalance), openingDate: pivot.openingDate, payDay: String(pivot.payDay ?? 1) };
    pivotEditing = true;
    pivotError = '';
  }
  function savePivot(e: Event) {
    e.preventDefault();
    if (!pivotForm.name.trim()) return void (pivotError = 'Le nom est obligatoire.');
    const openingBalance = inputToCents(pivotForm.openingBalance);
    if (openingBalance === undefined) return void (pivotError = 'Solde initial invalide.');
    const payDay = Math.min(31, Math.max(1, Number(pivotForm.payDay) || 1));
    const row: Account = {
      id: pivot?.id ?? app.newId(),
      name: pivotForm.name.trim(),
      kind: 'pivot',
      openingBalance,
      openingDate: pivotForm.openingDate,
      payDay,
      ...(pivotForm.bank.trim() ? { bank: pivotForm.bank.trim() } : {}),
    };
    app.upsert('accounts', row);
    pivotEditing = false;
  }

  // --- Comptes complémentaires ---
  let accForm = $state({ name: '', kind: 'holding' as AccountKind, bank: '', openingBalance: '0,00', openingDate: app.asOf, settlementThreshold: '10,00', settlementDirection: 'both' as SettlementDirection });
  let accEditing = $state(false);
  let accError = $state('');

  function startAccNew() {
    accForm = { name: '', kind: 'holding', bank: '', openingBalance: '0,00', openingDate: app.asOf, settlementThreshold: '10,00', settlementDirection: 'both' };
    accEditing = true;
    accError = '';
  }
  function saveAcc(e: Event) {
    e.preventDefault();
    if (!accForm.name.trim()) return void (accError = 'Le nom est obligatoire.');
    const openingBalance = inputToCents(accForm.openingBalance);
    if (openingBalance === undefined) return void (accError = 'Solde initial invalide.');
    const row: Account = {
      id: app.newId(),
      name: accForm.name.trim(),
      kind: accForm.kind,
      openingBalance,
      openingDate: accForm.openingDate,
      ...(accForm.bank.trim() ? { bank: accForm.bank.trim() } : {}),
      ...(accForm.kind === 'third' ? { settlementThreshold: inputToCents(accForm.settlementThreshold) ?? 0, settlementDirection: accForm.settlementDirection } : {}),
    };
    app.upsert('accounts', row);
    accEditing = false;
  }
  function removeAccount(a: Account) {
    if (confirm(`Supprimer le compte « ${a.name} » ?`)) app.remove('accounts', a.id);
  }

  // --- Enveloppes (provisions et budgets) ---
  let envForm = $state({ name: '', kind: 'provision' as EnvelopeKind, accountId: '', openingBalance: '0,00', openingDate: app.asOf, target: '', intervalMonths: '12', anchorDate: app.asOf, rollover: 'none' as 'none' | 'unlimited' | 'capped', rolloverMonths: '3' });
  let envEditing = $state(false);
  let envError = $state('');

  function startEnvNew() {
    envForm = { name: '', kind: 'provision', accountId: defaultHost(), openingBalance: '0,00', openingDate: app.asOf, target: '', intervalMonths: '12', anchorDate: app.asOf, rollover: 'none', rolloverMonths: '3' };
    envEditing = true;
    envError = '';
  }
  function onEnvKindChange() {
    envForm.intervalMonths = envForm.kind === 'budget' ? '1' : '12';
  }
  function saveEnv(e: Event) {
    e.preventDefault();
    if (!envForm.name.trim()) return void (envError = 'Le nom est obligatoire.');
    if (!envForm.accountId) return void (envError = 'Choisis le compte qui héberge l’enveloppe.');
    const openingBalance = inputToCents(envForm.openingBalance);
    if (openingBalance === undefined) return void (envError = 'Solde initial invalide.');
    const target = inputToCents(envForm.target);
    if (target === undefined) return void (envError = envForm.kind === 'provision' ? 'Montant de l’échéance invalide.' : 'Montant du budget invalide.');
    const interval = Math.max(1, Number(envForm.intervalMonths) || 1);
    const row: Envelope = {
      id: app.newId(),
      name: envForm.name.trim(),
      kind: envForm.kind,
      accountId: envForm.accountId,
      openingBalance,
      openingDate: envForm.openingDate,
      target,
      periodicity: { intervalMonths: interval, anchorDate: envForm.anchorDate },
      priority: DEFAULT_PRIORITY[envForm.kind],
      ...(envForm.kind === 'budget' ? { rollover: envForm.rollover === 'capped' ? { mode: 'capped' as const, months: Math.max(1, Number(envForm.rolloverMonths) || 1) } : { mode: envForm.rollover } } : {}),
    };
    app.upsert('envelopes', row);
    envEditing = false;
  }
  function removeEnvelope(en: Envelope) {
    if (confirm(`Supprimer l’enveloppe « ${en.name} » ?`)) app.remove('envelopes', en.id);
  }
  function describeEnv(e: Envelope): string {
    if (e.kind === 'provision') return `${money(e.target ?? 0)} ${periodicityLabel(e.periodicity)}`;
    const per = e.periodicity?.intervalMonths === 12 ? 'par an' : e.periodicity && e.periodicity.intervalMonths > 1 ? `tous les ${e.periodicity.intervalMonths} mois` : 'par mois';
    return `${money(e.target ?? 0)} ${per}`;
  }

  // --- Objectifs d'épargne (enveloppes de type goal) ---
  let goalForm = $state({ name: '', accountId: '', openingBalance: '0,00', openingDate: app.asOf, monthlyAmount: '', target: '' });
  let goalEditing = $state(false);
  let goalError = $state('');

  function startGoalNew() {
    goalForm = { name: '', accountId: defaultHost(), openingBalance: '0,00', openingDate: app.asOf, monthlyAmount: '', target: '' };
    goalEditing = true;
    goalError = '';
  }
  function saveGoal(e: Event) {
    e.preventDefault();
    if (!goalForm.name.trim()) return void (goalError = 'Le nom est obligatoire.');
    if (!goalForm.accountId) return void (goalError = 'Choisis le compte qui héberge l’objectif.');
    const openingBalance = inputToCents(goalForm.openingBalance);
    if (openingBalance === undefined) return void (goalError = 'Solde initial invalide.');
    const monthly = inputToCents(goalForm.monthlyAmount);
    if (monthly === undefined) return void (goalError = 'Mensualité invalide.');
    const target = inputToCents(goalForm.target);
    const row: Envelope = {
      id: app.newId(),
      name: goalForm.name.trim(),
      kind: 'goal',
      accountId: goalForm.accountId,
      openingBalance,
      openingDate: goalForm.openingDate,
      monthlyAmount: monthly,
      priority: DEFAULT_PRIORITY.goal,
      ...(target !== undefined ? { target } : {}),
    };
    app.upsert('envelopes', row);
    goalEditing = false;
  }

  // --- Revenus (flux prévus de type income) ---
  let incForm = $state({ name: '', amount: '', accountId: '', intervalMonths: '1', anchorDate: app.asOf, variable: false });
  let incEditing = $state(false);
  let incError = $state('');

  function startIncNew() {
    incForm = { name: '', amount: '', accountId: pivot?.id ?? '', intervalMonths: '1', anchorDate: app.asOf, variable: false };
    incEditing = true;
    incError = '';
  }
  function saveInc(e: Event) {
    e.preventDefault();
    if (!incForm.name.trim()) return void (incError = 'Le nom est obligatoire.');
    const abs = inputToCents(incForm.amount);
    if (abs === undefined || abs < 0) return void (incError = 'Montant invalide (saisis-le en positif).');
    if (!incForm.accountId) return void (incError = 'Choisis le compte.');
    const row: PlannedFlow = {
      id: app.newId(),
      name: incForm.name.trim(),
      kind: 'income',
      amount: abs,
      accountId: incForm.accountId,
      periodicity: { intervalMonths: Math.max(1, Number(incForm.intervalMonths) || 1), anchorDate: incForm.anchorDate },
      dateWindowDays: 3,
      ...(incForm.variable ? { variable: true } : {}),
    };
    app.upsert('plannedFlows', row);
    incEditing = false;
  }

  // --- Charges fixes et échéances (flux prévus de type fixedCharge / dueDate) ---
  let chgForm = $state({ name: '', kind: 'fixedCharge' as 'fixedCharge' | 'dueDate', amount: '', accountId: '', envelopeId: '', intervalMonths: '1', anchorDate: app.asOf });
  let chgEditing = $state(false);
  let chgError = $state('');

  function startChgNew() {
    chgForm = { name: '', kind: 'fixedCharge', amount: '', accountId: pivot?.id ?? '', envelopeId: '', intervalMonths: '1', anchorDate: app.asOf };
    chgEditing = true;
    chgError = '';
  }
  function saveChg(e: Event) {
    e.preventDefault();
    if (!chgForm.name.trim()) return void (chgError = 'Le nom est obligatoire.');
    const abs = inputToCents(chgForm.amount);
    if (abs === undefined || abs < 0) return void (chgError = 'Montant invalide (saisis-le en positif).');
    if (!chgForm.accountId) return void (chgError = 'Choisis le compte.');
    if (chgForm.kind === 'dueDate' && !chgForm.envelopeId) return void (chgError = 'Choisis la provision qui paie l’échéance.');
    const row: PlannedFlow = {
      id: app.newId(),
      name: chgForm.name.trim(),
      kind: chgForm.kind,
      amount: -abs,
      accountId: chgForm.accountId,
      periodicity: { intervalMonths: Math.max(1, Number(chgForm.intervalMonths) || 1), anchorDate: chgForm.anchorDate },
      dateWindowDays: 3,
      ...(chgForm.kind === 'dueDate' ? { envelopeId: chgForm.envelopeId } : {}),
    };
    app.upsert('plannedFlows', row);
    chgEditing = false;
  }

  function removeFlow(f: PlannedFlow) {
    if (confirm(`Supprimer « ${f.name} » ?`)) app.remove('plannedFlows', f.id);
  }

  function exitToPlan() {
    app.view = 'plan';
  }
  function exitToMore() {
    app.view = 'more';
  }
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.view = 'more'; }}>‹ Configuration</a></p>
<h1>Assistant de configuration</h1>
<p class="muted small">Construis ton budget étape par étape : compte pivot, enveloppes, objectifs d'épargne, revenus, charges. Tout reste modifiable ensuite depuis Configuration.</p>

<div class="wizard-steps">
  {#each STEPS as s, i (s.id)}
    <button class="wstep" class:active={s.id === step} class:done={i < stepIndex} disabled={!canGo(s.id)} onclick={() => go(s.id)}>{s.label}</button>
  {/each}
</div>

{#if step === 'intro'}
  <div class="card accent">
    <h2 style="margin-top:0">Construire ton budget</h2>
    <p>Six étapes : le compte pivot (obligatoire), des comptes complémentaires si besoin, tes enveloppes (provisions et budgets), tes objectifs d'épargne, tes revenus, puis tes charges fixes et échéances. Seule la première est obligatoire ; les autres se complètent au fil de l'eau.</p>
    <div class="actions" style="margin-bottom:0">
      <button class="btn primary" onclick={next}>Commencer</button>
    </div>
  </div>
{:else if step === 'pivot'}
  <p class="muted small">Le pivot est le compte réel par lequel tout transite (celui dont tu importeras le relevé).</p>
  {#if !pivot || pivotEditing}
    <form class="edit" onsubmit={savePivot}>
      <div class="grid">
        <label class="f">Nom <input bind:value={pivotForm.name} placeholder="Compte courant" /></label>
        <label class="f">Banque (facultatif) <input bind:value={pivotForm.bank} /></label>
        <label class="f">Solde initial <input bind:value={pivotForm.openingBalance} inputmode="decimal" /></label>
        <label class="f">Date du solde initial <input type="date" bind:value={pivotForm.openingDate} /></label>
        <label class="f">Jour de paie (début de période) <input type="number" min="1" max="31" bind:value={pivotForm.payDay} /></label>
      </div>
      {#if pivotError}<div class="err">{pivotError}</div>{/if}
      <div class="actions" style="margin:0">
        <button class="btn primary" type="submit">Enregistrer</button>
        {#if pivot}<button class="btn" type="button" onclick={() => (pivotEditing = false)}>Annuler</button>{/if}
      </div>
    </form>
  {:else}
    <div class="card accent">
      <div class="row">
        <div class="label">
          <strong>{pivot.name}</strong>
          <span class="sub">{pivot.bank ? pivot.bank + ' · ' : ''}solde initial {money(pivot.openingBalance)} au {shortDate(pivot.openingDate)} · paie le {pivot.payDay ?? 1}</span>
        </div>
        <button class="btn small" onclick={startPivotEdit}>Modifier</button>
      </div>
    </div>
  {/if}
{:else if step === 'accounts'}
  <p class="muted small">Comptes d'accueil (livret, PEL…) pour héberger des enveloppes, ou comptes tiers saisis à la main. Étape facultative : tout peut rester sur le pivot.</p>
  {#each others as a (a.id)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{a.name}</strong> <span class="pill">{a.kind === 'holding' ? 'accueil' : 'tiers'}</span>
          <span class="sub">{a.bank ? a.bank + ' · ' : ''}solde initial {money(a.openingBalance)} au {shortDate(a.openingDate)}</span>
        </div>
        <button class="btn small danger" onclick={() => removeAccount(a)}>Supprimer</button>
      </div>
    </div>
  {/each}
  {#if accEditing}
    <form class="edit" onsubmit={saveAcc}>
      <div class="grid">
        <label class="f">Nom <input bind:value={accForm.name} placeholder="Livret A" /></label>
        <label class="f">Type
          <select bind:value={accForm.kind}>
            <option value="holding">{ACCOUNT_KINDS.holding}</option>
            <option value="third">{ACCOUNT_KINDS.third}</option>
          </select>
        </label>
        <label class="f">Banque (facultatif) <input bind:value={accForm.bank} /></label>
        <label class="f">Solde initial <input bind:value={accForm.openingBalance} inputmode="decimal" /></label>
        <label class="f">Date du solde initial <input type="date" bind:value={accForm.openingDate} /></label>
        {#if accForm.kind === 'third'}
          <label class="f">Seuil de règlement <input bind:value={accForm.settlementThreshold} inputmode="decimal" /></label>
          <label class="f">Sens autorisé
            <select bind:value={accForm.settlementDirection}>
              <option value="both">Dans les deux sens</option>
              <option value="toThird">Pivot → ce compte seulement</option>
              <option value="fromThird">Ce compte → pivot seulement</option>
            </select>
          </label>
        {/if}
      </div>
      {#if accError}<div class="err">{accError}</div>{/if}
      <div class="actions" style="margin:0">
        <button class="btn primary" type="submit">Enregistrer</button>
        <button class="btn" type="button" onclick={() => (accEditing = false)}>Annuler</button>
      </div>
    </form>
  {:else}
    <div class="actions"><button class="btn" onclick={startAccNew}>+ Ajouter un compte</button></div>
  {/if}
{:else if step === 'envelopes'}
  <p class="muted small">Une provision accumule pour une échéance ; un budget encadre une dépense courante, avec ou sans report.</p>
  {#each provisionsAndBudgets as e (e.id)}
    {@const bal = envelopeBalance(e, idx, app.asOf)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{e.name}</strong> <span class="pill">{e.kind === 'provision' ? 'provision' : 'budget'}</span>
          <span class="sub">{describeEnv(e)}</span>
        </div>
        <div class="num {bal < 0 ? 'neg' : ''}">{money(bal)}</div>
      </div>
      <div class="actions" style="margin:6px 0 0"><button class="btn small danger" onclick={() => removeEnvelope(e)}>Supprimer</button></div>
    </div>
  {/each}
  {#if envEditing}
    <form class="edit" onsubmit={saveEnv}>
      <div class="grid">
        <label class="f">Nom <input bind:value={envForm.name} placeholder="Taxe foncière" /></label>
        <label class="f">Type
          <select bind:value={envForm.kind} onchange={onEnvKindChange}>
            <option value="provision">{ENVELOPE_KINDS.provision}</option>
            <option value="budget">{ENVELOPE_KINDS.budget}</option>
          </select>
        </label>
        <label class="f">Compte hôte
          <select bind:value={envForm.accountId}>
            {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
          </select>
        </label>
        <label class="f">Solde initial <input bind:value={envForm.openingBalance} inputmode="decimal" /></label>
        <label class="f">Date du solde initial <input type="date" bind:value={envForm.openingDate} /></label>
        {#if envForm.kind === 'provision'}
          <label class="f">Montant de l'échéance <input bind:value={envForm.target} inputmode="decimal" placeholder="1 200,00" /></label>
          <label class="f">Tous les (mois) <input type="number" min="1" bind:value={envForm.intervalMonths} /></label>
          <label class="f">Première échéance <input type="date" bind:value={envForm.anchorDate} /></label>
        {:else}
          <label class="f">Montant du budget <input bind:value={envForm.target} inputmode="decimal" placeholder="900,00" /></label>
          <label class="f">Par période de (mois) <input type="number" min="1" bind:value={envForm.intervalMonths} /></label>
          <label class="f">Depuis le <input type="date" bind:value={envForm.anchorDate} /></label>
          <label class="f">Reliquat en fin de période
            <select bind:value={envForm.rollover}>
              <option value="none">Remis à zéro</option>
              <option value="unlimited">Reporté</option>
              <option value="capped">Reporté, plafonné</option>
            </select>
          </label>
          {#if envForm.rollover === 'capped'}
            <label class="f">Plafond (mois de dotation) <input type="number" min="1" bind:value={envForm.rolloverMonths} /></label>
          {/if}
        {/if}
      </div>
      {#if envError}<div class="err">{envError}</div>{/if}
      <div class="actions" style="margin:0">
        <button class="btn primary" type="submit">Enregistrer</button>
        <button class="btn" type="button" onclick={() => (envEditing = false)}>Annuler</button>
      </div>
    </form>
  {:else}
    <div class="actions"><button class="btn" onclick={startEnvNew}>+ Ajouter une enveloppe</button></div>
  {/if}
{:else if step === 'goals'}
  <p class="muted small">Un objectif d'épargne se nourrit d'une mensualité fixe, avec une cible facultative.</p>
  {#each goals as g (g.id)}
    {@const bal = envelopeBalance(g, idx, app.asOf)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{g.name}</strong> <span class="pill">épargne</span>
          <span class="sub">{money(g.monthlyAmount ?? 0)} par mois{g.target !== undefined ? ` · cible ${money(g.target)}` : ''}</span>
        </div>
        <div class="num {bal < 0 ? 'neg' : ''}">{money(bal)}</div>
      </div>
      <div class="actions" style="margin:6px 0 0"><button class="btn small danger" onclick={() => removeEnvelope(g)}>Supprimer</button></div>
    </div>
  {/each}
  {#if goalEditing}
    <form class="edit" onsubmit={saveGoal}>
      <div class="grid">
        <label class="f">Nom <input bind:value={goalForm.name} placeholder="Vacances" /></label>
        <label class="f">Compte hôte
          <select bind:value={goalForm.accountId}>
            {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
          </select>
        </label>
        <label class="f">Solde initial <input bind:value={goalForm.openingBalance} inputmode="decimal" /></label>
        <label class="f">Date du solde initial <input type="date" bind:value={goalForm.openingDate} /></label>
        <label class="f">Mensualité <input bind:value={goalForm.monthlyAmount} inputmode="decimal" placeholder="300,00" /></label>
        <label class="f">Cible (facultatif) <input bind:value={goalForm.target} inputmode="decimal" /></label>
      </div>
      {#if goalError}<div class="err">{goalError}</div>{/if}
      <div class="actions" style="margin:0">
        <button class="btn primary" type="submit">Enregistrer</button>
        <button class="btn" type="button" onclick={() => (goalEditing = false)}>Annuler</button>
      </div>
    </form>
  {:else}
    <div class="actions"><button class="btn" onclick={startGoalNew}>+ Ajouter un objectif</button></div>
  {/if}
{:else if step === 'income'}
  <p class="muted small">Salaire, loyers perçus, aides… Le montant se saisit en positif.</p>
  {#each incomeFlows as f (f.id)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{f.name}</strong>{f.variable ? ' (variable)' : ''}
          <span class="sub">{periodicityLabel(f.periodicity)} · prochaine : {shortDate(nextOccurrence(f.periodicity, app.asOf))}</span>
        </div>
        <div class="num pos">{money(f.amount)}</div>
      </div>
      <div class="actions" style="margin:6px 0 0"><button class="btn small danger" onclick={() => removeFlow(f)}>Supprimer</button></div>
    </div>
  {/each}
  {#if incEditing}
    <form class="edit" onsubmit={saveInc}>
      <div class="grid">
        <label class="f">Nom <input bind:value={incForm.name} placeholder="Salaire" /></label>
        <label class="f">Montant <input bind:value={incForm.amount} inputmode="decimal" placeholder="3 400,00" /></label>
        <label class="f">Compte
          <select bind:value={incForm.accountId}>
            {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
          </select>
        </label>
        <label class="f">Tous les (mois) <input type="number" min="1" bind:value={incForm.intervalMonths} /></label>
        <label class="f">Première date <input type="date" bind:value={incForm.anchorDate} /></label>
        <label class="f check"><input type="checkbox" bind:checked={incForm.variable} /> Montant variable (à confirmer au pointage)</label>
      </div>
      {#if incError}<div class="err">{incError}</div>{/if}
      <div class="actions" style="margin:0">
        <button class="btn primary" type="submit">Enregistrer</button>
        <button class="btn" type="button" onclick={() => (incEditing = false)}>Annuler</button>
      </div>
    </form>
  {:else}
    <div class="actions"><button class="btn" onclick={startIncNew}>+ Ajouter un revenu</button></div>
  {/if}
{:else if step === 'charges'}
  <p class="muted small">Une charge fixe part directement du compte ; une échéance est payée par une provision qui se vide à la date prévue.</p>
  {#each chargeFlows as f (f.id)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{f.name}</strong>
          <span class="sub">{f.kind === 'dueDate' ? 'échéance' : 'charge fixe'} · {periodicityLabel(f.periodicity)} · prochaine : {shortDate(nextOccurrence(f.periodicity, app.asOf))}</span>
        </div>
        <div class="num">{money(f.amount)}</div>
      </div>
      <div class="actions" style="margin:6px 0 0"><button class="btn small danger" onclick={() => removeFlow(f)}>Supprimer</button></div>
    </div>
  {/each}
  {#if chgEditing}
    <form class="edit" onsubmit={saveChg}>
      <div class="grid">
        <label class="f">Nom <input bind:value={chgForm.name} placeholder="Assurance habitation" /></label>
        <label class="f">Type
          <select bind:value={chgForm.kind}>
            <option value="fixedCharge">Charge fixe</option>
            {#if provisions.length}<option value="dueDate">Échéance payée par une provision</option>{/if}
          </select>
        </label>
        <label class="f">Montant <input bind:value={chgForm.amount} inputmode="decimal" placeholder="45,00" /></label>
        <label class="f">Compte
          <select bind:value={chgForm.accountId}>
            {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
          </select>
        </label>
        {#if chgForm.kind === 'dueDate'}
          <label class="f">Provision qui paie
            <select bind:value={chgForm.envelopeId}>
              <option value="">—</option>
              {#each provisions as p}<option value={p.id}>{p.name}</option>{/each}
            </select>
          </label>
        {/if}
        <label class="f">Tous les (mois) <input type="number" min="1" bind:value={chgForm.intervalMonths} /></label>
        <label class="f">Première date <input type="date" bind:value={chgForm.anchorDate} /></label>
      </div>
      {#if chgError}<div class="err">{chgError}</div>{/if}
      <div class="actions" style="margin:0">
        <button class="btn primary" type="submit">Enregistrer</button>
        <button class="btn" type="button" onclick={() => (chgEditing = false)}>Annuler</button>
      </div>
    </form>
  {:else}
    <div class="actions"><button class="btn" onclick={startChgNew}>+ Ajouter une charge ou une échéance</button></div>
  {/if}
{:else if step === 'summary'}
  <h2 style="margin-top:0">C'est prêt</h2>
  <div class="card">
    <div class="row"><div class="label">Comptes</div><div class="num">{accounts.length}</div></div>
    <div class="row"><div class="label">Enveloppes (provisions et budgets)</div><div class="num">{provisionsAndBudgets.length}</div></div>
    <div class="row"><div class="label">Objectifs d'épargne</div><div class="num">{goals.length}</div></div>
    <div class="row"><div class="label">Revenus prévus</div><div class="num">{incomeFlows.length}</div></div>
    <div class="row"><div class="label">Charges et échéances</div><div class="num">{chargeFlows.length}</div></div>
  </div>
  <p class="muted small">Le plan calcule tout de suite l'ordre de financement et les virements à faire. Tu peux affiner chaque partie à tout moment depuis Configuration.</p>
  <div class="actions">
    <button class="btn primary" onclick={exitToPlan}>Voir le plan</button>
    <button class="btn" onclick={exitToMore}>Retour à la configuration</button>
  </div>
{/if}

{#if step !== 'intro' && step !== 'summary'}
  <div class="actions">
    {#if stepIndex > 0}<button class="btn" onclick={prev}>‹ Précédent</button>{/if}
    <button class="btn primary" onclick={next} disabled={step === 'pivot' && !pivot}>{step === 'charges' ? 'Voir le résumé' : 'Suivant'} ›</button>
  </div>
{/if}
