// @vitest-environment jsdom
/**
 * Harnais d'audit de #417, composé parmi les tests du codeur :
 * ce que vérifiait `navigateur/assistant-flux-exemple-harnais.test.ts` (harnais d'audit de
 * #213, « L'assistant propose tous les revenus et toutes les charges fixes de l'exemple, versions datées comprises »),
 * sans navigateur : l'application montée sous jsdom (`ecran.ts`), au jour des tests (20 septembre 2026), sur un dépôt
 * en mémoire. Chaque titre dit le point du « Fait quand » de #213 qu'il vérifie, et le numéro du test retiré dans la
 * table de #417.
 *
 * Ce qui se lit ici est ce que les étapes Revenus et Charges fixes montrent — leurs lignes, leurs dates, leurs
 * raccourcis — et ce que la validation enregistre — le projet que le dépôt relit, et l'écran Flux prévus qui le
 * montre, où les dates se modifient. Les propositions elles-mêmes sont lues côté cœur par
 * `packages/core/test/suggestions.test.ts` (niveau 2) et `suggestions-flux.test.ts` ; ce que le bandeau compte, par
 * `packages/core/test/suggestions-flux-harnais.test.ts`, « #213 · point 4 » (niveau 2). « L'étape se franchit par son
 * seul bouton primaire » (I4) est tenu par `navigateur/assistant-simple.test.ts`, harnais du registre.
 *
 * Les dates se lisent à l'écran sous la forme de l'application (« jusqu’au 27 oct. 2026 ») : seuls le jour et l'année
 * sont figés.
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #417 recopie. 1 pour le point 7 (flux 10 et 12, I11). Rouges
 * sur deux mutations : l'assistant pose les flux sans leurs dates de début et de fin (10) ; Flux prévus n'enregistre
 * plus la date de fin (12). 2 pour les autres : D43, D46 et D50 sont des décisions.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { alive, euros, exampleLedger, type PlannedFlow } from '@tirelire/core';
import {
  arriverAuxComptes,
  avancer,
  centimes,
  champQuiCommence,
  cliquer,
  ecran,
  lire,
  ouvrirLApplication,
  presser,
  projet,
  rouvrirAuxComptes,
  saisir,
  saisirQuiCommence,
  t,
  tous,
  validerTelQuel,
} from './ecran';

interface Ligne {
  nom: string;
  montant: string;
  jour: string;
  suites: string[];
  pastilles: string[];
}

/** Les lignes de flux de l'étape en cours (Revenus ou Charges fixes). */
const lignes = (): Ligne[] =>
  tous('main .ligne-flux').map((l) => ({
    nom: (l.querySelector('input.nom') as HTMLInputElement).value.trim(),
    montant: (l.querySelector('input.mt') as HTMLInputElement).value.trim(),
    jour: ((l.querySelectorAll('input.jour')[0] as HTMLInputElement | undefined)?.value ?? '').trim(),
    suites: tous('.suite', l).map(t),
    pastilles: tous('.pill', l).map(t),
  }));

/** Les raccourcis que l'étape offre encore : libellé et montant. */
const raccourcis = () =>
  tous('main .propositions .prop')
    .filter((b) => t(b.querySelector('.n')).startsWith('+ '))
    .map((b) => ({ nom: t(b.querySelector('.n')), montant: t(b.querySelector('.v')) }));

/** Ouvre l'assistant sur un projet vierge, jusqu'à l'étape des revenus. */
async function arriverAuxRevenus() {
  await arriverAuxComptes();
  expect(await avancer(), 'l’étape Comptes ne se franchit pas par son bouton primaire').toBe(true);
  expect(lire().h2).toMatch(/Qu.est-ce qui rentre/);
}

/** Rouvre l'assistant sur un projet existant, jusqu'à l'étape des revenus. */
async function rouvrirAuxRevenus() {
  await rouvrirAuxComptes();
  expect(await avancer()).toBe(true);
  expect(lire().h2).toMatch(/Qu.est-ce qui rentre/);
}

/** Un projet existant : l'assistant parcouru sans rien changer, puis validé. */
async function projetValide() {
  await ouvrirLApplication();
  await arriverAuxRevenus();
  await validerTelQuel();
}

/** Retire d'un clic la première ligne de l'étape en cours qui porte ce nom. */
async function retirer(nom: string) {
  const c = tous<HTMLInputElement>('main input.nom').find((i) => i.value.trim() === nom);
  const b = c?.closest('.ligne-flux')?.querySelector('button.danger') as HTMLButtonElement | null | undefined;
  expect(b, `la ligne « ${nom} » n’a pas de bouton pour la retirer`).toBeTruthy();
  await presser(b!);
}

interface LigneEcran {
  nom: string;
  genre: string;
  sous: string;
}

