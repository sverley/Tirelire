/**
 * Harnais d'audit de #407 — « Un retrait qui touche un ordre enregistré suit une seule règle, à
 * l'écran et dans l'assistant, montrée au résumé » : côté cœur, le plan (points 1, 5 et 6) et la
 * validation d'un budget (point 4). L'assistant sans navigateur est dans
 * `apps/web/test/retrait-ordre-enregistre-harnais.test.ts` ; l'écran, dans
 * `apps/web/test/navigateur/retrait-ordre-enregistre-harnais.test.ts`, et, depuis #419, sans
 * navigateur pour l'ordre proposé sur un projet vierge (point 3), dans
 * `apps/web/test/retrait-ordre-enregistre-ecran.test.ts`. Trois fichiers, un par ensemble de tests où
 * le codeur a écrit les siens (cœur, interface sans navigateur, navigateur), et un quatrième, celui
 * de #419.
 *
 * Les tests sont ceux du codeur (`retrait-ordre-enregistre.test.ts`, déplacé ici en entier), classés
 * par la suite de questions de D83 ; est de l'auditeur la lecture du point 1 par le vrai chemin de
 * l'import (`flowVentilation`) et par le solde prévu (`computeForecast`). Niveau 1 : les points 1, 5
 * et 6 (I2, I10, D60). Niveau 2 : le point 4 (D93, #378). Vus rouges sur le code de `main` ou sur des
 * mutations ciblées, dites dans la vérification de la PR.
 *
 * Sur le jeu d'exemple : l'ordre « Virement Livret A » (600 €) a trois parts fixes — Taxe foncière
 * 100 €, Assurance auto 50 €, Vacances 150 € — et la part variable d'Épargne de précaution. Chaque
 * `describe` dit le point du « Fait quand » qu'il tranche.
 */
import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import {
  appliquerBudget,
  budgetPeriodContaining,
  computeForecast,
  computePlan,
  differenceBudget,
  etatDuProjet,
  euros,
  exampleLedger,
  flowVentilation,
  indexLedger,
  keepStandingOrder,
  LedgerStore,
  preparerApplication,
  unallocatedAmount,
  type BudgetDefini,
  type Ledger,
  type PartieBudget,
  type PlannedFlow,
} from '../src/index.js';

const SQL = await initSqlJs();
const LECTURE = '2026-09-06';
const RETIRE = '2026-09-02T10:00:00.000Z';
const ORDRE = 'flow-vir-livret';

/** L'exemple, `retirer` appliqué : des tirelires et des comptes retirés, avec leur date de suppression. */
function exemple(retirer: { tirelires?: string[]; comptes?: string[] } = {}, ordre?: (f: PlannedFlow) => PlannedFlow): Ledger {
  const l = exampleLedger();
  l.tirelires = l.tirelires.map((t) => (retirer.tirelires?.includes(t.id) ? { ...t, deletedAt: RETIRE } : t));
  l.accounts = l.accounts.map((a) => (retirer.comptes?.includes(a.id) ? { ...a, deletedAt: RETIRE } : a));
  if (ordre) l.plannedFlows = l.plannedFlows.map((f) => (f.id === ORDRE ? ordre(f) : f));
  return l;
}
const livret = (l: Ledger) => computePlan(l, LECTURE).transfers.find((t) => t.accountId === 'acc-livret');
const alertes = (l: Ledger, code: string) => computePlan(l, LECTURE).warnings.filter((w) => w.code === code);

