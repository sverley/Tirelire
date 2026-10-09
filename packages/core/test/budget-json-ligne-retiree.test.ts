/**
 * Tests du codeur de #409 — « Le budget JSON porte un ordre enregistré qui désigne une tirelire ou un
 * compte retirés » : côté cœur, l'écriture (point 1), la relecture (point 2), la lecture (point 3), la
 * différence et l'application (point 4), le projet après la validation (point 6), rien d'autre (point
 * 7) et la version 5 (point 8).
 *
 * Sur le jeu d'exemple : l'ordre « Virement Livret A » (600 €), du compte principal vers le Livret A,
 * a trois parts fixes — Taxe foncière, Assurance auto, Vacances — et la part variable d'Épargne de
 * précaution, toutes placées sur le Livret A.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import {
  appliquerBudget,
  BUDGET_JSON_FORMAT,
  computePlan,
  differenceBudget,
  differenceVide,
  ecrireBudgetJson,
  etatDuProjet,
  etatLuDuProjet,
  exampleLedger,
  importerBudgetJson,
  LedgerStore,
  lireBudgetJson,
  type Ledger,
} from '../src/index.js';

const SQL = await initSqlJs();
const LECTURE = '2026-09-06';
const RETIRE = '2026-09-02T10:00:00.000Z';
const ORDRE = 'flow-vir-livret';

/** L'exemple, sans ses opérations, `retirer` appliqué : des lignes retirées, avec leur date de suppression ; une tirelire retirée l'est avec ses besoins. */
function exemple(retirer: { tirelires?: string[]; comptes?: string[]; categories?: string[] } = {}): Ledger {
  const l: Ledger = { ...exampleLedger(), operations: [], subOperations: [], shortfallAnswers: [] };
  l.tirelires = l.tirelires.map((t) => (retirer.tirelires?.includes(t.id) ? { ...t, deletedAt: RETIRE } : t));
  l.needs = l.needs.map((n) => (retirer.tirelires?.includes(n.tirelireId) ? { ...n, deletedAt: RETIRE } : n));
  l.accounts = l.accounts.map((a) => (retirer.comptes?.includes(a.id) ? { ...a, deletedAt: RETIRE } : a));
  l.categories = l.categories.map((c) => (retirer.categories?.includes(c.id) ? { ...c, deletedAt: RETIRE } : c));
  return l;
}

