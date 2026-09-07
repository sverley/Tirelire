<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { money, moneyClass, shortDate, STATUS_LABELS, NEED_KINDS_SHORT } from '../lib/format';
  import { periodsAround, missingFlows, addDays, type Period } from '@tirelire/core';

  const plan = $derived(app.plan);
  const accountsById = $derived(new Map(app.ledger.accounts.map((a) => [a.id, a])));
  const periods = $derived(periodsAround(app.ledger, app.asOf, 2, 3));
  const hasData = $derived(app.ledger.accounts.some((a) => !a.deletedAt));

  function goTo(p: Period) {
    // Se placer au début de la période, sauf pour la période courante réelle (aujourd'hui).
    app.asOf = p.start;
  }

  const virtualLines = $derived(plan.lines.filter((l) => l.virtual));
  const transferLines = $derived(plan.lines.filter((l) => !l.virtual));
  const netOut = $derived(plan.transfers.reduce((s, t) => s + t.net, 0));
  const missing = $derived(missingFlows(app.ledger, addDays(plan.period.start, -60), app.asOf));
  // Écarts qui n'impliquent pas le pivot : ils ne sont dans aucun virement pivot ↔ compte.
  const pivotId = $derived(app.ledger.accounts.find((a) => a.kind === 'pivot' && !a.deletedAt)?.id);
  const otherGaps = $derived(plan.gaps.filter((g) => g.fromAccountId !== pivotId && g.toAccountId !== pivotId));
  const hasImports = $derived(app.ledger.operations.some((o) => o.origin === 'imported' && !o.deletedAt));
</script>

{#if !hasData}
  <div class="card accent">
    <h2 style="margin-top:0">Bienvenue dans Tirelire</h2>
    <p>Commence par créer ton compte pivot, tes enveloppes et tes flux prévus — ou charge l'exemple de l'analyse pour voir le plan tout de suite.</p>
    <div class="actions">
      <button class="btn primary" onclick={() => app.loadExample()}>Charger l'exemple</button>
      <button class="btn" onclick={() => app.go('accounts')}>Créer mes comptes</button>
      <button class="btn" onclick={() => app.go('settings')}>Importer une sauvegarde</button>
    </div>
  </div>
{:else}
  <div class="actions" style="margin-top:0">
    {#each periods as p (p.key)}
      <button class="btn small" class:primary={p.key === plan.period.key} onclick={() => goTo(p)}>{p.label}</button>
    {/each}
  </div>
  <p class="muted small">Période du {shortDate(plan.period.start)} au {shortDate(plan.period.end)}, soldes au {shortDate(plan.asOf)}.</p>

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

  <h2>Virements à faire depuis le pivot</h2>
  {#if plan.transfers.length === 0}
    <div class="empty">Aucun virement : toutes les enveloppes sont sur le pivot.</div>
  {/if}
  {#each plan.transfers as t (t.accountId)}
    <div class="card">
      <div class="row">
        <div class="label">
          <strong>{t.accountName}</strong>
          <span class="sub">{t.accountKind === 'third' ? 'compte tiers' : "compte d'accueil"}{t.label ? ' · libellé : ' : ''}{#if t.label}<span class="num">{t.label}</span>{/if}</span>
        </div>
        <div class="{moneyClass(-t.net)}" style="font-size:18px">{t.net >= 0 ? money(t.net) : `← ${money(-t.net)}`}</div>
      </div>
      {#if t.orders.length}
        <div class="orders">
          {#each t.orders as o (o.envelopeId)}
            <div class="row">
              <div class="label">
                {o.envelopeName}
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
      {#if t.standing > 0 || t.exceptional > 0}
        <div class="row"><div class="label">Virement permanent (total)</div><div class="num">{money(t.standing)}</div></div>
      {/if}
      {#if t.exceptional > 0}
        <div class="row"><div class="label">Complément exceptionnel ce mois</div><div class="num neg">{money(t.exceptional)}</div></div>
      {/if}
      {#if t.settlement !== 0}
        <div class="row">
          <div class="label">{t.settlement > 0 ? `Règlement : le pivot doit à ${t.accountName}` : `Règlement : ${t.accountName} doit au pivot`}</div>
          <div class="num">{money(Math.abs(t.settlement))}</div>
        </div>
      {/if}
      {#if t.surplus !== 0}
        <div class="row">
          <div class="label">{t.surplus > 0 ? 'Non affecté sur ce compte, à rapatrier' : 'Enveloppes non couvertes par le solde'}</div>
          <div class="num">{money(Math.abs(t.surplus))}</div>
        </div>
      {/if}
    </div>
  {/each}
  {#if plan.transfers.length > 1}
    <div class="row total"><div class="label">Total net à sortir du pivot</div><div class="num">{money(netOut)}</div></div>
  {/if}
  {#if otherGaps.length}
    <h2>Écarts entre deux comptes</h2>
    <div class="card">
      {#each otherGaps as g (g.envelopeId + g.fromAccountId)}
        <div class="row">
          <div class="label">
            {g.envelopeName}
            <span class="sub">{accountsById.get(g.fromAccountId)?.name ?? '?'} → {accountsById.get(g.toAccountId)?.name ?? '?'} · {g.status === 'watch' ? 'à surveiller' : 'à faire'}</span>
          </div>
          <div class="num">{money(g.amount)}</div>
        </div>
      {/each}
    </div>
  {/if}

  <h2>Enveloppes</h2>
  <div class="card">
    {#each [...transferLines, ...virtualLines] as l (l.needId)}
      <div class="row">
        <div class="label">
          <strong>{l.name}</strong>{#if l.name !== l.envelopeName}<span class="sub"> dans {l.envelopeName}</span>{/if} <span class="pill {l.status}">{STATUS_LABELS[l.status]}</span>
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

  <p class="muted small">Non affecté sur le pivot au {shortDate(plan.asOf)} : <span class="num">{money(plan.totals.pivotUnallocated)}</span>.</p>
{/if}
