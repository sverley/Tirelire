<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, moneyClass, shortDate } from '../lib/format';
  import Manque from '../lib/Manque.svelte';
  import { alive, monthsOf, lastPeriods, reviewCategories, reviewProvisions, reviewReplenishments, addMonths, budgetPeriodContaining, minDate, needActive, needCruise, nextPeriod, automationsByRank, automationLabel, readBudgetAhead, type CategoryReview, type Automation, type Need, type BudgetNeedReading } from '@tirelire/core';

  let horizon = $state(6);
  let showIncome = $state(false);
  let openKey = $state<string | undefined>(undefined);

  const periods = $derived(lastPeriods(app.ledger, app.asOf, horizon));
  const rows = $derived(reviewCategories(app.ledger, periods).filter((r) => showIncome || r.nature === 'expense'));
  const provisions = $derived(reviewProvisions(app.ledger, addMonths(app.asOf, -24), app.asOf));
  const renflouements = $derived(reviewReplenishments(app.ledger, periods));
  const rules = $derived(automationsByRank(app.ledger));
  const categories = $derived(alive(app.ledger.categories));
  const tirelires = $derived(alive(app.ledger.tirelires));
  const hasOps = $derived(app.ledger.operations.some((o) => !o.deletedAt));

  /*
   * La lecture du budget (#320, D57 : le budget d'abord) : la période en cours et les suivantes,
   * autant que le choix du nombre de périodes en demande, chacune telle que le Plan la dit (D06, D29,
   * D52). Sans moyenne : les montants du budget, période par période. Absente sans besoin (U5).
   */
  const budget = $derived(readBudgetAhead(app.ledger, app.asOf, horizon));
  let periodesDepliees = $state<string[]>([]);
  function basculerPeriode(cle: string) {
    periodesDepliees = periodesDepliees.includes(cle) ? periodesDepliees.filter((x) => x !== cle) : [...periodesDepliees, cle];
  }
  /** Ce que le Plan dit d'un besoin que les revenus ne couvrent pas entièrement. */
  const nonCouvert = (n: BudgetNeedReading) =>
    n.status === 'unfunded' ? `« ${n.name} » n’est pas couverte par les revenus` : `« ${n.name} » n’est couverte qu’en partie par les revenus`;

  const keyOf = (r: CategoryReview) => `${r.categoryId ?? ''}|${r.tirelireId ?? ''}`;

  /**
   * Adopter une cible : la suggestion porte sur la dotation par période, donc sur les besoins
   * récurrents de la tirelire (D28). S'il y en a plusieurs, on ajuste celui qui pèse le plus.
   *
   * Deux règles héritées de D50. On ne calibre que sur un besoin **en vigueur** à la date de
   * lecture : un budget clos l'an dernier n'est plus la cible d'aujourd'hui. Et on ne change pas
   * son montant en place — cela recalculerait les dotations des périodes déjà écoulées au montant
   * d'aujourd'hui, et le Bilan comparerait le passé à une cible qui n'était pas la sienne. On clôt
   * donc l'ancien besoin la veille de la période courante, et on en ouvre un nouveau.
   */
  function adopt(r: CategoryReview) {
    if (!r.tirelireId || r.suggestion === undefined) return;
    const e = tirelires.find((x) => x.id === r.tirelireId);
    if (!e) return;
    const recurring = alive(app.ledger.needs)
      .filter((n) => n.tirelireId === e.id && n.kind === 'recurring' && needActive(n, app.asOf))
      .sort((a, b) => needCruise(b) - needCruise(a));
    const need = recurring[0];
    if (!need) return;
    const others = recurring.slice(1).reduce((s, n) => s + needCruise(n), 0);
    const interval = need.periodicity ? monthsOf(need.periodicity) : 1;
    const amount = Math.max(0, r.suggestion - others) * interval;
    const rythme = interval === 1 ? 'par période' : `tous les ${interval} mois`;
    const startDay = app.ledger.settings.periodStartDay;
    const courante = budgetPeriodContaining(app.asOf, startDay);
    const suivante = nextPeriod(courante, startDay);
    if (!confirm(`Réviser « ${need.name ?? e.name} » à ${money(amount)} ${rythme} à partir du ${shortDate(suivante.start)} ?`)) return;
    // Même coupure que le bouton « Réviser » de l'écran Tirelires (D51) : à la frontière de
    // période, parce qu'une dotation est un tout (D29) et qu'on ne redote pas une période entamée.
    app.upsert('needs', { ...need, activeTo: need.activeTo ? minDate(need.activeTo, courante.end) : courante.end });
    const { activeTo: _fin, ...reste } = need;
    const suivant: Need = { ...reste, id: app.newId(), amount, activeFrom: suivante.start };
    app.upsert('needs', suivant);
  }

  function gap(r: CategoryReview): number | undefined {
    if (r.target === undefined) return undefined;
    return r.avg6 - r.target;
  }

  function removeRule(rule: Automation) {
    if (confirm(`Supprimer l’automatisme « ${automationLabel(rule)} » ?`)) app.remove('automations', rule.id);
  }

  /** Ce que l'automatisme pose, en clair. */
  function ruleEffect(rule: Automation): string {
    const parts = [categoryName(rule.action.categoryId), tirelireName(rule.action.tirelireId) ? `tirelire ${tirelireName(rule.action.tirelireId)}` : undefined].filter(Boolean);
    const state = { lock: 'verrouille', reconcile: 'rapproche', none: 'ne change pas l’état', unlock: 'déverrouille' }[rule.action.state ?? 'none'];
    return [parts.join(' · ') || 'rien', state].join(' · ');
  }
  const categoryName = (id: string | undefined) => categories.find((c) => c.id === id)?.name;
  const tirelireName = (id: string | undefined) => tirelires.find((e) => e.id === id)?.name;
