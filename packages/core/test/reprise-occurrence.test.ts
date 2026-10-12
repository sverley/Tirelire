/**
 * Tests du codeur de #445 — dire à la main qu'une opération est l'occurrence d'un flux prévu, hors de
 * sa fenêtre et de sa tolérance (D12, D22, D24, D26, D88). Côté cœur ; ce qui se lit et se fait à
 * l'écran : `apps/web/test/reprise-occurrence-ecran.test.ts`. Chaque `describe` reprend un point du
 * « Fait quand » sous son numéro. Données inventées (D84) : de petits grands livres écrits ici.
 */
import { describe, expect, it } from 'vitest';
import {
  applyBulkOccurrence,
  applyPatchToLedger,
  bulkOccurrencePlan,
  bulkOfferedFlows,
  canResumeOccurrence,
  correctPlannedOperation,
  emptyLedger,
  euros,
  missingFlows,
  offeredFlows,
  operationsOfferedAFlow,
  proposeMatches,
  resumeOccurrence,
  resumptionOf,
  undoResumption,
  type Ledger,
  type Operation,
  type PlannedFlow,
} from '../src/index.js';

const CC = 'cc';
const LIVRET = 'livret';

function flux(f: Partial<PlannedFlow> & Pick<PlannedFlow, 'id' | 'name' | 'amount'>): PlannedFlow {
  return { kind: 'income', accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-10-25' }, dateWindowDays: 3, ...f };
}

function opération(o: Partial<Operation> & Pick<Operation, 'id' | 'date' | 'amount'>): Operation {
  return { accountId: CC, origin: 'imported', label: o.id.toUpperCase(), normalizedLabel: o.id.toUpperCase(), state: 'untreated', ...o };
}

/**
 * Un compte courant et un livret ; une paie de 2 500 € le 25 de chaque mois depuis octobre (motif
 * « SALAIRE », fenêtre de 3 jours, sans tolérance), classée « Salaire » ; un loyer de 700 € le 5.
 * Les paies d'octobre et de novembre sont reprises ; celle de décembre tombe le 19, hors de la
 * fenêtre du 25 : ni reprise, ni proposée (D12) — le cas du besoin.
 */
function budget(): Ledger {
  const l = emptyLedger({ periodStartDay: 1 });
  l.accounts.push({ id: CC, name: 'Compte courant', kind: 'principal', openingBalance: euros(1000), openingDate: '2026-09-30' });
  l.accounts.push({ id: LIVRET, name: 'Livret', kind: 'epargne', openingBalance: 0, openingDate: '2026-09-30' });
  l.categories.push({ id: 'cat-salaire', name: 'Salaire', nature: 'income' }, { id: 'cat-logement', name: 'Logement', nature: 'expense' }, { id: 'cat-divers', name: 'Divers', nature: 'income' });
  l.plannedFlows.push(flux({ id: 'f-paie', name: 'Paie', amount: euros(2500), labelPattern: 'SALAIRE', action: { categoryId: 'cat-salaire' } }));
  l.plannedFlows.push(flux({ id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', amount: -euros(700), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-10-05' } }));
  l.operations.push(
    opération({ id: 'salaire-oct', date: '2026-10-25', amount: euros(2500), state: 'reconciled', plannedFlowId: 'f-paie', plannedDate: '2026-10-25' }),
    opération({ id: 'salaire-nov', date: '2026-11-25', amount: euros(2500), state: 'reconciled', plannedFlowId: 'f-paie', plannedDate: '2026-11-25' }),
    opération({ id: 'salaire-dec', date: '2026-12-19', amount: euros(2480) }),
  );
  return l;
}

const lire = (l: Ledger, id: string) => l.operations.find((o) => o.id === id)!;
const dates = (l: Ledger, opId: string, flowId: string) => offeredFlows(l, opId).find((o) => o.flow.id === flowId)?.occurrences.map((o) => o.date);
const instantané = (l: Ledger) => JSON.stringify(l);

