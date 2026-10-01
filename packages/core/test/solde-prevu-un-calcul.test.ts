/**
 * Tests du codeur de #296, second tour — points 10 et 11 du « Fait quand ». Tous de niveau 4 (rôle du
 * codeur) : l'auditeur choisit parmi eux.
 *
 * 10. Pour une période à venir, la dotation qu'une tirelire reçoit dans son solde prévu est celle que
 *     sa ligne du plan demande : un seul calcul, prélèvements prévus de ses échéances compris.
 * 11. Une occurrence « attendue, non reçue » se reconnaît par le même calcul pour le solde prévu et
 *     pour le bloc « Attendus, non reçus » (`missingFlows`) ; le détail d'un solde prévu ne liste
 *     que ce qui compte.
 *
 * Données inventées (D84) : l'exemple, lu à sa date de lecture, et un petit grand livre écrit ici.
 */
import { describe, expect, it } from 'vitest';
import { computePlan, emptyLedger, euros, exampleLedger, missingFlows, periodsAround, type Ledger, type Plan } from '../src/index.js';

const LECTURE_EXEMPLE = '2026-09-06';

function àVenir(l: Ledger, lecture: string): Plan[] {
  return periodsAround(l, lecture, 0, 5)
    .filter((p) => p.start > lecture)
    .map((p) => computePlan(l, p.start, lecture));
}

/** Ce que les lignes d'une tirelire demandent, et ce que son solde prévu reçoit au début de la période. */
function deuxLectures(p: Plan, tirelireId: string) {
  const ligne = p.lines.filter((l) => l.tirelireId === tirelireId).reduce((s, l) => s + l.requested, 0);
  const prévu = p.forecast!.tirelires.find((t) => t.id === tirelireId)!;
  const dotation = prévu.movements.filter((m) => m.origin === 'dotation' && m.date === p.period.start).reduce((s, m) => s + m.amount, 0);
  return { ligne, dotation };
}

describe('[niveau 4] point 10 — la dotation du solde prévu est celle que la ligne du plan demande', () => {
  it('l’exemple : chaque tirelire, sur chaque période à venir', () => {
    const plans = àVenir(exampleLedger(), LECTURE_EXEMPLE);
    expect(plans.length).toBeGreaterThanOrEqual(4);
    for (const p of plans) {
      for (const t of p.forecast!.tirelires) {
        const { ligne, dotation } = deuxLectures(p, t.id);
        expect({ période: p.period.label, tirelire: t.name, dotation }).toEqual({ période: p.period.label, tirelire: t.name, dotation: ligne });
      }
    }
  });

  it('l’exemple : de novembre à janvier, la taxe foncière, vidée le 15 octobre, redemande sa croisière', () => {
    const plans = àVenir(exampleLedger(), LECTURE_EXEMPLE).filter((p) => ['novembre 2026', 'décembre 2026', 'janvier 2027'].includes(p.period.label));
    expect(plans.length).toBe(3);
    for (const p of plans) {
      expect({ période: p.period.label, ...deuxLectures(p, 'env-tf') }).toEqual({ période: p.period.label, ligne: euros(100), dotation: euros(100) });
    }
  });

  it('l’invariant de D52 tient toujours : vers un compte d’accueil, on vire ce que les tirelires placées là demandent', () => {
    for (const p of àVenir(exampleLedger(), LECTURE_EXEMPLE)) {
      for (const t of p.transfers) {
        const demande = p.lines.filter((x) => x.accountId === t.accountId).reduce((s, x) => s + x.requested, 0);
        expect({ période: p.period.label, compte: t.accountName, viré: t.net }).toEqual({ période: p.period.label, compte: t.accountName, viré: demande });
      }
    }
  });

  it('la période où l’on lit ne change pas : ses lignes ignorent les opérations prévues', () => {
    const l = exampleLedger();
    const courant = computePlan(l, LECTURE_EXEMPLE);
    const sansFlux = computePlan({ ...l, plannedFlows: l.plannedFlows.filter((f) => f.kind !== 'dueDate') }, LECTURE_EXEMPLE);
    expect(courant.lines.map((x) => [x.needId, x.balance, x.requested])).toEqual(sansFlux.lines.map((x) => [x.needId, x.balance, x.requested]));
  });
});

// ---------------------------------------------------------------------------------------------

const CC = 'cc';
/**
 * Un compte courant suivi (une opération importée le 3 septembre), un loyer de 700 € le 2 de chaque
 * mois, une fenêtre de 3 jours ; le loyer de septembre n'est jamais arrivé. Lu le 10 septembre.
 */
function compteSuivi(suivi = true): Ledger {
  const l = emptyLedger({ periodStartDay: 1 });
  l.accounts.push({ id: CC, name: 'Compte courant', kind: 'principal', openingBalance: euros(1000), openingDate: '2026-08-31' });
  l.plannedFlows.push({ id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', amount: -euros(700), accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-02' }, dateWindowDays: 3 });
  if (suivi) l.operations.push({ id: 'cb', accountId: CC, origin: 'imported', date: '2026-09-03', label: 'CB', normalizedLabel: 'CB', amount: -euros(20), state: 'untreated' });
  return l;
}
const LECTURE = '2026-09-10';

describe('[niveau 4] point 11 — « attendue, non reçue » : un seul calcul, un seul endroit', () => {
  it('le bloc « Attendus, non reçus » et le solde prévu reconnaissent la même occurrence', () => {
    const l = compteSuivi();
    const bloc = missingFlows(l, '2026-07-01', LECTURE).map((m) => [m.flowId, m.expectedDate]);
    const octobre = computePlan(l, '2026-10-01', LECTURE).forecast!.accounts.find((a) => a.id === CC)!;
    expect(bloc).toEqual([['f-loyer', '2026-09-02']]);
    expect(octobre.notReceived.map((n) => [n.flowId, n.date])).toEqual(bloc);
  });

  it('le détail du solde prévu ne liste que ce qui compte : l’occurrence non reçue n’y est pas', () => {
    const c = computePlan(compteSuivi(), '2026-10-01', LECTURE).forecast!.accounts.find((a) => a.id === CC)!;
    expect(c.movements.filter((m) => m.flowId === 'f-loyer').map((m) => m.date)).toEqual(['2026-10-02']);
  });

  it('sans suivi, rien n’est dit manquant, ni dans le bloc ni dans le solde prévu, et l’occurrence compte', () => {
    const l = compteSuivi(false);
    expect(missingFlows(l, '2026-07-01', LECTURE)).toEqual([]);
    const c = computePlan(l, '2026-10-01', LECTURE).forecast!.accounts.find((a) => a.id === CC)!;
    expect(c.notReceived).toEqual([]);
    expect(c.movements.filter((m) => m.flowId === 'f-loyer').map((m) => m.date)).toEqual(['2026-09-02', '2026-10-02']);
  });

  it('une occurrence reprise n’est ni dans le bloc, ni comptée deux fois', () => {
    const l = compteSuivi();
    l.operations.push({ id: 'loyer-sept', accountId: CC, origin: 'imported', date: '2026-09-03', label: 'LOYER', normalizedLabel: 'LOYER', amount: -euros(700), state: 'reconciled', plannedFlowId: 'f-loyer' });
    expect(missingFlows(l, '2026-07-01', LECTURE)).toEqual([]);
    const c = computePlan(l, '2026-10-01', LECTURE).forecast!.accounts.find((a) => a.id === CC)!;
    expect(c.notReceived).toEqual([]);
    expect(c.movements.filter((m) => m.flowId === 'f-loyer').map((m) => m.date)).toEqual(['2026-10-02']);
  });
});
