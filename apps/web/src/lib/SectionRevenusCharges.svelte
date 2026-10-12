<!--
  La section Revenus et charges fixes (#364), pour un genre : le texte qui l'explique, les lignes de
  ses flux sous leur en-tête de colonnes, corrigées sur place — nom, montant, jour ou date de la
  première occurrence, « Tous les », unité, compte quand plus d'un compte est ouvert —, avec ce
  qu'elles disent dessous (prochaine occurrence, dates de validité, D51) ; leur retrait ; les
  raccourcis de l'exemple (D46) ; le formulaire d'ajout et ses aides (#214). Écrite une fois ; l'endroit
  qui l'emploie donne la section (où elle écrit) et ce qu'il garde en propre : si le texte et le titre
  sont affichés (l'assistant) ou non (l'écran, qui replie le texte), les lignes qu'il montre (`ranger`),
  les gestes de la ligne à la place du « × » (`actions`) et ce qui la suit (`apresLigne`), si la ligne
  dit ses champs avancés (`detailAvance`, D59), et si le formulaire d'ajout est toujours là
  (l'assistant) ou ouvert à la demande (un écran).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { nextOccurrence, parseDate, type PlannedFlow } from '@tirelire/core';
  import { UNITS, centsToInput, money, shortDate, validityBadge, validityLabel } from './format';
  import FormulaireFlux from './FormulaireFlux.svelte';
  import { GENRES_DE_FLUX, type GenreDeFlux, type SectionRevenusCharges } from './sectionRevenusCharges.svelte';

  let {
    s,
    genre,
    explication = true,
    titre = true,
    formulaire = true,
    detailAvance = false,
    enEdition,
    ranger,
    actions,
    apresLigne,
  }: {
    s: SectionRevenusCharges;
    genre: GenreDeFlux;
    /** Le texte qui explique le genre, affiché : l'endroit qui le replie le montre lui-même. */
    explication?: boolean;
    /** Le titre des lignes : l'endroit qui a le sien le retire d'ici. */
    titre?: boolean;
    /** Le formulaire d'ajout sous les lignes : l'endroit qui l'ouvre à la demande le retire d'ici. */
    formulaire?: boolean;
    /** La ligne dit ses champs avancés que l'endroit montre (D59) : montant variable, verrouillage. */
    detailAvance?: boolean;
    /** Le flux dont l'endroit ouvre un panneau sous sa ligne. */
    enEdition?: string | undefined;
    /** Les lignes que l'endroit montre, dans l'ordre de la destination. À défaut, toutes. */
    ranger?: (genre: GenreDeFlux) => PlannedFlow[];
    /** Les gestes de la ligne, à la place du « × » de la section. */
    actions?: Snippet<[PlannedFlow]>;
    apresLigne?: Snippet<[PlannedFlow]>;
  } = $props();

  const g = $derived(GENRES_DE_FLUX[genre]);
  const lignes = $derived(ranger?.(genre) ?? s.deGenre(genre));
  const avecCompte = $derived(s.comptesOuverts.length > 1);
  const restants = $derived(s.restants(genre));
  /** Ce que la ligne dit de ses champs avancés, là où l'endroit les montre (D59). */
  const avance = (f: PlannedFlow) => [f.variable ? 'montant variable' : '', f.action?.state === 'lock' ? 'verrouille les opérations reprises' : ''].filter(Boolean).join(' · ');
</script>

{#if explication}
  <p class="muted small">
    {g.explication}
  </p>
{/if}

{#if titre}<h3>{g.titre}</h3>{/if}
<div class="tete tete-flux" class:avec-compte={avecCompte} class:avec-actions={!!actions}><span>Quoi ?</span><span class="d">Combien</span><span>Le</span><span>Tous les</span><span>Unité</span>{#if avecCompte}<span>Compte</span>{/if}{#if !actions}<span></span>{/if}</div>
{#each lignes as f (f.id)}
  <div class="card ligne ligne-flux" class:avec-compte={avecCompte} class:avec-actions={!!actions} class:editing={enEdition === f.id}>
    <input class="nom" value={f.name} aria-label="Nom" onchange={(e) => s.renommer(f, e.currentTarget.value)} />
    <input class="mt" value={centsToInput(Math.abs(f.amount))} inputmode="decimal" aria-label="Montant" onchange={(e) => s.changerMontant(f, e.currentTarget.value)} />
    {#if f.periodicity.unit === 'month' && f.periodicity.interval === 1}
      <input class="jour" type="number" min="1" max="31" value={parseDate(f.periodicity.anchorDate).d} aria-label="Jour du mois" onchange={(e) => s.changerJour(f, e.currentTarget.value)} />
    {:else}
      <input class="date" type="date" value={f.periodicity.anchorDate} aria-label="Première échéance" onchange={(e) => s.changerDate(f, e.currentTarget.value)} title="Première échéance ; les suivantes en découlent" />
    {/if}
    <input class="jour" type="number" min="1" value={f.periodicity.interval} aria-label="Tous les" onchange={(e) => s.changerRythme(f, 'interval', e.currentTarget.value)} />
    <select class="unite" value={f.periodicity.unit} aria-label="Unité" onchange={(e) => s.changerRythme(f, 'unit', e.currentTarget.value)}>
      {#each Object.entries(UNITS) as [u, l]}<option value={u}>{f.periodicity.interval > 1 ? l.pluriel : l.un}</option>{/each}
    </select>
    {#if avecCompte}
      <select class="cpt" value={f.accountId} aria-label="Compte" onchange={(e) => s.changerCompte(f, e.currentTarget.value)}>
        {#each s.comptesDeLaLigne(f) as a}<option value={a.id}>{a.name}</option>{/each}
      </select>
    {/if}
    {#if actions}
      {@render actions(f)}
    {:else}
      <button class="btn small danger" onclick={() => s.retirer(f)}>×</button>
    {/if}
    {#if f.periodicity.unit !== 'month' || f.periodicity.interval !== 1}
      <p class="muted small suite">Prochaine : {shortDate(nextOccurrence(f.periodicity, s.asOf))}</p>
    {/if}
    {#if validityLabel(f)}
      <!-- Une ligne que l'exemple borne le dit, avec sa date : deux versions d'un flux sont deux lignes du même nom (D51). -->
      <p class="muted small suite">
        {#if validityBadge(f, s.asOf)}<span class="pill dim">{validityBadge(f, s.asOf)}</span> {/if}{validityLabel(f)}
      </p>
    {/if}
    {#if detailAvance && avance(f)}
      <p class="muted small suite">{avance(f)}</p>
    {/if}
  </div>
  {@render apresLigne?.(f)}
{/each}
{#if restants.length}
  <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
  <div class="propositions">
    {#each restants as p (p.name)}
      <button class="prop" onclick={() => s.appliquer(p, genre)}>
        <span class="n">+ {p.name}</span><span class="v num">{money(s.montantDuRaccourci(p))}</span>
      </button>
    {/each}
  </div>
{/if}
{#if formulaire}
  <FormulaireFlux {s} {genre} />
{/if}
