// @vitest-environment jsdom
/**
 * Test du codeur de #445, second tour — le point 6 amendé (porteur, 12/10) : « quand aucune cible
 * n'est concernée, ou dans un projet sans flux, il n'en parle pas (U1, U5) ». L'application montée
 * sous jsdom (`ecran.ts`), sur un projet inventé (D84) qui a des flux, posé comme l'application pose
 * l'exemple (`replaceWith`), lu au 5 janvier 2027.
 */
import { describe, expect, it } from 'vitest';
import { emptyLedger, euros, type Ledger, type Operation } from '@tirelire/core';
import { allerA, app, cliquer, fixerLeJour, ouvrirLApplication, presser, rendu, saisir, t, tous } from './ecran';

const CC = 'acc-principal';

function opération(o: Partial<Operation> & Pick<Operation, 'id' | 'date' | 'amount'>): Operation {
  return { accountId: CC, origin: 'imported', label: o.id.toUpperCase(), normalizedLabel: o.id.toUpperCase(), state: 'untreated', ...o };
}

/** Un compte, une paie et un loyer prévus ; des opérations selon `operations`. */
function projet(operations: Operation[]): Ledger {
  const l = emptyLedger({ periodStartDay: 1 });
  l.accounts.push({ id: CC, name: 'Compte courant', kind: 'principal', openingBalance: euros(1000), openingDate: '2026-09-30' });
  l.plannedFlows.push(
    { id: 'f-paie', name: 'Paie', kind: 'income', accountId: CC, amount: euros(2500), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-10-25' }, dateWindowDays: 3 },
    { id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', accountId: CC, amount: -euros(700), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-10-05' }, dateWindowDays: 3 },
  );
  l.operations.push(...operations);
  return l;
}

async function ouvrirSur(l: Ledger): Promise<void> {
  fixerLeJour('2027-01-05');
  await ouvrirLApplication();
  await app.replaceWith(l);
  await rendu();
  await allerA('Opérations');
  const s = tous<HTMLSelectElement>('main select').find((x) => [...x.options].some((o) => t(o) === 'Non traitées'))!;
  await saisir(s, 'all');
}

const ligne = (libelle: string) => tous('main .card > .row').find((r) => t(r.querySelector(':scope > button.label strong')) === libelle)!;
const panneau = () => t(document.querySelector('main form.edit'));

describe('#445 · point 6 amendé — aucune cible concernée : le panneau des actions groupées ne parle pas de la reprise', () => {
  it('[niveau 4] U1 : un projet qui a des flux et aucun import, ses saisies visées', async () => {
    await ouvrirSur(projet([opération({ id: 'courses', date: '2026-12-10', amount: -euros(50), origin: 'manual', state: 'locked' })]));
    expect(await cliquer('Actions sur 1 opération(s)')).toBe(true);
    expect(panneau()).toContain('Actions à appliquer');
    expect(panneau()).not.toContain('occurrence');
  });

  it('[niveau 4] des cibles cochées dont aucune n’est concernée — une saisie, une opération qui reprend déjà —, puis une concernée de plus : le choix revient', async () => {
    await ouvrirSur(
      projet([
        opération({ id: 'courses', date: '2026-12-10', amount: -euros(50), origin: 'manual', state: 'locked' }),
        opération({ id: 'salaire-nov', date: '2026-11-25', amount: euros(2500), state: 'reconciled', plannedFlowId: 'f-paie', plannedDate: '2026-11-25' }),
        opération({ id: 'salaire-dec', date: '2026-12-19', amount: euros(2480) }),
      ]),
    );
    for (const l of ['COURSES', 'SALAIRE-NOV']) await presser(ligne(l).querySelector('label.cocher input') as HTMLElement);
    expect(await cliquer('Actions sur 2 opération(s)')).toBe(true);
    expect(panneau()).not.toContain('occurrence');
    await presser(ligne('SALAIRE-DEC').querySelector('label.cocher input') as HTMLElement);
    expect(panneau()).toContain('Reprendre une occurrence d’un flux');
  });
});
