/**
 * Tests du codeur de #306 : une opération en reprend une autre, et la sélection d'un flux est la seule
 * qui le reconnaisse (D12, D22, D24, D88). Tous de niveau 4 : l'auditeur choisit parmi eux le harnais.
 * Chaque suite nomme le point du « Fait quand » qu'elle vérifie.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import {
  accountBalance,
  applyAutomations,
  applyMatch,
  applyPatchToLedger,
  computePlan,
  correctPlannedOperation,
  emptyLedger,
  entryCandidates,
  euros,
  exampleLedger,
  FORMAT_VERSION,
  LEDGER_KEYS,
  LedgerStore,
  missingFlows,
  proposeMatches,
  resumeEntry,
  resumptionOf,
  reviewCategories,
  runPipeline,
  undoResumption,
  type Ledger,
  type Operation,
  type Patch,
  type PlannedFlow,
} from '../src/index.js';
import * as cœur from '../src/index.js';

const SQL = await initSqlJs();

const LECTURE = '2026-09-10';
const CC = 'cc';
const LIVRET = 'livret';

function flux(f: Partial<PlannedFlow> & Pick<PlannedFlow, 'id' | 'name' | 'kind' | 'amount'>): PlannedFlow {
  return { accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-25' }, dateWindowDays: 3, ...f };
}

/**
 * Un compte courant à 1 000 € et un livret vide, ouverts le 31 août ; une tirelire « Vacances »
 * placée sur le livret ; un salaire de 2 000 € le 25, un loyer de 700 € le 5 (motif « LOYER »), une
 * catégorie « Courses ».
 */
