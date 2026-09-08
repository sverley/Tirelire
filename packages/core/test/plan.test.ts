import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  computePlan,
  componentsOnAccount,
  tirelireBalance,
  tirelireComponents,
  euros,
  exampleLedger,
  indexLedger,
  settlementBalance,
  transferLabel,
  unallocated,
  type Ledger,
  standingTransferFlow,
  applyMatch,
  applyPatchToLedger,
  type Operation,
  wantedComponents,
} from '../src/index.js';

const asOf = '2026-09-06';

function line(plan: ReturnType<typeof computePlan>, needId: string) {
  const l = plan.lines.find((x) => x.needId === needId);
  if (!l) throw new Error(`ligne ${needId} absente`);
  return l;
}

describe('positions et soldes (D19, D29)', () => {
  const ledger = exampleLedger();
  const idx = indexLedger(ledger);

  it('une tirelire est répartie sur plusieurs comptes ; sa dotation attend sur le compte principal', () => {
    // Taxe foncière : 900 sur le livret, dotation de septembre (rattrapage 150) sur le compte principal.
    const tf = tirelireComponents(idx.tirelliresById_TMP.get('env-tf')!, idx, asOf);
    expect(tf.get('acc-livret')).toBe(euros(900));
    expect(tf.get('acc-principal')).toBe(euros(150));
    expect(tirelireBalance(idx.tirelliresById_TMP.get('env-tf')!, idx, asOf)).toBe(euros(1050));
  });

  it('un virement interne déplace une composante sans changer le solde', () => {
    // Enfants : dotation 200 sur le compte principal, virée le jour même sur la carte enfants, puis 236 dépensés là.
    const c = tirelireComponents(idx.tirelliresById_TMP.get('env-enfants')!, idx, asOf);
    expect(c.get('acc-principal') ?? 0).toBe(0);
    expect(c.get('acc-enfants')).toBe(euros(-36));
    expect(tirelireBalance(idx.tirelliresById_TMP.get('env-enfants')!, idx, asOf)).toBe(euros(-36));
  });

  it('une dépense consomme l’tirelire là où elle sort, même si l’argent dort ailleurs', () => {
    // Santé, placée sur le compte principal : dotation 100 sur le compte principal, dentiste 80 payé par Marie.
    const c = tirelireComponents(idx.tirelliresById_TMP.get('env-sante')!, idx, asOf);
    expect(c.get('acc-principal')).toBe(euros(100));
    expect(c.get('acc-marie')).toBe(euros(-80));
    expect(tirelireBalance(idx.tirelliresById_TMP.get('env-sante')!, idx, asOf)).toBe(euros(20));
  });

  it('solde à régler avec les comptes tiers', () => {
    const marie = idx.accountsById.get('acc-marie')!;
    const enfants = idx.accountsById.get('acc-enfants')!;
    // dentiste 80 payé par Marie (le compte principal lui doit 80) − allocations 100 reçues chez elle
    expect(settlementBalance(marie, ledger, idx, asOf)).toBe(euros(-20));
    // la dotation de 200 € alimente la tirelire placée là : pas une dette
    expect(settlementBalance(enfants, ledger, idx, asOf)).toBe(0);
  });

  it('second invariant : solde bancaire = composantes portées + non affecté', () => {
    for (const a of idx.accountsById.values()) {
      expect(componentsOnAccount(a, idx, asOf) + unallocated(a, ledger, idx, asOf)).toBe(accountBalance(a, ledger, asOf));
    }
    // Principal : 2340 + 3400 − 200 (virement enfants) − dotations (150 + 50 + 200 + 300 + 900 + 200 + 250 + 200 + 100) + 200 (virement)
    const principal = idx.accountsById.get('acc-principal')!;
    expect(unallocated(principal, ledger, idx, asOf)).toBe(euros(2340 + 3400 - 200 - 2350 + 200));
    const livret = idx.accountsById.get('acc-livret')!;
    expect(unallocated(livret, ledger, idx, asOf)).toBe(euros(15));
  });

  it('premier invariant : le solde est la somme des composantes', () => {
    for (const e of idx.tirelliresById_TMP.values()) {
      let sum = 0;
      for (const v of tirelireComponents(e, idx, asOf).values()) sum += v;
      expect(tirelireBalance(e, idx, asOf)).toBe(sum);
    }
  });
});

