import { describe, expect, it } from 'vitest';
import {
  computePlan,
  envelopeBalance,
  euros,
  exampleLedger,
  indexLedger,
  settlementBalance,
  transferLabel,
  unallocated,
  type Ledger,
} from '../src/index.js';

const asOf = '2026-09-06';

function line(plan: ReturnType<typeof computePlan>, id: string) {
  const l = plan.lines.find((x) => x.envelopeId === id);
  if (!l) throw new Error(`ligne ${id} absente`);
  return l;
}

describe('soldes', () => {
  const ledger = exampleLedger();
  const idx = indexLedger(ledger);

  it('enveloppes : solde initial + effets', () => {
    expect(envelopeBalance(idx.envelopesById.get('env-tf')!, idx, asOf)).toBe(euros(900));
    // budget sur compte tiers : dotation +200 (virement) − 146 − 90
    expect(envelopeBalance(idx.envelopesById.get('env-enfants')!, idx, asOf)).toBe(euros(-36));
    // budget sur le pivot sans report : dotation − dépensé (dentiste 80 € payé par Marie)
    expect(envelopeBalance(idx.envelopesById.get('env-sante')!, idx, asOf)).toBe(euros(20));
  });

  it('solde à régler avec les comptes tiers', () => {
    const marie = idx.accountsById.get('acc-marie')!;
    const enfants = idx.accountsById.get('acc-enfants')!;
    // dentiste 80 payé par Marie (le pivot lui doit 80) − allocations 100 reçues chez elle
    expect(settlementBalance(marie, ledger, idx, asOf)).toBe(euros(-20));
    // la dotation de 200 € alimente l'enveloppe hébergée là : pas une dette
    expect(settlementBalance(enfants, ledger, idx, asOf)).toBe(0);
  });

  it('non affecté du pivot et du livret', () => {
    const pivot = idx.accountsById.get('acc-pivot')!;
    const livret = idx.accountsById.get('acc-livret')!;
    // 2340 − 200 (virement enfants) − (900 + 200 + 250 + 20) budgets réservés
    expect(unallocated(pivot, ledger, idx, asOf)).toBe(euros(2340 - 200 - 900 - 200 - 250 - 20));
    expect(unallocated(livret, ledger, idx, asOf)).toBe(euros(15));
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

  it('provision en rattrapage : (échéance − solde) ÷ périodes restantes', () => {
    const tf = line(plan, 'env-tf');
    expect(tf.cruise).toBe(euros(100));
    expect(tf.dueDate).toBe('2026-10-15');
    // deux périodes de paie avant le 15 octobre (28 août et 28 septembre)
    expect(tf.catchUp).toBe(euros(150));
    expect(tf.requested).toBe(euros(150));
    expect(tf.status).toBe('catchUp');
  });

  it('provision en croisière', () => {
    const auto = line(plan, 'env-auto');
    expect(auto.cruise).toBe(euros(50));
    // sept périodes de paie avant le 5 mars : (600 − 300) ÷ 7
    expect(auto.catchUp).toBe(Math.ceil(30000 / 7));
    expect(auto.requested).toBe(euros(50));
    expect(auto.status).toBe('ahead');
  });

  it('épargne : mensualité fixe', () => {
    const goal = line(plan, 'env-precaution');
    expect(goal.requested).toBe(euros(300));
  });

  it('budget hébergé ailleurs en dépassement : complément', () => {
    const enfants = line(plan, 'env-enfants');
    expect(enfants.cruise).toBe(euros(200));
    expect(enfants.catchUp).toBe(euros(236));
    expect(enfants.virtual).toBe(false);
  });

  it('budgets sur le pivot : réservés, pas virés', () => {
    const alim = line(plan, 'env-alim');
    expect(alim.virtual).toBe(true);
    expect(alim.requested).toBe(euros(900));
  });

  it('virements par compte, un ordre par enveloppe', () => {
    const livret = plan.transfers.find((t) => t.accountId === 'acc-livret')!;
    expect(livret.standing).toBe(euros(100 + 50 + 200 + 300));
    expect(livret.exceptional).toBe(euros(50));
    expect(livret.orders.map((o) => o.label)).toContain('TIRELIRE TAXE FONCIERE');
    expect(livret.surplus).toBe(euros(15));
    expect(livret.net).toBe(euros(650 + 50 - 15));

    const enfants = plan.transfers.find((t) => t.accountId === 'acc-enfants')!;
    expect(enfants.standing).toBe(euros(200));
    expect(enfants.exceptional).toBe(euros(36));
    expect(enfants.settlement).toBe(0);

    const marie = plan.transfers.find((t) => t.accountId === 'acc-marie')!;
    expect(marie.settlement).toBe(euros(-20));
    expect(marie.net).toBe(euros(-20));
  });

  it('marge', () => {
    const funded = plan.totals.funded;
    expect(funded).toBe(euros(150 + 50 + 200 + 300 + 900 + 200 + 250 + 236 + 100));
    expect(plan.totals.margin).toBe(euros(4200) - plan.totals.fixedCharges - funded);
    expect(plan.warnings.map((w) => w.code)).not.toContain('negativeMargin');
  });
});

describe('marge négative : réduction par priorité', () => {
  it('coupe les lignes les moins prioritaires, jamais le rattrapage d’une provision', () => {
    const ledger: Ledger = exampleLedger();
    const salaire = ledger.plannedFlows.find((f) => f.id === 'flow-salaire')!;
    salaire.amount = euros(1500);
    const plan = computePlan(ledger, asOf);
    expect(plan.warnings.map((w) => w.code)).toContain('negativeMargin');
    // Le rattrapage de la taxe foncière est un plancher : toujours financé.
    expect(line(plan, 'env-tf').funded).toBe(euros(150));
    // La ligne la moins prioritaire (Divers, 40) saute en premier.
    expect(line(plan, 'env-divers').funded).toBe(0);
    expect(line(plan, 'env-divers').status).toBe('unfunded');
    // L'épargne (30) est réduite ou coupée avant les budgets (20).
    expect(line(plan, 'env-precaution').funded).toBeLessThan(euros(300));
    expect(plan.totals.margin).toBeGreaterThanOrEqual(0);
  });
});

describe('libellés de virement', () => {
  it('majuscules sans accents, préfixés', () => {
    expect(transferLabel('Épargne de précaution')).toBe('TIRELIRE EPARGNE DE PRECAUTION');
    expect(transferLabel('Taxe foncière').length).toBeLessThanOrEqual(35);
  });
});
