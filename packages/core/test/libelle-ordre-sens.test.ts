/**
 * #206, point 4, précision tranchée le 08/10 : le libellé d'un ordre ne reconnaît qu'un débit du
 * compte d'où part l'ordre, le compte principal (D24, D57) ; le libellé tiré d'un nom garde la
 * reconnaissance d'aujourd'hui. Données inventées (D84) : l'exemple et des opérations écrites ici.
 */
import { describe, expect, it } from 'vitest';
import { euros, exampleLedger, matchTirelireTransfers, normalizeLabel, type Ledger, type Operation } from '../src/index.js';

const PRINCIPAL = 'acc-principal';
const ENFANTS = 'acc-enfants';
const LIVRET = 'acc-livret';
const ORDRE = 'flow-vir-livret';

function avecMotif(l: Ledger, motif: string): Ledger {
  return { ...l, plannedFlows: l.plannedFlows.map((f) => (f.id === ORDRE ? { ...f, labelPattern: motif } : f)) };
}

function op(id: string, compte: string, libellé: string, montant: number): Operation {
  return { id, accountId: compte, origin: 'imported', date: '2026-09-29', label: libellé, normalizedLabel: normalizeLabel(libellé), amount: montant, state: 'untreated' };
}

function vers(l: Ledger, o: Operation) {
  return matchTirelireTransfers({ ...l, operations: [...l.operations, o] }).operations.find((x) => x.id === o.id)?.transferAccountId;
}

describe('[niveau 4] #206 · 4. le libellé d’un ordre ne reconnaît qu’un débit du compte principal', () => {
  const l = avecMotif(exampleLedger(), 'VIR');

  it('un débit du compte principal que le motif reconnaît va vers le compte de l’ordre', () => {
    expect(vers(l, op('o1', PRINCIPAL, 'VIR LIVRET', -euros(600)))).toBe(LIVRET);
  });

  it('un crédit du compte principal n’est pas reconnu par lui, quel que soit son libellé', () => {
    expect(vers(l, op('o2', PRINCIPAL, 'VIREMENT SALAIRE ACME', euros(3400)))).toBeUndefined();
  });

  it('une opération d’un autre compte n’est pas reconnue par lui, débit comme crédit', () => {
    expect(vers(l, op('o3', ENFANTS, 'VIR CANTINE', -euros(45)))).toBeUndefined();
    expect(vers(l, op('o4', ENFANTS, 'VIR RECU', euros(45)))).toBeUndefined();
  });

  it('le libellé tiré d’un nom garde la reconnaissance d’aujourd’hui, hors du compte principal comme en crédit', () => {
    const sans: Ledger = { ...l, plannedFlows: l.plannedFlows.filter((f) => f.id !== ORDRE) };
    expect(vers(sans, op('o5', ENFANTS, 'TIRELIRE LIVRET A', -euros(10)))).toBe(LIVRET);
    expect(vers(sans, op('o6', PRINCIPAL, 'TIRELIRE LIVRET A', euros(10)))).toBe(LIVRET);
  });
});
