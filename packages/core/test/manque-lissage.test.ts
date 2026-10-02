/**
 * #184 · Une échéance trop proche : le plan annonce le manque et propose le lissage (principe 1.4, D88).
 *
 * Tests du codeur, tous de niveau 4 : l'auditeur y choisit le harnais.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import {
  accountBalance,
  budgetPeriodContaining,
  computeForecast,
  computePlan,
  dueDateShortfalls,
  editDivision,
  euros,
  exampleLedger,
  FormatRefused,
  indexLedger,
  LEDGER_KEYS,
  LedgerStore,
  memoryTransportPair,
  nextPeriod,
  proposeSmoothing,
  refusalAnswer,
  reviewCategories,
  runSync,
  shortfallAnswerId,
  shortfallsForPeriod,
  smoothingAnswer,
  tirelireBalance,
  unallocated,
  withdrawnAnswer,
  type Ledger,
  type SmoothingPart,
} from '../src/index.js';

const SQL = await initSqlJs();
const asOf = '2026-09-06';
const START = 28;

/** L'exemple sans le lissage décidé de la taxe foncière : ce que donne une échéance sans réponse. */
function sansReponse(): Ledger {
  const l = exampleLedger();
  l.shortfallAnswers = [];
  l.operations = l.operations.filter((o) => o.id !== 'op-lissage-tf');
  l.subOperations = l.subOperations.filter((s) => s.operationId !== 'op-lissage-tf');
  return l;
}

function line(plan: ReturnType<typeof computePlan>, needId: string) {
  const l = plan.lines.find((x) => x.needId === needId);
  if (!l) throw new Error(`ligne ${needId} absente`);
  return l;
}

/** Écrit une réponse comme l'interface : le patch, puis la réponse. */
function repondre(l: Ledger, w: ReturnType<typeof smoothingAnswer>): Ledger {
  return {
    ...l,
    operations: [...l.operations, ...w.patch.operations],
    subOperations: [...l.subOperations, ...w.patch.subOperations],
    shortfallAnswers: [...l.shortfallAnswers.filter((a) => a.id !== w.answer.id), w.answer],
  };
}

async function deposer(l: Ledger, siteId = 'A'): Promise<LedgerStore> {
  const s = await LedgerStore.create({ sqlJs: SQL, siteId });
  for (const key of LEDGER_KEYS) for (const row of l[key]) s.upsert(key, row as never);
  for (const [k, v] of Object.entries(l.settings)) if (k !== 'siteId') s.setSetting(k as never, v as never);
  return s;
}

function taxe(l: Ledger, today = asOf) {
  return dueDateShortfalls(l, today).find((s) => s.needId === 'need-tf');
}

describe('[niveau 4] #184 · 1. le plan ne lisse plus rien d’office', () => {
  it('sans réponse, une échéance demande sa croisière à chaque période, et rien d’autre', () => {
    const l = sansReponse();
    for (const d of ['2026-09-06', '2026-10-01']) {
      const tf = line(computePlan(l, d, asOf), 'need-tf');
      expect(tf.requested, d).toBe(euros(100));
      expect(tf.smoothing, d).toBe(0);
      expect(tf.floor, d).toBe(euros(100));
    }
  });

  it('une échéance déjà en avance ne demande pas moins que sa croisière', () => {
    const auto = line(computePlan(sansReponse(), asOf), 'need-auto');
    expect(auto.requested).toBe(euros(50));
    expect(auto.catchUp).toBe(euros(50));
  });

  it('le rattrapage d’un déficit ne change pas', () => {
    // Enfants : 236 € dépensés pour 200 € dotés en septembre ; octobre rattrape les 36 € (D29).
    const enfants = line(computePlan(sansReponse(), '2026-10-20'), 'need-enfants');
    expect(enfants.catchUp).toBe(euros(236));
    expect(enfants.requested).toBe(euros(236));
  });
});