function budget(): Ledger {
  const l = emptyLedger({ periodStartDay: 1 });
  l.accounts.push({ id: CC, name: 'Compte courant', kind: 'principal', openingBalance: euros(1000), openingDate: '2026-08-31' });
  l.accounts.push({ id: LIVRET, name: 'Livret', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-31' });
  l.tirelires.push({ id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-31' });
  l.needs.push({ id: 'n-vac', tirelireId: 'vac', kind: 'goal', monthlyAmount: euros(100), priority: 30 });
  l.categories.push(
    { id: 'cat-salaire', name: 'Salaire', nature: 'income' },
    { id: 'cat-logement', name: 'Logement', nature: 'expense' },
    { id: 'cat-courses', name: 'Courses', nature: 'expense' },
  );
  l.plannedFlows.push(flux({ id: 'f-salaire', name: 'Salaire', kind: 'income', amount: euros(2000), categoryId: 'cat-salaire', amountTolerance: { pct: 10 }, labelPattern: 'SALAIRE' }));
  l.plannedFlows.push(
    flux({ id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', amount: -euros(700), categoryId: 'cat-logement', amountTolerance: { abs: euros(20) }, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-05' } }),
  );
  return l;
}

function opération(o: Partial<Operation> & Pick<Operation, 'id' | 'date' | 'amount'>): Operation {
  return { accountId: CC, origin: 'imported', label: o.id.toUpperCase(), normalizedLabel: o.id.toUpperCase(), state: 'untreated', ...o };
}

function saisie(o: Partial<Operation> & Pick<Operation, 'id' | 'date' | 'amount'>): Operation {
  return opération({ origin: 'manual', state: 'locked', ...o });
}

const appliquer = (l: Ledger, p: Patch) => applyPatchToLedger(l, p);
const prévu = (l: Ledger, date = '2026-10-01', lecture = LECTURE) => computePlan(l, date, lecture).forecast!;
const compteCC = (l: Ledger, date?: string, lecture?: string) => prévu(l, date, lecture).accounts.find((a) => a.id === CC)!;

describe('[niveau 4] #306 · point 1 — une opération en reprend au plus une autre, qui ne compte plus', () => {
  it('une opération bancaire qui reprend une saisie compte à sa place, pour son propre montant, dans le solde et les totaux', () => {
    let l = budget();
    l.operations.push(saisie({ id: 'courses-annoncées', date: '2026-09-08', amount: -euros(80) }));
    l.subOperations.push({ id: 's-courses', operationId: 'courses-annoncées', categoryId: 'cat-courses', share: { kind: 'variable' } });
    l.operations.push(opération({ id: 'courses-relevé', date: '2026-09-09', amount: -euros(82) }));
    const cc = l.accounts[0]!;
    expect(accountBalance(cc, l, LECTURE)).toBe(euros(1000 - 80 - 82));

    l = appliquer(l, resumeEntry(l, 'courses-relevé', 'courses-annoncées'));
    expect(l.operations.find((o) => o.id === 'courses-relevé')!.resumedOperationId).toBe('courses-annoncées');
    expect(accountBalance(cc, l, LECTURE)).toBe(euros(1000 - 82));
    const septembre = { key: '2026-09', label: 'septembre', start: '2026-09-01', end: '2026-09-30' };
    const courses = reviewCategories(l, [septembre]).find((r) => r.categoryId === 'cat-courses')!;
    expect(courses.periods[0]!.spent).toBe(euros(82));
    expect(courses.periods[0]!.count).toBe(1);
  });

  it('une occurrence se désigne par son flux et sa date ; reprise, elle ne compte plus ni ne manque, et n’est reprise qu’une fois', () => {
    let l = budget();
    l.operations.push(opération({ id: 'loyer-relevé', date: '2026-09-04', amount: -euros(690), label: 'PRLV LOYER SEPT', normalizedLabel: 'PRLV LOYER SEPT' }));
    l.operations.push(opération({ id: 'loyer-doublon', date: '2026-09-06', amount: -euros(700), label: 'PRLV LOYER BIS', normalizedLabel: 'PRLV LOYER BIS' }));
    const propositions = proposeMatches(l, '2026-09-01', '2026-09-30').filter((p) => p.flowId === 'f-loyer');
    expect(propositions).toHaveLength(1);
    l = appliquer(l, applyMatch(l, propositions[0]!));
    const reprise = l.operations.find((o) => o.id === propositions[0]!.operationId)!;
    expect([reprise.plannedFlowId, reprise.plannedDate]).toEqual(['f-loyer', '2026-09-05']);
    // L'occurrence du 5 septembre n'est plus proposée à personne, ne manque pas et ne compte plus.
    expect(proposeMatches(l, '2026-09-01', '2026-09-30').some((p) => p.flowId === 'f-loyer')).toBe(false);
    expect(missingFlows(l, '2026-09-01', '2026-09-20').some((m) => m.flowId === 'f-loyer')).toBe(false);
    const loyers = compteCC(l, '2026-10-01', '2026-09-20').movements.filter((m) => m.flowId === 'f-loyer').map((m) => m.date);
    expect(loyers).toEqual(['2026-10-05']);
  });

  it('une saisie reprise ne se reprend pas deux fois', () => {
    let l = budget();
    l.operations.push(saisie({ id: 'annonce', date: '2026-09-08', amount: -euros(80) }));
    l.operations.push(opération({ id: 'a', date: '2026-09-09', amount: -euros(80) }), opération({ id: 'b', date: '2026-09-09', amount: -euros(80) }));
    l = appliquer(l, resumeEntry(l, 'a', 'annonce'));
    expect(entryCandidates(l, 'b')).toEqual([]);
    expect(resumeEntry(l, 'b', 'annonce').operations).toEqual([]);
  });

  it('le fichier refuse une opération qui en reprendrait deux, ou une opération prévue sans sa date', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL });
    s.upsert('plannedFlows', flux({ id: 'f', name: 'F', kind: 'income', amount: 100, accountId: 'acc-principal' }));
    const base = { accountId: 'acc-principal', origin: 'imported' as const, date: '2026-09-01', label: 'X', normalizedLabel: 'X', amount: 100, state: 'untreated' as const };
    s.upsert('operations', { ...base, id: 'op_0000000000000001' });
    expect(() => s.upsert('operations', { ...base, id: 'op_0000000000000002', plannedFlowId: 'f' })).toThrow(/planned_date/);
    expect(() => s.upsert('operations', { ...base, id: 'op_0000000000000003', plannedFlowId: 'f', plannedDate: '2026-09-01', resumedOperationId: 'op_0000000000000001' })).toThrow(/au plus une autre/);
    expect(() => s.upsert('operations', { ...base, id: 'op_0000000000000004', resumedOperationId: 'op_0000000000000004' })).toThrow(/elle-même/);
  });
});

