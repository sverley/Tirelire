/**
 * Plomberie commune aux tests d'interface : trouver un navigateur, construire et servir le site,
 * ouvrir l'application sur le jeu d'exemple.
 *
 * Il faut un Chrome ou un Chromium déjà installé : `TIRELIRE_NAV` (ou `CHROME_BIN`, `CHROME_PATH`,
 * `PUPPETEER_EXECUTABLE_PATH`), sinon les emplacements habituels. Sans navigateur les gardes
 * s'abstiennent, sauf si `TIRELIRE_STRICT` (ou l'ancien `TIRELIRE_NAV_STRICT`) est posé — ce que fait
 * l'intégration continue, pour qu'une garde muette ne passe pas pour une garde verte (#59).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build, preview, type PreviewServer } from 'vite';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

export const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

export const navigateur = EMPLACEMENTS.find((c): c is string => !!c && existsSync(c));

if (!navigateur && (process.env.TIRELIRE_STRICT || process.env.TIRELIRE_NAV_STRICT)) {
  throw new Error(
    "Aucun Chrome ni Chromium trouvé pour les tests d'interface. Installer un navigateur ou " +
      'indiquer son chemin dans TIRELIRE_NAV.',
  );
}
if (!navigateur) console.warn("Aucun navigateur trouvé : gardes d'interface non jouées.");

export interface Site {
  url: string;
  chrome: Browser;
  fermer(): Promise<void>;
}

/**
 * Construit le site et le sert, puis lance le navigateur.
 *
 * C'est le site construit qui est mesuré, et non celui du serveur de développement : le fichier
 * réellement livré est le seul dont le rendu engage quelque chose.
 */
export async function ouvrirLeSite(): Promise<Site> {
  await build({ root: RACINE, logLevel: 'error' });
  const serveur: PreviewServer = await preview({ root: RACINE, preview: { port: 0 }, logLevel: 'error' });
  const url = serveur.resolvedUrls?.local[0] ?? `http://localhost:${serveur.config.preview.port}/`;
  const chrome = await puppeteer.launch({
    executablePath: navigateur!,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  return {
    url,
    chrome,
    async fermer() {
      await chrome.close();
      await serveur.close();
    },
  };
}

/** Ouvre l'application à la taille demandée et charge l'exemple, plan garni. */
export async function ouvrirLExemple(site: Site, largeur = 375, hauteur = 812): Promise<Page> {
  const page = await site.chrome.newPage();
  await page.setViewport({ width: largeur, height: hauteur, isMobile: true, hasTouch: true });
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.body.textContent?.includes('Ouverture de la base'));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes("Charger l'exemple"));
    b?.click();
  });
  // L'exemple porte des besoins : le titre « Tirelires » signe un plan effectivement calculé.
  await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Tirelires'));
  return page;
}

/** Va sur un onglet de la barre du bas, par son libellé. */
export async function allerÀ(page: Page, onglet: string): Promise<void> {
  await page.evaluate((libellé: string) => {
    const b = [...document.querySelectorAll('.tabbar button')].find((x) => x.textContent?.includes(libellé));
    (b as HTMLButtonElement | undefined)?.click();
  }, onglet);
  await new Promise((r) => setTimeout(r, 150));
}

/** Clique le premier bouton dont le texte contient `texte`, et laisse le rendu se faire. */
export async function cliquer(page: Page, texte: string): Promise<boolean> {
  const trouvé = await page.evaluate((t: string) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim().includes(t));
    if (!b) return false;
    (b as HTMLButtonElement).click();
    return true;
  }, texte);
  if (trouvé) await new Promise((r) => setTimeout(r, 150));
  return trouvé;
}
