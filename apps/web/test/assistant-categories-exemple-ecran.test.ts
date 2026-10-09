// @vitest-environment jsdom
/**
 * Tests du codeur de #417 — ce que vérifiait `navigateur/assistant-categories-exemple-harnais.test.ts` (harnais
 * d'audit de #212, « L'assistant propose les catégories de l'exemple »), sans navigateur : l'application montée sous
 * jsdom (`ecran.ts`), au jour des tests, sur un dépôt en mémoire. Chaque titre dit le point du « Fait quand » de #212
 * qu'il vérifie, et le numéro du test retiré dans la table de #417.
 *
 * Ce qui se lit ici est ce que l'étape montre — ses lignes rangées par nature, ce que chacune dit de sa tirelire par
 * défaut et de ses flux, ses refus, ses raccourcis — et ce que la validation enregistre — le projet que le dépôt relit,
 * et les écrans Catégories et Flux prévus qui le montrent. Les propositions elles-mêmes sont lues côté cœur par
 * `packages/core/test/suggestions.test.ts` (niveau 2) ; la règle du nom (`findCategoryByName`, D61) par
 * `packages/core/test/model.test.ts` (niveau 0). « L'étape se franchit par son seul bouton primaire » (I4) est tenu par
 * `navigateur/assistant-simple.test.ts`, et « ce que l'assistant a créé se modifie ensuite depuis Catégories » (I11)
 * par `navigateur/assistant-equivalent.test.ts`, harnais du registre.
 *
 * La ligne d'une catégorie se lit par ce qu'elle dit — quelles tirelires, quels flux —, non par la forme du texte, que
 * #212 laisse libre.
 *
 * Niveau 4, comme tout test du codeur ; l'auditeur donne le leur à ceux qu'il retient (D83) : ceux du test retiré.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { alive, type Category } from '@tirelire/core';
import { allerA, arriverAuxComptes, cliquer, ecran, etape, lire, ouvrirLApplication, presser, projet, saisir, t, tous } from './ecran';

/** Ce que dit une ligne de l'étape : son nom, sa nature (le titre qui la range) et ce que l'étape en dit dessous. */
interface Ligne {
  nature: string;
  nom: string;
  detail: string;
}

/** Les catégories que l'étape montre, dans l'ordre où elle les montre. */
const lesCategories = (): Ligne[] => {
  const sortie: Ligne[] = [];
  let nature = '';
  for (const e of tous('main h3, main .ligne-categorie')) {
    if (e.tagName === 'H3') nature = t(e);
    else sortie.push({ nature, nom: (e.querySelector('input.nom') as HTMLInputElement).value, detail: t(e.querySelector('.suite')) });
  }
  return sortie;
};

const noms = (lignes: Ligne[], nature: string) => lignes.filter((l) => l.nature === nature).map((l) => l.nom);
const detailDe = (lignes: Ligne[], nom: string, nature = 'Dépenses') => lignes.find((l) => l.nature === nature && l.nom === nom)?.detail ?? '';

const TIRELIRES_DE_L_EXEMPLE = ['Alimentation', 'Santé', 'Enfants et loisirs'];
const FLUX_DE_L_EXEMPLE = ['Salaire', 'Loyer locatif', 'Allocations', 'Crédit immobilier', 'Électricité', 'Assurance habitation', 'Internet et mobiles'];
/** Les tirelires et les flux de l'exemple que la ligne d'une catégorie nomme. */
const dit = (lignes: Ligne[], nom: string, nature = 'Dépenses') => {
  const ligne = lignes.find((l) => l.nature === nature && l.nom === nom);
  expect(ligne, `pas de catégorie « ${nom} » (${nature}) dans l’étape`).toBeDefined();
  const d = ligne!.detail;
  return { tirelires: TIRELIRES_DE_L_EXEMPLE.filter((n) => d.includes(n)), flux: FLUX_DE_L_EXEMPLE.filter((n) => d.includes(n)) };
};

/** Les raccourcis offerts par l'étape : « Logement · dépense ». */
const raccourcis = () => tous('main .propositions .prop').map((p) => `${t(p.querySelector('.n')).replace(/^\+\s*/, '')} · ${t(p.querySelector('.v'))}`);

/** Ce que l'étape refuse, dit en rouge. */
const erreurs = () => tous('main .err').map(t);

const titre = () => lire().h2;

