<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { ACCOUNT_KINDS, money, moneyClass, shortDate, STATUS_LABELS, NEED_KINDS_SHORT } from '../lib/format';
  import { revealed } from '../lib/actions';
  import { centsToInput, inputToCents } from '../lib/format';
  import VentilationOrdre from '../lib/VentilationOrdre.svelte';
  import PanneauVentilation from '../lib/PanneauVentilation.svelte';
  import ExplicationVentilation from '../lib/ExplicationVentilation.svelte';
  import { avecVentilation } from '../lib/ventilationOrdre';
  import Manque from '../lib/Manque.svelte';
  import { supprimerOperations } from '../lib/suppression';
  import { alive, computePlan, correctPlannedOperation, dueDateShortfalls, periodsAround, missingFlows, periodReadingDate, addDays, roundOrderUp, shortfallsForPeriod, standingTransferFlow, proposedOrderAllocation, keepStandingOrder, resumeStandingOrderProposal, type ForecastMovement, type Operation, type Period, type PlanTransfer, type AllocationLine } from '@tirelire/core';

  const accountsById = $derived(new Map(app.ledger.accounts.map((a) => [a.id, a])));
  const periods = $derived(periodsAround(app.ledger, app.asOf, 2, 3));
  /**
   * La base porte-t-elle quelque chose de l'utilisateur ? Le compte principal naît avec toute base
   * (D40) : lui seul n'est pas une donnée. Un autre compte, une tirelire, un flux ou une opération
   * en sont.
   */
  const hasData = $derived(
    alive(app.ledger.accounts).some((a) => a.kind !== 'principal') ||
      alive(app.ledger.tirelires).length > 0 ||
      alive(app.ledger.plannedFlows).length > 0 ||
      alive(app.ledger.operations).length > 0,
  );

  /*
   * Deux dates, à ne pas confondre (D52). La **date de lecture** (`app.asOf`) dit jusqu'où les
   * soldes sont connus ; elle appartient à toute l'application et l'en-tête la montre. La
   * **période regardée** n'est qu'un curseur de cet écran : la parcourir ne doit pas faire croire
   * aux autres écrans qu'on lit à une autre date. Le curseur se remet en place tout seul quand la
   * date de lecture le fait sortir de la fenêtre affichée.
   */
  let choisie = $state<Period | undefined>(undefined);
  const periode = $derived(
    (choisie && periods.find((p) => p.key === choisie!.key)) ?? periods.find((p) => p.start <= app.asOf && p.end >= app.asOf) ?? periods[0]!,
  );
  // Dans la période où l'on lit, on lit à la date de lecture ; ailleurs, au premier jour (D52).
  const periodeAsOf = $derived(periodReadingDate(periode, app.asOf));
  const plan = $derived(computePlan(app.ledger, periodeAsOf, app.asOf));

  function goTo(p: Period) {
    choisie = p;
  }

  /*
   * Les échéances en manque, ou qui ont reçu leur réponse (#184) : le plan de la période en cours et
   * de chaque période jusqu'à leur date les signale, avec la proposition de lisser tant qu'elles
   * n'ont pas de réponse. Elles se lisent à la date de lecture, quelle que soit la période regardée.
   */
  const echeances = $derived(dueDateShortfalls(app.ledger, app.asOf));
  const manques = $derived(shortfallsForPeriod(echeances, plan.period, app.asOf));

  const virtualLines = $derived(plan.lines.filter((l) => l.virtual));
  const transferLines = $derived(plan.lines.filter((l) => !l.virtual));
  const netOut = $derived(plan.transfers.reduce((s, t) => s + t.net, 0));
  const missing = $derived(missingFlows(app.ledger, addDays(plan.period.start, -60), app.asOf));
  // Écarts qui n'impliquent pas le compte principal : ils ne sont dans aucun virement principal ↔ compte.
  const principalId = $derived(app.ledger.accounts.find((a) => a.kind === 'principal' && !a.deletedAt)?.id);
  const otherGaps = $derived(plan.gaps.filter((g) => g.fromAccountId !== principalId && g.toAccountId !== principalId));
  /*
   * Enregistrer un ordre permanent, c'est écrire un **fait** (D57, D60) : le montant que la banque
   * exécute vraiment. L'application ne peut ni le connaître ni le changer là-bas, d'où la saisie —
   * proposée à la dizaine au-dessus de ce que le budget demande, parce qu'un ordre se pose rond,
   * puis corrigeable pour coller à ce qui a réellement été posé. Ce que le budget demande, lui, se
   * recalcule seul. L'ordre s'enregistre avec la ventilation que le plan propose pour le montant
   * validé (D21, D60, #393) ; un compte qui a plusieurs ordres ne se voit proposer aucun
   * enregistrement (#393, point 10).
   */
  let ordreEdite = $state<string | undefined>(undefined);
  /** Ce qu'annonce le panneau (D59) : figé à l'ouverture, pour ne pas suivre la saisie en cours. */
  let titreOrdre = $state('');

  const pasArrondi = $derived(app.ledger.settings.orderRounding);

  /*
   * La carte montre une somme, pas la liste des tirelires : quatre lignes de plus sur un téléphone
   * noient le seul chiffre qu'on vient chercher. « Détail » les rend à qui les demande — et ce sera
   * l'endroit où diviser le virement en plusieurs ordres.
   */
  let detaille = $state<string[]>([]);

  function basculerDetail(t: PlanTransfer) {
    detaille = detaille.includes(t.accountId) ? detaille.filter((x) => x !== t.accountId) : [...detaille, t.accountId];
  }

  /** Ce qu'il reste à virer pour cette tirelire dans la période, la dotation étant déjà affichée. */
  function aVirer(t: PlanTransfer, tirelireId: string): string {
    const o = t.orders.find((x) => x.tirelireId === tirelireId);
    if (!o) return 'rien à virer ce mois-ci';
    const reste = o.standing + o.exceptional;
    return `à virer : ${money(reste)}${o.status === 'watch' ? ' · petit écart, à surveiller' : ''}`;
  }

  /** L'ordre ouvert dans le panneau de correction : sur la proposition, ou l'ordre enregistré du compte. */
  let surProposition = $state(false);
  const noms = $derived({ tirelires: alive(app.ledger.tirelires), categories: alive(app.ledger.categories) });

  function ouvrirOrdre(t: PlanTransfer, proposition: boolean) {
    ordreEdite = t.accountId;
    surProposition = proposition;
    const existant = ordreSeul(t);
    titreOrdre = proposition ? `Enregistrer mon ordre permanent — ${t.accountName}` : `Corriger mon ordre — ${existant?.name ?? t.accountName}`;
  }

  /** L'ordre enregistré d'un compte qui en a exactement un. */
  function ordreSeul(t: PlanTransfer) {
    const id = t.bankOrder?.flowId;
    return id ? app.ledger.plannedFlows.find((f) => f.id === id) : undefined;
  }
  function ordresDe(t: PlanTransfer) {
    return (t.bankOrder?.flowIds ?? []).map((id) => app.ledger.plannedFlows.find((f) => f.id === id)).filter((f) => !!f);
  }
  /** Les parts fixes dont l'écart se signale, avec ce que le budget demande pour leur tirelire (point 6). */
  function ecartsDesParts(t: PlanTransfer): Map<string, number> {
    return new Map((t.bankOrder?.parts ?? []).filter((p) => p.signaled).map((p) => [p.tirelireId, p.requested]));
  }
  /** L'écart du montant ou d'une part fixe se signale, et le budget demande encore un ordre (point 5). */
  function ecartPropose(t: PlanTransfer): boolean {
    return !!t.proposal && t.permanent > 0 && !!t.bankOrder?.flowId && !t.bankOrder.kept && (t.bankOrder.signaled || t.bankOrder.parts.some((p) => p.signaled));
  }
  /** Un ordre au compte seul, dont l'écart se signale et n'est pas gardé : il peut se garder tel quel (#205, point 1). */
  function gardable(t: PlanTransfer): boolean {
    return !!t.bankOrder?.flowId && !t.bankOrder.kept && (t.bankOrder.signaled || t.bankOrder.parts.some((p) => p.signaled));
  }
  /** Garde l'ordre tel quel, en un geste : rien de son montant ni de sa ventilation ne change (#205, points 1 et 2, I10). */
  function garderOrdre(t: PlanTransfer) {
    const f = ordreSeul(t);
    const garde = f && keepStandingOrder(t, f);
    if (garde) app.upsert('plannedFlows', garde);
  }
  /** Rend l'écart à faire, avec sa proposition (#205, point 5). */
  function reprendreProposition(t: PlanTransfer) {
    const f = ordreSeul(t);
    if (f?.kept) app.upsert('plannedFlows', resumeStandingOrderProposal(f));
  }

  /** Enregistre l'ordre proposé tel qu'il est montré, en un geste (points 2 et 5) ; rien ne s'écrit avant (I10). */
  function validerProposition(t: PlanTransfer) {
    if (!principalId || !t.proposal) return;
    const flow = standingTransferFlow(plan, t, principalId, app.newId(), t.proposal.amount, ordreSeul(t));
    if (flow) app.upsert('plannedFlows', flow);
  }

  /** Ce que montre le panneau, exactement (point 4). */
  function enregistrerPanneau(t: PlanTransfer, montant: number, allocation: AllocationLine[]) {
    if (!principalId) return;
    const existant = ordreSeul(t);
    const base = existant ?? standingTransferFlow(plan, t, principalId, app.newId(), montant);
    if (!base) return;
    app.upsert('plannedFlows', avecVentilation(base, montant, allocation));
    ordreEdite = undefined;
  }

  function supprimerOrdre(t: PlanTransfer) {
    const id = t.bankOrder?.flowId;
    if (!id) return;
    if (!confirm(`Supprimer l'ordre permanent vers « ${t.accountName} » ?\n\nÀ faire une fois qu'il est supprimé chez votre banque — sinon le virement continuera d'arriver sans être reconnu.`)) return;
    app.remove('plannedFlows', id);
  }

  /*
   * Le solde prévu d'une période à venir (D52, D88) : un chiffre par compte et par tirelire, et,
   * sur demande seulement, les opérations qui le font — repliées par défaut, sans quoi quatre mois
   * de flux noieraient le chiffre qu'on vient chercher.
   */
  let deplies = $state<string[]>([]);
  function basculerSolde(cle: string) {
    deplies = deplies.includes(cle) ? deplies.filter((x) => x !== cle) : [...deplies, cle];
  }
  const ORIGINES: Record<ForecastMovement['origin'], string> = {
    flux: 'opération prévue par ce flux',
    dotation: 'dotation de la tirelire',
    liberation: 'reliquat rendu au non affecté',
    saisie: 'saisie',
    releve: 'relevé',
    ouverture: 'solde initial',
  };
  const tirelireNom = $derived(new Map(app.ledger.tirelires.map((t) => [t.id, t.name])));

  /*
   * Corriger ou masquer une opération prévue (D88, porteur, 30/09) : une saisie qui la reprend — elle
   * vaudra tel montant, à telle date ; zéro, elle n'aura pas lieu. La retirer fait compter de nouveau
   * l'opération prévue. Rien de cela ne demande d'import.
   */
  let correction = $state<{ cle: string; flowId: string; date: string; montant: string; jour: string; signe: number } | undefined>(undefined);
  let titreCorrection = $state('');
  let erreurCorrection = $state('');
  const operationsParId = $derived(new Map(alive(app.ledger.operations).map((o) => [o.id, o])));

  function ouvrirCorrection(cle: string, m: ForecastMovement) {
    const flux = app.ledger.plannedFlows.find((f) => f.id === m.flowId);
    if (!flux) return;
    correction = { cle, flowId: flux.id, date: m.date, montant: centsToInput(Math.abs(flux.amount)), jour: m.date, signe: flux.amount < 0 ? -1 : 1 };
    titreCorrection = `Corriger l’opération prévue — ${flux.name}, ${shortDate(m.date)}`;
    erreurCorrection = '';
  }

  function enregistrerCorrection(e: Event) {
    e.preventDefault();
    if (!correction) return;
    const montant = inputToCents(correction.montant);
    if (montant === undefined || montant < 0) return void (erreurCorrection = 'Montant invalide (en positif ; zéro la masque).');
    if (!correction.jour) return void (erreurCorrection = 'La date est obligatoire.');
    app.applyPatch(correctPlannedOperation(app.ledger, correction.flowId, correction.date, correction.signe * montant, correction.jour));
    correction = undefined;
  }

  function masquer(m: ForecastMovement) {
    if (!m.flowId) return;
    app.applyPatch(correctPlannedOperation(app.ledger, m.flowId, m.date, 0, m.date));
  }

  /** La saisie qui corrige ou masque une opération prévue, s'il s'agit d'elle. */
  function correctionDe(m: ForecastMovement): Operation | undefined {
    const op = m.origin === 'saisie' && m.operationId ? operationsParId.get(m.operationId) : undefined;
    return op?.plannedFlowId && op.plannedDate ? op : undefined;
  }

  /**
   * Retirer la correction : la saisie, et l'autre côté d'un virement corrigé ; l'opération prévue
   * compte de nouveau. Reprise par une opération du relevé, elle ne se retire qu'une fois la reprise
   * défaite (#306, point 9).
   */
  function retirerCorrection(op: Operation) {
    const jumelle = op.transferOperationId ? operationsParId.get(op.transferOperationId) : undefined;
    const ids = [op.id, ...(jumelle && jumelle.origin === 'manual' && jumelle.transferOperationId === op.id ? [jumelle.id] : [])];
    supprimerOperations(ids);
  }
  const hasImports = $derived(app.ledger.operations.some((o) => o.origin === 'imported' && !o.deletedAt));
