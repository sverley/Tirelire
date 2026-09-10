/**
 * Harnais de vérification de la PR #19 contre le besoin de l'issue #14 (D57).
 *
 * Il ne relit pas la solution : il rejoue les phrases de l'issue, une par une, sur le jeu d'exemple
 * (données inventées, D17). Aucune valeur n'est figée : ce que le budget demande est toujours relu
 * dans le plan, pour que le harnais survive aux évolutions de l'exemple.
 *
 * Le cycle mensuel complet est simulé comme dans la vraie vie : le plan propose, Simon enregistre
 * son ordre, la banque vire, l'import rapproche (`proposeMatches` → `applyMatch`), le plan est relu.
 * Une garde rouge ici veut dire qu'une exigence de l'issue n'est pas tenue, pas que le test est à
 * adapter.
 *
 * Arbitrage de Simon (10 septembre, PR #19) : ce que le budget demande comme ordre permanent vers
 * un compte est la **somme des dotations mensuelles** des tirelires placées sur ce compte, quel que
 * soit ce qui a déjà été viré dans la période. La section 7 le garde ; elle lit le montant auquel le
 * plan compare l'ordre (`bankOrder.amount + bankOrder.drift`), pas un champ particulier.
 */
import { describe, expect, it } from 'vitest';
import {
  alive,
  applyMatch,
  computePlan,
  distributeTransfer,
  emptyLedger,
  euros,
  exampleLedger,
  formatCents,
  isDerivedFlow,
  matchTirelireTransfers,
  normalizeLabel,
  proposeMatches,
  roundOrderUp,
  standingOrderFlow,
  standingTransferFlow,
  type Ledger,
  type Need,
  type Operation,
  type Patch,
  type PlannedFlow,
} from '../src/index.js';

const PRINCIPAL = 'acc-principal';
const LIVRET = 'acc-livret';
/** Mi-période « septembre » (28 août → 27 septembre). */
const AVANT = '2026-09-06';
/** Jour du virement de la période suivante, et lendemain. */
const JOUR_VIREMENT = '2026-09-28';
const LENDEMAIN = '2026-09-29';

// ---------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------

function transfert(l: Ledger, asOf: string) {
  const plan = computePlan(l, asOf);
  return { plan, t: plan.transfers.find((x) => x.accountId === LIVRET) };
}

/**
 * Ce que le budget demande vers le Livret A à cette date, comme ordre permanent : la croisière des
 * tirelires placées là (`permanent`), et non ce qui reste à virer cette période (`standing`), qui
 * fond dès que le virement est passé.
 */
function demande(l: Ledger, asOf: string): number {
  return transfert(l, asOf).t?.permanent ?? 0;
}

/** Le geste de l'écran Plan : enregistrer le montant que l'ordre exécute chez la banque. */
function enregistrerOrdre(l: Ledger, montant: number, asOf = AVANT): Ledger {
  const { plan, t } = transfert(l, asOf);
  const flux = standingTransferFlow(plan, t!, PRINCIPAL, t!.bankOrder?.flowId ?? 'flow-ordre', montant)!;
  return { ...l, plannedFlows: [...l.plannedFlows.filter((f) => f.id !== flux.id), flux] };
}

function ordre(l: Ledger): PlannedFlow {
  return standingOrderFlow(l.plannedFlows, LIVRET)!;
}

/** Une ligne de relevé comme la banque l'écrit : « VIR PERMANENT TIRELIRE LIVRET A ». */
function ligneBancaire(l: Ledger, montant: number, date = JOUR_VIREMENT, id = 'op-virement'): Operation {
  const libellé = `VIR PERMANENT ${ordre(l)?.labelPattern ?? 'TIRELIRE LIVRET A'}`;
  return { id, accountId: PRINCIPAL, origin: 'imported', date, label: libellé, normalizedLabel: normalizeLabel(libellé), amount: -montant, state: 'untreated' };
}

function appliquer(l: Ledger, p: Patch): Ledger {
  const ops = new Map(l.operations.map((o) => [o.id, o]));
  for (const o of p.operations) ops.set(o.id, o);
  const retirées = new Set(p.removedAllocations ?? []);
  return { ...l, operations: [...ops.values()], allocations: [...l.allocations.filter((a) => !retirées.has(a.id)), ...p.allocations] };
}

