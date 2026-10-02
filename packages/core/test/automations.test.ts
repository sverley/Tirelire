import { describe, expect, it } from 'vitest';
import {
  applyBulkAction,
  applyPatchToLedger,
  applyAutomations,
  euros,
  exampleLedger,
  inferSelection,
  outcomeFor,
  previewAutomations,
  rankBetween,
  applyMatch,
  automationsByRank,
  proposeMatches,
  selects,
  topRank,
  type Ledger,
  type Operation,
  type Automation,
} from '../src/index.js';

function op(id: string, label: string, amount: number, extra: Partial<Operation> = {}): Operation {
  return {
    id,
    accountId: 'acc-principal',
    origin: 'imported',
    date: '2026-09-03',
    label,
    normalizedLabel: label,
    amount,
    state: 'untreated',
    ...extra,
  };
}

function withOps(...ops: Operation[]): Ledger {
  const l = exampleLedger();
  l.operations.push(...ops);
  return l;
}

const rule = (r: Partial<Automation> & Pick<Automation, 'id' | 'rank'>): Automation => ({ selection: {}, action: {}, ...r });

describe('[niveau 1] harnais du registre · I3 (U5), I6', () => {
  describe('rangs triables (D31)', () => {
    it('insère toujours une clé entre deux voisines, même serrées', () => {
      const a = rankBetween(undefined, undefined);
      const b = rankBetween(a, undefined);
      expect(b > a).toBe(true);
      const between = rankBetween(a, b);
      expect(between > a && between < b).toBe(true);
      // Deux appareils qui insèrent au même endroit produisent des clés différentes, pas un doublon.
      let x = a;
      for (let i = 0; i < 30; i++) {
        const next = rankBetween(x, b);
        expect(next > x && next < b).toBe(true);
        x = next;
      }
    });

    it('les règles s’appliquent du rang le plus élevé au rang 1', () => {
      const l = withOps();
      l.automations.push(rule({ id: 'r-bas', rank: 'a' }), rule({ id: 'r-haut', rank: 'z' }));
      expect(automationsByRank(l).map((r) => r.id)).toEqual(['r-haut', 'r-bas']);
      expect(topRank(l) > 'z').toBe(true);
    });
  });

  describe('sélection (D23)', () => {
    it('tous les critères renseignés doivent être remplis', () => {
      const o = op('o1', 'SUPERMARCHE CASINO', euros(-42));
      expect(selects({ labelPattern: 'CASINO' }, o)).toBe(true);
      expect(selects({ labelPattern: 'CASINO', amountMin: euros(-50), amountMax: euros(-10) }, o)).toBe(true);
      expect(selects({ labelPattern: 'CASINO', amountMax: euros(-50) }, o)).toBe(false);
      expect(selects({ accountId: 'acc-livret' }, o)).toBe(false);
      expect(selects({ dateFrom: '2026-10-01' }, o)).toBe(false);
    });

    it('un motif invalide ne sélectionne rien plutôt que de faire échouer le passage', () => {
      expect(selects({ labelPattern: '[' }, op('o1', 'X', -1))).toBe(false);
    });
  });

  describe('moteur de règles (D23)', () => {
    it('le rang le plus élevé écrase, les champs vides laissent en place', () => {
      const rules = [
        rule({ id: 'haut', rank: 'z', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim' } }),
        rule({ id: 'bas', rank: 'a', selection: {}, action: { categoryId: 'cat-sante', oneOff: true, state: 'reconcile' } }),
      ];
      const out = outcomeFor(op('o1', 'SUPERMARCHE', euros(-40)), rules, new Map());
      // La catégorie vient du rang élevé ; l'état et « ponctuelle » du rang bas, que rien n'écrase.
      expect(out.allocation[0]!.categoryId).toBe('cat-alim');
      expect(out.oneOff).toBe(true);
      expect(out.state).toBe('reconciled');
      expect(out.by).toEqual(['haut', 'bas']);
    });

    it('« Ne rien faire » classe sans traiter : la distinction doit rester visible', () => {
      const out = outcomeFor(
        op('o1', 'EDF', euros(-90)),
        [rule({ id: 'r', rank: 'm', selection: { labelPattern: 'EDF' }, action: { categoryId: 'cat-energie', state: 'none' } })],
        new Map(),
      );
      expect(out.allocation.length).toBe(1);
      expect(out.state).toBe('untreated');
    });

    it('le rejeu est idempotent et une règle retirée défait ce qu’elle avait posé', () => {
      let l = withOps(op('o1', 'SUPERMARCHE', euros(-40)));
      l.automations.push(rule({ id: 'r', rank: 'm', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim', state: 'reconcile' } }));
      l = applyPatchToLedger(l, applyAutomations(l));
      expect(l.operations.find((o) => o.id === 'o1')!.state).toBe('reconciled');
      expect(l.subOperations.filter((a) => a.operationId === 'o1').length).toBe(1);
      // Deuxième passage : rien ne bouge.
      expect(applyAutomations(l).operations.length).toBe(0);
      // Règle retirée : l'opération revient à rien.
      l.automations = [];
      l = applyPatchToLedger(l, applyAutomations(l));
      expect(l.operations.find((o) => o.id === 'o1')!.state).toBe('untreated');
      expect(l.subOperations.filter((a) => a.operationId === 'o1').length).toBe(0);
    });

    describe('[niveau 0] D22 · la vérité est ce qui est verrouillé', () => {
      it('une opération verrouillée est hors d’atteinte', () => {
        const l = withOps(op('o1', 'SUPERMARCHE', euros(-40), { state: 'locked' }));
        l.automations.push(rule({ id: 'r', rank: 'm', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim', state: 'reconcile' } }));
        expect(applyAutomations(l).operations.length).toBe(0);
        expect(previewAutomations(l).some((d) => d.operation.id === 'o1')).toBe(false);
      });
    });

    describe('[niveau 0] D33 · ce que l’import a établi ne se perd pas', () => {
      it('ce que l’import a établi survit au passage des règles (D33)', () => {
        const l = withOps(op('o1', 'VIR LIVRET', euros(-100), { transferAccountId: 'acc-livret' }));
        l.subOperations.push({ id: 'al1', operationId: 'o1', tirelireId: 'env-vacances', share: { kind: 'variable' } });
        const patch = applyAutomations(l);
        // La ventilation posée par l'appariement survit ; seul l'état suit (le virement est rapproché).
        expect(patch.removedSubOperations).toEqual([]);
        // La ligne est réécrite à l'identique (même identifiant), pas remplacée.
        expect(patch.subOperations.map((a) => [a.id, a.tirelireId])).toEqual([['al1', 'env-vacances']]);
        expect(patch.operations[0]!.state).toBe('reconciled');
      });
    });

    it('l’aperçu montre l’avant et l’après sans rien écrire', () => {
      const l = withOps(op('o1', 'SUPERMARCHE', euros(-40)));
      const essai = rule({ id: 'essai', rank: 'm', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim', state: 'reconcile' } });
      const diffs = previewAutomations(l, essai).filter((d) => d.changed);
      expect(diffs.length).toBe(1);
      expect(diffs[0]!.before.allocation).toEqual([]);
      expect(diffs[0]!.after.allocation[0]!.categoryId).toBe('cat-alim');
      // Rien n'a été enregistré : la règle d'essai n'est pas dans le grand livre.
      expect(l.automations.find((r) => r.id === 'essai')).toBeUndefined();
    });

    it('la catégorie apporte son tirelire par défaut (D32)', () => {
      const l = withOps(op('o1', 'SUPERMARCHE', euros(-40)));
      l.automations.push(rule({ id: 'r', rank: 'm', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim', state: 'reconcile' } }));
      const patch = applyAutomations(l);
      expect(patch.subOperations[0]!.tirelireId).toBe('env-alim');
    });
  });

  describe('actions groupées (D26)', () => {
    describe('[niveau 0] D22 · la vérité est ce qui est verrouillé', () => {
      it('verrouille par défaut, et peut déverrouiller — ce qu’une règle ne peut pas', () => {
        const l = withOps(op('o1', 'A', euros(-10)), op('o2', 'B', euros(-20), { state: 'locked' }));
        const lock = applyBulkAction(l, ['o1'], { categoryId: 'cat-alim' });
        expect(lock.operations[0]!.state).toBe('locked');
        const free = applyBulkAction(l, ['o2'], { state: 'unlock' });
        expect(free.operations[0]!.state).toBe('untreated');
      });
    });

    it('ne laisse que ses effets : rien n’est enregistré qui puisse se rejouer', () => {
      let l = withOps(op('o1', 'A', euros(-10)));
      const rulesBefore = l.automations.length;
      l = applyPatchToLedger(l, applyBulkAction(l, ['o1'], { oneOff: true }));
      expect(l.automations.length).toBe(rulesBefore);
      expect(l.operations.find((o) => o.id === 'o1')!.oneOff).toBe(true);
    });

    it('une sélection manuelle propose un filtre qui la reproduit', () => {
      const sel = inferSelection([op('o1', 'SUPERMARCHE CASINO PARIS', euros(-40)), op('o2', 'SUPERMARCHE CASINO LYON', euros(-60))]);
      expect(sel.labelPattern).toBe('SUPERMARCHE.*CASINO');
      expect(sel.accountId).toBe('acc-principal');
      expect(selects(sel, op('o3', 'SUPERMARCHE CASINO NICE', euros(-50)))).toBe(true);
    });
  });

  describe('le flux reprend ce que sa sélection reconnaît, sans automatisme à part (D24, #306)', () => {
    /** L'échéance du crédit du 5 septembre, au relevé. */
    const échéance = (extra: Partial<Operation> = {}) => op('o-credit', 'ECHEANCE PRET IMMO', euros(-950), { date: '2026-09-05', ...extra });

    it('un flux qui verrouille fait verrouiller ce qu’il reprend : il porte toute la classification', () => {
      const l = withOps(échéance());
      l.plannedFlows.find((f) => f.id === 'flow-credit')!.locks = true;
      const m = proposeMatches(l, '2026-09-01', '2026-09-30').find((p) => p.operationId === 'o-credit')!;
      expect(m.flowId).toBe('flow-credit');
      const après = applyPatchToLedger(l, applyMatch(l, m)).operations.find((o) => o.id === 'o-credit')!;
      expect(après.state).toBe('locked');
      // Aucun automatisme n'est engendré : la liste des automatismes est celle d'avant.
      expect(l.automations).toEqual(exampleLedger().automations);
    });

    describe('[niveau 0] D24 · le passé déjà classé n’est pas réécrit', () => {
      it('modifier le flux ne réécrit aucune opération déjà reprise', () => {
        let l = withOps(échéance());
        const m = proposeMatches(l, '2026-09-01', '2026-09-30').find((p) => p.operationId === 'o-credit')!;
        l = applyPatchToLedger(l, applyMatch(l, m));
        const avant = { op: l.operations.find((o) => o.id === 'o-credit')!, subs: l.subOperations.filter((s) => s.operationId === 'o-credit') };
        expect(avant.subs.map((s) => s.categoryId)).toEqual(['cat-logement']);

        // Le flux change de montant et de catégorie : ce qu'il a repris garde ce qu'il a pris.
        l.plannedFlows = l.plannedFlows.map((f) => (f.id === 'flow-credit' ? { ...f, amount: euros(-1000), categoryId: 'cat-alim' } : f));
        l = applyPatchToLedger(l, applyAutomations(l));
        expect(l.operations.find((o) => o.id === 'o-credit')).toEqual(avant.op);
        expect(l.subOperations.filter((s) => s.operationId === 'o-credit')).toEqual(avant.subs);
      });
    });

    it('un flux à montant variable ne contraint pas le montant, et ne reprend jamais sans confirmation', () => {
      const l = withOps(op('o-sal', 'VIR SALAIRE SEPT', euros(3600), { date: '2026-09-28' }));
      const m = proposeMatches(l, '2026-09-01', '2026-09-30').find((p) => p.operationId === 'o-sal');
      expect(m?.flowId).toBe('flow-salaire');
      expect(m?.auto).toBe(false);
    });

    it('retirer le verrouillage du flux ne déverrouille pas ce qu’il a déjà repris', () => {
      let l = withOps(échéance());
      l.plannedFlows.find((f) => f.id === 'flow-credit')!.locks = true;
      l = applyPatchToLedger(l, applyMatch(l, proposeMatches(l, '2026-09-01', '2026-09-30').find((p) => p.operationId === 'o-credit')!));
      l.plannedFlows = l.plannedFlows.map((f) => (f.id === 'flow-credit' ? { ...f, locks: false } : f));
      l = applyPatchToLedger(l, applyAutomations(l));
      expect(l.operations.find((o) => o.id === 'o-credit')!.state).toBe('locked');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Témoins rouges des harnais U5 et I6 (docs/gardes.md) : les assertions du moteur de règles et de
  // l'aperçu, rejouées sur des versions volontairement cassées du besoin.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  it.fails('témoin rouge · un moteur de règles qui applique les rangs à l’envers', () => {
    const rules = [
      rule({ id: 'haut', rank: 'z', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim' } }),
      rule({ id: 'bas', rank: 'a', selection: {}, action: { categoryId: 'cat-sante', oneOff: true, state: 'reconcile' } }),
    ];
    // Version cassée : les règles sont parcourues dans l'ordre inverse des rangs, donc la règle
    // générale écrase la règle précise — classer « toutes les opérations semblables » ne veut plus
    // rien dire.
    const àLEnvers = [...rules].reverse();
    const out = outcomeFor(op('o1', 'SUPERMARCHE', euros(-40)), àLEnvers, new Map());

    expect(out.allocation[0]!.categoryId).toBe('cat-alim');
    expect(out.by).toEqual(['haut', 'bas']);
  });

  it.fails('témoin rouge · un aperçu de règle qui enregistre la règle d’essai', () => {
    const l = withOps(op('o1', 'SUPERMARCHE', euros(-40)));
    const essai = rule({ id: 'essai', rank: 'm', selection: { labelPattern: 'SUPERMARCHE' }, action: { categoryId: 'cat-alim', state: 'reconcile' } });
    // Version cassée : l'aperçu écrit la règle d'essai dans le grand livre avant de calculer. Ce
    // qu'on croyait regarder est déjà appliqué.
    l.automations.push(essai);
    const diffs = previewAutomations(l, essai).filter((d) => d.changed);

    expect(diffs.length).toBe(1);
    expect(l.automations.find((r) => r.id === 'essai')).toBeUndefined();
  });
});
