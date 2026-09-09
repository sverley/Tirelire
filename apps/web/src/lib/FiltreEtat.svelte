<!--
  Filtre d'état des écrans de cartes (D55) : Comptes, Tirelires, Flux prévus.

  Il ne s'affiche que s'il sert à quelque chose — c'est-à-dire dès que deux états au moins sont
  représentés. Sur un budget qui n'a rien de clos ni d'à venir, il n'y a rien à trier et la barre
  n'occupe pas la hauteur d'écran d'un téléphone.

  Chaque choix porte son compte, et un choix vide ne s'affiche pas : le filtre annonce ainsi ce
  qu'il cache, au lieu de laisser croire à un écran qui a perdu ses lignes.
-->
<script lang="ts">
  import { STATE_FILTER_LABELS } from './format';
  import { STATE_FILTERS, type StateFilter } from '@tirelire/core';

  let {
    value = $bindable(),
    counts,
    quoi,
  }: { value: StateFilter; counts: Record<StateFilter, number>; quoi: string } = $props();

  const états = $derived(STATE_FILTERS.filter((f) => f !== 'all' && counts[f] > 0));
  const utile = $derived(états.length > 1);
  const choix = $derived(STATE_FILTERS.filter((f) => f === 'all' || counts[f] > 0 || f === value));

  // Un filtre qui ne garde plus rien (le dernier besoin clos vient d'être supprimé) revient à tout
  // montrer de lui-même : mieux vaut un écran garni qu'un écran vide sans explication.
  $effect(() => {
    if (value !== 'all' && counts[value] === 0) value = 'all';
  });
</script>

{#if utile}
  <div class="filtres" role="group" aria-label="Filtrer {quoi} par état">
    {#each choix as f (f)}
      <button class="filtre" class:actif={value === f} aria-pressed={value === f} onclick={() => (value = f)}>
        {STATE_FILTER_LABELS[f]} <span class="n">{counts[f]}</span>
      </button>
    {/each}
  </div>
{/if}
