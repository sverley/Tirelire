<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { revealed } from '../lib/actions';
  import FiltreEtat from '../lib/FiltreEtat.svelte';
  import Manque from '../lib/Manque.svelte';
  import CarteTirelire from '../lib/CarteTirelire.svelte';
  import FormulaireTirelire from '../lib/FormulaireTirelire.svelte';
  import RaccourcisTirelires from '../lib/RaccourcisTirelires.svelte';
  import { EXPLICATION } from '../lib/explicationTirelires';
  import { SectionTirelires as Section, type GenreDeLaSection } from '../lib/sectionTirelires.svelte';
  import { money, centsToInput, inputToCents, openAccounts, NEED_KINDS, NEED_KINDS_SHORT, ROLLOVER_LABELS } from '../lib/format';
  import { aidesDeBesoin } from '../lib/aides';
  import {
    alive,
    activeAt,
    budgetPeriodContaining,
    minDate,
    nextPeriod,
    tirelireBalance,
    tirelireComponents,
    tirelireValidityState,
    stateShown,
    indexLedger,
    dueDateFlowForNeed,
    dueDateShortfalls,
    validityState,
    DEFAULT_PRIORITY,
    DEFAULT_VISIBILITY,
    MAIN_ACCOUNT_ID,
    type Tirelire,
    type Need,
    type NeedKind,
    type StateVisibility,
    type ValidityState,
  } from '@tirelire/core';

  // Tirelire : placement voulu (D20), solde initial, report (D05/D29) — ce que la carte ne corrige pas sur place.
  let editing = $state<Tirelire | undefined>(undefined);
  /** Ce qu'annoncent les panneaux : figé à l'ouverture, pour ne pas suivre la saisie en cours. */
  let titre = $state('');
  type PlacementForm = { accountId: string; kind: 'fixed' | 'percent' | 'variable'; value: string };
  let form = $state({
    placement: [] as PlacementForm[],
    openingBalance: '0,00',
    openingDate: app.asOf,
    rollover: 'unlimited' as 'none' | 'unlimited' | 'capped',
    rolloverMonths: '3',
  });
  let error = $state('');

  // Besoin : un ou plusieurs par tirelire (D28).
  let editingNeed = $state<{ need: Need; isNew: boolean } | undefined>(undefined);
  let needTitre = $state('');
  let needForm = $state({
    name: '',
    kind: 'recurring' as NeedKind,
    amount: '',
    interval: '1',
    anchorDate: app.asOf,
    monthlyAmount: '',
    priority: '20',
    activeFrom: '',
    activeTo: '',
  });
  let needError = $state('');
  /**
   * Les aides des champs (D43) : le nom d'une tirelire de l'exemple ; pour un besoin, les valeurs d'un
   * besoin de l'exemple du type choisi. Un type que l'exemple ne porte pas — le versement — n'a pas d'aide.
   */
  const aidesBesoin = $derived(aidesDeBesoin(needForm.kind));

  /** La section Tirelires, la même que l'assistant (#361), qui écrit ici dans le projet. */
  const section = new Section({
    get ledger() {
      return app.ledger;
    },
    upsert: (key, row) => app.upsert(key, row),
    remove: (key, id) => app.remove(key, id),
    newId: () => app.newId(),
    get asOf() {
      return app.asOf;
    },
    periodStart: () => budgetPeriodContaining(app.asOf, app.ledger.settings.periodStartDay).start,
    mainAccountId: () => accounts.find((a) => a.kind === 'principal')?.id ?? MAIN_ACCOUNT_ID,
  });
  /** L'ajout d'une tirelire : le formulaire de la section, ouvert à la demande, pour le genre choisi. */
  let ajout = $state(false);
  let genreAjout = $state<GenreDeLaSection>('everyday');
  const GENRES: Array<[GenreDeLaSection, string]> = [['everyday', 'Budget par période'], ['periodic', 'Dépense à échéance'], ['savings', 'Objectif d\'épargne']];

  const accounts = $derived(alive(app.ledger.accounts));
  const tirelires = $derived(alive(app.ledger.tirelires));
  const needs = $derived(alive(app.ledger.needs));
  const idx = $derived(indexLedger(app.ledger));
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?';
  /** En vigueur d'abord, puis ce qui vient, puis ce qui est clos : on lit le budget d'aujourd'hui en haut. */
  const rangValidite = (n: Need) => (activeAt(n, app.asOf) ? 0 : n.activeFrom && app.asOf < n.activeFrom ? 1 : 2);
  const needsOf = (e: Tirelire) =>
    needs
      .filter((n) => n.tirelireId === e.id)
      .sort((a, b) => rangValidite(a) - rangValidite(b) || a.priority - b.priority || (a.activeFrom ?? '').localeCompare(b.activeFrom ?? ''));

  // Filtre d'état (D56). Une tirelire n'a pas de dates : elle est retenue si son propre état est
  // allumé, ou si l'un de ses besoins l'est — sans cette seconde branche, allumer « Clos » ne
  // montrerait rien, puisque le budget clos d'hier vit sur une tirelire bien en vigueur.
  let etatsVisibles = $state<StateVisibility>({ ...DEFAULT_VISIBILITY });
  const porte = (e: Tirelire, s: ValidityState) =>
    tirelireValidityState(e, idx, app.asOf) === s || needsOf(e).some((n) => validityState(n, app.asOf) === s);
  const besoinsVisibles = (e: Tirelire) => needsOf(e).filter((n) => stateShown(etatsVisibles, validityState(n, app.asOf)));
  const visible = (e: Tirelire) =>
    stateShown(etatsVisibles, tirelireValidityState(e, idx, app.asOf)) || besoinsVisibles(e).length > 0;
  // Le compte d'un interrupteur = les cartes qu'il fait apparaître à lui seul.
  const états = $derived({
    active: tirelires.filter((e) => porte(e, 'active')).length,
    upcoming: tirelires.filter((e) => porte(e, 'upcoming')).length,
    closed: tirelires.filter((e) => porte(e, 'closed')).length,
  } as Record<ValidityState, number>);
  const masquées = $derived(tirelires.length - tirelires.filter(visible).length);

  /** Ce qu'on écrit quand une tirelire n'affiche aucun besoin : le vide du filtre n'est pas le vide. */
  const sansBesoin = (e: Tirelire) =>
    needsOf(e).length === 0
      ? 'Aucun besoin : cette tirelire ne demande rien au plan.'
      : `Ses ${needsOf(e).length} besoin(s) sont masqués par le filtre.`;

  /**
   * Le compte sous lequel une tirelire se range : son premier compte de placement (D38) ; sans
   * placement voulu, le compte principal, où restent ses dotations (D29) — un budget entier tient
   * sans placement, qui ne produit aucun écart (D40, D38).
   */
  const principal = $derived(accounts.find((a) => a.kind === 'principal'));
  const rangéeSous = (e: Tirelire) => (e.placement.length === 0 ? principal?.id : e.placement[0]?.accountId);
  const byPlacement = $derived(
    accounts
      .map((a) => ({ account: a, tirelires: tirelires.filter((e) => rangéeSous(e) === a.id && visible(e)) }))
      .filter((g) => g.tirelires.length > 0),
  );
  /** À part, en alerte : la tirelire dont le placement vise un compte qui n'existe plus. */
  const orphans = $derived(tirelires.filter((e) => !accounts.some((a) => a.id === rangéeSous(e)) && visible(e)));
  /** Comptes offerts au placement : les vivants, plus ceux que la tirelire désigne déjà (D56). */
  const comptesPlacement = $derived(openAccounts(accounts, app.asOf, ...form.placement.map((p) => p.accountId)));

  function placementText(e: Tirelire): string {
    if (e.placement.length === 0) return 'libre, aucun écart proposé';
    return e.placement
      .map((p) => {
        const where = accountName(p.accountId);
        if (p.share.kind === 'fixed') return `${money(p.share.amount)} sur ${where}`;
        if (p.share.kind === 'percent') return `${p.share.pct} % sur ${where}`;
        return `le reste sur ${where}`;
      })
      .join(', ');
  }

  function startEdit(e: Tirelire) {
    editing = e;
    form = {
      placement: e.placement.map((p) => ({
        accountId: p.accountId,
        kind: p.share.kind,
        value: p.share.kind === 'fixed' ? centsToInput(p.share.amount) : p.share.kind === 'percent' ? String(p.share.pct) : '',
      })),
      openingBalance: centsToInput(e.openingBalance),
      openingDate: e.openingDate,
      rollover: e.rollover?.mode ?? 'unlimited',
      rolloverMonths: String(e.rollover?.mode === 'capped' ? e.rollover.months : 3),
    };
    titre = `Modifier la tirelire — ${e.name}`;
    error = '';
  }

  function save(ev: Event) {
    ev.preventDefault();
    if (!editing) return;
    if (form.placement.filter((p) => p.kind === 'variable').length > 1)
      return void (error = 'Une seule ligne « le reste » : les autres doivent porter un montant ou un pourcentage.');
    if (form.placement.some((p) => !p.accountId)) return void (error = 'Chaque ligne de placement vise un compte.');
    const openingBalance = inputToCents(form.openingBalance);
    if (openingBalance === undefined) return void (error = 'Solde initial invalide.');
    // La carte corrige le nom sur place : le panneau repart de la tirelire telle qu'elle est maintenant.
    const row: Tirelire = {
      ...(tirelires.find((x) => x.id === editing!.id) ?? editing),
      placement: form.placement.map((p) => ({
        accountId: p.accountId,
        share:
          p.kind === 'fixed'
            ? ({ kind: 'fixed', amount: inputToCents(p.value) ?? 0 } as const)
            : p.kind === 'percent'
              ? ({ kind: 'percent', pct: Number(p.value.replace(',', '.')) || 0 } as const)
              : ({ kind: 'variable' } as const),
      })),
      openingBalance,
      openingDate: form.openingDate,
      rollover:
        form.rollover === 'capped'
          ? { mode: 'capped', months: Math.max(1, Number(form.rolloverMonths) || 1) }
          : { mode: form.rollover },
    };
    app.upsert('tirelires', row);
    editing = undefined;
  }

  /** L'ajout d'un besoin de tout type — échéance, objectif, versement — sur une tirelire existante, par un panneau nommé (D59). */
  function startNewNeed(e: Tirelire) {
    editingNeed = { need: { id: app.newId(), tirelireId: e.id, kind: 'recurring', priority: DEFAULT_PRIORITY.recurring }, isNew: true };
    needForm = { name: '', kind: 'recurring', amount: '', interval: '1', anchorDate: app.asOf, monthlyAmount: '', priority: String(DEFAULT_PRIORITY.recurring), activeFrom: '', activeTo: '' };
    needTitre = `Ajouter un besoin — ${e.name}`;
    needError = '';
  }

  function startEditNeed(n: Need) {
    editingNeed = { need: n, isNew: false };
    needForm = {
      name: n.name ?? '',
      kind: n.kind,
      amount: centsToInput(n.amount),
      interval: String(n.periodicity ? n.periodicity.interval : n.kind === 'dueDate' ? 12 : 1),
      anchorDate: n.periodicity?.anchorDate ?? app.asOf,
      monthlyAmount: centsToInput(n.monthlyAmount),
      priority: String(n.priority),
      activeFrom: n.activeFrom ?? '',
      activeTo: n.activeTo ?? '',
    };
    // Une tirelire peut porter plusieurs besoins (D28) : le panneau nomme les deux.
    const tirelire = tirelires.find((t) => t.id === n.tirelireId);
    const lequel = n.name && n.name !== tirelire?.name ? ` « ${n.name} »` : '';
    needTitre = `Modifier le besoin${lequel} — ${tirelire?.name ?? '?'}`;
    needError = '';
  }

  /**
   * Le geste de D50 : changer un budget, c'est clore l'ancien besoin et en ouvrir un nouveau, jamais
   * éditer le montant en place — sinon les périodes déjà écoulées seraient redotées au montant
   * d'aujourd'hui. La coupure tombe à la frontière de période, parce qu'une dotation est un tout.
   */
  function reviseNeed(n: Need) {
    const startDay = app.ledger.settings.periodStartDay;
    const courante = budgetPeriodContaining(app.asOf, startDay);
    const suivante = nextPeriod(courante, startDay);
    app.upsert('needs', { ...n, activeTo: n.activeTo ? minDate(n.activeTo, courante.end) : courante.end });
    const { activeTo: _fin, ...reste } = n;
    const copie: Need = { ...reste, id: app.newId(), activeFrom: suivante.start };
    app.upsert('needs', copie);
    startEditNeed(copie);
    needTitre = needTitre.replace('Modifier le besoin', 'Réviser le besoin');
  }

  function onNeedKindChange() {
    needForm.priority = String(DEFAULT_PRIORITY[needForm.kind]);
    needForm.interval = needForm.kind === 'dueDate' || needForm.kind === 'payout' ? '12' : '1';
  }

  function saveNeed(ev: Event) {
    ev.preventDefault();
    if (!editingNeed) return;
    const amount = inputToCents(needForm.amount);
    const monthly = inputToCents(needForm.monthlyAmount);
    const interval = Math.max(1, Number(needForm.interval) || 1);
    const row: Need = {
      id: editingNeed.need.id,
      tirelireId: editingNeed.need.tirelireId,
      kind: needForm.kind,
      priority: Number(needForm.priority) || DEFAULT_PRIORITY[needForm.kind],
    };
    if (needForm.name.trim()) row.name = needForm.name.trim();
    if (needForm.activeFrom) row.activeFrom = needForm.activeFrom;
    if (needForm.activeTo) row.activeTo = needForm.activeTo;
    if (row.activeFrom && row.activeTo && row.activeFrom > row.activeTo)
      return void (needError = 'La fin de validité est avant le début.');
    if (needForm.kind === 'dueDate') {
      if (amount === undefined) return void (needError = 'Montant de l’échéance invalide.');
      row.amount = amount;
      row.periodicity = { interval, unit: 'month', anchorDate: needForm.anchorDate };
    } else if (needForm.kind === 'recurring') {
      if (amount === undefined) return void (needError = 'Montant par période invalide.');
      row.amount = amount;
      row.periodicity = { interval, unit: 'month', anchorDate: needForm.anchorDate };
    } else if (needForm.kind === 'payout') {
      // Ce que la réserve rapporte sur la périodicité (l'année, en général) et qu'elle reversera.
      if (amount === undefined) return void (needError = 'Montant à reverser invalide.');
      row.amount = amount;
      row.periodicity = { interval, unit: 'month', anchorDate: needForm.anchorDate };
    } else {
      if (monthly === undefined) return void (needError = 'Mensualité invalide.');
      row.monthlyAmount = monthly;
      if (amount !== undefined) row.amount = amount;
    }
    app.upsert('needs', row);
    editingNeed = undefined;
    // Une échéance enregistrée trop près de sa date se dit aussitôt (principe 1.4, #184).
    section.derniereEcheance = row.kind === 'dueDate' ? row.id : undefined;
  }

  /*
   * L'échéance qu'on vient d'enregistrer, nouvelle ou qui en remplace une autre (D50) : si elle est
   * en manque, l'application dit aussitôt le montant qui manquera et sa date, à côté de ce que
   * l'ordre permanent demande par période, avec la proposition de lisser (#184, point 3).
   */
  const annonceManque = $derived(
    section.derniereEcheance
      ? dueDateShortfalls(app.ledger, app.asOf).find((s) => s.needId === section.derniereEcheance && (s.amount > 0 || s.answer))
      : undefined,
  );

  /**
   * L'autre face d'une échéance : le flux qui la paiera le jour venu. Le dire ici évite d'avoir à
   * deviner, depuis l'écran Tirelires, si la provision qu'on regarde correspond bien au
   * prélèvement attendu — et signale l'échéance provisionnée que rien ne viendra payer.
   */
  function paidByText(n: Need): string {
    if (n.kind !== 'dueDate') return '';
    const f = dueDateFlowForNeed(n, app.ledger.plannedFlows, app.asOf);
    return f ? `payée par le flux « ${f.name} »` : 'aucun flux ne paie cette échéance';
  }

  /** Position réelle : où l'argent se trouve vraiment, comparé au placement voulu (D19, D20). */
  function positionOf(e: Tirelire): Array<{ accountId: string; amount: number }> {
    return [...tirelireComponents(e, idx, app.asOf)]
      .filter(([, amount]) => amount !== 0)
      .map(([accountId, amount]) => ({ accountId, amount }));
  }
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.back() || app.switchTab('more'); }}>‹ Configuration</a></p>
<h1>Tirelires</h1>

