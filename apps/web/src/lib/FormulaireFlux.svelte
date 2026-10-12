<!--
  Le formulaire d'ajout d'un revenu ou d'une charge fixe, avec ses aides (#214, #364) : « Quoi ? »,
  « Combien ? », le rythme, le jour, et le compte quand plus d'un compte est ouvert. Écrit une fois ;
  l'assistant le garde sous les lignes de l'étape, l'écran Flux prévus l'ouvre sous le bouton du
  genre, intitulé (D59), avec en plus ses champs avancés (`avances`) et de quoi l'annuler.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { PeriodUnit } from '@tirelire/core';
  import { UNITS } from './format';
  import type { AideFlux } from './aides';
  import type { GenreDeFlux, SectionRevenusCharges } from './sectionRevenusCharges.svelte';

  let {
    s,
    genre,
    titre,
    avances,
    onajoute,
    onannule,
  }: {
    s: SectionRevenusCharges;
    genre: GenreDeFlux;
    titre?: string;
    /** Les champs avancés que l'endroit ajoute au formulaire (D59) : ils s'écrivent avec le flux. */
    avances?: Snippet;
    onajoute?: () => void;
    onannule?: () => void;
  } = $props();

  /** La ligne de l'exemple d'où viennent les aides du formulaire (D43). */
  const aide: AideFlux | undefined = $derived(s.aide(genre));
  const ev = $derived(s.valeurs(genre));
</script>

<form class="edit" onsubmit={(e) => { e.preventDefault(); if (s.ajouter(genre, !!avances)) onajoute?.(); }}>
  {#if titre}<p class="titre-panneau">{titre}</p>{/if}
  <div class="grid">
    <label class="f">Quoi ? <input bind:value={s.saisies[genre].name} placeholder={aide?.name} /></label>
    <label class="f">Combien ? <input bind:value={s.saisies[genre].amount} inputmode="decimal" placeholder={s.aideDuMontant(genre)} /></label>
    <label class="f">Tous les <input type="number" min="1" value={ev.interval} oninput={(e) => (s.saisies[genre].interval = e.currentTarget.value)} /></label>
    <label class="f">Unité
      <select value={ev.unit} onchange={(e) => (s.saisies[genre].unit = e.currentTarget.value as PeriodUnit)}>
        {#each Object.entries(UNITS) as [u, l]}<option value={u}>{Number(ev.interval) > 1 ? l.pluriel : l.un}</option>{/each}
      </select>
    </label>
    <label class="f">Vers le (jour) <input type="number" min="1" max="31" value={ev.day} oninput={(e) => (s.saisies[genre].day = e.currentTarget.value)} /></label>
    {#if s.comptesOuverts.length > 1}
      <label class="f">Sur quel compte ?
        <select value={ev.accountId} onchange={(e) => (s.saisies[genre].accountId = e.currentTarget.value)}>
          {#each s.comptesOuverts as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
    {/if}
    {@render avances?.()}
  </div>
  {#if s.erreurs[genre]}<div class="err">{s.erreurs[genre]}</div>{/if}
  <div class="actions" style="margin:0">
    <button class="btn primary" type="submit">Ajouter</button>
    {#if onannule}<button class="btn" type="button" onclick={onannule}>Annuler</button>{/if}
  </div>
</form>
