/**
 * Harnais d'audit de #394 — l'écran Plan valide un ordre avec sa ventilation, à 375 px, sur l'exemple.
 * Composé par l'auditeur à partir des tests du codeur (`ventilation-ordre-plan.test.ts`), complétés.
 *
 * L'exemple porte un ordre vers le Livret A décalé de ce que le budget demande (D60). Dans l'ordre :
 * rien ne s'écrit sans geste (I10) ; « Confirmer mon nouvel ordre » écrit l'ordre tel que la carte le
 * montre, relu après rechargement (points 5 et 8) ; le panneau refuse, puis écrit exactement ce qu'il
 * montre, et une part fixe en écart se marque et se propose (points 4, 5, 6) ; l'ordre retiré, la
 * carte propose, le panneau suit le montant tant qu'aucune part n'est touchée, et « Enregistrer mon
 * ordre permanent » écrit la proposition montrée (points 2 et 4). Partout, pas de débord (point 9).
 *
 * Niveaux (D83) : 0 pour ce qui écrit ou réécrit un ordre — un ordre altéré sans geste, ou autrement
 * que montré, est un fait bancaire faux que corriger le code ne rend pas ; 1 pour U2 et I4 (l'ordre
 * proposé s'enregistre en un geste avec sa ventilation) ; 2 pour la règle du panneau qui suit.
 * Rouges vus sur mutations du code de la PR : voir la vérification de l'auditeur dans la PR.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LedgerStore, type AllocationLine, type PlannedFlow } from '@tirelire/core';
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

/** « 1 234,56 € » → centimes. */
function centimes(texte: string): number {
  const m = texte.replace(/[\s  ]/g, '').match(/[-−]?\d+(?:,\d{1,2})?/);
  if (!m) return NaN;
  const signe = /^[-−]/.test(m[0]) ? -1 : 1;
  const [e, c = '0'] = m[0].replace(/^[-−]/, '').split(',');
  return signe * (Number(e) * 100 + Number(c.padEnd(2, '0')));
}

