<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, shortDate, centsToInput, inputToCents } from '../lib/format';
  import {
    alive,
    applyMatch,
    findCategoryByName,
    proposeMatches,
    payPeriodContaining,
    addDays,
    type Allocation,
    type Category,
    applyBulkAction,
    editAllocations,
    inferSelection,
    previewRules,
    suggestPattern,
    topRank,
    unlock,
    variableRest,
    type AllocationDraft,
    type MatchProposal,
    type Operation,
    type OperationState,
    type Rule,
  } from '@tirelire/core';

  type Filter = 'untreated' | 'all' | 'reconciled' | 'locked' | 'transfer';
  let filter = $state<Filter>('untreated');
  let accountFilter = $state('');
  let periodOnly = $state(false);
  let search = $state('');
  let editingId = $state<string | undefined>(undefined);

  // Formulaire de ventilation : chaque ligne porte une part (D27).
  type LineForm = { id?: string; categoryId: string; envelopeId: string; kind: 'fixed' | 'percent' | 'variable'; value: string };
  let lines = $state<LineForm[]>([]);
  let newCategory = $state('');
  let oneOff = $state(false);
  let makeRule = $state(false);
  let rulePattern = $state('');
  let error = $state('');

  // Sélection pour action groupée (D26) : ne se conserve pas, seuls ses effets restent.
  let selected = $state<Set<string>>(new Set());
  let bulkOpen = $state(false);
  let bulkCategory = $state('');
  let bulkEnvelope = $state('');
  let bulkState = $state<'lock' | 'reconcile' | 'none' | 'unlock'>('lock');
  let bulkOneOff = $state<'' | 'yes' | 'no'>('');
  let bulkRulePattern = $state('');

  const accounts = $derived(alive(app.ledger.accounts));
  const envelopes = $derived(alive(app.ledger.envelopes));
  const categories = $derived(alive(app.ledger.categories).sort((a, b) => a.name.localeCompare(b.name, 'fr')));
  const flows = $derived(alive(app.ledger.plannedFlows));
  const period = $derived(payPeriodContaining(app.asOf, accounts.find((a) => a.kind === 'pivot')?.payDay ?? 1));
  const allocByOp = $derived.by(() => {
    const m = new Map<string, Allocation[]>();
    for (const a of alive(app.ledger.allocations)) {
      const arr = m.get(a.operationId);
      if (arr) arr.push(a);
      else m.set(a.operationId, [a]);
    }
    return m;
  });
  const proposals = $derived.by(() => {
    const m = new Map<string, MatchProposal>();
    for (const p of proposeMatches(app.ledger, addDays(period.start, -400), addDays(period.end, 40))) m.set(p.operationId, p);
    return m;
  });
  const operations = $derived(
    alive(app.ledger.operations)
      .filter((o) => (filter === 'all' ? true : filter === 'transfer' ? !!o.transferAccountId : o.state === filter))
      .filter((o) => !accountFilter || o.accountId === accountFilter)
      .filter((o) => !periodOnly || (o.date >= period.start && o.date <= period.end))
      .filter((o) => !search || (o.label + ' ' + (o.details ?? '')).toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Math.abs(b.amount) - Math.abs(a.amount)))
      .slice(0, 300),
  );
  const untreatedCount = $derived(alive(app.ledger.operations).filter((o) => o.state === 'untreated').length);

  const accountName = (id: string | undefined) => accounts.find((a) => a.id === id)?.name ?? '?';
  const envelopeName = (id: string | undefined) => envelopes.find((e) => e.id === id)?.name;
  const categoryName = (id: string | undefined) => categories.find((c) => c.id === id)?.name;
  const flowName = (id: string | undefined) => flows.find((f) => f.id === id)?.name;

  /** D22 : l'état dit qui a le droit d'écrire, pas ce que l'opération est. */
  function stateLabel(s: OperationState): string {
    return { untreated: 'non traitée', reconciled: 'rapprochée', locked: 'verrouillée' }[s];
  }

  function startEdit(op: Operation) {
    editingId = op.id;
    const existing = allocByOp.get(op.id) ?? [];
    lines = existing.length
      ? existing.map((a) => ({
          id: a.id,
          categoryId: a.categoryId ?? '',
          envelopeId: a.envelopeId ?? '',
          kind: a.share.kind,
          value: a.share.kind === 'fixed' ? centsToInput(a.share.amount) : a.share.kind === 'percent' ? String(a.share.pct) : '',
        }))
      // Toute opération a par défaut une ligne unique variable, qui prend l'intégralité du montant.
      : [{ categoryId: '', envelopeId: '', kind: 'variable' as const, value: '' }];
    newCategory = '';
    oneOff = !!op.oneOff;
    makeRule = false;
    rulePattern = suggestPattern(op);
    error = '';
  }

  function addLine(op: Operation) {
    // Ajouter une ligne réduit d'autant la ligne variable ; s'il n'y en a pas, la nouvelle l'est.
    const hasVariable = lines.some((l) => l.kind === 'variable');
    lines.push(
      hasVariable
        ? { categoryId: '', envelopeId: '', kind: 'fixed', value: centsToInput(rest(op)) }
        : { categoryId: '', envelopeId: '', kind: 'variable', value: '' },
    );
  }

  /** Parts saisies, converties pour le cœur. */
  function drafts(): AllocationDraft[] {
    return lines.map((l) => ({
      ...(l.id ? { id: l.id } : {}),
      ...(l.categoryId ? { categoryId: l.categoryId } : {}),
      ...(l.envelopeId ? { envelopeId: l.envelopeId } : {}),
      share:
        l.kind === 'fixed'
          ? ({ kind: 'fixed', amount: inputToCents(l.value) ?? 0 } as const)
          : l.kind === 'percent'
            ? ({ kind: 'percent', pct: Number(l.value.replace(',', '.')) || 0 } as const)
            : ({ kind: 'variable' } as const),
    }));
  }

  /** Ce que prendrait la part variable en l'état de la saisie (D27). */
  function rest(op: Operation): number {
    const allocs = drafts().map((d, i) => ({ id: String(i), operationId: op.id, share: d.share }));
    return variableRest(op, allocs);
  }

  function lineAmount(op: Operation, l: LineForm): number {
    if (l.kind === 'fixed') return inputToCents(l.value) ?? 0;
    if (l.kind === 'percent') return Math.round((op.amount * (Number(l.value.replace(',', '.')) || 0)) / 100);
    return rest(op);
  }

  function onCategory(i: number) {
    const c = categories.find((x) => x.id === lines[i]!.categoryId);
    if (c?.envelopeId && !lines[i]!.envelopeId) lines[i]!.envelopeId = c.envelopeId;
  }

  function save(op: Operation) {
    error = '';
    let createdCategory: Category | undefined;
    if (newCategory.trim()) {
      const nature = op.amount < 0 ? 'expense' : 'income';
      createdCategory = findCategoryByName(categories, newCategory, nature);
      if (!createdCategory) {
        createdCategory = { id: app.newId(), name: newCategory.trim(), nature };
        app.store.upsert('categories', createdCategory);
      }
    }
    const drafted = drafts().map((d) => (createdCategory && !d.categoryId ? { ...d, categoryId: createdCategory!.id } : d));
    try {
      // Le cœur valide les parts et verrouille l'opération : c'est la modification qui change l'état.
      app.applyPatch(editAllocations(app.ledger, op.id, drafted, { oneOff }));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      return;
    }
    if (makeRule && rulePattern.trim()) {
      const first = drafted[0];
      const rule: Rule = {
        id: app.newId(),
        selection: { labelPattern: rulePattern.trim() },
        action: {
          state: 'reconcile',
          ...(first?.categoryId ? { categoryId: first.categoryId } : {}),
          ...(first?.envelopeId ? { envelopeId: first.envelopeId } : {}),
        },
        rank: topRank(app.ledger),
      };
      app.store.upsert('rules', rule);
    }
    app.reload();
    editingId = undefined;
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function selectAllVisible() {
    selected = new Set(operations.map((o) => o.id));
  }

  function clearSelection() {
    selected = new Set();
    bulkOpen = false;
  }

  /** Action de l'aperçu et de l'application : les mêmes champs qu'une règle, plus Déverrouiller. */
  function bulkActionValue() {
    return {
      ...(bulkCategory ? { categoryId: bulkCategory } : {}),
      ...(bulkEnvelope ? { envelopeId: bulkEnvelope } : {}),
      ...(bulkOneOff ? { oneOff: bulkOneOff === 'yes' } : {}),
      state: bulkState,
    };
  }

  /** Aperçu obligatoire (D26) : ce que l'action changerait, avant de l'appliquer. */
  const bulkPreview = $derived.by(() => {
    if (!bulkOpen) return [];
    const ids = [...selected];
    const patch = applyBulkAction(app.ledger, ids, bulkActionValue());
    return patch.operations.map((next) => {
      const before = app.ledger.operations.find((o) => o.id === next.id)!;
      return { label: before.label, from: stateLabel(before.state), to: stateLabel(next.state) };
    });
  });

  function applyBulk() {
    app.applyPatch(applyBulkAction(app.ledger, [...selected], bulkActionValue()));
    clearSelection();
  }

  /** Chemin inverse (D26) : la sélection propose un filtre, donc une règle. */
  function ruleFromSelection() {
    const ops = app.ledger.operations.filter((o) => selected.has(o.id));
    const selection = inferSelection(ops);
    bulkRulePattern = selection.labelPattern ?? '';
    const rule: Rule = {
      id: app.newId(),
      selection,
      action: {
        state: 'reconcile',
        ...(bulkCategory ? { categoryId: bulkCategory } : {}),
        ...(bulkEnvelope ? { envelopeId: bulkEnvelope } : {}),
      },
      rank: topRank(app.ledger),
    };
    const touched = previewRules(app.ledger, rule).filter((d) => d.changed).length;
    if (!confirm(`Créer une règle « ${selection.labelPattern ?? 'tout'} » ? Elle toucherait ${touched} opération(s).`)) return;
    app.upsert('rules', rule);
    clearSelection();
  }

  function acceptMatch(op: Operation) {
    const p = proposals.get(op.id);
    if (!p) return;
    app.applyPatch(applyMatch(app.ledger, p));
    editingId = undefined;
  }

  function markTransfer(op: Operation, accountId: string) {
    if (!accountId) return;
    // Désigner un virement est une modification manuelle : elle verrouille (D22).
    app.upsert('operations', { ...op, state: 'locked', transferAccountId: accountId });
  }

  /** Déverrouiller : l'opération repart aux règles, sans rien perdre (D22). */
  function unlockOp(op: Operation) {
    app.upsert('operations', unlock(op));
  }

  /** Repartir de zéro : plus de flux, plus de virement, plus de ventilation. */
  function unlink(op: Operation) {
    const next: Operation = { ...op, state: 'untreated' };
    delete next.plannedFlowId;
    delete next.transferAccountId;
    delete next.transferOperationId;
    for (const a of allocByOp.get(op.id) ?? []) app.store.remove('allocations', a.id);
    app.upsert('operations', next);
    editingId = undefined;
  }

  function remove(op: Operation) {
    if (!confirm(`Supprimer « ${op.label} » ? (un réimport la fera revenir)`)) return;
    for (const a of allocByOp.get(op.id) ?? []) app.store.remove('allocations', a.id);
    app.remove('operations', op.id);
    editingId = undefined;
  }
</script>

<h1>Opérations {#if untreatedCount}<span class="pill catchUp">{untreatedCount} non traitées</span>{/if}</h1>

<div class="actions" style="margin-top:8px">
  <select bind:value={filter} class="btn">
    <option value="untreated">Non traitées</option>
    <option value="all">Toutes</option>
    <option value="reconciled">Rapprochées</option>
    <option value="locked">Verrouillées</option>
    <option value="transfer">Virements internes</option>
  </select>
  <select bind:value={accountFilter} class="btn">
    <option value="">Tous les comptes</option>
    {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
  </select>
  <label class="btn" style="display:flex;gap:6px;align-items:center"><input type="checkbox" bind:checked={periodOnly} /> {period.label}</label>
  <input class="btn" placeholder="Rechercher…" bind:value={search} style="flex:1;min-width:120px" />
</div>

<div class="actions" style="margin-top:0">
  <button class="btn small" onclick={selectAllVisible}>Tout sélectionner ({operations.length})</button>
  {#if selected.size}
    <button class="btn small" onclick={clearSelection}>Désélectionner</button>
    <button class="btn small primary" onclick={() => (bulkOpen = !bulkOpen)}>Action sur {selected.size} opération(s)</button>
  {/if}
</div>

{#if bulkOpen && selected.size}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); applyBulk(); }}>
    <h3 style="margin-top:0">Action groupée</h3>
    <div class="grid">
      <label class="f">Catégorie
        <select bind:value={bulkCategory}>
          <option value="">— (ne pas toucher)</option>
          {#each categories as c}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label class="f">Enveloppe
        <select bind:value={bulkEnvelope}>
          <option value="">— (ne pas toucher)</option>
          {#each envelopes as e}<option value={e.id}>{e.name}</option>{/each}
        </select>
      </label>
      <label class="f">État
        <select bind:value={bulkState}>
          <option value="lock">Verrouiller</option>
          <option value="reconcile">Rapprocher</option>
          <option value="none">Ne rien faire</option>
          <option value="unlock">Déverrouiller</option>
        </select>
      </label>
      <label class="f">Ponctuelle
        <select bind:value={bulkOneOff}>
          <option value="">— (ne pas toucher)</option>
          <option value="yes">Oui</option>
          <option value="no">Non</option>
        </select>
      </label>
    </div>
    <h3>Aperçu</h3>
    <div class="card">
      {#each bulkPreview.slice(0, 8) as p}
        <div class="row"><div class="label">{p.label}<span class="sub">{p.from} → {p.to}</span></div></div>
      {/each}
      {#if bulkPreview.length > 8}<div class="sub">…et {bulkPreview.length - 8} autre(s).</div>{/if}
    </div>
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Appliquer</button>
      <button class="btn" type="button" onclick={ruleFromSelection}>En faire une règle</button>
      <button class="btn" type="button" onclick={clearSelection}>Annuler</button>
    </div>
  </form>
{/if}

<div class="card">
  {#each operations as op (op.id)}
    {@const allocs = allocByOp.get(op.id) ?? []}
    {@const prop = proposals.get(op.id)}
    <div class="row" style="flex-wrap:wrap">
      <input type="checkbox" checked={selected.has(op.id)} onchange={() => toggle(op.id)} style="margin-right:8px;align-self:flex-start" aria-label="Sélectionner" />
      <button class="label" style="text-align:left;border:0;background:none;padding:0;cursor:pointer;color:inherit;font:inherit" onclick={() => (editingId === op.id ? (editingId = undefined) : startEdit(op))}>
        <strong>{op.label}</strong>
        <span class="sub">
          {shortDate(op.date)} · {accountName(op.accountId)} · <span class="pill {op.state === 'untreated' ? 'catchUp' : 'ok'}">{stateLabel(op.state)}</span>
          {#if op.oneOff} · ponctuelle{/if}
          {#if op.plannedFlowId} · {flowName(op.plannedFlowId)}{/if}
          {#if op.transferAccountId} · → {accountName(op.transferAccountId)}{/if}
          {#if allocs.length} · {allocs.map((a) => [categoryName(a.categoryId), envelopeName(a.envelopeId)].filter(Boolean).join(' / ')).join(' + ')}{/if}
          {#if op.suggestedCategory && !allocs.length} · banque : {op.suggestedCategory}{/if}
        </span>
        {#if prop && op.state !== 'locked'}
          <span class="sub" style="color:var(--accent)">Proposition : rapprocher du flux « {flowName(prop.flowId)} » ({Math.round(prop.score * 100)} %, {prop.reasons.join(', ')})</span>
        {/if}
      </button>
      <div class="num {op.amount > 0 ? 'pos' : ''}">{money(op.amount)}</div>

      {#if editingId === op.id}
        <form class="edit" style="width:100%" onsubmit={(e) => { e.preventDefault(); save(op); }}>
          {#if op.details}<p class="small muted">{op.details}</p>{/if}
          {#if prop && op.state !== 'locked'}
            <div class="actions" style="margin:0">
              <button class="btn primary" type="button" onclick={() => acceptMatch(op)}>Rapprocher du flux « {flowName(prop.flowId)} »</button>
            </div>
          {/if}
          <h3>Ventilation</h3>
          {#each lines as l, i (i)}
            <div class="grid">
              <label class="f">Catégorie
                <select bind:value={l.categoryId} onchange={() => onCategory(i)}>
                  <option value="">—</option>
                  {#each categories as c}<option value={c.id}>{c.name}</option>{/each}
                </select>
              </label>
              <label class="f">Enveloppe
                <select bind:value={l.envelopeId}>
                  <option value="">— (non affecté)</option>
                  {#each envelopes as e}<option value={e.id}>{e.name} ({accountName(e.placementAccountId)})</option>{/each}
                </select>
              </label>
              <label class="f">Part
                <select bind:value={l.kind}>
                  <option value="variable">Le reste</option>
                  <option value="fixed">Montant fixe</option>
                  <option value="percent">Pourcentage</option>
                </select>
              </label>
              {#if l.kind !== 'variable'}
                <label class="f">{l.kind === 'percent' ? '%' : 'Montant'} <input bind:value={l.value} inputmode="decimal" /></label>
              {/if}
              <div class="f"><span class="sub">soit {money(lineAmount(op, l))}</span></div>
              {#if lines.length > 1}<button class="btn small danger" type="button" style="align-self:end" onclick={() => lines.splice(i, 1)}>Retirer</button>{/if}
            </div>
          {/each}
          <div class="actions" style="margin:0">
            <button class="btn small" type="button" onclick={() => addLine(op)}>Ajouter une ligne</button>
            {#if !lines.some((l) => l.kind === 'variable') && rest(op) !== 0}
              <span class="small neg">non affecté : {money(op.amount - lines.reduce((s, l) => s + lineAmount(op, l), 0))}</span>
            {/if}
          </div>
          <div class="grid">
            <label class="f">Nouvelle catégorie (si absente) <input bind:value={newCategory} /></label>
            <label class="f check"><input type="checkbox" bind:checked={oneOff} /> Dépense ponctuelle (hors moyennes de budget)</label>
          </div>
          <label class="f check"><input type="checkbox" bind:checked={makeRule} /> Créer une règle pour les prochaines opérations semblables</label>
          {#if makeRule}<label class="f">Motif (regex, insensible à la casse) <input bind:value={rulePattern} /></label>{/if}
          {#if error}<div class="err">{error}</div>{/if}
          <div class="actions" style="margin:0">
            <button class="btn primary" type="submit">Enregistrer</button>
            <select class="btn" onchange={(e) => markTransfer(op, (e.target as HTMLSelectElement).value)}>
              <option value="">Virement interne vers…</option>
              {#each accounts.filter((a) => a.id !== op.accountId) as a}<option value={a.id}>{a.name}</option>{/each}
            </select>
            {#if op.state === 'locked'}<button class="btn" type="button" onclick={() => unlockOp(op)}>Déverrouiller</button>{/if}
            {#if op.state !== 'untreated' || allocs.length}<button class="btn" type="button" onclick={() => unlink(op)}>Tout remettre à zéro</button>{/if}
            <button class="btn danger" type="button" onclick={() => remove(op)}>Supprimer</button>
            <button class="btn" type="button" onclick={() => (editingId = undefined)}>Fermer</button>
          </div>
        </form>
      {/if}
    </div>
  {:else}
    <div class="muted">Rien à afficher{filter === 'untreated' ? ' : tout est traité.' : '.'}</div>
  {/each}
</div>
