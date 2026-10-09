/**
 * Harnais d'audit de #363, côté écran — depuis les écrans Comptes et Tirelires, l'assistant s'ouvre
 * sur leur seule section : sur le site construit, à 375 px, base vide. Le brouillon lui-même est
 * vérifié sans navigateur dans `../assistant-section-harnais.test.ts`.
 *
 * Les tests sont ceux du codeur (d'où ils sont déplacés), classés par la suite de questions de D83.
 * Niveau 1 : le point d'entrée de chaque écran, sur une base vide (I5), lisible à 375 px (C9), et rien
 * d'écrit sans validation — « ‹ Retour », un autre assistant, l'abandon (D40, I10). Vus rouges sur le
 * code de `main`. Chaque test dit, dans son titre, les points du « Fait quand » qu'il tranche.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Ce que l'écran montre : titres, barre d'étapes, boutons, liens, texte, et s'il déborde. */
const lire = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return {
      h1: t(document.querySelector('main h1')),
      h2: t(document.querySelector('main h2')),
      etapes: [...document.querySelectorAll('main .wizard-steps .wstep')].map(t),
      active: t(document.querySelector('main .wizard-steps .wstep.active')),
      primaires: ([...document.querySelectorAll('main .actions .btn.primary')] as HTMLElement[]).map(t),
      boutons: ([...document.querySelectorAll('main button, main a.btn')] as HTMLElement[]).map(t),
      noms: ([...document.querySelectorAll('main input.nom, main .ligne-compte > input:first-child')] as HTMLInputElement[]).map((i) => i.value.trim()).filter(Boolean),
      texte: t(document.querySelector('main')),
      deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

/** Clique le lien ou le bouton dont le texte est exactement celui-là, dans `main`. */
async function toucher(page: Page, texte: string): Promise<boolean> {
  const fait = await page.evaluate((x: string) => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const b = ([...document.querySelectorAll('main button, main a')] as HTMLElement[]).find((e) => t(e) === x);
    b?.click();
    return !!b;
  }, texte);
  await pause(300);
  return fait;
}

/** Ouvre un écran de Configuration par le menu Plus. */
async function ecran(page: Page, nom: 'Comptes' | 'Tirelires' | 'Flux prévus' | 'Réglages') {
  await allerÀ(page, 'Plus');
  expect(await cliquer(page, nom), `pas d’écran « ${nom} » dans Plus`).toBe(true);
  await pause(250);
}

/** Avance par « Suivant › » jusqu'au résumé. */
async function jusquAuResume(page: Page) {
  for (let i = 0; i < 6 && !(await lire(page)).primaires.includes('Valider'); i++) expect(await toucher(page, 'Suivant ›')).toBe(true);
}

const jourDeDebut = (page: Page) =>
  page.evaluate(() => {
    const h = [...document.querySelectorAll('main h2')].find((x) => (x.textContent ?? '').includes('Début de la période budgétaire'));
    return (h?.nextElementSibling?.querySelector('input') as HTMLInputElement | null)?.value ?? null;
  });

