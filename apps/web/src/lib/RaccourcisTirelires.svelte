<!--
  Les raccourcis de l'exemple (D46, #361, #369) : « Ajouter en un geste ». Un raccourci crée la tirelire
  avec ce que l'exemple en dit et disparaît dès qu'une tirelire du même nom existe.
-->
<script lang="ts">
  import { money } from './format';
  import { montantDeLaTirelire } from './aides';
  import type { GenreDeLaSection, SectionTirelires } from './sectionTirelires.svelte';

  let { s, genres }: { s: SectionTirelires; genres: GenreDeLaSection[] } = $props();
  const restants = $derived(genres.flatMap((g) => s.restantes(g)));
</script>

{#if restants.length}
  <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
  <div class="propositions">
    {#each restants as p (p.name)}
      <button class="prop" onclick={() => s.appliquer(p)}>
        <span class="n">+ {p.name}</span><span class="v num">{money(montantDeLaTirelire(p, s.asOf))}</span>
      </button>
    {/each}
  </div>
{/if}
