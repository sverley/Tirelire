<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, shortDate, centsToInput, inputToCents, NEED_KINDS, NEED_KINDS_SHORT, ROLLOVER_LABELS, periodicityLabel } from '../lib/format';
  import {
    alive,
    envelopeBalance,
    envelopeComponents,
    indexLedger,
    needCruise,
    nextOccurrence,
    DEFAULT_PRIORITY,
    type Envelope,
    type Need,
    type NeedKind,
  } from '@tirelire/core';

  // Enveloppe : nom, placement voulu (D20), solde initial, report (D05/D29).
  let editing = $state<Envelope | undefined>(undefined);
  type PlacementForm = { accountId: string; kind: 'fixed' | 'percent' | 'variable'; value: string };
  let form = $state({
    name: '',
    placement: [] as PlacementForm[],
    openingBalance: '0,00',
    openingDate: app.asOf,
    rollover: 'unlimited' as 'none' | 'unlimited' | 'capped',
    rolloverMonths: '3',
  });
  let error = $state('');

  // Besoin : un ou plusieurs par enveloppe (D28).
  let editingNeed = $state<{ need: Need; isNew: boolean } | undefined>(undefined);
  let needForm = $state({
    name: '',
    kind: 'recurring' as NeedKind,
    amount: '',
    intervalMonths: '1',
    anchorDate: app.asOf,
    monthlyAmount: '',
    priority: '20',
  });
  let needError = $state('');

  const accounts = $derived(alive(app.ledger.accounts));
  const envelopes = $derived(alive(app.ledger.envelopes));
  const needs = $derived(alive(app.ledger.needs));
  const idx = $derived(indexLedger(app.ledger));
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?';
  const needsOf = (e: Envelope) => needs.filter((n) => n.envelopeId === e.id).sort((a, b) => a.priority - b.priority);

  // Regroupement d'affichage : par premier compte de placement (D38), ou « sans placement ».
  const byPlacement = $derived(
    accounts
      .map((a) => ({ account: a, envelopes: envelopes.filter((e) => e.placement[0]?.accountId === a.id) }))
      .filter((g) => g.envelopes.length > 0),
  );
  const orphans = $derived(envelopes.filter((e) => e.placement.length === 0 || !accounts.some((a) => a.id === e.placement[0]?.accountId)));

  function placementText(e: Envelope): string {
    if (e.placement.length === 0) return 'placement libre';
    return e.placement
      .map((p) => {
        const where = accountName(p.accountId);
        if (p.share.kind === 'fixed') return `${money(p.share.amount)} sur ${where}`;
        if (p.share.kind === 'percent') return `${p.share.pct} % sur ${where}`;
        return `le reste sur ${where}`;
      })
      .join(', ');
  }

  function startNew() {
    const pivot = accounts.find((a) => a.kind === 'pivot');
    editing = { id: app.newId(), name: '', placement: [], openingBalance: 0, openingDate: app.asOf };
    form = {
      name: '',
      placement: pivot ? [{ accountId: pivot.id, kind: 'variable' as const, value: '' }] : [],
      openingBalance: '0,00',
      openingDate: app.asOf,
      rollover: 'unlimited',
      rolloverMonths: '3',
    };
    error = '';
  }

  function startEdit(e: Envelope) {
    editing = e;
    form = {
      name: e.name,
      placement: e.placement.map((p) => ({
        accountId: p.accountId,
        kind: p.share.kind,
        value: p.share.kind === 'fixed' ? centsToInput(p.share.amount) : p.share.kind === 'percent' ? String(p.share.pct) : '',
      })),
      openingBalance: centsToInput(e.openingBalance),
      openingDate: e.openingDate,
      rollover: e.rollover?.mode ?? 'unlimited',
      rolloverMonths: String(e.rollover?.mode === 'capped' ? e.rollover.months : 3),
    };
    error = '';
  }

  function save(ev: Event) {
    ev.preventDefault();
    if (!editing) return;
    if (!form.name.trim()) return void (error = 'Le nom est obligatoire.');
    if (form.placement.filter((p) => p.kind === 'variable').length > 1)
      return void (error = 'Une seule ligne « le reste » : les autres doivent porter un montant ou un pourcentage.');
    if (form.placement.some((p) => !p.accountId)) return void (error = 'Chaque ligne de placement vise un compte.');
    const openingBalance = inputToCents(form.openingBalance);
    if (openingBalance === undefined) return void (error = 'Solde initial invalide.');
    const row: Envelope = {
      id: editing.id,
      name: form.name.trim(),
      placement: form.placement.map((p) => ({
        accountId: p.accountId,
        share:
          p.kind === 'fixed'
            ? ({ kind: 'fixed', amount: inputToCents(p.value) ?? 0 } as const)
            : p.kind === 'percent'
              ? ({ kind: 'percent', pct: Number(p.value.replace(',', '.')) || 0 } as const)
              : ({ kind: 'variable' } as const),
      })),
      openingBalance,
      openingDate: form.openingDate,
      rollover:
        form.rollover === 'capped'
          ? { mode: 'capped', months: Math.max(1, Number(form.rolloverMonths) || 1) }
          : { mode: form.rollover },
    };
    app.upsert('envelopes', row);
    editing = undefined;
  }

  function remove(e: Envelope) {
    if (!confirm(`Supprimer l’enveloppe « ${e.name} » et ses besoins ?`)) return;
    for (const n of needsOf(e)) app.remove('needs', n.id);
    app.remove('envelopes', e.id);
  }

  function startNewNeed(e: Envelope) {
    editingNeed = { need: { id: app.newId(), envelopeId: e.id, kind: 'recurring', priority: DEFAULT_PRIORITY.recurring }, isNew: true };
    needForm = { name: '', kind: 'recurring', amount: '', intervalMonths: '1', anchorDate: app.asOf, monthlyAmount: '', priority: String(DEFAULT_PRIORITY.recurring) };
    needError = '';
  }

  function startEditNeed(n: Need) {
    editingNeed = { need: n, isNew: false };
    needForm = {
      name: n.name ?? '',
      kind: n.kind,
      amount: centsToInput(n.amount),
      intervalMonths: String(n.periodicity?.intervalMonths ?? (n.kind === 'dueDate' ? 12 : 1)),
      anchorDate: n.periodicity?.anchorDate ?? app.asOf,
      monthlyAmount: centsToInput(n.monthlyAmount),
      priority: String(n.priority),
    };
    needError = '';
  }

  function onNeedKindChange() {
    needForm.priority = String(DEFAULT_PRIORITY[needForm.kind]);
    needForm.intervalMonths = needForm.kind === 'dueDate' ? '12' : '1';
  }

  function saveNeed(ev: Event) {
    ev.preventDefault();
    if (!editingNeed) return;
    const amount = inputToCents(needForm.amount);
    const monthly = inputToCents(needForm.monthlyAmount);
    const interval = Math.max(1, Number(needForm.intervalMonths) || 1);
    const row: Need = {
      id: editingNeed.need.id,
      envelopeId: editingNeed.need.envelopeId,
      kind: needForm.kind,
      priority: Number(needForm.priority) || DEFAULT_PRIORITY[needForm.kind],
    };
    if (needForm.name.trim()) row.name = needForm.name.trim();
    if (needForm.kind === 'dueDate') {
      if (amount === undefined) return void (needError = 'Montant de l’échéance invalide.');
      row.amount = amount;
      row.periodicity = { intervalMonths: interval, anchorDate: needForm.anchorDate };
    } else if (needForm.kind === 'recurring') {
      if (amount === undefined) return void (needError = 'Montant par période invalide.');
      row.amount = amount;
      row.periodicity = { intervalMonths: interval, anchorDate: needForm.anchorDate };
    } else {
      if (monthly === undefined) return void (needError = 'Mensualité invalide.');
      row.monthlyAmount = monthly;
      if (amount !== undefined) row.amount = amount;
    }
    app.upsert('needs', row);
    editingNeed = undefined;
  }

  function removeNeed(n: Need) {
    if (confirm('Supprimer ce besoin ?')) app.remove('needs', n.id);
  }

  function describeNeed(n: Need): string {
    if (n.kind === 'dueDate')
      return `${money(n.amount ?? 0)} ${periodicityLabel(n.periodicity)} · prochaine ${n.periodicity ? shortDate(nextOccurrence(n.periodicity, app.asOf)) : '?'}`;
    if (n.kind === 'goal') return `${money(n.monthlyAmount ?? 0)} par période${n.amount !== undefined ? ` · cible ${money(n.amount)}` : ''}`;
    const per = n.periodicity?.intervalMonths === 12 ? 'par an' : n.periodicity && n.periodicity.intervalMonths > 1 ? `tous les ${n.periodicity.intervalMonths} mois` : 'par période';
    return `${money(n.amount ?? 0)} ${per} · dotation ${money(needCruise(n))}`;
  }

  /** Position réelle : où l'argent se trouve vraiment, comparé au placement voulu (D19, D20). */
  function positionOf(e: Envelope): Array<{ accountId: string; amount: number }> {
    return [...envelopeComponents(e, idx, app.asOf)]
      .filter(([, amount]) => amount !== 0)
      .map(([accountId, amount]) => ({ accountId, amount }));
  }
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.back() || app.switchTab('more'); }}>‹ Configuration</a></p>
<h1>Enveloppes</h1>
<p class="muted small">Une enveloppe est un pot à solde unique, réparti sur les comptes où son argent se trouve vraiment. Elle déclare où il devrait dormir, et porte un ou plusieurs besoins : échéance, récurrent, objectif.</p>

