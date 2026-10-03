/**
 * Harnais d'audit de #212 — « L'assistant propose les catégories de l'exemple », côté écran : sur le site construit, à
 * 375 px. Les points 1 à 4, 6 et 7 du « Fait quand ». Le point 5 (« le test des propositions échoue si une catégorie
 * ou un lien proposé n'est pas dans l'exemple, ou si l'un de ceux de l'exemple n'est pas proposé ») est tranché par
 * `packages/core/test/suggestions.test.ts`, que le codeur a étendu aux catégories ; les points 8 (D40) et 9
 * (D61, que l'auditeur ajoute), par `packages/core/test/assistant-categories-decision-harnais.test.ts`. La lecture des catégories dans l'exemple, côté
 * cœur, reste dans ses `suggestions-categories.test.ts`, au niveau 4 : ce que ce fichier-ci observe à l'écran la couvre.
 *
 * Retenus parmi les tests du codeur (`navigateur/assistant-categories-exemple.test.ts`, d'où ils sont déplacés, ce
 * fichier-là n'existe plus), l'un d'eux corrigé (le point 7 comptait les gestes dans un tableau qu'il
 * remplit lui-même, ce qui ne pouvait pas échouer) et l'autre complété (le point 4 ne regardait, après la seconde
 * validation, que la tirelire de « Santé » : il compte maintenant toutes les catégories que le projet porte, pour
 * que rouvrir l'assistant ne casse ni ne double rien, D43).
 *
 * Trois parcours, chacun dans sa page et joué dans l'ordre :
 * - « tel quel » : un projet vierge, l'assistant accepté sans rien toucher (points 1, 2, 6 et 7) ;
 * - « corrigé » : l'étape retouchée sur place, puis validée (point 3) ;
 * - « rouvert » : l'assistant rouvert sur ce projet, ses raccourcis (point 4).
 *
 * Niveaux (D83), par phrase du « Fait quand » :
 *  - 2 pour les points 1 à 4, sauf les deux tests du point 3 que dit la ligne suivante : D43 et D46 (des propositions déjà là,
 *    tirées de l'exemple, qui disparaissent quand elles existent), D32 (la tirelire par défaut est un raccourci de
 *    saisie) et D61 (deux catégories de même nature ne portent pas le même nom) sont des décisions ; une catégorie
 *    absente, mal liée, en double ou restée sur un flux qui l'a perdue en est un cas faux, l'usage restant possible.
 *  - 1 pour les deux tests du point 3 sur la tirelire retirée : leur phrase est I3 telle que l'issue la porte
 *    (« Lien possible masqué : I3 — une catégorie proposée ne crée ni n'exige de tirelire »), appliquée à
 *    l'assistant : en U5, classer ne demande aucune tirelire. Rouge sur deux mutations où la catégorie exige sa
 *    tirelire : elle n'est pas créée quand sa tirelire par défaut manque à l'arrivée (le premier test), elle disparaît
 *    avec sa tirelire quand celle-ci est retirée après l'arrivée (le second).
 *  - 1 pour le point 6 : sa phrase est I11 telle qu'elle est écrite (« tout ce qu'une étape d'assistant crée ou fait
 *    se fait et se modifie aussi hors assistant ») appliquée aux catégories et à leurs liens. Rouge sur trois mutations : la
 *    validation n'écrit pas les catégories (les trois tests) ; l'assistant ne lie pas les flux (le deuxième) ; il ne
 *    lie pas la tirelire par défaut (le premier et le troisième).
 *  - 1 pour le point 7 : sa phrase est I4 telle qu'elle est écrite (« chaque étape se franchit par son seul bouton
 *    primaire »), que `assistant-simple.test.ts` tient déjà, étape par étape. Rouge sur une mutation où l'étape ne se
 *    franchit pas par « Suivant ».
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Ce que dit une ligne de l'étape : son nom, sa nature (le titre qui la range) et ce que l'étape en dit dessous. */
interface Ligne {
  nature: string;
  nom: string;
  detail: string;
}

