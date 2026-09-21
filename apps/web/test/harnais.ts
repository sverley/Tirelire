/**
 * Plomberie commune aux tests d'interface : trouver un navigateur, construire et servir le site,
 * ouvrir l'application sur le jeu d'exemple.
 *
 * Il faut un Chrome ou un Chromium déjà installé : `TIRELIRE_NAV` (ou `CHROME_BIN`, `CHROME_PATH`,
 * `PUPPETEER_EXECUTABLE_PATH`), sinon les emplacements habituels. Sans navigateur les gardes
 * s'abstiennent, sauf si `TIRELIRE_STRICT` (ou l'ancien `TIRELIRE_NAV_STRICT`) est posé — ce que fait
 * l'intégration continue, pour qu'une garde muette ne passe pas pour une garde verte (#59).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
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
 *
 * Chaque appel construit dans son propre dossier temporaire, jamais dans `dist` : vitest joue les
 * fichiers de test en parallèle, et une construction qui vide un dossier commun pendant qu'un autre
 * fichier le sert laisse une application qui ne monte pas (#149).
 */
export async function ouvrirLeSite(): Promise<Site> {
  const sortie = mkdtempSync(join(tmpdir(), 'tirelire-site-'));
  try {
    await build({ root: RACINE, logLevel: 'error', build: { outDir: sortie, emptyOutDir: true } });
    const serveur: PreviewServer = await preview({
      root: RACINE,
      build: { outDir: sortie },
      preview: { port: 0 },
      logLevel: 'error',
    });
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
        rmSync(sortie, { recursive: true, force: true });
      },
    };
  } catch (err) {
    rmSync(sortie, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Le jour où tournent les pages : un jour fixe, pour que le verdict ne dépende pas de la date réelle
 * (#149). C'est un jour quelconque après l'exemple (daté du 6 septembre 2026) et dans sa période
 * (28 août – 27 septembre) : comme chez tout utilisateur qui charge l'exemple, l'écran lit au
 * 6 septembre, pas « aujourd'hui ». Midi, heure de Paris : loin de tout changement de jour.
 */
export const JOUR_DES_TESTS = '2026-09-20T12:00:00+02:00';
const FUSEAU_DES_TESTS = 'Europe/Paris';

/**
 * Une page neuve, dans son propre contexte de navigation, à la taille demandée, l'horloge réglée
 * sur `JOUR_DES_TESTS`.
 *
 * Contexte propre : les pages d'un même navigateur partagent sinon leur stockage, et la base de la
 * page précédente. La deuxième page d'un fichier trouvait alors une base déjà remplie, sans bouton
 * « Charger l'exemple », et lisait les données à la date du jour (#149). Le contexte se ferme avec
 * la page.
 *
 * Horloge : `Date` est remplacée avant tout script de la page ; le temps s'écoule normalement à
 * partir du jour fixé.
 */
export async function nouvellePage(site: Site, largeur = 375, hauteur = 812): Promise<Page> {
  const contexte = await site.chrome.createBrowserContext();
  const page = await contexte.newPage();
  page.once('close', () => void contexte.close().catch(() => {}));
  await page.emulateTimezone(FUSEAU_DES_TESTS);
  await page.evaluateOnNewDocument((début: number) => {
    const Vraie = Date;
    const décalage = début - Vraie.now();
    const maintenant = () => Vraie.now() + décalage;
    function DateFixée(this: unknown, ...a: unknown[]): unknown {
      if (!new.target) return new Vraie(maintenant()).toString();
      return a.length === 0 ? new Vraie(maintenant()) : new (Vraie as unknown as new (...b: unknown[]) => Date)(...a);
    }
    Object.setPrototypeOf(DateFixée, Vraie);
    DateFixée.prototype = Vraie.prototype;
    (DateFixée as unknown as { now: () => number }).now = maintenant;
    (globalThis as unknown as { Date: unknown }).Date = DateFixée;
  }, Date.parse(JOUR_DES_TESTS));
  await page.setViewport({ width: largeur, height: hauteur, isMobile: true, hasTouch: true });
  return page;
}

/** Ce que montre la page, en une ligne : de quoi comprendre un échec sans rejouer le test. */
async function décrire(page: Page, erreurs: string[]): Promise<string> {
  const vu = await page
    .evaluate(() => {
      const t = (e: Element) => (e.textContent ?? '').trim().replace(/\s+/g, ' ');
      const titres = [...document.querySelectorAll('h1, h2')].map(t).join(' | ');
      const boutons = [...document.querySelectorAll('main button')].map(t).slice(0, 8).join(' | ');
      return `titres : ${titres || 'aucun'} ; boutons : ${boutons || 'aucun'}`;
    })
    .catch((e: unknown) => `page illisible (${e instanceof Error ? e.message : String(e)})`);
  return erreurs.length ? `${vu} ; erreurs de la page : ${erreurs.join(' | ')}` : vu;
}

/**
 * Attend que `condition` (exécutée dans la page) soit vraie, au plus `délai` ms. Rend faux à
 * l'échéance, et s'arrête aussitôt si la page lève une erreur : l'appelant dit alors ce qui manque.
 */
async function attendre(page: Page, condition: () => boolean, erreurs: string[], délai = 15_000): Promise<boolean> {
  const fin = Date.now() + délai;
  while (Date.now() < fin && erreurs.length === 0) {
    if (await page.evaluate(condition).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * Ouvre l'application à la taille demandée, dans une page neuve (`nouvellePage`), et charge
 * l'exemple, plan garni.
 *
 * Un chargement qui n'a pas lieu échoue en disant pourquoi (#149) : base impossible à ouvrir,
 * bouton « Charger l'exemple » absent, erreur levée par la page, ou exemple qui ne s'affiche pas.
 */
export async function ouvrirLExemple(site: Site, largeur = 375, hauteur = 812): Promise<Page> {
  const page = await nouvellePage(site, largeur, hauteur);
  const erreurs: string[] = [];
  const noter = (e: unknown) => erreurs.push(e instanceof Error ? e.message : String(e));
  page.on('pageerror', noter);
  const échec = async (quoi: string) => {
    const message = `Chargement de l'exemple : ${quoi} (${await décrire(page, erreurs)}).`;
    await page.close().catch(() => {});
    return new Error(message);
  };

  await page.goto(site.url, { waitUntil: 'networkidle0' });
  const prête = await attendre(
    page,
    () => !!document.querySelector('main') && !document.body.textContent?.includes('Ouverture de la base'),
    erreurs,
  );
  if (!prête) throw await échec("l'application ne s'est pas ouverte");
  const panne = await page.evaluate(() => document.querySelector('main .card.warn')?.textContent?.trim() ?? '');
  if (panne.includes("Impossible d'ouvrir la base")) throw await échec(panne);

  const cliqué = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes("Charger l'exemple"));
    b?.click();
    return !!b;
  });
  if (!cliqué) throw await échec("bouton « Charger l'exemple » introuvable à l'ouverture, la base n'était pas vide ?");

  // L'exemple porte des besoins : le titre « Tirelires » signe un plan effectivement calculé, et le
  // bouton disparu une base qui n'est plus vide.
  const chargé = await attendre(
    page,
    () =>
      [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Tirelires') &&
      ![...document.querySelectorAll('button')].some((x) => x.textContent?.includes("Charger l'exemple")),
    erreurs,
  );
  if (!chargé) throw await échec("« Charger l'exemple » cliqué, mais le plan de l'exemple ne s'affiche pas");
  page.off('pageerror', noter);
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
