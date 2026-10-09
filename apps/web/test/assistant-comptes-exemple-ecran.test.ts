// @vitest-environment jsdom
/**
 * Harnais d'audit de #417, composé parmi les tests du codeur :
 * ce que vérifiait `navigateur/assistant-comptes-exemple-harnais.test.ts` (harnais d'audit
 * de #211, « L'assistant propose les comptes de l'exemple »), sans navigateur : l'application montée sous jsdom
 * (`ecran.ts`), au jour des tests, sur un dépôt en mémoire. Chaque titre dit le point du « Fait quand » de #211 qu'il
 * vérifie, et le numéro du test retiré dans la table de #417.
 *
 * Ce qui se lit ici est ce que l'étape montre — ses lignes, ses pastilles, ses raccourcis, ses menus — et ce que la
 * validation enregistre — le projet que le dépôt relit, et l'écran Comptes qui le montre. Les propositions elles-mêmes
 * sont lues côté cœur par `packages/core/test/suggestions-comptes.test.ts`. « L'étape se franchit par son seul bouton
 * primaire » (I4) est tenu par `navigateur/assistant-simple.test.ts`, et « retrouvables dans Comptes … et
 * modifiables » (I11) par `navigateur/assistant-equivalent.test.ts`, harnais du registre.
 *
 * Niveaux (D83) : ceux des tests retirés, que la table de #417 recopie. 0 pour les points 7 et 8 de #211 (comptes 9 et
 * 10) : un nom, un solde ou une clôture que l'utilisateur a posés seraient perdus à la validation. Rouges sur deux
 * mutations : `appliquerPrincipal` renseigne le principal sans regarder ce qu'il porte ; `recalerLesClotures` recale
 * aussi les comptes clos du projet. 1 pour le point 6 (comptes 6, I11) : rouge quand l'assistant ne pose plus le
 * suivi du solde à régler (`appliquer`, `sectionComptes.svelte.ts`). 2 pour les autres : D43, D46 et D56 sont des
 * décisions.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, alive, budgetPeriodContaining, euros, MAIN_ACCOUNT_ID } from '@tirelire/core';
import {
  JOUR,
  arriverAuxComptes,
  avancer,
  centimes,
  champQuiCommence,
  cliquer,
  ecran,
  jusquAuResume,
  lire,
  ouvrirLApplication,
  presser,
  projet,
  rouvrirAuxComptes,
  saisir,
  t,
  tous,
  validerTelQuel,
} from './ecran';

/** Sur un projet vierge, l'assistant arrive au 28, jour de paie de l'exemple (#324, D44) : la veille du début de sa période. */
const VEILLE_DU_DEBUT_DE_PERIODE = addDays(budgetPeriodContaining(JOUR, 28).start, -1);

interface Ligne {
  principal: boolean;
  nom: string;
  solde: string;
  type: string;
  pastilles: string[];
  detail: string;
}

/** Les lignes de l'étape Comptes : nom, solde, type, pastilles, ce que l'étape en dit. */
const lignes = (): Ligne[] =>
  tous('main .ligne-compte').map((l) => ({
    principal: l.classList.contains('principal'),
    nom: (l.querySelector('input') as HTMLInputElement).value.trim(),
    solde: (l.querySelector('input.mt') as HTMLInputElement).value.trim(),
    type: (l.querySelector('select') as HTMLSelectElement | null)?.value ?? 'principal',
    pastilles: tous('.pill', l).map(t),
    detail: t(l.querySelector('.suite')),
  }));

/** Les raccourcis que l'étape offre encore. */
const raccourcis = () => tous('main .propositions .prop .n').map(t);

/** Retire d'un clic la ligne de compte qui porte ce nom. */
async function retirer(nom: string) {
  const ligne = tous('main .ligne-compte').find((l) => (l.querySelector('input') as HTMLInputElement).value.trim() === nom);
  const b = ligne?.querySelector('button.danger') as HTMLButtonElement | null | undefined;
  expect(b, `la ligne « ${nom} » n’a pas de bouton pour la retirer`).toBeTruthy();
  await presser(b!);
}

