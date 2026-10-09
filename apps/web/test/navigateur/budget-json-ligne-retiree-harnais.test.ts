/**
 * Harnais d'audit de #409, côté écran — le point 9 seul, le seul à demander le navigateur (D83, « Le
 * navigateur au minimum » ; issue, ligne « Navigateur : ») : un budget JSON qui porte un ordre
 * enregistré désignant une tirelire et un compte retirés, importé par l'adresse (#367) sur un projet
 * vierge. À 375 px, les lignes du résumé qui disent ce qui entre retiré (point 5) se lisent sans
 * défilement horizontal, même sous un nom long ; sur ordinateur, « Valider mon budget » s'atteint à
 * la touche Tab et se presse à la touche Entrée ; à 375 px, il se presse au doigt (un clic). Ce que le résumé, les cartes et la
 * validation disent et enregistrent (points 5 à 7) se vérifie sans navigateur, dans
 * `../budget-json-ligne-retiree-harnais.test.ts` ; le cœur, dans
 * `packages/core/test/budget-json-ligne-retiree-harnais.test.ts`.
 *
 * Niveau 1 (C9, tel qu'il est écrit) : vu rouge sur une mutation ciblée, dite dans la vérification de
 * la PR. Le vrai téléphone reste `VM-C9-telephone`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ElementHandle, Page } from 'puppeteer-core';
import { ecrireBudgetJson, exampleLedger, type Ledger } from '@tirelire/core';
import { navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
const RETIRE = '2026-09-02T10:00:00.000Z';
const LONG = 'Assurance auto et entretien du véhicule familial';

/** L'exemple, Assurance auto (sous un nom long) et la Carte enfants retirées ; un second ordre va vers la Carte enfants. */
function budget(): string {
  const l: Ledger = { ...exampleLedger(), operations: [], subOperations: [], shortfallAnswers: [] };
  l.tirelires = l.tirelires.map((t) => (t.id === 'env-auto' ? { ...t, name: LONG, deletedAt: RETIRE } : t));
  l.needs = l.needs.map((n) => (n.tirelireId === 'env-auto' ? { ...n, deletedAt: RETIRE } : n));
  l.accounts = l.accounts.map((a) => (a.id === 'acc-enfants' ? { ...a, deletedAt: RETIRE } : a));
  l.tirelires = l.tirelires.map((t) => (t.placement.some((p) => p.accountId === 'acc-enfants') ? { ...t, placement: [] } : t));
  const o = l.plannedFlows.find((f) => f.id === 'flow-vir-livret')!;
  l.plannedFlows.push({ ...o, id: 'flow-vir-enfants', name: 'Virement enfants', counterpartAccountId: 'acc-enfants', amount: -10000, labelPattern: 'ENFANTS', action: {} });
  return JSON.stringify(ecrireBudgetJson(l));
}

/** Les lignes « Ajouté, déjà retiré » du résumé, et celles qui débordent de leur ligne ou de l'écran. */
async function lignes(page: Page): Promise<{ textes: string[]; debordent: string[]; page: boolean }> {
  return page.evaluate(() => {
    const t = (e: Element) => ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim();
    const li = [...document.querySelectorAll('.difference li.entree-retiree')] as HTMLElement[];
    return {
      textes: li.map(t),
      debordent: li.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > window.innerWidth).map(t),
      page: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

describe.skipIf(!navigateur)('#409 · 9 — le résumé d’un budget JSON qui porte une tirelire et un compte retirés', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  });
  afterAll(async () => {
    await site?.fermer();
  });

  for (const [largeur, hauteur] of [
    [375, 812],
    [1280, 900],
  ] as const) {
    it(`[niveau 1] 9 — à ${largeur} px : les lignes qui entrent retirées sans défilement horizontal ; « Valider mon budget » ${largeur === 375 ? 'au doigt' : 'au clavier'}`, async () => {
      const page = await nouvellePage(site, largeur, hauteur);
      try {
        await page.goto(`${site.url}#budget=${encodeURIComponent(budget())}`, { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => document.body.textContent?.includes('Valider mon budget'), { timeout: 15_000 });
        await pause(400);
        const r = await lignes(page);
        expect(r.textes.some((l) => l.includes(LONG))).toBe(true);
        expect(r.textes.some((l) => l.includes('Carte enfants'))).toBe(true);
        expect(r.debordent).toEqual([]);
        expect(r.page).toBe(false);

        const estLeBouton = () => {
          const a = document.activeElement as HTMLElement | null;
          return !!a && a.tagName === 'BUTTON' && (a.textContent ?? '').includes('Valider mon budget');
        };
        if (largeur === 375) {
          const cible = await page.evaluateHandle(() => [...document.querySelectorAll('main button')].find((x) => (x.textContent ?? '').includes('Valider mon budget')) as HTMLElement);
          await (cible.asElement() as ElementHandle<Element>).click();
        } else {
          // Au clavier seul : Tab jusqu'au bouton, puis Entrée.
          let atteint = false;
          for (let i = 0; i < 300 && !atteint; i++) {
            await page.keyboard.press('Tab');
            atteint = await page.evaluate(estLeBouton);
          }
          expect(atteint).toBe(true);
          await page.keyboard.press('Enter');
        }
        await page.waitForFunction(() => document.body.textContent?.includes('Et maintenant'), { timeout: 10_000 });
      } finally {
        await page.close();
      }
    }, 120_000);
  }
});
