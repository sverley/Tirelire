/**
 * Harnais d'audit de #456 — faire d'une opération le flux prévu que l'historique propose, et repérer
 * les séries qui se répètent (cœur). Chaque `describe` reprend un point du « Fait quand » sous son
 * numéro, et son niveau (D83).
 *
 * Composé après le codage (auditeur.md, étape 2), parmi les tests du codeur
 * (`flux-depuis-operations.test.ts`, déplacé ici en entier). Sont de moi, au niveau 0 : l'opération
 * qui reprend déjà quelque chose ne propose rien, ne fonde ni série ni occurrence, et un
 * enregistrement qui la désigne n'écrit rien, pas même pour les autres (points 1, 3, 6 et 8, D88) ;
 * l'opération verrouillée qui le reste, et celle qui porte sa ventilation qui la garde, lue contre une
 * copie prise avant (point 8, D22) ; le plan qui ne réécrit pas l'ordre fait d'une série, lu contre
 * une copie prise avant, à deux dates et pour deux pas d'arrondi (point 10, D60, I10). Au niveau 1 :
 * le repérage, la proposition et l'enregistrement sur une base sans budget, ni tirelire, ni catégorie
 * (point 7, I3). Le redémarrage (point 8) et I10 (point 9) sont au niveau 0, I2 (point 11) au
 * niveau 1, comme dans le harnais de #434 ; la durée (point 12) au niveau 3 ; le reste au niveau 2.
 * Au second tour, les tests du codeur sur l'ancrage — la date de l'occurrence que reprend la plus
 * ancienne opération désignée, non celle de l'opération, et le bord du 31 (point 8) ; la série
 * reconnue par un flux ancré sur une occurrence plus ancienne (point 10) — sont déplacés ici en
 * entier, au niveau 2 de leur point.
 *
 * Données inventées : un compte principal, un Livret A, un compte joint. Le budget, quand il y en a un,
 * place deux tirelires sur le livret — une échéance (400 €/mois) et un objectif (250 €/mois) : il y
 * demande 650 €. Lecture le 6 septembre 2026, période du 28 août au 27 septembre.
 */
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  applyPatchToLedger,
  canBecomeFlow,
  componentsOnAccount,
  computePlan,
  detectSeries,
  emptyLedger,
  euros,
  flowFromOperations,
  historyOccurrences,
  indexLedger,
  LedgerStore,
  normalizeLabel,
  orderFromTransfer,
  acceptInternalTransfer,
  proposeMatches,
  recordFlowFromOperations,
  recordOrderFromTransfer,
  rhythmKnown,
  runPipeline,
  suggestPattern,
  tirelireComponents,
  unallocated,
  withPlannedOperations,
  type Ledger,
  type Operation,
  type PlannedFlow,
  type ProposedFlow,
  type SubOperation,
} from '../src/index.js';

const SQL = await initSqlJs();
const CC = 'acc-principal';
const LIVRET = 'livret';
const JOINT = 'joint';
const LECTURE = '2026-09-06';
const EDF = 'PRELEVEMENT EUROPEEN EDF ELEC CLIENT 4521';
const SALAIRE = 'VIR SEPA RECU SALAIRE ACME';
const EPARGNE = 'VIR SEPA EPARGNE LIVRET A M DUPONT';

function comptes(): Ledger {
  const l = emptyLedger({ periodStartDay: 28, orderRounding: euros(10) });
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(3000), openingDate: '2025-01-01' },
    { id: LIVRET, name: 'Livret A', kind: 'epargne', openingBalance: 0, openingDate: '2025-01-01' },
    { id: JOINT, name: 'Compte joint', kind: 'courant', openingBalance: 0, openingDate: '2025-01-01' },
  );
  l.categories.push({ id: 'energie', name: 'Énergie', nature: 'expense' }, { id: 'revenus', name: 'Revenus', nature: 'income' });
  return l;
}