describe('[niveau 1] #407 · 5 — le plan signale la part d’une tirelire retirée', () => {
  it('une part fixe sous le pas d’arrondi se signale : la tirelire retirée ne demande plus rien', () => {
    // Assurance auto ne garde que 5 € dans l'ordre : sous le pas de 10 €, une part vivante ne se signalerait pas.
    const l = exemple({ tirelires: ['env-auto'] }, (f) => ({
      ...f,
      action: { allocation: f.action!.allocation!.map((p) => (p.tirelireId === 'env-auto' ? { ...p, share: { kind: 'fixed', amount: -euros(5) } } : p)) },
    }));
    const part = livret(l)!.bankOrder!.parts.find((p) => p.tirelireId === 'env-auto');
    expect(part).toEqual({ tirelireId: 'env-auto', tirelireName: 'Assurance auto', amount: euros(5), requested: 0, drift: -euros(5), signaled: true, retired: true });
    const [w, ...autres] = alertes(l, 'bankOrderPartDrift').filter((x) => x.tirelireId === 'env-auto');
    expect(autres).toEqual([]);
    expect(w!.accountId).toBe('acc-livret');
    expect(w!.message).toContain('« Livret A »');
    expect(w!.message).toContain('« Assurance auto »');
    expect(w!.message).toMatch(/retirée/);
    expect(w!.message).toMatch(/le budget ne lui demande plus rien/);
    expect(w!.message).toMatch(/à modifier chez votre banque, puis à confirmer ici/);
    expect(w!.message).not.toMatch(/\btu\b|\bton\b|\bta\b|\btes\b/);
  });

  it('la part variable et la part en pourcentage d’une tirelire retirée se signalent, à ce qu’elles virent', () => {
    // La part variable d'Épargne de précaution prend 600 − 300 = 300 € ; en pourcentage, 10 % de 600 €.
    const variable = livret(exemple({ tirelires: ['env-precaution'] }))!.bankOrder!.parts.find((p) => p.tirelireId === 'env-precaution');
    expect(variable).toMatchObject({ amount: euros(300), requested: 0, signaled: true, retired: true });
    const pourcent = exemple({ tirelires: ['env-precaution'] }, (f) => ({
      ...f,
      action: { allocation: f.action!.allocation!.map((p) => (p.tirelireId === 'env-precaution' ? { ...p, share: { kind: 'percent', pct: 10 } } : p)) },
    }));
    expect(livret(pourcent)!.bankOrder!.parts.find((p) => p.tirelireId === 'env-precaution')).toMatchObject({ amount: euros(60), signaled: true, retired: true });
    expect(alertes(pourcent, 'bankOrderPartDrift').map((w) => w.tirelireId)).toContain('env-precaution');
  });

  it('l’ordre et ses parts ne changent pas : le plan lit, il n’écrit rien', () => {
    const l = exemple({ tirelires: ['env-auto'] });
    const avant = structuredClone(l.plannedFlows.find((f) => f.id === ORDRE));
    computePlan(l, LECTURE);
    expect(l.plannedFlows.find((f) => f.id === ORDRE)).toEqual(avant);
  });

  it('les gestes : confirmer l’ordre proposé, quand le budget en demande encore un ; ou le garder tel quel (#205)', () => {
    const l = exemple({ tirelires: ['env-auto'] });
    const t = livret(l)!;
    expect(t.permanent).toBeGreaterThan(0);
    expect(t.proposal!.allocation.some((p) => p.tirelireId === 'env-auto')).toBe(false);
    const garde = keepStandingOrder(t, l.plannedFlows.find((f) => f.id === ORDRE)!);
    expect(garde).toBeDefined();
    const gardee = { ...l, plannedFlows: l.plannedFlows.map((f) => (f.id === ORDRE ? garde! : f)) };
    expect(livret(gardee)!.bankOrder!.kept).toBe(true);
    expect(alertes(gardee, 'bankOrderPartDrift').filter((w) => w.tirelireId === 'env-auto')).toEqual([]);
  });

  it('sans tirelire vivante, le plan ne compare rien, même si des ordres restent enregistrés (D60)', () => {
    const l = exemple({ tirelires: exampleLedger().tirelires.map((t) => t.id) });
    expect(computePlan(l, LECTURE).transfers.some((t) => t.bankOrder)).toBe(false);
    expect(alertes(l, 'bankOrderPartDrift')).toEqual([]);
  });
});

