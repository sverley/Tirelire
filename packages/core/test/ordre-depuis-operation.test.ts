/**
 * Tests du codeur de #435, côté cœur : ce que l'écran Opérations lit pour proposer, depuis
 * l'opération, d'en faire l'ordre permanent — toutes les opérations qui se proposent, sur un seul
 * calcul du plan (`transfersToOrder`), et la reprise de la première occurrence d'un ordre corrigé
 * dans le panneau (`resumeFirstOccurrence`).
 *
 * Données inventées : un compte principal, un Livret A, un compte joint sans tirelire ; sur le
 * livret, une tirelire qui porte une échéance (400 €/mois) et un objectif (250 €/mois). Lecture le
 * 6 septembre 2026.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPatchToLedger,
  emptyLedger,
  euros,
  normalizeLabel,
  orderFromTransfer,
  recordOrderFromTransfer,
  resumeFirstOccurrence,
  transfersToOrder,
  type Ledger,
  type Operation,
} from '../src/index.js';

const CC = 'acc-principal';
const LIVRET = 'livret';
const JOINT = 'joint';
const LECTURE = '2026-09-06';
const mensuel = (anchorDate: string) => ({ interval: 1, unit: 'month' as const, anchorDate });

function budget(tirelires = true): Ledger {
  const l = emptyLedger({ periodStartDay: 28, orderRounding: euros(10) });
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(3000), openingDate: '2026-08-27' },
    { id: LIVRET, name: 'Livret A', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-27' },
    { id: JOINT, name: 'Compte joint', kind: 'courant', openingBalance: 0, openingDate: '2026-08-27' },
  );
  if (tirelires) {
    l.tirelires.push(
      { id: 'taxe', name: 'Taxe', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' },
      { id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' },
    );
    l.needs.push(
      { id: 'n-taxe', tirelireId: 'taxe', kind: 'dueDate', amount: euros(4800), periodicity: { interval: 12, unit: 'month', anchorDate: '2027-08-15' }, priority: 10 },
      { id: 'n-vac', tirelireId: 'vac', kind: 'goal', amount: euros(9000), monthlyAmount: euros(250), priority: 30 },
    );
  }
  l.plannedFlows.push({ id: 'salaire', name: 'Salaire', kind: 'income', amount: euros(2500), accountId: CC, periodicity: mensuel('2026-08-28'), dateWindowDays: 3 });
  return l;
}

function op(id: string, montant: number, o: Partial<Operation> = {}): Operation {
  const label = o.label ?? 'VIR SEPA EPARGNE LIVRET A M DUPONT';
  return { id, accountId: CC, origin: 'imported', date: '2026-09-02', label, normalizedLabel: normalizeLabel(label), amount: montant, state: 'locked', ...o };
}

function projet(tirelires = true): Ledger {
  const l = budget(tirelires);
  l.operations.push(
    op('vir-aout', -euros(600), { date: '2026-08-29', state: 'reconciled', transferAccountId: LIVRET }),
    op('vir-sept', -euros(600), { transferAccountId: LIVRET }),
    op('vir-joint', -euros(200), { transferAccountId: JOINT }),
    op('vir-brut', -euros(300)),
    op('credit', euros(600), { accountId: LIVRET, transferAccountId: CC }),
    op('saisie', -euros(600), { origin: 'manual', transferAccountId: LIVRET }),
    op('supprimee', -euros(600), { transferAccountId: LIVRET, deletedAt: '2026-09-03T00:00:00Z' }),
  );
  return l;
}

describe('[niveau 4] #435 · 1. transfersToOrder : la règle de orderFromTransfer, pour toutes les opérations', () => {
  it('les deux virements importés vers le livret, et eux seuls, chacun avec le livret', () => {
    const l = projet();
    const m = transfersToOrder(l, LECTURE);
    expect([...m.entries()].sort()).toEqual([
      ['vir-aout', LIVRET],
      ['vir-sept', LIVRET],
    ]);
  });

  it('dit, pour chaque opération, ce que dit orderFromTransfer', () => {
    const l = projet();
    const m = transfersToOrder(l, LECTURE);
    for (const o of l.operations) expect(m.has(o.id), o.id).toBe(orderFromTransfer(l, o.id, LECTURE, 'x') !== undefined);
  });

  it('sans tirelire (U5), aucune ; une fois l’ordre enregistré, plus aucune vers ce compte', () => {
    expect(transfersToOrder(projet(false), LECTURE).size).toBe(0);
    const l = projet();
    const r = recordOrderFromTransfer(l, 'vir-sept', LECTURE, 'ordre')!;
    const apres = applyPatchToLedger({ ...l, plannedFlows: [...l.plannedFlows, r.flow] }, r.patch);
    expect(transfersToOrder(apres, LECTURE).size).toBe(0);
  });

  it('ne modifie rien (I10)', () => {
    const l = projet();
    const avant = JSON.stringify(l);
    transfersToOrder(l, LECTURE);
    expect(JSON.stringify(l)).toBe(avant);
  });
});

describe('[niveau 4] #435 · 5. resumeFirstOccurrence : la reprise de l’ordre corrigé', () => {
  it('sans ventilation propre, l’opération prend les parts de l’ordre corrigé, et non celles de la proposition', () => {
    const l = projet();
    const base = orderFromTransfer(l, 'vir-sept', LECTURE, 'ordre', euros(500))!;
    const corrige = { ...base, action: { allocation: [{ tirelireId: 'vac', share: { kind: 'fixed' as const, amount: -euros(300) } }] } };
    const patch = resumeFirstOccurrence(l, 'vir-sept', corrige);
    const o = patch.operations.find((x) => x.id === 'vir-sept')!;
    expect(o.plannedFlowId).toBe('ordre');
    expect(o.plannedDate).toBe('2026-09-02');
    expect(o.state).toBe('locked');
    expect(patch.subOperations.map((s) => s.tirelireId)).toEqual(['vac']);
  });

  it('rend, pour l’ordre proposé, ce que rend recordOrderFromTransfer', () => {
    const l = projet();
    const r = recordOrderFromTransfer(l, 'vir-sept', LECTURE, 'ordre')!;
    const patch = resumeFirstOccurrence(l, 'vir-sept', r.flow);
    const sansId = (p: typeof patch) => ({ ...p, subOperations: p.subOperations.map(({ id: _id, ...s }) => s) });
    expect(sansId(patch)).toEqual(sansId(r.patch));
  });
});
