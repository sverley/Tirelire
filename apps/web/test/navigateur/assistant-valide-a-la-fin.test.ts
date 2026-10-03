/**
 * Tests du codeur de #210 — « L'assistant n'écrit dans le projet qu'à sa validation finale »,
 * dans le navigateur, sur le site construit, au téléphone.
 *
 * Chaque test dit, dans son titre, le point du « Fait quand » qu'il vérifie. Le brouillon lui-même,
 * sans navigateur, est dans `../assistant-brouillon.test.ts`.
 *
 * Ce qui prouve que « rien n'est entré dans le projet » : les écrans ordinaires (Plan, Tirelires,
 * Flux prévus), qui lisent le projet, ne montrent rien de ce que l'assistant a préparé, jusqu'au
 * résumé. Ce qui prouve que « rien ne survit à un rechargement » : une page rechargée, qui rouvre le
 * fichier enregistré, ne le montre pas non plus.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Ce que l'écran montre : titres, boutons, bouton primaire de l'assistant, texte. */
const lire = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return {
      h1: t(document.querySelector('main h1')),
      h2: t(document.querySelector('main h2')),
      primaires: ([...document.querySelectorAll('main .actions button.primary')] as HTMLButtonElement[]).map(t),
      boutons: ([...document.querySelectorAll('main button')] as HTMLButtonElement[]).map(t),
      texte: t(document.querySelector('main')),
    };
  });

/** Les noms que l'étape en cours montre dans ses champs de nom. */
const noms = (page: Page) =>
  page.evaluate(() => ([...document.querySelectorAll('main input.nom')] as HTMLInputElement[]).map((i) => i.value.trim()).filter(Boolean));

async function ouvrir(page: Page, site: Site) {
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
}

