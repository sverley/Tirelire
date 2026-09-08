<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { revealed } from '../lib/actions';
  import { money, shortDate, centsToInput, inputToCents, NEED_KINDS, NEED_KINDS_SHORT, ROLLOVER_LABELS, periodicityLabel } from '../lib/format';
  import {
    alive,
    tirelireBalance,
    tirelireComponents,
    indexLedger,
    needCruise,
    needActive,
    nextOccurrence,
    DEFAULT_PRIORITY,
    type Tirelire,
    type Need,
    type NeedKind,
    stepOf,
  } from '@tirelire/core';

  // Tirelire : nom, placement voulu (D20), solde initial, report (D05/D29).
  let editing = $state<Tirelire | undefined>(undefined);
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

  // Besoin : un ou plusieurs par tirelire (D28).
  let editingNeed = $state<{ need: Need; isNew: boolean } | undefined>(undefined);
  let needForm = $state({
    name: '',
    kind: 'recurring' as NeedKind,
    amount: '',
    intervalMonths: '1',
    anchorDate: app.asOf,
    monthlyAmount: '',
    priority: '20',
    // Période de validité (D50) : un budget qui change se clôt et se rouvre, il ne s'écrase pas.
    activeFrom: '',
    activeTo: '',
  });
  let needError = $state('');
  /** Les besoins hors vigueur à la date de lecture restent consultables, mais repliés (D50). */
  let showClosed = $state(false);

  const accounts = $derived(alive(app.ledger.accounts));
  const tirelires = $derived(alive(app.ledger.tirelires));
  const needs = $derived(alive(app.ledger.needs));
  const idx = $derived(indexLedger(app.ledger));
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?';
  const needsOf = (e: Tirelire) => needs.filter((n) => n.tirelireId === e.id).sort((a, b) => a.priority - b.priority);
  /** Ce que le plan retient à la date de lecture : les besoins en vigueur ce jour-là (D50). */
  const activeNeedsOf = (e: Tirelire) => needsOf(e).filter((n) => needActive(n, app.asOf));
  /** Les autres : clos avant la date de lecture, ou pas encore ouverts. */
  const closedNeedsOf = (e: Tirelire) => needsOf(e).filter((n) => !needActive(n, app.asOf));
  const closedCount = $derived(needs.filter((n) => !needActive(n, app.asOf)).length);

  /** Période de validité en clair, vide quand le besoin vaut depuis toujours et pour toujours. */
  function validityText(n: Need): string {
    if (n.activeFrom && n.activeTo) return `en vigueur du ${shortDate(n.activeFrom)} au ${shortDate(n.activeTo)}`;
    if (n.activeFrom) return `depuis le ${shortDate(n.activeFrom)}`;
    if (n.activeTo) return `jusqu’au ${shortDate(n.activeTo)}`;
    return '';
  }

  // Regroupement d'affichage : par premier compte de placement (D38), ou « sans placement ».
  const byPlacement = $derived(
    accounts
      .map((a) => ({ account: a, tirelires: tirelires.filter((e) => e.placement[0]?.accountId === a.id) }))
      .filter((g) => g.tirelires.length > 0),
  );
  const orphans = $derived(tirelires.filter((e) => e.placement.length === 0 || !accounts.some((a) => a.id === e.placement[0]?.accountId)));

  function placementText(e: Tirelire): string {
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
    const principal = accounts.find((a) => a.kind === 'principal');
    editing = { id: app.newId(), name: '', placement: [], openingBalance: 0, openingDate: app.asOf };
    form = {
      name: '',
      placement: principal ? [{ accountId: principal.id, kind: 'variable' as const, value: '' }] : [],
      openingBalance: '0,00',
      openingDate: app.asOf,
      rollover: 'unlimited',
      rolloverMonths: '3',
    };
    error = '';
  }

  function startEdit(e: Tirelire) {
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
    const row: Tirelire = {
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
    app.upsert('tirelires', row);
    editing = undefined;
  }

  function remove(e: Tirelire) {
    if (!confirm(`Supprimer la tirelire « ${e.name} » et ses besoins ?`)) return;
    for (const n of needsOf(e)) app.remove('needs', n.id);
    app.remove('tirelires', e.id);
  }

  function startNewNeed(e: Tirelire) {
    editingNeed = { need: { id: app.newId(), tirelireId: e.id, kind: 'recurring', priority: DEFAULT_PRIORITY.recurring }, isNew: true };
    needForm = { name: '', kind: 'recurring', amount: '', intervalMonths: '1', anchorDate: app.asOf, monthlyAmount: '', priority: String(DEFAULT_PRIORITY.recurring), activeFrom: '', activeTo: '' };
    needError = '';
  }

  function startEditNeed(n: Need) {
    editingNeed = { need: n, isNew: false };
    needForm = {
      name: n.name ?? '',
      kind: n.kind,
      amount: centsToInput(n.amount),
      intervalMonths: String(n.periodicity ? stepOf(n.periodicity).interval : n.kind === 'dueDate' ? 12 : 1),
      anchorDate: n.periodicity?.anchorDate ?? app.asOf,
      monthlyAmount: centsToInput(n.monthlyAmount),
      priority: String(n.priority),
      activeFrom: n.activeFrom ?? '',
      activeTo: n.activeTo ?? '',
    };
    needError = '';
  }

  function onNeedKindChange() {
    needForm.priority = String(DEFAULT_PRIORITY[needForm.kind]);
    needForm.intervalMonths = needForm.kind === 'dueDate' || needForm.kind === 'payout' ? '12' : '1';
  }

  function saveNeed(ev: Event) {
    ev.preventDefault();
    if (!editingNeed) return;
    const amount = inputToCents(needForm.amount);
    const monthly = inputToCents(needForm.monthlyAmount);
    const interval = Math.max(1, Number(needForm.intervalMonths) || 1);
    if (needForm.activeFrom && needForm.activeTo && needForm.activeTo < needForm.activeFrom)
      return void (needError = 'La fin de validité précède le début : le besoin ne vaudrait jamais.');
    const row: Need = {
      id: editingNeed.need.id,
      tirelireId: editingNeed.need.tirelireId,
      kind: needForm.kind,
      priority: Number(needForm.priority) || DEFAULT_PRIORITY[needForm.kind],
    };
    // La période de validité se saisit, et surtout se conserve : la reconstruire sans ces deux
    // champs rouvrait un besoin clos à chaque modification, et réécrivait le passé (D50).
    if (needForm.activeFrom) row.activeFrom = needForm.activeFrom;
    if (needForm.activeTo) row.activeTo = needForm.activeTo;
    if (needForm.name.trim()) row.name = needForm.name.trim();
    if (needForm.kind === 'dueDate') {
      if (amount === undefined) return void (needError = 'Montant de l’échéance invalide.');
      row.amount = amount;
      row.periodicity = { interval, unit: 'month', anchorDate: needForm.anchorDate };
    } else if (needForm.kind === 'recurring') {
      if (amount === undefined) return void (needError = 'Montant par période invalide.');
      row.amount = amount;
      row.periodicity = { interval, unit: 'month', anchorDate: needForm.anchorDate };
    } else if (needForm.kind === 'payout') {
      // Ce que la réserve rapporte sur la périodicité (l'année, en général) et qu'elle reversera.
      if (amount === undefined) return void (needError = 'Montant à reverser invalide.');
      row.amount = amount;
      row.periodicity = { interval, unit: 'month', anchorDate: needForm.anchorDate };
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
    const per = n.periodicity && stepOf(n.periodicity).interval === 12 ? 'par an' : n.periodicity && stepOf(n.periodicity).interval > 1 ? `tous les ${stepOf(n.periodicity).interval} mois` : 'par période';
    return `${money(n.amount ?? 0)} ${per} · dotation ${money(needCruise(n))}`;
  }

  /** Position réelle : où l'argent se trouve vraiment, comparé au placement voulu (D19, D20). */
  function positionOf(e: Tirelire): Array<{ accountId: string; amount: number }> {
    return [...tirelireComponents(e, idx, app.asOf)]
      .filter(([, amount]) => amount !== 0)
      .map(([accountId, amount]) => ({ accountId, amount }));
  }
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.back() || app.switchTab('more'); }}>‹ Configuration</a></p>
<h1>Tirelires</h1>
<p class="muted small">Une tirelire est un pot à solde unique, réparti sur les comptes où son argent se trouve vraiment. Elle déclare où il devrait dormir, et porte un ou plusieurs besoins : échéance, récurrent, objectif.</p>