/** Les cartes de l'écran Comptes : leur nom, leurs pastilles, leur texte. */
const cartes = () =>
  tous('main .card')
    .filter((c) => c.querySelector('.pill'))
    .map((c) => ({
      nom: (c.querySelector(':scope > .ligne-compte > input') as HTMLInputElement | null)?.value.trim() ?? t(c.querySelector('strong')),
      pastilles: tous('.pill', c).map(t),
      texte: t(c),
    }));

/** L'écran Comptes range les comptes clos (D56) : pour les lire, on allume « Clos ». */
async function montrerLeClos() {
  const b = tous<HTMLButtonElement>('main button.filtre').find((x) => t(x).startsWith('Clos') && x.getAttribute('aria-pressed') === 'false');
  if (b) await presser(b);
}

/** Ouvre le formulaire d'un compte, depuis sa carte de l'écran Comptes. */
async function modifier(nom: string) {
  const nomDuCompte = (c: Element) => (c.querySelector(':scope > .ligne-compte > input') as HTMLInputElement | null)?.value.trim() ?? t(c.querySelector('strong'));
  const carte = tous('main .card').find((c) => nomDuCompte(c) === nom);
  const b = tous<HTMLButtonElement>('button', carte ?? document.createElement('div')).find((x) => t(x) === 'Modifier');
  expect(b, `pas de bouton « Modifier » sur la carte « ${nom} »`).toBeTruthy();
  await presser(b!);
}

/** Le jour où la période commence, tel que l'étape des revenus l'affiche. */
const jourDeDebutDePeriode = () => {
  const label = tous('main form.edit label.f').find((x) => t(x).startsWith('La période commence le'));
  return Number((label?.querySelector('input') as HTMLInputElement | null)?.value);
};

/** Les comptes vivants du projet enregistré, par nom. */
const comptesDuProjet = () => new Map(alive(projet().accounts).map((a) => [a.name, a]));

