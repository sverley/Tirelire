<script lang="ts">
  import { onMount } from 'svelte';
  import { app, type View } from './lib/state.svelte';
  import { isNative } from './lib/platform';
  import Plan from './views/Plan.svelte';
  import Accounts from './views/Accounts.svelte';
  import Envelopes from './views/Envelopes.svelte';
  import Categories from './views/Categories.svelte';
  import Flows from './views/Flows.svelte';
  import Entries from './views/Entries.svelte';
  import Settings from './views/Settings.svelte';
  import Operations from './views/Operations.svelte';
  import Import from './views/Import.svelte';
  import More from './views/More.svelte';
  import Review from './views/Review.svelte';
  import Wizard from './views/Wizard.svelte';
  import Sync from './views/Sync.svelte';

  const tabs: Array<{ id: View; label: string; ico: string; group: View[] }> = [
    { id: 'plan', label: 'Plan', ico: '▤', group: ['plan'] },
    { id: 'operations', label: 'Opérations', ico: '☰', group: ['operations'] },
    { id: 'import', label: 'Import', ico: '⇩', group: ['import'] },
    { id: 'review', label: 'Bilan', ico: '◔', group: ['review'] },
    { id: 'more', label: 'Plus', ico: '⋯', group: ['more', 'accounts', 'envelopes', 'categories', 'flows', 'entries', 'settings', 'sync', 'wizard'] },
  ];

  // Geste « retour » Android : revient à l'écran précédent au lieu de quitter l'appli
  // tant qu'il reste quelque chose dans la pile de navigation (voir `app.go`/`app.back`).
  onMount(() => {
    if (!isNative) return;
    let handle: { remove(): void } | undefined;
    import('@capacitor/app').then(({ App: CapacitorApp }) => {
      CapacitorApp.addListener('backButton', () => {
        if (!app.back()) CapacitorApp.exitApp();
      }).then((h) => (handle = h));
    });
    return () => handle?.remove();
  });
</script>

<header class="topbar">
  {#if app.history.length > 0}
    <button class="back" aria-label="Retour" onclick={() => app.back()}>‹</button>
  {/if}
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
  {:else if app.view === 'operations'}
    <Operations />
  {:else if app.view === 'import'}
    <Import />
  {:else if app.view === 'review'}
    <Review />
  {:else if app.view === 'more'}
    <More />
  {:else if app.view === 'wizard'}
    <Wizard />
  {:else if app.view === 'accounts'}
    <Accounts />
  {:else if app.view === 'envelopes'}
    <Envelopes />
  {:else if app.view === 'categories'}
    <Categories />
  {:else if app.view === 'flows'}
    <Flows />
  {:else if app.view === 'entries'}
    <Entries />
  {:else if app.view === 'sync'}
    <Sync />
  {:else}
    <Settings />
  {/if}
</main>

<nav class="tabbar">
  {#each tabs as t (t.id)}
    <button class:active={t.group.includes(app.view)} onclick={() => app.switchTab(t.id)} aria-label={t.label}>
      <span class="ico" aria-hidden="true">{t.ico}</span>{t.label}
    </button>
  {/each}
</nav>
