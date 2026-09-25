import { describe, expect, it } from 'vitest';
import { euros, exampleLedger, lastPeriods, reviewCategories, reviewProvisions, reviewReplenishments, type Ledger, type Operation, type Allocation } from '../src/index.js';

function withHistory(): Ledger {
  const l = exampleLedger();
  // Six mois de courses sur le compte principal, un mois avec une dépense ponctuelle, et l'échéance de taxe foncière payée.
  const months = ['2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05'];
  const amounts = [820, 910, 870, 950, 890, 930];
  months.forEach((d, i) => {
    const op: Operation = { id: `op-alim-${i}`, accountId: 'acc-principal', origin: 'imported', date: d, label: 'SUPERMARCHE', normalizedLabel: 'SUPERMARCHE', amount: euros(-amounts[i]!), state: 'reconciled' };
    const al: Allocation = { id: `al-alim-${i}`, operationId: op.id, categoryId: 'cat-alim', tirelireId: 'env-alim', share: { kind: 'fixed', amount: op.amount } };
    l.operations.push(op);
    l.allocations.push(al);
  });
  l.operations.push({ id: 'op-frigo', accountId: 'acc-principal', origin: 'imported', date: '2026-06-10', label: 'FRIGO', normalizedLabel: 'FRIGO', amount: euros(-600), state: 'reconciled', oneOff: true });
  l.allocations.push({ id: 'al-frigo', operationId: 'op-frigo', categoryId: 'cat-alim', tirelireId: 'env-alim', share: { kind: 'fixed', amount: euros(-600) } });
  // Taxe foncière 2025 : provision à 1 200, payée 1 260 le 15 octobre 2025.
  l.tirelires.find((e) => e.id === 'env-tf')!.openingDate = '2025-01-01';
  l.tirelires.find((e) => e.id === 'env-tf')!.openingBalance = euros(1200);
  l.needs.find((n) => n.id === 'need-tf')!.periodicity = { interval: 12, unit: 'month' as const, anchorDate: '2025-10-15' };
  l.operations.push({ id: 'op-tf-2025', accountId: 'acc-principal', origin: 'imported', date: '2025-10-16', label: 'DGFIP TAXE FONCIERE', normalizedLabel: 'DGFIP TAXE FONCIERE', amount: euros(-1260), state: 'reconciled', plannedFlowId: 'flow-tf' });
  l.allocations.push({ id: 'al-tf-2025', operationId: 'op-tf-2025', categoryId: 'cat-logement', tirelireId: 'env-tf', share: { kind: 'fixed', amount: euros(-1260) } });
  return l;
}

describe('[niveau 1] harnais du registre', () => {
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
      const tf = rows.find((r) => r.needId === 'need-tf' && r.dueDate === '2025-10-15')!;
      expect(tf.provisioned).toBe(euros(1200));
      expect(tf.paid).toBe(euros(1260));
      expect(tf.variance).toBe(euros(60));
    });
  });

  /**
   * Un renflouement (D49) est ce que le plan sert à éviter : s'il faut ramener de l'argent, c'est que
   * la dotation était trop basse. Il doit donc sortir des moyennes — sinon il masque le problème
   * qu'il révèle — et être compté à part pour proposer un réajustement.
   */
  describe('renflouements (D49)', () => {
    function avecRenflouement(): Ledger {
      const l = withHistory();
      // Cadeau de 300 € versé dans la tirelire des courses, un mois où elle était à sec.
      const cadeau: Operation = {
        id: 'op-cadeau', accountId: 'acc-principal', origin: 'manual', date: '2026-07-20',
        label: 'VIREMENT MAMIE', normalizedLabel: 'VIREMENT MAMIE', amount: euros(300), state: 'reconciled',
      };
      const al: Allocation = {
        id: 'al-cadeau', operationId: cadeau.id, tirelireId: 'env-alim',
        share: { kind: 'fixed', amount: euros(300) }, replenishment: 'external',
      };
      l.operations.push(cadeau);
      l.allocations.push(al);
      return l;
    }

    it("ne laisse pas un cadeau fausser les moyennes du bilan", () => {
      const periods = lastPeriods(withHistory(), '2026-08-31', 6);
      const sans = reviewCategories(withHistory(), periods).find((r) => r.categoryId === 'cat-alim')!;
      const avec = reviewCategories(avecRenflouement(), periods).find((r) => r.categoryId === 'cat-alim')!;
      // Les 300 € entrés n'appartiennent pas au train de vie : la lecture doit être identique.
      expect(avec.avg6).toBe(sans.avg6);
      expect(avec.totalSpent).toBe(sans.totalSpent);
    });

    it('compte ce qui a été ramené, et distingue le dehors du dedans', () => {
      const periods = lastPeriods(avecRenflouement(), '2026-08-31', 6);
      const r = reviewReplenishments(avecRenflouement(), periods).find((x) => x.tirelireId === 'env-alim')!;
      expect(r.count).toBe(1);
      expect(r.total).toBe(euros(300));
      expect(r.fromOutside).toBe(euros(300));
      expect(r.fromInside).toBe(0);
    });

    it('propose de relever la dotation de ce qu\'il a fallu ramener, sans rien appliquer', () => {
      const periods = lastPeriods(avecRenflouement(), '2026-08-31', 6);
      const r = reviewReplenishments(avecRenflouement(), periods).find((x) => x.tirelireId === 'env-alim')!;
      // 300 € ramenés sur six périodes : la dotation manquait d'environ 50 € par période.
      expect(r.suggested).toBe(euros(50));
      // La dotation elle-même n'a pas bougé : la correction reste une décision du foyer.
      expect(r.cruise).toBeGreaterThan(0);
    });

    it("n'invente pas de renflouement là où il n'y en a pas", () => {
      const periods = lastPeriods(withHistory(), '2026-08-31', 6);
      expect(reviewReplenishments(withHistory(), periods)).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Témoin rouge du harnais U4 (docs/gardes.md) : les assertions du bilan par catégorie, rejouées
  // sur une version volontairement cassée du besoin.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it.fails('témoin rouge · un bilan qui compte les dépenses ponctuelles dans la moyenne', () => {
    const periods = lastPeriods(withHistory(), '2026-09-06', 12);
    const sans = reviewCategories(withHistory(), periods).find((r) => r.categoryId === 'cat-alim')!;
    // Version cassée : le frigo (600 €, acheté une fois) n'est plus distingué d'une dépense
    // courante. Reconstruire un budget depuis l'historique proposerait alors 100 € de courses de
    // trop chaque mois, à cause d'un achat qui ne reviendra pas.
    const l = withHistory();
    l.operations = l.operations.map((o) => (o.id === 'op-frigo' ? { ...o, oneOff: false } : o));
    const avec = reviewCategories(l, periods).find((r) => r.categoryId === 'cat-alim')!;

    expect(avec.avg6).toBe(sans.avg6);
    expect(avec.periods.find((p) => p.key === '2026-06')!.oneOff).toBe(euros(600));
  });
});
