// @vitest-environment jsdom
/**
 * Tests du codeur de #419 : ce que vérifiait, dans le navigateur, le harnais d'audit de #394 (« l'écran Plan valide un
 * ordre avec sa ventilation ») et que #419 en retire, se vérifie ici sans navigateur : l'application montée sous jsdom
 * (`ecran.ts`). Chaque titre dit le point du « Fait quand » de #394 qu'il vérifie, et le numéro du test retiré dans la
 * table de #419 (« ventilation 1 » et « ventilation 2 »). Ce qui reste au navigateur — l'écart proposé sans rien écrire,
 * le panneau qui écrit ce qu'il montre, l'enregistrement en un geste, chacun mesuré à 375 px — :
 * `navigateur/ventilation-ordre-harnais.test.ts`.
 *
 * Ce qui se lit ici : la carte du Livret A à l'écran Plan — la proposition, l'ordre enregistré, leurs ventilations, le
 * panneau qui les corrige —, la ligne de l'ordre à l'écran Flux prévus, et le projet que l'application a enregistré,
 * relu dans le dépôt. L'exemple chargé par « Charger l'exemple » (lu au 6 septembre 2026) porte un ordre vers le
 * Livret A décalé de ce que le budget demande (D60). Les montants attendus sont relus dans le cœur, sur le même exemple
 * et à la même date. Les règles du panneau, sans écran : `ventilation-ordre-harnais.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { alive, computePlan, exampleLedger, type AllocationLine, type PlannedFlow } from '@tirelire/core';
import { allerA, app, attendre, centimes, cliquer, cliquerExactement, ecran, ouvrirLApplication, presser, projet, rendu, rouvrirLApplication, saisir as saisirChamp, t, tous } from './ecran';

const LECTURE = '2026-09-06';

/** Ouvre l'application, charge l'exemple, et va au Plan. */
async function ouvrirLExemple(): Promise<void> {
  await ouvrirLApplication();
  expect(await cliquer('Charger l\'exemple')).toBe(true);
  await attendre(() => alive(app.ledger.accounts).some((a) => a.name === 'Livret A') && app.asOf === LECTURE, 'l’exemple');
  await allerA('Plan');
  await rendu();
}

/** Les ordres vers le Livret A, tels que le projet enregistré les porte. */
const ordresEnregistres = (): PlannedFlow[] => alive(projet().plannedFlows).filter((f) => f.kind === 'transfer' && f.counterpartAccountId === 'acc-livret');

interface Ligne { texte: string; montant: string }
/** La carte du Livret A : ses boutons, le montant proposé, et les lignes de ses ventilations. */
function carte() {
  const c = tous('main .card').find((x) => t(x.querySelector(':scope > .row strong')) === 'Livret A');
  const lignes = (sel: string): Ligne[] => (c ? tous(`${sel} .ventilation .row`, c) : []).map((r) => ({ texte: t(r), montant: t(r.querySelector('.num')) }));
  return {
    boutons: c ? tous('button', c).map(t) : [],
    propose: t(c?.querySelector('.proposition > .row > .num')),
    proposition: lignes('.proposition'),
    enregistre: lignes('.ordre-enregistre'),
    panneau: lignes('.panneau-ventilation'),
  };
}
async function cliquerDansLaCarte(texte: string): Promise<boolean> {
  const c = tous('main .card').find((x) => t(x.querySelector(':scope > .row strong')) === 'Livret A');
  const b = c && tous<HTMLButtonElement>('button', c).find((x) => t(x) === texte);
  if (b) await presser(b);
  return !!b;
}
/** Ouvre la part `i` du panneau, qui s'ouvre à la demande, une à la fois (#408, point 3), si elle ne l'est pas déjà. */
async function ouvrirLaPart(i: number): Promise<void> {
  const f = document.querySelector('main .panneau-ventilation')!;
  if (f.querySelector(`fieldset[data-part="${i}"]`)) return;
  await presser(f.querySelector<HTMLElement>(`.ventilation .row.part[data-part="${i}"]`)!);
}
/** Saisit `valeur` dans le champ `quoi` du panneau : le montant de l'ordre, ou la valeur de la part `i`. */
async function saisir(quoi: 'montant' | number, valeur: string): Promise<void> {
  if (quoi !== 'montant') await ouvrirLaPart(quoi);
  const f = document.querySelector('main .panneau-ventilation')!;
  const i = (quoi === 'montant' ? f.querySelector(':scope > .grid input') : f.querySelector(`fieldset[data-part="${quoi}"]`)!.querySelector('input')) as HTMLInputElement;
  await saisirChamp(i, valeur);
}
/** Les parts d'un ordre, en positif, comparables à ce que la carte montre. */
const montants = (a: AllocationLine[] | undefined) => (a ?? []).map((l) => (l.share.kind === 'fixed' ? Math.abs(l.share.amount) : l.share));
const sansNonAffecte = (l: Ligne[]) => l.filter((x) => !x.texte.startsWith('Non affecté'));

