/**
 * Harnais d'audit de #434 — « Faire d'un virement importé l'ordre permanent que le plan propose »
 * (#40, U3 ; D60 précisée). Côté cœur ; l'écran qui propose ce geste vient avec #435.
 *
 * Composé après le codage (auditeur.md, étape 2), parmi les tests du codeur
 * (`ordre-depuis-virement.test.ts`, déplacé ici en entier) : chaque `describe` nomme le point du
 * « Fait quand » qu'il tranche. Sont de moi : la séparation, au point 1, de l'opération qui reprend
 * déjà quelque chose, dont l'enregistrement effacerait la reprise (niveau 0), et, au point 7, la
 * non-réécriture de l'ordre lue contre une copie prise avant le calcul du plan, et non contre l'objet
 * même que le grand livre porte.
 *
 * Données inventées : un compte principal, un Livret A, un compte joint sans tirelire ; sur le
 * livret, une tirelire qui porte une échéance (400 €/mois) et un objectif (250 €/mois) : le budget y
 * demande 650 €. Lecture le 6 septembre 2026, période du 28 août au 27 septembre.
 */
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  applyMatch,
  applyPatchToLedger,
  componentsOnAccount,
  computePlan,
  emptyLedger,
  euros,
  indexLedger,
  LedgerStore,
  manualEdit,
  matchTirelireTransfers,
  normalizeLabel,
  orderFromTransfer,
  pairInternalTransfers,
  proposeMatches,
  recordOrderFromTransfer,
  standingTransferFlow,
  tirelireComponents,
  unallocated,
  unallocatedAmount,
  type Ledger,
  type Operation,
  type PlannedFlow,
} from '../src/index.js';

const SQL = await initSqlJs();
const CC = 'acc-principal';
const LIVRET = 'livret';
const JOINT = 'joint';
const LECTURE = '2026-09-06';
const LIBELLE = 'VIR SEPA EPARGNE LIVRET A M DUPONT';
const mensuel = (anchorDate: string) => ({ interval: 1, unit: 'month' as const, anchorDate });