function budget(): Ledger {
  const l = comptes();
  l.tirelires.push(
    { id: 'taxe', name: 'Taxe', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01' },
    { id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01' },
  );
  l.needs.push(
    { id: 'n-taxe', tirelireId: 'taxe', kind: 'dueDate', amount: euros(4800), periodicity: { interval: 12, unit: 'month', anchorDate: '2027-08-15' }, priority: 10 },
    { id: 'n-vac', tirelireId: 'vac', kind: 'goal', amount: euros(9000), monthlyAmount: euros(250), priority: 30 },
  );
  return l;
}

function op(id: string, date: string, label: string, amount: number, o: Partial<Operation> = {}): Operation {
  return { id, accountId: CC, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated', ...o };
}
const vir = (id: string, date: string, montant: number, o: Partial<Operation> = {}) => op(id, date, EPARGNE, -montant, { state: 'reconciled', transferAccountId: LIVRET, ...o });
const avec = (l: Ledger, ...ops: Operation[]): Ledger => ({ ...l, operations: [...l.operations, ...ops] });
const ventile = (l: Ledger, ...subs: SubOperation[]): Ledger => ({ ...l, subOperations: [...l.subOperations, ...subs] });
const ids = (ops: Operation[]) => ops.map((o) => o.id);
const proposer = (l: Ledger, opIds: string[], id = 'f') => flowFromOperations(l, opIds, LECTURE, id);
/** Les séries d'un historique de prélèvements EDF aux dates données. */
const series = (dates: string[], montant = euros(80)) => detectSeries(avec(comptes(), ...dates.map((d, i) => op(`e${i}`, d, EDF, -montant))), LECTURE);

describe('[niveau 2] #456 · 1. l’opération dont on fait un flux', () => {
  it('bancaire, vivante, sans reprise : son compte, son sens et son état n’y changent rien', () => {
    for (const o of [op('a', '2026-03-05', EDF, -euros(80)), op('a', '2026-03-05', SALAIRE, euros(2500), { state: 'locked' }), op('a', '2026-03-05', EDF, -euros(80), { accountId: JOINT, state: 'reconciled' })])
      expect(canBecomeFlow(avec(comptes(), o), 'a'), o.label).toBe(true);
  });

  it('rien pour une saisie, une opération supprimée, ni un libellé sans motif (l’opération qui reprend déjà quelque chose : niveau 0, plus bas)', () => {
    const l = comptes();
    for (const o of [
      op('a', '2026-03-05', EDF, -euros(80), { origin: 'manual' }),
      op('a', '2026-03-05', EDF, -euros(80), { deletedAt: '2026-03-06' }),
      op('a', '2026-03-05', '12 34', -euros(80)),
    ]) {
      expect(canBecomeFlow(avec(l, o), 'a'), JSON.stringify(o)).toBe(false);
      expect(proposer(avec(l, o), ['a'])).toBeUndefined();
    }
  });

  it('un virement interne : seulement le débit du principal vers un compte d’accueil sans ordre vivant (#434, point 1)', () => {
    const l = comptes();
    expect(canBecomeFlow(avec(l, vir('v', '2026-03-02', euros(600))), 'v')).toBe(true);
    // Le crédit apparié du compte d'accueil, et un virement depuis un autre compte que le principal.
    expect(canBecomeFlow(avec(l, op('v', '2026-03-02', 'VIR RECU', euros(600), { accountId: LIVRET, transferAccountId: CC })), 'v')).toBe(false);
    expect(canBecomeFlow(avec(l, op('v', '2026-03-02', 'VIR JOINT LIVRET', -euros(600), { accountId: JOINT, transferAccountId: LIVRET })), 'v')).toBe(false);
    // Vers un compte qui a déjà un ordre vivant : c'est #25.
    const avecOrdre = { ...l, plannedFlows: [{ id: 'o', name: 'Virement Livret A', kind: 'transfer' as const, amount: -euros(500), accountId: CC, counterpartAccountId: LIVRET, periodicity: { interval: 1, unit: 'month' as const, anchorDate: '2026-01-02' }, dateWindowDays: 5 }] };
    expect(canBecomeFlow(avec(avecOrdre, vir('v', '2026-03-02', euros(600))), 'v')).toBe(false);
  });

  it('plusieurs opérations : du même compte, du même sens, toutes des virements vers un même compte ou aucune, et un même motif ; sinon rien', () => {
    const l = avec(
      comptes(),
      op('a', '2026-03-05', EDF, -euros(80)),
      op('b', '2026-04-05', EDF, -euros(82)),
      op('c', '2026-04-05', EDF, -euros(82), { accountId: JOINT }),
      op('d', '2026-04-05', 'REMBOURSEMENT EDF ELEC', euros(10)),
      op('e', '2026-04-05', 'CARTE X1234 AUCHAN', -euros(40)),
      vir('v', '2026-04-02', euros(600)),
    );
    expect(proposer(l, ['a', 'b'])?.flow.labelPattern).toBe('EDF.*ELEC');
    for (const sel of [['a', 'c'], ['a', 'd'], ['a', 'e'], ['a', 'v'], ['a', 'inconnue']]) expect(proposer(l, sel), sel.join()).toBeUndefined();
  });

  it('des libellés qui proposent des motifs différents : le motif commun d’une sélection (D26), qui les reconnaît toutes, et un rythme inconnu', () => {
    const l = avec(comptes(), op('a', '2026-03-05', EDF, -euros(80)), op('b', '2026-04-05', 'PRELEVEMENT EUROPEEN EDF GAZ CLIENT 4521', -euros(30)), op('c', '2026-05-05', EDF, -euros(80)));
    const p = proposer(l, ['a', 'b', 'c'])!;
    expect([p.flow.labelPattern, p.flow.name, rhythmKnown(p.flow)]).toEqual(['PRELEVEMENT.*EUROPEEN.*EDF', 'PRELEVEMENT EUROPEEN EDF', false]);
  });
});

describe('[niveau 0] #456 · 1, 3, 6 et 8. une opération qui reprend déjà quelque chose ne propose ni ne fonde rien, et son enregistrement n’efface rien (D88)', () => {
  it('ni l’occurrence d’un flux, ni une saisie ne se perdent', () => {
    const flux: PlannedFlow = { id: 'f', name: 'EDF ELEC', kind: 'fixedCharge', amount: -euros(80), accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-03-05' }, dateWindowDays: 5, labelPattern: 'EDF.*ELEC' };
    const cas: Array<[string, Partial<Operation>]> = [
      ['reprend une occurrence', { plannedFlowId: 'pf', plannedDate: '2026-04-05', state: 'reconciled' }],
      ['reprend une saisie', { resumedOperationId: 'saisie' }],
    ];
    for (const [nom, reprise] of cas) {
      const l = avec(comptes(), op('saisie', '2026-04-04', 'SAISIE FACTURE', -euros(80), { origin: 'manual' }), op('e0', '2026-03-05', EDF, -euros(80)), op('a', '2026-04-05', EDF, -euros(80), reprise), op('e2', '2026-05-05', EDF, -euros(80)));
      l.plannedFlows.push({ ...flux, id: 'pf', labelPattern: 'AUTRE' });
      expect(canBecomeFlow(l, 'a'), nom).toBe(false);
      expect(proposer(l, ['a']), nom).toBeUndefined();
      expect(proposer(l, ['e0', 'a']), nom).toBeUndefined();
      // Comptée, elle ferait des trois une série mensuelle.
      expect(detectSeries(l, LECTURE), nom).toEqual([]);
      expect(ids(historyOccurrences(l, flux, []).map((o) => o.operation)), nom).toEqual(['e0', 'e2']);
      // Rien ne s'enregistre : la reprise qu'elle porte ne s'efface pas.
      expect(recordFlowFromOperations(l, flux, ['a']), nom).toBeUndefined();
      expect(recordFlowFromOperations(l, flux, ['e0', 'a', 'e2']), nom).toBeUndefined();
    }
  });
});

describe('[niveau 2] #456 · 2. le flux proposé', () => {
  it('compte, genre, motif qui la reconnaît, nom tiré du libellé, sans période de validité ni automatisme à côté', () => {
    const l = avec(comptes(), op('a', '2026-03-05', EDF, -euros(80), { accountId: JOINT }), op('s', '2026-03-28', SALAIRE, euros(2500)));
    const charge = proposer(l, ['a'])!.flow;
    expect([charge.accountId, charge.kind, charge.amount, charge.labelPattern, charge.name]).toEqual([JOINT, 'fixedCharge', -euros(80), suggestPattern(l.operations[0]!), 'EDF ELEC']);
    expect(new RegExp(charge.labelPattern!, 'i').test(l.operations[0]!.normalizedLabel)).toBe(true);
    expect(charge.activeFrom).toBeUndefined();
    expect(charge.activeTo).toBeUndefined();
    expect(proposer(l, ['s'])!.flow.kind).toBe('income');
    // Le flux est l'automatisme (D24) : la proposition ne porte rien d'autre.
    expect(Object.keys(proposer(l, ['a'])!).sort()).toEqual(['flow', 'founders', 'operations']);
  });

  it('la ventilation que l’opération porte, part pour part ; aucune si elle n’en porte pas, ni la catégorie que la banque suggère', () => {
    const base = avec(comptes(), op('a', '2026-03-05', EDF, -euros(80), { suggestedCategory: 'Énergie' }));
    expect(proposer(base, ['a'])!.flow.action).toBeUndefined();
    const l = ventile(base, { id: 's1', operationId: 'a', categoryId: 'energie', share: { kind: 'fixed', amount: -euros(60) } }, { id: 's2', operationId: 'a', categoryId: 'energie', tirelireId: 'vac', share: { kind: 'variable' } }, { id: 's3', operationId: 'a', parentId: 's1', share: { kind: 'variable' } });
    expect(proposer(l, ['a'])!.flow.action).toEqual({
      allocation: [
        { categoryId: 'energie', share: { kind: 'fixed', amount: -euros(60) } },
        { categoryId: 'energie', tirelireId: 'vac', share: { kind: 'variable' } },
      ],
    });
  });

  it('pour plusieurs opérations, la ventilation que portent toutes, la même ; sinon aucune', () => {
    const l = avec(comptes(), op('a', '2026-03-05', EDF, -euros(80)), op('b', '2026-04-05', EDF, -euros(80)));
    const meme = ventile(l, { id: 's1', operationId: 'a', categoryId: 'energie', share: { kind: 'variable' } }, { id: 's2', operationId: 'b', categoryId: 'energie', share: { kind: 'variable' } });
    expect(proposer(meme, ['a', 'b'])!.flow.action).toEqual({ allocation: [{ categoryId: 'energie', share: { kind: 'variable' } }] });
    const une = ventile(l, { id: 's1', operationId: 'a', categoryId: 'energie', share: { kind: 'variable' } });
    expect(proposer(une, ['a', 'b'])!.flow.action).toBeUndefined();
  });
});

describe('[niveau 2] #456 · 3. la périodicité proposée par constat', () => {
  const ecart = (dates: string[]) => series(dates).map((s) => [ids(s.operations).length, s.gap.interval, s.gap.unit]);

  it('les exemples du « Fait quand »', () => {
    expect(ecart(['2026-03-05', '2026-04-05', '2026-05-07'])).toEqual([[3, 1, 'month']]);
    expect(ecart(['2026-01-31', '2026-02-28', '2026-03-31'])).toEqual([[3, 1, 'month']]);
    expect(ecart(['2026-03-05', '2026-04-05'])).toEqual([]);
    expect(ecart(['2026-03-01', '2026-03-31', '2026-05-15'])).toEqual([]);
    expect(ecart(['2025-03-10', '2026-03-12'])).toEqual([[2, 1, 'year']]);
    expect(ecart(['2026-03-05', '2026-04-05', '2026-05-10'])).toEqual([[3, 1, 'month']]);
    expect(ecart(['2026-03-05', '2026-04-05', '2026-05-11'])).toEqual([]);
  });

  it('la semaine à 1 jour près, le trimestre à 5 jours', () => {
    expect(ecart(['2026-03-02', '2026-03-09', '2026-03-17'])).toEqual([[3, 1, 'week']]);
    expect(ecart(['2026-03-02', '2026-03-09', '2026-03-18'])).toEqual([]);
    expect(ecart(['2026-01-15', '2026-04-18', '2026-07-12'])).toEqual([[3, 3, 'month']]);
  });

  it('la suite la plus longue l’emporte, et chaque opération fonde au plus une série', () => {
    expect(ecart(['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05'])).toEqual([[6, 1, 'month']]);
  });

  it('un intrus ou un trou coupe la série ; une série interrompue en donne deux', () => {
    expect(ecart(['2026-03-05', '2026-03-20', '2026-04-05', '2026-05-05'])).toEqual([]);
    expect(ecart(['2026-01-05', '2026-02-05', '2026-03-05', '2026-05-05', '2026-06-05', '2026-07-05'])).toEqual([
      [3, 1, 'month'],
      [3, 1, 'month'],
    ]);
  });

  it('une opération ponctuelle ne fonde pas de série, et la coupe ; une saisie de même motif aussi', () => {
    const l = avec(comptes(), ...['2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05'].map((d, i) => op(`e${i}`, d, EDF, -euros(80), i === 1 ? { oneOff: true } : {})));
    expect(detectSeries(l, LECTURE)).toEqual([]);
    const saisie = avec(comptes(), ...['2026-03-05', '2026-04-05', '2026-05-05'].map((d, i) => op(`e${i}`, d, EDF, -euros(80), i === 1 ? { origin: 'manual' } : {})));
    expect(detectSeries(saisie, LECTURE)).toEqual([]);
  });

  it('un virement interne ne fonde une série que s’il peut devenir un ordre', () => {
    const credits = ['2026-03-02', '2026-04-02', '2026-05-02'].map((d, i) => op(`c${i}`, d, 'VIR RECU EPARGNE LIVRET', euros(600), { accountId: LIVRET, transferAccountId: CC }));
    expect(detectSeries(avec(comptes(), ...credits), LECTURE)).toEqual([]);
    const debits = ['2026-03-02', '2026-04-02', '2026-05-02'].map((d, i) => vir(`v${i}`, d, euros(600)));
    expect(detectSeries(avec(comptes(), ...debits), LECTURE).map((s) => s.flow.kind)).toEqual(['transfer']);
  });

  it('fondé par une série, le flux en prend le rythme et la fenêtre ; sans série, rythme inconnu et 5 jours ; un ordre, mensuel', () => {
    const hebdo = avec(comptes(), ...['2026-03-02', '2026-03-09', '2026-03-16'].map((d, i) => op(`h${i}`, d, 'CARTE X1234 BOULANGERIE DUPAIN', -euros(12))));
    const f = proposer(hebdo, ['h1'])!.flow;
    expect([f.periodicity, f.dateWindowDays]).toEqual([{ interval: 1, unit: 'week', anchorDate: '2026-03-02' }, 1]);
    const seule = proposer(avec(comptes(), op('a', '2026-03-05', EDF, -euros(80))), ['a'])!.flow;
    expect([rhythmKnown(seule), seule.periodicity, seule.dateWindowDays]).toEqual([false, { anchorDate: '2026-03-05' }, 5]);
    const ordre = proposer(avec(comptes(), vir('v', '2026-03-02', euros(600))), ['v'])!.flow;
    expect([rhythmKnown(ordre), ordre.periodicity]).toEqual([true, { interval: 1, unit: 'month', anchorDate: '2026-03-02' }]);
  });

  it('des opérations désignées hors d’une même série : rythme inconnu', () => {
    const l = avec(comptes(), ...['2026-01-05', '2026-02-05', '2026-03-05', '2026-05-05', '2026-06-05', '2026-07-05'].map((d, i) => op(`e${i}`, d, EDF, -euros(80))));
    expect(rhythmKnown(proposer(l, ['e0', 'e1'])!.flow)).toBe(true);
    expect(rhythmKnown(proposer(l, ['e2', 'e3'])!.flow)).toBe(false);
  });
});

describe('[niveau 2] #456 · 4. le montant et la tolérance', () => {
  const flux = (montants: number[]) => detectSeries(avec(comptes(), ...montants.map((m, i) => op(`e${i}`, `2026-0${3 + i}-05`, EDF, -m))), LECTURE)[0]!.flow;

  it('tous égaux au centime : fixe, à ce montant, de son signe, sans tolérance ni marque « variable »', () => {
    const f = flux([euros(80), euros(80), euros(80)]);
    expect([f.amount, f.amountTolerance, f.variable]).toEqual([-euros(80), undefined, undefined]);
  });

  it('différents : variable, à la moyenne au centime, avec la plus petite tolérance par pas de 10 % qui les reconnaît tous', () => {
    const a = flux([euros(100), euros(110), euros(120)]);
    expect([a.amount, a.amountTolerance, a.variable]).toEqual([-euros(110), { pct: 10 }, true]);
    const b = flux([euros(80), euros(100), euros(150)]);
    expect([b.amount, b.amountTolerance]).toEqual([-euros(110), { pct: 40 }]);
    const c = flux([10000, 10000, 10001]);
    expect([c.amount, c.amountTolerance, c.variable]).toEqual([-10000, { pct: 10 }, true]);
  });
});

describe('[niveau 2] #456 · 5. l’ordre permanent', () => {
  it('un virement qu’aucune série ne fonde, vers un compte où le budget demande un ordre : l’ordre de #434, en tout point', () => {
    const l = avec(budget(), vir('op-vir', '2026-09-02', euros(600)));
    expect(proposer(l, ['op-vir'], 'x')!.flow).toEqual(orderFromTransfer(l, 'op-vir', LECTURE, 'x'));
    expect(flowFromOperations(l, ['op-vir'], LECTURE, 'x', euros(500))!.flow).toEqual(orderFromTransfer(l, 'op-vir', LECTURE, 'x', euros(500)));
  });

  it('sans budget (U4), ou vers un compte où le budget ne demande rien : l’ordre se fait quand même, ventilé comme l’opération', () => {
    const l = ventile(avec(comptes(), vir('v', '2026-03-02', euros(600))), { id: 's', operationId: 'v', tirelireId: 'vac', share: { kind: 'variable' } });
    const f = proposer(l, ['v'])!.flow as PlannedFlow;
    expect([f.kind, f.accountId, f.counterpartAccountId, f.amount, f.name, f.dateWindowDays, f.amountTolerance]).toEqual(['transfer', CC, LIVRET, -euros(600), 'Virement Livret A', 5, { pct: 20 }]);
    expect(f.action).toEqual({ allocation: [{ tirelireId: 'vac', share: { kind: 'variable' } }] });
    const joint = proposer(avec(budget(), vir('v', '2026-03-02', euros(600), { transferAccountId: JOINT })), ['v'])!.flow;
    expect([joint.counterpartAccountId, joint.action]).toEqual([JOINT, undefined]);
  });

  it('l’un d’une série : son rythme, son montant et sa marque « variable », la tolérance du point 4 si elle est plus large', () => {
    const l = avec(comptes(), vir('v1', '2026-01-02', euros(500)), vir('v2', '2026-04-02', euros(700)), vir('v3', '2026-07-02', euros(900)));
    const f = proposer(l, ['v2'])!.flow as PlannedFlow;
    expect([f.periodicity, f.amount, f.variable, f.amountTolerance]).toEqual([{ interval: 3, unit: 'month', anchorDate: '2026-01-02' }, -euros(700), true, { pct: 30 }]);
  });

  it('vers un compte où le budget demande un ordre, ventilé comme le plan le propose pour ce montant, recalculé pour un montant corrigé', () => {
    const l = avec(budget(), vir('v1', '2026-07-02', euros(600)), vir('v2', '2026-08-02', euros(600)), vir('v3', '2026-09-02', euros(600)));
    const f = proposer(l, ['v3'])!.flow;
    expect(f.action).toEqual({
      allocation: [
        { tirelireId: 'taxe', share: { kind: 'fixed', amount: -euros(400) } },
        { tirelireId: 'vac', share: { kind: 'fixed', amount: -euros(200) } },
      ],
    });
    expect(flowFromOperations(l, ['v3'], LECTURE, 'f', euros(450))!.flow.action).toEqual({
      allocation: [
        { tirelireId: 'taxe', share: { kind: 'fixed', amount: -euros(400) } },
        { tirelireId: 'vac', share: { kind: 'fixed', amount: -euros(50) } },
      ],
    });
  });
});

/** Un historique de paie du 25 : une série d'août à novembre, la paie du 19 décembre qui l'interrompt, une autre de janvier à mars. */
function paies(): Ledger {
  const dates = ['2025-07-25', '2025-08-10', '2025-08-25', '2025-09-25', '2025-10-24', '2025-11-25', '2025-12-19', '2026-01-26', '2026-02-25', '2026-03-25'];
  return avec(comptes(), ...dates.map((d, i) => op(`p${i}`, d, SALAIRE, euros(2500))));
}

describe('[niveau 2] #456 · 6. les occurrences', () => {
  it('la série interrompue : le flux de la première reconnaît, avant comme après, ce qui tombe sur ses dates ; la paie du 19 décembre n’en est pas', () => {
    const l = paies();
    expect(detectSeries(l, LECTURE).map((s) => ids(s.operations))).toEqual([
      ['p2', 'p3', 'p4', 'p5'],
      ['p7', 'p8', 'p9'],
    ]);
    const { flow } = proposer(l, ['p3'])!;
    const occ = historyOccurrences(l, flow, ['p3']);
    expect(occ.map((o) => [o.operation.id, o.expectedDate, o.days, o.gap, o.designated])).toEqual([
      ['p0', '2025-07-25', 0, 0, false],
      ['p2', '2025-08-25', 0, 0, false],
      ['p3', '2025-09-25', 0, 0, true],
      ['p4', '2025-10-25', 1, 0, false],
      ['p5', '2025-11-25', 0, 0, false],
      ['p7', '2026-01-25', 1, 0, false],
      ['p8', '2026-02-25', 0, 0, false],
      ['p9', '2026-03-25', 0, 0, false],
    ]);
  });

  it('le flux corrigé : sa fenêtre, son montant ; les opérations désignées restent proposées', () => {
    const l = paies();
    const { flow } = proposer(l, ['p3'])!;
    expect(historyOccurrences(l, { ...flow, dateWindowDays: 6 }, []).map((o) => o.operation.id)).toContain('p6');
    const autre = historyOccurrences(l, { ...flow, amount: euros(3000) }, ['p3']);
    expect(autre.map((o) => [o.operation.id, o.expectedDate, o.gap])).toEqual([['p3', '2025-09-25', -euros(500)]]);
  });

  it('une opération pour une date, une date pour une opération : les plus proches', () => {
    const l = avec(paies(), op('q', '2026-01-24', SALAIRE, euros(2500)));
    const occ = historyOccurrences(l, proposer(l, ['p3'])!.flow, []);
    expect(occ.filter((o) => o.expectedDate === '2026-01-25').map((o) => o.operation.id)).toEqual(['q']);
    expect(occ.map((o) => o.operation.id)).not.toContain('p7');
  });

  it('au rythme inconnu, les opérations désignées sont les seules ; aucune n’est reprise d’office', () => {
    const l = avec(comptes(), op('a', '2026-03-05', EDF, -euros(80)), op('b', '2026-04-05', EDF, -euros(80)), op('c', '2026-08-05', EDF, -euros(80)));
    const { flow } = proposer(l, ['a', 'b'])!;
    expect(rhythmKnown(flow)).toBe(false);
    expect(historyOccurrences(l, flow, ['a', 'b']).map((o) => [o.operation.id, o.expectedDate])).toEqual([
      ['a', undefined],
      ['b', undefined],
    ]);
    // Le rythme donné, la sélection reconnaît l'opération d'août.
    expect(historyOccurrences(l, { ...flow, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-03-05' } }, ['a', 'b']).map((o) => o.operation.id)).toEqual(['a', 'b', 'c']);
    expect(l.operations.every((o) => !o.plannedFlowId)).toBe(true);
  });
});

describe('[niveau 2] #456 · 7. le repérage', () => {
  it('chaque série avec ses opérations dans l’ordre des dates, et le flux qu’elle deviendrait : celui d’une opération de la série, sa ventilation exceptée', () => {
    const l = ventile(avec(comptes(), ...['2026-05-05', '2026-03-05', '2026-04-06'].map((d, i) => op(`e${i}`, d, EDF, -euros(80)))), { id: 's', operationId: 'e2', categoryId: 'energie', share: { kind: 'variable' } });
    const [s] = detectSeries(l, LECTURE);
    expect(ids(s!.operations)).toEqual(['e1', 'e2', 'e0']);
    expect(s!.flow.action).toBeUndefined();
    const { flow } = proposer(l, ['e2'], s!.flow.id)!;
    expect(flow.action).toEqual({ allocation: [{ categoryId: 'energie', share: { kind: 'variable' } }] });
    const { action: _a, ...sansVentilation } = flow;
    expect(sansVentilation).toEqual(s!.flow);
    expect(proposer(l, ids(s!.operations), s!.flow.id)!.flow).toEqual(s!.flow);
  });

  it('les opérations qu’un flux reprend déjà ne fondent aucune série', () => {
    const l = comptes();
    l.plannedFlows.push({ id: 'pf', name: 'EDF', kind: 'fixedCharge', amount: -euros(80), accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-03-05' }, dateWindowDays: 5 });
    const ops = ['2026-03-05', '2026-04-05', '2026-05-05'].map((d, i) => op(`e${i}`, d, EDF, -euros(80), { plannedFlowId: 'pf', plannedDate: d, state: 'reconciled' }));
    expect(detectSeries(avec(l, ...ops), LECTURE)).toEqual([]);
  });

  it('le même historique rend la même liste, dans le même ordre ; vide sans opération', () => {
    const ops = [
      ...['2026-03-05', '2026-04-05', '2026-05-05'].map((d, i) => op(`e${i}`, d, EDF, -euros(80))),
      ...['2026-02-28', '2026-03-28', '2026-04-28'].map((d, i) => op(`s${i}`, d, SALAIRE, euros(2500))),
      ...['2026-03-02', '2026-04-02', '2026-05-02'].map((d, i) => vir(`v${i}`, d, euros(600))),
    ];
    const a = detectSeries(avec(comptes(), ...ops), LECTURE);
    const b = detectSeries(avec(comptes(), ...[...ops].reverse()), LECTURE);
    expect(a).toEqual(b);
    expect(a.map((s) => s.operations[0]!.id)).toEqual(['s0', 'v0', 'e0']);
    expect(detectSeries(comptes(), LECTURE)).toEqual([]);
    expect(detectSeries(emptyLedger(), LECTURE)).toEqual([]);
  });

  it('[niveau 1] sans budget, ni tirelire, ni catégorie (U4, U5 ; I3) : le repérage, la proposition et l’enregistrement tiennent, l’ordre compris', () => {
    const l = emptyLedger({ periodStartDay: 28, orderRounding: euros(10) });
    l.accounts.push({ id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(3000), openingDate: '2025-01-01' }, { id: LIVRET, name: 'Livret A', kind: 'epargne', openingBalance: 0, openingDate: '2025-01-01' });
    l.operations.push(...['2026-03-05', '2026-04-05', '2026-05-05'].map((d, i) => op(`e${i}`, d, EDF, -euros(80))), ...['2026-03-02', '2026-04-02', '2026-05-02'].map((d, i) => vir(`v${i}`, d, euros(600))));
    const trouvees = detectSeries(l, LECTURE);
    expect(trouvees.map((s) => [s.flow.kind, ids(s.operations), s.flow.action])).toEqual([
      ['transfer', ['v0', 'v1', 'v2'], undefined],
      ['fixedCharge', ['e0', 'e1', 'e2'], undefined],
    ]);
    const ordre = proposer(l, ['v1'])!.flow;
    expect([ordre.kind, ordre.counterpartAccountId, rhythmKnown(ordre)]).toEqual(['transfer', LIVRET, true]);
    const r = recordFlowFromOperations(l, ordre, ['v0', 'v1', 'v2'])!;
    expect(r.patch.operations.map((o) => [o.id, o.plannedFlowId])).toEqual([
      ['v0', 'f'],
      ['v1', 'f'],
      ['v2', 'f'],
    ]);
  });
});

/** Enregistre le flux et ses reprises, comme l'application l'écrira au geste. */
function enregistrer(l: Ledger, flow: ProposedFlow, reprises: string[]): { ledger: Ledger; flow: PlannedFlow } {
  const r = recordFlowFromOperations(l, flow, reprises);
  expect(r, 'rien à enregistrer').toBeDefined();
  return { ledger: applyPatchToLedger({ ...l, plannedFlows: [...l.plannedFlows, r!.flow] }, r!.patch), flow: r!.flow };
}

async function base(l: Ledger): Promise<LedgerStore> {
  const s = await LedgerStore.create({ sqlJs: SQL, siteId: 'u4' });
  s.setSetting('periodStartDay', l.settings.periodStartDay);
  s.setSetting('orderRounding', l.settings.orderRounding);
  for (const a of l.accounts) s.upsert('accounts', a);
  for (const c of l.categories) s.upsert('categories', c);
  for (const t of l.tirelires) s.upsert('tirelires', t);
  for (const n of l.needs) s.upsert('needs', n);
  for (const f of l.plannedFlows) s.upsert('plannedFlows', f);
  for (const o of l.operations) s.upsert('operations', o);
  for (const x of l.subOperations) s.upsert('subOperations', x);
  return s;
}

const edf = () => avec(comptes(), op('e0', '2026-02-03', EDF, -euros(80)), op('e1', '2026-03-05', EDF, -euros(80)), op('e2', '2026-04-05', EDF, -euros(80), { state: 'locked' }), op('e3', '2026-05-07', EDF, -euros(80)));

/** L'exemple du point 8 : la paie du 21 juin, puis les 25 août, 25 septembre, 29 octobre et 25 novembre. */
const paiesDuPoint8 = () =>
  avec(comptes(), ...['2025-06-21', '2025-08-25', '2025-09-25', '2025-10-29', '2025-11-25'].map((d, i) => op(`p${i}`, d, SALAIRE, euros(2500))));
const reprisesDe = (ops: Operation[]) => ops.filter((o) => o.plannedFlowId).map((o) => [o.id, o.plannedDate]);

describe('[niveau 2] #456 · 8. enregistrer', () => {
  it('un flux au rythme inconnu, ou de montant nul, ne s’enregistre pas', () => {
    const l = avec(comptes(), op('a', '2026-03-05', EDF, -euros(80)));
    const { flow } = proposer(l, ['a'])!;
    expect(recordFlowFromOperations(l, flow, ['a'])).toBeUndefined();
    const mensuel = { ...flow, periodicity: { interval: 1, unit: 'month' as const, anchorDate: '2026-03-05' } };
    expect(recordFlowFromOperations(l, { ...mensuel, amount: 0 }, ['a'])).toBeUndefined();
    expect(recordFlowFromOperations(l, mensuel, ['a'])?.flow.periodicity).toEqual(mensuel.periodicity);
  });

  it('ancré sur l’occurrence que reprend la plus ancienne opération désignée, ici à sa date ; chaque opération reprend l’occurrence la plus proche, rapprochée ou verrouillée, et prend la ventilation du flux si elle n’en porte pas', () => {
    const l = ventile(edf(), { id: 's', operationId: 'e2', categoryId: 'energie', tirelireId: 'vac', share: { kind: 'variable' } });
    const { flow } = proposer(l, ['e1'])!;
    expect(flow.periodicity).toEqual({ interval: 1, unit: 'month', anchorDate: '2026-02-03' });
    const corrige: ProposedFlow = { ...flow, action: { categoryId: 'energie' } };
    const r = recordFlowFromOperations(l, corrige, ['e3', 'e1', 'e2', 'e0'])!;
    expect(r.flow.periodicity.anchorDate).toBe('2026-02-03');
    expect(r.patch.operations.map((o) => [o.id, o.plannedFlowId, o.plannedDate, o.state])).toEqual([
      ['e0', 'f', '2026-02-03', 'reconciled'],
      ['e1', 'f', '2026-03-03', 'reconciled'],
      ['e2', 'f', '2026-04-03', 'locked'],
      ['e3', 'f', '2026-05-03', 'reconciled'],
    ]);
    expect(r.patch.subOperations.map((x) => [x.operationId, x.categoryId])).toEqual([
      ['e0', 'energie'],
      ['e1', 'energie'],
      ['e3', 'energie'],
    ]);
  });

  it('sans reprise désignée, ancré sur la plus ancienne des opérations qui le fondent ; une opération qui ne peut reprendre ce flux n’enregistre rien', () => {
    const l = edf();
    const { flow } = proposer(l, ['e3'])!;
    const r = recordFlowFromOperations(l, flow, [])!;
    expect([r.flow.periodicity.anchorDate, r.patch.operations]).toEqual(['2026-02-03', []]);
    const autre = avec(l, op('j', '2026-06-05', EDF, -euros(80), { accountId: JOINT }));
    expect(recordFlowFromOperations(autre, flow, ['e1', 'j'])).toBeUndefined();
    // Un flux nouveau : il n'en réécrit aucun qui porterait son identifiant.
    expect(recordFlowFromOperations(enregistrer(l, flow, []).ledger, flow, [])).toBeUndefined();
  });

  it('l’exemple du point 8 : ancré sur l’occurrence, non sur l’opération — le 25 juin ; la paie du 29 octobre reprend le 25 octobre, celle du 27 décembre importée ensuite est reprise', () => {
    const l = paiesDuPoint8();
    const { flow } = proposer(l, ['p2'])!;
    expect(flow.periodicity).toEqual({ interval: 1, unit: 'month', anchorDate: '2025-08-25' });
    expect(historyOccurrences(l, flow, ['p2']).map((o) => [o.operation.id, o.expectedDate, o.days])).toEqual([
      ['p0', '2025-06-25', 4],
      ['p1', '2025-08-25', 0],
      ['p2', '2025-09-25', 0],
      ['p3', '2025-10-25', 4],
      ['p4', '2025-11-25', 0],
    ]);
    const r = enregistrer(l, flow, ['p4', 'p3', 'p2', 'p1', 'p0']);
    expect(r.flow.periodicity).toEqual({ interval: 1, unit: 'month', anchorDate: '2025-06-25' });
    expect(reprisesDe(r.ledger.operations)).toEqual([
      ['p0', '2025-06-25'],
      ['p1', '2025-08-25'],
      ['p2', '2025-09-25'],
      ['p3', '2025-10-25'],
      ['p4', '2025-11-25'],
    ]);
    const ensuite = avec(r.ledger, op('p5', '2025-12-27', SALAIRE, euros(2500)));
    expect(proposeMatches(ensuite, '2025-01-01', '2026-12-31').map((m) => [m.operationId, m.flowId, m.expectedDate, m.auto])).toEqual([['p5', 'f', '2025-12-25', true]]);
  });

  it('une seule opération désignée, à quelques jours de son rythme : l’ancrage est la date de l’occurrence qu’elle reprend', () => {
    const l = paiesDuPoint8();
    const { flow } = proposer(l, ['p2'])!;
    const r = recordFlowFromOperations(l, flow, ['p3'])!;
    expect(r.flow.periodicity.anchorDate).toBe('2025-10-25');
    expect(r.patch.operations.map((o) => [o.id, o.plannedDate])).toEqual([['p3', '2025-10-25']]);
  });

  it('un ancrage qu’un mois plus court a ramené (le 30 novembre d’un rythme du 31) devient le jour des dates suivantes (D47)', () => {
    const l = avec(
      comptes(),
      op('e0', '2025-11-28', EDF, -euros(80)),
      op('e1', '2026-01-31', EDF, -euros(80)),
      op('e2', '2026-02-28', EDF, -euros(80)),
      op('e3', '2026-03-31', EDF, -euros(80)),
    );
    const { flow } = proposer(l, ['e1'])!;
    expect(flow.periodicity).toEqual({ interval: 1, unit: 'month', anchorDate: '2026-01-31' });
    expect(historyOccurrences(l, flow, ['e1']).map((o) => [o.operation.id, o.expectedDate])).toEqual([
      ['e0', '2025-11-30'],
      ['e1', '2026-01-31'],
      ['e2', '2026-02-28'],
      ['e3', '2026-03-31'],
    ]);
    const r = recordFlowFromOperations(l, flow, ['e0', 'e1', 'e2', 'e3'])!;
    expect(r.flow.periodicity.anchorDate).toBe('2025-11-30');
    expect(r.patch.operations.map((o) => [o.id, o.plannedDate])).toEqual([
      ['e0', '2025-11-30'],
      ['e1', '2026-01-30'],
      ['e2', '2026-02-28'],
      ['e3', '2026-03-30'],
    ]);
  });

  it('[niveau 0] le flux, ses reprises et leur ventilation se relisent après un redémarrage', async () => {
    const s = await base(edf());
    const { flow } = proposer(s.load(), ['e1'])!;
    const r = recordFlowFromOperations(s.load(), { ...flow, action: { categoryId: 'energie' } }, ['e0', 'e1', 'e3'])!;
    s.upsert('plannedFlows', r.flow);
    for (const o of r.patch.operations) s.upsert('operations', o);
    for (const x of r.patch.subOperations) s.upsert('subOperations', x);
    const relu = (await LedgerStore.create({ sqlJs: SQL, siteId: 'u4', bytes: s.export() })).load();
    s.close();
    expect(relu.plannedFlows.find((f) => f.id === 'f')).toEqual(r.flow);
    expect(relu.operations.filter((o) => o.plannedFlowId === 'f').map((o) => [o.id, o.plannedDate]).sort()).toEqual([
      ['e0', '2026-02-03'],
      ['e1', '2026-03-03'],
      ['e3', '2026-05-03'],
    ]);
    expect(relu.subOperations.map((x) => [x.operationId, x.categoryId]).sort()).toEqual([
      ['e0', 'energie'],
      ['e1', 'energie'],
      ['e3', 'energie'],
    ]);
  });

  it('un virement seul, enregistré avec lui-même pour seule reprise, donne ce que #434 enregistre', () => {
    const l = avec(budget(), vir('op-vir', '2026-09-02', euros(600)));
    const r = recordFlowFromOperations(l, proposer(l, ['op-vir'], 'x')!.flow, ['op-vir'])!;
    const attendu = recordOrderFromTransfer(l, 'op-vir', LECTURE, 'x')!;
    const sansId = (xs: SubOperation[]) => xs.map(({ id: _id, ...x }) => x);
    expect(r.flow).toEqual(attendu.flow);
    expect(r.patch.operations).toEqual(attendu.patch.operations);
    expect(sansId(r.patch.subOperations)).toEqual(sansId(attendu.patch.subOperations));
  });

  it('[niveau 0] verrouillée, elle le reste ; une opération qui porte sa ventilation la garde, verrouillée ou non (D22, D88)', () => {
    const propres: SubOperation[] = [
      { id: 's1', operationId: 'e1', tirelireId: 'taxe', share: { kind: 'variable' } },
      { id: 's2', operationId: 'e2', categoryId: 'energie', tirelireId: 'vac', share: { kind: 'variable' } },
    ];
    const l = ventile(edf(), ...propres);
    const avant = structuredClone(propres);
    const r = recordFlowFromOperations(l, { ...proposer(l, ['e0'])!.flow, action: { categoryId: 'energie' } }, ['e0', 'e1', 'e2', 'e3'])!;
    expect(r.patch.operations.map((o) => [o.id, o.state])).toEqual([
      ['e0', 'reconciled'],
      ['e1', 'reconciled'],
      ['e2', 'locked'],
      ['e3', 'reconciled'],
    ]);
    expect(r.patch.removedSubOperations ?? []).toEqual([]);
    const apres = applyPatchToLedger({ ...l, plannedFlows: [r.flow] }, r.patch);
    for (const id of ['e1', 'e2']) expect(apres.subOperations.filter((x) => x.operationId === id), id).toEqual(avant.filter((x) => x.operationId === id));
  });
});

describe('[niveau 0] #456 · 9. rien ne s’écrit avant le geste (I10)', () => {
  it('proposer, lire les occurrences, repérer ne modifient ni le grand livre lu ni la base', async () => {
    const s = await base(avec(budget(), ...edf().operations, vir('v1', '2026-07-02', euros(600)), vir('v2', '2026-08-02', euros(600)), vir('v3', '2026-09-02', euros(600))));
    const lu = s.load();
    const avant = structuredClone(lu);
    const baseAvant = JSON.stringify(s.load());
    const { flow } = proposer(lu, ['e1'])!;
    historyOccurrences(lu, flow, ['e1']);
    proposer(lu, ['v2']);
    detectSeries(lu, LECTURE);
    recordFlowFromOperations(lu, flow, ['e1', 'e3']);
    expect(lu).toEqual(avant);
    expect(JSON.stringify(s.load())).toBe(baseAvant);
    expect(s.load().plannedFlows).toEqual([]);
    expect(s.load().subOperations).toEqual([]);
    expect(s.load().operations.every((o) => !o.plannedFlowId)).toBe(true);
    s.close();
  });
});

describe('[niveau 2] #456 · 10. un flux comme les autres', () => {
  it('enregistré sans reprise, le rapprochement retrouve chaque opération non verrouillée de la série, sans confirmation s’il est fixe', () => {
    const l = edf();
    const { ledger } = enregistrer(l, proposer(l, ['e1'])!.flow, []);
    const p = proposeMatches(ledger, '2026-01-01', '2026-12-31');
    expect(p.map((m) => [m.operationId, m.expectedDate, m.auto]).sort()).toEqual([
      ['e0', '2026-02-03', true],
      ['e1', '2026-03-03', true],
      ['e3', '2026-05-03', true],
    ]);
  });

  it('ancré sur une occurrence plus ancienne — la seule paie du 21 juin gardée, au 25 juin —, le rapprochement retrouve chaque paie de la série à l’occurrence que son rythme lui assigne', () => {
    const l = paiesDuPoint8();
    const { ledger, flow } = enregistrer(l, proposer(l, ['p2'])!.flow, ['p0']);
    expect(flow.periodicity.anchorDate).toBe('2025-06-25');
    expect(
      proposeMatches(ledger, '2025-01-01', '2026-12-31')
        .map((m) => [m.operationId, m.expectedDate, m.auto])
        .sort(),
    ).toEqual([
      ['p1', '2025-08-25', true],
      ['p2', '2025-09-25', true],
      ['p3', '2025-10-25', true],
      ['p4', '2025-11-25', true],
    ]);
  });

  it('variable, chaque reprise est à confirmer (D12)', () => {
    const l = avec(comptes(), ...[euros(70), euros(80), euros(90)].map((m, i) => op(`e${i}`, `2026-0${3 + i}-05`, EDF, -m)));
    const { ledger } = enregistrer(l, proposer(l, ['e1'])!.flow, []);
    const p = proposeMatches(ledger, '2026-01-01', '2026-12-31');
    expect(p.map((m) => [m.operationId, m.auto]).sort()).toEqual([
      ['e0', false],
      ['e1', false],
      ['e2', false],
    ]);
  });

  it('une ligne importée ensuite, au même libellé et au même montant, à la date suivante, est reprise et prend la ventilation du flux', () => {
    const l = edf();
    const { ledger } = enregistrer(l, { ...proposer(l, ['e1'])!.flow, action: { categoryId: 'energie' } }, ['e0', 'e1', 'e2', 'e3']);
    let apres = avec(ledger, op('e4', '2026-06-04', EDF, -euros(80)));
    runPipeline(apres, '2026-06-01', '2026-06-30', (p) => (apres = applyPatchToLedger(apres, p)));
    const e4 = apres.operations.find((o) => o.id === 'e4')!;
    expect([e4.plannedFlowId, e4.plannedDate, e4.state]).toEqual(['f', '2026-06-03', 'reconciled']);
    expect(apres.subOperations.filter((x) => x.operationId === 'e4').map((x) => x.categoryId)).toEqual(['energie']);
  });

  it('ses reprises passées ne comptent pas deux fois : le solde prévu ne varie que des occurrences qui comptent encore', () => {
    const l = avec(comptes(), ...['2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05'].map((d, i) => op(`e${i}`, d, EDF, -euros(80))));
    const solde = (x: Ledger) => accountBalance(x.accounts[0]!, withPlannedOperations(x, LECTURE, '2026-11-30').ledger, '2026-11-30');
    const { flow } = proposer(l, ['e0'])!;
    // Les occurrences de septembre, d'octobre et de novembre comptent encore, avec ou sans reprises.
    expect(solde(enregistrer(l, flow, ids(l.operations)).ledger) - solde(l)).toBe(-euros(240));
    expect(solde(enregistrer(l, flow, []).ledger) - solde(l)).toBe(-euros(240));
  });

  it('un ordre fait d’une série trimestrielle est comparé par son équivalent mensuel (sa non-réécriture : niveau 0, plus bas)', () => {
    const l = comptes();
    l.tirelires.push({ id: 'pre', name: 'Précaution', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01' });
    l.needs.push({ id: 'n-pre', tirelireId: 'pre', kind: 'goal', amount: euros(90000), monthlyAmount: euros(300), priority: 10 });
    const h = avec(l, vir('v1', '2026-01-02', euros(900)), vir('v2', '2026-04-02', euros(900)), vir('v3', '2026-07-02', euros(900)));
    const { flow } = proposer(h, ['v1'])!;
    expect([flow.periodicity, flow.action]).toEqual([{ interval: 3, unit: 'month', anchorDate: '2026-01-02' }, { allocation: [{ tirelireId: 'pre', share: { kind: 'fixed', amount: -euros(900) } }] }]);
    const { ledger } = enregistrer(h, flow, ['v1', 'v2', 'v3']);
    const t = computePlan(ledger, LECTURE).transfers.find((x) => x.accountId === LIVRET)!;
    expect([t.permanent, t.bankOrder?.amount, t.bankOrder?.drift, t.bankOrder?.signaled, t.bankOrder?.parts.map((p) => p.drift)]).toEqual([euros(300), euros(300), 0, false, [0]]);
  });

  it('[niveau 0] le plan ne réécrit pas l’ordre fait d’une série, ni son montant ni ses parts, l’écart signalé ou non (D60, I10)', () => {
    for (const pas of [euros(10), euros(200)]) {
      const l = comptes();
      l.settings.orderRounding = pas;
      l.tirelires.push({ id: 'pre', name: 'Précaution', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01' });
      l.needs.push({ id: 'n-pre', tirelireId: 'pre', kind: 'goal', amount: euros(90000), monthlyAmount: euros(400), priority: 10 });
      const h = avec(l, vir('v1', '2026-01-02', euros(900)), vir('v2', '2026-04-02', euros(900)), vir('v3', '2026-07-02', euros(900)));
      const { ledger } = enregistrer(h, proposer(h, ['v1'])!.flow, ['v1', 'v2', 'v3']);
      const avant = structuredClone(ledger.plannedFlows.find((f) => f.id === 'f')!);
      // 900 € par trimestre, 300 € par mois, pour 400 € demandés : un écart de 100 €.
      expect(computePlan(ledger, LECTURE).transfers.find((x) => x.accountId === LIVRET)!.bankOrder?.signaled, `pas ${pas}`).toBe(pas < euros(100));
      computePlan(ledger, '2026-10-06');
      expect(ledger.plannedFlows.find((f) => f.id === 'f'), `pas ${pas}`).toEqual(avant);
    }
  });
});

describe('[niveau 1] #456 · 11. le livre de compte tient (I2)', () => {
  const verifier = (ledger: Ledger) => {
    const idx = indexLedger(ledger);
    for (const a of idx.accountsById.values()) expect(componentsOnAccount(a, idx, '2026-09-30') + unallocated(a, ledger, idx, '2026-09-30'), a.id).toBe(accountBalance(a, ledger, '2026-09-30'));
    // Chaque tirelire a reçu sa part à chaque reprise, sur le compte d'accueil, en plus de ce qu'elle y avait.
    const virements = new Set(['v1', 'v2', 'v3']);
    const sans = indexLedger({ ...ledger, subOperations: ledger.subOperations.filter((x) => !virements.has(x.operationId)) });
    for (const [t, part] of [['taxe', euros(400)], ['vac', euros(200)]] as const)
      expect((tirelireComponents(idx.tireliresById.get(t)!, idx, '2026-09-30').get(LIVRET) ?? 0) - (tirelireComponents(sans.tireliresById.get(t)!, sans, '2026-09-30').get(LIVRET) ?? 0), t).toBe(3 * part);
  };
  const historique = (o: Partial<Operation> = {}) => avec(budget(), vir('v1', '2026-07-02', euros(600), o), vir('v2', '2026-08-02', euros(600), o), vir('v3', '2026-09-02', euros(600), o));

  it('sans le relevé du compte d’accueil', () => {
    const l = historique();
    verifier(enregistrer(l, proposer(l, ['v3'])!.flow, ['v1', 'v2', 'v3']).ledger);
  });

  it('avec les crédits appariés sur le compte d’accueil', () => {
    const debits = historique({ state: 'untreated' });
    for (const o of debits.operations) delete o.transferAccountId;
    const credits = debits.operations.map((o) => op(`c-${o.id}`, o.date, 'VIR RECU', euros(600), { accountId: LIVRET }));
    let l = avec(debits, ...credits);
    // Les paires confirmées (#488, point 6) : sans destination connue, l'appariement ne les forme pas seul.
    for (const c of credits) l = applyPatchToLedger(l, acceptInternalTransfer(l, { debitId: c.id.slice(2), creditId: c.id }));
    const { ledger } = enregistrer(l, proposer(l, ['v3'])!.flow, ['v1', 'v2', 'v3']);
    verifier(ledger);
    const idx = indexLedger(ledger);
    const a = idx.accountsById.get(LIVRET)!;
    expect([accountBalance(a, ledger, '2026-09-30'), unallocated(a, ledger, idx, '2026-09-30')]).toEqual([euros(1800), 0]);
  });
});

describe('[niveau 3] #456 · 12. sans attente', () => {
  it('avec 5 000 opérations importées, le repérage et les occurrences d’un flux corrigé se calculent chacun en moins d’une seconde', () => {
    const l = budget();
    const commerces = Array.from({ length: 150 }, (_, i) => `CARTE X1234 COMMERCE${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))} PARIS`);
    let n = 0;
    for (let m = 0; m < 24; m++) {
      const mois = `${2024 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
      for (let k = 0; k < 20; k++) l.operations.push(op(`r${n++}`, `${mois}-${String(5 + (k % 20)).padStart(2, '0')}`, `PRELEVEMENT FOURNISSEUR${k} CONTRAT`, -euros(10 + k)));
      while (n < (m + 1) * 208) l.operations.push(op(`r${n++}`, `${mois}-${String(1 + (n % 28)).padStart(2, '0')}`, commerces[n % commerces.length]!, -(500 + (n % 9000))));
    }
    while (l.operations.length < 5000) l.operations.push(op(`r${n++}`, '2025-12-15', commerces[n % commerces.length]!, -euros(5)));
    expect(l.operations.length).toBe(5000);
    let t = performance.now();
    const trouvees = detectSeries(l, LECTURE);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(trouvees.length).toBeGreaterThanOrEqual(20);
    const flow = trouvees.find((s) => s.flow.kind === 'fixedCharge')!.flow;
    t = performance.now();
    const occ = historyOccurrences(l, { ...flow, amountTolerance: { pct: 50 }, dateWindowDays: 3 }, []);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(occ.length).toBeGreaterThan(0);
  });
});