describe('#417 · #211 — l’étape Comptes sur un projet vierge, sans navigateur', () => {
  let arrivee: Ligne[];

  beforeAll(async () => {
    await ouvrirLApplication();
    await arriverAuxComptes();
    arrivee = lignes();
  });

  it('[niveau 2] #211 point 1 (table #417, comptes 1) — l’étape Comptes arrive avec « Livret A », « Carte enfants », « Compte de Marie » et « Livret jeune », chacun avec son nom, son type et son solde', () => {
    const autres = arrivee.filter((l) => !l.principal);
    expect(autres.map((l) => l.nom)).toEqual(['Livret A', 'Carte enfants', 'Compte de Marie', 'Livret jeune']);
    expect(autres.map((l) => l.type)).toEqual(['epargne', 'courant', 'courant', 'epargne']);
    expect(autres.map((l) => centimes(l.solde))).toEqual([euros(4815), 0, 0, 0]);
  });

  it('[niveau 2] #211 point 1 (table #417, comptes 2) — les raccourcis sont tous consommés d’entrée : la rangée des raccourcis est vide, et le bouton primaire de l’étape est « Suivant » (D46)', () => {
    expect(raccourcis(), 'sur un projet vierge, la rangée des raccourcis est vide').toEqual([]);
    expect(lire().primaires.some((p) => /Suivant/.test(p))).toBe(true);
  });

  it('[niveau 2] #211 point 2 (table #417, comptes 3) — le compte principal arrive avec le nom « Compte courant » et le solde 2 340,00 €', () => {
    const principal = arrivee.filter((l) => l.principal);
    expect(principal).toHaveLength(1);
    expect(principal[0]!.nom).toBe('Compte courant');
    expect(centimes(principal[0]!.solde)).toBe(euros(2340));
  });

  it('[niveau 2] #211 point 3 (table #417, comptes 4) — l’étape dit qu’un compte est tiers, avec le suivi de son solde à régler tel que l’exemple le dit, et qu’un compte est clos', () => {
    const par = (nom: string) => arrivee.find((l) => l.nom === nom)!;
    for (const nom of ['Carte enfants', 'Compte de Marie']) {
      expect(par(nom).pastilles, nom).toContain('tiers');
      expect(par(nom).detail, nom).toContain('10,00');
      expect(par(nom).detail, nom).toContain('dans les deux sens');
    }
    expect(par('Livret jeune').pastilles).toContain('clos');
    for (const nom of ['Livret A', 'Compte courant']) {
      expect(par(nom).pastilles, nom).not.toContain('tiers');
      expect(par(nom).pastilles, nom).not.toContain('clos');
    }
  });

  it('[niveau 2] #211 point 3 (table #417, comptes 5) — le compte clos ne figure plus dans les menus de comptes des autres étapes (D56)', async () => {
    expect(await avancer()).toBe(true); // → les revenus
    const menus = tous<HTMLSelectElement>('main select')
      .filter((s) => [...s.options].some((o) => t(o) === 'Livret A'))
      .map((s) => [...s.options].map(t));
    expect(menus.length, 'aucun menu de comptes à l’étape des revenus').toBeGreaterThan(0);
    for (const options of menus) {
      expect(options).toContain('Compte courant');
      expect(options).toContain('Carte enfants');
      expect(options).not.toContain('Livret jeune');
    }
    expect(await cliquer('Précédent')).toBe(true);
  });

  it('[niveau 1] #211 point 6 (table #417, comptes 6) — validé tel quel, l’assistant laisse les comptes de l’exemple dans le projet, avec leur suivi et leur clôture, et Comptes les montre', async () => {
    await validerTelQuel();

    // Le projet enregistré porte les cinq comptes, le suivi des comptes tiers et la clôture du compte clos.
    const comptes = comptesDuProjet();
    expect([...comptes.keys()].sort()).toEqual(['Carte enfants', 'Compte courant', 'Compte de Marie', 'Livret A', 'Livret jeune']);
    expect(comptes.get('Compte courant')!.id).toBe(MAIN_ACCOUNT_ID);
    expect(comptes.get('Compte courant')!.openingBalance).toBe(euros(2340));
    expect(comptes.get('Livret A')!.openingBalance).toBe(euros(4815));
    for (const nom of ['Carte enfants', 'Compte de Marie']) {
      expect(comptes.get(nom)!.tracksSettlement, nom).toBe(true);
      expect(comptes.get(nom)!.settlementThreshold, nom).toBe(euros(10));
      expect(comptes.get(nom)!.settlementDirection, nom).toBe('both');
    }
    expect(comptes.get('Livret jeune')!.activeTo).toBe(VEILLE_DU_DEBUT_DE_PERIODE);
    for (const nom of ['Carte enfants', 'Compte de Marie', 'Livret A', 'Compte courant']) expect(comptes.get(nom)!.activeTo, nom).toBeUndefined();

    // L'écran Comptes les montre, le clos rangé derrière « Clos » (D56), et le suivi se lit dans le formulaire.
    expect(await ecran('Comptes')).toBe(true);
    const avantLeClos = cartes();
    expect(avantLeClos.map((c) => c.nom).sort()).toEqual(['Carte enfants', 'Compte courant', 'Compte de Marie', 'Livret A']);
    expect(avantLeClos.find((c) => c.nom === 'Compte courant')!.pastilles).toContain('principal');
    expect(avantLeClos.find((c) => c.nom === 'Livret A')!.texte).toMatch(/solde initial 4\s?815,00/);
    await modifier('Carte enfants');
    expect(champQuiCommence('Suivre un solde à régler')).toBe(true);
    expect(champQuiCommence('Seuil de règlement')).toBe('10,00');
    expect(champQuiCommence('Sens autorisé')).toBe('both');
    await montrerLeClos();
    expect(cartes().find((c) => c.nom === 'Livret jeune')?.pastilles).toContain('clos');
    await modifier('Livret jeune');
    expect(champQuiCommence('Compte clos le')).toBe(VEILLE_DU_DEBUT_DE_PERIODE);
  });
});

