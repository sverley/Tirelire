/**
 * Test du codeur de #435, point 8 : un motif de libellé qui n'est pas un simple texte ne se donne pas
 * à recopier chez la banque ; il se montre comme ce que l'import reconnaît. Un simple texte reste un
 * libellé à recopier (#13, point 6), tel qu'il se lit (#26).
 */
import { describe, expect, it } from 'vitest';
import type { PlannedFlow } from '@tirelire/core';
import { consigneDe, estUnLibelle } from '../src/lib/consigneOrdre';

const ordre = (labelPattern?: string): PlannedFlow => ({
  id: 'o',
  name: 'Virement Livret A',
  kind: 'transfer',
  amount: -60000,
  accountId: 'cc',
  counterpartAccountId: 'livret',
  periodicity: { interval: 1, unit: 'month', anchorDate: '2026-09-02' },
  dateWindowDays: 5,
  ...(labelPattern !== undefined ? { labelPattern } : {}),
});

describe('[niveau 4] #435 · 8. un motif qui n’est pas un simple texte ne se recopie pas', () => {
  it('estUnLibelle', () => {
    expect(estUnLibelle('TIRELIRE LIVRET A')).toBe(true);
    expect(estUnLibelle('VIR SEPA M. DUPONT')).toBe(false);
    for (const m of ['EPARGNE.*LIVRET', 'DGFIP|TAXE', 'VIR(EMENT)?', 'A+B', 'X?', '^LOYER', 'LOYER$', 'A[B]', 'A{2}', 'A\\.B']) expect(estUnLibelle(m), m).toBe(false);
  });

  it('consigneDe : un simple texte est un libellé ; un motif est ce que l’import reconnaît', () => {
    expect(consigneDe(ordre('TIRELIRE LIVRET A '))).toMatchObject({ libelle: 'TIRELIRE LIVRET A' });
    expect(consigneDe(ordre('TIRELIRE LIVRET A')).motif).toBeUndefined();
    const c = consigneDe(ordre('EPARGNE.*LIVRET'));
    expect(c.libelle).toBeUndefined();
    expect(c.motif).toBe('EPARGNE.*LIVRET');
    const sans = consigneDe(ordre());
    expect(sans.libelle).toBeUndefined();
    expect(sans.motif).toBeUndefined();
  });
});
