/**
 * #321 · Sans opération, aucun écran ne présente l'import comme un préalable (D57, I3, I5, D85).
 *
 * Tests du codeur, de niveau 4 : l'écran Opérations sans opération (point 1), ce que l'écran Import
 * dit d'abord (point 2), le bandeau des opérations anciennes (point 3), et le vouvoiement des textes
 * que la tâche écrit (point 4).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/** Les formes du tutoiement qu'un texte vouvoyé ne porte pas (D85). */
const TUTOIEMENT = /\b(tu|te|toi|ton|ta|tes)\b|\bimporte un\b|\bsaisis\b/i;

/** Ce que montre l'écran : titre, boutons, champs, texte, onglet actif, débordement. */
const lireLÉcran = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main');
    return {
      h1: t(main?.querySelector('h1')),
      boutons: [...(main?.querySelectorAll('button') ?? [])].map(t),
      champs: main?.querySelectorAll('input, select, textarea').length ?? 0,
      texte: t(main),
      ongletActif: t(document.querySelector('.tabbar button.active')),
      deborde: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

/** Une base vide, l'application ouverte sur l'accueil. */
async function baseVide(site: Site): Promise<Page> {
  const page = await nouvellePage(site);
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent?.includes('Construire mon budget')));
  return page;
}

async function attendreTitre(page: Page, titre: string) {
  await page.waitForFunction((t: string) => document.querySelector('main h1')?.textContent?.replace(/\s+/g, ' ').trim() === t, { timeout: 5000 }, titre);
  await pause();
}

/** L'assistant mené jusqu'au bout avec ses valeurs par défaut : un budget, des comptes, aucune opération. */
async function menerLAssistant(page: Page) {
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
}

