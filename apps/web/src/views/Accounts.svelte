<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { revealed } from '../lib/actions';
  import FiltreEtat from '../lib/FiltreEtat.svelte';
  import { money, moneyClass, shortDate, centsToInput, inputToCents, validityBadge, validityLabel, ACCOUNT_KINDS } from '../lib/format';
  import {
    accountBalance,
    countStates,
    indexLedger,
    settlementBalance,
    stateShown,
    unallocated,
    alive,
    validityState,
    DEFAULT_VISIBILITY,
    type Account,
    type AccountKind,
    type SettlementDirection,
    type StateVisibility,
  } from '@tirelire/core';

  let editing = $state<Account | undefined>(undefined);
  /** Ce qu'annonce le panneau : figé à l'ouverture, pour ne pas suivre la saisie en cours. */
  let titre = $state('');
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
    activeFrom: '',
    activeTo: '',
  });
  let error = $state('');
  let etatsVisibles = $state<StateVisibility>({ ...DEFAULT_VISIBILITY });

  const accounts = $derived(alive(app.ledger.accounts));
  const idx = $derived(indexLedger(app.ledger));
  const hasPivot = $derived(accounts.some((a) => a.kind === 'principal'));

  // Un compte n'a pas de besoins : son état est celui de ses propres dates d'ouverture et de
  // clôture (D56).
  const états = $derived(countStates(accounts, (a) => validityState(a, app.asOf)));
  const visibles = $derived(accounts.filter((a) => stateShown(etatsVisibles, validityState(a, app.asOf))));
  const masqués = $derived(accounts.length - visibles.length);

  /**
   * Ce qui retient encore un compte clos : les tirelires qui veulent y dormir et les flux qui y
   * tombent. Clore n'efface rien, et la liste doit dire ce qui reste à débrancher — sans quoi le
   * plan continue de proposer des virements vers un compte qui n'existe plus.
   */
  function stillUsed(a: Account): string[] {
    if (validityState(a, app.asOf) !== 'closed') return [];
    const noms = [
      ...alive(app.ledger.tirelires).filter((e) => e.placement.some((p) => p.accountId === a.id)).map((e) => e.name),
      ...alive(app.ledger.plannedFlows)
        .filter((f) => f.accountId === a.id || f.counterpartAccountId === a.id)
        .map((f) => f.name),
    ];
    return [...new Set(noms)];
  }

  function startNew() {
    editing = { id: app.newId(), name: '', kind: hasPivot ? 'epargne' : 'principal', openingBalance: 0, openingDate: app.asOf };
    form = { name: '', kind: editing.kind, bank: '', accountNumber: '', openingBalance: '0,00', openingDate: app.asOf, tracksSettlement: false, settlementThreshold: '10,00', settlementDirection: 'both', activeFrom: '', activeTo: '' };
    titre = 'Ajouter un compte';
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
      activeFrom: a.activeFrom ?? '',
      activeTo: a.activeTo ?? '',
    };
    titre = `Modifier le compte — ${a.name}`;
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
    if (form.activeFrom && form.activeTo && form.activeFrom > form.activeTo)
      return void (error = 'La clôture est avant l’ouverture.');
    const row: Account = {
      id: editing.id,
      name: form.name.trim(),
      kind: form.kind,
      openingBalance,
      openingDate: form.openingDate,
      ...(form.bank.trim() ? { bank: form.bank.trim() } : {}),
      ...(form.accountNumber.trim() ? { accountNumber: form.accountNumber.trim() } : {}),
      ...(form.activeFrom ? { activeFrom: form.activeFrom } : {}),
      ...(form.activeTo ? { activeTo: form.activeTo } : {}),
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

<FiltreEtat bind:value={etatsVisibles} counts={états} quoi="les comptes" />

{#snippet editeur()}
  <form class="edit attached" use:revealed onsubmit={save}>
    <p class="titre-panneau">{titre}</p>
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
      <p class="muted small" style="grid-column:1/-1;margin:0">
        Clore un compte ne le supprime pas : ses opérations restent, donc son passé dans les soldes
        et les bilans. Il quitte seulement les listes et les menus du jour.
      </p>
      <label class="f">Compte ouvert à partir du <input type="date" bind:value={form.activeFrom} /></label>
      <label class="f">Compte clos le <input type="date" bind:value={form.activeTo} /></label>
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
{/snippet}

<!-- Un compte qu'on crée n'a pas encore de ligne : son formulaire suit le bouton qui l'ouvre. -->
{#if editing && !accounts.some((a) => a.id === editing?.id)}
  {@render editeur()}
{/if}

{#each visibles as a (a.id)}
  {@const badge = validityBadge(a, app.asOf)}
  {@const validite = validityLabel(a)}
  {@const retenues = stillUsed(a)}
  <div class="card" class:accent={a.kind === 'principal'} class:editing={editing?.id === a.id} class:dormant={!!badge}>
    <div class="row">
      <div class="label">
        <strong>{a.name}</strong> <span class="pill">{a.kind === 'principal' ? 'principal' : a.kind === 'epargne' ? 'accueil' : 'tiers'}</span>
        {#if badge}<span class="pill dim">{badge}</span>{/if}
        <span class="sub">{a.bank ? a.bank + ' · ' : ''}solde initial {money(a.openingBalance)} au {shortDate(a.openingDate)}{a.accountNumber ? ` · n° ${a.accountNumber}` : ''}</span>
        {#if validite}<span class="sub">{validite}</span>{/if}
        {#if retenues.length}<span class="sub">⚠ compte clos, encore désigné par : {retenues.join(', ')}</span>{/if}
      </div>
      <div class="actions" style="margin:0">
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
  {#if editing?.id === a.id}
    {@render editeur()}
  {/if}
{:else}
  <div class="empty">
    {#if masqués > 0}Tout est masqué par le filtre : {masqués} compte(s) rangé(s).{:else}Aucun compte. Commence par le compte principal.{/if}
  </div>
{/each}