describe('#419 · #394 — l’écran Plan valide un ordre avec sa ventilation, sur l’exemple, sans navigateur', () => {
  it('[niveau 4] #394 points 5 et 8 (table #419, ventilation 1) — « Confirmer mon nouvel ordre » écrit l’ordre tel que la carte le montre, celui que le cœur propose ; relu après rechargement', async () => {
    await ouvrirLExemple();
    const [avant] = ordresEnregistres();
    expect(avant, 'l’exemple ne porte pas d’ordre vers le Livret A').toBeTruthy();
    const montre = carte();
    const montant = centimes(montre.propose);
    const parts = sansNonAffecte(montre.proposition).map((l) => centimes(l.montant));
    expect(parts.length, 'la proposition ne montre pas sa ventilation').toBeGreaterThan(0);
    // Ce que la carte montre est ce que le cœur propose, sur le même exemple, à la même date.
    const propose = computePlan(exampleLedger(), LECTURE, LECTURE).transfers.find((x) => x.accountName === 'Livret A')!.proposal!;
    expect(montant).toBe(propose.amount);
    expect(Math.abs(avant!.amount), 'l’ordre de l’exemple n’est pas décalé : confirmer ne change rien').not.toBe(montant);

    expect(await cliquerDansLaCarte('Confirmer mon nouvel ordre')).toBe(true);
    await rouvrirLApplication();
    await allerA('Plan');
    const [apres] = ordresEnregistres();
    expect(ordresEnregistres()).toHaveLength(1);
    expect({ id: apres!.id, name: apres!.name, periodicity: apres!.periodicity }).toEqual({ id: avant!.id, name: avant!.name, periodicity: avant!.periodicity });
    expect(Math.abs(apres!.amount)).toBe(montant);
    expect(montants(apres!.action?.allocation)).toEqual(parts);
    expect(apres!.action?.allocation).toEqual(propose.allocation);
    const c = carte();
    expect(c.boutons).not.toContain('Confirmer mon nouvel ordre');
    expect(sansNonAffecte(c.enregistre).map((l) => centimes(l.montant))).toEqual(parts);
  });

  it('[niveau 4] #394 point 4 (table #419, ventilation 2) — sur une proposition, le panneau suit le montant tant qu’aucune part n’est touchée, puis ne suit plus', async () => {
    await ouvrirLExemple();
    // Sans ordre : on supprime celui de l'exemple à l'écran Flux prévus (`confirm` répond oui).
    expect(await ecran('Flux prévus')).toBe(true);
    const r = tous('main .row').find((x) => t(x.querySelector('.label strong')) === 'Virement Livret A');
    const supprimer = r && tous<HTMLButtonElement>('button', r).find((x) => t(x) === 'Supprimer');
    expect(supprimer, 'bouton « Supprimer » de l’ordre absent').toBeTruthy();
    await presser(supprimer!);
    expect(ordresEnregistres()).toEqual([]);
    await allerA('Plan');

    expect(await cliquerDansLaCarte('Modifier avant d’enregistrer')).toBe(true);
    const propose = carte().panneau.map((l) => l.texte);
    expect(propose.length).toBeGreaterThan(0);
    await saisir('montant', '300');
    const suivi = carte().panneau;
    expect(suivi.map((l) => l.texte), 'le panneau ne suit pas le montant').not.toEqual(propose);
    expect(suivi.some((l) => l.texte.startsWith('Non affecté')), 'à 300 €, les parts proposées dépassent le montant').toBe(false);
    expect(suivi.reduce((s, l) => s + centimes(l.montant), 0)).toBe(30000);
    await saisir(0, '10');
    expect(await cliquerExactement('Refermer')).toBe(true);
    const touche = carte().panneau.map((l) => l.texte);
    await saisir('montant', '650');
    expect(carte().panneau.slice(0, -1).map((l) => l.texte), 'le panneau suit encore le montant, une part touchée').toEqual(touche.filter((x) => !x.startsWith('Non affecté')));
    expect(await cliquerExactement('Annuler')).toBe(true);
    expect(ordresEnregistres(), 'le panneau annulé a écrit un ordre').toEqual([]);
  });
});
