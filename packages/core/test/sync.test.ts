import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { LedgerStore, computePlan, euros, exampleLedger, exportBundle, getPeerCursor, importBundle, knownPeers, memoryTransportPair, runSync } from '../src/index.js';

const SQL = await initSqlJs();
async function seeded(site: string) {
  const s = await LedgerStore.create({ sqlJs: SQL, siteId: site });
  const l = exampleLedger();
  for (const a of l.accounts) s.upsert('accounts', a);
  for (const e of l.envelopes) s.upsert('envelopes', e);
  for (const n of l.needs) s.upsert('needs', n);
  for (const f of l.plannedFlows) s.upsert('plannedFlows', f);
  return s;
}

describe('synchronisation', () => {
  it('deux appareils convergent par le protocole, puis n’échangent plus que le delta', async () => {
    const a = await seeded('A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    const [ta, tb] = memoryTransportPair();
    const [ra, rb] = await Promise.all([runSync(a, ta, { name: 'Téléphone' }), runSync(b, tb, { name: 'PC' })]);
    expect(ra.peer).toBe('B');
    expect(ra.peerName).toBe('PC');
    expect(rb.applied).toBeGreaterThan(0);
    expect(computePlan(b.load(), '2026-09-06').totals).toEqual(computePlan(a.load(), '2026-09-06').totals);
    expect(getPeerCursor(b, 'A')).toBe(a.lastSeq);
    expect(knownPeers(a).map((p) => p.site)).toEqual(['B']);

    // Modification de chaque côté, second échange : seul le delta circule.
    const need = b.load().needs.find((n) => n.id === 'need-tf')!;
    b.upsert('needs', { ...need, amount: euros(1300) });
    const acc = a.load().accounts.find((x) => x.id === 'acc-pivot')!;
    a.upsert('accounts', { ...acc, name: 'Compte joint' });
    const [t2a, t2b] = memoryTransportPair();
    const [r2a, r2b] = await Promise.all([runSync(a, t2a), runSync(b, t2b)]);
    expect(r2a.sent).toBe(1);
    expect(r2b.sent).toBe(1);
    expect(a.load().needs.find((n) => n.id === 'need-tf')!.amount).toBe(euros(1300));
    expect(b.load().accounts.find((x) => x.id === 'acc-pivot')!.name).toBe('Compte joint');
  });

  it('trois appareils : C reçoit les changements de A relayés par B', async () => {
    const a = await seeded('A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    const c = await LedgerStore.create({ sqlJs: SQL, siteId: 'C' });
    let [x, y] = memoryTransportPair();
    await Promise.all([runSync(a, x), runSync(b, y)]);
    [x, y] = memoryTransportPair();
    await Promise.all([runSync(b, x), runSync(c, y)]);
    expect(c.load().envelopes.length).toBe(a.load().envelopes.length);
    // Et A n'a rien à recevoir de C que ses propres changements relayés (ignorés).
    [x, y] = memoryTransportPair();
    const [ra] = await Promise.all([runSync(a, x), runSync(c, y)]);
    expect(ra.applied).toBe(0);
  });

  it('échange par fichier : export depuis un curseur, import idempotent', async () => {
    const a = await seeded('A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    const bundle = exportBundle(a, 0, 'Téléphone');
    expect(bundle.entries.length).toBe(a.lastSeq);
    const r1 = importBundle(b, bundle);
    expect(r1.applied).toBeGreaterThan(0);
    const r2 = importBundle(b, bundle);
    expect(r2.applied).toBe(0);
    expect(getPeerCursor(b, 'A')).toBe(a.lastSeq);
    // Delta suivant
    const acc = a.load().accounts[0]!;
    a.upsert('accounts', { ...acc, name: 'Renommé' });
    const delta = exportBundle(a, getPeerCursor(b, 'A'));
    expect(delta.entries.length).toBe(1);
    importBundle(b, delta);
    expect(b.load().accounts.find((x) => x.id === acc.id)!.name).toBe('Renommé');
    expect(() => importBundle(b, { ...delta, format: 'x' as never })).toThrow();
  });
});