describe('[niveau 4] #445 · 1. les opérations concernées', () => {
  it('une opération importée qui ne reprend rien, quel que soit son état ; ni une saisie, ni une opération qui reprend déjà', () => {
    const l = budget();
    expect(canResumeOccurrence(lire(l, 'salaire-dec'))).toBe(true);
    expect(canResumeOccurrence({ ...lire(l, 'salaire-dec'), state: 'locked' })).toBe(true);
    expect(canResumeOccurrence({ ...lire(l, 'salaire-dec'), state: 'reconciled' })).toBe(true);
    expect(canResumeOccurrence(lire(l, 'salaire-nov')), 'elle reprend déjà une occurrence').toBe(false);
    expect(canResumeOccurrence({ ...lire(l, 'salaire-dec'), resumedOperationId: 'x' }), 'elle reprend déjà une saisie').toBe(false);
    expect(canResumeOccurrence({ ...lire(l, 'salaire-dec'), origin: 'manual' }), 'une saisie').toBe(false);
  });

  it('qu’une reprise lui soit proposée ou non : une opération dans la fenêtre, proposée, se voit offrir les mêmes flux', () => {
    const l = budget();
    l.operations.push(opération({ id: 'salaire-24', date: '2026-12-24', amount: euros(2500), label: 'SALAIRE', normalizedLabel: 'SALAIRE' }));
    expect(proposeMatches(l, '2026-12-01', '2026-12-31').some((p) => p.operationId === 'salaire-24'), 'le décor ne propose rien').toBe(true);
    expect(offeredFlows(l, 'salaire-24').map((o) => o.flow.id)).toEqual(['f-paie']);
  });
});

describe('[niveau 4] #445 · 2. les flux offerts', () => {
  it('ceux de son compte et de son sens, non supprimés, quels que soient motif, tolérance, fenêtre, variable', () => {
    const l = budget();
    l.plannedFlows.push(
      flux({ id: 'f-prime', name: 'Prime', amount: euros(300), variable: true, labelPattern: 'PRIME' }),
      flux({ id: 'f-livret', name: 'Intérêts', amount: euros(10), accountId: LIVRET }),
      flux({ id: 'f-retire', name: 'Ancienne paie', amount: euros(2480), deletedAt: '2026-11-01T00:00:00Z' }),
    );
    // Le loyer est de l'autre sens ; les intérêts, d'un autre compte ; l'ancienne paie, supprimée.
    expect(offeredFlows(l, 'salaire-dec').map((o) => o.flow.id)).toEqual(['f-paie', 'f-prime']);
  });

  it('du plus proche en montant au plus éloigné, puis par leur nom', () => {
    const l = budget();
    l.plannedFlows.push(flux({ id: 'f-b', name: 'Bonus', amount: euros(2460) }), flux({ id: 'f-a', name: 'Aide', amount: euros(2460) }), flux({ id: 'f-c', name: 'Cadeau', amount: euros(100) }));
    // Écarts : Paie 20 €, Aide 20 €, Bonus 20 €, Cadeau 2 380 €.
    expect(offeredFlows(l, 'salaire-dec').map((o) => o.flow.name)).toEqual(['Aide', 'Bonus', 'Paie', 'Cadeau']);
  });

  it('un flux sans occurrence libre dans sa période de validité ne s’offre pas', () => {
    const l = budget();
    l.plannedFlows.push(flux({ id: 'f-unique', name: 'Prime unique', amount: euros(500), activeFrom: '2026-11-25', activeTo: '2026-11-25' }));
    // Sa seule occurrence, le 25 novembre, est reprise.
    l.operations.push(opération({ id: 'prime', date: '2026-11-25', amount: euros(500), plannedFlowId: 'f-unique', plannedDate: '2026-11-25', state: 'reconciled' }));
    expect(offeredFlows(l, 'salaire-dec').map((o) => o.flow.id)).toEqual(['f-paie']);
  });

  it('rien pour une opération qui n’est pas concernée', () => {
    expect(offeredFlows(budget(), 'salaire-nov')).toEqual([]);
  });
});

