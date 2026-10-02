/**
 * #320 · Sans opération, le Bilan lit le budget : prévu, financé, non financé (D57, D06, D29, D52).
 *
 * Tests du codeur, tous de niveau 4 : ce que l'auditeur n'a pas retenu dans son harnais. Les autres, qui
 * tranchent les points 1, 2, 3 et 7 du « Fait quand », sont déplacés dans son harnais
 * (`bilan-budget-harnais.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { exampleLedger, hasBudget, readBudgetAhead } from '../src/index.js';

const LECTURE = '2026-09-06';

describe('[niveau 4] #320 · lecture sans effet, et besoins qui ne comptent pas', () => {
  it('lire le budget ne modifie rien (I10)', () => {
    const l = exampleLedger();
    const avant = JSON.stringify(l);
    readBudgetAhead(l, LECTURE, 12);
    expect(JSON.stringify(l)).toBe(avant);
  });

  it('un besoin supprimé, ou sur une tirelire supprimée, ne compte pas', () => {
    const l = exampleLedger();
    l.needs = l.needs.map((n) => ({ ...n, deletedAt: '2026-09-01T00:00:00Z' }));
    expect(hasBudget(l)).toBe(false);
    const m = exampleLedger();
    m.tirelires = m.tirelires.map((t) => ({ ...t, deletedAt: '2026-09-01T00:00:00Z' }));
    expect(hasBudget(m)).toBe(false);
  });
});
