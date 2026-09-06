<script lang="ts">
  import { app, type View } from './lib/state.svelte';
  import Plan from './views/Plan.svelte';
  import Accounts from './views/Accounts.svelte';
  import Envelopes from './views/Envelopes.svelte';
  import Flows from './views/Flows.svelte';
  import Entries from './views/Entries.svelte';
  import Settings from './views/Settings.svelte';

  const tabs: Array<{ id: View; label: string; ico: string }> = [
    { id: 'plan', label: 'Plan', ico: '▤' },
    { id: 'accounts', label: 'Comptes', ico: '🏦' },
    { id: 'envelopes', label: 'Enveloppes', ico: '✉' },
    { id: 'flows', label: 'Flux', ico: '↻' },
    { id: 'entries', label: 'Saisie', ico: '✎' },
    { id: 'settings', label: 'Réglages', ico: '⚙' },
  ];
</script>

<header class="topbar">
  <div class="brand"><img src="/icon.svg" alt="" /> Tirelire</div>
  <div class="spacer"></div>
  <label class="small muted">
    au
    <input type="date" bind:value={app.asOf} />
  </label>
</header>

<main>
  {#if app.error}
    <div class="card warn">Impossible d'ouvrir la base : {app.error}</div>
  {:else if !app.ready}
    <p class="muted">Ouverture de la base…</p>
  {:else if app.view === 'plan'}
    <Plan />
  {:else if app.view === 'accounts'}
    <Accounts />
  {:else if app.view === 'envelopes'}
    <Envelopes />
  {:else if app.view === 'flows'}
    <Flows />
  {:else if app.view === 'entries'}
    <Entries />
  {:else}
    <Settings />
  {/if}
</main>

<nav class="tabbar">
  {#each tabs as t (t.id)}
    <button class:active={app.view === t.id} onclick={() => (app.view = t.id)} aria-label={t.label}>
      <span class="ico" aria-hidden="true">{t.ico}</span>{t.label}
    </button>
  {/each}
</nav>
