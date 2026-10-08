/**
 * Harnais d'audit de #206 — point 6 : sur l'écran Plan, à 375 px, chaque libellé affiché pour un
 * compte se lit en entier, sans défilement horizontal de la page (C9), et se recopie sans capacité
 * propre à une plateforme (C2). Côté cœur : `packages/core/test/libelle-ordre-renommage-harnais.test.ts`.
 *
 * Repris du test du codeur (`libelle-ordre-renommage.test.ts`), que j'ai complété : son libellé,
 * « TIRELIRE LIVRET A », tenait dans l'écran sans rien éprouver. Ici, le motif de l'ordre de l'exemple
 * est changé à l'écran Flux en un libellé de 44 caractères sans espace, plus large que l'écran dans la
 * police de la page ; la carte du Livret A doit l'afficher en entier, sans déborder.
 *
 * Niveau (D83) : 1 — C2 et C9, tels qu'ils sont écrits.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const LONG = 'VIREMENTPERMANENTMAISONEPARGNELIVRETAFAMILLE';
const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

describe.skipIf(!navigateur)('[niveau 1] #206 · 6. le libellé enregistré se lit en entier et se recopie à 375 px', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);

  afterAll(async () => {
    await site?.fermer();
  });

  it('un libellé de 44 caractères sans espace, à la carte du Livret A : en entier, dans l’écran, sélectionnable', async () => {
    const page = await ouvrirLExemple(site, 375);
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Flux prévus')).toBe(true);
    const ouvert = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.row')].find((x) => x.querySelector('.label strong')?.textContent?.trim() === 'Virement Livret A');
      const b = r && [...r.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Modifier');
      (b as HTMLButtonElement | undefined)?.click();
      return !!b;
    });
    expect(ouvert, 'bouton « Modifier » absent de l’ordre').toBe(true);
    await pause(250);
    const enregistré = await page.evaluate((motif: string) => {
      const f = document.querySelector('form.edit') as HTMLFormElement | null;
      const champ = [...(f?.querySelectorAll('label') ?? [])].find((l) => l.textContent?.includes('Motif de libellé'))?.querySelector('input') as HTMLInputElement | null;
      if (!f || !champ) return false;
      champ.value = motif;
      champ.dispatchEvent(new Event('input', { bubbles: true }));
      (f.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      return true;
    }, LONG);
    expect(enregistré, 'formulaire du flux introuvable').toBe(true);
    await pause(250);
    await allerÀ(page, 'Plan');

    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const carte = [...document.querySelectorAll('.card')].find((c) => c.querySelector('.row .label strong')?.textContent?.trim() === 'Livret A');
      // Le libellé se lit avec l'ordre, à côté de son geste « Copier » (#13, point 6).
      const spans = carte ? [...carte.querySelectorAll('.libelle-a-copier .libelle')] : [];
      const bord = carte?.getBoundingClientRect().right ?? de.clientWidth;
      return {
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        libellés: spans.map((s) => s.textContent ?? ''),
        horsCarte: spans.filter((s) => [...s.getClientRects()].some((q) => q.right > Math.min(bord, de.clientWidth) + 0.5)).length,
        coupés: spans.filter((s) => {
          for (let e: Element | null = s; e && e !== carte; e = e.parentElement) {
            const st = getComputedStyle(e);
            if (st.textOverflow === 'ellipsis' || st.overflowX === 'hidden' || st.overflowX === 'clip') return true;
          }
          return false;
        }).length,
        sélection: spans.map((s) => getComputedStyle(s).userSelect),
      };
    });
    await page.close();

    expect(r.libellés, 'la carte n’affiche pas le libellé de l’ordre').toEqual([LONG]);
    expect(r.scrollWidth, 'défilement horizontal à 375 px').toBeLessThanOrEqual(r.clientWidth);
    expect(r.horsCarte, 'un libellé sort de sa carte ou de l’écran').toBe(0);
    expect(r.coupés, 'un libellé est rogné').toBe(0);
    expect(r.sélection.every((s) => s !== 'none'), 'un libellé ne se sélectionne pas').toBe(true);
  });
});
