<!--
  Le formulaire d'ajout d'une tirelire, avec ses aides (#214, #361, #369) : un formulaire par genre de
  besoin. Écrit une fois ; l'endroit qui l'emploie dit le genre, et s'il le titre (un écran l'ouvre
  comme un panneau, l'assistant le garde sous les cartes).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { divideCents, type Cents } from '@tirelire/core';
  import { money, inputToCents, openAccounts } from './format';
  import { montantAide } from './aides';
  import type { GenreDeLaSection, SectionTirelires } from './sectionTirelires.svelte';

  let {
    s,
    genre,
    titre,
    avant,
    onajoute,
    onannule,
  }: { s: SectionTirelires; genre: GenreDeLaSection; titre?: string; avant?: Snippet; onajoute?: () => void; onannule?: () => void } = $props();

  const comptesOuverts = $derived(openAccounts(s.accounts, s.asOf));
  const perPeriod = (amount: Cents, months: number) => divideCents(amount, Math.max(1, months));
  const perPreview = $derived.by(() => {
    const a = inputToCents(s.per.amount);
    return a === undefined || a <= 0 ? undefined : perPeriod(a, Number(s.evEcheance.months) || 1);
  });
  const savPreview = $derived.by(() => {
    const m = inputToCents(s.sav.monthly);
    const t = inputToCents(s.sav.target);
    if (m === undefined || m <= 0 || t === undefined || t <= 0) return undefined;
    return Math.ceil(t / m);
  });
  const ajouter = (fait: boolean) => {
    if (fait) onajoute?.();
  };
</script>

{#snippet entete()}
  {#if titre}<p class="titre-panneau">{titre}</p>{/if}
  {#if avant}{@render avant()}{/if}
{/snippet}

{#if genre === 'everyday'}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); ajouter(s.addEveryday()); }}>
    {@render entete()}
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={s.day.name} placeholder={s.aideBudget?.name} /></label>
      <label class="f">Combien par période ? <input bind:value={s.day.amount} inputmode="decimal" placeholder={s.aideBudget ? montantAide(s.aideBudget.amount) : undefined} /></label>
      <label class="f check"><input type="checkbox" checked={s.gardeBudget} onchange={(e) => (s.day.keep = e.currentTarget.checked)} /> Garder ce qui n'a pas été dépensé</label>
    </div>
    {#if s.dayError}<div class="err">{s.dayError}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Ajouter</button>
      {#if onannule}<button class="btn" type="button" onclick={onannule}>Annuler</button>{/if}
    </div>
  </form>
{:else if genre === 'periodic'}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); ajouter(s.addPeriodic()); }}>
    {@render entete()}
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={s.per.name} placeholder={s.aideEcheance?.name} /></label>
      <label class="f">Montant de la facture <input bind:value={s.per.amount} inputmode="decimal" placeholder={s.aideEcheance ? montantAide(s.aideEcheance.amount) : undefined} /></label>
      <label class="f">Elle revient tous les <input type="number" min="1" value={s.evEcheance.months} oninput={(e) => (s.per.months = e.currentTarget.value)} /> mois</label>
      <label class="f">Prochaine échéance <input type="date" value={s.evEcheance.dueDate} oninput={(e) => (s.per.dueDate = e.currentTarget.value)} /></label>
      {#if comptesOuverts.length > 1}
        <label class="f">Sur quel compte ?
          <select value={s.evEcheance.accountId} onchange={(e) => (s.per.accountId = e.currentTarget.value)}>
            {#each comptesOuverts as a}<option value={a.id}>{a.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="f check"><input type="checkbox" checked={s.evEcheance.withFlow} onchange={(e) => (s.per.withFlow = e.currentTarget.checked)} /> Attendre le prélèvement à cette date</label>
    </div>
    {#if perPreview !== undefined}
      <p class="small" style="margin:0">
        Soit <strong>{money(perPreview)}</strong> à mettre de côté par mois.
      </p>
    {/if}
    {#if s.perError}<div class="err">{s.perError}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Ajouter</button>
      {#if onannule}<button class="btn" type="button" onclick={onannule}>Annuler</button>{/if}
    </div>
  </form>
{:else}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); ajouter(s.addSavings()); }}>
    {@render entete()}
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={s.sav.name} placeholder={s.aideObjectif?.name} /></label>
      <label class="f">Combien par période ? <input bind:value={s.sav.monthly} inputmode="decimal" placeholder={s.aideObjectif ? montantAide(s.aideObjectif.monthly) : undefined} /></label>
      <label class="f">Cible (facultatif) <input bind:value={s.sav.target} inputmode="decimal" placeholder={s.aideObjectif?.target !== undefined ? montantAide(s.aideObjectif.target) : undefined} /></label>
    </div>
    {#if savPreview !== undefined}
      <p class="small" style="margin:0">Cible atteinte en <strong>{savPreview} périodes</strong>.</p>
    {/if}
    {#if s.savError}<div class="err">{s.savError}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Ajouter</button>
      {#if onannule}<button class="btn" type="button" onclick={onannule}>Annuler</button>{/if}
    </div>
  </form>
{/if}
