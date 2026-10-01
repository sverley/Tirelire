/**
 * Tests du codeur de #296 — le plan d'une période à venir montre le solde prévu des comptes et des
 * tirelires (D52, D88). Tous de niveau 4 (rôle du codeur) : l'auditeur choisit parmi eux.
 *
 * Chaque `describe` reprend un point du « Fait quand » sous son numéro ; le point 4 se lit aussi à
 * l'écran (`apps/web/test/navigateur/solde-prevu.test.ts`), et le point 8 est de la documentation.
 * Données inventées (D84) : l'exemple, lu à sa date de lecture, et de petits grands livres écrits ici.
 */
import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  alive,
  computePlan,
  emptyLedger,
  euros,
  exampleLedger,
  indexLedger,
  periodsAround,
  tirelireBalance,
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

describe('[niveau 4] point 1 — une période à venir montre le solde prévu de chaque compte et de chaque tirelire à sa fin', () => {
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

  it('une opération saisie à une date future compte jusqu’à la fin de la période qui la contient', () => {
    const l = petitBudget();
    l.operations.push(opération({ id: 'achat-futur', date: '2026-10-08', amount: -euros(250) }));
    const sans = compte(planDe(petitBudget(), '2026-10-01'), CC).end;
    const octobre = compte(planDe(l, '2026-10-01'), CC);
    expect(octobre.end).toBe(sans - euros(250));
    expect(octobre.movements).toContainEqual(expect.objectContaining({ date: '2026-10-08', origin: 'saisie', amount: -euros(250), operationId: 'achat-futur' }));
  });
});

