<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, shortDate } from '../lib/format';
  import { alive, lastPeriods, reviewCategories, reviewProvisions, addMonths, budgetYearContaining, type CategoryReview, type Rule } from '@tirelire/core';

  let horizon = $state(6);
  let showIncome = $state(false);
  let openKey = $state<string | undefined>(undefined);

  const periods = $derived(lastPeriods(app.ledger, app.asOf, horizon));
  const rows = $derived(reviewCategories(app.ledger, periods).filter((r) => showIncome || r.nature === 'expense'));
  const provisions = $derived(reviewProvisions(app.ledger, addMonths(app.asOf, -24), app.asOf));
  const rules = $derived(alive(app.ledger.rules).sort((a, b) => a.priority - b.priority));
  const categories = $derived(alive(app.ledger.categories));
  const envelopes = $derived(alive(app.ledger.envelopes));
  const year = $derived(budgetYearContaining(app.asOf, app.ledger.settings.budgetYearStart.month, app.ledger.settings.budgetYearStart.day));
  const hasOps = $derived(app.ledger.operations.some((o) => !o.deletedAt));

  const keyOf = (r: CategoryReview) => `${r.categoryId ?? ''}|${r.envelopeId ?? ''}`;

  function adopt(r: CategoryReview) {
    if (!r.envelopeId || r.suggestion === undefined) return;
    const e = envelopes.find((x) => x.id === r.envelopeId);
    if (!e) return;
    const n = e.periodicity?.intervalMonths ?? 1;
    if (!confirm(`Passer le budget « ${e.name} » à ${money(r.suggestion)} par période ?`)) return;
    app.upsert('envelopes', { ...e, target: r.suggestion * n });
  }

  function gap(r: CategoryReview): number | undefined {
    if (r.target === undefined) return undefined;
    return r.avg6 - r.target;
  }

  function removeRule(rule: Rule) {
    if (confirm(`Supprimer la règle « ${rule.pattern} » ?`)) app.remove('rules', rule.id);
  }
  const categoryName = (id: string | undefined) => categories.find((c) => c.id === id)?.name;
  const envelopeName = (id: string | undefined) => envelopes.find((e) => e.id === id)?.name;
</script>

<h1>Bilan</h1>
<p class="muted small">Dépensé par période de paie et par catégorie, hors virements internes ; les dépenses ponctuelles sont exclues des moyennes. Année budgétaire {year.label} (du {shortDate(year.start)} au {shortDate(year.end)}).</p>

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
                  <tr><td>{p.label}</td><td class="n">{money(p.spent)}</td><td class="n">{p.oneOff ? money(p.oneOff) : ''}</td><td class="n">{p.count}</td></tr>
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

<h2>Règles de classement</h2>
<p class="muted small">Appliquées à l'import, dans l'ordre de priorité, aux opérations sans ventilation. On les crée depuis l'écran Opérations en classant une opération.</p>
<div class="card">
  {#each rules as rule (rule.id)}
    <div class="row">
      <div class="label"><span class="num">{rule.pattern}</span><span class="sub">→ {[categoryName(rule.categoryId), envelopeName(rule.envelopeId) ? `enveloppe ${envelopeName(rule.envelopeId)}` : undefined].filter(Boolean).join(' · ') || 'rien'} · priorité {rule.priority}</span></div>
      <button class="btn small danger" onclick={() => removeRule(rule)}>×</button>
    </div>
  {:else}
    <div class="muted">Aucune règle pour l'instant.</div>
  {/each}
</div>
