// @vitest-environment jsdom
/**
 * Tests du codeur de #417 — ce que vérifiait `navigateur/aides-exemple-harnais.test.ts` (harnais d'audit de #214,
 * « Les aides des champs viennent de l'exemple »), sans navigateur : l'application montée sous jsdom (`ecran.ts`), au
 * jour des tests (20 septembre 2026), sur un dépôt en mémoire. Chaque titre dit le point du « Fait quand » de #214
 * qu'il vérifie, et le numéro du test retiré dans la table de #417.
 *
 * Ce qui se lit ici est l'aide que chaque champ montre (son `placeholder`), la valeur que prennent les champs sans
 * texte indicatif, ce qu'une ligne ajoutée en recopiant ses aides devient dans l'étape, et ce que la validation
 * enregistre. Les fonctions de `src/lib/aides.ts` sont lues par `aides-exemple.test.ts` (niveau 4) et, à d'autres dates
 * de lecture, par `aides-exemple-harnais.test.ts` (niveau 2).
 *
 * Niveau 4, comme tout test du codeur ; l'auditeur donne le leur à ceux qu'il retient (D83) : ceux du test retiré.
 */
import { describe, expect, it } from 'vitest';
import { alive, exampleLedger } from '@tirelire/core';
import {
  arriverAuxComptes,
  avancer,
  champ,
  champs,
  cliquer,
  cliquerExactement,
  ecran,
  lire,
  ouvrirLApplication,
  presser,
  projet,
  saisir,
  t,
  tous,
  validerTelQuel,
} from './ecran';

