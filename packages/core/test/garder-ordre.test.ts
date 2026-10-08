/**
 * #205 · Garder un ordre permanent tel quel, sans être bloqué (I10, D20, D60) : tests du codeur, tous
 * de niveau 4, parmi lesquels l'auditeur choisira le harnais.
 */
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import {
  computePlan,
  emptyLedger,
  euros,
  ecrireBudgetJson,
  exportBundle,
  importBundle,
  appliquerBudget,
  importerBudgetJson,
  keepStandingOrder,
  lapsedKeptOrders,
  LedgerStore,
  resumeStandingOrderProposal,
  standingTransferFlow,
  type Ledger,
  type PlannedFlow,
} from '../src/index.js';

const SQL = await initSqlJs();
const CC = 'acc-principal';
const LIVRET = 'livret';
const LECTURE = '2026-09-06';
const mensuel = (anchorDate: string) => ({ interval: 1, unit: 'month' as const, anchorDate });

/** Deux tirelires sur le livret : taxe 100 €/mois, vacances `vac` €/mois ; le budget demande 100 + vac. */
function budget(vac = 200, pas = euros(10)): Ledger {
  const l = emptyLedger({ periodStartDay: 28, orderRounding: pas });
  l.accounts.push(
    { id: CC, name: 'Compte courant', kind: 'principal', openingBalance: euros(3000), openingDate: '2026-08-27' },
    { id: LIVRET, name: 'Livret', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-27' },
  );
  l.tirelires.push(
    { id: 'taxe', name: 'Taxe', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' },
    { id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' },
  );
  l.needs.push(
    { id: 'n-taxe', tirelireId: 'taxe', kind: 'dueDate', amount: euros(1200), periodicity: { interval: 12, unit: 'month', anchorDate: '2027-08-15' }, priority: 10 },
    { id: 'n-vac', tirelireId: 'vac', kind: 'goal', amount: euros(50000), monthlyAmount: euros(vac), priority: 30 },
  );
  l.plannedFlows.push({ id: 'salaire', name: 'Salaire', kind: 'income', amount: euros(2500), accountId: CC, periodicity: mensuel('2026-08-28'), dateWindowDays: 3 });
  return l;
}

const ORDRE: PlannedFlow = {
  id: 'o',
  name: 'Virement livret',
  kind: 'transfer',
  amount: -euros(250),
  accountId: CC,
  counterpartAccountId: LIVRET,
  periodicity: mensuel('2026-08-28'),
  dateWindowDays: 5,
  labelPattern: 'TIRELIRE LIVRET',
  action: { allocation: [{ tirelireId: 'taxe', share: { kind: 'fixed', amount: -euros(100) } }] },
};

const avec = (l: Ledger, f: PlannedFlow = ORDRE): Ledger => ({ ...l, plannedFlows: [...l.plannedFlows.filter((x) => x.id !== f.id), f] });
const livret = (l: Ledger) => computePlan(l, LECTURE).transfers.find((t) => t.accountId === LIVRET)!;
const alertesOrdre = (l: Ledger) => computePlan(l, LECTURE).warnings.filter((w) => w.code === 'bankOrderDrift' || w.code === 'bankOrderPartDrift');
/** L'ordre gardé, sur le budget `l`. */
const garder = (l: Ledger, f: PlannedFlow = ORDRE): PlannedFlow => keepStandingOrder(livret(avec(l, f)), f)!;

describe('[niveau 4] #205 · 1 et 2. garder l’ordre tel quel ne réécrit rien', () => {
  it('le geste n’existe que sur un écart proposé, et garde montant et ventilation au centime', () => {
    const dans = { ...ORDRE, amount: -euros(300) };
    expect(keepStandingOrder(livret(avec(budget(), dans)), dans), 'dans le pas : rien à garder').toBeUndefined();
    const g = garder(budget());
    expect(g.amount).toBe(ORDRE.amount);
    expect(g.action).toEqual(ORDRE.action);
    expect(g.kept).toEqual({ amount: euros(300), parts: [{ tirelireId: 'taxe', amount: euros(100) }] });
  });
});

describe('[niveau 4] #205 · 3 et 4. l’écart reste lisible, à surveiller, sans avertissement', () => {
  it('le montant enregistré et demandé se lisent ; aucun avertissement d’ordre', () => {
    const l = budget();
    expect(alertesOrdre(avec(l))).toHaveLength(1);
    const g = avec(l, garder(l));
    const t = livret(g);
    expect(t.bankOrder).toMatchObject({ kept: true, signaled: true, amount: euros(250) });
    expect(t.permanent).toBe(euros(300));
    expect(alertesOrdre(g)).toEqual([]);
  });

  it('une part fixe hors du pas : la part enregistrée et la part demandée se lisent ; aucun avertissement de part', () => {
    const l = budget(200, euros(10));
    const partHors = { ...ORDRE, amount: -euros(300), action: { allocation: [{ tirelireId: 'taxe', share: { kind: 'fixed' as const, amount: -euros(50) } }] } };
    expect(alertesOrdre(avec(l, partHors)).map((w) => w.code)).toEqual(['bankOrderPartDrift']);
    const g = avec(l, garder(l, partHors));
    expect(livret(g).bankOrder!.parts[0]).toMatchObject({ amount: euros(50), requested: euros(100), signaled: true });
    expect(alertesOrdre(g)).toEqual([]);
  });

  it('un ordre que le budget ne demande plus se garde, sans avertissement', () => {
    const l = budget();
    l.tirelires.forEach((t) => (t.placement = []));
    const g = avec(l, garder(l));
    expect(livret(g).bankOrder).toMatchObject({ kept: true });
    expect(alertesOrdre(g)).toEqual([]);
  });
});

describe('[niveau 4] #205 · 5. reprendre la proposition', () => {
  it('rend l’écart à faire, avec son avertissement, l’ordre inchangé', () => {
    const l = budget();
    const repris = resumeStandingOrderProposal(garder(l));
    expect(repris).toEqual(ORDRE);
    expect(alertesOrdre(avec(l, repris))).toHaveLength(1);
  });
});

describe('[niveau 4] #205 · 6. le choix vaut pour l’écart tel qu’il était proposé', () => {
  it('dans le pas autour de la valeur gardée, l’écart reste à surveiller ; au-delà, dans un sens comme dans l’autre, il redevient à faire', () => {
    const g = garder(budget());
    for (const [vac, tient] of [[205, true], [210, true], [190, true], [211, false], [189, false]] as const) {
      const l = avec(budget(vac), g);
      expect(livret(l).bankOrder!.kept ?? false, `vacances à ${vac} €`).toBe(tient);
      expect(alertesOrdre(l).length > 0, `vacances à ${vac} €`).toBe(!tient);
      expect(lapsedKeptOrders(l, LECTURE).map((f) => f.id), `vacances à ${vac} €`).toEqual(tient ? [] : ['o']);
    }
  });

  it('une part fixe demandée qui s’éloigne de plus du pas met fin au choix', () => {
    const l = budget();
    const g = { ...garder(l), kept: { amount: euros(300), parts: [{ tirelireId: 'taxe', amount: euros(80) }] } };
    expect(livret(avec(l, g)).bankOrder!.kept).toBeUndefined();
  });

  it('un ordre que le budget ne demandait plus : le choix cesse dès que le budget en demande un', () => {
    const sans = budget();
    sans.tirelires.forEach((t) => (t.placement = []));
    const g = garder(sans);
    expect(g.kept!.amount).toBe(0);
    expect(livret(avec(budget(), g)).bankOrder!.kept).toBeUndefined();
    expect(lapsedKeptOrders(avec(budget(), g), LECTURE)).toHaveLength(1);
  });
});

describe('[niveau 4] #205 · 7. le choix cesse quand l’ordre est confirmé ou que l’écart disparaît', () => {
  it('confirmer le nouvel ordre retire le choix', () => {
    const l = avec(budget(), garder(budget()));
    const t = livret(l);
    const conf = standingTransferFlow(computePlan(l, LECTURE), t, CC, 'x', t.proposal!.amount, l.plannedFlows.find((f) => f.id === 'o'));
    expect(conf!.kept).toBeUndefined();
  });

  it('l’écart qui disparaît rend le choix caduc, et un écart qui revient se propose de nouveau', () => {
    const g = garder(budget());
    const rejoint = avec(budget(150), g); // le budget demande 250, l'ordre aussi : plus d'écart
    const [cesse] = lapsedKeptOrders(rejoint, LECTURE);
    expect(cesse!.kept).toBeUndefined();
    expect(alertesOrdre(avec(budget(), cesse!))).toHaveLength(1);
  });
});

describe('[niveau 4] #205 · 8. le choix est une donnée : fichier, budget JSON, synchronisation', () => {
  it('il survit à la réouverture du fichier, à l’export et à l’import du budget JSON, et passe par la synchronisation', async () => {
    const g = garder(budget());
    const a = await LedgerStore.create({ sqlJs: SQL, siteId: 'a' });
    for (const x of budget().accounts) a.upsert('accounts', x);
    for (const x of budget().tirelires) a.upsert('tirelires', x);
    a.upsert('plannedFlows', g);
    const rouvert = await LedgerStore.create({ sqlJs: SQL, bytes: a.export() });
    expect(rouvert.load().plannedFlows.find((f) => f.id === 'o')!.kept).toEqual(g.kept);

    const json = ecrireBudgetJson(a.load());
    const vierge = await LedgerStore.create({ sqlJs: SQL, siteId: 'c' });
    const lu = importerBudgetJson(JSON.stringify(json), vierge.load());
    expect(lu.ok).toBe(true);
    if (lu.ok) appliquerBudget(vierge, lu.application);
    expect(vierge.load().plannedFlows.find((f) => f.id === 'o')!.kept).toEqual(g.kept);

    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'b' });
    importBundle(b, exportBundle(a));
    expect(b.load().plannedFlows.filter((f) => f.id === 'o')).toEqual([g]);
  });
});
