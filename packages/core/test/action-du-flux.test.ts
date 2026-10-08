/**
 * Tests du codeur de #393, tour 3 (retour de l'auditeur) : le signal de l'écart d'une part fixe nomme
 * la tirelire même retirée (point 8). Les autres tests du codeur sont dans le harnais
 * (`action-du-flux-harnais.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { computePlan, emptyLedger, euros, type Ledger } from '../src/index.js';

describe('[niveau 4] #393 · 8. le signal d’une part nomme sa tirelire, même retirée', () => {
  it('une tirelire retirée depuis l’écran Tirelires, dont un ordre garde une part fixe, est nommée par son nom', () => {
    const l: Ledger = emptyLedger({ periodStartDay: 28 });
    l.accounts.push(
      { id: 'acc-principal', name: 'Compte courant', kind: 'principal', openingBalance: euros(3000), openingDate: '2026-08-27' },
      { id: 'livret', name: 'Livret', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-27' },
    );
    l.tirelires.push(
      { id: 'vac', name: 'Vacances', placement: [{ accountId: 'livret', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' },
      { id: 'noel', name: 'Noël', placement: [{ accountId: 'livret', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28', deletedAt: '2026-09-01T10:00:00.000Z' },
    );
    l.needs.push({ id: 'n-vac', tirelireId: 'vac', kind: 'goal', amount: euros(5000), monthlyAmount: euros(200), priority: 30 });
    l.plannedFlows.push({
      id: 'o',
      name: 'Virement livret',
      kind: 'transfer',
      amount: -euros(300),
      accountId: 'acc-principal',
      counterpartAccountId: 'livret',
      periodicity: { interval: 1, unit: 'month', anchorDate: '2026-08-28' },
      dateWindowDays: 5,
      action: { allocation: [{ tirelireId: 'vac', share: { kind: 'fixed', amount: -euros(200) } }, { tirelireId: 'noel', share: { kind: 'fixed', amount: -euros(100) } }] },
    });
    const parts = computePlan(l, '2026-09-06').warnings.filter((w) => w.code === 'bankOrderPartDrift');
    expect(parts.map((w) => w.tirelireId)).toEqual(['noel']);
    expect(parts[0]!.message).toContain('« Noël »');
    expect(parts[0]!.message).not.toContain('« noel »');
  });
});
