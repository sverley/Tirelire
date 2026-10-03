/**
 * Tests du codeur de #211 — « L'assistant propose les comptes de l'exemple » : l'écran, sur le site construit, à
 * 375 px. La lecture des comptes dans l'exemple (points 1, 2, 3 et 5) est dans
 * `packages/core/test/suggestions-comptes.test.ts`, sans navigateur.
 *
 * Chaque test dit, dans son titre, le point du « Fait quand » qu'il vérifie :
 *  - 1, 2, 3 : sur un projet vierge, l'étape Comptes arrive avec les comptes de l'exemple et le compte principal
 *    renseigné, chacun avec ce que l'exemple en dit ; l'étape dit qu'un compte est tiers ou clos ;
 *  - 4 : sur un projet existant, les raccourcis offrent les comptes qui manquent ;
 *  - 6 : validé tel quel, l'assistant laisse les comptes dans le projet, retrouvables et modifiables dans Comptes.
 * Un dernier test garde un choix du codeur, que l'issue ne tranche pas : le compte principal que l'utilisateur a déjà
 * renseigné n'est pas remplacé par celui de l'exemple (D43 : rouvrir l'assistant ne doit rien casser).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { addDays, budgetPeriodContaining, euros } from '@tirelire/core';
import { allerÀ, cliquer, JOUR_DES_TESTS, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Le jour où tournent les pages, et la veille du début de sa période (le jour de paie d'un projet vierge est le 1er). */
const JOUR = JOUR_DES_TESTS.slice(0, 10);
const VEILLE_DU_DEBUT_DE_PERIODE = addDays(budgetPeriodContaining(JOUR, 1).start, -1);

interface Ligne {
  principal: boolean;
  nom: string;
  solde: string;
  type: string;
  pastilles: string[];
  detail: string;
}

/** Les lignes de l'étape Comptes de l'assistant : nom, solde, type, pastilles, ce que l'étape en dit. */
const lignes = (page: Page): Promise<Ligne[]> =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return ([...document.querySelectorAll('main .ligne-compte')] as HTMLElement[]).map((l) => ({
      principal: l.classList.contains('principal'),
      nom: (l.querySelector('input') as HTMLInputElement).value.trim(),
      solde: (l.querySelector('input.mt') as HTMLInputElement).value.trim(),
      type: (l.querySelector('select') as HTMLSelectElement | null)?.value ?? 'principal',
      pastilles: [...l.querySelectorAll('.pill')].map(t),
      detail: t(l.querySelector('.suite')),
    }));
  });

/** Un solde saisi, en centimes : « 2340,00 » ou « 2 340,00 ». */
const centimes = (solde: string) => Math.round(parseFloat(solde.replace(/[\s  ]/g, '').replace(',', '.')) * 100);

/** Les raccourcis que l'étape offre encore. */
const raccourcis = (page: Page) =>
  page.evaluate(() => ([...document.querySelectorAll('main .propositions .prop .n')] as HTMLElement[]).map((n) => (n.textContent ?? '').trim()));

const lire = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return {
      h2: t(document.querySelector('main h2')),
      primaires: ([...document.querySelectorAll('main .actions button.primary')] as HTMLButtonElement[]).map(t),
    };
  });

async function ouvrir(page: Page, site: Site) {
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
}

/** Clique le bouton primaire « Suivant » ou « Commencer » ; rend faux s'il n'y en a pas. */
async function avancer(page: Page): Promise<boolean> {
  const fait = await page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const b = ([...document.querySelectorAll('main .actions button.primary')] as HTMLButtonElement[]).find((x) => /Suivant|Commencer/.test(t(x)));
    b?.click();
    return !!b;
  });
  await pause(250);
  return fait;
}

/** Du point où l'on est jusqu'au résumé, par les seuls boutons primaires. */
async function jusquAuResume(page: Page) {
  for (let i = 0; i < 14 && !(await lire(page)).primaires.includes('Valider mon budget'); i++) await avancer(page);
  expect((await lire(page)).primaires, 'le résumé n’est pas atteint par les boutons primaires').toContain('Valider mon budget');
}

/** Ouvre l'assistant sur un projet vierge, depuis le Plan, et passe le principe : on arrive sur l'étape Comptes. */
async function arriverAuxComptes(page: Page) {
  await allerÀ(page, 'Plan');
  expect(await cliquer(page, 'Construire mon budget'), 'pas de bouton « Construire mon budget »').toBe(true);
  await pause(300);
  expect(await avancer(page), 'le principe ne se franchit pas par son bouton primaire').toBe(true);
  expect((await lire(page)).h2).toBe('Vos comptes en banque');
}

