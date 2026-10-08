/**
 * Test du codeur de #13, second tour — le texte de la suite, sans import (point 7, précisé le 08/10) :
 * il ne suppose pas qu'on importe, et ne dit pas que le plan tient l'ordre pour exécuté ; il dit que
 * le plan compte l'ordre à sa date, parce qu'il est enregistré, sans le dire manquant (D52).
 */
import { describe, expect, it } from 'vitest';
import { EXPLICATION_SUITE } from '../src/lib/consigneOrdre';

describe('[niveau 4] #13 · 7 — sans import, l’ordre compte à sa date, il n’est pas tenu pour exécuté', () => {
  it('ce que dit la première phrase', () => {
    const premiere = EXPLICATION_SUITE.split('. ')[0]!;
    expect(premiere).toMatch(/^Importer vos relevés n’est pas nécessaire : sans import, /);
    expect(premiere).toMatch(/le plan compte l’ordre à sa date, parce qu’il est enregistré/);
    expect(premiere).toMatch(/ne le dit jamais manquant/);
    expect(EXPLICATION_SUITE).not.toMatch(/exécuté/);
  });
});
