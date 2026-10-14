/**
 * Harnais d'audit de #463 — les alertes d'un fichier, rassemblées dans une fonction du cœur
 * (`readAlerts`), que les écrans et la skill de #451 partagent (principe 13, D78, D89). Côté cœur ; ce
 * que montrent les écrans : `apps/web/test/alertes-ecrans-harnais.test.ts`. Chaque `describe` reprend
 * un point du « Fait quand » sous son numéro ; chaque titre porte son niveau (D83).
 *
 * Composé après le codage (auditeur.md, étape 2), parmi les tests du codeur (`alertes.test.ts`,
 * déplacé ici en entier ; au second tour, `alertes-ordre.test.ts`, l'ordre des reprises proposées,
 * déplacé au point 4). Niveaux, par le besoin que couvre chaque phrase :
 * - 0 · point 2 : calculer les alertes n'écrit rien, pas même une reprise automatique (I10) ; une
 *   reprise appliquée en cachette ne se défait pas en corrigeant le code (précédent : #184).
 * - 1 · point 17 : chaque usage tient seul (I3).
 * - 2 · les autres points : les règles de la lecture et de chaque genre (D12, D22, D52, D88, D89).
 * - 4 · « chaque genre est porté par un des fichiers » : un contrôle du décor du point 3.
 * Sont de moi : au point 3, la reconnaissance des montants du message, que les espaces de
 * `formatCents` (U+202F, U+00A0) faisaient manquer, et son témoin ; au point 1, les dates de lecture
 * écrites en clair ; au point 17, les témoins avec imports et avec besoins, lus d'abord.
 *
 * Décors : l'exemple (`exampleLedger`), lu au 6 ou au 20 septembre 2026, et ses variantes ; un foyer
 * écrit ici (`foyer`), au mois calendaire, lu au 20 septembre 2026, qui porte les alertes du
 * rapprochement : une opération importée non traitée qu'un flux reprendrait, un virement vers le livret
 * qui peut devenir l'ordre, un loyer attendu non reçu. Données inventées (D84).
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import {
  LEDGER_KEYS,
  LedgerStore,
  addDays,
  computePlan,
  dueDateShortfalls,
  emptyLedger,
  euros,
  exampleLedger,
  formatCents,
  missingFlows,
  normalizeLabel,
  periodReadingDate,
  proposeMatches,
  readAlerts,
  readBudgetAhead,
  readPeriods,
  shortDate,
  transfersToOrder,
  type Alert,
  type Ledger,
  type Operation,
} from '../src/index.js';

const SQL = await initSqlJs();
const LECTURE = '2026-09-20';
const mensuel = (anchorDate: string) => ({ interval: 1, unit: 'month' as const, anchorDate });

function op(id: string, date: string, label: string, amount: number, extra: Partial<Operation> = {}): Operation {
  return { id, accountId: 'acc-principal', origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated', ...extra };
}

/** Un foyer au mois calendaire : septembre 2026 va du 1er au 30. */
function foyer(): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: 'acc-principal', name: 'Compte courant', kind: 'principal', openingBalance: euros(3000), openingDate: '2025-01-01' },
    { id: 'acc-livret', name: 'Livret A', kind: 'epargne', openingBalance: 0, openingDate: '2025-01-01' },
  );
  l.tirelires.push({ id: 'tir-vac', name: 'Vacances', placement: [{ accountId: 'acc-livret', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01' });
  l.needs.push({ id: 'need-vac', tirelireId: 'tir-vac', kind: 'recurring', amount: euros(150), periodicity: mensuel('2026-01-01'), priority: 20 });
  l.plannedFlows.push(
    { id: 'flow-salaire', name: 'Salaire', kind: 'income', amount: euros(2000), accountId: 'acc-principal', periodicity: mensuel('2026-01-28'), dateWindowDays: 3, labelPattern: 'SALAIRE' },
    { id: 'flow-loyer', name: 'Loyer', kind: 'fixedCharge', amount: euros(-800), accountId: 'acc-principal', periodicity: mensuel('2026-01-05'), dateWindowDays: 3, labelPattern: 'LOYER' },
  );
  l.operations.push(
    op('op-salaire', '2026-08-28', 'VIR SALAIRE ACME', euros(2000)),
    op('op-virement', '2026-09-02', 'VIR LIVRET', euros(-150), { transferAccountId: 'acc-livret', state: 'locked' }),
  );
  return l;
}

/** L'exemple sans le lissage décidé de la taxe foncière : une échéance en manque, sans réponse. */
function exempleSansReponse(): Ledger {
  const l = exampleLedger();
  l.shortfallAnswers = [];
  l.operations = l.operations.filter((o) => o.id !== 'op-lissage-tf');
  l.subOperations = l.subOperations.filter((s) => s.operationId !== 'op-lissage-tf');
  return l;
}

const deGenre = <C extends Alert['code']>(alertes: Alert[], code: C) => alertes.filter((a): a is Extract<Alert, { code: C }> => a.code === code);
const sans = <T extends object>(x: T, ...cles: string[]) => Object.fromEntries(Object.entries(x).filter(([k]) => !cles.includes(k)));

// ── 1. La fonction ───────────────────────────────────────────────────────────────────────────

describe('#463 · 1. la lecture', () => {
  it('sans période donnée, la seule période qui contient la date de lecture [niveau 2]', () => {
    const l = exampleLedger();
    expect(readPeriods(l, { today: LECTURE }).map((p) => p.key)).toEqual(['2026-09']);
    const periodes = new Set(readAlerts(l, { today: LECTURE }).flatMap((a) => ('period' in a ? [a.period.key] : [])));
    expect([...periodes]).toEqual(['2026-09']);
  });

  it('des périodes consécutives, de celle qui contient `from` [niveau 2]', () => {
    const l = exampleLedger();
    expect(readPeriods(l, { today: LECTURE, from: '2026-08-10', count: 4 }).map((p) => [p.start, p.end])).toEqual([
      ['2026-07-28', '2026-08-27'],
      ['2026-08-28', '2026-09-27'],
      ['2026-09-28', '2026-10-27'],
      ['2026-10-28', '2026-11-27'],
    ]);
    expect(() => readPeriods(l, { today: LECTURE, count: 0 })).toThrow(RangeError);
  });

  it('chaque période lue se lit comme le Plan la lit : à la date de lecture dans la sienne, à son premier jour ailleurs [niveau 2]', () => {
    const l = exampleLedger();
    const lecture = { today: LECTURE, from: '2026-08-10', count: 3 };
    const alertes = readAlerts(l, lecture);
    // Août est passée : lue à son premier jour ; septembre contient la date de lecture ; octobre est à venir.
    const lueLe: Record<string, string> = { '2026-08': '2026-07-28', '2026-09': LECTURE, '2026-10': '2026-09-28' };
    expect(readPeriods(l, lecture).map((p) => [p.key, periodReadingDate(p, LECTURE)])).toEqual(Object.entries(lueLe));
    for (const p of readPeriods(l, lecture)) {
      const plan = computePlan(l, lueLe[p.key]!, LECTURE);
      const lues = alertes.filter((a) => 'period' in a && a.period.key === p.key && a.code !== 'forecastShortfall');
      expect(lues.map((a) => [a.code, a.message]), p.label).toEqual(plan.warnings.map((w) => [w.code, w.message]));
    }
  });
});

// ── 2. Rien ne s'écrit ───────────────────────────────────────────────────────────────────────

describe('#463 · 2. rien ne s’écrit', () => {
  it('la base relue est identique, et la reprise automatique proposée ne s’applique pas [niveau 0]', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 'A' });
    const l = foyer();
    for (const key of LEDGER_KEYS) for (const row of l[key]) s.upsert(key, row as never);
    const avant = s.export();
    const lu = s.load();
    const copie = structuredClone(lu);
    const alertes = readAlerts(lu, { today: LECTURE, count: 3 });
    const reprise = deGenre(alertes, 'matchProposal').find((a) => a.operationId === 'op-salaire');
    expect(reprise?.auto).toBe(true);
    expect(lu).toEqual(copie);
    expect(Buffer.from(s.export()).equals(Buffer.from(avant))).toBe(true);
    const relu = s.load().operations.find((o) => o.id === 'op-salaire')!;
    expect(relu.state).toBe('untreated');
    expect(relu.plannedFlowId).toBeUndefined();
  });
});