async function recharger(page: Page) {
  await pause(900); // l'application conserve son fichier peu après la dernière écriture
  await page.reload({ waitUntil: 'networkidle0' });
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

/** Du début de l'assistant à son résumé, par les boutons primaires ; rend les noms que chaque étape montrait. */
async function jusquAuResume(page: Page): Promise<Map<string, string[]>> {
  const parEtape = new Map<string, string[]>();
  for (let i = 0; i < 14; i++) {
    const e = await lire(page);
    if (e.primaires.includes('Valider mon budget')) return parEtape;
    parEtape.set(e.h2 || e.h1, await noms(page));
    if (!(await avancer(page))) break;
  }
  return parEtape;
}

/** Le texte d'un écran ordinaire, atteint par le menu Plus. */
async function ecranOrdinaire(page: Page, ecran: string): Promise<string> {
  await allerÀ(page, 'Plus');
  await cliquer(page, ecran);
  await pause(200);
  return (await lire(page)).texte;
}

async function lePlan(page: Page): Promise<string> {
  await allerÀ(page, 'Plan');
  await pause(200);
  return (await lire(page)).texte;
}

/** Retire d'un clic la rentrée qui porte ce nom, dans l'étape des rentrées. */
async function retirerLigne(page: Page, nom: string) {
  const fait = await page.evaluate((n: string) => {
    const ligne = [...document.querySelectorAll('main .ligne-flux')].find((l) => (l.querySelector('input.nom') as HTMLInputElement | null)?.value.trim() === n);
    const b = ligne?.querySelector('button.danger') as HTMLButtonElement | null;
    b?.click();
    return !!b;
  }, nom);
  expect(fait, `la rentrée « ${nom} » n’a pas de bouton pour la retirer`).toBe(true);
  await pause(250);
}

async function ouvrirLAssistant(page: Page) {
  await allerÀ(page, 'Plan');
  await cliquer(page, 'Construire mon budget');
  await pause(300);
}

describe.skipIf(!navigateur)('[niveau 4] #210 · l’assistant n’écrit dans le projet qu’à sa validation', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 300_000);

  afterAll(async () => {
    await site?.fermer();
  });

  it('[niveau 4] points 1, 3 et 5 — projet vierge : rien n’entre avant la validation, ce qui est préparé se retrouve en revenant, la validation range tout dans les écrans ordinaires', async () => {
    const page = await nouvellePage(site);
    try {
      await ouvrir(page, site);
      await ouvrirLAssistant(page);
      const parEtape = await jusquAuResume(page);

      // Point 4 : des propositions d'office sur les étapes qui en ont, un projet vierge.
      const semes = [...parEtape.values()].flat();
      expect(semes.length, 'l’assistant ne propose rien d’office dans un projet vierge').toBeGreaterThanOrEqual(3);

      // Point 3 : le résumé dit que rien n'est enregistré, et ne mène pas encore au plan.
      const resume = await lire(page);
      expect(resume.primaires).toContain('Valider mon budget');
      expect(resume.texte).toContain('Rien n’est encore enregistré');
      expect(resume.boutons).not.toContain('Voir le plan');

      // Point 1 : les écrans ordinaires lisent le projet, qui n'a rien reçu.
      const flux = await ecranOrdinaire(page, 'Flux prévus');
      const tirelires = await ecranOrdinaire(page, 'Tirelires');
      const plan = await lePlan(page);
      for (const nom of semes) {
        expect(flux, `« ${nom} » est déjà dans Flux prévus`).not.toContain(nom);
        expect(tirelires, `« ${nom} » est déjà dans Tirelires`).not.toContain(nom);
      }
      expect(plan).toContain('Bienvenue dans Tirelire');
      expect(plan).not.toContain('croisière');

      // Point 3 : l'application est restée ouverte, ce qui était préparé est retrouvé, une fois par étape.
      await ouvrirLAssistant(page);
      expect((await lire(page)).primaires, 'l’assistant ne reprend pas où il en était').toContain('Valider mon budget');
      for (let i = 0; i < 12 && !(await lire(page)).h2.startsWith('Qu’est-ce qui rentre') && !(await lire(page)).h2.startsWith("Qu'est-ce qui rentre"); i++) {
        await cliquer(page, 'Précédent');
        await pause(200);
      }
      expect(await noms(page), 'les rentrées préparées ne sont pas retrouvées telles quelles').toEqual(
        parEtape.get((await lire(page)).h2),
      );

      // Point 2 : une seule validation, qui écrit tout.
      for (let i = 0; i < 12 && !(await lire(page)).primaires.includes('Valider mon budget'); i++) await avancer(page);
      expect(await cliquer(page, 'Valider mon budget')).toBe(true);
      await pause(400);
      const apres = await lire(page);
      expect(apres.boutons).toContain('Voir le plan');
      expect(apres.texte).not.toContain('Rien n’est encore enregistré');

      // Point 5 : chaque ligne se retrouve dans son écran ordinaire ; le plan dote des tirelires.
      const fluxApres = await ecranOrdinaire(page, 'Flux prévus');
      for (const nom of parEtape.get([...parEtape.keys()].find((h) => h.startsWith('Qu’est-ce qui rentre') || h.startsWith("Qu'est-ce qui rentre"))!) ?? []) {
        expect(fluxApres, `« ${nom} » introuvable dans Flux prévus après la validation`).toContain(nom);
      }
      expect(await lePlan(page)).toContain('croisière');

      // Ce qui est validé survit à un rechargement.
      await recharger(page);
      expect(await lePlan(page)).toContain('croisière');
    } finally {
      await page.close();
    }
  }, 180_000);

  it('[niveau 4] point 3 — quitter sans valider n’enregistre rien : après un rechargement, le projet est vierge et l’assistant repart du début', async () => {
    const page = await nouvellePage(site);
    try {
      await ouvrir(page, site);
      await ouvrirLAssistant(page);
      const parEtape = await jusquAuResume(page);
      expect([...parEtape.values()].flat().length).toBeGreaterThanOrEqual(3);
      expect((await lire(page)).primaires).toContain('Valider mon budget');

      await recharger(page);

      const plan = await lePlan(page);
      expect(plan).toContain('Bienvenue dans Tirelire');
      expect(plan).not.toContain('croisière');
      const flux = await ecranOrdinaire(page, 'Flux prévus');
      for (const nom of [...parEtape.values()].flat()) expect(flux, `« ${nom} » a survécu au rechargement`).not.toContain(nom);
      await ouvrirLAssistant(page);
      const debut = await lire(page);
      expect(debut.h1).toBe('Construire mon budget');
      expect(debut.primaires.some((p) => p.includes('Commencer'))).toBe(true);
    } finally {
      await page.close();
    }
  }, 180_000);

  it('[niveau 4] point 4 — projet vierge : les propositions viennent une fois par étape ; une ligne retirée ne revient pas en repassant par l’étape', async () => {
    const page = await nouvellePage(site);
    try {
      await ouvrir(page, site);
      await ouvrirLAssistant(page);
      for (let i = 0; i < 12 && !(await lire(page)).h2.match(/Qu.est-ce qui rentre/); i++) await avancer(page);
      const avant = await noms(page);
      expect(avant.length, 'l’étape des rentrées ne propose rien d’office').toBeGreaterThanOrEqual(2);

      await page.evaluate(() => (document.querySelector('main .ligne-flux button.danger') as HTMLButtonElement | null)?.click());
      await pause(250);
      const apresRetrait = await noms(page);
      expect(apresRetrait).toHaveLength(avant.length - 1);

      await cliquer(page, 'Suivant');
      await pause(250);
      await cliquer(page, 'Précédent');
      await pause(250);
      expect(await noms(page), 'les propositions sont revenues en repassant par l’étape').toEqual(apresRetrait);
    } finally {
      await page.close();
    }
  }, 180_000);

  it('[niveau 4] points 1, 3 et 4 — projet existant : l’assistant part du contenu, un retrait n’entre dans le projet qu’à la validation', async () => {
    const page = await ouvrirLExemple(site);
    try {
      await allerÀ(page, 'Plus');
      expect(await cliquer(page, 'Lancer')).toBe(true);
      await pause(300);
      for (let i = 0; i < 12 && !(await lire(page)).h2.match(/Qu.est-ce qui rentre/); i++) await avancer(page);
      const avant = await noms(page);
      expect(avant.length, 'l’assistant ne part pas du contenu du projet').toBeGreaterThanOrEqual(1);
      // Une rentrée qui n'a pas de sosie : son retrait se lit sur son nom.
      const retire = avant.find((n) => avant.filter((x) => x === n).length === 1)!;
      expect(retire, 'toutes les rentrées de l’exemple ont un homonyme').toBeTruthy();
      expect(await ecranOrdinaire(page, 'Flux prévus')).toContain(retire);

      // On revient dans l'assistant (Configuration, Lancer), on retire la première rentrée.
      await allerÀ(page, 'Plus');
      await cliquer(page, 'Lancer');
      await pause(300);
      for (let i = 0; i < 12 && !(await lire(page)).h2.match(/Qu.est-ce qui rentre/); i++) await avancer(page);
      await retirerLigne(page, retire);
      expect(await noms(page)).not.toContain(retire);

      // Le projet n'a rien reçu : l'écran ordinaire montre encore la rentrée.
      expect(await ecranOrdinaire(page, 'Flux prévus'), 'le retrait est entré dans le projet avant la validation').toContain(retire);

      // L'assistant retrouvé, le retrait est toujours préparé ; on valide.
      await allerÀ(page, 'Plus');
      await cliquer(page, 'Lancer');
      await pause(300);
      expect(await noms(page)).not.toContain(retire);
      for (let i = 0; i < 12 && !(await lire(page)).primaires.includes('Valider mon budget'); i++) await avancer(page);
      expect(await cliquer(page, 'Valider mon budget')).toBe(true);
      await pause(400);

      expect(await ecranOrdinaire(page, 'Flux prévus'), 'le retrait n’est pas entré dans le projet à la validation').not.toContain(retire);
    } finally {
      await page.close();
    }
  }, 240_000);
});