const exemple = exampleLedger();
/** Un montant comme on le saisit : « 3 400,00 », l'espace des milliers ordinaire. */
const euros = (centimes: number) => (Math.abs(centimes) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');
const flux = alive(exemple.plannedFlows);

/** Saisit une valeur dans le champ du formulaire ouvert qui porte ce libellé. */
const saisirChamp = (libelle: string, valeur: string) => saisir(champ(libelle).el, valeur);

/** Recopie, dans chaque champ d'aide du formulaire, l'aide qu'il montre — ce que fait qui accepte les aides telles quelles. */
async function recopierLesAides(libelles: string[]) {
  for (const libelle of libelles) {
    const c = champ(libelle);
    expect(c.aide, `« ${libelle} » ne montre aucune aide à recopier`).not.toBe('');
    await saisir(c.el, c.aide);
  }
}

/** Les aides non vides des champs du formulaire ouvert, par libellé. */
const aides = () => Object.fromEntries(champs().filter((c) => c.aide !== '').map((c) => [c.libelle, c.aide]));

async function arriverAuxRevenus() {
  await arriverAuxComptes();
  expect(await avancer(), 'l’étape Comptes ne se franchit pas par son bouton primaire').toBe(true);
  expect(lire().h2).toMatch(/Qu.est-ce qui rentre/);
}

/** Les lignes de flux de l'étape en cours. */
const lignes = () =>
  tous('main .ligne-flux').map((l) => ({
    nom: (l.querySelector('input.nom') as HTMLInputElement).value.trim(),
    montant: (l.querySelector('input.mt') as HTMLInputElement).value.trim(),
    jour: ((l.querySelectorAll('input.jour')[0] as HTMLInputElement | undefined)?.value ?? '').trim(),
  }));

const raccourcis = () => tous('main .propositions .prop .n').map(t).filter((n) => n.startsWith('+ '));

async function retirer(nom: string) {
  const c = tous<HTMLInputElement>('main input.nom').find((i) => i.value.trim() === nom);
  const b = c?.closest('.ligne-flux')?.querySelector('button.danger') as HTMLButtonElement | null | undefined;
  expect(b, `la ligne « ${nom} » n’a pas de bouton pour la retirer`).toBeTruthy();
  await presser(b!);
}

/** L'état de chaque élément de l'étape qui porte ce nom : son texte et la valeur de chacun de ses champs. */
const etatDe = (element: string, identifiant: string, nom: string) =>
  tous(`main ${element}`)
    .filter((e) => (e.querySelector(identifiant) as HTMLInputElement | null)?.value.trim() === nom)
    .map((e) => ({
      texte: t(e),
      champs: tous<HTMLInputElement | HTMLSelectElement>('input, select', e).map((i) => (i instanceof HTMLInputElement && i.type === 'checkbox' ? String(i.checked) : i.value)),
    }));

/** Retire un élément de l'étape, recopie les aides de son formulaire, ajoute : l'élément doit être, à l'écran, ce qu'il était. */
async function retirerPuisRecopier(quoi: { element: string; identifiant: string; nom: string; libelles: string[]; ajouter: string; contient: string }) {
  const avant = etatDe(quoi.element, quoi.identifiant, quoi.nom);
  expect(avant.length, `« ${quoi.nom} » n’est pas dans l’étape`).toBeGreaterThan(0);
  expect(avant.map((x) => x.texte).join(' '), `« ${quoi.nom} » : ce que l’étape en dit`).toContain(quoi.contient);
  const e = tous(`main ${quoi.element}`).find((x) => (x.querySelector(quoi.identifiant) as HTMLInputElement | null)?.value.trim() === quoi.nom);
  await presser(e!.querySelector('button.danger') as HTMLButtonElement);
  expect(etatDe(quoi.element, quoi.identifiant, quoi.nom), `« ${quoi.nom} » n’est pas retiré`).toEqual([]);
  expect(champ(quoi.libelles[0]!).aide, `« ${quoi.nom} » retiré, ses aides sont les siennes`).toBe(quoi.nom);
  await recopierLesAides(quoi.libelles);
  expect(await cliquerExactement(quoi.ajouter), `pas de bouton « ${quoi.ajouter} »`).toBe(true);
  expect(etatDe(quoi.element, quoi.identifiant, quoi.nom), `« ${quoi.nom} » rajouté en recopiant ses aides n’est pas celui de son raccourci`).toEqual(avant);
}

/** Ce que dit, dans Flux prévus, le formulaire du flux qui porte ce nom : le motif, la fenêtre, le montant. */
async function formulaireDuFlux(nom: string) {
  const ligne = tous('main .row').find((r) => t(r.querySelector('.label strong')) === nom);
  const b = tous<HTMLButtonElement>('button', ligne ?? document.createElement('div')).find((x) => t(x) === 'Modifier');
  expect(b, `pas de bouton « Modifier » sur le flux « ${nom} »`).toBeTruthy();
  await presser(b!);
  const lu = { motif: champ('Motif de libellé (regex)').valeur, fenetre: champ('Fenêtre des échéances (± jours)').valeur, montant: champ('Montant').valeur };
  await cliquer('Annuler');
  return lu;
}

describe('#417 · #214 — dans l’assistant, sur un projet vierge, sans navigateur', () => {
  it('[niveau 4] #214 point 1 (table #417, aides 1) — à l’étape Revenus, toutes les aides du formulaire viennent d’une même ligne : la première de l’étape, puis celle du premier raccourci restant', async () => {
    await ouvrirLApplication();
    await arriverAuxRevenus();
    expect(raccourcis()).toEqual([]);
    expect(champ('Quoi ?')).toMatchObject({ aide: 'Salaire', valeur: '' });
    expect(champ('Combien ?')).toMatchObject({ aide: '3 400,00', valeur: '' });
    expect(champ('Vers le (jour)').valeur, 'le jour suit la ligne d’aide').toBe('28');

    await retirer('Loyer locatif');
    expect(raccourcis()).toEqual(['+ Loyer locatif']);
    expect(champ('Quoi ?')).toMatchObject({ aide: 'Loyer locatif' });
    expect(champ('Combien ?')).toMatchObject({ aide: '700,00' });
    expect(champ('Vers le (jour)').valeur).toBe('5');

    await retirer('Allocations');
    expect(champ('Quoi ?')).toMatchObject({ aide: 'Loyer locatif' });

    expect(await cliquer('+ Loyer locatif')).toBe(true);
    expect(champ('Quoi ?')).toMatchObject({ aide: 'Allocations' });
    expect(champ('Combien ?')).toMatchObject({ aide: '100,00' });
  });

  it('[niveau 4] #214 point 1 (table #417, aides 2) — chaque étape de l’assistant montre les aides de la première ligne de l’exemple de l’étape : comptes, charges fixes, budgets, échéances, épargne, catégories', async () => {
    await ouvrirLApplication();
    await arriverAuxComptes();
    expect(champ('Nom du compte'), 'comptes : le nom').toMatchObject({ aide: 'Livret A' });
    expect(champ('Solde actuel'), 'comptes : le solde').toMatchObject({ aide: '4 815,00' });
    expect(champ('Type').valeur, 'comptes : le type suit la ligne d’aide, un compte d’épargne').toBe('epargne');

    const etapes: Array<[RegExp, string, Record<string, string>]> = [
      [/Qu.est-ce qui rentre/, 'revenus', { 'Quoi ?': 'Salaire', 'Combien ?': euros(340000) }],
      [/part tout seul/, 'charges fixes', { 'Quoi ?': 'Crédit immobilier', 'Combien ?': euros(95000) }],
      [/tenir à un montant/, 'budgets', { 'Quoi ?': 'Alimentation', 'Combien par période ?': euros(90000) }],
      [/ne tombe pas tous les mois/, 'échéances', { 'Quoi ?': 'Taxe foncière', 'Montant de la facture': euros(120000) }],
      [/mettre de côté/, 'épargne', { 'Quoi ?': 'Épargne de précaution', 'Combien par période ?': euros(30000), Cible: euros(600000) }],
      [/Comment classer/, 'catégories', { 'Nom de la catégorie': 'Salaire' }],
    ];
    for (const [titre, nom, attendu] of etapes) {
      expect(await avancer(), `${nom} : l’étape précédente ne se franchit pas`).toBe(true);
      expect(lire().h2, `${nom} : on n’est pas à la bonne étape`).toMatch(titre);
      expect(aides(), `${nom} : les aides du formulaire`).toMatchObject(attendu);
    }
  });

  it('[niveau 4] #214 point 2 (table #417, aides 3) — ajouter « Loyer locatif » en recopiant ses aides fait ce que fait son raccourci : la ligne revient avec son motif de libellé et sa fenêtre, une fois l’assistant validé', async () => {
    const loyer = flux.find((f) => f.name === 'Loyer locatif')!;
    expect(loyer.labelPattern, 'l’exemple donne un motif au loyer : sans lui, ce test ne prouverait rien').toBeTruthy();
    await ouvrirLApplication();
    await arriverAuxRevenus();
    await retirer('Loyer locatif');
    await recopierLesAides(['Quoi ?', 'Combien ?']);
    expect(await cliquerExactement('Ajouter')).toBe(true);
    expect(raccourcis(), 'la ligne ajoutée vaut son raccourci : il disparaît').toEqual([]);
    expect(lignes().find((l) => l.nom === 'Loyer locatif')).toMatchObject({ montant: euros(loyer.amount), jour: '5' });

    await validerTelQuel();
    const enregistre = alive(projet().plannedFlows).find((f) => f.name === 'Loyer locatif')!;
    expect([enregistre.labelPattern, enregistre.dateWindowDays, enregistre.amount]).toEqual([loyer.labelPattern, loyer.dateWindowDays, loyer.amount]);
    expect(await ecran('Flux prévus')).toBe(true);
    expect(await formulaireDuFlux('Loyer locatif')).toEqual({ motif: loyer.labelPattern, fenetre: String(loyer.dateWindowDays), montant: euros(loyer.amount) });
  });

  it('[niveau 4] #214 point 7 (table #417, aides 4) — un champ qui change et la ligne n’est plus celle de l’exemple : « Loyer locatif » à 710,00 € garde son montant et ne reçoit ni le motif ni la fenêtre de l’exemple', async () => {
    const loyer = flux.find((f) => f.name === 'Loyer locatif')!;
    await ouvrirLApplication();
    await arriverAuxRevenus();
    await retirer('Loyer locatif');
    await recopierLesAides(['Quoi ?']);
    await saisirChamp('Combien ?', '710,00');
    expect(await cliquerExactement('Ajouter')).toBe(true);
    expect(lignes().find((l) => l.nom === 'Loyer locatif')).toMatchObject({ montant: '710,00' });

    await validerTelQuel();
    const enregistre = alive(projet().plannedFlows).find((f) => f.name === 'Loyer locatif')!;
    expect(enregistre.amount).toBe(71000);
    expect(enregistre.labelPattern, 'une ligne saisie à la main n’a pas le motif de l’exemple').not.toBe(loyer.labelPattern);
    expect(await ecran('Flux prévus')).toBe(true);
    const lu = await formulaireDuFlux('Loyer locatif');
    expect(lu.montant).toBe('710,00');
    expect(lu.motif).not.toBe(loyer.labelPattern);
  });

  it('[niveau 4] #214 point 2 (table #417, aides 5) — une étape vidée puis remplie en recopiant chaque aide finit avec les lignes de l’exemple, et elles seules, versions datées du « Salaire » comprises', async () => {
    const revenus = flux.filter((f) => f.kind === 'income');
    await ouvrirLApplication();
    await arriverAuxRevenus();
    for (const l of lignes()) await retirer(l.nom);
    expect(lignes()).toEqual([]);
    expect(raccourcis().length, 'trois raccourcis : un par revenu, le « Salaire » en un seul').toBe(3);

    for (let tour = 0; tour < 6 && raccourcis().length > 0; tour++) {
      await recopierLesAides(['Quoi ?', 'Combien ?']);
      expect(await cliquerExactement('Ajouter')).toBe(true);
    }
    expect(raccourcis(), 'toutes les lignes sont revenues').toEqual([]);
    const sansEspace = (montant: string) => montant.replace(/ /g, '');
    const vues = lignes().map((l) => `${l.nom} | ${sansEspace(l.montant)} | ${l.jour}`).sort();
    const attendues = revenus.map((f) => `${f.name} | ${sansEspace(euros(f.amount))} | ${f.periodicity.anchorDate.slice(8).replace(/^0/, '')}`).sort();
    expect(vues).toEqual(attendues);
  });

  it('[niveau 4] #214 point 2 (table #417, aides 6) — à chaque étape, l’élément retiré puis rajouté en recopiant ses aides est celui que son raccourci apportait : versions datées, prélèvement, suivi du solde, liens des catégories', async () => {
    await ouvrirLApplication();
    await arriverAuxComptes();
    await retirerPuisRecopier({ element: '.ligne-compte', identifiant: 'input', nom: 'Carte enfants', libelles: ['Nom du compte', 'Solde actuel'], ajouter: 'Ajouter un compte', contient: 'Solde à régler' });

    await avancer();
    await avancer();
    expect(lire().h2).toMatch(/part tout seul/);
    await retirerPuisRecopier({ element: '.ligne-flux', identifiant: 'input.nom', nom: 'Crédit immobilier', libelles: ['Quoi ?', 'Combien ?'], ajouter: 'Ajouter', contient: 'jusqu’au 5' });

    await avancer();
    expect(lire().h2).toMatch(/tenir à un montant/);
    await retirerPuisRecopier({ element: '.card.tirelire', identifiant: 'input.nom', nom: 'Alimentation', libelles: ['Quoi ?', 'Combien par période ?'], ajouter: 'Ajouter', contient: 'jusqu’au 27 oct' });

    await avancer();
    expect(lire().h2).toMatch(/ne tombe pas tous les mois/);
    await retirerPuisRecopier({ element: '.card.tirelire', identifiant: 'input.nom', nom: 'Taxe foncière', libelles: ['Quoi ?', 'Montant de la facture'], ajouter: 'Ajouter', contient: 'Prélèvement attendu' });

    await avancer();
    expect(lire().h2).toMatch(/mettre de côté/);
    await retirerPuisRecopier({ element: '.card.tirelire', identifiant: 'input.nom', nom: 'Épargne de précaution', libelles: ['Quoi ?', 'Combien par période ?', 'Cible'], ajouter: 'Ajouter', contient: 'jusqu’au 27 déc' });

    await avancer();
    expect(lire().h2).toMatch(/Comment classer/);
    await retirerPuisRecopier({ element: '.ligne-categorie', identifiant: 'input.nom', nom: 'Salaire', libelles: ['Nom de la catégorie'], ajouter: 'Ajouter une catégorie', contient: 'Flux : Salaire' });
  });
});

describe('#417 · #214 — hors de l’assistant, sur l’exemple chargé, sans navigateur', () => {
  /** Ouvre l'application et charge l'exemple, comme le bouton de l'accueil. */
  async function ouvrirLExemple() {
    await ouvrirLApplication();
    expect(await cliquer('Charger l\'exemple')).toBe(true);
    // `loadExample` est asynchrone : on attend que l'exemple soit là.
    for (let i = 0; i < 50 && !alive(projet().accounts).some((a) => a.name === 'Livret A'); i++) await new Promise((r) => setTimeout(r, 10));
    expect(alive(projet().accounts).some((a) => a.name === 'Livret A'), 'l’exemple ne s’est pas chargé').toBe(true);
  }

  it('[niveau 4] #214 point 3 (table #417, aides 7) — Comptes : l’aide du nom et le type proposé sont ceux d’une même ligne de l’exemple (le formulaire d’ajout de la section, #362)', async () => {
    await ouvrirLExemple();
    expect(await ecran('Comptes')).toBe(true);
    const aide = champ('Nom du compte').aide;
    const ligne = alive(exemple.accounts).find((a) => a.name === aide);
    expect(ligne, `l’aide « ${aide} » n’est pas un compte de l’exemple`).toBeDefined();
    expect(champ('Type').valeur).toBe(ligne!.kind);
  });

  it('[niveau 4] #214 point 3 (table #417, aides 8) — Tirelires : l’aide du nom de la tirelire est celle d’une tirelire de l’exemple', async () => {
    await ouvrirLExemple();
    expect(await ecran('Tirelires')).toBe(true);
    expect(await cliquer('Ajouter une tirelire')).toBe(true);
    expect(alive(exemple.tirelires).map((x) => x.name)).toContain(champ('Quoi ?').aide);
  });

  it('[niveau 4] #214 point 3 (table #417, aides 9) — Tirelires, besoin : les aides sont les valeurs d’un besoin de l’exemple du type choisi, et le « montant à reverser » d’un versement n’en a aucune', async () => {
    await ouvrirLExemple();
    expect(await ecran('Tirelires')).toBe(true);
    const b = tous<HTMLButtonElement>('main .par-besoin button').find((x) => t(x) === 'Modifier');
    expect(b, 'pas de « Modifier » sur une ligne de besoin').toBeTruthy();
    await presser(b!);
    const attendu: Array<[string, Record<string, string>]> = [
      ['dueDate', { "Montant de l'échéance": euros(120000) }],
      ['recurring', { Nom: 'Cours de piano', Montant: euros(4500) }],
      ['goal', { Mensualité: euros(30000), Cible: euros(600000) }],
    ];
    for (const [genre, a] of attendu) {
      await saisirChamp('Type', genre);
      expect(aides(), `besoin « ${genre} »`).toMatchObject(a);
    }
    await saisirChamp('Type', 'payout');
    expect(champ('Montant à reverser').aide, 'l’exemple n’a aucun versement : pas de montant inventé').toBe('');
  });

  it('[niveau 4] #214 point 3 (table #417, aides 10) — Flux prévus : le nom, le montant et le motif d’aide sont ceux d’un même flux de l’exemple du type choisi', async () => {
    await ouvrirLExemple();
    expect(await ecran('Flux prévus')).toBe(true);
    expect(await cliquer('Ajouter un flux')).toBe(true);
    for (const genre of ['income', 'fixedCharge', 'dueDate', 'transfer'] as const) {
      await saisirChamp('Type', genre);
      const f = flux.find((x) => x.kind === genre)!;
      expect(champ('Nom'), genre).toMatchObject({ aide: f.name });
      expect(champ('Montant'), genre).toMatchObject({ aide: euros(f.amount) });
      expect(champ('Motif de libellé (regex)'), genre).toMatchObject({ aide: f.labelPattern ?? '' });
    }
  });

  it('[niveau 4] #214 point 3 (table #417, aides 11) — Catégories : l’aide du nom est celle d’une catégorie de l’exemple de la nature choisie', async () => {
    await ouvrirLExemple();
    expect(await ecran('Catégories')).toBe(true);
    const categories = alive(exemple.categories);
    expect(await cliquer('Ajouter une catégorie de dépenses')).toBe(true);
    expect(categories.find((c) => c.name === champ('Nom').aide)?.nature).toBe('expense');
    await cliquer('Annuler');
    expect(await cliquer('Ajouter une catégorie de revenus')).toBe(true);
    expect(categories.find((c) => c.name === champ('Nom').aide)?.nature).toBe('income');
  });

  it('[niveau 4] #214 point 3 (table #417, aides 12) — Saisie : le libellé, le montant et la catégorie d’aide sont ceux d’une même opération saisie de l’exemple de la nature choisie', async () => {
    await ouvrirLExemple();
    expect(await ecran('Saisie')).toBe(true);
    expect(await cliquer('Saisir une opération')).toBe(true);
    const attendu: Array<[string, string, number, string]> = [
      ['expense', 'Dentiste (payé par Marie)', 8000, 'Santé'],
      ['income', 'VIR SALAIRE AOUT', 340000, 'Salaire'],
      ['transfer', 'VIR PERM TIRELIRE CARTE ENFANTS', 20000, 'Virement interne'],
    ];
    for (const [nature, libelle, montant, categorie] of attendu) {
      await saisirChamp('Nature', nature);
      expect(champ('Libellé'), nature).toMatchObject({ aide: libelle });
      expect(champ('Montant'), nature).toMatchObject({ aide: euros(montant) });
      expect(champ('ou nouvelle catégorie'), nature).toMatchObject({ aide: categorie });
    }
  });
});
