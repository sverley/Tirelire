<!--
  La section Tirelires (#361) : les cartes des tirelires d'un genre de besoin, leurs lignes corrigées
  sur place, l'ajout d'un besoin, les raccourcis de l'exemple (D46), le formulaire d'ajout et ses
  aides (#214), et le texte qui explique le concept. Écrite une fois ; l'endroit qui l'emploie donne
  la section (où elle écrit), le genre, les cartes à montrer (leur rangement) et si le texte
  d'explication est affiché (l'assistant) ou replié (un écran).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { divideCents, monthsOf, todayISO, type Cents, type Need, type Tirelire } from '@tirelire/core';
  import { money, centsToInput, inputToCents, openAccounts, validityBadge, validityLabel } from './format';
  import { montantAide, montantDeLaTirelire } from './aides';
  import type { GenreDeLaSection, SectionTirelires } from './sectionTirelires.svelte';

  let {
    s,
    genre,
    cartes,
    explicationRepliee = false,
  }: { s: SectionTirelires; genre: GenreDeLaSection; cartes: Array<{ t: Tirelire; besoins: Need[] }>; explicationRepliee?: boolean } = $props();

  const restants = $derived(s.restantes(genre));
  const comptesOuverts = $derived(openAccounts(s.accounts, s.asOf));
  const perPeriod = (amount: Cents, months: number) => divideCents(amount, Math.max(1, months));
  const perPreview = $derived.by(() => {
    const a = inputToCents(s.per.amount);
    return a === undefined || a <= 0 ? undefined : perPeriod(a, Number(s.evEcheance.months) || 1);
  });
  const savPreview = $derived.by(() => {
    const m = inputToCents(s.sav.monthly);
    const t = inputToCents(s.sav.target);
    if (m === undefined || m <= 0 || t === undefined || t <= 0) return undefined;
    return Math.ceil(t / m);
  });
</script>

{#snippet explication(texte: Snippet)}
  {#if explicationRepliee}
    <details class="explication muted small"><summary>Comprendre</summary><p>{@render texte()}</p></details>
  {:else}
    <p class="muted small">
      {@render texte()}
    </p>
  {/if}
{/snippet}

{#snippet enTeteTirelire(t: Tirelire, reliquat: boolean)}
  <!-- La tirelire : son nom, ce qui y est déjà mis de côté, son reliquat ; ses besoins suivent. -->
  <div class="ligne-tirelire">
    <input class="nom" value={t.name} aria-label="Nom de la tirelire" onchange={(e) => s.editTirelireName(t, e.currentTarget.value)} />
    <label class="deja small">Déjà de côté
      <input class="mt" value={centsToInput(t.openingBalance)} inputmode="decimal" onchange={(e) => s.editOpeningBalance(t, e.currentTarget.value)} />
    </label>
    {#if reliquat}
      <label class="garde small" title="Garder ce qui n'a pas été dépensé">
        <input type="checkbox" checked={t.rollover?.mode !== 'none'} onchange={(e) => s.editRollover(t, e.currentTarget.checked)} /> garder
      </label>
    {/if}
    <button class="btn small danger" title="Retirer cette tirelire" onclick={() => s.removeTirelire(t)}>×</button>
  </div>
{/snippet}

{#snippet quoi(n: Need, seul: string)}
  <!-- Un besoin qui porte son nom le montre, modifiable : c'est un besoin de la tirelire (D28). -->
  {#if n.name !== undefined}
    <input class="besoin" value={n.name} aria-label="Nom du besoin" onchange={(e) => s.editNeedOwnName(n, e.currentTarget.value)} />
  {:else}
    <span class="quoi muted small">{seul}</span>
  {/if}
{/snippet}

{#snippet suiteBesoin(n: Need, besoins: Need[])}
  {#if besoins.length > 1}
    <button class="btn small danger" title="Retirer ce besoin" onclick={() => s.removeNeed(n)}>×</button>
  {:else}
    <span></span>
  {/if}
  {#if validityLabel(n)}
    <!-- Une ligne que l'exemple borne le dit, avec sa date : deux versions d'un besoin sont deux lignes (D51). -->
    <p class="muted small suite">
      {#if validityBadge(n, s.asOf)}<span class="pill dim">{validityBadge(n, s.asOf)}</span> {/if}{validityLabel(n)}
    </p>
  {/if}
{/snippet}

{#if genre === 'everyday'}
  {#snippet texte()}
    Courses, essence, restaurants : le montant varie, mais vous voulez vous fixer une limite par
    période et voir ce qu'il en reste. C'est une tirelire qui se remplit à chaque paie.
  {/snippet}
  {@render explication(texte)}
  <h3>Budgets par période</h3>
  <div class="tete tete-courant"><span>Quoi ?</span><span class="d">Par période</span><span></span><span></span></div>
  {#each cartes as { t, besoins } (t.id)}
    <div class="card tirelire">
      {@render enTeteTirelire(t, true)}
      {#each besoins as n (n.id)}
        <div class="ligne ligne-courant">
          {@render quoi(n, 'Par période')}
          <input class="mt" value={centsToInput(n.amount ?? 0)} inputmode="decimal" aria-label="Par période" onchange={(e) => s.editNeedAmount(n, e.currentTarget.value)} />
          <span class="vide"></span>
          {@render suiteBesoin(n, besoins)}
        </div>
      {/each}
      <!-- Un besoin de plus sur cette tirelire (D28) : un nom et un montant par période. -->
      <form class="ajout-besoin" onsubmit={(e) => { e.preventDefault(); s.addNeedTo(t); }}>
        <input class="besoin-nom" aria-label="Nom du besoin à ajouter" value={s.saisieDuBesoin(t).name} placeholder={s.aideBesoinAjoute?.name} oninput={(e) => (s.ajoutBesoin[t.id] = { ...s.saisieDuBesoin(t), name: e.currentTarget.value })} />
        <input class="mt" aria-label="Montant par période du besoin à ajouter" inputmode="decimal" value={s.saisieDuBesoin(t).amount} placeholder={s.aideBesoinAjoute ? montantAide(s.aideBesoinAjoute.amount) : undefined} oninput={(e) => (s.ajoutBesoin[t.id] = { ...s.saisieDuBesoin(t), amount: e.currentTarget.value })} />
        <button class="btn small" type="submit">Ajouter un besoin</button>
        {#if s.saisieDuBesoin(t).error}<div class="err">{s.saisieDuBesoin(t).error}</div>{/if}
      </form>
    </div>
  {/each}
  {#if restants.length}
    <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
    <div class="propositions">
      {#each restants as p (p.name)}
        <button class="prop" onclick={() => s.appliquer(p)}>
          <span class="n">+ {p.name}</span><span class="v num">{money(montantDeLaTirelire(p, s.asOf))}</span>
        </button>
      {/each}
    </div>
  {/if}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); s.addEveryday(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={s.day.name} placeholder={s.aideBudget?.name} /></label>
      <label class="f">Combien par période ? <input bind:value={s.day.amount} inputmode="decimal" placeholder={s.aideBudget ? montantAide(s.aideBudget.amount) : undefined} /></label>
      <label class="f check"><input type="checkbox" checked={s.gardeBudget} onchange={(e) => (s.day.keep = e.currentTarget.checked)} /> Garder ce qui n'a pas été dépensé</label>
    </div>
    {#if s.dayError}<div class="err">{s.dayError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter</button></div>
  </form>
{:else if genre === 'periodic'}
  {#snippet texte()}
    C'est ici que les tirelires servent vraiment. Donnez le montant de la facture et sa date : Tirelire
    répartit la somme sur les paies qui restent d'ici là, et vous n'aurez pas de mauvaise surprise.
  {/snippet}
  {@render explication(texte)}
  <h3>Dépenses à échéance</h3>
  <div class="tete tete-echeance"><span>Quoi ?</span><span class="d">Montant</span><span>Prochaine échéance</span><span></span></div>
  {#each cartes as { t, besoins } (t.id)}
    <div class="card tirelire">
      {@render enTeteTirelire(t, false)}
      {#each besoins as n (n.id)}
        <div class="ligne ligne-echeance">
          {@render quoi(n, 'La facture')}
          <input class="mt" value={centsToInput(n.amount ?? 0)} inputmode="decimal" aria-label="Montant" onchange={(e) => s.editNeedAmount(n, e.currentTarget.value)} />
          <input class="date" type="date" value={n.periodicity?.anchorDate ?? todayISO()} aria-label="Prochaine échéance" onchange={(e) => s.editNeedDueDate(n, e.currentTarget.value)} />
          {@render suiteBesoin(n, besoins)}
          <p class="muted small suite">
            {money(perPeriod(n.amount ?? 0, n.periodicity ? monthsOf(n.periodicity) : 12))} à mettre de côté par mois.
          </p>
        </div>
      {/each}
      <!-- L'étape dit, pour chaque échéance, si un prélèvement y est attendu (D40). -->
      <label class="prelevement small">
        <input type="checkbox" checked={s.prelevementsDe(t).length > 0} onchange={(e) => s.editPrelevement(t, besoins[0]!, e.currentTarget.checked)} />
        {#if s.prelevementsDe(t).length}
          Prélèvement attendu : {#each s.prelevementsDe(t) as f, i (f.id)}{i ? ', ' : ''}« {f.name} », {money(Math.abs(f.amount))} sur {s.nomDuCompte(f.accountId)}{/each}
        {:else}
          Aucun prélèvement attendu
        {/if}
      </label>
    </div>
  {/each}
  {#if restants.length}
    <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
    <div class="propositions">
      {#each restants as p (p.name)}
        <button class="prop" onclick={() => s.appliquer(p)}>
          <span class="n">+ {p.name}</span><span class="v num">{money(montantDeLaTirelire(p, s.asOf))}</span>
        </button>
      {/each}
    </div>
  {/if}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); s.addPeriodic(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={s.per.name} placeholder={s.aideEcheance?.name} /></label>
      <label class="f">Montant de la facture <input bind:value={s.per.amount} inputmode="decimal" placeholder={s.aideEcheance ? montantAide(s.aideEcheance.amount) : undefined} /></label>
      <label class="f">Elle revient tous les <input type="number" min="1" value={s.evEcheance.months} oninput={(e) => (s.per.months = e.currentTarget.value)} /> mois</label>
      <label class="f">Prochaine échéance <input type="date" value={s.evEcheance.dueDate} oninput={(e) => (s.per.dueDate = e.currentTarget.value)} /></label>
        {#if comptesOuverts.length > 1}
          <label class="f">Sur quel compte ?
            <select value={s.evEcheance.accountId} onchange={(e) => (s.per.accountId = e.currentTarget.value)}>
              {#each comptesOuverts as a}<option value={a.id}>{a.name}</option>{/each}
            </select>
          </label>
        {/if}
      <label class="f check"><input type="checkbox" checked={s.evEcheance.withFlow} onchange={(e) => (s.per.withFlow = e.currentTarget.checked)} /> Attendre le prélèvement à cette date</label>
    </div>
    {#if perPreview !== undefined}
      <p class="small" style="margin:0">
        Soit <strong>{money(perPreview)}</strong> à mettre de côté par mois.
      </p>
    {/if}
    {#if s.perError}<div class="err">{s.perError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter</button></div>
  </form>
{:else if genre === 'savings'}
  {#snippet texte()}
    Une épargne sans date : vous décidez du montant par période, et la cible si vous en avez une.
    Elle passe après le reste — c'est ce qui est financé en dernier quand le mois est serré.
  {/snippet}
  {@render explication(texte)}
  <h3>Objectifs d'épargne</h3>
  <div class="tete tete-epargne"><span>Quoi ?</span><span class="d">Par période</span><span class="d">Cible</span><span></span></div>
  {#each cartes as { t, besoins } (t.id)}
    <div class="card tirelire">
      {@render enTeteTirelire(t, false)}
      {#each besoins as n (n.id)}
        <div class="ligne ligne-epargne">
          {@render quoi(n, 'Par période, et la cible')}
          <input class="mt" value={centsToInput(n.monthlyAmount ?? 0)} inputmode="decimal" aria-label="Par période" onchange={(e) => s.editNeedAmount(n, e.currentTarget.value)} />
          <input class="mt" value={n.amount ? centsToInput(n.amount) : ''} inputmode="decimal" placeholder="cible" aria-label="Cible" onchange={(e) => s.editNeedTarget(n, e.currentTarget.value)} />
          {@render suiteBesoin(n, besoins)}
        </div>
      {/each}
    </div>
  {/each}
  {#if restants.length}
    <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
    <div class="propositions">
      {#each restants as p (p.name)}
        <button class="prop" onclick={() => s.appliquer(p)}>
          <span class="n">+ {p.name}</span><span class="v num">{money(montantDeLaTirelire(p, s.asOf))}</span>
        </button>
      {/each}
    </div>
  {/if}
  <form class="edit" onsubmit={(e) => { e.preventDefault(); s.addSavings(); }}>
    <div class="grid">
      <label class="f">Quoi ? <input bind:value={s.sav.name} placeholder={s.aideObjectif?.name} /></label>
      <label class="f">Combien par période ? <input bind:value={s.sav.monthly} inputmode="decimal" placeholder={s.aideObjectif ? montantAide(s.aideObjectif.monthly) : undefined} /></label>
      <label class="f">Cible (facultatif) <input bind:value={s.sav.target} inputmode="decimal" placeholder={s.aideObjectif?.target !== undefined ? montantAide(s.aideObjectif.target) : undefined} /></label>
    </div>
    {#if savPreview !== undefined}
      <p class="small" style="margin:0">Cible atteinte en <strong>{savPreview} périodes</strong>.</p>
    {/if}
    {#if s.savError}<div class="err">{s.savError}</div>{/if}
    <div class="actions" style="margin:0"><button class="btn primary" type="submit">Ajouter</button></div>
  </form>
{/if}