/** Les catégories que l'étape montre, dans l'ordre où elle les montre. */
const lesCategories = (page: Page): Promise<Ligne[]> =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const sortie: Array<{ nature: string; nom: string; detail: string }> = [];
    let nature = '';
    for (const e of document.querySelectorAll('main h3, main .ligne-categorie')) {
      if (e.tagName === 'H3') nature = t(e);
      else sortie.push({ nature, nom: (e.querySelector('input.nom') as HTMLInputElement).value, detail: t(e.querySelector('.suite')) });
    }
    return sortie;
  });

/** Les noms de l'étape, d'une nature (« Dépenses », « Revenus »). */
const noms = (lignes: Ligne[], nature: string) => lignes.filter((l) => l.nature === nature).map((l) => l.nom);
const detailDe = (lignes: Ligne[], nom: string, nature = 'Dépenses') => lignes.find((l) => l.nature === nature && l.nom === nom)?.detail;

/** Les raccourcis offerts par l'étape : leur nom et leur nature, tels qu'ils s'écrivent (« + Logement », « dépense »). */
const raccourcis = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    ([...document.querySelectorAll('main .propositions .prop')] as HTMLElement[]).map(
      (p) => `${(p.querySelector('.n')?.textContent ?? '').replace(/^\+\s*/, '').trim()} · ${(p.querySelector('.v')?.textContent ?? '').trim()}`,
    ),
  );

/** Ce que l'étape refuse, dit en rouge. */
const erreurs = (page: Page): Promise<string[]> =>
  page.evaluate(() => ([...document.querySelectorAll('main .err')] as HTMLElement[]).map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));

/** Le titre de l'étape où se trouve l'assistant. */
const titre = (page: Page): Promise<string> => page.evaluate(() => (document.querySelector('main h2')?.textContent ?? '').trim());

