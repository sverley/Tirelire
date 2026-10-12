/**
 * Tests du codeur de #445, second tour — le point 6 amendé (porteur, 12/10) : « L'aperçu, qui se
 * refait à chaque choix d'un flux, et « Appliquer » se calculent sans attente : au cœur, avec 2 000
 * cibles concernées et un flux mensuel qui a au moins autant d'occurrences libres, chacun en moins
 * d'une seconde ». Et un diagnostic : le service des couples (`bulkOccurrencePlan`) rend ce que rend
 * le tri de tous les couples, sur des décors tirés au hasard. Données inventées (D84).
 */
import { describe, expect, it } from 'vitest';
import {
  applyBulkOccurrence,
  applyPatchToLedger,
  bulkOccurrencePlan,
  correctPlannedOperation,
  diffDays,
  emptyLedger,
  euros,
  occurrencesBetween,
  addDays,
  type Ledger,
  type Operation,
  type PlannedFlow,
} from '../src/index.js';

const CC = 'cc';

function flux(f: Partial<PlannedFlow> & Pick<PlannedFlow, 'id' | 'name' | 'amount'>): PlannedFlow {
  return { kind: 'income', accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2000-01-25' }, dateWindowDays: 3, ...f };
}

function opération(o: Partial<Operation> & Pick<Operation, 'id' | 'date' | 'amount'>): Operation {
  return { accountId: CC, origin: 'imported', label: o.id.toUpperCase(), normalizedLabel: o.id.toUpperCase(), state: 'untreated', ...o };
}

/** Un compte, une paie mensuelle depuis janvier 2000, classée, et `n` paies importées datées par `date(i)`. */
function décor(n: number, date: (i: number) => string): Ledger {
  const l = emptyLedger({ periodStartDay: 1 });
  l.accounts.push({ id: CC, name: 'Compte courant', kind: 'principal', openingBalance: 0, openingDate: '1999-12-31' });
  l.categories.push({ id: 'cat-salaire', name: 'Salaire', nature: 'income' });
  l.plannedFlows.push(flux({ id: 'f-paie', name: 'Paie', amount: euros(2500), action: { categoryId: 'cat-salaire' } }));
  for (let i = 0; i < n; i++) l.operations.push(opération({ id: `op-${String(i).padStart(5, '0')}`, date: date(i), amount: euros(2400) + i }));
  return l;
}

/** La durée d'un calcul, en millisecondes. */
function durée<T>(calcul: () => T): { ms: number; r: T } {
  const t0 = performance.now();
  const r = calcul();
  return { ms: performance.now() - t0, r };
}

describe('[niveau 4] #445 · 6. l’aperçu et « Appliquer » se calculent sans attente (porteur, 12/10)', () => {
  const cas: Array<[string, (i: number) => string]> = [
    // Une paie tous les quinze jours, de 2000 à 2082 : autant d'occurrences libres que de cibles, et plus.
    ['étalées', (i) => addDays('2000-01-19', 15 * i)],
    // Toutes le même jour : chaque cible dispute à toutes les autres les mêmes occurrences.
    ['toutes le même jour', () => '2026-12-19'],
    // Par grappes de cent, un mois sur deux.
    ['par grappes', (i) => addDays('2010-01-19', 61 * Math.floor(i / 100))],
  ];
  for (const [nom, date] of cas) {
    it(`2 000 cibles concernées, ${nom} : l’aperçu, puis « Appliquer », chacun en moins d’une seconde`, () => {
      const l = décor(2000, date);
      const ids = l.operations.map((o) => o.id);
      const aperçu = durée(() => bulkOccurrencePlan(l, ids, 'f-paie'));
      const appliquer = durée(() => applyBulkOccurrence(l, ids, 'f-paie'));
      expect(aperçu.r.filter((o) => o.occurrence)).toHaveLength(2000);
      expect(appliquer.r.operations).toHaveLength(2000);
      expect(new Set(appliquer.r.operations.map((o) => o.plannedDate)).size, 'une occurrence prise deux fois').toBe(2000);
      expect(aperçu.ms, `aperçu : ${Math.round(aperçu.ms)} ms`).toBeLessThan(1000);
      expect(appliquer.ms, `« Appliquer » : ${Math.round(appliquer.ms)} ms`).toBeLessThan(1000);
    });
  }
});

/**
 * La référence : tous les couples d'une cible et d'une occurrence libre, triés (point 6), servis un à
 * un. Sur un petit décor seulement : elle croît comme le produit des cibles et des occurrences.
 */
function référence(l: Ledger, ids: string[], f: PlannedFlow, jusquA: string): Map<string, string> {
  const pris = new Set(l.operations.filter((o) => !o.deletedAt && o.plannedFlowId === f.id && (o.origin !== 'manual' || l.operations.some((x) => x.resumedOperationId === o.id))).map((o) => o.plannedDate));
  const libres = occurrencesBetween(f.periodicity, f.periodicity.anchorDate, jusquA).filter((d) => !pris.has(d) && (!f.activeTo || d <= f.activeTo));
  const cibles = l.operations.filter((o) => ids.includes(o.id) && o.origin === 'imported' && !o.plannedFlowId && !o.resumedOperationId);
  const couples = cibles.flatMap((op) => libres.map((d) => ({ op, d, j: Math.abs(diffDays(op.date, d)) })));
  couples.sort((a, b) => a.j - b.j || (a.op.date < b.op.date ? -1 : a.op.date > b.op.date ? 1 : 0) || (a.d < b.d ? -1 : a.d > b.d ? 1 : 0) || (a.op.id < b.op.id ? -1 : 1));
  const out = new Map<string, string>();
  const servies = new Set<string>();
  for (const c of couples) {
    if (out.has(c.op.id) || servies.has(c.d)) continue;
    out.set(c.op.id, c.d);
    servies.add(c.d);
  }
  return out;
}

/** Un tirage reproductible. */
function hasard(graine: number): () => number {
  let x = graine;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

describe('[niveau 4] #445 · 6. diagnostic — le service des couples rend celui de la référence', () => {
  it('sur 300 décors tirés au hasard : cibles groupées ou non, occurrences déjà prises, saisies, fin de validité', () => {
    for (let k = 0; k < 300; k++) {
      const h = hasard(k + 1);
      const n = 1 + Math.floor(h() * 12);
      let l = décor(n, () => addDays('2026-06-01', Math.floor(h() * 240) - (h() < 0.3 ? 0 : Math.floor(h() * 3))));
      const f = l.plannedFlows[0]!;
      f.periodicity = { interval: 1, unit: 'month', anchorDate: '2026-05-25' };
      if (h() < 0.4) f.activeTo = addDays('2026-06-01', 100 + Math.floor(h() * 200));
      // Quelques occurrences déjà prises par une opération du relevé, ou corrigées par une saisie.
      for (const d of occurrencesBetween(f.periodicity, '2026-05-25', '2027-06-30')) {
        const r = h();
        if (r < 0.15) l.operations.push(opération({ id: `pris-${d}`, date: d, amount: euros(2500), plannedFlowId: f.id, plannedDate: d, state: 'reconciled' }));
        else if (r < 0.25) l = applyPatchToLedger(l, correctPlannedOperation(l, f.id, d, euros(2450), d));
      }
      const ids = l.operations.filter((o) => o.id.startsWith('op-')).map((o) => o.id);
      const attendu = référence(l, ids, f, '2028-12-31');
      const rendu = new Map(bulkOccurrencePlan(l, ids, f.id).flatMap((o) => (o.occurrence ? [[o.operationId, o.occurrence.date] as const] : [])));
      expect(rendu, `décor ${k}`).toEqual(attendu);
    }
  });
});
