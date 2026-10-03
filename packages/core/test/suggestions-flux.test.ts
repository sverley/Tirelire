import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  alive,
  budgetSuggestions,
  computePlan,
  emptyLedger,
  euros,
  exampleLedger,
  suggestedFlow,
  type FlowSuggestion,
} from '../src/index.js';

/**
 * Tests du codeur de #213 — « L'assistant propose tous les revenus et toutes les charges fixes de
 * l'exemple, versions datées comprises » : la lecture de ces flux dans l'exemple par
 * `budgetSuggestions`, et le flux qu'en fait `suggestedFlow` (`src/suggestions.ts`), sans navigateur.
 * Ce qui se voit à l'écran — les lignes des étapes, leur date, les raccourcis, ce que la validation
 * laisse dans Flux prévus — est dans `apps/web/test/navigateur/assistant-flux-exemple.test.ts`.
 *
 * Chaque test dit, dans son titre, le point du « Fait quand » qu'il vérifie.
 */
const exemple = exampleLedger();
const fluxDeLExemple = alive(exemple.plannedFlows).filter((f) => f.kind === 'income' || f.kind === 'fixedCharge');
const s = budgetSuggestions('2026-09-06');
type Genre = 'income' | 'fixedCharge';
const propositions: Array<[FlowSuggestion, Genre]> = [
  ...s.incomes.map((p): [FlowSuggestion, Genre] => [p, 'income']),
  ...s.charges.map((p): [FlowSuggestion, Genre] => [p, 'fixedCharge']),
];
const noms = (liste: FlowSuggestion[]) => liste.map((p) => p.name);

describe('[niveau 4] #213 · 1 — tous les flux de revenu et de charge fixe de l’exemple sont proposés, et eux seuls, versions datées comprises', () => {
  it('quatre revenus, dans l’ordre de l’exemple : les deux « Salaire », « Loyer locatif », « Allocations »', () => {
    expect(noms(s.incomes)).toEqual(['Salaire', 'Salaire', 'Loyer locatif', 'Allocations']);
  });

  it('quatre charges fixes : « Crédit immobilier », « Assurance habitation », « Internet et mobiles », « Électricité »', () => {
    expect(noms(s.charges)).toEqual(['Crédit immobilier', 'Assurance habitation', 'Internet et mobiles', 'Électricité']);
  });

  it('eux seuls : ni l’ordre permanent vers le Livret A ni l’échéance de la taxe foncière, qui relèvent de #336', () => {
    const tous = [...noms(s.incomes), ...noms(s.charges)];
    expect(tous).toHaveLength(8);
    expect(tous).not.toContain('Virement Livret A');
    expect(tous).not.toContain('Taxe foncière (prélèvement)');
  });

  it('autant de propositions que de flux de ces deux genres dans l’exemple : rien n’est laissé de côté', () => {
    expect(s.incomes).toHaveLength(fluxDeLExemple.filter((f) => f.kind === 'income').length);
    expect(s.charges).toHaveLength(fluxDeLExemple.filter((f) => f.kind === 'fixedCharge').length);
  });

  it('les propositions de flux ne dépendent pas de la date de lecture : toutes les versions, à toute date', () => {
    for (const date of ['2026-01-15', '2026-11-15', '2027-06-01']) {
      expect(budgetSuggestions(date).incomes, date).toEqual(s.incomes);
      expect(budgetSuggestions(date).charges, date).toEqual(s.charges);
    }
  });
});

