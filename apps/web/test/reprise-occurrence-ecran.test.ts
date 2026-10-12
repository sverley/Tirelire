// @vitest-environment jsdom
/**
 * Tests du codeur de #445 — dire à la main qu'une opération est l'occurrence d'un flux prévu, hors de
 * sa fenêtre, depuis l'opération ouverte, depuis sa ligne et par la sélection. L'application montée sous
 * jsdom (`ecran.ts`), sur un projet inventé (D84) posé comme l'application pose l'exemple
 * (`replaceWith`), lu au 5 janvier 2027. Les règles elles-mêmes : `packages/core/test/reprise-occurrence.test.ts`.
 *
 * Le décor : une paie de 2 500 € le 25 de chaque mois depuis octobre 2026 (fenêtre de 3 jours), classée
 * « Salaire » ; les paies d'octobre et de novembre la reprennent ; celle de décembre tombe le 19, hors
 * de la fenêtre du 25 : ni reprise, ni proposée — le cas du besoin.
 */
import { describe, expect, it } from 'vitest';
import { alive, emptyLedger, euros, formatCents, type Ledger, type Operation, type PlannedFlow } from '@tirelire/core';
import { allerA, app, cliquer, cliquerExactement, fixerLeJour, ouvrirLApplication, presser, projet, rendu, rouvrirLApplication, saisir, t, tous } from './ecran';

const fmt = (c: number) => formatCents(c).replace(/[\s  ]+/g, ' ');
const CC = 'acc-principal';
const TITRE = 'Reprendre une occurrence d’un flux';
const GESTE = 'Reprendre une occurrence';

function flux(f: Partial<PlannedFlow> & Pick<PlannedFlow, 'id' | 'name' | 'amount'>): PlannedFlow {
  return { kind: 'income', accountId: CC, periodicity: { interval: 1, unit: 'month', anchorDate: '2026-10-25' }, dateWindowDays: 3, ...f };
}

function opération(o: Partial<Operation> & Pick<Operation, 'id' | 'date' | 'amount'>): Operation {
  return { accountId: CC, origin: 'imported', label: o.id.toUpperCase(), normalizedLabel: o.id.toUpperCase(), state: 'untreated', ...o };
}

function budget(): Ledger {
  const l = emptyLedger({ periodStartDay: 1 });
  l.accounts.push({ id: CC, name: 'Compte courant', kind: 'principal', openingBalance: euros(1000), openingDate: '2026-09-30' });
  l.categories.push({ id: 'cat-salaire', name: 'Salaire', nature: 'income' }, { id: 'cat-logement', name: 'Logement', nature: 'expense' });
  l.plannedFlows.push(flux({ id: 'f-paie', name: 'Paie', amount: euros(2500), labelPattern: 'SALAIRE', action: { categoryId: 'cat-salaire' } }));
  l.plannedFlows.push(flux({ id: 'f-prime', name: 'Prime', amount: euros(300), periodicity: { interval: 1, unit: 'year', anchorDate: '2026-12-15' } }));
  l.plannedFlows.push(flux({ id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', amount: -euros(700), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-10-05' } }));
  l.operations.push(
    opération({ id: 'salaire-oct', date: '2026-10-25', amount: euros(2500), state: 'reconciled', plannedFlowId: 'f-paie', plannedDate: '2026-10-25' }),
    opération({ id: 'salaire-nov', date: '2026-11-25', amount: euros(2500), state: 'reconciled', plannedFlowId: 'f-paie', plannedDate: '2026-11-25' }),
    opération({ id: 'salaire-dec', date: '2026-12-19', amount: euros(2480) }),
    opération({ id: 'salaire-jan', date: '2027-01-02', amount: euros(2490) }),
    opération({ id: 'loyer-dec', date: '2026-12-05', amount: -euros(700) }),
    opération({ id: 'courses', date: '2026-12-10', amount: -euros(50), origin: 'manual', state: 'locked' }),
  );
  return l;
}

