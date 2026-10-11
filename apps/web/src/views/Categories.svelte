<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { revealed } from '../lib/actions';
  import { alive, findCategoryByName, type Category, type CategoryNature } from '@tirelire/core';
  import { aideCategorieDeNature } from '../lib/aides';
  import SectionCategories from '../lib/SectionCategories.svelte';
  import FormulaireCategorie from '../lib/FormulaireCategorie.svelte';
  import { NATURES_DE_CATEGORIE, SectionCategories as SectionDesCategories } from '../lib/sectionCategories.svelte';

  /**
   * Les lignes des catégories, la correction de leur nom sur place, ce qu'elles disent, leur retrait,
   * les raccourcis de l'exemple, le formulaire d'ajout et l'explication sont la section Catégories
   * (#365), la même que celle de l'assistant : elle écrit ici dans le projet. L'écran garde ce qui lui
   * est propre (D94) — le rangement par nature puis par ordre alphabétique, chaque sous-catégorie en
   * retrait sous sa parente ; le panneau des champs avancés (D59) ; la confirmation avant de supprimer ;
   * les deux boutons qui ouvrent, sous eux, le formulaire d'ajout de la nature choisie.
   */
  const section = new SectionDesCategories(
    {
      get ledger() {
        return app.ledger;
      },
      upsert: (key, row) => app.upsert(key, row),
      remove: (key, id) => app.remove(key, id),
      newId: () => app.newId(),
    },
    // Hors de l'assistant, l'aide du nom est une catégorie de l'exemple de la nature choisie (D43).
    (restantes, toutes, nature) => aideCategorieDeNature(restantes, toutes, nature ?? 'expense'),
  );

  const categories = $derived(alive(app.ledger.categories));
  const tirelires = $derived(alive(app.ledger.tirelires));
  const byId = $derived(new Map(categories.map((c) => [c.id, c])));

  /** Le panneau des champs avancés (D59), ouvert par « Modifier » sur une catégorie. */
  let editing = $state<Category | undefined>(undefined);
  /** Ce qu'annonce le panneau : figé à l'ouverture, pour ne pas suivre la saisie en cours. */
  let titre = $state('');
  let form = $state({ nature: 'expense' as CategoryNature, parentId: '', tirelireId: '' });
  let error = $state('');

  /** Le formulaire d'ajout de la section, ouvert sous le bouton de sa nature (D59) ; ses champs avancés. */
  let ajout = $state(false);
  let avances = $state({ parentId: '', tirelireId: '' });
  const titreAjout = (nature: CategoryNature) => `Ajouter une catégorie de ${nature === 'expense' ? 'dépense' : 'revenu'}`;

  /** Une catégorie et ses descendantes : on ne la range pas sous l'une d'elles. */
  function descendantsOf(id: string): Set<string> {
    const out = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of categories) {
        if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
          out.add(c.id);
          grew = true;
        }
      }
    }
    return out;
  }
  const parentsPossibles = (nature: CategoryNature, sauf?: string) => {
    const exclues = sauf ? descendantsOf(sauf) : new Set<string>();
    return categories.filter((c) => c.nature === nature && !exclues.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  };

  /** Le rangement de l'écran : par ordre alphabétique, chaque sous-catégorie en retrait sous sa parente. */
  function ranger(nature: CategoryNature): Array<{ c: Category; retrait: boolean }> {
    const toutes = categories.filter((c) => c.nature === nature);
    const alpha = (a: Category, b: Category) => a.name.localeCompare(b.name, 'fr');
    const sortie: Array<{ c: Category; retrait: boolean }> = [];
    const vues = new Set<string>();
    const poser = (c: Category, profondeur: number) => {
      if (vues.has(c.id)) return;
      vues.add(c.id);
      sortie.push({ c, retrait: profondeur > 0 });
      for (const sous of toutes.filter((x) => x.parentId === c.id).sort(alpha)) poser(sous, profondeur + 1);
    };
    for (const racine of toutes.filter((c) => !c.parentId || !byId.has(c.parentId) || byId.get(c.parentId)!.nature !== nature).sort(alpha)) poser(racine, 0);
    return sortie;
  }

  function ouvrirAjout(nature: CategoryNature) {
    editing = undefined;
    section.vider(nature);
    avances = { parentId: '', tirelireId: '' };
    ajout = true;
  }
  /** Le parent et la tirelire par défaut dépendent de la nature : ils se vident si le choix ne tient plus. */
  function natureAjout(nature: CategoryNature) {
    if (!parentsPossibles(nature).some((c) => c.id === avances.parentId)) avances.parentId = '';
    if (nature !== 'expense') avances.tirelireId = '';
  }

  function startEdit(c: Category) {
    ajout = false;
    editing = c;
    form = { nature: c.nature, parentId: c.parentId ?? '', tirelireId: c.tirelireId ?? '' };
    titre = `Modifier la catégorie — ${c.name}`;
    error = '';
  }
  function onNatureChange() {
    if (!parentsPossibles(form.nature, editing?.id).some((c) => c.id === form.parentId)) form.parentId = '';
    if (form.nature !== 'expense') form.tirelireId = '';
  }
  function save(e: Event) {
    e.preventDefault();
    if (!editing) return;
    const actuelle = categories.find((c) => c.id === editing!.id) ?? editing;
    const clash = findCategoryByName(categories, actuelle.name, form.nature);
    if (clash && clash.id !== actuelle.id) return void (error = `Une catégorie « ${clash.name} » existe déjà pour cette nature.`);
    const { parentId: _p, tirelireId: _t, ...reste } = actuelle;
    app.upsert('categories', {
      ...reste,
      nature: form.nature,
      ...(form.parentId ? { parentId: form.parentId } : {}),
      ...(form.nature === 'expense' && form.tirelireId ? { tirelireId: form.tirelireId } : {}),
    });
    editing = undefined;
  }

  /** Supprimer retire la catégorie des flux qui la portent, comme dans l'assistant ; les opérations gardent leur ventilation. */
  function remove(c: Category) {
    section.retirer(c, () =>
      confirm(`Supprimer la catégorie « ${c.name} » ?\nElle est retirée des flux prévus qui la portent. Les opérations déjà classées avec elle gardent leur ventilation.`),
    );
    if (editing?.id === c.id && !categories.some((x) => x.id === c.id)) editing = undefined;
  }
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.back() || app.switchTab('more'); }}>‹ Configuration</a></p>
<h1>Catégories</h1>
<!-- L'assistant, ouvert sur la seule section de cet écran (D94, #363, #365) : toujours offert, base vide comprise. -->
<p class="actions"><a class="btn" href="#top" onclick={(e) => { e.preventDefault(); app.demanderAssistant('categories'); }}>Compléter avec l’assistant</a></p>

