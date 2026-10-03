/**
 * Harnais d'audit de #336 — « L'assistant propose toutes les tirelires de l'exemple, leurs besoins,
 * leur placement et l'ordre permanent », côté écran : sur le site construit, à 375 px, au 20 septembre 2026.
 *
 * Retenus parmi les tests du codeur (`navigateur/assistant-tirelires-exemple.test.ts`, déplacé ici en
 * entier), puis complétés : ce que l'étape laisse corriger — le déjà mis de côté (point 3), la réponse
 * à « où dort chaque tirelire » (point 5), le montant de l'ordre (point 6) — et, après la validation,
 * le prélèvement et l'ordre retrouvés dans Flux prévus, modifiables, et le piano dans sa tirelire
 * (point 10). La lecture de l'exemple elle-même est dans `packages/core/test/suggestions-tirelires-harnais.test.ts`.
 *
 * Niveaux (D83), par phrase du « Fait quand » :
 *  - 2 pour les points 1 à 6 et 8 : D43, D46, D51, D40, D38 et D60 sont des décisions ; une ligne
 *    absente, fausse ou non corrigeable en est un cas faux, l'usage restant possible.
 *  - 1 pour le point 7 et le point 10 : l'ordre validé s'enregistre comme ce que la banque exécute et
 *    le Plan en montre l'écart sans le réécrire, l'ordre retiré ne s'enregistre pas (I10, « aucun ordre
 *    enregistré ne change sans validation ») ; ce que l'assistant a créé se retrouve et se modifie hors
 *    de lui (I11, tel qu'il est écrit). Rouges sur `main` (ni ordre ni piano après la validation) ; le
 *    test de l'ordre retiré, vert sur `main` qui n'en propose aucun, rouge sur une mutation du code de
 *    la PR : le × de l'ordre sans effet.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
const espaces = (t: string) => t.replace(/[\s  ]+/g, ' ').trim();

/** Ce qu'une étape montre de ses tirelires : une carte par tirelire, ses besoins dessous. */
interface Carte {
  nom: string;
  deja: string;
  garder: boolean | null;
  besoins: Array<{ nom: string; montants: string[]; suite: string }>;
  prelevement: string;
}

const cartes = (page: Page): Promise<Carte[]> =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
    return ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).map((c) => {
      const tete = c.querySelector('.ligne-tirelire')!;
      const garde = tete.querySelector('.garde input') as HTMLInputElement | null;
      return {
        nom: (tete.querySelector('input.nom') as HTMLInputElement).value,
        deja: (tete.querySelector('.deja input') as HTMLInputElement).value,
        garder: garde ? garde.checked : null,
        besoins: ([...c.querySelectorAll('.ligne')] as HTMLElement[]).map((l) => ({
          nom: (l.querySelector('input.besoin') as HTMLInputElement | null)?.value ?? '',
          montants: ([...l.querySelectorAll('input')] as HTMLInputElement[]).filter((i) => !i.classList.contains('besoin')).map((i) => i.value),
          suite: [...l.querySelectorAll('.suite')].map(t).join(' / '),
        })),
        prelevement: t(c.querySelector('.prelevement')),
      };
    });
  });

/** Les raccourcis offerts par l'étape : leur nom. */
const raccourcis = (page: Page) =>
  page.evaluate(() => ([...document.querySelectorAll('main .propositions .prop .n')] as HTMLElement[]).map((n) => (n.textContent ?? '').replace(/^\+\s*/, '').trim()));

/** Le placement que le résumé montre pour chaque tirelire : le compte choisi, par son nom. */
const placements = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      ([...document.querySelectorAll('main select')] as HTMLSelectElement[])
        .filter((s) => [...s.options].some((o) => o.textContent?.trim() === 'Peu importe'))
        .map((s) => [(s.closest('.card')?.querySelector('.label strong')?.textContent ?? '').trim(), (s.selectedOptions[0]?.textContent ?? '').trim()]),
    ),
  );

