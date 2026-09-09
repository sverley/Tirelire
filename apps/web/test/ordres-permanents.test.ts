/**
 * Garde de la dernière étape de l'assistant : « Vos ordres permanents » (D58).
 *
 * Ce que le test tient : l'assistant ne s'arrête plus sur le résumé du budget, mais sur ce qu'il
 * faut aller faire à la banque — un bloc par compte cible, le montant permanent, le libellé exact
 * tel qu'il sera tronqué, le détail des tirelires servies, et un bouton qui enregistre le virement
 * attendu sans jamais l'avoir fait d'office.
 *
 * Sans cette garde, l'étape se viderait au premier remaniement de l'exemple ou du calcul des
 * virements sans que rien ne le dise : c'est précisément ce qui était arrivé au jeu d'exemple.
 *
 * Plomberie commune dans `harnais.ts` : navigateur, site construit et servi, exemple chargé.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from './harnais.js';

/** Le plus petit côté acceptable pour une cible tactile, en pixels CSS (D55). */
const CIBLE = 44;

/** Ce que l'étape montre, mesuré dans la page. */
function lire(cible: number) {
  const texte = (document.body.textContent ?? '').replace(/\s+/g, ' ');
  const bouton = (t: string) => [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes(t));
  const de = document.documentElement;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  return {
    texte,
    libellés: [...document.querySelectorAll('code')].map((c) => (c.textContent ?? '').trim()),
    aEnregistrer: bouton('Enregistrer ce virement attendu'),
    aMettreÀJour: bouton('Mettre à jour le virement attendu'),
    débordement: de.scrollWidth - de.clientWidth,
    // La barre d'étapes est hors du compte : ses pastilles font 29 px de haut et précèdent cette
    // étape — c'est une garde à part, sur tout l'assistant, pas une dette de ce qu'on ajoute ici.
    petitesCibles: [...document.querySelectorAll('button, a[href], select')]
      .filter(visible)
      .filter((el) => !el.closest('.wizard-steps'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height < cible - 0.5 || r.width < cible - 0.5;
      })
      .map((el) => `${(el.textContent ?? '').trim().slice(0, 30)} — ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`),
  };
}

describe.skipIf(!navigateur)('assistant : dernière étape « Vos ordres permanents »', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);

  afterAll(async () => {
    await site?.fermer();
  });

  /** Ouvre l'assistant sur sa dernière étape, à la largeur d'un téléphone. */
  async function ouvrirLÉtape(): Promise<Page> {
    const page = await ouvrirLExemple(site);
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Lancer'), "l'assistant est introuvable depuis Configuration").toBe(true);
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Construire mon budget');
    expect(await cliquer(page, 'Ordres permanents'), "l'étape des ordres permanents est introuvable").toBe(true);
    await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Vos ordres permanents'));
    return page;
  }

  it('montre le montant permanent, son libellé tronqué et les tirelires servies', async () => {
    const page = await ouvrirLÉtape();
    const r = await page.evaluate(lire, CIBLE);
    await page.close();

    // Le virement de l'exemple : 650 € vers le Livret A, servant quatre tirelires.
    expect(r.libellés).toContain('TIRELIRE LIVRET A');
    for (const l of r.libellés) expect(l.length, `libellé plus long que ce qu'une banque accepte : ${l}`).toBeLessThanOrEqual(35);
    expect(r.texte).toContain('650,00');
    for (const nom of ['Épargne de précaution', 'Vacances', 'Taxe foncière', 'Assurance auto']) {
      expect(r.texte, `la tirelire « ${nom} » n'apparaît pas dans le détail du virement`).toContain(nom);
    }
    // Le complément exceptionnel du mois est distingué du permanent, jamais fondu dedans.
    expect(r.texte).toContain('Rattrapage');
  }, 60_000);

  it("n'enregistre rien d'office, et enregistre sur appui", async () => {
    const page = await ouvrirLÉtape();
    const avant = await page.evaluate(lire, CIBLE);
    expect(avant.aEnregistrer, 'le bouton d’enregistrement manque').toBe(true);
    expect(avant.aMettreÀJour, 'un virement attendu existait déjà : il a donc été enregistré d’office').toBe(false);

    expect(await cliquer(page, 'Enregistrer ce virement attendu')).toBe(true);
    const après = await page.evaluate(lire, CIBLE);
    await page.close();

    expect(après.aMettreÀJour, "le virement attendu n'a pas été enregistré").toBe(true);
    expect(après.aEnregistrer, 'un second virement attendu reste proposé pour le même compte').toBe(false);
  }, 60_000);

  it('tient dans 375 px, sans cible sous le doigt trop petite', async () => {
    const page = await ouvrirLÉtape();
    const r = await page.evaluate(lire, CIBLE);
    await page.close();

    expect(r.débordement, 'l’étape déborde latéralement à 375 px').toBeLessThanOrEqual(0);
    expect(r.petitesCibles, `cibles sous ${CIBLE} px sur l'étape des ordres permanents`).toEqual([]);
  }, 60_000);
});
