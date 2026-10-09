<!--
  La ventilation d'un ordre permanent, lue (#394, point 1) : une ligne par part — ce qu'elle nomme,
  sa forme, son montant pour le montant de l'ordre —, puis ce que les parts n'absorbent pas, non
  affecté sur le compte d'accueil (D21). Écrite une fois, pour l'écran Plan et l'assistant (D94).
  `ecarts` marque les parts fixes dont l'écart se signale, avec ce que le budget demande (point 6).
  La part d'une tirelire retirée se lit sous son nom, marquée comme retirée, quel que soit son genre
  (#407, points 5 et 8) : le budget ne lui demande plus rien.
  Le panneau de correction s'en sert pour dire ses parts, une fois chacune (#408, point 2) : `modifier`
  fait de chaque part une ligne qui l'ouvre, `edition` prend la place de la ligne de la part `ouverte`,
  et `reste` à faux retient le non affecté tant que les parts ne sont pas complètes.
-->
<script lang="ts">
  import type { AllocationLine, Cents, Id } from '@tirelire/core';
  import type { Snippet } from 'svelte';
  import { money } from './format';
  import { ligneNonAffecte, lireVentilation, type Noms } from './ventilationOrdre';

  let {
    montant,
    allocation,
    compte,
    noms,
    ecarts = new Map(),
    modifier,
    ouverte,
    edition,
    reste: direReste = true,
  }: {
    montant: Cents;
    allocation: AllocationLine[] | undefined;
    compte: string;
    noms: Noms;
    ecarts?: Map<Id, Cents>;
    /** Ouvre la part `i` pour la corriger (#408, point 3). */
    modifier?: ((i: number) => void) | undefined;
    /** La part dont `edition` tient la place de la ligne. */
    ouverte?: number | undefined;
    edition?: Snippet<[number]> | undefined;
    reste?: boolean;
  } = $props();

  const lecture = $derived(lireVentilation(montant, allocation, noms));
  const reste = $derived(direReste ? ligneNonAffecte(lecture.nonAffecte, compte) : undefined);
</script>

<div class="ventilation">
  {#each lecture.lignes as l, i (i)}
    {#if ouverte === i && edition}
      {@render edition(i)}
    {:else}
      {@const demande = !l.retiree && l.share.kind === 'fixed' && l.tirelireId ? ecarts.get(l.tirelireId) : undefined}
      {#snippet ligne()}
        <div class="label">{l.nom || `Part ${i + 1} : à compléter`}<span class="sub">{l.forme}{#if l.retiree} · tirelire retirée : le budget ne lui demande plus rien{:else if demande !== undefined} · le budget demande {money(demande)} par mois{/if}</span></div>
        <div class="num {demande !== undefined || l.retiree ? 'neg' : ''}">{money(l.montant)}</div>
      {/snippet}
      {#if modifier}
        <button class="row part modifiable" class:ecart={demande !== undefined || l.retiree} class:retiree={l.retiree} data-part={i} type="button" title="Modifier cette part" aria-label="Modifier la part {i + 1}{l.nom ? ` : ${l.nom}` : ''}" onclick={() => modifier(i)}>
          {@render ligne()}<span class="ouvre" aria-hidden="true">›</span>
        </button>
      {:else}
        <div class="row part" data-part={i} class:ecart={demande !== undefined || l.retiree} class:retiree={l.retiree}>{@render ligne()}</div>
      {/if}
    {/if}
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
  .ventilation .row .num { white-space: nowrap; }
  /* La ligne d'une part que le panneau ouvre : toute la ligne se presse (C9). */
  .ventilation button.row { display: flex; width: 100%; min-height: 44px; align-items: center; font: inherit; color: inherit; text-align: left; background: none; border: 0; border-bottom: 1px dashed var(--line); cursor: pointer; }
  .ventilation button.row:last-of-type { border-bottom: 0; }
  .ventilation .ouvre { flex: 0 0 auto; color: var(--muted); font-size: 22px; line-height: 1; }
</style>
