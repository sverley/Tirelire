import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * La garde de D52. Le défaut d'origine était structurel : le formulaire d'édition était écrit
 * *avant* la liste, donc il s'ouvrait en tête de document — à −1133 px du regard, sur un téléphone,
 * quand on venait de dérouler neuf tirelires, et sans que la page défile. Le bouton passait pour
 * mort. L'édition sur place le corrige en faisant du formulaire un `{#snippet}` rendu au point
 * d'usage, attaché à sa ligne et ramené dans le champ de vision.
 *
 * Ce test fige les trois conditions dont dépend cette correction, sur les cinq écrans. jsdom ne met
 * rien en page : c'est la structure qu'on garde ici, pas la géométrie — le rendu reste à vérifier
 * dans un navigateur (lot 9).
 */
const VUES = ['Accounts', 'Tirelires', 'Categories', 'Flows', 'Entries'];

// Sous jsdom, `import.meta.url` est une URL http : on repart de la racine du paquet.
const source = (vue: string) => readFileSync(resolve(process.cwd(), 'src/views', `${vue}.svelte`), 'utf8');

/** Positions successives d'un motif dans un texte. */
function positions(texte: string, motif: string): number[] {
  const trouvees: number[] = [];
  for (let i = texte.indexOf(motif); i !== -1; i = texte.indexOf(motif, i + 1)) trouvees.push(i);
  return trouvees;
}

/** Balise ouvrante complète commençant à `debut`. */
const balise = (texte: string, debut: number) => texte.slice(debut, texte.indexOf('>', debut));

/** Les trois conditions, séparées de leur source pour être rejouables sur un écran inventé. */
function extraitAuPointDUsage(vue: string, texte: string) {
  const formulaires = positions(texte, '<form class="edit');
  expect(formulaires.length).toBeGreaterThan(0);
  for (const position of formulaires) {
    const ouvert = Math.max(...positions(texte.slice(0, position), '{#snippet'), -1);
    const referme = Math.max(...positions(texte.slice(0, position), '{/snippet}'), -1);
    expect(ouvert, `${vue} : formulaire écrit en dur au lieu d’un {#snippet}`).toBeGreaterThan(referme);
  }
}

function attachéEtRamené(vue: string, texte: string) {
  for (const position of positions(texte, '<form class="edit')) {
    const ouvrante = balise(texte, position);
    expect(ouvrante, `${vue} : panneau sans la classe « attached »`).toContain('class="edit attached"');
    expect(ouvrante, `${vue} : panneau sans use:revealed`).toContain('use:revealed');
  }
}

function nommeCeQuIlModifie(vue: string, texte: string) {
  const formulaires = positions(texte, '<form class="edit');
  const titres = positions(texte, 'class="titre-panneau"');
  expect(titres.length, `${vue} : autant de titres que de panneaux`).toBe(formulaires.length);
  // Le titre est figé à l'ouverture : lu depuis `form.name`, il suivrait la frappe.
  expect(texte, `${vue} : titre non figé à l’ouverture`).toMatch(/^\s*(need)?[Tt]itre = /m);
}

describe('panneaux d’édition de la Configuration', () => {
  it.each(VUES)('%s : chaque panneau est un extrait rendu au point d’usage', (vue) => {
    extraitAuPointDUsage(vue, source(vue));
  });

  it.each(VUES)('%s : chaque panneau est attaché à sa ligne et ramené à l’écran', (vue) => {
    attachéEtRamené(vue, source(vue));
  });

  it.each(VUES)('%s : chaque panneau nomme ce qu’il modifie', (vue) => {
    nommeCeQuIlModifie(vue, source(vue));
  });
});

/**
 * Témoin rouge du harnais C9 (docs/gardes.md) : les trois mêmes conditions, rejouées sur un écran
 * volontairement écrit comme celui d'avant D52 — formulaire en tête de document, hors extrait, sans
 * attache, sans titre. Il doit échouer ; `it.fails` tient l'échec attendu (#66).
 */
const VUE_CASSÉE = [
  '<script lang="ts">',
  "  let ouvert = $state('');",
  '</script>',
  '',
  '<form class="edit" onsubmit={enregistrer}>',
  '  <label>Nom<input bind:value={form.name} /></label>',
  '</form>',
  '',
  '{#snippet ligne(t)}',
  '  <div class="row"><button onclick={() => (ouvert = t.id)}>Modifier</button></div>',
  '{/snippet}',
  '',
].join('\n');

it.fails('témoin rouge · un panneau écrit en tête de document, hors extrait et sans titre', () => {
  extraitAuPointDUsage('Cassée', VUE_CASSÉE);
  attachéEtRamené('Cassée', VUE_CASSÉE);
  nommeCeQuIlModifie('Cassée', VUE_CASSÉE);
});