async function ouvrirSur(l: Ledger): Promise<void> {
  fixerLeJour('2027-01-05');
  await ouvrirLApplication();
  await app.replaceWith(l);
  await rendu();
  await allerA('Opérations');
}

/** L'écran Opérations, sur toutes les opérations (il s'ouvre sur les non traitées). */
async function toutes(): Promise<void> {
  const s = tous<HTMLSelectElement>('main select').find((x) => [...x.options].some((o) => t(o) === 'Non traitées'))!;
  await saisir(s, 'all');
}

/** La ligne de l'opération de ce libellé, dans la liste. */
const ligne = (libelle: string): HTMLElement | undefined => tous('main .card > .row').find((r) => t(r.querySelector(':scope > button.label strong')) === libelle);
const geste = (libelle: string) => tous<HTMLButtonElement>(':scope > button', ligne(libelle)!).find((b) => t(b) === GESTE);
const lu = (id: string) => alive(projet().operations).find((o) => o.id === id)!;
const partsDe = (id: string) => alive(projet().subOperations).filter((s) => s.operationId === id).map((s) => s.categoryId);
const instantané = () => JSON.stringify({ ...projet(), settings: undefined });
/** Les lignes du bloc « Attendus, non reçus » du Plan : le flux, puis ce qui s'en dit. */
async function attendusNonRecus(): Promise<string[]> {
  await allerA('Plan');
  const h2 = tous('main h2').find((h) => t(h) === 'Attendus, non reçus');
  const lignes = h2 ? tous('.row .label', h2.nextElementSibling!).map((l) => `${t(l.firstChild as Element)} | ${t(l.querySelector('.sub'))}`) : [];
  await allerA('Opérations');
  return lignes;
}
/** La première occurrence offerte dans ce conteneur. */
const premiereOccurrence = (dans: Element) => dans.querySelector('.occurrence-offerte') as HTMLElement | null;

