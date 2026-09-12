/**
 * Parcours de bout en bout de **U1 · budget seul** (#15, #70).
 *
 * L'usage : quelqu'un qui ne branchera jamais sa banque décrit ses tirelires, leurs besoins et où
 * l'argent doit dormir, et obtient un budget, des dotations et des virements à faire. Le parcours
 * part donc d'une base vide, écrit ce budget comme l'application l'écrit, le relit après
 * redémarrage, et vérifie que **le plan de la période en cours se lit entièrement sans une seule
 * opération**.
 *
 * Ce qu'il ajoute aux harnais unitaires : ceux-ci éprouvent un calcul sur un grand livre déjà
 * constitué ; ici la base part vide et rien n'est importé ni saisi, ce qui est précisément la
 * condition que U1 doit tenir. Ce qu'il ne garde pas : ce que montrent les écrans — cela reste à
 * `VM-U1-parcours`.
 */
import { describe, expect, it } from 'vitest';
import { computePlan, euros, historyStart, lastPeriods, reviewCategories, type Plan } from '../src/index.js';
import { AS_OF, DEBUT, PAIE, baseVide, ecrireLeBudget, relire } from './parcours.js';

/**
 * Ce que le plan doit dire, sans aucune opération : les revenus et les charges déclarés, une ligne
 * par besoin dotée, le lissage de l'échéance, une marge lisible, et le virement à faire vers le
 * livret avec le détail de ce qu'il finance.
 */
function leParcoursSeLit(plan: Plan): void {
  expect(plan.period.start).toBe(DEBUT);
  expect(plan.totals.incomes).toBe(euros(2400));
  // Les totaux comptent les charges fixes en positif (ce qu'elles coûtent).
  expect(plan.totals.fixedCharges).toBe(euros(750));

  const parNom = new Map(plan.lines.map((l) => [l.tirelireName, l]));
  expect([...parNom.keys()].sort()).toEqual(['Courses', 'Taxe foncière', 'Vacances']);
  for (const l of plan.lines) expect(l.requested, `« ${l.tirelireName} » n'est pas dotée`).toBeGreaterThan(0);

  // Le budget courant est hébergé sur le compte principal : sa dotation y reste, sans virement.
  const courses = parNom.get('Courses')!;
  expect(courses.virtual).toBe(true);
  expect(courses.requested).toBe(euros(500));

  // L'échéance se lisse sur les périodes qui la précèdent (D02), sans le moindre historique.
  const taxe = parNom.get('Taxe foncière')!;
  expect(taxe.virtual).toBe(false);
  expect(taxe.cruise).toBe(euros(100));
  expect(taxe.catchUp).toBeGreaterThan(taxe.cruise);
  expect(taxe.requested).toBe(taxe.catchUp);

  expect(plan.totals.requested).toBe(plan.lines.reduce((s, l) => s + l.requested, 0));
  expect(plan.totals.funded).toBe(plan.totals.requested);
  expect(plan.totals.margin).toBe(plan.totals.incomes - plan.totals.fixedCharges - plan.totals.funded);
  expect(plan.totals.margin).toBeGreaterThan(0);

  // « Et des virements à faire » : un ordre par compte cible (D21), avec ce qu'il finance.
  const [virement, ...autres] = plan.transfers;
  expect(autres).toEqual([]);
  expect(virement, 'aucun virement proposé vers le livret').toBeDefined();
  expect(virement!.accountName).toBe('Livret A');
  expect(virement!.label).toBe('TIRELIRE LIVRET A');
  expect(virement!.permanent).toBeGreaterThan(0);
  expect(virement!.breakdown.map((b) => b.tirelireName).sort()).toEqual(['Taxe foncière', 'Vacances']);
  expect(virement!.breakdown.reduce((s, b) => s + b.cruise, 0)).toBe(virement!.permanent);

  const gênants = ['noPrincipal', 'noIncome', 'negativeMargin', 'unfunded'];
  expect(plan.warnings.map((w) => w.code).filter((c) => gênants.includes(c))).toEqual([]);
}

/**
 * Version volontairement cassée : un plan dont les dotations viennent de ce que les opérations
 * montrent, et non des besoins déclarés. Sans import, tout y tombe à zéro — c'est le « mode
 * dégradé » que D57 et I3 refusent.
 */
function planDeLObservé(plan: Plan): Plan {
  return {
    ...plan,
    lines: plan.lines.map((l) => ({ ...l, cruise: 0, catchUp: 0, requested: 0, funded: 0 })),
    transfers: plan.transfers.map((t) => ({ ...t, permanent: 0, standing: 0, breakdown: t.breakdown.map((b) => ({ ...b, cruise: 0 })) })),
    totals: { ...plan.totals, requested: 0, funded: 0, margin: plan.totals.incomes - plan.totals.fixedCharges },
  };
}

describe('U1 · budget seul, de bout en bout (#15)', () => {
  it('parcours U1 · de la base vide au plan, sans une seule opération', async () => {
    const store = await baseVide('parcours-u1');
    expect(store.load().tirelires, 'la base ne part pas vide').toEqual([]);

    ecrireLeBudget(store);
    const ledger = await relire(store, 'parcours-u1');
    store.close();

    // Rien n'a été importé ni saisi : c'est la condition de l'usage, pas un détail du cas.
    expect(ledger.operations).toEqual([]);
    expect(ledger.allocations).toEqual([]);
    expect(ledger.settings.periodStartDay).toBe(PAIE);
    expect(ledger.tirelires).toHaveLength(3);

    leParcoursSeLit(computePlan(ledger, AS_OF));

    // Le bilan ne fabrique pas d'observé : aucun historique, aucune moyenne — mais la cible du
    // budget s'y lit déjà (« ce qui est prévu », #15).
    expect(historyStart(ledger)).toBeUndefined();
    const bilan = reviewCategories(ledger, lastPeriods(ledger, AS_OF, 3));
    for (const c of bilan) {
      expect(c.totalSpent, `« ${c.name} » montre une dépense sans opération`).toBe(0);
      expect(c.avg3).toBe(0);
    }
    expect(bilan.filter((c) => c.target !== undefined).map((c) => c.target)).toEqual([euros(500)]);
  });

  it.fails('témoin rouge · un plan dont les dotations viennent de ce que les opérations montrent', async () => {
    const store = await baseVide('parcours-u1-témoin');
    ecrireLeBudget(store);
    const ledger = store.load();
    store.close();
    leParcoursSeLit(planDeLObservé(computePlan(ledger, AS_OF)));
  });
});
