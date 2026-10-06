<!--
  Importer un budget (JSON) (#367) : un fichier choisi sur l'appareil, ou le texte collé. Le budget
  accepté ouvre l'assistant sur son résumé, où rien n'est enregistré avant la validation ; refusé, il
  ne change rien et l'écran dit le premier problème. Le fichier est lu sur cet appareil et n'est
  envoyé nulle part (I7). Coller le texte est la voie sans capacité propre à une plateforme (C2).
-->
<script lang="ts">
  import { app } from '../lib/state.svelte';

  let texte = $state('');
  let refus = $state('');
  let lecture = $state(false);

  function importer(source: string) {
    const r = app.importerBudget(source);
    if (r.ok) {
      refus = '';
      app.go('wizard');
    } else {
      refus = r.message;
    }
  }

  async function choisirFichier(e: Event) {
    const input = e.target as HTMLInputElement;
    const fichier = input.files?.[0];
    if (!fichier) return;
    lecture = true;
    try {
      importer(await fichier.text());
    } catch {
      refus = 'Ce fichier ne se lit pas : choisissez un fichier texte, ou collez son texte ci-dessous.';
    } finally {
      lecture = false;
      input.value = '';
    }
  }
</script>

<h1>Importer un budget (JSON)</h1>

<p class="muted small">
  Un budget tenu ailleurs — comptes, tirelires et leurs besoins, flux prévus, catégories — se retrouve
  ici sans refaire l'assistant. Il arrive dans l'assistant, sur son résumé : vous le relisez, le
  corrigez si besoin, puis vous le validez. Il est lu sur cet appareil et n'est envoyé nulle part.
</p>

{#if app.assistantPrepare}
  <div class="card warn" role="status">
    <p style="margin:0">
      <strong>L'assistant a déjà préparé des changements que vous n'avez pas validés.</strong> Importer un
      budget les remplace : ils seront perdus. Rien d'enregistré dans votre budget n'est effacé.
    </p>
  </div>
{/if}

<div class="card">
  <label class="f">
    Un fichier de votre appareil
    <input type="file" accept=".json,application/json,text/plain" onchange={choisirFichier} />
  </label>
  {#if lecture}<p class="muted small">Lecture…</p>{/if}
</div>

<div class="card">
  <label class="f">
    Ou collez le texte du budget
    <textarea rows="8" bind:value={texte} spellcheck="false" autocapitalize="off" style="width:100%;padding:7px 8px;border:1px solid var(--line-strong);border-radius:6px;background:var(--surface);font-family:monospace;font-size:13px"></textarea>
  </label>
  <div class="actions" style="margin:6px 0 0">
    <button class="btn primary" disabled={!texte.trim()} onclick={() => importer(texte)}>Importer ce texte</button>
  </div>
</div>

{#if refus}
  <div class="card warn" role="alert">
    <p style="margin:0">{refus}</p>
    <p class="small" style="margin:6px 0 0">Rien n'a changé dans vos données, et l'assistant ne s'est pas ouvert.</p>
  </div>
{/if}
