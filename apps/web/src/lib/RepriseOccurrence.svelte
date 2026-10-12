<!--
  Le choix d'une occurrence d'un flux à reprendre à la main (#445, points 2 à 5) : un flux parmi ceux
  qui s'offrent, du plus proche en montant au plus éloigné, puis l'une de ses occurrences offertes,
  chacune avec sa date, le montant de ce qui serait repris et l'écart avec le montant de l'opération ;
  une occurrence qu'une saisie corrige ou masque le dit, et c'est cette saisie qui serait reprise
  (D88). Le premier flux offert est choisi d'avance ; en choisir un autre montre ses occurrences.
  Choisir une occurrence fait la reprise : rien ne s'écrit avant (I10, point 9). Écrit une fois, pour
  l'opération ouverte et pour le panneau de sa ligne.
-->
<script lang="ts">
  import type { Id, ISODate, OfferedFlow } from '@tirelire/core';
  import { money, shortDate } from './format';

  let { offres, onreprendre }: { offres: OfferedFlow[]; onreprendre: (flowId: Id, date: ISODate) => void } = $props();

  let choisi = $state('');
  const offre = $derived(offres.find((o) => o.flow.id === choisi) ?? offres[0]);
</script>

{#if offre}
  <label class="f">Flux
    <select value={offre.flow.id} onchange={(e) => (choisi = (e.currentTarget as HTMLSelectElement).value)}>
      {#each offres as o (o.flow.id)}<option value={o.flow.id}>{o.flow.name} · {money(o.flow.amount)}</option>{/each}
    </select>
  </label>
  {#each offre.occurrences as occ (occ.date)}
    <div class="row occurrence-offerte">
      <div class="label">
        Occurrence du {shortDate(occ.date)}
        <span class="sub">
          {money(occ.amount)} · écart {occ.gap === 0 ? 'nul' : money(occ.gap)} · à {occ.days} j de l’opération
          {#if occ.entry} · {occ.entry.amount === 0 ? 'masquée' : 'corrigée'} par la saisie « {occ.entry.label} » du {shortDate(occ.entry.date)} : c’est elle qui sera reprise{/if}
        </span>
      </div>
      <button class="btn small" type="button" onclick={() => onreprendre(offre.flow.id, occ.date)}>Reprendre</button>
    </div>
  {/each}
{/if}