describe('report (D05, D29)', () => {
  it('remise à zéro : l’excédent est libéré en fin de période, un déficit est effacé', () => {
    const l = exampleLedger();
    const idx = indexLedger(l);
    const alim = idx.tirelliresById_TMP.get('env-alim')!;
    // Septembre : dotation 900, rien dépensé. Le 27 septembre au soir, 900 ; le 28, libération puis nouvelle dotation.
    expect(tirelireBalance(alim, idx, '2026-09-27')).toBe(euros(900));
    expect(tirelireBalance(alim, idx, '2026-09-28')).toBe(euros(900));
    expect(tirelireComponents(alim, idx, '2026-09-28').get('acc-principal')).toBe(euros(900));
    const principal = idx.accountsById.get('acc-principal')!;
    // Le compte principal ne porte plus que la nouvelle dotation pour cette tirelire (ni 1 800 ni moins).
    expect(componentsOnAccount(principal, idx, '2026-09-28')).toBeGreaterThan(0);
  });

  it('report illimité : le déficit d’une période se rattrape à la suivante', () => {
    const l = exampleLedger();
    const octobre = computePlan(l, '2026-09-28');
    expect(line(octobre, 'need-enfants').balance).toBe(euros(-36));
    expect(line(octobre, 'need-enfants').catchUp).toBe(euros(236));
    expect(line(octobre, 'need-enfants').requested).toBe(euros(236));
  });
});

describe('plan de période (exemple de l’analyse)', () => {
  const ledger = exampleLedger();
  const plan = computePlan(ledger, asOf);

  it('période de paie à paie', () => {
    expect(plan.period.label).toBe('septembre 2026');
    expect(plan.period.start).toBe('2026-08-28');
  });

  it('revenus et charges fixes de la période', () => {
    expect(plan.totals.incomes).toBe(euros(4200));
    expect(plan.totals.fixedCharges).toBe(euros(950 + 45 + 75 + 150));
    expect(plan.fixedCharges.map((f) => f.name)).not.toContain('Taxe foncière (prélèvement)');
  });

  it('échéance en rattrapage : (échéance − retenu) ÷ périodes restantes', () => {
    const tf = line(plan, 'need-tf');
    expect(tf.cruise).toBe(euros(100));
    expect(tf.dueDate).toBe('2026-10-15');
    // deux périodes de paie avant le 15 octobre (28 août et 28 septembre)
    expect(tf.catchUp).toBe(euros(150));
    expect(tf.requested).toBe(euros(150));
    expect(tf.status).toBe('catchUp');
  });

  it('échéance en croisière', () => {
    const auto = line(plan, 'need-auto');
    expect(auto.cruise).toBe(euros(50));
    // sept périodes de paie avant le 5 mars : (600 − 300) ÷ 7
    expect(auto.catchUp).toBe(Math.ceil(30000 / 7));
    expect(auto.requested).toBe(euros(50));
    expect(auto.status).toBe('ahead');
  });

  it('échéance entièrement provisionnée : dotation nulle', () => {
    const l = exampleLedger();
    l.tirelires.find((e) => e.id === 'env-tf')!.openingBalance = euros(1200);
    expect(line(computePlan(l, asOf), 'need-tf').requested).toBe(0);
  });

  it('objectif : mensualité fixe', () => {
    expect(line(plan, 'need-precaution').requested).toBe(euros(300));
  });

  it('besoin récurrent placé ailleurs : dotation de croisière, pas virtuel', () => {
    const enfants = line(plan, 'need-enfants');
    expect(enfants.cruise).toBe(euros(200));
    expect(enfants.requested).toBe(euros(200));
    expect(enfants.virtual).toBe(false);
  });

  it('besoins récurrents sur le compte principal : réservés, pas virés', () => {
    const alim = line(plan, 'need-alim');
    expect(alim.virtual).toBe(true);
    expect(alim.requested).toBe(euros(900));
  });

  it('écarts de placement (D20) : les dotations du livret attendent sur le compte principal', () => {
    const toLivret = plan.gaps.filter((g) => g.toAccountId === 'acc-livret');
    expect(toLivret.map((g) => [g.tirelireId, g.amount])).toEqual(
      expect.arrayContaining([
        ['env-tf', euros(150)],
        ['env-auto', euros(50)],
        ['env-vac', euros(200)],
        ['env-precaution', euros(300)],
      ]),
    );
    expect(toLivret.every((g) => g.status === 'todo')).toBe(true);
    // Le dentiste payé par Marie relève du règlement, pas d'un écart.
    expect(plan.gaps.some((g) => g.fromAccountId === 'acc-marie')).toBe(false);
  });

  it('virements par compte : un ordre par couple de comptes, détaillé par tirelire (D21)', () => {
    const livret = plan.transfers.find((t) => t.accountId === 'acc-livret')!;
    expect(livret.label).toBe('TIRELIRE LIVRET A');
    expect(livret.standing).toBe(euros(100 + 50 + 200 + 300));
    expect(livret.exceptional).toBe(euros(50));
    expect(livret.orders.map((o) => o.tirelireName)).toContain('Taxe foncière');
    expect(livret.surplus).toBe(euros(15));
    expect(livret.net).toBe(euros(650 + 50 - 15));

    // La carte enfants a déjà reçu sa dotation : rien à virer, rien à régler.
    expect(plan.transfers.find((t) => t.accountId === 'acc-enfants')).toBeUndefined();

    const marie = plan.transfers.find((t) => t.accountId === 'acc-marie')!;
    expect(marie.settlement).toBe(euros(-20));
    expect(marie.net).toBe(euros(-20));
  });

  it('marge : lecture de ce que les revenus couvrent', () => {
    const funded = plan.totals.funded;
    expect(plan.totals.requested).toBe(euros(150 + 50 + 200 + 300 + 900 + 200 + 250 + 200 + 100));
    expect(funded).toBe(plan.totals.requested);
    expect(plan.totals.margin).toBe(euros(4200) - plan.totals.fixedCharges - funded);
    expect(plan.warnings.map((w) => w.code)).not.toContain('negativeMargin');
    expect(plan.warnings.map((w) => w.code)).not.toContain('principalOverdrawn');
  });
});

