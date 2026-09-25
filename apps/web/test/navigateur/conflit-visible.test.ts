/**
 * Harnais de #196, point 5 à l'écran — « Un conflit se voit ». Second fichier du harnais de #196,
 * à côté de `../fichier-etat.test.ts` : les tests navigateur vivent dans ce dossier, joués par la
 * CI et non par les crochets (#121, D83).
 *
 * L'issue : « Une même ligne modifiée des deux côtés depuis la dernière synchronisation des deux
 * instances : les deux retiennent la même version, et l'utilisateur voit la ligne, ce qui est
 * retenu et ce qui est écarté. Rien n'est écarté en silence. » Le cœur est gardé par
 * `fichier-etat.test.ts` ; ici, l'écran.
 *
 * Deux instances : A, un dépôt du cœur dans Node ; B, l'application dans le navigateur. Elles
 * passent par le même relais, en mémoire, au contrat de `apps/hebergement/serveur/relais.php` ; les
 * requêtes de la page vers lui sont interceptées, rien ne sort. B se synchronise par l'écran
 * Synchronisation, comme le harnais d'I7, et renomme une catégorie par l'écran Catégories, que #196
 * ne touche pas. A renomme la même catégorie de son côté ; puis chacune se synchronise.
 *
 * Ce qui est exigé, sans rien supposer de l'endroit ni de la forme que le codeur choisit : juste
 * après la synchronisation de B, sans autre geste — ou après un seul geste sur un élément qui nomme
 * le conflit ou l'écart —, la page montre les deux noms, le retenu et l'écarté. Le nom étant
 * l'objet du conflit, les deux noms désignent aussi la ligne. Le harnais ne suppose pas lequel est
 * retenu : les horloges du navigateur et de Node ne sont pas celles d'un même appareil.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import initSqlJs from 'sql.js';
import type { HTTPRequest, Page } from 'puppeteer-core';
import { LedgerStore, exampleLedger } from '@tirelire/core';
import { relaySync } from '../../src/lib/relay';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
const RELAIS = { url: 'https://relais.exemple.invalid/tirelire', room: 'salon-conflit-196', passphrase: 'phrase du foyer, conflit 196' };
const CATEGORIE = exampleLedger().categories.find((c) => c.nature === 'expense' && !c.parentId)!;
const VERSION_A = 'VERSION-A-196';
const VERSION_B = 'VERSION-B-196';
const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Le relais en mémoire, commun à Node et à la page
// ─────────────────────────────────────────────────────────────────────────────────────────────

type Depot = Record<string, unknown> & { id: number };

function relais() {
  const depots: Depot[] = [];
  const traiter = (methode: string, url: URL, corps: string | undefined): unknown => {
    if (methode === 'POST') {
      const id = depots.length + 1;
      depots.push({ ...(JSON.parse(corps ?? '{}') as Record<string, unknown>), id });
      return { id };
    }
    const site = url.searchParams.get('site') ?? '';
    const apres = Number(url.searchParams.get('after') ?? 0);
    return { records: depots.filter((r) => r.id > apres && r['site'] !== site) };
  };
  const pourNode = async (entree: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url);
    const reponse = traiter((init?.method ?? 'GET').toUpperCase(), url, init?.body ? String(init.body) : undefined);
    return new Response(JSON.stringify(reponse), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
  const pourLaPage = (req: HTTPRequest) => {
    if (!req.url().startsWith(RELAIS.url)) {
      void req.continue();
      return;
    }
    if (req.method() === 'OPTIONS') {
      void req.respond({ status: 204, headers: cors, body: '' });
      return;
    }
    const reponse = traiter(req.method(), new URL(req.url()), req.postData());
    void req.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(reponse) });
  };
  return { depots, pourNode, pourLaPage };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Gestes dans la page
// ─────────────────────────────────────────────────────────────────────────────────────────────

async function ouvrirVide(site: Site): Promise<Page> {
  const page = await nouvellePage(site);
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('main') && !document.body.textContent?.includes('Ouverture de la base'), { timeout: 15_000 });
  return page;
}

async function synchroniserParLeRelais(page: Page, depots: Depot[]): Promise<void> {
  await allerÀ(page, 'Plus');
  expect(await cliquer(page, 'Synchronisation'), 'écran Synchronisation introuvable').toBe(true);
  await pause(200);
  await page.evaluate(
    (url: string, salon: string, phrase: string) => {
      const definir = (input: HTMLInputElement | undefined, v: string) => {
        if (!input || input.value === v) return;
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const entrees = [...document.querySelectorAll('input')] as HTMLInputElement[];
      definir(entrees.find((i) => i.placeholder === 'https://maison.exemple.fr/tirelire'), url);
      definir(entrees.find((i) => i.placeholder === 'identifiant secret'), salon);
      definir(entrees.find((i) => i.type === 'password'), phrase);
    },
    RELAIS.url,
    RELAIS.room,
    RELAIS.passphrase,
  );
  await pause(150);
  const avant = depots.length;
  expect(await cliquer(page, 'Synchroniser maintenant'), 'bouton « Synchroniser maintenant » introuvable').toBe(true);
  // Laisse l'échange se faire : chiffrement, dépôt, retrait, application.
  for (let i = 0; i < 50 && depots.length === avant; i++) await pause(100);
  await pause(1500);
}

async function renommerLaCategorie(page: Page, ancien: string, nouveau: string): Promise<void> {
  await allerÀ(page, 'Plus');
  expect(await cliquer(page, 'Catégories'), 'écran Catégories introuvable').toBe(true);
  await pause(200);
  const ouvert = await page.evaluate((nom: string) => {
    const ligne = [...document.querySelectorAll('.row')].find((r) => r.querySelector('.label strong')?.textContent?.trim() === nom);
    const b = ligne && ([...ligne.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Modifier') as HTMLButtonElement | undefined);
    b?.click();
    return !!b;
  }, ancien);
  expect(ouvert, `catégorie « ${ancien} » introuvable sur l’écran Catégories : la première synchronisation ne l’a pas apportée`).toBe(true);
  await pause(200);
  const enregistre = await page.evaluate(async (nom: string) => {
    const f = document.querySelector('form') as HTMLFormElement | null;
    const l = f && [...f.querySelectorAll('label')].find((x) => x.textContent?.trim().startsWith('Nom'));
    const champ = l?.querySelector('input') as HTMLInputElement | null;
    if (!f || !champ) return false;
    champ.value = nom;
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((fin) => setTimeout(fin, 50));
    f.requestSubmit();
    for (let i = 0; i < 40 && f.isConnected; i++) await new Promise((fin) => setTimeout(fin, 50));
    return !f.isConnected;
  }, nouveau);
  expect(enregistre, `la catégorie ne se renomme pas en « ${nouveau} »`).toBe(true);
  await pause(600);
}

/** Le texte visible de la page. */
const visible = (page: Page) => page.evaluate(() => document.body.innerText);