</script>

{#if !hasData}
  <div class="card accent">
    <h2 style="margin-top:0">Bienvenue dans Tirelire</h2>
    <p>Répondez à quelques questions et Tirelire construit votre budget : ce qui rentre, ce qui part, et ce qu'il faut mettre de côté pour les dépenses qui ne tombent pas tous les mois. Ou chargez l'exemple pour voir le plan tout de suite.</p>
    <div class="actions">
      <button class="btn primary" onclick={() => app.go('wizard')}>Construire mon budget</button>
      <button class="btn" onclick={() => app.loadExample()}>Charger l'exemple</button>
      <button class="btn" onclick={() => app.go('settings')}>Importer une sauvegarde</button>
    </div>
  </div>
{:else}
  <div class="actions" style="margin-top:0">
    {#each periods as p (p.key)}
      <button class="btn small" class:primary={p.key === plan.period.key} onclick={() => goTo(p)}>{p.label}</button>
    {/each}
  </div>
  <p class="muted small">
    Période du {shortDate(plan.period.start)} au {shortDate(plan.period.end)}, {plan.simulated
      ? 'période à venir : ce que chaque tirelire demande, ce qu’il faut virer pour elle, et le solde prévu des comptes et des tirelires à la fin de la période'
      : `soldes au ${shortDate(plan.asOf)}`}.
  </p>

  <div class="stats">
    <div class="stat"><div class="v">{money(plan.totals.incomes)}</div><div class="k">Revenus prévus</div></div>
    <div class="stat"><div class="v">{money(plan.totals.fixedCharges)}</div><div class="k">Charges fixes</div></div>
    <div class="stat"><div class="v">{money(plan.totals.funded)}</div><div class="k">Couvert par les revenus</div></div>
    <div class="stat">
      <div class="v {moneyClass(plan.totals.margin)}">{money(plan.totals.margin)}</div>
      <div class="k">Marge{plan.totals.cushion ? ` (coussin ${money(plan.totals.cushion)})` : ''}</div>
    </div>
  </div>

  {#if plan.warnings.length}
    <div class="warnings">
      {#each plan.warnings as w}
        <div>{w.message}</div>
      {/each}
    </div>
  {/if}

  {#if manques.length}
    <h2>Échéances en manque</h2>
    <p class="muted small">Ce qui ne sera pas réuni à temps par les virements permanents. Rien ne se lisse sans vous : acceptez, modifiez ou refusez la proposition.</p>
    <div class="card warn">
      {#each manques as m (m.needId + m.dueDate)}
        <Manque manque={m} />
      {/each}
    </div>
  {/if}

  {#if plan.forecast}
    {@const f = plan.forecast}
    <h2>Soldes prévus au {shortDate(f.period.end)}</h2>
    <p class="muted small">
      Le solde au {shortDate(f.today)}, plus les opérations saisies et les opérations prévues par les flux enregistrés, jusqu’à la fin de la période. Un virement proposé ici mais pas enregistré ne compte pas. Une opération prévue se corrige ou se masque depuis le détail.
    </p>
    {#snippet mouvements(liste: ForecastMovement[], contexte: string)}
      <div class="orders">
        {#each liste as m, i (i)}
          {@const corrigee = correctionDe(m)}
          {@const cle = `${contexte}|${m.flowId}|${m.date}`}
          <div class="row">
            <div class="label">
              {m.label}<span class="sub">{shortDate(m.date)} · {ORIGINES[m.origin]}</span>
              {#if corrigee}<span class="sub">{corrigee.amount === 0 ? 'masque' : 'corrige'} l’opération prévue du {shortDate(corrigee.plannedDate!)}</span>{/if}
            </div>
            <div class="{moneyClass(m.amount)}">{money(m.amount)}</div>
          </div>
          {#if m.origin === 'flux' && m.flowId}
            <div class="actions" style="margin:0 0 6px">
              <button class="btn small" onclick={() => ouvrirCorrection(cle, m)}>Corriger</button>
              <button class="btn small" onclick={() => masquer(m)}>Masquer</button>
            </div>
          {:else if corrigee}
            <div class="actions" style="margin:0 0 6px">
              <button class="btn small" onclick={() => retirerCorrection(corrigee)}>{corrigee.amount === 0 ? 'Rétablir l’opération prévue' : 'Retirer la correction'}</button>
            </div>
          {/if}
          {#if correction?.cle === cle}
            <form class="edit attached" use:revealed onsubmit={enregistrerCorrection}>
              <p class="titre-panneau">{titreCorrection}</p>
              <div class="grid">
                <label class="f">Montant <input bind:value={correction.montant} inputmode="decimal" /></label>
                <label class="f">Date <input type="date" bind:value={correction.jour} /></label>
              </div>
              {#if erreurCorrection}<div class="err">{erreurCorrection}</div>{/if}
              <div class="actions" style="margin:0">
                <button class="btn primary" type="submit">Enregistrer</button>
                <button class="btn" type="button" onclick={() => (correction = undefined)}>Annuler</button>
              </div>
            </form>
          {/if}
        {:else}
          <div class="muted small">Aucune opération d’ici la fin de la période.</div>
        {/each}
      </div>
    {/snippet}
    <h3>Comptes</h3>
    <div class="card">
      {#each f.accounts as a (a.id)}
        {@const cle = `compte:${a.id}`}
        <div class="row">
          <div class="label">
            {a.name}
            <span class="sub">au {shortDate(f.today)} : <span class="num">{money(a.start)}</span>{a.hosted.length ? ` · non affecté prévu ${money(a.unallocated)}` : ''}</span>
            {#if a.shortfall}<span class="sub neg">Manque : <span class="num">{money(a.shortfall.amount)}</span> le {shortDate(a.shortfall.date)}</span>{/if}
          </div>
          <div class="{moneyClass(a.end)}" style="font-size:17px">{money(a.end)}</div>
        </div>
        {#if a.movements.length || a.hosted.length}
          <div class="actions" style="margin:0 0 6px">
            <button class="btn small" aria-expanded={deplies.includes(cle)} onclick={() => basculerSolde(cle)}>{deplies.includes(cle) ? 'Masquer le détail' : `Détail · ${a.movements.length} opération${a.movements.length > 1 ? 's' : ''}`}</button>
          </div>
        {/if}
        {#if deplies.includes(cle)}
          {@render mouvements(a.movements, cle)}
          {#if a.hosted.length}
            <div class="orders">
              {#each a.hosted as h (h.tirelireId)}
                <div class="row"><div class="label">{tirelireNom.get(h.tirelireId) ?? '?'}<span class="sub">part de la tirelire sur ce compte, prévue</span></div><div class="num">{money(h.amount)}</div></div>
              {/each}
              <div class="row"><div class="label">Non affecté prévu</div><div class="num">{money(a.unallocated)}</div></div>
            </div>
          {/if}
        {/if}
      {/each}
    </div>
    <h3>Tirelires</h3>
    <div class="card">
      {#each f.tirelires as t (t.id)}
        {@const cle = `tirelire:${t.id}`}
        <div class="row">
          <div class="label">
            {t.name}
            <span class="sub">au {shortDate(f.today)} : <span class="num">{money(t.start)}</span></span>
            {#if t.shortfall}<span class="sub neg">Manque : <span class="num">{money(t.shortfall.amount)}</span> le {shortDate(t.shortfall.date)}</span>{/if}
          </div>
          <div class="{moneyClass(t.end)}" style="font-size:17px">{money(t.end)}</div>
        </div>
        {#if t.movements.length}
          <div class="actions" style="margin:0 0 6px">
            <button class="btn small" aria-expanded={deplies.includes(cle)} onclick={() => basculerSolde(cle)}>{deplies.includes(cle) ? 'Masquer le détail' : `Détail · ${t.movements.length} opération${t.movements.length > 1 ? 's' : ''}`}</button>
          </div>
        {/if}
        {#if deplies.includes(cle)}{@render mouvements(t.movements, cle)}{/if}
      {/each}
    </div>
  {/if}

  {#if hasImports && missing.length}
    <h2>Attendus, non reçus</h2>
    <div class="card warn">
      {#each missing as m (m.flowId + m.expectedDate)}
        <div class="row"><div class="label">{m.name}<span class="sub">attendu le {shortDate(m.expectedDate)}, fenêtre close le {shortDate(m.windowEnd)}</span></div><div class="num">{money(m.amount)}</div></div>
      {/each}
    </div>
  {/if}

  <h2>Virements à faire depuis le compte principal</h2>
  {#if plan.transfers.length === 0}
    <div class="empty">Aucun virement : toutes les tirelires sont sur le compte principal.</div>
  {/if}
  {#each plan.transfers as t (t.accountId)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{t.accountName}</strong>
          <span class="sub">{ACCOUNT_KINDS[t.accountKind]}{t.label ? ' · libellé : ' : ''}{#if t.label}<span class="num">{t.label}</span>{/if}</span>
        </div>
        <div class="{moneyClass(-t.net)}" style="font-size:18px">{t.net >= 0 ? money(t.net) : `← ${money(-t.net)}`}</div>
      </div>
      {#if t.permanent > 0 || t.exceptional > 0 || t.bankOrder}
        <div class="row">
          <div class="label">Virement permanent<span class="sub">somme des dotations des tirelires placées là, recalculée</span></div>
          <div class="num">{money(t.permanent)}</div>
        </div>
        {#if detaille.includes(t.accountId)}
          <div class="orders">
            {#each t.breakdown as b (b.tirelireId)}
              <div class="row">
                <div class="label">{b.tirelireName}<span class="sub">{aVirer(t, b.tirelireId)}</span></div>
                <div class="num">{money(b.cruise)}</div>
              </div>
            {/each}
          </div>
        {/if}
        {#if t.occurrences}
          <!-- Chaque occurrence de chaque ordre, lue sur son flux et nommée par lui (D12, #183, #393) :
               seulement avec suivi des opérations ; sans suivi, rien ne se pointe et le plan n'en dit rien. -->
          {#each t.occurrences as o (`${o.flowId}|${o.date}`)}
            <div class="row">
              <div class="label">{o.flowName} du {shortDate(o.date)}
                <span class="sub">{o.status === 'pointee'
                  ? 'pointé sur le relevé'
                  : o.status === 'attendue'
                    ? `attendu, jusqu'au ${shortDate(o.windowEnd)}`
                    : `attendu, non reçu : fenêtre close le ${shortDate(o.windowEnd)}`}</span>
              </div>
              <div class="num {o.status === 'nonRecue' ? 'neg' : ''}">{o.status === 'pointee' ? '✓' : o.status === 'attendue' ? '…' : '!'}</div>
            </div>
          {/each}
        {/if}
        {#if t.bankOrder}
          <div class="row">
            <div class="label">Ordre permanent chez la banque
              <span class="sub">
                {t.bankOrder.kept
                  ? (t.permanent === 0
                    ? 'gardé tel quel, à surveiller : le budget ne le demande plus'
                    : `gardé tel quel, à surveiller : le budget demande ${money(t.permanent)}`)
                  : t.permanent === 0
                  ? 'plus demandé par le budget : à supprimer chez la banque, puis ici'
                  : t.bankOrder.drift === 0
                    ? 'au montant du budget'
                    : !t.bankOrder.signaled
                      ? 'dans le pas d’arrondi du budget : rien à changer'
                      : `à passer à ${money(roundOrderUp(t.permanent, pasArrondi))} chez la banque, puis à confirmer ici`}
              </span>
            </div>
            <div class="num {t.bankOrder.drift === 0 || t.bankOrder.kept ? '' : 'neg'}">{money(t.bankOrder.amount)}</div>
          </div>
          <!-- Chaque ordre enregistré, son nom, son montant et sa ventilation telle qu'elle est enregistrée (#394, point 3). -->
          {#each ordresDe(t) as f (f.id)}
            <div class="ordre-enregistre">
              <div class="row"><div class="label">{f.name}<span class="sub">enregistré</span></div><div class="num">{money(Math.abs(f.amount))}</div></div>
              <VentilationOrdre montant={Math.abs(f.amount)} allocation={f.action?.allocation} compte={t.accountName} {noms} ecarts={ecartsDesParts(t)} />
            </div>
          {/each}
        {/if}
        {#if t.proposal && t.permanent > 0 && (!t.bankOrder || ecartPropose(t))}
          <!-- L'ordre que le plan propose (#394, points 2 et 5) : rien ne s'écrit avant le geste (I10). -->
          <div class="proposition">
            <div class="row"><div class="label">{t.bankOrder ? 'Ordre que le plan propose' : 'Ordre permanent proposé'}<span class="sub">arrondi au pas au-dessus de {money(t.permanent)}</span></div><div class="num">{money(t.proposal.amount)}</div></div>
            <VentilationOrdre montant={t.proposal.amount} allocation={t.proposal.allocation} compte={t.accountName} {noms} />
          </div>
        {/if}
        <div class="actions" style="margin:6px 0 0">
          {#if t.proposal && t.permanent > 0 && ordreEdite !== t.accountId}
            {#if !t.bankOrder}
              <button class="btn primary" onclick={() => validerProposition(t)}>Enregistrer mon ordre permanent</button>
              <button class="btn small" onclick={() => ouvrirOrdre(t, true)}>Modifier avant d’enregistrer</button>
            {:else if ecartPropose(t)}
              <button class="btn primary" onclick={() => validerProposition(t)}>Confirmer mon nouvel ordre</button>
            {/if}
          {/if}
          {#if gardable(t) && ordreEdite !== t.accountId}
            <button class="btn small" onclick={() => garderOrdre(t)}>Garder mon ordre tel quel</button>
          {:else if t.bankOrder?.kept}
            <button class="btn small" onclick={() => reprendreProposition(t)}>Reprendre la proposition</button>
          {/if}
          {#if t.breakdown.length}
            <button class="btn small" onclick={() => basculerDetail(t)}>{detaille.includes(t.accountId) ? 'Masquer le détail' : 'Détail'}</button>
          {/if}
          {#if t.permanent > 0 && ordreEdite !== t.accountId && t.bankOrder?.flowId}
            <button class="btn small" onclick={() => ouvrirOrdre(t, false)}>Corriger mon ordre</button>
          {:else if t.permanent === 0 && t.bankOrder?.flowId}
            <button class="btn small danger" onclick={() => supprimerOrdre(t)}>Supprimer l’ordre enregistré</button>
          {/if}
        </div>
        {#if t.bankOrder || t.proposal}<ExplicationVentilation repliee />{/if}
        {#if ordreEdite === t.accountId}
          {@const existant = surProposition ? undefined : ordreSeul(t)}
          <PanneauVentilation
            titre={titreOrdre}
            montant={existant ? Math.abs(existant.amount) : (t.proposal?.amount ?? roundOrderUp(t.permanent, pasArrondi))}
            allocation={existant ? existant.action?.allocation : t.proposal?.allocation}
            compte={t.accountName}
            {noms}
            suivre={surProposition ? (m) => proposedOrderAllocation(plan, t, m) : undefined}
            onenregistrer={(m, al) => enregistrerPanneau(t, m, al)}
            onannuler={() => (ordreEdite = undefined)}
          >
            {#snippet aide()}
              <p class="muted small" style="margin:0">
                Le montant que <strong>votre ordre exécute chez votre banque</strong> — pas ce que le budget demande, qui se recalcule tout seul.
                Proposé arrondi au-dessus de {money(t.permanent)} ; corrigez-le pour coller à ce que vous avez réellement posé.
              </p>
            {/snippet}
          </PanneauVentilation>
        {/if}
      {/if}
      {#if t.exceptional > 0}
        <div class="row"><div class="label">Complément exceptionnel ce mois</div><div class="num neg">{money(t.exceptional)}</div></div>
      {/if}
      {#if t.settlement !== 0}
        <div class="row">
          <div class="label">{t.settlement > 0 ? `Règlement : le compte principal doit à ${t.accountName}` : `Règlement : ${t.accountName} doit au compte principal`}</div>
          <div class="num">{money(Math.abs(t.settlement))}</div>
        </div>
      {/if}
      {#if t.surplus !== 0}
        <div class="row">
          <div class="label">{t.surplus > 0 ? 'Non affecté sur ce compte, à rapatrier' : 'Tirelires non couvertes par le solde'}</div>
          <div class="num">{money(Math.abs(t.surplus))}</div>
        </div>
      {/if}
    </div>
  {/each}
  {#if plan.transfers.length > 1}
    <div class="row total"><div class="label">Total net à sortir du compte principal</div><div class="num">{money(netOut)}</div></div>
  {/if}
  {#if otherGaps.length}
    <h2>Écarts entre deux comptes</h2>
    <div class="card">
      {#each otherGaps as g (g.tirelireId + g.fromAccountId)}
        <div class="row">
          <div class="label">
            {g.tirelireName}
            <span class="sub">{accountsById.get(g.fromAccountId)?.name ?? '?'} → {accountsById.get(g.toAccountId)?.name ?? '?'} · {g.status === 'watch' ? 'à surveiller' : 'à faire'}</span>
          </div>
          <div class="num">{money(g.amount)}</div>
        </div>
      {/each}
    </div>
  {/if}

  <h2>Tirelires</h2>
  {#if plan.lines.length === 0}
    <p class="muted">Aucune tirelire n’est dotée sur cette période : aucun besoin de votre budget n’y est en vigueur.</p>
  {:else}
  <div class="card">
    {#each [...transferLines, ...virtualLines] as l (l.needId)}
      <div class="row">
        <div class="label">
          <strong>{l.name}</strong>{#if l.name !== l.tirelireName}<span class="sub"> dans {l.tirelireName}</span>{/if} <span class="pill {l.status}">{STATUS_LABELS[l.status]}</span>
          <span class="sub">
            {NEED_KINDS_SHORT[l.kind]} · {accountsById.get(l.accountId)?.name ?? '?'}{l.virtual ? ' (réservé sur place)' : ''}{l.dueDate ? ` · échéance ${shortDate(l.dueDate)}` : ''}{l.target !== undefined && l.kind !== 'recurring' ? ` · cible ${money(l.target)}` : ''}
          </span>
          <span class="sub num">
            retenu <span class={l.held < 0 ? 'neg' : ''}>{money(l.held)}</span> · croisière {money(l.cruise)}{l.requested !== l.cruise ? ` · demandé ${money(l.requested)}` : ''}{l.smoothing ? ` · dont lissage décidé ${money(l.smoothing)}` : ''}
          </span>
        </div>
        <div class="num" style="font-size:17px">{money(l.funded)}</div>
      </div>
    {/each}
    <div class="row total"><div class="label">Couvert par les revenus</div><div class="num">{money(plan.totals.funded)}</div></div>
  </div>
  {/if}

  <h2>Revenus de la période</h2>
  <div class="card">
    {#each plan.incomes as f (f.flowId)}
      <div class="row">
        <div class="label">{f.name}{f.variable ? ' (variable)' : ''}<span class="sub">{f.dates.map(shortDate).join(', ')}</span></div>
        <div class="num pos">{money(f.amount)}</div>
      </div>
    {:else}
      <div class="muted">Aucun revenu prévu.</div>
    {/each}
    <div class="row total"><div class="label">Total</div><div class="num">{money(plan.totals.incomes)}</div></div>
  </div>

  <h2>Charges fixes de la période</h2>
  <div class="card">
    {#each plan.fixedCharges as f (f.flowId)}
      <div class="row">
        <div class="label">{f.name}{f.variable ? ' (variable)' : ''}<span class="sub">{f.dates.map(shortDate).join(', ')}</span></div>
        <div class="num">{money(f.amount)}</div>
      </div>
    {:else}
      <div class="muted">Aucune charge fixe.</div>
    {/each}
    <div class="row total"><div class="label">Total</div><div class="num">{money(-plan.totals.fixedCharges)}</div></div>
  </div>

  {#if !plan.simulated}
    <p class="muted small">Non affecté sur le compte principal au {shortDate(plan.today)} : <span class="num">{money(plan.totals.principalUnallocated)}</span>.</p>
  {/if}
{/if}
