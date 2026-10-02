/**
 * Harnais d'audit de #296 — le plan d'une période à venir montre le solde prévu des comptes et des
 * tirelires (D52, D88). Côté cœur ; ce qui se lit à l'écran est dans
 * `apps/web/test/navigateur/plan-solde-prevu.test.ts`.
 *
 * Composé après le codage (auditeur.md, étape 2) : pour chaque phrase du « Fait quand » qu'un test
 * peut trancher, un test — celui du codeur quand il la tranche (repris de `solde-prevu.test.ts` et,
 * au second tour, de `solde-prevu-un-calcul.test.ts`, qui n'existent plus), sinon le mien : le point 5
 * est réécrit contre les fonctions de `balances.ts` (le test du codeur relisait ce que le calcul
 * venait de poser), la saisie future qui reprend une occurrence, le creux le plus profond, le bord de
 * la fenêtre d'une occurrence, ce qui existe à la fin de la période (flux supprimé, terminé ou à
 * venir ; compte et tirelire créés plus tard ; saisie d'une période suivante) et le point 9 (ajouté par
 * l'auditeur) sont de moi. Données inventées
 * (D84) : l'exemple, lu à sa date de lecture, et un petit grand livre écrit ici, dont les montants
 * attendus sont ceux qu'on calcule à la main.
 *
 * Chaque `describe` reprend un point du « Fait quand » sous son numéro. Le point 4 se lit aussi à
 * l'écran ; le point 8 est de la documentation, relue.
 *
 * Niveaux (D83), par le besoin que couvre chaque phrase :
 * - 0 · point 7 : le calcul n'écrit rien (I10). Même niveau que son harnais du registre, « calculer
 *   le plan n'écrit rien » ; une opération prévue enregistrée resterait en base après la correction.
 * - 1 · point 3 : le plan « signale un risque à venir » (principe 1.3) ; point 5 : I2 tel qu'il est
 *   écrit ; point 2, le seul test d'un virement proposé : « seules les données enregistrées servent,
 *   jamais une hypothèse » (principe 1.3).
 * - 2 · les autres, points 10 et 11 compris : une règle de D52, de D12 ou de D88 qui donnerait un
 *   résultat faux, l'usage restant possible.
 */
import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  alive,
  componentsOnAccount,
  computePlan,
  emptyLedger,
  euros,
  exampleLedger,
  indexLedger,
  missingFlows,
  periodsAround,
  tirelireBalance,
  unallocated,
  withPlannedOperations,
  type Ledger,
  type Operation,
  type PlannedFlow,
  type Plan,
} from '../src/index.js';

/** La date de lecture de l'exemple, telle que l'application la pose au chargement. */
const LECTURE_EXEMPLE = '2026-09-06';

/** Le plan de chaque période de la fenêtre de l'écran Plan, lu comme l'écran le lit. */
function plans(l: Ledger, lecture: string): Plan[] {
  return periodsAround(l, lecture, 1, 4).map((p) => computePlan(l, p.start <= lecture && p.end >= lecture ? lecture : p.start, lecture));
}
const àVenir = (l: Ledger, lecture: string) => plans(l, lecture).filter((p) => p.period.start > lecture);

// ---------------------------------------------------------------------------------------------
// Un petit budget, mois calendaires, lu le 10 septembre 2026
// ---------------------------------------------------------------------------------------------

const LECTURE = '2026-09-10';
const CC = 'cc';
const LIVRET = 'livret';
/** Le début de la fenêtre où l'on cherche les occurrences « attendues, non reçues ». */
const DEPUIS = '2026-07-01';

