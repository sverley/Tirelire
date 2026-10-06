<!--
  La carte d'une tirelire (#361, #369) : son nom, ce qui y est déjà mis de côté, son reliquat ; ses
  besoins, chacun avec les champs de son genre, corrigés sur place ; l'ajout d'un besoin ; le
  prélèvement attendu d'une échéance. Écrite une fois : l'assistant la montre par genre de besoin, l'écran
  Tirelires avec tous les besoins de la tirelire. Ce que l'écran y ajoute lui est donné en fragments
  (`enTete`, `parBesoin`, `apresBesoin`, `pied`) ; la carte ne sait pas où elle est.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { divideCents, monthsOf, todayISO, type Cents, type Need, type NeedKind, type Tirelire } from '@tirelire/core';
  import { money, centsToInput, validityBadge, validityLabel } from './format';
  import { montantAide } from './aides';
  import EnTeteDesBesoins from './EnTeteDesBesoins.svelte';
  import type { SectionTirelires } from './sectionTirelires.svelte';

  let {
    s,
    t,
    besoins,
    reliquat = false,
    ajoutBesoin = false,
    entetes = false,
    confirmer = false,
    editing = false,
    alerte = false,
    sansBesoin,
    enTete,
    parBesoin,
    apresBesoin,
    pied,
  }: {
    s: SectionTirelires;
    t: Tirelire;
    besoins: Need[];
    /** Montrer le choix de garder ce qui n'a pas été dépensé. */
    reliquat?: boolean;
    /** Montrer le formulaire d'ajout d'un besoin. */
    ajoutBesoin?: boolean;
    /** Chaque genre de besoin porte son en-tête de colonnes dans la carte (la carte mêle les genres). */
    entetes?: boolean;
    /** Demander confirmation avant de retirer une tirelire ou un besoin (un écran qui écrit dans le projet). */
    confirmer?: boolean;
    editing?: boolean;
    alerte?: boolean;
    /** Ce qu'on écrit quand la carte n'a aucun besoin à montrer. */
    sansBesoin?: string;
    enTete?: Snippet<[Tirelire]>;
    parBesoin?: Snippet<[Need]>;
    apresBesoin?: Snippet<[Need]>;
    pied?: Snippet<[Tirelire]>;
  } = $props();

  const perPeriod = (amount: Cents, months: number) => divideCents(amount, Math.max(1, months));
  const ORDRE: NeedKind[] = ['recurring', 'dueDate', 'goal', 'payout'];
  const groupes = $derived(ORDRE.map((kind) => ({ kind, lignes: besoins.filter((n) => n.kind === kind) })).filter((g) => g.lignes.length > 0));
  const avecEcheance = $derived(besoins.some((n) => n.kind === 'dueDate'));

  const retirerTirelire = () => {
    if (!confirmer || confirm(`Supprimer la tirelire « ${t.name} » et ses besoins ?`)) s.removeTirelire(t);
  };
  const retirerBesoin = (n: Need) => {
    if (!confirmer || confirm('Supprimer ce besoin ?')) s.removeNeed(n);
  };
</script>

