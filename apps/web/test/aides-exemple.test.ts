/**
 * Tests du codeur de #214 — « Les aides des champs viennent de l'exemple » : la lecture de l'exemple
 * qui donne leurs aides aux champs (`src/lib/aides.ts`), sans navigateur — la ligne d'aide de chaque
 * étape de l'assistant, la reconnaissance d'un formulaire qui recopie ses aides, et les aides des
 * formulaires hors de l'assistant. Ce qui se voit à l'écran, et le geste de recopier, est dans
 * `navigateur/aides-exemple-harnais.test.ts`.
 *
 * Chaque test dit, dans son titre, le point du « Fait quand » qu'il vérifie.
 */
import { describe, expect, it } from 'vitest';
import { budgetSuggestions, entrySuggestions, exampleLedger, alive, type FlowSuggestion, type TirelireSuggestion } from '@tirelire/core';
import {
  aideCategorie,
  aideCompte,
  aideCourant,
  aideEpargne,
  aideFlux,
  aidePeriodique,
  aidesDeBesoin,
  aidesDeCategorie,
  aidesDeCompte,
  aidesDeFluxPrevu,
  aidesDeSaisie,
  aidesDeTirelire,
  ligneDAide,
  montantAide,
  parNom,
  recopieCategorie,
  recopieCompte,
  recopieCourant,
  recopieEpargne,
  recopieFlux,
  recopiePeriodique,
} from '../src/lib/aides';

/** Le jour des tests : le Salaire y est à 3 400,00, sa hausse ne vient qu'au 28 octobre. */
const JOUR = '2026-09-20';
const s = budgetSuggestions(JOUR);
const revenus = parNom(s.incomes);
const charges = parNom(s.charges);
const periodiques = s.tirelires.filter((t) => t.needs.some((n) => n.kind === 'dueDate'));
const epargnes = s.tirelires.filter((t) => !t.needs.some((n) => n.kind === 'dueDate') && t.needs.some((n) => n.kind === 'goal'));
const courants = s.tirelires.filter((t) => !t.needs.some((n) => n.kind === 'dueDate' || n.kind === 'goal'));

/** L'utilisateur qui recopie l'aide dans chaque champ, ligne après ligne, jusqu'à vider l'étape : les lignes que ses ajouts reconnaissent, dans l'ordre. */
function viderEnRecopiant<L>(toutes: readonly L[], recopier: (restants: readonly L[]) => L | undefined): L[] {
  let restants = [...toutes];
  const reconnues: L[] = [];
  while (restants.length > 0) {
    const ligne = recopier(restants);
    if (ligne === undefined) throw new Error('le formulaire recopié n’est pas reconnu');
    reconnues.push(ligne);
    restants = restants.filter((x) => x !== ligne);
  }
  return reconnues;
}

describe('[niveau 4] #214 · montant d’une aide — écrit comme on le saisit', () => {
  it('les centimes toujours, un espace entre les milliers', () => {
    expect(montantAide(340000)).toBe('3 400,00');
    expect(montantAide(4500)).toBe('45,00');
    expect(montantAide(0)).toBe('0,00');
    expect(montantAide(120000000)).toBe('1 200 000,00');
  });
});

