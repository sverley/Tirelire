/**
 * Harnais d'audit de #13 — à l'écran, à 375 px : ce qui n'existe que dans un navigateur (D83, « Le navigateur au
 * minimum ») : au résumé de l'assistant, « Copier » met le libellé dans le presse-papiers, ou le sélectionne sans lui
 * (point 6) ; renommé d'un nom long, le libellé de 35 caractères se lit en entier, à 375 px (point 8) ; une fois
 * l'assistant validé, l'écran Plan propose le même ordre — montant, ventilation, libellé, jour —, replie la suite, et se
 * lit à 375 px (points 2, 5, 7, 8). Repris des tests du codeur.
 *
 * Le parcours part d'une base vierge, avec les propositions de l'exemple ; l'ordre de l'exemple vers le Livret A est
 * retiré au résumé, et le budget en demande un, que le résumé dit. Le compte est ensuite renommé d'un nom long, pour un
 * libellé de 35 caractères, la longueur d'un libellé bancaire, puis l'assistant est validé. Les autres points de #13 à
 * l'écran — l'ordre de l'exemple déjà là, le bloc de l'ordre à poser sans geste qui l'enregistre, la validation qui
 * n'enregistre rien et mène au Plan, l'ordre enregistré depuis le Plan, rien à poser —, depuis #419, se vérifient sans
 * navigateur : `../ordres-a-poser-ecran.test.ts` ; ce que l'assistant calcule et dit : `../ordres-a-poser-harnais.test.ts`.
 *
 * Niveau (D83) : 1 — U3 (points 2, 5 : ce qui se pose est ce que l'import reconnaîtra), C2 (point 6), C9 (point 8).
 * Rouges vus sur le code de `main` et sur mutations : voir la vérification de l'auditeur.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
const NOM_LONG = 'Livret d’épargne populaire famille Dupont';
const LIBELLE_LONG = 'TIRELIRE LIVRET D EPARGNE POPULAIRE';

async function ouvrirLAssistant(site: Site): Promise<Page> {
  const page = await nouvellePage(site);
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
  await allerÀ(page, 'Plan');
  await cliquer(page, 'Construire mon budget');
  await pause(300);
  await cliquer(page, 'Commencer');
  await pause(250);
  return page;
}

async function etape(page: Page, libelle: string) {
  const fait = await page.evaluate((l: string) => {
    const b = ([...document.querySelectorAll('.wizard-steps .wstep')] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').trim() === l);
    b?.click();
    return !!b;
  }, libelle);
  expect(fait, `pas d’étape « ${libelle} »`).toBe(true);
  await pause(250);
}

/** Ce que dit un ordre, dans le bloc de l'assistant ou sur la carte du Plan : la même lecture des deux côtés. */
interface Ordre {
  montant: string;
  parts: string[];
  libelles: string[];
  jours: string[];
  boutons: string[];
}

async function blocsDeLAssistant(page: Page): Promise<Array<Ordre & { compte: string }>> {
  return page.evaluate(() => {
    const t = (s?: string | null) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
    return ([...document.querySelectorAll('main .card.ordre-a-poser')] as HTMLElement[]).map((c) => ({
      compte: t(c.querySelector(':scope > .row .label strong')?.textContent),
      montant: t(c.querySelector(':scope > .row > .num')?.textContent),
      parts: [...c.querySelectorAll('.ventilation .row')].map((r) => t((r as HTMLElement).innerText)),
      libelles: [...c.querySelectorAll('.libelle-a-copier .libelle')].map((x) => x.textContent ?? ''),
      jours: [...c.querySelectorAll('.consigne .jour')].map((x) => t(x.textContent)),
      boutons: [...c.querySelectorAll('button')].map((b) => t(b.textContent)),
    }));
  });
}

async function carteDuPlan(page: Page, compte: string, bloc: string): Promise<Ordre | null> {
  return page.evaluate(
    (nom: string, sel: string) => {
      const t = (s?: string | null) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
      const carte = [...document.querySelectorAll('main .card')].find((x) => t(x.querySelector(':scope > .row strong')?.textContent) === nom);
      const c = carte?.querySelector(sel) as HTMLElement | null | undefined;
      if (!c) return null;
      return {
        montant: t(c.querySelector(':scope > .row > .num')?.textContent),
        parts: [...c.querySelectorAll('.ventilation .row')].map((r) => t((r as HTMLElement).innerText)),
        libelles: [...c.querySelectorAll('.libelle-a-copier .libelle')].map((x) => x.textContent ?? ''),
        jours: [...c.querySelectorAll('.consigne .jour')].map((x) => t(x.textContent)),
        boutons: [...c.querySelectorAll('button')].map((b) => t(b.textContent)),
      };
    },
    compte,
    bloc,
  );
}

