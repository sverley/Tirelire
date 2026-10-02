/**
 * #320 · Le Bilan lit le budget : prévu, financé, non financé (D57 : le budget d'abord).
 *
 * Test du codeur, de niveau 4 : le parcours U1 de bout en bout, de l'assistant mené à ses valeurs par
 * défaut au Bilan. Ses autres tests — l'exemple, la base vide — sont déplacés et complétés dans le
 * harnais de l'auditeur (`bilan-budget-harnais.test.ts`), qui fabrique aussi les états que son exemple
 * ne montrait pas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/** Ce que montre le Bilan : titres, cartes de période, boutons, case « revenus », largeur. */
const lireLeBilan = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main');
    return {
      h1: t(main?.querySelector('h1')),
      titres: [...(main?.querySelectorAll('h2') ?? [])].map(t),
      periodes: [...(main?.querySelectorAll('[data-periode]') ?? [])].map(t),
      boutons: [...(main?.querySelectorAll('button') ?? [])].map(t),
      caseRevenus: [...(main?.querySelectorAll('label') ?? [])].some((l) => t(l) === 'revenus' && !!l.querySelector('input[type=checkbox]')),
      texte: t(main),
      deborde: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

async function allerAuBilan(page: Page) {
  await allerÀ(page, 'Bilan');
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent?.trim() === 'Bilan');
  await pause();
}

describe.skipIf(!navigateur)('[niveau 4] #320 · le Bilan à l’écran', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  });
  afterAll(async () => {
    await site?.fermer();
  });

  it('[niveau 4] points 1 et 6 — U1 : l’assistant mené à ses valeurs par défaut, sans opération, le Bilan lit le budget et dit ce que des opérations y ajouteront', async () => {
    const page = await nouvellePage(site);
    try {
      await page.goto(site.url, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent?.includes('Construire mon budget')));
      expect(await cliquer(page, 'Construire mon budget')).toBe(true);
      for (let i = 0; i < 15; i++) {
        const suivant = await page.evaluate(() => {
          const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
          const boutons = [...document.querySelectorAll('main button')] as HTMLButtonElement[];
          const fin = boutons.find((x) => t(x) === 'Voir le plan');
          const b = fin ?? boutons.find((x) => x.classList.contains('primary') && /Suivant|Commencer/.test(t(x)));
          b?.click();
          return fin ? 'fin' : b ? 'suite' : 'rien';
        });
        await pause();
        if (suivant !== 'suite') break;
      }
      await allerAuBilan(page);
      const b = await lireLeBilan(page);
      expect(b.titres).toContain('Le budget, période par période');
      expect(b.periodes).toHaveLength(6);
      expect(b.titres).toContain('Ce qui a été dépensé');
      expect(b.texte).toContain('Avec des opérations, importées ou saisies, le Bilan ajoutera ici ce qui a été dépensé');
      expect(b.caseRevenus).toBe(false);
      expect(b.texte).not.toMatch(/moy\.|en moyenne/);
      expect(b.deborde).toBe(false);
    } finally {
      await page.close();
    }
  });
});
