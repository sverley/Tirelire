<!--
  Ce qu'il faut pour poser un ordre chez la banque (#13, points 5, 6 et 8) : le libellé tel qu'il
  sera réellement, avec son geste « Copier », et le jour où la banque doit virer, avec l'écart de
  jours que la reconnaissance admet, lus sur l'ordre. Écrit une fois, pour le résumé de l'assistant
  et la carte d'un compte de l'écran Plan.
-->
<script lang="ts">
  import type { PlannedFlow } from '@tirelire/core';
  import { consigneDe } from './consigneOrdre';
  import LibelleACopier from './LibelleACopier.svelte';

  /** `libelleDejaDit` : le libellé est déjà montré, avec sa copie, par l'ordre enregistré dont celui-ci est l'évolution. */
  let { ordre, libelleDejaDit = false }: { ordre: PlannedFlow; libelleDejaDit?: boolean } = $props();

  const consigne = $derived(consigneDe(ordre));
</script>

<div class="consigne">
  {#if libelleDejaDit}
    <!-- Le même libellé que l'ordre enregistré : il ne change pas (domaine plan et flux, hypothèse 3). -->
  {:else if consigne.libelle !== undefined}
    <LibelleACopier libelle={consigne.libelle} />
  {:else}
    <p class="muted small" style="margin:0">Aucun libellé n’est enregistré avec cet ordre.</p>
  {/if}
  <p class="small jour">
    Jour du virement : <strong>{consigne.quand}</strong>. Choisissez ce jour chez votre banque : {consigne.reconnaissance}.
  </p>
</div>

<style>
  .consigne { margin: 6px 0; }
  .jour { margin: 4px 0 0; overflow-wrap: anywhere; }
</style>
