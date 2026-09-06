import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { computePlan, exampleLedger, GENESIS_HASH, LedgerStore, euros, normalizeLabel, operationKey, uuidv7 } from '../src/index.js';

const SQL = await initSqlJs();

async function open(site: string, bytes?: Uint8Array) {
  return LedgerStore.create({ sqlJs: SQL, siteId: site, ...(bytes ? { bytes } : {}) });
}

async function seeded(site: string) {
  const s = await open(site);
  const l = exampleLedger();
  for (const a of l.accounts) s.upsert('accounts', a);
  for (const e of l.envelopes) s.upsert('envelopes', e);
  for (const c of l.categories) s.upsert('categories', c);
  for (const f of l.plannedFlows) s.upsert('plannedFlows', f);
  for (const o of l.operations) s.upsert('operations', o);
  for (const a of l.allocations) s.upsert('allocations', a);
  s.setSetting('budgetYearStart', l.settings.budgetYearStart);
  s.setSetting('pivotCushion', l.settings.pivotCushion);
  return s;
}

describe('dépôt SQLite', () => {
  it('écrit, relit, et le plan est identique à celui calculé en mémoire', async () => {
    const s = await seeded('A');
    const loaded = s.load();
    const fromMemory = computePlan(exampleLedger(), '2026-09-06');
    const fromStore = computePlan(loaded, '2026-09-06');
    expect(fromStore.totals).toEqual(fromMemory.totals);
    expect(fromStore.transfers).toEqual(fromMemory.transfers);
    expect(loaded.settings.budgetYearStart).toEqual({ month: 9, day: 1 });
    expect(loaded.settings.siteId).toBe('A');
  });

  it('survit à un export / réouverture', async () => {
    const s = await seeded('A');
    const bytes = s.export();
    const again = await open('A', bytes);
    expect(again.load().envelopes.length).toBe(exampleLedger().envelopes.length);
    expect(again.lastSeq).toBe(s.lastSeq);
  });

  it('ne journalise que les colonnes qui changent', async () => {
    const s = await open('A');
    const acc = exampleLedger().accounts[0]!;
    s.upsert('accounts', acc);
    const before = s.lastSeq;
    s.upsert('accounts', acc); // identique : rien
    expect(s.lastSeq).toBe(before);
    s.upsert('accounts', { ...acc, name: 'Compte joint' });
    expect(s.lastSeq).toBe(before + 1);
    const last = s.changesSince(before)[0]!;
    expect(last.tbl).toBe('accounts');
    expect(last.col).toBe('name');
    expect(JSON.parse(last.value!)).toBe('Compte joint');
  });

  it('suppression logique', async () => {
    const s = await seeded('A');
    s.remove('envelopes', 'env-divers');
    const l = s.load();
    expect(l.envelopes.find((e) => e.id === 'env-divers')?.deletedAt).toBeTruthy();
    expect(computePlan(l, '2026-09-06').lines.map((x) => x.envelopeId)).not.toContain('env-divers');
  });

  it('chaîne d’empreintes vérifiable', async () => {
    const s = await seeded('A');
    expect(s.verifyChain()).toBeUndefined();
    const first = s.changesSince(0)[0]!;
    expect(first.prevHash).toBe(GENESIS_HASH);
    // Corrompre une valeur en base casse la chaîne à partir de là.
    s.query(`UPDATE changes SET value = '"X"' WHERE seq = 3`);
    expect(s.verifyChain()).toBe(3);
  });

  it('requête SQL libre', async () => {
    const s = await seeded('A');
    const rows = s.query(`SELECT name, kind FROM envelopes WHERE account_id = ? ORDER BY name`, ['acc-livret']);
    expect(rows.map((r) => r['name'])).toEqual(['Assurance auto', 'Taxe foncière', 'Vacances', 'Épargne de précaution']);
  });
});

