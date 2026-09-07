<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, shortDate, centsToInput, inputToCents, FLOW_KINDS, periodicityLabel } from '../lib/format';
  import { alive, nextOccurrence, type PlannedFlow, type PlannedFlowKind } from '@tirelire/core';

  let editing = $state<PlannedFlow | undefined>(undefined);
  let form = $state({
    name: '',
    kind: 'income' as PlannedFlowKind,
    amount: '',
    accountId: '',
    envelopeId: '',
    categoryId: '',
    counterpartAccountId: '',
    intervalMonths: '1',
    anchorDate: app.asOf,
    dateWindowDays: '3',
    toleranceAbs: '',
    tolerancePct: '',
    labelPattern: '',
    variable: false,
    activeFrom: '',
    activeTo: '',
  });
  let error = $state('');

  const accounts = $derived(alive(app.ledger.accounts));
  const envelopes = $derived(alive(app.ledger.envelopes));
  const categories = $derived(alive(app.ledger.categories));
  const flows = $derived(alive(app.ledger.plannedFlows));
  const groups = $derived(
    (['income', 'fixedCharge', 'dueDate', 'transfer'] as PlannedFlowKind[])
      .map((k) => ({ kind: k, flows: flows.filter((f) => f.kind === k).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)) }))
      .filter((g) => g.flows.length > 0),
  );

  function startNew() {
    const pivot = accounts.find((a) => a.kind === 'pivot');
    editing = { id: app.newId(), name: '', kind: 'income', amount: 0, accountId: pivot?.id ?? '', periodicity: { intervalMonths: 1, anchorDate: app.asOf }, dateWindowDays: 3 };
    form = { ...form, name: '', kind: 'income', amount: '', accountId: pivot?.id ?? '', envelopeId: '', categoryId: '', counterpartAccountId: '', intervalMonths: '1', anchorDate: app.asOf, dateWindowDays: '3', toleranceAbs: '', tolerancePct: '', labelPattern: '', variable: false, activeFrom: '', activeTo: '' };
    error = '';
  }

  function startEdit(f: PlannedFlow) {
    editing = f;
    form = {
      name: f.name,
      kind: f.kind,
      amount: centsToInput(Math.abs(f.amount)),
      accountId: f.accountId,
      envelopeId: f.envelopeId ?? '',
      categoryId: f.categoryId ?? '',
      counterpartAccountId: f.counterpartAccountId ?? '',
      intervalMonths: String(f.periodicity.intervalMonths),
      anchorDate: f.periodicity.anchorDate,
      dateWindowDays: String(f.dateWindowDays),
      toleranceAbs: centsToInput(f.amountTolerance?.abs),
      tolerancePct: f.amountTolerance?.pct !== undefined ? String(f.amountTolerance.pct) : '',
      labelPattern: f.labelPattern ?? '',
      variable: !!f.variable,
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
    if (form.kind === 'dueDate' && !form.envelopeId) return void (error = 'Choisis l’enveloppe qui paie l’échéance.');
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
      periodicity: { intervalMonths: Math.max(1, Number(form.intervalMonths) || 1), anchorDate: form.anchorDate },
      dateWindowDays: Math.max(0, Number(form.dateWindowDays) || 0),
      ...(form.envelopeId && form.kind === 'dueDate' ? { envelopeId: form.envelopeId } : {}),
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
      ...(form.counterpartAccountId && form.kind === 'transfer' ? { counterpartAccountId: form.counterpartAccountId } : {}),
      ...(tolAbs !== undefined || tolPct !== undefined
        ? { amountTolerance: { ...(tolAbs !== undefined ? { abs: tolAbs } : {}), ...(tolPct !== undefined ? { pct: tolPct } : {}) } }
        : {}),
      ...(form.labelPattern.trim() ? { labelPattern: form.labelPattern.trim() } : {}),
      ...(form.variable ? { variable: true } : {}),
      ...(form.activeFrom ? { activeFrom: form.activeFrom } : {}),
      ...(form.activeTo ? { activeTo: form.activeTo } : {}),
    };
    app.upsert('plannedFlows', row);
    editing = undefined;
  }

  function remove(f: PlannedFlow) {
    if (confirm(`Supprimer « ${f.name} » ?`)) app.remove('plannedFlows', f.id);
  }

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?';
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.back() || app.switchTab('more'); }}>‹ Configuration</a></p>
<h1>Flux prévus</h1>
<p class="muted small">Revenus, charges fixes, échéances payées par une enveloppe. Le montant se saisit en positif ; la fenêtre de dates, la tolérance et le motif serviront au rapprochement de flux.</p>

<div class="actions">
  <button class="btn primary" onclick={startNew} disabled={accounts.length === 0}>Ajouter un flux</button>
</div>

{#if editing}
  <form class="edit" onsubmit={save}>
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
          {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
      {#if form.kind === 'dueDate'}
        <label class="f">Enveloppe qui paie
          <select bind:value={form.envelopeId}>
            <option value="">—</option>
            {#each envelopes.filter((e) => e.kind === 'provision') as e}<option value={e.id}>{e.name}</option>{/each}
          </select>
        </label>
      {/if}
      {#if form.kind === 'transfer'}
        <label class="f">Compte de contrepartie
          <select bind:value={form.counterpartAccountId}>
            <option value="">—</option>
            {#each accounts.filter((a) => a.id !== form.accountId) as a}<option value={a.id}>{a.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="f">Catégorie
        <select bind:value={form.categoryId}>
          <option value="">—</option>
          {#each categories as c}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label class="f">Tous les (mois) <input type="number" min="1" bind:value={form.intervalMonths} /></label>
      <label class="f">Première date <input type="date" bind:value={form.anchorDate} /></label>
      <label class="f">Fenêtre de rapprochement (± jours) <input type="number" min="0" bind:value={form.dateWindowDays} /></label>
      <label class="f">Tolérance de montant (€) <input bind:value={form.toleranceAbs} inputmode="decimal" /></label>
      <label class="f">Tolérance de montant (%) <input type="number" min="0" bind:value={form.tolerancePct} /></label>
      <label class="f">Motif de libellé (regex) <input bind:value={form.labelPattern} placeholder="ECHEANCE PRET" /></label>
      <label class="f">Actif à partir du <input type="date" bind:value={form.activeFrom} /></label>
      <label class="f">Actif jusqu'au <input type="date" bind:value={form.activeTo} /></label>
      <label class="f check"><input type="checkbox" bind:checked={form.variable} /> Montant variable (rapprochement à confirmer)</label>
    </div>
    {#if error}<div class="err">{error}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (editing = undefined)}>Annuler</button>
    </div>
  </form>
{/if}

{#each groups as g (g.kind)}
  <h2>{FLOW_KINDS[g.kind]}s</h2>
  <div class="card">
    {#each g.flows as f (f.id)}
      <div class="row">
        <div class="label">
          <strong>{f.name}</strong>{f.variable ? ' (variable)' : ''}
          <span class="sub">{accountName(f.accountId)} · {periodicityLabel(f.periodicity)} · prochaine : {shortDate(nextOccurrence(f.periodicity, app.asOf))}</span>
        </div>
        <div class="num {f.amount < 0 ? '' : 'pos'}">{money(f.amount)}</div>
        <div>
          <button class="btn small" onclick={() => startEdit(f)}>Modifier</button>
          <button class="btn small danger" onclick={() => remove(f)}>Supprimer</button>
        </div>
      </div>
    {/each}
  </div>
{/each}
{#if flows.length === 0}
  <div class="empty">Aucun flux prévu. Commence par les revenus, puis les charges fixes.</div>
{/if}
