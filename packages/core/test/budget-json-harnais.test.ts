/**
 * Harnais d'audit de #366 — le budget JSON, sa lecture tout ou rien par le cœur, sa documentation.
 *
 * Composé après le codage (auditeur.md, étape 2) : les tests du codeur, tous retenus, repris de
 * `budget-json.test.ts`, qui n'a plus lieu d'être ; chaque `describe` reprend un point du « Fait
 * quand » sous son numéro. Sont de moi : l'import n'écrit rien d'un budget refusé, par la voie
 * qu'emprunte l'application (lire, puis écrire si la lecture passe) ; une ligne du projet absente du
 * JSON reste après l'import, toutes tables ; un identifiant du compte principal du JSON repris par
 * une ligne d'une autre table (l'identifiant n'est unique que dans sa table, point 3). Le point 8, la
 * décision, est relu.
 *
 * Niveaux (D83), par le besoin couvert :
 * - 0 · l'irréparable : rien d'un budget refusé n'est retenu (point 4) ; une ligne du projet absente
 *   du JSON reste (point 5) — sinon le projet de l'utilisateur serait altéré ou amputé.
 * - 2 · un cas est faux : le contenu, le format, les références, chaque refus, le réimport, la
 *   documentation et l'exemple.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import {
  BUDGET_JSON_FORMAT,
  BUDGET_JSON_VERSION,
  COLONNES_BUDGET_JSON,
  computePlan,
  dueDateShortfalls,
  ecrireBudget,
  emptyLedger,
  exampleLedger,
  LedgerStore,
  lireBudgetJson,
  MAIN_ACCOUNT_ID,
  periodReadingDate,
  periodsAround,
  shortfallsForPeriod,
  type Ledger,
} from '../src/index.js';

const SQL = await initSqlJs();
const DOC = readFileSync(new URL('../../../docs/format-budget-json.md', import.meta.url), 'utf8');

/** L'exemple complet de la documentation : le seul bloc ```json qui porte le format. */
function exempleDeLaDoc(): Record<string, unknown> {
  const blocs = [...DOC.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const complet = blocs.find((b) => b.includes(`"format": "${BUDGET_JSON_FORMAT}"`) && b.includes('"planned_flows"'));
  return JSON.parse(complet!);
}

const copie = () => structuredClone(exempleDeLaDoc());

async function importer(json: unknown, store?: LedgerStore): Promise<LedgerStore> {
  const s = store ?? (await LedgerStore.create({ sqlJs: SQL, siteId: 'test' }));
  const lu = lireBudgetJson(json, s.load());
  if (!lu.ok) throw new Error(lu.message);
  ecrireBudget(s, lu.budget);
  return s;
}

/** Ce que dit le Plan de la période en cours et des douze suivantes, comme le critère de #324. */
function lirePlans(l: Ledger, jour: string) {
  return periodsAround(l, jour, 0, 12).map((p) => {
    const plan = computePlan(l, periodReadingDate(p, jour), jour);
    return {
      periode: [p.start, p.end],
      totaux: plan.totals,
      lignes: plan.lines.map((x) => ({ nom: x.name, genre: x.kind, demande: x.requested, couvert: x.funded, statut: x.status })),
      virements: plan.transfers.map((x) => ({ compte: x.accountName, permanent: x.permanent, reguliers: x.standing, net: x.net, ordre: x.bankOrder ? { montant: x.bankOrder.amount, ecart: x.bankOrder.drift } : null })),
      annonces: plan.warnings.map((w) => [w.code, w.message]),
      manques: shortfallsForPeriod(dueDateShortfalls(l, jour), plan.period, jour).map((m) => ({ nom: m.name, date: m.dueDate, manque: m.amount, propose: (m.proposal ?? []).map((q) => [q.date, q.amount]) })),
    };
  });
}

describe('[niveau 2] #366 · 7 — l’exemple de la documentation, lu sur un projet vierge, donne le plan de l’exemple privé de ses opérations', () => {
  it('au centime, au 6 septembre 2026, sur la période en cours et les douze suivantes', async () => {
    const projet = (await importer(exempleDeLaDoc())).load();
    const ref = exampleLedger();
    ref.operations = [];
    ref.subOperations = [];
    ref.shortfallAnswers = [];
    expect(lirePlans(projet, '2026-09-06')).toEqual(lirePlans(ref, '2026-09-06'));
  });
});

describe('[niveau 2] #366 · 1 — le contenu : le budget sans les opérations', () => {
  it('les tables acceptées sont celles du budget, et les réglages ceux du format', () => {
    expect(Object.keys(COLONNES_BUDGET_JSON).sort()).toEqual(['accounts', 'categories', 'needs', 'planned_flows', 'settings', 'tirelires']);
    expect(COLONNES_BUDGET_JSON['settings']!.sort()).toEqual(['orderRounding', 'periodStartDay', 'principalCushion', 'transferThreshold']);
  });
  it.each(['operations', 'sub_operations', 'shortfall_answers', 'automations', 'import_profiles', 'devices'])('la table %s est refusée', (t) => {
    const j = copie();
    j[t] = [];
    const lu = lireBudgetJson(j, emptyLedger());
    expect(lu.ok).toBe(false);
  });
  it('siteId est refusé : il décrit l’instance', () => {
    const j = copie();
    (j['settings'] as Record<string, unknown>)['siteId'] = 'x';
    expect(lireBudgetJson(j, emptyLedger()).ok).toBe(false);
  });
  it('l’ordre permanent enregistré se reprend avec son montant', async () => {
    const l = (await importer(exempleDeLaDoc())).load();
    const f = l.plannedFlows.find((x) => x.id === 'flow-vir-livret')!;
    expect(f.origin).toBe('derived');
    expect(f.amount).toBe(-60000);
  });
});

describe('[niveau 2] #366 · 2 — le format se dit', () => {
  it('une autre version est refusée en le disant', () => {
    const j = copie();
    j['version'] = BUDGET_JSON_VERSION + 1;
    const lu = lireBudgetJson(j, emptyLedger());
    expect(lu.ok).toBe(false);
    if (!lu.ok) expect(lu.message).toMatch(/version/);
  });
  it('un autre format est refusé', () => {
    const j = copie();
    j['format'] = 'tirelire';
    expect(lireBudgetJson(j, emptyLedger()).ok).toBe(false);
    expect(lireBudgetJson('pas du json', emptyLedger()).ok).toBe(false);
  });
});

describe('[niveau 2] #366 · 3 — les références', () => {
  it('le compte principal du JSON renseigne celui du projet, et ce qui le désigne le désigne', async () => {
    const j = copie();
    const comptes = j['accounts'] as Array<Record<string, unknown>>;
    comptes.find((a) => a['kind'] === 'principal')!['id'] = 'mon-courant';
    for (const f of j['planned_flows'] as Array<Record<string, unknown>>) if (f['account_id'] === MAIN_ACCOUNT_ID) f['account_id'] = 'mon-courant';
    for (const t of j['tirelires'] as Array<Record<string, unknown>>)
      for (const p of t['placement'] as Array<Record<string, unknown>>) if (p['accountId'] === MAIN_ACCOUNT_ID) p['accountId'] = 'mon-courant';
    const l = (await importer(j)).load();
    expect(l.accounts.filter((a) => a.kind === 'principal').map((a) => [a.id, a.name])).toEqual([[MAIN_ACCOUNT_ID, 'Compte courant']]);
    expect(l.accounts.some((a) => a.id === 'mon-courant')).toBe(false);
    expect(l.plannedFlows.find((f) => f.id === 'flow-salaire')!.accountId).toBe(MAIN_ACCOUNT_ID);
    expect(l.tirelires.find((t) => t.id === 'env-alim')!.placement[0]!.accountId).toBe(MAIN_ACCOUNT_ID);
  });
  it('une référence vers une ligne absente du JSON et du projet est refusée ; présente dans le projet, elle passe', async () => {
    const j = copie();
    (j['needs'] as Array<Record<string, unknown>>)[0]!['tirelire_id'] = 'env-absente';
    expect(lireBudgetJson(j, emptyLedger()).ok).toBe(false);
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
    s.upsert('tirelires', { id: 'env-absente', name: 'Déjà là', placement: [{ accountId: MAIN_ACCOUNT_ID, share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-08-28' });
    expect(lireBudgetJson(j, s.load()).ok).toBe(true);
  });
  it('l’identifiant du compte principal du JSON peut nommer une ligne d’une autre table : elle garde le sien', async () => {
    const j = copie();
    const tirelire = (j['tirelires'] as Array<Record<string, unknown>>)[0]!;
    const commun = tirelire['id'] as string;
    (j['accounts'] as Array<Record<string, unknown>>).find((a) => a['kind'] === 'principal')!['id'] = commun;
    for (const f of j['planned_flows'] as Array<Record<string, unknown>>) if (f['account_id'] === MAIN_ACCOUNT_ID) f['account_id'] = commun;
    for (const t of j['tirelires'] as Array<Record<string, unknown>>)
      for (const p of t['placement'] as Array<Record<string, unknown>>) if (p['accountId'] === MAIN_ACCOUNT_ID) p['accountId'] = commun;
    const l = (await importer(j)).load();
    expect(l.tirelires.some((t) => t.id === commun)).toBe(true);
    expect(l.needs.filter((n) => n.tirelireId === commun).length).toBeGreaterThan(0);
    expect(l.accounts.some((a) => a.id === commun)).toBe(false);
  });
  it('deux comptes principaux sont refusés', () => {
    const j = copie();
    (j['accounts'] as unknown[]).push({ id: 'autre', name: 'Autre', kind: 'principal', opening_balance: 0, opening_date: '2026-08-27' });
    expect(lireBudgetJson(j, emptyLedger()).ok).toBe(false);
  });
});

describe('[niveau 0] #366 · 4 — rien d’un budget refusé n’est retenu', () => {
  it('lire puis écrire si la lecture passe : un budget fautif laisse le projet tel quel, octet pour octet', async () => {
    const s = await importer(exempleDeLaDoc());
    s.upsert('categories', { id: 'cat-a-moi', name: 'À moi', nature: 'expense' });
    const avant = s.export();
    const j = copie();
    (j['categories'] as Array<Record<string, unknown>>).find((c) => c['id'] === 'cat-alim')!['name'] = 'Courses';
    (j['planned_flows'] as Array<Record<string, unknown>>)[0]!['amount'] = 10.5;
    await expect(importer(j, s)).rejects.toThrow(/planned_flows/);
    expect(s.export()).toEqual(avant);
  });
});

describe('[niveau 2] #366 · 4 — la lecture, tout ou rien', () => {
  it('une faute refuse le tout, nomme la table, la ligne, la colonne, et compte les autres', async () => {
    const j = copie();
    const comptes = j['accounts'] as Array<Record<string, unknown>>;
    comptes[1]!['opening_balance'] = 12.5;
    comptes[2]!['kind'] = 'inconnu';
    (j['needs'] as Array<Record<string, unknown>>)[0]!['active_from'] = '2026-13-01';
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
    const avant = s.export();
    const lu = lireBudgetJson(j, s.load());
    expect(lu.ok).toBe(false);
    if (lu.ok) return;
    expect(lu.problemes[0]).toMatchObject({ table: 'accounts', id: 'acc-livret', colonne: 'opening_balance' });
    expect(lu.message).toMatch(/table accounts, ligne « acc-livret », colonne opening_balance/);
    expect(lu.message).toMatch(/Il y a 2 autres problèmes/);
    expect(s.export()).toEqual(avant);
  });
  it('deux parts variables dans un placement sont refusées', () => {
    const j = copie();
    (j['tirelires'] as Array<Record<string, unknown>>)[0]!['placement'] = [
      { accountId: 'acc-livret', share: { kind: 'variable' } },
      { accountId: MAIN_ACCOUNT_ID, share: { kind: 'variable' } },
    ];
    expect(lireBudgetJson(j, emptyLedger()).ok).toBe(false);
  });
  it('un identifiant répété est refusé', () => {
    const j = copie();
    const c = j['categories'] as unknown[];
    c.push(structuredClone(c[0]));
    const lu = lireBudgetJson(j, emptyLedger());
    expect(lu.ok).toBe(false);
    if (!lu.ok) expect(lu.problemes[0]!.message).toMatch(/se répète/);
  });
  it('une colonne hors du format est refusée', () => {
    const j = copie();
    (j['accounts'] as Array<Record<string, unknown>>)[0]!['deleted_at'] = '2026-01-01T00:00:00.000Z';
    expect(lireBudgetJson(j, emptyLedger()).ok).toBe(false);
  });
});

describe('[niveau 0] #366 · 5 — une ligne du projet absente du JSON reste', () => {
  it('dans chaque table du budget, et les opérations du projet aussi', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
    const ref = exampleLedger();
    for (const k of ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows', 'operations'] as const)
      for (const r of ref[k]) s.upsert(k, r as never);
    const avant = s.load();
    await importer({ format: BUDGET_JSON_FORMAT, version: BUDGET_JSON_VERSION, categories: [{ id: 'cat-neuve', name: 'Neuve', nature: 'expense' }] }, s);
    const apres = s.load();
    for (const k of ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows', 'operations'] as const)
      for (const r of avant[k]) expect(apres[k].find((x) => x.id === r.id)).toEqual(r);
  });
});

describe('[niveau 2] #366 · 5 — réimporter', () => {
  it('deux imports donnent le même projet qu’un seul ; une ligne du projet absente du JSON reste', async () => {
    const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
    s.upsert('categories', { id: 'cat-a-moi', name: 'À moi', nature: 'expense' });
    await importer(exempleDeLaDoc(), s);
    const une = s.load();
    await importer(exempleDeLaDoc(), s);
    expect(s.load()).toEqual(une);
    expect(une.categories.some((c) => c.id === 'cat-a-moi')).toBe(true);
  });
  it('une ligne dont l’identifiant existe le remplace', async () => {
    const s = await importer(exempleDeLaDoc());
    const j = copie();
    (j['categories'] as Array<Record<string, unknown>>).find((c) => c['id'] === 'cat-alim')!['name'] = 'Courses';
    await importer(j, s);
    expect(s.load().categories.filter((c) => c.id === 'cat-alim').map((c) => c.name)).toEqual(['Courses']);
  });
});

describe('[niveau 2] #366 · 6 — la documentation nomme exactement ce que la lecture accepte', () => {
  const nommees = new Map<string, Set<string>>();
  for (const m of DOC.matchAll(/^### `(\w+)`\n([\s\S]*?)(?=^##)/gm)) nommees.set(m[1]!, new Set([...m[2]!.matchAll(/^\| `(\w+)` \|/gm)].map((x) => x[1]!)));
  it('les mêmes tables', () => expect([...nommees.keys()].sort()).toEqual(Object.keys(COLONNES_BUDGET_JSON).sort()));
  it.each(Object.keys(COLONNES_BUDGET_JSON))('les mêmes colonnes pour %s', (t) => expect([...(nommees.get(t) ?? [])].sort()).toEqual([...COLONNES_BUDGET_JSON[t]!].sort()));
});
