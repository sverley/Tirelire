/**
 * #184 · Une échéance trop proche : le plan annonce le manque et propose le lissage (principe 1.4, D88).
 *
 * Tests du codeur, tous de niveau 4. L'auditeur en a retenu la plupart dans son harnais
 * (`manque-lissage-harnais.test.ts`) ; ne restent ici que ceux qu'il n'a pas retenus.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import {
  computePlan,
  dueDateShortfalls,
  euros,
  exampleLedger,
  LEDGER_KEYS,
  LedgerStore,
  memoryTransportPair,
  refusalAnswer,
  runSync,
  smoothingAnswer,
  type Ledger,
} from '../src/index.js';

const SQL = await initSqlJs();
const asOf = '2026-09-06';

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
  it('une échéance déjà en avance ne demande pas moins que sa croisière', () => {
    const auto = line(computePlan(sansReponse(), asOf), 'need-auto');
    expect(auto.requested).toBe(euros(50));
    expect(auto.catchUp).toBe(euros(50));
  });
});

describe('[niveau 4] #184 · 2. une échéance en manque se signale, quelle que soit la façon dont elle est arrivée', () => {
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

describe('[niveau 4] #184 · 5. la réponse survit au redémarrage, à la sauvegarde restaurée et à la synchronisation', () => {
  const proposition = () => taxe(sansReponse())!.proposal!;

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
});

describe('[niveau 4] #184 · 7. une sous-opération peut porter sa propre date', () => {
  it('une date de sous-opération qui n’est pas une date refuse l’écriture', async () => {
    const s = await deposer(exampleLedger());
    expect(() => s.upsert('subOperations', { id: 'z', operationId: 'op-lissage-tf', share: { kind: 'fixed', amount: 1 }, date: '28/09/2026' })).toThrow();
  });
});