/** Les ordres que le résumé propose : nom, montant saisi, ce qu'il en dit. */
const ordres = (page: Page) =>
  page.evaluate(() =>
    ([...document.querySelectorAll('main .card.ordre')] as HTMLElement[]).map((c) => ({
      nom: (c.querySelector('strong')?.textContent ?? '').trim(),
      montant: (c.querySelector('input.mt') as HTMLInputElement).value,
      texte: (c.textContent ?? '').replace(/[\s  ]+/g, ' ').trim(),
    })),
  );

/** Va à l'étape nommée par le bandeau des étapes de l'assistant. */
async function etape(page: Page, libelle: string) {
  const fait = await page.evaluate((l: string) => {
    const b = ([...document.querySelectorAll('.wizard-steps .wstep')] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').trim() === l);
    b?.click();
    return !!b;
  }, libelle);
  expect(fait, `pas d’étape « ${libelle} »`).toBe(true);
  await pause(250);
}

/** Clique le bouton × de la ligne, de la carte ou de la ligne de compte qui porte ce nom. */
async function retirer(page: Page, selecteur: string, nom: string) {
  const fait = await page.evaluate(
    (sel: string, n: string) => {
      const champ = ([...document.querySelectorAll(sel)] as HTMLInputElement[]).find((i) => i.value.trim() === n);
      const b = champ?.parentElement?.querySelector('button.danger') as HTMLButtonElement | null;
      b?.click();
      return !!b;
    },
    selecteur,
    nom,
  );
  expect(fait, `« ${nom} » : pas de bouton pour le retirer`).toBe(true);
  await pause(250);
}

/** Une page neuve, sur un projet vierge, l'assistant ouvert à l'étape Comptes. */
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

/** La carte du Plan d'un compte d'accueil : ses lignes, libellé et montant. */
const carteDuPlan = (page: Page, compte: string) =>
  page.evaluate((nom: string) => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/[\s  ]+/g, ' ').trim();
    const c = [...document.querySelectorAll('main .card')].find((x) => t(x.querySelector(':scope > .row .label strong')) === nom);
    if (!c) return null;
    return [...c.querySelectorAll(':scope > .row')].map((r) => [t(r.querySelector('.label')), t(r.querySelector(':scope > .num, :scope > div:last-child'))]);
  }, compte);

