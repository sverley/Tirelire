/**
 * Harnais d'audit de #395 — composé des tests du codeur : ce que l'assistant montre et enregistre de la ventilation de l'ordre
 * « Virement Livret A » de l'exemple (points 3 à 7). Côté cœur : `packages/core/test/ordre-ventile-exemple-harnais.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LedgerStore, alive, computePlan, type Ledger } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
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

async function projetConserve(page: Page): Promise<Ledger> {
  await pause(1200);
  const b64 = await page.evaluate(
    () =>
      new Promise<string | null>((ok) => {
        const req = indexedDB.open('tirelire');
        req.onerror = () => ok(null);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('files')) return (db.close(), ok(null));
          const get = db.transaction('files', 'readonly').objectStore('files').get('ledger.sqlite');
          get.onerror = () => (db.close(), ok(null));
          get.onsuccess = () => {
            db.close();
            const v = get.result as Uint8Array | ArrayBuffer | undefined;
            if (!v) return ok(null);
            const u = v instanceof Uint8Array ? v : new Uint8Array(v);
            let s = '';
            for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
            ok(btoa(s));
          };
        };
      }),
  );
  expect(b64, 'le fichier de l’application est introuvable').not.toBeNull();
  const store = await LedgerStore.create({ sqlJs: SQL, bytes: new Uint8Array(Buffer.from(b64!, 'base64')) });
  const projet = store.load();
  store.close();
  return projet;
}

/** L'ordre enregistré : son montant et ses parts, nommées par leur tirelire. */
const ordreEnregistre = (l: Ledger) => {
  const f = alive(l.plannedFlows).find((x) => x.kind === 'transfer' && x.name === 'Virement Livret A');
  if (!f) return null;
  return { montant: f.amount, parts: (f.action?.allocation ?? []).map((a) => [l.tirelires.find((t) => t.id === a.tirelireId)?.name, a.share]) };
};

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

    it('[niveau 1] point 6 : rien n’est enregistré avant la validation', async () => {
      expect(ordreEnregistre(await projetConserve(page))).toBeNull();
    });

    it('[niveau 1] points 6 et 7 : validé, l’ordre s’enregistre avec ses parts, et le plan signale le montant et Vacances', async () => {
      expect(await cliquer(page, 'Valider mon budget')).toBe(true);
      await pause(400);
      const l = await projetConserve(page);
      expect(ordreEnregistre(l)).toEqual({
        montant: -60000,
        parts: [
          ['Taxe foncière', { kind: 'fixed', amount: -10000 }],
          ['Assurance auto', { kind: 'fixed', amount: -5000 }],
          ['Vacances', { kind: 'fixed', amount: -15000 }],
          ['Épargne de précaution', { kind: 'variable' }],
        ],
      });
      const asOf = await page.evaluate(() => new Date().toISOString().slice(0, 10));
      const livret = computePlan(l, asOf).transfers.find((t) => t.accountName === 'Livret A')!;
      expect(livret.bankOrder?.signaled).toBe(true);
      expect(livret.bankOrder!.parts.filter((p) => p.signaled).map((p) => p.tirelireName)).toEqual(['Vacances']);
    });
  });

  describe('une tirelire retirée après la proposition, le montant corrigé', () => {
    let page: Page;
    beforeAll(async () => {
      page = await ouvrirLAssistant(site);
      // Les tirelires se proposent à la visite de leurs étapes ; l'ordre, au résumé.
      for (const e of ['Budgets', 'Pas tous les mois', 'Épargne', 'Résumé']) await etape(page, e);
    }, 60_000);
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 2] points 4 et 5 : la part de Vacances disparaît, les parts fixes gardent leur montant, la variable prend le reste', async () => {
      await etape(page, 'Pas tous les mois');
      const fait = await page.evaluate(() => {
        const champ = ([...document.querySelectorAll('main .card.tirelire input.nom')] as HTMLInputElement[]).find((i) => i.value.trim() === 'Vacances');
        const b = champ?.parentElement?.querySelector('button.danger') as HTMLButtonElement | null;
        b?.click();
        return !!b;
      });
      expect(fait, 'pas de bouton pour retirer Vacances').toBe(true);
      await pause(250);
      await etape(page, 'Résumé');
      expect(await parts(page)).toEqual([
        ['Taxe foncière', 'part fixe', '100,00 €'],
        ['Assurance auto', 'part fixe', '50,00 €'],
        ['Épargne de précaution', 'le reste', '450,00 €'],
      ]);
      await page.evaluate(() => {
        const i = document.querySelector('main .card.ordre input.mt') as HTMLInputElement;
        i.value = '120,00';
        i.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await pause(250);
      expect(await parts(page)).toEqual([
        ['Taxe foncière', 'part fixe', '100,00 €'],
        ['Assurance auto', 'part fixe', '50,00 €'],
        ['Épargne de précaution', 'le reste', '0,00 €'],
      ]);
      expect(await cliquer(page, 'Valider mon budget')).toBe(true);
      await pause(400);
      expect(ordreEnregistre(await projetConserve(page))).toEqual({
        montant: -12000,
        parts: [
          ['Taxe foncière', { kind: 'fixed', amount: -10000 }],
          ['Assurance auto', { kind: 'fixed', amount: -5000 }],
          ['Épargne de précaution', { kind: 'variable' }],
        ],
      });
    });
  });
});
