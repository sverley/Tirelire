<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { revealed } from '../lib/actions';
  import { alive, findCategoryByName, type Category, type CategoryNature } from '@tirelire/core';

  let editing = $state<Category | undefined>(undefined);
  let form = $state({ name: '', nature: 'expense' as CategoryNature, parentId: '', tirelireId: '' });
  let error = $state('');

  const categories = $derived(alive(app.ledger.categories));
  const tirelires = $derived(alive(app.ledger.tirelires));
  const budgetTirelires = $derived(tirelires);
  const byId = $derived(new Map(categories.map((c) => [c.id, c])));
  const tirelireName = (id: string | undefined) => tirelires.find((e) => e.id === id)?.name;

  /** Une catégorie et elle-même (pour exclure ses descendants des parents possibles). */
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

  const parentChoices = $derived.by(() => {
    const excluded = editing ? descendantsOf(editing.id) : new Set<string>();
    return categories.filter((c) => c.nature === form.nature && !excluded.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  });

  function byNature(nature: CategoryNature) {
    const all = categories.filter((c) => c.nature === nature);
    const roots = all.filter((c) => !c.parentId || !byId.has(c.parentId)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const children = (id: string) => all.filter((c) => c.parentId === id).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return { roots, children };
  }

  function startNew(nature: CategoryNature) {
    editing = { id: app.newId(), name: '', nature };
    form = { name: '', nature, parentId: '', tirelireId: '' };
    error = '';
  }

  function startEdit(c: Category) {
    editing = c;
    form = { name: c.name, nature: c.nature, parentId: c.parentId ?? '', tirelireId: c.tirelireId ?? '' };
    error = '';
  }

  function onNatureChange() {
    // Le parent et la tirelire budget dépendent de la nature ; on les réinitialise si le choix ne tient plus.
    if (!parentChoices.some((c) => c.id === form.parentId)) form.parentId = '';
    if (form.nature !== 'expense') form.tirelireId = '';
  }

  function save(e: Event) {
    e.preventDefault();
    if (!editing) return;
    const name = form.name.trim();
    if (!name) return void (error = 'Le nom est obligatoire.');
    const clash = findCategoryByName(categories, name, form.nature);
    if (clash && clash.id !== editing.id) return void (error = `Une catégorie « ${clash.name} » existe déjà pour cette nature.`);
    const row: Category = {
      id: editing.id,
      name,
      nature: form.nature,
      ...(form.parentId ? { parentId: form.parentId } : {}),
      ...(form.nature === 'expense' && form.tirelireId ? { tirelireId: form.tirelireId } : {}),
    };
    app.upsert('categories', row);
    editing = undefined;
  }

  function remove(c: Category) {
    const children = categories.filter((x) => x.parentId === c.id);
    if (children.length) return void alert(`« ${c.name} » a ${children.length} sous-catégorie(s) : détache-les ou supprime-les d'abord.`);
    if (confirm(`Supprimer la catégorie « ${c.name} » ?\nLes opérations déjà classées avec elle gardent leur ventilation.`)) app.remove('categories', c.id);
  }
</script>

<p class="small"><a href="#top" onclick={(e) => { e.preventDefault(); app.back() || app.switchTab('more'); }}>‹ Configuration</a></p>
<h1>Catégories</h1>
<p class="muted small">
  Classent les opérations, indépendamment des tirelires. Une catégorie de dépense peut être liée à un budget : les
  opérations qui la portent viennent alors alimenter ce budget dans le bilan.
</p>

{#snippet editeur()}
  <form class="edit attached" use:revealed onsubmit={save}>
    <div class="grid">
      <label class="f">Nom <input bind:value={form.name} placeholder="Santé" /></label>
      <label class="f">Nature
        <select bind:value={form.nature} onchange={onNatureChange}>
          <option value="expense">Dépense</option>
          <option value="income">Revenu</option>
        </select>
      </label>
      <label class="f">Catégorie parente (facultatif)
        <select bind:value={form.parentId}>
          <option value="">— (catégorie principale)</option>
          {#each parentChoices as c}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      {#if form.nature === 'expense'}
        <label class="f">Budget consommé (facultatif)
          <select bind:value={form.tirelireId}>
            <option value="">— (simple suivi, pas de budget)</option>
            {#each budgetTirelires as e}<option value={e.id}>{e.name}</option>{/each}
          </select>
        </label>
      {/if}
    </div>
    {#if error}<div class="err">{error}</div>{/if}
    <div class="actions" style="margin:0">
      <button class="btn primary" type="submit">Enregistrer</button>
      <button class="btn" type="button" onclick={() => (editing = undefined)}>Annuler</button>
    </div>
  </form>
{/snippet}

{#each [{ nature: 'expense', title: 'Dépenses' }, { nature: 'income', title: 'Revenus' }] as g (g.nature)}
  {@const { roots, children } = byNature(g.nature as CategoryNature)}
  <h2>{g.title}</h2>
  <div class="actions">
    <button class="btn small" onclick={() => startNew(g.nature as CategoryNature)}>Ajouter une catégorie de {g.title.toLowerCase()}</button>
  </div>
  <!-- Une catégorie qu'on crée n'a pas encore de ligne : son formulaire suit le bouton, dans sa section. -->
  {#if editing && !categories.some((c) => c.id === editing?.id) && form.nature === g.nature}
    {@render editeur()}
  {/if}
  {#if roots.length === 0}
    <div class="muted">Aucune catégorie de {g.title.toLowerCase()} pour l'instant.</div>
  {/if}
  <div class="card" style="padding:0">
    {#each roots as c (c.id)}
      <div class="row" class:editing={editing?.id === c.id}>
        <div class="label">
          <strong>{c.name}</strong>
          {#if c.tirelireId}<span class="sub">budget {tirelireName(c.tirelireId)}</span>{/if}
        </div>
        <div>
          <button class="btn small" onclick={() => startEdit(c)}>Modifier</button>
          <button class="btn small danger" onclick={() => remove(c)}>Supprimer</button>
        </div>
      </div>
      {#if editing?.id === c.id}
        {@render editeur()}
      {/if}
      {#each children(c.id) as sub (sub.id)}
        <div class="row" class:editing={editing?.id === sub.id} style="padding-left:24px">
          <div class="label">
            {sub.name}
            {#if sub.tirelireId}<span class="sub">budget {tirelireName(sub.tirelireId)}</span>{/if}
          </div>
          <div>
            <button class="btn small" onclick={() => startEdit(sub)}>Modifier</button>
            <button class="btn small danger" onclick={() => remove(sub)}>Supprimer</button>
          </div>
        </div>
        {#if editing?.id === sub.id}
          {@render editeur()}
        {/if}
      {/each}
    {/each}
  </div>
{/each}
