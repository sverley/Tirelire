<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { ACCOUNT_KINDS, money, moneyClass, shortDate, STATUS_LABELS, NEED_KINDS_SHORT } from '../lib/format';
  import { revealed } from '../lib/actions';
  import { centsToInput, inputToCents } from '../lib/format';
  import { computePlan, periodsAround, missingFlows, addDays, roundOrderUp, standingTransferFlow, type Period, type PlanTransfer } from '@tirelire/core';

  const accountsById = $derived(new Map(app.ledger.accounts.map((a) => [a.id, a])));
  const periods = $derived(periodsAround(app.ledger, app.asOf, 2, 3));
  const hasData = $derived(app.ledger.accounts.some((a) => !a.deletedAt));

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
  // Dans la période où l'on lit, on lit à la date de lecture ; ailleurs, au premier jour.
  const periodeAsOf = $derived(periode.start <= app.asOf && periode.end >= app.asOf ? app.asOf : periode.start);
  const plan = $derived(computePlan(app.ledger, periodeAsOf, app.asOf));

  function goTo(p: Period) {
    choisie = p;
  }

  const virtualLines = $derived(plan.lines.filter((l) => l.virtual));
  const transferLines = $derived(plan.lines.filter((l) => !l.virtual));
  const netOut = $derived(plan.transfers.reduce((s, t) => s + t.net, 0));
  const missing = $derived(missingFlows(app.ledger, addDays(plan.period.start, -60), app.asOf));
  // Écarts qui n'impliquent pas le compte principal : ils ne sont dans aucun virement principal ↔ compte.
  const principalId = $derived(app.ledger.accounts.find((a) => a.kind === 'principal' && !a.deletedAt)?.id);
  const otherGaps = $derived(plan.gaps.filter((g) => g.fromAccountId !== principalId && g.toAccountId !== principalId));
  /*
   * Enregistrer un ordre permanent, c'est écrire un **fait** (D57, D58) : le montant que la banque
   * exécute vraiment. L'application ne peut ni le connaître ni le changer là-bas, d'où la saisie —
   * proposée à la dizaine au-dessus de ce que le budget demande, parce qu'un ordre se pose rond,
   * puis corrigeable pour coller à ce qui a réellement été posé. Ce que le budget demande, lui, se
   * recalcule seul, et la ventilation du virement se rejouera au jour de l'opération.
   */
  let ordreEdite = $state<string | undefined>(undefined);
  let montantOrdre = $state('');
  let erreurOrdre = $state('');

  const pasArrondi = $derived(app.ledger.settings.orderRounding);

  function ouvrirOrdre(t: PlanTransfer) {
    ordreEdite = t.accountId;
    montantOrdre = centsToInput(roundOrderUp(t.permanent, pasArrondi));
    erreurOrdre = '';
  }

  /**
   * Le seul cas où l'ordre enregistré n'a plus lieu d'être : le budget ne demande plus rien vers ce
   * compte. Le bouton n'apparaît que là, et il y remplace « Corriger mon ordre » — la carte n'en
   * porte jamais deux. Supprimer ici n'arrête rien chez la banque : c'est le sens de la question.
   */
  function supprimerOrdre(t: PlanTransfer) {
    const id = t.bankOrder?.flowId;
    if (!id) return;
    if (!confirm(`Supprimer l'ordre permanent vers « ${t.accountName} » ?\n\nÀ faire une fois qu'il est supprimé chez ta banque — sinon le virement continuera d'arriver sans être reconnu.`)) return;
    app.remove('plannedFlows', id);
  }

  function enregistrerOrdre(e: Event, t: PlanTransfer) {
    e.preventDefault();
    if (!principalId) return;
    const montant = inputToCents(montantOrdre);
    if (montant === undefined || montant <= 0) return void (erreurOrdre = 'Montant invalide (le montant que vire ton ordre, en positif).');
    const flow = standingTransferFlow(plan, t, principalId, t.bankOrder?.flowId ?? app.newId(), montant);
    if (!flow) return;
    app.upsert('plannedFlows', flow);
    ordreEdite = undefined;
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
      ? `période à venir : soldes projetés depuis le ${shortDate(plan.today)}, les virements des périodes précédentes étant supposés faits`
      : `soldes au ${shortDate(plan.asOf)}`}.
  </p>

  <div class="stats">
    <div class="stat"><div class="v">{money(plan.totals.incomes)}</div><div class="k">Revenus prévus</div></div>
    <div class="stat"><div class="v">{money(plan.totals.fixedCharges)}</div><div class="k">Charges fixes</div></div>
    <div class="stat"><div class="v">{money(plan.totals.funded)}</div><div class="k">Réservé et viré</div></div>
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
      {#if t.orders.length}
        <div class="orders">
          {#each t.orders as o (o.tirelireId)}
            <div class="row">
              <div class="label">
                {o.tirelireName}
                <span class="sub">{o.status === 'watch' ? 'petit écart, à surveiller' : 'à faire'}</span>
              </div>
              <div class="num">
                {money(o.standing)}
                {#if o.exceptional !== 0}<span class="neg"> {o.exceptional > 0 ? '+' : '−'} {money(Math.abs(o.exceptional))} ce mois</span>{/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
      {#if t.permanent > 0 || t.exceptional > 0 || t.bankOrder}
        <div class="row">
          <div class="label">Virement permanent<span class="sub">ce que le budget demande chaque période, recalculé</span></div>
          <div class="num">{money(t.permanent)}</div>
        </div>
        {#if t.bankOrder}
          <div class="row">
            <div class="label">Ordre permanent chez la banque
              <span class="sub">
                {t.permanent === 0
                  ? 'plus demandé par le budget : à supprimer chez la banque, puis ici'
                  : t.bankOrder.drift === 0
                    ? 'au montant du budget'
                    : t.bankOrder.drift < 0 && t.bankOrder.drift >= -pasArrondi
                      ? 'arrondi au-dessus du budget : il couvre ce qui est demandé'
                      : `à passer à ${money(roundOrderUp(t.permanent, pasArrondi))} chez la banque, puis à confirmer ici`}
              </span>
            </div>
            <div class="num {t.bankOrder.drift === 0 ? '' : 'neg'}">{money(t.bankOrder.amount)}</div>
          </div>
        {/if}
        {#if t.permanent > 0 && ordreEdite !== t.accountId}
          <div class="actions" style="margin:6px 0 0">
            <button class="btn small" onclick={() => ouvrirOrdre(t)}>{t.bankOrder ? 'Corriger mon ordre' : 'Enregistrer mon ordre permanent'}</button>
          </div>
        {:else if t.permanent === 0 && t.bankOrder}
          <div class="actions" style="margin:6px 0 0">
            <button class="btn small danger" onclick={() => supprimerOrdre(t)}>Supprimer l’ordre enregistré</button>
          </div>
        {/if}
        {#if ordreEdite === t.accountId}
          <form class="edit attached" use:revealed onsubmit={(e) => enregistrerOrdre(e, t)}>
            <p class="muted small" style="margin:0">
              Le montant que <strong>ton ordre exécute chez ta banque</strong> — pas ce que le budget demande, qui se recalcule tout seul.
              Proposé arrondi au-dessus de {money(t.permanent)} ; corrige-le pour coller à ce que tu as réellement posé.
            </p>
            <div class="grid">
              <label class="f">Montant de l’ordre permanent (€) <input bind:value={montantOrdre} inputmode="decimal" /></label>
            </div>
            {#if erreurOrdre}<div class="err">{erreurOrdre}</div>{/if}
            <div class="actions" style="margin:0">
              <button class="btn primary" type="submit">Enregistrer</button>
              <button class="btn" type="button" onclick={() => (ordreEdite = undefined)}>Annuler</button>
            </div>
          </form>
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
  <div class="card">
    {#each [...transferLines, ...virtualLines] as l (l.needId)}
      <div class="row">
        <div class="label">
          <strong>{l.name}</strong>{#if l.name !== l.tirelireName}<span class="sub"> dans {l.tirelireName}</span>{/if} <span class="pill {l.status}">{STATUS_LABELS[l.status]}</span>
          <span class="sub">
            {NEED_KINDS_SHORT[l.kind]} · {accountsById.get(l.accountId)?.name ?? '?'}{l.virtual ? ' (réservé sur place)' : ''}{l.dueDate ? ` · échéance ${shortDate(l.dueDate)}` : ''}{l.target !== undefined && l.kind !== 'recurring' ? ` · cible ${money(l.target)}` : ''}
          </span>
          <span class="sub num">
            retenu <span class={l.held < 0 ? 'neg' : ''}>{money(l.held)}</span> · croisière {money(l.cruise)}{l.requested !== l.cruise ? ` · demandé ${money(l.requested)}` : ''}
          </span>
        </div>
        <div class="num" style="font-size:17px">{money(l.funded)}</div>
      </div>
    {/each}
    <div class="row total"><div class="label">Total réservé et viré</div><div class="num">{money(plan.totals.funded)}</div></div>
  </div>

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

  <p class="muted small">Non affecté sur le compte principal au {shortDate(plan.today)} : <span class="num">{money(plan.totals.principalUnallocated)}</span>.</p>
{/if}
