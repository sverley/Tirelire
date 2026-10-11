<!--
  Le formulaire d'ajout d'une catégorie, avec ses aides (#214, #365) : le nom et la nature. Écrit une
  fois ; l'assistant le garde sous les lignes, l'écran Catégories l'ouvre sous le bouton de la nature
  choisie, intitulé (D59), avec en plus ses champs avancés (`avances`) et de quoi l'annuler.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { CategoryNature } from '@tirelire/core';
  import type { AideCategorie } from './aides';
  import { NATURES_DE_CATEGORIE, type ChampsAvances, type SectionCategories } from './sectionCategories.svelte';

  let {
    s,
    titre,
    avances,
    champsAvances,
    onnature,
    onajoute,
    onannule,
  }: {
    s: SectionCategories;
    titre?: string;
    /** Les champs avancés que l'endroit ajoute au formulaire (D59). */
    avances?: Snippet;
    /** Ce que ces champs portent, lu à l'ajout. */
    champsAvances?: () => ChampsAvances;
    onnature?: (n: CategoryNature) => void;
    onajoute?: () => void;
    onannule?: () => void;
  } = $props();

  /** La ligne de l'exemple d'où viennent les aides du formulaire (D43). */
  const aide: AideCategorie | undefined = $derived(s.aideDuFormulaire);
</script>

<form class="edit" onsubmit={(e) => { e.preventDefault(); if (s.ajouter(champsAvances?.())) onajoute?.(); }}>
  {#if titre}<p class="titre-panneau">{titre}</p>{/if}
  <div class="grid">
    <label class="f">Nom de la catégorie <input bind:value={s.saisie.name} placeholder={aide?.name} /></label>
    <label class="f">Nature
      <select value={s.natureSaisie} onchange={(e) => { s.saisie.nature = e.currentTarget.value as CategoryNature; onnature?.(s.saisie.nature); }}>
        {#each NATURES_DE_CATEGORIE as g}<option value={g.nature}>{g.libelle}</option>{/each}
      </select>
    </label>
    {@render avances?.()}
  </div>
  {#if s.saisieError}<div class="err">{s.saisieError}</div>{/if}
  <div class="actions" style="margin:0">
    <button class="btn primary" type="submit">Ajouter une catégorie</button>
    {#if onannule}<button class="btn" type="button" onclick={onannule}>Annuler</button>{/if}
  </div>
</form>
