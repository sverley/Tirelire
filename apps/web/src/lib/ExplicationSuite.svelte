<!-- Ce qui suit la mise en place d'un ordre permanent (#13, point 7) : affiché dans l'assistant, replié sur l'écran Plan (D94). -->
<script lang="ts">
  import { EXPLICATION_SUITE } from './consigneOrdre';
  let { repliee = false }: { repliee?: boolean } = $props();
</script>

{#if repliee}
  <details class="explication explication-suite muted small"><summary>Et une fois l’ordre posé ?</summary><p>{EXPLICATION_SUITE}</p></details>
{:else}
  <p class="muted small explication explication-suite">{EXPLICATION_SUITE}</p>
{/if}
