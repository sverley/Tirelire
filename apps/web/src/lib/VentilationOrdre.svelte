<!--
  La ventilation d'un ordre permanent, lue (#394, point 1) : une ligne par part — ce qu'elle nomme,
  sa forme, son montant pour le montant de l'ordre —, puis ce que les parts n'absorbent pas, non
  affecté sur le compte d'accueil (D21). Écrite une fois, pour l'écran Plan et l'assistant (D94).
  `ecarts` marque les parts fixes dont l'écart se signale, avec ce que le budget demande (point 6).
-->
<script lang="ts">
  import type { AllocationLine, Cents, Id } from '@tirelire/core';
  import { money } from './format';
  import { ligneNonAffecte, lireVentilation, type Noms } from './ventilationOrdre';

  let {
    montant,
    allocation,
    compte,
    noms,
    ecarts = new Map(),
  }: {
    montant: Cents;
    allocation: AllocationLine[] | undefined;
    compte: string;
    noms: Noms;
    ecarts?: Map<Id, Cents>;
  } = $props();

  const lecture = $derived(lireVentilation(montant, allocation, noms));
  const reste = $derived(ligneNonAffecte(lecture.nonAffecte, compte));
</script>

<div class="ventilation">
  {#each lecture.lignes as l, i (i)}
    {@const demande = l.share.kind === 'fixed' && l.tirelireId ? ecarts.get(l.tirelireId) : undefined}
    <div class="row part" class:ecart={demande !== undefined}>
      <div class="label">{l.nom}<span class="sub">{l.forme}{#if demande !== undefined} · le budget demande {money(demande)} par mois{/if}</span></div>
      <div class="num {demande !== undefined ? 'neg' : ''}">{money(l.montant)}</div>
    </div>
  {/each}
  {#if reste}
    <div class="row part non-affecte">
      <div class="label">{reste.libelle}{#if reste.detail}<span class="sub neg">{reste.detail}</span>{/if}</div>
      <div class="num {lecture.nonAffecte < 0 ? 'neg' : ''}">{money(lecture.nonAffecte)}</div>
    </div>
  {/if}
</div>

<style>
  .ventilation { padding-left: 10px; border-left: 2px solid var(--line, #ddd); margin: 4px 0; }
  .ventilation .label { overflow-wrap: anywhere; min-width: 0; }
</style>
