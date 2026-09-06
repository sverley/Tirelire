import { describe, expect, it } from 'vitest';
import { euros, exampleLedger, lastPeriods, reviewCategories, reviewProvisions, type Ledger, type Operation, type Allocation } from '../src/index.js';

function withHistory(): Ledger {
  const l = exampleLedger();
  // Six mois de courses sur le pivot, un mois avec une dépense ponctuelle, et l'échéance de taxe foncière payée.
  const months = ['2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05'];
  const amounts = [820, 910, 870, 950, 890, 930];
  months.forEach((d, i) => {
    const op: Operation = { id: `op-alim-${i}`, accountId: 'acc-pivot', origin: 'imported', date: d, label: 'SUPERMARCHE', normalizedLabel: 'SUPERMARCHE', amount: euros(-amounts[i]!), status: 'categorized' };
    const al: Allocation = { id: `al-alim-${i}`, operationId: op.id, categoryId: 'cat-alim', envelopeId: 'env-alim', amount: op.amount };
    l.operations.push(op);
    l.allocations.push(al);
  });
  l.operations.push({ id: 'op-frigo', accountId: 'acc-pivot', origin: 'imported', date: '2026-06-10', label: 'FRIGO', normalizedLabel: 'FRIGO', amount: euros(-600), status: 'oneOff' });
  l.allocations.push({ id: 'al-frigo', operationId: 'op-frigo', categoryId: 'cat-alim', envelopeId: 'env-alim', amount: euros(-600) });
  // Taxe foncière 2025 : provision à 1 200, payée 1 260 le 15 octobre 2025.
  l.envelopes.find((e) => e.id === 'env-tf')!.openingDate = '2025-01-01';
  l.envelopes.find((e) => e.id === 'env-tf')!.openingBalance = euros(1200);
  l.envelopes.find((e) => e.id === 'env-tf')!.periodicity = { intervalMonths: 12, anchorDate: '2025-10-15' };
  l.operations.push({ id: 'op-tf-2025', accountId: 'acc-pivot', origin: 'imported', date: '2025-10-16', label: 'DGFIP TAXE FONCIERE', normalizedLabel: 'DGFIP TAXE FONCIERE', amount: euros(-1260), status: 'matched', plannedFlowId: 'flow-tf' });
  l.allocations.push({ id: 'al-tf-2025', operationId: 'op-tf-2025', categoryId: 'cat-logement', envelopeId: 'env-tf', amount: euros(-1260) });
  return l;
}

describe('bilan par catégorie', () => {
  it('moyennes hors ponctuel, min, max, suggestion arrondie', () => {
    const l = withHistory();
    const periods = lastPeriods(l, '2026-09-06', 12);
    expect(periods.length).toBe(12);
    expect(periods[periods.length - 1]!.label).toBe('septembre 2026');
    const alim = reviewCategories(l, periods).find((r) => r.categoryId === 'cat-alim')!;
    expect(alim.target).toBe(euros(900));
    // Série : mars…septembre (7 périodes, septembre à 0) ; le frigo est ponctuel et exclu
    expect(alim.avg6).toBe(Math.round((910 + 870 + 950 + 890 + 930 + 0) * 100 / 6));
    expect(alim.max).toBe(euros(950));
    expect(alim.periods.find((p) => p.key === '2026-06')!.oneOff).toBe(euros(600));
    expect(alim.suggestion).toBe(Math.round(Math.round(alim.avg6 * 1.05) / 1000) * 1000);
  });

  it('les virements internes ne comptent pas', () => {
    const l = withHistory();
    const periods = lastPeriods(l, '2026-09-06', 3);
    const rows = reviewCategories(l, periods);
    expect(rows.find((r) => r.categoryId === 'cat-transfert')?.totalSpent ?? 0).toBe(0);
  });
});

describe('bilan des provisions', () => {
  it('provisionné vs payé à l’échéance', () => {
    const l = withHistory();
    const rows = reviewProvisions(l, '2025-01-01', '2026-09-06');
    const tf = rows.find((r) => r.envelopeId === 'env-tf' && r.dueDate === '2025-10-15')!;
    expect(tf.provisioned).toBe(euros(1200));
    expect(tf.paid).toBe(euros(1260));
    expect(tf.variance).toBe(euros(60));
  });
});