<div class="actions">
  <button class="btn primary" onclick={startNew} disabled={accounts.length === 0}>Ajouter une tirelire</button>
  {#if closedCount}
    <label class="btn" style="display:flex;gap:6px;align-items:center">
      <input type="checkbox" bind:checked={showClosed} /> Besoins hors vigueur ({closedCount})
    </label>
  {/if}
</div>
{#if accounts.length === 0}<div class="empty">Crée d'abord un compte.</div>{/if}

{#snippet editeurTirelire()}
  <form class="edit attached" use:revealed onsubmit={save}>
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
{/snippet}

{#snippet editeurBesoin()}
  <form class="edit attached" use:revealed onsubmit={saveNeed}>
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
      {:else if needForm.kind === 'payout'}
        <p class="muted small" style="grid-column:1/-1;margin:0">
          Une réserve qui alimente le budget au lieu de le consommer : les revenus d'une saison,
          encaissés en quelques mois, reversés régulièrement le reste de l'année.
        </p>
        <label class="f">Montant à reverser <input bind:value={needForm.amount} inputmode="decimal" placeholder="12 000,00" /></label>
        <label class="f">Réparti sur (mois) <input type="number" min="1" bind:value={needForm.intervalMonths} /></label>
        <label class="f">Depuis le <input type="date" bind:value={needForm.anchorDate} /></label>
      {:else}
        <label class="f">Mensualité <input bind:value={needForm.monthlyAmount} inputmode="decimal" placeholder="300,00" /></label>
        <label class="f">Cible (facultatif) <input bind:value={needForm.amount} inputmode="decimal" /></label>
      {/if}
      <label class="f">Priorité (petit = servi d'abord) <input type="number" min="0" bind:value={needForm.priority} /></label>
      <label class="f">En vigueur à partir du (facultatif) <input type="date" bind:value={needForm.activeFrom} /></label>
      <label class="f">Clos le (facultatif) <input type="date" bind:value={needForm.activeTo} /></label>
      <p class="muted small" style="grid-column:1/-1;margin:0">
        Un budget qui change ne s'écrase pas : on clôt l'ancien besoin la veille et on en ouvre un
        nouveau, sinon les périodes déjà écoulées seraient recalculées au montant d'aujourd'hui (D50).
      </p>
    </div>
    {#if needError}<div class="err">{needError}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (editingNeed = undefined)}>Annuler</button>
    </div>
  </form>
{/snippet}

<!-- Une tirelire qu'on crée n'a pas encore de carte : son formulaire suit le bouton qui l'ouvre. -->
{#if editing && !tirelires.some((e) => e.id === editing?.id)}
  {@render editeurTirelire()}
{/if}

{#each byPlacement as g (g.account.id)}
  <h2>{g.account.name}</h2>
  {#each g.tirelires as e (e.id)}
    {@const bal = tirelireBalance(e, idx, app.asOf)}
    {@const pos = positionOf(e)}
    <div class="card" class:editing={editing?.id === e.id}>
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
      {#each activeNeedsOf(e) as n (n.id)}
        <div class="row" style="padding-left:8px">
          <div class="label">
            <span class="pill">{NEED_KINDS_SHORT[n.kind]}</span> {n.name ?? e.name}
            <span class="sub">{describeNeed(n)} · priorité {n.priority}{validityText(n) ? ` · ${validityText(n)}` : ''}</span>
          </div>
          <div class="actions" style="margin:0">
            <button class="btn small" onclick={() => startEditNeed(n)}>Modifier</button>
            <button class="btn small danger" onclick={() => removeNeed(n)}>×</button>
          </div>
        </div>
        {#if editingNeed && !editingNeed.isNew && editingNeed.need.id === n.id}
          {@render editeurBesoin()}
        {/if}
      {/each}
      {#if activeNeedsOf(e).length === 0}
        <div class="sub" style="padding-left:8px">Aucun besoin en vigueur : cette tirelire ne demande rien au plan.</div>
      {/if}
      {#if showClosed}
        {#each closedNeedsOf(e) as n (n.id)}
          <div class="row muted" style="padding-left:8px">
            <div class="label">
              <span class="pill">{NEED_KINDS_SHORT[n.kind]}</span> {n.name ?? e.name}
              <span class="sub">hors vigueur — {validityText(n)} · {describeNeed(n)}</span>
            </div>
            <div class="actions" style="margin:0">
              <button class="btn small" onclick={() => startEditNeed(n)}>Modifier</button>
              <button class="btn small danger" onclick={() => removeNeed(n)}>×</button>
            </div>
          </div>
          {#if editingNeed && !editingNeed.isNew && editingNeed.need.id === n.id}
            {@render editeurBesoin()}
          {/if}
        {/each}
      {:else if closedNeedsOf(e).length}
        <div class="sub" style="padding-left:8px">{closedNeedsOf(e).length} besoin(s) hors vigueur au {shortDate(app.asOf)}, masqué(s).</div>
      {/if}
      <div class="actions" style="margin:6px 0 0">
        <button class="btn small" onclick={() => startNewNeed(e)}>Ajouter un besoin</button>
        <button class="btn small" onclick={() => startEdit(e)}>Modifier</button>
        <button class="btn small danger" onclick={() => remove(e)}>Supprimer</button>
      </div>
      {#if editingNeed?.isNew && editingNeed.need.tirelireId === e.id}
        {@render editeurBesoin()}
      {/if}
    </div>
    {#if editing?.id === e.id}
      {@render editeurTirelire()}
    {/if}
  {/each}
{/each}
{#if orphans.length}
  <h2>Sans compte de placement</h2>
  {#each orphans as e (e.id)}
    <div class="card warn" class:editing={editing?.id === e.id}><div class="row"><div class="label">{e.name}<span class="sub">aucun placement voulu : aucun écart ne sera proposé</span></div><button class="btn small" onclick={() => startEdit(e)}>Placer</button></div></div>
    {#if editing?.id === e.id}
      {@render editeurTirelire()}
    {/if}
  {/each}
{/if}
{#if tirelires.length === 0 && accounts.length > 0}
  <div class="empty">Aucune tirelire pour l'instant.</div>
{/if}