describe('[niveau 1] #407 · 1 — ce que vire la part d’une tirelire retirée est non affecté sur le compte d’accueil', () => {
  it('à l’import : l’opération qui reprend l’ordre prend toutes ses parts, et la part de la tirelire retirée reste au non affecté (D21, I2)', () => {
    const l = exemple({ tirelires: ['env-auto'] });
    // Le virement importé, côté compte principal, que décrit l'ordre, et la ventilation que pose l'import
    // quand il reprend l'ordre (D24, D88) : ce que ses parts vivantes n'absorbent pas, 50 €, est sans tirelire.
    l.operations.push({ id: 'op-vir', accountId: 'acc-principal', transferAccountId: 'acc-livret', origin: 'imported', date: '2026-08-28', label: 'TIRELIRE LIVRET A', normalizedLabel: 'TIRELIRE LIVRET A', amount: euros(-600), state: 'reconciled', plannedFlowId: ORDRE });
    const subs = flowVentilation(l, l.plannedFlows.find((f) => f.id === ORDRE)!, 'op-vir');
    expect(subs.map((x) => x.tirelireId)).toEqual(['env-tf', 'env-auto', 'env-vac', 'env-precaution']);
    l.subOperations.push(...subs);
    expect(unallocatedAmount(l.operations.find((o) => o.id === 'op-vir')!, indexLedger(l))).toBe(euros(-50));
  });

  it('au solde prévu : l’occurrence de l’ordre laisse la part de la tirelire retirée au non affecté du compte d’accueil', () => {
    // Le non affecté prévu du Livret A gagne, sur la période qui porte l'occurrence du 28 septembre,
    // 50 € de plus quand Assurance auto est retirée que quand elle est vivante.
    const gain = (l: Ledger) => {
      const avant = computeForecast(l, budgetPeriodContaining('2026-09-20', 28), LECTURE).accounts.find((a) => a.id === 'acc-livret')!.unallocated;
      const apres = computeForecast(l, budgetPeriodContaining('2026-10-06', 28), LECTURE).accounts.find((a) => a.id === 'acc-livret')!.unallocated;
      return apres - avant;
    };
    expect(gain(exemple({ tirelires: ['env-auto'] })) - gain(exemple())).toBe(euros(50));
  });
});

