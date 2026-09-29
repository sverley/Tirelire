/**
 * #183 · Ce qui reste des tests du codeur sur les occurrences d'un virement permanent, une fois le
 * harnais composé : les tests qui tranchent les points 5 et 6 du « Fait quand » ont rejoint le
 * harnais (`plan-sans-hypothese.test.ts`, auditeur.md, étape 2) ; celui-ci, redondant avec le point 7
 * du harnais, reste au niveau 4 (D83).
 *
 * Le jeu d'exemple porte l'ordre vers le Livret A, mensuel, le 28 (fenêtre de 5 jours), et
 * n'importe aucun relevé. Les soldes sont connus au 8 septembre 2026, dans la période « septembre
 * 2026 » (28/08 → 27/09) ; celle du 28 septembre ouvre la période « octobre 2026 », à venir.
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

describe('[niveau 4] #183 · commencer à importer ne change ni les besoins ni le virement permanent (point 7, redondant avec le harnais)', () => {
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
