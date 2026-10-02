/**
 * Harnais d'audit de #320, point 8 du « Fait quand » : tous les textes du Bilan vouvoient (D85), ceux de
 * la lecture du passé compris. La structure, pas le comportement : les formes du tutoiement dans le
 * source de l'écran, où vivent tous ses textes.
 *
 * Retenu parmi les tests du codeur (`bilan-vouvoiement.test.ts`, d'où il est déplacé), sans changer ce
 * qu'il affirme. Niveau 2 (D83) : D85 est une décision, un texte qui tutoie en est un cas faux, l'usage
 * restant possible. Un fichier à part parce qu'il lit le source de l'interface : il relève de l'ensemble
 * « interface sans navigateur », dont l'empreinte change avec ce source, ce que celle du cœur ne fait pas.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/views/Review.svelte'), 'utf8');

describe('[niveau 2] #320 · point 8 — le Bilan vouvoie', () => {
  it('aucune forme du tutoiement dans les textes de l’écran', () => {
    const tutoiement = /\b(tu|te|toi|ton|ta|tes|tien|tienne)\b|\bt[’']|\b(Importe|saisis|Choisis|Ajoute|Crée|Regarde|Vérifie)\b/g;
    expect(source.match(tutoiement) ?? []).toEqual([]);
  });
});
