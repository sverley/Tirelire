/**
 * Harnais d'audit de #213 — « L'assistant propose tous les revenus et toutes les charges fixes de l'exemple, versions
 * datées comprises », côté cœur, sans navigateur : les points 4 et 6 du « Fait quand ». Les autres points sont dans
 * `apps/web/test/assistant-flux-exemple-ecran.test.ts`, sur l'application montée sans navigateur (#417).
 *
 * Retenus parmi les tests du codeur (`suggestions-flux.test.ts`, d'où ils sont déplacés) :
 *  - point 4 : ce que compte le bandeau, lu par le calcul du Plan, à cinq périodes — là où l'écran n'en joue qu'une
 *    (septembre) : le salaire qui change, le crédit qui s'arrête ;
 *  - point 6 : un flux ajouté à l'exemple est proposé sans autre écriture, avec tout ce que l'exemple en dit — ce
 *    qu'aucun test d'écran ne peut jouer, l'exemple étant celui du site construit. Sa première phrase (« le test des
 *    propositions échoue si… ») est tranchée par `suggestions.test.ts`, que le codeur a étendu aux flux.
 *
 * Niveaux (D83) : 2 pour les deux. Le point 4 est D50 (un besoin, comme un flux, s'applique à une période s'il est en
 * vigueur le premier jour de celle-ci) ; le point 6 est D43 (les propositions n'ont aucun contenu propre : elles sont une
 * lecture de l'exemple). Un total faux ou un flux oublié en est un cas faux, l'usage restant possible.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alive, budgetSuggestions, computePlan, emptyLedger, euros, exampleLedger, suggestedFlow, type FlowSuggestion } from '../src/index.js';

const exemple = exampleLedger();
const s = budgetSuggestions('2026-09-06');
type Genre = 'income' | 'fixedCharge';
const propositions: Array<[FlowSuggestion, Genre]> = [
  ...s.incomes.map((p): [FlowSuggestion, Genre] => [p, 'income']),
  ...s.charges.map((p): [FlowSuggestion, Genre] => [p, 'fixedCharge']),
];

describe('[niveau 2] #213 · point 4 — le bandeau ne compte, pour la période en cours, que les versions en vigueur au début de celle-ci, comme le Plan (D50)', () => {
  // L'assistant lit son brouillon avec le calcul du Plan : les flux que les raccourcis écrivent, lus par `computePlan`.
  const principal = alive(exemple.accounts).find((a) => a.kind === 'principal')!;
  function brouillon() {
    const l = emptyLedger({ periodStartDay: exemple.settings.periodStartDay });
    l.accounts.push({ ...principal });
    propositions.forEach(([p, genre], i) => l.plannedFlows.push(suggestedFlow(p, genre, { id: `prop-${i}`, accountId: principal.id })));
    return l;
  }
  const totaux = (date: string) => {
    const t = computePlan(brouillon(), date).totals;
    return { revenus: t.incomes, charges: t.fixedCharges };
  };

  it('en septembre, une seule version du salaire compte : 3 400 €, et non les deux versions ensemble', () => {
    // 3 400 (salaire) + 700 (loyer perçu) + 100 (allocations) ; 950 + 45 + 75 + 150.
    expect(totaux('2026-09-06')).toEqual({ revenus: euros(4200), charges: euros(1220) });
  });

  it('à la période de novembre, c’est la version à 3 550 € qui compte, seule ; le crédit court encore', () => {
    expect(totaux('2026-11-15')).toEqual({ revenus: euros(4350), charges: euros(1220) });
  });

  it('à la période de janvier, le crédit ne compte plus : sa dernière échéance est le 5 décembre', () => {
    expect(totaux('2027-01-15')).toEqual({ revenus: euros(4350), charges: euros(270) });
  });

  it('à chaque période, mêmes totaux que le Plan de l’exemple lui-même', () => {
    for (const date of ['2026-09-06', '2026-10-15', '2026-11-15', '2026-12-15', '2027-01-15']) {
      const plan = computePlan(exemple, date).totals;
      expect(totaux(date), date).toEqual({ revenus: plan.incomes, charges: plan.fixedCharges });
    }
  });
});

describe('[niveau 2] #213 · point 6 — ces propositions viennent de l’exemple et de lui seul (D43)', () => {
  afterEach(() => {
    vi.doUnmock('../src/example.js');
    vi.resetModules();
  });

  it('un flux de revenu ou de charge fixe ajouté à l’exemple est proposé sans autre écriture, avec tout ce que l’exemple en dit', async () => {
    vi.resetModules();
    vi.doMock('../src/example.js', async () => {
      const reel = await vi.importActual<typeof import('../src/example.js')>('../src/example.js');
      return {
        ...reel,
        exampleLedger: () => {
          const l = reel.exampleLedger();
          l.plannedFlows.push({
            id: 'flow-cantine',
            name: 'Cantine',
            kind: 'fixedCharge',
            amount: -6000,
            accountId: 'acc-enfants',
            periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-08' },
            dateWindowDays: 2,
            labelPattern: 'CANTINE',
            activeTo: '2027-06-30',
          });
          return l;
        },
      };
    });
    const { budgetSuggestions: lire } = await import('../src/suggestions.js');
    const cantine = lire('2026-09-06').charges.find((p) => p.name === 'Cantine');
    expect(cantine, 'le flux ajouté à l’exemple n’est pas proposé').toBeDefined();
    expect(cantine).toMatchObject({
      amount: 6000,
      day: 8,
      anchorDate: '2026-09-08',
      dateWindowDays: 2,
      labelPattern: 'CANTINE',
      activeTo: '2027-06-30',
      accountName: 'Carte enfants',
    });
    expect(lire('2026-09-06').charges).toHaveLength(5);
  });
});
