/**
 * #206 — Le lien entre un ordre enregistré et son budget survit au renommage d'un compte (domaine
 * plan et flux, hypothèse 3 ; D11 amendée le 8 octobre 2026). Le plan affiche le libellé enregistré
 * avec l'ordre, l'import le reconnaît, et renommer le compte ne change ni l'un ni l'autre ; sans
 * ordre, le libellé tiré du nom actuel reste celui d'aujourd'hui.
 *
 * Tests du codeur, tous de niveau 4 : l'auditeur y choisit le harnais.
 */
import { describe, expect, it } from 'vitest';
import {
  computePlan,
  euros,
  exampleLedger,
  matchTirelireTransfers,
  normalizeLabel,
  standingTransferFlow,
  transferLabel,
  type Ledger,
  type Operation,
  type PlannedFlow,
} from '../src/index.js';

const PRINCIPAL = 'acc-principal';
const LIVRET = 'acc-livret';
const ORDRE = 'flow-vir-livret';
/** Mi-période « septembre » de l'exemple (28 août → 27 septembre). */
const LECTURE = '2026-09-06';

function renommer(l: Ledger, id: string, nom: string): Ledger {
  return { ...l, accounts: l.accounts.map((a) => (a.id === id ? { ...a, name: nom } : a)) };
}

/** L'ordre de l'exemple, sous l'identifiant `f.id`, avec `f` par-dessus ; une clé à `undefined` est retirée. */
function avecOrdre(l: Ledger, f: { [K in keyof PlannedFlow]?: PlannedFlow[K] | undefined } & { id: string }): Ledger {
  const base = l.plannedFlows.find((x) => x.id === ORDRE)!;
  const autre = { ...base, ...f } as Record<string, unknown>;
  for (const k of Object.keys(f)) if (autre[k] === undefined) delete autre[k];
  return { ...l, plannedFlows: [...l.plannedFlows.filter((x) => x.id !== f.id), autre as unknown as PlannedFlow] };
}

function sansOrdre(l: Ledger): Ledger {
  return { ...l, plannedFlows: l.plannedFlows.filter((f) => f.id !== ORDRE) };
}

function virement(l: Ledger, id = LIVRET, asOf = LECTURE) {
  return computePlan(l, asOf).transfers.find((t) => t.accountId === id);
}

function ligne(id: string, libellé: string, montant = euros(600), date = '2026-09-29'): Operation {
  return { id, accountId: PRINCIPAL, origin: 'imported', date, label: libellé, normalizedLabel: normalizeLabel(libellé), amount: -montant, state: 'untreated' };
}

function importer(l: Ledger, ...ops: Operation[]) {
  const avec: Ledger = { ...l, operations: [...l.operations, ...ops] };
  const patch = matchTirelireTransfers(avec);
  return { patch, vers: (id: string) => patch.operations.find((o) => o.id === id)?.transferAccountId };
}

describe('[niveau 4] #206 · le plan donne le libellé enregistré (point 1)', () => {
  it('le libellé de l’ordre comparé, et non celui tiré du nom', () => {
    const l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'VIR MAISON EPARGNE' });
    expect(virement(l)!.labels).toEqual(['VIR MAISON EPARGNE']);
  });

  it('plusieurs ordres : chaque libellé distinct une fois ; un ordre sans libellé n’en donne aucun', () => {
    let l = avecOrdre(exampleLedger(), { id: 'flow-b', labelPattern: 'VIR LIVRET B', amount: euros(-20) });
    l = avecOrdre(l, { id: 'flow-c', labelPattern: 'TIRELIRE LIVRET A', amount: euros(-10) });
    l = avecOrdre(l, { id: 'flow-d', labelPattern: undefined, amount: euros(-5) });
    expect([...virement(l)!.labels].sort()).toEqual(['TIRELIRE LIVRET A', 'VIR LIVRET B']);
    const seul = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: undefined });
    expect(virement(seul)!.labels).toEqual([]);
  });

  it('un compte sans ordre comparé garde le libellé tiré de son nom actuel', () => {
    const l = renommer(sansOrdre(exampleLedger()), LIVRET, 'Livret Bleu');
    expect(virement(l)!.labels).toEqual([transferLabel('Livret Bleu')]);
  });
});

