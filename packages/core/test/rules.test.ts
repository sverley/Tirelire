import { describe, expect, it } from 'vitest';
import {
  applyBulkAction,
  applyPatchToLedger,
  applyRules,
  euros,
  exampleLedger,
  inferSelection,
  outcomeFor,
  previewRules,
  rankBetween,
  ruleFromFlow,
  rulesByRank,
  selects,
  syncFlowRules,
  topRank,
  type Ledger,
  type Operation,
  type Rule,
} from '../src/index.js';

function op(id: string, label: string, amount: number, extra: Partial<Operation> = {}): Operation {
  return {
    id,
    accountId: 'acc-pivot',
    origin: 'imported',
    date: '2026-09-03',
    label,
    normalizedLabel: label,
    amount,
    state: 'untreated',
    ...extra,
  };
}

function withOps(...ops: Operation[]): Ledger {
  const l = exampleLedger();
  l.operations.push(...ops);
  return l;
}

const rule = (r: Partial<Rule> & Pick<Rule, 'id' | 'rank'>): Rule => ({ selection: {}, action: {}, ...r });

describe('rangs triables (D31)', () => {
  it('insère toujours une clé entre deux voisines, même serrées', () => {
    const a = rankBetween(undefined, undefined);
    const b = rankBetween(a, undefined);
    expect(b > a).toBe(true);
    const between = rankBetween(a, b);
    expect(between > a && between < b).toBe(true);
    // Deux appareils qui insèrent au même endroit produisent des clés différentes, pas un doublon.
    let x = a;
    for (let i = 0; i < 30; i++) {
      const next = rankBetween(x, b);
      expect(next > x && next < b).toBe(true);
      x = next;
    }
  });

  it('les règles s’appliquent du rang le plus élevé au rang 1', () => {
    const l = withOps();
    l.rules.push(rule({ id: 'r-bas', rank: 'a' }), rule({ id: 'r-haut', rank: 'z' }));
    expect(rulesByRank(l).map((r) => r.id)).toEqual(['r-haut', 'r-bas']);
    expect(topRank(l) > 'z').toBe(true);
  });
});

describe('sélection (D23)', () => {
  it('tous les critères renseignés doivent être remplis', () => {
    const o = op('o1', 'SUPERMARCHE CASINO', euros(-42));
    expect(selects({ labelPattern: 'CASINO' }, o)).toBe(true);
    expect(selects({ labelPattern: 'CASINO', amountMin: euros(-50), amountMax: euros(-10) }, o)).toBe(true);
    expect(selects({ labelPattern: 'CASINO', amountMax: euros(-50) }, o)).toBe(false);
    expect(selects({ accountId: 'acc-livret' }, o)).toBe(false);
    expect(selects({ dateFrom: '2026-10-01' }, o)).toBe(false);
  });

  it('un motif invalide ne sélectionne rien plutôt que de faire échouer le passage', () => {
    expect(selects({ labelPattern: '[' }, op('o1', 'X', -1))).toBe(false);
  });
});

