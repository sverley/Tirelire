/**
 * Harnais d'audit de #395 — composé des tests du codeur : la carte de l'ordre « Virement Livret A » de l'exemple, que
 * l'assistant propose au résumé, lue à 375 px (point 3). Il ne garde que ce qui n'existe que dans un navigateur : une
 * mesure de mise en page à une largeur d'écran (D83, « Le navigateur au minimum » ; C9 ; #418).
 *
 * Les autres points de #395 se vérifient sans navigateur : ce que l'assistant enregistre avant et après la validation, ce
 * que le Plan en signale, et la carte quand une tirelire est retirée ou le montant corrigé (points 4 à 7), sur
 * l'application montée sous jsdom, `apps/web/test/ordre-ventile-assistant-ecran.test.ts` ; le calcul sur l'exemple, au
 * cœur, `packages/core/test/ordre-ventile-exemple-harnais.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

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

async function etape(page: Page, libelle: string) {
  const fait = await page.evaluate((l: string) => {
    const b = ([...document.querySelectorAll('.wizard-steps .wstep')] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').trim() === l);
    b?.click();
    return !!b;
  }, libelle);
  expect(fait, `pas d’étape « ${libelle} »`).toBe(true);
  await pause(250);
}

/**
 * Les parts que montre la carte de l'ordre, par la ventilation commune au Plan (#394) : le nom de sa
 * tirelire, sa forme (« part fixe », « le reste ») et son montant ; la ligne du non affecté n'est pas une part.
 */
const parts = (page: Page) =>
  page.evaluate(() => {
    const t = (s?: string | null) => (s ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim();
    return ([...document.querySelectorAll('main .card.ordre .ventilation .row.part:not(.non-affecte)')] as HTMLElement[]).map((r) => {
      const label = r.querySelector('.label');
      return [t(label?.firstChild?.textContent), t(label?.querySelector('.sub')?.textContent), t(r.querySelector('.num')?.textContent)];
    });
  });

describe.skipIf(!navigateur)('#395 — l’assistant propose l’ordre de l’exemple avec sa ventilation', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);
  afterAll(async () => {
    await site?.fermer();
  });

  describe('parcouru sans rien modifier', () => {
    let page: Page;
    beforeAll(async () => {
      page = await ouvrirLAssistant(site);
      // Les tirelires se proposent à la visite de leurs étapes ; l'ordre, au résumé.
      for (const e of ['Budgets', 'Pas tous les mois', 'Épargne', 'Résumé']) await etape(page, e);
    }, 60_000);
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 1] point 3 : la carte de l’ordre dit chaque part, la variable comme le reste, lisible à 375 px', async () => {
      expect(await parts(page)).toEqual([
        ['Taxe foncière', 'part fixe', '100,00 €'],
        ['Assurance auto', 'part fixe', '50,00 €'],
        ['Vacances', 'part fixe', '150,00 €'],
        ['Épargne de précaution', 'le reste', '300,00 €'],
      ]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
});
