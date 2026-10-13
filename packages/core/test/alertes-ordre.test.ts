/**
 * Tests du codeur de #463, second tour — l'ordre des reprises proposées (point 4). De niveau 4 (D83).
 *
 * Décor : un foyer au mois calendaire, lu au 20 septembre 2026, dont quatre opérations importées non
 * traitées ont chacune une reprise proposée, et dont l'ordre de la sélection des flux (par note
 * décroissante) n'est pas celui de la liste d'Opérations.
 */
import { describe, expect, it } from 'vitest';
import { emptyLedger, euros, normalizeLabel, proposeMatches, readAlerts, type Ledger, type Operation } from '../src/index.js';

const LECTURE = '2026-09-20';
const mensuel = (anchorDate: string) => ({ interval: 1, unit: 'month' as const, anchorDate });

function op(id: string, date: string, label: string, amount: number): Operation {
  return { id, accountId: 'acc-principal', origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated' };
}

function foyer(): Ledger {
  const l = emptyLedger();
  l.accounts.push({ id: 'acc-principal', name: 'Compte courant', kind: 'principal', openingBalance: euros(3000), openingDate: '2025-01-01' });
  l.plannedFlows.push(
    { id: 'flow-salaire', name: 'Salaire', kind: 'income', amount: euros(2000), accountId: 'acc-principal', periodicity: mensuel('2026-01-28'), dateWindowDays: 3, labelPattern: 'SALAIRE' },
    { id: 'flow-loyer', name: 'Loyer', kind: 'fixedCharge', amount: euros(-800), accountId: 'acc-principal', periodicity: mensuel('2026-01-05'), dateWindowDays: 3, labelPattern: 'LOYER' },
    { id: 'flow-gaz', name: 'Gaz', kind: 'fixedCharge', amount: euros(-50), accountId: 'acc-principal', periodicity: mensuel('2026-01-05'), dateWindowDays: 3, labelPattern: 'GAZ' },
    { id: 'flow-eau', name: 'Eau', kind: 'fixedCharge', amount: euros(-50), accountId: 'acc-principal', periodicity: mensuel('2026-01-07'), dateWindowDays: 3 },
  );
  // L'ordre du grand livre : l'eau avant le gaz, du même jour et du même montant.
  l.operations.push(
    op('op-eau', '2026-09-07', 'PRLV EAU', euros(-50)),
    op('op-gaz', '2026-09-07', 'PRLV GAZ', euros(-50)),
    op('op-loyer', '2026-09-07', 'PRLV LOYER', euros(-800)),
    op('op-salaire', '2026-08-28', 'VIR SALAIRE', euros(2000)),
  );
  return l;
}

describe('#463 · 4. l’ordre des reprises proposées', () => {
  it('celui de la liste d’Opérations : date décroissante, puis montant absolu décroissant, puis l’ordre du grand livre [niveau 4]', () => {
    const l = foyer();
    // Témoin : la sélection des flux les rend par note décroissante, dans un autre ordre.
    expect(proposeMatches(l, '2025-07-28', '2026-11-09').map((m) => m.operationId)).toEqual(['op-salaire', 'op-gaz', 'op-loyer', 'op-eau']);
    expect(readAlerts(l, { today: LECTURE }, ['matchProposal']).map((a) => a.code === 'matchProposal' && a.operationId)).toEqual([
      'op-loyer', // le 7 septembre, 800 €
      'op-eau', // le 7 septembre, 50 €, avant le gaz dans le grand livre
      'op-gaz',
      'op-salaire', // le 28 août
    ]);
  });
});