describe.skipIf(!navigateur)('[niveau 4] #321 · l’import, un enrichissement et non un préalable', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  });
  afterAll(async () => {
    await site?.fermer();
  });

  it('[niveau 4] point 1 — sans opération, Opérations le dit en une phrase et offre les deux moyens, au même rang, rien d’autre', async () => {
    const page = await baseVide(site);
    try {
      await allerÀ(page, 'Opérations');
      await attendreTitre(page, 'Opérations');
      const é = await lireLÉcran(page);
      expect(é.texte).toContain('votre budget et votre plan se tiennent sans elles');
      expect(é.texte).toContain("importées d'un relevé ou saisies");
      expect(é.texte).toContain('confronteront au réel');
      expect(é.boutons).toEqual(['Importer un relevé', 'Saisir une opération']);
      const classes = await page.$$eval('main [data-sans-operation] button', (bs) => bs.map((b) => b.className));
      expect(classes[0], 'les deux moyens au même rang').toBe(classes[1]);
      expect(é.champs, 'ni recherche, ni filtre, ni action').toBe(0);
      expect(é.texte).not.toMatch(/Recherche|Actions sur|Tout cocher|Non traitées/);
      expect(é.texte).not.toMatch(TUTOIEMENT);
      expect(é.deborde).toBe(false);

      expect(await cliquer(page, 'Saisir une opération')).toBe(true);
      await attendreTitre(page, 'Saisie');

      await allerÀ(page, 'Opérations');
      await attendreTitre(page, 'Opérations');
      expect(await cliquer(page, 'Importer un relevé')).toBe(true);
      await attendreTitre(page, "Import d'un relevé");
      expect((await lireLÉcran(page)).ongletActif).toContain('Import');
    } finally {
      await page.close();
    }
  });

  it('[niveau 4] point 1 — dès la première opération saisie, Opérations redevient l’écran d’aujourd’hui', async () => {
    const page = await baseVide(site);
    try {
      await menerLAssistant(page);
      await allerÀ(page, 'Opérations');
      await attendreTitre(page, 'Opérations');
      expect((await lireLÉcran(page)).boutons).toEqual(['Importer un relevé', 'Saisir une opération']);

      expect(await cliquer(page, 'Saisir une opération')).toBe(true);
      await attendreTitre(page, 'Saisie');
      expect(await cliquer(page, 'Saisir une opération')).toBe(true);
      await page.type('main input[placeholder="Dentiste"]', 'Boulangerie');
      await page.type('main input[placeholder="80,00"]', '4,20');
      expect(await cliquer(page, 'Enregistrer')).toBe(true);
      await pause(300);

      await allerÀ(page, 'Opérations');
      await attendreTitre(page, 'Opérations');
      const é = await lireLÉcran(page);
      expect(é.texte).toContain('Recherche');
      expect(é.texte).toContain('opération(s) sur 1 connues');
      expect(é.boutons.some((b) => b.startsWith('Actions sur'))).toBe(true);
      expect(é.boutons.some((b) => b.startsWith('Tout cocher'))).toBe(true);
      expect(é.texte).not.toContain('se tiennent sans elles');
    } finally {
      await page.close();
    }
  });

  it('[niveau 4] point 2 — Import dit d’abord ce que l’import apporte et que le budget n’en a pas besoin, puis son texte d’aujourd’hui', async () => {
    const page = await baseVide(site);
    try {
      await allerÀ(page, 'Import');
      await attendreTitre(page, "Import d'un relevé");
      const { texte } = await lireLÉcran(page);
      const ordre = [
        "de rapprocher vos opérations réelles d'un budget déjà construit",
        'de reconstruire un budget à partir de votre historique',
        'sans budget ni tirelire, de classer et d\'analyser vos dépenses par catégorie',
        "Votre budget, lui, n'en a pas besoin : il se construit et se lit sans aucun import.",
        "CSV ou Excel exporté de la banque ou de Linxo : le relevé du compte principal, celui par lequel tout transite. Le fichier est lu sur cet appareil et n'est envoyé nulle part. Un profil (colonnes, formats, correspondance des comptes) est mémorisé par type de fichier.",
      ].map((p) => texte.indexOf(p));
      expect(ordre.every((i) => i >= 0), `textes absents : ${texte.slice(0, 400)}`).toBe(true);
      expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
      const apport = await page.$eval('main [data-apport-import]', (e) => e.textContent ?? '');
      expect(apport).not.toMatch(TUTOIEMENT);
    } finally {
      await page.close();
    }
  });

  it('[niveau 4] point 3 — le bandeau des opérations anciennes propose d’importer ou de saisir, au même rang, en plus de « Lire au … »', async () => {
    const page = await ouvrirLExemple(site);
    try {
      // L'exemple s'arrête début septembre : lu plus d'un mois après, ses opérations sont anciennes.
      await page.$eval('header input[type=date]', (i) => {
        const champ = i as HTMLInputElement;
        champ.value = '2026-10-20';
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        champ.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await pause(300);
      const bandeau = await page.evaluate(() => {
        const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const carte = [...document.querySelectorAll('main .card.warn')].find((c) => t(c).includes('Dernière opération connue'));
        return carte
          ? { texte: t(carte), boutons: [...carte.querySelectorAll('button')].map((b) => ({ texte: t(b), classe: b.className })) }
          : null;
      });
      expect(bandeau, 'le bandeau des opérations anciennes doit paraître').not.toBeNull();
      expect(bandeau!.texte).toContain('mettez vos opérations à jour, en important un relevé ou en les saisissant, ou lisez à cette date');
      expect(bandeau!.texte).not.toMatch(TUTOIEMENT);
      const textes = bandeau!.boutons.map((b) => b.texte);
      expect(textes.slice(0, 2)).toEqual(['Importer un relevé', 'Saisir une opération']);
      expect(textes[2]).toMatch(/^Lire au /);
      expect(bandeau!.boutons[0]?.classe, 'importer et saisir au même rang').toBe(bandeau!.boutons[1]?.classe);

      expect(await cliquer(page, 'Saisir une opération')).toBe(true);
      await attendreTitre(page, 'Saisie');
    } finally {
      await page.close();
    }
  });
});
