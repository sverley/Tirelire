<!--
  Le panneau de correction d'un ordre permanent (#394, point 4) : il nomme l'ordre (D59), porte son
  montant et ses parts. Ouvert sur une proposition (`suivre`), tant qu'aucune part n'est touchée, la
  ventilation montrée est celle que le plan propose pour le montant saisi ; dès qu'une part l'est,
  ou sur un ordre enregistré, les parts ne changent que par la main de l'utilisateur. « Enregistrer »
  rend exactement ce que montre le panneau ; les refus nomment ce qui ne va pas (D85). Écrit une
  fois (D94).

  Chaque part s'y lit sur une ligne, une fois (#408, point 2) ; une part s'ouvre à la demande pour se
  corriger, une à la fois, et reprend sa ligne en se refermant (point 3). Le panneau tient ainsi dans
  l'écran d'un téléphone à son ouverture, parts fermées (C9).
-->
<script lang="ts">
  import type { AllocationLine, Cents } from '@tirelire/core';
  import type { Snippet } from 'svelte';
  import { revealed } from './actions';
  import { centsToInput, inputToCents } from './format';
  import VentilationOrdre from './VentilationOrdre.svelte';
  import { allocationDeSaisie, enSaisie, validerCorrection, type Noms, type PartEnSaisie } from './ventilationOrdre';

  let {
    titre,
    montant: montantInitial,
    allocation,
    compte,
    noms,
    suivre,
    aide,
    onenregistrer,
    onannuler,
  }: {
    titre: string;
    montant: Cents;
    allocation: AllocationLine[] | undefined;
    compte: string;
    noms: Noms;
    /** Sur une proposition : la ventilation proposée pour un montant (#393, point 9). */
    suivre?: ((montant: Cents) => AllocationLine[]) | undefined;
    aide?: Snippet;
    onenregistrer: (montant: Cents, allocation: AllocationLine[]) => void;
    onannuler: () => void;
  } = $props();

  // Le panneau s'ouvre rempli, puis ne suit que la saisie : il ne relit pas ses données d'ouverture.
  // svelte-ignore state_referenced_locally
  let montant = $state(centsToInput(montantInitial));
  // svelte-ignore state_referenced_locally
  let parts = $state<PartEnSaisie[]>(enSaisie(allocation));
  // svelte-ignore state_referenced_locally
  let touchees = $state(!suivre);
  let erreur = $state('');
  /** La part ouverte pour être corrigée : une seule à la fois (#408, point 3). */
  let ouverte = $state<number | undefined>(undefined);

  // Tant qu'aucune part n'est touchée, la ventilation suit le montant saisi.
  $effect(() => {
    if (touchees || !suivre) return;
    const c = inputToCents(montant);
    if (c !== undefined && c > 0) parts = enSaisie(suivre(c));
  });

  function toucher() {
    touchees = true;
  }
  function ajouter() {
    toucher();
    parts = [...parts, { tirelireId: '', categoryId: '', forme: 'fixed', valeur: '' }];
    ouverte = parts.length - 1; // la nouvelle part s'ouvre, prête à être remplie (point 3)
  }
  function retirer(i: number) {
    toucher();
    parts = parts.filter((_, j) => j !== i);
    ouverte = undefined;
  }
  function ouvrir(i: number) {
    ouverte = i;
  }

  // Ce que montrerait l'enregistrement : la lecture se refait à chaque changement (point 1).
  const apercu = $derived.by(() => {
    const v = validerCorrection(montant, parts, noms);
    return v.ok ? v : undefined;
  });

  function enregistrer(e: Event) {
    e.preventDefault();
    const v = validerCorrection(montant, parts, noms);
    if (!v.ok) return void (erreur = v.message);
    erreur = '';
    onenregistrer(v.montant, v.allocation);
  }
</script>

<form class="edit attached panneau-ventilation" use:revealed onsubmit={enregistrer}>
  <p class="titre-panneau">{titre}</p>
  {@render aide?.()}
  <div class="grid">
    <label class="f">Montant de l’ordre permanent (€) <input bind:value={montant} inputmode="decimal" /></label>
  </div>
  <VentilationOrdre
    montant={inputToCents(montant) ?? 0}
    allocation={allocationDeSaisie(parts)}
    {compte}
    {noms}
    modifier={ouvrir}
    {ouverte}
    reste={!!apercu}
  >
    {#snippet edition(i)}
      {@const p = parts[i]!}
      <fieldset class="part-saisie" data-part={i} use:revealed>
        <legend>Part {i + 1}</legend>
        <div class="grid">
          <label class="f">Tirelire
            <select bind:value={p.tirelireId} onchange={toucher}>
              <option value="">—</option>
              {#each noms.tirelires as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
              <!-- La part d'une tirelire retirée garde sa tirelire tant qu'on n'en choisit pas une autre (#407, I10). -->
              {#each (noms.retirees ?? []).filter((t) => t.id === p.tirelireId) as t (t.id)}<option value={t.id}>{t.name} (retirée)</option>{/each}
            </select>
          </label>
          <label class="f">Catégorie
            <select bind:value={p.categoryId} onchange={toucher}>
              <option value="">—</option>
              {#each noms.categories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
            </select>
          </label>
          <label class="f">Forme
            <select bind:value={p.forme} onchange={toucher}>
              <option value="fixed">Part fixe (€)</option>
              <option value="percent">Pourcentage</option>
              <option value="variable">Le reste</option>
            </select>
          </label>
          {#if p.forme !== 'variable'}
            <label class="f">{p.forme === 'fixed' ? 'Montant (€)' : 'Pourcentage (%)'} <input bind:value={p.valeur} inputmode="decimal" oninput={toucher} /></label>
          {/if}
        </div>
        <div class="actions" style="margin:6px 0 0">
          <button class="btn small" type="button" onclick={() => (ouverte = undefined)}>Refermer</button>
          <button class="btn small danger" type="button" onclick={() => retirer(i)}>Retirer cette part</button>
        </div>
      </fieldset>
    {/snippet}
  </VentilationOrdre>
  <div class="actions" style="margin:0"><button class="btn small" type="button" onclick={ajouter}>Ajouter une part</button></div>
  {#if erreur}<div class="err" role="alert">{erreur}</div>{/if}
  <div class="actions" style="margin:0">
    <button class="btn primary" type="submit">Enregistrer</button>
    <button class="btn" type="button" onclick={onannuler}>Annuler</button>
  </div>
</form>

<style>
  .panneau-ventilation { gap: 6px; }
  .part-saisie { border: 1px solid var(--line, #ddd); border-radius: 8px; padding: 6px 8px; margin: 6px 0; min-width: 0; }
  .part-saisie select, .part-saisie input { max-width: 100%; }
  /* Deux champs par ligne, pour que la part ouverte ne passe pas l'écran d'un téléphone (C9). */
  .part-saisie .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
</style>
