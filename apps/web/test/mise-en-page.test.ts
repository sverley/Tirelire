/**
 * Garde de mise en page mobile.
 *
 * Le défaut corrigé le 8 septembre 2026 : `.num` interdisait le retour à la ligne, si bien que la
 * ligne « retenu … · croisière … · demandé … » d'une tirelire formait une boîte insécable plus
 * large que l'écran. Le document débordait (scrollWidth 462 pour un clientWidth de 375), la barre
 * d'onglets prenait cette largeur et son cinquième onglet sortait de l'écran.
 *
 * Ce test charge l'exemple dans un vrai navigateur et vérifie, à 320 et 375 px, que le document ne
 * défile pas latéralement et qu'aucun libellé ne recouvre le montant de sa ligne.
 *
 * Il lui faut un Chrome ou un Chromium déjà installé : `TIRELIRE_NAV` (ou `CHROME_BIN`,
 * `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`), sinon les emplacements habituels. Sans navigateur il
 * s'abstient, sauf si `TIRELIRE_NAV_STRICT` est posé — ce que fait l'intégration continue, pour
 * qu'une garde muette ne passe pas pour une garde verte.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, preview, type PreviewServer } from 'vite';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const EMPLACEMENTS = [
  process.env.TIRELIRE_NAV,
  process.env.CHROME_BIN,
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const navigateur = EMPLACEMENTS.find((c): c is string => !!c && existsSync(c));

if (!navigateur && process.env.TIRELIRE_NAV_STRICT) {
  throw new Error(
    "Aucun Chrome ni Chromium trouvé pour les tests d'interface. Installer un navigateur ou " +
      'indiquer son chemin dans TIRELIRE_NAV.',
  );
}
if (!navigateur) console.warn("Aucun navigateur trouvé : garde de mise en page mobile non jouée.");

/** Ce que le test mesure dans la page, exécuté dans le navigateur. */
function mesurer() {
  const de = document.documentElement;
  /** Bord droit de l'encre d'un élément, et non de sa boîte : c'est le texte qui déborde. */
  const encre = (el: Element) => {
    const plage = document.createRange();
    plage.selectNodeContents(el);
    const bords = [...plage.getClientRects()].map((r) => r.right);
    return bords.length ? Math.max(...bords) : el.getBoundingClientRect().left;
  };
  const chevauchements: string[] = [];
  for (const ligne of document.querySelectorAll('.row')) {
    const libellé = ligne.querySelector(':scope > .label');
    if (!libellé) continue;
    const droite = encre(libellé);
    for (const voisin of [...ligne.children].filter((c) => c !== libellé)) {
      const gauche = voisin.getBoundingClientRect().left;
      // Une demi-pixel de marge : les arrondis de rendu ne sont pas un chevauchement.
      if (droite > gauche + 0.5) {
        chevauchements.push(`« ${(libellé.textContent ?? '').trim().slice(0, 40)} » ${Math.round(droite)} > ${Math.round(gauche)}`);
      }
    }
  }
  const barre = document.querySelector('.tabbar');
  const onglets = barre ? [...barre.querySelectorAll('button')] : [];
  return {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    chevauchements,
    // Chaque onglet doit être entièrement dans la fenêtre : sinon « Plus » est hors d'atteinte.
    ongletsHorsÉcran: onglets
      .filter((b) => b.getBoundingClientRect().right > de.clientWidth + 0.5)
      .map((b) => b.getAttribute('aria-label') ?? '?'),
  };
}

describe.skipIf(!navigateur)('mise en page mobile de l’écran Plan', () => {
  let serveur: PreviewServer;
  let url: string;
  let chrome: Browser;

  beforeAll(async () => {
    // Le site est construit puis prévisualisé, et non servi par le serveur de développement :
    // c'est le fichier réellement livré que la garde doit mesurer.
    await build({ root: RACINE, logLevel: 'error' });
    serveur = await preview({ root: RACINE, preview: { port: 0 }, logLevel: 'error' });
    url = serveur.resolvedUrls?.local[0] ?? `http://localhost:${serveur.config.preview.port}/`;
    chrome = await puppeteer.launch({
      executablePath: navigateur!,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  });

  afterAll(async () => {
    await chrome?.close();
    await serveur?.close();
  });

  /** Ouvre l'application à la largeur demandée, charge l'exemple et attend que le plan soit garni. */
  async function ouvrirLePlan(largeur: number): Promise<Page> {
    const page = await chrome.newPage();
    await page.setViewport({ width: largeur, height: 812, isMobile: true, hasTouch: true });
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.body.textContent?.includes('Ouverture de la base'));
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes("Charger l'exemple"));
      b?.click();
    });
    // L'exemple porte des besoins : le titre « Tirelires » signe un plan effectivement calculé.
    await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Tirelires'));
    return page;
  }

  for (const largeur of [320, 375]) {
    it(`ne déborde pas et ne se chevauche pas à ${largeur} px`, async () => {
      const page = await ouvrirLePlan(largeur);
      const r = await page.evaluate(mesurer);
      await page.close();

      expect(r.clientWidth).toBe(largeur);
      expect(r.scrollWidth, `défilement horizontal à ${largeur} px`).toBeLessThanOrEqual(r.clientWidth);
      expect(r.chevauchements, 'un libellé recouvre le montant de sa ligne').toEqual([]);
      expect(r.ongletsHorsÉcran, 'un onglet de la barre du bas sort de la fenêtre').toEqual([]);
    });
  }
});
