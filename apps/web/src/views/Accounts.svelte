<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { revealed } from '../lib/actions';
  import FiltreEtat from '../lib/FiltreEtat.svelte';
  import SectionComptes from '../lib/SectionComptes.svelte';
  import { SectionComptes as SectionDesComptes } from '../lib/sectionComptes.svelte';
  import { money, moneyClass, shortDate, centsToInput, inputToCents } from '../lib/format';
  import {
    accountBalance,
    budgetPeriodContaining,
    countStates,
    indexLedger,
    settlementBalance,
    stateShown,
    unallocated,
    alive,
    validityState,
    DEFAULT_MAIN_ACCOUNT,
    DEFAULT_VISIBILITY,
    MAIN_ACCOUNT_ID,
    type Account,
    type SettlementDirection,
    type StateVisibility,
  } from '@tirelire/core';

  /**
   * Les lignes des comptes, leur correction sur place, les raccourcis de l'exemple, le formulaire
   * d'ajout et l'explication sont la section Comptes (#362), la même que celle de l'assistant : elle
   * écrit ici dans le projet. L'écran garde ce qui lui est propre — le filtre d'état, les soldes
   * reconstruits, ce qui désigne encore un compte clos, le panneau des champs avancés et la
   * suppression confirmée.
   */
  const section = new SectionDesComptes({
    get ledger() {
      return app.ledger;
    },
    upsert: (key, row) => app.upsert(key, row),
    remove: (key, id) => app.remove(key, id),
    newId: () => app.newId(),
    get asOf() {
      return app.asOf;
    },
    periodStart: () => budgetPeriodContaining(app.asOf, app.ledger.settings.periodStartDay).start,
    mainAccountId: () => alive(app.ledger.accounts).find((a) => a.kind === 'principal')?.id ?? MAIN_ACCOUNT_ID,
    get coussin() {
      return app.ledger.settings.principalCushion;
    },
    setCoussin: (c) => app.setSetting('principalCushion', c),
  });

  let editing = $state<Account | undefined>(undefined);
  /** Ce qu'annonce le panneau : figé à l'ouverture, pour ne pas suivre la saisie en cours. */
  let titre = $state('');
  /** Les champs avancés : le nom, la banque, le numéro, le solde et le type se corrigent sur la ligne (D59). */
  let form = $state({
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
  /** Le compte principal existe dans toute base, unique (D40) : l'écran n'en crée pas, il le renseigne. */
  const isMain = (a: Account) => a.kind === 'principal';
  /**
   * Le compte principal tel qu'il naît avec la base : sa date d'ouverture dit « à renseigner »
   * (`DEFAULT_MAIN_ACCOUNT`). L'assistant comme ce panneau la renseignent avec le solde.
   */
  const aRenseigner = (a: Account) => isMain(a) && a.openingDate === DEFAULT_MAIN_ACCOUNT.openingDate;

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

  function startEdit(a: Account) {
    editing = a;
    form = {
      // Pas encore renseigné : le solde à saisir est celui du début de la période, comme dans l'assistant.
      openingDate: aRenseigner(a) ? budgetPeriodContaining(app.asOf, app.ledger.settings.periodStartDay).start : a.openingDate,
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
    if (form.activeFrom && form.activeTo && form.activeFrom > form.activeTo)
      return void (error = 'La clôture est avant l’ouverture.');
    // Le compte tel qu'il est maintenant : une correction faite sur la ligne, panneau ouvert, ne se perd pas.
    const courant = accounts.find((a) => a.id === editing?.id) ?? editing;
    const { activeFrom: _o, activeTo: _c, tracksSettlement: _t, settlementThreshold: _s, settlementDirection: _d, ...base } = courant;
    const row: Account = {
      ...base,
      openingDate: form.openingDate,
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
    try {
      app.upsert('accounts', row);
    } catch (err) {
      return void (error = err instanceof Error ? err.message : String(err));
    }
    editing = undefined;
  }

  function remove(a: Account) {
    if (isMain(a)) return;
    if (confirm(`Supprimer le compte « ${a.name} » ?`)) app.remove('accounts', a.id);
  }
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.back() || app.switchTab('more'); }}>‹ Configuration</a></p>
<h1>Comptes</h1>

{#snippet filtre()}
  <FiltreEtat bind:value={etatsVisibles} counts={états} quoi="les comptes" />
{/snippet}

{#snippet editeur()}
  <form class="edit attached" use:revealed onsubmit={save}>
    <p class="titre-panneau">{titre}</p>
    <div class="grid">
      <label class="f">Date du solde initial <input type="date" bind:value={form.openingDate} /></label>
      <p class="muted small" style="grid-column:1/-1;margin:0">
        Clore un compte ne le supprime pas : ses opérations restent, donc son passé dans les soldes
        et les bilans. Il quitte seulement les listes et les menus du jour.
      </p>
      <label class="f">Compte ouvert à partir du <input type="date" bind:value={form.activeFrom} /></label>
      <label class="f">Compte clos le <input type="date" bind:value={form.activeTo} /></label>
      {#if editing && !isMain(editing)}
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

{#snippet suiteCompte(a: Account)}
  {@const retenues = stillUsed(a)}
  <div class="row">
    <div class="label">
      {#if a.kind === 'epargne'}<span class="pill">accueil</span>{/if}
      <span class="sub">{aRenseigner(a) ? 'solde initial à renseigner' : `solde initial ${money(a.openingBalance)} au ${shortDate(a.openingDate)}`}</span>
      {#if retenues.length}<span class="sub">⚠ compte clos, encore désigné par : {retenues.join(', ')}</span>{/if}
    </div>
    <div class="actions" style="margin:0">
      <button class="btn small" onclick={() => startEdit(a)}>Modifier</button>
      {#if !isMain(a)}<button class="btn small danger" onclick={() => remove(a)}>Supprimer</button>{/if}
    </div>
  </div>
  {#if section.estTiers(a)}
    {@const owes = settlementBalance(a, app.ledger, idx, app.asOf)}
    <div class="row">
      <div class="label">{owes >= 0 ? 'Le compte principal lui doit' : 'Il doit au compte principal'}</div>
      <div class="num">{money(Math.abs(owes))}</div>
    </div>
  {:else}
    <div class="row"><div class="label">Solde reconstruit au {shortDate(app.asOf)}</div><div class="num">{money(accountBalance(a, app.ledger, app.asOf))}</div></div>
    <div class="row"><div class="label">Non affecté (solde − tirelires hébergées)</div><div class="{moneyClass(unallocated(a, app.ledger, idx, app.asOf))}">{money(unallocated(a, app.ledger, idx, app.asOf))}</div></div>
  {/if}
{/snippet}

{#snippet apresCompte(a: Account)}
  {#if editing?.id === a.id}
    {@render editeur()}
  {/if}
{/snippet}

{#snippet vide()}
  <div class="empty">
    {#if masqués > 0}Tout est masqué par le filtre : {masqués} compte(s) rangé(s).{:else}Aucun compte.{/if}
  </div>
{/snippet}

<SectionComptes s={section} comptes={visibles} explicationRepliee carte retrait={false} enEdition={editing?.id} entete={filtre} {suiteCompte} {apresCompte} {vide} />