{#snippet quoi(n: Need, seul: string)}
  <!-- Un besoin qui porte son nom le montre, modifiable : c'est un besoin de la tirelire (D28). -->
  {#if n.name !== undefined}
    <input class="besoin" value={n.name} aria-label="Nom du besoin" onchange={(e) => s.editNeedOwnName(n, e.currentTarget.value)} />
  {:else}
    <span class="quoi muted small">{seul}</span>
  {/if}
{/snippet}

{#snippet suiteBesoin(n: Need)}
  {#if besoins.length > 1}
    <button class="btn small danger" title="Retirer ce besoin" onclick={() => retirerBesoin(n)}>×</button>
  {:else}
    <span></span>
  {/if}
  {#if validityLabel(n)}
    <!-- Une ligne que l'exemple borne le dit, avec sa date : deux versions d'un besoin sont deux lignes (D51). -->
    <p class="muted small suite">
      {#if validityBadge(n, s.asOf)}<span class="pill dim">{validityBadge(n, s.asOf)}</span> {/if}{validityLabel(n)}
    </p>
  {/if}
  {#if parBesoin}<div class="suite par-besoin">{@render parBesoin(n)}</div>{/if}
{/snippet}

<div class="card tirelire" class:editing class:warn={alerte}>
  <!-- La tirelire : son nom, ce qui y est déjà mis de côté, son reliquat ; ses besoins suivent. -->
  <div class="ligne-tirelire">
    <input class="nom" value={t.name} aria-label="Nom de la tirelire" onchange={(e) => s.editTirelireName(t, e.currentTarget.value)} />
    <label class="deja small">Déjà de côté
      <input class="mt" value={centsToInput(t.openingBalance)} inputmode="decimal" onchange={(e) => s.editOpeningBalance(t, e.currentTarget.value)} />
    </label>
    {#if reliquat}
      <label class="garde small" title="Garder ce qui n'a pas été dépensé">
        <input type="checkbox" checked={t.rollover?.mode !== 'none'} onchange={(e) => s.editRollover(t, e.currentTarget.checked)} /> garder
      </label>
    {/if}
    <button class="btn small danger" title="Retirer cette tirelire" onclick={retirerTirelire}>×</button>
  </div>
  {#if enTete}{@render enTete(t)}{/if}
  {#each groupes as { kind, lignes } (kind)}
    {#if entetes}<EnTeteDesBesoins {kind} />{/if}
    {#each lignes as n (n.id)}
      {#if kind === 'recurring'}
        <div class="ligne ligne-courant">
          {@render quoi(n, 'Par période')}
          <input class="mt" value={centsToInput(n.amount ?? 0)} inputmode="decimal" aria-label="Par période" onchange={(e) => s.editNeedAmount(n, e.currentTarget.value)} />
          <span class="vide"></span>
          {@render suiteBesoin(n)}
        </div>
      {:else if kind === 'dueDate'}
        <div class="ligne ligne-echeance">
          {@render quoi(n, 'La facture')}
          <input class="mt" value={centsToInput(n.amount ?? 0)} inputmode="decimal" aria-label="Montant" onchange={(e) => s.editNeedAmount(n, e.currentTarget.value)} />
          <input class="date" type="date" value={n.periodicity?.anchorDate ?? todayISO()} aria-label="Prochaine échéance" onchange={(e) => s.editNeedDueDate(n, e.currentTarget.value)} />
          {@render suiteBesoin(n)}
          <p class="muted small suite">
            {money(perPeriod(n.amount ?? 0, n.periodicity ? monthsOf(n.periodicity) : 12))} à mettre de côté par mois.
          </p>
        </div>
      {:else if kind === 'goal'}
        <div class="ligne ligne-epargne">
          {@render quoi(n, 'Par période, et la cible')}
          <input class="mt" value={centsToInput(n.monthlyAmount ?? 0)} inputmode="decimal" aria-label="Par période" onchange={(e) => s.editNeedAmount(n, e.currentTarget.value)} />
          <input class="mt" value={n.amount ? centsToInput(n.amount) : ''} inputmode="decimal" placeholder="cible" aria-label="Cible" onchange={(e) => s.editNeedTarget(n, e.currentTarget.value)} />
          {@render suiteBesoin(n)}
        </div>
      {:else}
        <div class="ligne ligne-echeance">
          {@render quoi(n, 'La réserve')}
          <input class="mt" value={centsToInput(n.amount ?? 0)} inputmode="decimal" aria-label="Montant à reverser" onchange={(e) => s.editNeedAmount(n, e.currentTarget.value)} />
          <input class="date" type="date" value={n.periodicity?.anchorDate ?? todayISO()} aria-label="Depuis le" onchange={(e) => s.editNeedDueDate(n, e.currentTarget.value)} />
          {@render suiteBesoin(n)}
        </div>
      {/if}
      {#if apresBesoin}{@render apresBesoin(n)}{/if}
    {/each}
  {/each}
  {#if besoins.length === 0 && sansBesoin}
    <div class="sub" style="padding-left:8px">{sansBesoin}</div>
  {/if}
  {#if ajoutBesoin}
    <!-- Un besoin de plus sur cette tirelire (D28) : un nom et un montant par période. -->
    <form class="ajout-besoin" onsubmit={(e) => { e.preventDefault(); s.addNeedTo(t); }}>
      <input class="besoin-nom" aria-label="Nom du besoin à ajouter" value={s.saisieDuBesoin(t).name} placeholder={s.aideBesoinAjoute?.name} oninput={(e) => (s.ajoutBesoin[t.id] = { ...s.saisieDuBesoin(t), name: e.currentTarget.value })} />
      <input class="mt" aria-label="Montant par période du besoin à ajouter" inputmode="decimal" value={s.saisieDuBesoin(t).amount} placeholder={s.aideBesoinAjoute ? montantAide(s.aideBesoinAjoute.amount) : undefined} oninput={(e) => (s.ajoutBesoin[t.id] = { ...s.saisieDuBesoin(t), amount: e.currentTarget.value })} />
      <button class="btn small" type="submit">Ajouter un besoin</button>
      {#if s.saisieDuBesoin(t).error}<div class="err">{s.saisieDuBesoin(t).error}</div>{/if}
    </form>
  {/if}
  {#if avecEcheance}
    <!-- L'étape dit, pour chaque échéance, si un prélèvement y est attendu (D40). -->
    <label class="prelevement small">
      <input type="checkbox" checked={s.prelevementsDe(t).length > 0} onchange={(e) => s.editPrelevement(t, besoins.find((n) => n.kind === 'dueDate')!, e.currentTarget.checked)} />
      {#if s.prelevementsDe(t).length}
        Prélèvement attendu : {#each s.prelevementsDe(t) as f, i (f.id)}{i ? ', ' : ''}« {f.name} », {money(Math.abs(f.amount))} sur {s.nomDuCompte(f.accountId)}{/each}
      {:else}
        Aucun prélèvement attendu
      {/if}
    </label>
  {/if}
  {#if pied}{@render pied(t)}{/if}
</div>