describe('#417 · #211 — la clôture du compte clos quand le début de période est choisi dans l’assistant, sans navigateur', () => {
  it('[niveau 2] #211 point 3 (table #417, comptes 7) — la clôture du compte clos reste la veille du premier jour de la période qui contient la date de l’assistant, quel que soit le jour où la période commence', async () => {
    await ouvrirLApplication();
    await arriverAuxComptes();
    expect(await avancer(), 'l’étape des revenus ne se franchit pas par son bouton primaire').toBe(true);
    expect(await cliquer('Suivre le mois calendaire'), 'pas de raccourci « Suivre le mois calendaire »').toBe(true);
    const jour = jourDeDebutDePeriode();
    expect(jour, 'le jour proposé est le 28, le même qu’au départ : ce test ne départagerait rien').toBe(1);
    await validerTelQuel();

    const veille = addDays(budgetPeriodContaining(JOUR, jour).start, -1);
    expect(veille).not.toBe(VEILLE_DU_DEBUT_DE_PERIODE);
    expect(projet().settings.periodStartDay).toBe(jour);
    expect(comptesDuProjet().get('Livret jeune')!.activeTo, `la période qui contient ${JOUR} commence le ${budgetPeriodContaining(JOUR, jour).start} : la clôture est la veille`).toBe(veille);
    expect(await ecran('Comptes')).toBe(true);
    await montrerLeClos();
    await modifier('Livret jeune');
    expect(champQuiCommence('Compte clos le')).toBe(veille);
  });
});

describe('#417 · #211 — les raccourcis sur un projet existant, sans navigateur', () => {
  it('[niveau 2] #211 point 4 (table #417, comptes 8) — les raccourcis offrent les comptes de l’exemple qui manquent, chacun disparaît dès qu’un compte du même nom existe, et rien n’est semé d’office', async () => {
    await ouvrirLApplication();
    await arriverAuxComptes();
    for (const nom of ['Carte enfants', 'Compte de Marie', 'Livret jeune']) await retirer(nom);
    await validerTelQuel();

    // Le projet n'est plus vierge : l'assistant part de son contenu, il ne sème plus rien (D43).
    await rouvrirAuxComptes();
    expect(lignes().map((l) => l.nom), 'sur un projet existant, rien n’est semé d’office').toEqual(['Compte courant', 'Livret A']);
    expect(raccourcis()).toEqual(['+ Carte enfants', '+ Compte de Marie', '+ Livret jeune']);

    // Un compte saisi à la main sous le même nom fait disparaître le raccourci.
    const nom = document.querySelector('main form.edit input[placeholder="Carte enfants"]') as HTMLInputElement | null;
    expect(nom, 'le formulaire d’ajout n’a pas pour aide le premier raccourci restant').toBeTruthy();
    await saisir(nom!, 'Compte de Marie');
    expect(await cliquer('Ajouter un compte')).toBe(true);
    expect(raccourcis()).toEqual(['+ Carte enfants', '+ Livret jeune']);

    // Un raccourci crée la ligne, avec ce que l'exemple en dit, et disparaît à son tour.
    expect(await cliquer('+ Carte enfants')).toBe(true);
    expect(await cliquer('+ Livret jeune')).toBe(true);
    const apres = lignes();
    expect(apres.map((l) => l.nom)).toEqual(['Compte courant', 'Livret A', 'Compte de Marie', 'Carte enfants', 'Livret jeune']);
    expect(apres.find((l) => l.nom === 'Carte enfants')!.pastilles).toContain('tiers');
    expect(apres.find((l) => l.nom === 'Livret jeune')!.pastilles).toContain('clos');
    expect(centimes(apres.find((l) => l.nom === 'Livret jeune')!.solde)).toBe(0);
    expect(raccourcis(), 'tous les comptes de l’exemple sont là : plus de raccourci').toEqual([]);
  });
});