describe('fusion entre deux appareils', () => {
  it('B rejoue le journal de A et obtient les mêmes tables', async () => {
    const a = await seeded('A');
    const b = await open('B');
    const res = b.applyRemote(a.changesSince(0));
    expect(res.applied).toBeGreaterThan(0);
    expect(computePlan(b.load(), '2026-09-06').totals).toEqual(computePlan(a.load(), '2026-09-06').totals);
    // Rejouer une seconde fois est sans effet.
    expect(b.applyRemote(a.changesSince(0)).applied).toBe(0);
  });

  it('modifications concurrentes de champs différents : les deux survivent', async () => {
    const a = await seeded('A');
    const b = await open('B');
    b.applyRemote(a.changesSince(0));
    const seqA = a.lastSeq;
    const seqB = b.lastSeq;

    const envA = a.load().envelopes.find((e) => e.id === 'env-tf')!;
    a.upsert('envelopes', { ...envA, target: euros(1300) });
    const envB = b.load().envelopes.find((e) => e.id === 'env-tf')!;
    b.upsert('envelopes', { ...envB, name: 'Taxe foncière 2026' });

    b.applyRemote(a.changesSince(seqA));
    a.applyRemote(b.changesSince(seqB));

    const finalA = a.load().envelopes.find((e) => e.id === 'env-tf')!;
    const finalB = b.load().envelopes.find((e) => e.id === 'env-tf')!;
    expect(finalA).toEqual(finalB);
    expect(finalA.target).toBe(euros(1300));
    expect(finalA.name).toBe('Taxe foncière 2026');
  });

  it('même champ modifié des deux côtés : le plus récent gagne, des deux côtés', async () => {
    let t = 1_700_000_000_000;
    const clock = () => (t += 1000);
    const a = await LedgerStore.create({ sqlJs: SQL, siteId: 'A', now: clock });
    const b = await LedgerStore.create({ sqlJs: SQL, siteId: 'B', now: clock });
    const acc = exampleLedger().accounts[0]!;
    a.upsert('accounts', acc);
    b.applyRemote(a.changesSince(0));
    const seqA = a.lastSeq;
    const seqB = b.lastSeq;
    a.upsert('accounts', { ...acc, name: 'Nom de A' });
    b.upsert('accounts', { ...acc, name: 'Nom de B' }); // plus tard sur l'horloge
    a.applyRemote(b.changesSince(seqB));
    b.applyRemote(a.changesSince(seqA));
    expect(a.load().accounts[0]!.name).toBe('Nom de B');
    expect(b.load().accounts[0]!.name).toBe('Nom de B');
  });

  it('refuse un changement dont l’empreinte ne correspond pas', async () => {
    const a = await seeded('A');
    const b = await open('B');
    const [first] = a.changesSince(0);
    expect(() => b.applyRemote([{ ...first!, value: '"trafiqué"' }])).toThrow(/Empreinte/);
  });
});

describe('identifiants', () => {
  it('uuid v7 ordonnés dans le temps', () => {
    const u1 = uuidv7(1000);
    const u2 = uuidv7(2000);
    expect(u1 < u2).toBe(true);
    expect(u1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('normalisation des libellés', () => {
    expect(normalizeLabel('CARTE X2009 02/09 SUPERMARCHE LYON')).toBe('SUPERMARCHE LYON');
    expect(normalizeLabel('Prélèvement européen 6303920409 DE: EAU DU VILLAGE')).toBe('PRELEVEMENT EUROPEEN DE EAU DU VILLAGE');
    expect(normalizeLabel('VIR RECU    6584639237S DE: DUPONT')).toBe('VIR RECU DE DUPONT');
    expect(normalizeLabel('VIR PERM TIRELIRE TAXE FONCIERE')).toBe('VIR PERM TIRELIRE TAXE FONCIERE');
  });

  it('clé d’opération déterministe', () => {
    const k1 = operationKey('acc', '2026-09-04', -7600, 'PRELEVEMENT EUROPEEN DE EAU DU VILLAGE', 0);
    const k2 = operationKey('acc', '2026-09-04', -7600, 'PRELEVEMENT EUROPEEN DE EAU DU VILLAGE', 0);
    const k3 = operationKey('acc', '2026-09-04', -7600, 'PRELEVEMENT EUROPEEN DE EAU DU VILLAGE', 1);
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1).toMatch(/^op_[0-9a-f]{32}$/);
  });
});
