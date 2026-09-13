<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, shortDate, centsToInput, inputToCents } from '../lib/format';
  import {
    alive,
    applyMatch,
    findCategoryByName,
    proposeMatches,
    budgetPeriodContaining,
    addDays,
    type Allocation,
    type Category,
    applyAutomations,
    applyBulkAction,
    editAllocations,
    selects,
    type AutomationSelection,
    inferSelection,
    previewAutomations,
    suggestPattern,
    topRank,
    unlock,
    variableRest,
    type AllocationDraft,
    type MatchProposal,
    type Operation,
    type OperationState,
    type Automation,
  } from '@tirelire/core';

  type Filter = 'untreated' | 'all' | 'reconciled' | 'locked' | 'transfer';
  let filter = $state<Filter>('untreated');
  let periodOnly = $state(false);

  /**
   * Recherche = sélection d'un automatisme (D36, D39) : ces champs sont exactement ceux d'une
   * `AutomationSelection`, et partent tels quels dans l'automatisme qu'on enregistre.
   */
  let sel = $state({ labelPattern: '', regex: false, accountId: '', amountMin: '', amountMax: '', dateFrom: '', dateTo: '' });
  let searchOpen = $state(true);
  let editingId = $state<string | undefined>(undefined);

  // Formulaire de ventilation : chaque ligne porte une part (D27).
  type LineForm = { id?: string; categoryId: string; tirelireId: string; kind: 'fixed' | 'percent' | 'variable'; value: string; replenishment: '' | 'internal' | 'external' };
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
  let bulkTirelire = $state('');
  let bulkState = $state<'lock' | 'reconcile' | 'none' | 'unlock'>('lock');
  let bulkOneOff = $state<'' | 'yes' | 'no'>('');
  let automationName = $state('');
  let saved = $state('');

  const accounts = $derived(alive(app.ledger.accounts));
  const tirelires = $derived(alive(app.ledger.tirelires));
  const categories = $derived(alive(app.ledger.categories).sort((a, b) => a.name.localeCompare(b.name, 'fr')));
  const flows = $derived(alive(app.ledger.plannedFlows));
  const period = $derived(budgetPeriodContaining(app.asOf, app.ledger.settings.periodStartDay));
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
  /** Les champs de recherche, convertis en sélection pour le cœur. Vide = critère absent. */
  const selection = $derived.by<AutomationSelection>(() => {
    const out: AutomationSelection = {};
    const pattern = sel.labelPattern.trim();
    // Sans la case « expression régulière », on cherche le texte littéral : les caractères
    // spéciaux sont échappés pour que « CAFÉ (2) » ne soit pas lu comme un motif.
    if (pattern) out.labelPattern = sel.regex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (sel.accountId) out.accountId = sel.accountId;
    const min = inputToCents(sel.amountMin);
    const max = inputToCents(sel.amountMax);
    if (min !== undefined) out.amountMin = min;
    if (max !== undefined) out.amountMax = max;
    if (sel.dateFrom) out.dateFrom = sel.dateFrom;
    if (sel.dateTo) out.dateTo = sel.dateTo;
    return out;
  });

  /** Ce que la recherche retourne : les critères d'un automatisme, plus ceux de consultation. */
  const matching = $derived(
    alive(app.ledger.operations)
      .filter((o) => selects(selection, o))
      .filter((o) => (filter === 'all' ? true : filter === 'transfer' ? !!o.transferAccountId : o.state === filter))
      .filter((o) => !periodOnly || (o.date >= period.start && o.date <= period.end))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Math.abs(b.amount) - Math.abs(a.amount))),
  );
  /**
   * La liste se coupait à 300 lignes sans le dire : après l'import de plusieurs années, on voyait
   * les 300 plus récentes et rien n'indiquait que le reste existait. On affiche par tranches, on
   * annonce combien il en reste, et le compteur de recherche rappelle toujours le total connu.
   */
  const PAGE = 300;
  let shown = $state(PAGE);
  const operations = $derived(matching.slice(0, shown));
  const selectionActive = $derived(Object.keys(selection).length > 0);
  const totalOps = $derived(alive(app.ledger.operations).length);
  const untreatedCount = $derived(alive(app.ledger.operations).filter((o) => o.state === 'untreated').length);
  // Changer de critère repart de la première tranche : sinon on hérite du « voir plus » d'avant.
  $effect(() => {
    void selection;
    void filter;
    void periodOnly;
    shown = PAGE;
  });

  const accountName = (id: string | undefined) => accounts.find((a) => a.id === id)?.name ?? '?';
  const tirelireName = (id: string | undefined) => tirelires.find((e) => e.id === id)?.name;
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
          tirelireId: a.tirelireId ?? '',
          kind: a.share.kind,
          value: a.share.kind === 'fixed' ? centsToInput(a.share.amount) : a.share.kind === 'percent' ? String(a.share.pct) : '',
          replenishment: a.replenishment ?? '',
        }))
      // Toute opération a par défaut une ligne unique variable, qui prend l'intégralité du montant.
      : [{ categoryId: '', tirelireId: '', kind: 'variable' as const, value: '', replenishment: '' as const }];
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
        ? { categoryId: '', tirelireId: '', kind: 'fixed', value: centsToInput(rest(op)), replenishment: '' }
        : { categoryId: '', tirelireId: '', kind: 'variable', value: '', replenishment: '' },
    );
  }

  /** Parts saisies, converties pour le cœur. */
  function drafts(): AllocationDraft[] {
    return lines.map((l) => ({
      ...(l.id ? { id: l.id } : {}),
      ...(l.categoryId ? { categoryId: l.categoryId } : {}),
      ...(l.tirelireId ? { tirelireId: l.tirelireId } : {}),
      ...(l.replenishment ? { replenishment: l.replenishment } : {}),
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
    if (c?.tirelireId && !lines[i]!.tirelireId) lines[i]!.tirelireId = c.tirelireId;
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
      const rule: Automation = {
        id: app.newId(),
        selection: { labelPattern: rulePattern.trim() },
        action: {
          state: 'reconcile',
          ...(first?.categoryId ? { categoryId: first.categoryId } : {}),
          ...(first?.tirelireId ? { tirelireId: first.tirelireId } : {}),
        },
        rank: topRank(app.ledger),
      };
      app.store.upsert('automations', rule);
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
    selected = new Set(matching.map((o) => o.id));
  }

  /** Cibles de l'action : les lignes cochées, sinon tout ce que la recherche retourne. */
  const targets = $derived(selected.size ? [...selected] : matching.map((o) => o.id));

  function clearSelection() {
    selected = new Set();
    bulkOpen = false;
  }

  /** Action de l'aperçu et de l'application : les mêmes champs qu'un automatisme, plus Déverrouiller. */
  function bulkActionValue() {
    return {
      ...(bulkCategory ? { categoryId: bulkCategory } : {}),
      ...(bulkTirelire ? { tirelireId: bulkTirelire } : {}),
      ...(bulkOneOff ? { oneOff: bulkOneOff === 'yes' } : {}),
      state: bulkState,
    };
  }

  /** Aperçu obligatoire (D26) : ce que l'action changerait, avant de l'appliquer. */
  const bulkPreview = $derived.by(() => {
    if (!bulkOpen) return [];
    const patch = applyBulkAction(app.ledger, targets, bulkActionValue());
    return patch.operations.map((next) => {
      const before = app.ledger.operations.find((o) => o.id === next.id)!;
      return { label: before.label, from: stateLabel(before.state), to: stateLabel(next.state) };
    });
  });

  function applyBulk() {
    const n = targets.length;
    if (n > 20 && !confirm(`Appliquer à ${n} opérations ?`)) return;
    app.applyPatch(applyBulkAction(app.ledger, targets, bulkActionValue()));
    saved = `${n} opération(s) modifiée(s).`;
    clearSelection();
  }

  /**
   * Enregistrer la recherche et ses actions comme automatisme (D39) : la sélection part telle
   * quelle, sans inférence — c'est ce que l'utilisateur vient d'écrire.
   */
  function saveAutomation() {
    if (!selectionActive) {
      error = 'Renseigne au moins un critère de recherche avant d’enregistrer.';
      return;
    }
    const automation: Automation = {
      id: app.newId(),
      selection,
      action: bulkActionValue(),
      rank: topRank(app.ledger),
      ...(automationName.trim() ? { name: automationName.trim() } : {}),
    };
    const touched = previewAutomations(app.ledger, automation).filter((d) => d.changed).length;
    app.upsert('automations', automation);
    // Un automatisme s'applique dès qu'il existe : il n'attend pas le prochain import.
    app.applyPatch(applyAutomations(app.ledger));
    saved = `Automatisme enregistré · ${touched} opération(s) reprises.`;
    automationName = '';
    bulkOpen = false;
  }

  /** Chemin inverse (D26) : à partir des lignes cochées, remplir les champs de recherche. */
  function guessFilter() {
    const ops = app.ledger.operations.filter((o) => selected.has(o.id));
    const guess = inferSelection(ops);
    sel.labelPattern = guess.labelPattern ?? '';
    sel.regex = true;
    sel.accountId = guess.accountId ?? '';
    sel.amountMin = guess.amountMin !== undefined ? centsToInput(guess.amountMin) : '';
    sel.amountMax = guess.amountMax !== undefined ? centsToInput(guess.amountMax) : '';
    searchOpen = true;
  }

  function resetSearch() {
    sel = { labelPattern: '', regex: false, accountId: '', amountMin: '', amountMax: '', dateFrom: '', dateTo: '' };
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

  /** Déverrouiller : l'opération repart aux automatismes, sans rien perdre (D22). */
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

<!-- Recherche = sélection d'un automatisme (D36, D39) : ces champs partent tels quels. -->
<div class="card" style="margin-top:8px">
  <div class="row">
    <button class="label" style="text-align:left;border:0;background:none;padding:0;cursor:pointer;color:inherit;font:inherit" onclick={() => (searchOpen = !searchOpen)}>
      <strong>Recherche</strong>
      <span class="sub">{matching.length} opération(s) sur {totalOps} connues{selectionActive ? '' : ' · aucun critère de recherche'}</span>
    </button>
    <span class="num">{searchOpen ? '▾' : '▸'}</span>
  </div>
  {#if searchOpen}
    <div class="grid">
      <label class="f">Libellé contient
        <input bind:value={sel.labelPattern} placeholder="SUPERMARCHE" />
      </label>
      <label class="f check"><input type="checkbox" bind:checked={sel.regex} /> Expression régulière</label>
      <label class="f">Compte
        <select bind:value={sel.accountId}>
          <option value="">Tous</option>
          {#each accounts as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
      <label class="f">Montant de <input bind:value={sel.amountMin} inputmode="decimal" placeholder="-100,00" /></label>
      <label class="f">à <input bind:value={sel.amountMax} inputmode="decimal" placeholder="-10,00" /></label>
      <label class="f">Date du <input type="date" bind:value={sel.dateFrom} /></label>
      <label class="f">au <input type="date" bind:value={sel.dateTo} /></label>
    </div>
    <div class="actions" style="margin:6px 0 0">
      <button class="btn small" onclick={resetSearch}>Effacer</button>
      {#if selected.size}<button class="btn small" onclick={guessFilter}>Deviner d’après la sélection</button>{/if}
    </div>
    <div class="sub" style="margin-top:6px">Affichage seulement, jamais enregistré dans un automatisme :</div>
    <div class="actions" style="margin:4px 0 0">
      <select bind:value={filter} class="btn">
        <option value="untreated">Non traitées</option>
        <option value="all">Toutes</option>
        <option value="reconciled">Rapprochées</option>
        <option value="locked">Verrouillées</option>
        <option value="transfer">Virements internes</option>
      </select>
      <label class="btn" style="display:flex;gap:6px;align-items:center"><input type="checkbox" bind:checked={periodOnly} /> {period.label}</label>
    </div>
  {/if}
</div>

<div class="actions" style="margin-top:0">
  <button class="btn small primary" onclick={() => (bulkOpen = !bulkOpen)}>
    {bulkOpen ? 'Masquer les actions' : `Actions sur ${selected.size || matching.length} opération(s)`}
  </button>
  <button class="btn small" onclick={selectAllVisible}>Tout cocher ({matching.length})</button>
  {#if selected.size}<button class="btn small" onclick={clearSelection}>Décocher</button>{/if}
</div>

{#if saved}<div class="card ok"><div class="sub">{saved}</div></div>{/if}

{#if bulkOpen}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); applyBulk(); }}>
    <h3 style="margin-top:0">Actions à appliquer</h3>
    <p class="sub" style="margin-top:0">
      {selected.size ? `${selected.size} opération(s) cochée(s)` : `les ${matching.length} opération(s) trouvée(s)`}
    </p>
    <div class="grid">
      <label class="f">Catégorie
        <select bind:value={bulkCategory}>
          <option value="">— (ne pas toucher)</option>
          {#each categories as c}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label class="f">Tirelire
        <select bind:value={bulkTirelire}>
          <option value="">— (ne pas toucher)</option>
          {#each tirelires as e}<option value={e.id}>{e.name}</option>{/each}
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
    <label class="f">Nom de l’automatisme (facultatif) <input bind:value={automationName} placeholder="Courses du supermarché" /></label>
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Appliquer maintenant</button>
      <button class="btn primary" type="button" onclick={saveAutomation} disabled={!selectionActive}>Enregistrer l’automatisme</button>
      <button class="btn" type="button" onclick={() => (bulkOpen = false)}>Fermer</button>
    </div>
    {#if !selectionActive}
      <p class="sub">Pour enregistrer un automatisme, renseigne au moins un critère de recherche : c’est lui qui dira à quelles opérations futures ces actions s’appliquent.</p>
    {/if}
  </form>
{/if}

<div class="card">
  {#each operations as op (op.id)}
    {@const allocs = allocByOp.get(op.id) ?? []}
    {@const prop = proposals.get(op.id)}
    <div class="row" style="flex-wrap:wrap">
      <!-- L'étiquette porte la cible : une case à cocher nue fait 13 px de côté, on la manque au doigt. -->
      <label class="cocher" aria-label="Sélectionner l’opération {op.label}">
        <input type="checkbox" checked={selected.has(op.id)} onchange={() => toggle(op.id)} />
      </label>
      <button class="label" style="text-align:left;border:0;background:none;padding:0;cursor:pointer;color:inherit;font:inherit" onclick={() => (editingId === op.id ? (editingId = undefined) : startEdit(op))}>
        <strong>{op.label}</strong>
        <span class="sub">
          {shortDate(op.date)} · {accountName(op.accountId)} · <span class="pill {op.state === 'untreated' ? 'catchUp' : 'ok'}">{stateLabel(op.state)}</span>
          {#if op.oneOff} · ponctuelle{/if}
          {#if op.plannedFlowId} · {flowName(op.plannedFlowId)}{/if}
          {#if op.transferAccountId} · → {accountName(op.transferAccountId)}{/if}
          {#if allocs.length} · {allocs.map((a) => [categoryName(a.categoryId), tirelireName(a.tirelireId)].filter(Boolean).join(' / ')).join(' + ')}{/if}
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
              <label class="f">Tirelire
                <select bind:value={l.tirelireId}>
                  <option value="">— (non affecté)</option>
                  {#each tirelires as e}<option value={e.id}>{e.name}</option>{/each}
                </select>
              </label>
              {#if l.tirelireId}
                <label class="f">Renflouement
                  <select bind:value={l.replenishment}>
                    <option value="">Non (mouvement normal)</option>
                    <option value="internal">Repris ailleurs chez nous</option>
                    <option value="external">Venu du dehors (cadeau, remboursement)</option>
                  </select>
                </label>
              {/if}
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
          <label class="f check"><input type="checkbox" bind:checked={makeRule} /> Créer un automatisme pour les prochaines opérations semblables</label>
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
    <div class="muted">
      {#if totalOps === 0}
        Aucune opération connue : importe un relevé depuis l'écran Import, ou saisis-en une depuis Saisie manuelle.
      {:else}
        Rien à afficher{filter === 'untreated' ? ' : tout est traité.' : '.'}
        {#if matching.length === 0}
          <span class="sub">Le dépôt contient {totalOps} opération(s) : élargis la recherche ou passe le filtre d'affichage sur « Toutes ».</span>
        {/if}
      {/if}
    </div>
  {/each}
  {#if matching.length > operations.length}
    <div class="row">
      <div class="label sub">{operations.length} affichée(s) sur {matching.length}</div>
      <button class="btn small" onclick={() => (shown += PAGE)}>Afficher {Math.min(PAGE, matching.length - operations.length)} de plus</button>
    </div>
  {/if}
</div>
