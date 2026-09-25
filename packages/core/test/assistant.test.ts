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
    periodicity: { interval: 1, unit: 'month' as const, anchorDate: periodStart },
    dateWindowDays: 5,
  });
  l.plannedFlows.push({
    id: 'loyer',
    name: 'Loyer',
    kind: 'fixedCharge',
    amount: euros(-750),
    accountId: 'principal',
    periodicity: { interval: 1, unit: 'month' as const, anchorDate: '2026-09-05' },
    dateWindowDays: 5,
  });
  // Budget courant : tirelire ouverte au début de la période en cours.
  l.tirelires.push({ id: 'courses', name: 'Courses', placement: [], openingBalance: 0, openingDate: periodStart, rollover: { mode: 'none' } });
  l.needs.push({
    id: 'n-courses',
    tirelireId: 'courses',
    kind: 'recurring',
    amount: euros(500),
    periodicity: { interval: 1, unit: 'month' as const, anchorDate: periodStart },
    priority: DEFAULT_PRIORITY.recurring,
  });
  // Dépense annuelle : réserve lissée sur les périodes qui restent avant l'échéance.
  l.tirelires.push({ id: 'assurance', name: 'Assurance auto', placement: [], openingBalance: 0, openingDate: periodStart, rollover: { mode: 'unlimited' } });
  l.needs.push({
    id: 'n-assurance',
    tirelireId: 'assurance',
    kind: 'dueDate',
    amount: euros(1200),
    periodicity: { interval: 12, unit: 'month' as const, anchorDate: '2027-01-15' },
    priority: DEFAULT_PRIORITY.dueDate,
  });
  return l;
}

describe('[niveau 1] harnais du registre', () => {
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
});

/**
 * Revenus concentrés sur une saison, dont on veut vivre toute l'année (D48). La tirelire encaisse
 * l'été et verse chaque période ; le reste à vivre doit être le même en février qu'en août.
 */
describe('tirelire de saison (D48)', () => {
  function saison(soldeSaison: number): Ledger {
    const l = emptyLedger();
    l.settings.periodStartDay = 1;
    l.accounts.push({ id: 'principal', name: 'Compte principal', kind: 'principal', openingBalance: euros(500), openingDate: '2026-01-01' });
    l.tirelires.push({ id: 'saison', name: 'Location saisonnière', placement: [], openingBalance: euros(soldeSaison), openingDate: '2026-01-01', rollover: { mode: 'unlimited' } });
    l.needs.push({
      id: 'n-saison',
      tirelireId: 'saison',
      kind: 'payout',
      amount: euros(12000), // ce que la saison rapporte sur l'année
      periodicity: { interval: 1, unit: 'year', anchorDate: '2026-01-01' },
      priority: DEFAULT_PRIORITY.payout,
    });
    l.plannedFlows.push({
      id: 'loyer', name: 'Loyer', kind: 'fixedCharge', amount: euros(-800), accountId: 'principal',
      periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-05' }, dateWindowDays: 5,
    });
    return l;
  }

  it('verse chaque période le douzième de ce que la saison rapporte', () => {
    const plan = computePlan(saison(12000), '2026-02-10');
    const ligne = plan.lines.find((l) => l.needId === 'n-saison')!;
    // 12 000 € sur l'année, soit 1 000 € versés par période — comptés en négatif : la tirelire donne.
    expect(ligne.requested).toBe(euros(-1000));
    expect(ligne.funded).toBe(euros(-1000));
    expect(ligne.status).toBe('ok');
  });

  it('fait remonter le reste à vivre du montant versé', () => {
    const plan = computePlan(saison(12000), '2026-02-10');
    // Aucun revenu prévu ce mois-là, 800 € de loyer : sans le versement la marge serait de −800 €.
    expect(plan.totals.incomes).toBe(0);
    expect(plan.totals.margin).toBe(euros(200));
  });

  it('ne verse que ce que la tirelire porte quand la saison a été mauvaise', () => {
    // 300 € en caisse là où le rythme annoncé demanderait 1 000 € : on verse les 300 €.
    const plan = computePlan(saison(300), '2026-01-10');
    const ligne = plan.lines.find((l) => l.needId === 'n-saison')!;
    expect(ligne.requested).toBe(euros(-300));
    expect(ligne.cruise).toBe(euros(1000));
    expect(ligne.status).toBe('reduced');
    expect(plan.warnings.map((w) => w.code)).toContain('payoutShort');
  });

  it("prévient quand la réserve est épuisée, au lieu de creuser un solde négatif", () => {
    // Le mois suivant, les 300 € ont été versés : il ne reste rien à verser.
    const plan = computePlan(saison(300), '2026-02-10');
    const ligne = plan.lines.find((l) => l.needId === 'n-saison')!;
    expect(ligne.requested).toBe(0);
    expect(ligne.status).toBe('reduced');
    expect(plan.warnings.map((w) => w.code)).toContain('payoutShort');
    // Et la marge retombe au niveau qu'elle aurait sans la saison.
    expect(plan.totals.margin).toBe(euros(-800));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Témoin rouge du harnais U1 (docs/gardes.md) : les assertions de « budget construit par
// l'assistant (D40) », rejouées sur la version que l'en-tête de ce fichier décrit comme fausse.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Version cassée : tirelires ouvertes « aujourd'hui », flux ancrés sur une occurrence à venir. */
function budgetCassé(): Ledger {
  const l = budgetDeLAssistant();
  return {
    ...l,
    tirelires: l.tirelires.map((t) => ({ ...t, openingDate: asOf })),
    plannedFlows: l.plannedFlows.map((f) => ({ ...f, periodicity: { interval: 1, unit: 'month' as const, anchorDate: '2026-10-28' } })),
  };
}

describe('[niveau 1] harnais du registre', () => {
  it.fails('témoin rouge · un budget ouvert aujourd’hui et ancré sur une occurrence à venir', () => {
    const plan = computePlan(budgetCassé(), asOf);

    expect(plan.totals.incomes).toBe(euros(2400));
    expect(plan.totals.fixedCharges).toBe(euros(750));
    expect(plan.warnings.map((w) => w.code)).not.toContain('noIncome');
    expect(plan.lines.map((l) => l.needId).sort()).toEqual(['n-assurance', 'n-courses']);
  });
});