describe.skipIf(!navigateur)('#336 — l’assistant propose les tirelires, leurs besoins, leur placement et l’ordre de l’exemple', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);

  afterAll(async () => {
    await site?.fermer();
  });

  describe('un projet vierge, parcouru sans rien changer', () => {
    let page: Page;
    beforeAll(async () => {
      page = await ouvrirLAssistant(site);
    }, 60_000);
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 2] 1, 2, 3 — Budgets : cinq tirelires, toutes leurs versions, le piano sous Enfants et loisirs, le reliquat et le déjà de côté', async () => {
      await etape(page, 'Budgets');
      const vu = await cartes(page);
      expect(vu.map((c) => c.nom)).toEqual(['Alimentation', 'Essence', 'Divers et sorties', 'Enfants et loisirs', 'Santé']);
      expect(vu.map((c) => [c.nom, c.garder, c.deja])).toEqual([
        ['Alimentation', false, '0,00'],
        ['Essence', false, '0,00'],
        ['Divers et sorties', false, '0,00'],
        ['Enfants et loisirs', true, '0,00'],
        ['Santé', false, '0,00'],
      ]);
      const alimentation = vu.find((c) => c.nom === 'Alimentation')!.besoins;
      expect(alimentation.map((b) => b.montants[0])).toEqual(['900,00', '950,00']);
      expect(espaces(alimentation[0]!.suite)).toMatch(/jusqu’au 27 oct\S* 2026/);
      expect(espaces(alimentation[1]!.suite)).toMatch(/à partir du 28 oct\S* 2026/);
      const divers = vu.find((c) => c.nom === 'Divers et sorties')!.besoins;
      expect(divers.map((b) => b.montants[0])).toEqual(['300,00', '250,00']);
      expect(divers[0]!.suite).toMatch(/clos/);
      const enfants = vu.find((c) => c.nom === 'Enfants et loisirs')!.besoins;
      expect(enfants.map((b) => [b.nom, b.montants[0]])).toEqual([
        ['', '200,00'],
        ['Cours de piano', '45,00'],
      ]);
      // La priorité ne se montre pas dans l'assistant.
      expect(await page.evaluate(() => /priorit/i.test(document.querySelector('main')?.textContent ?? ''))).toBe(false);
      expect(await raccourcis(page)).toEqual([]);
    });

    it('[niveau 2] 1, 3, 4 — Pas tous les mois : trois échéances, leur déjà de côté, et le prélèvement attendu de la seule taxe foncière', async () => {
      await etape(page, 'Pas tous les mois');
      const vu = await cartes(page);
      expect(vu.map((c) => [c.nom, c.deja, c.besoins.map((b) => b.montants)])).toEqual([
        ['Taxe foncière', '900,00', [['1200,00', '2026-10-15']]],
        ['Assurance auto', '300,00', [['600,00', '2027-03-05']]],
        ['Vacances', '400,00', [['2400,00', '2027-07-01']]],
      ]);
      const prelevement = Object.fromEntries(vu.map((c) => [c.nom, c.prelevement]));
      expect(prelevement['Taxe foncière']).toMatch(/Prélèvement attendu : « Taxe foncière \(prélèvement\) », 1 200,00 € sur Compte courant/);
      expect(prelevement['Assurance auto']).toBe('Aucun prélèvement attendu');
      expect(prelevement['Vacances']).toBe('Aucun prélèvement attendu');
    });

    it('[niveau 2] 1, 2, 3 — Épargne : l’épargne de précaution, ses deux versions et ses 3 200 € déjà de côté', async () => {
      await etape(page, 'Épargne');
      const vu = await cartes(page);
      expect(vu.map((c) => [c.nom, c.deja, c.besoins.map((b) => b.montants)])).toEqual([
        ['Épargne de précaution', '3200,00', [['300,00', '6000,00'], ['800,00', '12000,00']]],
      ]);
    });

    it('[niveau 2] 5, 6 — Résumé : chaque tirelire placée comme dans l’exemple, et l’ordre vers Livret A à côté de ce que le budget demande', async () => {
      await etape(page, 'Résumé');
      expect(await placements(page)).toEqual({
        'Taxe foncière': 'Livret A',
        'Assurance auto': 'Livret A',
        Vacances: 'Livret A',
        'Épargne de précaution': 'Livret A',
        Alimentation: 'Compte courant',
        Essence: 'Compte courant',
        'Divers et sorties': 'Compte courant',
        'Enfants et loisirs': 'Carte enfants',
        Santé: 'Compte courant',
      });
      const o = await ordres(page);
      expect(o.map((x) => [x.nom, x.montant])).toEqual([['Virement Livret A', '600,00']]);
      expect(o[0]!.texte).toMatch(/Le 28 de chaque mois, de Compte courant vers Livret A/);
      expect(o[0]!.texte).toMatch(/TIRELIRE LIVRET A/);
      expect(o[0]!.texte).toMatch(/budget demande 650,00 € par mois pour Livret A/);
    });

    it('[niveau 1] 7, 10 — validé tel quel : le Plan montre l’ordre à 600 € contre 650 € demandés, et Tirelires retrouve tout', async () => {
      expect(await cliquer(page, 'Valider mon budget')).toBe(true);
      await pause(400);
      await allerÀ(page, 'Plan');
      await pause(300);
      const livret = await carteDuPlan(page, 'Livret A');
      expect(livret, 'pas de carte « Livret A » dans le Plan').not.toBeNull();
      const ligne = (debut: string) => livret!.find(([l]) => l!.startsWith(debut))?.[1];
      expect(ligne('Virement permanent')).toBe('650,00 €');
      expect(ligne('Ordre permanent chez la banque')).toBe('600,00 €');
      // L'ordre se corrige hors de l'assistant, depuis le Plan (I11, D60).
      const corriger = await page.evaluate(() =>
        [...document.querySelectorAll('main .card')].some(
          (c) => (c.querySelector(':scope > .row .label strong')?.textContent ?? '').trim() === 'Livret A' &&
            [...c.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Corriger mon ordre'),
        ),
      );
      expect(corriger, 'pas de « Corriger mon ordre » sur la carte Livret A du Plan').toBe(true);

      await allerÀ(page, 'Plus');
      expect(await cliquer(page, 'Tirelires')).toBe(true);
      await pause(300);
      const texte = espaces(await page.evaluate(() => document.querySelector('main')?.textContent ?? ''));
      for (const nom of ['Taxe foncière', 'Assurance auto', 'Vacances', 'Épargne de précaution', 'Alimentation', 'Essence', 'Divers et sorties', 'Enfants et loisirs', 'Santé', 'Cours de piano']) {
        expect(texte, nom).toContain(nom);
      }
      // Le piano est un besoin d'« Enfants et loisirs », pas une tirelire à part (point 2, D28).
      expect(texte).toMatch(/Enfants et loisirs voulu : [^]*?Cours de piano[^]*?Ajouter un besoin Modifier Supprimer/);
      expect(texte).not.toMatch(/Cours de piano voulu :/);

      // Le prélèvement et l'ordre se retrouvent dans Flux prévus (I11) : le prélèvement s'y modifie ;
      // l'ordre, dérivé du budget, y renvoie au Plan, où il se corrige (#183, D60).
      await allerÀ(page, 'Plus');
      expect(await cliquer(page, 'Flux prévus')).toBe(true);
      await pause(300);
      const flux = await page.evaluate(() => {
        const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
        return ([...document.querySelectorAll('main .row')] as HTMLElement[])
          .filter((r) => r.querySelector('.label strong'))
          .map((r) => [t(r.querySelector('.label strong')), [...r.querySelectorAll('button')].map(t).filter((b) => b !== 'Supprimer').join(' / ')] as const);
      });
      expect(flux.filter(([n]) => n === 'Taxe foncière (prélèvement)')).toEqual([['Taxe foncière (prélèvement)', 'Modifier']]);
      expect(flux.filter(([n]) => n === 'Virement Livret A')).toEqual([['Virement Livret A', 'Voir dans le Plan']]);
    });
  });

  describe('corrigé sur place : un déjà mis de côté, un placement, le montant de l’ordre', () => {
    let page: Page;
    beforeAll(async () => {
      page = await ouvrirLAssistant(site);
    }, 60_000);
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 2] 3, 5, 6 — chaque correction s’enregistre à la validation : 500 € de côté pour Vacances, Santé sur Livret A, l’ordre à 620 €', async () => {
      await etape(page, 'Budgets');
      await etape(page, 'Pas tous les mois');
      // Le déjà mis de côté se corrige sur la carte de la tirelire (point 3).
      const deja = await page.evaluate(() => {
        const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find(
          (x) => (x.querySelector('.ligne-tirelire input.nom') as HTMLInputElement | null)?.value === 'Vacances',
        );
        const i = c?.querySelector('.deja input') as HTMLInputElement | null;
        if (!i) return false;
        i.value = '500,00';
        i.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      });
      expect(deja, 'pas de « Déjà de côté » pour Vacances').toBe(true);
      await pause(200);
      await etape(page, 'Épargne');
      await etape(page, 'Résumé');
      // La réponse à « où dort chaque tirelire » se corrige sur place (point 5), le montant de l'ordre aussi (point 6).
      const corrige = await page.evaluate(() => {
        const carte = ([...document.querySelectorAll('main .card')] as HTMLElement[]).find((c) => (c.querySelector('.label strong')?.textContent ?? '').trim() === 'Santé');
        const sel = carte?.querySelector('select') as HTMLSelectElement | null;
        const o = sel && [...sel.options].find((x) => x.textContent?.trim() === 'Livret A');
        if (!sel || !o) return 'placement';
        sel.value = o.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const mt = document.querySelector('main .card.ordre input.mt') as HTMLInputElement | null;
        if (!mt) return 'ordre';
        mt.value = '620,00';
        mt.dispatchEvent(new Event('change', { bubbles: true }));
        return '';
      });
      expect(corrige, `rien à corriger : ${corrige}`).toBe('');
      await pause(250);
      expect((await placements(page))['Santé']).toBe('Livret A');
      expect((await ordres(page)).map((x) => x.montant)).toEqual(['620,00']);

      expect(await cliquer(page, 'Valider mon budget')).toBe(true);
      await pause(400);
      await allerÀ(page, 'Plan');
      await pause(300);
      const livret = await carteDuPlan(page, 'Livret A');
      expect(livret?.find(([l]) => l!.startsWith('Ordre permanent chez la banque'))?.[1]).toBe('620,00 €');

      await allerÀ(page, 'Plus');
      expect(await cliquer(page, 'Tirelires')).toBe(true);
      await pause(300);
      const texte = espaces(await page.evaluate(() => document.querySelector('main')?.textContent ?? ''));
      expect(texte).toMatch(/Vacances voulu : le reste sur Livret A réel : 500,00 € sur Livret A/);
      expect(texte).toMatch(/Santé voulu : le reste sur Livret A/);
    });
  });

  describe('Livret A retiré à l’étape Comptes', () => {
    let page: Page;
    beforeAll(async () => {
      page = await ouvrirLAssistant(site);
      await retirer(page, 'main .ligne-compte input', 'Livret A');
    }, 60_000);
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 2] 5, 6 — les réserves arrivent sans placement, et aucun ordre n’est proposé', async () => {
      await etape(page, 'Budgets');
      await etape(page, 'Pas tous les mois');
      await etape(page, 'Épargne');
      await etape(page, 'Résumé');
      const p = await placements(page);
      expect([p['Taxe foncière'], p['Épargne de précaution'], p['Enfants et loisirs']]).toEqual(['Peu importe', 'Peu importe', 'Carte enfants']);
      expect(await ordres(page)).toEqual([]);
      expect(await raccourcis(page)).toEqual([]);
    });
  });

  describe('ordre retiré, puis réouverture sur le projet existant', () => {
    let page: Page;
    beforeAll(async () => {
      page = await ouvrirLAssistant(site);
      await etape(page, 'Budgets');
      await retirer(page, 'main .card.tirelire input.nom', 'Santé');
      await etape(page, 'Résumé');
      const fait = await page.evaluate(() => {
        const b = document.querySelector('main .card.ordre button.danger') as HTMLButtonElement | null;
        b?.click();
        return !!b;
      });
      expect(fait).toBe(true);
      await pause(250);
      await cliquer(page, 'Valider mon budget');
      await pause(400);
    }, 60_000);
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 1] 7 — retiré, aucun ordre n’est enregistré', async () => {
      await allerÀ(page, 'Plan');
      await pause(300);
      const livret = await carteDuPlan(page, 'Livret A');
      expect(livret?.some(([l]) => l!.startsWith('Ordre permanent chez la banque')) ?? false).toBe(false);
    });

    it('[niveau 2] 8 — rouvert, un raccourci apporte « Santé » avec son placement, et celui de l’ordre l’apporte tant qu’aucun flux ne porte son nom', async () => {
      await allerÀ(page, 'Plus');
      expect(await cliquer(page, 'Lancer'), 'pas de bouton « Lancer » pour ouvrir l’assistant').toBe(true);
      await pause(300);
      await etape(page, 'Budgets');
      expect(await raccourcis(page)).toEqual(['Santé']);
      expect(await cliquer(page, '+ Santé')).toBe(true);
      await pause(250);
      expect(await raccourcis(page)).toEqual([]);
      const sante = (await cartes(page)).find((c) => c.nom === 'Santé')!;
      expect([sante.garder, sante.besoins.map((b) => b.montants[0])]).toEqual([false, ['100,00']]);

      await etape(page, 'Résumé');
      expect((await placements(page))['Santé']).toBe('Compte courant');
      expect(await ordres(page)).toEqual([]);
      expect(await raccourcis(page)).toEqual(['Virement Livret A']);
      expect(await cliquer(page, '+ Virement Livret A')).toBe(true);
      await pause(250);
      expect((await ordres(page)).map((x) => [x.nom, x.montant])).toEqual([['Virement Livret A', '600,00']]);
      expect(await raccourcis(page)).toEqual([]);
    });
  });
});