describe('[niveau 4] #213 · 2 — chaque flux arrive avec ce que l’exemple en dit : nom, montant, rythme, jour ou date, compte, premières occurrences, dates, et ce que l’étape ne montre pas', () => {
  it('le flux que crée une proposition est celui de l’exemple, champ pour champ — hors identité, compte du projet et catégorie (#212)', () => {
    for (const [p, genre] of propositions) {
      const dans = fluxDeLExemple.find((f) => f.name === p.name && f.periodicity.anchorDate === p.anchorDate)!;
      expect(dans, `${p.name} : pas de flux de l’exemple à cette date`).toBeDefined();
      const attendu = { ...dans };
      delete attendu.categoryId;
      expect(suggestedFlow(p, genre, { id: dans.id, accountId: dans.accountId }), `${p.name} (${p.anchorDate})`).toEqual(attendu);
    }
  });

  it('le montant se propose en positif : le signe est celui du genre, un revenu est un crédit et une charge fixe un débit', () => {
    for (const [p, genre] of propositions) {
      expect(p.amount, p.name).toBeGreaterThan(0);
      const flux = suggestedFlow(p, genre, { id: 'x', accountId: 'cpt' });
      expect(flux.amount, p.name).toBe(genre === 'income' ? p.amount : -p.amount);
    }
    expect(suggestedFlow(s.charges[0]!, 'fixedCharge', { id: 'x', accountId: 'cpt' }).amount).toBe(euros(-950));
  });

  it('les premières occurrences sont aux dates de l’exemple, sans décalage au jour de lecture, et le jour du mois s’en déduit', () => {
    expect(propositions.map(([p]) => [p.name, p.anchorDate, p.day, p.interval, p.unit])).toEqual([
      ['Salaire', '2026-08-28', 28, 1, 'month'],
      ['Salaire', '2026-10-28', 28, 1, 'month'],
      ['Loyer locatif', '2026-09-05', 5, 1, 'month'],
      ['Allocations', '2026-09-05', 5, 1, 'month'],
      ['Crédit immobilier', '2026-09-05', 5, 1, 'month'],
      ['Assurance habitation', '2026-09-10', 10, 1, 'month'],
      ['Internet et mobiles', '2026-09-12', 12, 1, 'month'],
      ['Électricité', '2026-09-15', 15, 1, 'month'],
    ]);
  });

  it('ce que l’étape ne montre pas arrive tel que l’exemple le dit : fenêtre, tolérance de montant, motif de libellé, montant variable', () => {
    const detail = (p: FlowSuggestion) => ({
      fenetre: p.dateWindowDays,
      tolerance: p.amountTolerance,
      motif: p.labelPattern,
      variable: p.variable,
    });
    const salaire = { fenetre: 3, tolerance: { pct: 10 }, motif: 'VIR(EMENT)? .*SALAIRE', variable: true };
    expect(propositions.map(([p]) => detail(p))).toEqual([
      salaire,
      salaire,
      { fenetre: 5, tolerance: undefined, motif: 'LOYER', variable: undefined },
      { fenetre: 5, tolerance: undefined, motif: 'CAF', variable: undefined },
      { fenetre: 3, tolerance: undefined, motif: 'ECHEANCE PRET', variable: undefined },
      { fenetre: 3, tolerance: undefined, motif: undefined, variable: undefined },
      { fenetre: 3, tolerance: undefined, motif: undefined, variable: undefined },
      { fenetre: 4, tolerance: { pct: 30 }, motif: undefined, variable: true },
    ]);
  });

  it('le compte : l’exemple met ces huit flux sur le compte principal, aucune proposition ne nomme donc un autre compte', () => {
    const principal = alive(exemple.accounts).find((a) => a.kind === 'principal')!;
    for (const f of fluxDeLExemple) expect(f.accountId, f.name).toBe(principal.id);
    for (const [p] of propositions) expect(p.accountName, p.name).toBeUndefined();
  });

  it('la catégorie n’est pas une proposition : le flux créé n’en porte pas (#212)', () => {
    for (const [p, genre] of propositions) expect(suggestedFlow(p, genre, { id: 'x', accountId: 'cpt' }).categoryId, p.name).toBeUndefined();
  });

  it('une proposition ne partage rien avec l’exemple : corriger le flux créé ne touche pas la proposition suivante', () => {
    const salaire = s.incomes[0]!;
    const flux = suggestedFlow(salaire, 'income', { id: 'x', accountId: 'cpt' });
    flux.amountTolerance!.pct = 99;
    expect(budgetSuggestions('2026-09-06').incomes[0]!.amountTolerance).toEqual({ pct: 10 });
    expect(salaire.amountTolerance).toEqual({ pct: 10 });
  });
});

describe('[niveau 4] #213 · 3 — une ligne dont l’exemple borne la validité le dit : jusqu’au 27/10/2026, à partir du 28/10/2026, jusqu’au 05/12/2026', () => {
  it('« Salaire » se propose en deux versions du même nom, chacune avec sa date', () => {
    const salaires = s.incomes.filter((p) => p.name === 'Salaire');
    expect(salaires.map((p) => ({ montant: p.amount, de: p.activeFrom, a: p.activeTo }))).toEqual([
      { montant: euros(3400), de: undefined, a: '2026-10-27' },
      { montant: euros(3550), de: '2026-10-28', a: undefined },
    ]);
  });

  it('« Crédit immobilier » porte sa dernière échéance : jusqu’au 05/12/2026', () => {
    const credit = s.charges.find((p) => p.name === 'Crédit immobilier')!;
    expect({ de: credit.activeFrom, a: credit.activeTo }).toEqual({ de: undefined, a: '2026-12-05' });
  });

  it('les autres flux ne portent aucune borne : l’exemple n’en dit pas', () => {
    const bornes = propositions.filter(([p]) => p.activeFrom !== undefined || p.activeTo !== undefined).map(([p]) => p.name);
    expect(bornes).toEqual(['Salaire', 'Salaire', 'Crédit immobilier']);
  });

  it('les bornes arrivent dans le flux créé, où Flux prévus les lit et les modifie (D23, I11)', () => {
    const flux = propositions.map(([p, genre]) => suggestedFlow(p, genre, { id: p.name + p.anchorDate, accountId: 'cpt' }));
    expect(flux.map((f) => [f.name, f.activeFrom, f.activeTo])).toEqual([
      ['Salaire', undefined, '2026-10-27'],
      ['Salaire', '2026-10-28', undefined],
      ['Loyer locatif', undefined, undefined],
      ['Allocations', undefined, undefined],
      ['Crédit immobilier', undefined, '2026-12-05'],
      ['Assurance habitation', undefined, undefined],
      ['Internet et mobiles', undefined, undefined],
      ['Électricité', undefined, undefined],
    ]);
  });
});

describe('[niveau 4] #213 · 4 — le bandeau ne compte, pour la période en cours, que les versions en vigueur au début de celle-ci, comme le Plan (D50)', () => {
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

describe('[niveau 4] #213 · 6 — ces propositions viennent de l’exemple et de lui seul', () => {
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