describe('[niveau 4] #445 · 3. les occurrences offertes', () => {
  it('le cas du besoin : la paie du 19 décembre se voit offrir d’abord l’occurrence du 25 décembre', () => {
    const l = budget();
    const paie = offeredFlows(l, 'salaire-dec')[0]!;
    expect(paie.flow.id).toBe('f-paie');
    // Octobre et novembre sont repris : aucune occurrence libre avant le 19 ; la première après, le 25.
    expect(paie.occurrences).toEqual([{ flowId: 'f-paie', date: '2026-12-25', amount: euros(2500), gap: -euros(20), days: 6 }]);
  });

  it('la dernière libre à la date de l’opération ou avant, puis la première libre après ; la plus proche d’abord', () => {
    const l = budget();
    l.operations = l.operations.filter((o) => o.id !== 'salaire-nov');
    // Libres : 25 novembre (24 jours avant), 25 décembre (6 jours après).
    expect(dates(l, 'salaire-dec', 'f-paie')).toEqual(['2026-12-25', '2026-11-25']);
    // Une opération le jour même d'une occurrence libre la prend en premier, à 0 jour.
    l.operations.push(opération({ id: 'le-jour', date: '2026-11-25', amount: euros(2500) }));
    expect(offeredFlows(l, 'le-jour')[0]!.occurrences.map((o) => [o.date, o.days])).toEqual([
      ['2026-11-25', 0],
      ['2026-12-25', 30],
    ]);
  });

  it('à égalité de jours, la plus ancienne', () => {
    const l = budget();
    l.plannedFlows.push(flux({ id: 'f-2j', name: 'Tous les deux jours', amount: euros(100), periodicity: { interval: 2, unit: 'day', anchorDate: '2026-12-02' } }));
    // Occurrences les 18 et 20 décembre, à 1 jour du 19 chacune.
    expect(dates(l, 'salaire-dec', 'f-2j')).toEqual(['2026-12-18', '2026-12-20']);
  });

  it('dans sa période de validité seulement', () => {
    const l = budget();
    l.plannedFlows.find((f) => f.id === 'f-paie')!.activeTo = '2026-12-20';
    // Le 25 décembre est hors de la validité ; octobre et novembre sont repris : rien ne s'offre.
    expect(offeredFlows(l, 'salaire-dec')).toEqual([]);
    delete l.plannedFlows.find((f) => f.id === 'f-paie')!.activeTo;
    l.plannedFlows.find((f) => f.id === 'f-paie')!.activeFrom = '2027-01-01';
    expect(dates(l, 'salaire-dec', 'f-paie')).toEqual(['2027-01-25']);
  });

  it('une occurrence qu’une saisie corrige ou masque le dit : ce qui serait repris est la saisie', () => {
    let l = budget();
    l = applyPatchToLedger(l, correctPlannedOperation(l, 'f-paie', '2026-12-25', euros(2450), '2026-12-23'));
    const [occ] = offeredFlows(l, 'salaire-dec')[0]!.occurrences;
    expect(occ!.date).toBe('2026-12-25');
    expect(occ!.entry?.amount).toBe(euros(2450));
    expect([occ!.amount, occ!.gap]).toEqual([euros(2450), euros(30)]);
    // Masquée : ce qui serait repris vaut zéro.
    let m = budget();
    m = applyPatchToLedger(m, correctPlannedOperation(m, 'f-paie', '2026-12-25', 0, '2026-12-25'));
    expect(offeredFlows(m, 'salaire-dec')[0]!.occurrences[0]).toMatchObject({ date: '2026-12-25', amount: 0, gap: euros(2480) });
  });

  it('une occurrence dont la saisie est déjà reprise par une autre opération n’est pas libre', () => {
    let l = budget();
    l = applyPatchToLedger(l, correctPlannedOperation(l, 'f-paie', '2026-12-25', euros(2450), '2026-12-23'));
    const saisie = l.operations.find((o) => o.origin === 'manual')!;
    l.operations.push(opération({ id: 'autre', date: '2026-12-23', amount: euros(2450), resumedOperationId: saisie.id, state: 'reconciled' }));
    expect(dates(l, 'salaire-dec', 'f-paie')).toEqual(['2027-01-25']);
  });
});