// ── 3. Ce que porte une alerte ───────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Un montant tel que `formatCents` l'écrit : milliers séparés par U+202F, U+00A0 avant l'euro. */
const MONTANT = /−?\d{1,3}(?:[   ]\d{3})*,\d{2}[  ]€/g;
const DATE = /\d{1,2} (?:janv\.|févr\.|mars|avr\.|mai|juin|juil\.|août|sept\.|oct\.|nov\.|déc\.) \d{4}/g;

/** Ce qu'une alerte porte à part du message : ses nombres et ses dates, tels que le message les écrirait. */
function portes(a: Alert): { nombres: Set<string>; dates: Set<string> } {
  const nombres = new Set<string>();
  const dates = new Set<string>();
  const visiter = (v: unknown, cle?: string): void => {
    if (cle === 'message' || cle === 'score') return;
    if (typeof v === 'number') {
      expect(Number.isInteger(v), `${a.code} · ${cle} est un entier`).toBe(true);
      for (const x of [formatCents(v), formatCents(-v), String(v)]) nombres.add(x);
    } else if (typeof v === 'string' && /^\d{4}-\d{2}-/.test(v)) {
      expect(v, `${a.code} · ${cle} est une date AAAA-MM-JJ`).toMatch(ISO);
      dates.add(shortDate(v));
    } else if (Array.isArray(v)) v.forEach((x) => visiter(x));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visiter(x, k);
  };
  visiter(a);
  return { nombres, dates };
}

/**
 * L'exemple, son coussin relevé à 700 € : sa marge du 20 octobre, 630 €, est dessous. Depuis #477,
 * l'exemple seul n'y est plus, Enfants et loisirs ne rattrapant plus ses 36 €.
 */
function coussinReleve(): Ledger {
  const l = exampleLedger();
  l.settings.principalCushion = euros(700);
  return l;
}

