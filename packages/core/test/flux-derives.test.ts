import { describe, expect, it } from 'vitest';
import {
  applyMatch,
  computePlan,
  euros,
  exampleLedger,
  formatCents,
  isDerivedFlow,
  roundOrderUp,
  standingOrderFlow,
  standingTransferFlow,
  type Ledger,
  type Operation,
  type PlannedFlow,
} from '../src/index.js';

const asOf = '2026-09-06';

/** La ventilation que produirait l'import d'un virement de ce montant, tirelire par tirelire. */
function ventilation(l: Ledger, flow: PlannedFlow, montant: number): Map<string, number> {
  const op: Operation = {
    id: 'op-vir',
    accountId: 'acc-principal',
    origin: 'imported',
    date: '2026-09-28',
    label: flow.labelPattern!,
    normalizedLabel: flow.labelPattern!,
    amount: montant,
    state: 'untreated',
  };
  const avec: Ledger = { ...l, operations: [...l.operations, op], plannedFlows: [...l.plannedFlows, flow] };
  const patch = applyMatch(avec, {
    operationId: op.id,
    flowId: flow.id,
    expectedDate: '2026-09-28',
    expectedAmount: flow.amount,
    score: 1,
    auto: true,
    reasons: [],
  });
  return new Map(patch.allocations.map((a) => [a.tirelireId!, a.share.kind === 'fixed' ? a.share.amount : 0]));
}

const total = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);

function ordreVersLivret(l: Ledger, montant?: number): PlannedFlow {
  const plan = computePlan(l, asOf);
  const t = plan.transfers.find((x) => x.accountId === 'acc-livret')!;
  return standingTransferFlow(plan, t, 'acc-principal', 'flow-vir', montant ?? t.standing)!;
}

describe('un flux dérivé se recalcule au lieu d’être figé (D57)', () => {
  it('à montant inchangé, un budget qui bouge donne une autre ventilation', () => {
    const avantLedger = exampleLedger();
    const flow = ordreVersLivret(avantLedger);
    const avant = ventilation(avantLedger, flow, flow.amount);

    // Le budget change sans que la banque le sache : la taxe foncière est revue de 1 200 à
    // 2 400 €. L'ordre permanent, lui, vire toujours la même somme.
    const apresLedger: Ledger = {
      ...avantLedger,
      needs: avantLedger.needs.map((n) => (n.id === 'need-tf' ? { ...n, amount: euros(2400) } : n)),
    };
    const apres = ventilation(apresLedger, flow, flow.amount);

    // Le virement est réparti en entier dans les deux cas — mais pas de la même façon : c'est le
    // budget du jour qui décide, jamais la photo prise à l'enregistrement.
    expect(total(avant)).toBe(flow.amount);
    expect(total(apres)).toBe(flow.amount);
    expect([...apres.entries()]).not.toEqual([...avant.entries()]);
  });

  it('le flux enregistré ne sert qu’à reconnaître la ligne bancaire', () => {
    const l = exampleLedger();
    const flow = ordreVersLivret(l);
    expect(isDerivedFlow(flow)).toBe(true);
    // Ce qui reste écrit : le libellé, la tolérance, la fenêtre. Rien du budget.
    expect(flow.labelPattern).toBeTruthy();
    expect(flow.amountTolerance?.pct).toBe(20);
    expect(Object.keys(flow)).not.toContain('plannedAllocation');
    // Un flux saisi à la main reste déclaré : rien ne le réécrira.
    const { origin: _derive, ...reste } = flow;
    const declare: PlannedFlow = { ...reste, id: 'flow-main' };
    expect(isDerivedFlow(declare)).toBe(false);
    expect(standingOrderFlow([declare], 'acc-livret')).toBeUndefined();
    expect(standingOrderFlow([flow], 'acc-livret')?.id).toBe('flow-vir');
  });
});