/** Rien ne déborde à 375 px, et chaque libellé se lit en entier, dans l'écran, sans être rogné (C9). */
async function lisible(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const libelles = [...document.querySelectorAll('.libelle-a-copier .libelle')] as HTMLElement[];
    const boutons = [...document.querySelectorAll('.libelle-a-copier button')] as HTMLElement[];
    const fautifs = [...document.querySelectorAll('main *')]
      .filter((e) => e.getBoundingClientRect().right > de.clientWidth + 0.5)
      .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}:${(e.textContent ?? '').trim().slice(0, 40)}`)
      .slice(0, 6);
    return {
      fautifs,
      deborde: de.scrollWidth > de.clientWidth,
      horsEcran: libelles.filter((s) => [...s.getClientRects()].some((q) => q.right > de.clientWidth + 0.5 || q.left < -0.5)).length,
      rognes: libelles.filter((s) => {
        for (let e: Element | null = s; e && e !== document.body; e = e.parentElement) {
          const st = getComputedStyle(e);
          if (st.textOverflow === 'ellipsis' || st.overflowX === 'hidden' || st.overflowX === 'clip') return true;
        }
        return false;
      }).length,
      boutonsPetits: boutons.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width < 44 || r.height < 44 || r.right > de.clientWidth + 0.5;
      }).length,
      selection: libelles.map((s) => getComputedStyle(s).userSelect),
    };
  });
}

/** Le presse-papiers de la page : il note ce qu'on y met, ou refuse tout. */
async function pressePapiers(page: Page, accepte: boolean) {
  await page.evaluate((ok: boolean) => {
    const w = window as unknown as { __copie13?: string[] };
    w.__copie13 = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (x: string) => (ok ? (w.__copie13!.push(x), Promise.resolve()) : Promise.reject(new Error('refusé'))) },
    });
  }, accepte);
}
const copies = (page: Page) => page.evaluate(() => (window as unknown as { __copie13?: string[] }).__copie13 ?? []);

describe.skipIf(!navigateur)('[niveau 1] #13 — les ordres à poser, de l’assistant au Plan, à 375 px', () => {
  let site: Site;
  let page: Page;
  let dansLAssistant: Ordre & { compte: string };

  beforeAll(async () => {
    site = await ouvrirLeSite();
    page = await ouvrirLAssistant(site);
    for (const e of ['Budgets', 'Pas tous les mois', 'Épargne', 'Résumé']) await etape(page, e);
    // L'ordre de l'exemple retiré au résumé : le budget demande l'ordre vers le Livret A, que les tests suivants lisent.
    expect(
      await page.evaluate(() => {
        const b = document.querySelector('main .card.ordre button[title="Retirer ce virement"]') as HTMLButtonElement | null;
        b?.click();
        return !!b;
      }),
    ).toBe(true);
    await pause(250);
  }, 120_000);
  afterAll(async () => {
    await page?.close();
    await site?.fermer();
  });

  it('6 — « Copier » met exactement le libellé dans le presse-papiers et le dit ; sans presse-papiers, rien n’est copié et le libellé est sélectionné', async () => {
    await pressePapiers(page, true);
    expect(await cliquer(page, 'Copier')).toBe(true);
    await pause(100);
    expect(await copies(page)).toEqual(['TIRELIRE LIVRET A']);
    expect(await page.evaluate(() => document.querySelector('main .libelle-a-copier [role="status"]')?.textContent?.trim())).toBe('Libellé copié.');
    await pressePapiers(page, false);
    expect(await cliquer(page, 'Copier')).toBe(true);
    await pause(100);
    expect(await copies(page)).toEqual([]);
    const echec = await page.evaluate(() => ({
      dit: document.querySelector('main .libelle-a-copier [role="status"]')?.textContent?.trim() ?? '',
      selection: window.getSelection()?.toString() ?? '',
    }));
    expect(echec.dit).toMatch(/^Rien n’a été copié/);
    expect(echec.selection).toBe('TIRELIRE LIVRET A');
  });

  it('8 — renommé d’un nom long, le libellé fait 35 caractères et se lit en entier, à 375 px', async () => {
    await etape(page, 'Comptes');
    const renomme = await page.evaluate((nom: string) => {
      const i = ([...document.querySelectorAll('main .ligne-compte input')] as HTMLInputElement[]).find((x) => x.value === 'Livret A');
      if (!i) return false;
      i.value = nom;
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, NOM_LONG);
    expect(renomme).toBe(true);
    await etape(page, 'Résumé');
    dansLAssistant = (await blocsDeLAssistant(page))[0]!;
    expect(dansLAssistant.compte).toBe(NOM_LONG);
    expect(dansLAssistant.libelles).toEqual([LIBELLE_LONG]);
    expect(LIBELLE_LONG.length).toBe(35);
    const l = await lisible(page);
    expect(l.fautifs).toEqual([]);
    expect(l).toMatchObject({ deborde: false, horsEcran: 0, rognes: 0, boutonsPetits: 0 });
    expect(l.selection.every((s) => s !== 'none')).toBe(true);
  });

  describe('une fois l’assistant validé', () => {
    beforeAll(async () => {
      expect(await cliquer(page, 'Valider mon budget')).toBe(true);
      await pause(400);
    });

    it('2, 5, 7, 8 — le Plan propose le même ordre, dit son jour, replie la suite, et se lit à 375 px', async () => {
      expect(await cliquer(page, 'Voir le plan')).toBe(true);
      await pause(300);
      const propose = await carteDuPlan(page, NOM_LONG, '.proposition');
      expect(propose, 'la carte du Plan ne propose pas d’ordre').not.toBeNull();
      const { compte: _c, boutons: _b, ...attendu } = dansLAssistant;
      const { boutons: _p, ...lu } = propose!;
      expect(lu).toEqual(attendu);
      const suite = await page.evaluate(() => {
        const d = document.querySelector('main details.explication-suite') as HTMLDetailsElement | null;
        return { replie: !!d && !d.open, texte: d?.querySelector('p')?.textContent ?? '' };
      });
      expect(suite.replie, 'le texte de la suite n’est pas replié sur le Plan').toBe(true);
      expect(suite.texte).toMatch(/non affecté/);
      expect(await lisible(page)).toMatchObject({ deborde: false, horsEcran: 0, rognes: 0, boutonsPetits: 0 });
    });
  });
});