/**
 * Ce que la page montre juste après la synchronisation ; sinon, après un seul geste sur un élément
 * qui nomme le conflit ou l'écart.
 */
async function ceQueVoitLUtilisateur(page: Page): Promise<string> {
  const d = await visible(page);
  if (d.includes(VERSION_A) && d.includes(VERSION_B)) return d;
  const touche = await page.evaluate(() => {
    const e = [...document.querySelectorAll('button, a, summary, [role=button]')].find((x) => /conflit|écart/i.test((x as HTMLElement).innerText ?? ''));
    (e as HTMLElement | undefined)?.click();
    return !!e;
  });
  if (!touche) return d;
  await pause(400);
  return visible(page);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Assertion, partagée avec le témoin rouge
// ─────────────────────────────────────────────────────────────────────────────────────────────

function verifierConflitAffiche(texte: string): void {
  const resume = texte.replace(/\s+/g, ' ').slice(0, 400);
  expect(texte.includes(VERSION_A) && texte.includes(VERSION_B), `l’écran ne montre pas le retenu et l’écarté (${VERSION_A}, ${VERSION_B}) : « ${resume} »`).toBe(true);
}

describe('[niveau 1] harnais du registre', () => {
  it.fails('témoin rouge · un conflit tranché sans que l’écran en dise rien', () => {
    // Version cassée : l'écran de synchronisation ne montre que le nombre de changements reçus, et
    // la catégorie sous la version retenue.
    verifierConflitAffiche(`Synchronisation\nÉchange terminé : 3 changements reçus.\nCatégories\n${VERSION_A}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('[niveau 1] harnais du registre', () => {
  describe.skipIf(!navigateur)('#196 · 5. un conflit se voit à l’écran', () => {
    let site: Site;

    beforeAll(async () => {
      site = await ouvrirLeSite();
    }, 120_000);

    afterAll(async () => {
      await site?.fermer();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('une catégorie renommée des deux côtés : après la synchronisation, l’écran montre le nom retenu et le nom écarté', async () => {
      const { depots, pourNode, pourLaPage } = relais();
      vi.stubGlobal('fetch', pourNode);

      // A : le cœur, l'exemple déposé sur le relais.
      const a = await LedgerStore.create({ sqlJs: SQL });
      const l = exampleLedger();
      for (const cle of ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows', 'operations', 'allocations'] as const)
        for (const r of l[cle]) a.upsert(cle, r as never);
      await relaySync(a, RELAIS);

      // B : l'application, vide, qui reçoit l'exemple par le relais.
      const page = await ouvrirVide(site);
      await page.setRequestInterception(true);
      page.on('request', pourLaPage);
      await synchroniserParLeRelais(page, depots);
      await relaySync(a, RELAIS);

      // Chacune renomme la même catégorie, hors ligne.
      a.upsert('categories', { ...a.load().categories.find((c) => c.id === CATEGORIE.id)!, name: VERSION_A });
      await renommerLaCategorie(page, CATEGORIE.name, VERSION_B);

      // A se synchronise, puis B : B reçoit la version de A et dépose la sienne.
      await relaySync(a, RELAIS);
      await synchroniserParLeRelais(page, depots);

      const vu = await ceQueVoitLUtilisateur(page);
      await page.close();

      // Le scénario a bien eu lieu : B a déposé sur le relais, et A, qui reçoit ce dépôt, retient
      // l'une des deux versions.
      const siteA = depots[0]?.['site'];
      expect(depots.some((d) => d['site'] !== siteA), 'la page n’a rien déposé sur le relais').toBe(true);
      await relaySync(a, RELAIS);
      expect([VERSION_A, VERSION_B], 'A ne retient aucune des deux versions').toContain(a.load().categories.find((c) => c.id === CATEGORIE.id)?.name);

      verifierConflitAffiche(vu);
    }, 120_000);
  });
});
