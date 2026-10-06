<!--
  La section Comptes (#362) : les lignes des comptes corrigées sur place, ce qu'elles disent d'un
  compte tiers ou clos, le retrait d'un compte, les raccourcis de l'exemple (D46), le formulaire
  d'ajout et ses aides (#214), et le texte qui explique le concept. Écrite une fois ; l'endroit qui
  l'emploie donne la section (où elle écrit), les comptes à montrer, et ce qu'il garde en propre :
  son entête, ce qu'il ajoute à la ligne d'un compte (`suiteCompte`, dans la carte) ou après elle
  (`apresCompte`), et si le texte d'explication est affiché (l'assistant) ou replié (un écran).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { todayISO, type Account } from '@tirelire/core';
  import { ACCOUNT_KINDS, money, centsToInput, validityBadge, validityLabel } from './format';
  import { montantAide } from './aides';
  import { NATURES_DE_COMPTE, SENS_DE_REGLEMENT, type SectionComptes } from './sectionComptes.svelte';

  let {
    s,
    comptes,
    explicationRepliee = false,
    carte = false,
    retrait = true,
    enEdition,
    entete,
    suiteCompte,
    apresCompte,
    vide,
  }: {
    s: SectionComptes;
    /** Les comptes à montrer, le compte principal d'abord : tous, à défaut. */
    comptes?: Account[];
    explicationRepliee?: boolean;
    /** Chaque ligne dans sa carte, avec ce que l'endroit y ajoute. */
    carte?: boolean;
    /** Le « × » de la ligne : l'endroit qui garde son propre retrait le retire d'ici. */
    retrait?: boolean;
    /** Le compte dont l'endroit ouvre un panneau sous sa carte. */
    enEdition?: string | undefined;
    entete?: Snippet;
    suiteCompte?: Snippet<[Account]>;
    apresCompte?: Snippet<[Account]>;
    vide?: Snippet;
  } = $props();

  const lignes = $derived.by(() => {
    const tous = comptes ?? s.accounts;
    return [...tous.filter((a) => a.kind === 'principal'), ...tous.filter((a) => a.kind !== 'principal')];
  });
</script>

{#snippet texte()}
  Uniquement des comptes bancaires réels — ceux dont vous recevez un relevé. Le compte principal
  est celui par lequel tout transite ; les autres sont facultatifs.
{/snippet}

{#if explicationRepliee}
  <details class="explication muted small"><summary>Comment ça marche ?</summary><p>{@render texte()}</p></details>
{:else}
  <p class="muted small">
    {@render texte()}
  </p>
{/if}

{@render entete?.()}

<div class="tete tete-compte"><span>Nom du compte</span><span>Banque</span><span>Numéro ou IBAN</span><span class="d">Solde actuel</span><span>Type</span><span></span></div>

{#snippet ligne(a: Account)}
  {#if a.kind === 'principal'}
    <div class="ligne-compte principal">
      <input value={a.name} onchange={(e) => s.editAccount(a, 'name', e.currentTarget.value)} />
      <input value={a.bank ?? ''} placeholder="Banque" onchange={(e) => s.editAccount(a, 'bank', e.currentTarget.value)} />
      <input value={a.accountNumber ?? ''} placeholder="FR76 …" onchange={(e) => s.editAccount(a, 'accountNumber', e.currentTarget.value)} />
      <input class="mt" value={centsToInput(a.openingBalance)} inputmode="decimal" onchange={(e) => s.editAccountBalance(a, e.currentTarget.value)} />
      <span class="pill">principal</span>
      <span></span>
      <label class="coussin">
        <span class="muted small">Coussin : montant minimum à laisser en non affecté ; le plan avertit si la marge passe en dessous.</span>
        <input class="mt" value={centsToInput(s.coussin)} inputmode="decimal" aria-label="Coussin du compte principal" onchange={(e) => s.editCoussin(e.currentTarget.value)} />
      </label>
    </div>
  {:else}
    <div class="ligne-compte">
      <input value={a.name} placeholder="Nom du compte" onchange={(e) => s.editAccount(a, 'name', e.currentTarget.value)} />
      <input value={a.bank ?? ''} placeholder="Banque" onchange={(e) => s.editAccount(a, 'bank', e.currentTarget.value)} />
      <input value={a.accountNumber ?? ''} placeholder="FR76 …" onchange={(e) => s.editAccount(a, 'accountNumber', e.currentTarget.value)} />
      <input class="mt" value={centsToInput(a.openingBalance)} inputmode="decimal" onchange={(e) => s.editAccountBalance(a, e.currentTarget.value)} />
      <select value={a.kind} onchange={(e) => s.editAccountKind(a, e.currentTarget.value)}>
        {#each NATURES_DE_COMPTE as k}<option value={k}>{ACCOUNT_KINDS[k]}</option>{/each}
      </select>
      {#if retrait}<button class="btn small danger" title="Retirer ce compte" onclick={() => s.retirer(a)}>×</button>{:else}<span></span>{/if}
      <!-- Ce que la section dit du compte : tiers (suivi d'un solde à régler) ou clos. Ces réglages se modifient dans le panneau de l'écran Comptes (I11, D59). -->
      {#if s.estTiers(a) || validityBadge(a, s.asOf)}
        <p class="muted small suite">
          {#if s.estTiers(a)}
            <span class="pill">tiers</span> Solde à régler avec le compte principal{a.settlementThreshold ? ` dès ${money(a.settlementThreshold)}` : ''}, {SENS_DE_REGLEMENT[a.settlementDirection ?? 'both']}.
          {/if}
          {#if validityBadge(a, s.asOf)}
            <span class="pill dim">{validityBadge(a, s.asOf)}</span> {validityLabel(a)}
          {/if}
        </p>
      {/if}
    </div>
  {/if}
{/snippet}

{#each lignes as a (a.id)}
  {#if carte}
    <div class="card" class:accent={a.kind === 'principal'} class:editing={enEdition === a.id} class:dormant={!!validityBadge(a, s.asOf)}>
      {@render ligne(a)}
      {@render suiteCompte?.(a)}
    </div>
    {@render apresCompte?.(a)}
  {:else}
    {@render ligne(a)}
  {/if}
{:else}
  {@render vide?.()}
{/each}
{#if s.ligneError}<div class="err">{s.ligneError}</div>{/if}

{#if s.restantes.length}
  <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
  <div class="propositions">
    {#each s.restantes as p (p.name)}
      <button class="prop" onclick={() => s.appliquer(p)}>
        <span class="n">+ {p.name}</span><span class="v num">{money(p.balance)}</span>
      </button>
    {/each}
  </div>
{/if}
<form class="edit" onsubmit={(e) => { e.preventDefault(); s.ajouter(todayISO()); }}>
  <div class="grid">
    <label class="f">Nom du compte <input bind:value={s.saisie.name} placeholder={s.aide?.name} /></label>
    <label class="f">Type
      <select value={s.typeSaisi} onchange={(e) => (s.saisie.kind = e.currentTarget.value as (typeof NATURES_DE_COMPTE)[number])}>
        {#each NATURES_DE_COMPTE as k}<option value={k}>{ACCOUNT_KINDS[k]}</option>{/each}
      </select>
    </label>
    <label class="f">Solde actuel <input bind:value={s.saisie.balance} inputmode="decimal" placeholder={s.aide ? montantAide(s.aide.balance) : undefined} /></label>
  </div>
  {#if s.saisieError}<div class="err">{s.saisieError}</div>{/if}
  <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter un compte</button></div>
</form>
