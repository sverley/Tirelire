/**
 * Garde du filtre d'état des écrans de cartes (D56).
 *
 * Ce que le test tient : après « Charger l'exemple », les trois écrans de cartes offrent leurs
 * interrupteurs d'état, ce qui est clos part rangé, et chaque interrupteur montre ou masque ce
 * qu'il annonce sans toucher aux autres. Sans cette garde, la fonction se perdrait au premier
 * remaniement de l'exemple — un jeu de données sans rien de clos ni d'à venir fait disparaître la
 * barre sans qu'aucun test ne s'en aperçoive.
 *
 * Plomberie commune dans `harnais.ts` : navigateur, site construit et servi, exemple chargé.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from './harnais.js';

/** Noms des cartes affichées, interrupteurs et pastilles d'état. Exécuté dans le navigateur. */
function lire() {
  const texte = (el: Element | null | undefined) => (el?.textContent ?? '').trim().replace(/\s+/g, ' ');
  return {
    cartes: [...document.querySelectorAll('.card > .row > .label > strong')].map((e) => texte(e)),
    filtres: [...document.querySelectorAll('.filtre')].map((b) => texte(b)),
    allumés: [...document.querySelectorAll('.filtre.actif')].map((b) => texte(b)),
    pastilles: [...document.querySelectorAll('.pill.dim')].map((p) => texte(p)),
  };
}

describe.skipIf(!navigateur)('filtre d’état des écrans de cartes', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);

  afterAll(async () => {
    await site?.fermer();
  });

  /** Ouvre l'exemple sur un écran de Configuration, à la largeur d'un téléphone. */
  async function ouvrir(écran: string): Promise<Page> {
    const page = await ouvrirLExemple(site);
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, écran), `l'écran ${écran} est introuvable`).toBe(true);
    await page.waitForFunction((t) => document.querySelector('h1')?.textContent === t, {}, écran);
    return page;
  }

  /** Bascule un interrupteur d'état par son libellé. */
  async function basculer(page: Page, état: string): Promise<void> {
    const trouvé = await page.evaluate((t: string) => {
      const b = [...document.querySelectorAll('.filtre')].find((x) => (x.textContent ?? '').trim().startsWith(t));
      if (!b) return false;
      (b as HTMLButtonElement).click();
      return true;
    }, état);
    expect(trouvé, `interrupteur « ${état} » introuvable`).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
  }

  it('l’écran Tirelires part sans les besoins clos, et les rend au premier clic', async () => {
    const page = await ouvrir('Tirelires');

    const départ = await page.evaluate(lire);
    expect(départ.filtres.some((f) => f.startsWith('Clos')), 'l’interrupteur « Clos » manque').toBe(true);
    expect(départ.allumés.some((f) => f.startsWith('En cours')), '« En cours » doit partir allumé').toBe(true);
    expect(départ.allumés.some((f) => f.startsWith('À venir')), '« À venir » doit partir allumé').toBe(true);
    expect(départ.allumés.some((f) => f.startsWith('Clos')), '« Clos » doit partir éteint').toBe(false);
    // L'exemple porte un budget révisé (D51) : « Divers et sorties » a un besoin clos, rangé au
    // départ, et un besoin en vigueur, qui garde la carte à l'écran.
    expect(départ.cartes).toContain('Divers et sorties');
    expect(départ.pastilles, 'rien de clos ne doit s’afficher au départ').not.toContain('clos');
    expect(départ.pastilles, 'ce qui vient reste lisible').toContain('à venir');

    await basculer(page, 'Clos');
    const avecClos = await page.evaluate(lire);
    expect(avecClos.pastilles, 'allumer « Clos » doit rendre le besoin clos').toContain('clos');
    expect(avecClos.pastilles, 'les autres interrupteurs ne bougent pas').toContain('à venir');

    // Éteindre le courant ne garde que les cartes qui portent du clos ou de l'à venir.
    await basculer(page, 'En cours');
    await basculer(page, 'À venir');
    const closSeul = await page.evaluate(lire);
    expect(closSeul.cartes).toContain('Divers et sorties');
    expect(closSeul.cartes, 'une tirelire sans rien de clos n’a rien à faire ici').not.toContain('Taxe foncière');
    expect(closSeul.pastilles.every((p) => p === 'clos'), 'seul le clos doit rester').toBe(true);

    await page.close();
  }, 60_000);

  it('l’écran Comptes range le compte clos, et le rend au premier clic', async () => {
    const page = await ouvrir('Comptes');

    const départ = await page.evaluate(lire);
    expect(départ.cartes).toContain('Compte courant');
    expect(départ.cartes, 'un compte clos ne se lit pas comme un compte ouvert').not.toContain('Livret jeune');
    expect(départ.filtres.some((f) => f.startsWith('Clos')), 'ce qui est masqué doit rester visible dans la barre').toBe(true);

    await basculer(page, 'Clos');
    const avecClos = await page.evaluate(lire);
    expect(avecClos.cartes).toContain('Livret jeune');
    expect(avecClos.cartes).toContain('Compte courant');

    await basculer(page, 'En cours');
    const closSeul = await page.evaluate(lire);
    expect(closSeul.cartes).toEqual(['Livret jeune']);

    await page.close();
  }, 60_000);

  it('l’écran Flux prévus masque ce qui n’a pas encore commencé quand on l’éteint', async () => {
    const page = await ouvrir('Flux prévus');

    const départ = await page.evaluate(lire);
    expect(départ.filtres.some((f) => f.startsWith('À venir')), 'l’interrupteur « À venir » manque').toBe(true);
    // L'exemple porte un salaire revalorisé à la paie de novembre (D51) : son successeur est à venir.
    expect(départ.pastilles).toContain('à venir');

    await basculer(page, 'À venir');
    const sansÀVenir = await page.evaluate(lire);
    expect(sansÀVenir.pastilles, 'éteindre « À venir » doit ranger le successeur').not.toContain('à venir');
    expect(sansÀVenir.cartes.length, 'les flux en vigueur restent').toBeGreaterThan(0);

    await page.close();
  }, 60_000);
});
