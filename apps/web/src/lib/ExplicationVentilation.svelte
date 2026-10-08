<!-- Le texte qui explique la ventilation d'un ordre (#394, point 7, D94) : affiché dans l'assistant, replié sur l'écran Plan. -->
<script lang="ts">
  import { EXPLICATION_VENTILATION } from './ventilationOrdre';
  let { repliee = false }: { repliee?: boolean } = $props();
</script>

{#if repliee}
  <details class="explication muted small"><summary>Comment se répartit un ordre ?</summary><p>{EXPLICATION_VENTILATION}</p></details>
{:else}
  <p class="muted small explication">{EXPLICATION_VENTILATION}</p>
{/if}
