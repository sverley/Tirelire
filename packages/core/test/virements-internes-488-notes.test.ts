/**
 * Tests du codeur de #488, sixième tour : le point 8, « Le mieux noté ne l'emporte que s'il se
 * distingue » (porteur, 16/10, sur la remarque de l'auditeur au cinquième tour). Tous de niveau 4.
 * Le piège de l'ordre et de la dépense et la règle des notes sont passés au harnais
 * (`virements-internes-harnais.test.ts`) ; le diagnostic des seuils, qui recopiait un réglage, est
 * retiré (D78). Reste l'hypothèse du codeur sur l'égalité au plus haut.
 *
 * Septième tour : la même règle dans l'autre sens, pour une occurrence que plusieurs opérations se
 * disputent (porteur, 16/10, après le sixième tour), et le piège du doublon.
 *
 * Données inventées (D84) : un compte principal et des charges.
 */
import { describe, expect, it } from 'vitest';
import { applyMatch, applyPatchToLedger, emptyLedger, euros, normalizeLabel, proposeMatches, type Ledger, type Operation, type PlannedFlow } from '../src/index.js';

const CC = 'acc-principal';
const DU = '2026-03-25';
const AU = '2026-04-15';

function op(id: string, accountId: string, date: string, label: string, amount: number): Operation {
  return { id, accountId, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated' };
}

/** Un flux mensuel du principal, ancré au jour donné, de fenêtre 5 jours, sauf ce que le test change. */
function flux(o: Partial<PlannedFlow> & Pick<PlannedFlow, 'id' | 'kind' | 'amount'>, jour: string, fenetre = 5): PlannedFlow {
  return { name: o.id, accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: `2026-01-${jour}` }, dateWindowDays: fenetre, ...o };
}

function base(flows: PlannedFlow[], ...operations: Operation[]): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2025-12-31' },
  );
  l.plannedFlows.push(...flows);
  l.operations.push(...operations);
  return l;
}

const reprises = (l: Ledger) => proposeMatches(l, DU, AU).map((p) => [p.operationId, p.flowId, Math.round(p.score * 100) / 100, p.auto]);

describe('#488 · 8. le mieux noté ne l’emporte que s’il se distingue, pour toute opération', () => {
  const PRLV = op('o', CC, '2026-04-07', 'PRLV GAZ', -euros(50));

  it('[niveau 4] à égalité au plus haut, même basse (0,55 et 0,55) : aucun n’est le mieux noté, chacun se propose (hypothèse du codeur)', () => {
    const a = flux({ id: 'a', kind: 'fixedCharge', amount: -euros(50) }, '02', 5);
    const b = flux({ id: 'b', kind: 'fixedCharge', amount: -euros(50) }, '12', 5);
    expect(reprises(base([a, b], PRLV)).sort()).toEqual([
      ['o', 'a', 0.55, false],
      ['o', 'b', 0.55, false],
    ]);
  });
});

describe('#488 · 8. la même règle dans l’autre sens : une occurrence que plusieurs opérations se disputent', () => {
  // Le piège du doublon : un loyer de 700 €, sans motif, le 5 de chaque mois, fenêtre de 5 jours.
  const LOYER = flux({ id: 'loyer', kind: 'fixedCharge', amount: -euros(700) }, '05', 5);
  const prlv = (id: string, jour: string) => op(id, CC, `2026-04-${jour}`, 'PRLV LOYER', -euros(700));

  it('[niveau 4] le doublon, le 5 (0,80) et le 6 (0,75) : notes élevées et proches, aucun ne prend l’occurrence d’office, la reprise se propose avec chacun', () => {
    expect(reprises(base([LOYER], prlv('p5', '05'), prlv('p6', '06')))).toEqual([
      ['p5', 'loyer', 0.8, false],
      ['p6', 'loyer', 0.75, false],
    ]);
  });

  it('[niveau 4] le prélèvement que l’utilisateur rapproche prend l’occurrence, et la proposition de l’autre disparaît', () => {
    let l = base([LOYER], prlv('p5', '05'), prlv('p6', '06'));
    const choisie = proposeMatches(l, DU, AU).find((p) => p.operationId === 'p6')!;
    l = applyPatchToLedger(l, applyMatch(l, choisie));
    expect(l.operations.find((o) => o.id === 'p6')).toMatchObject({ plannedFlowId: 'loyer', plannedDate: '2026-04-05' });
    expect(reprises(l)).toEqual([]);
  });

  it('[niveau 4] deux prélèvements de même note, le même jour : aucun ne prend l’occurrence, chacun se la voit proposer', () => {
    expect(reprises(base([LOYER], prlv('a', '05'), prlv('b', '05'))).sort()).toEqual([
      ['a', 'loyer', 0.8, false],
      ['b', 'loyer', 0.8, false],
    ]);
  });

  it('[niveau 4] le second du 9 (0,60) : celui du 5 se distingue et prend l’occurrence d’office ; celui du 9 ne se voit rien proposer', () => {
    expect(reprises(base([LOYER], prlv('p5', '05'), prlv('p9', '09')))).toEqual([['p5', 'loyer', 0.8, true]]);
  });

  it('[niveau 4] une opération douteuse prétend aux occurrences de chacun de ses flux : proche d’une autre, aucune ne prend d’office', () => {
    // « p5 », retenu par le loyer et par une charge sans fenêtre de même montant le même jour (0,80 et
    // 0,80), est douteux ; « p6 », retenu par le loyer seul (0,75), lui dispute l’occurrence du loyer.
    const CHARGE = flux({ id: 'charge', kind: 'fixedCharge', amount: -euros(700) }, '05', 0);
    expect(reprises(base([LOYER, CHARGE], prlv('p5', '05'), prlv('p6', '06'))).sort()).toEqual([
      ['p5', 'charge', 0.8, false],
      ['p5', 'loyer', 0.8, false],
      ['p6', 'loyer', 0.75, false],
    ]);
  });

  it('[niveau 4] une opération douteuse qui se distingue est seule à se voir proposer l’occurrence ; l’autre n’a rien', () => {
    const CHARGE = flux({ id: 'charge', kind: 'fixedCharge', amount: -euros(700) }, '05', 0);
    expect(reprises(base([LOYER, CHARGE], prlv('p5', '05'), prlv('p9', '09'))).sort()).toEqual([
      ['p5', 'charge', 0.8, false],
      ['p5', 'loyer', 0.8, false],
    ]);
  });
});