describe('[niveau 4] #184 · 2. une échéance est en manque quand le solde prévu de sa tirelire, à sa date, est négatif', () => {
  it('l’exemple sans réponse : 100 € manquent au 15 octobre (1 200 − 900 − 2 × 100), avec une proposition', () => {
    const s = taxe(sansReponse())!;
    expect(s.dueDate).toBe('2026-10-15');
    expect(s.amount).toBe(euros(100));
    expect(s.answer).toBeUndefined();
    expect(s.proposal).toEqual([
      { date: '2026-08-28', amount: euros(50) },
      { date: '2026-09-28', amount: euros(50) },
    ]);
  });

  it('le manque est le solde prévu de la tirelire à sa date, prélèvement compris', () => {
    const l = sansReponse();
    const fin = budgetPeriodContaining('2026-10-15', START);
    const prevu = computeForecast(l, fin, asOf).tirelires.find((t) => t.id === 'env-tf')!;
    // 900 + 100 (septembre) + 100 (octobre) − 1 200 au 15 octobre.
    expect(prevu.shortfall).toEqual({ date: '2026-10-15', amount: euros(-100) });
    expect(taxe(l)!.amount).toBe(-prevu.shortfall!.amount);
  });

  it('le plan de la période en cours et de chaque période jusqu’à sa date le signale ; pas au-delà, ni une période passée', () => {
    const all = dueDateShortfalls(sansReponse(), asOf);
    const septembre = budgetPeriodContaining(asOf, START);
    const octobre = nextPeriod(septembre, START);
    const novembre = nextPeriod(octobre, START);
    const aout = budgetPeriodContaining('2026-08-01', START);
    const ids = (p: typeof septembre) => shortfallsForPeriod(all, p, asOf).map((s) => s.needId);
    expect(ids(septembre)).toContain('need-tf');
    expect(ids(octobre)).toContain('need-tf');
    expect(ids(novembre)).not.toContain('need-tf');
    expect(ids(aout)).toEqual([]);
  });

  it('une échéance suffisamment provisionnée n’est pas en manque', () => {
    const l = sansReponse();
    l.tirelires.find((e) => e.id === 'env-tf')!.openingBalance = euros(1000);
    expect(taxe(l)).toBeUndefined();
  });

  it('une échéance sans prélèvement prévu se paie à sa date pour son montant', () => {
    const l = sansReponse();
    l.plannedFlows = l.plannedFlows.filter((f) => f.id !== 'flow-tf');
    expect(taxe(l)!.amount).toBe(euros(100));
  });

  it('venue par la sauvegarde restaurée, l’échéance se signale de même', async () => {
    const s = await deposer(sansReponse());
    const rouvert = await LedgerStore.create({ sqlJs: SQL, bytes: s.export(), verifier: true });
    expect(taxe(rouvert.load())!.amount).toBe(euros(100));
    expect(taxe(rouvert.load())!.proposal).toHaveLength(2);
  });

  it('venue par la synchronisation, l’échéance se signale de même', async () => {
    const a = await deposer(sansReponse(), 'A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    const [ta, tb] = memoryTransportPair();
    await Promise.all([runSync(a, ta), runSync(b, tb)]);
    expect(taxe(b.load())).toEqual(taxe(a.load()));
  });
});

describe('[niveau 4] #184 · 3. une échéance enregistrée en manque se dit aussitôt, à côté de la croisière', () => {
  it('une nouvelle échéance trop proche : montant, date, croisière et proposition', () => {
    const l = sansReponse();
    l.tirelires.push({ id: 'env-ct', name: 'Contrôle technique', placement: [{ accountId: 'acc-livret', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-27' });
    l.needs.push({ id: 'need-ct', tirelireId: 'env-ct', kind: 'dueDate', amount: euros(120), periodicity: { interval: 24, unit: 'month', anchorDate: '2026-11-10' }, priority: 10 });
    const s = dueDateShortfalls(l, asOf).find((x) => x.needId === 'need-ct')!;
    // Croisière : 120 € sur 24 mois = 5 € ; trois périodes avant le 10 novembre (28 août, 28 septembre, 28 octobre).
    expect(s.cruise).toBe(euros(5));
    expect(s.dueDate).toBe('2026-11-10');
    expect(s.amount).toBe(euros(105));
    expect(s.proposal).toEqual([
      { date: '2026-08-28', amount: euros(35) },
      { date: '2026-09-28', amount: euros(35) },
      { date: '2026-10-28', amount: euros(35) },
    ]);
  });

  it('un besoin qui en remplace un autre (D50) se propose de nouveau, même si l’ancien avait sa réponse', () => {
    const l = exampleLedger();
    const ancien = l.needs.find((n) => n.id === 'need-tf')!;
    ancien.activeTo = '2026-09-27';
    const { activeTo: _ferme, ...rest } = ancien;
    void _ferme;
    l.needs.push({ ...rest, id: 'need-tf-2', amount: euros(1300), activeFrom: '2026-09-28' });
    l.plannedFlows.find((f) => f.id === 'flow-tf')!.amount = euros(-1300);
    const s = dueDateShortfalls(l, asOf).find((x) => x.needId === 'need-tf-2')!;
    expect(s.amount).toBeGreaterThan(0);
    expect(s.answer).toBeUndefined();
    expect(s.proposal).toBeDefined();
  });
});

describe('[niveau 4] #184 · 4. la proposition répartit le manque sur les périodes restantes, à parts égales au centime', () => {
  const septembre = budgetPeriodContaining(asOf, START);

  it('une part par période, datée de son premier jour, la dernière prenant le reste', () => {
    expect(proposeSmoothing(10001, septembre, '2026-12-01', START)).toEqual([
      { date: '2026-08-28', amount: 2500 },
      { date: '2026-09-28', amount: 2500 },
      { date: '2026-10-28', amount: 2500 },
      { date: '2026-11-28', amount: 2501 },
    ]);
  });

  it('une échéance dans la période en cours : une seule part, la période en cours', () => {
    expect(proposeSmoothing(euros(80), septembre, '2026-09-20', START)).toEqual([{ date: '2026-08-28', amount: euros(80) }]);
  });

  it('l’utilisateur la modifie — montants et dates des parts — et c’est la sienne qui s’enregistre', () => {
    const parts: SmoothingPart[] = [
      { date: '2026-09-10', amount: euros(30) },
      { date: '2026-10-01', amount: euros(70) },
    ];
    const l = repondre(sansReponse(), smoothingAnswer(sansReponse(), 'need-tf', '2026-10-15', parts));
    const s = taxe(l)!;
    expect(s.answer).toMatchObject({ kind: 'smoothing', parts });
    expect(s.amount).toBe(0);
  });

  it('une part sans montant, ou après l’échéance, est refusée', () => {
    expect(() => smoothingAnswer(sansReponse(), 'need-tf', '2026-10-15', [{ date: '2026-09-28', amount: 0 }])).toThrow();
    expect(() => smoothingAnswer(sansReponse(), 'need-tf', '2026-10-15', [{ date: '2026-10-20', amount: euros(100) }])).toThrow();
  });
});

describe('[niveau 4] #184 · 5. la réponse s’enregistre, une par échéance', () => {
  const proposition = () => taxe(sansReponse())!.proposal!;

  it('accepté : une saisie divisée en sous-opérations datées ; la proposition ne revient pas', () => {
    const w = smoothingAnswer(sansReponse(), 'need-tf', '2026-10-15', proposition());
    expect(w.patch.operations).toHaveLength(1);
    expect(w.patch.operations[0]).toMatchObject({ origin: 'manual', amount: 0, state: 'locked', accountId: 'acc-principal' });
    expect(w.patch.subOperations.map((s) => [s.date, s.share, s.tirelireId])).toEqual([
      ['2026-08-28', { kind: 'fixed', amount: euros(50) }, 'env-tf'],
      ['2026-09-28', { kind: 'fixed', amount: euros(50) }, 'env-tf'],
    ]);
    expect(w.answer).toEqual({ id: shortfallAnswerId('need-tf', '2026-10-15'), needId: 'need-tf', dueDate: '2026-10-15', operationId: w.patch.operations[0]!.id });
    const s = taxe(repondre(sansReponse(), w))!;
    expect(s.proposal).toBeUndefined();
    expect(s.answer?.kind).toBe('smoothing');
  });

  it('refusé : aucune opération ; la proposition se tait, le manque se signale toujours', () => {
    const l = sansReponse();
    l.shortfallAnswers.push(refusalAnswer('need-tf', '2026-10-15'));
    const s = taxe(l)!;
    expect(s.answer).toEqual({ kind: 'refusal', answerId: shortfallAnswerId('need-tf', '2026-10-15') });
    expect(s.proposal).toBeUndefined();
    expect(s.amount).toBe(euros(100));
    expect(l.operations).toHaveLength(sansReponse().operations.length);
    // Un refus ne paraît dans aucun solde.
    expect(computePlan(l, asOf).totals).toEqual(computePlan(sansReponse(), asOf).totals);
  });

  it('un lissage partiel : le manque qui reste se signale, sans proposition', () => {
    const l = repondre(sansReponse(), smoothingAnswer(sansReponse(), 'need-tf', '2026-10-15', [{ date: '2026-09-28', amount: euros(40) }]));
    const s = taxe(l)!;
    expect(s.amount).toBe(euros(60));
    expect(s.proposal).toBeUndefined();
  });

  it('retirer le lissage, ou revenir sur le refus, fait revenir la proposition', () => {
    const lisse = repondre(sansReponse(), smoothingAnswer(sansReponse(), 'need-tf', '2026-10-15', proposition()));
    const w = withdrawnAnswer(lisse, shortfallAnswerId('need-tf', '2026-10-15'));
    const retire: Ledger = {
      ...lisse,
      shortfallAnswers: lisse.shortfallAnswers.map((a) => (a.id === w.answerId ? { ...a, deletedAt: '2026-09-06T00:00:00.000Z' } : a)),
      operations: lisse.operations.map((o) => (o.id === w.operationId ? { ...o, deletedAt: '2026-09-06T00:00:00.000Z' } : o)),
      subOperations: lisse.subOperations.map((x) => (w.subOperationIds.includes(x.id) ? { ...x, deletedAt: '2026-09-06T00:00:00.000Z' } : x)),
    };
    expect(taxe(retire)!.proposal).toEqual(proposition());

    const refuse = sansReponse();
    refuse.shortfallAnswers.push({ ...refusalAnswer('need-tf', '2026-10-15'), deletedAt: '2026-09-06T00:00:00.000Z' });
    expect(taxe(refuse)!.proposal).toEqual(proposition());
  });

  it('la saisie du lissage retirée depuis les opérations : la réponse ne répond plus, la proposition revient', () => {
    const l = exampleLedger();
    l.operations.find((o) => o.id === 'op-lissage-tf')!.deletedAt = '2026-09-06T00:00:00.000Z';
    expect(taxe(l)!.proposal).toEqual(proposition());
  });

  it('l’échéance suivante se propose de nouveau', () => {
    // Après le 15 octobre, la taxe de 2027 : 100 € pris sur la tirelire en novembre la laissent en
    // manque de 100 € ; la réponse de 2026 ne vaut pas pour elle.
    const l = exampleLedger();
    l.operations.push({ id: 'op-pris', accountId: 'acc-principal', origin: 'manual', date: '2026-11-10', label: 'Pris sur la taxe', normalizedLabel: 'PRIS SUR LA TAXE', amount: euros(-100), state: 'locked' });
    l.subOperations.push({ id: 'al-pris', operationId: 'op-pris', tirelireId: 'env-tf', share: { kind: 'variable' } });
    const s = taxe(l, '2026-11-12')!;
    expect(s.dueDate).toBe('2027-10-15');
    expect(s.amount).toBe(euros(100));
    expect(s.answer).toBeUndefined();
    expect(s.proposal).toBeDefined();
  });

  it('elle survit au redémarrage et à la sauvegarde restaurée', async () => {
    const l = repondre(sansReponse(), smoothingAnswer(sansReponse(), 'need-tf', '2026-10-15', proposition()));
    const s = await deposer(l);
    const relu = await LedgerStore.create({ sqlJs: SQL, bytes: s.export() });
    const restaure = await LedgerStore.create({ sqlJs: SQL, bytes: s.export(), verifier: true });
    for (const x of [relu, restaure]) {
      expect(taxe(x.load())!.answer?.kind).toBe('smoothing');
      expect(computePlan(x.load(), asOf).totals).toEqual(computePlan(l, asOf).totals);
    }
  });

  it('elle survit à la synchronisation', async () => {
    const l = sansReponse();
    l.shortfallAnswers.push(refusalAnswer('need-tf', '2026-10-15'));
    const a = await deposer(l, 'A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    const [ta, tb] = memoryTransportPair();
    await Promise.all([runSync(a, ta), runSync(b, tb)]);
    expect(taxe(b.load())!.answer?.kind).toBe('refusal');
  });

  it('deux instances qui répondent à la même échéance écrivent la même réponse : la plus récente reste, l’autre est un conflit, et aucun lissage ne compte deux fois', async () => {
    const a = await deposer(sansReponse(), 'A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    const [t1a, t1b] = memoryTransportPair();
    await Promise.all([runSync(a, t1a), runSync(b, t1b)]);

    const ecrire = (s: LedgerStore, parts: SmoothingPart[]) => {
      const w = smoothingAnswer(s.load(), 'need-tf', '2026-10-15', parts);
      for (const o of w.patch.operations) s.upsert('operations', o);
      for (const x of w.patch.subOperations) s.upsert('subOperations', x);
      s.upsert('shortfallAnswers', w.answer);
    };
    ecrire(a, proposition());
    ecrire(b, [{ date: '2026-09-28', amount: euros(100) }]);

    const [t2a, t2b] = memoryTransportPair();
    const [ra, rb] = await Promise.all([runSync(a, t2a), runSync(b, t2b)]);
    const conflits = [...ra.conflicts, ...rb.conflicts].filter((c) => c.table === 'shortfall_answers');
    expect(conflits.length).toBeGreaterThan(0);
    const [t3a, t3b] = memoryTransportPair();
    await Promise.all([runSync(a, t3a), runSync(b, t3b)]);

    for (const s of [a, b]) {
      const l = s.load();
      expect(l.shortfallAnswers.filter((x) => !x.deletedAt)).toHaveLength(1);
      expect(l.operations.filter((o) => !o.deletedAt && o.label.startsWith('Lissage'))).toHaveLength(1);
      expect(taxe(l)!.amount).toBe(0);
    }
    expect(computePlan(a.load(), asOf).totals).toEqual(computePlan(b.load(), asOf).totals);
    expect(taxe(a.load())).toEqual(taxe(b.load()));
  });
});

describe('[niveau 4] #184 · 6. un lissage décidé compte comme des dotations', () => {
  const lisse = () => exampleLedger();

  it('chaque part, à sa date, augmente le solde de la tirelire et diminue d’autant le non affecté, sans changer le compte (I2)', () => {
    const avec = indexLedger(lisse());
    const sans = indexLedger(sansReponse());
    const tf = avec.tireliresById.get('env-tf')!;
    const principal = avec.accountsById.get('acc-principal')!;
    for (const d of ['2026-08-28', '2026-09-06', '2026-09-28']) {
      const partsAvant = d >= '2026-09-28' ? euros(100) : euros(50);
      expect(tirelireBalance(tf, avec, d) - tirelireBalance(sans.tireliresById.get('env-tf')!, sans, d), d).toBe(partsAvant);
      expect(accountBalance(principal, lisse(), d), d).toBe(accountBalance(principal, sansReponse(), d));
      expect(unallocated(principal, lisse(), avec, d) - unallocated(principal, sansReponse(), sans, d), d).toBe(-partsAvant);
    }
    // La seconde part ne compte pas avant sa date.
    expect(tirelireBalance(tf, avec, '2026-09-27') - tirelireBalance(sans.tireliresById.get('env-tf')!, sans, '2026-09-27')).toBe(euros(50));
  });

  it('il n’est ni une dépense ni un revenu : aucun total par catégorie du bilan ne le compte', () => {
    const periods = [budgetPeriodContaining(asOf, START), nextPeriod(budgetPeriodContaining(asOf, START), START)];
    expect(reviewCategories(lisse(), periods)).toEqual(reviewCategories(sansReponse(), periods));
  });

  it('dans le plan de sa période, sa part s’ajoute à ce que l’échéance demande, en complément exceptionnel, jamais dans l’ordre permanent', () => {
    for (const d of ['2026-09-06', '2026-10-01']) {
      const avec = computePlan(lisse(), d, asOf);
      const sans = computePlan(sansReponse(), d, asOf);
      expect(line(avec, 'need-tf').smoothing, d).toBe(euros(50));
      expect(line(avec, 'need-tf').requested - line(sans, 'need-tf').requested, d).toBe(euros(50));
      const livret = (p: typeof avec) => p.transfers.find((t) => t.accountId === 'acc-livret')!;
      expect(livret(avec).permanent, d).toBe(livret(sans).permanent);
      const tfOrder = (p: typeof avec) => livret(p).orders.find((o) => o.tirelireId === 'env-tf')!;
      expect(tfOrder(avec).standing, d).toBe(tfOrder(sans).standing);
      expect(tfOrder(avec).exceptional - tfOrder(sans).exceptional, d).toBe(euros(50));
    }
  });

  it('sous une marge négative, elle fait partie du plancher de l’échéance (D06)', () => {
    const l = lisse();
    l.plannedFlows = l.plannedFlows.filter((f) => f.kind !== 'income');
    const tf = line(computePlan(l, asOf), 'need-tf');
    expect(tf.floor).toBe(euros(150));
  });
});

describe('[niveau 4] #184 · 7. une sous-opération peut porter sa propre date', () => {
  it('elle compte à sa date dans sa tirelire et sa catégorie ; le compte réel bouge à la date de l’opération', () => {
    const l = exampleLedger();
    l.operations.push({ id: 'op-courses', accountId: 'acc-principal', origin: 'manual', date: '2026-09-20', label: 'Courses', normalizedLabel: 'COURSES', amount: euros(-90), state: 'locked' });
    l.subOperations.push({ id: 'al-courses', operationId: 'op-courses', tirelireId: 'env-alim', categoryId: 'cat-alim', share: { kind: 'variable' }, date: '2026-10-02' });
    const idx = indexLedger(l);
    const alim = idx.tireliresById.get('env-alim')!;
    const principal = idx.accountsById.get('acc-principal')!;
    const sans = exampleLedger();
    const idxSans = indexLedger(sans);
    expect(accountBalance(principal, l, '2026-09-25') - accountBalance(principal, sans, '2026-09-25')).toBe(euros(-90));
    expect(tirelireBalance(alim, idx, '2026-09-25')).toBe(tirelireBalance(idxSans.tireliresById.get('env-alim')!, idxSans, '2026-09-25'));
    // Le reste tient à la date de l’opération sur le compte ; la tirelire ne bouge qu’à la date de la ligne.
    const septembre = budgetPeriodContaining(asOf, START);
    const octobre = nextPeriod(septembre, START);
    const bilan = reviewCategories(l, [septembre, octobre]).find((r) => r.categoryId === 'cat-alim')!;
    expect(bilan.periods.map((p) => p.spent)).toEqual([0, euros(90)]);
  });

  it('une sous-opération sans date prend celle du niveau qui la contient', () => {
    const l = exampleLedger();
    l.operations.push({ id: 'op-x', accountId: 'acc-principal', origin: 'manual', date: '2026-09-01', label: 'X', normalizedLabel: 'X', amount: 0, state: 'locked' });
    l.subOperations.push(
      { id: 'x-1', operationId: 'op-x', share: { kind: 'fixed', amount: euros(30) }, date: '2026-10-05' },
      { id: 'x-1-a', operationId: 'op-x', parentId: 'x-1', tirelireId: 'env-vac', share: { kind: 'variable' } },
    );
    const idx = indexLedger(l);
    expect(idx.linesByOperation.get('op-x')!.find((x) => x.subOperationId === 'x-1-a')!.date).toBe('2026-10-05');
    expect(idx.linesByOperation.get('op-x')!.find((x) => x.subOperationId === undefined)!.date).toBe('2026-09-01');
  });

  it('l’éditeur de la ventilation garde et modifie la date d’une part', () => {
    const l = exampleLedger();
    const patch = editDivision(l, 'op-lissage-tf', [
      { id: 'al-lissage-tf-1', tirelireId: 'env-tf', share: { kind: 'fixed', amount: euros(50) }, date: '2026-08-28' },
      { id: 'al-lissage-tf-2', tirelireId: 'env-tf', share: { kind: 'fixed', amount: euros(50) }, date: '2026-10-01' },
    ]);
    expect(patch.subOperations.map((s) => [s.id, s.date])).toEqual([['al-lissage-tf-2', '2026-10-01']]);
    expect(patch.removedSubOperations).toEqual([]);
  });

  it('le format change de version, et un fichier de la version 4 est refusé en le disant', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL });
    const db = new SQL.Database(s.export());
    db.run(`UPDATE meta SET value = '4' WHERE key = 'format_version'`);
    const ancien = db.export();
    await expect(LedgerStore.create({ sqlJs: SQL, bytes: ancien })).rejects.toMatchObject({ reason: 'ancien' });
    await expect(LedgerStore.create({ sqlJs: SQL, bytes: ancien })).rejects.toBeInstanceOf(FormatRefused);
  });

  it('une date de sous-opération qui n’est pas une date refuse l’écriture', async () => {
    const s = await deposer(exampleLedger());
    expect(() => s.upsert('subOperations', { id: 'z', operationId: 'op-lissage-tf', share: { kind: 'fixed', amount: 1 }, date: '28/09/2026' })).toThrow();
  });

  it('une réponse qui ne se désigne pas par son échéance, ou qui désigne un besoin absent du fichier, refuse l’ouverture', async () => {
    const s = await deposer(exampleLedger());
    expect(() => s.upsert('shortfallAnswers', { id: 'autre', needId: 'need-tf', dueDate: '2026-10-15' })).toThrow();
    s.upsert('shortfallAnswers', { id: shortfallAnswerId('need-absent', '2026-10-15'), needId: 'need-absent', dueDate: '2026-10-15' });
    await expect(LedgerStore.create({ sqlJs: SQL, bytes: s.export(), verifier: true })).rejects.toBeInstanceOf(FormatRefused);
  });
});

describe('[niveau 4] #184 · 8. le plan de l’exemple reste celui d’aujourd’hui, au centime près', () => {
  // Les montants que `main` donnait avant #184 (`apps/web/test/compte-principal-209.avant.json`).
  it('le 6 septembre', () => {
    const p = computePlan(exampleLedger(), '2026-09-06');
    const tf = line(p, 'need-tf');
    expect([tf.catchUp, tf.requested, tf.floor, tf.funded, tf.status]).toEqual([15000, 15000, 15000, 15000, 'catchUp']);
    expect(p.totals).toEqual({ incomes: 420000, fixedCharges: 122000, requested: 235000, funded: 235000, margin: 63000, cushion: 60000, principalUnallocated: 339000 });
    const livret = p.transfers.find((t) => t.accountId === 'acc-livret')!;
    expect([livret.standing, livret.permanent, livret.exceptional, livret.surplus, livret.net]).toEqual([65000, 65000, 5000, 1500, 68500]);
    expect(livret.orders.find((o) => o.tirelireId === 'env-tf')).toMatchObject({ standing: 10000, exceptional: 5000, amount: 15000 });
  });

  it('le 20 octobre et le 10 janvier', () => {
    const oct = computePlan(exampleLedger(), '2026-10-20');
    expect(line(oct, 'need-tf')).toMatchObject({ balance: 105000, requested: 15000, floor: 15000 });
    expect(oct.totals).toEqual({ incomes: 420000, fixedCharges: 122000, requested: 238600, funded: 238600, margin: 59400, cushion: 60000, principalUnallocated: 237400 });
    expect(oct.transfers.find((t) => t.accountId === 'acc-livret')!.net).toBe(138500);
    const jan = computePlan(exampleLedger(), '2027-01-10');
    expect(line(jan, 'need-tf')).toMatchObject({ balance: 120000, requested: 0 });
    expect(jan.totals).toEqual({ incomes: 435000, fixedCharges: 27000, requested: 279500, funded: 279500, margin: 128500, cushion: 60000, principalUnallocated: -56100 });
    expect(jan.transfers.find((t) => t.accountId === 'acc-livret')!.net).toBe(353500);
  });

  it('les périodes à venir, lues le 6 septembre : la demande et le solde prévu de la taxe foncière', () => {
    const oct = computePlan(exampleLedger(), '2026-10-01', asOf);
    expect(line(oct, 'need-tf').requested).toBe(15000);
    expect(oct.forecast!.tirelires.find((t) => t.id === 'env-tf')!.end).toBe(0);
    expect(oct.forecast!.tirelires.find((t) => t.id === 'env-tf')!.shortfall).toBeUndefined();
  });

  it('l’exemple n’annonce aucun manque : la taxe foncière a sa réponse', () => {
    const s = taxe(exampleLedger())!;
    expect(s.amount).toBe(0);
    expect(s.answer?.kind).toBe('smoothing');
    expect(dueDateShortfalls(exampleLedger(), asOf).filter((x) => x.amount > 0)).toEqual([]);
  });
});
