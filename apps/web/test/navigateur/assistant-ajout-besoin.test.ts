/**
 * Tests du codeur de #344 — « Dans l'assistant, ajouter un besoin à une tirelire de l'étape Budgets » :
 * sur le site construit, à 375 px, projet vierge. Chaque test dit, dans son titre, le point du
 * « Fait quand » qu'il vérifie.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Les lignes de besoin d'une carte de l'étape : nom propre et montant. */
const lignes = (page: Page, tirelire: string) =>
  page.evaluate((nom: string) => {
    const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === nom);
    return c
      ? ([...c.querySelectorAll('.ligne')] as HTMLElement[]).map((l) => ({
          nom: (l.querySelector('input.besoin') as HTMLInputElement | null)?.value ?? '',
          montant: (l.querySelector('input.mt') as HTMLInputElement).value,
          suite: (l.querySelector('.suite')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        }))
      : null;
  }, tirelire);

/** Remplit le formulaire d'ajout d'un besoin de la carte, et l'envoie. */
async function ajouter(page: Page, tirelire: string, nom: string, montant: string) {
  await page.evaluate(
    (t: string, n: string, m: string) => {
      const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === t)!;
      const f = c.querySelector('form.ajout-besoin')!;
      const poser = (i: HTMLInputElement, v: string) => {
        i.value = v;
        i.dispatchEvent(new Event('input', { bubbles: true }));
      };
      poser(f.querySelector('.besoin-nom') as HTMLInputElement, n);
      poser(f.querySelector('.mt') as HTMLInputElement, m);
      (f.querySelector('button[type=submit]') as HTMLButtonElement).click();
    },
    tirelire,
    nom,
    montant,
  );
  await pause(250);
}

const aides = (page: Page, tirelire: string) =>
  page.evaluate((t: string) => {
    const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === t)!;
    return [(c.querySelector('.besoin-nom') as HTMLInputElement).placeholder, (c.querySelector('form.ajout-besoin .mt') as HTMLInputElement).placeholder];
  }, tirelire);

const erreur = (page: Page, tirelire: string) =>
  page.evaluate((t: string) => {
    const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === t)!;
    return (c.querySelector('form.ajout-besoin .err')?.textContent ?? '').trim();
  }, tirelire);

describe.skipIf(!navigateur)('#344 — ajouter un besoin à une tirelire de l’étape Budgets', () => {
  let site: Site;
  let page: Page;
  beforeAll(async () => {
    site = await ouvrirLeSite();
    page = await nouvellePage(site);
    await page.goto(site.url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
    await allerÀ(page, 'Plan');
    await cliquer(page, 'Construire mon budget');
    await pause(300);
    await cliquer(page, 'Commencer');
    await pause(250);
    await page.evaluate(() => {
      ([...document.querySelectorAll('.wizard-steps .wstep')] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').trim() === 'Budgets')?.click();
    });
    await pause(300);
  }, 120_000);
  afterAll(async () => {
    await page?.close();
    await site?.fermer();
  });

  it('[niveau 4] 5 — la ligne d’aide du formulaire est « Cours de piano », 45,00', async () => {
    expect(await aides(page, 'Essence')).toEqual(['Cours de piano', '45,00']);
  });

  it('[niveau 4] 2 — un besoin sans nom ou sans montant positif est refusé, en le disant', async () => {
    await ajouter(page, 'Essence', '', '30');
    expect(await erreur(page, 'Essence')).not.toBe('');
    await ajouter(page, 'Essence', 'Péage', '0');
    expect(await erreur(page, 'Essence')).not.toBe('');
    expect(await lignes(page, 'Essence')).toHaveLength(1);
  });

  it('[niveau 4] 1, 3 — le besoin ajouté est une ligne de plus de la carte, avec son nom, en vigueur sans date, et se retire', async () => {
    await ajouter(page, 'Essence', 'Péage', '30');
    const vu = (await lignes(page, 'Essence'))!;
    expect(vu).toHaveLength(2);
    expect(vu[1]).toEqual({ nom: 'Péage', montant: '30,00', suite: '' });
    expect(await erreur(page, 'Essence')).toBe('');
    await page.evaluate(() => {
      const l = ([...document.querySelectorAll('main .card.tirelire .ligne')] as HTMLElement[]).find((x) => (x.querySelector('input.besoin') as HTMLInputElement | null)?.value === 'Péage')!;
      (l.querySelector('button.danger') as HTMLButtonElement).click();
    });
    await pause(250);
    expect(await lignes(page, 'Essence')).toHaveLength(1);
  });

  it('[niveau 4] 5 — recopier les aides ajoute le besoin de l’exemple, date de début comprise', async () => {
    await ajouter(page, 'Essence', 'Cours de piano', '45,00');
    const vu = (await lignes(page, 'Essence'))!;
    expect(vu).toHaveLength(2);
    expect(vu[1]!.nom).toBe('Cours de piano');
    expect(vu[1]!.suite).toMatch(/à partir du 28 oct\S* 2026/);
  });

  it('[niveau 4] 4 — mon bouton n’est pas primaire : l’étape garde ses boutons', async () => {
    const primaires = await page.evaluate(() => [...document.querySelectorAll('main .btn.primary')].map((b) => (b.textContent ?? '').trim()));
    expect(primaires).toEqual(['Ajouter', 'Suivant ›']);
  });
});