/** L'import tel que l'écran Opérations le fait : proposition, puis application. */
function importer(l: Ledger, op: Operation) {
  const avec: Ledger = { ...l, operations: [...l.operations, op] };
  const proposition = proposeMatches(avec, addJours(op.date, -40), addJours(op.date, 40)).find((p) => p.operationId === op.id);
  const patch = proposition ? applyMatch(avec, proposition) : undefined;
  return { avec, proposition, patch, après: patch ? appliquer(avec, patch) : avec };
}

function addJours(d: string, n: number): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** Ventilation d'un patch, tirelire → montant positif. */
function ventilation(p: Patch | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of p?.allocations ?? []) if (a.tirelireId && a.share.kind === 'fixed') out[a.tirelireId] = (out[a.tirelireId] ?? 0) - a.share.amount;
  return out;
}

function attendue(l: Ledger, op: Operation): Record<string, number> {
  return Object.fromEntries(distributeTransfer({ ...l, operations: [...l.operations, op] }, LIVRET, op.amount, op.date).map((p) => [p.tirelireId, p.amount]));
}

const alertes = (l: Ledger, asOf: string) => computePlan(l, asOf).warnings.filter((w) => w.code === 'bankOrderDrift');

function gelé<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) gelé(v);
  }
  return o;
}

/**
 * Budget minimal sans arriéré : un compte courant, un livret, une tirelire Vacances à 200 € par
 * période sur le livret, un ordre de 200 € enregistré, et le virement du 28 septembre importé des
 * deux côtés.
 */