describe('[niveau 4] point 2 — ce qui compte, et ce qui ne compte plus', () => {
  it('sans suivi, chaque occurrence d’un flux compte à sa date : septembre et octobre, pour octobre', () => {
    const c = compte(planDe(petitBudget(), '2026-10-01'), CC);
    expect(c.tracked).toBe(false);
    expect(c.start).toBe(euros(1000));
    expect(c.movements.filter((m) => m.origin === 'flux' && m.flowId === 'f-salaire').map((m) => m.date)).toEqual(['2026-09-25', '2026-10-25']);
    expect(c.end).toBe(euros(5000));
    expect(c.notReceived).toEqual([]);
  });

  it('sans suivi, une occurrence passée compte aussi : rien ne se confronte (U1)', () => {
    const l = petitBudget();
    l.plannedFlows.push(flux({ id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', amount: -euros(700), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-02' } }));
    const c = compte(planDe(l, '2026-10-01'), CC);
    expect(c.movements.filter((m) => m.flowId === 'f-loyer').map((m) => m.date)).toEqual(['2026-09-02', '2026-10-02']);
    expect(c.notReceived).toEqual([]);
  });

  it('avec suivi, une occurrence dont la fenêtre est passée sans reprise ne compte plus et se signale « attendue, non reçue »', () => {
    const l = petitBudget();
    l.plannedFlows.push(flux({ id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', amount: -euros(700), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-02' } }));
    l.operations.push(opération({ id: 'cb', origin: 'imported', date: '2026-09-03', amount: -euros(20), state: 'untreated' }));
    const c = compte(planDe(l, '2026-10-01'), CC);
    expect(c.tracked).toBe(true);
    expect(c.movements.filter((m) => m.flowId === 'f-loyer').map((m) => m.date)).toEqual(['2026-10-02']);
    expect(c.notReceived).toEqual([{ flowId: 'f-loyer', label: 'Loyer', date: '2026-09-02', windowEnd: '2026-09-05', amount: -euros(700) }]);
  });

  it('avec suivi, une occurrence encore dans sa fenêtre compte', () => {
    const l = petitBudget();
    l.plannedFlows.push(flux({ id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', amount: -euros(700), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-08' } }));
    l.operations.push(opération({ id: 'cb', origin: 'imported', date: '2026-09-03', amount: -euros(20), state: 'untreated' }));
    const c = compte(planDe(l, '2026-10-01'), CC);
    expect(c.movements.filter((m) => m.flowId === 'f-loyer').map((m) => m.date)).toEqual(['2026-09-08', '2026-10-08']);
    expect(c.notReceived).toEqual([]);
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

  it('un virement proposé par le plan mais non enregistré ne compte pas', () => {
    const p = planDe(petitBudget(), '2026-10-01');
    expect(p.transfers.find((t) => t.accountId === LIVRET)?.net ?? 0, 'le plan propose bien un virement vers le livret').toBeGreaterThan(0);
    expect(compte(p, LIVRET).movements).toEqual([]);
    expect(compte(p, LIVRET).end).toBe(0);
  });

  it('l’exemple : le virement permanent enregistré vers le Livret A compte, celui vers la Carte enfants, proposé seulement, ne compte pas', () => {
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

describe('[niveau 4] point 3 — un solde prévu négatif est un manque, au point le plus bas', () => {
  it('une échéance plus forte que le compte, puis un revenu : le manque est daté de l’échéance, à son montant le plus bas', () => {
    const l = petitBudget();
    l.accounts[0]!.openingBalance = euros(100);
    // Le salaire ne tombe qu'à partir de novembre, le 20 ; l'échéance est le 15.
    l.plannedFlows[0] = { ...l.plannedFlows[0]!, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-11-20' } };
    const c = compte(planDe(l, '2026-11-01'), CC);
    expect(c.shortfall).toEqual({ date: '2026-11-15', amount: euros(100 - 1200) });
    expect(c.end).toBe(euros(100 - 1200 + 2000));
  });

  it('pas de manque quand le solde prévu reste positif', () => {
    expect(compte(planDe(petitBudget(), '2026-11-01'), CC).shortfall).toBeUndefined();
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

describe('[niveau 4] point 4 — chaque opération qui fait un solde prévu porte son origine', () => {
  it('le flux qui la produit, la dotation de la tirelire, ou « saisie »', () => {
    const l = petitBudget();
    l.operations.push(opération({ id: 'achat-futur', date: '2026-11-03', amount: -euros(40) }));
    l.allocations.push({ id: 'al-achat', operationId: 'achat-futur', tirelireId: 'tf', share: { kind: 'fixed', amount: -euros(40) } });
    const p = planDe(l, '2026-11-01');
    const t = tirelire(p, 'tf');
    expect(t.movements).toContainEqual(expect.objectContaining({ origin: 'flux', flowId: 'f-tf', date: '2026-11-15', amount: -euros(1200) }));
    expect(t.movements).toContainEqual(expect.objectContaining({ origin: 'dotation', date: '2026-11-01' }));
    expect(t.movements).toContainEqual(expect.objectContaining({ origin: 'saisie', operationId: 'achat-futur', amount: -euros(40) }));
    for (const m of [...t.movements, ...compte(p, CC).movements]) expect(['flux', 'dotation', 'liberation', 'saisie', 'releve', 'ouverture']).toContain(m.origin);
    for (const m of compte(p, CC).movements.filter((x) => x.origin === 'flux')) expect(l.plannedFlows.map((f) => f.id)).toContain(m.flowId);
  });
});

describe('[niveau 4] point 5 — le solde prévu d’un compte est la somme des tirelires qu’il héberge, plus son non affecté (I2)', () => {
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
    for (const p of àVenir(faire(), lecture)) {
      const f = p.forecast!;
      for (const a of f.accounts) expect(a.hosted.reduce((s, h) => s + h.amount, 0) + a.unallocated, `${p.period.label} · ${a.name}`).toBe(a.end);
      // Le solde prévu d'une tirelire répartie est la somme de ses composantes.
      for (const t of f.tirelires) {
        const composantes = f.accounts.reduce((s, a) => s + (a.hosted.find((h) => h.tirelireId === t.id)?.amount ?? 0), 0);
        expect(composantes, `${p.period.label} · ${t.name}`).toBe(t.end);
      }
    }
  });
});

describe('[niveau 4] point 6 — la période où l’on lit se lit sur le réel ; une période à venir vire ce que les tirelires demandent', () => {
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

describe('[niveau 4] point 7 — calculer le solde prévu ne modifie rien, et aucune opération prévue ne s’enregistre', () => {
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
