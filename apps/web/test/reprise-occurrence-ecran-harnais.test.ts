// @vitest-environment jsdom
/**
 * Harnais d'audit de #445 — dire à la main qu'une opération est l'occurrence d'un flux prévu, hors de
 * sa fenêtre, depuis l'opération ouverte, depuis sa ligne et par la sélection. Côté écran :
 * l'application montée sous jsdom (`ecran.ts`), sur un projet inventé (D84) posé comme l'application
 * pose l'exemple (`replaceWith`), lu au 5 janvier 2027. Les règles elles-mêmes :
 * `packages/core/test/reprise-occurrence-harnais.test.ts`. Chaque `describe` nomme le point du
 * « Fait quand » qu'il tranche, et son niveau (D83).
 *
 * Composé après le codage (auditeur.md, étape 2), parmi les tests du codeur
 * (`reprise-occurrence-ecran.test.ts`, déplacé ici en entier, et réparti). Sont de moi : au point 5,
 * l'accès depuis l'accueil (I5) ; au point 7, la reprise relue après un redémarrage par ses trois
 * chemins, le flux inchangé compris ; au point 9, la base relue en entier après avoir ouvert, puis
 * fermé, les trois panneaux et quitté l'écran ; au point 6, l'écart de l'aperçu ; au point 8,
 * l'occurrence de nouveau « attendue, non reçue ».
 * Au second tour, le point 6 amendé (porteur, 12/10) : les tests du codeur
 * (`reprise-occurrence-silence-ecran.test.ts`, déplacé ici en entier) — sans cible concernée, le
 * panneau des actions groupées ne parle pas de la reprise (U1).
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
const ATTENDU = 'Paie | attendu le 25 déc. 2026, fenêtre close le 28 déc. 2026';

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

/** Le projet posé, puis l'accueil ; `onglet` vide : on y reste. */
async function ouvrirSur(l: Ledger, onglet = 'Opérations'): Promise<void> {
  fixerLeJour('2027-01-05');
  await ouvrirLApplication();
  await app.replaceWith(l);
  await rendu();
  if (onglet) await allerA(onglet);
}

/** L'écran Opérations, sur toutes les opérations (il s'ouvre sur les non traitées). */
async function toutes(): Promise<void> {
  const s = tous<HTMLSelectElement>('main select').find((x) => [...x.options].some((o) => t(o) === 'Non traitées'))!;
  await saisir(s, 'all');
}

/** La ligne de l'opération de ce libellé, dans la liste. */
const ligne = (libelle: string): HTMLElement | undefined => tous('main .card > .row').find((r) => t(r.querySelector(':scope > button.label strong')) === libelle);
const geste = (libelle: string) => tous<HTMLButtonElement>(':scope > button', ligne(libelle)!).find((b) => t(b) === GESTE);
const ouvrirLOperation = (libelle: string) => presser(ligne(libelle)!.querySelector(':scope > button.label') as HTMLElement);
const cocher = (libelle: string) => presser(ligne(libelle)!.querySelector('label.cocher input') as HTMLElement);
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
/** Le choix du flux dans la section ou le panneau : la liste qui offre la paie. */
const choixDuFlux = (dans: Element) => tous<HTMLSelectElement>('select', dans).find((s) => [...s.options].some((o) => t(o).startsWith('Paie ·')))!;
const reprendre = (occ: Element) => presser(tous<HTMLButtonElement>('button', occ).find((b) => t(b) === 'Reprendre')!);
/** Le panneau des actions groupées ouvert sur les cibles cochées, et son choix d'un flux. */
async function actionsSur(libelles: string[]): Promise<{ form: HTMLElement; choix: HTMLSelectElement }> {
  for (const l of libelles) await cocher(l);
  expect(await cliquer(`Actions sur ${libelles.length} opération(s)`)).toBe(true);
  const form = document.querySelector('main form.edit') as HTMLElement;
  const champ = tous('label.f', form).find((x) => t(x).startsWith(TITRE));
  return { form, choix: champ?.querySelector('select') as HTMLSelectElement };
}

/**
 * La reprise écrite, et relue après un redémarrage : l'opération reprend l'occurrence, verrouillée, avec
 * la ventilation du flux ; aucun flux n'a changé.
 */
