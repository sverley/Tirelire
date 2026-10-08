/**
 * #206, point 6 — Sur l'écran Plan, à 375 px, chaque libellé affiché pour un compte se lit en entier,
 * sans défilement horizontal de la page (C9), et se recopie sans capacité propre à une plateforme
 * (C2) : c'est du texte de la page, sélectionnable. L'exemple porte un ordre vers le Livret A,
 * enregistré sous « TIRELIRE LIVRET A » : c'est ce libellé que la carte du compte doit afficher.
 *
 * Test du codeur, de niveau 4 : l'auditeur y choisit le harnais.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allerÀ, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

describe.skipIf(!navigateur)('[niveau 4] #206 · le libellé enregistré se lit et se recopie à 375 px (point 6)', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);

  afterAll(async () => {
    await site?.fermer();
  });

  it('la carte du Livret A affiche le libellé de l’ordre, en entier, sélectionnable, sans déborder', async () => {
    const page = await ouvrirLExemple(site, 375);
    await allerÀ(page, 'Plan');
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const carte = [...document.querySelectorAll('.card')].find((c) => c.querySelector('.row .label strong')?.textContent?.trim() === 'Livret A');
      const sub = carte?.querySelector('.row .label .sub');
      const spans = sub ? [...sub.querySelectorAll('.num')] : [];
      return {
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        texte: sub?.textContent ?? '',
        libellés: spans.map((s) => s.textContent ?? ''),
        horsÉcran: spans.filter((s) => s.getBoundingClientRect().right > de.clientWidth + 0.5).length,
        sélection: spans.map((s) => getComputedStyle(s).userSelect),
      };
    });
    await page.close();

    expect(r.libellés).toEqual(['TIRELIRE LIVRET A']);
    expect(r.texte).toContain('libellé : TIRELIRE LIVRET A');
    expect(r.scrollWidth, 'défilement horizontal à 375 px').toBeLessThanOrEqual(r.clientWidth);
    expect(r.horsÉcran, 'un libellé sort de l’écran').toBe(0);
    expect(r.sélection.every((s) => s !== 'none'), 'un libellé ne se sélectionne pas').toBe(true);
  });
});
