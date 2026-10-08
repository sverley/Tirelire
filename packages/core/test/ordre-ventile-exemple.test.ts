/**
 * Tests du codeur de #395 — « L'exemple porte un ordre permanent ventilé, que l'assistant propose ».
 * Côté cœur : l'ordre de l'exemple et sa ventilation (point 1), ce que le plan du 6 septembre en
 * signale (point 2), ce que montrent ses parts quand le montant change (point 4), les parts dont la
 * tirelire manque (point 5) et l'ordre que reproduit la proposition (point 7). Ce que l'écran en dit
 * est dans `apps/web/test/navigateur/ordre-ventile-assistant.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { alive, budgetSuggestions, computePlan, euros, exampleLedger, orderPartsShown, suggestedOrder, type Ledger, type PlannedFlow } from '../src/index.js';

const LECTURE = '2026-09-06';
const ordreDe = (l: Ledger) => l.plannedFlows.find((f) => f.id === 'flow-vir-livret')!;
const virementLivret = (l: Ledger) => computePlan(l, LECTURE).transfers.find((t) => t.accountId === 'acc-livret')!;
const nom = (l: Ledger, id?: string) => l.tirelires.find((t) => t.id === id)?.name;
const sansAction = ({ action: _a, ...f }: PlannedFlow): PlannedFlow => f;
const proposition = () => budgetSuggestions().orders.find((o) => o.name === 'Virement Livret A')!;

describe('point 1 : l’ordre de l’exemple porte sa ventilation', () => {
  it('[niveau 4] 600 € du principal vers le Livret A, quatre parts de tirelire sans catégorie, une seule variable', () => {
    const l = exampleLedger();
    const f = ordreDe(l);
    expect(f).toMatchObject({ kind: 'transfer', amount: euros(-600), accountId: 'acc-principal', counterpartAccountId: 'acc-livret', labelPattern: 'TIRELIRE LIVRET A', dateWindowDays: 5, amountTolerance: { pct: 20 } });
    expect(f.periodicity).toEqual({ interval: 1, unit: 'month', anchorDate: '2026-08-28' });
    const parts = f.action!.allocation!.map((a) => ({ nom: nom(l, a.tirelireId), share: a.share, cat: a.categoryId }));
    expect(parts).toEqual([
      { nom: 'Taxe foncière', share: { kind: 'fixed', amount: euros(-100) }, cat: undefined },
      { nom: 'Assurance auto', share: { kind: 'fixed', amount: euros(-50) }, cat: undefined },
      { nom: 'Vacances', share: { kind: 'fixed', amount: euros(-150) }, cat: undefined },
      { nom: 'Épargne de précaution', share: { kind: 'variable' }, cat: undefined },
    ]);
    expect(orderPartsShown(f, l).at(-1)!.amount).toBe(euros(300));
    expect(alive(l.operations).some((o) => o.transferAccountId === 'acc-livret' || /LIVRET/.test(o.normalizedLabel ?? ''))).toBe(false);
  });
});

describe('point 2 : le plan du 6 septembre signale l’écart du montant et celui de la part de Vacances', () => {
  it('[niveau 4] 650 € demandés, détail 100/50/200/300 ; ordre et Vacances signalés, rien d’autre', () => {
    const l = exampleLedger();
    const t = virementLivret(l);
    expect(t.permanent).toBe(euros(650));
    expect(Object.fromEntries(t.breakdown.map((b) => [nom(l, b.tirelireId), b.cruise]))).toEqual({
      'Taxe foncière': euros(100), 'Assurance auto': euros(50), Vacances: euros(200), 'Épargne de précaution': euros(300),
    });
    expect(t.bankOrder).toMatchObject({ amount: euros(600), drift: euros(50), signaled: true });
    const signalees = t.bankOrder!.parts.filter((p) => p.signaled).map((p) => [p.tirelireName, p.amount, p.requested]);
    expect(signalees).toEqual([['Vacances', euros(150), euros(200)]]);
    expect(t.bankOrder!.parts.map((p) => p.tirelireName).sort()).toEqual(['Assurance auto', 'Taxe foncière', 'Vacances']);
  });
  it('[niveau 4] hors de ces signalements, le plan du 6 septembre est celui de l’exemple sans ventilation', () => {
    const avec = exampleLedger();
    const sans: Ledger = { ...avec, plannedFlows: avec.plannedFlows.map((f) => (f.id === 'flow-vir-livret' ? sansAction(f) : f)) };
    const efface = (l: Ledger) => {
      const p = computePlan(l, LECTURE);
      return {
        ...p,
        transfers: p.transfers.map((t) => (t.bankOrder ? { ...t, bankOrder: { ...t.bankOrder, parts: [] } } : t)),
        warnings: p.warnings.filter((w) => w.code !== 'bankOrderPartDrift'),
      };
    };
    expect(efface(avec)).toEqual(efface(sans));
    expect(computePlan(avec, LECTURE).warnings.filter((w) => w.code === 'bankOrderPartDrift').map((w) => w.tirelireId)).toEqual(['env-vac']);
  });
});

describe('point 4 : corriger le montant ne touche pas les parts fixes', () => {
  it.each([[800, 500], [600, 300], [250, 0]])('[niveau 4] à %i €, les parts fixes restent, la variable vaut %i €', (montant, reste) => {
    const l = exampleLedger();
    const f = { ...ordreDe(l), amount: euros(-montant) };
    expect(orderPartsShown(f, l).map((p) => p.amount)).toEqual([euros(100), euros(50), euros(150), euros(reste)]);
  });
});

describe('points 5 et 7 : l’ordre que crée la proposition', () => {
  const compte = (n: string) => ({ 'Livret A': 'liv' })[n];
  it('[niveau 4] avec les quatre tirelires, il reproduit l’ordre de l’exemple sur les tirelires de même nom', () => {
    const ids: Record<string, string> = { 'Taxe foncière': 't1', 'Assurance auto': 't2', Vacances: 't3', 'Épargne de précaution': 't4' };
    const f = suggestedOrder(proposition(), { id: 'o', principalId: 'pr', compte, tirelire: (n) => ids[n] })!;
    expect(f.amount).toBe(euros(-600));
    expect(f.action!.allocation).toEqual([
      { tirelireId: 't1', share: { kind: 'fixed', amount: euros(-100) } },
      { tirelireId: 't2', share: { kind: 'fixed', amount: euros(-50) } },
      { tirelireId: 't3', share: { kind: 'fixed', amount: euros(-150) } },
      { tirelireId: 't4', share: { kind: 'variable' } },
    ]);
  });
  it('[niveau 4] une tirelire absente : sa part n’est pas posée, les autres restent, le montant ne change pas', () => {
    const ids: Record<string, string> = { 'Taxe foncière': 't1', 'Épargne de précaution': 't4' };
    const f = suggestedOrder(proposition(), { id: 'o', principalId: 'pr', compte, tirelire: (n) => ids[n] })!;
    expect(f.amount).toBe(euros(-600));
    expect(f.action!.allocation!.map((a) => a.tirelireId)).toEqual(['t1', 't4']);
  });
  it('[niveau 4] sans tirelire, l’ordre se propose sans part ; sans son compte d’arrivée, il ne se propose pas', () => {
    const f = suggestedOrder(proposition(), { id: 'o', principalId: 'pr', compte, tirelire: () => undefined })!;
    expect(f.action).toBeUndefined();
    expect(suggestedOrder(proposition(), { id: 'o', principalId: 'pr', compte: () => undefined, tirelire: () => 'x' })).toBeUndefined();
  });
  it('[niveau 4] une part montrée dont la tirelire a été retirée n’est pas montrée', () => {
    const l = exampleLedger();
    const sansVac: Ledger = { ...l, tirelires: l.tirelires.filter((t) => t.id !== 'env-vac') };
    expect(orderPartsShown(ordreDe(l), sansVac).map((p) => [p.tirelireName, p.amount])).toEqual([
      ['Taxe foncière', euros(100)], ['Assurance auto', euros(50)], ['Épargne de précaution', euros(450)],
    ]);
  });
});