/** Pose une valeur dans le champ de la ligne qui porte ce nom. */
async function poser(selecteur: string, nomDeLaLigne: string, valeur: string) {
  const c = tous<HTMLInputElement>(selecteur).find((x) => x.value === nomDeLaLigne);
  expect(c, `pas de ligne « ${nomDeLaLigne} » (${selecteur})`).toBeTruthy();
  await saisir(c!, valeur);
}

/** Retire une ligne de l'étape — catégorie ou tirelire —, par le bouton × de la ligne qui porte ce nom. */
async function retirer(selecteurDuChamp: string, nom: string) {
  const c = tous<HTMLInputElement>(selecteurDuChamp).find((i) => i.value.trim() === nom);
  const b = (c?.closest('.ligne-categorie') ?? c?.parentElement)?.querySelector('button.danger') as HTMLButtonElement | null | undefined;
  expect(b, `« ${nom} » : pas de bouton pour le retirer`).toBeTruthy();
  await presser(b!);
}

/** Remplit le formulaire d'ajout de l'étape, puis l'envoie. */
async function ajouter(nom: string, nature: 'expense' | 'income') {
  const f = document.querySelector('main form.edit');
  const champ = f?.querySelector('input') as HTMLInputElement | null;
  const choix = f?.querySelector('select') as HTMLSelectElement | null;
  expect(champ && choix, 'pas de formulaire pour ajouter une catégorie').toBeTruthy();
  await saisir(champ!, nom);
  await saisir(choix!, nature);
  expect(await cliquer('Ajouter une catégorie')).toBe(true);
}

/** Ouvre l'assistant sur un projet vierge, à l'étape Comptes. */
async function ouvrirLAssistant() {
  await ouvrirLApplication();
  await arriverAuxComptes();
}

async function suivant(n: number) {
  for (let i = 0; i < n; i++) expect(await cliquer('Suivant'), 'pas de bouton « Suivant »').toBe(true);
}

/** Ce que l'écran Catégories du projet dit : chaque catégorie, sa nature (le titre qui la range) et son budget. */
async function categoriesDeLEcran(): Promise<Array<{ nature: string; nom: string; budget: string }>> {
  expect(await ecran('Catégories')).toBe(true);
  const sortie: Array<{ nature: string; nom: string; budget: string }> = [];
  let nature = '';
  for (const e of tous('main h2, main .row .label')) {
    if (e.tagName === 'H2') nature = t(e);
    else sortie.push({ nature, nom: t(e.querySelector('strong')), budget: t(e.querySelector('.sub')).replace(/^budget\s*/, '') });
  }
  return sortie;
}

/** Les lignes de Flux prévus qui portent ce nom : on ouvre chacune, et on lit sa catégorie. */
async function categoriesDuFlux(nom: string): Promise<string[]> {
  expect(await ecran('Flux prévus')).toBe(true);
  const lignes = () => tous('main .row').filter((r) => t(r.querySelector('.label > strong')) === nom);
  const vues: string[] = [];
  const combien = lignes().length;
  for (let i = 0; i < combien; i++) {
    const b = tous<HTMLButtonElement>('button', lignes()[i]!).find((x) => t(x) === 'Modifier');
    expect(b, `« ${nom} » : pas de bouton « Modifier » dans Flux prévus`).toBeTruthy();
    await presser(b!);
    const l = tous('main form label.f').find((x) => t(x).startsWith('Catégorie'));
    const s = l?.querySelector('select') as HTMLSelectElement | null | undefined;
    vues.push(s ? t(s.selectedOptions[0]) : '(pas de champ Catégorie)');
    await cliquer('Annuler');
  }
  return vues;
}

/** Le projet enregistré : ses catégories vivantes, et, par nom, la tirelire par défaut et les flux qui les portent. */
function categoriesDuProjet() {
  const p = projet();
  const cats = alive(p.categories);
  const tirelire = (c: Category) => (c.tirelireId ? alive(p.tirelires).find((e) => e.id === c.tirelireId)?.name ?? '?' : '');
  const flux = (c: Category) => [...new Set(alive(p.plannedFlows).filter((f) => f.action?.categoryId === c.id).map((f) => f.name))].sort();
  return {
    cats,
    noms: (nature: Category['nature']) => cats.filter((c) => c.nature === nature).map((c) => c.name).sort(),
    tirelireDe: (nom: string) => tirelire(cats.find((c) => c.name === nom)!),
    fluxDe: (nom: string, nature: Category['nature'] = 'expense') => flux(cats.find((c) => c.name === nom && c.nature === nature)!),
    categorieDuFlux: (nom: string) => [...new Set(alive(p.plannedFlows).filter((f) => f.name === nom).map((f) => cats.find((c) => c.id === f.action?.categoryId)?.name ?? '—'))],
  };
}