async function laRepriseTient(id: string, date: string, fluxAvant: string): Promise<void> {
  const verifier = () => {
    expect(lu(id)).toMatchObject({ plannedFlowId: 'f-paie', plannedDate: date, state: 'locked' });
    expect(partsDe(id)).toEqual(['cat-salaire']);
    expect(JSON.stringify(projet().plannedFlows), 'le flux a changé').toBe(fluxAvant);
  };
  verifier();
  await rouvrirLApplication();
  verifier();
}

describe('[niveau 1] #445 · 5. (I5) depuis l’accueil, en deux gestes', () => {
  it('l’onglet Opérations, sur son filtre d’ouverture, puis le geste de la ligne, qui le nomme : le panneau de la reprise s’ouvre', async () => {
    await ouvrirSur(budget(), '');
    await allerA('Opérations');
    expect(geste('SALAIRE-DEC'), 'la ligne ne porte pas le geste').toBeDefined();
    await presser(geste('SALAIRE-DEC')!);
    expect(t(ligne('SALAIRE-DEC')!.querySelector('form.reprise-ligne .titre-panneau'))).toBe(`${TITRE} — SALAIRE-DEC`);
    expect(premiereOccurrence(ligne('SALAIRE-DEC')!), 'le panneau n’offre aucune occurrence').toBeTruthy();
  });
});

describe('[niveau 0] #445 · 7. la reprise s’écrit, verrouillée, avec la ventilation du flux, le flux inchangé, et se relit après un redémarrage', () => {
  it('depuis l’opération ouverte (point 4)', async () => {
    await ouvrirSur(budget());
    const fluxAvant = JSON.stringify(projet().plannedFlows);
    await ouvrirLOperation('SALAIRE-DEC');
    await reprendre(premiereOccurrence(ligne('SALAIRE-DEC')!.querySelector('form.edit')!)!);
    await laRepriseTient('salaire-dec', '2026-12-25', fluxAvant);
  });

  it('depuis la ligne, sans l’ouvrir (point 5)', async () => {
    await ouvrirSur(budget());
    const fluxAvant = JSON.stringify(projet().plannedFlows);
    await presser(geste('SALAIRE-DEC')!);
    await reprendre(premiereOccurrence(ligne('SALAIRE-DEC')!.querySelector('form.reprise-ligne')!)!);
    await laRepriseTient('salaire-dec', '2026-12-25', fluxAvant);
  });

  it('par la sélection, à « Appliquer » (point 6)', async () => {
    await ouvrirSur(budget());
    const fluxAvant = JSON.stringify(projet().plannedFlows);
    const { choix } = await actionsSur(['SALAIRE-DEC', 'SALAIRE-JAN']);
    await saisir(choix, 'f-paie');
    expect(await cliquerExactement('Appliquer maintenant')).toBe(true);
    await laRepriseTient('salaire-dec', '2026-12-25', fluxAvant);
    await laRepriseTient('salaire-jan', '2027-01-25', fluxAvant);
  });
});

describe('[niveau 0] #445 · 9. rien ne s’écrit avant le geste (I10)', () => {
  it('ouvrir la section, le panneau de la ligne et celui des actions groupées, y choisir un flux, lire l’aperçu, fermer, quitter l’écran : la base relue est identique', async () => {
    await ouvrirSur(budget(), 'Plan');
    const avant = JSON.stringify(projet());
    await allerA('Opérations');
    await toutes();
    // La section de l'opération ouverte, un autre flux choisi, puis l'opération refermée.
    await ouvrirLOperation('SALAIRE-DEC');
    const form = ligne('SALAIRE-DEC')!.querySelector('form.edit')!;
    expect(tous('h3', form).map(t)).toContain(TITRE);
    await saisir(choixDuFlux(form), 'f-prime');
    await ouvrirLOperation('SALAIRE-DEC');
    // Le panneau de la ligne, un autre flux choisi, puis « Fermer ».
    await presser(geste('SALAIRE-DEC')!);
    await saisir(choixDuFlux(ligne('SALAIRE-DEC')!.querySelector('form.reprise-ligne')!), 'f-prime');
    await cliquerExactement('Fermer');
    expect(ligne('SALAIRE-DEC')!.querySelector('form.reprise-ligne')).toBeNull();
    // Le panneau des actions groupées, un flux choisi et son aperçu, puis « Fermer ».
    const { form: groupe, choix } = await actionsSur(['SALAIRE-DEC', 'SALAIRE-JAN']);
    await saisir(choix, 'f-paie');
    expect(tous('.apercu-reprises .row', groupe)).toHaveLength(2);
    await cliquerExactement('Fermer');
    await allerA('Plan');
    expect(JSON.stringify(projet())).toBe(avant);
  });
});

