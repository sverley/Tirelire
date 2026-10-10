/**
 * Harnais d'audit de #369 — l'écran Tirelires emploie la section Tirelires de l'assistant (#361), ce qui
 * n'existe que dans un navigateur : sur le site construit, à 375 px, projet vierge, le formulaire d'ajout de
 * la section, avec ses aides, ajoute une échéance, sa ligne et son prélèvement attendu, sans que l'écran
 * déborde (C9). Reprend un test du codeur (niveau marqué par l'auditeur, D83).
 *
 * Les autres points du besoin — rien de créé d'office et les raccourcis d'une base vide (point 3, I5, I10,
 * D46), l'explication repliée (point 4), la carte corrigée sur place et le besoin ajouté sur la carte
 * (point 1, U1), « Réviser », « Modifier », la priorité et les panneaux nommés (point 2, D51, D59) — se
 * vérifient sans navigateur, dans `../ecran-tirelires-ecran.test.ts` (#421) ; le texte de l'explication et
 * l'écran qui donne la section, dans les sources, par `../ecran-tirelires-section.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

describe.skipIf(!navigateur)('#369 · l’écran Tirelires emploie la section Tirelires', () => {
  let site: Site;
  let page: Page;

  beforeAll(async () => {
    site = await ouvrirLeSite();
    page = await nouvellePage(site);
    page.on('dialog', (d) => void d.accept());
    await page.goto(site.url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
  }, 180_000);

  afterAll(async () => {
    await page?.close().catch(() => {});
    await site?.fermer();
  });

  const ouvrir = async () => {
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Tirelires')).toBe(true);
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Tirelires');
    await pause(150);
  };
  const cartes = () =>
    page.evaluate(() => ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).map((c) => (c.querySelector('input.nom') as HTMLInputElement).value));
  const remplir = (étiquette: string, valeur: string) =>
    page.evaluate(
      (é: string, v: string) => {
        const l = [...document.querySelectorAll('main form.edit label')].find((x) => (x.textContent ?? '').trim().startsWith(é));
        const c = l?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null;
        if (!c) return false;
        if (c instanceof HTMLSelectElement) {
          const o = [...c.options].find((x) => x.value === v || (x.textContent ?? '').trim() === v);
          if (!o) return false;
          c.value = o.value;
          c.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          c.value = v;
          c.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      },
      étiquette,
      valeur,
    );

  it('[niveau 2] points 1 et 5 (#214) — le formulaire d’ajout est celui de la section, avec ses aides ; une échéance ajoute sa ligne et son prélèvement attendu', async () => {
    await ouvrir();
    expect(await cliquer(page, 'Ajouter une tirelire')).toBe(true);
    await pause(200);
    const aide = await page.evaluate(() => {
      const l = [...document.querySelectorAll('main form.edit label')].find((x) => (x.textContent ?? '').trim().startsWith('Quoi'));
      return (l?.querySelector('input') as HTMLInputElement | null)?.placeholder ?? null;
    });
    expect(aide, 'le champ « Quoi ? » porte l’aide de l’exemple').toBeTruthy();
    expect(await remplir('Quelle sorte', 'Dépense à échéance')).toBe(true);
    await pause(150);
    expect(await remplir('Quoi', 'Contrôle technique')).toBe(true);
    expect(await remplir('Montant de la facture', '90,00')).toBe(true);
    expect(await remplir('Prochaine échéance', '2027-03-01')).toBe(true);
    await pause(100);
    await page.evaluate(() => (document.querySelector('main form.edit button[type="submit"]') as HTMLButtonElement).click());
    await pause(300);
    expect(await cartes()).toContain('Contrôle technique');
    const carte = await page.evaluate(() => {
      const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === 'Contrôle technique')!;
      return { echeance: !!c.querySelector('.ligne-echeance input[type="date"]'), prelevement: (c.querySelector('.prelevement')?.textContent ?? '').replace(/\s+/g, ' ').trim() };
    });
    expect(carte.echeance).toBe(true);
    expect(carte.prelevement).toMatch(/Prélèvement attendu/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'l’écran déborde à 375 px').toBe(true);
  });
});
