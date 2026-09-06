<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { centsToInput, inputToCents } from '../lib/format';
  import { budgetYearContaining, MONTHS_FR } from '@tirelire/core';
  import { saveFile } from '../lib/platform';

  let month = $state(String(app.ledger.settings.budgetYearStart.month));
  let day = $state(String(app.ledger.settings.budgetYearStart.day));
  let cushion = $state(centsToInput(app.ledger.settings.pivotCushion));
  let msg = $state('');

  $effect(() => {
    month = String(app.ledger.settings.budgetYearStart.month);
    day = String(app.ledger.settings.budgetYearStart.day);
    cushion = centsToInput(app.ledger.settings.pivotCushion);
  });

  const year = $derived(budgetYearContaining(app.asOf, app.ledger.settings.budgetYearStart.month, app.ledger.settings.budgetYearStart.day));

  function saveYear() {
    app.setSetting('budgetYearStart', { month: Math.min(12, Math.max(1, Number(month) || 1)), day: Math.min(31, Math.max(1, Number(day) || 1)) });
    msg = 'Année budgétaire enregistrée.';
  }
  function saveCushion() {
    const c = inputToCents(cushion);
    if (c === undefined) return void (msg = 'Montant invalide.');
    app.setSetting('pivotCushion', c);
    msg = 'Coussin enregistré.';
  }

  async function exportFile() {
    const bytes = await app.exportBytes();
    await saveFile(`tirelire-${app.asOf}.sqlite`, bytes, 'application/x-sqlite3');
  }

  async function importFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!confirm('Remplacer toutes les données par ce fichier ?')) return void (input.value = '');
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await app.importFile(bytes);
      msg = 'Fichier importé.';
    } catch (err) {
      msg = `Import impossible : ${err instanceof Error ? err.message : String(err)}`;
    }
    input.value = '';
  }

  async function erase() {
    if (!confirm('Effacer toutes les données de cet appareil ? (pense à exporter avant)')) return;
    await app.eraseAll();
    msg = 'Données effacées.';
  }

  async function loadExample() {
    if (app.ledger.accounts.length && !confirm("Remplacer les données courantes par l'exemple ?")) return;
    await app.loadExample();
    app.view = 'plan';
  }
</script>

<h1>Réglages</h1>

<h2>Année budgétaire</h2>
<div class="card">
  <p class="small muted">L'année budgétaire commence à une date de ton choix ; les budgets annuels et les bilans la suivent. Actuellement : du {year.start} au {year.end} ({year.label}).</p>
  <div class="grid" style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end">
    <label class="f">Mois
      <select bind:value={month}>
        {#each MONTHS_FR as m, i}<option value={String(i + 1)}>{m}</option>{/each}
      </select>
    </label>
    <label class="f">Jour <input type="number" min="1" max="31" bind:value={day} /></label>
    <button class="btn" onclick={saveYear}>Enregistrer</button>
  </div>
</div>

<h2>Coussin du pivot</h2>
<div class="card">
  <p class="small muted">Montant minimum à laisser en non affecté sur le pivot ; le plan avertit si la marge passe en dessous.</p>
  <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end">
    <label class="f">Coussin <input bind:value={cushion} inputmode="decimal" /></label>
    <button class="btn" onclick={saveCushion}>Enregistrer</button>
  </div>
</div>

<h2>Données</h2>
<div class="card">
  <p class="small muted">Tout est stocké dans ce navigateur, dans un fichier SQLite. Exporte-le régulièrement : c'est ta sauvegarde, et le moyen de passer d'un appareil à l'autre en attendant la synchronisation.</p>
  <div class="actions">
    <button class="btn primary" onclick={exportFile}>Exporter le fichier SQLite</button>
    <label class="btn">Importer un fichier… <input type="file" accept=".sqlite,.db,application/x-sqlite3" onchange={importFile} hidden /></label>
    <button class="btn" onclick={loadExample}>Charger l'exemple</button>
    <button class="btn danger" onclick={erase}>Tout effacer</button>
  </div>
  <p class="small muted">Appareil : <span class="num">{app.ledger.settings.siteId}</span> · changements journalisés : <span class="num">{app.ready ? app.store.lastSeq : 0}</span></p>
</div>

{#if msg}<p class="small">{msg}</p>{/if}
