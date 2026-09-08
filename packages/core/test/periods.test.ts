import { describe, expect, it } from 'vitest';
import { addMonths, nextOccurrence, occurrencesBetween, budgetPeriodContaining, periodsUntil, previousOccurrence, nextPeriod } from '../src/index.js';

describe('dates', () => {
  it('borne le jour en ajoutant des mois', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });
});

describe('périodes de paie', () => {
  it('jour de paie 28 : du 28 au 27, nommée d’après le mois du milieu', () => {
    const p = budgetPeriodContaining('2026-09-06', 28);
    expect(p.start).toBe('2026-08-28');
    expect(p.end).toBe('2026-09-27');
    expect(p.label).toBe('septembre 2026');
    expect(p.key).toBe('2026-09');
  });

  it('le jour de paie lui-même ouvre la période', () => {
    const p = budgetPeriodContaining('2026-09-28', 28);
    expect(p.start).toBe('2026-09-28');
    expect(p.end).toBe('2026-10-27');
    expect(p.label).toBe('octobre 2026');
  });

  it('jour de paie 1 : mois calendaire', () => {
    const p = budgetPeriodContaining('2026-02-14', 1);
    expect(p.start).toBe('2026-02-01');
    expect(p.end).toBe('2026-02-28');
    expect(p.label).toBe('février 2026');
  });

  it('jour de paie 31 : borné aux mois courts', () => {
    const p = budgetPeriodContaining('2026-05-10', 31);
    expect(p.start).toBe('2026-04-30');
    expect(p.end).toBe('2026-05-30');
    const n = nextPeriod(p, 31);
    expect(n.start).toBe('2026-05-31');
    expect(n.end).toBe('2026-06-29');
  });

  it('compte les périodes jusqu’à une échéance', () => {
    const p = budgetPeriodContaining('2026-09-06', 28);
    expect(periodsUntil(p, '2026-09-20', 28)).toBe(1);
    expect(periodsUntil(p, '2026-10-15', 28)).toBe(2);
    expect(periodsUntil(p, '2027-03-05', 28)).toBe(7);
    expect(periodsUntil(p, '2026-08-01', 28)).toBe(0);
  });
});

describe('périodicités', () => {
  const annual = { intervalMonths: 12, anchorDate: '2026-10-15' };
  const quarterly = { intervalMonths: 3, anchorDate: '2026-01-05' };
  const monthly31 = { intervalMonths: 1, anchorDate: '2026-01-31' };

  it('prochaine occurrence', () => {
    expect(nextOccurrence(annual, '2026-09-06')).toBe('2026-10-15');
    expect(nextOccurrence(annual, '2026-10-15')).toBe('2026-10-15');
    expect(nextOccurrence(annual, '2026-10-16')).toBe('2027-10-15');
    expect(nextOccurrence(quarterly, '2026-09-06')).toBe('2026-10-05');
    expect(nextOccurrence(annual, '2020-01-01')).toBe('2026-10-15');
  });

  it('occurrences dans un intervalle, sans dérive du jour', () => {
    expect(occurrencesBetween(monthly31, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrencesBetween(quarterly, '2026-08-28', '2026-09-27')).toEqual([]);
    expect(occurrencesBetween(quarterly, '2026-09-28', '2026-10-27')).toEqual(['2026-10-05']);
  });

  it('occurrence précédente', () => {
    // l'ancrage est la première occurrence : rien avant
    expect(previousOccurrence(annual, '2026-09-06')).toBeUndefined();
    expect(previousOccurrence(annual, '2026-10-15')).toBeUndefined();
    expect(previousOccurrence(annual, '2027-01-01')).toBe('2026-10-15');
    expect(previousOccurrence(quarterly, '2026-09-06')).toBe('2026-07-05');
  });
});
