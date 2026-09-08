import { describe, expect, it } from 'vitest';
import { activeAt, alive, budgetSuggestions, exampleLedger, euros, nextDueDate, stepOf } from '../src/index.js';

/**
 * Les propositions de l'assistant (D43) n'ont pas de contenu propre : elles sont une lecture du jeu
 * d'exemple. Ce test fige cet engagement — si quelqu'un ajoute une proposition écrite en dur, il
 * échoue, et c'est bien le but : c'est l'exemple qu'il faut étoffer.
 */
describe("propositions de l'assistant (D43)", () => {
  // Date explicite : l'exemple porte plusieurs versions d'un même budget (D51) et les propositions
  // suivent celle qui est en vigueur. Sans date figée, ce test changerait de résultat tout seul.
  const asOf = '2026-09-06';
  const l = exampleLedger();
  const s = budgetSuggestions(asOf);

  it("ne propose rien qui ne vienne de l'exemple", () => {
    const connus = new Set([
      ...alive(l.plannedFlows).map((f) => f.name),
      ...alive(l.tirelires).map((t) => t.name),
    ]);
    const proposes = [
      ...s.incomes.map((x) => x.name),
      ...s.charges.map((x) => x.name),
      ...s.everyday.map((x) => x.name),
      ...s.periodic.map((x) => x.name),
      ...s.savings.map((x) => x.name),
    ];
    expect(proposes.length).toBeGreaterThan(0);
    for (const nom of proposes) expect(connus).toContain(nom);
  });

  it("couvre les cinq questions du parcours à partir de l'exemple seul", () => {
    expect(s.incomes.length).toBeGreaterThan(0);
    expect(s.charges.length).toBeGreaterThan(0);
    expect(s.everyday.length).toBeGreaterThan(0);
    expect(s.periodic.length).toBeGreaterThan(0);
    expect(s.savings.length).toBeGreaterThan(0);
  });

  it('ne propose qu’une version de chaque budget, celle en vigueur (D51)', () => {
    const noms = [...s.incomes.map((x) => x.name), ...s.everyday.map((x) => x.name), ...s.savings.map((x) => x.name)];
    expect(new Set(noms).size).toBe(noms.length);
    expect(s.everyday.find((x) => x.name === 'Alimentation')!.amount).toBe(euros(900));
    expect(s.incomes.find((x) => x.name === 'Salaire')!.amount).toBe(euros(3400));
  });

  it('suit la version en vigueur quand le budget a changé', () => {
    // Novembre : l'alimentation est passée à 950, le salaire à 3 550, et le piano est apparu.
    const apres = budgetSuggestions('2026-11-15');
    expect(apres.everyday.find((x) => x.name === 'Alimentation')!.amount).toBe(euros(950));
    expect(apres.incomes.find((x) => x.name === 'Salaire')!.amount).toBe(euros(3550));
    expect(apres.everyday.filter((x) => x.name === 'Alimentation').length).toBe(1);
    // Le crédit court encore en novembre, plus en janvier : une charge peut disparaître des propositions.
    expect(budgetSuggestions('2026-11-15').charges.some((x) => x.name === 'Crédit immobilier')).toBe(true);
    expect(budgetSuggestions('2027-01-15').charges.some((x) => x.name === 'Crédit immobilier')).toBe(false);
  });

  it('reprend les montants et les rythmes tels que l’exemple les porte', () => {
    const salaire = s.incomes.find((x) => x.name === 'Salaire')!;
    const flux = alive(l.plannedFlows).find((f) => f.name === 'Salaire' && activeAt(f, asOf))!;
    // Le montant est proposé en positif : le signe appartient au genre du flux, pas à la saisie.
    expect(salaire.amount).toBe(Math.abs(flux.amount));
    expect({ interval: salaire.interval, unit: salaire.unit }).toEqual(stepOf(flux.periodicity));

    const credit = s.charges.find((x) => x.name === 'Crédit immobilier')!;
    expect(credit.amount).toBeGreaterThan(0);

    const tf = s.periodic.find((x) => x.name === 'Taxe foncière')!;
    expect({ interval: tf.interval, unit: tf.unit }).toEqual({ interval: 12, unit: 'month' });
    expect({ month: tf.month, day: tf.day }).toEqual({ month: 10, day: 15 });
  });

  it("date l'échéance proposée sur sa prochaine occurrence, sans demander l'année", () => {
    // Le 15 octobre est encore devant nous en septembre…
    expect(nextDueDate(10, 15, '2026-09-08')).toBe('2026-10-15');
    // …mais derrière nous en novembre, donc l'année suivante.
    expect(nextDueDate(10, 15, '2026-11-01')).toBe('2027-10-15');
    // Le jour même compte comme à venir.
    expect(nextDueDate(10, 15, '2026-10-15')).toBe('2026-10-15');
  });
});
