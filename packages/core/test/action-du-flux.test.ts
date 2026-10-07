/**
 * Tests du codeur de #393 : le flux porte une action d'automatisme ; l'ordre permanent en est le
 * premier usage (D21, D24, D57, D60 amendées). Chaque `describe` nomme le point du « Fait quand »
 * qu'il vérifie. Les points 2, 3, 15 et 17 sont aussi tenus par les fichiers adaptés
 * (`flux-derives-besoin.test.ts`, `parcours-u2.test.ts`, `plan-solde-prevu.test.ts`,
 * `import.test.ts`) ; ceux-ci ne vérifient que ce qu'aucun autre ne vérifie.
 *
 * Données inventées : un compte courant, un livret, deux tirelires placées sur le livret.
 */
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import {
  applyMatch,
  applyPatchToLedger,
  computePlan,
  correctPlannedOperation,
  emptyLedger,
  euros,
  exampleLedger,
  exportBundle,
  formatCents,
  importBundle,
  indexLedger,
  LedgerStore,
  lireBudgetJson,
  matchTirelireTransfers,
  normalizeLabel,
  proposeMatches,
  runPipeline,
  standingOrderFlows,
  standingTransferFlow,
  tirelireComponents,
  unallocatedAmount,
  verifierFichier,
  withPlannedOperations,
  BUDGET_JSON_FORMAT,
  BUDGET_JSON_VERSION,
  FORMAT_VERSION,
  type Ledger,
  type Operation,
  type PlannedFlow,
} from '../src/index.js';

const SQL = await initSqlJs();
const CC = 'acc-principal';
const LIVRET = 'livret';
const LECTURE = '2026-09-06';
const mensuel = (anchorDate: string) => ({ interval: 1, unit: 'month' as const, anchorDate });

