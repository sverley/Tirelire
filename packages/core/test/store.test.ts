import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { computePlan, emptyLedger, exampleLedger, LEDGER_KEYS, LedgerStore, normalizeLabel, operationKey, uuidv7 } from '../src/index.js';

const SQL = await initSqlJs();

async function open(site: string, bytes?: Uint8Array) {
  return LedgerStore.create({ sqlJs: SQL, siteId: site, ...(bytes ? { bytes } : {}) });
}

async function seeded(site: string) {
  const s = await open(site);
  const l = exampleLedger();
  for (const a of l.accounts) s.upsert('accounts', a);
  for (const e of l.tirelires) s.upsert('tirelires', e);
  for (const n of l.needs) s.upsert('needs', n);
  for (const c of l.categories) s.upsert('categories', c);
  for (const f of l.plannedFlows) s.upsert('plannedFlows', f);
  for (const o of l.operations) s.upsert('operations', o);
  for (const a of l.allocations) s.upsert('allocations', a);
  s.setSetting('principalCushion', l.settings.principalCushion);
  return s;
}

describe('[niveau 0] harnais du registre', () => {
  describe('dépôt SQLite', () => {
    it('LEDGER_KEYS couvre toutes les tables du grand livre', () => {
      // Écrire un grand livre table par table, à la main, se paie : la fonction qui charge l'exemple
      // dans l'application avait oublié `needs`, donc chargeait des tirelires sans aucun besoin. Tout
      // ce qui parcourt les tables passe désormais par cette liste, et ce test la garde complète.
      const tables = Object.entries(emptyLedger())
        .filter(([, v]) => Array.isArray(v))
        .map(([k]) => k);
      expect([...LEDGER_KEYS].sort()).toEqual(tables.sort());
    });

    it('écrit, relit, et le plan est identique à celui calculé en mémoire', async () => {
      const s = await seeded('A');
      const loaded = s.load();
      const fromMemory = computePlan(exampleLedger(), '2026-09-06');
      const fromStore = computePlan(loaded, '2026-09-06');
      expect(fromStore.totals).toEqual(fromMemory.totals);
      expect(fromStore.transfers).toEqual(fromMemory.transfers);
      expect(loaded.settings.principalCushion).toBe(exampleLedger().settings.principalCushion);
      expect(loaded.settings.siteId).toBe('A');
    });

    it('survit à un export / réouverture', async () => {
      const s = await seeded('A');
      const bytes = s.export();
      const again = await open('A', bytes);
      expect(again.load().tirelires.length).toBe(exampleLedger().tirelires.length);
      expect(again.load()).toEqual(s.load());
    });

    it('une écriture date la ligne entière, et rien ne se date si rien ne change', async () => {
      const s = await open('A');
      const acc = exampleLedger().accounts[0]!;
      s.upsert('accounts', acc);
      const horloge = () => s.query(`SELECT hlc FROM accounts WHERE id = ?`, [acc.id])[0]!['hlc'] as string;
      const avant = horloge();
      expect(avant).toMatch(/:A$/);
      s.upsert('accounts', acc); // identique : rien
      expect(horloge()).toBe(avant);
      s.upsert('accounts', { ...acc, name: 'Compte joint' });
      expect(horloge() > avant).toBe(true);
      expect(s.query(`SELECT name FROM sqlite_master WHERE name IN ('changes', 'cell_versions')`)).toEqual([]);
    });

    it('suppression logique', async () => {
      const s = await seeded('A');
      s.remove('tirelires', 'env-divers');
      const l = s.load();
      expect(l.tirelires.find((e) => e.id === 'env-divers')?.deletedAt).toBeTruthy();
      expect(computePlan(l, '2026-09-06').lines.map((x) => x.tirelireId)).not.toContain('env-divers');
    });

    it('requête SQL libre', async () => {
      const s = await seeded('A');
      const rows = s.query(`SELECT name FROM envelopes WHERE placement LIKE ? ORDER BY name`, ['%acc-livret%']);
      expect(rows.map((r) => r['name'])).toEqual(['Assurance auto', 'Taxe foncière', 'Vacances', 'Épargne de précaution']);
    });
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Témoin rouge du harnais C5 (docs/gardes.md) : les assertions de l'export, rejouées sur une
// version volontairement cassée du besoin.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('[niveau 0] harnais du registre', () => {
  it.fails('témoin rouge · une sauvegarde qui rejoue les tables et en oublie une', async () => {
    const s = await seeded('A');
    // Version cassée : au lieu du fichier exporté, la sauvegarde réécrit les tables une à une — et
    // en oublie une, exactement comme la fonction qui chargeait l'exemple sans ses besoins.
    const copie = await open('A');
    const l = s.load();
    for (const a of l.accounts) copie.upsert('accounts', a);
    for (const n of l.needs) copie.upsert('needs', n);

    expect(copie.load().tirelires.length).toBe(exampleLedger().tirelires.length);
    expect(copie.load()).toEqual(s.load());
  });
});