describe('deux montants distincts : ce que le budget veut, ce que la banque fait (D58)', () => {
  it('l’écart se voit dans le plan et se dit', () => {
    const l = exampleLedger();
    const demande = computePlan(l, asOf).transfers.find((x) => x.accountId === 'acc-livret')!.standing;

    // Ordre posé chez la banque 50 € en dessous de ce que le budget demande.
    const enRetard: Ledger = { ...l, plannedFlows: [...l.plannedFlows, ordreVersLivret(l, demande - euros(50))] };
    const plan = computePlan(enRetard, asOf);
    const t = plan.transfers.find((x) => x.accountId === 'acc-livret')!;
    expect(t.bankOrder).toEqual({ flowId: 'flow-vir', amount: demande - euros(50), drift: euros(50) });
    // Le budget, lui, n'a pas bougé : ce qu'il demande reste ce qu'il demande.
    expect(t.standing).toBe(demande);
    const alerte = plan.warnings.find((w) => w.code === 'bankOrderDrift')!;
    expect(alerte.message).toContain('Livret A');
    expect(alerte.message).toContain(formatCents(demande - euros(50)));
    expect(alerte.message).toContain(formatCents(demande));

    // Une fois l'ordre modifié chez la banque et confirmé ici, plus rien à signaler.
    const aligne: Ledger = { ...l, plannedFlows: [...l.plannedFlows, ordreVersLivret(l)] };
    const planAligne = computePlan(aligne, asOf);
    expect(planAligne.transfers.find((x) => x.accountId === 'acc-livret')!.bankOrder!.drift).toBe(0);
    expect(planAligne.warnings.map((w) => w.code)).not.toContain('bankOrderDrift');
  });

  it('un ordre que le budget ne demande plus reste signalé', () => {
    const l = exampleLedger();
    const vide: Ledger = {
      ...l,
      accounts: [...l.accounts, { id: 'acc-vide', name: 'Livret vide', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-27' }],
      plannedFlows: [
        ...l.plannedFlows,
        {
          id: 'flow-vide',
          name: 'Virement Livret vide',
          kind: 'transfer',
          origin: 'derived',
          amount: -euros(300),
          accountId: 'acc-principal',
          counterpartAccountId: 'acc-vide',
          periodicity: { interval: 1, unit: 'month', anchorDate: '2026-08-28' },
          dateWindowDays: 5,
        },
      ],
    };
    const plan = computePlan(vide, asOf);
    const t = plan.transfers.find((x) => x.accountId === 'acc-vide')!;
    // Aucune tirelire n'y est placée : le budget ne demande rien, l'ordre continue pourtant de virer.
    expect(t.standing).toBe(0);
    expect(t.bankOrder).toEqual({ flowId: 'flow-vide', amount: euros(300), drift: -euros(300) });
    expect(plan.warnings.find((w) => w.code === 'bankOrderDrift')?.message).toContain('supprimer');
  });
});

describe('un ordre permanent se pose rond (D58)', () => {
  it('le montant proposé est la dizaine d’euros au-dessus', () => {
    expect(roundOrderUp(euros(683.5))).toBe(euros(690));
    expect(roundOrderUp(euros(650))).toBe(euros(650));
    expect(roundOrderUp(euros(0.01))).toBe(euros(10));
  });

  it('l’arrondi au-dessus ne se signale pas, un vrai écart si', () => {
    const l = exampleLedger();
    const demande = computePlan(l, asOf).transfers.find((x) => x.accountId === 'acc-livret')!.standing;

    // Ordre posé quelques euros au-dessus : il couvre ce que le budget demande, rien à corriger.
    const arrondi = computePlan({ ...l, plannedFlows: [...l.plannedFlows, ordreVersLivret(l, demande + euros(5))] }, asOf);
    expect(arrondi.transfers.find((x) => x.accountId === 'acc-livret')!.bankOrder!.drift).toBe(-euros(5));
    expect(arrondi.warnings.map((w) => w.code)).not.toContain('bankOrderDrift');

    // Au-delà du pas d'arrondi, l'ordre vire nettement trop : là, on le dit.
    const trop = computePlan({ ...l, plannedFlows: [...l.plannedFlows, ordreVersLivret(l, demande + euros(15))] }, asOf);
    expect(trop.warnings.map((w) => w.code)).toContain('bankOrderDrift');
  });
});