describe('#417 · #212 — tel quel, sans navigateur', () => {
  let ecrans: string[] = [];

  beforeAll(async () => {
    await ouvrirLAssistant();
    // Comptes → Revenus → Charges fixes → Budgets → Pas tous les mois → Épargne → Catégories : le seul bouton primaire.
    await suivant(6);
    ecrans = tous('.wizard-steps .wstep').map(t);
  });

  it('[niveau 4] #212 point 1 (table #417, catégories 1) — une étape Catégories, après Épargne et avant le Résumé', () => {
    const i = ecrans.indexOf('Catégories');
    expect(ecrans[i - 1]).toBe('Épargne');
    expect(ecrans[i + 1]).toBe('Résumé');
    expect(titre()).toContain('classer');
  });

  it('[niveau 4] #212 point 1 (table #417, catégories 2) — sur un projet vierge, l’étape arrive avec les dix catégories de l’exemple, et elles seules, chacune rangée sous sa nature, sans raccourci restant', () => {
    const lignes = lesCategories();
    expect(noms(lignes, 'Revenus')).toEqual(['Salaire', 'Loyer perçu', 'Allocations']);
    expect(noms(lignes, 'Dépenses')).toEqual(['Alimentation', 'Santé', 'Enfants', 'Logement', 'Assurances', 'Abonnements', 'Virement interne']);
    expect(lignes).toHaveLength(10);
    expect(raccourcis()).toEqual([]);
  });

  it('[niveau 4] #212 point 2 (table #417, catégories 3) — chaque ligne dit la tirelire par défaut et les flux qui portent la catégorie', () => {
    const lignes = lesCategories();
    expect(dit(lignes, 'Alimentation')).toEqual({ tirelires: ['Alimentation'], flux: [] });
    expect(dit(lignes, 'Santé')).toEqual({ tirelires: ['Santé'], flux: [] });
    expect(dit(lignes, 'Enfants')).toEqual({ tirelires: ['Enfants et loisirs'], flux: [] });
    expect(dit(lignes, 'Logement')).toEqual({ tirelires: [], flux: ['Crédit immobilier', 'Électricité'] });
    expect(dit(lignes, 'Assurances')).toEqual({ tirelires: [], flux: ['Assurance habitation'] });
    expect(dit(lignes, 'Abonnements')).toEqual({ tirelires: [], flux: ['Internet et mobiles'] });
    expect(dit(lignes, 'Virement interne')).toEqual({ tirelires: [], flux: [] });
    expect(dit(lignes, 'Salaire', 'Revenus')).toEqual({ tirelires: [], flux: ['Salaire'] });
    expect(detailDe(lignes, 'Salaire', 'Revenus').split('Salaire').length - 1, 'le flux « Salaire » est nommé une fois').toBe(1);
    expect(dit(lignes, 'Loyer perçu', 'Revenus')).toEqual({ tirelires: [], flux: ['Loyer locatif'] });
    expect(dit(lignes, 'Allocations', 'Revenus')).toEqual({ tirelires: [], flux: ['Allocations'] });
  });

  it('[niveau 4] #212 point 6 (table #417, catégories 5) — validé tel quel, le projet porte les dix catégories, chacune avec sa tirelire par défaut, et Catégories les montre', async () => {
    await suivant(1);
    expect(await cliquer('Valider mon budget')).toBe(true);
    const p = categoriesDuProjet();
    expect(p.noms('income')).toEqual(['Allocations', 'Loyer perçu', 'Salaire']);
    expect(p.noms('expense')).toEqual(['Abonnements', 'Alimentation', 'Assurances', 'Enfants', 'Logement', 'Santé', 'Virement interne']);
    expect(p.cats).toHaveLength(10);
    expect([p.tirelireDe('Alimentation'), p.tirelireDe('Santé'), p.tirelireDe('Enfants'), p.tirelireDe('Logement')]).toEqual(['Alimentation', 'Santé', 'Enfants et loisirs', '']);

    const cats = await categoriesDeLEcran();
    expect(cats.filter((c) => c.nature === 'Revenus').map((c) => c.nom).sort()).toEqual(['Allocations', 'Loyer perçu', 'Salaire']);
    expect(cats.filter((c) => c.nature === 'Dépenses').map((c) => c.nom).sort()).toEqual(['Abonnements', 'Alimentation', 'Assurances', 'Enfants', 'Logement', 'Santé', 'Virement interne']);
    const budget = (nom: string) => cats.find((c) => c.nom === nom)!.budget;
    expect([budget('Alimentation'), budget('Santé'), budget('Enfants'), budget('Logement')]).toEqual(['Alimentation', 'Santé', 'Enfants et loisirs', '']);
    expect(cats).toHaveLength(10);
  });

  it('[niveau 4] #212 point 6 (table #417, catégories 6) — chaque flux de l’exemple se retrouve, enregistré et dans Flux prévus, avec sa catégorie', async () => {
    const attendu: Array<[string, string]> = [
      ['Crédit immobilier', 'Logement'],
      ['Électricité', 'Logement'],
      ['Assurance habitation', 'Assurances'],
      ['Internet et mobiles', 'Abonnements'],
      ['Loyer locatif', 'Loyer perçu'],
      ['Allocations', 'Allocations'],
    ];
    const p = categoriesDuProjet();
    for (const [flux, categorie] of attendu) {
      expect(p.categorieDuFlux(flux), flux).toEqual([categorie]);
      expect(await categoriesDuFlux(flux), flux).toEqual([categorie]);
    }
    expect(p.categorieDuFlux('Salaire')).toEqual(['Salaire']);
    const salaires = await categoriesDuFlux('Salaire');
    expect(salaires).toHaveLength(2);
    expect(salaires.every((c) => c === 'Salaire')).toBe(true);
  });
});

