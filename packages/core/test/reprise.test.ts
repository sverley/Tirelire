/**
 * Tests du codeur de #306 que l'auditeur n'a pas retenus dans le harnais (`reprise-harnais.test.ts`) :
 * niveau 4, un diagnostic. Les autres y sont passés, ou y ont une épreuve plus forte.
 */
import { describe, expect, it } from 'vitest';
import * as cœur from '../src/index.js';

describe('[niveau 4] #306 · point 5 — le cœur ne sait plus engendrer un automatisme à partir d’un flux', () => {
  it('automationFromFlow et syncFlowAutomations ne sont plus exportés', () => {
    expect('automationFromFlow' in cœur || 'syncFlowAutomations' in cœur).toBe(false);
  });
});

describe('[niveau 4] #306 · point 9 — une saisie reprise ne se supprime pas tant que la reprise tient', () => {
  const CC = 'cc';
  const LECTURE = '2026-09-10';
  /** Un compte courant à 1 000 € ; un salaire de 2 000 € le 25, corrigé à 1 800 €, puis repris par le relevé. */
  function corrigéEtRepris(): { l: cœur.Ledger; correction: cœur.Operation } {
    let l = cœur.emptyLedger({ periodStartDay: 1 });
    l.accounts.push({ id: CC, name: 'Compte courant', kind: 'principal', openingBalance: cœur.euros(1000), openingDate: '2026-08-31' });
    l.plannedFlows.push({ id: 'f-salaire', name: 'Salaire', kind: 'income', amount: cœur.euros(2000), accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-25' }, dateWindowDays: 3, amountTolerance: { pct: 10 }, labelPattern: 'SALAIRE' });
    l = cœur.applyPatchToLedger(l, cœur.correctPlannedOperation(l, 'f-salaire', '2026-09-25', cœur.euros(1800), '2026-09-25'));
    const correction = l.operations.find((o) => o.origin === 'manual')!;
    l.operations.push({ id: 'relevé', accountId: CC, origin: 'imported', date: '2026-09-25', label: 'VIR SALAIRE', normalizedLabel: 'VIR SALAIRE', amount: cœur.euros(1850), state: 'untreated' });
    l = cœur.applyPatchToLedger(l, cœur.applyMatch(l, cœur.proposeMatches(l, '2026-09-01', '2026-09-30')[0]!));
    return { l, correction };
  }
  const salaires = (l: cœur.Ledger) =>
    cœur.computePlan(l, '2026-10-01', LECTURE).forecast!.accounts.find((a) => a.id === CC)!.movements.filter((m) => m.flowId === 'f-salaire').map((m) => m.date);

  it('ce qui reprend la saisie l’empêche d’être supprimée ; rien n’empêche une saisie que rien ne reprend', () => {
    const { l, correction } = corrigéEtRepris();
    expect(cœur.removalBlockers(l, [correction.id]).map((o) => o.id)).toEqual(['relevé']);
    expect(cœur.removalBlockers(l, ['relevé'])).toEqual([]);
    // Supprimer ensemble la saisie et ce qui la reprend : rien ne reste pour la reprendre.
    expect(cœur.removalBlockers(l, [correction.id, 'relevé'])).toEqual([]);
  });

  it('la reprise défaite, la saisie se supprime, et l’occurrence qu’elle corrigeait compte de nouveau', () => {
    const { l: repris, correction } = corrigéEtRepris();
    expect(salaires(repris)).toEqual(['2026-10-25']);
    let l = cœur.applyPatchToLedger(repris, cœur.undoResumption(repris, 'relevé'));
    expect(cœur.removalBlockers(l, [correction.id])).toEqual([]);
    l = { ...l, operations: l.operations.map((o) => (o.id === correction.id ? { ...o, deletedAt: '2026-09-26T00:00:00.000Z' } : o)) };
    expect(salaires(l)).toEqual(['2026-09-25', '2026-10-25']);
  });
});
