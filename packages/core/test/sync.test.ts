import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { LedgerStore, computePlan, euros, exampleLedger, exportBundle, exportBundleFor, importBundle, knownPeers, memoryTransportPair, runSync } from '../src/index.js';

const SQL = await initSqlJs();
async function seeded(site: string) {
  const s = await LedgerStore.create({ sqlJs: SQL, siteId: site });
  const l = exampleLedger();
  for (const a of l.accounts) s.upsert('accounts', a);
  for (const e of l.tirelires) s.upsert('tirelires', e);
  for (const n of l.needs) s.upsert('needs', n);
  for (const f of l.plannedFlows) s.upsert('plannedFlows', f);
  return s;
}
const lignes = (l: ReturnType<typeof exampleLedger>) => l.accounts.length + l.tirelires.length + l.needs.length + l.plannedFlows.length;

describe('synchronisation', () => {
  it('deux appareils convergent par le protocole, puis n’échangent plus que le delta', async () => {
    const a = await seeded('A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    const [ta, tb] = memoryTransportPair();
    const [ra, rb] = await Promise.all([runSync(a, ta, { name: 'Téléphone' }), runSync(b, tb, { name: 'PC' })]);
    expect(ra.peer).toBe('B');
    expect(ra.peerName).toBe('PC');
    expect(rb.applied).toBe(lignes(exampleLedger()));
    expect(computePlan(b.load(), '2026-09-06').totals).toEqual(computePlan(a.load(), '2026-09-06').totals);
    expect(b.getKnowledge()['A']).toBe(a.getKnowledge()['A']);
    expect(knownPeers(a).map((p) => p.site)).toEqual(['B']);

    // Modification de chaque côté, second échange : seul le delta circule.
    const need = b.load().needs.find((n) => n.id === 'need-tf')!;
    b.upsert('needs', { ...need, amount: euros(1300) });
    const acc = a.load().accounts.find((x) => x.id === 'acc-principal')!;
    a.upsert('accounts', { ...acc, name: 'Compte joint' });
    const [t2a, t2b] = memoryTransportPair();
    const [r2a, r2b] = await Promise.all([runSync(a, t2a), runSync(b, t2b)]);
    expect(r2a.sent).toBe(1);
    expect(r2b.sent).toBe(1);
    expect(r2a.conflicts).toEqual([]);
    expect(a.load().needs.find((n) => n.id === 'need-tf')!.amount).toBe(euros(1300));
    expect(b.load().accounts.find((x) => x.id === 'acc-principal')!.name).toBe('Compte joint');
  });

  it('trois appareils : C reçoit les lignes de A par B', async () => {
    const a = await seeded('A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    const c = await LedgerStore.create({ sqlJs: SQL, siteId: 'C' });
    let [x, y] = memoryTransportPair();
    await Promise.all([runSync(a, x), runSync(b, y)]);
    [x, y] = memoryTransportPair();
    await Promise.all([runSync(b, x), runSync(c, y)]);
    expect(c.load()).toEqual({ ...a.load(), settings: { ...a.load().settings, siteId: 'C' } });
    // Et A n'a rien à recevoir de C : C lui annonce tout savoir de A.
    [x, y] = memoryTransportPair();
    const [ra, rc] = await Promise.all([runSync(a, x), runSync(c, y)]);
    expect(ra.received).toBe(0);
    expect(rc.received).toBe(0);
  });

  it('échange par fichier : un paquet pour ce qu’un pair ignore, import idempotent', async () => {
    const a = await seeded('A');
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
    const bundle = exportBundle(a, undefined, 'Téléphone');
    expect(bundle.rows.length).toBe(lignes(exampleLedger()));
    const r1 = importBundle(b, bundle);
    expect(r1.applied).toBe(bundle.rows.length);
    const r2 = importBundle(b, bundle);
    expect(r2.applied).toBe(0);
    // B répond : A apprend ce que B sait, et le paquet suivant ne porte que la nouveauté.
    importBundle(a, exportBundle(b));
    const acc = a.load().accounts[0]!;
    a.upsert('accounts', { ...acc, name: 'Renommé' });
    const delta = exportBundleFor(a, 'B');
    expect(delta.rows.length).toBe(1);
    importBundle(b, delta);
    expect(b.load().accounts.find((x) => x.id === acc.id)!.name).toBe('Renommé');
    expect(() => importBundle(b, { ...delta, format: 'x' as never })).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Témoin rouge du harnais I8 (docs/gardes.md) : les assertions de l'échange par fichier, rejouées
// sur une version volontairement cassée du besoin.
// ─────────────────────────────────────────────────────────────────────────────────────────────

it.fails('témoin rouge · un échange par fichier qui repart toujours de zéro', async () => {
  const a = await seeded('A');
  const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B' });
  importBundle(b, exportBundle(a, undefined, 'Téléphone'));
  importBundle(a, exportBundle(b));
  const acc = a.load().accounts[0]!;
  a.upsert('accounts', { ...acc, name: 'Renommé' });
  // Version cassée : ce que sait le pair est ignoré ; chaque paquet porte tout l'état, et deux
  // appareils ne « n'échangent plus que le delta » jamais.
  const delta = exportBundle(a);

  expect(delta.rows.length).toBe(1);
});