/** Les lignes de l'écran Flux prévus : leur nom, leur groupe, ce qu'elles disent sous le nom. */
const fluxPrevus = (): LigneEcran[] =>
  tous('main .row')
    .filter((r) => r.querySelector('.label strong'))
    .map((r) => ({ nom: t(r.querySelector('.label strong')), genre: t(r.closest('.card')?.previousElementSibling), sous: t(r.querySelector('.label .sub')) }));

const revenusEtCharges = (l: LigneEcran[]) => l.filter((x) => /^(Revenus|Charges fixes)/.test(x.genre));

/** Ouvre le formulaire du flux de Flux prévus dont la ligne dit ceci sous son nom. */
async function modifier(nom: string, sousContient: RegExp) {
  const ligne = tous('main .row').find((r) => t(r.querySelector('.label strong')) === nom && sousContient.test(t(r.querySelector('.label .sub'))));
  const b = tous<HTMLButtonElement>('button', ligne ?? document.createElement('div')).find((x) => t(x) === 'Modifier');
  expect(b, `pas de bouton « Modifier » sur la ligne « ${nom} » (${sousContient})`).toBeTruthy();
  await presser(b!);
}

const exemple = exampleLedger();
const compteDe = (id: string) => alive(exemple.accounts).find((a) => a.id === id)!.name;
const fluxDeLExemple = alive(exemple.plannedFlows).filter((f) => f.kind === 'income' || f.kind === 'fixedCharge');
/** Les revenus et les charges fixes du projet enregistré. */
const fluxDuProjet = () => alive(projet().plannedFlows).filter((f) => f.kind === 'income' || f.kind === 'fixedCharge');

describe('#417 · #213 — l’étape Revenus sur un projet vierge, sans navigateur', () => {
  let arrivee: Ligne[];

  beforeAll(async () => {
    await ouvrirLApplication();
    await arriverAuxRevenus();
    arrivee = lignes();
  });

  it('[niveau 2] #213 point 1 (table #417, flux 1) — l’étape arrive avec les quatre revenus de l’exemple, et eux seuls : les deux « Salaire », « Loyer locatif », « Allocations »', () => {
    expect(arrivee.map((l) => l.nom)).toEqual(['Salaire', 'Salaire', 'Loyer locatif', 'Allocations']);
  });

  it('[niveau 2] #213 point 2 (table #417, flux 2) — chacun avec son montant et son jour, tels que l’exemple les dit', () => {
    expect(arrivee.map((l) => centimes(l.montant))).toEqual([euros(3400), euros(3550), euros(700), euros(100)]);
    expect(arrivee.map((l) => l.jour)).toEqual(['28', '28', '5', '5']);
  });

  it('[niveau 2] #213 point 3 (table #417, flux 3) — deux versions d’un même flux se lisent comme deux lignes du même nom, chacune avec sa date', () => {
    const [avant, apres, loyer, alloc] = arrivee as [Ligne, Ligne, Ligne, Ligne];
    expect(avant.suites.join(' ')).toMatch(/jusqu’au 27 \S+ 2026/);
    expect(apres.suites.join(' ')).toMatch(/à partir du 28 \S+ 2026/);
    expect(apres.pastilles).toContain('à venir');
    expect(avant.pastilles).not.toContain('à venir');
    for (const l of [loyer, alloc]) expect(l.suites.join(' '), l.nom).not.toMatch(/jusqu’au|à partir du/);
  });

  it('[niveau 2] #213 point 1 (table #417, flux 4) — les raccourcis sont tous consommés d’entrée : la rangée des raccourcis est vide, et le bouton primaire de l’étape est « Suivant » (D46)', () => {
    expect(raccourcis(), 'sur un projet vierge, la rangée des raccourcis est vide').toEqual([]);
    expect(lire().primaires.some((p) => /Suivant/.test(p))).toBe(true);
  });

  it('[niveau 2] #213 point 3 (table #417, flux 5) — les deux lignes « Salaire » se retirent une à une', async () => {
    await retirer('Salaire');
    const reste = lignes();
    expect(reste.map((l) => l.nom)).toEqual(['Salaire', 'Loyer locatif', 'Allocations']);
    expect(reste[0]!.suites.join(' '), 'c’est la première version qui est retirée').toMatch(/à partir du 28 \S+ 2026/);
    await retirer('Salaire');
    expect(lignes().map((l) => l.nom)).toEqual(['Loyer locatif', 'Allocations']);
  });
});

