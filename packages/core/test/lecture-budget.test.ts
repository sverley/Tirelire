/**
 * #320 · Sans opération, le Bilan lit le budget : prévu, financé, non financé (D57, D06, D29, D52).
 *
 * Tests du codeur, tous de niveau 4 : ce que l'auditeur n'a pas retenu dans son harnais. Les autres, qui
 * tranchent les points 1, 2, 3 et 7 du « Fait quand », sont déplacés dans son harnais
 * (`bilan-budget-harnais.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { budgetPeriodContaining, exampleLedger, hasBudget, nextPeriod, periodReadingDate, readBudgetAhead } from '../src/index.js';

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

describe('[niveau 4] #320 · tour 2 — une seule règle pour la date à laquelle se lit une période (D52, principe 13)', () => {
  it('la date de lecture dans la période qui la contient, le premier jour ailleurs', () => {
    const courante = budgetPeriodContaining(LECTURE, 28);
    const suivante = nextPeriod(courante, 28);
    expect(periodReadingDate(courante, LECTURE)).toBe(LECTURE);
    expect(periodReadingDate(suivante, LECTURE)).toBe(suivante.start);
    expect(periodReadingDate(courante, courante.start)).toBe(courante.start);
    expect(periodReadingDate(courante, courante.end)).toBe(courante.end);
  });

  it('le Bilan lit chaque période à cette date', () => {
    for (const p of readBudgetAhead(exampleLedger(), LECTURE, 6)!.periods) expect(p.asOf).toBe(periodReadingDate(p.period, LECTURE));
  });
});