describe('#417 · #211 — ce que le projet porte déjà, sans navigateur', () => {
  it('[niveau 0] #211 point 7 (table #417, comptes 9) — sur un projet vierge dont le compte principal porte un nom et un solde que l’utilisateur a posés, l’assistant validé laisse ce nom et ce solde ; les autres comptes de l’exemple entrent', async () => {
    await ouvrirLApplication();
    expect(await ecran('Comptes')).toBe(true);
    // Le nom et le solde du compte principal se corrigent sur sa ligne, écrits aussitôt dans le projet (#362).
    await saisir(document.querySelector('main .ligne-compte.principal > input:first-child') as HTMLInputElement, 'Compte de la maison');
    await saisir(document.querySelector('main .ligne-compte.principal input.mt') as HTMLInputElement, '1 500,00');
    expect(comptesDuProjet().get('Compte de la maison')?.openingBalance, 'la saisie n’a pas été enregistrée').toBe(euros(1500));

    await arriverAuxComptes();
    const l = lignes();
    const principal = l.find((x) => x.principal)!;
    expect(principal.nom, 'le nom que l’utilisateur a posé a été remplacé').toBe('Compte de la maison');
    expect(centimes(principal.solde), 'le solde que l’utilisateur a posé a été remplacé').toBe(euros(1500));
    expect(l.filter((x) => !x.principal).map((x) => x.nom), 'les autres comptes de l’exemple arrivent, le projet étant vierge').toEqual([
      'Livret A',
      'Carte enfants',
      'Compte de Marie',
      'Livret jeune',
    ]);

    await validerTelQuel();
    const comptes = comptesDuProjet();
    const enregistre = alive(projet().accounts).find((a) => a.id === MAIN_ACCOUNT_ID)!;
    expect(enregistre.name, 'le projet validé ne porte plus le nom posé par l’utilisateur').toBe('Compte de la maison');
    expect(enregistre.openingBalance, 'le projet validé ne porte plus le solde posé par l’utilisateur').toBe(euros(1500));
    expect([...comptes.keys()].sort()).toEqual(['Carte enfants', 'Compte de Marie', 'Compte de la maison', 'Livret A', 'Livret jeune']);
  });

  it('[niveau 0] #211 point 8 (table #417, comptes 10) — sur un projet dont un compte clos porte sa clôture, rouvrir l’assistant, changer le jour de début de période et valider ne déplace pas cette clôture', async () => {
    await ouvrirLApplication();
    await arriverAuxComptes();
    expect(await jusquAuResume()).toBe(true);
    expect(await cliquer('Valider mon budget')).toBe(true);
    expect(comptesDuProjet().get('Livret jeune')!.activeTo, 'au départ, la clôture est celle du premier passage (début de période le 28)').toBe(VEILLE_DU_DEBUT_DE_PERIODE);

    // On rouvre l'assistant sur ce projet, on suit le mois calendaire, on valide de nouveau.
    await rouvrirAuxComptes();
    expect(await avancer(), 'l’étape des revenus ne se franchit pas par son bouton primaire').toBe(true);
    expect(await cliquer('Suivre le mois calendaire'), 'pas de raccourci « Suivre le mois calendaire »').toBe(true);
    expect(jourDeDebutDePeriode(), 'le jour proposé est le 28, celui du premier passage : ce test ne départagerait rien').toBe(1);
    await validerTelQuel();

    expect(projet().settings.periodStartDay, 'le second passage n’a pas enregistré le nouveau début de période').toBe(1);
    expect(comptesDuProjet().get('Livret jeune')!.activeTo, 'la clôture que le projet portait a été déplacée par le second passage').toBe(VEILLE_DU_DEBUT_DE_PERIODE);
    expect(await ecran('Comptes')).toBe(true);
    await montrerLeClos();
    await modifier('Livret jeune');
    expect(champQuiCommence('Compte clos le')).toBe(VEILLE_DU_DEBUT_DE_PERIODE);
  });
});
