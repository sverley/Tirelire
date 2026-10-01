import { describe, expect, it } from 'vitest';
import {
  applyMatch,
  budgetSuggestions,
  computePlan,
  euros,
  exampleLedger,
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
  return new Map(patch.subOperations.map((a) => [a.tirelireId!, a.share.kind === 'fixed' ? a.share.amount : 0]));
}

/**
 * L'exemple porte déjà un ordre permanent vers le livret (décalé de 50 €) : les cas construits
 * ici le retirent pour poser le leur, sans quoi deux ordres viseraient le même compte.
 */
function sansOrdre(l: Ledger): Ledger {
  return { ...l, plannedFlows: l.plannedFlows.filter((f) => f.id !== 'flow-vir-livret') };
}

function ordreVersLivret(l: Ledger, montant?: number): PlannedFlow {
  const plan = computePlan(l, asOf);
  const t = plan.transfers.find((x) => x.accountId === 'acc-livret')!;
  return standingTransferFlow(plan, t, 'acc-principal', 'flow-vir', montant ?? t.standing)!;
}

describe('[niveau 2] un virement déclaré n’est pas un calcul (D57, D60)', () => {
  it('sa ventilation reste celle qu’on lui a donnée, part variable comprise', () => {
    const l = sansOrdre(exampleLedger());
    // Un virement saisi à la main vers le livret, rattaché à une tirelire précise.
    const declare: PlannedFlow = {
      id: 'flow-main',
      name: 'Virement saisi',
      kind: 'transfer',
      amount: -euros(650),
      accountId: 'acc-principal',
      counterpartAccountId: 'acc-livret',
      tirelireId: 'env-vac',
      periodicity: { interval: 1, unit: 'month', anchorDate: '2026-08-28' },
      dateWindowDays: 5,
      labelPattern: 'VIR LIVRET',
    };
    const parts = ventilation(l, declare, -euros(650));
    // Une seule ligne, sur la tirelire déclarée : rejouer l'ordre de financement ici réécrirait un
    // fait de l'utilisateur, et la part variable (D27) serait perdue au passage.
    expect([...parts.keys()]).toEqual(['env-vac']);
    expect(parts.get('env-vac')).toBe(0); // part variable : aucun montant figé
  });
});

describe('[niveau 1] deux montants distincts : un ordre que le budget ne demande plus se signale (I10, D60)', () => {
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
    const alerte = plan.warnings.find((w) => w.code === 'bankOrderDrift' && w.accountId === 'acc-vide')!;
    // Aucune tirelire n'y est placée : le budget ne demande rien, l'ordre continue pourtant de virer.
    expect(t.standing).toBe(0);
    expect(t.bankOrder).toEqual({ flowId: 'flow-vide', amount: euros(300), drift: -euros(300), since: '2026-08-28' });
    expect(alerte.message).toContain('supprimer');

    // Le geste que propose alors le Plan : oublier l'ordre. Rien d'autre ne s'en trouve changé.
    const oublie = computePlan(
      { ...vide, plannedFlows: vide.plannedFlows.map((f) => (f.id === 'flow-vide' ? { ...f, deletedAt: '2026-09-06T10:00:00.000Z' } : f)) },
      asOf,
    );
    expect(oublie.transfers.find((x) => x.accountId === 'acc-vide')).toBeUndefined();
    expect(oublie.warnings.filter((w) => w.accountId === 'acc-vide')).toEqual([]);
  });
});