interface Ligne { texte: string; montant: string; ecart: boolean }
interface Carte { texte: string; boutons: string[]; proposition: Ligne[]; enregistre: Ligne[]; panneau: Ligne[]; débord: boolean }
async function carte(page: Page): Promise<Carte> {
  return page.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find((x) => x.querySelector(':scope > .row strong')?.textContent?.trim() === 'Livret A') as HTMLElement | undefined;
    const lignes = (sel: string) =>
      [...(c?.querySelectorAll(`${sel} .ventilation .row`) ?? [])].map((r) => ({
        texte: (r as HTMLElement).innerText.replace(/\s+/g, ' '),
        montant: r.querySelector('.num')?.textContent ?? '',
        ecart: r.classList.contains('ecart'),
      }));
    return {
      texte: c?.innerText ?? '',
      boutons: [...(c?.querySelectorAll('button') ?? [])].map((b) => b.textContent?.trim() ?? ''),
      proposition: lignes('.proposition'),
      enregistre: lignes('.ordre-enregistre'),
      panneau: lignes('.panneau-ventilation'),
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
/** Ouvre la part `i` du panneau, qui s'ouvre à la demande, une à la fois (#408, point 3), si elle ne l'est pas déjà. */
async function ouvrirLaPart(page: Page, i: number) {
  await page.evaluate((j: number) => {
    const f = document.querySelector('.panneau-ventilation')!;
    if (f.querySelector(`fieldset[data-part="${j}"]`)) return;
    (f.querySelector(`.ventilation .row.part[data-part="${j}"]`) as HTMLElement).click();
  }, i);
  await pause(150);
}
/** Referme la part ouverte : elle reprend sa ligne, avec ce qui a été choisi (#408, point 3). */
async function refermerLaPart(page: Page) {
  expect(await cliquer(page, 'Refermer')).toBe(true);
  await pause(150);
}
/** Saisit `valeur` dans le champ `quoi` du panneau : le montant de l'ordre, ou la valeur de la part `i`. */
async function saisir(page: Page, quoi: 'montant' | number, valeur: string) {
  if (quoi !== 'montant') await ouvrirLaPart(page, quoi);
  await page.evaluate(
    (q: 'montant' | number, v: string) => {
      const f = document.querySelector('.panneau-ventilation')!;
      const i = (q === 'montant' ? f.querySelector(':scope > .grid input') : f.querySelector(`fieldset[data-part="${q}"]`)!.querySelector('input')) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input', { bubbles: true }));
    },
    quoi,
    valeur,
  );
  await pause(150);
}
async function forme(page: Page, i: number, valeur: 'fixed' | 'percent' | 'variable') {
  await ouvrirLaPart(page, i);
  await page.evaluate(
    (j: number, v: string) => {
      const s = document.querySelector(`.panneau-ventilation fieldset[data-part="${j}"]`)!.querySelectorAll('select')[2] as HTMLSelectElement;
      s.value = v;
      s.dispatchEvent(new Event('change', { bubbles: true }));
    },
    i,
    valeur,
  );
  await pause(150);
}
async function soumettre(page: Page): Promise<string> {
  await page.evaluate(() => (document.querySelector('.panneau-ventilation button[type="submit"]') as HTMLButtonElement).click());
  await pause(200);
  return page.evaluate(() => document.querySelector('.panneau-ventilation .err')?.textContent ?? '');
}
/** Les parts d'un ordre, en positif, comparables à ce que la carte montre. */
const montants = (a: AllocationLine[] | undefined) => (a ?? []).map((l) => (l.share.kind === 'fixed' ? Math.abs(l.share.amount) : l.share));

describe.skipIf(!navigateur)('#394 · l’écran Plan valide un ordre avec sa ventilation, à 375 px', () => {
  let site: Site;
  let page: Page;
  beforeAll(async () => {
    site = await ouvrirLeSite();
    page = await ouvrirLExemple(site, 375, 812);
  });
  afterAll(async () => {
    await site?.fermer();
  });

  it('[niveau 0] 5, 4 · I10 — l’écart se propose en regard de l’ordre ; ni la carte, ni le panneau ouvert puis annulé n’écrivent rien', async () => {
    const avant = await ordresConservés(page);
    const c = await carte(page);
    expect(c.boutons).toEqual(expect.arrayContaining(['Confirmer mon nouvel ordre', 'Corriger mon ordre']));
    expect(c.proposition.length, 'la proposition ne montre pas sa ventilation').toBeGreaterThan(0);
    expect(c.enregistre.length, 'l’ordre enregistré ne montre pas sa ventilation').toBeGreaterThan(0);
    expect(c.débord).toBe(false);
    expect(await cliquerDansLaCarte(page, 'Corriger mon ordre')).toBe(true);
    await saisir(page, 'montant', '999');
    expect(await cliquer(page, 'Annuler')).toBe(true);
    expect(await ordresConservés(page)).toEqual(avant);
  });

  it('[niveau 1] 5, 8 · U2 — « Confirmer mon nouvel ordre » écrit l’ordre tel que la carte le montre ; relu après rechargement', async () => {
    const [avant] = await ordresConservés(page);
    const montré = await carte(page);
    const montant = centimes(montré.texte.match(/Ordre que le plan propose[^\n]*\n?[^\n]*?([\d\s  ]+,\d\d)/)?.[1] ?? '');
    const parts = montré.proposition.filter((l) => !l.texte.startsWith('Non affecté')).map((l) => centimes(l.montant));
    expect(await cliquerDansLaCarte(page, 'Confirmer mon nouvel ordre')).toBe(true);
    await page.reload({ waitUntil: 'networkidle0' });
    await allerÀ(page, 'Plan');
    const [après] = await ordresConservés(page);
    expect({ id: après!.id, name: après!.name, periodicity: après!.periodicity }).toEqual({ id: avant!.id, name: avant!.name, periodicity: avant!.periodicity });
    expect(Math.abs(après!.amount)).toBe(montant);
    expect(montants(après!.action?.allocation)).toEqual(parts);
    const c = await carte(page);
    expect(c.boutons).not.toContain('Confirmer mon nouvel ordre');
    expect(c.enregistre.filter((l) => !l.texte.startsWith('Non affecté')).map((l) => centimes(l.montant))).toEqual(parts);
  });

  it('[niveau 0] 4, 5, 6 — le panneau refuse sans écrire, puis écrit exactement ce qu’il montre ; la part fixe en écart se marque et se propose', async () => {
    const [avant] = await ordresConservés(page);
    expect(await cliquerDansLaCarte(page, 'Corriger mon ordre')).toBe(true);
    const titre = await page.evaluate(() => document.querySelector('.panneau-ventilation .titre-panneau')?.textContent ?? '');
    expect(titre).toContain(avant!.name);
    await forme(page, 0, 'percent');
    await saisir(page, 0, '150');
    expect(await soumettre(page)).toMatch(/ne dépasse pas 100/);
    expect(await ordresConservés(page)).toEqual([avant]);
    expect((await carte(page)).débord).toBe(false);
    // Première part : fixe, 50 € sous ce que le budget demande (au-delà du pas de 10 €) ; montant : 700 €.
    const premier = Math.abs((avant!.action!.allocation![0]!.share as { amount: number }).amount);
    await forme(page, 0, 'fixed');
    await saisir(page, 0, String((premier - 5000) / 100));
    await saisir(page, 'montant', '700');
    await refermerLaPart(page);
    const panneau = (await carte(page)).panneau.map((l) => l.montant);
    expect(await soumettre(page)).toBe('');
    const [après] = await ordresConservés(page);
    expect({ id: après!.id, name: après!.name, periodicity: après!.periodicity, labelPattern: après!.labelPattern }).toEqual({
      id: avant!.id, name: avant!.name, periodicity: avant!.periodicity, labelPattern: avant!.labelPattern,
    });
    expect(Math.abs(après!.amount)).toBe(70000);
    const attendues = [premier - 5000, ...montants(avant!.action!.allocation!.slice(1))];
    expect(montants(après!.action?.allocation)).toEqual(attendues);
    const c = await carte(page);
    expect(c.enregistre.map((l) => l.montant), 'la carte ne montre pas ce que montrait le panneau').toEqual(panneau);
    expect(c.enregistre[0]!.ecart, 'la part fixe en écart n’est pas marquée').toBe(true);
    expect(c.enregistre[0]!.texte).toMatch(new RegExp(`le budget demande ${(premier / 100).toFixed(2).replace('.', ',')}`));
    expect(c.enregistre.slice(1).some((l) => l.ecart), 'une part sans écart est marquée').toBe(false);
    expect(c.boutons).toContain('Confirmer mon nouvel ordre');
  });

  it('[niveau 2] 4 — sur une proposition, le panneau suit le montant tant qu’aucune part n’est touchée, puis ne suit plus', async () => {
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
    expect(await cliquerDansLaCarte(page, 'Modifier avant d’enregistrer')).toBe(true);
    const proposé = (await carte(page)).panneau.map((l) => l.texte);
    expect(proposé.length).toBeGreaterThan(0);
    await saisir(page, 'montant', '300');
    const suivi = (await carte(page)).panneau;
    expect(suivi.map((l) => l.texte)).not.toEqual(proposé);
    expect(suivi.some((l) => l.texte.startsWith('Non affecté')), 'à 300 €, les parts proposées dépassent le montant').toBe(false);
    expect(suivi.reduce((s, l) => s + centimes(l.montant), 0)).toBe(30000);
    await saisir(page, 0, '10');
    await refermerLaPart(page);
    const touché = (await carte(page)).panneau.map((l) => l.texte);
    await saisir(page, 'montant', '650');
    expect((await carte(page)).panneau.slice(0, -1).map((l) => l.texte)).toEqual(touché.filter((t) => !t.startsWith('Non affecté')));
    expect(await cliquer(page, 'Annuler')).toBe(true);
    expect(await ordresConservés(page)).toEqual([]);
  });

  it('[niveau 1] 2 · I4 — sans ordre : « Enregistrer mon ordre permanent » écrit en un geste la proposition montrée', async () => {
    const c = await carte(page);
    expect(c.boutons).toEqual(expect.arrayContaining(['Enregistrer mon ordre permanent', 'Modifier avant d’enregistrer']));
    expect(c.débord).toBe(false);
    const parts = c.proposition.filter((l) => !l.texte.startsWith('Non affecté')).map((l) => centimes(l.montant));
    expect(parts.length).toBeGreaterThan(0);
    expect(await cliquerDansLaCarte(page, 'Enregistrer mon ordre permanent')).toBe(true);
    const [nouveau] = await ordresConservés(page);
    expect(montants(nouveau!.action?.allocation)).toEqual(parts);
  });
});
