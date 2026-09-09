/**
 * Garde du filtre d'état des écrans de cartes (D55).
 *
 * Ce que le test tient : après « Charger l'exemple », les écrans Tirelires et Comptes offrent le
 * filtre, et chaque choix garde ce qu'il annonce. Sans cette garde, la fonction se perdrait au
 * premier remaniement de l'exemple — un jeu de données sans rien de clos ni d'à venir fait
 * disparaître la barre sans qu'aucun test ne s'en aperçoive.
 *
 * Même harnais que `mise-en-page.test.ts` : le site construit, prévisualisé, ouvert dans un Chrome
 * déjà installé. Sans navigateur il s'abstient, sauf si `TIRELIRE_NAV_STRICT` est posé.
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
  throw new Error("Aucun Chrome ni Chromium trouvé pour les tests d'interface : indiquer son chemin dans TIRELIRE_NAV.");
}
if (!navigateur) console.warn('Aucun navigateur trouvé : garde du filtre d’état non jouée.');

/** Noms des cartes affichées, et pastilles d'état visibles. Exécuté dans le navigateur. */
function lire() {
  const texte = (el: Element | null | undefined) => (el?.textContent ?? '').trim();
  return {
    cartes: [...document.querySelectorAll('.card > .row > .label > strong')].map((e) => texte(e)),
    filtres: [...document.querySelectorAll('.filtre')].map((b) => texte(b).replace(/\s+/g, ' ')),
    filtreActif: texte(document.querySelector('.filtre.actif')).replace(/\s+/g, ' '),
    pastilles: [...document.querySelectorAll('.pill.dim')].map((p) => texte(p)),
  };
}

describe.skipIf(!navigateur)('filtre d’état des écrans de cartes', () => {
  let serveur: PreviewServer;
  let url: string;
  let chrome: Browser;

  beforeAll(async () => {
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

  /** Clique le premier élément dont le texte contient celui-ci. */
  async function cliquer(page: Page, sélecteur: string, texte: string): Promise<void> {
    const trouvé = await page.evaluate(
      (s, t) => {
        const el = [...document.querySelectorAll(s)].find((x) => (x.textContent ?? '').includes(t));
        if (!el) return false;
        (el as HTMLElement).click();
        return true;
      },
      sélecteur,
      texte,
    );
    expect(trouvé, `rien à cliquer : ${sélecteur} contenant « ${texte} »`).toBe(true);
  }

  /** Ouvre l'exemple sur un écran de Configuration, à la largeur d'un téléphone. */
  async function ouvrir(écran: string): Promise<Page> {
    const page = await chrome.newPage();
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.body.textContent?.includes('Ouverture de la base'));
    await cliquer(page, 'button', "Charger l'exemple");
    await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Tirelires'));
    await cliquer(page, '.tabbar button', 'Plus');
    await cliquer(page, '.card .row', écran);
    await page.waitForFunction((t) => document.querySelector('h1')?.textContent === t, {}, écran);
    return page;
  }

  it('l’écran Tirelires isole les besoins clos, et les cache quand on demande le courant', async () => {
    const page = await ouvrir('Tirelires');

    const tout = await page.evaluate(lire);
    expect(tout.filtres.some((f) => f.startsWith('Tout')), 'la barre de filtre manque').toBe(true);
    expect(tout.filtreActif.startsWith('Tout'), 'le filtre ne part pas de « Tout »').toBe(true);
    // L'exemple porte un budget révisé (D51) : « Divers et sorties » a un besoin clos.
    expect(tout.cartes).toContain('Divers et sorties');
    expect(tout.cartes).toContain('Taxe foncière');
    expect(tout.pastilles).toContain('clos');

    await cliquer(page, '.filtre', 'Clos');
    const clos = await page.evaluate(lire);
    expect(clos.cartes, 'la tirelire au besoin clos doit rester').toContain('Divers et sorties');
    expect(clos.cartes, 'une tirelire sans rien de clos n’a rien à faire ici').not.toContain('Taxe foncière');
    expect(clos.pastilles.every((p) => p === 'clos'), 'seul le clos doit rester').toBe(true);

    await cliquer(page, '.filtre', 'En cours');
    const courant = await page.evaluate(lire);
    expect(courant.cartes).toContain('Taxe foncière');
    expect(courant.pastilles, 'aucun besoin clos ni à venir dans le courant').toEqual([]);

    await page.close();
  });

  it('l’écran Comptes isole le compte clos', async () => {
    const page = await ouvrir('Comptes');

    const tout = await page.evaluate(lire);
    expect(tout.cartes).toContain('Livret jeune');
    expect(tout.cartes).toContain('Compte courant');

    await cliquer(page, '.filtre', 'Clos');
    const clos = await page.evaluate(lire);
    expect(clos.cartes).toEqual(['Livret jeune']);

    await cliquer(page, '.filtre', 'En cours');
    const courant = await page.evaluate(lire);
    expect(courant.cartes).toContain('Compte courant');
    expect(courant.cartes, 'un compte clos ne se lit pas comme un compte ouvert').not.toContain('Livret jeune');

    await page.close();
  });

  it('l’écran Flux prévus isole ce qui n’a pas encore commencé', async () => {
    const page = await ouvrir('Flux prévus');

    const tout = await page.evaluate(lire);
    expect(tout.filtres.some((f) => f.startsWith('À venir')), 'le choix « À venir » manque').toBe(true);
    // L'exemple porte un salaire revalorisé à la paie de novembre (D51) : son successeur est à venir.
    expect(tout.pastilles).toContain('à venir');

    await cliquer(page, '.filtre', 'À venir');
    const àVenir = await page.evaluate(lire);
    expect(àVenir.pastilles.length, 'le filtre a tout vidé').toBeGreaterThan(0);
    expect(àVenir.pastilles.every((p) => p === 'à venir'), 'seul ce qui est à venir doit rester').toBe(true);

    await page.close();
  });
});
