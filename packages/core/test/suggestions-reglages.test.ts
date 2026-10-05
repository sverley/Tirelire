import { describe, expect, it } from 'vitest';
import { budgetSuggestions, euros, exampleLedger } from '../src/index.js';

/**
 * Tests du codeur de #324 — les réglages que l'exemple porte, lus par `budgetSuggestions`
 * (`src/suggestions.ts`), sans navigateur : le jour où commence la période (point 1, D44) et le
 * coussin du compte principal (point 2, D41). Ils viennent de l'exemple et de lui seul (D43).
 */
const exemple = exampleLedger();

describe('[niveau 4] #324 · 1 — le jour de début de période proposé est celui de l’exemple, le 28', () => {
  it('c’est le réglage de l’exemple, jour de son plus gros revenu, le salaire', () => {
    expect(budgetSuggestions().periodStartDay).toBe(exemple.settings.periodStartDay);
    expect(budgetSuggestions().periodStartDay).toBe(28);
    const salaire = exemple.plannedFlows.filter((f) => f.kind === 'income').sort((a, b) => b.amount - a.amount)[0]!;
    expect(Number(salaire.periodicity.anchorDate.slice(8))).toBe(28);
  });

  it('il ne dépend pas de la date de lecture', () => {
    expect(budgetSuggestions('2027-01-15').periodStartDay).toBe(28);
  });
});

describe('[niveau 4] #324 · 2 — le coussin proposé au compte principal est celui de l’exemple, 600,00 €', () => {
  it('c’est le réglage de l’exemple', () => {
    expect(budgetSuggestions().mainAccount.cushion).toBe(exemple.settings.principalCushion);
    expect(budgetSuggestions().mainAccount.cushion).toBe(euros(600));
  });

  it('il ne dépend pas de la date de lecture', () => {
    expect(budgetSuggestions('2027-01-15').mainAccount.cushion).toBe(euros(600));
  });
});
