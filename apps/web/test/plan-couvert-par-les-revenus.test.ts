/**
 * Tests du codeur de #323, niveau 4 — « Le Plan se lit sans opération, période passée comprise ».
 *
 * Sans navigateur : ce que l'écran Plan écrit (source de `Plan.svelte`), et, par le cœur, la
 * prémisse du point 2 — une période où aucun besoin n'est en vigueur n'a aucune ligne de tirelire.
 * Le rendu à l'écran est vérifié par le harnais de l'auditeur,
 * `navigateur/plan-couvert-par-les-revenus-harnais.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computePlan, exampleLedger, periodsAround, periodReadingDate, type Ledger } from '@tirelire/core';

const source = readFileSync(resolve(process.cwd(), 'src/views/Plan.svelte'), 'utf8');

/** L'exemple, chaque besoin ouvert au plus tôt au premier jour de la période qui suit `jour`. */
function besoinsDifférés(jour: string): { ledger: Ledger; vide: string; dotée: string } {
  const l = exampleLedger();
  const [courante, suivante] = periodsAround(l, jour, 0, 1);
  const needs = l.needs.map((n) => (!n.activeFrom || n.activeFrom < suivante!.start ? { ...n, activeFrom: suivante!.start } : n));
  return { ledger: { ...l, needs }, vide: courante!.label, dotée: suivante!.label };
}

describe('[niveau 4] #323 · le Plan dit ce que couvrent les revenus', () => {
  it('point 1 — la tuile et le total des tirelires disent « Couvert par les revenus », pour plan.totals.funded ; « viré » n’y paraît plus', () => {
    expect(source).toMatch(/\{money\(plan\.totals\.funded\)\}<\/div><div class="k">Couvert par les revenus<\/div>/);
    expect(source).toMatch(/<div class="label">Couvert par les revenus<\/div><div class="num">\{money\(plan\.totals\.funded\)\}<\/div>/);
    expect(source).not.toMatch(/viré/i);
  });

  it('point 2 — sans ligne de tirelire, une phrase remplace la carte', () => {
    expect(source).toMatch(/<h2>Tirelires<\/h2>\s*\{#if plan\.lines\.length === 0\}\s*<p class="muted">Aucune tirelire n’est dotée sur cette période : aucun besoin de votre budget n’y est en vigueur\.<\/p>\s*\{:else\}\s*<div class="card">/);
  });

  it('point 3 — la phrase ajoutée vouvoie', () => {
    expect(source).toContain('aucun besoin de votre budget n’y est en vigueur');
  });

  it('point 2, prémisse — une période où aucun besoin n’est en vigueur n’a aucune ligne, la suivante en a (D50)', () => {
    const jour = '2026-09-20';
    const { ledger } = besoinsDifférés(jour);
    const [courante, suivante] = periodsAround(ledger, jour, 0, 1);
    const vide = computePlan(ledger, periodReadingDate(courante!, jour), jour);
    expect(vide.lines).toEqual([]);
    expect(vide.totals.funded).toBe(0);
    const dotée = computePlan(ledger, periodReadingDate(suivante!, jour), jour);
    expect(dotée.lines.length).toBeGreaterThan(0);
    expect(dotée.totals.funded).toBeGreaterThan(0);
  });
});
