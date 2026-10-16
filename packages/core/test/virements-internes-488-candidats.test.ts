/**
 * Tests du codeur de #488, cinquième tour : le point 8, « Une reprise automatique n'a qu'un candidat »,
 * sur les deux retours de l'auditeur (PR #491, quatrième tour).
 * - Un flux sans motif dont le compte, le montant et la fenêtre conviennent retient le virement : il
 *   compte parmi les « plusieurs flux ».
 * - « Un virement n'est repris automatiquement que par un ordre du compte qui en est la destination
 *   connue » : un flux qui n'est pas un ordre vers elle ne fait que se proposer.
 *
 * Données inventées (D84) : un compte principal et le compte de Léa ; « Le piège de l'ordre de Noël ».
 */
import { describe, expect, it } from 'vitest';
import { emptyLedger, euros, normalizeLabel, proposeMatches, type Ledger, type Operation, type PlannedFlow } from '../src/index.js';

const CC = 'acc-principal';
const LEA = 'acc-lea';
const MOTIF_MOIS = 'VIR SEPA ARGENT POCHE LEA';
const MOTIF_NOEL = 'VIR SEPA ARGENT POCHE LEA NOEL';
const MENSUELLE = { interval: 1, unit: 'month', anchorDate: '2026-01-01' } as const;

function op(id: string, accountId: string, date: string, label: string, amount: number, o: Partial<Operation> = {}): Operation {
  return { id, accountId, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated', ...o };
}

function flux(o: Partial<PlannedFlow> & Pick<PlannedFlow, 'id' | 'kind' | 'amount' | 'accountId'>): PlannedFlow {
  return { name: o.id, periodicity: MENSUELLE, dateWindowDays: 5, amountTolerance: { pct: 20 }, ...o };
}

/** L'ordre de Noël porté à 20 € chaque mois : il reconnaît souplement le virement d'avril, et le retient. */
const noel20 = flux({ id: 'ordre-noel', kind: 'transfer', amount: -euros(20), accountId: CC, counterpartAccountId: LEA, labelPattern: MOTIF_NOEL });
/** Une dépense sans motif, 20 € chaque mois, sur le compte principal. */
const depense = flux({ id: 'depense', kind: 'fixedCharge', amount: -euros(20), accountId: CC });
/** Un ordre vers Léa sans motif, 20 € chaque mois. */
const ordreSansMotif = flux({ id: 'ordre-sans-motif', kind: 'transfer', amount: -euros(20), accountId: CC, counterpartAccountId: LEA });
/** L'ordre mensuel « … LEA », le 15 : il donne la destination Léa, sans retenir le virement du 1er (sa fenêtre). */
const mensuelLe15 = flux({
  id: 'poche',
  kind: 'transfer',
  amount: -euros(20),
  accountId: CC,
  counterpartAccountId: LEA,
  labelPattern: MOTIF_MOIS,
  periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-15' },
});

function base(flows: PlannedFlow[], operations: Operation[] = [op('d-avril', CC, '2026-04-01', MOTIF_MOIS, -euros(20))]): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2025-12-31' },
    { id: LEA, name: 'Léa', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
  );
  l.plannedFlows.push(...flows);
  l.operations.push(...operations);
  return l;
}

const reprises = (l: Ledger) =>
  proposeMatches(l, '2026-03-25', '2026-04-10')
    .map((p) => [p.operationId, p.flowId, p.auto] as const)
    .sort((a, b) => a[1].localeCompare(b[1]));

describe('#488 · 8. un flux sans motif retient le virement, et compte parmi les « plusieurs flux »', () => {
  it('[niveau 4] l’ordre de Noël à 20 € et une dépense sans motif de 20 € : aucun ne le reprend d’office, la reprise se propose avec chacun', () => {
    expect(reprises(base([noel20, depense]))).toEqual([
      ['d-avril', 'depense', false],
      ['d-avril', 'ordre-noel', false],
    ]);
  });

  it('[niveau 4] de même avec un ordre vers Léa sans motif', () => {
    expect(reprises(base([noel20, ordreSansMotif]))).toEqual([
      ['d-avril', 'ordre-noel', false],
      ['d-avril', 'ordre-sans-motif', false],
    ]);
  });

  it('[niveau 4] l’ordre de Noël seul le reprend d’office : un seul flux le retient', () => {
    expect(reprises(base([noel20]))).toEqual([['d-avril', 'ordre-noel', true]]);
  });
});

describe('#488 · 8. un virement à destination connue n’est repris d’office que par un ordre vers elle', () => {
  it('[niveau 4] l’ordre mensuel hors de sa fenêtre donne la destination Léa : la dépense sans motif de 20 € se propose seulement', () => {
    expect(reprises(base([mensuelLe15, depense]))).toEqual([['d-avril', 'depense', false]]);
  });

  it('[niveau 4] sans destination connue, la dépense sans motif de montant exact reprend d’office, comme avant', () => {
    expect(reprises(base([depense], [op('d-avril', CC, '2026-04-01', 'PRLV QUELCONQUE', -euros(20))]))).toEqual([['d-avril', 'depense', true]]);
  });

  it('[niveau 4] un crédit désigné depuis le principal : un revenu sans motif du compte de Léa se propose seulement, un ordre vers le principal le reprend d’office', () => {
    const credit = op('c-avril', LEA, '2026-04-01', 'VIR RECU', euros(20), { transferAccountId: CC, state: 'reconciled' });
    const revenu = flux({ id: 'revenu', kind: 'income', amount: euros(20), accountId: LEA });
    const ordreRecu = flux({ id: 'ordre-recu', kind: 'transfer', amount: euros(20), accountId: LEA, counterpartAccountId: CC });
    expect(reprises(base([revenu], [credit]))).toEqual([['c-avril', 'revenu', false]]);
    expect(reprises(base([ordreRecu], [credit]))).toEqual([['c-avril', 'ordre-recu', true]]);
  });
});