<details class="explication muted small">
  <summary>Comment ça marche ?</summary>
  {#each Object.values(EXPLICATION) as texte}<p>{texte}</p>{/each}
</details>

<div class="actions">
  <button class="btn primary" onclick={() => (ajout = !ajout)} aria-expanded={ajout}>Ajouter une tirelire</button>
</div>
{#if ajout}
  <div use:revealed>
  <FormulaireTirelire s={section} genre={genreAjout} titre="Ajouter une tirelire" onajoute={() => (ajout = false)} onannule={() => (ajout = false)}>
    {#snippet avant()}
      <label class="f">Quelle sorte ?
        <select value={genreAjout} onchange={(ev) => (genreAjout = (ev.currentTarget as HTMLSelectElement).value as GenreDeLaSection)}>
          {#each GENRES as [g, nom]}<option value={g}>{nom}</option>{/each}
        </select>
      </label>
    {/snippet}
  </FormulaireTirelire>
  </div>
{/if}
<RaccourcisTirelires s={section} genres={['everyday', 'periodic', 'savings']} />

<FiltreEtat bind:value={etatsVisibles} counts={états} quoi="les tirelires" />

{#snippet editeurTirelire()}
  <form class="edit attached" use:revealed onsubmit={save}>
    <p class="titre-panneau">{titre}</p>
    <div class="grid">
      <div class="f" style="grid-column:1/-1">
        <span class="sub">Placement voulu — où cet argent devrait dormir. Plusieurs comptes possibles : un montant, un pourcentage, et « le reste ».</span>
        {#each form.placement as p, i (i)}
          <div class="grid" style="align-items:end">
            <label class="f">Compte
              <select value={p.accountId} onchange={(ev) => (form.placement[i]!.accountId = (ev.currentTarget as HTMLSelectElement).value)}>
                <option value="">—</option>
                {#each comptesPlacement as a}<option value={a.id}>{a.name}</option>{/each}
              </select>
            </label>
            <label class="f">Part
              <select value={p.kind} onchange={(ev) => (form.placement[i]!.kind = (ev.currentTarget as HTMLSelectElement).value as 'fixed' | 'percent' | 'variable')}>
                <option value="variable">Le reste</option>
                <option value="fixed">Montant</option>
                <option value="percent">Pourcentage</option>
              </select>
            </label>
            {#if p.kind !== 'variable'}
              <label class="f">{p.kind === 'percent' ? '%' : 'Montant'}
                <input value={p.value} inputmode="decimal" oninput={(ev) => (form.placement[i]!.value = (ev.currentTarget as HTMLInputElement).value)} />
              </label>
            {/if}
            <button class="btn small danger" type="button" onclick={() => form.placement.splice(i, 1)}>Retirer</button>
          </div>
        {/each}
        <button class="btn small" type="button" onclick={() => form.placement.push({ accountId: '', kind: form.placement.some((x) => x.kind === 'variable') ? 'fixed' : 'variable', value: '' })}>
          Ajouter un compte
        </button>
      </div>
      <label class="f">Solde initial <input bind:value={form.openingBalance} inputmode="decimal" /></label>
      <label class="f">Date du solde initial <input type="date" bind:value={form.openingDate} /></label>
      <label class="f">Excédent en fin de période
        <select bind:value={form.rollover}>
          {#each Object.entries(ROLLOVER_LABELS) as [k, label]}<option value={k}>{label}</option>{/each}
        </select>
      </label>
      {#if form.rollover === 'capped'}
        <label class="f">Plafond (périodes de dotation) <input type="number" min="1" bind:value={form.rolloverMonths} /></label>
      {/if}
    </div>
    {#if error}<div class="err">{error}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (editing = undefined)}>Annuler</button>
    </div>
  </form>
{/snippet}

{#snippet editeurBesoin()}
  <form class="edit attached" use:revealed onsubmit={saveNeed}>
    <p class="titre-panneau">{needTitre}</p>
    <div class="grid">
      <label class="f">Type
        <select bind:value={needForm.kind} onchange={onNeedKindChange}>
          {#each Object.entries(NEED_KINDS) as [k, label]}<option value={k}>{label}</option>{/each}
        </select>
      </label>
      <label class="f">Nom (facultatif) <input bind:value={needForm.name} placeholder={aidesBesoin.name} /></label>
      {#if needForm.kind === 'dueDate'}
        <label class="f">Montant de l'échéance <input bind:value={needForm.amount} inputmode="decimal" placeholder={aidesBesoin.amount} /></label>
        <label class="f">Tous les (mois) <input type="number" min="1" bind:value={needForm.interval} /></label>
        <label class="f">Première échéance <input type="date" bind:value={needForm.anchorDate} /></label>
      {:else if needForm.kind === 'recurring'}
        <label class="f">Montant <input bind:value={needForm.amount} inputmode="decimal" placeholder={aidesBesoin.amount} /></label>
        <label class="f">Par période de (mois) <input type="number" min="1" bind:value={needForm.interval} /></label>
        <label class="f">Depuis le <input type="date" bind:value={needForm.anchorDate} /></label>
      {:else if needForm.kind === 'payout'}
        <p class="muted small" style="grid-column:1/-1;margin:0">
          Une réserve qui alimente le budget au lieu de le consommer : les revenus d'une saison,
          encaissés en quelques mois, reversés régulièrement le reste de l'année.
        </p>
        <label class="f">Montant à reverser <input bind:value={needForm.amount} inputmode="decimal" placeholder={aidesBesoin.amount} /></label>
        <label class="f">Réparti sur (mois) <input type="number" min="1" bind:value={needForm.interval} /></label>
        <label class="f">Depuis le <input type="date" bind:value={needForm.anchorDate} /></label>
      {:else}
        <label class="f">Mensualité <input bind:value={needForm.monthlyAmount} inputmode="decimal" placeholder={aidesBesoin.monthlyAmount} /></label>
        <label class="f">Cible (facultatif) <input bind:value={needForm.amount} inputmode="decimal" placeholder={aidesBesoin.amount} /></label>
      {/if}
      <label class="f">Priorité (petit = servi d'abord) <input type="number" min="0" bind:value={needForm.priority} /></label>
      <p class="muted small" style="grid-column:1/-1;margin:0">
        Un budget qui change ne s'édite pas : on clôt celui-ci et on en ouvre un autre, sinon les
        périodes déjà passées seraient redotées au montant d'aujourd'hui. Le bouton « Réviser » le
        fait pour vous à la frontière de période.
      </p>
      <label class="f">En vigueur à partir du <input type="date" bind:value={needForm.activeFrom} /></label>
      <label class="f">En vigueur jusqu'au <input type="date" bind:value={needForm.activeTo} /></label>
    </div>
    {#if needError}<div class="err">{needError}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (editingNeed = undefined)}>Annuler</button>
    </div>
  </form>
{/snippet}


{#snippet carte(e: Tirelire, alerte: boolean)}
  <CarteTirelire
    s={section}
    t={e}
    besoins={besoinsVisibles(e)}
    reliquat
    ajoutBesoin
    entetes
    confirmer
    alerte={alerte}
    editing={editing?.id === e.id}
    sansBesoin={sansBesoin(e)}
  >
    {#snippet enTete(e)}
      {#if alerte}
        <div class="sub">son placement vise un compte qui n'existe plus : modifiez-le pour dire où cet argent doit dormir</div>
      {:else}
        {@const bal = tirelireBalance(e, idx, app.asOf)}
        {@const pos = positionOf(e)}
        <div class="row">
          <div class="label">
            <span class="sub">
              voulu : {placementText(e)}
              <br />réel : {pos.length ? pos.map((c) => `${money(c.amount)} sur ${accountName(c.accountId)}`).join(', ') : 'rien'}
            </span>
          </div>
          <div class="num {bal < 0 ? 'neg' : ''}" style="font-size:18px">{money(bal)}</div>
        </div>
      {/if}
    {/snippet}
    {#snippet parBesoin(n)}
      {@const paidBy = paidByText(n)}
      <span class="pill">{NEED_KINDS_SHORT[n.kind]}</span>
      <span class="sub">priorité {n.priority}{#if paidBy} · {paidBy}{/if}</span>
      <span class="actions" style="margin:0">
        {#if activeAt(n, app.asOf)}
          <button class="btn small" onclick={() => reviseNeed(n)} title="Clore ce budget à la fin de la période et en ouvrir un nouveau">Réviser</button>
        {/if}
        <button class="btn small" onclick={() => startEditNeed(n)}>Modifier</button>
      </span>
    {/snippet}
    {#snippet apresBesoin(n)}
      {#if editingNeed && !editingNeed.isNew && editingNeed.need.id === n.id}
        {@render editeurBesoin()}
      {/if}
    {/snippet}
    {#snippet pied(e)}
      <div class="actions" style="margin:6px 0 0">
        <button class="btn small" onclick={() => startNewNeed(e)}>Ajouter un besoin d'un autre type</button>
        <button class="btn small" onclick={() => startEdit(e)}>Modifier</button>
      </div>
      {#if editingNeed?.isNew && editingNeed.need.tirelireId === e.id}
        {@render editeurBesoin()}
      {/if}
      {#if annonceManque && annonceManque.tirelireId === e.id}
        <div class="card warn" style="margin:8px 0 0" role="status">
          <Manque manque={annonceManque} />
          <div class="actions" style="margin:0"><button class="btn small" onclick={() => (section.derniereEcheance = undefined)}>Fermer</button></div>
        </div>
      {/if}
    {/snippet}
  </CarteTirelire>
  {#if editing?.id === e.id}
    {@render editeurTirelire()}
  {/if}
{/snippet}

{#each byPlacement as g (g.account.id)}
  <h2>{g.account.name}</h2>
  {#each g.tirelires as e (e.id)}
    {@render carte(e, false)}
  {/each}
{/each}
{#if orphans.length}
  <h2>Sans compte de placement</h2>
  {#each orphans as e (e.id)}
    {@render carte(e, true)}
  {/each}
{/if}
{#if tirelires.length === 0}
  <div class="empty">Aucune tirelire pour l'instant : les raccourcis ci-dessus, ou « Ajouter une tirelire », en créent une.</div>
{:else if masquées === tirelires.length}
  <div class="empty">Tout est masqué par le filtre : {masquées} tirelire(s) rangée(s).</div>
{/if}
