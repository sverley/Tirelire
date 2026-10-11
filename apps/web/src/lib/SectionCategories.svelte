<!--
  La section Catégories (#365) : les lignes des catégories, leur nom corrigé sur place, ce qu'elles
  disent de leur parente, de leur tirelire par défaut et des flux qui les portent, leur retrait, les
  raccourcis de l'exemple (D46), le formulaire d'ajout et ses aides (#214), et le texte qui explique
  la catégorie et sa tirelire par défaut (D32). Écrite une fois ; l'endroit qui l'emploie donne la
  section (où elle écrit) et ce qu'il garde en propre : le rangement des lignes (`ranger`), le niveau
  du titre de chaque nature, ce qu'il met avant les lignes d'une nature (`avantNature`), les gestes de
  la ligne à la place du « × » (`actions`) et ce qui la suit (`apresLigne`), si le formulaire d'ajout
  est toujours là (l'assistant) ou ouvert à la demande (un écran), et si le texte d'explication est
  affiché (l'assistant) ou replié (un écran).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Category, CategoryNature } from '@tirelire/core';
  import FormulaireCategorie from './FormulaireCategorie.svelte';
  import { NATURES_DE_CATEGORIE, type SectionCategories } from './sectionCategories.svelte';

  let {
    s,
    explicationRepliee = false,
    titreNature = 'h3',
    formulaire = true,
    enEdition,
    ranger,
    avantNature,
    actions,
    apresLigne,
  }: {
    s: SectionCategories;
    explicationRepliee?: boolean;
    titreNature?: 'h2' | 'h3';
    /** Le formulaire d'ajout sous les lignes : l'endroit qui l'ouvre à la demande le retire d'ici. */
    formulaire?: boolean;
    /** La catégorie dont l'endroit ouvre un panneau sous sa ligne. */
    enEdition?: string | undefined;
    /** Les lignes d'une nature, dans l'ordre où l'endroit les range, et celles qui vont en retrait. À défaut, l'ordre de la destination. */
    ranger?: (nature: CategoryNature) => Array<{ c: Category; retrait?: boolean }>;
    avantNature?: Snippet<[CategoryNature]>;
    /** Les gestes de la ligne, à la place du « × » de la section. */
    actions?: Snippet<[Category]>;
    apresLigne?: Snippet<[Category]>;
  } = $props();

  const lignes = (nature: CategoryNature) => ranger?.(nature) ?? s.deNature(nature).map((c) => ({ c, retrait: false }));
</script>

{#snippet texte()}
  Une catégorie dit à quoi sert une opération : les courses, le loyer, un salaire. Elle classe vos
  opérations sans demander de tirelire. Une catégorie de dépense peut avoir une tirelire par défaut :
  une opération ou un flux classé dans cette catégorie sans tirelire prend alors celle-là. Ce n’est
  qu’un raccourci de saisie, pas un lien comptable.
{/snippet}

{#if explicationRepliee}
  <details class="explication muted small"><summary>Comment ça marche ?</summary><p>{@render texte()}</p></details>
{:else}
  <p class="muted small">
    {@render texte()}
  </p>
{/if}

{#each NATURES_DE_CATEGORIE as g (g.nature)}
  <svelte:element this={titreNature}>{g.titre}</svelte:element>
  {@render avantNature?.(g.nature)}
  {#each lignes(g.nature) as { c, retrait } (c.id)}
    {@const detail = s.detail(c)}
    <div class="card ligne ligne-categorie" class:avec-actions={!!actions} class:sous={retrait} class:editing={enEdition === c.id}>
      <input
        class="nom"
        value={c.name}
        aria-label="Nom de la catégorie"
        onchange={(e) => {
          const champ = e.currentTarget;
          if (!s.renommer(c, champ.value)) champ.value = c.name;
        }}
      />
      {#if actions}
        {@render actions(c)}
      {:else}
        <button class="btn small danger" title="Retirer cette catégorie" onclick={() => s.retirer(c)}>×</button>
      {/if}
      {#if detail}<p class="muted small suite">{detail}</p>{/if}
    </div>
    {@render apresLigne?.(c)}
  {:else}
    <p class="muted small">{g.vide}</p>
  {/each}
{/each}
{#if s.ligneError}<div class="err">{s.ligneError}</div>{/if}

{#if s.restantes.length}
  <p class="eyebrow" style="margin:12px 0 6px">Ajouter en un geste</p>
  <div class="propositions">
    {#each s.restantes as p (p.nature + p.name)}
      <button class="prop" onclick={() => s.appliquer(p)}>
        <span class="n">+ {p.name}</span><span class="v">{p.nature === 'income' ? 'revenu' : 'dépense'}</span>
      </button>
    {/each}
  </div>
{/if}
{#if formulaire}
  <FormulaireCategorie {s} />
{/if}
