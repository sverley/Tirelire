import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Test du codeur de #320, point 8 : tous les textes du Bilan vouvoient (D85), ceux de la lecture du
 * passé compris. La structure, pas le comportement : les formes du tutoiement dans le source de
 * l'écran, où vivent tous ses textes.
 */
const source = readFileSync(resolve(process.cwd(), 'src/views/Review.svelte'), 'utf8');

describe('[niveau 4] #320 · point 8 — le Bilan vouvoie', () => {
  it('aucune forme du tutoiement dans les textes de l’écran', () => {
    const tutoiement = /\b(tu|te|toi|ton|ta|tes|tien|tienne)\b|\bt[’']|\b(Importe|saisis|Choisis|Ajoute|Crée|Regarde|Vérifie)\b/g;
    expect(source.match(tutoiement) ?? []).toEqual([]);
  });

  it('les phrases que #320 ajoute vouvoient', () => {
    expect(source).toContain('Le Bilan lira votre budget');
    expect(source).toContain('ce que vous avez dépensé');
    expect(source).toContain('Vous y répondez dans le Plan');
  });
});