describe('[niveau 4] #214 · 1 — dans l’assistant, la ligne d’aide est celle du premier raccourci restant, à défaut la première ligne de l’exemple de l’étape', () => {
  it('le premier raccourci restant donne sa ligne ; quand il n’en reste aucun, la première ligne de l’étape ; une étape sans exemple n’en a pas', () => {
    expect(ligneDAide(['b', 'c'], ['a', 'b', 'c'])).toBe('b');
    expect(ligneDAide([], ['a', 'b', 'c'])).toBe('a');
    expect(ligneDAide([], [])).toBeUndefined();
  });

  it('revenus : « Salaire » d’abord, avec ses valeurs — 3 400,00 €, chaque mois, le 28 —, toutes de la version en vigueur', () => {
    const a = aideFlux(revenus, revenus, JOUR)!;
    expect(a).toMatchObject({ name: 'Salaire', amount: 340000, interval: 1, unit: 'month', day: 28 });
    expect(montantAide(a.amount)).toBe('3 400,00');
  });

  it('revenus : une fois « Salaire » ajouté, toutes les aides passent à la ligne suivante, « Loyer locatif » : 700,00 €, le 5', () => {
    const a = aideFlux(revenus.slice(1), revenus, JOUR)!;
    expect(a).toMatchObject({ name: 'Loyer locatif', amount: 70000, interval: 1, unit: 'month', day: 5 });
  });

  it('revenus : plus aucun raccourci, la première ligne de l’exemple de l’étape revient', () => {
    expect(aideFlux([], revenus, JOUR)).toMatchObject({ name: 'Salaire', amount: 340000, day: 28 });
  });

  it('charges : « Crédit immobilier » d’abord (950,00 €, le 5), puis « Assurance habitation » (45,00 €, le 10) une fois le premier ajouté', () => {
    expect(aideFlux(charges, charges, JOUR)).toMatchObject({ name: 'Crédit immobilier', amount: 95000, day: 5 });
    expect(aideFlux(charges.slice(1), charges, JOUR)).toMatchObject({ name: 'Assurance habitation', amount: 4500, day: 10 });
  });

  it('revenus et charges : le nom, le montant, le rythme et le jour d’une aide sont ceux d’une même version d’une même ligne', () => {
    for (const toutes of [revenus, charges]) {
      for (let k = 0; k < toutes.length; k++) {
        const a = aideFlux(toutes.slice(k), toutes, JOUR)!;
        expect(a.ligne.name).toBe(toutes[k]!.name);
        const memeVersion = (v: FlowSuggestion) => v.amount === a.amount && v.interval === a.interval && v.unit === a.unit && v.day === a.day;
        expect(a.ligne.versions.some(memeVersion), `${a.name} : ses aides viennent de plusieurs lignes`).toBe(true);
      }
    }
  });

  it('budgets : « Alimentation » d’abord, 900,00 € et sans report (l’exemple lui en donne aucun) ; « Enfants et loisirs » garde son report', () => {
    expect(aideCourant(courants, courants, JOUR)).toMatchObject({ name: 'Alimentation', amount: 90000, keep: false });
    const enfants = courants.filter((t) => t.name === 'Enfants et loisirs');
    expect(aideCourant(enfants, courants, JOUR)).toMatchObject({ name: 'Enfants et loisirs', amount: 20000, keep: true });
  });

  it('échéances : « Taxe foncière » d’abord — 1 200,00 €, tous les 12 mois, au 15 octobre 2026, avec son prélèvement —, puis « Assurance auto », sans prélèvement', () => {
    const a = aidePeriodique(periodiques, periodiques, JOUR)!;
    expect(a).toMatchObject({ name: 'Taxe foncière', amount: 120000, months: 12, dueDate: '2026-10-15', withFlow: true });
    const b = aidePeriodique(periodiques.slice(1), periodiques, JOUR)!;
    expect(b).toMatchObject({ name: 'Assurance auto', amount: 60000, months: 12, dueDate: '2027-03-05', withFlow: false });
  });

  it('catégories : la première restante, avec sa nature — « Salaire » est un revenu, « Alimentation » une dépense', () => {
    const categories = s.categories;
    expect(aideCategorie(categories, categories)).toMatchObject({ name: 'Salaire', nature: 'income' });
    const restantes = categories.filter((c) => c.name !== 'Salaire' && c.name !== 'Loyer perçu' && c.name !== 'Allocations');
    expect(aideCategorie(restantes, categories)).toMatchObject({ name: 'Alimentation', nature: 'expense' });
  });

  it('comptes : « Livret A » d’abord, avec son type et son solde (4 815,00 €), puis « Carte enfants » quand il est ajouté', () => {
    expect(aideCompte(s.accounts, s.accounts)).toMatchObject({ name: 'Livret A', kind: 'epargne', balance: 481500 });
    expect(aideCompte(s.accounts.slice(1), s.accounts)).toMatchObject({ name: 'Carte enfants', kind: 'courant', balance: 0 });
  });
});