describe('#417 · #212 — renommé, sans navigateur', () => {
  beforeAll(async () => {
    await ouvrirLAssistant();
    await suivant(2); // Comptes → Revenus → Charges fixes
    await poser('main .ligne-flux input.nom', 'Électricité', 'Énergie');
    await suivant(1); // Charges fixes → Budgets
    await poser('main .card.tirelire input.nom', 'Alimentation', 'Courses');
    await suivant(3); // Budgets → Pas tous les mois → Épargne → Catégories
  });

  it('[niveau 4] #212 point 2 (table #417, catégories 8) — une catégorie se lie par le nom : un flux ou une tirelire renommé à une étape précédente ne lui est pas lié, la ligne ne le montre pas, et le projet validé le laisse sans catégorie', async () => {
    expect(titre()).toContain('classer');
    const lignes = lesCategories();
    expect(lignes).toHaveLength(10);
    expect(dit(lignes, 'Logement').flux).toEqual(['Crédit immobilier']);
    expect(detailDe(lignes, 'Logement')).not.toMatch(/Énergie|Électricité/);
    expect(dit(lignes, 'Alimentation').tirelires).toEqual([]);
    expect(detailDe(lignes, 'Alimentation')).not.toContain('Courses');
    expect(dit(lignes, 'Santé').tirelires).toEqual(['Santé']);
    expect(dit(lignes, 'Assurances').flux).toEqual(['Assurance habitation']);

    await suivant(1);
    expect(await cliquer('Valider mon budget')).toBe(true);
    const p = categoriesDuProjet();
    expect(p.categorieDuFlux('Énergie')).toEqual(['—']);
    expect(p.categorieDuFlux('Crédit immobilier')).toEqual(['Logement']);
    expect(p.tirelireDe('Alimentation')).toBe('');
    expect(p.tirelireDe('Santé')).toBe('Santé');
    expect(await categoriesDuFlux('Énergie')).toEqual(['—']);
    const cats = await categoriesDeLEcran();
    expect(cats.find((c) => c.nom === 'Alimentation')?.budget).toBe('');
  });
});

