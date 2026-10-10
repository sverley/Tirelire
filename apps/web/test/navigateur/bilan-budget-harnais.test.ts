/**
 * Harnais d'audit de #320, côté écran — ce que le Bilan montre de la mise en page : un Bilan aux périodes
 * signalées ne déborde pas de l'écran à 375 px (C9). Seule cette mesure demande un navigateur (D83, « Le
 * navigateur au minimum ») ; #420 a retiré d'ici les autres tests de #320.
 *
 * Les autres points du « Fait quand » de #320 se vérifient sans navigateur : ce que le Bilan montre — le
 * budget d'abord, période par période, au montant du Plan ; le passé dessous ; ce qu'il dit sans opération,
 * sans besoin, sans rien (points 1 à 7) — dans `apps/web/test/bilan-budget-ecran.test.ts`, sur l'application
 * montée sous jsdom ; le calcul dans le cœur (`packages/core/test/bilan-budget-harnais.test.ts`).
 *
 * Le décor : un budget sans aucune opération, dont les revenus ne couvrent pas tout, fabriqué en grand livre
 * importé par Réglages, comme le font les autres harnais. Les cartes de période se reconnaissent à
 * `data-periode`.
 *
 * Niveau (D83) : 1 — C9 : le registre ne garde ce débordement que pour le Plan. Il a son témoin rouge,
 * montré à l'audit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LEDGER_KEYS, LedgerStore, exampleLedger, type Ledger } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));

async function allerAuBilan(page: Page) {
  await allerÀ(page, 'Bilan');
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent?.trim() === 'Bilan');
  await pause();
}

/** Importe un grand livre par le champ « Importer un fichier… » de Réglages, sur une page neuve, puis va au Bilan. */
async function pageAvec(site: Site, l: Ledger): Promise<Page> {
  const store = await LedgerStore.create({ sqlJs: SQL, siteId: 'audit-320' });
  for (const clé of LEDGER_KEYS) for (const r of l[clé]) store.upsert(clé, r as never);
  for (const clé of ['periodStartDay', 'principalCushion', 'transferThreshold', 'orderRounding'] as const) store.setSetting(clé, l.settings[clé]);
  const octets = store.export();
  store.close();

  const dossier = mkdtempSync(join(tmpdir(), 'tirelire-320-'));
  const chemin = join(dossier, 'grand-livre.sqlite');
  writeFileSync(chemin, octets);
  try {
    const page = await nouvellePage(site);
    page.on('dialog', (d) => void d.accept());
    await page.goto(site.url, { waitUntil: 'networkidle0' });
    const fin = Date.now() + 15_000;
    while (Date.now() < fin && !(await page.evaluate(() => !!document.querySelector('main') && !document.body.textContent?.includes('Ouverture de la base')).catch(() => false))) await pause(100);
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Réglages'), 'Réglages introuvable sous Plus').toBe(true);
    await pause(300);
    const champ = (await page.evaluateHandle(() => [...document.querySelectorAll<HTMLInputElement>('main input[type="file"]')].find((c) => /sqlite/i.test(c.accept)) ?? null)).asElement();
    expect(champ, 'aucun champ pour importer un fichier SQLite dans Réglages').not.toBeNull();
    await (champ as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(chemin);
    await pause(1_500);
    await allerAuBilan(page);
    return page;
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

/** Un budget sans aucune opération, dont les revenus, réduits au tiers, ne couvrent plus tout. */
function budgetSansOperationAuxRevenusReduits(): Ledger {
  const l = exampleLedger();
  l.operations = [];
  l.subOperations = [];
  l.shortfallAnswers = [];
  l.plannedFlows = l.plannedFlows.map((f) => (f.kind === 'income' ? { ...f, amount: Math.round(f.amount / 3) } : f));
  return l;
}

describe.skipIf(!navigateur)('#320 · le Bilan à l’écran', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  });
  afterAll(async () => {
    await site?.fermer();
  });

  describe('un budget sans aucune opération, dont les revenus ne couvrent pas tout', () => {
    let page: Page;
    const l = budgetSansOperationAuxRevenusReduits();
    beforeAll(async () => {
      page = await pageAvec(site, l);
    });
    afterAll(async () => {
      await page?.close();
    });

    it('[niveau 1] C9 — à 375 px, douze périodes signalées et leurs détails dépliés ne font pas défiler l’écran en largeur', async () => {
      expect(await cliquer(page, '12 périodes')).toBe(true);
      for (let i = 0; i < 3; i++) expect(await cliquer(page, 'Détail ·')).toBe(true);
      const r = await page.evaluate(() => ({ largeur: document.documentElement.clientWidth, defile: document.documentElement.scrollWidth }));
      expect(r.largeur).toBe(375);
      expect(r.defile, `le Bilan défile en largeur : ${r.defile} px pour ${r.largeur} px`).toBeLessThanOrEqual(r.largeur);
    });
  });
});
