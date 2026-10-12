<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { revealed } from '../lib/actions';
  import FiltreEtat from '../lib/FiltreEtat.svelte';
  import SectionRevenusCharges from '../lib/SectionRevenusCharges.svelte';
  import FormulaireFlux from '../lib/FormulaireFlux.svelte';
  import {
    GENRES_DE_FLUX,
    SectionRevenusCharges as SectionDesFlux,
    completerAvecLesChampsAvances,
    type GenreDeFlux,
    type ValeursAvancees,
  } from '../lib/sectionRevenusCharges.svelte';
  import { money, shortDate, centsToInput, inputToCents, openAccounts, FLOW_KINDS, FLOW_GROUP_TITLES, periodicityLabel, UNITS, validityLabel, validityBadge } from '../lib/format';
  import { aidesDeFluxPrevu } from '../lib/aides';
  import {
    addMonths,
    alive,
    countStates,
    flowOccurrences,
    flowTirelire,
    tracksOperations,
    standingOrderTarget,
    needForDueDateFlow,
    nextOccurrence,
    stateShown,
    validityState,
    DEFAULT_VISIBILITY,
    MAIN_ACCOUNT_ID,
    type FlowAction,
    type PlannedFlow,
    type PlannedFlowKind,
    type PeriodUnit,
    type StateVisibility,
  } from '@tirelire/core';

  /*
   * Les revenus et les charges fixes sont les lignes de la section Revenus et charges fixes (#364), la
   * même que celle de l'assistant : corrigées sur place, elles s'écrivent ici aussitôt dans le projet.
   * L'écran garde ce qui lui est propre (D94) : le filtre d'état (D56) ; le panneau des champs avancés
   * (D59) ; la confirmation avant de supprimer ; les boutons qui ouvrent, sous eux, le formulaire
   * d'ajout de chaque genre ; et les échéances et les virements, avec leur panneau d'aujourd'hui.
   */
  const section = new SectionDesFlux({
    get ledger() {
      return app.ledger;
    },
    upsert: (key, row) => app.upsert(key, row),
    remove: (key, id) => app.remove(key, id),
    newId: () => app.newId(),
    get asOf() {
      return app.asOf;
    },
    mainAccountId: () => principalId || MAIN_ACCOUNT_ID,
  });
  const GENRES: GenreDeFlux[] = ['income', 'fixedCharge'];
  const estDeLaSection = (k: PlannedFlowKind): k is GenreDeFlux => k === 'income' || k === 'fixedCharge';
  /** Le bouton, et le titre du formulaire qu'il ouvre (D59). */
  const AJOUTER: Record<GenreDeFlux, string> = { income: 'Ajouter un revenu', fixedCharge: 'Ajouter une charge fixe' };
  const AJOUTER_AUTRE = 'Ajouter une échéance ou un virement';

  /** Le formulaire d'ajout de la section, ouvert sous le bouton de son genre. */
  let ajout = $state<GenreDeFlux | undefined>(undefined);

  /** Le panneau des champs avancés d'un revenu ou d'une charge fixe (D59), ouvert par « Modifier » sous sa ligne. */
  let avance = $state<PlannedFlow | undefined>(undefined);
  /** Ce qu'annonce le panneau : figé à l'ouverture, pour ne pas suivre la saisie en cours. */
  let titreAvance = $state('');
  /** Le genre du flux, entre revenu et charge fixe seulement (#364, point 4). */
  let genreAvance = $state<GenreDeFlux>('income');
  let formAvance = $state<ValeursAvancees>({
    categoryId: '',
    dateWindowDays: '',
    toleranceAbs: '',
    tolerancePct: '',
    labelPattern: '',
    activeFrom: '',
    activeTo: '',
    variable: false,
    locks: false,
  });
  let errorAvance = $state('');

  /** Le panneau d'une échéance ou d'un virement : celui d'aujourd'hui (#364, point 7). */
  let editing = $state<PlannedFlow | undefined>(undefined);
  /** Ce qu'annonce le panneau : figé à l'ouverture, pour ne pas suivre la saisie en cours. */
  let titre = $state('');
  let form = $state({
    name: '',
    kind: 'income' as PlannedFlowKind,
    amount: '',
    accountId: '',
    tirelireId: '',
    categoryId: '',
    counterpartAccountId: '',
    interval: '1',
    unit: 'month' as PeriodUnit,
    anchorDate: app.asOf,
    dateWindowDays: '3',
    toleranceAbs: '',
    tolerancePct: '',
    labelPattern: '',
    variable: false,
    locks: false,
    activeFrom: '',
    activeTo: '',
  });
  let error = $state('');
  let etatsVisibles = $state<StateVisibility>({ ...DEFAULT_VISIBILITY });
  /** Les aides des champs (D43) : le nom, le montant et le motif d'un même flux de l'exemple, du type choisi. */
  const aides = $derived(aidesDeFluxPrevu(form.kind));

  const accounts = $derived(alive(app.ledger.accounts));
  const tirelires = $derived(alive(app.ledger.tirelires));
  const categories = $derived(alive(app.ledger.categories));
  const flows = $derived(alive(app.ledger.plannedFlows));
  const principalId = $derived(accounts.find((a) => a.kind === 'principal')?.id ?? '');
  /** Un ordre permanent : un flux de virement du compte principal vers un autre compte (D57, D60). */
  const estOrdre = (f: PlannedFlow) => standingOrderTarget(f, principalId) !== undefined;
  const états = $derived(countStates(flows, (f) => validityState(f, app.asOf)));
  const visibles = $derived(flows.filter((f) => stateShown(etatsVisibles, validityState(f, app.asOf))));
  const masqués = $derived(flows.length - visibles.length);
  /**
   * Les groupes : les revenus et les charges fixes, toujours là, chacun dans l'ordre du projet comme
   * dans l'assistant ; les échéances et les virements, quand l'écran en montre, par montant décroissant.
   */
  const groups = $derived(
    (['income', 'fixedCharge', 'dueDate', 'transfer'] as PlannedFlowKind[])
      .map((k) => ({ kind: k, flows: visibles.filter((f) => f.kind === k).sort((a, b) => (estDeLaSection(k) ? 0 : Math.abs(b.amount) - Math.abs(a.amount))) }))
      .filter((g) => estDeLaSection(g.kind) || g.flows.length > 0),
  );
  /** Les lignes de la section que l'écran montre : celles que le filtre d'état laisse voir (D56). */
  const ranger = (genre: GenreDeFlux) => visibles.filter((f) => f.kind === genre);
  /** Comptes offerts aux menus : les vivants, plus celui que la ligne désigne déjà (D56). */
  const comptesChoisis = $derived(openAccounts(accounts, app.asOf, form.accountId));
  const comptesContrepartie = $derived(openAccounts(accounts, app.asOf, form.counterpartAccountId).filter((a) => a.id !== form.accountId));

  /**
   * Une échéance est payée le jour venu par ce flux, mais provisionnée d'avance par une tirelire.
   * La liste le dit maintenant, et signale les deux cas où la provision manque : pas de tirelire
   * désignée, ou une tirelire qui ne porte aucun besoin d'échéance.
   */
  function provisionText(f: PlannedFlow): string {
    if (f.kind !== 'dueDate') return '';
    const nom = tirelires.find((e) => e.id === flowTirelire(f))?.name;
    if (!nom) return '⚠ aucune tirelire ne la provisionne';
    return needForDueDateFlow(f, app.ledger.needs, app.asOf)
      ? `provisionnée par « ${nom} »`
      : `⚠ « ${nom} » ne porte aucun besoin d’échéance`;
  }

  /** Ferme tout panneau ouvert : un seul à la fois. */
  function fermer() {
    ajout = undefined;
    avance = undefined;
    editing = undefined;
  }

  /** « Ajouter une échéance ou un virement » : le panneau d'aujourd'hui, son type limité à ces deux genres (#364, point 7). */
  function startNew() {
    fermer();
    const principal = accounts.find((a) => a.kind === 'principal');
    editing = { id: app.newId(), name: '', kind: 'dueDate', amount: 0, accountId: principal?.id ?? '', periodicity: { interval: 1, unit: 'month' as const, anchorDate: app.asOf }, dateWindowDays: 3 };
    form = { ...form, name: '', kind: 'dueDate', amount: '', accountId: principal?.id ?? '', tirelireId: '', categoryId: '', counterpartAccountId: '', interval: '1', unit: 'month' as PeriodUnit, anchorDate: app.asOf, dateWindowDays: '3', toleranceAbs: '', tolerancePct: '', labelPattern: '', variable: false, locks: false, activeFrom: '', activeTo: '' };
    titre = AJOUTER_AUTRE;
    error = '';
  }
  /** Le flux qu'on crée par ce panneau n'a pas encore de ligne. */
  const nouveau = $derived(!!editing && !flows.some((f) => f.id === editing?.id));
  /** Les types qu'offre le panneau : les quatre pour un flux qui existe, comme aujourd'hui ; l'échéance et le virement pour en ajouter un. */
  const typesOfferts = $derived(Object.entries(FLOW_KINDS).filter(([k]) => !nouveau || !estDeLaSection(k as PlannedFlowKind)));

  /** « Ajouter un revenu », « Ajouter une charge fixe » : le formulaire d'ajout de la section, ouvert sous son bouton. */
  function ouvrirAjout(genre: GenreDeFlux) {
    fermer();
    section.vider(genre);
    ajout = genre;
  }

  /** « Modifier » sur la ligne d'un revenu ou d'une charge fixe : le panneau de ce que la ligne ne corrige pas (#364, point 4). */
  function ouvrirAvance(f: PlannedFlow) {
    fermer();
    avance = f;
    genreAvance = f.kind === 'fixedCharge' ? 'fixedCharge' : 'income';
    formAvance = {
      categoryId: f.action?.categoryId ?? '',
      dateWindowDays: String(f.dateWindowDays),
      toleranceAbs: centsToInput(f.amountTolerance?.abs),
      tolerancePct: f.amountTolerance?.pct !== undefined ? String(f.amountTolerance.pct) : '',
      labelPattern: f.labelPattern ?? '',
      activeFrom: f.activeFrom ?? '',
      activeTo: f.activeTo ?? '',
      variable: !!f.variable,
      locks: f.action?.state === 'lock',
    };
    titreAvance = `Modifier le flux — ${f.name}`;
    errorAvance = '';
  }
  /**
   * Enregistre les champs avancés et le genre, sur le flux tel qu'il est maintenant : ce que la ligne a
   * corrigé, panneau ouvert, reste, comme les parts de son action (#393, point 11). Changer de genre
   * garde le flux, donc ses occurrences reprises (D88) ; aucune opération déjà reprise n'est réécrite (D24).
   */
  function saveAvance(e: Event) {
    e.preventDefault();
    if (!avance) return;
    const actuel = flows.find((f) => f.id === avance!.id) ?? avance;
    const row: PlannedFlow = { ...actuel, kind: genreAvance, amount: genreAvance === 'income' ? Math.abs(actuel.amount) : -Math.abs(actuel.amount) };
    const refus = completerAvecLesChampsAvances(row, formAvance);
    if (refus) return void (errorAvance = refus);
    app.upsert('plannedFlows', row);
    avance = undefined;
  }
  function supprimerDeLaSection(f: PlannedFlow) {
    section.retirer(f, () => confirm(`Supprimer « ${f.name} » ?`));
    if (avance?.id === f.id && !flows.some((x) => x.id === f.id)) avance = undefined;
  }

  function startEdit(f: PlannedFlow) {
    fermer();
    editing = f;
    form = {
      name: f.name,
      kind: f.kind,
      amount: centsToInput(Math.abs(f.amount)),
      accountId: f.accountId,
      tirelireId: flowTirelire(f) ?? '',
      categoryId: f.action?.categoryId ?? '',
      counterpartAccountId: f.counterpartAccountId ?? '',
      interval: String(f.periodicity.interval),
      unit: f.periodicity.unit,
      anchorDate: f.periodicity.anchorDate,
      dateWindowDays: String(f.dateWindowDays),
      toleranceAbs: centsToInput(f.amountTolerance?.abs),
      tolerancePct: f.amountTolerance?.pct !== undefined ? String(f.amountTolerance.pct) : '',
      labelPattern: f.labelPattern ?? '',
      variable: !!f.variable,
      locks: f.action?.state === 'lock',
      activeFrom: f.activeFrom ?? '',
      activeTo: f.activeTo ?? '',
    };
    titre = `Modifier le flux — ${f.name}`;
    error = '';
  }

  function save(e: Event) {
    e.preventDefault();
    if (!editing) return;
    if (!form.name.trim()) return void (error = 'Le nom est obligatoire.');
    const abs = inputToCents(form.amount);
    if (abs === undefined || abs < 0) return void (error = 'Montant invalide (saisissez-le en positif, le sens dépend du type).');
    if (!form.accountId) return void (error = 'Choisissez le compte.');
    if (form.kind === 'dueDate' && !form.tirelireId) return void (error = 'Choisissez la tirelire qui paie l’échéance.');
    if (form.kind === 'transfer' && !form.counterpartAccountId) return void (error = 'Choisissez le compte de contrepartie.');
    if (form.labelPattern.trim()) {
      try {
        new RegExp(form.labelPattern, 'i');
      } catch {
        return void (error = 'Motif de libellé invalide (expression régulière).');
      }
    }
    const tolAbs = inputToCents(form.toleranceAbs);
    const tolPct = form.tolerancePct.trim() ? Number(form.tolerancePct) : undefined;
    /*
     * L'action du flux (D24) : ce que l'écran règle — catégorie, tirelire d'une échéance, verrouillage —
     * s'y écrit ; ses parts, que l'écran ne montre pas, restent telles qu'elles sont (#393, point 11).
     */
    const action: FlowAction = { ...editing.action };
    if (form.categoryId) action.categoryId = form.categoryId;
    else delete action.categoryId;
    if (form.kind === 'dueDate' && form.tirelireId !== (flowTirelire(editing) ?? '')) {
      if (form.tirelireId) action.tirelireId = form.tirelireId;
      else delete action.tirelireId;
    } else if (form.kind !== 'dueDate' && editing.kind === 'dueDate') delete action.tirelireId;
    if (form.locks) action.state = 'lock';
    else delete action.state;
    const row: PlannedFlow = {
      id: editing.id,
      name: form.name.trim(),
      kind: form.kind,
      amount: form.kind === 'income' ? abs : -abs,
      accountId: form.accountId,
      periodicity: { interval: Math.max(1, Number(form.interval) || 1), unit: form.unit, anchorDate: form.anchorDate },
      dateWindowDays: Math.max(0, Number(form.dateWindowDays) || 0),
      ...(form.counterpartAccountId && form.kind === 'transfer' ? { counterpartAccountId: form.counterpartAccountId } : {}),
      ...(tolAbs !== undefined || tolPct !== undefined
        ? { amountTolerance: { ...(tolAbs !== undefined ? { abs: tolAbs } : {}), ...(tolPct !== undefined ? { pct: tolPct } : {}) } }
        : {}),
      ...(form.labelPattern.trim() ? { labelPattern: form.labelPattern.trim() } : {}),
      ...(form.variable ? { variable: true } : {}),
      ...(Object.keys(action).length ? { action } : {}),
      ...(form.activeFrom ? { activeFrom: form.activeFrom } : {}),
      ...(form.activeTo ? { activeTo: form.activeTo } : {}),
    };
    // D24 : modifier un flux ne réécrit aucune opération déjà reprise ; il vaut pour celles qu'il reprendra.
    app.upsert('plannedFlows', row);
    editing = undefined;
  }

  function remove(f: PlannedFlow) {
    if (confirm(`Supprimer « ${f.name} » ?`)) app.remove('plannedFlows', f.id);
  }

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?';
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.back() || app.switchTab('more'); }}>‹ Configuration</a></p>
<h1>Flux prévus</h1>
<!-- L'assistant, ouvert sur la seule section de cet écran (D94, #363, #364) : toujours offert, base vide comprise. -->
<p class="actions"><a class="btn" href="#top" onclick={(e) => { e.preventDefault(); app.demanderAssistant('revenus'); }}>Compléter avec l’assistant</a></p>
<p class="muted small">Revenus, charges fixes, échéances payées par une tirelire. Le montant se saisit en positif.</p>
<!-- Le texte de la section, replié ici (D94), avec ce que l'écran explique de la sélection d'un flux (U3) et de l'ordre permanent. -->
<details class="explication muted small">
  <summary>Comment ça marche ?</summary>
  {#each GENRES as genre}<p>{GENRES_DE_FLUX[genre].explication}</p>{/each}
  <p>Le compte, le motif de libellé, la tolérance de montant et la fenêtre de dates sont les critères du flux : eux seuls reconnaissent l’opération du relevé qui réalise chaque échéance, qu’elle reprend et classe. Un virement du compte principal vers un autre compte est un <strong>ordre permanent</strong> : le Plan le compare à ce que le budget demande, et propose de l’enregistrer avec sa ventilation.</p>
</details>

<FiltreEtat bind:value={etatsVisibles} counts={états} quoi="les flux" />
{#if flows.length === 0}
  <div class="empty">Aucun flux prévu. Commencez par les revenus, puis les charges fixes.</div>
{/if}

<!-- Les champs avancés d'un revenu ou d'une charge fixe (D59), dans son panneau et dans le formulaire d'ajout de l'écran. -->
{#snippet champsAvances(v: ValeursAvancees, poser: <K extends keyof ValeursAvancees>(k: K, val: ValeursAvancees[K]) => void, aide: { toleranceAbs: string | undefined; labelPattern: string | undefined } | undefined)}
  <label class="f">Catégorie
    <select value={v.categoryId} onchange={(e) => poser('categoryId', e.currentTarget.value)}>
      <option value="">—</option>
      {#each categories as c}<option value={c.id}>{c.name}</option>{/each}
    </select>
  </label>
  <label class="f">Fenêtre des échéances (± jours) <input type="number" min="0" value={v.dateWindowDays} oninput={(e) => poser('dateWindowDays', e.currentTarget.value)} /></label>
  <label class="f">Tolérance de montant (€) <input value={v.toleranceAbs} inputmode="decimal" placeholder={aide?.toleranceAbs} oninput={(e) => poser('toleranceAbs', e.currentTarget.value)} /></label>
  <label class="f">Tolérance de montant (%) <input type="number" min="0" value={v.tolerancePct} oninput={(e) => poser('tolerancePct', e.currentTarget.value)} /></label>
  <label class="f">Motif de libellé (regex) <input value={v.labelPattern} placeholder={aide?.labelPattern} oninput={(e) => poser('labelPattern', e.currentTarget.value)} /></label>
  <label class="f">Actif à partir du <input type="date" value={v.activeFrom} oninput={(e) => poser('activeFrom', e.currentTarget.value)} /></label>
  <label class="f">Actif jusqu'au <input type="date" value={v.activeTo} oninput={(e) => poser('activeTo', e.currentTarget.value)} /></label>
  <label class="f check"><input type="checkbox" checked={v.variable} onchange={(e) => poser('variable', e.currentTarget.checked)} /> Montant variable (reprise à confirmer)</label>
  <label class="f check"><input type="checkbox" checked={v.locks} onchange={(e) => poser('locks', e.currentTarget.checked)} /> Verrouiller les opérations que ce flux reprend</label>
{/snippet}

{#snippet editeurAvance()}
  <form class="edit attached" use:revealed onsubmit={saveAvance}>
    <p class="titre-panneau">{titreAvance}</p>
    <div class="grid">
      <label class="f">Type
        <select bind:value={genreAvance}>
          {#each GENRES as k}<option value={k}>{FLOW_KINDS[k]}</option>{/each}
        </select>
      </label>
      {@render champsAvances(formAvance, (k, val) => (formAvance[k] = val), undefined)}
    </div>
    {#if errorAvance}<div class="err">{errorAvance}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (avance = undefined)}>Annuler</button>
    </div>
  </form>
{/snippet}

{#snippet avancesAjout()}
  {#if ajout}
    {@const genre = ajout}
    {@render champsAvances(section.valeursAvancees(genre), (k, val) => (section.avancees[genre][k] = val), section.aidesAvancees(genre))}
  {/if}
{/snippet}

{#snippet actionsSection(f: PlannedFlow)}
  <div class="actions" style="margin:0">
    <button class="btn small" onclick={() => ouvrirAvance(f)}>Modifier</button>
    <button class="btn small danger" onclick={() => supprimerDeLaSection(f)}>Supprimer</button>
  </div>
{/snippet}

{#snippet apresLigne(f: PlannedFlow)}
  {#if avance?.id === f.id}
    {@render editeurAvance()}
  {/if}
{/snippet}

{#snippet editeur()}
  <form class="edit attached" use:revealed onsubmit={save}>
    <p class="titre-panneau">{titre}</p>
    <div class="grid">
      <label class="f">Nom <input bind:value={form.name} placeholder={aides.name} /></label>
      <label class="f">Type
        <select bind:value={form.kind}>
          {#each typesOfferts as [k, label]}<option value={k}>{label}</option>{/each}
        </select>
      </label>
      <label class="f">Montant <input bind:value={form.amount} inputmode="decimal" placeholder={aides.amount} /></label>
      <label class="f">Compte
        <select bind:value={form.accountId}>
          {#each comptesChoisis as a}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
      {#if form.kind === 'dueDate'}
        <label class="f">Tirelire qui paie
          <select bind:value={form.tirelireId}>
            <option value="">—</option>
            {#each tirelires as e}<option value={e.id}>{e.name}</option>{/each}
          </select>
        </label>
      {/if}
      {#if form.kind === 'transfer'}
        <label class="f">Compte de contrepartie
          <select bind:value={form.counterpartAccountId}>
            <option value="">—</option>
            {#each comptesContrepartie as a}<option value={a.id}>{a.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="f">Catégorie
        <select bind:value={form.categoryId}>
          <option value="">—</option>
          {#each categories as c}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label class="f">Tous les <input type="number" min="1" bind:value={form.interval} /></label>
      <label class="f">Unité
        <select bind:value={form.unit}>
          {#each Object.entries(UNITS) as [u, l]}<option value={u}>{l.pluriel}</option>{/each}
        </select>
      </label>
      <label class="f">Première date <input type="date" bind:value={form.anchorDate} /></label>
      <label class="f">Fenêtre des échéances (± jours) <input type="number" min="0" bind:value={form.dateWindowDays} /></label>
      <label class="f">Tolérance de montant (€) <input bind:value={form.toleranceAbs} inputmode="decimal" /></label>
      <label class="f">Tolérance de montant (%) <input type="number" min="0" bind:value={form.tolerancePct} /></label>
      <label class="f">Motif de libellé (regex) <input bind:value={form.labelPattern} placeholder={aides.labelPattern} /></label>
      <label class="f">Actif à partir du <input type="date" bind:value={form.activeFrom} /></label>
      <label class="f">Actif jusqu'au <input type="date" bind:value={form.activeTo} /></label>
      <label class="f check"><input type="checkbox" bind:checked={form.variable} /> Montant variable (reprise à confirmer)</label>
      <label class="f check"><input type="checkbox" bind:checked={form.locks} /> Verrouiller les opérations que ce flux reprend</label>
    </div>
    {#if error}<div class="err">{error}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (editing = undefined)}>Annuler</button>
    </div>
  </form>
{/snippet}

{#each groups as g (g.kind)}
  <h2>{FLOW_GROUP_TITLES[g.kind]}</h2>
  {#if estDeLaSection(g.kind)}
    {@const genre = g.kind}
    <SectionRevenusCharges s={section} {genre} explication={false} titre={false} formulaire={false} detailAvance enEdition={avance?.id} {ranger} actions={actionsSection} {apresLigne} />
    <div class="actions">
      <button class="btn small" onclick={() => ouvrirAjout(genre)}>{AJOUTER[genre]}</button>
    </div>
    <!-- Le formulaire d'ajout de la section suit le bouton de son genre, intitulé comme lui et avec les champs avancés (D59). -->
    {#if ajout === genre}
      <div use:revealed>
        <FormulaireFlux s={section} {genre} titre={AJOUTER[genre]} avances={avancesAjout} onajoute={() => (ajout = undefined)} onannule={() => (ajout = undefined)} />
      </div>
    {/if}
  {:else}
    <div class="card">
      {#each g.flows as f (f.id)}
        {@const badge = validityBadge(f, app.asOf)}
        {@const validite = validityLabel(f)}
        {@const provision = provisionText(f)}
        <div class="row {badge ? 'dormant' : ''}" class:editing={editing?.id === f.id}>
          <div class="label">
            <strong>{f.name}</strong>{f.variable ? ' (variable)' : ''}{f.action?.state === 'lock' ? ' · verrouille' : ''}
            {#if badge}<span class="pill dim">{badge}</span>{/if}
            {#if estOrdre(f)}<span class="pill dim">ordre permanent</span>{/if}
            <span class="sub">{accountName(f.accountId)} · {periodicityLabel(f.periodicity)} · prochaine : {shortDate(nextOccurrence(f.periodicity, app.asOf))}{validite ? ` · ${validite}` : ''}</span>
            {#if provision}<span class="sub">{provision}</span>{/if}
            {#if estOrdre(f)}<span class="sub">montant de l’ordre permanent chez la banque</span>{/if}
            {#if estOrdre(f) && tracksOperations(app.ledger, f.accountId)}
              <!-- Les dernières occurrences de l'ordre, au pointage (D12, #183) ; sans suivi des
                   opérations, rien ne se pointe et rien ne se dit. -->
              {@const occurrences = flowOccurrences(app.ledger, f, addMonths(app.asOf, -3), app.asOf, app.asOf).slice(-3)}
              {#if occurrences.length}
                <span class="sub">{occurrences
                  .map((o) => `${shortDate(o.date)} : ${o.status === 'pointee' ? 'repris' : o.status === 'attendue' ? 'attendu' : 'attendu, non reçu'}`)
                  .join(' · ')}</span>
              {/if}
            {/if}
          </div>
          <div class="num {f.amount < 0 ? '' : 'pos'}">{money(f.amount)}</div>
          <div class="actions" style="margin:0">
            {#if estOrdre(f)}
              <button class="btn small" onclick={() => app.switchTab('plan')}>Voir dans le Plan</button>
            {/if}
            <button class="btn small" onclick={() => startEdit(f)}>Modifier</button>
            <button class="btn small danger" onclick={() => remove(f)}>Supprimer</button>
          </div>
        </div>
        {#if editing?.id === f.id}
          {@render editeur()}
        {/if}
      {/each}
    </div>
  {/if}
{/each}

<div class="actions">
  <button class="btn small" onclick={startNew} disabled={accounts.length === 0}>{AJOUTER_AUTRE}</button>
</div>
<!-- Une échéance ou un virement qu'on crée n'a pas encore de ligne : son panneau suit le bouton qui l'ouvre. -->
{#if nouveau}
  {@render editeur()}
{/if}
{#if flows.length > 0 && visibles.length === 0}
  <div class="empty">Tout est masqué par le filtre : {masqués} flux rangé(s).</div>
{/if}