/** Une étape, atteinte par la barre des étapes. */
async function etape(page: Page, libelle: string) {
  const fait = await page.evaluate((l: string) => {
    const b = ([...document.querySelectorAll('.wizard-steps .wstep')] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').trim() === l);
    b?.click();
    return !!b;
  }, libelle);
  expect(fait, `pas d’étape « ${libelle} »`).toBe(true);
  await pause(250);
}

/** Pose une valeur dans un champ, comme on la saisit, et la valide. */
const poser = (page: Page, selecteur: string, nomDeLaLigne: string | undefined, valeur: string) =>
  page.evaluate(
    (sel: string, nom: string | undefined, v: string) => {
      const champs = [...document.querySelectorAll(sel)] as HTMLInputElement[];
      const champ = nom === undefined ? champs[0] : champs.find((c) => c.value === nom);
      if (!champ) return false;
      champ.value = v;
      champ.dispatchEvent(new Event('input', { bubbles: true }));
      champ.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    selecteur,
    nomDeLaLigne,
    valeur,
  );

/** Renomme la catégorie de l'étape qui porte ce nom, comme on corrige un champ. */
async function renommer(page: Page, ancien: string, nouveau: string) {
  expect(await poser(page, 'main .ligne-categorie input.nom', ancien, nouveau), `pas de catégorie « ${ancien} »`).toBe(true);
  await pause(250);
}

/** Retire une ligne de l'étape — catégorie ou tirelire —, par le bouton × de la ligne qui porte ce nom. */
async function retirer(page: Page, selecteurDuChamp: string, nom: string) {
  const fait = await page.evaluate(
    (sel: string, n: string) => {
      const champ = ([...document.querySelectorAll(sel)] as HTMLInputElement[]).find((i) => i.value.trim() === n);
      const b = (champ?.closest('.ligne-categorie') ?? champ?.parentElement)?.querySelector('button.danger') as HTMLButtonElement | null | undefined;
      b?.click();
      return !!b;
    },
    selecteurDuChamp,
    nom,
  );
  expect(fait, `« ${nom} » : pas de bouton pour le retirer`).toBe(true);
  await pause(250);
}

/** Remplit le formulaire d'ajout de l'étape, puis l'envoie. */
async function ajouter(page: Page, nom: string, nature: 'expense' | 'income') {
  const rempli = await page.evaluate(
    (n: string, na: string) => {
      const f = document.querySelector('main form.edit') as HTMLFormElement | null;
      const champ = f?.querySelector('input') as HTMLInputElement | null;
      const choix = f?.querySelector('select') as HTMLSelectElement | null;
      if (!champ || !choix) return false;
      champ.value = n;
      champ.dispatchEvent(new Event('input', { bubbles: true }));
      choix.value = na;
      choix.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    nom,
    nature,
  );
  expect(rempli, 'pas de formulaire pour ajouter une catégorie').toBe(true);
  expect(await cliquer(page, 'Ajouter une catégorie')).toBe(true);
  await pause(250);
}

/** Une page neuve sur un projet vierge, l'assistant ouvert à l'étape Comptes. */
async function ouvrirLAssistant(site: Site): Promise<Page> {
  const page = await nouvellePage(site);
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
  await allerÀ(page, 'Plan');
  await cliquer(page, 'Construire mon budget');
  await pause(300);
  await cliquer(page, 'Commencer');
  await pause(250);
  return page;
}

/** Suivant, `n` fois. */
async function suivant(page: Page, n: number) {
  for (let i = 0; i < n; i++) {
    expect(await cliquer(page, 'Suivant'), 'pas de bouton « Suivant »').toBe(true);
    await pause(250);
  }
}

/** Ce que l'écran Catégories du projet dit : chaque catégorie, sa nature (le titre qui la range) et son budget. */
async function categoriesDuProjet(page: Page): Promise<Array<{ nature: string; nom: string; budget: string }>> {
  await allerÀ(page, 'Plus');
  await cliquer(page, 'Catégories');
  await pause(250);
  return page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const sortie: Array<{ nature: string; nom: string; budget: string }> = [];
    let nature = '';
    for (const e of document.querySelectorAll('main h2, main .row .label')) {
      if (e.tagName === 'H2') nature = t(e);
      else sortie.push({ nature, nom: t(e.querySelector('strong')), budget: t(e.querySelector('.sub')).replace(/^budget\s*/, '') });
    }
    return sortie;
  });
}

/** Les lignes de Flux prévus qui portent ce nom : on y ouvre chacune, et on lit sa catégorie. */
async function categoriesDuFlux(page: Page, nom: string): Promise<string[]> {
  await allerÀ(page, 'Plus');
  await cliquer(page, 'Flux prévus');
  await pause(250);
  const combien = await page.evaluate(
    (n: string) => ([...document.querySelectorAll('main .row')] as HTMLElement[]).filter((r) => (r.querySelector('.label > strong')?.textContent ?? '').trim() === n).length,
    nom,
  );
  const vues: string[] = [];
  for (let i = 0; i < combien; i++) {
    const ouvert = await page.evaluate(
      (n: string, k: number) => {
        const r = ([...document.querySelectorAll('main .row')] as HTMLElement[]).filter((x) => (x.querySelector('.label > strong')?.textContent ?? '').trim() === n)[k];
        const b = ([...(r?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').trim() === 'Modifier');
        b?.click();
        return !!b;
      },
      nom,
      i,
    );
    expect(ouvert, `« ${nom} » : pas de bouton « Modifier » dans Flux prévus`).toBe(true);
    await pause(250);
    vues.push(
      await page.evaluate(() => {
        const l = ([...document.querySelectorAll('main form label.f')] as HTMLLabelElement[]).find((x) => (x.textContent ?? '').trim().startsWith('Catégorie'));
        const s = l?.querySelector('select') as HTMLSelectElement | null | undefined;
        return s ? (s.selectedOptions[0]?.textContent ?? '').trim() : '(pas de champ Catégorie)';
      }),
    );
    await cliquer(page, 'Annuler');
    await pause(150);
  }
  return vues;
}

describe.skipIf(!navigateur)('#212 — l’assistant propose les catégories de l’exemple', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);

  afterAll(async () => {
    await site?.fermer();
  });

  describe('tel quel', () => {
    let page: Page;
    let ecrans: string[] = [];

    beforeAll(async () => {
      page = await ouvrirLAssistant(site); // Commencer : intro → Comptes
      for (let i = 0; i < 6; i++) {
        // Comptes → Revenus → Charges fixes → Budgets → Pas tous les mois → Épargne → Catégories : le seul bouton primaire.
        expect(await cliquer(page, 'Suivant')).toBe(true);
        await pause(250);
      }
      ecrans = await page.evaluate(() => ([...document.querySelectorAll('.wizard-steps .wstep')] as HTMLElement[]).map((e) => (e.textContent ?? '').trim()));
    }, 120_000);

    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 2] point 1 — une étape Catégories, après Épargne et avant le Résumé', async () => {
      const i = ecrans.indexOf('Catégories');
      expect(ecrans[i - 1]).toBe('Épargne');
      expect(ecrans[i + 1]).toBe('Résumé');
      expect(await titre(page)).toContain('classer');
    });

    it('[niveau 2] point 1 — sur un projet vierge, elle arrive avec les dix catégories de l’exemple, et elles seules, chacune rangée sous sa nature', async () => {
      const lignes = await lesCategories(page);
      expect(noms(lignes, 'Revenus')).toEqual(['Salaire', 'Loyer perçu', 'Allocations']);
      expect(noms(lignes, 'Dépenses')).toEqual(['Alimentation', 'Santé', 'Enfants', 'Logement', 'Assurances', 'Abonnements', 'Virement interne']);
      expect(lignes).toHaveLength(10);
      // Elles sont déjà là : rien à ajouter en un geste.
      expect(await raccourcis(page)).toEqual([]);
    });

    it('[niveau 2] point 2 — chaque ligne dit la tirelire par défaut et les flux qui portent la catégorie', async () => {
      const lignes = await lesCategories(page);
      expect(detailDe(lignes, 'Alimentation')).toBe('Tirelire par défaut : Alimentation');
      expect(detailDe(lignes, 'Santé')).toBe('Tirelire par défaut : Santé');
      expect(detailDe(lignes, 'Enfants')).toBe('Tirelire par défaut : Enfants et loisirs');
      expect(detailDe(lignes, 'Logement')).toBe('Flux : Crédit immobilier, Électricité');
      expect(detailDe(lignes, 'Assurances')).toBe('Flux : Assurance habitation');
      expect(detailDe(lignes, 'Abonnements')).toBe('Flux : Internet et mobiles');
      expect(detailDe(lignes, 'Virement interne')).toBe('');
      // Les deux versions du salaire ne font qu'un flux dans la ligne.
      expect(detailDe(lignes, 'Salaire', 'Revenus')).toBe('Flux : Salaire');
      expect(detailDe(lignes, 'Loyer perçu', 'Revenus')).toBe('Flux : Loyer locatif');
      expect(detailDe(lignes, 'Allocations', 'Revenus')).toBe('Flux : Allocations');
    });

    it('[niveau 1] point 7 (I4) — l’étape se franchit par son seul bouton primaire, sans rien refuser', async () => {
      expect(await erreurs(page)).toEqual([]);
      // Le bouton primaire de l'étape est « Suivant », et il n'est pas désactivé : rien à remplir pour le presser.
      expect(
        await page.evaluate(() => {
          const b = ([...document.querySelectorAll('button.primary')] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').includes('Suivant'));
          return !!b && !b.disabled;
        }),
      ).toBe(true);
      await suivant(page, 1);
      expect(await titre(page)).not.toContain('classer');
      expect(await page.evaluate(() => [...document.querySelectorAll('main button')].some((b) => (b.textContent ?? '').includes('Valider mon budget')))).toBe(true);
    });

    it('[niveau 1] point 6 (I11) — validé tel quel, le projet porte les dix catégories, chacune avec sa tirelire par défaut', async () => {
      expect(await cliquer(page, 'Valider mon budget')).toBe(true);
      await pause(500);
      const cats = await categoriesDuProjet(page);
      // L'écran Catégories range à sa façon : on compare les noms, pas leur ordre.
      expect(cats.filter((c) => c.nature === 'Revenus').map((c) => c.nom).sort()).toEqual(['Allocations', 'Loyer perçu', 'Salaire']);
      expect(cats.filter((c) => c.nature === 'Dépenses').map((c) => c.nom).sort()).toEqual(
        ['Abonnements', 'Alimentation', 'Assurances', 'Enfants', 'Logement', 'Santé', 'Virement interne'],
      );
      const budget = (nom: string) => cats.find((c) => c.nom === nom)!.budget;
      expect(budget('Alimentation')).toBe('Alimentation');
      expect(budget('Santé')).toBe('Santé');
      expect(budget('Enfants')).toBe('Enfants et loisirs');
      expect(budget('Logement')).toBe('');
      expect(cats).toHaveLength(10);
    }, 60_000);

    it('[niveau 1] point 6 (I11) — chaque flux de l’exemple se retrouve dans Flux prévus avec sa catégorie', async () => {
      expect(await categoriesDuFlux(page, 'Crédit immobilier')).toEqual(['Logement']);
      expect(await categoriesDuFlux(page, 'Électricité')).toEqual(['Logement']);
      expect(await categoriesDuFlux(page, 'Assurance habitation')).toEqual(['Assurances']);
      expect(await categoriesDuFlux(page, 'Internet et mobiles')).toEqual(['Abonnements']);
      expect(await categoriesDuFlux(page, 'Loyer locatif')).toEqual(['Loyer perçu']);
      expect(await categoriesDuFlux(page, 'Allocations')).toEqual(['Allocations']);
      const salaires = await categoriesDuFlux(page, 'Salaire');
      expect(salaires.length).toBeGreaterThan(0);
      expect(salaires.every((c) => c === 'Salaire')).toBe(true);
    }, 60_000);

    it('[niveau 1] point 6 (I11) — ce que l’assistant a créé se modifie ensuite depuis Catégories', async () => {
      await allerÀ(page, 'Plus');
      await cliquer(page, 'Catégories');
      await pause(250);
      const ouvert = await page.evaluate(() => {
        const r = ([...document.querySelectorAll('main .row')] as HTMLElement[]).find((x) => (x.querySelector('.label > strong')?.textContent ?? '').trim() === 'Santé');
        const b = ([...(r?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').trim() === 'Modifier');
        b?.click();
        return !!b;
      });
      expect(ouvert).toBe(true);
      await pause(250);
      expect(await poser(page, 'main form.edit input', undefined, 'Santé et soins')).toBe(true);
      expect(await cliquer(page, 'Enregistrer')).toBe(true);
      await pause(300);
      const cats = await categoriesDuProjet(page);
      expect(cats.find((c) => c.nom === 'Santé et soins')?.budget).toBe('Santé');
      expect(cats.some((c) => c.nom === 'Santé')).toBe(false);
    }, 60_000);
  });

  describe('corrigé', () => {
    let page: Page;

    beforeAll(async () => {
      page = await ouvrirLAssistant(site);
      await suivant(page, 3); // Comptes → Revenus → Charges fixes → Budgets
      // Une tirelire retirée à une étape précédente : « Alimentation ».
      await retirer(page, 'main .card.tirelire input.nom', 'Alimentation');
      await suivant(page, 3); // Budgets → Pas tous les mois → Épargne → Catégories
    }, 120_000);

    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 1] point 3 (I3) — une tirelire retirée à une étape précédente laisse sa catégorie, sans tirelire par défaut', async () => {
      expect(await titre(page)).toContain('classer');
      const lignes = await lesCategories(page);
      expect(lignes).toHaveLength(10);
      expect(noms(lignes, 'Dépenses')).toContain('Alimentation');
      expect(detailDe(lignes, 'Alimentation')).toBe('');
      expect(detailDe(lignes, 'Santé')).toBe('Tirelire par défaut : Santé');
    });

    it('[niveau 2] point 3 — le nom d’une catégorie se corrige sur place, et la correction tient quand on quitte l’étape et qu’on y revient', async () => {
      await renommer(page, 'Santé', 'Soins');
      let lignes = await lesCategories(page);
      expect(noms(lignes, 'Dépenses')).toContain('Soins');
      expect(noms(lignes, 'Dépenses')).not.toContain('Santé');
      expect(detailDe(lignes, 'Soins')).toBe('Tirelire par défaut : Santé');
      expect(await erreurs(page)).toEqual([]);

      await etape(page, 'Résumé');
      await etape(page, 'Catégories');
      lignes = await lesCategories(page);
      expect(noms(lignes, 'Dépenses')).toContain('Soins');
      expect(lignes).toHaveLength(10);
    });

    it('[niveau 2] point 3 — deux catégories de même nature ne portent pas le même nom : le renommage en doublon est refusé, dit, et le champ reprend son nom', async () => {
      // Sans casse, sans accent, sans espaces autour (D61).
      await renommer(page, 'Enfants', ' logement ');
      expect(await erreurs(page)).toEqual(['Une catégorie « Logement » existe déjà pour cette nature.']);
      const lignes = await lesCategories(page);
      expect(noms(lignes, 'Dépenses')).toContain('Enfants');
      expect(lignes).toHaveLength(10);
      // Le refus ne reste pas affiché quand on quitte l'étape.
      await etape(page, 'Résumé');
      await etape(page, 'Catégories');
      expect(await erreurs(page)).toEqual([]);
    });

    it('[niveau 2] point 3 — l’ajout d’une catégorie de même nature et de même nom est refusé et dit ; en l’autre nature, il est accepté', async () => {
      await ajouter(page, 'salaire', 'income');
      expect(await erreurs(page)).toEqual(['Une catégorie « Salaire » existe déjà pour cette nature.']);
      expect(await lesCategories(page)).toHaveLength(10);

      await ajouter(page, 'Salaire', 'expense');
      expect(await erreurs(page)).toEqual([]);
      const lignes = await lesCategories(page);
      expect(noms(lignes, 'Dépenses')).toContain('Salaire');
      expect(lignes).toHaveLength(11);
      await retirer(page, 'main .ligne-categorie input.nom', 'Salaire');
      expect(await lesCategories(page)).toHaveLength(10);
    });

    it('[niveau 2] point 3 — une catégorie retirée sur place disparaît de l’étape, et ne reste sur aucun flux', async () => {
      await retirer(page, 'main .ligne-categorie input.nom', 'Logement');
      await retirer(page, 'main .ligne-categorie input.nom', 'Assurances');
      await retirer(page, 'main .ligne-categorie input.nom', 'Loyer perçu');
      const lignes = await lesCategories(page);
      expect(noms(lignes, 'Dépenses')).toEqual(['Alimentation', 'Soins', 'Enfants', 'Abonnements', 'Virement interne']);
      expect(noms(lignes, 'Revenus')).toEqual(['Salaire', 'Allocations']);
      // Les flux qu'elles portaient ne sont plus dans aucune ligne.
      for (const l of lignes) expect(l.detail, l.nom).not.toMatch(/Crédit immobilier|Électricité|Assurance habitation|Loyer locatif/);
    });

    it('[niveau 1] point 3 (I3) — une tirelire retirée à l’étape des budgets, après l’arrivée ici, laisse aussi sa catégorie sans tirelire par défaut', async () => {
      await etape(page, 'Budgets');
      await retirer(page, 'main .card.tirelire input.nom', 'Enfants et loisirs');
      await etape(page, 'Catégories');
      const lignes = await lesCategories(page);
      expect(noms(lignes, 'Dépenses')).toContain('Enfants');
      expect(detailDe(lignes, 'Enfants')).toBe('');
      expect(detailDe(lignes, 'Soins')).toBe('Tirelire par défaut : Santé');
    });

    it('[niveau 2] point 3 — validé, le projet porte les catégories gardées et corrigées, sans celles qui ont été retirées, et leurs flux n’ont plus de catégorie', async () => {
      await etape(page, 'Résumé');
      expect(await cliquer(page, 'Valider mon budget')).toBe(true);
      await pause(500);
      const cats = await categoriesDuProjet(page);
      expect(cats.filter((c) => c.nature === 'Revenus').map((c) => c.nom).sort()).toEqual(['Allocations', 'Salaire']);
      expect(cats.filter((c) => c.nature === 'Dépenses').map((c) => c.nom).sort()).toEqual(['Abonnements', 'Alimentation', 'Enfants', 'Soins', 'Virement interne']);
      const budget = (nom: string) => cats.find((c) => c.nom === nom)!.budget;
      expect([budget('Alimentation'), budget('Soins'), budget('Enfants')]).toEqual(['', 'Santé', '']);

      expect(await categoriesDuFlux(page, 'Crédit immobilier')).toEqual(['—']);
      expect(await categoriesDuFlux(page, 'Électricité')).toEqual(['—']);
      expect(await categoriesDuFlux(page, 'Assurance habitation')).toEqual(['—']);
      expect(await categoriesDuFlux(page, 'Loyer locatif')).toEqual(['—']);
      expect(await categoriesDuFlux(page, 'Internet et mobiles')).toEqual(['Abonnements']);
    }, 90_000);

    it('[niveau 2] point 4 — rouvert sur ce projet, un raccourci apporte chaque catégorie de l’exemple qui manque, et disparaît dès qu’une catégorie de même nature et de même nom existe', async () => {
      await allerÀ(page, 'Plus');
      expect(await cliquer(page, 'Lancer')).toBe(true);
      await pause(300);
      await etape(page, 'Catégories');
      expect(await titre(page)).toContain('classer');
      // Sur un projet existant, rien n'est semé : les lignes sont celles du projet, et les manquantes se proposent.
      expect(noms(await lesCategories(page), 'Dépenses').sort()).toEqual(['Abonnements', 'Alimentation', 'Enfants', 'Soins', 'Virement interne']);
      // Dans l'ordre de l'exemple : les revenus, puis les dépenses.
      expect(await raccourcis(page)).toEqual(['Loyer perçu · revenu', 'Santé · dépense', 'Logement · dépense', 'Assurances · dépense']);

      // Le raccourci apporte la catégorie avec ses liens vers ce qui existe : les flux de même nom, la tirelire par défaut.
      expect(await cliquer(page, '+ Logement')).toBe(true);
      await pause(250);
      expect(detailDe(await lesCategories(page), 'Logement')).toBe('Flux : Crédit immobilier, Électricité');
      expect(await cliquer(page, '+ Santé')).toBe(true);
      await pause(250);
      expect(detailDe(await lesCategories(page), 'Santé')).toBe('Tirelire par défaut : Santé');
      expect(await raccourcis(page)).toEqual(['Loyer perçu · revenu', 'Assurances · dépense']);

      // Une catégorie de même nom, mais de l'autre nature, ne fait pas disparaître le raccourci…
      await ajouter(page, 'Loyer perçu', 'expense');
      expect(await erreurs(page)).toEqual([]);
      expect(await raccourcis(page)).toEqual(['Loyer perçu · revenu', 'Assurances · dépense']);
      // … et de même nature, quelle que soit la casse, si.
      await ajouter(page, 'assurances', 'expense');
      expect(await erreurs(page)).toEqual([]);
      expect(await raccourcis(page)).toEqual(['Loyer perçu · revenu']);
      expect(await cliquer(page, '+ Loyer perçu')).toBe(true);
      await pause(250);
      expect(detailDe(await lesCategories(page), 'Loyer perçu', 'Revenus')).toBe('Flux : Loyer locatif');
      expect(await raccourcis(page)).toEqual([]);
    }, 90_000);

    it('[niveau 2] point 4 — validé, les catégories apportées par les raccourcis portent leurs flux, dans Flux prévus', async () => {
      await etape(page, 'Résumé');
      expect(await cliquer(page, 'Valider mon budget')).toBe(true);
      await pause(500);
      expect(await categoriesDuFlux(page, 'Crédit immobilier')).toEqual(['Logement']);
      expect(await categoriesDuFlux(page, 'Électricité')).toEqual(['Logement']);
      expect(await categoriesDuFlux(page, 'Loyer locatif')).toEqual(['Loyer perçu']);
      expect(await categoriesDuFlux(page, 'Assurance habitation')).toEqual(['—']);
      const cats = await categoriesDuProjet(page);
      expect(cats.find((c) => c.nom === 'Santé')?.budget).toBe('Santé');
      // Rouvert puis validé, le projet porte ce que l'assistant montrait, et rien de plus ni de moins : rien n'est cassé, rien n'est doublé (D43).
      expect(cats.filter((c) => c.nature === 'Revenus').map((c) => c.nom).sort()).toEqual(['Allocations', 'Loyer perçu', 'Salaire']);
      expect(cats.filter((c) => c.nature === 'Dépenses').map((c) => c.nom).sort()).toEqual(
        ['Abonnements', 'Alimentation', 'Enfants', 'Logement', 'Loyer perçu', 'Santé', 'Soins', 'Virement interne', 'assurances'].sort(),
      );
      expect(cats).toHaveLength(12);
    }, 90_000);
  });
});