<div class="actions">
  <button class="btn primary" onclick={startNew} disabled={accounts.length === 0}>Ajouter une enveloppe</button>
</div>
{#if accounts.length === 0}<div class="empty">Crée d'abord un compte.</div>{/if}

{#if editing}
  <form class="edit" onsubmit={save}>
    <div class="grid">
      <label class="f">Nom <input bind:value={form.name} placeholder="Charges" /></label>
      <div class="f" style="grid-column:1/-1">
        <span class="sub">Placement voulu — où cet argent devrait dormir. Plusieurs comptes possibles : un montant, un pourcentage, et « le reste ».</span>
        {#each form.placement as p, i (i)}
          <div class="grid" style="align-items:end">
            <label class="f">Compte
              <select value={p.accountId} onchange={(ev) => (form.placement[i]!.accountId = (ev.currentTarget as HTMLSelectElement).value)}>
                <option value="">—</option>
                {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
              </select>
            </label>
            <label class="f">Part
              <select value={p.kind} onchange={(ev) => (form.placement[i]!.kind = (ev.currentTarget as HTMLSelectElement).value as 'fixed' | 'percent' | 'variable')}>
                <option value="variable">Le reste</option>
                <option value="fixed">Montant</option>
                <option value="percent">Pourcentage</option>
              </select>
            </label>
            {#if p.kind !== 'variable'}
              <label class="f">{p.kind === 'percent' ? '%' : 'Montant'}
                <input value={p.value} inputmode="decimal" oninput={(ev) => (form.placement[i]!.value = (ev.currentTarget as HTMLInputElement).value)} />
              </label>
            {/if}
            <button class="btn small danger" type="button" onclick={() => form.placement.splice(i, 1)}>Retirer</button>
          </div>
        {/each}
        <button class="btn small" type="button" onclick={() => form.placement.push({ accountId: '', kind: form.placement.some((x) => x.kind === 'variable') ? 'fixed' : 'variable', value: '' })}>
          Ajouter un compte
        </button>
      </div>
      <label class="f">Solde initial <input bind:value={form.openingBalance} inputmode="decimal" /></label>
      <label class="f">Date du solde initial <input type="date" bind:value={form.openingDate} /></label>
      <label class="f">Excédent en fin de période
        <select bind:value={form.rollover}>
          {#each Object.entries(ROLLOVER_LABELS) as [k, label]}<option value={k}>{label}</option>{/each}
        </select>
      </label>
      {#if form.rollover === 'capped'}
        <label class="f">Plafond (périodes de dotation) <input type="number" min="1" bind:value={form.rolloverMonths} /></label>
      {/if}
    </div>
    {#if error}<div class="err">{error}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (editing = undefined)}>Annuler</button>
    </div>
  </form>
{/if}

{#if editingNeed}
  <form class="edit" onsubmit={saveNeed}>
    <h2 style="margin-top:0">Besoin</h2>
    <div class="grid">
      <label class="f">Type
        <select bind:value={needForm.kind} onchange={onNeedKindChange}>
          {#each Object.entries(NEED_KINDS) as [k, label]}<option value={k}>{label}</option>{/each}
        </select>
      </label>
      <label class="f">Nom (facultatif) <input bind:value={needForm.name} placeholder="Taxe foncière" /></label>
      {#if needForm.kind === 'dueDate'}
        <label class="f">Montant de l'échéance <input bind:value={needForm.amount} inputmode="decimal" placeholder="1 200,00" /></label>
        <label class="f">Tous les (mois) <input type="number" min="1" bind:value={needForm.intervalMonths} /></label>
        <label class="f">Première échéance <input type="date" bind:value={needForm.anchorDate} /></label>
      {:else if needForm.kind === 'recurring'}
        <label class="f">Montant <input bind:value={needForm.amount} inputmode="decimal" placeholder="900,00" /></label>
        <label class="f">Par période de (mois) <input type="number" min="1" bind:value={needForm.intervalMonths} /></label>
        <label class="f">Depuis le <input type="date" bind:value={needForm.anchorDate} /></label>
      {:else}
        <label class="f">Mensualité <input bind:value={needForm.monthlyAmount} inputmode="decimal" placeholder="300,00" /></label>
        <label class="f">Cible (facultatif) <input bind:value={needForm.amount} inputmode="decimal" /></label>
      {/if}
      <label class="f">Priorité (petit = servi d'abord) <input type="number" min="0" bind:value={needForm.priority} /></label>
    </div>
    {#if needError}<div class="err">{needError}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (editingNeed = undefined)}>Annuler</button>
    </div>
  </form>
{/if}

{#each byPlacement as g (g.account.id)}
  <h2>{g.account.name}</h2>
  {#each g.envelopes as e (e.id)}
    {@const bal = envelopeBalance(e, idx, app.asOf)}
    {@const pos = positionOf(e)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{e.name}</strong>
          <span class="sub">
            voulu : {placementText(e)}
            <br />réel : {pos.length ? pos.map((c) => `${money(c.amount)} sur ${accountName(c.accountId)}`).join(', ') : 'rien'}
            · {ROLLOVER_LABELS[e.rollover?.mode ?? 'unlimited'].toLowerCase()}
          </span>
        </div>
        <div class="num {bal < 0 ? 'neg' : ''}" style="font-size:18px">{money(bal)}</div>
      </div>
      {#each needsOf(e) as n (n.id)}
        <div class="row" style="padding-left:8px">
          <div class="label">
            <span class="pill">{NEED_KINDS_SHORT[n.kind]}</span> {n.name ?? e.name}
            <span class="sub">{describeNeed(n)} · priorité {n.priority}</span>
          </div>
          <div class="actions" style="margin:0">
            <button class="btn small" onclick={() => startEditNeed(n)}>Modifier</button>
            <button class="btn small danger" onclick={() => removeNeed(n)}>×</button>
          </div>
        </div>
      {/each}
      {#if needsOf(e).length === 0}
        <div class="sub" style="padding-left:8px">Aucun besoin : cette enveloppe ne demande rien au plan.</div>
      {/if}
      <div class="actions" style="margin:6px 0 0">
        <button class="btn small" onclick={() => startNewNeed(e)}>Ajouter un besoin</button>
        <button class="btn small" onclick={() => startEdit(e)}>Modifier</button>
        <button class="btn small danger" onclick={() => remove(e)}>Supprimer</button>
      </div>
    </div>
  {/each}
{/each}
{#if orphans.length}
  <h2>Sans compte de placement</h2>
  {#each orphans as e (e.id)}
    <div class="card warn"><div class="row"><div class="label">{e.name}<span class="sub">aucun placement voulu : aucun écart ne sera proposé</span></div><button class="btn small" onclick={() => startEdit(e)}>Placer</button></div></div>
  {/each}
{/if}
{#if envelopes.length === 0 && accounts.length > 0}
  <div class="empty">Aucune enveloppe pour l'instant.</div>
{/if}
