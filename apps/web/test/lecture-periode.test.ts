import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Tests du codeur de #320, tour 2 (principe 13) : ce qui est proche partage le même code. La
 * structure, pas le comportement : les écrans passent par la règle et le composant communs.
 */
const source = (chemin: string) => readFileSync(resolve(process.cwd(), 'src', chemin), 'utf8');

describe('[niveau 4] #320 · tour 2 — le Plan et le Bilan partagent la règle et l’annonce', () => {
  it('le Plan lit sa période par la règle du cœur, sans la recopier', () => {
    const plan = source('views/Plan.svelte');
    expect(plan).toContain('periodReadingDate(periode, app.asOf)');
    expect(plan).not.toMatch(/periode\.start <= app\.asOf/);
  });

  it('le Bilan annonce un manque par le composant du Plan, sans la proposition ni les gestes de la réponse', () => {
    const bilan = source('views/Review.svelte');
    expect(bilan).toContain("import Manque from '../lib/Manque.svelte'");
    expect(bilan).toContain('<Manque manque={m} repondre={false} />');
    expect(bilan).not.toContain('Il manquera');
    const manque = source('lib/Manque.svelte');
    expect(manque).toMatch(/\{#if repondre\}\s*<div class="actions"/);
  });
});
