<script lang="ts">
  import { onMount } from 'svelte';
  import { app, type View } from './lib/state.svelte';
  import { shortDate } from './lib/format';
  import { isNative, saveFile } from './lib/platform';

  /**
   * Au-delà de cet écart entre la dernière opération connue et la date de lecture, l'application
   * prévient : le plan et les soldes reposent alors sur un historique qui s'arrête loin derrière.
   */
  const JOURS_AVANT_ALERTE = 15;
  import Plan from './views/Plan.svelte';
  import Accounts from './views/Accounts.svelte';
  import Tirelires from './views/Tirelires.svelte';
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
    { id: 'more', label: 'Plus', ico: '⋯', group: ['more', 'accounts', 'tirelires', 'categories', 'flows', 'entries', 'settings', 'sync', 'wizard'] },
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
  {#if app.refused}
    <div class="card warn" role="alert">
      <h2 style="margin-top:0">Ces données ne s'ouvrent pas ici</h2>
      <p>{app.refused.message}</p>
      <p class="small">Rien n'a été effacé. Enregistrez-les d'abord si vous voulez les garder, telles quelles, puis repartez d'un fichier neuf ou de l'exemple : c'est seulement à ce moment qu'elles seront remplacées.</p>
      <div class="actions" style="margin-bottom:0">
        <button class="btn" onclick={() => saveFile('tirelire-ancien-format.sqlite', app.refused!.bytes, 'application/x-sqlite3')}>Enregistrer ces données telles quelles</button>
        <button class="btn primary" onclick={() => app.startOver(false)}>Repartir d'un fichier neuf</button>
        <button class="btn" onclick={() => app.startOver(true)}>Repartir de l'exemple</button>
      </div>
    </div>
  {:else if app.error}
    <div class="card warn">Impossible d'ouvrir la base : {app.error}</div>
  {:else if !app.ready}
    <p class="muted">Ouverture de la base…</p>
  {:else}
    {#if app.staleDays > JOURS_AVANT_ALERTE && app.lastOperationDate}
      <div class="card warn">
        <div class="row">
          <div class="label">
            <strong>Dernière opération connue le {shortDate(app.lastOperationDate)}</strong>
            <span class="sub">
              Il y a {app.staleDays} jours. Les soldes et le plan au {shortDate(app.asOf)} supposent
              qu'il ne s'est rien passé depuis : importe un relevé, ou lis à cette date.
            </span>
          </div>
        </div>
        <div class="actions" style="margin:6px 0 0">
          <button class="btn small primary" onclick={() => app.switchTab('import')}>Importer un relevé</button>
          <button class="btn small" onclick={() => (app.asOf = app.lastOperationDate!)}>Lire au {shortDate(app.lastOperationDate)}</button>
        </div>
      </div>
    {/if}
    {#if app.conflicts.length && app.view !== 'sync'}
      <div class="card warn">
        <div class="row">
          <div class="label"><strong>{app.conflicts.length === 1 ? 'Une ligne modifiée' : `${app.conflicts.length} lignes modifiées`} des deux côtés à la synchronisation</strong><span class="sub">Une version a été retenue, l'autre écartée : voyez lesquelles.</span></div>
          <button class="btn small primary" onclick={() => app.go('sync')}>Voir</button>
        </div>
      </div>
    {/if}
    {#if !app.readingToday}
      <div class="card">
        <div class="row">
          <div class="label sub">Lecture au {shortDate(app.asOf)}, pas aujourd'hui : tous les écrans suivent cette date.</div>
          <button class="btn small" onclick={() => app.backToToday()}>Revenir à aujourd'hui</button>
        </div>
      </div>
    {/if}
    {#if app.view === 'plan'}
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
    {:else if app.view === 'tirelires'}
      <Tirelires />
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
  {/if}
</main>

<nav class="tabbar">
  {#each tabs as t (t.id)}
    <button class:active={t.group.includes(app.view)} onclick={() => app.switchTab(t.id)} aria-label={t.label}>
      <span class="ico" aria-hidden="true">{t.ico}</span>{t.label}
    </button>
  {/each}
</nav>
