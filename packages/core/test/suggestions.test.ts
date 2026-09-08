import { describe, expect, it } from 'vitest';
import { alive, budgetSuggestions, exampleLedger, nextDueDate } from '../src/index.js';

/**
 * Les propositions de l'assistant (D43) n'ont pas de contenu propre : elles sont une lecture du jeu
 * d'exemple. Ce test fige cet engagement — si quelqu'un ajoute une proposition écrite en dur, il
 * échoue, et c'est bien le but : c'est l'exemple qu'il faut étoffer.
 */
describe("propositions de l'assistant (D43)", () => {
  const l = exampleLedger();
  const s = budgetSuggestions();

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

  it('reprend les montants et les rythmes tels que l’exemple les porte', () => {
    const salaire = s.incomes.find((x) => x.name === 'Salaire')!;
    const flux = alive(l.plannedFlows).find((f) => f.name === 'Salaire')!;
    // Le montant est proposé en positif : le signe appartient au genre du flux, pas à la saisie.
    expect(salaire.amount).toBe(Math.abs(flux.amount));
    expect(salaire.intervalMonths).toBe(flux.periodicity.intervalMonths);

    const credit = s.charges.find((x) => x.name === 'Crédit immobilier')!;
    expect(credit.amount).toBeGreaterThan(0);

    const tf = s.periodic.find((x) => x.name === 'Taxe foncière')!;
    expect(tf.intervalMonths).toBe(12);
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
