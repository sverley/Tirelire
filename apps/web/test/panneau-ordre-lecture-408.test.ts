/**
 * #408, point 2 — le panneau de correction dit chaque part sur une ligne, pendant qu'on la remplit :
 * `allocationDeSaisie` lit les parts en saisie telles qu'elles sont, sans rien refuser ; seule
 * `validerCorrection` décide de ce qui s'écrit. Sans navigateur ; la mesure à 375 × 812 px est
 * celle du harnais du registre (`navigateur/flux-derives-plan.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { allocationDeSaisie, lireVentilation, validerCorrection, type PartEnSaisie } from '../src/lib/ventilationOrdre';

const noms = { tirelires: [{ id: 't1', name: 'Vacances' }, { id: 't2', name: 'Taxe' }], categories: [{ id: 'c1', name: 'Loisirs' }] };
const p = (x: Partial<PartEnSaisie>): PartEnSaisie => ({ tirelireId: 't1', categoryId: '', forme: 'fixed', valeur: '10', ...x });

describe('[niveau 4] #408 · 2 — le panneau lit ses parts en saisie, une ligne chacune', () => {
  it('des parts complètes se lisent comme ce que le panneau écrira', () => {
    const parts = [p({ valeur: '150,00' }), p({ tirelireId: 't2', categoryId: 'c1', forme: 'percent', valeur: '10' }), p({ tirelireId: '', categoryId: 'c1', forme: 'variable', valeur: '' })];
    const v = validerCorrection('600', parts, noms);
    expect(v.ok).toBe(true);
    if (v.ok) expect(allocationDeSaisie(parts)).toEqual(v.allocation);
  });

  it('une part qu’on vient d’ajouter garde sa ligne, sans nom ni montant, à sa place', () => {
    const parts = [p({ valeur: '100' }), p({ tirelireId: '', valeur: '' }), p({ tirelireId: 't2', forme: 'variable', valeur: '' })];
    const l = lireVentilation(30000, allocationDeSaisie(parts), noms);
    expect(l.lignes.map((x) => [x.nom, x.forme, x.montant])).toEqual([
      ['Vacances', 'part fixe', 10000],
      ['', 'part fixe', 0],
      ['Taxe', 'le reste', 20000],
    ]);
  });

  it('un montant ou un pourcentage illisible se lit zéro, sans refus', () => {
    const l = lireVentilation(10000, allocationDeSaisie([p({ valeur: 'abc' }), p({ tirelireId: 't2', forme: 'percent', valeur: '-5' })]), noms);
    expect(l.lignes.map((x) => x.montant)).toEqual([0, 0]);
    expect(validerCorrection('100', [p({ valeur: 'abc' })], noms).ok).toBe(false);
  });
});
