/**
 * Harnais d'audit de #407, côté écran — à 375 px, sur l'exemple : retirer une tirelire ou un compte,
 * depuis son écran ou dans l'assistant complet, laisse l'ordre enregistré « Virement Livret A » tel
 * qu'il est ; le Plan signale ce qui n'est plus demandé, et le résumé de l'assistant le dit avant la
 * validation. Le cœur est dans `packages/core/test/retrait-ordre-enregistre-harnais.test.ts` ;
 * l'assistant sans navigateur, dans `../retrait-ordre-enregistre-harnais.test.ts`. L'ordre proposé
 * sur un projet vierge, qui part avec son compte (point 3, #395), à l'écran : depuis #419, sans
 * navigateur, dans `../retrait-ordre-enregistre-ecran.test.ts`.
 *
 * Les tests sont ceux du codeur (`retrait-ordre-enregistre.test.ts`, déplacé ici en entier), classés
 * par la suite de questions de D83 ; est de l'auditeur le retrait d'un compte dans l'assistant
 * complet (points 2, 7 et 8 : seul il passe par le branchement de la section Comptes dans
 * `Wizard.svelte`). Niveau 0 : un retrait qui réécrirait l'ordre enregistré (points 1 et 2, D60,
 * I10) ; vus rouges sur le code de `main`, et le retrait d'une tirelire dans l'assistant sur une
 * mutation qui rend l'élagage aux ordres enregistrés.
 *
 * L'ordre (600 €) a trois parts fixes — Taxe foncière 100 €, Assurance auto 50 €, Vacances 150 € — et
 * la part variable d'Épargne de précaution. Chaque test dit, dans son titre, les points du « Fait
 * quand » qu'il tranche.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LedgerStore, type Ledger, type PlannedFlow } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
const ORDRE = 'flow-vir-livret';

/** Le projet, lu dans le fichier que l'application a conservé. */
async function conserve(page: Page): Promise<Ledger> {
  await pause(1200);
  const b64 = await page.evaluate(
    () =>
      new Promise<string | null>((ok) => {
        const req = indexedDB.open('tirelire');
        req.onerror = () => ok(null);
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction('files', 'readonly').objectStore('files').get('ledger.sqlite');
          get.onerror = () => (db.close(), ok(null));
          get.onsuccess = () => {
            db.close();
            const v = get.result as Uint8Array;
            let s = '';
            for (let i = 0; i < v.length; i += 0x8000) s += String.fromCharCode(...v.subarray(i, i + 0x8000));
            ok(btoa(s));
          };
        };
      }),
  );
  const store = await LedgerStore.create({ sqlJs: SQL, bytes: new Uint8Array(Buffer.from(b64!, 'base64')) });
  const l = store.load();
  store.close();
  return l;
}
const ordre = (l: Ledger): PlannedFlow | undefined => l.plannedFlows.find((f) => f.id === ORDRE && !f.deletedAt);
/** L'ordre sans le choix de le garder tel quel : ce que l'utilisateur a validé, montant et parts. */
const fait = (f: PlannedFlow | undefined) => {
  if (!f) return f;
  const { kept: _k, ...reste } = f;
  return reste;
};

