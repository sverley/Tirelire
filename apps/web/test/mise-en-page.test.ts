/**
 * Garde de mise en page mobile.
 *
 * Le défaut corrigé le 8 septembre 2026 : `.num` interdisait le retour à la ligne, si bien que la
 * ligne « retenu … · croisière … · demandé … » d'une tirelire formait une boîte insécable plus
 * large que l'écran. Le document débordait (scrollWidth 462 pour un clientWidth de 375), la barre
 * d'onglets prenait cette largeur et son cinquième onglet sortait de l'écran.
 *
 * Ce test charge l'exemple dans un vrai navigateur et vérifie, à 320 et 375 px, que le document ne
 * défile pas latéralement et qu'aucun libellé ne recouvre le montant de sa ligne.
 *
 * Il lui faut un Chrome ou un Chromium déjà installé : `TIRELIRE_NAV` (ou `CHROME_BIN`,
 * `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`), sinon les emplacements habituels. Sans navigateur il
 * s'abstient, sauf si `TIRELIRE_STRICT` est posé — ce que fait l'intégration continue, pour
 * qu'une garde muette ne passe pas pour une garde verte.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from './harnais.js';

/** Ce que le test mesure dans la page, exécuté dans le navigateur. */
function mesurer() {
  const de = document.documentElement;
  /** Bord droit de l'encre d'un élément, et non de sa boîte : c'est le texte qui déborde. */
  const encre = (el: Element) => {
    const plage = document.createRange();
    plage.selectNodeContents(el);
    const bords = [...plage.getClientRects()].map((r) => r.right);
    return bords.length ? Math.max(...bords) : el.getBoundingClientRect().left;
  };
  const chevauchements: string[] = [];
  for (const ligne of document.querySelectorAll('.row')) {
    const libellé = ligne.querySelector(':scope > .label');
    if (!libellé) continue;
    const droite = encre(libellé);
    for (const voisin of [...ligne.children].filter((c) => c !== libellé)) {
      const gauche = voisin.getBoundingClientRect().left;
      // Une demi-pixel de marge : les arrondis de rendu ne sont pas un chevauchement.
      if (droite > gauche + 0.5) {
        chevauchements.push(`« ${(libellé.textContent ?? '').trim().slice(0, 40)} » ${Math.round(droite)} > ${Math.round(gauche)}`);
      }
    }
  }
  const barre = document.querySelector('.tabbar');
  const onglets = barre ? [...barre.querySelectorAll('button')] : [];
  return {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    chevauchements,
    // Chaque onglet doit être entièrement dans la fenêtre : sinon « Plus » est hors d'atteinte.
    ongletsHorsÉcran: onglets
      .filter((b) => b.getBoundingClientRect().right > de.clientWidth + 0.5)
      .map((b) => b.getAttribute('aria-label') ?? '?'),
  };
}

describe.skipIf(!navigateur)('mise en page mobile de l’écran Plan', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);

  afterAll(async () => {
    await site?.fermer();
  });

  for (const largeur of [320, 375]) {
    it(`ne déborde pas et ne se chevauche pas à ${largeur} px`, async () => {
      const page = await ouvrirLExemple(site, largeur);
      const r = await page.evaluate(mesurer);
      await page.close();

      expect(r.clientWidth).toBe(largeur);
      expect(r.scrollWidth, `défilement horizontal à ${largeur} px`).toBeLessThanOrEqual(r.clientWidth);
      expect(r.chevauchements, 'un libellé recouvre le montant de sa ligne').toEqual([]);
      expect(r.ongletsHorsÉcran, 'un onglet de la barre du bas sort de la fenêtre').toEqual([]);
    });
  }
});