describe('[niveau 4] #214 · 2 — ajouter une ligne dont chaque champ porte la valeur de son aide, c’est ajouter la ligne de l’exemple', () => {
  it('revenus : la saisie qui recopie l’aide est reconnue ; un seul champ qui change ne l’est plus', () => {
    const a = aideFlux(revenus, revenus, JOUR)!;
    const recopiee = { name: a.name, amount: a.amount, interval: a.interval, unit: a.unit, day: a.day, accountId: 'compte' };
    expect(recopieFlux(recopiee, a, 'compte')).toBe(true);
    expect(recopieFlux({ ...recopiee, name: 'Salaire de Jean' }, a, 'compte'), 'nom').toBe(false);
    expect(recopieFlux({ ...recopiee, amount: 340001 }, a, 'compte'), 'montant').toBe(false);
    expect(recopieFlux({ ...recopiee, amount: undefined }, a, 'compte'), 'montant vide').toBe(false);
    expect(recopieFlux({ ...recopiee, interval: 2 }, a, 'compte'), 'rythme').toBe(false);
    expect(recopieFlux({ ...recopiee, unit: 'week' }, a, 'compte'), 'unité').toBe(false);
    expect(recopieFlux({ ...recopiee, day: 27 }, a, 'compte'), 'jour').toBe(false);
    expect(recopieFlux({ ...recopiee, accountId: 'autre' }, a, 'compte'), 'compte').toBe(false);
  });

  it('budgets : le nom, le montant et le report', () => {
    const a = aideCourant(courants, courants, JOUR)!;
    const recopiee = { name: a.name, amount: a.amount, keep: a.keep };
    expect(recopieCourant(recopiee, a)).toBe(true);
    expect(recopieCourant({ ...recopiee, name: 'Courses' }, a), 'nom').toBe(false);
    expect(recopieCourant({ ...recopiee, amount: 1 }, a), 'montant').toBe(false);
    expect(recopieCourant({ ...recopiee, keep: !a.keep }, a), 'report').toBe(false);
  });

  it('échéances : le nom, le montant, le rythme, l’échéance, le prélèvement et son compte', () => {
    const a = aidePeriodique(periodiques, periodiques, JOUR)!;
    const recopiee = { name: a.name, amount: a.amount, months: a.months, dueDate: a.dueDate!, withFlow: a.withFlow, accountId: 'compte' };
    expect(recopiePeriodique(recopiee, a, 'compte')).toBe(true);
    expect(recopiePeriodique({ ...recopiee, name: 'Impôt' }, a, 'compte'), 'nom').toBe(false);
    expect(recopiePeriodique({ ...recopiee, amount: 1 }, a, 'compte'), 'montant').toBe(false);
    expect(recopiePeriodique({ ...recopiee, months: 6 }, a, 'compte'), 'rythme').toBe(false);
    expect(recopiePeriodique({ ...recopiee, dueDate: '2026-10-16' }, a, 'compte'), 'échéance').toBe(false);
    expect(recopiePeriodique({ ...recopiee, withFlow: !a.withFlow }, a, 'compte'), 'prélèvement').toBe(false);
    expect(recopiePeriodique({ ...recopiee, accountId: 'autre' }, a, 'compte'), 'compte').toBe(false);
  });

  it('épargne : le nom, le montant par mois et la cible', () => {
    const a = aideEpargne(epargnes, epargnes, JOUR)!;
    const recopiee = { name: a.name, monthly: a.monthly, target: a.target };
    expect(recopieEpargne(recopiee, a)).toBe(true);
    expect(recopieEpargne({ ...recopiee, name: 'Voyage' }, a), 'nom').toBe(false);
    expect(recopieEpargne({ ...recopiee, monthly: 1 }, a), 'mensualité').toBe(false);
    expect(recopieEpargne({ ...recopiee, target: undefined }, a), 'cible').toBe(false);
  });

  it('catégories : le nom et la nature', () => {
    const a = aideCategorie(s.categories, s.categories)!;
    const recopiee = { name: a.name, nature: a.nature };
    expect(recopieCategorie(recopiee, a)).toBe(true);
    expect(recopieCategorie({ ...recopiee, name: 'Paie' }, a), 'nom').toBe(false);
    expect(recopieCategorie({ ...recopiee, nature: 'expense' }, a), 'nature').toBe(false);
  });

  it('comptes : le nom, le type et le solde', () => {
    const a = aideCompte(s.accounts, s.accounts)!;
    const recopiee = { name: a.name, kind: a.kind, balance: a.balance };
    expect(recopieCompte(recopiee, a)).toBe(true);
    expect(recopieCompte({ ...recopiee, name: 'Livret B' }, a), 'nom').toBe(false);
    expect(recopieCompte({ ...recopiee, kind: 'courant' }, a), 'type').toBe(false);
    expect(recopieCompte({ ...recopiee, balance: 0 }, a), 'solde').toBe(false);
  });

  it('une étape vidée puis remplie en recopiant chaque aide finit avec les lignes de l’exemple, et elles seules, chacune une fois, dans l’ordre', () => {
    const flux = (toutes: ReturnType<typeof parNom>) =>
      viderEnRecopiant(toutes, (restants) => {
        const a = aideFlux(restants, toutes, JOUR)!;
        return recopieFlux({ name: a.name, amount: a.amount, interval: a.interval, unit: a.unit, day: a.day, accountId: 'c' }, a, 'c') ? a.ligne : undefined;
      });
    expect(flux(revenus).map((l) => l.name)).toEqual(['Salaire', 'Loyer locatif', 'Allocations']);
    expect(flux(charges).map((l) => l.name)).toEqual(['Crédit immobilier', 'Assurance habitation', 'Internet et mobiles', 'Électricité']);

    const budgets = viderEnRecopiant<TirelireSuggestion>(courants, (restants) => {
      const a = aideCourant(restants, courants, JOUR)!;
      return recopieCourant({ name: a.name, amount: a.amount, keep: a.keep }, a) ? a.ligne : undefined;
    });
    expect(budgets.map((l) => l.name)).toEqual(courants.map((t) => t.name));

    const echeances = viderEnRecopiant<TirelireSuggestion>(periodiques, (restants) => {
      const a = aidePeriodique(restants, periodiques, JOUR)!;
      return recopiePeriodique({ name: a.name, amount: a.amount, months: a.months, dueDate: a.dueDate!, withFlow: a.withFlow, accountId: 'c' }, a, 'c') ? a.ligne : undefined;
    });
    expect(echeances.map((l) => l.name)).toEqual(periodiques.map((t) => t.name));

    const objectifs = viderEnRecopiant<TirelireSuggestion>(epargnes, (restants) => {
      const a = aideEpargne(restants, epargnes, JOUR)!;
      return recopieEpargne({ name: a.name, monthly: a.monthly, target: a.target }, a) ? a.ligne : undefined;
    });
    expect(objectifs.map((l) => l.name)).toEqual(epargnes.map((t) => t.name));

    const categories = viderEnRecopiant(s.categories, (restants) => {
      const a = aideCategorie(restants, s.categories)!;
      return recopieCategorie({ name: a.name, nature: a.nature }, a) ? a.ligne : undefined;
    });
    expect(categories.map((l) => l.name)).toEqual(s.categories.map((c) => c.name));

    const comptes = viderEnRecopiant(s.accounts, (restants) => {
      const a = aideCompte(restants, s.accounts)!;
      return recopieCompte({ name: a.name, kind: a.kind, balance: a.balance }, a) ? a.ligne : undefined;
    });
    expect(comptes.map((l) => l.name)).toEqual(s.accounts.map((c) => c.name));
  });
});

