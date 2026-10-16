// @vitest-environment jsdom
/**
 * Test du codeur de #488, troisième tour, sur l'écran Opérations monté sans navigateur (`ecran.ts`) : un
 * libellé que plusieurs ordres reconnaissent, dont l'un souplement, se propose avec chacun (point 8,
 * « dans le doute, on propose »), et l'utilisateur choisit l'ordre qui le reprend.
 *
 * Données inventées (D84) : un compte principal, les comptes de Léa et de Léane, un ordre vers chacune.
 */
import { describe, expect, it } from 'vitest';
import { emptyLedger, euros, normalizeLabel, type Ledger, type Operation, type PlannedFlow } from '@tirelire/core';
import { allerA, app, ouvrirLApplication, presser, projet, rendu, t, tous } from './ecran';

const CC = 'acc-principal';
const LEA = 'acc-lea';
const LEANE = 'acc-leane';

function op(id: string, accountId: string, date: string, label: string, amount: number): Operation {
  return { id, accountId, origin: 'imported', date, label, normalizedLabel: normalizeLabel(label), amount, state: 'untreated' };
}

function ordre(id: string, nom: string, vers: string, motif: string): PlannedFlow {
  return { id, name: nom, kind: 'transfer', amount: -euros(20), accountId: CC, counterpartAccountId: vers, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-01-01' }, dateWindowDays: 5, labelPattern: motif };
}

function projetDeDepart(): Ledger {
  const l = emptyLedger();
  l.accounts.push(
    { id: CC, name: 'Compte principal', kind: 'principal', openingBalance: euros(2000), openingDate: '2026-08-01' },
    { id: LEA, name: 'Léa', kind: 'courant', openingBalance: 0, openingDate: '2026-08-01' },
    { id: LEANE, name: 'Léane', kind: 'courant', openingBalance: 0, openingDate: '2026-08-01' },
  );
  l.plannedFlows.push(ordre('ordre-lea', 'Argent de poche Léa', LEA, 'VIR SEPA ARGENT POCHE LEA'), ordre('ordre-leane', 'Argent de poche Léane', LEANE, 'VIR SEPA ARGENT POCHE LEANE'));
  l.operations.push(op('d-lea', CC, '2026-09-01', 'VIR SEPA ARGENT POCHE LEA', -euros(20)));
  return l;
}

describe('#488 · 8. dans le doute, la reprise se propose avec chacun, à l’écran', () => {
  it('[niveau 4] la ligne montre une proposition par ordre, l’opération ouverte un bouton par ordre, et le bouton choisi reprend avec cet ordre', async () => {
    await ouvrirLApplication();
    await app.replaceWith(projetDeDepart());
    await rendu();
    await allerA('Opérations');
    const ligne = tous('main .card > .row').find((r) => t(r.querySelector(':scope > button.label strong')) === 'VIR SEPA ARGENT POCHE LEA')!;
    expect(ligne, 'la ligne du virement n’est pas à l’écran').toBeTruthy();
    const texte = t(ligne.querySelector(':scope > button.label'));
    expect(texte).toMatch(/Proposition : reprendre l’opération prévue « Argent de poche Léa »/);
    expect(texte).toMatch(/Proposition : reprendre l’opération prévue « Argent de poche Léane »/);
    await presser(ligne.querySelector<HTMLButtonElement>(':scope > button.label')!);
    const boutons = tous<HTMLButtonElement>('main button.primary').filter((b) => /^Reprendre l’opération prévue/.test(t(b)));
    expect(boutons.map(t).sort()).toEqual([
      expect.stringMatching(/« Argent de poche Léa »/),
      expect.stringMatching(/« Argent de poche Léane »/),
    ]);
    await presser(boutons.find((b) => /« Argent de poche Léa »/.test(t(b)))!);
    const d = projet().operations.find((o) => o.id === 'd-lea')!;
    expect([d.plannedFlowId, d.transferAccountId]).toEqual(['ordre-lea', LEA]);
  });
});
