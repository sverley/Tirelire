<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { revealed } from '../lib/actions';
  import { money, shortDate, centsToInput, inputToCents, openAccounts } from '../lib/format';
  import { alive, normalizeLabel, findCategoryByName, type Allocation, type Category, type Operation } from '@tirelire/core';

  type Nature = 'expense' | 'income' | 'transfer';

  let showForm = $state(false);
  let editingId = $state<string | undefined>(undefined);
  let form = $state({
    accountId: '',
    date: app.asOf,
    label: '',
    nature: 'expense' as Nature,
    amount: '',
    categoryId: '',
    newCategory: '',
    tirelireId: '',
    transferAccountId: '',
  });
  let error = $state('');

  const accounts = $derived(alive(app.ledger.accounts));
  const tirelires = $derived(alive(app.ledger.tirelires));
  const categories = $derived(alive(app.ledger.categories).sort((a, b) => a.name.localeCompare(b.name, 'fr')));
  const operations = $derived(
    alive(app.ledger.operations)
      .filter((o) => o.origin === 'manual')
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
  );
  const allocByOp = $derived(new Map(alive(app.ledger.allocations).map((a) => [a.operationId, a])));
  const accountName = (id: string | undefined) => accounts.find((a) => a.id === id)?.name ?? '?';
  /** Une saisie neuve ne vise pas un compte clos (D56) ; celui déjà choisi reste offert. */
  const comptesSaisie = $derived(openAccounts(accounts, app.asOf, form.accountId));
  const comptesContrepartie = $derived(openAccounts(accounts, app.asOf, form.transferAccountId).filter((a) => a.id !== form.accountId));
  const tirelireName = (id: string | undefined) => tirelires.find((e) => e.id === id)?.name;
  const categoryName = (id: string | undefined) => categories.find((c) => c.id === id)?.name;

  function startNew() {
    const third = accounts.find((a) => a.tracksSettlement);
    form = { accountId: third?.id ?? accounts[0]?.id ?? '', date: app.asOf, label: '', nature: 'expense', amount: '', categoryId: '', newCategory: '', tirelireId: '', transferAccountId: '' };
    editingId = undefined;
    showForm = true;
    error = '';
  }

  function startEdit(op: Operation) {
    const al = allocByOp.get(op.id);
    form = {
      accountId: op.accountId,
      date: op.date,
      label: op.label,
      nature: op.transferAccountId ? 'transfer' : op.amount < 0 ? 'expense' : 'income',
      amount: centsToInput(Math.abs(op.amount)),
      categoryId: al?.categoryId ?? '',
      newCategory: '',
      tirelireId: al?.tirelireId ?? '',
      transferAccountId: op.transferAccountId ?? '',
    };
    editingId = op.id;
    showForm = true;
    error = '';
  }

  function onCategoryPick() {
    // Quand on choisit une catégorie liée à un budget, proposer la tirelire correspondante.
    const c = categories.find((x) => x.id === form.categoryId);
    if (c?.tirelireId && !form.tirelireId) form.tirelireId = c.tirelireId;
  }

  function save(e: Event) {
    e.preventDefault();
    const abs = inputToCents(form.amount);
    if (!form.accountId) return void (error = 'Choisis le compte.');
    if (!form.label.trim()) return void (error = 'Le libellé est obligatoire.');
    if (abs === undefined || abs <= 0) return void (error = 'Montant invalide (en positif).');
    if (form.nature === 'transfer' && !form.transferAccountId) return void (error = 'Choisis le compte de contrepartie.');

    let categoryId = form.categoryId;
    if (form.newCategory.trim()) {
      const nature = form.nature === 'income' ? 'income' : 'expense';
      const existing = findCategoryByName(categories, form.newCategory, nature);
      if (existing) {
        categoryId = existing.id;
      } else {
        const c: Category = { id: app.newId(), name: form.newCategory.trim(), nature };
        app.upsert('categories', c);
        categoryId = c.id;
      }
    }
    const id = editingId ?? app.newId();
    const amount = form.nature === 'income' ? abs : -abs;
    const op: Operation = {
      id,
      accountId: form.accountId,
      origin: 'manual',
      date: form.date,
      label: form.label.trim(),
      normalizedLabel: normalizeLabel(form.label),
      amount,
      // Une saisie manuelle est de la vérité : elle naît verrouillée (D22).
      state: 'locked',
      ...(form.nature === 'transfer' ? { transferAccountId: form.transferAccountId } : {}),
    };
    app.upsert('operations', op);
    const existing = allocByOp.get(id);
    const al: Allocation = {
      id: existing?.id ?? app.newId(),
      operationId: id,
      // Une ligne unique variable prend l'intégralité du montant (D27).
      share: { kind: 'variable' },
      ...(categoryId ? { categoryId } : {}),
      ...(form.tirelireId ? { tirelireId: form.tirelireId } : {}),
    };
    app.upsert('allocations', al);
    showForm = false;
    editingId = undefined;
  }

  function remove(op: Operation) {
    if (!confirm(`Supprimer « ${op.label} » ?`)) return;
    const al = allocByOp.get(op.id);
    if (al) app.remove('allocations', al.id);
    app.remove('operations', op.id);
  }
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.back() || app.switchTab('more'); }}>‹ Configuration</a></p>
<h1>Saisie</h1>
<p class="muted small">Dépenses et revenus non importables (comptes tiers, espèces), et virements internes faits depuis le compte principal. Une catégorie et une tirelire par opération ; la ventilation en plusieurs lignes arrivera avec l'import.</p>