describe('#417 · #213 — l’étape Charges fixes sur un projet vierge, sans navigateur', () => {
  it('[niveau 2] #213 point 1 (table #417, flux 6) — l’étape arrive avec les quatre charges fixes de l’exemple, et elles seules, chacune avec son montant, son jour et sa date de fin', async () => {
    await ouvrirLApplication();
    await arriverAuxRevenus();
    expect(await avancer()).toBe(true);
    expect(lire().h2).toMatch(/Qu.est-ce qui part tout seul/);
    const l = lignes();
    expect(l.map((x) => x.nom)).toEqual(['Crédit immobilier', 'Assurance habitation', 'Internet et mobiles', 'Électricité']);
    expect(l.map((x) => centimes(x.montant))).toEqual([euros(950), euros(45), euros(75), euros(150)]);
    expect(l.map((x) => x.jour)).toEqual(['5', '10', '12', '15']);
    expect(l[0]!.suites.join(' ')).toMatch(/jusqu’au 5 \S+ 2026/);
    for (const x of l.slice(1)) expect(x.suites.join(' '), x.nom).not.toMatch(/jusqu’au|à partir du/);
    expect(raccourcis(), 'sur un projet vierge, la rangée des raccourcis est vide').toEqual([]);
  });
});

describe('#417 · #213 — sur un projet existant, sans navigateur', () => {
  it('[niveau 2] #213 points 5 et 9 (table #417, flux 8) — le raccourci d’un flux apporte toutes ses versions, avec leurs dates, et disparaît dès qu’un flux du même nom existe ; il montre le montant de la version en vigueur', async () => {
    await projetValide();
    await rouvrirAuxRevenus();
    expect(lignes().map((l) => l.nom), 'sur un projet existant, rien n’est semé d’office').toEqual(['Salaire', 'Salaire', 'Loyer locatif', 'Allocations']);
    expect(raccourcis()).toEqual([]);

    await retirer('Salaire');
    expect(raccourcis(), 'une version reste : le raccourci ne revient pas').toEqual([]);
    await retirer('Salaire');
    const offerts = raccourcis();
    expect(offerts.map((r) => r.nom), 'un raccourci par flux, non par version').toEqual(['+ Salaire']);
    expect(centimes(offerts[0]!.montant)).toBe(euros(3400));

    expect(await cliquer('+ Salaire')).toBe(true);
    const apres = lignes();
    expect(apres.map((l) => l.nom).sort()).toEqual(['Allocations', 'Loyer locatif', 'Salaire', 'Salaire']);
    const salaires = apres.filter((l) => l.nom === 'Salaire');
    expect(salaires.map((l) => centimes(l.montant))).toEqual([euros(3400), euros(3550)]);
    expect(salaires[0]!.suites.join(' ')).toMatch(/jusqu’au 27 \S+ 2026/);
    expect(salaires[1]!.suites.join(' ')).toMatch(/à partir du 28 \S+ 2026/);
    expect(raccourcis(), 'tous les flux de l’exemple sont là : plus de raccourci').toEqual([]);
  });

  it('[niveau 2] #213 point 5 (table #417, flux 9) — un flux saisi à la main sous le même nom fait disparaître le raccourci', async () => {
    await projetValide();
    await rouvrirAuxRevenus();
    await retirer('Salaire');
    await retirer('Salaire');
    expect(raccourcis().map((r) => r.nom)).toEqual(['+ Salaire']);

    await saisir(document.querySelector('main form.edit input[placeholder="Salaire"]') as HTMLInputElement, 'Salaire');
    await saisir(document.querySelector('main form.edit input[placeholder="3 400,00"]') as HTMLInputElement, '2 000,00');
    expect(await cliquer('Ajouter')).toBe(true);
    expect(raccourcis()).toEqual([]);
    expect(lignes().filter((l) => l.nom === 'Salaire').map((l) => centimes(l.montant))).toEqual([euros(2000)]);
  });
});