describe('[niveau 2] #445 · 4. depuis l’opération ouverte', () => {
  it('la section, avec « Reprendre une saisie » : les flux offerts, du plus proche en montant, et les occurrences de celui qui est choisi, avec l’écart ; ouvrir n’écrit rien', async () => {
    await ouvrirSur(budget());
    const avant = instantané();
    await ouvrirLOperation('SALAIRE-DEC');
    const form = ligne('SALAIRE-DEC')!.querySelector('form.edit')!;
    expect(tous('h3', form).map(t), 'l’opération ouverte ne montre pas la section').toContain(TITRE);
    expect([...form.querySelectorAll('select')].some((s) => [...s.options].map(t).join('|') === `Paie · ${fmt(euros(2500))}|Prime · ${fmt(euros(300))}`), 'les flux offerts, du plus proche en montant').toBe(true);
    const occ = premiereOccurrence(form)!;
    expect(t(occ)).toContain('Occurrence du 25 déc. 2026');
    expect(t(occ)).toContain(`écart ${fmt(-euros(20))}`);
    expect(instantané(), 'ouvrir l’opération a écrit').toBe(avant);
  });
});

describe('[niveau 2] #445 · 7 et 8. aussitôt, sans recharger ; puis défaite', () => {
  it('la ligne dit ce qu’elle reprend, avec l’écart ; l’occurrence n’est plus attendue, non reçue ; défaite, l’opération reste verrouillée avec sa ventilation, l’occurrence se signale de nouveau et s’offre de nouveau', async () => {
    await ouvrirSur(budget());
    expect(await attendusNonRecus(), 'le décor ne montre pas l’occurrence du 25 décembre attendue, non reçue').toContain(ATTENDU);
    await ouvrirLOperation('SALAIRE-DEC');
    await reprendre(premiereOccurrence(ligne('SALAIRE-DEC')!.querySelector('form.edit')!)!);
    // Aussitôt : la ligne, restée à l'écran malgré le filtre « Non traitées », dit ce qu'elle reprend.
    expect(t(ligne('SALAIRE-DEC'))).toContain(`reprend l’opération prévue « Paie » du 25 déc. 2026 · écart ${fmt(-euros(20))}`);
    expect(geste('SALAIRE-DEC'), 'une opération qui reprend ne porte plus le geste').toBeUndefined();
    expect(await attendusNonRecus()).not.toContain(ATTENDU);

    await toutes();
    await ouvrirLOperation('SALAIRE-DEC');
    expect(await cliquer('Défaire la reprise')).toBe(true);
    expect(lu('salaire-dec').plannedFlowId).toBeUndefined();
    expect(lu('salaire-dec').state).toBe('locked');
    expect(partsDe('salaire-dec')).toEqual(['cat-salaire']);
    expect(geste('SALAIRE-DEC'), 'défaite, l’occurrence s’offre de nouveau').toBeDefined();
    // Sa fenêtre est passée au 5 janvier, sur un compte suivi : attendue, non reçue de nouveau.
    expect(await attendusNonRecus()).toContain(ATTENDU);
  });
});

describe('[niveau 2] #445 · 5. sur la ligne, sans l’ouvrir', () => {
  it('le geste, sur les seules lignes concernées ; le panneau qui nomme l’opération ; le choix d’un flux ; la fermeture qui n’écrit rien ; le reste de la ligne inchangé', async () => {
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
    await reprendre(premiereOccurrence(ligne('SALAIRE-DEC')!.querySelector('form.reprise-ligne')!)!);
    expect(lu('salaire-dec')).toMatchObject({ plannedFlowId: 'f-paie', plannedDate: '2026-12-25', state: 'locked' });
    expect(ligne('SALAIRE-DEC')!.querySelector('form.reprise-ligne')).toBeNull();

    // Le reste de la ligne ne change pas : sa case se coche, et la toucher ouvre l'opération.
    await cocher('LOYER-DEC');
    expect(tous<HTMLButtonElement>('main button').some((b) => t(b) === 'Actions sur 1 opération(s)')).toBe(true);
    await ouvrirLOperation('LOYER-DEC');
    expect(ligne('LOYER-DEC')!.querySelector('form.edit:not(.reprise-ligne)')).toBeTruthy();
  });
});

