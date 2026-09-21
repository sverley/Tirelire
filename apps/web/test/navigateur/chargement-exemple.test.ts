/**
 * Harnais #149 : un chargement de l'exemple qui n'a pas lieu échoue en le disant.
 *
 * `ouvrirLExemple` ouvre presque tous les tests d'interface. Quand l'exemple ne se charge pas —
 * application qui ne monte pas, bouton absent, clic sans effet —, le test qui l'appelle doit
 * échouer sur un message qui nomme l'exemple, et non sur un délai dépassé qui ne dit rien de ce
 * qui s'est passé : c'est ce qui a rendu illisible l'échec de `main` en CI le 21 septembre 2026.
 *
 * Le site construit n'est pas nécessaire : deux pages minimales, servies en `data:`, jouent les
 * deux pannes. Seul le message est tenu, pas la durée : attendre le bouton un moment avant de
 * conclure reste permis, pourvu que l'échec dise ce qui manque.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import puppeteer, { type Browser } from 'puppeteer-core';
import { navigateur, ouvrirLExemple, type Site } from '../harnais.js';

const pageDe = (corps: string) =>
  'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><title>Tirelire</title>${corps}`);

describe.skipIf(!navigateur)('chargement de l’exemple · une panne se dit', () => {
  let chrome: Browser;

  beforeAll(async () => {
    chrome = await puppeteer.launch({
      executablePath: navigateur!,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }, 60_000);

  afterAll(async () => {
    await chrome?.close();
  });

  /** Message de l'échec d'`ouvrirLExemple` sur cette page, ou `null` s'il n'a pas échoué. */
  async function échecSur(url: string): Promise<string | null> {
    const site = { url, chrome, fermer: async () => {} } as Site;
    try {
      const page = await ouvrirLExemple(site);
      await page.close();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  it('sans bouton « Charger l’exemple », l’échec le nomme', async () => {
    const message = await échecSur(pageDe('<p>L’application n’a pas monté.</p>'));
    expect(message, 'ouvrirLExemple doit échouer quand il n’y a rien à charger').not.toBeNull();
    expect(message, 'le message doit nommer l’exemple, pas seulement un délai').toMatch(/exemple/i);
  }, 90_000);

  it('un clic qui ne charge rien : l’échec dit que l’exemple ne s’est pas chargé', async () => {
    const message = await échecSur(pageDe(`<button type="button">Charger l'exemple</button>`));
    expect(message, 'ouvrirLExemple doit échouer quand le clic ne charge rien').not.toBeNull();
    expect(message, 'le message doit nommer l’exemple, pas seulement un délai').toMatch(/exemple/i);
  }, 90_000);
});
