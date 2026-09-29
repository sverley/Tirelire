/**
 * #183 · Les occurrences d'un virement permanent se lisent sur son flux, et le plan de leur période
 * les montre ; sans suivi des opérations, il n'en dit rien. Tests du codeur, à côté du harnais de
 * l'auditeur : ils gardent ce que le codage ajoute (`flowOccurrences`, `tracksOperations`,
 * `PlanTransfer.occurrences`).
 *
 * Le jeu d'exemple porte l'ordre vers le Livret A, mensuel, le 28 (fenêtre de 5 jours), et
 * n'importe aucun relevé. Les soldes sont connus au 8 septembre 2026, dans la période « septembre
 * 2026 » (28/08 → 27/09) : l'occurrence du 28 août y est close, celle du 28 septembre ouvre la
 * période « octobre 2026 », à venir.
 */
import { describe, expect, it } from 'vitest';
import { computePlan, euros, exampleLedger, normalizeLabel, type Ledger, type Operation } from '../src/index.js';

const AUJOURD_HUI = '2026-09-08';
const SEPTEMBRE = '2026-09-08';
const OCTOBRE = '2026-09-28';

function opération(id: string, date: string, montant: number, plannedFlowId?: string): Operation {
  const label = 'VIR PERMANENT TIRELIRE LIVRET A';
  return {
    id,
    accountId: 'acc-principal',
    origin: 'imported',
    date,
    label,
    normalizedLabel: normalizeLabel(label),
    amount: montant,
    state: 'untreated',
    ...(plannedFlowId ? { plannedFlowId } : {}),
  };
}

const avec = (...ops: Operation[]): Ledger => {
  const l = exampleLedger();
  return { ...l, operations: [...l.operations, ...ops] };
};

const livret = (l: Ledger, asOf: string) => computePlan(l, asOf, AUJOURD_HUI).transfers.find((t) => t.accountId === 'acc-livret')!;

describe('[niveau 2] #183 · le virement permanent se lit sur son flux, le plan de sa période le montre', () => {
  it('sans suivi des opérations (U1), le plan ne dit ni réception ni manquement', () => {
    const l = exampleLedger();
    expect(livret(l, SEPTEMBRE).bankOrder).toBeDefined();
    expect(livret(l, SEPTEMBRE).occurrences).toBeUndefined();
    expect(livret(l, OCTOBRE).occurrences).toBeUndefined();
  });

  it('pointée : une opération rapprochée de l’ordre, dans sa fenêtre', () => {
    const l = avec(opération('o1', '2026-08-29', -euros(600), 'flow-vir-livret'));
    expect(livret(l, SEPTEMBRE).occurrences).toEqual([
      { date: '2026-08-28', windowEnd: '2026-09-02', status: 'pointee', operationId: 'o1' },
    ]);
  });

  it('attendue non reçue : la fenêtre est close sans opération, et le plan de sa période le montre', () => {
    const l = avec(opération('o2', '2026-09-01', -euros(40)));
    expect(livret(l, SEPTEMBRE).occurrences).toEqual([{ date: '2026-08-28', windowEnd: '2026-09-02', status: 'nonRecue' }]);
  });

  it('attendue : une période à venir montre l’occurrence à venir, sans rien en supposer', () => {
    const l = avec(opération('o2', '2026-09-01', -euros(40)));
    expect(livret(l, OCTOBRE).occurrences).toEqual([{ date: '2026-09-28', windowEnd: '2026-10-03', status: 'attendue' }]);
  });

  it('commencer à importer ne change ni les besoins, ni le virement permanent proposé (point 7)', () => {
    const sans = exampleLedger();
    const importé = avec(opération('o2', '2026-09-01', -euros(40)));
    for (const asOf of [SEPTEMBRE, OCTOBRE]) {
      const a = computePlan(sans, asOf, AUJOURD_HUI);
      const b = computePlan(importé, asOf, AUJOURD_HUI);
      expect(b.lines.map((x) => [x.needId, x.requested])).toEqual(a.lines.map((x) => [x.needId, x.requested]));
      expect(b.transfers.map((t) => [t.accountId, t.permanent])).toEqual(a.transfers.map((t) => [t.accountId, t.permanent]));
    }
  });
});