/** Des fichiers qui, ensemble, portent chacun des genres. */
function fichiersDeTousLesGenres(): Array<{ nom: string; l: Ledger; today: string; count: number; from?: string }> {
  const tiers = exampleLedger();
  for (const f of tiers.plannedFlows) if (f.kind === 'income') f.amount = Math.round(f.amount / 3);
  const marie = exampleLedger();
  Object.assign(marie.accounts.find((a) => a.id === 'acc-marie')!, { settlementDirection: 'toThird', settlementThreshold: 0 });
  const saison = exampleLedger();
  saison.tirelires.push({ id: 'env-saison', name: 'Saison', placement: [], openingBalance: euros(50), openingDate: '2026-08-28' });
  saison.needs.push({ id: 'need-saison', tirelireId: 'env-saison', kind: 'payout', amount: euros(1200), periodicity: { interval: 12, unit: 'month', anchorDate: '2026-08-28' }, priority: 5 });
  const livretRetire = exampleLedger();
  livretRetire.accounts.find((a) => a.id === 'acc-livret')!.deletedAt = '2026-09-01T00:00:00.000Z';
  const vacancesRetirees = exampleLedger();
  vacancesRetirees.tirelires.find((t) => t.id === 'env-vac')!.deletedAt = '2026-09-01T00:00:00.000Z';
  return [
    { nom: 'coussin relevé', l: coussinReleve(), today: '2026-10-20', count: 1 },
    { nom: 'exemple', l: exampleLedger(), today: '2026-09-06', count: 3 },
    { nom: 'exemple, plus tard', l: exampleLedger(), today: '2027-01-10', count: 1 },
    { nom: 'exemple sans réponse', l: exempleSansReponse(), today: '2026-09-06', count: 2 },
    { nom: 'revenus au tiers', l: tiers, today: '2026-09-06', count: 1 },
    { nom: 'règlement bloqué', l: marie, today: '2026-09-06', count: 1 },
    { nom: 'versement court', l: saison, today: '2026-09-06', count: 1 },
    { nom: 'livret retiré', l: livretRetire, today: '2026-09-06', count: 1 },
    { nom: 'vacances retirées', l: vacancesRetirees, today: '2026-09-06', count: 1 },
    { nom: 'foyer', l: foyer(), today: LECTURE, count: 1 },
    { nom: 'foyer sans revenu', l: { ...foyer(), plannedFlows: foyer().plannedFlows.filter((f) => f.kind !== 'income') }, today: LECTURE, count: 1 },
  ];
}

describe('#463 · 3. ce que porte une alerte', () => {
  const lues = fichiersDeTousLesGenres().flatMap((f) => readAlerts(f.l, { today: f.today, count: f.count, ...(f.from ? { from: f.from } : {}) }).map((a) => ({ f: f.nom, a })));

  it('chaque genre est porté par un des fichiers [niveau 4]', () => {
    expect(new Set(lues.map((x) => x.a.code))).toEqual(
      new Set(['staleHistory', 'orphanTirelire', 'untreatedOperations', 'matchProposal', 'transferToOrder', 'dueDateShortfall', 'noIncome', 'negativeMargin', 'belowCushion', 'unfunded', 'reduced', 'payoutShort', 'principalOverdrawn', 'settlementBlocked', 'bankOrderDrift', 'bankOrderPartDrift', 'forecastShortfall', 'missingFlow']),
    );
  });

  it('montants en centimes entiers, dates en AAAA-MM-JJ ; tout montant et toute date du message sont portés à part [niveau 2]', () => {
    // Témoin : les messages des décors portent des montants et des dates, et les motifs les reconnaissent.
    const trouves = (motif: RegExp) => lues.flatMap(({ a }) => a.message.match(motif) ?? []);
    expect(trouves(MONTANT)).toContain(formatCents(euros(600)));
    expect(trouves(MONTANT).length).toBeGreaterThan(10);
    expect(trouves(DATE).length).toBeGreaterThan(10);
    for (const { f, a } of lues) {
      const { nombres, dates } = portes(a);
      for (const m of a.message.match(MONTANT) ?? []) expect(nombres.has(m), `${f} · ${a.code} : « ${m} » dans « ${a.message} »`).toBe(true);
      for (const d of a.message.match(DATE) ?? []) expect(dates.has(d), `${f} · ${a.code} : « ${d} » dans « ${a.message} »`).toBe(true);
      for (const n of a.message.match(/-?\d+(?= (?:centimes|jours|opérations))/g) ?? []) expect(nombres.has(n), `${f} · ${a.code} : « ${n} »`).toBe(true);
    }
  });

  it('un message en français, au vouvoiement [niveau 2]', () => {
    for (const { f, a } of lues) {
      expect(a.message.length, `${f} · ${a.code}`).toBeGreaterThan(0);
      expect(a.message, `${f} · ${a.code}`).not.toMatch(/\b(?:tu|toi|ton|ta|tes|te)\b/i);
    }
  });

  it('ce qu’elle concerne, par ses identifiants et ses noms [niveau 2]', () => {
    for (const { f, a } of lues) {
      const x = a as unknown as Record<string, unknown>;
      for (const [id, nom] of [['tirelireId', 'tirelireName'], ['needId', 'needName'], ['flowId', 'flowName'], ['operationId', 'operationLabel']] as const)
        if (id in x && (nom in x || a.code === 'dueDateShortfall' || a.code === 'missingFlow')) expect(typeof x[id], `${f} · ${a.code} · ${id}`).toBe('string');
      if (a.code === 'dueDateShortfall') expect([typeof a.name, typeof a.tirelireName]).toEqual(['string', 'string']);
      if (a.code === 'missingFlow') expect(typeof a.name).toBe('string');
      if ('accountName' in x) expect(typeof x['accountId'], `${f} · ${a.code}`).toBe('string');
    }
  });
});

// ── 4. Un seul calcul ────────────────────────────────────────────────────────────────────────