describe('[niveau 2] #445 · 6. par la sélection', () => {
  it('le flux offert ; l’aperçu pour chaque cible, avec l’écart ; ni catégorie ni automatisme avec une reprise ; « Appliquer » ne fait que les reprises', async () => {
    await ouvrirSur(budget());
    await toutes();
    const { form, choix } = await actionsSur(['SALAIRE-DEC', 'SALAIRE-JAN', 'COURSES']);
    expect([...choix.options].map(t)).toEqual(['— (ne pas reprendre)', `Paie · ${fmt(euros(2500))}`, `Prime · ${fmt(euros(300))}`]);
    const avant = instantané();
    await saisir(choix, 'f-paie');
    const apercu = tous('.apercu-reprises .row', form).map(t);
    expect(apercu.find((x) => x.startsWith('SALAIRE-DEC'))).toContain(`reprend l’opération prévue « Paie » du 25 déc. 2026 · écart ${fmt(-euros(20))}`);
    expect(apercu.find((x) => x.startsWith('SALAIRE-JAN'))).toContain(`reprend l’opération prévue « Paie » du 25 janv. 2027 · écart ${fmt(-euros(10))}`);
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

  it('sans flux offert, le panneau le dit ; dans un projet sans flux, ni geste, ni section, ni mot (U5)', async () => {
    await ouvrirSur(budget());
    await actionsSur(['SALAIRE-DEC', 'LOYER-DEC']);
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
    await ouvrirLOperation('SALAIRE-DEC');
    expect(tous('h3', ligne('SALAIRE-DEC')!).map(t), 'sans flux offert, la section est montrée').not.toContain(TITRE);
    await ouvrirLOperation('SALAIRE-DEC');
    expect(await cliquer('Actions sur')).toBe(true);
    expect(t(document.querySelector('main form.edit'))).not.toContain('occurrence');
  });

  /** Un compte, une paie et un loyer prévus, sans catégorie ; des opérations selon `operations`. */
  const avecFlux = (operations: Operation[]): Ledger => {
    const l = emptyLedger({ periodStartDay: 1 });
    l.accounts.push({ id: CC, name: 'Compte courant', kind: 'principal', openingBalance: euros(1000), openingDate: '2026-09-30' });
    l.plannedFlows.push(flux({ id: 'f-paie', name: 'Paie', amount: euros(2500) }), flux({ id: 'f-loyer', name: 'Loyer', kind: 'fixedCharge', amount: -euros(700), periodicity: { interval: 1, unit: 'month', anchorDate: '2026-10-05' } }));
    l.operations.push(...operations);
    return l;
  };
  const panneau = () => t(document.querySelector('main form.edit'));

  it('sans cible concernée, il ne parle pas de la reprise : U1, un projet qui a des flux et aucun import, ses saisies visées', async () => {
    await ouvrirSur(avecFlux([opération({ id: 'courses', date: '2026-12-10', amount: -euros(50), origin: 'manual', state: 'locked' })]));
    await toutes();
    expect(await cliquer('Actions sur 1 opération(s)')).toBe(true);
    expect(panneau()).toContain('Actions à appliquer');
    expect(panneau()).not.toContain('occurrence');
  });

  it('des cibles cochées dont aucune n’est concernée — une saisie, une opération qui reprend déjà — : rien sur la reprise ; une concernée de plus : le choix revient', async () => {
    await ouvrirSur(
      avecFlux([
        opération({ id: 'courses', date: '2026-12-10', amount: -euros(50), origin: 'manual', state: 'locked' }),
        opération({ id: 'salaire-nov', date: '2026-11-25', amount: euros(2500), state: 'reconciled', plannedFlowId: 'f-paie', plannedDate: '2026-11-25' }),
        opération({ id: 'salaire-dec', date: '2026-12-19', amount: euros(2480) }),
      ]),
    );
    await toutes();
    for (const l of ['COURSES', 'SALAIRE-NOV']) await cocher(l);
    expect(await cliquer('Actions sur 2 opération(s)')).toBe(true);
    expect(panneau()).not.toContain('occurrence');
    await cocher('SALAIRE-DEC');
    expect(panneau()).toContain(TITRE);
  });
});