describe('#445 · la reprise d’une occurrence choisie, à l’écran', () => {
  it('[niveau 4] points 4, 7, 8 et 9 — depuis l’opération ouverte : la section, la reprise verrouillée, relue au redémarrage, puis défaite', async () => {
    await ouvrirSur(budget());
    const attendu = 'Paie | attendu le 25 déc. 2026, fenêtre close le 28 déc. 2026';
    expect(await attendusNonRecus(), 'le décor ne montre pas l’occurrence du 25 décembre attendue, non reçue').toContain(attendu);
    const avant = instantané();
    const fluxAvant = JSON.stringify(projet().plannedFlows);
    await presser(ligne('SALAIRE-DEC')!.querySelector(':scope > button.label') as HTMLElement);
    const form = ligne('SALAIRE-DEC')!.querySelector('form.edit')!;
    expect(tous('h3', form).map(t), 'l’opération ouverte ne montre pas la section').toContain(TITRE);
    expect([...form.querySelectorAll('select')].some((s) => [...s.options].map(t).join('|') === `Paie · ${fmt(euros(2500))}|Prime · ${fmt(euros(300))}`), 'les flux offerts, du plus proche en montant').toBe(true);
    const occ = premiereOccurrence(form)!;
    expect(t(occ)).toContain('Occurrence du 25 déc. 2026');
    expect(t(occ)).toContain(`écart ${fmt(-euros(20))}`);
    expect(instantané(), 'ouvrir l’opération a écrit').toBe(avant);

    await presser(tous<HTMLButtonElement>('button', occ).find((b) => t(b) === 'Reprendre')!);
    expect(lu('salaire-dec')).toMatchObject({ plannedFlowId: 'f-paie', plannedDate: '2026-12-25', state: 'locked' });
    expect(partsDe('salaire-dec')).toEqual(['cat-salaire']);
    // Aussitôt : la ligne, restée à l'écran malgré le filtre « Non traitées », dit ce qu'elle reprend.
    expect(t(ligne('SALAIRE-DEC'))).toContain(`reprend l’opération prévue « Paie » du 25 déc. 2026 · écart ${fmt(-euros(20))}`);
    expect(geste('SALAIRE-DEC'), 'une opération qui reprend ne porte plus le geste').toBeUndefined();
    expect(JSON.stringify(projet().plannedFlows), 'le flux a changé').toBe(fluxAvant);
    // Le Plan ne compte plus l'occurrence du 25 décembre parmi les attendus non reçus.
    expect(await attendusNonRecus()).not.toContain(attendu);

    await rouvrirLApplication();
    expect(lu('salaire-dec')).toMatchObject({ plannedFlowId: 'f-paie', plannedDate: '2026-12-25', state: 'locked' });
    await allerA('Opérations');
    await toutes();
    await presser(ligne('SALAIRE-DEC')!.querySelector(':scope > button.label') as HTMLElement);
    expect(await cliquer('Défaire la reprise')).toBe(true);
    expect(lu('salaire-dec').plannedFlowId).toBeUndefined();
    expect(lu('salaire-dec').state).toBe('locked');
    expect(partsDe('salaire-dec')).toEqual(['cat-salaire']);
    expect(geste('SALAIRE-DEC'), 'défaite, l’occurrence s’offre de nouveau').toBeDefined();
  });

  it('[niveau 4] points 5 et 9 — sur la ligne, sans l’ouvrir : le geste, le panneau qui nomme l’opération, le choix d’un flux, la fermeture qui n’écrit rien', async () => {
    await ouvrirSur(budget());
    await toutes();
    expect(geste('SALAIRE-DEC')).toBeDefined();
    expect(geste('LOYER-DEC')).toBeDefined();
    expect(geste('SALAIRE-NOV'), 'elle reprend déjà une occurrence').toBeUndefined();
    expect(geste('COURSES'), 'une saisie').toBeUndefined();

    const avant = instantané();
    await presser(geste('SALAIRE-DEC')!);
    const panneau = ligne('SALAIRE-DEC')!.querySelector('form.reprise-ligne')!;
    expect(panneau, 'le geste n’ouvre pas de panneau sous la ligne').toBeTruthy();
    expect(t(panneau.querySelector('.titre-panneau'))).toBe(`${TITRE} — SALAIRE-DEC`);
    expect(tous('form.edit', ligne('SALAIRE-DEC')!).length, 'le geste a ouvert l’opération').toBe(1);
    // Choisir un autre flux montre ses occurrences, sans rien écrire.
    await saisir(panneau.querySelector('select') as HTMLSelectElement, 'f-prime');
    expect(t(premiereOccurrence(panneau))).toContain('Occurrence du 15 déc. 2026');
    await cliquerExactement('Fermer');
    expect(ligne('SALAIRE-DEC')!.querySelector('form.reprise-ligne')).toBeNull();
    expect(instantané(), 'ouvrir, choisir, fermer a écrit').toBe(avant);

    await presser(geste('SALAIRE-DEC')!);
    const p2 = ligne('SALAIRE-DEC')!.querySelector('form.reprise-ligne')!;
    await presser(tous<HTMLButtonElement>('button', premiereOccurrence(p2)!).find((b) => t(b) === 'Reprendre')!);
    expect(lu('salaire-dec')).toMatchObject({ plannedFlowId: 'f-paie', plannedDate: '2026-12-25', state: 'locked' });
    expect(ligne('SALAIRE-DEC')!.querySelector('form.reprise-ligne')).toBeNull();

    // Le reste de la ligne ne change pas : sa case se coche, et la toucher ouvre l'opération.
    await presser(ligne('LOYER-DEC')!.querySelector('label.cocher input') as HTMLElement);
    expect(tous<HTMLButtonElement>('main button').some((b) => t(b) === 'Actions sur 1 opération(s)')).toBe(true);
    await presser(ligne('LOYER-DEC')!.querySelector(':scope > button.label') as HTMLElement);
    expect(ligne('LOYER-DEC')!.querySelector('form.edit:not(.reprise-ligne)')).toBeTruthy();
  });

  it('[niveau 4] points 6 et 9 — par la sélection : le flux, l’aperçu pour chaque cible, « Appliquer » qui ne fait que les reprises', async () => {
    await ouvrirSur(budget());
    await toutes();
    for (const l of ['SALAIRE-DEC', 'SALAIRE-JAN', 'COURSES']) await presser(ligne(l)!.querySelector('label.cocher input') as HTMLElement);
    expect(await cliquer('Actions sur 3 opération(s)')).toBe(true);
    const form = document.querySelector('main form.edit') as HTMLElement;
    const champ = tous('label.f', form).find((x) => t(x).startsWith(TITRE))!;
    const choix = champ.querySelector('select') as HTMLSelectElement;
    expect([...choix.options].map(t)).toEqual(['— (ne pas reprendre)', `Paie · ${fmt(euros(2500))}`, `Prime · ${fmt(euros(300))}`]);
    const avant = instantané();
    await saisir(choix, 'f-paie');
    const apercu = tous('.apercu-reprises .row', form).map(t);
    expect(apercu.find((x) => x.startsWith('SALAIRE-DEC'))).toContain('reprend l’opération prévue « Paie » du 25 déc. 2026');
    expect(apercu.find((x) => x.startsWith('SALAIRE-JAN'))).toContain('reprend l’opération prévue « Paie » du 25 janv. 2027');
    expect(apercu.find((x) => x.startsWith('COURSES'))).toContain('non concernée');
    expect(tous<HTMLButtonElement>('button', form).map(t), 'une reprise ne s’enregistre pas en automatisme').not.toContain('Enregistrer l’automatisme');
    expect(tous('label.f', form).map(t).some((x) => x.startsWith('Catégorie')), 'ni catégorie ne s’applique avec une reprise').toBe(false);
    expect(instantané(), 'choisir un flux et lire l’aperçu a écrit').toBe(avant);

    expect(await cliquerExactement('Appliquer maintenant')).toBe(true);
    expect(lu('salaire-dec')).toMatchObject({ plannedFlowId: 'f-paie', plannedDate: '2026-12-25', state: 'locked' });
    expect(lu('salaire-jan')).toMatchObject({ plannedFlowId: 'f-paie', plannedDate: '2027-01-25', state: 'locked' });
    expect([lu('courses').plannedFlowId, lu('courses').resumedOperationId, lu('courses').state]).toEqual([undefined, undefined, 'locked']);
    expect(alive(projet().automations)).toEqual([]);
    expect(t(ligne('SALAIRE-JAN'))).toContain('reprend l’opération prévue « Paie » du 25 janv. 2027');
  });

  it('[niveau 4] point 6 — sans flux offert, le panneau le dit ; dans un projet sans flux, ni geste ni mot (U5)', async () => {
    await ouvrirSur(budget());
    for (const l of ['SALAIRE-DEC', 'LOYER-DEC']) await presser(ligne(l)!.querySelector('label.cocher input') as HTMLElement);
    expect(await cliquer('Actions sur 2 opération(s)')).toBe(true);
    expect(t(document.querySelector('main form.edit'))).toContain(`${TITRE} : aucun flux n’est offert, les opérations visées ne partagent pas un même compte et un même sens.`);

    const sansFlux = budget();
    sansFlux.plannedFlows = [];
    for (const o of sansFlux.operations) {
      delete o.plannedFlowId;
      delete o.plannedDate;
    }
    await ouvrirSur(sansFlux);
    await toutes();
    expect(tous<HTMLButtonElement>('main button').some((b) => t(b) === GESTE), 'une ligne porte le geste dans un projet sans flux').toBe(false);
    expect(await cliquer('Actions sur')).toBe(true);
    expect(t(document.querySelector('main form.edit'))).not.toContain('occurrence');
  });
});