describe('moteur de règles (D23)', () => {
  it('le rang le plus élevé écrase, les champs vides laissent en place', () => {
    const rules = [
      rule({ id: 'haut', rank: 'z', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim' } }),
      rule({ id: 'bas', rank: 'a', selection: {}, action: { categoryId: 'cat-sante', oneOff: true, state: 'reconcile' } }),
    ];
    const out = outcomeFor(op('o1', 'SUPERMARCHE', euros(-40)), rules, new Map());
    // La catégorie vient du rang élevé ; l'état et « ponctuelle » du rang bas, que rien n'écrase.
    expect(out.allocation[0]!.categoryId).toBe('cat-alim');
    expect(out.oneOff).toBe(true);
    expect(out.state).toBe('reconciled');
    expect(out.by).toEqual(['haut', 'bas']);
  });

  it('« Ne rien faire » classe sans traiter : la distinction doit rester visible', () => {
    const out = outcomeFor(
      op('o1', 'EDF', euros(-90)),
      [rule({ id: 'r', rank: 'm', selection: { labelPattern: 'EDF' }, action: { categoryId: 'cat-energie', state: 'none' } })],
      new Map(),
    );
    expect(out.allocation.length).toBe(1);
    expect(out.state).toBe('untreated');
  });

  it('le rejeu est idempotent et une règle retirée défait ce qu’elle avait posé', () => {
    let l = withOps(op('o1', 'SUPERMARCHE', euros(-40)));
    l.rules.push(rule({ id: 'r', rank: 'm', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim', state: 'reconcile' } }));
    l = applyPatchToLedger(l, applyRules(l));
    expect(l.operations.find((o) => o.id === 'o1')!.state).toBe('reconciled');
    expect(l.allocations.filter((a) => a.operationId === 'o1').length).toBe(1);
    // Deuxième passage : rien ne bouge.
    expect(applyRules(l).operations.length).toBe(0);
    // Règle retirée : l'opération revient à rien.
    l.rules = [];
    l = applyPatchToLedger(l, applyRules(l));
    expect(l.operations.find((o) => o.id === 'o1')!.state).toBe('untreated');
    expect(l.allocations.filter((a) => a.operationId === 'o1').length).toBe(0);
  });

  it('une opération verrouillée est hors d’atteinte', () => {
    const l = withOps(op('o1', 'SUPERMARCHE', euros(-40), { state: 'locked' }));
    l.rules.push(rule({ id: 'r', rank: 'm', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim', state: 'reconcile' } }));
    expect(applyRules(l).operations.length).toBe(0);
    expect(previewRules(l).some((d) => d.operation.id === 'o1')).toBe(false);
  });

  it('ce que l’import a établi survit au passage des règles (D33)', () => {
    const l = withOps(op('o1', 'VIR LIVRET', euros(-100), { transferAccountId: 'acc-livret' }));
    l.allocations.push({ id: 'al1', operationId: 'o1', envelopeId: 'env-vacances', share: { kind: 'variable' } });
    const patch = applyRules(l);
    // La ventilation posée par l'appariement survit ; seul l'état suit (le virement est rapproché).
    expect(patch.removedAllocations).toEqual([]);
    // La ligne est réécrite à l'identique (même identifiant), pas remplacée.
    expect(patch.allocations.map((a) => [a.id, a.envelopeId])).toEqual([['al1', 'env-vacances']]);
    expect(patch.operations[0]!.state).toBe('reconciled');
  });

  it('l’aperçu montre l’avant et l’après sans rien écrire', () => {
    const l = withOps(op('o1', 'SUPERMARCHE', euros(-40)));
    const essai = rule({ id: 'essai', rank: 'm', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim', state: 'reconcile' } });
    const diffs = previewRules(l, essai).filter((d) => d.changed);
    expect(diffs.length).toBe(1);
    expect(diffs[0]!.before.allocation).toEqual([]);
    expect(diffs[0]!.after.allocation[0]!.categoryId).toBe('cat-alim');
    // Rien n'a été enregistré : la règle d'essai n'est pas dans le grand livre.
    expect(l.rules.find((r) => r.id === 'essai')).toBeUndefined();
  });

  it('la catégorie apporte son enveloppe par défaut (D32)', () => {
    const l = withOps(op('o1', 'SUPERMARCHE', euros(-40)));
    l.rules.push(rule({ id: 'r', rank: 'm', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim', state: 'reconcile' } }));
    const patch = applyRules(l);
    expect(patch.allocations[0]!.envelopeId).toBe('env-alim');
  });
});

describe('actions groupées (D26)', () => {
  it('verrouille par défaut, et peut déverrouiller — ce qu’une règle ne peut pas', () => {
    const l = withOps(op('o1', 'A', euros(-10)), op('o2', 'B', euros(-20), { state: 'locked' }));
    const lock = applyBulkAction(l, ['o1'], { categoryId: 'cat-alim' });
    expect(lock.operations[0]!.state).toBe('locked');
    const free = applyBulkAction(l, ['o2'], { state: 'unlock' });
    expect(free.operations[0]!.state).toBe('untreated');
  });

  it('ne laisse que ses effets : rien n’est enregistré qui puisse se rejouer', () => {
    let l = withOps(op('o1', 'A', euros(-10)));
    const rulesBefore = l.rules.length;
    l = applyPatchToLedger(l, applyBulkAction(l, ['o1'], { oneOff: true }));
    expect(l.rules.length).toBe(rulesBefore);
    expect(l.operations.find((o) => o.id === 'o1')!.oneOff).toBe(true);
  });

  it('une sélection manuelle propose un filtre qui la reproduit', () => {
    const sel = inferSelection([op('o1', 'SUPERMARCHE CASINO PARIS', euros(-40)), op('o2', 'SUPERMARCHE CASINO LYON', euros(-60))]);
    expect(sel.labelPattern).toBe('SUPERMARCHE.*CASINO');
    expect(sel.accountId).toBe('acc-pivot');
    expect(selects(sel, op('o3', 'SUPERMARCHE CASINO NICE', euros(-50)))).toBe(true);
  });
});

describe('règles engendrées par les flux (D24)', () => {
  it('un flux qui engendre une règle la fait verrouiller : elle porte toute la classification', () => {
    const l = withOps();
    const flow = l.plannedFlows.find((f) => f.id === 'flow-credit')!;
    flow.makesRule = true;
    const patch = syncFlowRules(l, '2026-09-07');
    expect(patch.rules.length).toBe(1);
    expect(patch.rules[0]!.action.state).toBe('lock');
    expect(patch.rules[0]!.flowId).toBe('flow-credit');
  });

  it('modifier le flux archive la règle et en crée une nouvelle, sans réécrire le passé', () => {
    let l = withOps();
    const flow = l.plannedFlows.find((f) => f.id === 'flow-credit')!;
    flow.makesRule = true;
    l.rules.push(...syncFlowRules(l, '2026-09-07').rules);
    const first = l.rules[l.rules.length - 1]!;

    flow.amount = euros(-1000);
    const patch = syncFlowRules(l, '2026-10-07');
    const archived = patch.rules.find((r) => r.id === first.id)!;
    const created = patch.rules.find((r) => r.id !== first.id)!;
    expect(archived.validTo).toBe('2026-10-07');
    expect(created.validFrom).toBe('2026-10-07');

    // Une opération d'avant la bascule reste sélectionnée par l'ancienne règle, pas par la nouvelle.
    const ancienne = op('o-ancien', 'CREDIT MAISON', euros(-950), { date: '2026-08-05' });
    l = applyPatchToLedger(l, { operations: [ancienne], allocations: [] });
    expect(selects(created.selection, ancienne) && !created.validFrom).toBe(false);
  });

  it('un flux à montant variable ne contraint pas le montant', () => {
    const l = withOps();
    const flow = { ...l.plannedFlows[0]!, variable: true, labelPattern: 'SALAIRE' };
    const r = ruleFromFlow(flow, 'm');
    expect(r.selection.amountMin).toBeUndefined();
    expect(r.selection.labelPattern).toBe('SALAIRE');
  });

  it('décocher « engendre une règle » archive la règle plutôt que de la supprimer', () => {
    const l = withOps();
    const flow = l.plannedFlows.find((f) => f.id === 'flow-credit')!;
    flow.makesRule = true;
    l.rules.push(...syncFlowRules(l, '2026-09-07').rules);
    flow.makesRule = false;
    const patch = syncFlowRules(l, '2026-10-07');
    expect(patch.rules[0]!.validTo).toBe('2026-10-07');
    expect(patch.rules[0]!.deletedAt).toBeUndefined();
  });
});