/** Ouvre l'assistant sur un projet existant, depuis Configuration, et passe le principe. */
async function rouvrirAuxComptes(page: Page) {
  await allerÀ(page, 'Plus');
  expect(await cliquer(page, 'Lancer'), 'pas de bouton « Lancer » pour ouvrir l’assistant').toBe(true);
  await pause(300);
  expect(await avancer(page)).toBe(true);
  expect((await lire(page)).h2).toBe('Vos comptes en banque');
}

/** Retire d'un clic la ligne de compte qui porte ce nom. */
async function retirer(page: Page, nom: string) {
  const fait = await page.evaluate((n: string) => {
    const ligne = ([...document.querySelectorAll('main .ligne-compte')] as HTMLElement[]).find((l) => (l.querySelector('input') as HTMLInputElement).value.trim() === n);
    const b = ligne?.querySelector('button.danger') as HTMLButtonElement | null;
    b?.click();
    return !!b;
  }, nom);
  expect(fait, `la ligne « ${nom} » n’a pas de bouton pour la retirer`).toBe(true);
  await pause(250);
}

/** Saisit une valeur dans le champ du sélecteur, comme le fait la saisie : `input`, puis `change`. */
async function saisir(page: Page, sélecteur: string, valeur: string) {
  const fait = await page.evaluate(
    (s: string, v: string) => {
      const el = document.querySelector(s) as HTMLInputElement | null;
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    sélecteur,
    valeur,
  );
  expect(fait, `champ introuvable : ${sélecteur}`).toBe(true);
  await pause(200);
}

/** Un écran ordinaire, atteint par le menu Plus. */
async function ecran(page: Page, nom: string) {
  await allerÀ(page, 'Plus');
  expect(await cliquer(page, nom), `pas d’écran « ${nom} » dans le menu Plus`).toBe(true);
  await pause(200);
}

/** Les cartes de l'écran Comptes : leur nom, leurs pastilles. */
const cartes = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return [...document.querySelectorAll('main .card')]
      .filter((c) => c.querySelector('.pill'))
      .map((c) => ({ nom: t(c.querySelector('strong')), pastilles: [...c.querySelectorAll('.pill')].map(t), texte: t(c) }));
  });

/** L'écran Comptes range les comptes clos (D56) : pour les lire, on allume « Clos ». */
async function montrerLeClos(page: Page) {
  const allume = await page.evaluate(() => {
    const b = ([...document.querySelectorAll('main button.filtre')] as HTMLButtonElement[]).find(
      (x) => (x.textContent ?? '').trim().startsWith('Clos') && x.getAttribute('aria-pressed') === 'false',
    );
    b?.click();
    return !!b;
  });
  if (allume) await pause(200);
}

/** Ouvre le formulaire d'un compte, depuis sa carte. */
async function modifier(page: Page, nom: string) {
  const fait = await page.evaluate((n: string) => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const carte = [...document.querySelectorAll('main .card')].find((c) => t(c.querySelector('strong')) === n);
    const b = ([...(carte?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]).find((x) => t(x) === 'Modifier');
    b?.click();
    return !!b;
  }, nom);
  expect(fait, `pas de bouton « Modifier » sur la carte « ${nom} »`).toBe(true);
  await pause(250);
}

/** Ce que dit un champ du formulaire ouvert, par le début de son libellé : sa valeur, ou sa case cochée. */
const champ = (page: Page, libellé: string) =>
  page.evaluate((l: string) => {
    const label = ([...document.querySelectorAll('form.edit label.f')] as HTMLElement[]).find((x) => (x.textContent ?? '').trim().startsWith(l));
    const el = label?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null | undefined;
    if (!el) return undefined;
    return el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
  }, libellé);

