/**
 * Harnais d'interface de la PR #19 contre le besoin de l'issue #14 (D57), à 375 px.
 *
 * Le cœur est gardé par `packages/core/test/flux-derives-besoin.test.ts`. Ici on vérifie ce que
 * Simon voit et touche, sur le site construit, à partir de l'exemple :
 * - le bouton de l'écran Plan **enregistre un fait** (le montant de l'ordre chez la banque), sans
 *   figer le calcul, et le plan **compare** l'ordre et le budget en disant lequel changer ;
 * - un ordre arrondi au-dessus dans le pas ne crie pas ; le pas se règle, et à zéro tout écart se dit ;
 * - le fait enregistré survit au rechargement ;
 * - un flux **dérivé** se reconnaît à l'écran Flux et ne s'y modifie pas à la main.
 *
 * Les montants ne sont pas figés : ce que le budget demande est relu à l'écran avant chaque geste.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from './harnais.js';

const COMPTE = 'Livret A';
const attendre = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/** « 1 234,56 € » → 123456 centimes. */
function centimes(texte: string): number {
  const m = texte.replace(/[\s\u00a0\u202f]/g, '').match(/-?−?\d+(?:,\d{1,2})?/);
  if (!m) return NaN;
  const signe = m[0].startsWith('-') || m[0].startsWith('−') ? -1 : 1;
  const [e, c = '0'] = m[0].replace(/^[-−]/, '').split(',');
  return signe * (Number(e) * 100 + Number(c.padEnd(2, '0')));
}
const euros = (c: number) => (c / 100).toFixed(2).replace('.', ',');

interface Carte {
  visible: boolean;
  lignes: Array<{ libellé: string; sous: string; montant: string }>;
  boutons: string[];
  formulaire?: { valeur: string; haut: number; bas: number };
}

/** Lit la carte de virement du compte, telle qu'affichée. */
async function carte(page: Page): Promise<Carte> {
  return page.evaluate((nom: string) => {
    const c = [...document.querySelectorAll('.card')].find((x) => x.querySelector(':scope > .row strong')?.textContent?.trim() === nom);
    if (!c) return { visible: false, lignes: [], boutons: [] };
    const lignes = [...c.querySelectorAll(':scope > .row')].map((r) => {
      const label = r.querySelector('.label');
      const sous = label?.querySelector('.sub')?.textContent?.trim() ?? '';
      const libellé = (label?.textContent ?? '').replace(sous, '').trim();
      return { libellé, sous, montant: r.querySelector(':scope > .num, :scope > div:last-child')?.textContent?.trim() ?? '' };
    });
    const boutons = [...c.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
    const f = c.querySelector('form');
    const input = f?.querySelector('input');
    const r = f?.getBoundingClientRect();
    return {
      visible: true,
      lignes,
      boutons,
      ...(f && input && r ? { formulaire: { valeur: (input as HTMLInputElement).value, haut: r.top, bas: r.bottom } } : {}),
    };
  }, COMPTE);
}

const ligne = (c: Carte, début: string) => c.lignes.find((l) => l.libellé.startsWith(début));
const alertesÀlÉcran = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('.warnings > div')].map((d) => d.textContent?.trim() ?? '').filter((t) => t.includes('ordre permanent')));

async function cliquerDansCarte(page: Page, texte: string): Promise<boolean> {
  const ok = await page.evaluate(
    (nom: string, t: string) => {
      const c = [...document.querySelectorAll('.card')].find((x) => x.querySelector(':scope > .row strong')?.textContent?.trim() === nom);
      const b = c && [...c.querySelectorAll('button')].find((x) => x.textContent?.trim() === t);
      (b as HTMLButtonElement | undefined)?.click();
      return !!b;
    },
    COMPTE,
    texte,
  );
  await attendre();
  return ok;
}

