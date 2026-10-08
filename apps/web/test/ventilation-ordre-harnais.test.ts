/**
 * Harnais d'audit de #394 — la ventilation d'un ordre, sa lecture et sa correction (points 1, 4 et 7),
 * sans navigateur. Composé par l'auditeur parmi les tests du codeur ; l'écran est gardé par
 * `navigateur/ventilation-ordre-harnais.test.ts`. Niveau 2 : les règles de D21, D27, D85 et D94.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PlannedFlow } from '@tirelire/core';
import { avecVentilation, enSaisie, ligneNonAffecte, lireVentilation, validerCorrection, type PartEnSaisie } from '../src/lib/ventilationOrdre';

const noms = { tirelires: [{ id: 't1', name: 'Vacances' }, { id: 't2', name: 'Taxe' }], categories: [{ id: 'c1', name: 'Loisirs' }] };
const lire = (chemin: string) => readFileSync(resolve(__dirname, '..', chemin), 'utf8');

describe('[niveau 2] #394 · 1 — lire une ventilation', () => {
  it('une ligne par part, sa forme et son montant, par le calcul de l’opération ; le non affecté', () => {
    const l = lireVentilation(-50000, [
      { tirelireId: 't1', share: { kind: 'fixed', amount: -20000 } },
      { tirelireId: 't2', categoryId: 'c1', share: { kind: 'percent', pct: 10 } },
    ], noms);
    expect(l.lignes.map((x) => [x.nom, x.forme, x.montant])).toEqual([['Vacances', 'part fixe', 20000], ['Taxe · Loisirs', '10 %', 5000]]);
    expect(l.nonAffecte).toBe(25000);
    expect(ligneNonAffecte(l.nonAffecte, 'Livret A')).toEqual({ libelle: 'Non affecté sur « Livret A »' });
  });
  it('la part variable prend le reste : rien de non affecté', () => {
    const l = lireVentilation(30000, [{ tirelireId: 't1', share: { kind: 'fixed', amount: 10000 } }, { tirelireId: 't2', share: { kind: 'variable' } }], noms);
    expect(l.lignes[1]).toMatchObject({ forme: 'le reste', montant: 20000 });
    expect(ligneNonAffecte(l.nonAffecte, 'X')).toBeUndefined();
  });
  it('des parts qui dépassent le montant : non affecté négatif, dit', () => {
    const l = lireVentilation(10000, [{ tirelireId: 't1', share: { kind: 'fixed', amount: 15000 } }], noms);
    expect(l.nonAffecte).toBe(-5000);
    expect(ligneNonAffecte(l.nonAffecte, 'X')?.detail).toMatch(/les parts dépassent le montant de 50,00/);
  });
  it('sans parts : la seule ligne du non affecté, pour tout le montant', () => {
    const l = lireVentilation(10000, undefined, noms);
    expect(l.lignes).toEqual([]);
    expect(l.nonAffecte).toBe(10000);
  });
});

describe('[niveau 2] #394 · 4 — les refus du panneau, et ce qu’il écrit', () => {
  const p = (x: Partial<PartEnSaisie>): PartEnSaisie => ({ tirelireId: 't1', categoryId: '', forme: 'fixed', valeur: '10', ...x });
  it.each([
    ['', [], /montant de l’ordre/],
    ['0', [], /montant de l’ordre/],
    ['-5', [], /montant de l’ordre/],
    ['100', [p({ tirelireId: '' })], /ni tirelire ni catégorie/],
    ['100', [p({ forme: 'variable' }), p({ forme: 'variable', tirelireId: 't2' })], /Une seule part/],
    ['100', [p({ valeur: '' })], /son montant/],
    ['100', [p({ valeur: '0' })], /son montant/],
    ['100', [p({ forme: 'percent', valeur: '-3' })], /son pourcentage/],
    ['100', [p({ forme: 'percent', valeur: '101' })], /ne dépasse pas 100/],
  ])('montant %j, parts %j : refusé', (m, parts, msg) => {
    const v = validerCorrection(m, parts, noms);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.message).toMatch(msg);
      expect(v.message).toMatch(/[Ii]ndiquez|choisissez|ne dépasse/); // vouvoyé, en français (D85)
    }
  });
  it('des parts qui dépassent le montant ne sont pas refusées', () => {
    expect(validerCorrection('10', [p({ valeur: '50' })], noms).ok).toBe(true);
  });
  it('écrit exactement montant et parts, dans le signe de l’ordre, et garde le reste de l’ordre', () => {
    const v = validerCorrection('120', [p({ valeur: '20' }), p({ tirelireId: '', categoryId: 'c1', forme: 'percent', valeur: '12,5' }), p({ tirelireId: 't2', forme: 'variable' })], noms);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const ordre = { id: 'f', name: 'Virement Livret A', kind: 'transfer', amount: -10000, accountId: 'p', counterpartAccountId: 'l', periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-05' }, dateWindowDays: 5, labelPattern: 'VIR', action: { state: 'lock' } } as PlannedFlow;
    const n = avecVentilation(ordre, v.montant, v.allocation);
    expect(n).toMatchObject({ id: 'f', name: 'Virement Livret A', amount: -12000, labelPattern: 'VIR', periodicity: ordre.periodicity });
    expect(n.action).toEqual({ state: 'lock', allocation: [
      { tirelireId: 't1', share: { kind: 'fixed', amount: -2000 } },
      { categoryId: 'c1', share: { kind: 'percent', pct: 12.5 } },
      { tirelireId: 't2', share: { kind: 'variable' } },
    ] });
    // Relue en saisie, la ventilation rend les mêmes champs.
    expect(enSaisie(n.action!.allocation).map((x) => x.valeur)).toEqual(['20,00', '12,5', '']);
  });
});

describe('[niveau 2] #394 · 7 — une ventilation écrite une fois, pour le Plan et l’assistant', () => {
  const plan = lire('src/views/Plan.svelte');
  const wizard = lire('src/views/Wizard.svelte');
  it('le Plan et l’assistant emploient la même lecture et la même explication ; seul le Plan la replie et corrige les parts', () => {
    expect(plan).toMatch(/<VentilationOrdre /);
    expect(wizard).toMatch(/<VentilationOrdre /);
    expect(plan).toMatch(/<ExplicationVentilation repliee \/>/);
    expect(wizard).toMatch(/<ExplicationVentilation \/>/);
    expect(plan).toMatch(/<PanneauVentilation/);
    expect(wizard).not.toMatch(/PanneauVentilation/);
  });
});