/** Un projet tenu par un dépôt, avec les lignes du budget de `l`, retirées comprises. */
async function depot(l: Ledger): Promise<LedgerStore> {
  const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
  for (const k of ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows'] as const) for (const r of l[k]) s.upsert(k, r as never);
  for (const [k, v] of Object.entries(l.settings)) if (k !== 'siteId') s.setSetting(k as never, v as never);
  return s;
}

const lignes = (j: Record<string, unknown>, table: string) => (j[table] as Array<Record<string, unknown>> | undefined) ?? [];
const ids = (j: Record<string, unknown>, table: string) => lignes(j, table).map((l) => l['id']);
const retirees = (j: Record<string, unknown>, table: string) => lignes(j, table).filter((l) => 'deleted_at' in l).map((l) => l['id']);

describe('[niveau 4] #409 · 1 — le fichier écrit porte la ligne retirée désignée', () => {
  it('une tirelire retirée qu’une part de l’ordre désigne s’écrit entière, avec sa date de suppression ; une autre retirée, non', () => {
    // Santé, retirée, n'est plus désignée par rien de vivant : son besoin est retiré, sa catégorie n'a plus de tirelire par défaut.
    const l = exemple({ tirelires: ['env-auto', 'env-sante'] });
    l.needs = l.needs.map((n) => (n.tirelireId === 'env-sante' ? { ...n, deletedAt: RETIRE } : n));
    l.categories = l.categories.map(({ tirelireId, ...c }) => (c.id === 'cat-sante' ? c : { ...c, ...(tirelireId ? { tirelireId } : {}) }));
    const j = ecrireBudgetJson(l);
    expect(retirees(j, 'tirelires')).toEqual(['env-auto']);
    const auto = lignes(j, 'tirelires').find((t) => t['id'] === 'env-auto')!;
    expect(auto).toMatchObject({ name: 'Assurance auto', opening_balance: 30000, deleted_at: RETIRE });
    expect(ids(j, 'tirelires')).not.toContain('env-sante');
  });

  it('un compte retiré vers lequel va l’ordre s’écrit ; de proche en proche, la tirelire retirée placée sur lui aussi', () => {
    // L'ordre désigne le Livret A ; Taxe foncière, retirée et désignée par une part, est placée sur lui ; la catégorie retirée
    // qu'aucune ligne portée ne désigne n'y est pas.
    const l = exemple({ comptes: ['acc-livret'], tirelires: ['env-tf'], categories: ['cat-transfert'] });
    const j = ecrireBudgetJson(l);
    expect(retirees(j, 'accounts')).toEqual(['acc-livret']);
    expect(retirees(j, 'tirelires')).toEqual(['env-tf']);
    expect(retirees(j, 'categories')).toEqual([]);
    expect(ids(j, 'categories')).not.toContain('cat-transfert');
  });

  it('de proche en proche : une ligne retirée qu’une seule ligne retirée portée désigne est portée', () => {
    // Le Livret jeune, retiré, n'est désigné que par Vacances, retirée, que l'ordre désigne.
    const l = exemple({ tirelires: ['env-vac'], comptes: ['acc-livret-jeune'] });
    l.tirelires = l.tirelires.map((t) => (t.id === 'env-vac' ? { ...t, placement: [{ accountId: 'acc-livret-jeune', share: { kind: 'variable' } }] } : t));
    const j = ecrireBudgetJson(l);
    expect(retirees(j, 'accounts')).toEqual(['acc-livret-jeune']);
    expect(retirees(j, 'tirelires')).toEqual(['env-vac']);
  });

  it('une table que le fichier ne définit pas n’y gagne aucune ligne', () => {
    const l = exemple({ tirelires: ['env-auto'], comptes: ['acc-livret'] });
    const j = ecrireBudgetJson(l, ['plannedFlows']);
    expect(Object.keys(j).sort()).toEqual(['format', 'planned_flows', 'version']);
  });

  it('une ligne retirée que seule une ligne retirée non portée désigne ne s’écrit pas', () => {
    // Le besoin de Taxe foncière désigne la tirelire ; le besoin retiré ne la fait pas porter si rien de vivant ne la désigne.
    const l = exemple({ tirelires: ['env-tf'] });
    l.needs = l.needs.map((n) => (n.tirelireId === 'env-tf' ? { ...n, deletedAt: RETIRE } : n));
    l.plannedFlows = l.plannedFlows.filter((f) => f.id !== ORDRE && f.id !== 'flow-tf');
    const j = ecrireBudgetJson(l);
    expect(retirees(j, 'tirelires')).toEqual([]);
    expect(retirees(j, 'needs')).toEqual([]);
  });
});

describe('[niveau 4] #409 · 2 — il se relit', () => {
  it('relire redonne les mêmes lignes, colonne pour colonne, retirées comprises', () => {
    const l = exemple({ tirelires: ['env-auto', 'env-tf'], comptes: ['acc-livret'] });
    const j = ecrireBudgetJson(l);
    const lu = lireBudgetJson(JSON.stringify(j));
    if (!lu.ok) throw new Error(lu.message);
    expect(lu.budget).toEqual(etatDuProjet(l));
    expect(lu.budget.tables.tirelires!.find((t) => t.id === 'env-auto')!.v['deleted_at']).toBe(RETIRE);
  });

  it('le projet issu d’un retrait à l’écran (dépôt) s’écrit et se relit', async () => {
    const s = await depot(exemple());
    s.remove('tirelires', 'env-vac');
    s.remove('accounts', 'acc-enfants');
    const j = ecrireBudgetJson(s.load());
    const lu = lireBudgetJson(JSON.stringify(j));
    if (!lu.ok) throw new Error(lu.message);
    expect(lu.budget).toEqual(etatDuProjet(s.load()));
    expect(retirees(j, 'tirelires')).toContain('env-vac');
  });
});

describe('[niveau 4] #409 · 3 — ce que la lecture accepte et refuse', () => {
  const v5 = (parties: Record<string, unknown>) => ({ format: BUDGET_JSON_FORMAT, version: 5, ...parties });
  const compte = { id: 'acc-x', name: 'X', kind: 'courant', opening_balance: 0, opening_date: '2026-01-01' };
  const tirelire = { id: 'env-x', name: 'T', placement: [], opening_balance: 0, opening_date: '2026-01-01' };

  it('deleted_at s’accepte sur une ligne de chacune des cinq tables', () => {
    const lu = lireBudgetJson(
      v5({
        accounts: [{ ...compte, deleted_at: RETIRE }],
        tirelires: [{ ...tirelire, deleted_at: RETIRE }],
        needs: [{ id: 'need-x', tirelire_id: 'env-x', kind: 'recurring', priority: 1, deleted_at: RETIRE }],
        categories: [{ id: 'cat-x', name: 'C', nature: 'expense', tirelire_id: 'env-x', deleted_at: RETIRE }],
        planned_flows: [
          {
            id: 'flow-x',
            name: 'F',
            kind: 'transfer',
            amount: -100,
            account_id: 'acc-principal',
            counterpart_account_id: 'acc-x',
            periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' },
            date_window_days: 3,
            deleted_at: RETIRE,
          },
        ],
      }),
    );
    if (!lu.ok) throw new Error(lu.message);
    for (const k of ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows'] as const) expect(lu.budget.tables[k]![0]!.v['deleted_at']).toBe(RETIRE);
  });

  it('une ligne vivante peut désigner une ligne retirée du fichier', () => {
    const lu = lireBudgetJson(v5({ tirelires: [{ ...tirelire, deleted_at: RETIRE }], needs: [{ id: 'need-x', tirelire_id: 'env-x', kind: 'recurring', priority: 1 }] }));
    expect(lu.ok).toBe(true);
  });

  it('une ligne retirée se vérifie comme une vivante : ses références désignent une ligne du fichier', () => {
    const lu = lireBudgetJson(v5({ tirelires: [], needs: [{ id: 'need-x', tirelire_id: 'env-absente', kind: 'recurring', priority: 1, deleted_at: RETIRE }] }));
    expect(lu.ok).toBe(false);
    if (!lu.ok) expect(lu.problemes[0]).toMatchObject({ table: 'needs', id: 'need-x', colonne: 'tirelire_id' });
    const valeur = lireBudgetJson(v5({ tirelires: [{ ...tirelire, opening_balance: 'beaucoup', deleted_at: RETIRE }] }));
    expect(valeur.ok).toBe(false);
  });

  it('un deleted_at qui n’est pas un horodatage est refusé, en nommant la ligne et la colonne', () => {
    for (const mauvais of ['2026-09-02', '2026-09-02 10:00:00', 12, true]) {
      const lu = lireBudgetJson(v5({ tirelires: [{ ...tirelire, deleted_at: mauvais }] }));
      expect(lu.ok).toBe(false);
      if (!lu.ok) expect(lu.problemes[0]).toMatchObject({ table: 'tirelires', id: 'env-x', colonne: 'deleted_at' });
    }
  });

  it('le compte principal retiré est refusé, en nommant la ligne et la colonne', () => {
    const lu = lireBudgetJson(v5({ accounts: [{ id: 'acc-principal', name: 'P', kind: 'principal', opening_balance: 0, opening_date: '2026-01-01', deleted_at: RETIRE }] }));
    expect(lu.ok).toBe(false);
    if (!lu.ok) expect(lu.problemes[0]).toMatchObject({ table: 'accounts', colonne: 'deleted_at' });
  });
});

describe('[niveau 4] #409 · 4 — la différence et l’application', () => {
  it('une ligne retirée du fichier que le projet porte vivante est un retrait, comme si le fichier ne la nommait pas', async () => {
    const fichier = ecrireBudgetJson(exemple({ tirelires: ['env-auto'] }));
    const s = await depot(exemple());
    const r = importerBudgetJson(fichier, s.load());
    if (!r.ok) throw new Error(r.message);
    expect(r.difference.tables.tirelires!.retraits.map((t) => t.id)).toEqual(['env-auto']);
    expect(r.difference.tables.tirelires!.entreesRetirees).toEqual([]);
    expect(r.application.retraits).toEqual([{ cle: 'tirelires', id: 'env-auto' }, { cle: 'needs', id: 'need-auto' }]);
    expect(r.application.ecritures).toEqual([]);
    appliquerBudget(s, r.application);
    expect(s.load().tirelires.find((t) => t.id === 'env-auto')!.deletedAt).toBeTruthy();
    expect(s.load().plannedFlows.find((f) => f.id === ORDRE)).toEqual(exemple().plannedFlows.find((f) => f.id === ORDRE));
  });

  it('une ligne retirée du fichier que le projet porte déjà retirée ne fait aucune différence, quelles que soient ses colonnes', async () => {
    const s = await depot(exemple({ tirelires: ['env-auto'] }));
    const fichier = ecrireBudgetJson(exemple({ tirelires: ['env-auto'] }));
    const auto = lignes(fichier, 'tirelires').find((t) => t['id'] === 'env-auto')!;
    auto['name'] = 'Autre nom';
    auto['deleted_at'] = '2025-01-01T00:00:00.000Z';
    const r = importerBudgetJson(fichier, s.load());
    if (!r.ok) throw new Error(r.message);
    expect(differenceVide(r.difference)).toBe(true);
    expect(r.application.ecritures).toEqual([]);
  });

  it('une ligne absente du fichier que le projet porte retirée ne fait aucune différence', async () => {
    const s = await depot(exemple({ categories: ['cat-transfert'] }));
    const r = importerBudgetJson(ecrireBudgetJson(exemple()), s.load());
    if (!r.ok) throw new Error(r.message);
    // Le fichier de l'exemple porte cat-transfert vivante : un ajout, comme aujourd'hui ; sans elle, rien.
    expect(r.difference.tables.categories!.ajouts.map((c) => c.id)).toEqual(['cat-transfert']);
    const sans = ecrireBudgetJson(exemple({ categories: ['cat-transfert'] }));
    expect(ids(sans, 'categories')).not.toContain('cat-transfert');
    const r2 = importerBudgetJson(sans, s.load());
    if (!r2.ok) throw new Error(r2.message);
    expect(differenceVide(r2.difference)).toBe(true);
  });

  it('une ligne retirée que le projet ne porte pas entre retirée, entière, avec sa date de suppression ; ce n’est pas un ajout', async () => {
    const s = await depot(exemple());
    const l = exemple({ tirelires: ['env-auto'] });
    l.tirelires = l.tirelires.map((t) => (t.id === 'env-auto' ? { ...t, id: 'env-auto-ancienne' } : t));
    l.needs = l.needs.map((n) => (n.tirelireId === 'env-auto' ? { ...n, id: 'need-auto-ancien', tirelireId: 'env-auto-ancienne' } : n));
    l.plannedFlows = l.plannedFlows.map((f) =>
      f.id === ORDRE ? { ...f, action: { allocation: f.action!.allocation!.map((p) => (p.tirelireId === 'env-auto' ? { ...p, tirelireId: 'env-auto-ancienne' } : p)) } } : f,
    );
    const r = importerBudgetJson(ecrireBudgetJson(l), s.load());
    if (!r.ok) throw new Error(r.message);
    const d = r.difference.tables.tirelires!;
    expect(d.entreesRetirees.map((t) => [t.id, t['deletedAt']])).toEqual([['env-auto-ancienne', RETIRE]]);
    expect(d.ajouts).toEqual([]);
    expect(d.retraits.map((t) => t.id)).toEqual(['env-auto']);
    appliquerBudget(s, r.application);
    expect(s.load().tirelires.find((t) => t.id === 'env-auto-ancienne')).toMatchObject({ name: 'Assurance auto', deletedAt: RETIRE });
  });

  it('l’état lu porte toutes les lignes du projet, retirées comprises ; l’état écrit, les seules désignées', () => {
    const l = exemple({ tirelires: ['env-auto', 'env-sante'] });
    l.categories = l.categories.filter((c) => c.id !== 'cat-sante');
    expect(etatLuDuProjet(l, ['tirelires']).tables.tirelires!.map((t) => t.id)).toContain('env-sante');
    expect(etatDuProjet(l, ['tirelires']).tables.tirelires!.map((t) => t.id)).not.toContain('env-auto'); // l'ordre n'est pas dans ces parties
    expect(etatDuProjet(l, ['tirelires', 'plannedFlows']).tables.tirelires!.map((t) => t.id)).toContain('env-auto');
  });
});

describe('[niveau 4] #409 · 6 — après la validation', () => {
  it('sur un projet qui ne portait ni la tirelire ni le compte retirés ni l’ordre : le projet tel que le fichier le dit, et le plan le signale', async () => {
    const source = exemple({ tirelires: ['env-auto'], comptes: ['acc-enfants'] });
    // Un second ordre, vers la Carte enfants retirée.
    source.plannedFlows.push({ ...source.plannedFlows.find((f) => f.id === ORDRE)!, id: 'flow-vir-enfants', name: 'Virement enfants', counterpartAccountId: 'acc-enfants', amount: -10000, action: {} });
    const fichier = ecrireBudgetJson(source);
    const vierge = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
    const r = importerBudgetJson(fichier, vierge.load());
    if (!r.ok) throw new Error(r.message);
    expect(r.difference.tables.tirelires!.entreesRetirees.map((t) => t.id)).toEqual(['env-auto']);
    expect(r.difference.tables.accounts!.entreesRetirees.map((t) => t.id)).toEqual(['acc-enfants']);
    appliquerBudget(vierge, r.application);
    const apres = vierge.load();
    expect(apres.tirelires.find((t) => t.id === 'env-auto')!.deletedAt).toBe(RETIRE);
    expect(apres.accounts.find((a) => a.id === 'acc-enfants')!.deletedAt).toBe(RETIRE);
    expect(apres.plannedFlows.find((f) => f.id === ORDRE)!.action).toEqual(source.plannedFlows.find((f) => f.id === ORDRE)!.action);
    // Réécrit, le projet redonne les lignes du fichier importé, retirées comprises.
    const parId = (j: Record<string, unknown>, t: string) => [...lignes(j, t)].sort((a, b) => String(a['id']).localeCompare(String(b['id'])));
    for (const t of ['accounts', 'tirelires', 'needs', 'categories', 'planned_flows']) expect(parId(ecrireBudgetJson(apres), t)).toEqual(parId(fichier, t));

    const plan = computePlan(apres, LECTURE);
    const part = plan.transfers.find((t) => t.accountId === 'acc-livret')!.bankOrder!.parts.find((p) => p.tirelireId === 'env-auto');
    expect(part).toMatchObject({ retired: true, signaled: true });
    expect(plan.warnings.some((w) => w.code === 'bankOrderPartDrift' && w.tirelireId === 'env-auto')).toBe(true);
    expect(plan.transfers.find((t) => t.accountId === 'acc-enfants')).toMatchObject({ accountRetired: true, permanent: 0, bankOrder: { flowId: 'flow-vir-enfants', signaled: true } });
  });
});

describe('[niveau 4] #409 · 7 et 8 — rien d’autre ne change ; la version 5', () => {
  it('un projet sans ligne retirée désignée s’écrit sans deleted_at, en version 5', () => {
    const j = ecrireBudgetJson(exemple({ categories: ['cat-transfert'] }));
    expect(j['version']).toBe(5);
    for (const t of ['accounts', 'tirelires', 'needs', 'categories', 'planned_flows']) expect(retirees(j, t)).toEqual([]);
  });

  it('la version 4 est refusée en le disant, sans rien lire', () => {
    const j = { ...ecrireBudgetJson(exemple()), version: 4 };
    const lu = lireBudgetJson(j);
    expect(lu.ok).toBe(false);
    if (!lu.ok) expect(lu.message).toMatch(/version vaut 4.*version 5/);
  });
});
