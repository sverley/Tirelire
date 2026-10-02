/**
 * Harnais d'audit de #306 — « Une opération en reprend une autre, et la sélection d'un flux est la
 * seule qui le reconnaisse » (D12, D22, D24, D88). Côté cœur ; ce qui se lit et se fait à l'écran est
 * dans `apps/web/test/navigateur/reprise-harnais.test.ts`.
 *
 * Composé après le codage (auditeur.md, étape 2) : pour chaque phrase du « Fait quand » qu'un test
 * peut trancher, un test — celui du codeur quand il la tranche (repris de `reprise.test.ts`, où ne
 * restent que ses tests non retenus), sinon le mien. Sont de moi : le non-écrasement de ce que
 * l'utilisateur a décidé (point 4), l'import qui ne reprend que ce que D12 permet (point 3, principe
 * 4.4), un flux modifié qui ne réécrit rien tout en valant pour la suite (point 6), la tirelire et le
 * non affecté d'une dépense reprise (I2, point 1), et le plan de l'exemple au centime (point 7).
 * Données inventées (D84) : de petits grands livres écrits ici, et l'exemple, lu au 6 septembre 2026.
 *
 * Chaque `describe` reprend un point du « Fait quand » sous son numéro. Les phrases qui se lisent à
 * l'écran (points 2, 4 et 5) y ont leur épreuve ; le point 8 est de la documentation, relue.
 *
 * Niveaux (D83), par le besoin que couvre chaque phrase :
 * - 0 · ce que l'utilisateur a décidé sur une opération n'est jamais écrasé par une reprise (point 4),
 *   et modifier un flux ne réécrit aucune opération déjà reprise (point 6) : une classification ou un
 *   verrouillage écrasés ne se rétablissent pas en corrigeant le code.
 * - 1 · I2 (une dépense annoncée puis réalisée ne compte, pour le compte et la tirelire, qu'une
 *   fois — point 1), U1 (corriger ou masquer une opération prévue sans aucun import — point 2),
 *   principe 4.4 et I10 (l'import ne reprend que ce que D12 permet, et jamais une saisie — point 3),
 *   C8 (le format change de version — point 7).
 * - 2 · les règles de D12, D22, D24 et D88 que ces phrases appliquent, nominales comme limites : la
 *   désignation par le flux et la date, la reprise une seule fois, la correction et le masquage, la
 *   reprise d'une saisie, la ventilation prise, l'état rapproché ou verrouillé, la sélection du
 *   flux, le fichier, le plan de l'exemple au centime près.
 * - 3 · ce que l'écran lit d'une reprise : ce qu'elle reprend et l'écart de montant (point 4).
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
  indexLedger,
  LEDGER_KEYS,
  LedgerStore,
  missingFlows,
  proposeMatches,
  resumeEntry,
  resumptionOf,
  reviewCategories,
  runPipeline,
  tirelireBalance,
  unallocated,
  undoResumption,
  type Ledger,
  type MatchProposal,
  type Operation,
  type Patch,
  type PlannedFlow,
} from '../src/index.js';

const SQL = await initSqlJs();

const LECTURE = '2026-09-10';
const CC = 'cc';
const LIVRET = 'livret';

function flux(f: Partial<PlannedFlow> & Pick<PlannedFlow, 'id' | 'name' | 'kind' | 'amount'>): PlannedFlow {
  return { accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-25' }, dateWindowDays: 3, ...f };
}

/**
 * Un compte courant à 1 000 € et un livret vide, ouverts le 31 août ; une tirelire « Vacances »
 * placée sur le livret ; un salaire de 2 000 € le 25 (motif « SALAIRE », tolérance 10 %), un loyer de
 * 700 € le 5 (sans motif, tolérance 20 €), trois catégories.
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
const importer = (l: Ledger) => {
  let r = l;
  runPipeline(r, '2026-09-01', '2026-10-31', (p) => (r = appliquer(r, p)));
  return r;
};
const prévu = (l: Ledger, date = '2026-10-01', lecture = LECTURE) => computePlan(l, date, lecture).forecast!;
const compteCC = (l: Ledger, date?: string, lecture?: string) => prévu(l, date, lecture).accounts.find((a) => a.id === CC)!;
const lire = (l: Ledger, id: string) => l.operations.find((o) => o.id === id)!;

// ---------------------------------------------------------------------------
// Point 1
// ---------------------------------------------------------------------------

describe('[niveau 1] #306 · 1. l’opération reprise ne compte plus, celle qui la reprend compte à sa place, pour son propre montant (I2, D88)', () => {
  it('une dépense annoncée, puis réalisée au relevé, ne compte qu’une fois : dans le compte, la tirelire, le non affecté et les totaux du bilan', () => {
    // Une tirelire « Courses » placée sur le compte courant, dotée de 300 € : elle consomme là où elle sort.
    const avecTirelire = () => {
      const x = budget();
      x.tirelires.push({ id: 'cour', name: 'Courses', placement: [{ accountId: CC, share: { kind: 'variable' } }], openingBalance: euros(300), openingDate: '2026-08-31' });
      return x;
    };
    let l = avecTirelire();
    l.operations.push(saisie({ id: 'annonce', date: '2026-09-08', amount: -euros(80) }));
    l.subOperations.push({ id: 's-annonce', operationId: 'annonce', categoryId: 'cat-courses', tirelireId: 'cour', share: { kind: 'variable' } });
    l.operations.push(opération({ id: 'relevé', date: '2026-09-09', amount: -euros(82) }));
    const cc = l.accounts[0]!;
    const tirelire = (x: Ledger) => tirelireBalance(x.tirelires.find((t) => t.id === 'cour')!, indexLedger(x), LECTURE);
    const nonAffecté = (x: Ledger) => unallocated(cc, x, indexLedger(x), LECTURE);
    const sansRien = avecTirelire();

    // Avant la reprise, les deux comptent : 80 + 82.
    expect(accountBalance(cc, l, LECTURE)).toBe(euros(1000 - 80 - 82));
    expect(tirelire(l)).toBe(tirelire(sansRien) - euros(80));

    l = appliquer(l, resumeEntry(l, 'relevé', 'annonce'));
    expect(lire(l, 'relevé').resumedOperationId).toBe('annonce');
    // Après, seule celle du relevé compte, pour 82 : le compte, la tirelire — qui la reprend avec sa
    // ventilation —, et le non affecté, que ni l'annonce ni la reprise ne changent (I2).
    expect(accountBalance(cc, l, LECTURE)).toBe(euros(1000 - 82));
    expect(tirelire(l)).toBe(tirelire(sansRien) - euros(82));
    expect(nonAffecté(l)).toBe(nonAffecté(sansRien));
    const septembre = { key: '2026-09', label: 'septembre', start: '2026-09-01', end: '2026-09-30' };
    const courses = reviewCategories(l, [septembre]).find((r) => r.categoryId === 'cat-courses')!;
    expect([courses.periods[0]!.spent, courses.periods[0]!.count]).toEqual([euros(82), 1]);
  });
});

describe('[niveau 2] #306 · 1. une occurrence se désigne par son flux et sa date, et n’est reprise qu’une fois (D12, D88)', () => {
  it('reprise, l’occurrence ne compte plus ni ne manque, et n’est plus proposée à personne', () => {
    let l = budget();
    l.operations.push(opération({ id: 'loyer-relevé', date: '2026-09-04', amount: -euros(690), label: 'PRLV LOYER SEPT', normalizedLabel: 'PRLV LOYER SEPT' }));
    l.operations.push(opération({ id: 'loyer-doublon', date: '2026-09-06', amount: -euros(700), label: 'PRLV LOYER BIS', normalizedLabel: 'PRLV LOYER BIS' }));
    const propositions = proposeMatches(l, '2026-09-01', '2026-09-30').filter((p) => p.flowId === 'f-loyer');
    expect(propositions).toHaveLength(1);
    l = appliquer(l, applyMatch(l, propositions[0]!));
    const reprise = lire(l, propositions[0]!.operationId);
    expect([reprise.plannedFlowId, reprise.plannedDate]).toEqual(['f-loyer', '2026-09-05']);
    expect(proposeMatches(l, '2026-09-01', '2026-09-30').some((p) => p.flowId === 'f-loyer')).toBe(false);
    expect(missingFlows(l, '2026-09-01', '2026-09-20').some((m) => m.flowId === 'f-loyer')).toBe(false);
    expect(compteCC(l, '2026-10-01', '2026-09-20').movements.filter((m) => m.flowId === 'f-loyer').map((m) => m.date)).toEqual(['2026-10-05']);
  });

  it('une saisie reprise ne se reprend pas deux fois', () => {
    let l = budget();
    l.operations.push(saisie({ id: 'annonce', date: '2026-09-08', amount: -euros(80) }));
    l.operations.push(opération({ id: 'a', date: '2026-09-09', amount: -euros(80) }), opération({ id: 'b', date: '2026-09-09', amount: -euros(80) }));
    l = appliquer(l, resumeEntry(l, 'a', 'annonce'));
    expect(entryCandidates(l, 'b')).toEqual([]);
    expect(resumeEntry(l, 'b', 'annonce').operations).toEqual([]);
  });

  it('une occurrence déjà corrigée ne se corrige pas une seconde fois', () => {
    let l = budget();
    l = appliquer(l, correctPlannedOperation(l, 'f-salaire', '2026-09-25', euros(1800), '2026-09-25'));
    expect(correctPlannedOperation(l, 'f-salaire', '2026-09-25', euros(1500), '2026-09-25').operations).toEqual([]);
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

// ---------------------------------------------------------------------------
// Point 2
// ---------------------------------------------------------------------------

describe('[niveau 1] #306 · 2. U1 · corriger une opération prévue, ou la masquer, sans aucun import (D88)', () => {
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
    expect(l.operations.every((o) => o.origin !== 'imported')).toBe(true);
    expect(compteCC(l).end).toBe(avant.end - euros(2000));
    l = { ...l, operations: l.operations.map((o) => (o.id === masquée.id ? { ...o, deletedAt: '2026-09-11T00:00:00.000Z' } : o)) };
    expect(compteCC(l).end).toBe(avant.end);
  });
});

describe('[niveau 2] #306 · 2. un virement corrigé garde ses deux côtés, comme l’opération prévue qu’il remplace ; masqué, il n’en a aucun (D88)', () => {
  it('le livret et le compte courant bougent de l’écart, ou de tout le virement', () => {
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

// ---------------------------------------------------------------------------
// Point 3
// ---------------------------------------------------------------------------

describe('[niveau 2] #306 · 3. l’opération bancaire reprend l’occurrence, ou la saisie qui la corrige ou la masque déjà', () => {
  it('une occurrence corrigée se reprend par sa saisie : l’opération bancaire reprend la saisie', () => {
    let l = budget();
    l = appliquer(l, correctPlannedOperation(l, 'f-salaire', '2026-09-25', euros(1800), '2026-09-25'));
    const correction = l.operations.find((o) => o.origin === 'manual')!;
    l.operations.push(opération({ id: 'salaire-relevé', date: '2026-09-25', amount: euros(1850), label: 'VIR SALAIRE', normalizedLabel: 'VIR SALAIRE' }));
    const p = proposeMatches(l, '2026-09-01', '2026-09-30').find((x) => x.operationId === 'salaire-relevé')!;
    expect(p.resumedOperationId).toBe(correction.id);
    l = appliquer(l, applyMatch(l, p));
    const relevé = lire(l, 'salaire-relevé');
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
    l = appliquer(l, applyMatch(l, p));
    expect(accountBalance(l.accounts[0]!, l, '2026-09-30')).toBe(euros(1000 + 2000));
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
});

describe('[niveau 1] #306 · 3. l’import ne reprend que ce que D12 permet, jamais une saisie : le reste se propose, et l’utilisateur valide (principe 4.4, I10)', () => {
  it('une opération seulement proposée, ou qui a une saisie proche, n’est reprise par rien tant que l’utilisateur ne valide pas', () => {
    let l = budget();
    // 690 € pour un loyer de 700 € (tolérance 20 €), sans motif de libellé : proposé, pas automatique (D12).
    l.operations.push(opération({ id: 'loyer-proche', date: '2026-09-06', amount: -euros(690) }));
    // Une saisie qui annonçait le même mouvement, hors de tout flux : jamais reprise d'office.
    l.operations.push(saisie({ id: 'annonce', date: '2026-09-08', amount: -euros(80) }));
    l.operations.push(opération({ id: 'courses', date: '2026-09-09', amount: -euros(80) }));
    // Un salaire variable : jamais repris sans confirmation, même exact.
    l.plannedFlows = l.plannedFlows.map((f) => (f.id === 'f-salaire' ? { ...f, variable: true } : f));
    l.operations.push(opération({ id: 'salaire', date: '2026-09-25', amount: euros(2000), label: 'VIR SALAIRE', normalizedLabel: 'VIR SALAIRE' }));

    l = importer(l);
    for (const id of ['loyer-proche', 'courses', 'salaire']) {
      const o = lire(l, id);
      expect([id, o.plannedFlowId, o.plannedDate, o.resumedOperationId]).toEqual([id, undefined, undefined, undefined]);
    }
    expect(lire(l, 'loyer-proche').state).toBe('untreated');
    // Ce que l'application propose reste proposé ; la validation de l'utilisateur est un geste à part.
    const proposé = proposeMatches(l, '2026-09-01', '2026-09-30').filter((p) => ['loyer-proche', 'salaire'].includes(p.operationId));
    expect(proposé.map((p) => [p.operationId, p.auto])).toEqual(expect.arrayContaining([['loyer-proche', false], ['salaire', false]]));
    expect(entryCandidates(l, 'courses').map((e) => e.id)).toEqual(['annonce']);

    l = appliquer(l, applyMatch(l, proposé.find((p) => p.operationId === 'loyer-proche')!));
    expect([lire(l, 'loyer-proche').plannedFlowId, lire(l, 'loyer-proche').plannedDate]).toEqual(['f-loyer', '2026-09-05']);
    l = appliquer(l, resumeEntry(l, 'courses', 'annonce'));
    expect(lire(l, 'courses').resumedOperationId).toBe('annonce');
  });
});

// ---------------------------------------------------------------------------
// Point 4
// ---------------------------------------------------------------------------

describe('[niveau 0] #306 · 4. l’opération qui reprend garde ce qui a été décidé sur elle : verrouillage et ventilation (D22, D88)', () => {
  it('verrouillée et ventilée, elle reprend une saisie sans rien prendre ni perdre', () => {
    let l = budget();
    l.operations.push(saisie({ id: 'annonce', date: '2026-09-08', amount: -euros(100) }));
    l.subOperations.push({ id: 's1', operationId: 'annonce', categoryId: 'cat-courses', share: { kind: 'variable' } });
    l.operations.push(opération({ id: 'relevé', date: '2026-09-09', amount: -euros(100), state: 'locked' }));
    l.subOperations.push({ id: 'r1', operationId: 'relevé', categoryId: 'cat-logement', share: { kind: 'variable' } });
    l = appliquer(l, resumeEntry(l, 'relevé', 'annonce'));
    expect(l.subOperations.filter((s) => s.operationId === 'relevé').map((s) => s.categoryId)).toEqual(['cat-logement']);
    expect(lire(l, 'relevé').state).toBe('locked');
    expect(lire(l, 'relevé').resumedOperationId).toBe('annonce');
  });

  it('verrouillée et ventilée, elle reprend une occurrence : le flux ne lui prend pas son état et ne lui donne pas sa ventilation', () => {
    let l = budget();
    l.operations.push(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700), state: 'locked' }));
    l.subOperations.push({ id: 'r1', operationId: 'loyer', categoryId: 'cat-courses', share: { kind: 'variable' } });
    const m: MatchProposal = { operationId: 'loyer', flowId: 'f-loyer', expectedDate: '2026-09-05', expectedAmount: -euros(700), score: 1, auto: true, reasons: [] };
    l = appliquer(l, applyMatch(l, m));
    expect([lire(l, 'loyer').plannedFlowId, lire(l, 'loyer').plannedDate, lire(l, 'loyer').state]).toEqual(['f-loyer', '2026-09-05', 'locked']);
    expect(l.subOperations.filter((s) => s.operationId === 'loyer').map((s) => s.categoryId)).toEqual(['cat-courses']);
  });
});

describe('[niveau 2] #306 · 4. sinon, elle prend la ventilation de l’opération reprise, rejouée par l’ordre de financement pour un virement permanent dérivé (D21, D60)', () => {
  it('une saisie : sa ventilation, à tous ses niveaux', () => {
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

  it('une occurrence : celle du flux ; un virement permanent dérivé, corrigé puis réalisé, se rejoue sur le montant réel', () => {
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
});

describe('[niveau 3] #306 · 4. ce que l’écran lit d’une reprise : ce qu’elle reprend et l’écart de montant', () => {
  it('une saisie reprise : la saisie, son montant, l’écart ; une occurrence reprise : le flux, sa date, l’écart', () => {
    let l = budget();
    l.operations.push(saisie({ id: 'annonce', date: '2026-09-08', amount: -euros(80) }));
    l.operations.push(opération({ id: 'relevé', date: '2026-09-09', amount: -euros(82) }));
    l.operations.push(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(690) }));
    l = appliquer(l, resumeEntry(l, 'relevé', 'annonce'));
    l = appliquer(l, applyMatch(l, proposeMatches(l, '2026-09-01', '2026-09-30').find((p) => p.operationId === 'loyer')!));
    const saisieReprise = resumptionOf(l, lire(l, 'relevé'))!;
    expect([saisieReprise.operation?.id, saisieReprise.amount, saisieReprise.gap]).toEqual(['annonce', -euros(80), -euros(2)]);
    const occurrence = resumptionOf(l, lire(l, 'loyer'))!;
    expect([occurrence.flow?.id, occurrence.date, occurrence.amount, occurrence.gap]).toEqual(['f-loyer', '2026-09-05', -euros(700), euros(10)]);
  });
});

describe('[niveau 2] #306 · 4. la reprise se défait : ce qu’elle reprenait compte de nouveau', () => {
  it('l’opération repart de ce que l’import avait établi, et la saisie reprise compte à nouveau', () => {
    let l = budget();
    l.operations.push(saisie({ id: 'annonce', date: '2026-09-08', amount: -euros(80) }));
    l.operations.push(opération({ id: 'relevé', date: '2026-09-09', amount: -euros(82) }));
    l = appliquer(l, resumeEntry(l, 'relevé', 'annonce'));
    l = appliquer(l, undoResumption(l, 'relevé'));
    const relevé = lire(l, 'relevé');
    expect(relevé.resumedOperationId).toBeUndefined();
    expect(relevé.state).toBe('untreated');
    expect(l.subOperations.filter((s) => s.operationId === 'relevé' && !s.deletedAt)).toEqual([]);
    expect(accountBalance(l.accounts[0]!, l, LECTURE)).toBe(euros(1000 - 80 - 82));
  });

  it('une occurrence défaite est de nouveau proposée, et compte de nouveau', () => {
    let l = budget();
    l.operations.push(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700) }));
    l = importer(l);
    expect(lire(l, 'loyer').plannedFlowId).toBe('f-loyer');
    l = appliquer(l, undoResumption(l, 'loyer'));
    expect([lire(l, 'loyer').plannedFlowId, lire(l, 'loyer').plannedDate]).toEqual([undefined, undefined]);
    expect(proposeMatches(l, '2026-09-01', '2026-09-30').some((p) => p.operationId === 'loyer' && p.flowId === 'f-loyer')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Point 5
// ---------------------------------------------------------------------------

describe('[niveau 2] #306 · 5. la sélection du flux, la seule, reconnaît l’opération : automatique selon D12, en proposition sinon', () => {
  const avec = (o: Operation, retouche?: (l: Ledger) => void) => {
    const l = budget();
    retouche?.(l);
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

  it('ce que le motif, la tolérance, la fenêtre ou le compte ne retiennent pas n’est ni repris ni proposé', () => {
    expect(avec(opération({ id: 'sal', date: '2026-09-25', amount: euros(2000), label: 'VIR PRIME', normalizedLabel: 'VIR PRIME' }))).toBeUndefined();
    expect(avec(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(750) }))).toBeUndefined();
    expect(avec(opération({ id: 'loyer', date: '2026-09-15', amount: -euros(700) }))).toBeUndefined();
    expect(avec(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700), accountId: LIVRET }))).toBeUndefined();
  });

  it('un flux variable n’est jamais repris sans confirmation', () => {
    const p = avec(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700) }), (l) => {
      l.plannedFlows = l.plannedFlows.map((f) => (f.id === 'f-loyer' ? { ...f, variable: true } : f));
    });
    expect(p?.auto).toBe(false);
  });

  it('aucun automatisme n’est engendré à part d’un flux : l’import n’en ajoute aucun, qu’un flux verrouille ou non', () => {
    const l = budget();
    l.plannedFlows = l.plannedFlows.map((f) => ({ ...f, locks: true }));
    l.operations.push(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700) }));
    expect(importer(l).automations).toEqual([]);
    const exemple = exampleLedger();
    expect(importer(exemple).automations).toEqual(exemple.automations);
  });
});

// ---------------------------------------------------------------------------
// Point 6
// ---------------------------------------------------------------------------

describe('[niveau 2] #306 · 6. ce qu’un flux reprend devient rapproché, verrouillé si le flux le demande ; ce que sa sélection ne reconnaît pas n’est ni repris ni classé', () => {
  it('rapproché par défaut, avec la ventilation du flux ; verrouillé si le flux le demande', () => {
    let l = budget();
    l.operations.push(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700) }));
    l = importer(l);
    expect(lire(l, 'loyer').state).toBe('reconciled');
    expect(l.subOperations.find((s) => s.operationId === 'loyer')?.categoryId).toBe('cat-logement');

    let v = budget();
    v.plannedFlows = v.plannedFlows.map((f) => ({ ...f, locks: true }));
    v.operations.push(opération({ id: 'loyer', date: '2026-09-06', amount: -euros(700) }));
    v = importer(v);
    expect(lire(v, 'loyer').state).toBe('locked');
  });

  it('une opération que la sélection ne reconnaît pas n’est ni reprise ni classée par le flux', () => {
    let l = budget();
    // Le compte et la date conviennent, pas le montant : le loyer de 750 € n'est pas celui du flux.
    l.operations.push(opération({ id: 'autre', date: '2026-09-06', amount: -euros(750) }));
    l = importer(l);
    const o = lire(l, 'autre');
    expect([o.plannedFlowId, o.state]).toEqual([undefined, 'untreated']);
    expect(l.subOperations.filter((s) => s.operationId === 'autre')).toEqual([]);
  });
});

describe('[niveau 0] #306 · 6. modifier un flux ne réécrit aucune opération déjà reprise, et vaut pour celles qu’il reprendra (D24)', () => {
  it('l’opération reprise garde ce qu’elle a pris, l’import suivant applique le flux modifié', () => {
    let l = budget();
    l.operations.push(opération({ id: 'loyer-sept', date: '2026-09-06', amount: -euros(700) }));
    l = importer(l);
    expect(lire(l, 'loyer-sept').state).toBe('reconciled');
    const avant = { op: lire(l, 'loyer-sept'), subs: l.subOperations.filter((s) => s.operationId === 'loyer-sept') };
    expect(avant.subs.map((s) => s.categoryId)).toEqual(['cat-logement']);

    // Le flux change de classement et se met à verrouiller ; son montant et sa tolérance restent ceux
    // qui reconnaissent encore l'opération de septembre.
    l.plannedFlows = l.plannedFlows.map((f) => (f.id === 'f-loyer' ? { ...f, categoryId: 'cat-courses', tirelireId: 'vac', locks: true } : f));
    l.operations.push(opération({ id: 'loyer-oct', date: '2026-10-06', amount: -euros(700) }));
    l = importer(l);

    expect(lire(l, 'loyer-sept')).toEqual(avant.op);
    expect(l.subOperations.filter((s) => s.operationId === 'loyer-sept')).toEqual(avant.subs);
    // Ce que le flux reprend ensuite prend le flux tel qu'il est devenu.
    expect(lire(l, 'loyer-oct').state).toBe('locked');
    expect(l.subOperations.filter((s) => s.operationId === 'loyer-oct').map((s) => [s.categoryId, s.tirelireId])).toEqual([['cat-courses', 'vac']]);
  });
});

// ---------------------------------------------------------------------------
// Point 7
// ---------------------------------------------------------------------------

describe('[niveau 1] #306 · 7. le format change de version, et la précédente est refusée en le disant (D30, C8)', () => {
  it('la version du format est la 6 ; un fichier de la version 5 est refusé, sans rien ouvrir', async () => {
    expect(FORMAT_VERSION).toBe(6);
    const s = await LedgerStore.create({ sqlJs: SQL });
    const db = new SQL.Database(s.export());
    db.run(`UPDATE meta SET value = '5' WHERE key = 'format_version'`);
    await expect(LedgerStore.create({ sqlJs: SQL, bytes: db.export() })).rejects.toMatchObject({ reason: 'ancien' });
  });
});

describe('[niveau 2] #306 · 7. l’exemple s’écrit et se relit au nouveau format, et son plan reste celui d’aujourd’hui, au centime près', () => {
  it('l’exemple, son salaire d’août repris par son flux et sa date, se relit tel quel', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL });
    const l = exampleLedger();
    for (const cle of LEDGER_KEYS) for (const ligne of l[cle]) s.upsert(cle, ligne as never);
    const relu = await LedgerStore.create({ sqlJs: SQL, bytes: s.export(), verifier: true });
    expect(relu.load().operations.find((o) => o.id === 'op-salaire-08')).toMatchObject({ plannedFlowId: 'flow-salaire', plannedDate: '2026-08-28' });
    expect(missingFlows(l, '2026-08-01', '2026-09-06').some((m) => m.flowId === 'flow-salaire' && m.expectedDate === '2026-08-28')).toBe(false);
  });

  it('les montants que `main` donnait : le 6 septembre, le 20 octobre, le 10 janvier', () => {
    const net = (p: ReturnType<typeof computePlan>) => p.transfers.find((t) => t.accountId === 'acc-livret')!.net;
    const sept = computePlan(exampleLedger(), '2026-09-06');
    expect(sept.totals).toEqual({ incomes: 420000, fixedCharges: 122000, requested: 235000, funded: 235000, margin: 63000, cushion: 60000, principalUnallocated: 339000 });
    expect(net(sept)).toBe(68500);
    const oct = computePlan(exampleLedger(), '2026-10-20');
    expect(oct.totals).toEqual({ incomes: 420000, fixedCharges: 122000, requested: 238600, funded: 238600, margin: 59400, cushion: 60000, principalUnallocated: 237400 });
    expect(net(oct)).toBe(138500);
    const jan = computePlan(exampleLedger(), '2027-01-10');
    expect(jan.totals).toEqual({ incomes: 435000, fixedCharges: 27000, requested: 279500, funded: 279500, margin: 128500, cushion: 60000, principalUnallocated: -56100 });
    expect(net(jan)).toBe(353500);
  });
});