describe('[niveau 4] #206 · renommer le compte ne change pas ce libellé (point 2)', () => {
  it('le plan affiche le libellé enregistré, nomme le compte par son nom actuel, et compare la même chose', () => {
    const avant = exampleLedger();
    const après = renommer(avant, LIVRET, 'Livret Bleu');
    const a = virement(avant)!;
    const b = virement(après)!;
    expect(b.labels).toEqual(['TIRELIRE LIVRET A']);
    expect(b.labels).not.toContain(transferLabel('Livret Bleu'));
    expect(b.accountName).toBe('Livret Bleu');
    expect({ permanent: b.permanent, bankOrder: b.bankOrder, proposal: b.proposal }).toEqual({ permanent: a.permanent, bankOrder: a.bankOrder, proposal: a.proposal });
    expect(après.plannedFlows.find((f) => f.id === ORDRE)).toEqual(avant.plannedFlows.find((f) => f.id === ORDRE));
    const signal = computePlan(après, LECTURE).warnings.find((w) => w.code === 'bankOrderDrift' && w.accountId === LIVRET);
    expect(signal?.message).toContain('« Livret Bleu »');
  });
});

describe('[niveau 4] #206 · enregistrer garde le libellé (point 3)', () => {
  it('un ordre enregistré depuis le plan prend le libellé que le plan affiche', () => {
    const l = renommer(sansOrdre(exampleLedger()), LIVRET, 'Livret Bleu');
    const plan = computePlan(l, LECTURE);
    const t = plan.transfers.find((x) => x.accountId === LIVRET)!;
    const f = standingTransferFlow(plan, t, PRINCIPAL, 'flow-neuf', euros(650))!;
    expect(f.labelPattern).toBe(t.labels[0]);
    expect(f.labelPattern).toBe(transferLabel('Livret Bleu'));
  });

  for (const renomme of [false, true])
    it(`un nouveau montant garde le libellé de l’ordre${renomme ? ', après un renommage' : ''}`, () => {
      let l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'VIR MAISON EPARGNE' });
      if (renomme) l = renommer(l, LIVRET, 'Livret Bleu');
      const plan = computePlan(l, LECTURE);
      const t = plan.transfers.find((x) => x.accountId === LIVRET)!;
      const existant = l.plannedFlows.find((f) => f.id === ORDRE)!;
      const f = standingTransferFlow(plan, t, PRINCIPAL, 'inutile', euros(700), existant)!;
      expect(f.id).toBe(ORDRE);
      expect(f.amount).toBe(euros(-700));
      expect(f.labelPattern).toBe('VIR MAISON EPARGNE');
    });
});

