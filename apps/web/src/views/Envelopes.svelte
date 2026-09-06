<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, shortDate, centsToInput, inputToCents, ENVELOPE_KINDS, periodicityLabel } from '../lib/format';
  import { alive, envelopeBalance, indexLedger, nextOccurrence, DEFAULT_PRIORITY, type Envelope, type EnvelopeKind } from '@tirelire/core';

  let editing = $state<Envelope | undefined>(undefined);
  let form = $state({
    name: '',
    kind: 'provision' as EnvelopeKind,
    accountId: '',
    openingBalance: '0,00',
    openingDate: app.asOf,
    target: '',
    intervalMonths: '12',
    anchorDate: app.asOf,
    monthlyAmount: '',
    rollover: 'none' as 'none' | 'unlimited' | 'capped',
    rolloverMonths: '3',
    priority: '10',
  });
  let error = $state('');

  const accounts = $derived(alive(app.ledger.accounts));
  const envelopes = $derived(alive(app.ledger.envelopes));
  const idx = $derived(indexLedger(app.ledger));
  const byAccount = $derived(
    accounts
      .map((a) => ({ account: a, envelopes: envelopes.filter((e) => e.accountId === a.id) }))
      .filter((g) => g.envelopes.length > 0),
  );
  const orphans = $derived(envelopes.filter((e) => !accounts.some((a) => a.id === e.accountId)));

  function startNew() {
    const pivot = accounts.find((a) => a.kind === 'pivot');
    editing = { id: app.newId(), name: '', kind: 'provision', accountId: pivot?.id ?? '', openingBalance: 0, openingDate: app.asOf, priority: 10 };
    form = { ...form, name: '', kind: 'provision', accountId: accounts.find((a) => a.kind === 'holding')?.id ?? pivot?.id ?? '', openingBalance: '0,00', openingDate: app.asOf, target: '', intervalMonths: '12', anchorDate: app.asOf, monthlyAmount: '', rollover: 'none', priority: '10' };
    error = '';
  }

  function startEdit(e: Envelope) {
    editing = e;
    form = {
      name: e.name,
      kind: e.kind,
      accountId: e.accountId,
      openingBalance: centsToInput(e.openingBalance),
      openingDate: e.openingDate,
      target: centsToInput(e.target),
      intervalMonths: String(e.periodicity?.intervalMonths ?? (e.kind === 'budget' ? 1 : 12)),
      anchorDate: e.periodicity?.anchorDate ?? app.asOf,
      monthlyAmount: centsToInput(e.monthlyAmount),
      rollover: e.rollover?.mode ?? 'none',
      rolloverMonths: String(e.rollover?.mode === 'capped' ? e.rollover.months : 3),
      priority: String(e.priority),
    };
    error = '';
  }

  function onKindChange() {
    form.priority = String(DEFAULT_PRIORITY[form.kind]);
    form.intervalMonths = form.kind === 'budget' ? '1' : '12';
  }

  function save(e: Event) {
    e.preventDefault();
    if (!editing) return;
    if (!form.name.trim()) return void (error = 'Le nom est obligatoire.');
    if (!form.accountId) return void (error = 'Choisis le compte qui héberge l’enveloppe.');
    const openingBalance = inputToCents(form.openingBalance);
    if (openingBalance === undefined) return void (error = 'Solde initial invalide.');
    const target = inputToCents(form.target);
    const monthly = inputToCents(form.monthlyAmount);
    const interval = Math.max(1, Number(form.intervalMonths) || 1);
    const row: Envelope = {
      id: editing.id,
      name: form.name.trim(),
      kind: form.kind,
      accountId: form.accountId,
      openingBalance,
      openingDate: form.openingDate,
      priority: Number(form.priority) || DEFAULT_PRIORITY[form.kind],
    };
    if (form.kind === 'provision') {
      if (target === undefined) return void (error = 'Montant de l’échéance invalide.');
      row.target = target;
      row.periodicity = { intervalMonths: interval, anchorDate: form.anchorDate };
    } else if (form.kind === 'goal') {
      if (monthly === undefined) return void (error = 'Mensualité invalide.');
      row.monthlyAmount = monthly;
      if (target !== undefined) row.target = target;
    } else {
      if (target === undefined) return void (error = 'Montant du budget invalide.');
      row.target = target;
      row.periodicity = { intervalMonths: interval, anchorDate: form.anchorDate };
      row.rollover = form.rollover === 'capped' ? { mode: 'capped', months: Math.max(1, Number(form.rolloverMonths) || 1) } : { mode: form.rollover };
    }
    app.upsert('envelopes', row);
    editing = undefined;
  }

  function remove(e: Envelope) {
    if (confirm(`Supprimer l’enveloppe « ${e.name} » ?`)) app.remove('envelopes', e.id);
  }

  function describe(e: Envelope): string {
    if (e.kind === 'provision') return `${money(e.target ?? 0)} ${periodicityLabel(e.periodicity)} · prochaine échéance ${e.periodicity ? shortDate(nextOccurrence(e.periodicity, app.asOf)) : '?'}`;
    if (e.kind === 'goal') return `${money(e.monthlyAmount ?? 0)} par mois${e.target !== undefined ? ` · cible ${money(e.target)}` : ''}`;
    const per = e.periodicity?.intervalMonths === 12 ? 'par an' : e.periodicity && e.periodicity.intervalMonths > 1 ? `tous les ${e.periodicity.intervalMonths} mois` : 'par mois';
    const roll = e.rollover?.mode === 'unlimited' ? 'report' : e.rollover?.mode === 'capped' ? `report ${e.rollover.months} mois` : 'sans report';
    return `${money(e.target ?? 0)} ${per} · ${roll}`;
  }
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.view = 'more'; }}>‹ Configuration</a></p>
<h1>Enveloppes</h1>
<p class="muted small">Une enveloppe est un sous-compte comptable hébergé sur un compte réel : provision pour une échéance, objectif d'épargne, ou budget courant.</p>