function budgetMinimalAprèsVirement() {
  const l = emptyLedger({ periodStartDay: 28 });
  l.accounts.push(
    { id: 'p', name: 'Courant', kind: 'principal', openingBalance: euros(1000), openingDate: '2026-09-27' },
    { id: 'e', name: 'Livret', kind: 'epargne', openingBalance: 0, openingDate: '2026-09-27' },
  );
  l.tirelires.push({ id: 't', name: 'Vacances', placement: [{ accountId: 'e', share: { kind: 'variable' } }], openingBalance: 0, openingDate: '2026-09-28' });
  l.needs.push({ id: 'n', tirelireId: 't', kind: 'goal', amount: euros(5000), monthlyAmount: euros(200), priority: 30 } as Need);
  l.plannedFlows.push({ id: 's', name: 'Salaire', kind: 'income', amount: euros(2000), accountId: 'p', periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-28' }, dateWindowDays: 3 });

  const plan = computePlan(l, '2026-09-28');
  const t = plan.transfers.find((x) => x.accountId === 'e')!;
  expect(t.standing).toBe(euros(200));
  const flux = standingTransferFlow(plan, t, 'p', 'o', euros(200))!;
  const avecOrdre: Ledger = { ...l, plannedFlows: [...l.plannedFlows, flux] };
  expect(computePlan(avecOrdre, '2026-09-28').warnings.filter((w) => w.code === 'bankOrderDrift')).toHaveLength(0);

  const libellé = `VIR PERMANENT ${flux.labelPattern}`;
  const sortie: Operation = { id: 'v', accountId: 'p', origin: 'imported', date: '2026-09-28', label: libellé, normalizedLabel: normalizeLabel(libellé), amount: -euros(200), state: 'untreated' };
  const entrée: Operation = { id: 'v2', accountId: 'e', origin: 'imported', date: '2026-09-28', label: libellé, normalizedLabel: normalizeLabel(libellé), amount: euros(200), state: 'reconciled', transferAccountId: 'p' };
  const { proposition, après } = importer({ ...avecOrdre, operations: [entrée] }, sortie);
  expect(proposition?.auto).toBe(true);
  return { après, compte: 'e' };
}

/** Nombre de mois couverts par une périodicité (jour et semaine ramenés au mois). */
function moisDe(p: NonNullable<Need['periodicity']>): number {
  const u = p.unit as string;
  const n = p.interval ?? 1;
  return u === 'year' ? 12 * n : u === 'month' ? n : u === 'week' ? (n * 7) / 30.4375 : n / 30.4375;
}

/**
 * La somme des dotations mensuelles des tirelires placées sur le compte, telle que l'arbitrage la
 * définit, recalculée ici depuis les besoins et non lue dans le plan. Les tirelires versantes
 * (`payout`, D48) ne demandent rien.
 */
function sommeDesDotations(l: Ledger, compte: string, asOf: string): number {
  const placées = new Set(alive(l.tirelires).filter((e) => e.placement.some((p) => p.accountId === compte)).map((e) => e.id));
  let total = 0;
  for (const n of alive(l.needs)) {
    if (!placées.has(n.tirelireId)) continue;
    if ((n.activeFrom && asOf < n.activeFrom) || (n.activeTo && asOf > n.activeTo)) continue;
    if (n.kind === 'goal') total += n.monthlyAmount ?? 0;
    else if (n.kind === 'recurring') total += Math.round((n.amount ?? 0) / (n.periodicity ? moisDe(n.periodicity) : 1));
    else if (n.kind === 'dueDate') total += Math.round((n.amount ?? 0) / (n.periodicity ? moisDe(n.periodicity) : 12));
  }
  return total;
}

/** Le montant auquel le plan compare l'ordre enregistré vers ce compte. */
function montantComparé(l: Ledger, compte: string, asOf: string): number | undefined {
  const b = computePlan(l, asOf).transfers.find((x) => x.accountId === compte)?.bankOrder;
  return b ? b.amount + b.drift : undefined;
}

// Trois façons dont le budget bouge, tirées de l'issue.
const besoinAjouté = (l: Ledger): Ledger => ({
  ...l,
  needs: [...l.needs, { id: 'need-harnais-travaux', tirelireId: 'env-vac', kind: 'goal', amount: euros(3000), monthlyAmount: euros(150), priority: 5 } as Need],
});
const prioritéModifiée = (l: Ledger): Ledger => ({
  ...l,
  needs: l.needs.map((n) => (n.tirelireId === 'env-precaution' ? { ...n, priority: 1 } : n)),
});
const dotationRevue = (l: Ledger): Ledger => ({
  ...l,
  needs: l.needs.map((n) => (n.id === 'need-tf' ? { ...n, amount: euros(2400) } : n)),
});

// ---------------------------------------------------------------------------------------------
// 1. « La ventilation d'un virement dérivé du budget est recalculée, pas mémorisée. »
// ---------------------------------------------------------------------------------------------

describe('#14 · la ventilation est recalculée, pas mémorisée', () => {
  it('le flux enregistré ne garde que ce qui reconnaît la ligne bancaire : aucune tirelire, aucune part', () => {
    const l = enregistrerOrdre(exampleLedger(), euros(650));
    const f = ordre(l);
    expect(isDerivedFlow(f)).toBe(true);
    expect(f.labelPattern).toBeTruthy();
    expect(f.amountTolerance).toBeTruthy();
    const écrit = JSON.stringify(f);
    for (const e of l.tirelires) expect(écrit, `le flux mentionne la tirelire ${e.name}`).not.toContain(e.id);
    expect(f.tirelireId).toBeUndefined();
  });

  it('à l’import, la répartition est celle de l’ordre de financement au jour de l’opération (D06)', () => {
    const l = enregistrerOrdre(exampleLedger(), euros(650));
    for (const montant of [euros(650), euros(600), euros(700)]) {
      const op = ligneBancaire(l, montant);
      const { proposition, patch } = importer(l, op);
      expect(proposition?.flowId, `virement de ${formatCents(montant)} non reconnu`).toBe(ordre(l).id);
      expect(ventilation(patch)).toEqual(attendue(l, op));
      expect(Object.values(ventilation(patch)).reduce((s, v) => s + v, 0)).toBe(montant);
    }
  });

  it.each([
    ['un besoin ajouté', besoinAjouté],
    ['une priorité modifiée', prioritéModifiée],
    ['une dotation revue', dotationRevue],
  ])('à montant viré inchangé, %s change la ventilation : c’est le budget du jour qui décide', (_, bouger) => {
    const avant = enregistrerOrdre(exampleLedger(), euros(650));
    const après = bouger(avant);
    const op = ligneBancaire(avant, euros(650));
    const vAvant = ventilation(importer(avant, op).patch);
    const vAprès = ventilation(importer(après, op).patch);
    expect(vAprès).toEqual(attendue(après, op));
    expect(vAprès).not.toEqual(vAvant);
  });

  it('une échéance passée entre deux virements identiques change la ventilation du second', () => {
    const l = enregistrerOrdre(exampleLedger(), euros(650));
    // Taxe foncière due le 15 octobre : le même ordre vire le 28 septembre, puis le 28 octobre.
    const avantÉchéance = ligneBancaire(l, euros(650), '2026-09-28', 'op-avant');
    const aprèsÉchéance = ligneBancaire(l, euros(650), '2026-10-28', 'op-apres');
    const vAvant = ventilation(importer(l, avantÉchéance).patch);
    const vAprès = ventilation(importer(l, aprèsÉchéance).patch);
    expect(vAvant).toEqual(attendue(l, avantÉchéance));
    expect(vAprès).toEqual(attendue(l, aprèsÉchéance));
    expect(vAprès).not.toEqual(vAvant);
  });

  it('une vieille photo écrite par un pair non migré (plannedAllocation) est ignorée', () => {
    const l = enregistrerOrdre(exampleLedger(), euros(650));
    const photo = { ...ordre(l), plannedAllocation: [{ tirelireId: 'env-auto', share: { kind: 'fixed', amount: -euros(650) } }] } as PlannedFlow;
    const avecPhoto: Ledger = { ...l, plannedFlows: l.plannedFlows.map((f) => (f.id === photo.id ? photo : f)) };
    const op = ligneBancaire(l, euros(650));
    expect(ventilation(importer(avecPhoto, op).patch)).toEqual(attendue(l, op));
  });
});

// ---------------------------------------------------------------------------------------------
// 2. « Quand le budget change, les flux qui en dérivent sont mis à jour tout seuls, et
//    l'application dit ce qui a bougé. Aucun bouton à penser à appuyer. »
// ---------------------------------------------------------------------------------------------

describe('#14 · le budget bouge, le plan suit sans geste et le dit', () => {
  it('ce que le budget demande se relit sans qu’aucune écriture ne soit nécessaire', () => {
    const l = gelé(enregistrerOrdre(exampleLedger(), roundOrderUp(demande(exampleLedger(), AVANT), euros(10))));
    const après = besoinAjouté(l);
    // Aucune fonction du parcours ne modifie le dépôt (un objet gelé lèverait).
    expect(() => computePlan(après, AVANT)).not.toThrow();
    expect(demande(après, AVANT)).toBeGreaterThan(demande(l, AVANT));
  });

  it('un budget qui monte fait dire au plan l’ancien montant de l’ordre et le nouveau montant demandé', () => {
    const base = exampleLedger();
    const l = enregistrerOrdre(base, demande(base, AVANT));
    expect(alertes(l, AVANT)).toHaveLength(0);
    const après = besoinAjouté(l);
    const [alerte, ...autres] = alertes(après, AVANT);
    expect(autres).toHaveLength(0);
    expect(alerte?.message).toContain('Livret A');
    expect(alerte?.message).toContain(formatCents(demande(base, AVANT)));
    expect(alerte?.message).toContain(formatCents(demande(après, AVANT)));
  });

  it('un budget qui baisse au-delà du pas d’arrondi se dit aussi', () => {
    const base = besoinAjouté(exampleLedger());
    const l = enregistrerOrdre(base, demande(base, AVANT));
    const après: Ledger = { ...l, needs: l.needs.filter((n) => n.id !== 'need-harnais-travaux') };
    const alerte = alertes(après, AVANT)[0];
    expect(alerte?.message).toContain(formatCents(demande(base, AVANT)));
    expect(alerte?.message).toContain(formatCents(demande(après, AVANT)));
  });
});

// ---------------------------------------------------------------------------------------------
// 3. « Le montant permanent enregistré ne peut pas se mettre à jour tout seul chez la banque :
//    quand il diverge, l'application signale qu'un ordre est à modifier. »
// ---------------------------------------------------------------------------------------------

describe('#14 · l’ordre chez la banque diverge : signalé, jamais réécrit', () => {
  it('le montant enregistré ne suit pas le budget', () => {
    const l = enregistrerOrdre(exampleLedger(), euros(650));
    const après = dotationRevue(besoinAjouté(l));
    const { t } = transfert(après, AVANT);
    expect(ordre(après).amount).toBe(-euros(650));
    expect(t?.bankOrder?.amount).toBe(euros(650));
  });

  it('un ordre trop court d’un centime est signalé, quel que soit le pas', () => {
    const base = exampleLedger();
    for (const pas of [0, euros(10), euros(50)]) {
      const l = enregistrerOrdre({ ...base, settings: { ...base.settings, orderRounding: pas } }, demande(base, AVANT) - 1);
      expect(alertes(l, AVANT), `pas ${pas}`).toHaveLength(1);
    }
  });

  it('un ordre que le budget ne demande plus est signalé, même s’il est petit', () => {
    // Plus aucune tirelire ne veut d'argent sur le Livret A : tout ordre vers lui est à supprimer.
    const base = exampleLedger();
    const vide: Ledger = { ...base, needs: base.needs.filter((n) => !['env-tf', 'env-auto', 'env-vac', 'env-precaution'].includes(n.tirelireId)) };
    for (const montant of [euros(300), euros(10), euros(5)]) {
      const l = enregistrerOrdre(vide, montant);
      expect(demande(l, AVANT)).toBe(0);
      expect(alertes(l, AVANT), `ordre de ${formatCents(montant)} devenu inutile, non signalé`).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Le cycle réel : l'ordre n'a pas changé, le budget non plus, la banque vire, on importe.
//    Rien n'a divergé : le plan ne doit rien demander de modifier.
// ---------------------------------------------------------------------------------------------

describe('#14 · cycle mensuel sans changement : aucune fausse alerte', () => {
  it('le plan de la période est le même avant et après l’import du virement attendu', () => {
    const base = exampleLedger();
    const demandé = demande(base, LENDEMAIN);
    const l = enregistrerOrdre(base, demandé, LENDEMAIN);
    expect(alertes(l, LENDEMAIN), 'alerte avant même le virement').toHaveLength(0);

    const { proposition, après } = importer(l, ligneBancaire(l, demandé, JOUR_VIREMENT));
    expect(proposition?.auto, 'le virement au montant exact doit se pointer seul (D12)').toBe(true);

    // Ni le budget ni l'ordre n'ont bougé : ce que le budget demande comme ordre permanent reste
    // ce qu'il demandait, et aucun ordre n'est « à modifier chez la banque ».
    expect(alertes(après, LENDEMAIN).map((w) => w.message)).toEqual([]);
    expect(demande(après, LENDEMAIN)).toBe(demandé);
  });

  it('sur un budget minimal sans arriéré, l’ordre juste n’est pas déclaré « à supprimer » après son virement', () => {
    const { après } = budgetMinimalAprèsVirement();
    for (const jour of ['2026-09-29', '2026-10-15', '2026-10-27'])
      expect(computePlan(après, jour).warnings.filter((w) => w.code === 'bankOrderDrift').map((w) => `${jour} : ${w.message}`)).toEqual([]);
  });

  it('au fil de la période qui suit le virement, l’alerte ne s’allume pas', () => {
    const base = exampleLedger();
    const demandé = demande(base, LENDEMAIN);
    const posé = roundOrderUp(demande(base, LENDEMAIN), base.settings.orderRounding);
    const avecOrdre = enregistrerOrdre(base, posé, LENDEMAIN);
    const l = importer(avecOrdre, ligneBancaire(avecOrdre, posé)).après;
    for (const jour of ['2026-10-05', '2026-10-15', '2026-10-27']) expect(alertes(l, jour).map((w) => `${jour} : ${w.message}`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. « Distinguer un flux déclaré d'un flux dérivé. Un flux déclaré n'est jamais réécrit. »
// ---------------------------------------------------------------------------------------------

describe('#14 · déclaré ou dérivé', () => {
  it('seul l’ordre enregistré depuis le Plan est dérivé ; le reste de l’exemple est déclaré', () => {
    const l = enregistrerOrdre(exampleLedger(), euros(650));
    const dérivés = alive(l.plannedFlows).filter(isDerivedFlow).map((f) => f.id);
    expect(dérivés).toEqual([ordre(l).id]);
  });

  it('un virement saisi à la main reste déclaré et n’est pas pris pour l’ordre permanent', () => {
    // L'exemple porte son propre ordre dérivé (D58) : on le retire pour n'avoir que celui saisi.
    const base = exampleLedger();
    const l: Ledger = { ...base, plannedFlows: base.plannedFlows.filter((f) => f.id !== 'flow-vir-livret') };
    const main: PlannedFlow = {
      id: 'flow-main',
      name: 'Virement saisi',
      kind: 'transfer',
      amount: -euros(650),
      accountId: PRINCIPAL,
      counterpartAccountId: LIVRET,
      periodicity: { interval: 1, unit: 'month', anchorDate: '2026-08-28' },
      dateWindowDays: 5,
    };
    const avec: Ledger = { ...l, plannedFlows: [...l.plannedFlows, main] };
    expect(isDerivedFlow(main)).toBe(false);
    expect(standingOrderFlow(avec.plannedFlows, LIVRET)).toBeUndefined();
    expect(transfert(avec, AVANT).t?.bankOrder).toBeUndefined();
  });

  it('ni le plan, ni le rapprochement, ni la reconnaissance par libellé ne réécrivent un flux', () => {
    const l = gelé(dotationRevue(enregistrerOrdre(exampleLedger(), euros(650))));
    const op = ligneBancaire(l, euros(650));
    const avec = gelé({ ...l, operations: [...l.operations, op] });
    expect(() => {
      computePlan(avec, LENDEMAIN);
      for (const p of proposeMatches(avec, AVANT, LENDEMAIN)) {
        const patch = applyMatch(avec, p);
        expect(Object.keys(patch)).not.toContain('plannedFlows');
      }
      expect(Object.keys(matchTirelireTransfers(avec))).not.toContain('plannedFlows');
    }).not.toThrow();
  });

  it('réenregistrer l’ordre remplace le fait, sans créer un second flux', () => {
    const une = enregistrerOrdre(exampleLedger(), euros(650));
    const deux = enregistrerOrdre(une, euros(700));
    expect(alive(deux.plannedFlows).filter(isDerivedFlow)).toHaveLength(1);
    expect(transfert(deux, AVANT).t?.bankOrder?.amount).toBe(euros(700));
  });
});

// ---------------------------------------------------------------------------------------------
// 6. « Ne pas casser la reconnaissance à l'import. Un ordre que Simon n'a pas encore modifié
//    chez sa banque doit continuer d'être reconnu. »
// ---------------------------------------------------------------------------------------------

describe('#14 · la reconnaissance à l’import tient quand le budget bouge', () => {
  it('le budget a monté, l’ordre bancaire non : la ligne à l’ancien montant est reconnue et pointée seule', () => {
    const l = enregistrerOrdre(exampleLedger(), euros(650));
    const après = dotationRevue(besoinAjouté(l));
    expect(demande(après, AVANT)).not.toBe(euros(650));
    const { proposition } = importer(après, ligneBancaire(après, euros(650)));
    expect(proposition?.flowId).toBe(ordre(après).id);
    expect(proposition?.auto).toBe(true);
  });

  it('Simon a modifié son ordre chez la banque sans le confirmer : la ligne est reconnue (tolérance)', () => {
    const l = besoinAjouté(enregistrerOrdre(exampleLedger(), euros(650)));
    const nouveau = roundOrderUp(demande(l, AVANT), l.settings.orderRounding);
    const { proposition, patch } = importer(l, ligneBancaire(l, nouveau));
    if (Math.abs(nouveau - euros(650)) <= euros(650) * 0.2) expect(proposition?.flowId).toBe(ordre(l).id);
    // Au-delà de la tolérance, le libellé « TIRELIRE LIVRET A » suffit encore (D11).
    else expect(Object.keys(ventilation(matchTirelireTransfers({ ...l, operations: [...l.operations, ligneBancaire(l, nouveau)] })))).not.toHaveLength(0);
    if (patch) expect(ventilation(patch)).toEqual(attendue(l, ligneBancaire(l, nouveau)));
  });

  it('même hors tolérance, le libellé reconnaît le virement et le ventile par l’ordre de financement', () => {
    const l = enregistrerOrdre(exampleLedger(), euros(650));
    const op = ligneBancaire(l, euros(1000));
    expect(importer(l, op).proposition?.flowId).not.toBe(ordre(l).id);
    const patch = matchTirelireTransfers({ ...l, operations: [...l.operations, op] });
    expect(patch.operations.find((o) => o.id === op.id)?.transferAccountId).toBe(LIVRET);
    expect(ventilation(patch)).toEqual(attendue(l, op));
  });
});

// ---------------------------------------------------------------------------------------------
// 7. Arbitrage du 10 septembre : l'ordre voulu est la somme des dotations mensuelles des tirelires
//    placées sur le compte, quel que soit ce qui a déjà été viré dans la période.
// ---------------------------------------------------------------------------------------------

describe('#14 · arbitrage : l’ordre voulu est la somme des dotations mensuelles', () => {
  it('le harnais recalcule bien la somme de l’exemple (650 € vers le Livret A, 1 150 € dès la paie de décembre)', () => {
    const l = exampleLedger();
    expect(sommeDesDotations(l, LIVRET, AVANT)).toBe(euros(650));
    expect(sommeDesDotations(l, LIVRET, '2026-12-29')).toBe(euros(1150));
  });

  it('avant tout virement, le plan compare l’ordre à cette somme, période après période', () => {
    const l = enregistrerOrdre(exampleLedger(), euros(1));
    for (const jour of [AVANT, LENDEMAIN, '2026-10-29', '2026-11-29', '2026-12-29'])
      expect(montantComparé(l, LIVRET, jour), jour).toBe(sommeDesDotations(l, LIVRET, jour));
  });

  it('après l’import du virement du mois, la somme comparée ne baisse pas', () => {
    const base = exampleLedger();
    const posé = sommeDesDotations(base, LIVRET, LENDEMAIN);
    const avecOrdre = enregistrerOrdre(base, posé, LENDEMAIN);
    const { après } = importer(avecOrdre, ligneBancaire(avecOrdre, posé));
    for (const jour of [LENDEMAIN, '2026-10-15', '2026-10-27'])
      expect(montantComparé(après, LIVRET, jour), jour).toBe(sommeDesDotations(après, LIVRET, jour));
  });

  it('sur le budget minimal, la somme comparée reste 200 € après le virement', () => {
    const { après, compte } = budgetMinimalAprèsVirement();
    for (const jour of ['2026-09-29', '2026-10-15', '2026-10-27']) expect(montantComparé(après, compte, jour), jour).toBe(euros(200));
  });
});

// ---------------------------------------------------------------------------------------------
// 8. Arbitrage du 10 septembre, suite : le « Détail » divise le virement, « simple pour le plus
//    grand nombre, souple pour les exigeants ».
//
//    Gardes à écrire dès que la forme du modèle existe : les écrire maintenant obligerait à
//    inventer des noms que le développement choisira. Elles restent listées ici pour qu'aucune ne
//    soit oubliée ; `vitest` les affiche comme « todo ».
// ---------------------------------------------------------------------------------------------

describe('#14 · arbitrage : diviser le virement, simple par défaut, souple sur demande', () => {
  // Simple
  it.todo('sans aucun réglage, un compte a un seul ordre voulu : la somme des dotations de ses tirelires');
  it.todo('un budget qui n’a jamais été divisé se comporte exactement comme aujourd’hui (aucune migration de sens)');
  // Souple
  it.todo('les tirelires d’un compte se répartissent librement en plusieurs ordres, chacune dans un seul ordre, aucune oubliée');
  it.todo('ce que le budget demande pour chaque ordre est la somme des dotations de ses tirelires, et le total des ordres vaut la somme du compte');
  it.todo('un ordre par tirelire est un cas particulier du regroupement, pas un mode à part');
  it.todo('revenir à un seul ordre regroupe tout, sans perdre les faits bancaires enregistrés');
  // Ce que chaque ordre doit tenir, comme l'ordre unique aujourd'hui (D57)
  it.todo('chaque ordre enregistre son propre fait bancaire et se compare à sa propre demande ; l’écart d’un ordre ne masque pas celui d’un autre');
  it.todo('chaque ordre a un libellé distinct, et chaque ligne bancaire est reconnue par l’ordre qui la vire');
  it.todo('la ligne d’un ordre se ventile par l’ordre de financement parmi ses seules tirelires, recalculé au jour de l’opération');
  it.todo('le regroupement est un choix de l’utilisateur (fait déclaré) ; les montants des groupes restent des calculs jamais stockés');
  it.todo('une tirelire ajoutée sur le compte après la division est rattachée à un ordre, et le plan dit lequel est à modifier');
});
