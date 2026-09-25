<script lang="ts">
  /**
   * Les lignes modifiées des deux côtés depuis la dernière synchronisation (D58, I10) : pour
   * chacune, ce qu'elle est, la version retenue — la même sur toutes les instances — et celle qui
   * a été écartée, telles que la synchronisation qui les a détectées les a rendues. Rien n'est
   * écarté en silence ; le conflit n'est gardé nulle part (D58), la liste ne vit que la session.
   */
  import type { Conflict, RowState, SqlValue } from '@tirelire/core';
  import { app } from './state.svelte';
  import { money } from './format';

  const TABLES: Record<string, string> = {
    accounts: 'Compte',
    envelopes: 'Tirelire',
    needs: 'Besoin',
    categories: 'Catégorie',
    planned_flows: 'Flux prévu',
    operations: 'Opération',
    allocations: 'Ventilation',
    automations: 'Automatisme',
    devices: 'Appareil',
    import_profiles: 'Profil d’import',
    settings: 'Réglage',
  };
  const COLONNES: Record<string, string> = {
    name: 'Nom',
    label: 'Libellé',
    amount: 'Montant',
    opening_balance: 'Solde d’ouverture',
    opening_date: 'Date d’ouverture',
    date: 'Date',
    kind: 'Genre',
    periodicity: 'Rythme',
    priority: 'Priorité',
    placement: 'Placement',
    category_id: 'Catégorie',
    envelope_id: 'Tirelire',
    account_id: 'Compte',
    active_from: 'Valable du',
    active_to: 'Valable jusqu’au',
    state: 'État',
    share: 'Part',
    value: 'Valeur',
    user: 'Utilisé par',
  };
  const MONTANTS = new Set(['amount', 'opening_balance', 'monthly_amount', 'settlement_threshold']);

  function nom(c: Conflict): string {
    const pick = (r: RowState) => r.v['name'] ?? r.v['label'];
    const n = pick(c.kept) ?? pick(c.discarded);
    return typeof n === 'string' && n ? n : c.rowId;
  }

  function valeur(col: string, v: SqlValue | undefined): string {
    if (v === null || v === undefined || v === '') return '(vide)';
    if (MONTANTS.has(col) && typeof v === 'number') return money(v);
    return String(v);
  }

  interface Ecart {
    label: string;
    kept: string;
    discarded: string;
  }

  function ecarts(c: Conflict): Ecart[] {
    const out: Ecart[] = [];
    const del = (r: RowState) => !!r.v['deleted_at'];
    if (del(c.kept) !== del(c.discarded)) {
      out.push({ label: 'La ligne', kept: del(c.kept) ? 'supprimée' : 'gardée', discarded: del(c.discarded) ? 'supprimée' : 'gardée' });
    }
    const cols = new Set([...Object.keys(c.kept.v), ...Object.keys(c.discarded.v)]);
    for (const col of cols) {
      if (col === 'deleted_at') continue;
      const k = c.kept.v[col] ?? null;
      const d = c.discarded.v[col] ?? null;
      if (k === d) continue;
      out.push({ label: COLONNES[col] ?? col, kept: valeur(col, k), discarded: valeur(col, d) });
    }
    return out;
  }
</script>

{#if app.conflicts.length}
  <h2>Modifiées des deux côtés</h2>
  <div class="card warn">
    <p class="small">Ces lignes ont été modifiées sur deux appareils entre deux synchronisations. Tous les appareils retiennent la même version, la plus récente ; l'autre est écartée. Si l'écartée était la bonne, reprends-la à la main : cette liste n'est pas gardée, elle disparaît à la fermeture de l'application.</p>
    {#each app.conflicts as c (c.id)}
      <div class="conflit">
        <strong>{TABLES[c.table] ?? c.table} « {nom(c)} »</strong>
        {#each ecarts(c) as e (e.label)}
          <div class="row">
            <div class="label">{e.label}<span class="sub">retenu : <strong>{e.kept}</strong></span><span class="sub">écarté : <span class="ecarte">{e.discarded}</span></span></div>
          </div>
        {/each}
        <div class="actions" style="margin:6px 0 0"><button class="btn small" onclick={() => app.dismissConflict(c.id)}>J’ai vu</button></div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .conflit {
    padding: 8px 0;
    border-top: 1px solid var(--line, #ddd);
  }
  .ecarte {
    text-decoration: line-through;
  }
  .conflit:first-of-type {
    border-top: none;
  }
</style>
