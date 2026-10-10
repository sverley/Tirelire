/**
 * Harnais d'audit de #296, côté écran — ce qui n'existe que dans un navigateur (D83, « Le navigateur au minimum ») :
 * le plan d'une période à venir, son détail déplié, ne déborde pas à 375 px (C9). Test du codeur, repris tel quel
 * (`solde-prevu.test.ts`, qui n'existe plus) ; niveau 1 (D83).
 *
 * Le reste de ce que le Plan montre du solde prévu — aucun solde prévu dans la période où l'on lit, celui de chaque
 * compte et de chaque tirelire en octobre, un manque avec sa date et son montant, les opérations repliées par défaut et
 * lues sur demande avec leur origine (points 1, 3, 4 et 6) —, depuis #419, se vérifie sans navigateur :
 * `../plan-solde-prevu-ecran.test.ts` ; le calcul : `packages/core/test/plan-solde-prevu.test.ts`.
 *
 * L'exemple chargé par « Charger l'exemple » se lit au 6 septembre 2026 ; octobre 2026 est la première période à
 * venir. Le test part de l'état où le laissaient les tests que #419 retire : octobre ouvert, le détail de la tirelire
 * « Taxe foncière » déplié.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const OCTOBRE = 'octobre 2026';

/** Clique le bouton « Détail » qui suit la ligne `nom` du bloc. */
async function déplier(page: Page, nom: string): Promise<boolean> {
  const fait = await page.evaluate((n: string) => {
    const h2 = [...document.querySelectorAll('main h2')].find((h) => /^Soldes prévus/.test(h.textContent?.trim() ?? ''));
    let el = h2?.nextElementSibling ?? null;
    for (; el; el = el.nextElementSibling) {
      for (const r of el.querySelectorAll(':scope > .row')) {
        if ((r.querySelector('.label')?.firstChild?.textContent ?? '').trim() !== n) continue;
        const b = r.nextElementSibling?.querySelector('button');
        if (!b) return false;
        (b as HTMLButtonElement).click();
        return true;
      }
    }
    return false;
  }, nom);
  await pause(150);
  return fait;
}

describe.skipIf(!navigateur)('#296 · le solde prévu à l’écran Plan, à 375 px', () => {
  let site: Site;
  let page: Page;

  beforeAll(async () => {
    site = await ouvrirLeSite();
    page = await ouvrirLExemple(site);
    // L'état où le laissaient les tests que #419 retire : octobre ouvert, le détail de la taxe foncière déplié.
    expect(await cliquer(page, OCTOBRE)).toBe(true);
    await pause(200);
    expect(await déplier(page, 'Taxe foncière')).toBe(true);
  }, 120_000);
  afterAll(async () => {
    await page?.close().catch(() => {});
    await site?.fermer();
  });

  it('[niveau 1] déplié, l’écran ne déborde pas à 375 px', async () => {
    expect(await déplier(page, 'Compte courant')).toBe(true);
    // `clientWidth`, la largeur de mise en page (375) : en émulation mobile, `window.innerWidth` s'élargit
    // avec le contenu qui déborde, et le test ne pourrait jamais rougir (comme `mise-en-page.test.ts`).
    const largeurs = await page.evaluate(() => ({ contenu: document.documentElement.scrollWidth, écran: document.documentElement.clientWidth }));
    expect(largeurs.écran).toBe(375);
    expect(largeurs.contenu, `défilement horizontal : le contenu fait ${largeurs.contenu} px pour un écran de ${largeurs.écran} px`).toBeLessThanOrEqual(largeurs.écran);
  });
});
