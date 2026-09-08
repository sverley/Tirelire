<script lang="ts">
  import { app, type View } from '../lib/state.svelte';
  const items: Array<{ id: View; label: string; desc: string }> = [
    { id: 'accounts', label: 'Comptes', desc: 'Pivot, comptes d’accueil, comptes tiers' },
    { id: 'envelopes', label: 'Enveloppes', desc: 'Provisions, objectifs d’épargne, budgets' },
    { id: 'categories', label: 'Catégories', desc: 'Classement des dépenses et revenus' },
    { id: 'flows', label: 'Flux prévus', desc: 'Revenus, charges fixes, échéances' },
    { id: 'entries', label: 'Saisie manuelle', desc: 'Dépenses des comptes tiers, virements faits' },
    { id: 'sync', label: 'Synchronisation', desc: 'D’appareil à appareil, ou par un relais privé' },
    { id: 'settings', label: 'Réglages', desc: 'Année budgétaire, coussin, sauvegarde' },
  ];
</script>

<h1>Configuration</h1>

<div class="card accent">
  <div class="row">
    <div class="label">
      <strong>Assistant de configuration</strong>
      <span class="sub">Construire pas à pas : pivot, enveloppes, objectifs d'épargne, revenus, charges</span>
    </div>
    <button class="btn primary" onclick={() => app.go('wizard')}>Lancer</button>
  </div>
</div>

<p class="muted small">Ou modifie directement une partie :</p>
<div class="card" style="padding:0">
  {#each items as it (it.id)}
    <button class="row" style="width:100%;border:0;background:none;text-align:left;cursor:pointer;color:inherit;font:inherit;padding:12px 16px" onclick={() => app.go(it.id)}>
      <div class="label"><strong>{it.label}</strong><span class="sub">{it.desc}</span></div>
      <div class="muted">›</div>
    </button>
  {/each}
</div>
