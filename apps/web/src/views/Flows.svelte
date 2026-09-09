<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { revealed } from '../lib/actions';
  import FiltreEtat from '../lib/FiltreEtat.svelte';
  import { money, shortDate, centsToInput, inputToCents, openAccounts, FLOW_KINDS, periodicityLabel, UNITS, validityLabel, validityBadge } from '../lib/format';
  import {
    alive,
    countStates,
    needForDueDateFlow,
    nextOccurrence,
    stepOf,
    stateShown,
    syncFlowAutomations,
    todayISO,
    validityState,
    DEFAULT_VISIBILITY,
    type PlannedFlow,
    type PlannedFlowKind,
    type PeriodUnit,
    type StateVisibility,
  } from '@tirelire/core';

  let editing = $state<PlannedFlow | undefined>(undefined);
  let form = $state({
    name: '',
    kind: 'income' as PlannedFlowKind,
    amount: '',
    accountId: '',
    tirelireId: '',
    categoryId: '',
    counterpartAccountId: '',
    interval: '1',
    unit: 'month' as PeriodUnit,
    anchorDate: app.asOf,
    dateWindowDays: '3',
    toleranceAbs: '',
    tolerancePct: '',
    labelPattern: '',
    variable: false,
    makesRule: false,
    activeFrom: '',
    activeTo: '',
  });
  let error = $state('');
  let etatsVisibles = $state<StateVisibility>({ ...DEFAULT_VISIBILITY });

  const accounts = $derived(alive(app.ledger.accounts));
  const tirelires = $derived(alive(app.ledger.tirelires));
  const categories = $derived(alive(app.ledger.categories));
  const flows = $derived(alive(app.ledger.plannedFlows));
  const états = $derived(countStates(flows, (f) => validityState(f, app.asOf)));
  const visibles = $derived(flows.filter((f) => stateShown(etatsVisibles, validityState(f, app.asOf))));
  const masqués = $derived(flows.length - visibles.length);
  const groups = $derived(
    (['income', 'fixedCharge', 'dueDate', 'transfer'] as PlannedFlowKind[])
      .map((k) => ({ kind: k, flows: visibles.filter((f) => f.kind === k).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)) }))
      .filter((g) => g.flows.length > 0),
  );
  /** Comptes offerts aux menus : les vivants, plus celui que la ligne désigne déjà (D55). */
  const comptesChoisis = $derived(openAccounts(accounts, app.asOf, form.accountId));
  const comptesContrepartie = $derived(openAccounts(accounts, app.asOf, form.counterpartAccountId).filter((a) => a.id !== form.accountId));

  /**
   * Une échéance est payée le jour venu par ce flux, mais provisionnée d'avance par une tirelire.
   * La liste le dit maintenant, et signale les deux cas où la provision manque : pas de tirelire
   * désignée, ou une tirelire qui ne porte aucun besoin d'échéance.
   */
  function provisionText(f: PlannedFlow): string {
    if (f.kind !== 'dueDate') return '';
    const nom = tirelires.find((e) => e.id === f.tirelireId)?.name;
    if (!nom) return '⚠ aucune tirelire ne la provisionne';
    return needForDueDateFlow(f, app.ledger.needs, app.asOf)
      ? `provisionnée par « ${nom} »`
      : `⚠ « ${nom} » ne porte aucun besoin d’échéance`;
  }

  function startNew() {
    const principal = accounts.find((a) => a.kind === 'principal');
    editing = { id: app.newId(), name: '', kind: 'income', amount: 0, accountId: principal?.id ?? '', periodicity: { interval: 1, unit: 'month' as const, anchorDate: app.asOf }, dateWindowDays: 3 };
    form = { ...form, name: '', kind: 'income', amount: '', accountId: principal?.id ?? '', tirelireId: '', categoryId: '', counterpartAccountId: '', interval: '1', unit: 'month' as PeriodUnit, anchorDate: app.asOf, dateWindowDays: '3', toleranceAbs: '', tolerancePct: '', labelPattern: '', variable: false, makesRule: false, activeFrom: '', activeTo: '' };
    error = '';
  }

  function startEdit(f: PlannedFlow) {
    editing = f;
    form = {
      name: f.name,
      kind: f.kind,
      amount: centsToInput(Math.abs(f.amount)),
      accountId: f.accountId,
      tirelireId: f.tirelireId ?? '',
      categoryId: f.categoryId ?? '',
      counterpartAccountId: f.counterpartAccountId ?? '',
      interval: String(stepOf(f.periodicity).interval),
      unit: stepOf(f.periodicity).unit,
      anchorDate: f.periodicity.anchorDate,
      dateWindowDays: String(f.dateWindowDays),
      toleranceAbs: centsToInput(f.amountTolerance?.abs),
      tolerancePct: f.amountTolerance?.pct !== undefined ? String(f.amountTolerance.pct) : '',
      labelPattern: f.labelPattern ?? '',
      variable: !!f.variable,
      makesRule: !!f.makesRule,
      activeFrom: f.activeFrom ?? '',
      activeTo: f.activeTo ?? '',
    };
    error = '';
  }

  function save(e: Event) {
    e.preventDefault();
    if (!editing) return;
    if (!form.name.trim()) return void (error = 'Le nom est obligatoire.');
    const abs = inputToCents(form.amount);
    if (abs === undefined || abs < 0) return void (error = 'Montant invalide (saisis-le en positif, le sens dépend du type).');
    if (!form.accountId) return void (error = 'Choisis le compte.');
    if (form.kind === 'dueDate' && !form.tirelireId) return void (error = 'Choisis la tirelire qui paie l’échéance.');
    if (form.kind === 'transfer' && !form.counterpartAccountId) return void (error = 'Choisis le compte de contrepartie.');
    if (form.labelPattern.trim()) {
      try {
        new RegExp(form.labelPattern, 'i');
      } catch {
        return void (error = 'Motif de libellé invalide (expression régulière).');
      }
    }
    const tolAbs = inputToCents(form.toleranceAbs);
    const tolPct = form.tolerancePct.trim() ? Number(form.tolerancePct) : undefined;
    const row: PlannedFlow = {
      id: editing.id,
      name: form.name.trim(),
      kind: form.kind,
      amount: form.kind === 'income' ? abs : -abs,
      accountId: form.accountId,
      periodicity: { interval: Math.max(1, Number(form.interval) || 1), unit: form.unit, anchorDate: form.anchorDate },
      dateWindowDays: Math.max(0, Number(form.dateWindowDays) || 0),
      ...(form.tirelireId && form.kind === 'dueDate' ? { tirelireId: form.tirelireId } : {}),
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
      ...(form.counterpartAccountId && form.kind === 'transfer' ? { counterpartAccountId: form.counterpartAccountId } : {}),
      ...(tolAbs !== undefined || tolPct !== undefined
        ? { amountTolerance: { ...(tolAbs !== undefined ? { abs: tolAbs } : {}), ...(tolPct !== undefined ? { pct: tolPct } : {}) } }
        : {}),
      ...(form.labelPattern.trim() ? { labelPattern: form.labelPattern.trim() } : {}),
      ...(form.variable ? { variable: true } : {}),
      ...(form.makesRule ? { makesRule: true } : {}),
      ...(form.activeFrom ? { activeFrom: form.activeFrom } : {}),
      ...(form.activeTo ? { activeTo: form.activeTo } : {}),
    };
    app.upsert('plannedFlows', row);
    // D24 : modifier un flux archive son automatisme et en crée une nouvelle, sans réécrire le passé.
    for (const rule of syncFlowAutomations(app.ledger, todayISO()).automations) app.store.upsert('automations', rule);
    app.reload();
    editing = undefined;
  }

  function remove(f: PlannedFlow) {
    if (confirm(`Supprimer « ${f.name} » ?`)) app.remove('plannedFlows', f.id);
  }

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?';
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.back() || app.switchTab('more'); }}>‹ Configuration</a></p>
<h1>Flux prévus</h1>
<p class="muted small">Revenus, charges fixes, échéances payées par une tirelire. Le montant se saisit en positif ; la fenêtre de dates, la tolérance et le motif serviront au rapprochement de flux.</p>