/** Les aides d'un formulaire hors de l'assistant viennent d'une même ligne de l'exemple, du genre du formulaire. */
describe('[niveau 4] #214 · 3 — hors de l’assistant, chaque aide qui propose une valeur est la valeur de ce champ dans une ligne de l’exemple du même genre', () => {
  const exemple = exampleLedger();
  const besoinsDeLExemple = alive(exemple.needs);

  it('Comptes : le nom d’aide est celui d’un compte de l’exemple du type choisi — le compte principal pour « principal »', () => {
    expect(aidesDeCompte('principal').name).toBe(s.mainAccount.name);
    expect(aidesDeCompte('courant').name).toBe('Carte enfants');
    expect(aidesDeCompte('epargne').name).toBe('Livret A');
    for (const kind of ['courant', 'epargne'] as const) {
      expect(alive(exemple.accounts).find((a) => a.name === aidesDeCompte(kind).name)?.kind, kind).toBe(kind);
    }
  });

  it('Tirelires : le nom d’aide est celui d’une tirelire de l’exemple', () => {
    expect(alive(exemple.tirelires).map((t) => t.name)).toContain(aidesDeTirelire().name);
  });

  it('Tirelires, besoin : le nom, le montant et la mensualité d’aide sont les valeurs d’un même besoin de l’exemple du genre choisi', () => {
    for (const kind of ['recurring', 'dueDate', 'goal'] as const) {
      const a = aidesDeBesoin(kind);
      const sien = s.tirelires
        .flatMap((t) => t.needs)
        .filter((n) => n.kind === kind)
        .some(
          (n) =>
            n.name === a.name &&
            (n.amount === undefined ? undefined : montantAide(n.amount)) === a.amount &&
            (n.monthlyAmount === undefined ? undefined : montantAide(n.monthlyAmount)) === a.monthlyAmount,
        );
      expect(sien, `besoin « ${kind} » : ses aides viennent de plusieurs besoins`).toBe(true);
    }
    expect(besoinsDeLExemple.length).toBeGreaterThan(0);
    // Les valeurs lues : une échéance de 1 200,00 €, un besoin récurrent « Cours de piano » à 45,00 €, un objectif de 6 000,00 € à 300,00 € par mois.
    expect(aidesDeBesoin('dueDate')).toMatchObject({ amount: '1 200,00' });
    expect(aidesDeBesoin('recurring')).toMatchObject({ name: 'Cours de piano', amount: '45,00' });
    expect(aidesDeBesoin('goal')).toMatchObject({ amount: '6 000,00', monthlyAmount: '300,00' });
  });

  it('Tirelires, besoin : un champ sans valeur dans l’exemple n’a pas d’aide inventée — le « montant à reverser » d’un versement, le nom d’une échéance', () => {
    const versement = aidesDeBesoin('payout');
    expect(versement.name).toBeUndefined();
    expect(versement.amount).toBeUndefined();
    expect(versement.monthlyAmount).toBeUndefined();
    expect(aidesDeBesoin('dueDate').name).toBeUndefined();
    expect(aidesDeBesoin('dueDate').monthlyAmount).toBeUndefined();
    expect(aidesDeBesoin('recurring').monthlyAmount).toBeUndefined();
    expect(aidesDeBesoin('goal').name).toBeUndefined();
  });

  it('Flux prévus : le nom, le montant et le motif d’aide sont ceux d’un même flux de l’exemple du type choisi', () => {
    const flux = alive(exemple.plannedFlows);
    for (const kind of ['income', 'fixedCharge', 'dueDate', 'transfer'] as const) {
      const a = aidesDeFluxPrevu(kind);
      const sien = flux.some((f) => f.kind === kind && f.name === a.name && montantAide(Math.abs(f.amount)) === a.amount && f.labelPattern === a.labelPattern);
      expect(sien, `flux « ${kind} » : ses aides viennent de plusieurs flux`).toBe(true);
    }
    expect(aidesDeFluxPrevu('income')).toMatchObject({ name: 'Salaire', amount: '3 400,00' });
    expect(aidesDeFluxPrevu('transfer')).toMatchObject({ name: 'Virement Livret A', amount: '600,00' });
  });

  it('Catégories : le nom d’aide est celui d’une catégorie de l’exemple de la nature choisie', () => {
    for (const nature of ['expense', 'income'] as const) {
      const c = alive(exemple.categories).find((x) => x.name === aidesDeCategorie(nature).name);
      expect(c?.nature, nature).toBe(nature);
    }
    expect(aidesDeCategorie('income').name).toBe('Salaire');
    expect(aidesDeCategorie('expense').name).toBe('Alimentation');
  });

  it('Saisie : le libellé, le montant et la catégorie d’aide sont ceux d’une même opération saisie de l’exemple de la nature choisie', () => {
    const saisies = entrySuggestions();
    for (const nature of ['expense', 'income', 'transfer'] as const) {
      const a = aidesDeSaisie(nature);
      const sienne = saisies.some((o) => o.nature === nature && o.label === a.label && montantAide(o.amount) === a.amount && o.categoryName === a.newCategory);
      expect(sienne, `saisie « ${nature} » : ses aides viennent de plusieurs opérations`).toBe(true);
    }
    expect(aidesDeSaisie('expense')).toEqual({ label: 'Dentiste (payé par Marie)', amount: '80,00', newCategory: 'Santé' });
  });
});