<div class="actions">
  <button class="btn primary" onclick={startNew} disabled={accounts.length === 0}>Ajouter une enveloppe</button>
</div>
{#if accounts.length === 0}<div class="empty">Crée d'abord un compte.</div>{/if}

{#if editing}
  <form class="edit" onsubmit={save}>
    <div class="grid">
      <label class="f">Nom <input bind:value={form.name} placeholder="Taxe foncière" /></label>
      <label class="f">Type
        <select bind:value={form.kind} onchange={onKindChange}>
          {#each Object.entries(ENVELOPE_KINDS) as [k, label]}<option value={k}>{label}</option>{/each}
        </select>
      </label>
      <label class="f">Compte hôte
        <select bind:value={form.accountId}>
          {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
      <label class="f">Solde initial <input bind:value={form.openingBalance} inputmode="decimal" /></label>
      <label class="f">Date du solde initial <input type="date" bind:value={form.openingDate} /></label>
      {#if form.kind === 'provision'}
        <label class="f">Montant de l'échéance <input bind:value={form.target} inputmode="decimal" placeholder="1 200,00" /></label>
        <label class="f">Tous les (mois) <input type="number" min="1" bind:value={form.intervalMonths} /></label>
        <label class="f">Première échéance <input type="date" bind:value={form.anchorDate} /></label>
      {:else if form.kind === 'goal'}
        <label class="f">Mensualité <input bind:value={form.monthlyAmount} inputmode="decimal" placeholder="300,00" /></label>
        <label class="f">Cible (facultatif) <input bind:value={form.target} inputmode="decimal" /></label>
      {:else}
        <label class="f">Montant du budget <input bind:value={form.target} inputmode="decimal" placeholder="900,00" /></label>
        <label class="f">Par période de (mois) <input type="number" min="1" bind:value={form.intervalMonths} /></label>
        <label class="f">Depuis le <input type="date" bind:value={form.anchorDate} /></label>
        <label class="f">Reliquat en fin de période
          <select bind:value={form.rollover}>
            <option value="none">Remis à zéro</option>
            <option value="unlimited">Reporté</option>
            <option value="capped">Reporté, plafonné</option>
          </select>
        </label>
        {#if form.rollover === 'capped'}
          <label class="f">Plafond (mois de dotation) <input type="number" min="1" bind:value={form.rolloverMonths} /></label>
        {/if}
      {/if}
      <label class="f">Priorité (petit = financé d'abord) <input type="number" min="0" bind:value={form.priority} /></label>
    </div>
    {#if error}<div class="err">{error}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (editing = undefined)}>Annuler</button>
    </div>
  </form>
{/if}

{#each byAccount as g (g.account.id)}
  <h2>{g.account.name}</h2>
  {#each g.envelopes as e (e.id)}
    {@const bal = envelopeBalance(e, idx, app.asOf)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{e.name}</strong> <span class="pill">{e.kind === 'provision' ? 'provision' : e.kind === 'goal' ? 'épargne' : 'budget'}</span>
          <span class="sub">{describe(e)} · priorité {e.priority}</span>
        </div>
        <div class="num {bal < 0 ? 'neg' : ''}" style="font-size:18px">{money(bal)}</div>
      </div>
      <div class="actions" style="margin:6px 0 0">
        <button class="btn small" onclick={() => startEdit(e)}>Modifier</button>
        <button class="btn small danger" onclick={() => remove(e)}>Supprimer</button>
      </div>
    </div>
  {/each}
{/each}
{#if orphans.length}
  <h2>Sans compte</h2>
  {#each orphans as e (e.id)}
    <div class="card warn"><div class="row"><div class="label">{e.name}</div><button class="btn small" onclick={() => startEdit(e)}>Rattacher</button></div></div>
  {/each}
{/if}
{#if envelopes.length === 0 && accounts.length > 0}
  <div class="empty">Aucune enveloppe pour l'instant.</div>
{/if}