describe('#463 · 4. un seul calcul', () => {
  it('chaque genre est ce que rend le calcul du cœur qui le fait [niveau 2]', () => {
    const l = foyer();
    const a = readAlerts(l, { today: LECTURE });
    // Les reprises proposées ne gardent pas l'ordre de leur calcul (par note) : leur ordre est celui
    // d'Opérations, tranché plus bas ; ici, le contenu seul.
    const parOperation = (x: { operationId: string; flowId: string }, y: { operationId: string; flowId: string }) =>
      x.operationId.localeCompare(y.operationId) || x.flowId.localeCompare(y.flowId);
    expect(
      deGenre(a, 'matchProposal')
        .sort(parOperation)
        .map((x) => sans(x, 'code', 'message', 'operationLabel', 'operationDate', 'operationAmount', 'flowName', 'resumedOperationLabel')),
    ).toEqual(proposeMatches(l, addDays('2026-09-01', -400), addDays('2026-09-30', 40)).sort(parOperation));
    expect(deGenre(a, 'missingFlow').map((x) => sans(x, 'code', 'message'))).toEqual(missingFlows(l, addDays('2026-09-01', -60), LECTURE));
    expect(new Map(deGenre(a, 'transferToOrder').map((x) => [x.operationId, x.accountId]))).toEqual(transfersToOrder(l, LECTURE));

    const e = exempleSansReponse();
    const b = readAlerts(e, { today: '2026-09-06', count: 6 });
    expect(deGenre(b, 'dueDateShortfall').map((x) => sans(x, 'code', 'message', 'signaledIn', 'inReading'))).toEqual(dueDateShortfalls(e, '2026-09-06'));
  });

  it('les non couverts sont ceux de la lecture du budget, période par période [niveau 2]', () => {
    const l = exampleLedger();
    for (const f of l.plannedFlows) if (f.kind === 'income') f.amount = Math.round(f.amount / 3);
    const lecture = readBudgetAhead(l, '2026-09-06', 3)!;
    const a = readAlerts(l, { today: '2026-09-06', count: 3 });
    for (const p of lecture.periods) {
      const lues = a.filter((x) => (x.code === 'unfunded' || x.code === 'reduced') && x.period.key === p.period.key);
      expect(lues.map((x) => 'uncovered' in x && [x.needId, x.requested, x.funded, x.uncovered]), p.period.label).toEqual(p.uncovered.map((n) => [n.needId, n.requested, n.funded, n.uncovered]));
    }
  });

  // Du codeur, second tour (`alertes-ordre.test.ts`, déplacé ici). Décor : quatre opérations importées
  // non traitées, chacune avec sa reprise proposée, dont l'ordre par note n'est pas celui de la liste.
  function foyerQuatreReprises(): Ledger {
    const l = emptyLedger();
    l.accounts.push({ id: 'acc-principal', name: 'Compte courant', kind: 'principal', openingBalance: euros(3000), openingDate: '2025-01-01' });
    l.plannedFlows.push(
      { id: 'flow-salaire', name: 'Salaire', kind: 'income', amount: euros(2000), accountId: 'acc-principal', periodicity: mensuel('2026-01-28'), dateWindowDays: 3, labelPattern: 'SALAIRE' },
      { id: 'flow-loyer', name: 'Loyer', kind: 'fixedCharge', amount: euros(-800), accountId: 'acc-principal', periodicity: mensuel('2026-01-05'), dateWindowDays: 3, labelPattern: 'LOYER' },
      { id: 'flow-gaz', name: 'Gaz', kind: 'fixedCharge', amount: euros(-50), accountId: 'acc-principal', periodicity: mensuel('2026-01-05'), dateWindowDays: 3, labelPattern: 'GAZ' },
      { id: 'flow-eau', name: 'Eau', kind: 'fixedCharge', amount: euros(-50), accountId: 'acc-principal', periodicity: mensuel('2026-01-07'), dateWindowDays: 3 },
    );
    // L'ordre du grand livre : l'eau avant le gaz, du même jour et du même montant.
    l.operations.push(
      op('op-eau', '2026-09-07', 'PRLV EAU', euros(-50)),
      op('op-gaz', '2026-09-07', 'PRLV GAZ', euros(-50)),
      op('op-loyer', '2026-09-07', 'PRLV LOYER', euros(-800)),
      op('op-salaire', '2026-08-28', 'VIR SALAIRE', euros(2000)),
    );
    return l;
  }

  it('les reprises proposées, dans l’ordre de la liste d’Opérations : date décroissante, puis montant absolu décroissant, puis l’ordre du grand livre [niveau 2]', () => {
    const l = foyerQuatreReprises();
    // Témoin : la sélection des flux les rend par note décroissante, dans un autre ordre.
    expect(proposeMatches(l, '2025-07-28', '2026-11-09').map((m) => m.operationId)).toEqual(['op-salaire', 'op-gaz', 'op-loyer', 'op-eau']);
    expect(deGenre(readAlerts(l, { today: LECTURE }, ['matchProposal']), 'matchProposal').map((a) => a.operationId)).toEqual([
      'op-loyer', // le 7 septembre, 800 €
      'op-eau', // le 7 septembre, 50 €, avant le gaz dans le grand livre
      'op-gaz',
      'op-salaire', // le 28 août
    ]);
  });
});

// ── 5. Historique en retard ──────────────────────────────────────────────────────────────────

describe('#463 · 5. historique en retard', () => {
  const avecDerniere = (date: string): Ledger => {
    const l = foyer();
    l.operations.push(op('op-recente', date, 'CB BOULANGERIE', -350, { origin: 'manual', accountId: 'acc-livret' }));
    l.operations.push(op('op-retiree', addDays(LECTURE, -1), 'CB RETIREE', -100, { deletedAt: '2026-09-19T00:00:00.000Z' }));
    return l;
  };
  it('à 15 jours, pas d’alerte ; à 16, l’alerte, avec sa date et le nombre de jours [niveau 2]', () => {
    expect(readAlerts(avecDerniere(addDays(LECTURE, -15)), { today: LECTURE }, ['staleHistory'])).toEqual([]);
    const [a] = readAlerts(avecDerniere(addDays(LECTURE, -16)), { today: LECTURE }, ['staleHistory']);
    expect(a && [a.lastOperationDate, a.days]).toEqual(['2026-09-04', 16]);
  });
  it('sans opération, aucune [niveau 2]', () => {
    expect(readAlerts({ ...foyer(), operations: [] }, { today: LECTURE }, ['staleHistory'])).toEqual([]);
  });
});

