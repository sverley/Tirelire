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
 * Arbitrage de Simon (10 septembre, PR #19) : le virement permanent s'affiche comme **une somme**,
 * celle des dotations mensuelles des tirelires placées sur le compte, avec un bouton « Détail » qui
 * montre la part de chaque tirelire et permet de diviser le virement en plusieurs. Les tirelires du
 * Livret A et leurs dotations viennent de l'exemple (Taxe foncière 100 €, Assurance auto 50 €,
 * Vacances 200 €, Épargne de précaution 300 €).
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

  it('le Plan montre les deux montants dès l’exemple, et dit lequel changer', async () => {
    // Le jeu d'exemple porte un ordre volontairement décalé (D58) : la banque vire 600 €, le
    // budget en demande 650. La comparaison est donc là sans qu'on ait rien saisi.
    const c = await carte(page);
    expect(c.visible, `carte « ${COMPTE} » absente du Plan`).toBe(true);
    const permanent = ligne(c, 'Virement permanent');
    expect(permanent, 'ligne « Virement permanent » absente').toBeTruthy();
    demandé = centimes(permanent!.montant);
    expect(demandé).toBeGreaterThan(0);
    const banque = ligne(c, 'Ordre permanent chez la banque');
    expect(banque, 'ligne « Ordre permanent chez la banque » absente').toBeTruthy();
    expect(centimes(banque!.montant)).toBeLessThan(demandé);
    expect(c.boutons).toContain('Corriger mon ordre');
    const [alerte] = await alertesÀlÉcran(page);
    expect(alerte).toContain(COMPTE);
  });

  it('le virement s’affiche comme une somme ; « Détail » montre la dotation de chaque tirelire', async () => {
    const TIRELIRES = ['Taxe foncière', 'Assurance auto', 'Vacances', 'Épargne de précaution'];
    const lignesTirelires = () =>
      page.evaluate((noms: string[]) => {
        const c = [...document.querySelectorAll('.card')].find((x) => x.querySelector(':scope > .row strong')?.textContent?.trim() === 'Livret A');
        if (!c) return [];
        return [...c.querySelectorAll('.row')]
          .filter((r) => (r as HTMLElement).offsetParent !== null)
          .map((r) => ({ label: r.querySelector('.label')?.firstChild?.textContent?.trim() ?? '', num: r.querySelector('.num')?.textContent?.trim() ?? '' }))
          .filter((l) => noms.includes(l.label));
      }, TIRELIRES);

    expect(await lignesTirelires(), 'la carte détaille déjà les tirelires au lieu d’afficher une somme').toEqual([]);
    const boutons = (await carte(page)).boutons;
    const détail = boutons.find((b) => /^détail/i.test(b));
    expect(détail, `pas de bouton « Détail » dans la carte (boutons : ${boutons.join(', ')})`).toBeTruthy();
    await cliquerDansCarte(page, détail!);

    const lignes = await lignesTirelires();
    expect(lignes.map((l) => l.label).sort()).toEqual([...TIRELIRES].sort());
    const parTirelire = Object.fromEntries(lignes.map((l) => [l.label, centimes(l.num)]));
    expect(parTirelire).toEqual({ 'Taxe foncière': 10000, 'Assurance auto': 5000, Vacances: 20000, 'Épargne de précaution': 30000 });
    expect(Object.values(parTirelire).reduce((a, b) => a + b, 0)).toBe(demandé);

    // Refermer, pour que la suite parte de la carte telle qu'elle s'ouvre.
    const refermer = (await carte(page)).boutons.find((b) => /^détail|masquer|fermer/i.test(b));
    if (refermer) await cliquerDansCarte(page, refermer);
  });

  it('le bouton ouvre une saisie dans la carte, visible, préremplie au pas au-dessus', async () => {
    expect(await cliquerDansCarte(page, 'Corriger mon ordre')).toBe(true);
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
    const avant = centimes((await carte(page)).lignes.find((l) => l.libellé.startsWith('Ordre permanent chez la banque'))?.montant ?? '');
    expect(await cliquerDansCarte(page, 'Annuler')).toBe(true);
    const c = await carte(page);
    expect(c.formulaire).toBeUndefined();
    // Le montant enregistré n'a pas bougé : rien n'a été écrit.
    expect(centimes(ligne(c, 'Ordre permanent chez la banque')!.montant)).toBe(avant);
  });

  it('un ordre posé trop court s’enregistre tel quel, et le plan dit lequel changer', async () => {
    await cliquerDansCarte(page, 'Corriger mon ordre');
    const posé = demandé - 7000;
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
    expect(centimes(ligne(c, 'Ordre permanent chez la banque')?.montant ?? '')).toBe(demandé - 7000);
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

  // Arbitrage du 10 septembre, suite : « simple pour le plus grand nombre, souple pour les
  // exigeants ». À rendre concrètes quand l'écran existe (les libellés ne sont pas encore choisis).
  it.todo('sans rien toucher, la carte montre une seule ligne de virement permanent et un seul ordre à poser');
  it.todo('depuis « Détail », diviser le virement ne demande pas de quitter la carte, et Annuler revient à la somme');
  it.todo('depuis « Détail », regrouper des tirelires en plusieurs ordres : chaque ordre affiche sa demande, son fait bancaire et son écart');
  it.todo('à 375 px, un compte divisé en quatre ordres reste lisible sans débordement');
  it.todo('à l’écran Flux, chaque ordre d’un compte divisé est un flux dérivé distinct, non modifiable à la main');
});
