/**
 * Garde du filtre d'état des écrans de cartes (D55).
 *
 * Ce que le test tient : après « Charger l'exemple », les trois écrans de cartes offrent leurs
 * interrupteurs d'état, ce qui est clos part rangé, et chaque interrupteur montre ou masque ce
 * qu'il annonce. Sans cette garde, la fonction se perdrait au premier remaniement de l'exemple —
 * un jeu de données sans rien de clos ni d'à venir fait disparaître la barre sans qu'aucun test ne
 * s'en aperçoive.
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
    allumés: [...document.querySelectorAll('.filtre.actif')].map((b) => texte(b).replace(/\s+/g, ' ')),
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

  it('l’écran Tirelires part sans les besoins clos, et les rend au premier clic', async () => {
    const page = await ouvrir('Tirelires');

    const départ = await page.evaluate(lire);
    expect(départ.filtres.some((f) => f.startsWith('Clos')), 'l’interrupteur « Clos » manque').toBe(true);
    expect(départ.allumés.some((f) => f.startsWith('En cours')), '« En cours » doit partir allumé').toBe(true);
    expect(départ.allumés.some((f) => f.startsWith('À venir')), '« À venir » doit partir allumé').toBe(true);
    expect(départ.allumés.some((f) => f.startsWith('Clos')), '« Clos » doit partir éteint').toBe(false);
    // L'exemple porte un budget révisé (D51) : « Divers et sorties » a un besoin clos, rangé au
    // départ, et un besoin en vigueur, qui garde la carte à l'écran.
    expect(départ.cartes).toContain('Divers et sorties');
    expect(départ.pastilles, 'rien de clos ne doit s’afficher au départ').not.toContain('clos');
    expect(départ.pastilles, 'ce qui vient reste lisible').toContain('à venir');

    await cliquer(page, '.filtre', 'Clos');
    const avecClos = await page.evaluate(lire);
    expect(avecClos.pastilles, 'allumer « Clos » doit rendre le besoin clos').toContain('clos');
    expect(avecClos.pastilles, 'les autres interrupteurs ne bougent pas').toContain('à venir');

    // Éteindre le courant ne garde que les cartes qui portent du clos ou de l'à venir.
    await cliquer(page, '.filtre', 'En cours');
    await cliquer(page, '.filtre', 'À venir');
    const closSeul = await page.evaluate(lire);
    expect(closSeul.cartes).toContain('Divers et sorties');
    expect(closSeul.cartes, 'une tirelire sans rien de clos n’a rien à faire ici').not.toContain('Taxe foncière');
    expect(closSeul.pastilles.every((p) => p === 'clos'), 'seul le clos doit rester').toBe(true);

    await page.close();
  });

  it('l’écran Comptes range le compte clos, et le rend au premier clic', async () => {
    const page = await ouvrir('Comptes');

    const départ = await page.evaluate(lire);
    expect(départ.cartes).toContain('Compte courant');
    expect(départ.cartes, 'un compte clos ne se lit pas comme un compte ouvert').not.toContain('Livret jeune');
    expect(départ.filtres.some((f) => f.startsWith('Clos')), 'ce qui est masqué doit rester visible dans la barre').toBe(true);

    await cliquer(page, '.filtre', 'Clos');
    const avecClos = await page.evaluate(lire);
    expect(avecClos.cartes).toContain('Livret jeune');
    expect(avecClos.cartes).toContain('Compte courant');

    await cliquer(page, '.filtre', 'En cours');
    const closSeul = await page.evaluate(lire);
    expect(closSeul.cartes).toEqual(['Livret jeune']);

    await page.close();
  });

  it('l’écran Flux prévus masque ce qui n’a pas encore commencé quand on l’éteint', async () => {
    const page = await ouvrir('Flux prévus');

    const départ = await page.evaluate(lire);
    expect(départ.filtres.some((f) => f.startsWith('À venir')), 'l’interrupteur « À venir » manque').toBe(true);
    // L'exemple porte un salaire revalorisé à la paie de novembre (D51) : son successeur est à venir.
    expect(départ.pastilles).toContain('à venir');

    await cliquer(page, '.filtre', 'À venir');
    const sansÀVenir = await page.evaluate(lire);
    expect(sansÀVenir.pastilles, 'éteindre « À venir » doit ranger le successeur').not.toContain('à venir');
    expect(sansÀVenir.cartes.length, 'les flux en vigueur restent').toBeGreaterThan(0);

    await page.close();
  });
});