describe('#417 · #212 — corrigé, puis rouvert, sans navigateur', () => {
  beforeAll(async () => {
    await ouvrirLAssistant();
    await suivant(3); // Comptes → Revenus → Charges fixes → Budgets
    await retirer('main .card.tirelire input.nom', 'Alimentation');
    await suivant(3); // Budgets → Pas tous les mois → Épargne → Catégories
  });

  it('[niveau 4] #212 point 3, I3 (table #417, catégories 9) — une tirelire retirée à une étape précédente laisse sa catégorie, sans tirelire par défaut', () => {
    expect(titre()).toContain('classer');
    const lignes = lesCategories();
    expect(lignes).toHaveLength(10);
    expect(noms(lignes, 'Dépenses')).toContain('Alimentation');
    expect(dit(lignes, 'Alimentation').tirelires).toEqual([]);
    expect(dit(lignes, 'Santé').tirelires).toEqual(['Santé']);
  });

  it('[niveau 4] #212 point 3 (table #417, catégories 10) — le nom d’une catégorie se corrige sur place, et la correction tient quand on quitte l’étape et qu’on y revient', async () => {
    await poser('main .ligne-categorie input.nom', 'Santé', 'Soins');
    let lignes = lesCategories();
    expect(noms(lignes, 'Dépenses')).toContain('Soins');
    expect(noms(lignes, 'Dépenses')).not.toContain('Santé');
    expect(dit(lignes, 'Soins').tirelires).toEqual(['Santé']);
    expect(erreurs()).toEqual([]);

    await etape('Résumé');
    await etape('Catégories');
    lignes = lesCategories();
    expect(noms(lignes, 'Dépenses')).toContain('Soins');
    expect(lignes).toHaveLength(10);
  });

  it('[niveau 4] #212 point 3 (table #417, catégories 11) — le renommage en doublon d’une catégorie de même nature est refusé, dit, et le champ reprend son nom', async () => {
    await poser('main .ligne-categorie input.nom', 'Enfants', ' logement ');
    expect(erreurs()).toEqual(['Une catégorie « Logement » existe déjà pour cette nature.']);
    const lignes = lesCategories();
    expect(noms(lignes, 'Dépenses')).toContain('Enfants');
    expect(lignes).toHaveLength(10);
    await etape('Résumé');
    await etape('Catégories');
    expect(erreurs()).toEqual([]);
  });

  it('[niveau 4] #212 point 3 (table #417, catégories 12) — l’ajout d’une catégorie de même nature et de même nom est refusé et dit ; en l’autre nature, il est accepté', async () => {
    await ajouter('salaire', 'income');
    expect(erreurs()).toEqual(['Une catégorie « Salaire » existe déjà pour cette nature.']);
    expect(lesCategories()).toHaveLength(10);

    await ajouter('Salaire', 'expense');
    expect(erreurs()).toEqual([]);
    const lignes = lesCategories();
    expect(noms(lignes, 'Dépenses')).toContain('Salaire');
    expect(lignes).toHaveLength(11);
    await retirer('main .ligne-categorie input.nom', 'Salaire');
    expect(lesCategories()).toHaveLength(10);
  });

  it('[niveau 4] #212 point 3 (table #417, catégories 13) — une catégorie retirée sur place disparaît de l’étape, et ne reste sur aucun flux', async () => {
    await retirer('main .ligne-categorie input.nom', 'Logement');
    await retirer('main .ligne-categorie input.nom', 'Assurances');
    await retirer('main .ligne-categorie input.nom', 'Loyer perçu');
    const lignes = lesCategories();
    expect(noms(lignes, 'Dépenses')).toEqual(['Alimentation', 'Soins', 'Enfants', 'Abonnements', 'Virement interne']);
    expect(noms(lignes, 'Revenus')).toEqual(['Salaire', 'Allocations']);
    for (const l of lignes) expect(l.detail, l.nom).not.toMatch(/Crédit immobilier|Électricité|Assurance habitation|Loyer locatif/);
  });

  it('[niveau 4] #212 point 3, I3 (table #417, catégories 14) — une tirelire retirée à l’étape des budgets, après l’arrivée ici, laisse aussi sa catégorie sans tirelire par défaut', async () => {
    await etape('Budgets');
    await retirer('main .card.tirelire input.nom', 'Enfants et loisirs');
    await etape('Catégories');
    const lignes = lesCategories();
    expect(noms(lignes, 'Dépenses')).toContain('Enfants');
    expect(dit(lignes, 'Enfants').tirelires).toEqual([]);
    expect(dit(lignes, 'Soins').tirelires).toEqual(['Santé']);
  });

  it('[niveau 4] #212 point 3 (table #417, catégories 15) — validé, le projet porte les catégories gardées et corrigées, sans celles qui ont été retirées, et leurs flux n’ont plus de catégorie', async () => {
    await etape('Résumé');
    expect(await cliquer('Valider mon budget')).toBe(true);
    const p = categoriesDuProjet();
    expect(p.noms('income')).toEqual(['Allocations', 'Salaire']);
    expect(p.noms('expense')).toEqual(['Abonnements', 'Alimentation', 'Enfants', 'Soins', 'Virement interne']);
    expect([p.tirelireDe('Alimentation'), p.tirelireDe('Soins'), p.tirelireDe('Enfants')]).toEqual(['', 'Santé', '']);
    for (const flux of ['Crédit immobilier', 'Électricité', 'Assurance habitation', 'Loyer locatif']) expect(p.categorieDuFlux(flux), flux).toEqual(['—']);
    expect(p.categorieDuFlux('Internet et mobiles')).toEqual(['Abonnements']);

    const cats = await categoriesDeLEcran();
    expect(cats.map((c) => c.nom).sort()).toEqual(['Abonnements', 'Alimentation', 'Allocations', 'Enfants', 'Salaire', 'Soins', 'Virement interne']);
    expect(await categoriesDuFlux('Crédit immobilier')).toEqual(['—']);
  });

  it('[niveau 4] #212 point 4 (table #417, catégories 16) — rouvert sur ce projet, un raccourci apporte chaque catégorie de l’exemple qui manque, et disparaît dès qu’une catégorie de même nature et de même nom existe', async () => {
    await allerA('Plus');
    expect(await cliquer('Lancer')).toBe(true);
    await etape('Catégories');
    expect(titre()).toContain('classer');
    expect(noms(lesCategories(), 'Dépenses').sort()).toEqual(['Abonnements', 'Alimentation', 'Enfants', 'Soins', 'Virement interne']);
    expect(raccourcis()).toEqual(['Loyer perçu · revenu', 'Santé · dépense', 'Logement · dépense', 'Assurances · dépense']);

    expect(await cliquer('+ Logement')).toBe(true);
    expect(dit(lesCategories(), 'Logement').flux).toEqual(['Crédit immobilier', 'Électricité']);
    expect(await cliquer('+ Santé')).toBe(true);
    expect(dit(lesCategories(), 'Santé').tirelires).toEqual(['Santé']);
    expect(raccourcis()).toEqual(['Loyer perçu · revenu', 'Assurances · dépense']);

    await ajouter('Loyer perçu', 'expense');
    expect(erreurs()).toEqual([]);
    expect(raccourcis()).toEqual(['Loyer perçu · revenu', 'Assurances · dépense']);
    await ajouter('assurances', 'expense');
    expect(erreurs()).toEqual([]);
    expect(raccourcis()).toEqual(['Loyer perçu · revenu']);
    expect(await cliquer('+ Loyer perçu')).toBe(true);
    expect(dit(lesCategories(), 'Loyer perçu', 'Revenus').flux).toEqual(['Loyer locatif']);
    expect(raccourcis()).toEqual([]);
  });

  it('[niveau 4] #212 point 4 (table #417, catégories 17) — validé, les catégories apportées par les raccourcis portent leurs flux, enregistrés et dans Flux prévus', async () => {
    await etape('Résumé');
    expect(await cliquer('Valider mon budget')).toBe(true);
    const p = categoriesDuProjet();
    expect(p.categorieDuFlux('Crédit immobilier')).toEqual(['Logement']);
    expect(p.categorieDuFlux('Électricité')).toEqual(['Logement']);
    expect(p.categorieDuFlux('Loyer locatif')).toEqual(['Loyer perçu']);
    expect(p.categorieDuFlux('Assurance habitation')).toEqual(['—']);
    expect(p.tirelireDe('Santé')).toBe('Santé');
    // Rouvert puis validé, le projet porte ce que l'assistant montrait, et rien de plus ni de moins (D43).
    expect(p.noms('income')).toEqual(['Allocations', 'Loyer perçu', 'Salaire']);
    expect(p.noms('expense')).toEqual(['Abonnements', 'Alimentation', 'Enfants', 'Logement', 'Loyer perçu', 'Santé', 'Soins', 'Virement interne', 'assurances'].sort());
    expect(p.cats).toHaveLength(12);
    expect(await categoriesDuFlux('Loyer locatif')).toEqual(['Loyer perçu']);
  });
});
