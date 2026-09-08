import { describe, expect, it } from 'vitest';
import { computePlan, emptyLedger, euros, DEFAULT_PRIORITY, type Ledger } from '../src/index.js';

/**
 * L'assistant de configuration (D40) écrit des tirelires, des besoins et des flux à partir de
 * réponses simples. Deux choix d'ancrage sont indispensables pour que le budget se voie dès la
 * période en cours, et rien dans le cœur ne les imposait :
 *
 *  - une tirelire ouverte « aujourd'hui » ne compte qu'à partir de la période *suivante*
 *    (`tirelireTimeline` démarre à la première période entièrement postérieure à l'ouverture),
 *    donc l'assistant l'ouvre au début de la période en cours ;
 *  - `nextOccurrence` ne remonte jamais avant l'ancrage, donc un flux ancré sur une date à venir
 *    n'a aucune occurrence dans la période en cours : l'assistant l'ancre sur la dernière
 *    occurrence déjà passée.
 *
 * Ce test fige ces deux règles : sans elles, un budget tout juste saisi s'affiche vide.
 */

const payDay = 28;
const asOf = '2026-09-20';
const periodStart = '2026-08-28'; // période de paie contenant asOf : 28 août → 27 septembre

function budgetDeLAssistant(): Ledger {
  const l = emptyLedger();
  l.accounts.push({
    id: 'principal',
    name: 'Compte principal',
    kind: 'principal',
    openingBalance: euros(1500),
    openingDate: periodStart,
  });
  l.settings.periodStartDay = payDay;
  // Revenu ancré sur la dernière occurrence passée du jour de paie.
  l.plannedFlows.push({
    id: 'salaire',
    name: 'Salaire',
    kind: 'income',
    amount: euros(2400),
    accountId: 'principal',
    periodicity: { intervalMonths: 1, anchorDate: periodStart },
    dateWindowDays: 5,
  });
  l.plannedFlows.push({
    id: 'loyer',
    name: 'Loyer',
    kind: 'fixedCharge',
    amount: euros(-750),
    accountId: 'principal',
    periodicity: { intervalMonths: 1, anchorDate: '2026-09-05' },
    dateWindowDays: 5,
  });
  // Budget courant : tirelire ouverte au début de la période en cours.
  l.tirelires.push({ id: 'courses', name: 'Courses', placement: [], openingBalance: 0, openingDate: periodStart, rollover: { mode: 'none' } });
  l.needs.push({
    id: 'n-courses',
    tirelireId: 'courses',
    kind: 'recurring',
    amount: euros(500),
    periodicity: { intervalMonths: 1, anchorDate: periodStart },
    priority: DEFAULT_PRIORITY.recurring,
  });
  // Dépense annuelle : réserve lissée sur les périodes qui restent avant l'échéance.
  l.tirelires.push({ id: 'assurance', name: 'Assurance auto', placement: [], openingBalance: 0, openingDate: periodStart, rollover: { mode: 'unlimited' } });
  l.needs.push({
    id: 'n-assurance',
    tirelireId: 'assurance',
    kind: 'dueDate',
    amount: euros(1200),
    periodicity: { intervalMonths: 12, anchorDate: '2027-01-15' },
    priority: DEFAULT_PRIORITY.dueDate,
  });
  return l;
}

describe("budget construit par l'assistant (D40)", () => {
  it('se voit dès la période en cours, revenus comme réserves', () => {
    const plan = computePlan(budgetDeLAssistant(), asOf);

    // Le revenu ancré sur une occurrence passée compte bien dans la période en cours.
    expect(plan.totals.incomes).toBe(euros(2400));
    // `totals.fixedCharges` est une magnitude positive, pas un montant signé.
    expect(plan.totals.fixedCharges).toBe(euros(750));
    expect(plan.warnings.map((w) => w.code)).not.toContain('noIncome');

    // Les deux tirelires produisent une ligne dès cette période.
    expect(plan.lines.map((l) => l.needId).sort()).toEqual(['n-assurance', 'n-courses']);
  });

  it("lisse l'échéance annuelle sur les périodes qui restent avant la date", () => {
    const plan = computePlan(budgetDeLAssistant(), asOf);
    const assurance = plan.lines.find((l) => l.needId === 'n-assurance')!;

    // De la période de septembre à l'échéance du 15 janvier, il reste cinq virements :
    // 1 200 € / 5 = 240 € par période, en rattrapage puisque la réserve part de zéro.
    expect(assurance.requested).toBe(euros(240));
    expect(assurance.status).toBe('catchUp');
  });

  it('laisse un reste à vivre cohérent avec ce qui a été déclaré', () => {
    const plan = computePlan(budgetDeLAssistant(), asOf);
    // 2 400 − 750 de loyer − (500 de courses + 240 d'assurance) = 910 €.
    expect(plan.totals.requested).toBe(euros(740));
    expect(plan.totals.margin).toBe(euros(910));
  });

  it("n'annonce pas de découvert quand le solde du compte a été renseigné", () => {
    const plan = computePlan(budgetDeLAssistant(), asOf);
    expect(plan.warnings.map((w) => w.code)).not.toContain('principalOverdrawn');
  });
});
