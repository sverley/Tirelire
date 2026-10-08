/**
 * Tests du codeur de #394 — l'écran Plan valide un ordre avec sa ventilation, à 375 px, sur l'exemple.
 * L'exemple porte un ordre vers le Livret A décalé de ce que le budget demande (D60) : la carte
 * propose l'ordre du plan (point 5) ; on le confirme, le relit après rechargement (point 8), puis on
 * corrige ses parts au panneau (point 4). Un ordre retiré à l'écran Flux rend la proposition d'un
 * compte sans ordre (point 2).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LedgerStore, type PlannedFlow } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Les ordres vers le Livret A, lus dans le fichier que l'application a conservé. */
async function ordresConservés(page: Page): Promise<PlannedFlow[]> {
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
  const flux = store.load().plannedFlows.filter((f) => !f.deletedAt && f.kind === 'transfer' && f.counterpartAccountId === 'acc-livret');
  store.close();
  return flux;
}

interface Carte { texte: string; boutons: string[]; parts: string[]; largeur: number; débord: boolean }
async function carte(page: Page): Promise<Carte> {
  return page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find((x) => x.querySelector(':scope > .row strong')?.textContent?.trim() === 'Livret A') as HTMLElement | undefined;
    if (!c) return { texte: '', boutons: [], parts: [], largeur: 0, débord: true };
    return {
      texte: c.innerText,
      boutons: [...c.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? ''),
      parts: [...c.querySelectorAll('.ventilation .row')].map((r) => (r as HTMLElement).innerText.replace(/\s+/g, ' ')),
      largeur: c.getBoundingClientRect().right,
      débord: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}
async function cliquerDansLaCarte(page: Page, texte: string): Promise<boolean> {
  const ok = await page.evaluate((t: string) => {
    const c = [...document.querySelectorAll('.card')].find((x) => x.querySelector(':scope > .row strong')?.textContent?.trim() === 'Livret A');
    const b = c && [...c.querySelectorAll('button')].find((x) => x.textContent?.trim() === t);
    if (!b) return false;
    const r = b.getBoundingClientRect();
    if (r.right > window.innerWidth || r.width === 0) return false;
    (b as HTMLButtonElement).click();
    return true;
  }, texte);
  await pause(300);
  return ok;
}

describe.skipIf(!navigateur)('[niveau 4] #394 · l’écran Plan valide un ordre avec sa ventilation, à 375 px', () => {
  let site: Site;
  let page: Page;
  beforeAll(async () => {
    site = await ouvrirLeSite();
    page = await ouvrirLExemple(site, 375, 812);
  });
  afterAll(async () => {
    await site?.fermer();
  });

  it('5, 6 — l’écart se propose : l’ordre du plan et sa ventilation, en regard de l’ordre enregistré ; rien n’est écrit', async () => {
    const avant = await ordresConservés(page);
    const c = await carte(page);
    expect(c.boutons).toContain('Confirmer mon nouvel ordre');
    expect(c.boutons).toContain('Corriger mon ordre');
    expect(c.texte).toContain('Ordre que le plan propose');
    expect(c.parts.length).toBeGreaterThan(0);
    expect(c.débord).toBe(false);
    expect(await ordresConservés(page)).toEqual(avant);
  });

  it('5, 8 — « Confirmer mon nouvel ordre » l’enregistre tel qu’il est montré ; relu après rechargement', async () => {
    const [avant] = await ordresConservés(page);
    expect(await cliquerDansLaCarte(page, 'Confirmer mon nouvel ordre')).toBe(true);
    await page.reload({ waitUntil: 'networkidle0' });
    await allerÀ(page, 'Plan');
    const [après] = await ordresConservés(page);
    expect(après!.id).toBe(avant!.id);
    expect(après!.periodicity).toEqual(avant!.periodicity);
    expect(Math.abs(après!.amount)).toBeGreaterThan(Math.abs(avant!.amount));
    expect(après!.action?.allocation?.length).toBeGreaterThan(0);
    const c = await carte(page);
    expect(c.boutons).not.toContain('Confirmer mon nouvel ordre');
    expect(c.texte).toContain(après!.name);
  });

  it('4 — le panneau refuse un pourcentage au-dessus de 100, puis écrit exactement ce qu’il montre', async () => {
    expect(await cliquerDansLaCarte(page, 'Corriger mon ordre')).toBe(true);
    const titre = await page.evaluate(() => document.querySelector('.panneau-ventilation .titre-panneau')?.textContent ?? '');
    expect(titre).toMatch(/Corriger mon ordre — Virement Livret A/);
    // Première part en pourcentage à 150 : refusé.
    await page.evaluate(() => {
      const f = document.querySelector('.panneau-ventilation')!;
      const sel = f.querySelectorAll('fieldset')[0]!.querySelectorAll('select')[2] as HTMLSelectElement;
      sel.value = 'percent';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await pause(100);
    await page.evaluate(() => {
      const i = document.querySelector('.panneau-ventilation fieldset input') as HTMLInputElement;
      i.value = '150';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      (document.querySelector('.panneau-ventilation button[type="submit"]') as HTMLButtonElement).click();
    });
    await pause(200);
    const err = await page.evaluate(() => document.querySelector('.panneau-ventilation .err')?.textContent ?? '');
    expect(err).toMatch(/ne dépasse pas 100/);
    const débord = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(débord).toBe(false);
    await page.evaluate(() => {
      const i = document.querySelector('.panneau-ventilation fieldset input') as HTMLInputElement;
      i.value = '40';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      (document.querySelector('.panneau-ventilation button[type="submit"]') as HTMLButtonElement).click();
    });
    await pause(200);
    const [ordre] = await ordresConservés(page);
    expect(ordre!.action?.allocation?.[0]?.share).toEqual({ kind: 'percent', pct: 40 });
    expect((await carte(page)).parts[0]).toMatch(/40 %/);
  });

  it('2 — sans ordre enregistré : l’ordre proposé, « Enregistrer mon ordre permanent » et « Modifier avant d’enregistrer »', async () => {
    page.once('dialog', (d) => void d.accept());
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Flux prévus')).toBe(true);
    const supprimé = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.row')].find((x) => x.querySelector('.label strong')?.textContent?.trim() === 'Virement Livret A');
      const b = r && [...r.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Supprimer');
      (b as HTMLButtonElement | undefined)?.click();
      return !!b;
    });
    expect(supprimé, 'bouton « Supprimer » de l’ordre absent').toBe(true);
    await pause(300);
    expect(await ordresConservés(page)).toEqual([]);
    await allerÀ(page, 'Plan');
    const c = await carte(page);
    expect(c.boutons).toContain('Enregistrer mon ordre permanent');
    expect(c.boutons).toContain('Modifier avant d’enregistrer');
    expect(c.texte).toContain('Ordre permanent proposé');
    expect(await cliquerDansLaCarte(page, 'Enregistrer mon ordre permanent')).toBe(true);
    const [nouveau] = await ordresConservés(page);
    expect(nouveau!.action?.allocation?.length).toBeGreaterThan(0);
  });
});