{#snippet editeur()}
  <form class="edit attached" use:revealed onsubmit={save}>
    <p class="titre-panneau">{titre}</p>
    <div class="grid">
      <label class="f">Nature
        <select bind:value={form.nature} onchange={onNatureChange}>
          {#each NATURES_DE_CATEGORIE as g}<option value={g.nature}>{g.libelle}</option>{/each}
        </select>
      </label>
      {@render champsAvances(form, form.nature, editing?.id)}
    </div>
    {#if error}<div class="err">{error}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (editing = undefined)}>Annuler</button>
    </div>
  </form>
{/snippet}

<!-- Les champs avancés (D59) : la catégorie parente, et la tirelire par défaut d'une catégorie de dépense (D32). -->
{#snippet champsAvances(v: { parentId: string; tirelireId: string }, nature: CategoryNature, sauf: string | undefined)}
  <label class="f">Catégorie parente (facultatif)
    <select bind:value={v.parentId}>
      <option value="">— (catégorie principale)</option>
      {#each parentsPossibles(nature, sauf) as c}<option value={c.id}>{c.name}</option>{/each}
    </select>
  </label>
  {#if nature === 'expense'}
    <label class="f">Tirelire par défaut (facultatif)
      <select bind:value={v.tirelireId}>
        <option value="">— (aucune)</option>
        {#each tirelires as t}<option value={t.id}>{t.name}</option>{/each}
      </select>
    </label>
  {/if}
{/snippet}

{#snippet avancesAjout()}
  {@render champsAvances(avances, section.natureSaisie, undefined)}
{/snippet}

{#snippet avantNature(nature: CategoryNature)}
  {@const g = NATURES_DE_CATEGORIE.find((x) => x.nature === nature)!}
  <div class="actions">
    <button class="btn small" onclick={() => ouvrirAjout(nature)}>Ajouter une catégorie de {g.titre.toLowerCase()}</button>
  </div>
  <!-- Le formulaire d'ajout de la section suit le bouton de sa nature, intitulé et avec les champs avancés (D59). -->
  {#if ajout && section.natureSaisie === nature}
    <div use:revealed>
      <FormulaireCategorie
        s={section}
        titre={titreAjout(nature)}
        champsAvances={() => avances}
        onnature={natureAjout}
        onajoute={() => (ajout = false)}
        onannule={() => (ajout = false)}
        avances={avancesAjout}
      />
    </div>
  {/if}
{/snippet}

{#snippet actions(c: Category)}
  <div class="actions" style="margin:0">
    <button class="btn small" onclick={() => startEdit(c)}>Modifier</button>
    <button class="btn small danger" onclick={() => remove(c)}>Supprimer</button>
  </div>
{/snippet}

{#snippet apresLigne(c: Category)}
  {#if editing?.id === c.id}
    {@render editeur()}
  {/if}
{/snippet}

<SectionCategories s={section} explicationRepliee titreNature="h2" formulaire={false} enEdition={editing?.id} {ranger} {avantNature} {actions} {apresLigne} />