function flux(f: Partial<PlannedFlow> & Pick<PlannedFlow, 'id' | 'name' | 'kind' | 'amount'>): PlannedFlow {
  return { accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-25' }, dateWindowDays: 3, ...f };
}

/**
 * Un compte courant à 1 000 € et un livret vide, ouverts le 31 août ; une tirelire « Taxe
 * foncière » placée sur le livret, avec 300 € et une échéance de 1 200 € le 15 novembre, payée
 * depuis le compte courant ; un salaire de 2 000 € le 25 de chaque mois.
 */
function petitBudget(): Ledger {
  const l = emptyLedger({ periodStartDay: 1 });
  l.accounts.push({ id: CC, name: 'Compte courant', kind: 'principal', openingBalance: euros(1000), openingDate: '2026-08-31' });
  l.accounts.push({ id: LIVRET, name: 'Livret', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-31' });
  l.tirelires.push({ id: 'tf', name: 'Taxe foncière', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: euros(300), openingDate: '2026-08-31' });
  l.needs.push({ id: 'n-tf', tirelireId: 'tf', kind: 'dueDate', amount: euros(1200), periodicity: { interval: 12, unit: 'month', anchorDate: '2026-11-15' }, priority: 10 });
  l.plannedFlows.push(flux({ id: 'f-salaire', name: 'Salaire', kind: 'income', amount: euros(2000) }));
  l.plannedFlows.push(
    flux({ id: 'f-tf', name: 'Taxe foncière (prélèvement)', kind: 'dueDate', amount: -euros(1200), tirelireId: 'tf', periodicity: { interval: 12, unit: 'month', anchorDate: '2026-11-15' } }),
  );
  return l;
}

function opération(o: Partial<Operation> & Pick<Operation, 'id' | 'date' | 'amount'>): Operation {
  return { accountId: CC, origin: 'manual', label: o.id, normalizedLabel: o.id.toUpperCase(), state: 'locked', ...o };
}

/** Le plan de la période qui contient `date`, lu le 10 septembre. */
const planDe = (l: Ledger, date: string, lecture = LECTURE) => computePlan(l, date, lecture);
const compte = (p: Plan, id: string) => p.forecast!.accounts.find((a) => a.id === id)!;
const tirelire = (p: Plan, id: string) => p.forecast!.tirelires.find((t) => t.id === id)!;

// ---------------------------------------------------------------------------------------------

describe('[niveau 2] point 1 — une période à venir montre le solde prévu de chaque compte et de chaque tirelire à sa fin', () => {
  it('l’exemple : chaque compte réel et chaque tirelire, sur chaque période à venir', () => {
    const l = exampleLedger();
    const périodes = àVenir(l, LECTURE_EXEMPLE);
    expect(périodes.length).toBeGreaterThanOrEqual(3);
    for (const p of périodes) {
      expect(p.forecast, `${p.period.label} : pas de solde prévu`).toBeDefined();
      // Un compte clos avant la période (D56, le Livret jeune de l'exemple) n'en a pas.
      const ouverts = alive(l.accounts).filter((a) => !a.activeTo || a.activeTo >= p.period.start);
      expect(ouverts.length).toBeLessThan(alive(l.accounts).length);
      expect(p.forecast!.accounts.map((a) => a.id).sort()).toEqual(ouverts.map((a) => a.id).sort());
      expect(p.forecast!.tirelires.map((t) => t.id).sort()).toEqual(alive(l.tirelires).map((t) => t.id).sort());
    }
  });

  it('le solde de départ est le réel à la date de lecture, et les mouvements le mènent au solde prévu', () => {
    const l = exampleLedger();
    const idx = indexLedger(l);
    for (const p of àVenir(l, LECTURE_EXEMPLE)) {
      for (const a of p.forecast!.accounts) {
        expect({ période: p.period.label, compte: a.name, départ: a.start }).toEqual({ période: p.period.label, compte: a.name, départ: accountBalance(l.accounts.find((x) => x.id === a.id)!, l, LECTURE_EXEMPLE) });
        expect(a.start + a.movements.reduce((s, m) => s + m.amount, 0)).toBe(a.end);
      }
      for (const t of p.forecast!.tirelires) {
        expect({ période: p.period.label, tirelire: t.name, départ: t.start }).toEqual({ période: p.period.label, tirelire: t.name, départ: tirelireBalance(l.tirelires.find((x) => x.id === t.id)!, idx, LECTURE_EXEMPLE) });
        expect(t.start + t.movements.reduce((s, m) => s + m.amount, 0)).toBe(t.end);
      }
    }
  });

  it('une opération saisie à une date future compte jusqu’à la fin de la période qui la contient, et pas avant ni après', () => {
    const l = petitBudget();
    l.operations.push(opération({ id: 'achat-futur', date: '2026-10-08', amount: -euros(250) }));
    l.operations.push(opération({ id: 'achat-novembre', date: '2026-11-03', amount: -euros(75) }));
    const sans = compte(planDe(petitBudget(), '2026-10-01'), CC).end;
    const octobre = compte(planDe(l, '2026-10-01'), CC);
    expect(octobre.end).toBe(sans - euros(250));
    expect(octobre.movements).toContainEqual(expect.objectContaining({ date: '2026-10-08', origin: 'saisie', amount: -euros(250), operationId: 'achat-futur' }));
    // Celle de novembre ne compte pas en octobre, et le départ reste le réel à la date de lecture.
    expect(octobre.movements.map((m) => m.operationId)).not.toContain('achat-novembre');
    expect(octobre.start).toBe(euros(1000));
    expect(compte(planDe(l, '2026-11-01'), CC).movements.map((m) => m.operationId)).toContain('achat-novembre');
  });

  it('un compte et une tirelire qui n’existent pas encore à la fin de la période n’y figurent pas', () => {
    const l = petitBudget();
    l.accounts.push({ id: 'futur', name: 'Compte futur', kind: 'courant', openingBalance: 0, openingDate: '2026-12-01', activeFrom: '2026-12-01' });
    l.tirelires.push({ id: 'futur', name: 'Tirelire future', placement: [{ accountId: CC, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-12-01' });
    const octobre = planDe(l, '2026-10-01').forecast!;
    expect(octobre.accounts.map((a) => a.id)).toEqual([CC, LIVRET]);
    expect(octobre.tirelires.map((t) => t.id)).toEqual(['tf']);
    const décembre = planDe(l, '2026-12-01').forecast!;
    expect(décembre.accounts.map((a) => a.id)).toContain('futur');
    expect(décembre.tirelires.map((t) => t.id)).toContain('futur');
  });
});

describe('[niveau 2] point 2 — ce qui compte, et ce qui ne compte plus', () => {
  it('sans suivi, chaque occurrence d’un flux compte à sa date : septembre et octobre, pour octobre', () => {
    const c = compte(planDe(petitBudget(), '2026-10-01'), CC);
    expect(c.tracked).toBe(false);
    expect(c.start).toBe(euros(1000));
    expect(c.movements.filter((m) => m.origin === 'flux' && m.flowId === 'f-salaire').map((m) => m.date)).toEqual(['2026-09-25', '2026-10-25']);
    expect(c.end).toBe(euros(5000));
  });

  it('un flux supprimé, un flux terminé et un flux pas encore commencé ne produisent pas d’opération prévue', () => {
    const l = petitBudget();
    const mensuel = (id: string, plus: Partial<PlannedFlow>) =>
      flux({ id, name: id, kind: 'fixedCharge', amount: -euros(10), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-12' }, ...plus });
    l.plannedFlows.push(
      mensuel('f-vivant', {}),
      mensuel('f-supprimé', { deletedAt: '2026-09-01T00:00:00Z' }),
      mensuel('f-terminé', { activeTo: '2026-10-05' }),
      mensuel('f-futur', { activeFrom: '2026-11-01' }),
    );
    const dates = (p: Plan, id: string) => compte(p, CC).movements.filter((m) => m.flowId === id).map((m) => m.date);
    const novembre = planDe(l, '2026-11-01');
    expect(dates(novembre, 'f-vivant')).toEqual(['2026-09-12', '2026-10-12', '2026-11-12']);
    expect(dates(novembre, 'f-supprimé')).toEqual([]);
    expect(dates(novembre, 'f-terminé')).toEqual(['2026-09-12']);
    expect(dates(novembre, 'f-futur')).toEqual(['2026-11-12']);
  });

  it('sans suivi, une occurrence passée compte aussi : rien ne se confronte, rien n’est dit manquant (U1)', () => {
    const l = petitBudget();
    l.plannedFlows.push(flux({ id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', amount: -euros(700), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-02' } }));
    const c = compte(planDe(l, '2026-10-01'), CC);
    expect(c.movements.filter((m) => m.flowId === 'f-loyer').map((m) => m.date)).toEqual(['2026-09-02', '2026-10-02']);
    expect(missingFlows(l, DEPUIS, LECTURE)).toEqual([]);
  });

  it('avec suivi, une occurrence dont la fenêtre est passée sans reprise ne compte plus : le bloc « Attendus, non reçus » la dit', () => {
    const l = petitBudget();
    l.plannedFlows.push(flux({ id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', amount: -euros(700), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-02' } }));
    l.operations.push(opération({ id: 'cb', origin: 'imported', date: '2026-09-03', amount: -euros(20), state: 'untreated' }));
    const c = compte(planDe(l, '2026-10-01'), CC);
    expect(c.tracked).toBe(true);
    expect(c.movements.filter((m) => m.flowId === 'f-loyer').map((m) => m.date)).toEqual(['2026-10-02']);
    expect(missingFlows(l, DEPUIS, LECTURE)).toEqual([{ flowId: 'f-loyer', name: 'Loyer', expectedDate: '2026-09-02', amount: -euros(700), windowEnd: '2026-09-05' }]);
  });

  it('avec suivi, une occurrence encore dans sa fenêtre compte', () => {
    const l = petitBudget();
    l.plannedFlows.push(flux({ id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', amount: -euros(700), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-08' } }));
    l.operations.push(opération({ id: 'cb', origin: 'imported', date: '2026-09-03', amount: -euros(20), state: 'untreated' }));
    const c = compte(planDe(l, '2026-10-01'), CC);
    expect(c.movements.filter((m) => m.flowId === 'f-loyer').map((m) => m.date)).toEqual(['2026-09-08', '2026-10-08']);
    expect(missingFlows(l, DEPUIS, LECTURE)).toEqual([]);
  });

  it('une occurrence reprise ne compte plus : l’opération qui la reprend compte à sa place, pour son propre montant', () => {
    const l = petitBudget();
    l.operations.push(opération({ id: 'salaire-sept', origin: 'imported', date: '2026-09-09', amount: euros(1900), plannedFlowId: 'f-salaire', state: 'reconciled' }));
    const c = compte(planDe(l, '2026-10-01', '2026-09-10'), CC);
    // Reprise dans la fenêtre du 25 septembre ? Non : le 9 est hors fenêtre (±3 jours) ; elle ne reprend rien.
    expect(c.movements.filter((m) => m.flowId === 'f-salaire').map((m) => m.date)).toEqual(['2026-09-25', '2026-10-25']);
    const l2 = petitBudget();
    l2.operations.push(opération({ id: 'salaire-sept', origin: 'imported', date: '2026-09-24', amount: euros(1900), plannedFlowId: 'f-salaire', state: 'reconciled' }));
    const c2 = compte(planDe(l2, '2026-10-01', '2026-09-26'), CC);
    expect(c2.movements.filter((m) => m.flowId === 'f-salaire').map((m) => m.date)).toEqual(['2026-10-25']);
    expect(c2.start).toBe(euros(1000 + 1900));
    expect(c2.end).toBe(euros(1000 + 1900 + 2000));
  });

  it('une saisie à venir qui reprend une occurrence compte à sa place, pour son propre montant (D88)', () => {
    const l = petitBudget();
    l.operations.push(opération({ id: 'salaire-corrigé', date: '2026-09-25', amount: euros(1900), plannedFlowId: 'f-salaire' }));
    const c = compte(planDe(l, '2026-10-01'), CC);
    expect(c.movements.filter((m) => m.flowId === 'f-salaire').map((m) => m.date)).toEqual(['2026-10-25']);
    expect(c.movements).toContainEqual(expect.objectContaining({ date: '2026-09-25', origin: 'saisie', amount: euros(1900), operationId: 'salaire-corrigé' }));
    expect(c.end).toBe(euros(1000 + 1900 + 2000));
  });

  it('un virement permanent enregistré compte à sa date, des deux côtés, sans changer le solde des tirelires (D29)', () => {
    const l = petitBudget();
    l.plannedFlows.push(
      flux({ id: 'f-vir', name: 'Virement Livret', kind: 'transfer', origin: 'derived', amount: -euros(150), counterpartAccountId: LIVRET, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-28' } }),
    );
    const sans = planDe(petitBudget(), '2026-10-01');
    const avec = planDe(l, '2026-10-01');
    expect(compte(avec, CC).end).toBe(compte(sans, CC).end - euros(300));
    expect(compte(avec, LIVRET).end).toBe(compte(sans, LIVRET).end + euros(300));
    expect(compte(avec, LIVRET).movements.map((m) => [m.date, m.origin, m.amount])).toEqual([
      ['2026-09-28', 'flux', euros(150)],
      ['2026-10-28', 'flux', euros(150)],
    ]);
    expect(tirelire(avec, 'tf').end).toBe(tirelire(sans, 'tf').end);
    // La composante se déplace vers le livret, où la tirelire est placée.
    expect(compte(avec, LIVRET).hosted.find((h) => h.tirelireId === 'tf')?.amount).toBe(euros(300) + (compte(sans, LIVRET).hosted.find((h) => h.tirelireId === 'tf')?.amount ?? 0));
  });

  it('[niveau 1] un virement proposé par le plan mais non enregistré ne compte pas (principe 1.3)', () => {
    const p = planDe(petitBudget(), '2026-10-01');
    expect(p.transfers.find((t) => t.accountId === LIVRET)?.net ?? 0, 'le plan propose bien un virement vers le livret').toBeGreaterThan(0);
    expect(compte(p, LIVRET).movements).toEqual([]);
    expect(compte(p, LIVRET).end).toBe(0);
  });

  it('[niveau 1] l’exemple : le virement permanent enregistré vers le Livret A compte, celui vers la Carte enfants, proposé seulement, ne compte pas', () => {
    const octobre = àVenir(exampleLedger(), LECTURE_EXEMPLE)[0]!;
    expect(compte(octobre, 'acc-livret').movements.every((m) => m.origin === 'flux' && m.flowId === 'flow-vir-livret')).toBe(true);
    expect(compte(octobre, 'acc-livret').movements.length).toBeGreaterThan(0);
    expect(compte(octobre, 'acc-enfants').movements).toEqual([]);
  });

  it('sur une tirelire, ses dotations comptent, datées du début de chaque période', () => {
    const t = tirelire(planDe(petitBudget(), '2026-10-01'), 'tf');
    const dotations = t.movements.filter((m) => m.origin === 'dotation');
    expect(dotations.map((m) => m.date)).toEqual(['2026-10-01']);
    const ligne = planDe(petitBudget(), '2026-10-01').lines.find((x) => x.needId === 'n-tf')!;
    expect(dotations[0]!.amount).toBe(ligne.requested);
  });
});

describe('[niveau 1] point 3 — un solde prévu négatif est un manque, au point le plus bas (principe 1.3 : le plan signale un risque à venir)', () => {
  it('une échéance plus forte que le compte, puis un revenu : le manque est daté de l’échéance, à son montant le plus bas', () => {
    const l = petitBudget();
    l.accounts[0]!.openingBalance = euros(100);
    // Le salaire ne tombe qu'à partir de novembre, le 20 ; l'échéance est le 15.
    l.plannedFlows[0] = { ...l.plannedFlows[0]!, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-11-20' } };
    const c = compte(planDe(l, '2026-11-01'), CC);
    expect(c.shortfall).toEqual({ date: '2026-11-15', amount: euros(100 - 1200) });
    expect(c.end).toBe(euros(100 - 1200 + 2000));
  });

  it('deux creux dans la période : le manque est le plus profond, pas le premier', () => {
    const l = petitBudget();
    l.accounts[0]!.openingBalance = euros(100);
    const unique = (id: string, kind: PlannedFlow['kind'], amount: number, jour: string) =>
      flux({ id, name: id, kind, amount, periodicity: { interval: 12, unit: 'month', anchorDate: jour } });
    l.plannedFlows.length = 0;
    l.plannedFlows.push(unique('f-a', 'fixedCharge', -euros(200), '2026-11-10'), unique('f-b', 'fixedCharge', -euros(400), '2026-11-20'), unique('f-c', 'income', euros(1000), '2026-11-25'));
    const c = compte(planDe(l, '2026-11-01'), CC);
    expect(c.shortfall).toEqual({ date: '2026-11-20', amount: euros(100 - 200 - 400) });
    expect(c.end).toBe(euros(100 - 200 - 400 + 1000));
  });

  it('pas de manque quand le solde prévu reste positif, ni quand il tombe juste à zéro', () => {
    expect(compte(planDe(petitBudget(), '2026-11-01'), CC).shortfall).toBeUndefined();
    const l = petitBudget();
    l.accounts[0]!.openingBalance = euros(1200);
    l.plannedFlows.length = 0;
    l.plannedFlows.push(flux({ id: 'f-tf', name: 'Taxe foncière (prélèvement)', kind: 'fixedCharge', amount: -euros(1200), periodicity: { interval: 12, unit: 'month', anchorDate: '2026-11-15' } }));
    const c = compte(planDe(l, '2026-11-01'), CC);
    expect(c.end).toBe(0);
    expect(c.shortfall).toBeUndefined();
  });

  it('une tirelire que l’échéance vide au-delà de ce qu’elle porte est en manque à la date de l’échéance', () => {
    const l = petitBudget();
    l.tirelires[0]!.openingBalance = 0;
    l.needs.length = 0;
    const t = tirelire(planDe(l, '2026-11-01'), 'tf');
    expect(t.shortfall).toEqual({ date: '2026-11-15', amount: -euros(1200) });
  });

  it('un manque déjà là au début de la période se date de son premier jour', () => {
    const l = petitBudget();
    l.accounts[0]!.openingBalance = -euros(500);
    l.plannedFlows.splice(0, 1);
    const c = compte(planDe(l, '2026-10-01'), CC);
    expect(c.shortfall).toEqual({ date: '2026-10-01', amount: -euros(500) });
  });
});

describe('[niveau 2] point 4 — chaque opération qui fait un solde prévu porte son origine', () => {
  it('le flux qui la produit, la dotation de la tirelire, ou « saisie »', () => {
    const l = petitBudget();
    l.operations.push(opération({ id: 'achat-futur', date: '2026-11-03', amount: -euros(40) }));
    l.subOperations.push({ id: 'al-achat', operationId: 'achat-futur', tirelireId: 'tf', share: { kind: 'fixed', amount: -euros(40) } });
    const p = planDe(l, '2026-11-01');
    const t = tirelire(p, 'tf');
    expect(t.movements).toContainEqual(expect.objectContaining({ origin: 'flux', flowId: 'f-tf', date: '2026-11-15', amount: -euros(1200) }));
    expect(t.movements).toContainEqual(expect.objectContaining({ origin: 'dotation', date: '2026-11-01' }));
    expect(t.movements).toContainEqual(expect.objectContaining({ origin: 'saisie', operationId: 'achat-futur', amount: -euros(40) }));
    for (const m of [...t.movements, ...compte(p, CC).movements]) expect(['flux', 'dotation', 'liberation', 'saisie', 'releve', 'ouverture']).toContain(m.origin);
    for (const m of compte(p, CC).movements.filter((x) => x.origin === 'flux')) expect(l.plannedFlows.map((f) => f.id)).toContain(m.flowId);
  });
});

describe('[niveau 1] point 5 — le solde prévu d’un compte est la somme des tirelires qu’il héberge, plus son non affecté (I2)', () => {
  const cas: Array<[string, () => Ledger, string]> = [
    ['l’exemple', exampleLedger, LECTURE_EXEMPLE],
    ['le petit budget', petitBudget, LECTURE],
    [
      'le petit budget, avec un virement permanent',
      () => {
        const l = petitBudget();
        l.plannedFlows.push(flux({ id: 'f-vir', name: 'Virement Livret', kind: 'transfer', origin: 'derived', amount: -euros(150), counterpartAccountId: LIVRET }));
        return l;
      },
      LECTURE,
    ],
  ];
  it.each(cas)('%s : au centime près, à la fin de chaque période à venir', (_nom, faire, lecture) => {
    const l = faire();
    for (const p of àVenir(l, lecture)) {
      const f = p.forecast!;
      // Le grand livre que les fonctions de `balances.ts` lisent : celui du plan, opérations prévues comprises.
      const prevu = withPlannedOperations(l, lecture, f.period.end).ledger;
      const idx = indexLedger(prevu);
      for (const a of f.accounts) {
        const réel = l.accounts.find((x) => x.id === a.id)!;
        const où = `${p.period.label} · ${a.name}`;
        expect(a.end, `${où} : solde prévu`).toBe(accountBalance(réel, prevu, f.period.end));
        // I2 tel qu'il est écrit : solde bancaire = somme des tirelires hébergées + non affecté.
        expect(a.hosted.reduce((s, h) => s + h.amount, 0) + a.unallocated, où).toBe(a.end);
        expect(a.hosted.reduce((s, h) => s + h.amount, 0), `${où} : tirelires hébergées`).toBe(componentsOnAccount(réel, idx, f.period.end));
        expect(a.unallocated, `${où} : non affecté`).toBe(unallocated(réel, prevu, idx, f.period.end));
      }
      // Le solde prévu d'une tirelire répartie est la somme de ses composantes, comptes confondus.
      for (const t of f.tirelires) {
        const composantes = f.accounts.reduce((s, a) => s + (a.hosted.find((h) => h.tirelireId === t.id)?.amount ?? 0), 0);
        expect(composantes, `${p.period.label} · ${t.name} : somme des composantes`).toBe(t.end);
        expect(t.end, `${p.period.label} · ${t.name} : solde prévu`).toBe(tirelireBalance(l.tirelires.find((x) => x.id === t.id)!, idx, f.period.end));
      }
    }
  });
});

describe('[niveau 2] point 6 — la période où l’on lit se lit sur le réel ; une période à venir vire ce que les tirelires demandent', () => {
  it('la période où l’on lit n’a pas de solde prévu', () => {
    const courante = plans(exampleLedger(), LECTURE_EXEMPLE).find((p) => p.period.start <= LECTURE_EXEMPLE && p.period.end >= LECTURE_EXEMPLE)!;
    expect(courante.simulated).toBe(false);
    expect(courante.forecast).toBeUndefined();
  });

  it('pour une période à venir, ce qu’on vire vers un compte d’accueil vaut ce que les tirelires placées là demandent', () => {
    for (const p of àVenir(exampleLedger(), LECTURE_EXEMPLE)) {
      for (const t of p.transfers) {
        const demande = p.lines.filter((x) => x.accountId === t.accountId).reduce((s, x) => s + x.requested, 0);
        expect({ période: p.period.label, compte: t.accountName, viré: t.net }).toEqual({ période: p.period.label, compte: t.accountName, viré: demande });
      }
    }
  });
});

describe('[niveau 0] point 7 — calculer le solde prévu ne modifie rien, et aucune opération prévue ne s’enregistre (I10)', () => {
  it('le grand livre est le même avant et après, sans opération prévue', () => {
    const l = petitBudget();
    l.plannedFlows.push(flux({ id: 'f-vir', name: 'Virement Livret', kind: 'transfer', origin: 'derived', amount: -euros(150), counterpartAccountId: LIVRET }));
    const avant = JSON.stringify(l);
    for (const p of àVenir(l, LECTURE)) expect(p.forecast).toBeDefined();
    expect(JSON.stringify(l)).toBe(avant);
    const ex = exampleLedger();
    const avantEx = JSON.stringify(ex);
    àVenir(ex, LECTURE_EXEMPLE);
    expect(JSON.stringify(ex)).toBe(avantEx);
  });
});

describe('[niveau 2] point 9 (ajouté par l’auditeur) — une libération de reliquat compte dans le solde prévu d’une tirelire, avec son origine (D29)', () => {
  it('l’exemple, octobre : « Alimentation », à remise à zéro et sans réserve, rend son solde le dernier jour de sa période, puis reçoit sa dotation', () => {
    const octobre = àVenir(exampleLedger(), LECTURE_EXEMPLE)[0]!;
    const t = tirelire(octobre, 'env-alim');
    expect(t.movements.map((m) => [m.date, m.origin, m.amount])).toEqual([
      ['2026-09-27', 'liberation', -euros(900)],
      ['2026-09-28', 'dotation', euros(900)],
    ]);
    expect([t.start, t.end]).toEqual([euros(900), euros(900)]);
  });
});

describe('[niveau 2] point 10 — la dotation du solde prévu d’une tirelire est celle que sa ligne du plan demande : un seul calcul (D88, D29)', () => {
  /** Ce que les lignes d'une tirelire demandent, et ce que son solde prévu reçoit au début de la période. */
  function deuxLectures(p: Plan, tirelireId: string) {
    const ligne = p.lines.filter((l) => l.tirelireId === tirelireId).reduce((s, l) => s + l.requested, 0);
    const dotation = tirelire(p, tirelireId).movements.filter((m) => m.origin === 'dotation' && m.date === p.period.start).reduce((s, m) => s + m.amount, 0);
    return { ligne, dotation };
  }

  it('l’exemple : chaque tirelire, sur chaque période à venir', () => {
    const périodes = àVenir(exampleLedger(), LECTURE_EXEMPLE);
    expect(périodes.length).toBeGreaterThanOrEqual(4);
    for (const p of périodes) {
      for (const t of p.forecast!.tirelires) {
        const { ligne, dotation } = deuxLectures(p, t.id);
        expect({ période: p.period.label, tirelire: t.name, dotation }).toEqual({ période: p.period.label, tirelire: t.name, dotation: ligne });
      }
    }
  });

  it('l’exemple : de novembre à janvier, la taxe foncière, vidée le 15 octobre, redemande sa croisière', () => {
    const périodes = àVenir(exampleLedger(), LECTURE_EXEMPLE).filter((p) => ['novembre 2026', 'décembre 2026', 'janvier 2027'].includes(p.period.label));
    expect(périodes.length).toBe(3);
    for (const p of périodes) {
      expect({ période: p.period.label, ...deuxLectures(p, 'env-tf') }).toEqual({ période: p.period.label, ligne: euros(100), dotation: euros(100) });
    }
  });

  it('la période où l’on lit se calcule sur le réel : une occurrence encore dans sa fenêtre, que rien n’a reprise, ne change pas ses lignes', () => {
    const l = petitBudget();
    // L'échéance de 1 200 € est prévue le 8 septembre, dans la période où l'on lit (le 10), fenêtre de 3 jours : encore attendue.
    l.needs[0] = { ...l.needs[0]!, periodicity: { interval: 12, unit: 'month', anchorDate: '2026-09-08' } };
    l.plannedFlows[1] = { ...l.plannedFlows[1]!, periodicity: { interval: 12, unit: 'month', anchorDate: '2026-09-08' } };
    const avec = planDe(l, LECTURE);
    const sans = planDe({ ...l, plannedFlows: l.plannedFlows.filter((f) => f.id !== 'f-tf') }, LECTURE);
    expect(avec.simulated).toBe(false);
    expect(avec.lines.length).toBeGreaterThan(0);
    // Ce que le plan lit sur le réel : ses lignes, ce qu'il vire, ses totaux (dont le non affecté du compte principal), ses écarts de placement.
    const lu = (p: Plan) => ({ lignes: p.lines.map((x) => [x.needId, x.balance, x.requested]), virements: p.transfers, totaux: p.totals, écarts: p.gaps, alertes: p.warnings });
    expect(lu(avec)).toEqual(lu(sans));
  });
});

describe('[niveau 2] point 11 — « attendue, non reçue » : le bloc « Attendus, non reçus » et le solde prévu reconnaissent la même occurrence (D12, D88)', () => {
  /** Le petit budget, avec un loyer de 700 € le 2 de chaque mois (fenêtre de 3 jours) et un relevé importé le 3 septembre : le compte courant est suivi. */
  function suivi(): Ledger {
    const l = petitBudget();
    l.plannedFlows.push(flux({ id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', amount: -euros(700), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-02' } }));
    l.operations.push(opération({ id: 'cb', origin: 'imported', date: '2026-09-03', amount: -euros(20), state: 'untreated' }));
    return l;
  }
  /** Les dates où le solde prévu d'octobre compte le loyer, lu à `lecture`. */
  const loyers = (l: Ledger, lecture: string) => compte(planDe(l, '2026-10-01', lecture), CC).movements.filter((m) => m.flowId === 'f-loyer').map((m) => m.date);

  it('jusqu’au bord de la fenêtre : la dernière journée l’occurrence compte et n’est pas dite manquante, le lendemain l’inverse', () => {
    const l = suivi();
    // La fenêtre du 2 septembre finit le 5 : le 5, l'occurrence est encore attendue.
    expect(missingFlows(l, DEPUIS, '2026-09-05')).toEqual([]);
    expect(loyers(l, '2026-09-05')).toEqual(['2026-09-02', '2026-10-02']);
    // Le 6, la fenêtre est passée sans reprise : le bloc la dit manquante, le solde prévu ne la compte plus.
    expect(missingFlows(l, DEPUIS, '2026-09-06').map((m) => [m.flowId, m.expectedDate])).toEqual([['f-loyer', '2026-09-02']]);
    expect(loyers(l, '2026-09-06')).toEqual(['2026-10-02']);
  });

  it('une occurrence reprise n’est pas dite manquante, et n’est pas comptée deux fois', () => {
    const l = suivi();
    l.operations.push(opération({ id: 'loyer-sept', origin: 'imported', date: '2026-09-03', amount: -euros(700), plannedFlowId: 'f-loyer', state: 'reconciled' }));
    expect(missingFlows(l, DEPUIS, LECTURE)).toEqual([]);
    expect(loyers(l, LECTURE)).toEqual(['2026-10-02']);
  });
});