function budget(pas = euros(10)): Ledger {
  const l = emptyLedger({ periodStartDay: 28, orderRounding: pas });
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(3000), openingDate: '2026-08-27' },
    { id: LIVRET, name: 'Livret A', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-27' },
    { id: JOINT, name: 'Compte joint', kind: 'courant', openingBalance: 0, openingDate: '2026-08-27' },
  );
  l.tirelires.push(
    { id: 'taxe', name: 'Taxe', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' },
    { id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' },
  );
  l.needs.push(
    { id: 'n-taxe', tirelireId: 'taxe', kind: 'dueDate', amount: euros(4800), periodicity: { interval: 12, unit: 'month', anchorDate: '2027-08-15' }, priority: 10 },
    { id: 'n-vac', tirelireId: 'vac', kind: 'goal', amount: euros(9000), monthlyAmount: euros(250), priority: 30 },
  );
  l.plannedFlows.push({ id: 'salaire', name: 'Salaire', kind: 'income', amount: euros(2500), accountId: CC, periodicity: mensuel('2026-08-28'), dateWindowDays: 3 });
  return l;
}

function virement(montant: number, o: Partial<Operation> = {}): Operation {
  const label = o.label ?? LIBELLE;
  return { id: 'op-vir', accountId: CC, origin: 'imported', date: '2026-09-02', label, normalizedLabel: normalizeLabel(label), amount: -montant, state: 'reconciled', transferAccountId: LIVRET, ...o };
}

const avec = (l: Ledger, ...ops: Operation[]): Ledger => ({ ...l, operations: [...l.operations, ...ops] });
const livret = (l: Ledger, lecture = LECTURE) => computePlan(l, lecture).transfers.find((t) => t.accountId === LIVRET)!;

/** Enregistre l'ordre fait du virement, comme l'application l'écrira au geste. */
function enregistrer(l: Ledger, opId = 'op-vir', montant?: number): { ledger: Ledger; flow: PlannedFlow } {
  const r = recordOrderFromTransfer(l, opId, LECTURE, 'ordre-u3', montant);
  expect(r, 'aucun ordre à enregistrer').toBeDefined();
  return { ledger: applyPatchToLedger({ ...l, plannedFlows: [...l.plannedFlows, r!.flow] }, r!.patch), flow: r!.flow };
}

describe('[niveau 2] #434 · 1. le virement qui peut devenir un ordre', () => {
  it('le budget demande 650 € sur le Livret A, et le plan y propose un ordre', () => {
    const t = livret(avec(budget(), virement(euros(600))));
    expect(t.permanent).toBe(euros(650));
    expect(t.proposal?.amount).toBe(euros(650));
  });

  it('reconnu par le libellé tiré du nom du compte (D11)', () => {
    const brut = virement(euros(600), { label: 'VIR TIRELIRE LIVRET A', state: 'untreated' });
    delete brut.transferAccountId;
    const l = avec(budget(), brut);
    expect(orderFromTransfer(l, 'op-vir', LECTURE, 'x')).toBeUndefined();
    const l2 = applyPatchToLedger(l, matchTirelireTransfers(l));
    expect(orderFromTransfer(l2, 'op-vir', LECTURE, 'x')?.amount).toBe(-euros(600));
  });

  it('reconnu par l’appariement au crédit du même montant ; le côté compte d’accueil ne propose rien', () => {
    const debit = virement(euros(600), { state: 'untreated' });
    delete debit.transferAccountId;
    const credit: Operation = { id: 'op-credit', accountId: LIVRET, origin: 'imported', date: '2026-09-03', label: 'VIR RECU', normalizedLabel: 'VIR RECU', amount: euros(600), state: 'untreated' };
    const l = avec(budget(), debit, credit);
    const l2 = applyPatchToLedger(l, pairInternalTransfers(l));
    expect(l2.operations.find((o) => o.id === 'op-vir')!.transferOperationId).toBe('op-credit');
    expect(orderFromTransfer(l2, 'op-vir', LECTURE, 'x')?.amount).toBe(-euros(600));
    expect(orderFromTransfer(l2, 'op-credit', LECTURE, 'x')).toBeUndefined();
  });

  it('désigné à la main comme « Virement vers » ce compte, donc verrouillé (D22)', () => {
    const brut = virement(euros(600), { state: 'untreated' });
    delete brut.transferAccountId;
    const l = avec(budget(), manualEdit(brut, { transferAccountId: LIVRET }));
    expect(l.operations[0]!.state).toBe('locked');
    expect(orderFromTransfer(l, 'op-vir', LECTURE, 'x')?.amount).toBe(-euros(600));
  });

  it('rien pour une opération qui n’est pas un virement importé vivant du principal', () => {
    const cas: Array<[string, Operation]> = [
      ['saisie', virement(euros(600), { origin: 'manual' })],
      ['retirée', virement(euros(600), { deletedAt: '2026-09-05T00:00:00Z' })],
      ['crédit', virement(-euros(600))],
      ['pas un virement', (() => { const o = virement(euros(600)); delete o.transferAccountId; return o; })()],
      ['depuis un autre compte', virement(euros(600), { accountId: JOINT })],
    ];
    for (const [nom, op] of cas) expect(orderFromTransfer(avec(budget(), op), 'op-vir', LECTURE, 'x'), nom).toBeUndefined();
  });

  it('rien vers un compte où le budget ne demande rien, ou retiré', () => {
    expect(orderFromTransfer(avec(budget(), virement(euros(600), { transferAccountId: JOINT })), 'op-vir', LECTURE, 'x')).toBeUndefined();
    const l = avec(budget(), virement(euros(600)));
    l.accounts = l.accounts.map((a) => (a.id === LIVRET ? { ...a, deletedAt: '2026-09-01T00:00:00Z' } : a));
    expect(orderFromTransfer(l, 'op-vir', LECTURE, 'x')).toBeUndefined();
  });

  it('rien vers un compte qui a déjà un ordre permanent vivant, quelle que soit sa validité (#393, point 5)', () => {
    const ordre: PlannedFlow = { id: 'o', name: 'Ancien', kind: 'transfer', amount: -euros(300), accountId: CC, counterpartAccountId: LIVRET, periodicity: mensuel('2026-01-05'), dateWindowDays: 5, labelPattern: 'AUTRE' };
    for (const o of [ordre, { ...ordre, activeTo: '2026-06-30' }, { ...ordre, activeFrom: '2027-01-01' }, { ...ordre, id: 'o2', amount: euros(300), accountId: LIVRET, counterpartAccountId: CC }]) {
      const l = { ...avec(budget(), virement(euros(600))), plannedFlows: [...budget().plannedFlows, o] };
      expect(orderFromTransfer(l, 'op-vir', LECTURE, 'x'), o.id).toBeUndefined();
    }
    // Un ordre retiré ne compte plus.
    const l = { ...avec(budget(), virement(euros(600))), plannedFlows: [...budget().plannedFlows, { ...ordre, deletedAt: '2026-08-01T00:00:00Z' }] };
    expect(orderFromTransfer(l, 'op-vir', LECTURE, 'x')).toBeDefined();
  });

  it('sans tirelire (U5), aucune opération ne se propose', () => {
    const l = avec(budget(), virement(euros(600)));
    l.tirelires = [];
    l.needs = [];
    expect(orderFromTransfer(l, 'op-vir', LECTURE, 'x')).toBeUndefined();
  });
});

describe('[niveau 0] #434 · 1 et 5. une opération qui reprend déjà quelque chose ne propose rien, et son enregistrement n’efface rien (D88)', () => {
  it('ni l’occurrence d’un flux, ni une saisie ne se perdent', () => {
    const cas: Array<[string, Operation]> = [
      ['reprend une occurrence', virement(euros(600), { plannedFlowId: 'salaire', plannedDate: '2026-08-28' })],
      ['reprend une saisie', virement(euros(600), { resumedOperationId: 'op-saisie' })],
    ];
    for (const [nom, op] of cas) {
      const l = avec(budget(), op);
      expect(orderFromTransfer(l, 'op-vir', LECTURE, 'x'), nom).toBeUndefined();
      expect(recordOrderFromTransfer(l, 'op-vir', LECTURE, 'x'), nom).toBeUndefined();
    }
  });
});

describe('[niveau 2] #434 · 2. l’ordre proposé', () => {
  it('l’ordre de l’écran Plan, sauf le montant, la ventilation, l’ancrage et le motif', () => {
    const l = avec(budget(), virement(euros(600)));
    const plan = computePlan(l, LECTURE);
    const t = plan.transfers.find((x) => x.accountId === LIVRET)!;
    const plan650 = standingTransferFlow(plan, t, CC, 'ordre-u3')!;
    const fait = orderFromTransfer(l, 'op-vir', LECTURE, 'ordre-u3')!;
    const { amount, action, periodicity, labelPattern, ...reste } = fait;
    const { amount: _a, action: _b, periodicity: p650, labelPattern: lp650, ...reste650 } = plan650;
    expect(reste).toEqual(reste650);
    expect(lp650).toBe('TIRELIRE LIVRET A');
    expect(amount).toBe(-euros(600));
    // L'échéance d'abord, puis l'objectif, jusqu'à épuiser le montant (D06 ; #393, point 9).
    expect(action).toEqual({
      allocation: [
        { tirelireId: 'taxe', share: { kind: 'fixed', amount: -euros(400) } },
        { tirelireId: 'vac', share: { kind: 'fixed', amount: -euros(200) } },
      ],
    });
    expect(periodicity).toEqual({ ...p650, anchorDate: '2026-09-02' });
    expect(periodicity).toEqual(mensuel('2026-09-02'));
    expect(labelPattern).toBe('EPARGNE.*LIVRET');
    expect(new RegExp(labelPattern!, 'i').test(LIBELLE)).toBe(true);
  });

  it('le motif est celui que l’écran Opérations propose pour un automatisme créé depuis l’opération', async () => {
    const { suggestPattern } = await import('../src/index.js');
    const op = virement(euros(600), { label: 'VIREMENT PERMANENT VERS CPT EPARGNE 0123456789' });
    expect(orderFromTransfer(avec(budget(), op), 'op-vir', LECTURE, 'x')?.labelPattern).toBe(suggestPattern(op));
  });
});

describe('[niveau 2] #434 · 3. un montant corrigé', () => {
  it('la ventilation se recalcule pour le montant validé ; l’opération reste la première occurrence', () => {
    const l = avec(budget(), virement(euros(600)));
    const à500 = orderFromTransfer(l, 'op-vir', LECTURE, 'x', euros(500))!;
    expect(à500.amount).toBe(-euros(500));
    expect(à500.action?.allocation?.map((p) => [p.tirelireId, p.share])).toEqual([
      ['taxe', { kind: 'fixed', amount: -euros(400) }],
      ['vac', { kind: 'fixed', amount: -euros(100) }],
    ]);
    expect(à500.periodicity.anchorDate).toBe('2026-09-02');
    // Au-delà de ce que le budget demande, le reste n'a pas de part (D21).
    expect(orderFromTransfer(l, 'op-vir', LECTURE, 'x', euros(700))!.action?.allocation?.map((p) => p.share)).toEqual([
      { kind: 'fixed', amount: -euros(400) },
      { kind: 'fixed', amount: -euros(250) },
    ]);
    const { amount: _x, action: _y, ...r500 } = à500;
    const { amount: _z, action: _w, ...r600 } = orderFromTransfer(l, 'op-vir', LECTURE, 'x')!;
    expect(r500).toEqual(r600);
  });

  it('un montant nul ou négatif ne fait pas d’ordre', () => {
    const l = avec(budget(), virement(euros(600)));
    expect(orderFromTransfer(l, 'op-vir', LECTURE, 'x', 0)).toBeUndefined();
    expect(orderFromTransfer(l, 'op-vir', LECTURE, 'x', -euros(10))).toBeUndefined();
    expect(recordOrderFromTransfer(l, 'op-vir', LECTURE, 'x', 0)).toBeUndefined();
  });
});

async function base(l: Ledger): Promise<LedgerStore> {
  const s = await LedgerStore.create({ sqlJs: SQL, siteId: 'u3' });
  s.setSetting('periodStartDay', l.settings.periodStartDay);
  s.setSetting('orderRounding', l.settings.orderRounding);
  for (const a of l.accounts) s.upsert('accounts', a);
  for (const t of l.tirelires) s.upsert('tirelires', t);
  for (const n of l.needs) s.upsert('needs', n);
  for (const f of l.plannedFlows) s.upsert('plannedFlows', f);
  for (const o of l.operations) s.upsert('operations', o);
  for (const x of l.subOperations) s.upsert('subOperations', x);
  return s;
}

describe('[niveau 0] #434 · 4. rien ne s’écrit avant le geste (I10)', () => {
  it('calculer la proposition ne modifie ni le grand livre lu ni la base', async () => {
    const s = await base(avec(budget(), virement(euros(600))));
    const lu = s.load();
    const avant = structuredClone(lu);
    const baseAvant = JSON.stringify(s.load());
    orderFromTransfer(lu, 'op-vir', LECTURE, 'x');
    orderFromTransfer(lu, 'op-vir', LECTURE, 'x', euros(500));
    recordOrderFromTransfer(lu, 'op-vir', LECTURE, 'x');
    expect(lu).toEqual(avant);
    expect(JSON.stringify(s.load())).toBe(baseAvant);
    const op = s.load().operations.find((o) => o.id === 'op-vir')!;
    expect(op.plannedFlowId).toBeUndefined();
    expect(s.load().subOperations).toEqual([]);
    s.close();
  });
});

describe('[niveau 0] #434 · 5. enregistrer', () => {
  it('l’ordre, la reprise de sa première occurrence et les parts se relisent après un redémarrage', async () => {
    const l = avec(budget(), virement(euros(600)));
    const s = await base(l);
    const r = recordOrderFromTransfer(s.load(), 'op-vir', LECTURE, 'ordre-u3')!;
    s.upsert('plannedFlows', r.flow);
    for (const o of r.patch.operations) s.upsert('operations', o);
    for (const x of r.patch.subOperations) s.upsert('subOperations', x);
    const relu = (await LedgerStore.create({ sqlJs: SQL, siteId: 'u3', bytes: s.export() })).load();
    s.close();
    const flow = relu.plannedFlows.find((f) => f.id === 'ordre-u3')!;
    expect(flow).toEqual(r.flow);
    const op = relu.operations.find((o) => o.id === 'op-vir')!;
    expect([op.plannedFlowId, op.plannedDate, op.state, op.transferAccountId]).toEqual(['ordre-u3', '2026-09-02', 'reconciled', LIVRET]);
    expect(relu.subOperations.filter((x) => x.operationId === 'op-vir').map((x) => [x.tirelireId, x.share])).toEqual([
      ['taxe', { kind: 'fixed', amount: -euros(400) }],
      ['vac', { kind: 'fixed', amount: -euros(200) }],
    ]);
  });

  it('une opération verrouillée le reste, et garde sa ventilation si elle en porte une', () => {
    const l = avec(budget(), virement(euros(600), { state: 'locked' }));
    l.subOperations.push({ id: 's1', operationId: 'op-vir', tirelireId: 'vac', share: { kind: 'variable' } });
    const r = recordOrderFromTransfer(l, 'op-vir', LECTURE, 'ordre-u3')!;
    expect(r.patch.operations.map((o) => o.state)).toEqual(['locked']);
    expect(r.patch.subOperations).toEqual([]);
    expect(r.patch.removedSubOperations ?? []).toEqual([]);
  });

  it('pour un montant corrigé, l’opération prend les parts de l’ordre ; le reste est non affecté (D21, D29)', () => {
    const { ledger } = enregistrer(avec(budget(), virement(euros(600))), 'op-vir', euros(500));
    const idx = indexLedger(ledger);
    expect(unallocatedAmount(ledger.operations.find((o) => o.id === 'op-vir')!, idx)).toBe(-euros(100));
  });
});

describe('[niveau 1] #434 · 6. le livre de compte tient (I2, D19)', () => {
  const verifier = (ledger: Ledger, nonAffecteDuVirement: number) => {
    const idx = indexLedger(ledger);
    for (const a of idx.accountsById.values()) expect(componentsOnAccount(a, idx, '2026-09-30') + unallocated(a, ledger, idx, '2026-09-30'), a.id).toBe(accountBalance(a, ledger, '2026-09-30'));
    // Chaque tirelire d'une part a reçu cette part sur le compte d'accueil, en plus de ce qu'elle y avait.
    const sans = indexLedger({ ...ledger, subOperations: ledger.subOperations.filter((x) => x.operationId !== 'op-vir') });
    for (const [t, part] of [['taxe', euros(400)], ['vac', euros(200)]] as const)
      expect((tirelireComponents(idx.tireliresById.get(t)!, idx, '2026-09-30').get(LIVRET) ?? 0) - (tirelireComponents(sans.tireliresById.get(t)!, sans, '2026-09-30').get(LIVRET) ?? 0), t).toBe(part);
    expect(unallocatedAmount(ledger.operations.find((o) => o.id === 'op-vir')!, idx)).toBe(nonAffecteDuVirement);
  };

  it('sans le relevé du compte d’accueil', () => {
    verifier(enregistrer(avec(budget(), virement(euros(600)))).ledger, 0);
  });

  it('avec le crédit apparié sur le compte d’accueil', () => {
    const debit = virement(euros(600), { state: 'untreated' });
    delete debit.transferAccountId;
    const credit: Operation = { id: 'op-credit', accountId: LIVRET, origin: 'imported', date: '2026-09-03', label: 'VIR RECU', normalizedLabel: 'VIR RECU', amount: euros(600), state: 'untreated' };
    const l = avec(budget(), debit, credit);
    const { ledger } = enregistrer(applyPatchToLedger(l, pairInternalTransfers(l)));
    verifier(ledger, 0);
    // Le relevé du livret dit 600 € : tout est dans ses tirelires, rien n'y reste non affecté.
    const idx = indexLedger(ledger);
    const a = idx.accountsById.get(LIVRET)!;
    expect([accountBalance(a, ledger, '2026-09-30'), unallocated(a, ledger, idx, '2026-09-30')]).toEqual([euros(600), 0]);
  });
});

describe('[niveau 0] #434 · 7. le plan ne réécrit pas l’ordre fait d’un virement (D60, I10)', () => {
  it('ni son montant ni ses parts, l’écart signalé ou non', () => {
    for (const pas of [euros(10), euros(50)]) {
      const { ledger } = enregistrer(avec(budget(pas), virement(euros(600))));
      const avant = structuredClone(ledger.plannedFlows.find((f) => f.id === 'ordre-u3')!);
      computePlan(ledger, LECTURE);
      computePlan(ledger, '2026-10-06');
      expect(ledger.plannedFlows.find((f) => f.id === 'ordre-u3'), `pas ${pas}`).toEqual(avant);
    }
  });
});

describe('[niveau 2] #434 · 7. un ordre comme les autres', () => {
  it('le plan signale l’écart de 50 € avec un pas de 10 €, pas avec un pas de 50 € (D60)', () => {
    for (const [pas, signale] of [[euros(10), true], [euros(50), false]] as const) {
      const { ledger } = enregistrer(avec(budget(pas), virement(euros(600))));
      const t = livret(ledger);
      expect(t.bankOrder?.flowId).toBe('ordre-u3');
      expect(t.bankOrder?.drift).toBe(euros(50));
      expect(t.bankOrder?.signaled, `pas ${pas}`).toBe(signale);
      // Les parts fixes : la taxe reçoit ce qu'on lui demande, l'objectif 50 € de moins.
      expect(t.bankOrder?.parts.map((p) => [p.tirelireId, p.drift, p.signaled])).toEqual([
        ['taxe', 0, false],
        ['vac', euros(50), signale],
      ]);
      expect(computePlan(ledger, LECTURE).warnings.filter((w) => w.code === 'bankOrderDrift')).toHaveLength(signale ? 1 : 0);
    }
  });

  it('la ligne du mois suivant, même libellé, même montant, est reprise sans confirmation et prend ses parts (D12)', () => {
    const { ledger } = enregistrer(avec(budget(), virement(euros(600))));
    const suivant = virement(euros(600), { id: 'op-oct', date: '2026-10-02', state: 'untreated' });
    delete suivant.transferAccountId;
    let l = avec(ledger, suivant);
    l = applyPatchToLedger(l, matchTirelireTransfers(l));
    expect(l.operations.find((o) => o.id === 'op-oct')!.transferAccountId).toBe(LIVRET);
    const m = proposeMatches(l, '2026-09-28', '2026-10-27').find((p) => p.operationId === 'op-oct')!;
    expect([m.flowId, m.expectedDate, m.auto]).toEqual(['ordre-u3', '2026-10-02', true]);
    const l2 = applyPatchToLedger(l, applyMatch(l, m));
    expect(l2.subOperations.filter((x) => x.operationId === 'op-oct').map((x) => [x.tirelireId, x.share])).toEqual([
      ['taxe', { kind: 'fixed', amount: -euros(400) }],
      ['vac', { kind: 'fixed', amount: -euros(200) }],
    ]);
  });

  it('un virement déjà importé à une occurrence suivante se propose ; un virement d’avant l’opération, non', () => {
    const après = virement(euros(620), { id: 'op-nov', date: '2026-11-03' });
    const avant = virement(euros(600), { id: 'op-aout', date: '2026-08-02' });
    const { ledger } = enregistrer(avec(budget(), virement(euros(600)), après, avant));
    const props = proposeMatches(ledger, '2026-07-01', '2026-12-31');
    expect(props.filter((p) => p.flowId === 'ordre-u3').map((p) => [p.operationId, p.expectedDate])).toEqual([['op-nov', '2026-11-02']]);
  });
});
