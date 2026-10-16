/**
 * Tests du codeur de #488, sixième tour : le point 8, « Le mieux noté ne l'emporte que s'il se
 * distingue » (porteur, 16/10, sur la remarque de l'auditeur au cinquième tour). Tous de niveau 4.
 *
 * Données inventées (D84) : un compte principal et le compte de Léa ; « Le piège de l'ordre et de la
 * dépense » de l'issue, puis des charges du principal, pour la règle sur toute opération.
 */
import { describe, expect, it } from 'vitest';
import {
  MATCH_SCORE_CLOSE,
  MATCH_SCORE_HIGH,
  applyPatchToLedger,
  emptyLedger,
  euros,
  normalizeLabel,
  proposeMatches,
  runPipeline,
  type Ledger,
  type Operation,
  type PlannedFlow,
} from '../src/index.js';

const CC = 'acc-principal';
const LEA = 'acc-lea';
const MOTIF_LEA = 'VIR SEPA ARGENT POCHE LEA';
const DU = '2026-03-25';
const AU = '2026-04-15';

function op(id: string, accountId: string, date: string, label: string, amount: number): Operation {
  return { id, accountId, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated' };
}

/** Un flux mensuel du principal, ancré au jour donné d'avril, de fenêtre 5 jours, sauf ce que le test change. */
function flux(o: Partial<PlannedFlow> & Pick<PlannedFlow, 'id' | 'kind' | 'amount'>, jour: string, fenetre = 5): PlannedFlow {
  return { name: o.id, accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: `2026-01-${jour}` }, dateWindowDays: fenetre, ...o };
}

/** L'ordre du principal vers Léa, 20 € le 1er ; une dépense sans motif, 20 € le 5. */
const ORDRE = flux({ id: 'ordre-lea', kind: 'transfer', amount: -euros(20), counterpartAccountId: LEA, labelPattern: MOTIF_LEA }, '01');
const DEPENSE = flux({ id: 'depense', kind: 'fixedCharge', amount: -euros(20) }, '05');

function base(flows: PlannedFlow[], ...operations: Operation[]): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2025-12-31' },
    { id: LEA, name: 'Léa', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
  );
  l.plannedFlows.push(...flows);
  l.operations.push(...operations);
  return l;
}

function importer(l: Ledger): Ledger {
  let out = l;
  runPipeline(out, DU, AU, (p) => (out = applyPatchToLedger(out, p)));
  return out;
}

const reprises = (l: Ledger) => proposeMatches(l, DU, AU).map((p) => [p.operationId, p.flowId, Math.round(p.score * 100) / 100, p.auto]);
const de = (l: Ledger, id: string) => l.operations.find((o) => o.id === id)!;
const virement = (jour: string) => [op('d', CC, `2026-04-${jour}`, MOTIF_LEA, -euros(20)), op('c', LEA, `2026-04-${jour}`, 'VIR RECU', euros(20))];

describe('#488 · 8. le piège de l’ordre et de la dépense', () => {
  it('[niveau 4] les seuils : élevée à 0,7, proche à 0,1', () => {
    expect([MATCH_SCORE_HIGH, MATCH_SCORE_CLOSE]).toEqual([0.7, 0.1]);
  });

  it('[niveau 4] le virement le 5 : 0,80 pour l’ordre, 0,80 pour la dépense, élevées et proches : aucun ne le reprend d’office, la reprise se propose avec chacun, et l’appariement se fait avec Léa', () => {
    const avant = base([ORDRE, DEPENSE], ...virement('05'));
    expect(reprises(avant).sort()).toEqual([
      ['d', 'depense', 0.8, false],
      ['d', 'ordre-lea', 0.8, false],
    ]);
    const d = de(importer(avant), 'd');
    expect([d.transferAccountId, d.transferOperationId, d.plannedFlowId]).toEqual([LEA, 'c', undefined]);
  });

  it('[niveau 4] le virement le 1er : 1,00 pour l’ordre, 0,60 pour la dépense : l’ordre se distingue et le reprend d’office ; la dépense ne se propose pas', () => {
    const avant = base([ORDRE, DEPENSE], ...virement('01'));
    expect(reprises(avant)).toEqual([['d', 'ordre-lea', 1, true]]);
    const d = de(importer(avant), 'd');
    expect([d.transferAccountId, d.transferOperationId, d.plannedFlowId]).toEqual([LEA, 'c', 'ordre-lea']);
  });

  it('[niveau 4] à date et montant égaux, un libellé reconnu départage : l’ordre ancré le 5, 1,00, contre la dépense, 0,80', () => {
    const le5 = { ...ORDRE, periodicity: { ...ORDRE.periodicity, anchorDate: '2026-01-05' } };
    expect(reprises(base([le5, DEPENSE], ...virement('05')))).toEqual([['d', 'ordre-lea', 1, true]]);
  });
});

