/**
 * Tests du codeur de #194 : la webapp propose de s'installer là où Chrome le permet.
 *
 * Hors du harnais du besoin (`installation.test.ts`), qui seul le valide. Chromium sans interface ne
 * montre pas la fenêtre d'installation : ces tests jouent le signal de Chrome (`beforeinstallprompt`), avec une
 * fenêtre simulée qui compte ses ouvertures et rend la réponse choisie ; l'installation réelle se
 * constate sur un téléphone et un ordinateur. Le point 5 lit, lui, ce que Chromium relève vraiment
 * sur le site construit.
 *
 * Niveau 4 (D83) : les tests du codeur servent ses propres besoins, ils ne valident pas le besoin ;
 * le harnais de l'auditeur garde les points 1 à 6 (règle du porteur, #283). Ils restent pour
 * diagnostiquer, joués nommément ou au seuil 4 : ils disent aussi la place de la proposition, au bas
 * de l'accueil, que le harnais lit autrement.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

let site: Site;

beforeAll(async () => {
  if (navigateur) site = await ouvrirLeSite();
}, 180_000);

afterAll(async () => {
  await site?.fermer();
});

interface Options {
  /** L'application s'exécute installée (`display-mode: standalone`). */
  installee?: boolean;
  /** Le navigateur refuse de garder les données (#42). */
  persistanceRefusee?: boolean;
}

/** Une page neuve sur l'accueil, application montée. */
async function ouvrir(o: Options = {}): Promise<Page> {
  const page = await nouvellePage(site);
  await page.evaluateOnNewDocument((opts: Options) => {
    if (opts.installee) {
      const vraie = window.matchMedia.bind(window);
      window.matchMedia = (q: string) => {
        if (q.includes('display-mode: standalone')) {
          return { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as MediaQueryList;
        }
        return vraie(q);
      };
    }
    if (opts.persistanceRefusee) {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: { persisted: async () => false, persist: async () => false, estimate: async () => ({}) },
      });
    }
  }, o);
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('main') && !document.body.textContent?.includes('Ouverture de la base'), { timeout: 15_000 });
  return page;
}

/** Le signal de Chrome, avec une fenêtre simulée qui répond `réponse`. */
async function chromeSaitInstaller(page: Page, réponse: 'accepted' | 'dismissed'): Promise<void> {
  await page.evaluate((r: string) => {
    const w = window as unknown as { __fenetres: number };
    w.__fenetres ??= 0;
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt?: () => Promise<void>; userChoice?: Promise<unknown> };
    e.prompt = async () => {
      w.__fenetres++;
    };
    e.userChoice = Promise.resolve({ outcome: r, platform: 'web' });
    window.dispatchEvent(e);
  }, réponse);
  await new Promise((r) => setTimeout(r, 150));
}

const fenetres = (page: Page) => page.evaluate(() => (window as unknown as { __fenetres?: number }).__fenetres ?? 0);
const texte = (page: Page) => page.evaluate(() => document.querySelector('main')?.textContent?.replace(/\s+/g, ' ') ?? '');
const PROPOSITION = 'Installer Tirelire sur cet appareil';

