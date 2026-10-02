<script lang="ts">
  /*
   * Le manque d'une échéance et sa réponse (principe 1.4, D88, #184). L'application annonce le
   * montant qui manquera et sa date, à côté de ce que l'ordre permanent demande par période, et
   * propose de le lisser ; l'utilisateur accepte, modifie — montants et dates des parts — ou refuse,
   * sur place. Rien ne se lisse d'office. Une fois répondu, la proposition se tait ; le manque qui
   * resterait se dit toujours, et la réponse se retire d'un geste.
   */
  import { app } from './state.svelte';
  import { revealed } from './actions';
  import { money, shortDate, centsToInput, inputToCents } from './format';
  import type { DueDateShortfall, SmoothingPart } from '@tirelire/core';

  let { manque }: { manque: DueDateShortfall } = $props();

  type PartForm = { date: string; amount: string };
  let modifie = $state(false);
  let parts = $state<PartForm[]>([]);
  let erreur = $state('');
  /** Ce qu'annonce le panneau (D59) : figé à l'ouverture. */
  let titre = $state('');

  const total = (ps: SmoothingPart[]) => ps.reduce((s, p) => s + p.amount, 0);

  function accepter(ps: SmoothingPart[]) {
    const e = app.acceptSmoothing(manque.needId, manque.dueDate, ps);
    if (e) erreur = e;
    else modifie = false;
  }

  function ouvrirModification() {
    parts = (manque.proposal ?? []).map((p) => ({ date: p.date, amount: centsToInput(p.amount) }));
    titre = `Modifier le lissage — ${manque.name}, échéance du ${shortDate(manque.dueDate)}`;
    erreur = '';
    modifie = true;
  }

  function enregistrer(e: Event) {
    e.preventDefault();
    const lues: SmoothingPart[] = [];
    for (const p of parts) {
      const amount = inputToCents(p.amount);
      if (amount === undefined || amount <= 0) return void (erreur = 'Chaque part est un montant positif.');
      if (!p.date) return void (erreur = 'Chaque part porte une date.');
      lues.push({ date: p.date, amount });
    }
    accepter(lues);
  }
</script>

<div class="row">
  <div class="label">
    <strong>{manque.name}</strong>{#if manque.name !== manque.tirelireName}<span class="sub"> dans {manque.tirelireName}</span>{/if}
    <span class="sub">échéance du {shortDate(manque.dueDate)} · l’ordre permanent en demande <span class="num">{money(manque.cruise)}</span> par période</span>
    {#if manque.amount > 0}
      <span class="sub neg">Il manquera <span class="num">{money(manque.amount)}</span> le {shortDate(manque.dueDate)}, en plus des virements permanents.</span>
    {/if}
    {#if manque.answer?.kind === 'smoothing'}
      <span class="sub">Lissage décidé : {manque.answer.parts.map((p) => `${money(p.amount)} le ${shortDate(p.date)}`).join(', ')}</span>
    {:else if manque.answer?.kind === 'refusal'}
      <span class="sub">Lissage refusé.</span>
    {:else if manque.proposal}
      <span class="sub">Proposé : lisser {money(total(manque.proposal))} sur {manque.proposal.length === 1 ? 'la période en cours' : `${manque.proposal.length} périodes`} — {manque.proposal.map((p) => `${money(p.amount)} le ${shortDate(p.date)}`).join(', ')}.</span>
    {/if}
  </div>
  <div class="num {manque.amount > 0 ? 'neg' : ''}">{money(manque.amount)}</div>
</div>
<div class="actions" style="margin:0 0 6px">
  {#if manque.answer?.kind === 'smoothing'}
    <button class="btn small" onclick={() => app.withdrawAnswer(manque.answer!.answerId)}>Retirer le lissage</button>
  {:else if manque.answer?.kind === 'refusal'}
    <button class="btn small" onclick={() => app.withdrawAnswer(manque.answer!.answerId)}>Revenir sur le refus</button>
  {:else if manque.proposal && !modifie}
    <button class="btn small primary" onclick={() => accepter(manque.proposal!)}>Lisser</button>
    <button class="btn small" onclick={ouvrirModification}>Modifier</button>
    <button class="btn small" onclick={() => app.refuseSmoothing(manque.needId, manque.dueDate)}>Refuser</button>
  {/if}
</div>
{#if erreur && !modifie}<div class="err">{erreur}</div>{/if}
{#if modifie}
  {@render editeurLissage()}
{/if}

{#snippet editeurLissage()}
  <form class="edit attached" use:revealed onsubmit={enregistrer}>
    <p class="titre-panneau">{titre}</p>
    <p class="muted small" style="margin:0">Chaque part passe du non affecté à la tirelire, à sa date, au plus tard le {shortDate(manque.dueDate)}.</p>
    {#each parts as p, i (i)}
      <div class="grid">
        <label class="f">Date de la part {i + 1} <input type="date" bind:value={p.date} max={manque.dueDate} /></label>
        <label class="f">Montant (€) <input bind:value={p.amount} inputmode="decimal" /></label>
        <button class="btn small danger" type="button" onclick={() => (parts = parts.filter((_, j) => j !== i))} aria-label="Retirer la part {i + 1}">×</button>
      </div>
    {/each}
    <div class="actions" style="margin:0">
      <button class="btn small" type="button" onclick={() => (parts = [...parts, { date: parts.at(-1)?.date ?? manque.dueDate, amount: '' }])}>Ajouter une part</button>
    </div>
    {#if erreur}<div class="err">{erreur}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Lisser ainsi</button>
      <button class="btn" type="button" onclick={() => (modifie = false)}>Annuler</button>
    </div>
  </form>
{/snippet}
