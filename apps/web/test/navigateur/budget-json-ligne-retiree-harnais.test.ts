/**
 * Harnais d'audit de #409, côté écran — à 375 px puis sur ordinateur : un budget JSON qui porte un
 * ordre enregistré désignant une tirelire et un compte retirés, importé par l'adresse (#367) sur un
 * projet vierge. Le résumé de l'assistant dit les lignes qui entrent retirées, à part des ajouts
 * (point 5) ; les cartes des ordres montrent la part et le compte retirés (point 5, #407 point 8) ;
 * aucune ligne retirée ne se montre comme vivante (point 7) ; rien ne déborde (point 9) ; la
 * validation laisse le projet tel que le fichier le dit (point 6). Le cœur est dans
 * `packages/core/test/budget-json-ligne-retiree-harnais.test.ts` ; l'assistant sans navigateur, dans
 * `../budget-json-ligne-retiree-harnais.test.ts`.
 *
 * Le test est celui du codeur (`budget-json-ligne-retiree.test.ts`, déplacé ici en entier), classé par
 * la suite de questions de D83 : niveau 1, le résumé et la carte d'un ordre qui entre avec le fichier
 * (point 5, D40, I10), la validation qui garde chacune de ses parts (point 6, D60, I10) et C9 (point
 * 9). Vu rouge sur des mutations ciblées, dites dans la vérification de la PR.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LedgerStore, ecrireBudgetJson, exampleLedger, type Ledger } from '@tirelire/core';
import { navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
const RETIRE = '2026-09-02T10:00:00.000Z';
const ORDRE = 'flow-vir-livret';

/** L'exemple, Assurance auto (et son besoin) et la Carte enfants retirées ; un second ordre va vers la Carte enfants. */
function budget(): string {
  const l: Ledger = { ...exampleLedger(), operations: [], subOperations: [], shortfallAnswers: [] };
  l.tirelires = l.tirelires.map((t) => (t.id === 'env-auto' ? { ...t, deletedAt: RETIRE } : t));
  l.needs = l.needs.map((n) => (n.tirelireId === 'env-auto' ? { ...n, deletedAt: RETIRE } : n));
  l.accounts = l.accounts.map((a) => (a.id === 'acc-enfants' ? { ...a, deletedAt: RETIRE } : a));
  l.tirelires = l.tirelires.map((t) => (t.placement.some((p) => p.accountId === 'acc-enfants') ? { ...t, placement: [] } : t));
  const o = l.plannedFlows.find((f) => f.id === ORDRE)!;
  l.plannedFlows.push({ ...o, id: 'flow-vir-enfants', name: 'Virement enfants', counterpartAccountId: 'acc-enfants', amount: -10000, labelPattern: 'ENFANTS', action: {} });
  return JSON.stringify(ecrireBudgetJson(l));
}

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

interface Resume {
  entrees: string[];
  ajouts: string[];
  partsRetirees: string[];
  ordreEnfants: string;
  tireliresVivantes: string[];
  debord: boolean;
}
async function resume(page: Page): Promise<Resume> {
  return page.evaluate(() => {
    const t = (e: Element) => ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim();
    const cartes = [...document.querySelectorAll('.card.ordre')];
    const carte = (nom: string) => cartes.find((c) => t(c.querySelector('strong')!) === nom);
    const dort = [...document.querySelectorAll('h3')].find((h) => t(h) === 'Où dort chaque tirelire ?');
    const vivantes: string[] = [];
    for (let e = dort?.nextElementSibling; e && e.tagName !== 'H3'; e = e.nextElementSibling) if (e.matches('.card')) vivantes.push(t(e.querySelector('strong')!));
    return {
      entrees: [...document.querySelectorAll('.difference li.entree-retiree')].map(t),
      ajouts: [...document.querySelectorAll('.difference li')].filter((li) => t(li).startsWith('Ajouté ')).map(t),
      partsRetirees: [...(carte('Virement Livret A')?.querySelectorAll('.ventilation .row.retiree') ?? [])].map(t),
      ordreEnfants: carte('Virement enfants') ? t(carte('Virement enfants')!) : '',
      tireliresVivantes: vivantes,
      debord: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

describe.skipIf(!navigateur)('#409 · un budget JSON qui porte une tirelire et un compte retirés', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  });
  afterAll(async () => {
    await site?.fermer();
  });

  for (const [largeur, hauteur] of [
    [375, 812],
    [1280, 900],
  ] as const) {
    it(`[niveau 1] 5, 6, 7, 9 — à ${largeur} px : le résumé et les cartes les disent retirés ; validé, le projet est celui du fichier`, async () => {
      const page = await nouvellePage(site, largeur, hauteur);
      try {
        await page.goto(`${site.url}#budget=${encodeURIComponent(budget())}`, { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => document.body.textContent?.includes('Valider mon budget'), { timeout: 15_000 });
        await pause(400);
        const r = await resume(page);
        expect(r.entrees.some((l) => l.includes('« Assurance auto »'))).toBe(true);
        expect(r.entrees.some((l) => l.includes('« Carte enfants »'))).toBe(true);
        expect(r.ajouts.some((l) => l.includes('« Assurance auto »') || l.includes('« Carte enfants »'))).toBe(false);
        expect(r.partsRetirees.join(' ')).toContain('Assurance auto');
        expect(r.ordreEnfants).toContain('Carte enfants (compte retiré)');
        expect(r.tireliresVivantes).not.toContain('Assurance auto');
        expect(r.debord).toBe(false);

        // Au clavier : le bouton « Valider mon budget » s'atteint et se presse.
        const atteint = await page.evaluate(() => {
          const b = [...document.querySelectorAll('main button')].find((x) => (x.textContent ?? '').includes('Valider mon budget')) as HTMLButtonElement | undefined;
          b?.focus();
          return document.activeElement === b;
        });
        expect(atteint).toBe(true);
        await page.keyboard.press('Enter');
        await pause(500);
        const apres = await conserve(page);
        expect(apres.tirelires.find((t) => t.id === 'env-auto')).toMatchObject({ deletedAt: RETIRE });
        expect(apres.accounts.find((a) => a.id === 'acc-enfants')).toMatchObject({ deletedAt: RETIRE });
        expect(apres.plannedFlows.find((f) => f.id === ORDRE)!.action).toEqual(exampleLedger().plannedFlows.find((f) => f.id === ORDRE)!.action);
        expect(apres.plannedFlows.find((f) => f.id === 'flow-vir-enfants')!.deletedAt).toBeUndefined();
      } finally {
        await page.close();
      }
    }, 120_000);
  }
});
