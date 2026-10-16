/**
 * Tests du codeur de #488, troisième tour : le point 8 amendé (porteur, 16/10, « dans le doute, on
 * propose »). Une reconnaissance est exacte quand l'expression régulière la donnait, souple quand seul le
 * score la donne, un score de 1 compris ; plusieurs comptes, dont l'un souplement : aucune destination ;
 * une reprise automatique n'a qu'un candidat, et ne diverge pas de la destination ; changer le compte
 * désigné d'un côté apparié par une reprise défait l'appariement (point 5).
 *
 * Données inventées (D84) : un compte principal, les comptes de Léa, de Léane et de Thomas.
 */
import { describe, expect, it } from 'vitest';
import {
  applyMatch,
  applyPatchToLedger,
  emptyLedger,
  euros,
  labelRecognizer,
  matchTirelireTransfers,
  normalizeLabel,
  proposeInternalTransfers,
  proposeMatches,
  runPipeline,
  type Ledger,
  type Operation,
  type PlannedFlow,
} from '../src/index.js';

const CC = 'acc-principal';
const LEA = 'acc-lea';
const LEANE = 'acc-leane';
const THOMAS = 'acc-thomas';
const MOTIF_LEA = 'VIR SEPA ARGENT POCHE LEA';
const MOTIF_LEANE = 'VIR SEPA ARGENT POCHE LEANE';

