/**
 * Harnais d'audit de #320, côté cœur — la lecture du budget que le Bilan affiche (`readBudgetAhead`) :
 * points 1, 2, 3 et 7 du « Fait quand ». Elle ne calcule rien de propre : chaque période est le Plan de
 * cette période, lu à la même date, et les échéances en manque sont celles que le Plan annonce (D78).
 * Ce qui se voit à l'écran est dans `apps/web/test/navigateur/bilan-budget-harnais.test.ts`.
 *
 * Retenus parmi les tests du codeur (`lecture-budget.test.ts`, d'où ils sont déplacés), sans changer ce
 * qu'ils affirment : montants, périodes et états relus dans le Plan, sur l'exemple lu au 6 septembre.
 *
 * Niveaux (D83) : tous à 2. Chacun garde une règle métier — la lecture de D06, D29 et D52, le manque et
 * sa réponse de #184 —, nominale comme limite : un résultat faux, l'usage restant possible. Aucun n'est
 * de niveau 0 (la lecture ne modifie rien) ni de niveau 1 (aucun identifiant du registre ne s'y lit tel
 * qu'écrit) : pas de témoin rouge exigé.
 */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  computePlan,
  dueDateShortfalls,
  emptyLedger,
  exampleLedger,
  hasBudget,
  readBudgetAhead,
  refusalAnswer,
  type Ledger,
} from '../src/index.js';

const LECTURE = '2026-09-06';

/** L'exemple sans le lissage décidé de la taxe foncière : son échéance est en manque, sans réponse. */
function sansReponse(): Ledger {
  const l = exampleLedger();
  l.shortfallAnswers = [];
  l.operations = l.operations.filter((o) => o.id !== 'op-lissage-tf');
  l.subOperations = l.subOperations.filter((s) => s.operationId !== 'op-lissage-tf');
  return l;
}

/** L'exemple dont les revenus ne couvrent plus tout : chaque revenu réduit au tiers. */
function revenusReduits(): Ledger {
  const l = exampleLedger();
  l.plannedFlows = l.plannedFlows.map((f) => (f.kind === 'income' ? { ...f, amount: Math.round(f.amount / 3) } : f));
  return l;
}

describe('[niveau 2] #320 · point 1 — le budget, période par période, tel que le Plan le dit', () => {
  it('sur l’exemple lu au 6 septembre, la première période redonne le budget de référence d’U1', () => {
    const r = readBudgetAhead(exampleLedger(), LECTURE, 6)!;
    const p = r.periods[0]!;
    expect(p.period.start).toBe('2026-08-28');
    expect(p.period.end).toBe('2026-09-27');
    expect(p.totals).toEqual({ incomes: 420000, fixedCharges: 122000, requested: 235000, funded: 235000, margin: 63000 });
    expect(p.uncovered).toEqual([]);
  });

  it.each([3, 6, 12])('%i périodes : la période en cours et les suivantes, chacune égale au Plan lu à la même date', (n) => {
    const l = exampleLedger();
    const r = readBudgetAhead(l, LECTURE, n)!;
    expect(r.periods).toHaveLength(n);
    expect(r.periods[0]!.period.start <= LECTURE && LECTURE <= r.periods[0]!.period.end).toBe(true);
    for (let i = 0; i < n; i++) {
      const p = r.periods[i]!;
      if (i > 0) expect(p.period.start).toBe(addDays(r.periods[i - 1]!.period.end, 1));
      // Lue comme l'écran Plan la lit : à la date de lecture dans la période en cours, au premier jour au-delà.
      expect(p.asOf).toBe(i === 0 ? LECTURE : p.period.start);
      const plan = computePlan(l, p.asOf, LECTURE);
      expect(p.period).toEqual(plan.period);
      expect(p.totals.incomes).toBe(plan.totals.incomes);
      expect(p.totals.fixedCharges).toBe(plan.totals.fixedCharges);
      expect(p.totals.requested).toBe(plan.totals.requested);
      expect(p.totals.funded).toBe(plan.totals.funded);
      expect(p.totals.margin).toBe(plan.totals.margin);
      expect(p.needs.map((x) => [x.needId, x.requested, x.funded, x.status])).toEqual(plan.lines.map((x) => [x.needId, x.requested, x.funded, x.status]));
    }
  });
});

