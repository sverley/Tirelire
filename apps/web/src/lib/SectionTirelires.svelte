<!--
  La section Tirelires (#361) : les cartes des tirelires d'un genre de besoin, leurs lignes corrigées
  sur place, l'ajout d'un besoin, les raccourcis de l'exemple (D46), le formulaire d'ajout et ses
  aides (#214), et le texte qui explique le concept. Les cartes, les raccourcis et le formulaire sont
  des composants écrits une fois (#369), que l'écran Tirelires emploie aussi ; l'endroit qui emploie
  cette section donne la section (où elle écrit), le genre, les cartes à montrer (leur rangement) et
  si le texte d'explication est affiché (l'assistant) ou replié (un écran).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Need, Tirelire } from '@tirelire/core';
  import CarteTirelire from './CarteTirelire.svelte';
  import EnTeteDesBesoins from './EnTeteDesBesoins.svelte';
  import FormulaireTirelire from './FormulaireTirelire.svelte';
  import RaccourcisTirelires from './RaccourcisTirelires.svelte';
  import { EXPLICATION } from './explicationTirelires';
  import { GENRE_DU_BESOIN, type GenreDeLaSection, type SectionTirelires } from './sectionTirelires.svelte';

  let {
    s,
    genre,
    cartes,
    explicationRepliee = false,
  }: { s: SectionTirelires; genre: GenreDeLaSection; cartes: Array<{ t: Tirelire; besoins: Need[] }>; explicationRepliee?: boolean } = $props();

  const TITRES: Record<GenreDeLaSection, string> = { everyday: 'Budgets par période', periodic: 'Dépenses à échéance', savings: 'Objectifs d\'épargne' };
</script>

{#snippet texte()}
  {EXPLICATION[genre]}
{/snippet}
{#snippet explication(texte: Snippet)}
  {#if explicationRepliee}
    <details class="explication muted small"><summary>Comprendre</summary><p>{@render texte()}</p></details>
  {:else}
    <p class="muted small">
      {@render texte()}
    </p>
  {/if}
{/snippet}

{@render explication(texte)}
<h3>{TITRES[genre]}</h3>
<EnTeteDesBesoins kind={GENRE_DU_BESOIN[genre]} />
{#each cartes as { t, besoins } (t.id)}
  <CarteTirelire {s} {t} {besoins} reliquat={genre === 'everyday'} ajoutBesoin={genre === 'everyday'} />
{/each}
<RaccourcisTirelires {s} genres={[genre]} />
<FormulaireTirelire {s} {genre} />
