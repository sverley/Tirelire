<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, shortDate } from '../lib/format';
  import { alive, lastPeriods, reviewCategories, reviewProvisions, addMonths, needCruise, automationsByRank, automationLabel, type CategoryReview, type Automation } from '@tirelire/core';

  let horizon = $state(6);
  let showIncome = $state(false);
  let openKey = $state<string | undefined>(undefined);

  const periods = $derived(lastPeriods(app.ledger, app.asOf, horizon));
  const rows = $derived(reviewCategories(app.ledger, periods).filter((r) => showIncome || r.nature === 'expense'));
  const provisions = $derived(reviewProvisions(app.ledger, addMonths(app.asOf, -24), app.asOf));
  const rules = $derived(automationsByRank(app.ledger));
  const categories = $derived(alive(app.ledger.categories));
  const envelopes = $derived(alive(app.ledger.envelopes));
  const hasOps = $derived(app.ledger.operations.some((o) => !o.deletedAt));

  const keyOf = (r: CategoryReview) => `${r.categoryId ?? ''}|${r.envelopeId ?? ''}`;

  /**
   * Adopter une cible : la suggestion porte sur la dotation par période, donc sur les besoins
   * récurrents de l'enveloppe (D28). S'il y en a plusieurs, on ajuste celui qui pèse le plus.
   */
  function adopt(r: CategoryReview) {
    if (!r.envelopeId || r.suggestion === undefined) return;
    const e = envelopes.find((x) => x.id === r.envelopeId);
    if (!e) return;
    const recurring = alive(app.ledger.needs)
      .filter((n) => n.envelopeId === e.id && n.kind === 'recurring')
      .sort((a, b) => needCruise(b) - needCruise(a));
    const need = recurring[0];
    if (!need) return;
    const others = recurring.slice(1).reduce((s, n) => s + needCruise(n), 0);
    const interval = need.periodicity?.intervalMonths ?? 1;
    const amount = Math.max(0, r.suggestion - others) * interval;
    if (!confirm(`Passer « ${need.name ?? e.name} » à ${money(amount)} ${interval === 1 ? 'par période' : `tous les ${interval} mois`} ?`)) return;
    app.upsert('needs', { ...need, amount });
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
    const parts = [categoryName(rule.action.categoryId), envelopeName(rule.action.envelopeId) ? `enveloppe ${envelopeName(rule.action.envelopeId)}` : undefined].filter(Boolean);
    const state = { lock: 'verrouille', reconcile: 'rapproche', none: 'ne change pas l’état', unlock: 'déverrouille' }[rule.action.state ?? 'none'];
    return [parts.join(' · ') || 'rien', state].join(' · ');
  }
  const categoryName = (id: string | undefined) => categories.find((c) => c.id === id)?.name;
  const envelopeName = (id: string | undefined) => envelopes.find((e) => e.id === id)?.name;
</script>

<h1>Bilan</h1>
<p class="muted small">Dépensé par période de paie et par catégorie, hors virements internes ; les dépenses ponctuelles sont exclues des moyennes. Une période « partielle » commence avant la première opération connue : la comparer aux autres serait trompeur.</p>

<div class="actions" style="margin-top:0">
  {#each [3, 6, 12] as n}
    <button class="btn small" class:primary={horizon === n} onclick={() => (horizon = n)}>{n} périodes</button>
  {/each}
  <label class="btn small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" bind:checked={showIncome} /> revenus</label>
</div>

{#if !hasOps}
  <div class="empty">Importe des relevés ou saisis des opérations pour voir le bilan.</div>
{:else}
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
          {#if r.suggestion !== undefined && r.envelopeId}
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

  {#if provisions.length}
    <h2>Provisions : prévu vs payé</h2>
    <div class="card">
      {#each provisions as p (p.envelopeId + p.dueDate)}
        <div class="row">
          <div class="label">{p.name}<span class="sub">échéance {shortDate(p.dueDate)} · provisionné {money(p.provisioned)} pour {money(p.target)}</span></div>
          <div class="num {p.variance > 0 ? 'neg' : ''}">{p.paid ? money(p.paid) : 'non payé'}{p.paid && p.variance !== 0 ? ` (${p.variance > 0 ? '+' : ''}${money(p.variance)})` : ''}</div>
        </div>
      {/each}
    </div>
  {/if}
{/if}

<h2>Automatismes</h2>
<p class="muted small">Rejoués sur les opérations non verrouillées, du rang le plus élevé au rang 1 : le plus haut écrit en dernier. On les crée depuis l'écran Opérations : on cherche, on ajoute des actions, on enregistre.</p>
<div class="card">
  {#each rules as rule (rule.id)}
    <div class="row">
      <div class="label">
        <span class="num">{automationLabel(rule)}</span>
        <span class="sub">→ {ruleEffect(rule)}{rule.flowId ? ' · issu d’un flux' : ''}{rule.validTo ? ` · archivée le ${rule.validTo}` : ''}</span>
      </div>
      <button class="btn small danger" onclick={() => removeRule(rule)}>×</button>
    </div>
  {:else}
    <div class="muted">Aucun automatisme pour l'instant.</div>
  {/each}
</div>
