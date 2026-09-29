<script lang="ts">
  import { onMount } from 'svelte';
  import { app, type View } from './lib/state.svelte';
  import { shortDate } from './lib/format';
  import { isNative, saveFile } from './lib/platform';
  import { BETA, texteSauvegarde, texteSynchronisation } from './lib/sauvegarde';
  import { miseAJour } from './lib/miseAJour.svelte';

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
  {#if miseAJour.prete && !miseAJour.masquee}
    <!-- Une version plus récente attend (#142) : l'utilisateur choisit quand recharger ; rien ne
         se recharge de soi-même. Le signal ne bloque aucun écran. -->
    <div class="card accent" role="status" aria-live="polite">
      <div class="row">
        <div class="label">
          <strong>Une nouvelle version de Tirelire est prête</strong>
          <span class="sub">
            Rechargez pour l'utiliser : vos données restent sur cet appareil. Sinon, elle s'ouvrira la
            prochaine fois que vous ouvrirez Tirelire.
          </span>
        </div>
      </div>
      <div class="actions" style="margin:6px 0 0">
        <button class="btn small primary" onclick={() => miseAJour.recharger(() => app.ecrireMaintenant())}>Recharger</button>
        <button class="btn small" onclick={() => (miseAJour.masquee = true)}>Plus tard</button>
      </div>
    </div>
  {/if}
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
              qu'il ne s'est rien passé depuis : importez un relevé, ou lisez à cette date.
            </span>
          </div>
        </div>
        <div class="actions" style="margin:6px 0 0">
          <button class="btn small primary" onclick={() => app.switchTab('import')}>Importer un relevé</button>
          <button class="btn small" onclick={() => (app.asOf = app.lastOperationDate!)}>Lire au {shortDate(app.lastOperationDate)}</button>
        </div>
      </div>
    {/if}
    {#if (app.effacable || app.rappelSauvegarde) && app.view === 'plan' && !app.signalDonneesMasque}
      <!-- Un seul signal sur la sûreté des données (#41) : ce que le navigateur peut effacer (C4,
           #42), la sauvegarde à faire et les deux dates (C5). Il ne bloque rien, et se masque
           pour cette ouverture. -->
      <div class="card warn" aria-live="polite">
        <div class="row">
          <div class="label">
            {#if app.effacable}
              <strong>Vos données peuvent être effacées par le navigateur</strong>
              <span class="sub">
                {app.persistance === 'impossible'
                  ? 'Ce navigateur ne permet pas de les mettre à l’abri'
                  : 'Votre navigateur n’a pas accepté de les mettre à l’abri'} : s'il manque de place, il
                peut les effacer sans prévenir. Une copie du fichier, enregistrée sur votre appareil, vous
                permet de tout retrouver.
              </span>
            {:else}
              <strong>Pensez à enregistrer une copie de vos données</strong>
              <span class="sub">
                {app.sauvegarde
                  ? 'Elles ont changé depuis votre dernière copie, qui date de plus d’une période budgétaire.'
                  : 'Vous n’en avez encore enregistré aucune copie.'} Elles ne vivent que sur vos
                appareils : si vous perdez celui-ci, une copie du fichier vous permet de tout retrouver.
              </span>
            {/if}
          </div>
        </div>
        <div class="small">Dernière sauvegarde : {texteSauvegarde(app.sauvegarde)}</div>
        <div class="small">Dernière synchronisation : {texteSynchronisation(app.synchronisation)}</div>
        {#if BETA}
          <p class="small" style="margin:6px 0 0">
            Version bêta : à la version suivante de Tirelire, un fichier d'aujourd'hui peut ne plus
            s'ouvrir. La copie que vous enregistrez garde vos données telles quelles.
          </p>
        {/if}
        <div class="actions" style="margin:6px 0 0">
          <button class="btn small primary" onclick={() => app.saveBackup()}>Enregistrer une copie</button>
          <button class="btn small" onclick={() => (app.signalDonneesMasque = true)}>Masquer</button>
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