interface Carte { texte: string; boutons: string[]; retirees: string[]; debord: boolean; horsEcran: string[] }
/** La carte du Livret A sur le Plan : son texte, ses gestes, les parts marquées comme retirées. */
async function carteDuPlan(page: Page): Promise<Carte> {
  return page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find((x) => x.querySelector(':scope > .row strong')?.textContent?.trim() === 'Livret A') as HTMLElement | undefined;
    const boutons = [...(c?.querySelectorAll('button') ?? [])] as HTMLElement[];
    return {
      texte: (c?.innerText ?? '').replace(/\s+/g, ' '),
      boutons: boutons.map((b) => b.textContent?.trim() ?? ''),
      retirees: [...(c?.querySelectorAll('.ordre-enregistre .ventilation .row.retiree') ?? [])].map((r) => (r as HTMLElement).innerText.replace(/\s+/g, ' ')),
      debord: document.documentElement.scrollWidth > window.innerWidth,
      horsEcran: boutons.filter((b) => b.getBoundingClientRect().right > window.innerWidth).map((b) => b.textContent?.trim() ?? ''),
    };
  });
}
const avertissements = (page: Page) => page.evaluate(() => [...document.querySelectorAll('.warnings li, .warnings .warn, .warnings > *')].map((w) => (w as HTMLElement).innerText.replace(/\s+/g, ' ')));
/** Va à une étape de l'assistant par son onglet. */
async function etape(page: Page, libelle: string): Promise<boolean> {
  const fait = await page.evaluate((l: string) => {
    const b = ([...document.querySelectorAll('.wizard-steps .wstep')] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').trim() === l);
    b?.click();
    return !!b;
  }, libelle);
  await pause(250);
  return fait;
}
async function ouvrirConfiguration(page: Page, partie: string) {
  await allerÀ(page, 'Plus');
  expect(await cliquer(page, partie)).toBe(true);
  await pause(200);
}

describe.skipIf(!navigateur)('#407 · un retrait laisse l’ordre enregistré, à 375 px', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  });
  afterAll(async () => {
    await site?.fermer();
  });

  it('[niveau 0] 1, 5, 9 — depuis l’écran Tirelires : l’ordre reste ; le Plan montre la part sous le nom de la tirelire, retirée, et offre ses gestes', async () => {
    const page = await ouvrirLExemple(site, 375, 812);
    const avant = ordre(await conserve(page));
    await ouvrirConfiguration(page, 'Tirelires');
    page.once('dialog', (d) => void d.accept());
    const retire = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.card.tirelire')].find((x) => (x.querySelector('input.nom') as HTMLInputElement | null)?.value === 'Assurance auto');
      const b = c?.querySelector('button[title="Retirer cette tirelire"]') as HTMLButtonElement | null;
      b?.click();
      return !!b;
    });
    expect(retire, 'bouton « Retirer cette tirelire » d’Assurance auto absent').toBe(true);
    await pause(300);
    const apres = await conserve(page);
    expect(apres.tirelires.find((t) => t.id === 'env-auto')?.deletedAt).toBeTruthy();
    expect(ordre(apres)).toEqual(avant);

    await allerÀ(page, 'Plan');
    await pause(300);
    const c = await carteDuPlan(page);
    expect(c.retirees).toHaveLength(1);
    expect(c.retirees[0]).toMatch(/Assurance auto/);
    expect(c.retirees[0]).toMatch(/tirelire retirée/);
    expect(c.boutons).toEqual(expect.arrayContaining(['Confirmer mon nouvel ordre', 'Garder mon ordre tel quel']));
    expect(c.debord).toBe(false);
    expect(c.horsEcran).toEqual([]);
    const w = (await avertissements(page)).filter((x) => x.includes('Assurance auto'));
    expect(w.some((x) => /Livret A/.test(x) && /retirée/.test(x) && /ne lui demande plus rien/.test(x) && /modifier chez votre banque, puis à confirmer ici/.test(x)), w.join(' | ')).toBe(true);

    // Garder l'ordre tel quel ne change ni son montant ni ses parts (#205, I10).
    expect(await cliquer(page, 'Garder mon ordre tel quel')).toBe(true);
    const garde = ordre(await conserve(page));
    expect(garde?.kept).toBeDefined();
    expect(fait(garde)).toEqual(fait(avant));
    await page.close();
  });

  it('[niveau 0] 2, 6, 9 — depuis l’écran Comptes : l’ordre reste ; le Plan montre la carte du compte retiré, l’ordre plus demandé, et ses gestes', async () => {
    const page = await ouvrirLExemple(site, 375, 812);
    const avant = ordre(await conserve(page));
    await ouvrirConfiguration(page, 'Comptes');
    page.once('dialog', (d) => void d.accept());
    const supprime = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.card')].find((x) => [...x.querySelectorAll('input')].some((i) => (i as HTMLInputElement).value === 'Livret A'));
      const b = c && [...c.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Supprimer');
      (b as HTMLButtonElement | undefined)?.click();
      return !!b;
    });
    expect(supprime, 'bouton « Supprimer » du Livret A absent').toBe(true);
    await pause(300);
    const apres = await conserve(page);
    expect(apres.accounts.find((a) => a.id === 'acc-livret')?.deletedAt).toBeTruthy();
    expect(ordre(apres)).toEqual(avant);

    await allerÀ(page, 'Plan');
    await pause(300);
    const c = await carteDuPlan(page);
    expect(c.texte).toMatch(/compte retiré/);
    expect(c.texte).toMatch(/plus demandé par le budget : à supprimer chez la banque, puis ici/);
    expect(c.texte).toMatch(/Virement Livret A/);
    expect(c.boutons).toEqual(expect.arrayContaining(['Supprimer l’ordre enregistré', 'Garder mon ordre tel quel']));
    expect(c.boutons).not.toContain('Enregistrer mon ordre permanent');
    expect(c.boutons).not.toContain('Confirmer mon nouvel ordre');
    expect(c.debord).toBe(false);
    expect(c.horsEcran).toEqual([]);
    const w = await avertissements(page);
    expect(w.some((x) => /Livret A/.test(x) && /compte retiré/.test(x) && /supprimer chez votre banque, puis ici/.test(x)), w.join(' | ')).toBe(true);

    // La suppression de l'ordre enregistré reste un geste de l'utilisateur, confirmé.
    page.once('dialog', (d) => void d.accept());
    expect(await cliquer(page, 'Supprimer l’ordre enregistré')).toBe(true);
    expect(ordre(await conserve(page))).toBeUndefined();
    await page.close();
  });

  it('[niveau 0] 1, 4, 7, 8, 9 — dans l’assistant complet : le résumé dit que l’ordre reste, sa carte montre la part retirée ; la validation l’écrit tel quel', async () => {
    const page = await ouvrirLExemple(site, 375, 812);
    const avant = ordre(await conserve(page));
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Lancer')).toBe(true);
    await pause(300);
    expect(await cliquer(page, 'Pas tous les mois')).toBe(true);
    await pause(200);
    const retire = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.card.tirelire')].find((x) => (x.querySelector('input.nom') as HTMLInputElement | null)?.value === 'Assurance auto');
      const b = c?.querySelector('button[title="Retirer cette tirelire"]') as HTMLButtonElement | null;
      b?.click();
      return !!b;
    });
    expect(retire, 'bouton « Retirer cette tirelire » d’Assurance auto absent dans l’assistant').toBe(true);
    await pause(200);
    expect(await cliquer(page, 'Résumé')).toBe(true);
    await pause(300);
    const resume = await page.evaluate(() => ({
      lignes: [...document.querySelectorAll('.difference .ordres-touches li')].map((l) => (l as HTMLElement).innerText.replace(/\s+/g, ' ')),
      retirees: [...document.querySelectorAll('.card.ordre .ventilation .row.retiree')].map((r) => (r as HTMLElement).innerText.replace(/\s+/g, ' ')),
      parts: document.querySelectorAll('.card.ordre .ventilation .row.part:not(.non-affecte)').length,
      debord: document.documentElement.scrollWidth > window.innerWidth,
    }));
    expect(resume.lignes).toHaveLength(1);
    expect(resume.lignes[0]).toMatch(/Virement Livret A/);
    expect(resume.lignes[0]).toMatch(/reste enregistré tel quel/);
    expect(resume.lignes[0]).toMatch(/« Assurance auto »/);
    expect(resume.lignes[0]).toMatch(/non affecté sur « Livret A »/);
    expect(resume.lignes[0]).toMatch(/le Plan la signalera/);
    expect(resume.retirees).toHaveLength(1);
    expect(resume.retirees[0]).toMatch(/Assurance auto/);
    expect(resume.parts, 'la carte de l’ordre enregistré ne montre pas ses quatre parts').toBe(4);
    expect(resume.debord).toBe(false);
    expect(await cliquer(page, 'Valider mon budget')).toBe(true);
    const apres = await conserve(page);
    expect(apres.tirelires.find((t) => t.id === 'env-auto')?.deletedAt).toBeTruthy();
    expect(ordre(apres)).toEqual(avant);
    await page.close();
  });
  it('[niveau 0] 2, 4, 7, 8, 9 — dans l’assistant complet, retirer un compte : le résumé dit que l’ordre reste, sa carte nomme le compte retiré ; la validation l’écrit tel quel', async () => {
    const page = await ouvrirLExemple(site, 375, 812);
    const avant = ordre(await conserve(page));
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Lancer')).toBe(true);
    await pause(300);
    expect(await etape(page, 'Comptes')).toBe(true);
    await pause(200);
    const retire = await page.evaluate(() => {
      const l = [...document.querySelectorAll('.ligne-compte')].find((x) => (x.querySelector('input') as HTMLInputElement | null)?.value === 'Livret A');
      const b = l?.querySelector('button[title="Retirer ce compte"]') as HTMLButtonElement | null;
      b?.click();
      return !!b;
    });
    expect(retire, 'bouton « Retirer ce compte » du Livret A absent dans l’assistant').toBe(true);
    await pause(200);
    expect(await etape(page, 'Résumé')).toBe(true);
    await pause(300);
    const resume = await page.evaluate(() => ({
      lignes: [...document.querySelectorAll('.difference .ordres-touches li')].map((l) => (l as HTMLElement).innerText.replace(/\s+/g, ' ')),
      cartes: [...document.querySelectorAll('.card.ordre')].map((c) => (c as HTMLElement).innerText.replace(/\s+/g, ' ')),
      debord: document.documentElement.scrollWidth > window.innerWidth,
    }));
    expect(resume.lignes).toHaveLength(1);
    expect(resume.lignes[0]).toMatch(/« Virement Livret A » vers « Livret A » reste enregistré tel quel/);
    expect(resume.lignes[0]).toMatch(/continue de virer chez votre banque/);
    expect(resume.lignes[0]).toMatch(/plus demandé/);
    expect(resume.cartes.filter((c) => /Virement Livret A/.test(c) && /Livret A \(compte retiré\)/.test(c)), resume.cartes.join(' | ')).toHaveLength(1);
    expect(resume.debord).toBe(false);
    expect(await cliquer(page, 'Valider mon budget')).toBe(true);
    const apres = await conserve(page);
    expect(apres.accounts.find((a) => a.id === 'acc-livret')?.deletedAt).toBeTruthy();
    expect(ordre(apres)).toEqual(avant);
    await page.close();
  });
});
