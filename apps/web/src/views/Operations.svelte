<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, shortDate, centsToInput, inputToCents } from '../lib/format';
  import {
    alive,
    applyMatch,
    findCategoryByName,
    proposeMatches,
    suggestPattern,
    payPeriodContaining,
    addDays,
    type Allocation,
    type Category,
    type MatchProposal,
    type Operation,
    type OperationStatus,
    type Rule,
  } from '@tirelire/core';

  type Filter = 'pending' | 'all' | 'matched' | 'transfer';
  let filter = $state<Filter>('pending');
  let accountFilter = $state('');
  let periodOnly = $state(false);
  let search = $state('');
  let editingId = $state<string | undefined>(undefined);

  // Formulaire de ventilation
  let lines = $state<Array<{ id?: string; categoryId: string; envelopeId: string; amount: string }>>([]);
  let newCategory = $state('');
  let oneOff = $state(false);
  let makeRule = $state(false);
  let rulePattern = $state('');
  let error = $state('');

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
      .filter((o) => (filter === 'all' ? true : filter === 'pending' ? o.status === 'pending' : o.status === filter))
      .filter((o) => !accountFilter || o.accountId === accountFilter)
      .filter((o) => !periodOnly || (o.date >= period.start && o.date <= period.end))
      .filter((o) => !search || (o.label + ' ' + (o.details ?? '')).toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Math.abs(b.amount) - Math.abs(a.amount)))
      .slice(0, 300),
  );
  const pendingCount = $derived(alive(app.ledger.operations).filter((o) => o.status === 'pending').length);

  const accountName = (id: string | undefined) => accounts.find((a) => a.id === id)?.name ?? '?';
  const envelopeName = (id: string | undefined) => envelopes.find((e) => e.id === id)?.name;
  const categoryName = (id: string | undefined) => categories.find((c) => c.id === id)?.name;
  const flowName = (id: string | undefined) => flows.find((f) => f.id === id)?.name;

  function statusLabel(s: OperationStatus): string {
    return { pending: 'à traiter', matched: 'flux rapproché', categorized: 'classée', transfer: 'virement interne', oneOff: 'ponctuelle' }[s];
  }

  function startEdit(op: Operation) {
    editingId = op.id;
    const existing = allocByOp.get(op.id) ?? [];
    lines = existing.length
      ? existing.map((a) => ({ id: a.id, categoryId: a.categoryId ?? '', envelopeId: a.envelopeId ?? '', amount: centsToInput(a.amount) }))
      : [{ categoryId: '', envelopeId: '', amount: centsToInput(op.amount) }];
    newCategory = '';
    oneOff = op.status === 'oneOff';
    makeRule = false;
    rulePattern = suggestPattern(op);
    error = '';
  }

  function addLine(op: Operation) {
    const used = lines.reduce((s, l) => s + (inputToCents(l.amount) ?? 0), 0);
    lines.push({ categoryId: '', envelopeId: '', amount: centsToInput(op.amount - used) });
  }

  function onCategory(i: number) {
    const c = categories.find((x) => x.id === lines[i]!.categoryId);
    if (c?.envelopeId && !lines[i]!.envelopeId) lines[i]!.envelopeId = c.envelopeId;
  }

  function remaining(op: Operation): number {
    return op.amount - lines.reduce((s, l) => s + (inputToCents(l.amount) ?? 0), 0);
  }

  function save(op: Operation) {
    error = '';
    const parsedLines = lines.map((l) => ({ ...l, cents: inputToCents(l.amount) }));
    if (parsedLines.some((l) => l.cents === undefined)) return void (error = 'Montant de ligne invalide.');
    if (remaining(op) !== 0) return void (error = `La ventilation doit couvrir le montant (reste ${money(remaining(op))}).`);
    let createdCategory: Category | undefined;
    if (newCategory.trim()) {
      const nature = op.amount < 0 ? 'expense' : 'income';
      createdCategory = findCategoryByName(categories, newCategory, nature);
      if (!createdCategory) {
        createdCategory = { id: app.newId(), name: newCategory.trim(), nature };
        app.store.upsert('categories', createdCategory);
      }
    }
    const existing = allocByOp.get(op.id) ?? [];
    const keep = new Set<string>();
    for (const l of parsedLines) {
      const categoryId = l.categoryId || (createdCategory && !l.categoryId ? createdCategory.id : '');
      const al: Allocation = {
        id: l.id ?? app.newId(),
        operationId: op.id,
        amount: l.cents!,
        ...(categoryId ? { categoryId } : {}),
        ...(l.envelopeId ? { envelopeId: l.envelopeId } : {}),
      };
      keep.add(al.id);
      app.store.upsert('allocations', al);
    }
    for (const a of existing) if (!keep.has(a.id)) app.store.remove('allocations', a.id);
    const status: OperationStatus = oneOff ? 'oneOff' : op.status === 'matched' || op.status === 'transfer' ? op.status : 'categorized';
    app.store.upsert('operations', { ...op, status });
    if (makeRule && rulePattern.trim()) {
      const first = parsedLines[0]!;
      const rule: Rule = {
        id: app.newId(),
        pattern: rulePattern.trim(),
        priority: 50,
        ...(first.categoryId || createdCategory ? { categoryId: first.categoryId || createdCategory!.id } : {}),
        ...(first.envelopeId ? { envelopeId: first.envelopeId } : {}),
      };
      app.store.upsert('rules', rule);
    }
    app.reload();
    editingId = undefined;
  }

  function acceptMatch(op: Operation) {
    const p = proposals.get(op.id);
    if (!p) return;
    app.applyPatch(applyMatch(app.ledger, p));
    editingId = undefined;
  }

  function markTransfer(op: Operation, accountId: string) {
    if (!accountId) return;
    app.upsert('operations', { ...op, status: 'transfer', transferAccountId: accountId });
  }

  function unlink(op: Operation) {
    const next: Operation = { ...op, status: 'pending' };
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

<h1>Opérations {#if pendingCount}<span class="pill catchUp">{pendingCount} à traiter</span>{/if}</h1>

<div class="actions" style="margin-top:8px">
  <select bind:value={filter} class="btn">
    <option value="pending">À traiter</option>
    <option value="all">Toutes</option>
    <option value="matched">Flux rapprochés</option>
    <option value="transfer">Virements internes</option>
  </select>
  <select bind:value={accountFilter} class="btn">
    <option value="">Tous les comptes</option>
    {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
  </select>
  <label class="btn" style="display:flex;gap:6px;align-items:center"><input type="checkbox" bind:checked={periodOnly} /> {period.label}</label>
  <input class="btn" placeholder="Rechercher…" bind:value={search} style="flex:1;min-width:120px" />
</div>

<div class="card">
  {#each operations as op (op.id)}
    {@const allocs = allocByOp.get(op.id) ?? []}
    {@const prop = proposals.get(op.id)}
    <div class="row" style="flex-wrap:wrap">
      <button class="label" style="text-align:left;border:0;background:none;padding:0;cursor:pointer;color:inherit;font:inherit" onclick={() => (editingId === op.id ? (editingId = undefined) : startEdit(op))}>
        <strong>{op.label}</strong>
        <span class="sub">
          {shortDate(op.date)} · {accountName(op.accountId)} · <span class="pill {op.status === 'pending' ? 'catchUp' : 'ok'}">{statusLabel(op.status)}</span>
          {#if op.plannedFlowId} · {flowName(op.plannedFlowId)}{/if}
          {#if op.transferAccountId} · → {accountName(op.transferAccountId)}{/if}
          {#if allocs.length} · {allocs.map((a) => [categoryName(a.categoryId), envelopeName(a.envelopeId)].filter(Boolean).join(' / ')).join(' + ')}{/if}
          {#if op.suggestedCategory && !allocs.length} · banque : {op.suggestedCategory}{/if}
        </span>
        {#if prop && op.status === 'pending'}
          <span class="sub" style="color:var(--accent)">Proposition : rapprocher du flux « {flowName(prop.flowId)} » ({Math.round(prop.score * 100)} %, {prop.reasons.join(', ')})</span>
        {/if}
      </button>
      <div class="num {op.amount > 0 ? 'pos' : ''}">{money(op.amount)}</div>

      {#if editingId === op.id}
        <form class="edit" style="width:100%" onsubmit={(e) => { e.preventDefault(); save(op); }}>
          {#if op.details}<p class="small muted">{op.details}</p>{/if}
          {#if prop && op.status === 'pending'}
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
              <label class="f">Montant <input bind:value={l.amount} inputmode="decimal" /></label>
              {#if lines.length > 1}<button class="btn small danger" type="button" style="align-self:end" onclick={() => lines.splice(i, 1)}>Retirer</button>{/if}
            </div>
          {/each}
          <div class="actions" style="margin:0">
            <button class="btn small" type="button" onclick={() => addLine(op)}>Ajouter une ligne</button>
            {#if remaining(op) !== 0}<span class="small neg">reste {money(remaining(op))}</span>{/if}
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
            {#if op.status !== 'pending'}<button class="btn" type="button" onclick={() => unlink(op)}>Remettre à traiter</button>{/if}
            <button class="btn danger" type="button" onclick={() => remove(op)}>Supprimer</button>
            <button class="btn" type="button" onclick={() => (editingId = undefined)}>Fermer</button>
          </div>
        </form>
      {/if}
    </div>
  {:else}
    <div class="muted">Rien à afficher{filter === 'pending' ? ' : tout est trié.' : '.'}</div>
  {/each}
</div>
