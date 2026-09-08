import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { changeHash, computePlan, exampleLedger, GENESIS_HASH, LedgerStore, MODEL_VERSION, euros, migrateModel, normalizeLabel, operationKey, uuidv7 } from '../src/index.js';

const SQL = await initSqlJs();

async function open(site: string, bytes?: Uint8Array) {
  return LedgerStore.create({ sqlJs: SQL, siteId: site, ...(bytes ? { bytes } : {}) });
}

/**
 * Dépôt écrit par un pair resté au modèle 1 : les colonnes dépréciées n'étant plus écrites par
 * `upsert`, on rejoue un journal de changements ancien, ce qui est exactement ce qui arrive
 * quand un appareil non migré se synchronise (D30).
 */
async function storeAtModel1(cells: Array<[string, string, string, unknown]>) {
  const store = await open('mig');
  let prevHash = GENESIS_HASH;
  const entries = cells.map(([tbl, rowId, col, value], i) => {
    const hlc = `${String(1757200000000 + i).padStart(13, '0')}:0000:vieux`;
    const v = value === undefined ? null : JSON.stringify(value);
    const hash = changeHash(prevHash, hlc, 'vieux', tbl, rowId, col, v);
    const e = { seq: i + 1, hlc, site: 'vieux', tbl, rowId, col, value: v, prevHash, hash };
    prevHash = hash;
    return e;
  });
  store.applyRemote(entries);
  store.setModelVersion(1);
  return store;
}

async function seeded(site: string) {
  const s = await open(site);
  const l = exampleLedger();
  for (const a of l.accounts) s.upsert('accounts', a);
  for (const e of l.envelopes) s.upsert('envelopes', e);
  for (const n of l.needs) s.upsert('needs', n);
  for (const c of l.categories) s.upsert('categories', c);
  for (const f of l.plannedFlows) s.upsert('plannedFlows', f);
  for (const o of l.operations) s.upsert('operations', o);
  for (const a of l.allocations) s.upsert('allocations', a);
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
    expect(loaded.settings.pivotCushion).toBe(exampleLedger().settings.pivotCushion);
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
    const rows = s.query(`SELECT name FROM envelopes WHERE placement LIKE ? ORDER BY name`, ['%acc-livret%']);
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
    a.upsert('envelopes', { ...envA, openingBalance: euros(950) });
    const envB = b.load().envelopes.find((e) => e.id === 'env-tf')!;
    b.upsert('envelopes', { ...envB, name: 'Taxe foncière 2026' });

    b.applyRemote(a.changesSince(seqA));
    a.applyRemote(b.changesSince(seqB));

    const finalA = a.load().envelopes.find((e) => e.id === 'env-tf')!;
    const finalB = b.load().envelopes.find((e) => e.id === 'env-tf')!;
    expect(finalA).toEqual(finalB);
    expect(finalA.openingBalance).toBe(euros(950));
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

describe('migration du modèle (D30)', () => {
  it('1 → 2 : une enveloppe typée devient une enveloppe placée plus un besoin (D19, D28)', async () => {
    const store = await storeAtModel1([
      ['envelopes', 'env_tf', 'name', 'Taxe foncière'],
      ['envelopes', 'env_tf', 'kind', 'provision'],
      ['envelopes', 'env_tf', 'account_id', 'acc_livret'],
      ['envelopes', 'env_tf', 'opening_balance', 0],
      ['envelopes', 'env_tf', 'opening_date', '2026-01-01'],
      ['envelopes', 'env_tf', 'target', 120000],
      ['envelopes', 'env_tf', 'periodicity', { intervalMonths: 12, anchorDate: '2026-10-15' }],
      ['envelopes', 'env_tf', 'priority', 10],
    ]);

    const report = migrateModel(store);
    expect(report.from).toBe(1);
    expect(store.modelVersion).toBe(MODEL_VERSION);

    const l = store.load();
    const env = l.envelopes.find((e) => e.id === 'env_tf')!;
    expect(env.placement).toEqual([{ accountId: 'acc_livret', share: { kind: 'variable' } }]);
    expect('kind' in env).toBe(false);
    const need = l.needs.find((n) => n.envelopeId === 'env_tf')!;
    expect(need.kind).toBe('dueDate');
    expect(need.amount).toBe(120000);
    expect(need.priority).toBe(10);
    expect(need.periodicity?.anchorDate).toBe('2026-10-15');
  });

  it('la migration est idempotente et journalisée', async () => {
    const store = await storeAtModel1([
      ['envelopes', 'env_courses', 'name', 'Courses'],
      ['envelopes', 'env_courses', 'kind', 'budget'],
      ['envelopes', 'env_courses', 'account_id', 'acc_pivot'],
      ['envelopes', 'env_courses', 'opening_balance', 0],
      ['envelopes', 'env_courses', 'opening_date', '2026-01-01'],
      ['envelopes', 'env_courses', 'target', 60000],
      ['envelopes', 'env_courses', 'periodicity', { intervalMonths: 1, anchorDate: '2026-01-01' }],
      ['envelopes', 'env_courses', 'priority', 20],
    ]);

    migrateModel(store);
    const after = store.load();
    const before = store.changesSince(0, 'mig').length;
    // Une seconde migration ne réécrit rien : la version est à jour.
    const second = migrateModel(store);
    expect(second.steps).toEqual([]);
    expect(store.changesSince(0, 'mig').length).toBe(before);
    expect(store.load().needs).toEqual(after.needs);
    // Le report d'un budget sans report explicite reste « libéré » (D05).
    expect(after.envelopes[0]!.rollover).toEqual({ mode: 'none' });
    // Les écritures de migration sont dans le journal, donc synchronisables.
    expect(store.changesSince(0, 'mig').some((c) => c.tbl === 'needs')).toBe(true);
  });
});