describe('[niveau 4] #306 · point 2 — corriger ou masquer une opération prévue, sans import', () => {
  it('la correction est une saisie qui reprend l’opération prévue : elle compte à sa place, à sa date, pour son montant', () => {
    let l = budget();
    const avant = compteCC(l);
    l = appliquer(l, correctPlannedOperation(l, 'f-salaire', '2026-09-25', euros(1800), '2026-09-27'));
    const c = compteCC(l);
    // Seule l'occurrence du 25 septembre est reprise ; celle d'octobre compte toujours.
    expect(c.movements.filter((m) => m.flowId === 'f-salaire').map((m) => m.date)).toEqual(['2026-10-25']);
    expect(c.movements).toContainEqual(expect.objectContaining({ date: '2026-09-27', origin: 'saisie', amount: euros(1800) }));
    expect(c.end).toBe(avant.end - euros(200));
    const correction = l.operations.find((o) => o.origin === 'manual')!;
    expect([correction.plannedFlowId, correction.plannedDate, correction.state]).toEqual(['f-salaire', '2026-09-25', 'locked']);
    expect(l.operations.every((o) => o.origin !== 'imported')).toBe(true);
  });

  it('le masquage est une saisie de zéro qui la reprend ; retirer cette saisie la fait compter de nouveau', () => {
    let l = budget();
    const avant = compteCC(l);
    l = appliquer(l, correctPlannedOperation(l, 'f-salaire', '2026-09-25', 0, '2026-09-25'));
    const masquée = l.operations.find((o) => o.origin === 'manual')!;
    expect(masquée.amount).toBe(0);
    expect(compteCC(l).end).toBe(avant.end - euros(2000));
    l = { ...l, operations: l.operations.map((o) => (o.id === masquée.id ? { ...o, deletedAt: '2026-09-11T00:00:00.000Z' } : o)) };
    expect(compteCC(l).end).toBe(avant.end);
  });

  it('une occurrence déjà corrigée ne se corrige pas une seconde fois', () => {
    let l = budget();
    l = appliquer(l, correctPlannedOperation(l, 'f-salaire', '2026-09-25', euros(1800), '2026-09-25'));
    expect(correctPlannedOperation(l, 'f-salaire', '2026-09-25', euros(1500), '2026-09-25').operations).toEqual([]);
  });

  it('un virement corrigé garde ses deux côtés, comme l’opération prévue qu’il remplace ; masqué, il n’en a aucun', () => {
    const base = budget();
    base.plannedFlows.push(flux({ id: 'f-vir', name: 'Virement Livret', kind: 'transfer', amount: -euros(150), counterpartAccountId: LIVRET, tirelireId: 'vac', periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-28' } }));
    const livret = (l: Ledger) => prévu(l).accounts.find((a) => a.id === LIVRET)!.end;
    const corrigé = appliquer(base, correctPlannedOperation(base, 'f-vir', '2026-09-28', -euros(120), '2026-09-28'));
    expect(livret(corrigé)).toBe(livret(base) - euros(30));
    expect(compteCC(corrigé).end).toBe(compteCC(base).end + euros(30));
    const masqué = appliquer(base, correctPlannedOperation(base, 'f-vir', '2026-09-28', 0, '2026-09-28'));
    expect(livret(masqué)).toBe(livret(base) - euros(150));
    expect(masqué.operations).toHaveLength(1);
  });
});

describe('[niveau 4] #306 · point 3 — l’opération bancaire reprend l’occurrence, ou la saisie qui la corrige, ou la saisie qui l’annonçait', () => {
  it('une occurrence corrigée se reprend par sa saisie : l’opération bancaire reprend la saisie', () => {
    let l = budget();
    l = appliquer(l, correctPlannedOperation(l, 'f-salaire', '2026-09-25', euros(1800), '2026-09-25'));
    const correction = l.operations.find((o) => o.origin === 'manual')!;
    l.operations.push(opération({ id: 'salaire-relevé', date: '2026-09-25', amount: euros(1850), label: 'VIR SALAIRE', normalizedLabel: 'VIR SALAIRE' }));
    const p = proposeMatches(l, '2026-09-01', '2026-09-30').find((x) => x.operationId === 'salaire-relevé')!;
    expect(p.resumedOperationId).toBe(correction.id);
    l = appliquer(l, applyMatch(l, p));
    const relevé = l.operations.find((o) => o.id === 'salaire-relevé')!;
    expect(relevé.resumedOperationId).toBe(correction.id);
    expect(relevé.plannedFlowId).toBeUndefined();
    expect(accountBalance(l.accounts[0]!, l, '2026-09-30')).toBe(euros(1000 + 1850));
  });

  it('une occurrence masquée se reprend par sa saisie de zéro, si l’opération arrive tout de même', () => {
    let l = budget();
    l = appliquer(l, correctPlannedOperation(l, 'f-salaire', '2026-09-25', 0, '2026-09-25'));
    l.operations.push(opération({ id: 'salaire-relevé', date: '2026-09-26', amount: euros(2000), label: 'VIR SALAIRE', normalizedLabel: 'VIR SALAIRE' }));
    const p = proposeMatches(l, '2026-09-01', '2026-09-30').find((x) => x.operationId === 'salaire-relevé')!;
    expect(p.resumedOperationId).toBe(l.operations.find((o) => o.origin === 'manual')!.id);
  });

  it('hors de tout flux, l’application propose les saisies non reprises du même compte et du même sens, les plus proches en date puis en montant', () => {
    const l = budget();
    l.operations.push(
      saisie({ id: 'proche', date: '2026-09-08', amount: -euros(80) }),
      saisie({ id: 'loin', date: '2026-08-31', amount: -euros(81) }),
      saisie({ id: 'même-jour-autre-montant', date: '2026-09-08', amount: -euros(95) }),
      saisie({ id: 'autre-sens', date: '2026-09-09', amount: euros(80) }),
      saisie({ id: 'autre-compte', date: '2026-09-09', amount: -euros(80), accountId: LIVRET }),
      saisie({ id: 'zéro', date: '2026-09-09', amount: 0 }),
    );
    l.operations.push(opération({ id: 'relevé', date: '2026-09-09', amount: -euros(82) }));
    expect(entryCandidates(l, 'relevé').map((o) => o.id)).toEqual(['proche', 'même-jour-autre-montant', 'loin']);
  });

  it('la reprise d’une saisie hors flux attend la validation de l’utilisateur : l’import ne la fait pas', () => {
    let l = budget();
    l.operations.push(saisie({ id: 'annonce', date: '2026-09-08', amount: -euros(80) }));
    l.operations.push(opération({ id: 'relevé', date: '2026-09-09', amount: -euros(80) }));
    runPipeline(l, '2026-09-01', '2026-09-30', (p) => (l = appliquer(l, p)));
    expect(l.operations.find((o) => o.id === 'relevé')!.resumedOperationId).toBeUndefined();
  });
});

describe('[niveau 4] #306 · point 4 — la ventilation reprise, l’écart, et la reprise qui se défait', () => {
  it('l’opération qui reprend prend la ventilation de la saisie, à tous ses niveaux', () => {
    let l = budget();
    l.operations.push(saisie({ id: 'annonce', date: '2026-09-08', amount: -euros(100) }));
    l.subOperations.push(
      { id: 's1', operationId: 'annonce', categoryId: 'cat-courses', share: { kind: 'fixed', amount: -euros(60) } },
      { id: 's2', operationId: 'annonce', tirelireId: 'vac', share: { kind: 'variable' } },
      { id: 's2a', operationId: 'annonce', parentId: 's2', categoryId: 'cat-logement', share: { kind: 'percent', pct: 50 } },
    );
    l.operations.push(opération({ id: 'relevé', date: '2026-09-09', amount: -euros(100) }));
    l = appliquer(l, resumeEntry(l, 'relevé', 'annonce'));
    const copies = l.subOperations.filter((s) => s.operationId === 'relevé');
    expect(copies).toHaveLength(3);
    const parent = copies.find((s) => s.tirelireId === 'vac')!;
    expect(copies.find((s) => s.parentId === parent.id)?.categoryId).toBe('cat-logement');
    expect(copies.find((s) => s.categoryId === 'cat-courses')?.share).toEqual({ kind: 'fixed', amount: -euros(60) });
  });

  it('elle garde ce qui a été décidé sur elle : verrouillée et ventilée, elle ne prend rien', () => {
    let l = budget();
    l.operations.push(saisie({ id: 'annonce', date: '2026-09-08', amount: -euros(100) }));
    l.subOperations.push({ id: 's1', operationId: 'annonce', categoryId: 'cat-courses', share: { kind: 'variable' } });
    l.operations.push(opération({ id: 'relevé', date: '2026-09-09', amount: -euros(100), state: 'locked' }));
    l.subOperations.push({ id: 'r1', operationId: 'relevé', categoryId: 'cat-logement', share: { kind: 'variable' } });
    l = appliquer(l, resumeEntry(l, 'relevé', 'annonce'));
    expect(l.subOperations.filter((s) => s.operationId === 'relevé').map((s) => s.categoryId)).toEqual(['cat-logement']);
    expect(l.operations.find((o) => o.id === 'relevé')!.state).toBe('locked');
  });

  it('pour une occurrence, elle prend la ventilation du flux ; un virement permanent dérivé se rejoue sur le montant réel', () => {
    let l = budget();
    l.operations.push(opération({ id: 'loyer-relevé', date: '2026-09-05', amount: -euros(700), label: 'PRLV LOYER', normalizedLabel: 'PRLV LOYER' }));
    l = appliquer(l, applyMatch(l, proposeMatches(l, '2026-09-01', '2026-09-30')[0]!));
    expect(l.subOperations.find((s) => s.operationId === 'loyer-relevé')?.categoryId).toBe('cat-logement');

    let v = budget();
    v.plannedFlows.push(flux({ id: 'f-vir', name: 'Ordre', kind: 'transfer', origin: 'derived', amount: -euros(100), counterpartAccountId: LIVRET, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-01' } }));
    v = appliquer(v, correctPlannedOperation(v, 'f-vir', '2026-10-01', -euros(80), '2026-10-01'));
    const correction = v.operations.find((o) => o.plannedFlowId === 'f-vir')!;
    expect(v.subOperations.filter((s) => s.operationId === correction.id).map((s) => s.share)).toEqual([{ kind: 'fixed', amount: -euros(80) }]);
    v.operations.push(opération({ id: 'vir-relevé', date: '2026-10-01', amount: -euros(90) }));
    v = appliquer(v, resumeEntry(v, 'vir-relevé', correction.id));
    expect(v.subOperations.filter((s) => s.operationId === 'vir-relevé').map((s) => [s.tirelireId, s.share])).toEqual([['vac', { kind: 'fixed', amount: -euros(90) }]]);
  });

  it('l’écran dit ce qu’une opération reprend et l’écart de montant ; défaire la reprise fait compter de nouveau ce qu’elle reprenait', () => {
    let l = budget();
    l.operations.push(saisie({ id: 'annonce', date: '2026-09-08', amount: -euros(80) }));
    l.operations.push(opération({ id: 'relevé', date: '2026-09-09', amount: -euros(82) }));
    l = appliquer(l, resumeEntry(l, 'relevé', 'annonce'));
    const r = resumptionOf(l, l.operations.find((o) => o.id === 'relevé')!)!;
    expect([r.operation?.id, r.amount, r.gap]).toEqual(['annonce', -euros(80), -euros(2)]);
    l = appliquer(l, undoResumption(l, 'relevé'));
    const relevé = l.operations.find((o) => o.id === 'relevé')!;
    expect(relevé.resumedOperationId).toBeUndefined();
    expect(relevé.state).toBe('untreated');
    expect(l.subOperations.filter((s) => s.operationId === 'relevé' && !s.deletedAt)).toEqual([]);
    expect(accountBalance(l.accounts[0]!, l, LECTURE)).toBe(euros(1000 - 80 - 82));
  });
});

describe('[niveau 4] #306 · point 5 — un flux n’a qu’une sélection, qui seule reconnaît l’opération', () => {
  const avec = (o: Operation) => {
    const l = budget();
    l.operations.push(o);
    return proposeMatches(l, '2026-09-01', '2026-09-30').find((p) => p.operationId === o.id);
  };

  it('automatique pour un montant exact', () => {
    expect(avec(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700) }))?.auto).toBe(true);
  });

  it('automatique dans la tolérance avec le libellé reconnu ; proposée sans libellé reconnu', () => {
    expect(avec(opération({ id: 'sal', date: '2026-09-25', amount: euros(1900), label: 'VIR SALAIRE', normalizedLabel: 'VIR SALAIRE' }))?.auto).toBe(true);
    expect(avec(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(690) }))?.auto).toBe(false);
  });

  it('ce que le motif, la tolérance, la fenêtre ou le compte ne retiennent pas n’est pas reconnu', () => {
    expect(avec(opération({ id: 'sal', date: '2026-09-25', amount: euros(2000), label: 'VIR PRIME', normalizedLabel: 'VIR PRIME' }))).toBeUndefined();
    expect(avec(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(750) }))).toBeUndefined();
    expect(avec(opération({ id: 'loyer', date: '2026-09-15', amount: -euros(700) }))).toBeUndefined();
    expect(avec(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700), accountId: LIVRET }))).toBeUndefined();
  });

  it('un flux variable n’est jamais repris sans confirmation', () => {
    const l = budget();
    l.plannedFlows = l.plannedFlows.map((f) => (f.id === 'f-loyer' ? { ...f, variable: true } : f));
    l.operations.push(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700) }));
    expect(proposeMatches(l, '2026-09-01', '2026-09-30')[0]?.auto).toBe(false);
  });

  it('aucun automatisme n’est engendré à part d’un flux : l’import n’en ajoute aucun, et le cœur n’en sait plus faire', () => {
    let l = budget();
    l.plannedFlows = l.plannedFlows.map((f) => ({ ...f, locks: true }));
    l.operations.push(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700) }));
    runPipeline(l, '2026-09-01', '2026-09-30', (p) => (l = appliquer(l, p)));
    expect(l.automations).toEqual([]);
    expect('automationFromFlow' in cœur || 'syncFlowAutomations' in cœur).toBe(false);
  });
});

