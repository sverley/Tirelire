/**
 * Tests du codeur de #488, sixième tour : le point 8, « Le mieux noté ne l'emporte que s'il se
 * distingue » (porteur, 16/10, sur la remarque de l'auditeur au cinquième tour). Tous de niveau 4.
 * Le piège de l'ordre et de la dépense et la règle des notes sont passés au harnais
 * (`virements-internes-harnais.test.ts`) ; le diagnostic des seuils, qui recopiait un réglage, est
 * retiré (D78). Reste l'hypothèse du codeur sur l'égalité au plus haut.
 *
 * Septième tour : les tests de la même règle dans l'autre sens, pour une occurrence que plusieurs
 * opérations se disputent, et du piège du doublon, sont passés au harnais.
 *
 * Données inventées (D84) : un compte principal et des charges.
 */
import { describe, expect, it } from 'vitest';
import { emptyLedger, euros, normalizeLabel, proposeMatches, type Ledger, type Operation, type PlannedFlow } from '../src/index.js';

const CC = 'acc-principal';
const DU = '2026-03-25';
const AU = '2026-04-15';

function op(id: string, accountId: string, date: string, label: string, amount: number): Operation {
  return { id, accountId, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated' };
}

/** Un flux mensuel du principal, ancré au jour donné, de fenêtre 5 jours, sauf ce que le test change. */
function flux(o: Partial<PlannedFlow> & Pick<PlannedFlow, 'id' | 'kind' | 'amount'>, jour: string, fenetre = 5): PlannedFlow {
  return { name: o.id, accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: `2026-01-${jour}` }, dateWindowDays: fenetre, ...o };
}

function base(flows: PlannedFlow[], ...operations: Operation[]): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2025-12-31' },
  );
  l.plannedFlows.push(...flows);
  l.operations.push(...operations);
  return l;
}

const reprises = (l: Ledger) => proposeMatches(l, DU, AU).map((p) => [p.operationId, p.flowId, Math.round(p.score * 100) / 100, p.auto]);

describe('#488 · 8. le mieux noté ne l’emporte que s’il se distingue, pour toute opération', () => {
  const PRLV = op('o', CC, '2026-04-07', 'PRLV GAZ', -euros(50));

  it('[niveau 4] à égalité au plus haut, même basse (0,55 et 0,55) : aucun n’est le mieux noté, chacun se propose (hypothèse du codeur)', () => {
    const a = flux({ id: 'a', kind: 'fixedCharge', amount: -euros(50) }, '02', 5);
    const b = flux({ id: 'b', kind: 'fixedCharge', amount: -euros(50) }, '12', 5);
    expect(reprises(base([a, b], PRLV)).sort()).toEqual([
      ['o', 'a', 0.55, false],
      ['o', 'b', 0.55, false],
    ]);
  });
});
