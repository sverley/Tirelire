import { describe, expect, it } from 'vitest';
import {
  applyPatchToLedger,
  editAllocations,
  EditError,
  euros,
  exampleLedger,
  indexLedger,
  manualEdit,
  resolveShares,
  unallocatedAmount,
  unlock,
  variableRest,
  type Allocation,
  type Ledger,
  type Operation,
} from '../src/index.js';

function withOperation(amount = euros(-100)): { ledger: Ledger; op: Operation } {
  const ledger = exampleLedger();
  const op: Operation = {
    id: 'op-test',
    accountId: 'acc-pivot',
    origin: 'imported',
    date: '2026-09-03',
    label: 'SUPERMARCHE',
    normalizedLabel: 'SUPERMARCHE',
    amount,
    state: 'untreated',
  };
  ledger.operations.push(op);
  return { ledger, op };
}

describe('ventilation à parts (D27)', () => {
  it('la part variable prend le reste, dans le signe de l’opération', () => {
    const { op } = withOperation(euros(-100));
    const allocs: Allocation[] = [
      { id: 'a1', operationId: op.id, share: { kind: 'fixed', amount: euros(-30) } },
      { id: 'a2', operationId: op.id, share: { kind: 'percent', pct: 20 } },
      { id: 'a3', operationId: op.id, share: { kind: 'variable' } },
    ];
    const amounts = resolveShares(op, allocs);
    expect(amounts.get('a1')).toBe(euros(-30));
    expect(amounts.get('a2')).toBe(euros(-20));
    expect(amounts.get('a3')).toBe(euros(-50));
  });

  it('la part variable ne devient jamais négative : elle tombe à zéro', () => {
    const { op } = withOperation(euros(-100));
    const allocs: Allocation[] = [
      { id: 'a1', operationId: op.id, share: { kind: 'fixed', amount: euros(-100) } },
      { id: 'a2', operationId: op.id, share: { kind: 'variable' } },
    ];
    expect(resolveShares(op, allocs).get('a2')).toBe(0);
    expect(variableRest(op, allocs.slice(0, 1))).toBe(0);
  });

  it('une seule ligne variable : les suivantes ne prennent rien, et la saisie est refusée', () => {
    const { ledger, op } = withOperation();
    const allocs: Allocation[] = [
      { id: 'a1', operationId: op.id, share: { kind: 'variable' } },
      { id: 'a2', operationId: op.id, share: { kind: 'variable' } },
    ];
    expect(resolveShares(op, allocs).get('a2')).toBe(0);
    expect(() =>
      editAllocations(ledger, op.id, [{ share: { kind: 'variable' } }, { share: { kind: 'variable' } }]),
    ).toThrow(EditError);
  });

  it('une opération sans ligne pèse en entier sur le non affecté du compte', () => {
    const { ledger, op } = withOperation(euros(-42));
    const idx = indexLedger(ledger);
    expect(unallocatedAmount(op, idx)).toBe(euros(-42));
  });

  it('le rejeu est déterministe à montant inconnu d’avance : mêmes parts, montants différents', () => {
    const parts: Allocation[] = [
      { id: 'a1', operationId: 'x', share: { kind: 'percent', pct: 50 } },
      { id: 'a2', operationId: 'x', share: { kind: 'variable' } },
    ];
    const petit = { ...withOperation(euros(-80)).op, id: 'x' };
    const grand = { ...withOperation(euros(-120)).op, id: 'x' };
    expect(resolveShares(petit, parts).get('a2')).toBe(euros(-40));
    expect(resolveShares(grand, parts).get('a2')).toBe(euros(-60));
  });

  it('des parts qui dépassent le montant sont refusées', () => {
    const { ledger, op } = withOperation(euros(-100));
    expect(() =>
      editAllocations(ledger, op.id, [
        { share: { kind: 'fixed', amount: euros(-80) } },
        { share: { kind: 'fixed', amount: euros(-40) } },
      ]),
    ).toThrow(EditError);
  });
});

describe('états d’une opération (D22)', () => {
  it('une modification manuelle verrouille, l’ouverture de l’éditeur non', () => {
    const { ledger, op } = withOperation();
    // Lire la ventilation ne change rien : aucun patch n'est produit tant qu'on n'écrit pas.
    expect(op.state).toBe('untreated');
    const patch = editAllocations(ledger, op.id, [{ categoryId: 'cat-alim', share: { kind: 'variable' } }]);
    expect(patch.operations[0]!.state).toBe('locked');
  });

  it('le déverrouillage rend l’opération aux règles sans rien lui retirer', () => {
    const { op } = withOperation();
    const locked = manualEdit(op, { oneOff: true });
    expect(locked.state).toBe('locked');
    const freed = unlock(locked);
    expect(freed.state).toBe('untreated');
    expect(freed.oneOff).toBe(true);
  });

  it('une ligne retirée à la main disparaît vraiment', () => {
    const { ledger, op } = withOperation(euros(-100));
    let l = applyPatchToLedger(
      ledger,
      editAllocations(ledger, op.id, [
        { id: 'a1', categoryId: 'cat-alim', share: { kind: 'fixed', amount: euros(-60) } },
        { id: 'a2', categoryId: 'cat-sante', share: { kind: 'variable' } },
      ]),
    );
    expect(l.allocations.filter((a) => a.operationId === op.id).length).toBe(2);
    l = applyPatchToLedger(l, editAllocations(l, op.id, [{ id: 'a1', categoryId: 'cat-alim', share: { kind: 'variable' } }]));
    const rest = l.allocations.filter((a) => a.operationId === op.id);
    expect(rest.length).toBe(1);
    expect(rest[0]!.share).toEqual({ kind: 'variable' });
  });
});