describe.skipIf(!navigateur)('[niveau 1] #363 · l’assistant ouvert sur la section d’un écran', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 180_000);

  afterAll(async () => {
    await site?.fermer();
  });

  const pageVide = async () => {
    const page = await nouvellePage(site);
    page.on('dialog', (d) => void d.accept());
    await page.goto(site.url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
    return page;
  };

  it('points 1 à 6, 9 — depuis Tirelires, base vide : ses trois étapes garnies, le résumé, la validation qui n’écrit qu’elles, le retour à l’écran', async () => {
    const page = await pageVide();
    await ecran(page, 'Tirelires');
    const avant = await lire(page);
    expect(avant.boutons, 'point 1 : pas de « Compléter avec l’assistant » sur l’écran Tirelires').toContain('Compléter avec l’assistant');
    expect(avant.deborde, 'point 9 : l’écran Tirelires déborde à 375 px').toBe(false);

    expect(await toucher(page, 'Compléter avec l’assistant')).toBe(true);
    const premiere = await lire(page);
    expect(premiere.h1).toBe('Compléter mes tirelires');
    expect(premiere.etapes).toEqual(['Budgets', 'Pas tous les mois', 'Épargne', 'Résumé']);
    expect(premiere.active).toBe('Budgets');
    expect(premiere.h2).toBe('Sur quoi voulez-vous vous tenir à un montant ?');
    expect(premiere.noms.length, 'point 3 : l’étape Budgets n’est pas garnie sur un projet vierge').toBeGreaterThan(0);
    expect(premiere.texte, 'point 2 : les totaux du budget, là où l’assistant complet les montre').toContain('Reste à vivre');
    expect(premiere.deborde, 'point 9 : la barre d’étapes déborde à 375 px').toBe(false);

    await toucher(page, 'Suivant ›');
    expect((await lire(page)).noms.length, 'point 3 : l’étape « Pas tous les mois » n’est pas garnie').toBeGreaterThan(0);
    await jusquAuResume(page);
    const resume = await lire(page);
    expect(resume.texte).toContain('Rien n’est encore enregistré');
    expect(resume.texte).toContain('Ce que la validation va changer');
    expect(resume.texte, 'point 4 : le résumé parle des ordres permanents').not.toMatch(/virements permanents|ordres permanents/);
    expect(resume.boutons, 'point 4 : le résumé offre l’enregistrement en JSON').not.toContain('Enregistrer ce brouillon (JSON)');
    expect(resume.primaires).toEqual(['Valider']);
    expect(resume.boutons).toContain('‹ Précédent');
    expect(resume.deborde, 'point 9 : le résumé déborde à 375 px').toBe(false);

    expect(await toucher(page, 'Valider')).toBe(true);
    const valide = await lire(page);
    expect(valide.h2).toBe('Vos changements sont enregistrés');
    expect(valide.primaires).toEqual(['Revenir aux tirelires']);
    await toucher(page, 'Revenir aux tirelires');
    const retour = await lire(page);
    expect(retour.h1).toBe('Tirelires');
    expect(retour.noms.length, 'point 6 : l’écran ne montre pas les tirelires validées').toBeGreaterThan(0);

    // Point 5 : ni compte, ni jour de début de période, ni coussin.
    await ecran(page, 'Comptes');
    expect((await page.evaluate(() => document.querySelectorAll('main .ligne-compte').length)), 'point 5 : un compte a été créé').toBe(1);
    await ecran(page, 'Réglages');
    expect(await jourDeDebut(page), 'point 5 : le jour de début de période a changé').toBe('1');
    await page.close();
  }, 120_000);

  it('points 6 et 7 — « ‹ Retour » n’enregistre rien et se reprend ; un autre assistant ne remplace rien sans accord', async () => {
    const page = await pageVide();
    await ecran(page, 'Comptes');
    expect((await lire(page)).boutons, 'point 1 : pas de « Compléter avec l’assistant » sur l’écran Comptes').toContain('Compléter avec l’assistant');
    await toucher(page, 'Compléter avec l’assistant');
    const comptes = await lire(page);
    expect(comptes.h1).toBe('Compléter mes comptes');
    expect(comptes.etapes).toEqual(['Comptes', 'Résumé']);
    expect(comptes.noms.length, 'point 3 : l’étape Comptes n’est pas garnie').toBeGreaterThan(1);

    // « ‹ Retour » : l'écran Comptes, rien d'enregistré.
    await toucher(page, '‹ Retour');
    expect((await lire(page)).h1).toBe('Comptes');
    expect(await page.evaluate(() => document.querySelectorAll('main .ligne-compte').length), 'point 6 : « ‹ Retour » a enregistré').toBe(1);
    // Rouvert sur la même section : le brouillon se reprend, sans demander.
    await toucher(page, 'Compléter avec l’assistant');
    expect((await lire(page)).noms).toEqual(comptes.noms);

    // Un autre assistant, demandé pendant que celui-ci a des changements : le choix.
    await ecran(page, 'Tirelires');
    await toucher(page, 'Compléter avec l’assistant');
    const choix = await lire(page);
    expect(choix.h1).toBe('Un assistant est déjà en cours');
    expect(choix.boutons).toEqual(expect.arrayContaining(['Reprendre « Compléter mes comptes »', 'Abandonner et ouvrir « Compléter mes tirelires »']));
    expect(choix.deborde, 'point 9 : le choix déborde à 375 px').toBe(false);
    await toucher(page, 'Reprendre « Compléter mes comptes »');
    expect((await lire(page)).h1).toBe('Compléter mes comptes');
    expect((await lire(page)).noms).toEqual(comptes.noms);

    // L'assistant complet, demandé depuis Plus : le même choix ; abandonner n'écrit rien.
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Lancer')).toBe(true);
    await pause(300);
    expect((await lire(page)).h1).toBe('Un assistant est déjà en cours');
    await toucher(page, 'Abandonner et ouvrir « Construire mon budget »');
    expect((await lire(page)).h1).toBe('Construire mon budget');
    await ecran(page, 'Comptes');
    expect(await page.evaluate(() => document.querySelectorAll('main .ligne-compte').length), 'point 7 : abandonner a écrit').toBe(1);

    // Depuis Comptes, maintenant que l'assistant complet n'a rien préparé : il s'ouvre sans demander, se valide, n'écrit que les comptes.
    await toucher(page, 'Compléter avec l’assistant');
    expect((await lire(page)).h1).toBe('Compléter mes comptes');
    await jusquAuResume(page);
    expect((await lire(page)).texte, 'point 4 : la question du placement depuis Comptes').not.toContain('Où dort chaque tirelire');
    await toucher(page, 'Valider');
    await toucher(page, 'Revenir aux comptes');
    expect((await lire(page)).h1).toBe('Comptes');
    expect(await page.evaluate(() => document.querySelectorAll('main .ligne-compte').length), 'point 5 : les comptes de l’exemple ne sont pas entrés').toBeGreaterThan(1);
    await ecran(page, 'Tirelires');
    expect((await lire(page)).noms, 'point 5 : une tirelire est entrée depuis Comptes').toEqual([]);
    await ecran(page, 'Flux prévus');
    expect(await page.evaluate(() => document.querySelectorAll('main .card .row').length), 'point 5 : un flux est entré depuis Comptes').toBe(0);
    await ecran(page, 'Réglages');
    expect(await jourDeDebut(page), 'point 5 : le jour de début de période a changé').toBe('1');
    await page.close();
  }, 180_000);
});