function op(id: string, accountId: string, date: string, label: string, amount: number, o: Partial<Operation> = {}): Operation {
  return { id, accountId, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated', ...o };
}

function ordre(id: string, vers: string, motif: string): PlannedFlow {
  return { id, name: `Virement ${vers}`, kind: 'transfer', amount: -euros(20), accountId: CC, counterpartAccountId: vers, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' }, dateWindowDays: 5, labelPattern: motif, amountTolerance: { pct: 20 } };
}

function base(flows: PlannedFlow[], ...ops: Operation[]): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2025-12-31' },
    { id: LEA, name: 'Léa', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
    { id: LEANE, name: 'Léane', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
    { id: THOMAS, name: 'Thomas', kind: 'courant', openingBalance: 0, openingDate: '2025-12-31' },
  );
  l.plannedFlows.push(...flows);
  l.operations.push(...ops);
  return l;
}

function importer(l: Ledger): Ledger {
  let out = l;
  runPipeline(out, '2026-03-25', '2026-04-10', (p) => (out = applyPatchToLedger(out, p)));
  return out;
}

const trouve = (l: Ledger, id: string) => l.operations.find((o) => o.id === id)!;
const creditsLeaLeane = () => [op('c-lea', LEA, '2026-04-01', 'VIR RECU', euros(20)), op('c-leane', LEANE, '2026-04-02', 'VIR RECU', euros(20))];

describe('#488 · 8. exacte ou souple : la lecture d’avant, ou le score seul', () => {
  it('[niveau 4] un score de 1 est une reconnaissance souple ; l’expression régulière, sur le libellé normalisé compris, est exacte', () => {
    const lit = (motif: string, label: string) => labelRecognizer(motif)(op('x', CC, '2026-04-01', label, -euros(20)));
    // « LEA », dernier mot du libellé, lu comme « LEANE » coupé : score de 1, mais souple.
    expect(lit(MOTIF_LEANE, MOTIF_LEA)).toBe('souple');
    expect(lit(MOTIF_LEA, MOTIF_LEA)).toBe('exact');
    expect(lit(MOTIF_LEA, `PRLV ${MOTIF_LEA} REF 9`)).toBe('exact');
    expect(lit(MOTIF_LEA, 'vir sepa argent poche léa')).toBe('exact');
    // Ce que seul le score reconnaît, sans mot absent : souple aussi.
    expect(lit(MOTIF_LEA, 'VIR-SEPA ARGENT DE POCHE LEA')).toBe('souple');
  });
});

describe('#488 · 8. le piège des prénoms dont l’un commence l’autre', () => {
  it('[niveau 4] « … LEANE », reconnu exactement par les deux ordres : le plus long l’emporte, il s’apparie au crédit de Léane et l’ordre de Léane le reprend', () => {
    const avant = base([ordre('ordre-lea', LEA, MOTIF_LEA), ordre('ordre-leane', LEANE, MOTIF_LEANE)], op('d-leane', CC, '2026-04-04', MOTIF_LEANE, -euros(20)), ...creditsLeaLeane());
    expect(matchTirelireTransfers(avant).operations.map((o) => [o.id, o.transferAccountId])).toEqual([['d-leane', LEANE]]);
    // La reprise ne diverge pas de la destination : l'ordre de Léa ne la sélectionne pas.
    expect(proposeMatches(avant, '2026-03-25', '2026-04-10').map((p) => [p.flowId, p.auto])).toEqual([['ordre-leane', true]]);
    const d = trouve(importer(avant), 'd-leane');
    expect([d.transferAccountId, d.transferOperationId, d.plannedFlowId]).toEqual([LEANE, 'c-leane', 'ordre-leane']);
  });

  it('[niveau 4] « … LEA », exact pour Léa et souple pour Léane : pas de destination, la paire se propose avec chaque crédit, et la reprise avec chaque ordre, sans rien d’office', () => {
    const avant = base([ordre('ordre-lea', LEA, MOTIF_LEA), ordre('ordre-leane', LEANE, MOTIF_LEANE)], op('d-lea', CC, '2026-04-01', MOTIF_LEA, -euros(20)), ...creditsLeaLeane());
    expect(matchTirelireTransfers(avant).operations).toEqual([]);
    const reprises = proposeMatches(avant, '2026-03-25', '2026-04-10');
    expect(reprises.map((p) => [p.operationId, p.flowId, p.auto]).sort()).toEqual([
      ['d-lea', 'ordre-lea', false],
      ['d-lea', 'ordre-leane', false],
    ]);
    const l = importer(avant);
    const d = trouve(l, 'd-lea');
    expect([d.transferAccountId, d.transferOperationId, d.plannedFlowId]).toEqual([undefined, undefined, undefined]);
    expect(proposeInternalTransfers(l).filter((p) => p.debitId === 'd-lea').map((p) => p.creditId).sort()).toEqual(['c-lea', 'c-leane']);
  });

  it('[niveau 4] les deux virements du mois : « … LEANE » s’apparie, « … LEA » se propose, aucune fausse paire', () => {
    const l = importer(
      base([ordre('ordre-lea', LEA, MOTIF_LEA), ordre('ordre-leane', LEANE, MOTIF_LEANE)], op('d-lea', CC, '2026-04-01', MOTIF_LEA, -euros(20)), op('d-leane', CC, '2026-04-04', MOTIF_LEANE, -euros(20)), ...creditsLeaLeane()),
    );
    expect(trouve(l, 'd-leane').transferOperationId).toBe('c-leane');
    expect(trouve(l, 'c-leane').transferOperationId).toBe('d-leane');
    expect(trouve(l, 'd-lea').transferOperationId).toBeUndefined();
    expect(trouve(l, 'c-lea').transferOperationId).toBeUndefined();
    expect(proposeInternalTransfers(l).map((p) => [p.debitId, p.creditId])).toEqual([['d-lea', 'c-lea']]);
  });

  it('[niveau 4] avec le seul ordre de Léane, « … LEA » est reconnu par lui seul : sa destination est Léane', () => {
    const avant = base([ordre('ordre-leane', LEANE, MOTIF_LEANE)], op('d-lea', CC, '2026-04-01', MOTIF_LEA, -euros(20)), ...creditsLeaLeane());
    expect(matchTirelireTransfers(avant).operations.map((o) => [o.id, o.transferAccountId])).toEqual([['d-lea', LEANE]]);
    const d = trouve(importer(avant), 'd-lea');
    expect([d.transferAccountId, d.transferOperationId]).toEqual([LEANE, 'c-leane']);
  });

  it('[niveau 4] deux ordres reconnaissent exactement, à égalité de longueur : aucune destination, aucune reprise d’office, chacun se propose', () => {
    const avant = base([ordre('ordre-lea', LEA, 'LEA'), ordre('ordre-thomas', THOMAS, 'TOM')], op('d', CC, '2026-04-01', 'VIR LEA TOM', -euros(20)));
    expect(matchTirelireTransfers(avant).operations).toEqual([]);
    expect(proposeMatches(avant, '2026-03-25', '2026-04-10').map((p) => [p.flowId, p.auto]).sort()).toEqual([
      ['ordre-lea', false],
      ['ordre-thomas', false],
    ]);
  });
});

describe('#488 · 8. une reprise automatique n’a qu’un candidat', () => {
  it('[niveau 4] deux flux reconnaissent un libellé, l’un souplement : aucun ne le reprend d’office, chacun se propose', () => {
    const flux = (id: string, motif: string): PlannedFlow => ({ id, name: id, kind: 'fixedCharge', amount: -euros(30), accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-05' }, dateWindowDays: 5, labelPattern: motif });
    const avant = base([flux('court', 'ABONNEMENT SALLE SPORT'), flux('long', 'ABONNEMENT SALLE SPORT CLUB ANNUEL')], op('d', CC, '2026-04-05', 'PRLV ABONNEMENT SALLE SPORT CLUB', -euros(30)));
    expect(labelRecognizer('ABONNEMENT SALLE SPORT')(avant.operations[0]!)).toBe('exact');
    expect(labelRecognizer('ABONNEMENT SALLE SPORT CLUB ANNUEL')(avant.operations[0]!)).toBe('souple');
    expect(proposeMatches(avant, '2026-03-25', '2026-04-10').map((p) => [p.flowId, p.auto]).sort()).toEqual([
      ['court', false],
      ['long', false],
    ]);
    expect(trouve(importer(avant), 'd').plannedFlowId).toBeUndefined();
  });

  it('[niveau 4] un seul flux reconnaît le libellé, exactement : il le reprend d’office, comme avant', () => {
    const flux: PlannedFlow = { id: 'court', name: 'court', kind: 'fixedCharge', amount: -euros(30), accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-05' }, dateWindowDays: 5, labelPattern: 'ABONNEMENT SALLE SPORT' };
    const avant = base([flux], op('d', CC, '2026-04-05', 'PRLV ABONNEMENT SALLE SPORT CLUB', -euros(30)));
    expect(proposeMatches(avant, '2026-03-25', '2026-04-10').map((p) => [p.flowId, p.auto])).toEqual([['court', true]]);
  });
});

describe('#488 · 5. une reprise par l’ordre d’un autre compte défait l’appariement', () => {
  it('[niveau 4] le côté apparié repris par un ordre vers un autre compte : les deux côtés ne se désignent plus, l’autre garde son état', () => {
    const l = importer(base([ordre('ordre-lea', LEA, MOTIF_LEA)], op('d', CC, '2026-04-01', MOTIF_LEA, -euros(20)), op('c', LEA, '2026-04-01', 'VIR RECU', euros(20))));
    expect(trouve(l, 'd').transferOperationId).toBe('c');
    // L'utilisateur confirme une reprise par un ordre vers Thomas (« Reprendre une occurrence »).
    const avecThomas: Ledger = { ...l, plannedFlows: [...l.plannedFlows, ordre('ordre-thomas', THOMAS, 'AUTRE MOTIF')] };
    const apres = applyPatchToLedger(avecThomas, applyMatch(avecThomas, { operationId: 'd', flowId: 'ordre-thomas', expectedDate: '2026-04-01', expectedAmount: -euros(20), score: 1, auto: false, reasons: [] }));
    const d = trouve(apres, 'd');
    const c = trouve(apres, 'c');
    expect([d.transferAccountId, d.transferOperationId]).toEqual([THOMAS, undefined]);
    expect([c.transferAccountId, c.transferOperationId, c.state]).toEqual([undefined, undefined, trouve(l, 'c').state]);
  });

  it('[niveau 4] repris par un ordre vers le compte qu’il désigne déjà : l’appariement reste', () => {
    const avant = base([ordre('ordre-lea', LEA, 'AUTRE MOTIF')], op('d', CC, '2026-04-01', 'VIR SEPA', -euros(20), { transferAccountId: LEA, transferOperationId: 'c', state: 'reconciled' }), op('c', LEA, '2026-04-01', 'VIR RECU', euros(20), { transferAccountId: CC, transferOperationId: 'd', state: 'reconciled' }));
    const apres = applyPatchToLedger(avant, applyMatch(avant, { operationId: 'd', flowId: 'ordre-lea', expectedDate: '2026-04-01', expectedAmount: -euros(20), score: 1, auto: false, reasons: [] }));
    expect([trouve(apres, 'd').transferOperationId, trouve(apres, 'c').transferOperationId]).toEqual(['c', 'd']);
  });
});
