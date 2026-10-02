/**
 * #320 · Le Bilan lit le budget : prévu, financé, non financé (D57 : le budget d'abord).
 *
 * Tests du codeur, tous de niveau 4 : ce que l'écran Bilan montre et mène à faire. Le calcul est
 * gardé dans le cœur (`packages/core/test/lecture-budget.test.ts`) ; les montants attendus ici sont
 * relus dans le cœur, sur le même exemple, lu au 6 septembre 2026, et non figés.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { exampleLedger, formatCents, readBudgetAhead } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const fmt = (c: number) => formatCents(c).replace(/\s+/g, ' ');
const LECTURE = '2026-09-06';

/** Ce que montre le Bilan : titres, cartes de période, boutons, case « revenus », largeur. */
const lireLeBilan = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main');
    return {
      h1: t(main?.querySelector('h1')),
      titres: [...(main?.querySelectorAll('h2') ?? [])].map(t),
      periodes: [...(main?.querySelectorAll('[data-periode]') ?? [])].map(t),
      boutons: [...(main?.querySelectorAll('button') ?? [])].map(t),
      caseRevenus: [...(main?.querySelectorAll('label') ?? [])].some((l) => t(l) === 'revenus' && !!l.querySelector('input[type=checkbox]')),
      texte: t(main),
      deborde: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

async function allerAuBilan(page: Page) {
  await allerÀ(page, 'Bilan');
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent?.trim() === 'Bilan');
  await pause();
}

describe.skipIf(!navigateur)('[niveau 4] #320 · le Bilan à l’écran', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  });
  afterAll(async () => {
    await site?.fermer();
  });

  it('[niveau 4] points 1, 3 et 5 — sur l’exemple : le budget d’abord, période par période, puis le passé ; le choix des périodes vaut pour les deux', async () => {
    const page = await ouvrirLExemple(site);
    try {
      await allerAuBilan(page);
      const lecture = readBudgetAhead(exampleLedger(), LECTURE, 12)!;
      let b = await lireLeBilan(page);
      // D57 : le budget d'abord, le passé dessous.
      const iBudget = b.titres.indexOf('Le budget, période par période');
      const iPasse = b.titres.indexOf('Ce qui a été dépensé');
      expect(iBudget).toBeGreaterThanOrEqual(0);
      expect(iPasse).toBeGreaterThan(iBudget);
      expect(b.caseRevenus).toBe(true);
      expect(b.texte).toContain('moy.');
      // Six périodes par défaut, la première au montant du budget de référence d'U1.
      expect(b.periodes).toHaveLength(6);
      const t0 = lecture.periods[0]!.totals;
      for (const m of [t0.incomes, t0.fixedCharges, t0.requested, t0.funded, t0.margin]) expect(b.periodes[0]).toContain(fmt(m));
      expect(b.periodes[0]).toContain('période en cours');
      // Aucune moyenne dans la lecture du budget (point 4).
      for (const p of b.periodes) expect(p).not.toMatch(/moy\.|en moyenne/);

      expect(await cliquer(page, '3 périodes')).toBe(true);
      b = await lireLeBilan(page);
      expect(b.periodes).toHaveLength(3);
      expect(await cliquer(page, '12 périodes')).toBe(true);
      b = await lireLeBilan(page);
      expect(b.periodes).toHaveLength(12);
      for (let i = 0; i < 12; i++) expect(b.periodes[i]).toContain(fmt(lecture.periods[i]!.totals.margin));

      // Le détail d'une période se déplie à la demande : chaque besoin, demandé et couvert.
      expect(b.boutons.some((x) => /^Détail · \d+ besoins?$/.test(x))).toBe(true);
      expect(await cliquer(page, 'Détail ·')).toBe(true);
      b = await lireLeBilan(page);
      for (const n of lecture.periods[0]!.needs) expect(b.periodes[0]).toContain(n.name);
      expect(b.deborde).toBe(false);

      // Point 3 : la taxe foncière, son lissage décidé, et le chemin vers le Plan pour y répondre.
      expect(b.titres).toContain('Échéances en manque');
      expect(b.texte).toContain('Lissage décidé');
      expect(b.boutons).not.toContain('Lisser');
      expect(await cliquer(page, 'Répondre dans le Plan')).toBe(true);
      await page.waitForFunction(() => [...document.querySelectorAll('main h2')].some((h) => h.textContent?.trim() === 'Échéances en manque'));
    } finally {
      await page.close();
    }
  });

  it('[niveau 4] point 7 — base vide : le Bilan dit ce qu’il lira, et mène à « Construire mon budget »', async () => {
    const page = await nouvellePage(site);
    try {
      await page.goto(site.url, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => !!document.querySelector('.tabbar'));
      await allerAuBilan(page);
      const b = await lireLeBilan(page);
      expect(b.texte).toContain('dès qu’il y en aura un');
      expect(b.texte).toContain('dès qu’il y aura des opérations');
      expect(b.boutons).toContain('Construire mon budget');
      expect(b.boutons.some((x) => /périodes$/.test(x))).toBe(false);
      expect(b.caseRevenus).toBe(false);
      expect(b.periodes).toHaveLength(0);
      expect(await cliquer(page, 'Construire mon budget')).toBe(true);
      await page.waitForFunction(() => document.querySelector('main h1')?.textContent?.trim() === 'Construire mon budget');
    } finally {
      await page.close();
    }
  });

  it('[niveau 4] points 1 et 6 — U1 : l’assistant mené à ses valeurs par défaut, sans opération, le Bilan lit le budget et dit ce que des opérations y ajouteront', async () => {
    const page = await nouvellePage(site);
    try {
      await page.goto(site.url, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent?.includes('Construire mon budget')));
      expect(await cliquer(page, 'Construire mon budget')).toBe(true);
      for (let i = 0; i < 15; i++) {
        const suivant = await page.evaluate(() => {
          const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
          const boutons = [...document.querySelectorAll('main button')] as HTMLButtonElement[];
          const fin = boutons.find((x) => t(x) === 'Voir le plan');
          const b = fin ?? boutons.find((x) => x.classList.contains('primary') && /Suivant|Commencer/.test(t(x)));
          b?.click();
          return fin ? 'fin' : b ? 'suite' : 'rien';
        });
        await pause();
        if (suivant !== 'suite') break;
      }
      await allerAuBilan(page);
      const b = await lireLeBilan(page);
      expect(b.titres).toContain('Le budget, période par période');
      expect(b.periodes).toHaveLength(6);
      expect(b.titres).toContain('Ce qui a été dépensé');
      expect(b.texte).toContain('Avec des opérations, importées ou saisies, le Bilan ajoutera ici ce qui a été dépensé');
      expect(b.caseRevenus).toBe(false);
      expect(b.texte).not.toMatch(/moy\.|en moyenne/);
      expect(b.deborde).toBe(false);
    } finally {
      await page.close();
    }
  });
});