describe('[niveau 4] #445 · 5. les lignes qui portent le geste', () => {
  it('les opérations concernées à qui au moins un flux est offert, et elles seules', () => {
    const l = budget();
    l.operations.push(
      opération({ id: 'saisie', date: '2026-12-10', amount: euros(50), origin: 'manual', state: 'locked' }),
      opération({ id: 'livret', date: '2026-12-10', amount: euros(50), accountId: LIVRET }),
      opération({ id: 'loyer-dec', date: '2026-12-05', amount: -euros(700) }),
    );
    expect([...operationsOfferedAFlow(l)].sort()).toEqual(['loyer-dec', 'salaire-dec']);
  });

  it('dans un projet sans flux, aucune (U5)', () => {
    const l = budget();
    l.plannedFlows = [];
    expect(operationsOfferedAFlow(l).size).toBe(0);
    l.plannedFlows = budget().plannedFlows.map((f) => ({ ...f, deletedAt: '2026-11-01T00:00:00Z' }));
    expect(operationsOfferedAFlow(l).size).toBe(0);
  });
});

describe('[niveau 4] #445 · 7. ce que fait la reprise', () => {
  it('l’opération reprend l’occurrence, avec la ventilation du flux, et devient verrouillée ; le flux ne change pas', () => {
    const l = budget();
    const p = resumeOccurrence(l, 'salaire-dec', 'f-paie', '2026-12-25');
    expect(p.operations).toHaveLength(1);
    expect(p.operations[0]).toMatchObject({ id: 'salaire-dec', plannedFlowId: 'f-paie', plannedDate: '2026-12-25', state: 'locked' });
    expect(p.subOperations.map((s) => [s.operationId, s.categoryId, s.share.kind])).toEqual([['salaire-dec', 'cat-salaire', 'variable']]);
    expect(Object.keys(p).sort()).toEqual(['operations', 'removedSubOperations', 'subOperations']);
    const après = applyPatchToLedger(l, p);
    expect(après.plannedFlows).toEqual(l.plannedFlows);
    expect(resumptionOf(après, lire(après, 'salaire-dec'))).toMatchObject({ date: '2026-12-25', amount: euros(2500), gap: -euros(20) });
  });

  it('elle garde sa ventilation si elle en porte une ; verrouillée ou rapprochée, elle devient verrouillée', () => {
    const l = budget();
    l.operations.find((o) => o.id === 'salaire-dec')!.state = 'reconciled';
    l.subOperations.push({ id: 's-own', operationId: 'salaire-dec', categoryId: 'cat-divers', share: { kind: 'variable' } });
    const p = resumeOccurrence(l, 'salaire-dec', 'f-paie', '2026-12-25');
    expect(p.subOperations).toEqual([]);
    expect(p.operations[0]!.state).toBe('locked');
  });

  it('pour un flux de virement, son compte de destination', () => {
    const l = budget();
    l.plannedFlows.push(flux({ id: 'f-epargne', name: 'Épargne', kind: 'transfer', amount: -euros(200), counterpartAccountId: LIVRET, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-10-02' } }));
    l.operations.push(opération({ id: 'vir', date: '2026-12-15', amount: -euros(150) }));
    const p = resumeOccurrence(l, 'vir', 'f-epargne', '2026-12-02');
    expect(p.operations[0]).toMatchObject({ plannedFlowId: 'f-epargne', plannedDate: '2026-12-02', transferAccountId: LIVRET, state: 'locked' });
  });

  it('une occurrence corrigée par une saisie : c’est la saisie qui est reprise, avec sa ventilation', () => {
    let l = budget();
    l = applyPatchToLedger(l, correctPlannedOperation(l, 'f-paie', '2026-12-25', euros(2450), '2026-12-23'));
    const saisie = l.operations.find((o) => o.origin === 'manual')!;
    const p = resumeOccurrence(l, 'salaire-dec', 'f-paie', '2026-12-25');
    expect(p.operations[0]).toMatchObject({ resumedOperationId: saisie.id, state: 'locked' });
    expect(p.operations[0]!.plannedFlowId).toBeUndefined();
    expect(p.subOperations.map((s) => s.categoryId)).toEqual(['cat-salaire']);
  });

  it('aussitôt : l’occurrence n’est plus attendue, non reçue, ne se propose ni ne s’offre plus à une autre opération', () => {
    const l = budget();
    l.operations.push(opération({ id: 'salaire-25', date: '2026-12-25', amount: euros(2500), label: 'SALAIRE', normalizedLabel: 'SALAIRE' }));
    // Avant : l'occurrence du 25 est proposée à l'opération du 25, et offerte aux deux.
    expect(proposeMatches(l, '2026-12-01', '2026-12-31').find((p) => p.operationId === 'salaire-25')?.expectedDate).toBe('2026-12-25');
    const après = applyPatchToLedger(l, resumeOccurrence(l, 'salaire-dec', 'f-paie', '2026-12-25'));
    expect(proposeMatches(après, '2026-12-01', '2026-12-31').some((p) => p.flowId === 'f-paie' && p.expectedDate === '2026-12-25')).toBe(false);
    expect(dates(après, 'salaire-25', 'f-paie')).not.toContain('2026-12-25');
    expect(proposeMatches(après, '2026-12-01', '2026-12-31').some((p) => p.operationId === 'salaire-dec')).toBe(false);
    // Sans opération, le 25 décembre serait attendu, non reçu au 31 ; repris, il ne l'est plus.
    const sans = budget();
    expect(missingFlows(sans, '2026-12-01', '2026-12-31').some((m) => m.flowId === 'f-paie' && m.expectedDate === '2026-12-25')).toBe(true);
    const repris = applyPatchToLedger(sans, resumeOccurrence(sans, 'salaire-dec', 'f-paie', '2026-12-25'));
    expect(missingFlows(repris, '2026-12-01', '2026-12-31').some((m) => m.flowId === 'f-paie')).toBe(false);
  });

  it('rien pour une occurrence prise, hors validité, qui n’existe pas, ou un flux d’un autre sens', () => {
    const l = budget();
    expect(resumeOccurrence(l, 'salaire-dec', 'f-paie', '2026-11-25').operations).toEqual([]);
    expect(resumeOccurrence(l, 'salaire-dec', 'f-paie', '2026-12-24').operations).toEqual([]);
    expect(resumeOccurrence(l, 'salaire-dec', 'f-paie', '2026-09-25').operations, 'avant l’ancrage').toEqual([]);
    expect(resumeOccurrence(l, 'salaire-dec', 'f-loyer', '2026-12-05').operations).toEqual([]);
    expect(resumeOccurrence(l, 'salaire-nov', 'f-paie', '2026-12-25').operations).toEqual([]);
  });
});

describe('[niveau 4] #445 · 8. la défaire', () => {
  it('l’occurrence redevient libre et s’offre de nouveau ; l’opération reste verrouillée et garde sa ventilation', () => {
    const l = budget();
    const repris = applyPatchToLedger(l, resumeOccurrence(l, 'salaire-dec', 'f-paie', '2026-12-25'));
    const défait = applyPatchToLedger(repris, undoResumption(repris, 'salaire-dec'));
    const op = lire(défait, 'salaire-dec');
    expect(op.plannedFlowId).toBeUndefined();
    expect(op.state).toBe('locked');
    expect(défait.subOperations.filter((s) => s.operationId === 'salaire-dec').map((s) => s.categoryId)).toEqual(['cat-salaire']);
    expect(dates(défait, 'salaire-dec', 'f-paie')).toEqual(['2026-12-25']);
    expect(missingFlows(défait, '2026-12-01', '2026-12-31').some((m) => m.flowId === 'f-paie' && m.expectedDate === '2026-12-25')).toBe(true);
  });
});

describe('[niveau 4] #445 · 6. par la sélection', () => {
  /** Trois paies de décembre à janvier, hors de leur fenêtre, et ce qu'il faut autour. */
  function plusieurs(): Ledger {
    const l = budget();
    l.operations.push(opération({ id: 'salaire-jan', date: '2027-01-20', amount: euros(2490) }), opération({ id: 'saisie', date: '2026-12-10', amount: euros(50), origin: 'manual', state: 'locked' }));
    return l;
  }

  it('les flux offerts sont ceux du compte et du sens que partagent les cibles concernées', () => {
    const l = plusieurs();
    expect(bulkOfferedFlows(l, ['salaire-dec', 'salaire-jan', 'saisie', 'salaire-nov']).flows.map((f) => f.id)).toEqual(['f-paie']);
    l.operations.push(opération({ id: 'loyer-dec', date: '2026-12-05', amount: -euros(700) }));
    expect(bulkOfferedFlows(l, ['salaire-dec', 'loyer-dec'])).toEqual({ flows: [], refusal: 'mixed' });
    expect(bulkOfferedFlows(l, ['saisie', 'salaire-nov'])).toEqual({ flows: [], refusal: 'noTarget' });
    l.plannedFlows.find((f) => f.id === 'f-paie')!.activeTo = '2026-11-30';
    expect(bulkOfferedFlows(l, ['salaire-dec'])).toEqual({ flows: [], refusal: 'noFree' });
    l.plannedFlows = [];
    expect(bulkOfferedFlows(l, ['salaire-dec'])).toEqual({ flows: [], refusal: 'noFlow' });
  });

  it('chaque cible prend l’occurrence libre la plus proche ; les couples se servent du plus proche au plus éloigné', () => {
    const l = plusieurs();
    l.operations.push(opération({ id: 'salaire-22', date: '2026-12-22', amount: euros(2500) }));
    const plan = bulkOccurrencePlan(l, ['salaire-dec', 'salaire-22', 'salaire-jan', 'saisie', 'salaire-nov'], 'f-paie');
    // Les couples, du plus proche au plus éloigné : le 22 décembre et le 25 décembre (3 jours), le
    // 20 janvier et le 25 janvier (5 jours), puis le 19 décembre, dont le 25 décembre (6 jours) et le
    // 25 janvier (37 jours) sont pris : il prend le 25 février (68 jours).
    expect(plan.map((p) => [p.operationId, p.occurrence?.date ?? p.refusal])).toEqual([
      ['salaire-dec', '2027-02-25'],
      ['salaire-22', '2026-12-25'],
      ['salaire-jan', '2027-01-25'],
      ['saisie', 'notConcerned'],
      ['salaire-nov', 'notConcerned'],
    ]);
  });

  it('à égalité de jours, la cible la plus ancienne d’abord ; aucune occurrence libre ne reste à la dernière', () => {
    const l = budget();
    l.operations.push(opération({ id: 'apres', date: '2026-12-28', amount: euros(2500) }), opération({ id: 'avant', date: '2026-12-22', amount: euros(2500) }));
    l.plannedFlows.find((f) => f.id === 'f-paie')!.activeTo = '2027-01-31';
    // Le 22 et le 28 sont à 3 jours du 25 : le 22 le prend. Le 28 prend le 25 janvier, le 19 rien.
    const plan = bulkOccurrencePlan(l, ['salaire-dec', 'apres', 'avant'], 'f-paie');
    expect(plan.map((p) => [p.operationId, p.occurrence?.date ?? p.refusal])).toEqual([
      ['salaire-dec', 'noneLeft'],
      ['apres', '2027-01-25'],
      ['avant', '2026-12-25'],
    ]);
  });

  it('« Appliquer » fait ces reprises, et elles seules : verrouillées, avec ce que le flux leur donne', () => {
    const l = plusieurs();
    const p = applyBulkOccurrence(l, ['salaire-dec', 'salaire-jan', 'saisie'], 'f-paie');
    expect(p.operations.map((o) => [o.id, o.plannedDate, o.state])).toEqual([
      ['salaire-dec', '2026-12-25', 'locked'],
      ['salaire-jan', '2027-01-25', 'locked'],
    ]);
    expect(p.subOperations.map((s) => [s.operationId, s.categoryId])).toEqual([
      ['salaire-dec', 'cat-salaire'],
      ['salaire-jan', 'cat-salaire'],
    ]);
    // Un flux qui n'est pas offert aux cibles ne reprend rien.
    expect(applyBulkOccurrence(l, ['salaire-dec'], 'f-loyer').operations).toEqual([]);
  });
});

describe('[niveau 4] #445 · 9. rien ne s’écrit avant le geste (I10)', () => {
  it('lire ce qui s’offre, l’aperçu ou la reprise ne touche pas au grand livre', () => {
    const l = budget();
    const avant = instantané(l);
    offeredFlows(l, 'salaire-dec');
    operationsOfferedAFlow(l);
    bulkOfferedFlows(l, ['salaire-dec']);
    bulkOccurrencePlan(l, ['salaire-dec'], 'f-paie');
    resumeOccurrence(l, 'salaire-dec', 'f-paie', '2026-12-25');
    applyBulkOccurrence(l, ['salaire-dec'], 'f-paie');
    expect(instantané(l)).toBe(avant);
  });
});