describe('[niveau 4] #306 · point 6 — l’état de ce qu’un flux reprend, et ce qu’il ne classe pas', () => {
  it('ce qu’un flux reprend devient rapproché ; verrouillé si le flux le demande', () => {
    let l = budget();
    l.operations.push(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700) }));
    runPipeline(l, '2026-09-01', '2026-09-30', (p) => (l = appliquer(l, p)));
    expect(l.operations.find((o) => o.id === 'loyer')!.state).toBe('reconciled');

    let v = budget();
    v.plannedFlows = v.plannedFlows.map((f) => ({ ...f, locks: true }));
    v.operations.push(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700) }));
    runPipeline(v, '2026-09-01', '2026-09-30', (p) => (v = appliquer(v, p)));
    expect(v.operations.find((o) => o.id === 'loyer')!.state).toBe('locked');
  });

  it('une opération que sa sélection ne reconnaît pas n’est ni reprise ni classée par lui', () => {
    let l = budget();
    // Même motif de compte, montant hors tolérance : le loyer de 750 € n'est pas celui du flux.
    l.operations.push(opération({ id: 'autre', date: '2026-09-06', amount: -euros(750) }));
    runPipeline(l, '2026-09-01', '2026-09-30', (p) => (l = appliquer(l, p)));
    const o = l.operations.find((x) => x.id === 'autre')!;
    expect([o.plannedFlowId, o.state]).toEqual([undefined, 'untreated']);
    expect(l.subOperations.filter((s) => s.operationId === 'autre')).toEqual([]);
  });

  it('modifier un flux ne réécrit aucune opération déjà reprise', () => {
    let l = budget();
    l.operations.push(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700) }));
    runPipeline(l, '2026-09-01', '2026-09-30', (p) => (l = appliquer(l, p)));
    const avant = { op: l.operations.find((o) => o.id === 'loyer'), subs: l.subOperations.filter((s) => s.operationId === 'loyer') };
    l.plannedFlows = l.plannedFlows.map((f) => (f.id === 'f-loyer' ? { ...f, amount: -euros(750), categoryId: 'cat-courses', locks: true } : f));
    l = appliquer(l, applyAutomations(l));
    runPipeline(l, '2026-09-01', '2026-09-30', (p) => (l = appliquer(l, p)));
    expect(l.operations.find((o) => o.id === 'loyer')).toEqual(avant.op);
    expect(l.subOperations.filter((s) => s.operationId === 'loyer')).toEqual(avant.subs);
  });
});

