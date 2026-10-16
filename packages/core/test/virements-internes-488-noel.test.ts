/**
 * Tests du codeur de #488, quatrième tour : le point 8, « Une reprise automatique n'a qu'un candidat »
 * (porteur, 16/10, sur la troisième question de l'auditeur). Ne comptent parmi les « plusieurs flux »
 * que ceux qui retiennent le virement, leur sélection entière (D24) : compte, motif, tolérance de
 * montant, fenêtre des occurrences. Un flux que le montant ou la fenêtre écarte ne compte pas.
 *
 * Données inventées (D84) : un compte principal et le compte de Léa ; « Le piège de l'ordre de Noël ».
 */
import { describe, expect, it } from 'vitest';
import {
  applyPatchToLedger,
  emptyLedger,
  euros,
  labelRecognizer,
  matchTirelireTransfers,
  normalizeLabel,
  proposeMatches,
  runPipeline,
  type Ledger,
  type Operation,
  type PlannedFlow,
} from '../src/index.js';

const CC = 'acc-principal';
const LEA = 'acc-lea';
const MOTIF_MOIS = 'VIR SEPA ARGENT POCHE LEA';
const MOTIF_NOEL = 'VIR SEPA ARGENT POCHE LEA NOEL';

function op(id: string, accountId: string, date: string, label: string, amount: number): Operation {
  return { id, accountId, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated' };
}

/** L'ordre mensuel de 20 €, le 1er de chaque mois. */
const mensuel: PlannedFlow = {
  id: 'ordre-mois',
  name: 'Argent de poche Léa',
  kind: 'transfer',
  amount: -euros(20),
  accountId: CC,
  counterpartAccountId: LEA,
  periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' },
  dateWindowDays: 5,
  labelPattern: MOTIF_MOIS,
  amountTolerance: { pct: 20 },
};

/** L'ordre de Noël, 50 € chaque 1er décembre, sauf ce que le test change. */
function noel(o: Partial<PlannedFlow> = {}): PlannedFlow {
  return {
    id: 'ordre-noel',
    name: 'Noël de Léa',
    kind: 'transfer',
    amount: -euros(50),
    accountId: CC,
    counterpartAccountId: LEA,
    periodicity: { interval: 1, unit: 'year', anchorDate: '2025-12-01' },
    dateWindowDays: 5,
    labelPattern: MOTIF_NOEL,
    amountTolerance: { pct: 20 },
    ...o,
  };
}

function base(flows: PlannedFlow[]): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2025-12-31' },
    { id: LEA, name: 'Léa', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
  );
  l.plannedFlows.push(...flows);
  // Le virement d'avril, 20 €, et son crédit sur le compte de Léa.
  l.operations.push(op('d-avril', CC, '2026-04-01', MOTIF_MOIS, -euros(20)), op('c-avril', LEA, '2026-04-01', 'VIR RECU', euros(20)));
  return l;
}

function importer(l: Ledger): Ledger {
  let out = l;
  runPipeline(out, '2026-03-25', '2026-04-10', (p) => (out = applyPatchToLedger(out, p)));
  return out;
}

const trouve = (l: Ledger, id: string) => l.operations.find((o) => o.id === id)!;
const reprises = (l: Ledger) => proposeMatches(l, '2026-03-25', '2026-04-10').map((p) => [p.operationId, p.flowId, p.auto]);

describe('#488 · 8. le piège de l’ordre de Noël : seuls comptent les flux qui retiennent le virement', () => {
  it('[niveau 4] le virement d’avril est reconnu exactement par l’ordre mensuel et souplement par celui de Noël', () => {
    const d = base([]).operations[0]!;
    expect(labelRecognizer(MOTIF_MOIS)(d)).toBe('exact');
    expect(labelRecognizer(MOTIF_NOEL)(d)).toBe('souple');
  });

  it('[niveau 4] l’ordre de Noël, que son montant et sa fenêtre écartent, ne compte pas : l’ordre mensuel reprend le virement d’office, et l’appariement se fait', () => {
    const avant = base([mensuel, noel()]);
    // Les deux ordres vont vers Léa : la destination, lue sur les libellés seuls, est connue.
    expect(matchTirelireTransfers(avant).operations.map((o) => [o.id, o.transferAccountId])).toEqual([['d-avril', LEA]]);
    expect(reprises(avant)).toEqual([['d-avril', 'ordre-mois', true]]);
    const d = trouve(importer(avant), 'd-avril');
    expect([d.transferAccountId, d.transferOperationId, d.plannedFlowId, d.state]).toEqual([LEA, 'c-avril', 'ordre-mois', 'reconciled']);
  });

  it('[niveau 4] le montant seul l’écarte (50 € chaque mois) : l’ordre mensuel le reprend d’office', () => {
    const avant = base([mensuel, noel({ periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' } })]);
    expect(reprises(avant)).toEqual([['d-avril', 'ordre-mois', true]]);
  });

  it('[niveau 4] la fenêtre seule l’écarte (20 €, chaque décembre) : l’ordre mensuel le reprend d’office', () => {
    const avant = base([mensuel, noel({ amount: -euros(20) })]);
    expect(reprises(avant)).toEqual([['d-avril', 'ordre-mois', true]]);
  });

  it('[niveau 4] l’ordre de Noël, hors de ses dates d’activité, ne compte pas', () => {
    const avant = base([mensuel, noel({ amount: -euros(20), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' }, activeFrom: '2026-11-01' })]);
    expect(reprises(avant)).toEqual([['d-avril', 'ordre-mois', true]]);
  });

  it('[niveau 4] si le montant et la fenêtre de l’ordre de Noël le retenaient aussi, aucun ne le reprend d’office : la reprise se propose avec chacun', () => {
    const avant = base([mensuel, noel({ amount: -euros(20), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' } })]);
    expect(reprises(avant).sort()).toEqual([
      ['d-avril', 'ordre-mois', false],
      ['d-avril', 'ordre-noel', false],
    ]);
    const d = trouve(importer(avant), 'd-avril');
    // La destination reste connue : l'appariement se fait ; la reprise attend un geste.
    expect([d.transferAccountId, d.transferOperationId, d.plannedFlowId]).toEqual([LEA, 'c-avril', undefined]);
  });
});
