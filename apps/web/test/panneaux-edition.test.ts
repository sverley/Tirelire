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

describe('panneaux d’édition de la Configuration', () => {
  it.each(VUES)('%s : chaque panneau est un extrait rendu au point d’usage', (vue) => {
    const texte = source(vue);
    const formulaires = positions(texte, '<form class="edit');
    expect(formulaires.length).toBeGreaterThan(0);
    for (const position of formulaires) {
      const ouvert = Math.max(...positions(texte.slice(0, position), '{#snippet'), -1);
      const referme = Math.max(...positions(texte.slice(0, position), '{/snippet}'), -1);
      expect(ouvert, `${vue} : formulaire écrit en dur au lieu d’un {#snippet}`).toBeGreaterThan(referme);
    }
  });

  it.each(VUES)('%s : chaque panneau est attaché à sa ligne et ramené à l’écran', (vue) => {
    const texte = source(vue);
    for (const position of positions(texte, '<form class="edit')) {
      const ouvrante = balise(texte, position);
      expect(ouvrante, `${vue} : panneau sans la classe « attached »`).toContain('class="edit attached"');
      expect(ouvrante, `${vue} : panneau sans use:revealed`).toContain('use:revealed');
    }
  });

  it.each(VUES)('%s : chaque panneau nomme ce qu’il modifie', (vue) => {
    const texte = source(vue);
    const formulaires = positions(texte, '<form class="edit');
    const titres = positions(texte, 'class="titre-panneau"');
    expect(titres.length, `${vue} : autant de titres que de panneaux`).toBe(formulaires.length);
    // Le titre est figé à l'ouverture : lu depuis `form.name`, il suivrait la frappe.
    expect(texte, `${vue} : titre non figé à l’ouverture`).toMatch(/^\s*(need)?[Tt]itre = /m);
  });
});