</script>

<h1>Bilan</h1>

{#if !budget && !hasOps}
  <div class="card accent">
    <p style="margin-top:0">Le Bilan lira votre budget, période par période, dès qu’il y en aura un ; et ce que vous avez dépensé dès qu’il y aura des opérations, importées ou saisies.</p>
    <div class="actions" style="margin-bottom:0">
      <button class="btn primary" onclick={() => app.go('wizard')}>Construire mon budget</button>
    </div>
  </div>
{:else}
  <div class="actions" style="margin-top:0">
    {#each [3, 6, 12] as n}
      <button class="btn small" class:primary={horizon === n} onclick={() => (horizon = n)}>{n} périodes</button>
    {/each}
  </div>

  {#if budget}
    <h2>Le budget, période par période</h2>
    <p class="muted small">La période en cours et les suivantes : ce que le budget demande, ce que les revenus prévus en couvrent et la marge, comme le Plan le dit pour chacune. Des montants du budget, pas des moyennes.</p>
    {#each budget.periods as p, i (p.period.key)}
      {@const cle = p.period.key}
      <div class="card" class:warn={p.uncovered.length > 0} data-periode={cle}>
        <div class="row">
          <div class="label">
            <strong>Du {shortDate(p.period.start)} au {shortDate(p.period.end)}</strong>{#if i === 0}<span class="sub"> · période en cours</span>{/if}
          </div>
          <div style="text-align:right">
            <div class="{moneyClass(p.totals.margin)}" style="font-size:17px">{money(p.totals.margin)}</div>
            <div class="sub">marge</div>
          </div>
        </div>
        <div class="small">
          {#each [['Revenus prévus', p.totals.incomes], ['Charges fixes', p.totals.fixedCharges], ['Demandé', p.totals.requested], ['Couvert par les revenus', p.totals.funded]] as [k, v] (k)}
            <div style="display:flex;justify-content:space-between;gap:8px"><span class="muted">{k}</span><span class="num">{money(v as number)}</span></div>
          {/each}
        </div>
        {#each p.uncovered as n (n.needId)}
          <div class="row">
            <div class="label neg">{nonCouvert(n)}</div>
            <div class="num neg">{money(n.uncovered)}<span class="sub"> non couverts</span></div>
          </div>
        {/each}
        {#if p.needs.length}
          <div class="actions" style="margin:6px 0 0">
            <button class="btn small" aria-expanded={periodesDepliees.includes(cle)} onclick={() => basculerPeriode(cle)}>{periodesDepliees.includes(cle) ? 'Masquer le détail' : `Détail · ${p.needs.length} besoin${p.needs.length > 1 ? 's' : ''}`}</button>
          </div>
        {/if}
        {#if periodesDepliees.includes(cle)}
          <div class="orders">
            {#each p.needs as n (n.needId)}
              <div class="row">
                <div class="label">
                  {n.name}{#if n.name !== n.tirelireName}<span class="sub"> dans {n.tirelireName}</span>{/if}
                  <span class="sub">{n.kind === 'payout' ? `verse au budget ${money(-n.requested)}` : `demandé ${money(n.requested)} · couvert ${money(n.funded)}`}</span>
                </div>
                {#if n.uncovered > 0}<div class="num neg">{money(n.uncovered)}<span class="sub"> non couverts</span></div>{:else if n.kind !== 'payout'}<div class="sub">couvert</div>{/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    {#if budget.shortfalls.length}
      <h2>Échéances en manque</h2>
      <p class="muted small">Ce que les virements permanents ne réuniront pas à temps, sur ces périodes. Vous y répondez dans le Plan : lisser ou refuser.</p>
      <div class="card warn">
        {#each budget.shortfalls as m (m.needId + m.dueDate)}
          <Manque manque={m} repondre={false} />
        {/each}
        <div class="actions" style="margin:6px 0 0">
          <button class="btn small" onclick={() => app.go('plan')}>Répondre dans le Plan</button>
        </div>
      </div>
    {/if}
  {/if}

  {#if hasOps}
    {#if budget}<h2>Ce qui a été dépensé</h2>{/if}
    <p class="muted small">Dépensé par période de paie et par catégorie, hors virements internes ; les dépenses ponctuelles sont exclues des moyennes. Une période « partielle » commence avant la première opération connue : la comparer aux autres serait trompeur.</p>
    <div class="actions" style="margin-top:0">
      <label class="btn small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" bind:checked={showIncome} /> revenus</label>
    </div>

  <div class="card" style="padding:0">
    {#each rows as r (keyOf(r))}
      {@const g = gap(r)}
      <div style="padding:10px 16px;border-bottom:1px solid var(--line)">
        <button class="row" style="width:100%;border:0;background:none;text-align:left;cursor:pointer;color:inherit;font:inherit;padding:0" onclick={() => (openKey = openKey === keyOf(r) ? undefined : keyOf(r))}>
          <div class="label">
            <strong>{r.name}</strong>
            <span class="sub num">
              {#if r.target !== undefined}cible {money(r.target)} · {/if}moy. {money(horizon <= 3 ? r.avg3 : horizon <= 6 ? r.avg6 : r.avg12)} · de {money(r.min)} à {money(r.max)}
            </span>
            {#if g !== undefined && Math.abs(g) >= 1000}
              <span class="sub {g > 0 ? 'neg' : 'pos'}">{g > 0 ? `en moyenne ${money(g)} au-dessus du budget` : `en moyenne ${money(-g)} sous le budget`}</span>
            {/if}
          </div>
          <div class="num" style="font-size:17px">{money(r.last)}</div>
        </button>
        {#if openKey === keyOf(r)}
          <div class="tbl" style="margin-top:8px">
            <table>
              <thead><tr><th>Période</th><th class="n">Dépensé</th><th class="n">dont ponctuel</th><th class="n">Opérations</th></tr></thead>
              <tbody>
                {#each [...r.periods].reverse() as p (p.key)}
                  <tr><td>{p.label}{#if p.partial}<span class="sub" title="historique incomplet"> · partiel</span>{/if}</td><td class="n">{money(p.spent)}</td><td class="n">{p.oneOff ? money(p.oneOff) : ''}</td><td class="n">{p.count}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if r.suggestion !== undefined && r.tirelireId}
            <div class="actions" style="margin:8px 0 0">
              <span class="small">Cible suggérée (moyenne + 5 %, arrondie) : <strong class="num">{money(r.suggestion)}</strong></span>
              {#if r.suggestion !== r.target}<button class="btn small primary" onclick={() => adopt(r)}>Adopter</button>{/if}
            </div>
          {/if}
        {/if}
      </div>
    {:else}
      <div class="muted" style="padding:16px">Aucune dépense classée sur ces périodes.</div>
    {/each}
  </div>

  {#if renflouements.length}
    <h2>Renflouements</h2>
    <p class="muted small">
      Ramener de l'argent dans une tirelire est ce que le plan sert à éviter : si c'est arrivé, la
      dotation était trop basse ou la dépense n'était pas prévue. Ces montants sont tenus à l'écart
      des moyennes ci-dessus. À vous de juger si c'était un accident isolé ou un manque durable.
    </p>
    <div class="card">
      {#each renflouements as r (r.tirelireId)}
        <div class="row">
          <div class="label">
            {r.name}
            <span class="sub">
              {r.count} fois sur {periods.length} périodes ·
              {r.fromOutside ? `${money(r.fromOutside)} du dehors` : ''}{r.fromOutside && r.fromInside ? ' · ' : ''}{r.fromInside ? `${money(r.fromInside)} repris ailleurs` : ''}
              {#if r.cruise}· dotation actuelle {money(r.cruise)}{/if}
            </span>
          </div>
          <div class="num neg">{money(r.total)}</div>
        </div>
        {#if r.suggested > 0}
          <div class="row">
            <div class="label small muted" style="padding-left:8px">
              Pour ne plus avoir à renflouer, il aurait fallu doter {money(r.suggested)} de plus par période.
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if provisions.length}
    <h2>Provisions : prévu vs payé</h2>
    <div class="card">
      {#each provisions as p (p.tirelireId + p.dueDate)}
        <div class="row">
          <div class="label">{p.name}<span class="sub">échéance {shortDate(p.dueDate)} · provisionné {money(p.provisioned)} pour {money(p.target)}</span></div>
          <div class="num {p.variance > 0 ? 'neg' : ''}">{p.paid ? money(p.paid) : 'non payé'}{p.paid && p.variance !== 0 ? ` (${p.variance > 0 ? '+' : ''}${money(p.variance)})` : ''}</div>
        </div>
      {/each}
    </div>
  {/if}
  {:else}
    <h2>Ce qui a été dépensé</h2>
    <div class="empty">Avec des opérations, importées ou saisies, le Bilan ajoutera ici ce qui a été dépensé, face à ce budget.</div>
  {/if}
{/if}

<h2>Automatismes</h2>
<p class="muted small">Rejoués sur les opérations non verrouillées, du rang le plus élevé au rang 1 : le plus haut écrit en dernier. On les crée depuis l'écran Opérations : on cherche, on ajoute des actions, on enregistre.</p>
<div class="card">
  {#each rules as rule (rule.id)}
    <div class="row">
      <div class="label">
        <span class="num">{automationLabel(rule)}</span>
        <span class="sub">→ {ruleEffect(rule)}{rule.validTo ? ` · archivée le ${rule.validTo}` : ''}</span>
      </div>
      <button class="btn small danger" onclick={() => removeRule(rule)}>×</button>
    </div>
  {:else}
    <div class="muted">Aucun automatisme pour l'instant.</div>
  {/each}
</div>