describe('[niveau 2] #320 · point 2 — les besoins non couverts, nommés avec leur montant, comme le Plan les signale', () => {
  it('chaque besoin que le Plan signale « n’est pas couverte » ou « n’est couverte qu’en partie » est nommé, avec demandé − couvert', () => {
    const l = revenusReduits();
    const r = readBudgetAhead(l, LECTURE, 6)!;
    let vus = 0;
    for (const p of r.periods) {
      const plan = computePlan(l, p.asOf, LECTURE);
      const signales = plan.warnings.filter((w) => w.code === 'unfunded' || w.code === 'reduced').map((w) => w.needId);
      expect(p.uncovered.map((n) => n.needId).sort()).toEqual([...signales].sort());
      for (const n of p.uncovered) {
        const ligne = plan.lines.find((x) => x.needId === n.needId)!;
        expect(n.uncovered).toBe(ligne.requested - ligne.funded);
        expect(n.uncovered).toBeGreaterThan(0);
        expect(['unfunded', 'reduced']).toContain(n.status);
      }
      vus += p.uncovered.length;
    }
    expect(vus).toBeGreaterThan(0);
  });

  it('une période entièrement couverte ne nomme aucun besoin, et le détail porte tous les besoins de la période', () => {
    const r = readBudgetAhead(exampleLedger(), LECTURE, 3)!;
    for (const p of r.periods) {
      expect(p.uncovered).toEqual([]);
      expect(p.needs.length).toBeGreaterThan(0);
      expect(p.needs.every((n) => n.uncovered === 0)).toBe(true);
    }
  });
});

describe('[niveau 2] #320 · point 3 — les échéances en manque des périodes lues, une fois chacune, avec leur réponse', () => {
  it('sans réponse : la taxe foncière du 15 octobre paraît dès que la deuxième période est lue, comme le Plan l’annonce', () => {
    const l = sansReponse();
    const plan = dueDateShortfalls(l, LECTURE).find((s) => s.needId === 'need-tf')!;
    expect(readBudgetAhead(l, LECTURE, 1)!.shortfalls.map((s) => s.needId)).not.toContain('need-tf');
    for (const n of [3, 6, 12]) {
      const tf = readBudgetAhead(l, LECTURE, n)!.shortfalls.filter((s) => s.needId === 'need-tf');
      expect(tf).toHaveLength(1);
      expect(tf[0]).toEqual(plan);
      expect(tf[0]!.answer).toBeUndefined();
      expect(tf[0]!.amount).toBeGreaterThan(0);
    }
  });

  it('l’état de la réponse suit : lissage décidé (l’exemple), refus', () => {
    const decide = readBudgetAhead(exampleLedger(), LECTURE, 3)!.shortfalls.find((s) => s.needId === 'need-tf')!;
    expect(decide.answer?.kind).toBe('smoothing');
    const l = sansReponse();
    l.shortfallAnswers = [refusalAnswer('need-tf', '2026-10-15')];
    const refus = readBudgetAhead(l, LECTURE, 3)!.shortfalls.find((s) => s.needId === 'need-tf')!;
    expect(refus.answer?.kind).toBe('refusal');
  });

  it('chaque échéance retenue tombe dans les périodes lues, une seule fois', () => {
    const r = readBudgetAhead(sansReponse(), LECTURE, 12)!;
    const debut = r.periods[0]!.period.start;
    const fin = r.periods.at(-1)!.period.end;
    for (const s of r.shortfalls) expect(s.dueDate >= debut && s.dueDate <= fin).toBe(true);
    expect(new Set(r.shortfalls.map((s) => s.needId + s.dueDate)).size).toBe(r.shortfalls.length);
  });
});

describe('[niveau 2] #320 · point 7 — sans aucun besoin, rien à lire du budget', () => {
  it('une base vide, ou des opérations sans aucun besoin, n’ont rien à lire', () => {
    const vide = emptyLedger();
    expect(hasBudget(vide)).toBe(false);
    expect(readBudgetAhead(vide, LECTURE, 6)).toBeUndefined();
    const sansBesoin = exampleLedger();
    sansBesoin.needs = [];
    expect(hasBudget(sansBesoin)).toBe(false);
    expect(readBudgetAhead(sansBesoin, LECTURE, 6)).toBeUndefined();
  });
});
