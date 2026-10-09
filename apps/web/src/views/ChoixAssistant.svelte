<!--
  Un seul assistant à la fois (#363, point 7) : l'application ne tient qu'un brouillon. Quand un
  assistant — complet, ou ouvert sur une section — a des changements non validés et qu'on en demande
  un autre, rien ne les remplace sans accord : on reprend celui qui est en cours, ou on l'abandonne
  pour ouvrir celui qui est demandé. Abandonner perd ces changements et n'écrit rien dans le projet.
-->
<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { titreDeLAssistant } from '../lib/brouillon';

  const enCours = $derived(titreDeLAssistant(app.assistant?.section));
  const demande = $derived(titreDeLAssistant(app.assistantDemande));
</script>

<p class="small">
  <a href="#top" onclick={(e) => { e.preventDefault(); if (!app.back()) app.switchTab('more'); }}>‹ Retour</a>
</p>
<h1>Un assistant est déjà en cours</h1>

<div class="card warn" role="alert">
  <p style="margin-top:0">
    L’assistant « {enCours} » a des changements que vous n’avez pas validés. Ouvrir « {demande} » les
    remplace : ils seront perdus. Rien d’enregistré dans votre budget n’est effacé.
  </p>
  <div class="actions" style="margin-bottom:0">
    <button class="btn primary" onclick={() => app.reprendreAssistant()}>Reprendre « {enCours} »</button>
    <button class="btn" onclick={() => app.abandonnerAssistant()}>Abandonner et ouvrir « {demande} »</button>
  </div>
</div>