describe.skipIf(!navigateur)('#211 · l’assistant propose les comptes de l’exemple', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 300_000);

  afterAll(async () => {
    await site?.fermer();
  });

  describe('sur un projet vierge', () => {
    let page: Page;
    let arrivee: Ligne[];

    beforeAll(async () => {
      page = await nouvellePage(site);
      await ouvrir(page, site);
      await arriverAuxComptes(page);
      arrivee = await lignes(page);
    }, 120_000);

    afterAll(async () => {
      await page?.close().catch(() => {});
    });

    it('[niveau 4] point 1 — l’étape Comptes arrive avec « Livret A », « Carte enfants », « Compte de Marie » et « Livret jeune », chacun avec son nom, son type et son solde', () => {
      const autres = arrivee.filter((l) => !l.principal);
      expect(autres.map((l) => l.nom)).toEqual(['Livret A', 'Carte enfants', 'Compte de Marie', 'Livret jeune']);
      expect(autres.map((l) => l.type)).toEqual(['epargne', 'courant', 'courant', 'epargne']);
      expect(autres.map((l) => centimes(l.solde))).toEqual([euros(4815), 0, 0, 0]);
    });

    it('[niveau 4] point 1 — les raccourcis sont tous consommés d’entrée, et l’étape se franchit par son seul bouton primaire (D46, I4)', async () => {
      expect(await raccourcis(page), 'sur un projet vierge, la rangée des raccourcis est vide').toEqual([]);
      expect((await lire(page)).primaires.some((p) => /Suivant/.test(p))).toBe(true);
    });

    it('[niveau 4] point 2 — le compte principal arrive avec le nom « Compte courant » et le solde 2 340,00 €', () => {
      const principal = arrivee.filter((l) => l.principal);
      expect(principal).toHaveLength(1);
      expect(principal[0]!.nom).toBe('Compte courant');
      expect(centimes(principal[0]!.solde)).toBe(euros(2340));
    });

    it('[niveau 4] point 3 — l’étape dit qu’un compte est tiers, avec le suivi de son solde à régler tel que l’exemple le dit, et qu’un compte est clos', () => {
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
      expect(par('Livret A').pastilles).not.toContain('tiers');
      expect(par('Livret jeune').pastilles).not.toContain('tiers');
    });

    it('[niveau 4] point 3 — le compte clos ne figure plus dans les menus de comptes des autres étapes (D56)', async () => {
      await avancer(page); // → les revenus
      const menus = await page.evaluate(() =>
        ([...document.querySelectorAll('main select')] as HTMLSelectElement[])
          .filter((s) => [...s.options].some((o) => (o.textContent ?? '').trim() === 'Livret A'))
          .map((s) => [...s.options].map((o) => (o.textContent ?? '').trim())),
      );
      expect(menus.length, 'aucun menu de comptes à l’étape des revenus').toBeGreaterThan(0);
      for (const options of menus) {
        expect(options).toContain('Compte courant');
        expect(options).toContain('Carte enfants');
        expect(options).not.toContain('Livret jeune');
      }
      await cliquer(page, 'Précédent');
      await pause(250);
    });

    it('[niveau 4] point 6 — validé tel quel, l’assistant laisse les comptes de l’exemple dans le projet, retrouvables dans Comptes avec leur suivi et leur clôture, et modifiables', async () => {
      await jusquAuResume(page);
      expect(await cliquer(page, 'Valider mon budget')).toBe(true);
      await pause(400);

      await ecran(page, 'Comptes');
      const avantLeClos = await cartes(page);
      expect(avantLeClos.map((c) => c.nom).sort()).toEqual(['Carte enfants', 'Compte courant', 'Compte de Marie', 'Livret A']);
      expect(avantLeClos.find((c) => c.nom === 'Compte courant')!.pastilles).toContain('principal');
      expect(avantLeClos.find((c) => c.nom === 'Livret A')!.texte).toMatch(/solde initial 4\s?815,00/);
      expect(avantLeClos.find((c) => c.nom === 'Compte courant')!.texte).toMatch(/solde initial 2\s?340,00/);

      // Un compte tiers : son suivi se retrouve dans son formulaire, où il se modifie.
      await modifier(page, 'Carte enfants');
      expect(await champ(page, 'Suivre un solde à régler')).toBe(true);
      expect(await champ(page, 'Seuil de règlement')).toBe('10,00');
      expect(await champ(page, 'Sens autorisé')).toBe('both');

      // Le compte clos : rangé par défaut (D56), il se retrouve en allumant « Clos », avec sa clôture.
      await montrerLeClos(page);
      const avecLeClos = await cartes(page);
      expect(avecLeClos.map((c) => c.nom)).toContain('Livret jeune');
      expect(avecLeClos.find((c) => c.nom === 'Livret jeune')!.pastilles).toContain('clos');
      await modifier(page, 'Livret jeune');
      expect(await champ(page, 'Compte clos le'), 'la clôture : la veille du premier jour de la période qui contient la date de l’assistant').toBe(VEILLE_DU_DEBUT_DE_PERIODE);
    }, 120_000);
  });

  describe('sur un projet existant', () => {
    it('[niveau 4] point 4 — les raccourcis offrent les comptes de l’exemple qui manquent, chacun disparaît dès qu’un compte du même nom existe, et rien n’est semé d’office', async () => {
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        await arriverAuxComptes(page);
        for (const nom of ['Carte enfants', 'Compte de Marie', 'Livret jeune']) await retirer(page, nom);
        await jusquAuResume(page);
        expect(await cliquer(page, 'Valider mon budget')).toBe(true);
        await pause(400);

        // Le projet n'est plus vierge : l'assistant part de son contenu, il ne sème plus rien (D43).
        await rouvrirAuxComptes(page);
        expect((await lignes(page)).map((l) => l.nom), 'sur un projet existant, rien n’est semé d’office').toEqual(['Compte courant', 'Livret A']);
        expect(await raccourcis(page)).toEqual(['+ Carte enfants', '+ Compte de Marie', '+ Livret jeune']);

        // Un compte saisi à la main sous le même nom fait disparaître le raccourci.
        await saisir(page, 'main form.edit input[placeholder="Livret A"]', 'Compte de Marie');
        expect(await cliquer(page, 'Ajouter un compte')).toBe(true);
        await pause(250);
        expect(await raccourcis(page)).toEqual(['+ Carte enfants', '+ Livret jeune']);

        // Un raccourci crée la ligne, avec ce que l'exemple en dit, et disparaît à son tour.
        expect(await cliquer(page, '+ Carte enfants')).toBe(true);
        await pause(250);
        expect(await cliquer(page, '+ Livret jeune')).toBe(true);
        await pause(250);
        const apres = await lignes(page);
        expect(apres.map((l) => l.nom)).toEqual(['Compte courant', 'Livret A', 'Compte de Marie', 'Carte enfants', 'Livret jeune']);
        expect(apres.find((l) => l.nom === 'Carte enfants')!.pastilles).toContain('tiers');
        expect(apres.find((l) => l.nom === 'Livret jeune')!.pastilles).toContain('clos');
        expect(centimes(apres.find((l) => l.nom === 'Livret jeune')!.solde)).toBe(0);
        expect(await raccourcis(page), 'tous les comptes de l’exemple sont là : plus de raccourci').toEqual([]);
      } finally {
        await page.close();
      }
    }, 180_000);
  });

  describe('sur un projet vierge dont le compte principal est déjà renseigné', () => {
    it('[niveau 4] choix du codeur — le nom et le solde que l’utilisateur a posés ne sont pas remplacés par ceux de l’exemple, les autres comptes arrivent', async () => {
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        await ecran(page, 'Comptes');
        await modifier(page, 'Compte principal');
        await saisir(page, 'form.edit label.f input[placeholder="Compte courant"]', 'Compte de la maison');
        const soldeInitial = await page.evaluate(() => {
          const label = ([...document.querySelectorAll('form.edit label.f')] as HTMLElement[]).find((x) => (x.textContent ?? '').trim().startsWith('Solde initial'));
          return !!label;
        });
        expect(soldeInitial, 'le formulaire du compte n’a pas de « Solde initial »').toBe(true);
        await page.evaluate(() => {
          const label = ([...document.querySelectorAll('form.edit label.f')] as HTMLElement[]).find((x) => (x.textContent ?? '').trim().startsWith('Solde initial'));
          const el = label!.querySelector('input') as HTMLInputElement;
          el.value = '1 500,00';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(await cliquer(page, 'Enregistrer')).toBe(true);
        await pause(300);

        await arriverAuxComptes(page);
        const l = await lignes(page);
        const principal = l.find((x) => x.principal)!;
        expect(principal.nom, 'le nom que l’utilisateur a posé a été remplacé').toBe('Compte de la maison');
        expect(centimes(principal.solde), 'le solde que l’utilisateur a posé a été remplacé').toBe(euros(1500));
        expect(l.filter((x) => !x.principal).map((x) => x.nom), 'les autres comptes de l’exemple arrivent, le projet étant vierge').toEqual([
          'Livret A',
          'Carte enfants',
          'Compte de Marie',
          'Livret jeune',
        ]);
      } finally {
        await page.close();
      }
    }, 180_000);
  });
});
