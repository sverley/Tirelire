import { describe, expect, it } from 'vitest';
import { emptyLedger, type Ledger } from '../src/model.js';
import { euros } from '../src/money.js';
import { indexLedger, tirelireTimeline } from '../src/balances.js';
import { computePlan } from '../src/plan.js';
import { lastPeriods, recurringPerPeriod, reviewCategories } from '../src/review.js';

/**
 * D50 : changer un budget, c'est clore un besoin et en ouvrir un autre. Le passé ne doit pas être
 * redoté au montant d'aujourd'hui, et l'avenir ne doit pas l'être à celui d'hier.
 */
function foyer(dates: boolean): Ledger {
  const l = emptyLedger({ periodStartDay: 1 });
  l.accounts.push({ id: 'acc', name: 'Compte', kind: 'principal', openingBalance: euros(10000), openingDate: '2024-12-31' });
  l.tirelires.push({
    id: 'tir',
    name: 'Courses',
    placement: [{ accountId: 'acc', share: { kind: 'variable' } }],
    openingBalance: 0,
    openingDate: '2025-01-01',
  });
  const mensuel = { interval: 1, unit: 'month' as const, anchorDate: '2025-01-01' };
  l.needs.push(
    {
      id: 'n-ancien',
      tirelireId: 'tir',
      kind: 'recurring',
      name: 'Courses (ancien budget)',
      amount: euros(300),
      periodicity: mensuel,
      priority: 20,
      ...(dates ? { activeTo: '2025-02-28' } : {}),
    },
    {
      id: 'n-nouveau',
      tirelireId: 'tir',
      kind: 'recurring',
      name: 'Courses (nouveau budget)',
      amount: euros(400),
      periodicity: mensuel,
      priority: 20,
      ...(dates ? { activeFrom: '2025-03-01' } : {}),
    },
  );
  l.plannedFlows.push({
    id: 'flux',
    name: 'Salaire',
    kind: 'income',
    amount: euros(2000),
    accountId: 'acc',
    periodicity: mensuel,
    dateWindowDays: 3,
  });
  return l;
}

const dotations = (l: Ledger, jusqua: string) => {
  const idx = indexLedger(l);
  return tirelireTimeline(idx.tireliresById.get('tir')!, idx, jusqua).map((s) => [s.period.key, s.dotation] as const);
};

describe('période de validité d’un besoin (D50)', () => {
  it('dote chaque période au budget qui était le sien', () => {
    expect(dotations(foyer(true), '2025-04-15')).toEqual([
      ['2025-01', euros(300)],
      ['2025-02', euros(300)],
      ['2025-03', euros(400)],
      ['2025-04', euros(400)],
    ]);
  });

  it('sans les dates, les deux versions du budget s’additionnent', () => {
    expect(dotations(foyer(false), '2025-04-15')).toEqual([
      ['2025-01', euros(700)],
      ['2025-02', euros(700)],
      ['2025-03', euros(700)],
      ['2025-04', euros(700)],
    ]);
  });

  it('le plan ne montre que la version en vigueur', () => {
    const l = foyer(true);
    const fevrier = computePlan(l, '2025-02-15');
    expect(fevrier.lines.map((x) => [x.name, x.requested])).toEqual([['Courses (ancien budget)', euros(300)]]);
    const mars = computePlan(l, '2025-03-15');
    expect(mars.lines.map((x) => [x.name, x.requested])).toEqual([['Courses (nouveau budget)', euros(400)]]);
  });

  it('la cible du Bilan suit la version en vigueur à la fin de la fenêtre', () => {
    const l = foyer(true);
    expect(recurringPerPeriod(l, l.tirelires[0]!, '2025-02-01')).toBe(euros(300));
    expect(recurringPerPeriod(l, l.tirelires[0]!, '2025-03-01')).toBe(euros(400));
    const bilan = reviewCategories(l, lastPeriods(l, '2025-04-15', 4));
    expect(bilan.find((r) => r.tirelireId === 'tir')?.target).toBe(euros(400));
  });

  it('changer le budget ne réécrit pas les dotations déjà passées', () => {
    const avant = dotations(foyer(true), '2025-02-15');
    const l = foyer(true);
    // Le foyer révise encore son budget en avril : janvier et février ne bougent pas.
    l.needs[1]!.activeTo = '2025-03-31';
    l.needs.push({
      id: 'n-avril',
      tirelireId: 'tir',
      kind: 'recurring',
      name: 'Courses (avril)',
      amount: euros(500),
      periodicity: { interval: 1, unit: 'month', anchorDate: '2025-04-01' },
      priority: 20,
      activeFrom: '2025-04-01',
    });
    const apres = dotations(l, '2025-04-15');
    expect(apres.slice(0, 2)).toEqual(avant);
    expect(apres[3]).toEqual(['2025-04', euros(500)]);
  });
});