describe('[niveau 2] un ordre permanent se pose rond (D60)', () => {
  const pas = euros(10);

  it('le montant proposé est le multiple du pas au-dessus', () => {
    expect(roundOrderUp(euros(683.5), pas)).toBe(euros(690));
    expect(roundOrderUp(euros(650), pas)).toBe(euros(650));
    expect(roundOrderUp(euros(0.01), pas)).toBe(euros(10));
    // Un autre pas se règle (settings.orderRounding) ; un pas nul rend le montant au centime.
    expect(roundOrderUp(euros(683.5), euros(50))).toBe(euros(700));
    expect(roundOrderUp(euros(683.5), 0)).toBe(euros(683.5));
  });

  describe('[niveau 1] I10 · un écart se signale au-delà du pas d’arrondi des ordres', () => {
    it('l’arrondi au-dessus ne se signale pas, un vrai écart si', () => {
      const l = sansOrdre(exampleLedger());
      expect(l.settings.orderRounding).toBe(pas);
      const demande = computePlan(l, asOf).transfers.find((x) => x.accountId === 'acc-livret')!.standing;

      // Ordre posé quelques euros au-dessus : il couvre ce que le budget demande, rien à corriger.
      const arrondi = computePlan({ ...l, plannedFlows: [...l.plannedFlows, ordreVersLivret(l, demande + euros(5))] }, asOf);
      expect(arrondi.transfers.find((x) => x.accountId === 'acc-livret')!.bankOrder!.drift).toBe(-euros(5));
      expect(arrondi.warnings.map((w) => w.code)).not.toContain('bankOrderDrift');

      // Au-delà du pas d'arrondi, l'ordre vire nettement trop : là, on le dit.
      const trop = computePlan({ ...l, plannedFlows: [...l.plannedFlows, ordreVersLivret(l, demande + euros(15))] }, asOf);
      expect(trop.warnings.map((w) => w.code)).toContain('bankOrderDrift');
    });

    it('le pas est un réglage : à zéro, le moindre écart se dit', () => {
      const l = sansOrdre(exampleLedger());
      const sansArrondi = { ...l, settings: { ...l.settings, orderRounding: 0 } };
      const demande = computePlan(sansArrondi, asOf).transfers.find((x) => x.accountId === 'acc-livret')!.standing;
      const plan = computePlan(
        { ...sansArrondi, plannedFlows: [...l.plannedFlows, ordreVersLivret(sansArrondi, demande + euros(5))] },
        asOf,
      );
      expect(plan.warnings.map((w) => w.code)).toContain('bankOrderDrift');
    });
  });
});

describe('[niveau 2] le jeu d’exemple porte un ordre permanent décalé (D60)', () => {
  it('le plan montre les deux montants et dit d’aller modifier l’ordre', () => {
    const l = exampleLedger();
    const ordre = standingOrderFlow(l.plannedFlows, 'acc-livret')!;
    expect(ordre.id).toBe('flow-vir-livret');
    expect(isDerivedFlow(ordre)).toBe(true);

    const plan = computePlan(l, asOf);
    const t = plan.transfers.find((x) => x.accountId === 'acc-livret')!;
    // Ce que le budget demande n'a pas bougé d'un centime : l'ordre enregistré ne le touche pas.
    expect(t.standing).toBe(euros(650));
    expect(t.bankOrder).toEqual({ flowId: 'flow-vir-livret', amount: euros(600), drift: euros(50), since: '2026-08-28' });
    expect(plan.warnings.map((w) => w.code)).toContain('bankOrderDrift');
  });

  it('la somme demandée se détaille en dotations', () => {
    const t = computePlan(exampleLedger(), asOf).transfers.find((x) => x.accountId === 'acc-livret')!;
    expect(Object.fromEntries(t.breakdown.map((b) => [b.tirelireName, b.cruise]))).toEqual({
      'Taxe foncière': euros(100),
      'Assurance auto': euros(50),
      Vacances: euros(200),
      'Épargne de précaution': euros(300),
    });
    // C'est ce que « Détail » affiche : la somme et ses parts ne peuvent pas se contredire.
    expect(t.breakdown.reduce((s, b) => s + b.cruise, 0)).toBe(t.permanent);
  });

  it('il ne se glisse pas dans les propositions de l’assistant', () => {
    // Un flux dérivé est une conséquence du budget, pas une ligne à proposer (D43, D57).
    const s = budgetSuggestions(asOf);
    const noms = [...s.incomes, ...s.charges, ...s.everyday, ...s.periodic, ...s.savings].map((x) => x.name);
    expect(noms).not.toContain('Virement Livret A');
    expect(noms.length).toBeGreaterThan(0);
  });
});

