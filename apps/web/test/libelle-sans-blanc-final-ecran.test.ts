// @vitest-environment jsdom
/**
 * Tests du codeur de #26, point 2 — « Ce qu'on voit est ce qu'on copie » : le libellé que l'écran Plan
 * montre à recopier, et que son bouton Copier copie, ne commence ni ne finit par un blanc, et le texte
 * copié est exactement le texte montré, y compris pour un ordre enregistré avant ce changement, dont
 * le motif de libellé finit par un blanc. L'application montée sans navigateur (`ecran.ts`) ; le
 * presse-papiers est remplacé par un relevé de ce qui y est écrit.
 *
 * Données inventées (D84) : l'exemple, son Livret A renommé « Assurance vie de Simon et Marie ».
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exampleLedger, type Ledger, type PlannedFlow } from '@tirelire/core';
import { allerA, app, ouvrirLApplication, presser, projet, rendu, t, tous } from './ecran';

const COMPTE = 'acc-livret';
const NOM = 'Assurance vie de Simon et Marie';
const ORDRE = 'flow-vir-livret';
const LIBELLE = 'TIRELIRE ASSURANCE VIE DE SIMON ET';

function projetDeDepart(motif: string | null): Ledger {
  const l = exampleLedger();
  const accounts = l.accounts.map((a) => (a.id === COMPTE ? { ...a, name: NOM } : a));
  const plannedFlows =
    motif === null ? l.plannedFlows.filter((f) => f.id !== ORDRE) : l.plannedFlows.map((f): PlannedFlow => (f.id === ORDRE ? { ...f, labelPattern: motif } : f));
  return { ...l, accounts, plannedFlows };
}

async function auPlan(l: Ledger): Promise<void> {
  await ouvrirLApplication();
  await app.replaceWith(l);
  await rendu();
  await allerA('Plan');
}

/** Les libellés à recopier de la carte du compte, chacun avec ce que son bouton Copier copie. */
async function libellesDeLaCarte(): Promise<Array<{ montre: string; copie: string[] }>> {
  const carte = tous('main .card').find((c) => t(c.querySelector(':scope > .row strong')) === NOM);
  expect(carte, 'pas de carte pour le compte').toBeTruthy();
  const out: Array<{ montre: string; copie: string[] }> = [];
  for (const bloc of tous('.libelle-a-copier', carte!)) {
    const copie: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: (x: string) => (copie.push(x), Promise.resolve()) } });
    await presser(bloc.querySelector<HTMLButtonElement>('button')!);
    await rendu();
    out.push({ montre: bloc.querySelector('.libelle')?.textContent ?? '', copie });
  }
  return out;
}

describe('[niveau 4] #26 · 2. ce qu’on voit est ce qu’on copie, à l’écran Plan', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ordre enregistré avant ce changement, motif finissant par un blanc : montré et copié sans lui, identiques', async () => {
    await auPlan(projetDeDepart(`${LIBELLE} `));
    const libelles = await libellesDeLaCarte();
    expect(libelles.length).toBeGreaterThan(0);
    for (const l of libelles) {
      expect(l.montre).toBe(LIBELLE);
      expect(l.copie).toEqual([l.montre]);
    }
    // Montrer n'a rien réécrit : l'ordre garde son motif enregistré, blanc compris (point 6).
    expect(projet().plannedFlows.find((f) => f.id === ORDRE)?.labelPattern).toBe(`${LIBELLE} `);
  });

  it('compte sans ordre : le libellé tiré du nom, montré et copié sans blanc final', async () => {
    await auPlan(projetDeDepart(null));
    const libelles = await libellesDeLaCarte();
    expect(libelles.length).toBeGreaterThan(0);
    for (const l of libelles) {
      expect(l.montre).toBe(LIBELLE);
      expect(l.copie).toEqual([l.montre]);
    }
  });
});