describe('#417 · #213 — l’assistant validé tel quel, sans navigateur', () => {
  beforeAll(async () => {
    await projetValide();
    expect(await ecran('Flux prévus')).toBe(true);
  });

  it('[niveau 1] #213 point 7, I11 (table #417, flux 10) — le projet porte les huit flux de revenu et de charge fixe, et eux seuls, chacun dans son groupe et sur son compte, et Flux prévus les montre avec leur date', () => {
    const cle = (f: PlannedFlow) => `${f.name} | ${f.kind} | ${compteDe(f.accountId)} | ${f.activeFrom ?? ''} | ${f.activeTo ?? ''}`;
    expect(fluxDuProjet().map(cle).sort(), 'les flux enregistrés (nom | genre | compte | dates) ne sont pas ceux de l’exemple').toEqual(fluxDeLExemple.map(cle).sort());

    const l = revenusEtCharges(fluxPrevus());
    const vus = l.map((x) => `${x.nom} | ${/^Revenu/.test(x.genre) ? 'income' : 'fixedCharge'} | ${x.sous.split(' · ')[0]}`).sort();
    const attendus = fluxDeLExemple.map((f) => `${f.name} | ${f.kind} | ${compteDe(f.accountId)}`).sort();
    expect(vus).toEqual(attendus);
    expect(l).toHaveLength(8);
    const salaires = l.filter((x) => x.nom === 'Salaire');
    expect(salaires.map((x) => x.sous).join(' | ')).toMatch(/jusqu’au 27 \S+ 2026/);
    expect(salaires.map((x) => x.sous).join(' | ')).toMatch(/à partir du 28 \S+ 2026/);
    expect(l.find((x) => x.nom === 'Crédit immobilier')!.sous).toMatch(/jusqu’au 5 \S+ 2026/);
  });

  it('[niveau 2] #213 point 2 (table #417, flux 11) — chacun des huit flux se lit dans son formulaire tel que l’exemple le dit : montant, rythme, première date, compte, fenêtre, tolérance, motif, montant variable, dates de début et de fin', async () => {
    const n = revenusEtCharges(fluxPrevus()).length;
    const lignesDuGroupe = () => tous('main .row').filter((r) => r.querySelector('.label strong') && /^(Revenus|Charges fixes)/.test(t(r.closest('.card')?.previousElementSibling)));
    const lus = [];
    for (let i = 0; i < n; i++) {
      const b = tous<HTMLButtonElement>('button', lignesDuGroupe()[i]!).find((x) => t(x) === 'Modifier')!;
      await presser(b);
      const entree = (l: string) => tous('form.edit label.f').find((x) => t(x).startsWith(l))?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null | undefined;
      const v = (l: string) => entree(l)?.value ?? '';
      lus.push({
        nom: v('Nom'),
        compte: t((entree('Compte') as HTMLSelectElement).selectedOptions[0]),
        montant: Math.abs(centimes(v('Montant'))),
        tousLes: v('Tous les'),
        unite: v('Unité'),
        premiere: v('Première date'),
        fenetre: v('Fenêtre des échéances'),
        toleranceEuros: v('Tolérance de montant (€)') === '' ? null : centimes(v('Tolérance de montant (€)')),
        tolerancePct: v('Tolérance de montant (%)') === '' ? null : Number(v('Tolérance de montant (%)')),
        motif: v('Motif de libellé'),
        de: v('Actif à partir du'),
        a: v('Actif jusqu'),
        variable: (entree('Montant variable') as HTMLInputElement | null | undefined)?.checked ?? false,
      });
      await cliquer('Annuler');
    }
    const attendus = fluxDeLExemple.map((f) => ({
      nom: f.name,
      compte: compteDe(f.accountId),
      montant: Math.abs(f.amount),
      tousLes: String(f.periodicity.interval),
      unite: f.periodicity.unit,
      premiere: f.periodicity.anchorDate,
      fenetre: String(f.dateWindowDays),
      toleranceEuros: f.amountTolerance?.abs ?? null,
      tolerancePct: f.amountTolerance?.pct ?? null,
      motif: f.labelPattern ?? '',
      de: f.activeFrom ?? '',
      a: f.activeTo ?? '',
      variable: !!f.variable,
    }));
    const parNomEtDate = (a: { nom: string; premiere: string }, b: { nom: string; premiere: string }) => `${a.nom}|${a.premiere}`.localeCompare(`${b.nom}|${b.premiere}`);
    expect(lus.sort(parNomEtDate)).toEqual(attendus.sort(parNomEtDate));
  });

  it('[niveau 1] #213 point 7, I11 (table #417, flux 12) — les dates de début et de fin se modifient dans Flux prévus, s’enregistrent, et la ligne le dit', async () => {
    await modifier('Salaire', /jusqu’au 27/);
    expect(champQuiCommence('Actif à partir du')).toBe('');
    expect(champQuiCommence('Actif jusqu')).toBe('2026-10-27');
    await saisirQuiCommence('Actif jusqu', '2026-11-30');
    expect(await cliquer('Enregistrer')).toBe(true);
    expect(fluxPrevus().filter((x) => x.nom === 'Salaire').map((x) => x.sous).join(' | ')).toMatch(/jusqu’au 30 \S+ 2026/);

    await modifier('Salaire', /à partir du 28/);
    expect(champQuiCommence('Actif à partir du')).toBe('2026-10-28');
    expect(champQuiCommence('Actif jusqu')).toBe('');
    await saisirQuiCommence('Actif à partir du', '2026-12-01');
    expect(await cliquer('Enregistrer')).toBe(true);
    expect(fluxPrevus().filter((x) => x.nom === 'Salaire').map((x) => x.sous).join(' | ')).toMatch(/à partir du 1 \S+ 2026/);

    const salaires = alive(projet().plannedFlows).filter((f) => f.name === 'Salaire');
    expect(salaires.map((f) => [f.activeFrom ?? '', f.activeTo ?? '']).sort()).toEqual([['', '2026-11-30'], ['2026-12-01', '']]);
  });
});