<div class="actions">
  <button class="btn primary" onclick={startNew} disabled={accounts.length === 0}>Ajouter un flux</button>
</div>

<FiltreEtat bind:value={etatsVisibles} counts={états} quoi="les flux" />

{#snippet editeur()}
  <form class="edit attached" use:revealed onsubmit={save}>
    <div class="grid">
      <label class="f">Nom <input bind:value={form.name} placeholder="Salaire" /></label>
      <label class="f">Type
        <select bind:value={form.kind}>
          {#each Object.entries(FLOW_KINDS) as [k, label]}<option value={k}>{label}</option>{/each}
        </select>
      </label>
      <label class="f">Montant <input bind:value={form.amount} inputmode="decimal" placeholder="3 400,00" /></label>
      <label class="f">Compte
        <select bind:value={form.accountId}>
          {#each comptesChoisis as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
      {#if form.kind === 'dueDate'}
        <label class="f">Tirelire qui paie
          <select bind:value={form.tirelireId}>
            <option value="">—</option>
            {#each tirelires as e}<option value={e.id}>{e.name}</option>{/each}
          </select>
        </label>
      {/if}
      {#if form.kind === 'transfer'}
        <label class="f">Compte de contrepartie
          <select bind:value={form.counterpartAccountId}>
            <option value="">—</option>
            {#each comptesContrepartie as a}<option value={a.id}>{a.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="f">Catégorie
        <select bind:value={form.categoryId}>
          <option value="">—</option>
          {#each categories as c}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label class="f">Tous les <input type="number" min="1" bind:value={form.interval} /></label>
      <label class="f">Unité
        <select bind:value={form.unit}>
          {#each Object.entries(UNITS) as [u, l]}<option value={u}>{l.pluriel}</option>{/each}
        </select>
      </label>
      <label class="f">Première date <input type="date" bind:value={form.anchorDate} /></label>
      <label class="f">Fenêtre de rapprochement (± jours) <input type="number" min="0" bind:value={form.dateWindowDays} /></label>
      <label class="f">Tolérance de montant (€) <input bind:value={form.toleranceAbs} inputmode="decimal" /></label>
      <label class="f">Tolérance de montant (%) <input type="number" min="0" bind:value={form.tolerancePct} /></label>
      <label class="f">Motif de libellé (regex) <input bind:value={form.labelPattern} placeholder="ECHEANCE PRET" /></label>
      <label class="f">Actif à partir du <input type="date" bind:value={form.activeFrom} /></label>
      <label class="f">Actif jusqu'au <input type="date" bind:value={form.activeTo} /></label>
      <label class="f check"><input type="checkbox" bind:checked={form.variable} /> Montant variable (rapprochement à confirmer)</label>
      <label class="f check"><input type="checkbox" bind:checked={form.makesRule} /> Classer automatiquement les opérations de ce flux (crée un automatisme qui verrouille)</label>
    </div>
    {#if error}<div class="err">{error}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (editing = undefined)}>Annuler</button>
    </div>
  </form>
{/snippet}

<!-- Un flux qu'on crée n'a pas encore de ligne : son formulaire suit le bouton qui l'ouvre. -->
{#if editing && !flows.some((f) => f.id === editing?.id)}
  {@render editeur()}
{/if}

{#each groups as g (g.kind)}
  <h2>{FLOW_KINDS[g.kind]}s</h2>
  <div class="card">
    {#each g.flows as f (f.id)}
      {@const badge = validityBadge(f, app.asOf)}
      {@const validite = validityLabel(f)}
      {@const provision = provisionText(f)}
      <div class="row {badge ? 'dormant' : ''}" class:editing={editing?.id === f.id}>
        <div class="label">
          <strong>{f.name}</strong>{f.variable ? ' (variable)' : ''}{f.makesRule ? ' · automatisme' : ''}
          {#if badge}<span class="pill dim">{badge}</span>{/if}
          <span class="sub">{accountName(f.accountId)} · {periodicityLabel(f.periodicity)} · prochaine : {shortDate(nextOccurrence(f.periodicity, app.asOf))}{validite ? ` · ${validite}` : ''}</span>
          {#if provision}<span class="sub">{provision}</span>{/if}
        </div>
        <div class="num {f.amount < 0 ? '' : 'pos'}">{money(f.amount)}</div>
        <div>
          <button class="btn small" onclick={() => startEdit(f)}>Modifier</button>
          <button class="btn small danger" onclick={() => remove(f)}>Supprimer</button>
        </div>
      </div>
      {#if editing?.id === f.id}
        {@render editeur()}
      {/if}
    {/each}
  </div>
{/each}
{#if flows.length === 0}
  <div class="empty">Aucun flux prévu. Commence par les revenus, puis les charges fixes.</div>
{:else if visibles.length === 0}
  <div class="empty">Tout est masqué par le filtre : {masqués} flux rangé(s).</div>
{/if}
