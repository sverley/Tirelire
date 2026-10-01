/**
 * Tests du codeur de #297 — « Une opération contient des sous-opérations, sur autant de niveaux
 * qu'on veut ». Tous de niveau 4 (D83).
 *
 * L'auditeur a repris ceux qui tranchent une phrase du « Fait quand » dans le harnais du besoin,
 * `sous-operations-harnais.test.ts`, où ils ont leur niveau. Restent ici ceux qu'il n'a pas retenus :
 * la ventilation d'un niveau lue ligne à ligne (le harnais la compare à l'ancien calcul), l'action
 * groupée et le déverrouillage (D22, D26, que le « Fait quand » ne nomme pas), et ce qu'une édition
 * écrit ou n'écrit pas à un niveau plus bas (le harnais garde ce que cela évite : la perte, le conflit).
 */
import { describe, expect, it } from 'vitest';
import {
  applyAutomations,
  applyBulkAction,
  applyPatchToLedger,
  countedLines,
  editDivision,
  euros,
  exampleLedger,
  indexLedger,
  liveSubOperations,
  unlock,
  type Ledger,
  type Operation,
  type Share,
  type SubOperation,
} from '../src/index.js';

const PRINCIPAL = 'acc-principal';
const VACANCES = 'env-vac';
const RESTAURANT = 'cat-resto';

const fixe = (e: number): Share => ({ kind: 'fixed', amount: euros(e) });
const variable: Share = { kind: 'variable' };
const pct = (p: number): Share => ({ kind: 'percent', pct: p });

function sub(id: string, operationId: string, share: Share, more: Partial<SubOperation> = {}): SubOperation {
  return { id, operationId, share, ...more };
}

function operation(id: string, amount: number, more: Partial<Operation> = {}): Operation {
  return {
    id,
    accountId: PRINCIPAL,
    origin: 'manual',
    date: '2026-09-03',
    label: 'DEPENSE',
    normalizedLabel: 'DEPENSE',
    amount: euros(amount),
    state: 'locked',
    ...more,
  };
}

/** L'exemple, avec une catégorie « Restaurant ». */
function base(): Ledger {
  const l = exampleLedger();
  l.categories.push({ id: RESTAURANT, name: 'Restaurant', nature: 'expense' });
  return l;
}

/**
 * L'exemple du point 3 : une dépense de 100 € sur le compte courant, divisée en 60 € sur
 * « Vacances » et 40 € sans tirelire, les 60 € divisés à leur tour en 20 € « Restaurant » et
 * 40 € sans catégorie.
 */
function exempleDuPoint3(more: Partial<Operation> = {}): { ledger: Ledger; op: Operation } {
  const ledger = base();
  const op = operation('op-297', -100, more);
  ledger.operations.push(op);
  ledger.subOperations.push(
    sub('s-vac', op.id, fixe(-60), { tirelireId: VACANCES }),
    sub('s-reste', op.id, variable),
    sub('s-resto', op.id, fixe(-20), { parentId: 's-vac', categoryId: RESTAURANT }),
    sub('s-sans', op.id, variable, { parentId: 's-vac' }),
  );
  return { ledger, op };
}

describe('[niveau 4] #297 · 4. une ventilation d’un seul niveau donne ce qu’elle donnait', () => {
  it('un niveau : les lignes comptées sont les lignes de ventilation, au centime', () => {
    const ledger = base();
    const op = operation('op-4', -100);
    ledger.operations.push(op);
    ledger.subOperations.push(sub('x', op.id, pct(30), { categoryId: RESTAURANT }), sub('y', op.id, fixe(-50), { tirelireId: VACANCES }));
    // Sans part variable, le reste de l'opération, sans rien qui vaille pour lui, est son non affecté.
    expect(countedLines(op, ledger.subOperations).map((l) => [l.id, l.amount, l.categoryId, l.tirelireId])).toEqual([
      ['x', euros(-30), RESTAURANT, undefined],
      ['y', euros(-50), undefined, VACANCES],
      [`${op.id}:reste`, euros(-20), undefined, undefined],
    ]);
  });
});

describe('[niveau 4] #297 · 5. une action groupée ou un déverrouillage, sur une opération divisée', () => {
  function avecRegle(state: Operation['state']): { ledger: Ledger; op: Operation } {
    const { ledger, op } = exempleDuPoint3({ origin: 'imported', label: 'RESTO PLAGE', normalizedLabel: 'RESTO PLAGE', state });
    ledger.automations.push({ id: 'r-resto', selection: { labelPattern: 'RESTO' }, action: { categoryId: RESTAURANT, state: 'reconcile' }, rank: 'm' });
    return { ledger, op };
  }

  it('une action groupée remplace aussi tous les niveaux', () => {
    const { ledger, op } = avecRegle('locked');
    const apres = applyPatchToLedger(ledger, applyBulkAction(ledger, [op.id], { categoryId: RESTAURANT }));
    expect(liveSubOperations(apres.subOperations).filter((s) => s.operationId === op.id).map((s) => s.parentId)).toEqual([undefined]);
  });

  it('déverrouillée, une opération divisée à la main est reprise par la règle', () => {
    const { ledger, op } = avecRegle('locked');
    const l = applyPatchToLedger(ledger, { operations: [unlock(op)], subOperations: [] });
    const apres = applyPatchToLedger(l, applyAutomations(l));
    expect(liveSubOperations(apres.subOperations).filter((s) => s.operationId === op.id)).toHaveLength(1);
  });
});

describe('[niveau 4] #297 · 6. une édition à un niveau plus bas', () => {
  it('modifier un niveau plus bas n’écrit aucune sous-opération du niveau au-dessus', () => {
    const { ledger, op } = exempleDuPoint3();
    const patch = editDivision(ledger, op.id, [{ id: 's-resto', categoryId: RESTAURANT, share: fixe(-25) }, { id: 's-sans', share: variable }], {}, 's-vac');
    expect(patch.subOperations.map((s) => [s.id, s.parentId])).toEqual([['s-resto', 's-vac']]);
    expect(patch.operations.map((o) => o.state)).toEqual(['locked']);
    // Les lignes comptées de l'opération se relisent après l'édition.
    const apres = applyPatchToLedger(ledger, patch);
    expect(indexLedger(apres).linesByOperation.get(op.id)!.reduce((s, l) => s + l.amount, 0)).toBe(op.amount);
  });
});
