<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, shortDate } from '../lib/format';
  import {
    alive,
    decodeBytes,
    newProfileFromRows,
    parseCsv,
    parseRows,
    prepareImport,
    runPipeline,
    todayISO,
    addDays,
    type ImportCandidate,
    type ImportProfile,
    type ImportPreparation,
    type ParseResult,
    type PipelineReport,
  } from '@tirelire/core';

  type Step = 'file' | 'profile' | 'preview' | 'done';
  let step = $state<Step>('file');
  let fileName = $state('');
  let rows = $state<string[][]>([]);
  let profile = $state<ImportProfile | undefined>(undefined);
  let isNewProfile = $state(false);
  let parsed = $state<ParseResult | undefined>(undefined);
  let prep = $state<ImportPreparation | undefined>(undefined);
  let decisions = $state<Record<number, boolean>>({}); // ligne → importer malgré doublon probable
  let report = $state<(PipelineReport & { inserted: number }) | undefined>(undefined);
  let error = $state('');
  let busy = $state(false);

  const accounts = $derived(alive(app.ledger.accounts));
  const profiles = $derived(alive(app.ledger.importProfiles));
  const headers = $derived(profile ? (rows[profile.headerRow] ?? []).map((h) => h.trim()) : []);
  const accountKeys = $derived(parsed ? [...new Set(parsed.rows.map((r) => r.accountKey).filter((k): k is string => k !== undefined))] : []);

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    error = '';
    busy = true;
    try {
      fileName = file.name;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(bytes, { type: 'array', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]!]!;
        rows = (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][]).map((r) => r.map((c) => String(c ?? '')));
      } else {
        rows = parseCsv(decodeBytes(bytes));
      }
      if (rows.length < 2) throw new Error('Fichier vide ou illisible.');
      // Profil : celui dont les colonnes existent dans ce fichier, sinon un nouveau.
      const hdrGuess = newProfileFromRows(app.newId(), file.name.replace(/\.[^.]+$/, ''), rows);
      const hdrs = (rows[hdrGuess.headerRow] ?? []).map((h) => h.trim());
      const known = profiles.find((p) => [p.columns.date, p.columns.label].every((c) => hdrs.includes(c)));
      if (known) {
        profile = structuredClone($state.snapshot(known));
        isNewProfile = false;
      } else {
        profile = hdrGuess;
        isNewProfile = true;
      }
      reparse();
      step = 'profile';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      input.value = '';
    }
  }

  function reparse() {
    if (!profile) return;
    parsed = parseRows(rows, profile);
    for (const k of accountKeys) if (!(k in profile.accountMap)) profile.accountMap[k] = '';
  }

  function toPreview() {
    if (!profile || !parsed) return;
    error = '';
    // Retirer les comptes « ignorés » (valeur vide) : on les laisse non mappés, l'import les saute.
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(profile.accountMap)) if (v) cleaned[k] = v;
    const p = { ...profile, accountMap: cleaned };
    if (!p.columns.account && !p.accountId) return void (error = 'Choisis le compte cible.');
    prep = prepareImport(app.ledger, parsed.rows, p);
    decisions = {};
    for (const c of prep.candidates) if (c.probable) decisions[c.row.line] = (c.similarity ?? 0) < 0.5;
    step = 'preview';
  }

  function toImport(c: ImportCandidate): boolean {
    if (c.exact) return false;
    if (c.probable) return decisions[c.row.line] === true;
    return true;
  }

  function doImport() {
    if (!profile || !prep) return;
    busy = true;
    try {
      const ops = prep.candidates.filter(toImport).map((c) => c.operation);
      // Enregistrer le profil (avec la correspondance des comptes), puis les opérations, puis la chaîne automatique.
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(profile.accountMap)) if (v) cleaned[k] = v;
      app.upsert('importProfiles', { ...$state.snapshot(profile), accountMap: cleaned });
      for (const o of ops) app.store.upsert('operations', o);
      app.reload();
      const dates = ops.map((o) => o.date).sort();
      const from = dates[0] ?? todayISO();
      const to = addDays(dates[dates.length - 1] ?? todayISO(), 1);
      const r = runPipeline(app.ledger, from, to, (p) => app.applyPatchQuiet(p));
      report = { ...r, inserted: ops.length };
      step = 'done';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function reset() {
    step = 'file';
    rows = [];
    profile = undefined;
    parsed = undefined;
    prep = undefined;
    report = undefined;
    error = '';
  }

  const columnFields: Array<[keyof ImportProfile['columns'], string]> = [
    ['date', 'Date'],
    ['valueDate', 'Date de valeur (facultatif)'],
    ['label', 'Libellé'],
    ['fullLabel', 'Libellé complet (facultatif)'],
    ['amount', 'Montant signé'],
    ['debit', 'Débit (si séparé)'],
    ['credit', 'Crédit (si séparé)'],
    ['account', 'Compte (fichier multi-comptes)'],
    ['category', 'Catégorie (suggestion)'],
    ['subCategory', 'Sous-catégorie (suggestion)'],
  ];
</script>

<h1>Import d'un relevé</h1>

{#if step === 'file'}
  <p class="muted small">CSV ou Excel exporté de la banque ou de Linxo. Le fichier est lu sur cet appareil et n'est envoyé nulle part. Un profil (colonnes, formats, correspondance des comptes) est mémorisé par type de fichier.</p>
  {#if accounts.length === 0}
    <div class="empty">Crée d'abord ton compte pivot.</div>
  {:else}
    <label class="btn primary">Choisir un fichier… <input type="file" accept=".csv,.txt,.tsv,.xlsx,.xls,text/csv" onchange={onFile} hidden /></label>
    {#if busy}<p class="muted">Lecture…</p>{/if}
  {/if}
  {#if profiles.length}
    <h2>Profils enregistrés</h2>
    <div class="card">
      {#each profiles as p (p.id)}
        <div class="row">
          <div class="label">{p.name}<span class="sub">{p.source} · {Object.keys(p.accountMap).length} compte(s) mappé(s)</span></div>
          <button class="btn small danger" onclick={() => { if (confirm(`Supprimer le profil « ${p.name} » ?`)) app.remove('importProfiles', p.id); }}>×</button>
        </div>
      {/each}
    </div>
  {/if}
{/if}

{#if step === 'profile' && profile && parsed}
  <p class="muted small">{fileName} · {rows.length} lignes lues · profil {isNewProfile ? 'nouveau (détecté)' : 'existant'}.</p>
  <form class="edit" onsubmit={(e) => { e.preventDefault(); toPreview(); }}>
    <div class="grid">
      <label class="f">Nom du profil <input bind:value={profile.name} /></label>
      <label class="f">Source
        <select bind:value={profile.source}>
          <option value="bank">Banque</option>
          <option value="linxo">Linxo</option>
          <option value="other">Autre</option>
        </select>
      </label>
      <label class="f">Ligne d'en-tête (0 = première) <input type="number" min="0" bind:value={profile.headerRow} onchange={reparse} /></label>
      <label class="f">Format de date
        <select bind:value={profile.dateFormat} onchange={reparse}>
          <option value="DMY">JJ/MM/AAAA</option>
          <option value="MDY">MM/JJ/AAAA</option>
          <option value="YMD">AAAA-MM-JJ</option>
        </select>
      </label>
    </div>
    <h3>Colonnes</h3>
    <div class="grid">
      {#each columnFields as [key, label] (key)}
        <label class="f">{label}
          <select value={profile.columns[key] ?? ''} onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) profile!.columns[key] = v; else delete profile!.columns[key]; reparse(); }}>
            <option value="">—</option>
            {#each headers as h}<option value={h}>{h}</option>{/each}
          </select>
        </label>
      {/each}
      {#if profile.columns.debit || profile.columns.credit}
        <label class="f check"><input type="checkbox" bind:checked={profile.debitPositive} onchange={reparse} /> Le débit est écrit en positif</label>
      {/if}
    </div>
    <h3>Comptes</h3>
    {#if profile.columns.account}
      <p class="small muted">Valeurs trouvées dans la colonne compte ; laisse vide pour ignorer un compte.</p>
      <div class="grid">
        {#each accountKeys as k (k)}
          <label class="f">{k}
            <select bind:value={profile.accountMap[k]}>
              <option value="">— ignorer</option>
              {#each accounts.filter((a) => a.kind !== 'third') as a}<option value={a.id}>{a.name}</option>{/each}
            </select>
          </label>
        {/each}
      </div>
    {:else}
      <label class="f">Compte cible
        <select bind:value={profile.accountId}>
          <option value={undefined}>—</option>
          {#each accounts.filter((a) => a.kind !== 'third') as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
    {/if}
    <h3>Aperçu ({parsed.rows.length} opérations lisibles{parsed.errors.length ? `, ${parsed.errors.length} lignes illisibles` : ''})</h3>
    {#if parsed.errors.length}
      <div class="warnings">{#each parsed.errors.slice(0, 5) as e}<div>Ligne {e.line} : {e.message}</div>{/each}</div>
    {/if}
    <div class="card">
      {#each parsed.rows.slice(0, 8) as r (r.line)}
        <div class="row"><div class="label">{r.label}<span class="sub">{shortDate(r.date)}{r.accountKey ? ` · ${r.accountKey}` : ''}{r.suggestedCategory ? ` · ${r.suggestedCategory}` : ''}</span></div><div class="num">{money(r.amount)}</div></div>
      {/each}
    </div>
    {#if error}<div class="err">{error}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit" disabled={parsed.rows.length === 0}>Vérifier les doublons</button>
      <button class="btn" type="button" onclick={reset}>Annuler</button>
    </div>
  </form>
{/if}

{#if step === 'preview' && prep}
  <div class="stats">
    <div class="stat"><div class="v">{prep.counts.new}</div><div class="k">Nouvelles</div></div>
    <div class="stat"><div class="v">{prep.counts.exact}</div><div class="k">Déjà connues</div></div>
    <div class="stat"><div class="v">{prep.counts.probable}</div><div class="k">Doublons probables</div></div>
    <div class="stat"><div class="v">{prep.counts.unmapped}</div><div class="k">Comptes ignorés</div></div>
  </div>
  {#if prep.unmappedAccounts.length}
    <p class="small muted">Ignoré : {prep.unmappedAccounts.join(', ')}</p>
  {/if}
  {#if prep.counts.probable}
    <h2>Doublons probables</h2>
    <p class="small muted">Même compte, même montant, à trois jours près, libellé proche. Coche celles qui sont bien de nouvelles opérations.</p>
    <div class="card">
      {#each prep.candidates.filter((c) => c.probable) as c (c.row.line)}
        <div class="row">
          <label class="label" style="display:flex;gap:8px;align-items:flex-start">
            <input type="checkbox" bind:checked={decisions[c.row.line]} />
            <span>{c.row.label}<span class="sub">{shortDate(c.row.date)} · ressemble à « {c.probable!.label} » du {shortDate(c.probable!.date)} ({Math.round((c.similarity ?? 0) * 100)} %)</span></span>
          </label>
          <div class="num">{money(c.row.amount)}</div>
        </div>
      {/each}
    </div>
  {/if}
  {#if error}<div class="err">{error}</div>{/if}
  <div class="actions">
    <button class="btn primary" onclick={doImport} disabled={busy || prep.candidates.filter(toImport).length === 0}>Importer {prep.candidates.filter(toImport).length} opérations</button>
    <button class="btn" onclick={() => (step = 'profile')}>Retour</button>
  </div>
{/if}

{#if step === 'done' && report}
  <div class="card accent">
    <h2 style="margin-top:0">Import terminé</h2>
    <div class="row"><div class="label">Opérations importées</div><div class="num">{report.inserted}</div></div>
    <div class="row"><div class="label">Virements internes appariés</div><div class="num">{report.transfersPaired}</div></div>
    <div class="row"><div class="label">Virements vers des enveloppes reconnus</div><div class="num">{report.envelopeTransfers}</div></div>
    <div class="row"><div class="label">Flux prévus pointés automatiquement</div><div class="num">{report.autoMatched}</div></div>
    <div class="row"><div class="label">Pointages à confirmer</div><div class="num">{report.proposals.length}</div></div>
    <div class="row"><div class="label">Classées par une règle</div><div class="num">{report.ruled}</div></div>
  </div>
  <div class="actions">
    <button class="btn primary" onclick={() => app.switchTab('operations')}>Trier les opérations</button>
    <button class="btn" onclick={reset}>Importer un autre fichier</button>
  </div>
{/if}