describe('marge négative : lecture par priorité (D06)', () => {
  it('signale les lignes les moins prioritaires, jamais le rattrapage d’une échéance', () => {
    const ledger: Ledger = exampleLedger();
    const salaire = ledger.plannedFlows.find((f) => f.id === 'flow-salaire')!;
    salaire.amount = euros(1500);
    const plan = computePlan(ledger, asOf);
    expect(plan.warnings.map((w) => w.code)).toContain('negativeMargin');
    // Le rattrapage de la taxe foncière est un plancher : toujours couvert.
    expect(line(plan, 'need-tf').funded).toBe(euros(150));
    // La ligne la moins prioritaire (Divers, 40) saute en premier.
    expect(line(plan, 'need-divers').funded).toBe(0);
    expect(line(plan, 'need-divers').status).toBe('unfunded');
    // L'épargne (30) est réduite ou coupée avant les budgets (20).
    expect(line(plan, 'need-precaution').funded).toBeLessThan(euros(300));
    expect(plan.totals.margin).toBeGreaterThanOrEqual(0);
    // La dotation, elle, est acquise (D29) : le plan le dit par le non affecté du compte principal.
    expect(plan.totals.requested).toBe(euros(2350));
  });
});

describe('besoins multiples dans une tirelire (D28)', () => {
  it('le solde est attribué dans l’ordre des priorités ; le plancher de l’échéance passe avant le courant', () => {
    const l = exampleLedger();
    // Une seule tirelire « Charges » : taxe foncière (échéance, priorité 10) + courant 100/mois (priorité 20).
    l.tirelires.push({ id: 'env-charges', name: 'Charges', placement: [{ accountId: 'acc-livret', share: { kind: 'variable' } }], openingBalance: euros(500), openingDate: '2026-08-27' });
    l.needs.push(
      { id: 'need-charges-tf', tirelireId: 'env-charges', kind: 'dueDate', name: 'Taxe foncière', amount: euros(1200), periodicity: { intervalMonths: 12, anchorDate: '2026-10-15' }, priority: 10 },
      { id: 'need-charges-courant', tirelireId: 'env-charges', kind: 'recurring', name: 'Courant', amount: euros(100), priority: 20 },
    );
    const plan = computePlan(l, asOf);
    const tf = line(plan, 'need-charges-tf');
    const courant = line(plan, 'need-charges-courant');
    expect(tf.held).toBe(euros(500));
    expect(tf.catchUp).toBe(euros(350));
    expect(tf.floor).toBe(euros(350));
    expect(courant.held).toBe(0);
    expect(courant.requested).toBe(euros(100));
    expect(tf.name).toBe('Taxe foncière');
    expect(tf.tirelireName).toBe('Charges');
  });
});

describe('libellés de virement', () => {
  it('majuscules sans accents, préfixés, un par compte', () => {
    expect(transferLabel('Livret A')).toBe('TIRELIRE LIVRET A');
    expect(transferLabel('Épargne de précaution')).toBe('TIRELIRE EPARGNE DE PRECAUTION');
    expect(transferLabel('Taxe foncière').length).toBeLessThanOrEqual(35);
  });
});

