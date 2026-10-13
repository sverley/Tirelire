/**
 * Tests du codeur de #456, second tour — l'ancrage d'un flux fait d'opérations (points 8 et 10) : la
 * date de l'occurrence que reprend la plus ancienne opération désignée, non la date de cette opération.
 * Tous sont de niveau 4 : l'auditeur choisit ceux qu'il retient et leur niveau (codeur.md, étape 3).
 *
 * Données inventées : un compte principal, une paie mensuelle et un prélèvement EDF.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPatchToLedger,
  emptyLedger,
  euros,
  flowFromOperations,
  historyOccurrences,
  normalizeLabel,
  proposeMatches,
  recordFlowFromOperations,
  type Ledger,
  type Operation,
  type PlannedFlow,
  type ProposedFlow,
} from '../src/index.js';

const CC = 'acc-principal';
const LECTURE = '2026-09-06';
const EDF = 'PRELEVEMENT EUROPEEN EDF ELEC CLIENT 4521';
const SALAIRE = 'VIR SEPA RECU SALAIRE ACME';

function comptes(): Ledger {
  const l = emptyLedger({ periodStartDay: 28, orderRounding: euros(10) });
  l.accounts.push({ id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(3000), openingDate: '2025-01-01' });
  return l;
}

function op(id: string, date: string, label: string, amount: number, o: Partial<Operation> = {}): Operation {
  return { id, accountId: CC, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated', ...o };
}
const avec = (l: Ledger, ...ops: Operation[]): Ledger => ({ ...l, operations: [...l.operations, ...ops] });

/** Enregistre le flux et ses reprises, comme l'application l'écrira au geste. */
function enregistrer(l: Ledger, flow: ProposedFlow, reprises: string[]): { ledger: Ledger; flow: PlannedFlow } {
  const r = recordFlowFromOperations(l, flow, reprises);
  expect(r, 'rien à enregistrer').toBeDefined();
  return { ledger: applyPatchToLedger({ ...l, plannedFlows: [...l.plannedFlows, r!.flow] }, r!.patch), flow: r!.flow };
}
const reprises = (ops: Operation[]) => ops.filter((o) => o.plannedFlowId).map((o) => [o.id, o.plannedDate]);

/** L'exemple du point 8 : la paie du 21 juin, puis les 25 août, 25 septembre, 29 octobre et 25 novembre. */
const paies = () =>
  avec(
    comptes(),
    op('p0', '2025-06-21', SALAIRE, euros(2500)),
    op('p1', '2025-08-25', SALAIRE, euros(2500)),
    op('p2', '2025-09-25', SALAIRE, euros(2500)),
    op('p3', '2025-10-29', SALAIRE, euros(2500)),
    op('p4', '2025-11-25', SALAIRE, euros(2500)),
  );

describe('[niveau 4] #456 · 8. l’ancrage : l’occurrence, non l’opération', () => {
  it('l’exemple du point 8 : ancré le 25 juin, la paie du 29 octobre reprend le 25 octobre, celle du 27 décembre importée ensuite est reprise', () => {
    const l = paies();
    const { flow } = flowFromOperations(l, ['p2'], LECTURE, 'f')!;
    expect(flow.periodicity).toEqual({ interval: 1, unit: 'month', anchorDate: '2025-08-25' });
    expect(historyOccurrences(l, flow, ['p2']).map((o) => [o.operation.id, o.expectedDate, o.days])).toEqual([
      ['p0', '2025-06-25', 4],
      ['p1', '2025-08-25', 0],
      ['p2', '2025-09-25', 0],
      ['p3', '2025-10-25', 4],
      ['p4', '2025-11-25', 0],
    ]);
    const r = enregistrer(l, flow, ['p4', 'p3', 'p2', 'p1', 'p0']);
    expect(r.flow.periodicity).toEqual({ interval: 1, unit: 'month', anchorDate: '2025-06-25' });
    expect(reprises(r.ledger.operations)).toEqual([
      ['p0', '2025-06-25'],
      ['p1', '2025-08-25'],
      ['p2', '2025-09-25'],
      ['p3', '2025-10-25'],
      ['p4', '2025-11-25'],
    ]);
    const ensuite = avec(r.ledger, op('p5', '2025-12-27', SALAIRE, euros(2500)));
    expect(proposeMatches(ensuite, '2025-01-01', '2026-12-31').map((m) => [m.operationId, m.flowId, m.expectedDate, m.auto])).toEqual([['p5', 'f', '2025-12-25', true]]);
  });

  it('une seule opération désignée, à quelques jours de son rythme : l’ancrage est la date de l’occurrence qu’elle reprend', () => {
    const l = paies();
    const { flow } = flowFromOperations(l, ['p2'], LECTURE, 'f')!;
    const r = recordFlowFromOperations(l, flow, ['p3'])!;
    expect(r.flow.periodicity.anchorDate).toBe('2025-10-25');
    expect(r.patch.operations.map((o) => [o.id, o.plannedDate])).toEqual([['p3', '2025-10-25']]);
  });

  it('un ancrage qu’un mois plus court a ramené (le 30 novembre d’un rythme du 31) devient le jour des dates suivantes (D47)', () => {
    const l = avec(
      comptes(),
      op('e0', '2025-11-28', EDF, -euros(80)),
      op('e1', '2026-01-31', EDF, -euros(80)),
      op('e2', '2026-02-28', EDF, -euros(80)),
      op('e3', '2026-03-31', EDF, -euros(80)),
    );
    const { flow } = flowFromOperations(l, ['e1'], LECTURE, 'f')!;
    expect(flow.periodicity).toEqual({ interval: 1, unit: 'month', anchorDate: '2026-01-31' });
    expect(historyOccurrences(l, flow, ['e1']).map((o) => [o.operation.id, o.expectedDate])).toEqual([
      ['e0', '2025-11-30'],
      ['e1', '2026-01-31'],
      ['e2', '2026-02-28'],
      ['e3', '2026-03-31'],
    ]);
    const r = recordFlowFromOperations(l, flow, ['e0', 'e1', 'e2', 'e3'])!;
    expect(r.flow.periodicity.anchorDate).toBe('2025-11-30');
    expect(r.patch.operations.map((o) => [o.id, o.plannedDate])).toEqual([
      ['e0', '2025-11-30'],
      ['e1', '2026-01-30'],
      ['e2', '2026-02-28'],
      ['e3', '2026-03-30'],
    ]);
  });
});

describe('[niveau 4] #456 · 10. ancré sur une occurrence plus ancienne, le flux reconnaît sa série', () => {
  it('enregistré avec la seule paie du 21 juin, le rapprochement retrouve chaque paie de la série, à l’occurrence que son rythme lui assigne', () => {
    const l = paies();
    const { flow } = flowFromOperations(l, ['p2'], LECTURE, 'f')!;
    const { ledger, flow: nouveau } = enregistrer(l, flow, ['p0']);
    expect(nouveau.periodicity.anchorDate).toBe('2025-06-25');
    expect(
      proposeMatches(ledger, '2025-01-01', '2026-12-31')
        .map((m) => [m.operationId, m.expectedDate, m.auto])
        .sort(),
    ).toEqual([
      ['p1', '2025-08-25', true],
      ['p2', '2025-09-25', true],
      ['p3', '2025-10-25', true],
      ['p4', '2025-11-25', true],
    ]);
  });
});
