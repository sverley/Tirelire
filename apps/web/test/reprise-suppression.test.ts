import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Test du codeur de #306, point 9 : une saisie reprise ne se supprime pas tant que la reprise tient,
 * « depuis quelque écran que ce soit ». La règle vit dans `supprimerOperations` ; ce test garde que
 * les écrans qui suppriment une opération passent par elle, et par elle seule. La structure, pas le
 * comportement : jsdom ne joue pas `confirm`.
 */
const source = (chemin: string) => readFileSync(resolve(process.cwd(), 'src', chemin), 'utf8');

describe('[niveau 4] #306 · point 9 — toute suppression d’une opération passe par le garde de la reprise', () => {
  it('le garde demande ce qui reprend la saisie, et propose de défaire la reprise avant de supprimer', () => {
    const garde = source('lib/suppression.ts');
    expect(garde).toContain('removalBlockers(app.ledger, ids)');
    expect(garde).toContain('undoResumption(app.ledger, o.id)');
    expect(garde.indexOf('undoResumption')).toBeLessThan(garde.indexOf("app.remove('operations'"));
  });

  it.each(['views/Operations.svelte', 'views/Entries.svelte', 'views/Plan.svelte'])('%s supprime par supprimerOperations, jamais directement', (vue) => {
    const s = source(vue);
    expect(s).toContain('supprimerOperations(');
    expect(s).not.toContain("app.remove('operations'");
    expect(s).not.toContain("store.remove('operations'");
  });

  it('aucun autre écran ne supprime une opération', () => {
    for (const vue of ['Accounts', 'Categories', 'Flows', 'Import', 'Review', 'Settings', 'Tirelires', 'Wizard', 'More', 'Sync']) {
      let s = '';
      try {
        s = source(`views/${vue}.svelte`);
      } catch {
        continue;
      }
      expect(s, vue).not.toMatch(/remove\('operations'/);
    }
  });
});
