/**
 * Test du codeur de #320, point 8, niveau 4 : les phrases que #320 ajoute vouvoient. Son autre test —
 * aucune forme du tutoiement dans le source de l'écran — est déplacé dans le harnais de l'auditeur
 * (`bilan-vouvoiement-harnais.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/views/Review.svelte'), 'utf8');

describe('[niveau 4] #320 · point 8 — le Bilan vouvoie', () => {
  it('les phrases que #320 ajoute vouvoient', () => {
    expect(source).toContain('Le Bilan lira votre budget');
    expect(source).toContain('ce que vous avez dépensé');
    expect(source).toContain('Vous y répondez dans le Plan');
  });
});