describe('[niveau 1] #407 · 6 — le plan signale l’ordre vers un compte retiré', () => {
  it('la carte du compte retiré, sous son nom : l’ordre plus demandé, à tout montant, sans proposition', () => {
    const l = exemple({ comptes: ['acc-livret'] });
    const t = livret(l)!;
    expect(t).toMatchObject({ accountName: 'Livret A', accountRetired: true, permanent: 0, breakdown: [], net: 0 });
    expect(t.proposal).toBeUndefined();
    expect(t.bankOrder).toMatchObject({ flowId: ORDRE, amount: euros(600), signaled: true });
    const [w] = alertes(l, 'bankOrderDrift').filter((x) => x.accountId === 'acc-livret');
    expect(w!.message).toContain('« Livret A »');
    expect(w!.message).toMatch(/compte retiré/);
    expect(w!.message).toMatch(/n'est plus demandé par le budget : à supprimer chez votre banque, puis ici/);
    expect(l.plannedFlows.find((f) => f.id === ORDRE)).toEqual(exampleLedger().plannedFlows.find((f) => f.id === ORDRE));
  });

  it('un ordre qui n’est plus en vigueur à la date du plan ne montre pas la carte', () => {
    const l = exemple({ comptes: ['acc-livret'] }, (f) => ({ ...f, activeTo: '2026-08-31' }));
    expect(livret(l)).toBeUndefined();
  });

  it('gardé tel quel, l’ordre se lit à surveiller, sans avertissement (#205)', () => {
    const l = exemple({ comptes: ['acc-livret'] });
    const garde = keepStandingOrder(livret(l)!, l.plannedFlows.find((f) => f.id === ORDRE)!);
    const gardee = { ...l, plannedFlows: l.plannedFlows.map((f) => (f.id === ORDRE ? garde! : f)) };
    expect(livret(gardee)!.bankOrder!.kept).toBe(true);
    expect(computePlan(gardee, LECTURE).warnings.filter((w) => w.accountId === 'acc-livret')).toEqual([]);
  });

  it('sans tirelire vivante, aucune carte (D60)', () => {
    const l = exemple({ comptes: ['acc-livret'], tirelires: exampleLedger().tirelires.map((t) => t.id) });
    expect(livret(l)).toBeUndefined();
  });
});

/** Un dépôt qui porte le budget de l'exemple, sans ses opérations. */
async function depot(): Promise<LedgerStore> {
  const s = await LedgerStore.create({ sqlJs: SQL, siteId: 't' });
  const l = exampleLedger();
  for (const k of ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows'] as const) for (const r of l[k]) s.upsert(k, r as never);
  return s;
}

/**
 * Ce que fait la validation de l'assistant (`preparerValidation`, #379) : la différence entre son
 * fichier — l'état lu des parties `parties`, changé par `changer` — et cet état lu, préparée sur le
 * projet du moment par le cœur.
 */
function preparer(s: LedgerStore, parties: PartieBudget[], changer: (f: BudgetDefini) => void) {
  const projet = s.load();
  const etatLu = etatDuProjet(projet, parties);
  const fichier = structuredClone(etatLu);
  changer(fichier);
  return preparerApplication(differenceBudget(fichier, etatLu), etatLu, projet);
}
const sansAuto = (f: BudgetDefini) => {
  f.tables.tirelires = f.tables.tirelires!.filter((t) => t.id !== 'env-auto');
  f.tables.needs = f.tables.needs!.filter((n) => n.v['tirelire_id'] !== 'env-auto');
};

describe('[niveau 2] #407 · 4 — la validation de l’assistant accepte ce qu’un ordre enregistré désigne', () => {
  it('retirer une tirelire qu’une part désigne : la validation écrit le retrait, l’ordre reste tel quel', async () => {
    const s = await depot();
    const avant = s.load().plannedFlows.find((f) => f.id === ORDRE);
    const prep = preparer(s, ['tirelires', 'needs', 'plannedFlows'], sansAuto);
    if (!prep.ok) throw new Error(prep.message);
    appliquerBudget(s, prep);
    const apres = s.load();
    expect(apres.tirelires.find((t) => t.id === 'env-auto')!.deletedAt).toBeTruthy();
    expect(apres.plannedFlows.find((f) => f.id === ORDRE)).toEqual(avant);
  });

  it('retirer le compte vers lequel va l’ordre : la validation écrit le retrait, l’ordre reste tel quel', async () => {
    const s = await depot();
    const avant = s.load().plannedFlows.find((f) => f.id === ORDRE);
    const prep = preparer(s, ['accounts', 'tirelires', 'plannedFlows'], (f) => {
      f.tables.accounts = f.tables.accounts!.filter((a) => a.id !== 'acc-livret');
      // Le placement d'une tirelire sur le compte retiré est un autre lien : il se retire avec le compte.
      f.tables.tirelires = f.tables.tirelires!.map((t) => (String(t.v['placement']).includes('acc-livret') ? { ...t, v: { ...t.v, placement: '[]' } } : t));
    });
    if (!prep.ok) throw new Error(prep.message);
    appliquerBudget(s, prep);
    const apres = s.load();
    expect(apres.accounts.find((a) => a.id === 'acc-livret')!.deletedAt).toBeTruthy();
    expect(apres.plannedFlows.find((f) => f.id === ORDRE)).toEqual(avant);
  });

  it('tout autre lien vers une ligne retirée refuse toujours (#378, point 8) : le placement d’une tirelire sur le compte retiré', async () => {
    const s = await depot();
    const prep = preparer(s, ['accounts'], (f) => {
      f.tables.accounts = f.tables.accounts!.filter((a) => a.id !== 'acc-livret');
    });
    expect(prep.ok).toBe(false);
    if (!prep.ok) {
      expect(prep.problemes.some((p) => p.table === 'tirelires')).toBe(true);
      expect(prep.problemes.some((p) => p.table === 'planned_flows')).toBe(false);
    }
  });

  it('un ordre que le projet ne porte pas encore ne désigne pas une tirelire que la validation retire', async () => {
    const s = await depot();
    const prep = preparer(s, ['tirelires', 'needs', 'plannedFlows'], (f) => {
      sansAuto(f);
      const ordre = f.tables.plannedFlows!.find((l) => l.id === ORDRE)!;
      f.tables.plannedFlows!.push({ id: 'flow-nouveau', v: { ...ordre.v, name: 'Nouvel ordre' } });
    });
    expect(prep.ok).toBe(false);
    if (!prep.ok) expect(prep.problemes.map((p) => [p.table, p.id])).toEqual([['planned_flows', 'flow-nouveau']]);
  });

  it('une part dont la tirelire n’est pas dans le fichier, ni vivante ni retirée, refuse (#393, point 12)', async () => {
    const s = await depot();
    const prep = preparer(s, ['plannedFlows'], (f) => {
      const ordre = f.tables.plannedFlows!.find((l) => l.id === ORDRE)!;
      ordre.v['action'] = String(ordre.v['action']).replace(/env-auto/g, 'env-inconnue');
    });
    expect(prep.ok).toBe(false);
    if (!prep.ok) expect(prep.problemes.map((p) => [p.table, p.id])).toEqual([['planned_flows', ORDRE]]);
  });
});