async function saisirMontant(page: Page, valeur: string): Promise<void> {
  await page.evaluate((v: string) => {
    const c = [...document.querySelectorAll('.card')].find((x) => x.querySelector(':scope > .row strong')?.textContent?.trim() === 'Livret A');
    const input = c?.querySelector('form input') as HTMLInputElement;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, valeur);
  await attendre(50);
}

describe.skipIf(!navigateur)('#14 · l’ordre permanent à l’écran, à 375 px', () => {
  let site: Site;
  let page: Page;
  const dialogues: string[] = [];

  beforeAll(async () => {
    site = await ouvrirLeSite();
    page = await ouvrirLExemple(site, 375, 812);
    page.on('dialog', (d) => {
      dialogues.push(d.message());
      void d.accept();
    });
  });
  afterAll(async () => {
    await site?.fermer();
  });

  let demandé = 0;

  it('le Plan montre ce que le budget demande, et propose d’enregistrer l’ordre', async () => {
    const c = await carte(page);
    expect(c.visible, `carte « ${COMPTE} » absente du Plan`).toBe(true);
    const permanent = ligne(c, 'Virement permanent');
    expect(permanent, 'ligne « Virement permanent » absente').toBeTruthy();
    demandé = centimes(permanent!.montant);
    expect(demandé).toBeGreaterThan(0);
    expect(ligne(c, 'Ordre permanent chez la banque')).toBeUndefined();
    expect(c.boutons).toContain('Enregistrer mon ordre permanent');
  });

  it('le bouton ouvre une saisie dans la carte, visible, préremplie au pas au-dessus', async () => {
    expect(await cliquerDansCarte(page, 'Enregistrer mon ordre permanent')).toBe(true);
    await attendre(400);
    const c = await carte(page);
    expect(dialogues, 'une boîte de confirmation fige-t-elle encore un calcul ?').toEqual([]);
    expect(c.formulaire, 'aucune saisie ouverte dans la carte').toBeTruthy();
    expect(c.formulaire!.haut).toBeGreaterThanOrEqual(0);
    expect(c.formulaire!.bas).toBeLessThanOrEqual(812);
    const proposé = centimes(c.formulaire!.valeur);
    expect(proposé % 1000).toBe(0);
    expect(proposé).toBeGreaterThanOrEqual(demandé);
    expect(proposé - demandé).toBeLessThan(1000);
  });

  it('Annuler n’enregistre rien', async () => {
    expect(await cliquerDansCarte(page, 'Annuler')).toBe(true);
    const c = await carte(page);
    expect(c.formulaire).toBeUndefined();
    expect(ligne(c, 'Ordre permanent chez la banque')).toBeUndefined();
  });

  it('un ordre posé trop court s’enregistre tel quel, et le plan dit lequel changer', async () => {
    await cliquerDansCarte(page, 'Enregistrer mon ordre permanent');
    const posé = demandé - 5000;
    await saisirMontant(page, euros(posé));
    await cliquerDansCarte(page, 'Enregistrer');
    const c = await carte(page);
    expect(c.formulaire).toBeUndefined();
    // Le fait enregistré est celui qui a été saisi, pas ce que le budget demande.
    expect(centimes(ligne(c, 'Ordre permanent chez la banque')?.montant ?? '')).toBe(posé);
    expect(centimes(ligne(c, 'Virement permanent')?.montant ?? '')).toBe(demandé);
    expect(ligne(c, 'Ordre permanent chez la banque')?.sous).toMatch(/banque/);
    const [alerte, ...autres] = await alertesÀlÉcran(page);
    expect(autres).toEqual([]);
    expect(alerte).toContain(COMPTE);
    expect(alerte).toContain(euros(posé));
    expect(alerte).toContain(euros(demandé));
    expect(c.boutons).toContain('Corriger mon ordre');
  });

  it('le fait enregistré survit au rechargement', async () => {
    // La sauvegarde dans IndexedDB part 400 ms après la dernière écriture (db.ts).
    await attendre(1200);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Tirelires'));
    const c = await carte(page);
    expect(centimes(ligne(c, 'Ordre permanent chez la banque')?.montant ?? '')).toBe(demandé - 5000);
  });

  it('corrigé à un montant arrondi au-dessus, l’ordre ne crie plus', async () => {
    await cliquerDansCarte(page, 'Corriger mon ordre');
    await saisirMontant(page, euros(demandé + 500));
    await cliquerDansCarte(page, 'Enregistrer');
    const c = await carte(page);
    expect(centimes(ligne(c, 'Ordre permanent chez la banque')?.montant ?? '')).toBe(demandé + 500);
    expect(await alertesÀlÉcran(page)).toEqual([]);
    // Un seul ordre : la correction remplace le fait, elle n'en ajoute pas un second.
    expect(c.lignes.filter((l) => l.libellé.startsWith('Ordre permanent chez la banque'))).toHaveLength(1);
  });

  it('à l’écran Flux, l’ordre est marqué dérivé et ne s’ouvre pas à la main', async () => {
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Flux prévus')).toBe(true);
    const flux = await page.evaluate(() =>
      [...document.querySelectorAll('.row')]
        .filter((r) => r.querySelector('strong')?.textContent?.includes('Virement'))
        .map((r) => ({ texte: r.textContent ?? '', boutons: [...r.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '') })),
    );
    expect(flux, 'le flux de l’ordre permanent n’apparaît pas à l’écran Flux').toHaveLength(1);
    expect(flux[0]!.texte).toContain('dérivé du budget');
    expect(flux[0]!.boutons).not.toContain('Modifier');
    expect(flux[0]!.boutons).toContain('Voir dans le Plan');
    // Les flux déclarés, eux, restent modifiables.
    const déclarés = await page.evaluate(() =>
      [...document.querySelectorAll('.row')].filter((r) => r.textContent?.includes('Salaire') && r.querySelector('button')).map((r) => [...r.querySelectorAll('button')].map((b) => b.textContent?.trim())),
    );
    expect(déclarés.length).toBeGreaterThan(0);
    for (const b of déclarés) expect(b).toContain('Modifier');
    expect(await cliquer(page, 'Voir dans le Plan')).toBe(true);
    expect((await carte(page)).visible).toBe(true);
  });

  it('le pas d’arrondi se règle : à zéro, le moindre écart se dit', async () => {
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Réglages')).toBe(true);
    const ok = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((x) => x.textContent?.includes('Arrondi des ordres permanents'));
      const card = h?.nextElementSibling;
      const input = card?.querySelector('input') as HTMLInputElement | null;
      const bouton = card?.querySelector('button') as HTMLButtonElement | null;
      if (!input || !bouton) return false;
      input.value = '0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      bouton.click();
      return true;
    });
    expect(ok, 'réglage « Arrondi des ordres permanents » introuvable').toBe(true);
    await attendre();
    await allerÀ(page, 'Plan');
    const alertes = await alertesÀlÉcran(page);
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toContain(euros(demandé + 500));
  });
});