describe('virement permanent à ventilation prévue (D21)', () => {
  it('un flux par couple de comptes, ventilation calculée d’avance', () => {
    const l = exampleLedger();
    const plan = computePlan(l, '2026-09-06');
    const t = plan.transfers.find((x) => x.accountKind === 'holding')!;
    const flow = standingTransferFlow(plan, t, 'acc-principal', 'flow-vir')!;
    expect(flow.kind).toBe('transfer');
    expect(flow.counterpartAccountId).toBe(t.accountId);
    expect(flow.labelPattern).toBe(t.label);
    // Le permanent, pas le total : le complément de ce mois-ci n'est pas un ordre permanent.
    expect(flow.amount).toBe(-t.standing);
    expect(flow.plannedAllocation!.reduce((s, a) => s + (a.share.kind === 'fixed' ? a.share.amount : 0), 0)).toBe(-t.standing);
  });

  it('au montant prévu, la ventilation prévue s’applique ; sinon l’ordre de financement rejoue', () => {
    let l = exampleLedger();
    const plan = computePlan(l, '2026-09-06');
    const t = plan.transfers.find((x) => x.accountKind === 'holding')!;
    const flow = standingTransferFlow(plan, t, 'acc-principal', 'flow-vir')!;
    l.plannedFlows.push(flow);

    const virement = (id: string, amount: number): Operation => ({
      id,
      accountId: 'acc-principal',
      origin: 'imported',
      date: '2026-09-28',
      label: flow.labelPattern!,
      normalizedLabel: flow.labelPattern!,
      amount,
      state: 'untreated',
    });

    // Montant exact : on retrouve la ventilation prévue.
    l.operations.push(virement('op-vir-exact', flow.amount));
    let patch = applyMatch(l, { operationId: 'op-vir-exact', flowId: flow.id, expectedDate: '2026-09-28', expectedAmount: flow.amount, score: 1, auto: true, reasons: [] });
    expect(patch.allocations.map((a) => a.tirelireId)).toEqual(flow.plannedAllocation!.map((a) => a.tirelireId));

    // Montant moindre : les planchers passent d'abord, on ne saupoudre pas au prorata.
    const moindre = Math.round(flow.amount / 2);
    l = applyPatchToLedger(l, { operations: [virement('op-vir-court', moindre)], allocations: [] });
    patch = applyMatch(l, { operationId: 'op-vir-court', flowId: flow.id, expectedDate: '2026-09-28', expectedAmount: flow.amount, score: 1, auto: true, reasons: [] });
    const total = patch.allocations.reduce((s, a) => s + (a.share.kind === 'fixed' ? a.share.amount : 0), 0);
    expect(total).toBe(moindre);
    expect(patch.allocations.length).toBeLessThanOrEqual(flow.plannedAllocation!.length);
  });
});

describe('placement réparti sur plusieurs comptes (D37)', () => {
  it('« tant sur le livret, le reste sur le compte principal » se résout sur le solde du moment', () => {
    const l = exampleLedger();
    const e = l.tirelires.find((x) => x.id === 'env-precaution')!;
    e.placement = [
      { accountId: 'acc-livret', share: { kind: 'fixed', amount: euros(2000) } },
      { accountId: 'acc-principal', share: { kind: 'variable' } },
    ];
    const idx = indexLedger(l);
    const wanted = wantedComponents(e, idx, '2026-09-06');
    const total = tirelireBalance(e, idx, '2026-09-06');
    expect(wanted.get('acc-livret')).toBe(euros(2000));
    expect(wanted.get('acc-principal')).toBe(total - euros(2000));
  });

  it('un pourcentage se calcule sur le solde, et la part « reste » absorbe le change', () => {
    const l = exampleLedger();
    const e = l.tirelires.find((x) => x.id === 'env-precaution')!;
    e.placement = [
      { accountId: 'acc-livret', share: { kind: 'percent', pct: 70 } },
      { accountId: 'acc-principal', share: { kind: 'variable' } },
    ];
    const idx = indexLedger(l);
    const total = tirelireBalance(e, idx, '2026-09-06');
    const wanted = wantedComponents(e, idx, '2026-09-06');
    expect(wanted.get('acc-livret')).toBe(Math.round((total * 70) / 100));
    expect([...wanted.values()].reduce((s, v) => s + v, 0)).toBe(total);
  });

  it('le plan apparie l’excédent d’un compte au manque d’un autre', () => {
    const l = exampleLedger();
    const e = l.tirelires.find((x) => x.id === 'env-precaution')!;
    e.placement = [
      { accountId: 'acc-livret', share: { kind: 'fixed', amount: euros(1000) } },
      { accountId: 'acc-principal', share: { kind: 'variable' } },
    ];
    const plan = computePlan(l, '2026-09-06');
    const g = plan.gaps.filter((x) => x.tirelireId === e.id);
    // Trop sur le livret, pas assez sur le compte principal : un seul mouvement, du livret vers le compte principal.
    expect(g.length).toBe(1);
    expect(g[0]!.fromAccountId).toBe('acc-livret');
    expect(g[0]!.toAccountId).toBe('acc-principal');
    expect(g[0]!.amount).toBeGreaterThan(0);
  });

  it('sans placement déclaré, aucun écart : l’argent est bien là où il est', () => {
    const l = exampleLedger();
    for (const e of l.tirelires) e.placement = [];
    expect(computePlan(l, '2026-09-06').gaps).toEqual([]);
  });
});