// ── 6. Tirelire sans compte de placement ─────────────────────────────────────────────────────

describe('#463 · 6. tirelire sans compte de placement', () => {
  it('le compte où elle se range n’est pas un compte vivant : la tirelire, et le compte visé quand il y en a un [niveau 2]', () => {
    const l = foyer();
    l.accounts.push({ id: 'acc-clos', name: 'Ancien livret', kind: 'epargne', openingBalance: 0, openingDate: '2025-01-01', deletedAt: '2026-06-01T00:00:00.000Z' });
    l.tirelires.push(
      { id: 'tir-orpheline', name: 'Orpheline', placement: [{ accountId: 'acc-clos', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01' },
      { id: 'tir-libre', name: 'Libre', placement: [], openingBalance: 0, openingDate: '2026-01-01' },
      { id: 'tir-retiree', name: 'Retirée', placement: [{ accountId: 'acc-clos', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-01-01', deletedAt: '2026-06-01T00:00:00.000Z' },
    );
    expect(readAlerts(l, { today: LECTURE }, ['orphanTirelire']).map((a) => [a.tirelireId, a.tirelireName, a.accountId])).toEqual([['tir-orpheline', 'Orpheline', 'acc-clos']]);
    // Sans placement ni compte principal : aucun compte visé.
    const sansPrincipal = { ...l, accounts: l.accounts.filter((a) => a.kind !== 'principal') };
    expect(readAlerts(sansPrincipal, { today: LECTURE }, ['orphanTirelire']).map((a) => [a.tirelireId, 'accountId' in a])).toEqual([
      ['tir-orpheline', true],
      ['tir-libre', false],
    ]);
  });
});

// ── 7. Opérations non traitées ───────────────────────────────────────────────────────────────

describe('#463 · 7. opérations non traitées', () => {
  it('le nombre d’opérations vivantes non traitées, et chacune ; aucune alerte sans elles [niveau 2]', () => {
    const l = foyer();
    l.operations.push(op('op-cb', '2026-09-10', 'CB MARCHE', -2500), op('op-supprimee', '2026-09-11', 'CB X', -100, { deletedAt: '2026-09-12T00:00:00.000Z' }));
    const [a] = readAlerts(l, { today: LECTURE }, ['untreatedOperations']);
    expect(a?.count).toBe(2);
    expect(a?.operations).toEqual([
      { id: 'op-salaire', label: 'VIR SALAIRE ACME', accountId: 'acc-principal', date: '2026-08-28', amount: euros(2000) },
      { id: 'op-cb', label: 'CB MARCHE', accountId: 'acc-principal', date: '2026-09-10', amount: -2500 },
    ]);
    const traitees = { ...l, operations: l.operations.map((o) => ({ ...o, state: 'locked' as const })) };
    expect(readAlerts(traitees, { today: LECTURE }, ['untreatedOperations'])).toEqual([]);
  });
});

// ── 8. Reprise proposée ──────────────────────────────────────────────────────────────────────

describe('#463 · 8. reprise proposée', () => {
  it('l’opération, le flux et la date de l’occurrence, le montant attendu, la note, les raisons, et si elle s’appliquerait sans confirmation [niveau 2]', () => {
    const [a] = readAlerts(foyer(), { today: LECTURE }, ['matchProposal']);
    expect(a).toMatchObject({
      operationId: 'op-salaire',
      operationLabel: 'VIR SALAIRE ACME',
      operationDate: '2026-08-28',
      operationAmount: euros(2000),
      flowId: 'flow-salaire',
      flowName: 'Salaire',
      expectedDate: '2026-08-28',
      expectedAmount: euros(2000),
      auto: true,
      reasons: ['date à 0 j', 'libellé reconnu', 'montant exact'],
    });
    expect(a?.score).toBeGreaterThan(0);
  });

  it('la saisie qu’elle reprendrait, quand une saisie corrige déjà l’occurrence [niveau 2]', () => {
    const l = foyer();
    l.operations.push(op('op-correction', '2026-08-28', 'Salaire corrigé', euros(2000), { origin: 'manual', state: 'locked', plannedFlowId: 'flow-salaire', plannedDate: '2026-08-28' }));
    const [a] = readAlerts(l, { today: LECTURE }, ['matchProposal']);
    expect(a && [a.resumedOperationId, a.resumedOperationLabel]).toEqual(['op-correction', 'Salaire corrigé']);
  });

  /** Un flux hebdomadaire, le lundi, fenêtre d'un jour : 2025-07-28 et 2026-11-09 sont des lundis. */
  const hebdo = (dates: string[]): Ledger => {
    const l = foyer();
    l.operations = dates.map((d, i) => op(`op-abo-${i}`, d, 'ABONNEMENT', -999));
    l.plannedFlows.push({ id: 'flow-abo', name: 'Abonnement', kind: 'fixedCharge', amount: -999, accountId: 'acc-principal', periodicity: { interval: 1, unit: 'week', anchorDate: '2025-07-28' }, dateWindowDays: 1, labelPattern: 'ABONNEMENT' });
    return l;
  };
  it('de 400 jours avant le début de la période de la date de lecture à 40 jours après sa fin, bornes comprises [niveau 2]', () => {
    // Septembre 2026 : du 1er au 30 ; la fenêtre va du 28 juillet 2025 au 9 novembre 2026.
    expect(readAlerts(hebdo(['2025-07-28', '2026-11-09']), { today: LECTURE }, ['matchProposal']).map((a) => a.operationDate)).toEqual(expect.arrayContaining(['2025-07-28', '2026-11-09']));
    const dehors = hebdo(['2025-07-27', '2026-11-10']);
    expect(readAlerts(dehors, { today: LECTURE }, ['matchProposal'])).toEqual([]);
    // Elles seraient proposées dans une fenêtre plus large : seule la fenêtre les écarte.
    expect(proposeMatches(dehors, '2025-07-01', '2026-12-31').map((m) => m.operationId).sort()).toEqual(['op-abo-0', 'op-abo-1']);
  });
  it('la fenêtre suit la période de la date de lecture, pas les périodes lues [niveau 2]', () => {
    const l = hebdo(['2025-07-28']);
    expect(readAlerts(l, { today: LECTURE, from: '2027-03-01', count: 2 }, ['matchProposal']).map((a) => a.operationId)).toEqual(['op-abo-0']);
  });
});

// ── 9. Virement qui peut devenir un ordre permanent ──────────────────────────────────────────

describe('#463 · 9. virement qui peut devenir un ordre permanent', () => {
  it('l’opération, sa date, son montant, et le compte d’accueil, le plan lu à la date de lecture [niveau 2]', () => {
    const a = readAlerts(foyer(), { today: LECTURE, from: '2027-01-01' }, ['transferToOrder']);
    expect(a.map((x) => [x.operationId, x.operationLabel, x.date, x.amount, x.accountId, x.accountName])).toEqual([['op-virement', 'VIR LIVRET', '2026-09-02', euros(-150), 'acc-livret', 'Livret A']]);
  });
  it('du plus ancien au plus récent [niveau 2]', () => {
    const l = foyer();
    l.operations.unshift(op('op-virement-2', '2026-09-15', 'VIR LIVRET', euros(-150), { transferAccountId: 'acc-livret', state: 'locked' }));
    l.operations.push(op('op-virement-0', '2026-08-02', 'VIR LIVRET', euros(-150), { transferAccountId: 'acc-livret', state: 'locked' }));
    expect(readAlerts(l, { today: LECTURE }, ['transferToOrder']).map((x) => x.date)).toEqual(['2026-08-02', '2026-09-02', '2026-09-15']);
  });
});

// ── 10. Échéance en manque ───────────────────────────────────────────────────────────────────

describe('#463 · 10. échéance en manque', () => {
  it('en manque sans réponse : le besoin, sa tirelire, la date, ce qui manquera, la croisière et la proposition de lisser [niveau 2]', () => {
    const [a] = readAlerts(exempleSansReponse(), { today: '2026-09-06' }, ['dueDateShortfall']);
    const attendu = dueDateShortfalls(exempleSansReponse(), '2026-09-06')[0]!;
    expect(a).toMatchObject({ needId: 'need-tf', name: 'Taxe foncière', tirelireId: 'env-tf', tirelireName: 'Taxe foncière', dueDate: '2026-10-15' });
    expect(a!.amount).toBeGreaterThan(0);
    expect([a!.amount, a!.cruise, a!.proposal]).toEqual([attendu.amount, attendu.cruise, attendu.proposal]);
    expect(a!.answer).toBeUndefined();
  });
  it('déjà répondue : le lissage, avec ses parts datées, ou le refus ; zéro quand la réponse y suffit [niveau 2]', () => {
    const [lisse] = readAlerts(exampleLedger(), { today: '2026-09-06' }, ['dueDateShortfall']);
    expect(lisse!.amount).toBe(0);
    expect(lisse!.answer?.kind).toBe('smoothing');
    expect(lisse!.answer?.kind === 'smoothing' && lisse!.answer.parts.length).toBeGreaterThan(0);
    expect(lisse!.proposal).toBeUndefined();
    const refus = exempleSansReponse();
    refus.shortfallAnswers.push({ id: 'reponse:need-tf:2026-10-15', needId: 'need-tf', dueDate: '2026-10-15' });
    const [r] = readAlerts(refus, { today: '2026-09-06' }, ['dueDateShortfall']);
    expect(r!.answer?.kind).toBe('refusal');
    expect(r!.amount).toBeGreaterThan(0);
  });
  it('une période passée ne la signale pas ; celle de la date de lecture et les suivantes jusqu’à sa date, oui ; et sa date tombe ou non dans les périodes lues [niveau 2]', () => {
    // Échéance du 15 octobre 2026, lue au 20 septembre : août est passée, septembre est la période de la date de lecture,
    // octobre la contient, novembre vient après.
    const lecture = { today: LECTURE, from: '2026-08-10', count: 4 };
    const [a] = readAlerts(exampleLedger(), lecture, ['dueDateShortfall']);
    expect(a!.signaledIn).toEqual(['2026-09', '2026-10']);
    expect(a!.inReading).toBe(true);
    const [b] = readAlerts(exampleLedger(), { today: LECTURE, from: '2026-11-01', count: 2 }, ['dueDateShortfall']);
    expect([b!.signaledIn, b!.inReading]).toEqual([[], false]);
    const [c] = readAlerts(exampleLedger(), { today: LECTURE, from: '2026-08-10' }, ['dueDateShortfall']);
    expect([c!.signaledIn, c!.inReading]).toEqual([[], false]);
  });
});

// ── 11. Avertissement du plan ────────────────────────────────────────────────────────────────

describe('#463 · 11. avertissements du plan, selon leur code', () => {
  const septembre = { today: '2026-09-06' };

  it('noIncome : la période seule [niveau 2]', () => {
    const l = foyer();
    l.plannedFlows = l.plannedFlows.filter((f) => f.kind !== 'income');
    const [a] = readAlerts(l, { today: LECTURE }, ['noIncome']);
    expect(a && sans(a, 'message')).toEqual({ code: 'noIncome', period: readPeriods(l, { today: LECTURE })[0] });
    expect(a!.message).toBe('Aucun revenu prévu sur la période.');
  });

  it('negativeMargin : ce qui manque aux revenus, charges fixes déduites, pour couvrir les dotations ; unfunded et reduced : demandé, couvert, non couvert [niveau 2]', () => {
    const l = exampleLedger();
    for (const f of l.plannedFlows) if (f.kind === 'income') f.amount = Math.round(f.amount / 3);
    const plan = computePlan(l, '2026-09-06');
    const a = readAlerts(l, septembre);
    expect(deGenre(a, 'negativeMargin').map((x) => x.missing)).toEqual([plan.totals.requested - (plan.totals.incomes - plan.totals.fixedCharges)]);
    const reduite = deGenre(a, 'reduced')[0]!;
    const ligne = plan.lines.find((x) => x.needId === reduite.needId)!;
    expect([reduite.needName, reduite.tirelireId, reduite.tirelireName, reduite.requested, reduite.funded, reduite.uncovered]).toEqual([ligne.name, ligne.tirelireId, ligne.tirelireName, ligne.requested, ligne.funded, ligne.requested - ligne.funded]);
    expect(reduite.funded).toBeGreaterThan(0);
    for (const x of deGenre(a, 'unfunded')) expect([x.funded, x.uncovered]).toEqual([0, x.requested]);
  });

  it('belowCushion : la marge et le coussin [niveau 2]', () => {
    const l = coussinReleve();
    const [a] = readAlerts(l, { today: '2026-10-20' }, ['belowCushion']);
    const plan = computePlan(l, '2026-10-20');
    expect(a && [a.margin, a.cushion]).toEqual([plan.totals.margin, plan.totals.cushion]);
    expect(a!.margin).toBeLessThan(a!.cushion);
  });

  it('payoutShort : le besoin et sa tirelire, ce que la réserve retient au début de la période et la part déclarée [niveau 2]', () => {
    const l = exampleLedger();
    l.tirelires.push({ id: 'env-saison', name: 'Saison', placement: [], openingBalance: euros(50), openingDate: '2026-08-28' });
    l.needs.push({ id: 'need-saison', tirelireId: 'env-saison', kind: 'payout', amount: euros(1200), periodicity: { interval: 12, unit: 'month', anchorDate: '2026-08-28' }, priority: 5 });
    const [a] = readAlerts(l, septembre, ['payoutShort']);
    expect(a && [a.needId, a.needName, a.tirelireId, a.tirelireName, a.held, a.cruise]).toEqual(['need-saison', 'Saison', 'env-saison', 'Saison', euros(50), euros(100)]);
  });

  it('principalOverdrawn : le compte principal et son non affecté, négatif [niveau 2]', () => {
    const l = exampleLedger();
    const [a] = readAlerts(l, { today: '2027-01-10' }, ['principalOverdrawn']);
    expect(a && [a.accountId, a.accountName, a.unallocated]).toEqual(['acc-principal', 'Compte courant', computePlan(l, '2027-01-10').totals.principalUnallocated]);
    expect(a!.unallocated).toBeLessThan(0);
  });

  it('settlementBlocked : le compte tiers et le règlement bloqué, signé comme le plan le calcule [niveau 2]', () => {
    const l = exampleLedger();
    Object.assign(l.accounts.find((a) => a.id === 'acc-marie')!, { settlementDirection: 'toThird', settlementThreshold: 0 });
    const [a] = readAlerts(l, septembre, ['settlementBlocked']);
    expect(a && [a.accountId, a.accountName, a.amount]).toEqual(['acc-marie', 'Compte de Marie', euros(-20)]);
    expect(a!.message).toBe('Un règlement de -2000 centimes avec « Compte de Marie » est bloqué par le sens autorisé.');
  });

  it('bankOrderDrift : le compte d’accueil, l’ordre enregistré, ce que le budget demande (zéro quand il ne demande plus rien), et si le compte est retiré [niveau 2]', () => {
    const [a] = readAlerts(exampleLedger(), septembre, ['bankOrderDrift']);
    expect(a && [a.accountId, a.accountName, a.recorded, a.requested, a.accountRetired]).toEqual(['acc-livret', 'Livret A', euros(600), euros(650), false]);
    const retire = exampleLedger();
    retire.accounts.find((x) => x.id === 'acc-livret')!.deletedAt = '2026-09-01T00:00:00.000Z';
    const [b] = readAlerts(retire, septembre, ['bankOrderDrift']);
    expect(b && [b.accountId, b.accountName, b.recorded, b.requested, b.accountRetired]).toEqual(['acc-livret', 'Livret A', euros(600), 0, true]);
  });

  it('bankOrderPartDrift : le compte, la tirelire, sa part enregistrée et ce que le budget lui demande (zéro pour une tirelire retirée) [niveau 2]', () => {
    const [a] = readAlerts(exampleLedger(), septembre, ['bankOrderPartDrift']);
    expect(a && [a.accountId, a.tirelireId, a.tirelireName, a.recorded, a.requested, a.tirelireRetired]).toEqual(['acc-livret', 'env-vac', 'Vacances', euros(150), euros(200), false]);
    const retiree = exampleLedger();
    retiree.tirelires.find((t) => t.id === 'env-vac')!.deletedAt = '2026-09-01T00:00:00.000Z';
    const [b] = readAlerts(retiree, septembre, ['bankOrderPartDrift']);
    expect(b && [b.tirelireId, b.recorded, b.requested, b.tirelireRetired]).toEqual(['env-vac', euros(150), 0, true]);
  });

  it('le message est celui que le plan rend, inchangé, dans l’ordre du plan [niveau 2]', () => {
    for (const today of ['2026-09-06', '2026-10-20', '2027-01-10']) {
      const l = exampleLedger();
      const lues = readAlerts(l, { today }).filter((a) => 'period' in a && a.code !== 'forecastShortfall');
      expect(lues.map((a) => [a.code, a.message])).toEqual(computePlan(l, today).warnings.map((w) => [w.code, w.message]));
    }
  });
});

// ── 12. Manque d'un solde prévu ──────────────────────────────────────────────────────────────

describe('#463 · 12. manque d’un solde prévu', () => {
  it('pour une période à venir seulement : chaque compte et chaque tirelire, le montant et la date du point le plus bas [niveau 2]', () => {
    const l = exampleLedger();
    const lecture = { today: LECTURE, from: '2026-08-10', count: 3 };
    const a = readAlerts(l, lecture, ['forecastShortfall']);
    expect([...new Set(a.map((x) => x.period.key))]).toEqual(['2026-10']);
    const plan = computePlan(l, '2026-09-28', LECTURE);
    const attendus = [
      ...plan.forecast!.accounts.filter((x) => x.shortfall).map((x) => ['accountId', x.id, x.shortfall!.amount, x.shortfall!.date]),
      ...plan.forecast!.tirelires.filter((x) => x.shortfall).map((x) => ['tirelireId', x.id, x.shortfall!.amount, x.shortfall!.date]),
    ];
    expect(attendus.length).toBeGreaterThan(0);
    expect(a.map((x) => ('accountId' in x ? ['accountId', x.accountId, x.amount, x.date] : ['tirelireId', x.tirelireId, x.amount, x.date]))).toEqual(attendus);
    for (const x of a) expect(x.amount).toBeLessThan(0);
  });
});

// ── 13. Attendu, non reçu ────────────────────────────────────────────────────────────────────

describe('#463 · 13. attendu, non reçu', () => {
  it('le flux, la date attendue, le montant, la fin de la fenêtre [niveau 2]', () => {
    const a = readAlerts(foyer(), { today: LECTURE }, ['missingFlow']);
    expect(a.find((x) => x.expectedDate === '2026-09-05')).toMatchObject({ flowId: 'flow-loyer', name: 'Loyer', amount: euros(-800), windowEnd: '2026-09-08' });
  });
  it('de 60 jours avant le début de la première période lue : une occurrence à la borne compte, une juste avant non [niveau 2]', () => {
    // Septembre 2026 commence le 1er : la borne est le 3 juillet 2026.
    const l = foyer();
    l.plannedFlows.push(
      { id: 'flow-borne', name: 'À la borne', kind: 'fixedCharge', amount: -1000, accountId: 'acc-principal', periodicity: mensuel('2026-07-03'), dateWindowDays: 2 },
      { id: 'flow-avant', name: 'Juste avant', kind: 'fixedCharge', amount: -1000, accountId: 'acc-principal', periodicity: mensuel('2026-07-02'), dateWindowDays: 2 },
    );
    const a = readAlerts(l, { today: LECTURE }, ['missingFlow']);
    expect(a.filter((x) => x.flowId === 'flow-borne').map((x) => x.expectedDate)).toContain('2026-07-03');
    expect(a.filter((x) => x.flowId === 'flow-avant').map((x) => x.expectedDate)).not.toContain('2026-07-02');
    expect(a.filter((x) => x.flowId === 'flow-avant').map((x) => x.expectedDate)).toContain('2026-08-02');
    // La borne suit la première période lue.
    const plusTot = readAlerts(l, { today: LECTURE, from: '2026-08-15', count: 2 }, ['missingFlow']);
    expect(plusTot.filter((x) => x.flowId === 'flow-avant').map((x) => x.expectedDate)).toContain('2026-07-02');
  });
});

// ── 17. Chaque usage tient seul ──────────────────────────────────────────────────────────────

describe('#463 · 17. chaque usage tient seul (I3)', () => {
  it('sans opération importée : ni reprise proposée, ni attendu non reçu [niveau 1]', () => {
    // Témoin, lu d'abord : avec ses opérations importées, le foyer porte l'une et l'autre.
    const avec = readAlerts(foyer(), { today: LECTURE, count: 3 }).map((a) => a.code);
    expect(avec).toContain('matchProposal');
    expect(avec).toContain('missingFlow');
    const l = foyer();
    l.operations = l.operations.map((o) => ({ ...o, origin: 'manual' as const }));
    const codes = readAlerts(l, { today: LECTURE, count: 3 }).map((a) => a.code);
    expect(codes).not.toContain('matchProposal');
    expect(codes).not.toContain('missingFlow');
    const exemple = exampleLedger();
    exemple.operations = exemple.operations.map((o) => ({ ...o, origin: 'manual' as const }));
    const parExemple = readAlerts(exemple, { today: '2026-09-06', count: 3 }).map((a) => a.code);
    expect(parExemple).not.toContain('matchProposal');
    expect(parExemple).not.toContain('missingFlow');
  });
  it('sans besoin : ni échéance en manque, ni unfunded, ni reduced [niveau 1]', () => {
    const auTiers = (): Ledger => {
      const l = exempleSansReponse();
      for (const f of l.plannedFlows) if (f.kind === 'income') f.amount = Math.round(f.amount / 3);
      return l;
    };
    // Témoin, lu d'abord, à la même lecture : avec ses besoins, le fichier porte les trois.
    const avec = readAlerts(auTiers(), { today: '2026-09-06', count: 6 }).map((a) => a.code);
    for (const c of ['dueDateShortfall', 'unfunded', 'reduced']) expect(avec).toContain(c);
    const l = auTiers();
    l.needs = [];
    const codes = readAlerts(l, { today: '2026-09-06', count: 6 }).map((a) => a.code);
    for (const c of ['dueDateShortfall', 'unfunded', 'reduced']) expect(codes).not.toContain(c);
  });
});