<div class="actions">
  <button class="btn primary" onclick={startNew} disabled={accounts.length === 0}>Saisir une opération</button>
</div>

{#snippet editeur()}
  <form class="edit attached" use:revealed onsubmit={save}>
    <div class="grid">
      <label class="f">Compte
        <select bind:value={form.accountId}>
          {#each comptesSaisie as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
      <label class="f">Nature
        <select bind:value={form.nature}>
          <option value="expense">Dépense</option>
          <option value="income">Revenu</option>
          <option value="transfer">Virement vers un autre compte</option>
        </select>
      </label>
      <label class="f">Date <input type="date" bind:value={form.date} /></label>
      <label class="f">Libellé <input bind:value={form.label} placeholder="Dentiste" /></label>
      <label class="f">Montant <input bind:value={form.amount} inputmode="decimal" placeholder="80,00" /></label>
      {#if form.nature === 'transfer'}
        <label class="f">Vers le compte
          <select bind:value={form.transferAccountId}>
            <option value="">—</option>
            {#each comptesContrepartie as a}<option value={a.id}>{a.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="f">Catégorie
        <select bind:value={form.categoryId} onchange={onCategoryPick}>
          <option value="">—</option>
          {#each categories as c}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label class="f">ou nouvelle catégorie <input bind:value={form.newCategory} placeholder="Santé" /></label>
      <label class="f">Tirelire
        <select bind:value={form.tirelireId}>
          <option value="">— (non affecté)</option>
          {#each tirelires as e}<option value={e.id}>{e.name}</option>{/each}
        </select>
      </label>
    </div>
    {#if error}<div class="err">{error}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (showForm = false)}>Annuler</button>
    </div>
  </form>
{/snippet}

<!-- Une saisie neuve n'a pas encore de ligne : son formulaire suit le bouton qui l'ouvre. -->
{#if showForm && !editingId}
  {@render editeur()}
{/if}

<div class="card">
  {#each operations as op (op.id)}
    {@const al = allocByOp.get(op.id)}
    <div class="row" class:editing={showForm && editingId === op.id}>
      <div class="label">
        <strong>{op.label}</strong>
        <span class="sub">
          {shortDate(op.date)} · {accountName(op.accountId)}{op.transferAccountId ? ` → ${accountName(op.transferAccountId)}` : ''}
          {#if al?.categoryId || al?.tirelireId}
            · {[categoryName(al.categoryId), tirelireName(al.tirelireId) ? `tirelire ${tirelireName(al.tirelireId)}` : undefined].filter(Boolean).join(' · ')}
          {/if}
        </span>
      </div>
      <div class="num {op.amount < 0 ? '' : 'pos'}">{money(op.amount)}</div>
      <div class="actions" style="margin:0">
        <button class="btn small" onclick={() => startEdit(op)}>Modifier</button>
        <button class="btn small danger" onclick={() => remove(op)}>×</button>
      </div>
    </div>
    {#if showForm && editingId === op.id}
      {@render editeur()}
    {/if}
  {:else}
    <div class="muted">Aucune opération saisie.</div>
  {/each}
</div>
