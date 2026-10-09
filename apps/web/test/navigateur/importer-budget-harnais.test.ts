/**
 * Harnais d'audit de #367 — « Importer un budget JSON depuis Configuration ou par une adresse, et le
 * valider dans l'assistant » : sur le site construit, à 375 px, au 6 septembre 2026, projet vierge. Il ne
 * garde que ce qui n'existe que dans un navigateur (D83, « Le navigateur au minimum » ; #418) : les requêtes
 * que la page envoie.
 *
 * L'exemple importé est celui de la documentation de #366 (`docs/format-budget-json.md`, « Exemple
 * complet »).
 *
 * Niveau (D83) : 0 pour le point 2, « la partie après « # » ne quitte pas l'appareil » : I7 ; sinon le
 * budget serait sorti de l'appareil, ce qu'aucune correction ne rattrape.
 *
 * Les autres points de #367 se vérifient sans navigateur : le parcours par chaque voie, l'adresse lue et
 * retirée, l'application déjà ouverte, le remplacement d'un brouillon, le refus et « quitter sans valider
 * n'enregistre rien » sur l'application montée sous jsdom, `apps/web/test/importer-budget-ecran.test.ts` ;
 * le brouillon seul, `apps/web/test/importer-budget.test.ts`. Le point 1 (l'entrée en deux gestes) est
 * tranché par le harnais du registre d'I5, `acces-fonctions.test.ts` ; le point 7, par `VM-C9-telephone` et
 * `VM-C9-ordinateur`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from 'puppeteer-core';
import { navigateur, nouvellePage, ouvrirLeSite, RACINE, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
const JOUR = '2026-09-06';
const DOC = readFileSync(resolve(RACINE, '../../docs/format-budget-json.md'), 'utf8');
const EXEMPLE = [...DOC.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!).find((b) => b.includes('"planned_flows"'))!;
const ADRESSE = (url: string, json = EXEMPLE) => `${url}#budget=${encodeURIComponent(json)}`;
/** Un nom propre au JSON, qu'aucune requête ne doit porter (I7). */
const MARQUE = 'acc-livret-jeune';

async function pageAuJour(site: Site): Promise<Page> {
  const page = await nouvellePage(site);
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
  }, Date.parse(`${JOUR}T12:00:00+02:00`));
  return page;
}

const prete = (page: Page) =>
  page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));

const texte = (page: Page) => page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
const auResume = async (page: Page) => (await texte(page)).includes('Valider mon budget');

async function bouton(page: Page, libellé: string, sel = 'main button'): Promise<void> {
  const fait = await page.evaluate(
    (l: string, s: string) => {
      const b = ([...document.querySelectorAll(s)] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').replace(/\s+/g, ' ').includes(l));
      b?.click();
      return !!b;
    },
    libellé,
    sel,
  );
  expect(fait, `pas de bouton « ${libellé} »`).toBe(true);
  await pause(300);
}

describe.skipIf(!navigateur)('#367 · harnais navigateur', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 180_000);
  afterAll(async () => {
    await site?.fermer();
  });

  describe('[niveau 0] #367 · 2 — la partie après « # » ne quitte pas l’appareil (I7)', () => {
    it('ouvrir par l’adresse, puis valider : aucune requête ne porte le budget', async () => {
      const page = await pageAuJour(site);
      const sorties: string[] = [];
      // Ce qu'une requête envoie : son adresse sans la partie après « # » (HTTP ne la transmet jamais), et son corps.
      page.on('request', (r) => sorties.push(`${r.url().split('#')[0]} ${r.postData() ?? ''}`));
      try {
        await page.goto(ADRESSE(site.url), { waitUntil: 'networkidle0' });
        await prete(page);
        await pause(500);
        expect(await auResume(page), 'l’assistant ne s’ouvre pas sur son résumé').toBe(true);
        await bouton(page, 'Valider mon budget', 'main .actions button.primary');
        await pause(800);
        expect(sorties.filter((s) => s.includes(MARQUE) || s.includes(encodeURIComponent(MARQUE)) || s.includes('budget='))).toEqual([]);
      } finally {
        await page.close();
      }
    }, 90_000);
  });
});