describe('[niveau 4] #206 · l’import reconnaît le libellé enregistré (point 4)', () => {
  it('le libellé d’un ordre la reconnaît comme sa sélection, même sans « TIRELIRE »', () => {
    const l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'VIR(EMENT)? MAISON' });
    const { patch, vers } = importer(l, ligne('op-1', 'VIREMENT MAISON 09'));
    expect(vers('op-1')).toBe(LIVRET);
    expect(patch.subOperations).toEqual([]);
    expect(patch.operations.find((o) => o.id === 'op-1')!.state).toBe('reconciled');
  });

  it('un ordre terminé à la date de l’opération la reconnaît encore (relevé ancien)', () => {
    const l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'VIR MAISON', activeTo: '2026-08-31' });
    expect(importer(l, ligne('op-1', 'VIR MAISON', euros(600), '2026-09-29')).vers('op-1')).toBe(LIVRET);
  });

  it('le libellé tiré du nom d’un compte qui a un ordre ne reconnaît rien pour lui', () => {
    const l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'VIR MAISON' });
    expect(importer(l, ligne('op-1', 'VIR PERMANENT TIRELIRE LIVRET A')).vers('op-1')).toBeUndefined();
  });

  it('un compte sans ordre se reconnaît par le libellé tiré de son nom actuel', () => {
    const l = sansOrdre(exampleLedger());
    expect(importer(l, ligne('op-1', 'VIR PERMANENT TIRELIRE LIVRET A')).vers('op-1')).toBe(LIVRET);
  });

  it('le libellé d’un ordre l’emporte sur un libellé tiré d’un nom, même plus long', () => {
    // « Livret A Maison », sans ordre, se reconnaît par « LIVRET A MAISON » ; l'ordre du Livret A, par « MAISON ».
    let l = avecOrdre(exampleLedger(), { id: ORDRE, labelPattern: 'MAISON' });
    l = { ...l, accounts: [...l.accounts, { id: 'acc-lam', name: 'Livret A Maison', kind: 'epargne', openingBalance: 0, openingDate: '2026-08-27' }] };
    expect(importer(l, ligne('op-1', 'VIR TIRELIRE LIVRET A MAISON')).vers('op-1')).toBe(LIVRET);
  });

  it('entre libellés de même sorte, le plus long ; à égalité, aucun compte', () => {
    const autre = { id: 'acc-autre', name: 'Autre livret', kind: 'epargne' as const, openingBalance: 0, openingDate: '2026-08-27' };
    let l: Ledger = { ...exampleLedger(), accounts: [...exampleLedger().accounts, autre] };
    l = avecOrdre(l, { id: ORDRE, labelPattern: 'VIR MAISON' });
    l = avecOrdre(l, { id: 'flow-autre', counterpartAccountId: 'acc-autre', labelPattern: 'VIR MAISON BIS', action: undefined });
    expect(importer(l, ligne('op-1', 'VIR MAISON BIS')).vers('op-1')).toBe('acc-autre');
    const égal = avecOrdre(l, { id: 'flow-autre', counterpartAccountId: 'acc-autre', labelPattern: 'MAISON XYZ', action: undefined });
    // « VIR MAISON » et « MAISON XYZ » ont la même longueur et la reconnaissent tous deux.
    const r = importer(égal, ligne('op-2', 'VIR MAISON XYZ'));
    expect(r.vers('op-2')).toBeUndefined();
    expect(r.patch.operations.map((o) => o.id)).not.toContain('op-2');
  });

  it('ne touche ni une opération verrouillée, ni une qui reprend, ni une déjà reconnue', () => {
    const l = exampleLedger();
    const verrouillée = { ...ligne('op-v', 'VIR TIRELIRE LIVRET A'), state: 'locked' as const };
    const reprend = { ...ligne('op-r', 'VIR TIRELIRE LIVRET A'), plannedFlowId: ORDRE, plannedDate: '2026-09-28' };
    const reconnue = { ...ligne('op-d', 'VIR TIRELIRE LIVRET A'), transferAccountId: 'acc-enfants' };
    expect(importer(l, verrouillée, reprend, reconnue).patch.operations).toEqual([]);
  });
});

describe('[niveau 4] #206 · renommer ne change pas ce qui est reconnu (point 5)', () => {
  it('après renommage, le libellé enregistré se reconnaît, celui du nouveau nom non, et une opération reconnue garde son compte', () => {
    const avant = exampleLedger();
    const déjà = { ...ligne('op-0', 'VIR PERMANENT TIRELIRE LIVRET A', euros(600), '2026-08-29'), state: 'reconciled' as const, transferAccountId: LIVRET };
    const après = renommer({ ...avant, operations: [...avant.operations, déjà] }, LIVRET, 'Livret Bleu');
    const r = importer(après, ligne('op-1', 'VIR PERMANENT TIRELIRE LIVRET A'), ligne('op-2', 'VIR PERMANENT TIRELIRE LIVRET BLEU'));
    expect(r.vers('op-1')).toBe(LIVRET);
    expect(r.vers('op-2')).toBeUndefined();
    expect(r.patch.operations.map((o) => o.id)).not.toContain('op-0');
  });
});