describe('[niveau 4] #306 · point 7 — le format change de version, et l’exemple reste le même', () => {
  it('la version du format est la 6 ; un fichier de la version 5 est refusé en le disant, sans rien ouvrir', async () => {
    expect(FORMAT_VERSION).toBe(6);
    const s = await LedgerStore.create({ sqlJs: SQL });
    const db = new SQL.Database(s.export());
    db.run(`UPDATE meta SET value = '5' WHERE key = 'format_version'`);
    await expect(LedgerStore.create({ sqlJs: SQL, bytes: db.export() })).rejects.toMatchObject({ reason: 'ancien' });
  });

  it('l’exemple s’écrit et se relit au nouveau format, son salaire d’août repris par son flux et sa date', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL });
    const l = exampleLedger();
    for (const cle of LEDGER_KEYS) for (const ligne of l[cle]) s.upsert(cle, ligne as never);
    const relu = await LedgerStore.create({ sqlJs: SQL, bytes: s.export(), verifier: true });
    expect(relu.load().operations.find((o) => o.id === 'op-salaire-08')).toMatchObject({ plannedFlowId: 'flow-salaire', plannedDate: '2026-08-28' });
    const salaire = l.operations.find((o) => o.id === 'op-salaire-08')!;
    expect([salaire.plannedFlowId, salaire.plannedDate]).toEqual(['flow-salaire', '2026-08-28']);
    expect(missingFlows(l, '2026-08-01', '2026-09-06').some((m) => m.flowId === 'flow-salaire' && m.expectedDate === '2026-08-28')).toBe(false);
  });
});
