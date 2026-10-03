/**
 * Tests du codeur de #211, second tour — la clôture du compte clos de l'exemple et le texte de
 * l'étape Comptes. Le compte clos (« Livret jeune ») est semé à l'étape Comptes ; le jour où la
 * période commence se choisit après, à l'étape des revenus. La clôture du compte doit pourtant valoir
 * la veille du premier jour de la période que l'assistant retient (point 3 de l'issue).
 *
 * Un seul parcours, joué dans l'ordre : le texte de l'étape, la date que l'étape montre quand on y
 * revient après avoir choisi le jour de paie, puis ce que le projet porte une fois le budget validé.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { addDays, budgetPeriodContaining } from '@tirelire/core';
import { shortDate } from '../../src/lib/format';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Le jour où tournent les pages du harnais (`JOUR_DES_TESTS`). */
const JOUR = '2026-09-20';
/** La clôture que l'issue demande : la veille du premier jour de la période qui contient le jour, si elle commence le `jourDeDebut`. */
const veille = (jourDeDebut: number) => addDays(budgetPeriodContaining(JOUR, jourDeDebut).start, -1);

/** Ce que l'étape Comptes dit sous « Livret jeune » (pastille « clos » et date). */
async function detailDeLivretJeune(page: Page): Promise<string> {
  return page.evaluate(() => {
    const ligne = [...document.querySelectorAll('.ligne-compte')].find(
      (l) => (l.querySelector('input') as HTMLInputElement | null)?.value === 'Livret jeune',
    );
    return (ligne?.querySelector('.suite')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

/** Le champ « Compte clos le » du formulaire de modification de « Livret jeune », depuis l'écran Comptes. */
async function clotureDansComptes(page: Page): Promise<string> {
  await allerÀ(page, 'Plus');
  await cliquer(page, 'Comptes');
  await pause(200);
  // Un compte clos est rangé derrière le filtre « Clos » (D56).
  await page.evaluate(() => {
    const b = ([...document.querySelectorAll('main button.filtre')] as HTMLButtonElement[]).find(
      (x) => (x.textContent ?? '').trim().startsWith('Clos') && x.getAttribute('aria-pressed') === 'false',
    );
    b?.click();
  });
  await pause(200);
  const ouvert = await page.evaluate(() => {
    const label = [...document.querySelectorAll('.label')].find(
      (l) => (l.querySelector(':scope > strong')?.textContent ?? '').trim() === 'Livret jeune',
    );
    const boutons = [...(label?.closest('.row')?.querySelectorAll(':scope > button, :scope > .actions button') ?? [])] as HTMLButtonElement[];
    const modifier = boutons.find((b) => (b.textContent ?? '').trim() === 'Modifier');
    modifier?.click();
    return !!modifier;
  });
  expect(ouvert, '« Livret jeune » : aucun bouton « Modifier » sur l’écran Comptes').toBe(true);
  await pause(200);
  return page.evaluate(() => {
    const champ = ([...document.querySelectorAll('label.f')] as HTMLLabelElement[]).find((l) => (l.textContent ?? '').includes('Compte clos le'));
    return (champ?.querySelector('input') as HTMLInputElement | null)?.value ?? '';
  });
}

describe.skipIf(!navigateur)('#211 · 3 — le compte clos de l’exemple suit le début de période retenu', () => {
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
    await cliquer(page, 'Commencer'); // intro → Comptes : les comptes de l'exemple sont semés
    await pause(250);
  }, 120_000);

  afterAll(async () => {
    await page?.close();
    await site?.fermer();
  });

  it('[niveau 4] l’étape Comptes garde le texte de D43 : des comptes bancaires réels, dont on reçoit un relevé, en deux phrases', async () => {
    const texte = await page.evaluate(() => {
      const titre = [...document.querySelectorAll('h2')].find((h) => (h.textContent ?? '').includes('Vos comptes en banque'));
      return (titre?.nextElementSibling?.textContent ?? '').replace(/\s+/g, ' ').trim();
    });
    expect(texte).toContain('comptes bancaires réels');
    expect(texte).toContain('dont vous recevez un relevé');
    expect((texte.match(/\./g) ?? []).length, texte).toBe(2);
  });

  it('[niveau 4] point 3 — le jour de paie choisi aux revenus, l’étape Comptes, en y revenant, dit la clôture à la veille de la période retenue', async () => {
    // Avant : le mois calendaire, la période du 20 septembre commence le 1er.
    expect(await detailDeLivretJeune(page)).toContain(shortDate(veille(1)));

    await cliquer(page, 'Suivant'); // → Revenus
    await pause(250);
    expect(await cliquer(page, 'Commencer au jour de ma paie')).toBe(true);
    await pause(250);
    await cliquer(page, 'Précédent'); // → Comptes
    await pause(250);

    const detail = await detailDeLivretJeune(page);
    expect(detail, 'la période commence le 28 : la clôture est la veille').toContain(shortDate(veille(28)));
    expect(detail).not.toContain(shortDate(veille(1)));
  });

  it('[niveau 4] point 3 — validé, « Livret jeune » est clos dans le projet la veille du premier jour de la période retenue', async () => {
    for (let i = 0; i < 6; i++) {
      await cliquer(page, 'Suivant'); // Comptes → Revenus → … → Résumé
      await pause(250);
    }
    expect(await cliquer(page, 'Valider mon budget')).toBe(true);
    await pause(400);
    expect(await clotureDansComptes(page)).toBe(veille(28));
  }, 60_000);
});