describe.skipIf(!navigateur)('[niveau 4] #194 · la webapp propose de s’installer sur Chrome', () => {
  it('1, 6. le signal de Chrome : proposée sur l’accueil, sous l’écran et non en tête ; accepter ouvre la fenêtre de Chrome', async () => {
    const page = await ouvrir();
    try {
      expect(await texte(page), 'sans signal de Chrome, rien n’est proposé').not.toContain(PROPOSITION);
      await chromeSaitInstaller(page, 'accepted');
      // Sous l'écran : la proposition est le dernier élément de `main`, après tout ce que l'accueil
      // montre ; les signaux du haut, eux, précèdent l'écran.
      const place = await page.evaluate((t: string) => {
        const carte = [...document.querySelectorAll('main > *')].find((c) => c.textContent?.includes(t));
        return { trouvée: !!carte, aprèsLÉcran: !!carte && document.querySelector('main')!.lastElementChild === carte };
      }, PROPOSITION);
      expect(place.trouvée, 'l’accueil ne propose pas l’installation').toBe(true);
      expect(place.aprèsLÉcran, 'la proposition s’ajoute aux signaux du haut de l’écran (#279)').toBe(true);
      expect(await cliquer(page, 'Installer')).toBe(true);
      await new Promise((r) => setTimeout(r, 150));
      expect(await fenetres(page), 'la fenêtre d’installation de Chrome ne s’est pas ouverte').toBe(1);
      expect(await texte(page), 'acceptée, la proposition reste').not.toContain(PROPOSITION);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('2. remise à plus tard : elle ne revient pas à l’ouverture suivante, et reste dans Plus', async () => {
    const page = await ouvrir();
    try {
      await chromeSaitInstaller(page, 'dismissed');
      expect(await cliquer(page, 'Plus tard')).toBe(true);
      expect(await texte(page)).not.toContain(PROPOSITION);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForFunction(() => !!document.querySelector('main') && !document.body.textContent?.includes('Ouverture de la base'), { timeout: 15_000 });
      await chromeSaitInstaller(page, 'dismissed');
      expect(await texte(page), 'écartée, la proposition revient à l’ouverture suivante').not.toContain(PROPOSITION);
      await allerÀ(page, 'Plus');
      expect(await texte(page), 'écartée, l’installation n’est plus atteignable dans Plus').toContain('Installer Tirelire');
      expect(await cliquer(page, 'Installer')).toBe(true);
      await new Promise((r) => setTimeout(r, 150));
      expect(await fenetres(page)).toBe(1);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('2. refusée dans la fenêtre de Chrome : elle ne revient pas d’elle-même', async () => {
    const page = await ouvrir();
    try {
      await chromeSaitInstaller(page, 'dismissed');
      await cliquer(page, 'Installer');
      await new Promise((r) => setTimeout(r, 150));
      await chromeSaitInstaller(page, 'dismissed');
      expect(await texte(page)).not.toContain(PROPOSITION);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('3. installée : rien n’est proposé, ni sur l’accueil ni dans Plus', async () => {
    const page = await ouvrir({ installee: true });
    try {
      await chromeSaitInstaller(page, 'accepted');
      expect(await texte(page)).not.toContain(PROPOSITION);
      await allerÀ(page, 'Plus');
      expect(await texte(page)).not.toContain('Installer Tirelire');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('3. un navigateur qui n’installe pas : rien n’est proposé, ni sur l’accueil ni dans Plus', async () => {
    const page = await ouvrir();
    try {
      await new Promise((r) => setTimeout(r, 500));
      expect(await texte(page)).not.toContain(PROPOSITION);
      await allerÀ(page, 'Plus');
      expect(await texte(page)).not.toContain('Installer Tirelire');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('4. persistance refusée : Réglages, qui conseille l’installation, la propose directement', async () => {
    const page = await ouvrir({ persistanceRefusee: true });
    try {
      await chromeSaitInstaller(page, 'accepted');
      await allerÀ(page, 'Plus');
      expect(await cliquer(page, 'Réglages')).toBe(true);
      expect(await cliquer(page, "Installer l'application"), 'Réglages ne propose pas l’installation').toBe(true);
      await new Promise((r) => setTimeout(r, 150));
      expect(await fenetres(page)).toBe(1);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('5. Chromium tient le site construit pour installable', async () => {
    // Le contexte par défaut du navigateur : un contexte neuf est privé, et Chromium n'installe pas
    // depuis une navigation privée (« in-incognito »).
    const page = await site.chrome.newPage();
    try {
      await page.goto(site.url, { waitUntil: 'networkidle0' });
      const cdp = await page.createCDPSession();
      const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: Array<{ errorId: string }> };
      expect(installabilityErrors.map((e) => e.errorId), 'Chromium relève des erreurs d’installabilité').toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);
});
