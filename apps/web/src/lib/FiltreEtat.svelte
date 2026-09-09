<!--
  Filtre d'état des écrans de cartes (D55) : Comptes, Tirelires, Flux prévus.

  Un interrupteur par état, indépendants les uns des autres : on clique pour montrer ou masquer.
  Par défaut, ce qui vit et ce qui vient sont allumés, ce qui est fini est éteint — la lecture
  courante est celle du budget d'aujourd'hui, pas celle de son histoire.

  Le bouton d'un état masqué reste affiché, éteint, avec son compte : ce que le filtre cache se
  voit et se rallume d'un doigt. La barre n'apparaît que si elle sert à quelque chose — plusieurs
  états représentés, ou un état représenté qui est masqué. Sur un budget qui n'a rien de clos ni
  d'à venir, elle n'occupe aucune hauteur d'écran.
-->
<script lang="ts">
  import { STATE_LABELS } from './format';
  import { VALIDITY_STATES, type StateVisibility, type ValidityState } from '@tirelire/core';

  let {
    value = $bindable(),
    counts,
    quoi,
  }: { value: StateVisibility; counts: Record<ValidityState, number>; quoi: string } = $props();

  const présents = $derived(VALIDITY_STATES.filter((s) => counts[s] > 0));
  const utile = $derived(présents.length > 1 || présents.some((s) => !value[s]));
</script>

{#if utile}
  <div class="filtres" role="group" aria-label="Afficher ou masquer {quoi} par état">
    {#each présents as s (s)}
      <button
        class="filtre"
        class:actif={value[s]}
        aria-pressed={value[s]}
        onclick={() => (value = { ...value, [s]: !value[s] })}
      >
        {STATE_LABELS[s]} <span class="n">{counts[s]}</span>
      </button>
    {/each}
  </div>
{/if}
