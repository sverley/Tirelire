/**
 * Harnais d'audit de #393 — ce que l'écran Flux garde de l'action d'un flux (point 11), à 375 px.
 * Le cœur est gardé par `packages/core/test/action-du-flux-harnais.test.ts`.
 *
 * Écrit par l'auditeur : aucun test du codeur ne tranche « modifier un flux depuis lui ne retire pas
 * les parts de son action ». Sur l'exemple, l'ordre vers le Livret A s'enregistre depuis le Plan
 * avec la ventilation proposée ; on le modifie ensuite à l'écran Flux, en cochant le verrouillage :
 * le fichier conservé garde ses parts, et son action porte l'état demandé.
 *
 * Niveau 0 (D83) : des parts retirées en douce sont une ventilation que l'utilisateur a validée,
 * perdue ; corriger le code ne la rend pas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LedgerStore, type PlannedFlow } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** L'ordre vers le Livret A, lu dans le fichier que l'application a conservé. */
async function ordreConservé(page: Page): Promise<PlannedFlow | undefined> {
  await pause(1200); // l'application conserve le fichier un instant après la dernière écriture
  const b64 = await page.evaluate(
    () =>
      new Promise<string | null>((ok) => {
        const req = indexedDB.open('tirelire');
        req.onerror = () => ok(null);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('files')) return (db.close(), ok(null));
          const get = db.transaction('files', 'readonly').objectStore('files').get('ledger.sqlite');
          get.onerror = () => (db.close(), ok(null));
          get.onsuccess = () => {
            db.close();
            const v = get.result as Uint8Array | undefined;
            if (!(v instanceof Uint8Array)) return ok(null);
            let s = '';
            for (let i = 0; i < v.length; i += 0x8000) s += String.fromCharCode(...v.subarray(i, i + 0x8000));
            ok(btoa(s));
          };
        };
      }),
  );
  expect(b64, 'le fichier de l’application est introuvable').not.toBeNull();
  const store = await LedgerStore.create({ sqlJs: SQL, bytes: new Uint8Array(Buffer.from(b64!, 'base64')) });
  const flux = store.load().plannedFlows.find((f) => !f.deletedAt && f.kind === 'transfer' && f.counterpartAccountId === 'acc-livret');
  store.close();
  return flux;
}

/** Clique un bouton de la carte du Livret A, à l'écran Plan. */
async function cliquerDansLaCarte(page: Page, texte: string): Promise<boolean> {
  const ok = await page.evaluate((t: string) => {
    const c = [...document.querySelectorAll('.card')].find((x) => x.querySelector(':scope > .row strong')?.textContent?.trim() === 'Livret A');
    const b = c && [...c.querySelectorAll('button')].find((x) => x.textContent?.trim() === t);
    (b as HTMLButtonElement | undefined)?.click();
    return !!b;
  }, texte);
  await pause(250);
  return ok;
}

describe.skipIf(!navigateur)('[niveau 0] #393 · 11. modifier un ordre à l’écran Flux ne retire pas les parts de son action', () => {
  let site: Site;
  let page: Page;

  beforeAll(async () => {
    site = await ouvrirLeSite();
    page = await ouvrirLExemple(site, 375, 812);
  });
  afterAll(async () => {
    await site?.fermer();
  });

  it('enregistré depuis le Plan avec ses parts, modifié et verrouillé à l’écran Flux : ses parts restent', async () => {
    expect(await cliquerDansLaCarte(page, 'Corriger mon ordre'), 'bouton « Corriger mon ordre » absent').toBe(true);
    expect(await cliquerDansLaCarte(page, 'Enregistrer'), 'bouton « Enregistrer » absent').toBe(true);
    const enregistré = await ordreConservé(page);
    const parts = enregistré?.action?.allocation;
    expect(parts?.length, 'l’ordre enregistré depuis le Plan ne porte pas de parts').toBeGreaterThan(0);

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
    const enregistréIci = await page.evaluate(() => {
      const f = document.querySelector('form.edit') as HTMLFormElement | null;
      const coche = [...(f?.querySelectorAll('label') ?? [])].find((l) => l.textContent?.includes('Verrouiller'))?.querySelector('input') as HTMLInputElement | null;
      if (!f || !coche) return false;
      if (!coche.checked) coche.click();
      (f.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      return true;
    });
    expect(enregistréIci, 'formulaire du flux introuvable').toBe(true);

    const modifié = await ordreConservé(page);
    expect(modifié?.id).toBe(enregistré!.id);
    expect(modifié?.action?.allocation).toEqual(parts);
    expect(modifié?.action?.state).toBe('lock');
  });
});
