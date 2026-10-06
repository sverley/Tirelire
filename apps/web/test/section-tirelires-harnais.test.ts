/**
 * Harnais d'audit de #361 — la section Tirelires, écrite une fois, sert les trois étapes de l'assistant.
 *
 * Sans navigateur, sur le texte des sources (tests du codeur, repris). Point 1, niveau 1 : le principe 13 et
 * I11 (« la section le rend vrai par construction », issue) ; vu rouge sur le `Wizard.svelte` de `main`.
 * Point 2, niveau 2 : D94 et D46 (où la section écrit, le garnissage d'office laissé à l'endroit).
 * Point 3 : les tests que l'issue nomme, inchangés ; point 4 : relecture de D94 et D40.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (chemin: string) => readFileSync(resolve(__dirname, '..', chemin), 'utf8');
const wizard = lire('src/views/Wizard.svelte');
const composant = lire('src/lib/SectionTirelires.svelte');
const section = lire('src/lib/sectionTirelires.svelte.ts');

describe('[niveau 1] #361 · 1 — une section Tirelires, que les trois étapes de l’assistant emploient', () => {
  it('les trois étapes Budgets, « Pas tous les mois » et Épargne emploient la section, chacune pour son genre', () => {
    for (const genre of ['everyday', 'periodic', 'savings']) {
      expect(wizard).toMatch(new RegExp(`<SectionTirelires s=\\{section\\} genre="${genre}" cartes=\\{section\\.parTirelire\\('${genre}'\\)\\} />`));
    }
  });
  it('l’assistant n’écrit plus rien des tirelires à part : ni tirelire, ni besoin, ni carte, ni formulaire d’ajout', () => {
    // Le résumé, hors de la section, touche seulement le placement d'une tirelire (« où dort chaque tirelire »).
    for (const m of wizard.matchAll(/assistantUpsert\('tirelires', \{ \.\.\.\w+, (\w+)/g)) expect(m[1]).toBe('placement');
    // Le retrait d'un compte, qui ôte la part du placement d'une tirelire, est passé dans la section Comptes (#362) : il n'en reste qu'une, le placement du résumé.
    expect([...wizard.matchAll(/assistantUpsert\('tirelires'/g)].length).toBe(1);
    expect(wizard).not.toMatch(/assistantUpsert\('needs'/);
    expect(wizard).not.toMatch(/class="card tirelire"/);
    expect(wizard).not.toMatch(/Ajouter un besoin|Garder ce qui n'a pas été dépensé|Montant de la facture|Cible \(facultatif\)/);
  });
});

describe('[niveau 2] #361 · 2 — la section ne sait pas où elle écrit : l’endroit qui l’emploie le lui donne', () => {
  it('ni le composant ni sa logique ne lisent l’application ni le brouillon', () => {
    for (const texte of [composant, section]) {
      expect(texte).not.toMatch(/from '\.\/state\.svelte'/);
      expect(texte).not.toMatch(/assistantUpsert|assistantRemove|assistantLedger/);
    }
  });
  it('l’assistant la construit sur son brouillon, et la garnit d’office lui-même (D46)', () => {
    expect(wizard).toMatch(/new Section\(\{[\s\S]*?app\.assistantLedger[\s\S]*?app\.assistantUpsert[\s\S]*?app\.assistantRemove/);
    expect(wizard).toMatch(/section\.garnir\(etape\)/);
    expect(section).not.toMatch(/projetVierge/);
  });
  it('le texte d’explication s’affiche, ou se replie quand l’endroit le demande', () => {
    expect(composant).toMatch(/explicationRepliee = false/);
    expect(composant).toMatch(/<details class="explication/);
  });
});
