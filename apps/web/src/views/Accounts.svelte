<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, moneyClass, shortDate, centsToInput, inputToCents, ACCOUNT_KINDS } from '../lib/format';
  import { accountBalance, indexLedger, settlementBalance, unallocated, alive, type Account, type AccountKind, type SettlementDirection } from '@tirelire/core';

  let editing = $state<Account | undefined>(undefined);
  let form = $state({
    name: '',
    kind: 'epargne' as AccountKind,
    bank: '',
    accountNumber: '',
    openingBalance: '',
    openingDate: app.asOf,
    tracksSettlement: false,
    settlementThreshold: '10,00',
    settlementDirection: 'both' as SettlementDirection,
  });
  let error = $state('');

  const accounts = $derived(alive(app.ledger.accounts));
  const idx = $derived(indexLedger(app.ledger));
  const hasPivot = $derived(accounts.some((a) => a.kind === 'principal'));

  function startNew() {
    editing = { id: app.newId(), name: '', kind: hasPivot ? 'epargne' : 'principal', openingBalance: 0, openingDate: app.asOf };
    form = { name: '', kind: editing.kind, bank: '', accountNumber: '', openingBalance: '0,00', openingDate: app.asOf, tracksSettlement: false, settlementThreshold: '10,00', settlementDirection: 'both' };
    error = '';
  }

  function startEdit(a: Account) {
    editing = a;
    form = {
      name: a.name,
      kind: a.kind,
      bank: a.bank ?? '',
      accountNumber: a.accountNumber ?? '',
      openingBalance: centsToInput(a.openingBalance),
      openingDate: a.openingDate,
      tracksSettlement: !!a.tracksSettlement,
      settlementThreshold: centsToInput(a.settlementThreshold ?? 1000),
      settlementDirection: a.settlementDirection ?? 'both',
    };
    error = '';
  }

  function save(e: Event) {
    e.preventDefault();
    if (!editing) return;
    const openingBalance = inputToCents(form.openingBalance);
    if (!form.name.trim()) return void (error = 'Le nom est obligatoire.');
    if (openingBalance === undefined) return void (error = 'Solde initial invalide.');
    if (form.kind === 'principal' && accounts.some((a) => a.kind === 'principal' && a.id !== editing!.id))
      return void (error = 'Il ne peut y avoir qu’un seul compte principal.');
    const row: Account = {
      id: editing.id,
      name: form.name.trim(),
      kind: form.kind,
      openingBalance,
      openingDate: form.openingDate,
      ...(form.bank.trim() ? { bank: form.bank.trim() } : {}),
      ...(form.accountNumber.trim() ? { accountNumber: form.accountNumber.trim() } : {}),
      ...(form.tracksSettlement
        ? {
            tracksSettlement: true,
            settlementThreshold: inputToCents(form.settlementThreshold) ?? 0,
            settlementDirection: form.settlementDirection,
          }
        : {}),
    };
    app.upsert('accounts', row);
    editing = undefined;
  }

  function remove(a: Account) {
    if (confirm(`Supprimer le compte « ${a.name} » ?`)) app.remove('accounts', a.id);
  }
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.back() || app.switchTab('more'); }}>‹ Configuration</a></p>
<h1>Comptes</h1>
<p class="muted small">Le compte principal est le compte réel par lequel tout transite. Les comptes d'accueil hébergent des tirelires ; les comptes tiers ne sont pas importés, on y saisit à la main ce qui concerne le plan.</p>

<div class="actions">
  <button class="btn primary" onclick={startNew}>Ajouter un compte</button>
</div>

{#if editing}
  <form class="edit" onsubmit={save}>
    <div class="grid">
      <label class="f">Nom <input bind:value={form.name} placeholder="Compte courant" /></label>
      <label class="f">Type
        <select bind:value={form.kind}>
          {#each Object.entries(ACCOUNT_KINDS) as [k, label]}<option value={k}>{label}</option>{/each}
        </select>
      </label>
      <label class="f">Banque (facultatif) <input bind:value={form.bank} /></label>
      <label class="f">Numéro de compte ou IBAN (facultatif) <input bind:value={form.accountNumber} placeholder="FR76 1234 5678 90…" /></label>
      <label class="f">Solde initial <input bind:value={form.openingBalance} inputmode="decimal" /></label>
      <label class="f">Date du solde initial <input type="date" bind:value={form.openingDate} /></label>
      {#if form.kind !== 'principal'}
        <label class="f check" style="grid-column:1/-1">
          <input type="checkbox" bind:checked={form.tracksSettlement} />
          Suivre un solde à régler avec le compte principal
        </label>
      {/if}
      {#if form.tracksSettlement}
        <label class="f">Seuil de règlement <input bind:value={form.settlementThreshold} inputmode="decimal" /></label>
        <label class="f">Sens autorisé
          <select bind:value={form.settlementDirection}>
            <option value="both">Dans les deux sens</option>
            <option value="toThird">Principal → ce compte seulement</option>
            <option value="fromThird">Ce compte → principal seulement</option>
          </select>
        </label>
      {/if}
    </div>
    {#if error}<div class="err">{error}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (editing = undefined)}>Annuler</button>
    </div>
  </form>
{/if}

{#each accounts as a (a.id)}
  <div class="card" class:accent={a.kind === 'principal'}>
    <div class="row">
      <div class="label">
        <strong>{a.name}</strong> <span class="pill">{a.kind === 'principal' ? 'principal' : a.kind === 'epargne' ? 'accueil' : 'tiers'}</span>
        <span class="sub">{a.bank ? a.bank + ' · ' : ''}solde initial {money(a.openingBalance)} au {shortDate(a.openingDate)}{a.accountNumber ? ` · n° ${a.accountNumber}` : ''}</span>
      </div>
      <div>
        <button class="btn small" onclick={() => startEdit(a)}>Modifier</button>
        <button class="btn small danger" onclick={() => remove(a)}>Supprimer</button>
      </div>
    </div>
    {#if a.kind === 'courant'}
      {@const owes = settlementBalance(a, app.ledger, idx, app.asOf)}
      <div class="row">
        <div class="label">{owes >= 0 ? 'Le compte principal lui doit' : 'Il doit au compte principal'}</div>
        <div class="num">{money(Math.abs(owes))}</div>
      </div>
    {:else}
      <div class="row"><div class="label">Solde reconstruit au {shortDate(app.asOf)}</div><div class="num">{money(accountBalance(a, app.ledger, app.asOf))}</div></div>
      <div class="row"><div class="label">Non affecté (solde − tirelires hébergées)</div><div class="{moneyClass(unallocated(a, app.ledger, idx, app.asOf))}">{money(unallocated(a, app.ledger, idx, app.asOf))}</div></div>
    {/if}
  </div>
{:else}
  <div class="empty">Aucun compte. Commence par le compte principal.</div>
{/each}