describe('#488 · 8. le mieux noté ne l’emporte que s’il se distingue, pour toute opération', () => {
  const PRLV = op('o', CC, '2026-04-07', 'PRLV GAZ', -euros(50));
  const gaz = flux({ id: 'gaz', kind: 'fixedCharge', amount: -euros(50), labelPattern: 'GAZ' }, '05', 3);

  it('[niveau 4] une charge que retiennent un flux reconnu, 0,85, et un flux sans motif, 0,80 : aucun ne la reprend d’office, chacun se propose', () => {
    const sansMotif = flux({ id: 'sans-motif', kind: 'fixedCharge', amount: -euros(50) }, '07', 3);
    expect(reprises(base([gaz, sansMotif], PRLV)).sort()).toEqual([
      ['o', 'gaz', 0.85, false],
      ['o', 'sans-motif', 0.8, false],
    ]);
    expect(de(importer(base([gaz, sansMotif], PRLV)), 'o').plannedFlowId).toBeUndefined();
  });

  it('[niveau 4] l’autre, à 0,58, ne lui est pas proche : le flux reconnu la reprend d’office, seul', () => {
    const loin = flux({ id: 'loin', kind: 'fixedCharge', amount: -euros(50) }, '04', 3);
    expect(reprises(base([gaz, loin], PRLV))).toEqual([['o', 'gaz', 0.85, true]]);
  });

  it('[niveau 4] proches mais pas élevées, 0,65 et 0,60 : le mieux noté la reprend d’office, seul', () => {
    const a = flux({ id: 'a', kind: 'fixedCharge', amount: -euros(50) }, '05', 3);
    const b = flux({ id: 'b', kind: 'fixedCharge', amount: -euros(50) }, '03', 5);
    expect(reprises(base([a, b], PRLV))).toEqual([['o', 'a', 0.65, true]]);
  });

  it('[niveau 4] les deux bornes comprises : 0,80 et 0,70, élevée et proche, chacun se propose', () => {
    const a = flux({ id: 'a', kind: 'fixedCharge', amount: -euros(50) }, '07', 3);
    const b = flux({ id: 'b', kind: 'fixedCharge', amount: -euros(50) }, '06', 2);
    expect(reprises(base([a, b], PRLV)).sort()).toEqual([
      ['o', 'a', 0.8, false],
      ['o', 'b', 0.7, false],
    ]);
  });

  it('[niveau 4] à égalité au plus haut, même basse (0,55 et 0,55) : aucun n’est le mieux noté, chacun se propose (hypothèse du codeur)', () => {
    const a = flux({ id: 'a', kind: 'fixedCharge', amount: -euros(50) }, '02', 5);
    const b = flux({ id: 'b', kind: 'fixedCharge', amount: -euros(50) }, '12', 5);
    expect(reprises(base([a, b], PRLV)).sort()).toEqual([
      ['o', 'a', 0.55, false],
      ['o', 'b', 0.55, false],
    ]);
  });
});