/** Deux tirelires sur le livret : une échéance (taxe, 100 €/mois), un objectif (vacances, 200 €/mois). */
function budget(pas = euros(10)): Ledger {
  const l = emptyLedger({ periodStartDay: 28, orderRounding: pas });
  l.accounts.push(
    { id: CC, name: 'Compte courant', kind: 'principal', openingBalance: euros(3000), openingDate: '2026-08-27' },
    { id: LIVRET, name: 'Livret', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-27' },
  );
  l.tirelires.push(
    { id: 'taxe', name: 'Taxe', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' },
    { id: 'vac', name: 'Vacances', placement: [{ accountId: LIVRET, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' },
  );
  l.needs.push(
    { id: 'n-taxe', tirelireId: 'taxe', kind: 'dueDate', amount: euros(1200), periodicity: { interval: 12, unit: 'month', anchorDate: '2027-08-15' }, priority: 10 },
    { id: 'n-vac', tirelireId: 'vac', kind: 'goal', amount: euros(5000), monthlyAmount: euros(200), priority: 30 },
  );
  l.categories.push({ id: 'cat-vir', name: 'Épargne', nature: 'expense', tirelireId: 'vac' });
  l.plannedFlows.push({ id: 'salaire', name: 'Salaire', kind: 'income', amount: euros(2500), accountId: CC, periodicity: mensuel('2026-08-28'), dateWindowDays: 3 });
  return l;
}

const ordre = (o: Partial<PlannedFlow> & Pick<PlannedFlow, 'id' | 'amount'>): PlannedFlow => ({
  name: 'Virement livret',
  kind: 'transfer',
  accountId: CC,
  counterpartAccountId: LIVRET,
  periodicity: mensuel('2026-08-28'),
  dateWindowDays: 5,
  labelPattern: 'TIRELIRE LIVRET',
  ...o,
});
const avec = (l: Ledger, ...flux: PlannedFlow[]): Ledger => ({ ...l, plannedFlows: [...l.plannedFlows, ...flux] });
const livret = (l: Ledger, lecture = LECTURE) => computePlan(l, lecture).transfers.find((t) => t.accountId === LIVRET);
const alertes = (l: Ledger, code = 'bankOrderDrift', lecture = LECTURE) => computePlan(l, lecture).warnings.filter((w) => w.code === code);

function ligne(montant: number, date = '2026-09-28', id = 'op-vir'): Operation {
  const libellé = 'VIR PERMANENT TIRELIRE LIVRET';
  return { id, accountId: CC, origin: 'imported', date, label: libellé, normalizedLabel: normalizeLabel(libellé), amount: -montant, state: 'untreated' };
}

describe('[niveau 4] #393 · 1. l’action d’un flux', () => {
  it('une catégorie seule classe comme aujourd’hui : une part variable, la tirelire par défaut de la catégorie (D32)', () => {
    const l = avec(budget(), ordre({ id: 'o', amount: -euros(300), action: { categoryId: 'cat-vir' } }));
    const op = ligne(euros(300));
    const l2 = { ...l, operations: [op] };
    const p = applyMatch(l2, proposeMatches(l2, '2026-09-01', '2026-10-31')[0]!);
    expect(p.subOperations.map((s) => [s.categoryId, s.tirelireId, s.share])).toEqual([['cat-vir', 'vac', { kind: 'variable' }]]);
  });

  it('une échéance se relie à la tirelire de son action quand elle en nomme exactement une (D53)', async () => {
    const { needForDueDateFlow, dueDateFlowForNeed } = await import('../src/index.js');
    const l = budget();
    const une: PlannedFlow = { id: 'f', name: 'Taxe', kind: 'dueDate', amount: -euros(1200), accountId: CC, periodicity: { interval: 12, unit: 'month', anchorDate: '2027-08-15' }, dateWindowDays: 5, action: { tirelireId: 'taxe' } };
    const deux: PlannedFlow = { ...une, id: 'g', action: { allocation: [{ tirelireId: 'taxe', share: { kind: 'percent', pct: 50 } }, { tirelireId: 'vac', share: { kind: 'variable' } }] } };
    expect(needForDueDateFlow(une, l.needs, LECTURE)?.id).toBe('n-taxe');
    expect(dueDateFlowForNeed(l.needs[0]!, [une], LECTURE)?.id).toBe('f');
    expect(needForDueDateFlow(deux, l.needs, LECTURE)).toBeUndefined();
    expect(dueDateFlowForNeed(l.needs[0]!, [deux], LECTURE)).toBeUndefined();
  });

  it('l’état Verrouiller verrouille ce que le flux reprend ; Rapprocher le rapproche', () => {
    for (const [state, attendu] of [['lock', 'locked'], ['reconcile', 'reconciled']] as const) {
      const l = { ...avec(budget(), ordre({ id: 'o', amount: -euros(300), action: { state } })), operations: [ligne(euros(300))] };
      const après = applyPatchToLedger(l, applyMatch(l, proposeMatches(l, '2026-09-01', '2026-10-31')[0]!));
      expect(après.operations.find((o) => o.id === 'op-vir')!.state, state).toBe(attendu);
    }
  });
});

describe('[niveau 4] #393 · 2 et 3. les parts, à la reprise, à la correction et au solde prévu', () => {
  const parts = { allocation: [{ tirelireId: 'taxe', share: { kind: 'fixed' as const, amount: -euros(100) } }, { tirelireId: 'vac', share: { kind: 'percent' as const, pct: 50 } }] };

  it('une part fixe vaut son montant, une part en pourcentage se calcule sur le montant de l’opération, le reste est non affecté', () => {
    const l = { ...avec(budget(), ordre({ id: 'o', amount: -euros(300), amountTolerance: { pct: 50 }, action: parts })), operations: [ligne(euros(400))] };
    const après = applyPatchToLedger(l, applyMatch(l, proposeMatches(l, '2026-09-01', '2026-10-31')[0]!));
    const idx = indexLedger(après);
    const op = après.operations.find((o) => o.id === 'op-vir')!;
    expect(unallocatedAmount(op, idx)).toBe(-euros(400 - 100 - 200));
    expect(tirelireComponents(idx.tireliresById.get('vac')!, idx, '2026-09-30').get(LIVRET)).toBe(euros(200));
  });

  it('une saisie qui corrige une occurrence prend l’action à sa création ; l’opération bancaire qui la reprend prend celle de la saisie', () => {
    let l = avec(budget(), ordre({ id: 'o', amount: -euros(300), action: parts }));
    l = applyPatchToLedger(l, correctPlannedOperation(l, 'o', '2026-09-28', -euros(250), '2026-09-28'));
    const saisie = l.operations.find((o) => o.plannedFlowId === 'o')!;
    expect(l.subOperations.filter((s) => s.operationId === saisie.id).map((s) => [s.tirelireId, s.share])).toEqual(parts.allocation.map((p) => [p.tirelireId, p.share]));
  });

  it('l’opération prévue compte avec les parts, sans répartition par l’ordre de financement', () => {
    const l = avec(budget(), ordre({ id: 'o', amount: -euros(300), action: parts, periodicity: mensuel('2026-09-28') }));
    const prevu = withPlannedOperations(l, LECTURE, '2026-09-30').ledger;
    const idx = indexLedger(prevu);
    expect(tirelireComponents(idx.tireliresById.get('taxe')!, idx, '2026-09-30').get(LIVRET)).toBe(euros(100));
    expect(tirelireComponents(idx.tireliresById.get('vac')!, idx, '2026-09-30').get(LIVRET)).toBe(euros(150));
    const op = prevu.operations.find((o) => o.plannedFlowId === 'o' && o.accountId === CC)!;
    expect(unallocatedAmount(op, idx)).toBe(-euros(50));
  });
});

describe('[niveau 4] #393 · 4. un virement reconnu par son libellé, puis par un ordre, dans les deux ordres', () => {
  it('reconnu d’abord par le libellé puis repris par l’ordre, ou l’inverse : la même ventilation, celle de l’ordre', () => {
    const l = { ...avec(budget(), ordre({ id: 'o', amount: -euros(300), action: { allocation: [{ tirelireId: 'vac', share: { kind: 'fixed', amount: -euros(300) } }] } })), operations: [ligne(euros(300))] };
    // Le pipeline : le libellé d'abord, l'ordre ensuite.
    let a = l;
    runPipeline(a, '2026-09-01', '2026-10-31', (p) => (a = applyPatchToLedger(a, p)));
    // L'ordre d'abord, le libellé ensuite.
    let b = applyPatchToLedger(l, applyMatch(l, proposeMatches(l, '2026-09-01', '2026-10-31')[0]!));
    b = applyPatchToLedger(b, matchTirelireTransfers(b));
    for (const x of [a, b]) {
      const op = x.operations.find((o) => o.id === 'op-vir')!;
      expect(op.plannedFlowId).toBe('o');
      expect(x.subOperations.filter((s) => s.operationId === 'op-vir').map((s) => [s.tirelireId, s.share])).toEqual([['vac', { kind: 'fixed', amount: -euros(300) }]]);
    }
  });
});

describe('[niveau 4] #393 · 5. les ordres permanents d’un compte', () => {
  it('décrit sur le principal ou sur le compte d’accueil, tout virement du principal vers ce compte est un ordre ; le sens inverse n’en est pas un', () => {
    const l = avec(
      budget(),
      ordre({ id: 'a', amount: -euros(100) }),
      ordre({ id: 'b', amount: euros(50), accountId: LIVRET, counterpartAccountId: CC }),
      ordre({ id: 'retour', amount: euros(20) }),
      ordre({ id: 'retour2', amount: -euros(20), accountId: LIVRET, counterpartAccountId: CC }),
    );
    expect(standingOrderFlows(l.plannedFlows, CC, LIVRET, LECTURE).map((f) => f.id)).toEqual(['a', 'b']);
    expect(livret(l)!.bankOrder).toMatchObject({ flowIds: ['a', 'b'], amount: euros(150) });
    expect(livret(l)!.bankOrder!.flowId).toBeUndefined();
  });

  it('chacun pour son équivalent mensuel, arrondi au centime, et seulement si sa validité couvre la date lue', () => {
    const l = avec(
      budget(),
      ordre({ id: 'trimestriel', amount: -euros(300), periodicity: { interval: 3, unit: 'month', anchorDate: '2026-08-28' } }),
      ordre({ id: 'hebdo', amount: -euros(10), periodicity: { interval: 1, unit: 'week', anchorDate: '2026-08-28' } }),
      ordre({ id: 'fini', amount: -euros(500), activeTo: '2026-08-31' }),
      ordre({ id: 'futur', amount: -euros(500), activeFrom: '2026-10-01' }),
    );
    expect(livret(l)!.bankOrder!.flowIds).toEqual(['hebdo', 'trimestriel']);
    expect(livret(l)!.bankOrder!.amount).toBe(euros(100) + Math.round(euros(10) / ((7 / 365.2425) * 12)));
  });
});

describe('[niveau 4] #393 · 6. l’écart du montant', () => {
  it('sans aucune tirelire (U5), aucun compte n’est comparé et rien n’est signalé', () => {
    const l = budget();
    const sans: Ledger = { ...avec(l, ordre({ id: 'o', amount: -euros(300) })), tirelires: [], needs: [] };
    expect(livret(sans)?.bankOrder).toBeUndefined();
    expect(alertes(sans)).toEqual([]);
  });

  it('un compte sans tirelire placée, ou dont les tirelires ne demandent plus rien, est signalé comme plus demandé, à tout montant', () => {
    const l = budget();
    const autre: Ledger = { ...l, accounts: [...l.accounts, { id: 'marie', name: 'Compte de Marie', kind: 'courant', openingBalance: 0, openingDate: '2026-08-27' }] };
    const l2 = avec(autre, ordre({ id: 'm', amount: -euros(1), counterpartAccountId: 'marie' }));
    expect(alertes(l2).map((w) => [w.accountId, /plus demandé/.test(w.message)])).toEqual([['marie', true]]);
  });

  it('le message nomme le compte, le montant enregistré et celui que le budget demande, et dit quoi faire', () => {
    const [w] = alertes(avec(budget(), ordre({ id: 'o', amount: -euros(250) })));
    expect(w!.message).toBe(`L'ordre permanent vers « Livret » est enregistré à ${formatCents(euros(250))}, le budget en demande ${formatCents(euros(300))} : à modifier chez votre banque, puis à confirmer ici.`);
  });
});

describe('[niveau 4] #393 · 7. l’écart d’une part fixe', () => {
  const avecParts = (taxe: number, vac: number, pas = euros(10)) =>
    avec(budget(pas), ordre({ id: 'o', amount: -euros(300), action: { allocation: [{ tirelireId: 'taxe', share: { kind: 'fixed', amount: -taxe } }, { tirelireId: 'vac', share: { kind: 'fixed', amount: -vac } }] } }));

  it('chaque tirelire à part fixe se compare à sa ligne du détail, au-delà du pas, dans les deux sens', () => {
    expect(alertes(avecParts(euros(100), euros(200)), 'bankOrderPartDrift')).toEqual([]);
    expect(alertes(avecParts(euros(110), euros(190)), 'bankOrderPartDrift')).toEqual([]);
    const deux = alertes(avecParts(euros(80), euros(220)), 'bankOrderPartDrift');
    expect(deux.map((w) => w.tirelireId)).toEqual(['taxe', 'vac']);
    expect(deux[0]!.message).toContain('Livret');
    expect(deux[0]!.message).toContain('Taxe');
    expect(deux[0]!.message).toContain(formatCents(euros(80)));
    expect(deux[0]!.message).toContain(formatCents(euros(100)));
    expect(alertes(avecParts(euros(100) - 1, euros(200) + 1, 0), 'bankOrderPartDrift')).toHaveLength(2);
  });

  it('une tirelire absente du détail se compare à zéro ; une part en pourcentage ou variable ne se compare pas', () => {
    const l = budget();
    const sansVac: Ledger = { ...l, needs: l.needs.filter((n) => n.tirelireId !== 'vac') };
    const l2 = avec(sansVac, ordre({ id: 'o', amount: -euros(300), action: { allocation: [{ tirelireId: 'vac', share: { kind: 'fixed', amount: -euros(5) } }, { tirelireId: 'taxe', share: { kind: 'variable' } }] } }));
    expect(livret(l2)!.bankOrder!.parts.map((p) => [p.tirelireId, p.requested, p.signaled])).toEqual([['vac', 0, false]]);
    const l3 = avec(sansVac, ordre({ id: 'o', amount: -euros(300), action: { allocation: [{ tirelireId: 'vac', share: { kind: 'fixed', amount: -euros(50) } }] } }));
    expect(alertes(l3, 'bankOrderPartDrift').map((w) => w.tirelireId)).toEqual(['vac']);
  });
});

describe('[niveau 4] #393 · 8. calculer le plan ne réécrit aucun ordre', () => {
  it('ni son montant ni ses parts', () => {
    const l = avec(budget(), ordre({ id: 'o', amount: -euros(250), action: { allocation: [{ tirelireId: 'vac', share: { kind: 'fixed', amount: -euros(10) } }] } }));
    const avant = JSON.stringify(l);
    computePlan(l, LECTURE);
    expect(JSON.stringify(l)).toBe(avant);
  });
});

describe('[niveau 4] #393 · 9. ce que le plan propose', () => {
  it('le multiple du pas au-dessus, et une part fixe sans catégorie par tirelire, échéances d’abord ; l’arrondi reste sans part', () => {
    const l = budget(euros(50));
    l.needs.push({ id: 'n-vac2', tirelireId: 'vac', kind: 'recurring', amount: euros(15), periodicity: mensuel('2026-08-28'), priority: 20 });
    const t = livret(l)!;
    expect(t.permanent).toBe(euros(315));
    expect(t.proposal).toEqual({
      amount: euros(350),
      allocation: [
        { tirelireId: 'taxe', share: { kind: 'fixed', amount: -euros(100) } },
        { tirelireId: 'vac', share: { kind: 'fixed', amount: -euros(215) } },
      ],
    });
  });

  it('pour un montant plus court, l’ordre de financement décide, et une tirelire qui ne reçoit rien n’a pas de part', () => {
    const plan = computePlan(budget(), LECTURE);
    const t = plan.transfers.find((x) => x.accountId === LIVRET)!;
    expect(standingTransferFlow(plan, t, CC, 'n', euros(80))!.action).toEqual({ allocation: [{ tirelireId: 'taxe', share: { kind: 'fixed', amount: -euros(80) } }] });
  });
});

describe('[niveau 4] #393 · 10. enregistrer l’ordre', () => {
  it('vers un compte qui a un ordre : montant et ventilation remplacés, ancrage, nom et sélection gardés', () => {
    const existant = ordre({ id: 'o', name: 'Mon virement', amount: -euros(250), labelPattern: 'MON MOTIF', amountTolerance: { abs: 500 }, dateWindowDays: 9, periodicity: mensuel('2026-07-03') });
    const l = avec(budget(), existant);
    const plan = computePlan(l, LECTURE);
    const t = plan.transfers.find((x) => x.accountId === LIVRET)!;
    const f = standingTransferFlow(plan, t, CC, 'neuf', euros(300), existant)!;
    expect(f).toEqual({ ...existant, amount: -euros(300), action: { allocation: [{ tirelireId: 'taxe', share: { kind: 'fixed', amount: -euros(100) } }, { tirelireId: 'vac', share: { kind: 'fixed', amount: -euros(200) } }] } });
    // Un autre flux que l'ordre du compte ne se réécrit pas.
    expect(standingTransferFlow(plan, t, CC, 'neuf', euros(300), { ...existant, id: 'autre' })).toBeUndefined();
  });

  it('un ordre décrit sur le compte d’accueil y reste décrit, dans son signe', () => {
    const existant = ordre({ id: 'o', amount: euros(250), accountId: LIVRET, counterpartAccountId: CC });
    const l = avec(budget(), existant);
    const plan = computePlan(l, LECTURE);
    const f = standingTransferFlow(plan, plan.transfers.find((x) => x.accountId === LIVRET)!, CC, 'x', euros(300), existant)!;
    expect([f.accountId, f.amount, f.action?.allocation?.map((p) => p.share)]).toEqual([LIVRET, euros(300), [{ kind: 'fixed', amount: euros(100) }, { kind: 'fixed', amount: euros(200) }]]);
  });

  it('un compte qui a plusieurs ordres ne se voit proposer aucun enregistrement', () => {
    const l = avec(budget(), ordre({ id: 'a', amount: -euros(100) }), ordre({ id: 'b', amount: -euros(100) }));
    const plan = computePlan(l, LECTURE);
    const t = plan.transfers.find((x) => x.accountId === LIVRET)!;
    expect(standingTransferFlow(plan, t, CC, 'x', euros(300))).toBeUndefined();
    expect(standingTransferFlow(plan, t, CC, 'x', euros(300), l.plannedFlows.find((f) => f.id === 'a'))).toBeUndefined();
  });
});

describe('[niveau 4] #393 · 12. le dépôt SQLite au format 7', () => {
  async function fichier(action: unknown, version = String(FORMAT_VERSION)): Promise<Uint8Array> {
    const s = await LedgerStore.create({ sqlJs: SQL });
    const db = new SQL.Database(s.export());
    db.run(`UPDATE meta SET value = ? WHERE key = 'format_version'`, [version]);
    // Un fichier fabriqué dehors : la table sans les CHECK que l'application écrit, ses colonnes facultatives absentes.
    db.run(`DROP TABLE planned_flows`);
    db.run(`CREATE TABLE planned_flows (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL, account_id TEXT NOT NULL, periodicity TEXT NOT NULL, date_window_days INTEGER NOT NULL, action TEXT, hlc TEXT)`);
    db.run(`INSERT INTO tirelires (id, name, placement, opening_balance, opening_date, hlc) VALUES ('t', 'T', '[]', 0, '2026-09-01', '')`);
    db.run(`INSERT INTO categories (id, name, nature, hlc) VALUES ('c', 'C', 'expense', '')`);
    db.run(
      `INSERT INTO planned_flows (id, name, kind, amount, account_id, periodicity, date_window_days, action, hlc) VALUES ('f', 'F', 'fixedCharge', -100, 'acc-principal', '{"interval":1,"unit":"month","anchorDate":"2026-09-01"}', 3, ?, '')`,
      [JSON.stringify(action)],
    );
    return db.export();
  }

  it('une action juste s’ouvre et se relit à un seul endroit', async () => {
    const action = { categoryId: 'c', allocation: [{ tirelireId: 't', share: { kind: 'fixed', amount: -50 } }, { share: { kind: 'variable' } }], state: 'lock' };
    expect((await verifierFichier(await fichier(action), { sqlJs: SQL })).ouvre).toBe(true);
    const s = await LedgerStore.create({ sqlJs: SQL, bytes: await fichier(action) });
    expect(s.load().plannedFlows[0]!.action).toEqual(action);
    expect(Object.keys(s.load().plannedFlows[0]!)).not.toContain('origin');
  });

  it.each([
    ['une catégorie absente', { categoryId: 'absente' }],
    ['une tirelire absente', { allocation: [{ tirelireId: 'absente', share: { kind: 'variable' } }] }],
    ['deux parts variables', { allocation: [{ share: { kind: 'variable' } }, { tirelireId: 't', share: { kind: 'variable' } }] }],
    ['l’état « Ne rien faire »', { state: 'none' }],
    ['l’état « Déverrouiller »', { state: 'unlock' }],
  ])('%s fait refuser le fichier, en nommant la table, la ligne et la colonne', async (_, action) => {
    const v = await verifierFichier(await fichier(action), { sqlJs: SQL });
    expect(v.ouvre).toBe(false);
    if (!v.ouvre) expect(v.problemes.some((p) => p.table === 'planned_flows' && p.id === 'f' && p.colonne === 'action')).toBe(true);
  });

  it('un fichier au format 6 est refusé en le disant', async () => {
    await expect(LedgerStore.create({ sqlJs: SQL, bytes: await fichier({}, '6') })).rejects.toMatchObject({ reason: 'ancien' });
  });
});

describe('[niveau 4] #393 · 13. le budget JSON en version 3', () => {
  it('l’action s’écrit en JSON natif ; ses références et ses refus sont ceux du fichier', () => {
    const base = { format: BUDGET_JSON_FORMAT, version: BUDGET_JSON_VERSION, categories: [{ id: 'c', name: 'C', nature: 'expense' }] };
    const flux = (action: unknown) => ({ ...base, planned_flows: [{ name: 'F', kind: 'fixedCharge', amount: -100, account_id: 'acc-principal', periodicity: mensuel('2026-09-01'), date_window_days: 3, action }] });
    expect(lireBudgetJson(flux({ categoryId: 'c', state: 'lock' })).ok).toBe(true);
    expect(lireBudgetJson(flux({ categoryId: 'absente' })).ok).toBe(false);
    expect(lireBudgetJson(flux({ state: 'none' })).ok).toBe(false);
    expect(lireBudgetJson(flux('{"categoryId":"c"}')).ok).toBe(false);
    expect(lireBudgetJson({ ...flux({}), version: 2 }).ok).toBe(false);
  });
});

describe('[niveau 4] #393 · 14. deux instances de formats différents (C8)', () => {
  it('un paquet d’une instance au format 6 est refusé par une instance au format 7, et inversement, sans rien écrire', async () => {
    const a = await LedgerStore.create({ sqlJs: SQL, siteId: 'a' });
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'b' });
    for (const f of exampleLedger().plannedFlows) a.upsert('plannedFlows', f);
    const paquet = exportBundle(a);
    const avant = b.export();
    for (const version of [FORMAT_VERSION - 1, FORMAT_VERSION + 1]) {
      expect(() => importBundle(b, { ...paquet, version })).toThrow(/Rien n’a été écrit/);
      expect(b.export()).toEqual(avant);
    }
    expect(importBundle(b, paquet).applied).toBeGreaterThan(0);
    expect(b.load().plannedFlows.filter((f) => !f.deletedAt).map((f) => [f.id, f.action])).toEqual(exampleLedger().plannedFlows.map((f) => [f.id, f.action]));
  });
});
