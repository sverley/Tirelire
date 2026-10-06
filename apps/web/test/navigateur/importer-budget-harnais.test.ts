/**
 * Harnais d'audit de #367 — « Importer un budget JSON depuis Configuration ou par une adresse, et le
 * valider dans l'assistant » : sur le site construit, à 375 px, au 6 septembre 2026, projet vierge.
 *
 * L'exemple importé est celui de la documentation de #366 (`docs/format-budget-json.md`, « Exemple
 * complet »). Les tests du codeur (`test/importer-budget.test.ts`) restent dans son fichier, au niveau 4.
 *
 * Niveaux (D83), par phrase du « Fait quand » :
 *  - 0 pour le point 2, « la partie après « # » ne quitte pas l'appareil » : I7 ; sinon le budget serait
 *    sorti de l'appareil, ce qu'aucune correction ne rattrape.
 *  - 1 pour le point 4, « quitter sans valider n'enregistre rien » : I10 tel qu'il est écrit.
 *  - 2 pour les points 2 (l'adresse lue disparaît, recharger ne refait rien ; l'application déjà ouverte),
 *    3 (le résumé, aucune proposition d'office : D46), 4 (le remplacement d'un brouillon, avec l'accord par
 *    une adresse), 5 (le refus) et 6 (le critère au centime, comme #324 point 5) : l'usage reste possible.
 *  Le point 1 (l'entrée en deux gestes) est tranché par le harnais du registre d'I5,
 *  `acces-fonctions.test.ts`, où l'écran est inventorié ; le point 7, par `VM-C9-telephone` et
 *  `VM-C9-ordinateur`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LedgerStore, computePlan, exampleLedger, periodReadingDate, periodsAround, type Ledger } from '@tirelire/core';
import { allerÀ, navigateur, nouvellePage, ouvrirLeSite, RACINE, type Site } from '../harnais.js';

const SQL = await initSqlJs();
const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
const JOUR = '2026-09-06';
const DOC = readFileSync(resolve(RACINE, '../../docs/format-budget-json.md'), 'utf8');
const EXEMPLE = [...DOC.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!).find((b) => b.includes('"planned_flows"'))!;
const ADRESSE = (url: string, json = EXEMPLE) => `${url}#budget=${encodeURIComponent(json)}`;
/** Un nom propre au JSON, qu'aucune requête ne doit porter (I7). */
const MARQUE = 'acc-livret-jeune';

async function pageAuJour(site: Site): Promise<Page> {
  const page = await nouvellePage(site);
  await page.evaluateOnNewDocument((début: number) => {
    const Vraie = Date;
    const décalage = début - Vraie.now();
    const maintenant = () => Vraie.now() + décalage;
    function DateFixée(this: unknown, ...a: unknown[]): unknown {
      if (!new.target) return new Vraie(maintenant()).toString();
      return a.length === 0 ? new Vraie(maintenant()) : new (Vraie as unknown as new (...b: unknown[]) => Date)(...a);
    }
    Object.setPrototypeOf(DateFixée, Vraie);
    DateFixée.prototype = Vraie.prototype;
    (DateFixée as unknown as { now: () => number }).now = maintenant;
    (globalThis as unknown as { Date: unknown }).Date = DateFixée;
  }, Date.parse(`${JOUR}T12:00:00+02:00`));
  return page;
}

const prete = (page: Page) =>
  page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));

const texte = (page: Page) => page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));
const auResume = async (page: Page) => (await texte(page)).includes('Valider mon budget');

async function bouton(page: Page, libellé: string, sel = 'main button'): Promise<void> {
  const fait = await page.evaluate(
    (l: string, s: string) => {
      const b = ([...document.querySelectorAll(s)] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').replace(/\s+/g, ' ').includes(l));
      b?.click();
      return !!b;
    },
    libellé,
    sel,
  );
  expect(fait, `pas de bouton « ${libellé} »`).toBe(true);
  await pause(300);
}

/** Plus, puis « Importer un budget (JSON) ». */
async function ouvrirLEntree(page: Page) {
  await allerÀ(page, 'Plus');
  await bouton(page, 'Importer un budget (JSON)');
}

async function coller(page: Page, json: string) {
  await page.evaluate((v: string) => {
    const t = document.querySelector('main textarea') as HTMLTextAreaElement;
    t.value = v;
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }, json);
  await pause(150);
  await bouton(page, 'Importer ce texte');
}

async function choisirLeFichier(page: Page, json: string) {
  const champ = await page.$('main input[type="file"]');
  expect(champ, 'pas de champ fichier').not.toBeNull();
  const chemin = join(mkdtempSync(join(tmpdir(), 'tirelire-367-')), 'budget.json');
  writeFileSync(chemin, json);
  await (champ as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(chemin);
  await pause(600);
}

async function projetConserve(page: Page): Promise<Ledger> {
  await pause(1200);
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
  if (b64 === null) return { ...exampleLedger(), accounts: [], tirelires: [], needs: [], categories: [], plannedFlows: [], operations: [], subOperations: [], shortfallAnswers: [] } as Ledger;
  const store = await LedgerStore.create({ sqlJs: SQL, bytes: new Uint8Array(Buffer.from(b64, 'base64')) });
  const projet = store.load();
  store.close();
  return projet;
}

function plans(l: Ledger) {
  return periodsAround(l, JOUR, 0, 12).map((p) => {
    const plan = computePlan(l, periodReadingDate(p, JOUR), JOUR);
    return {
      periode: [p.start, p.end],
      totaux: plan.totals,
      lignes: plan.lines.map((x) => [x.name, x.kind, x.requested, x.funded, x.status]),
      virements: plan.transfers.map((x) => [x.accountName, x.permanent, x.standing, x.net, x.bankOrder?.amount ?? null]),
      annonces: plan.warnings.map((w) => [w.code, w.message]),
    };
  });
}
const sansOperations = (): Ledger => ({ ...exampleLedger(), operations: [], subOperations: [], shortfallAnswers: [] });
/** Ce que l'import aurait écrit : comptes, tirelires, besoins, catégories, flux, réglages (sans l'identifiant de l'appareil, propre à la base). */
const budgetDe = (l: Ledger) => JSON.stringify({ accounts: l.accounts, tirelires: l.tirelires, needs: l.needs, categories: l.categories, plannedFlows: l.plannedFlows, settings: { ...l.settings, siteId: undefined } }, null, 1).split('\n');

/** De l'étape où l'on est, recule jusqu'à la première, puis avance par les boutons primaires jusqu'au résumé. */
async function parcourirLesEtapes(page: Page) {
  for (let i = 0; i < 15; i++) {
    const recule = await page.evaluate(() => {
      const b = ([...document.querySelectorAll('main button')] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').includes('Précédent'));
      b?.click();
      return !!b;
    });
    if (!recule) break;
    await pause(200);
  }
  for (let i = 0; i < 15 && !(await auResume(page)); i++) {
    await page.evaluate(() => {
      const b = ([...document.querySelectorAll('main .actions button.primary')] as HTMLButtonElement[]).find((x) => /Suivant|Commencer/.test(x.textContent ?? ''));
      b?.click();
    });
    await pause(250);
  }
  expect(await auResume(page), 'l’assistant ne revient pas à son résumé').toBe(true);
}

describe.skipIf(!navigateur)('#367 · harnais navigateur', () => {
  let site: Site;
  /** Le projet d'une application ouverte pour la première fois, sans rien faire. */
  let VIERGE: Ledger | undefined;
  beforeAll(async () => {
    site = await ouvrirLeSite();
    const page = await pageAuJour(site);
    await page.goto(site.url, { waitUntil: 'networkidle0' });
    await prete(page);
    VIERGE = await projetConserve(page);
    await page.close();
  }, 180_000);
  afterAll(async () => {
    await site?.fermer();
  });

  describe('[niveau 0] #367 · 2 — la partie après « # » ne quitte pas l’appareil (I7)', () => {
    it('ouvrir par l’adresse, puis valider : aucune requête ne porte le budget', async () => {
      const page = await pageAuJour(site);
      const sorties: string[] = [];
      // Ce qu'une requête envoie : son adresse sans la partie après « # » (HTTP ne la transmet jamais), et son corps.
      page.on('request', (r) => sorties.push(`${r.url().split('#')[0]} ${r.postData() ?? ''}`));
      try {
        await page.goto(ADRESSE(site.url), { waitUntil: 'networkidle0' });
        await prete(page);
        await pause(500);
        expect(await auResume(page), 'l’assistant ne s’ouvre pas sur son résumé').toBe(true);
        await bouton(page, 'Valider mon budget', 'main .actions button.primary');
        await pause(800);
        expect(sorties.filter((s) => s.includes(MARQUE) || s.includes(encodeURIComponent(MARQUE)) || s.includes('budget='))).toEqual([]);
      } finally {
        await page.close();
      }
    }, 90_000);
  });

  describe('[niveau 1] #367 · 4 — rien n’est enregistré avant « Valider mon budget » (I10)', () => {
    it('importé par chacune des voies, puis quitté sans valider : le projet reste vierge, rechargement compris', async () => {
      const page = await pageAuJour(site);
      try {
        await page.goto(site.url, { waitUntil: 'networkidle0' });
        await prete(page);
        const avant = budgetDe(await projetConserve(page));
        await ouvrirLEntree(page);
        await coller(page, EXEMPLE);
        expect(await auResume(page)).toBe(true);
        await allerÀ(page, 'Plan');
        await page.reload({ waitUntil: 'networkidle0' }); // quitter : le brouillon ne vit qu'en mémoire
        await prete(page);
        await page.goto(ADRESSE(site.url), { waitUntil: 'networkidle0' });
        await prete(page);
        await pause(500);
        expect(await auResume(page)).toBe(true);
        await allerÀ(page, 'Plan');
        expect(budgetDe(await projetConserve(page)), 'le projet a changé sans validation').toEqual(avant);
        await page.reload({ waitUntil: 'networkidle0' });
        await prete(page);
        expect(budgetDe(await projetConserve(page))).toEqual(avant);
        expect(await texte(page)).toContain('Construire mon budget');
      } finally {
        await page.close();
      }
    }, 120_000);
  });

  describe('[niveau 2] #367 · 2, 3, 6 — le parcours de bout en bout, par chaque voie', () => {
    for (const voie of ['texte collé', 'fichier choisi', 'adresse'] as const) {
      it(`${voie} : résumé marqué « import », étapes parcourues sans proposition d’office, validé d’un geste, plan de l’exemple au centime`, async () => {
        const page = await pageAuJour(site);
        try {
          if (voie === 'adresse') {
            await page.goto(ADRESSE(site.url), { waitUntil: 'networkidle0' });
            await prete(page);
            await pause(500);
            expect(await page.evaluate(() => location.hash), 'l’adresse garde le budget après lecture').toBe('');
          } else {
            await page.goto(site.url, { waitUntil: 'networkidle0' });
            await prete(page);
            await ouvrirLEntree(page);
            if (voie === 'texte collé') await coller(page, EXEMPLE);
            else await choisirLeFichier(page, EXEMPLE);
          }
          const resume = await texte(page);
          expect(resume).toContain('Valider mon budget');
          expect(resume).toContain('Ce budget vient d’un import');
          expect(resume).toContain('Rien n’est encore enregistré');
          await parcourirLesEtapes(page);
          await bouton(page, 'Valider mon budget', 'main .actions button.primary');
          expect(await texte(page)).toContain('Votre budget est enregistré');
          expect(plans(await projetConserve(page))).toEqual(plans(sansOperations()));
          if (voie === 'adresse') {
            await page.reload({ waitUntil: 'networkidle0' });
            await prete(page);
            await pause(500);
            expect(await auResume(page), 'recharger refait l’import').toBe(false);
          }
        } finally {
          await page.close();
        }
      }, 180_000);
    }

    it('application déjà ouverte, assistant au début : une adresse #budget= ouvre l’assistant sur le budget importé', async () => {
      const page = await pageAuJour(site);
      try {
        await page.goto(site.url, { waitUntil: 'networkidle0' });
        await prete(page);
        await allerÀ(page, 'Plus');
        await bouton(page, 'Lancer');
        await page.evaluate((h: string) => (location.hash = h), ADRESSE('').slice(0));
        await pause(800);
        const vu = await texte(page);
        expect(await page.evaluate(() => location.hash)).toBe('');
        expect(vu, 'l’assistant affiché ne montre pas le budget importé').toContain('Ce budget vient d’un import');
      } finally {
        await page.close();
      }
    }, 90_000);
  });

  describe('[niveau 2] #367 · 4 — ce que l’assistant avait préparé est remplacé, et l’entrée le dit', () => {
    async function brouillonPrepare(page: Page) {
      await page.goto(site.url, { waitUntil: 'networkidle0' });
      await prete(page);
      await allerÀ(page, 'Plus');
      await bouton(page, 'Lancer');
      await bouton(page, 'Commencer', 'main .actions button.primary'); // l'étape suivante se garnit de l'exemple (D46)
      await allerÀ(page, 'Plan');
    }

    it('depuis Configuration : l’écran dit le remplacement avant d’importer', async () => {
      const page = await pageAuJour(site);
      try {
        await brouillonPrepare(page);
        await ouvrirLEntree(page);
        expect(await texte(page)).toContain('Importer un budget les remplace');
      } finally {
        await page.close();
      }
    }, 90_000);

    it('par une adresse : sans accord, rien n’est importé ; avec, le budget remplace le brouillon', async () => {
      const page = await pageAuJour(site);
      try {
        await brouillonPrepare(page);
        await page.evaluate((h: string) => (location.hash = h), ADRESSE(''));
        await pause(600);
        expect(await page.evaluate(() => location.hash)).toBe('');
        await bouton(page, 'Garder mes changements');
        await allerÀ(page, 'Plus');
        await bouton(page, 'Lancer');
        expect(await texte(page)).not.toContain('Ce budget vient d’un import');
        await allerÀ(page, 'Plan');
        await page.evaluate((h: string) => (location.hash = h), ADRESSE(''));
        await pause(600);
        await bouton(page, 'Remplacer par ce budget');
        expect(await texte(page)).toContain('Ce budget vient d’un import');
      } finally {
        await page.close();
      }
    }, 120_000);
  });

  describe('[niveau 2] #367 · 5 — un JSON refusé n’ouvre pas l’assistant et ne change rien', () => {
    const FAUX = EXEMPLE.replace('"opening_balance": 234000', '"opening_balance": "deux"').replace('"opening_balance": 481500', '"opening_balance": "trois"');

    it('sur l’écran de l’entrée : le premier problème, et le nombre des autres', async () => {
      const page = await pageAuJour(site);
      try {
        await page.goto(site.url, { waitUntil: 'networkidle0' });
        await prete(page);
        const avant = budgetDe(await projetConserve(page));
        await ouvrirLEntree(page);
        await coller(page, FAUX);
        const vu = await texte(page);
        expect(vu).toContain('Importer un budget (JSON)');
        expect(vu).toMatch(/Ce budget JSON ne se lit pas/);
        expect(vu).toMatch(/accounts/);
        expect(vu).toMatch(/opening_balance/);
        expect(vu).toMatch(/1 autre problème/);
        expect(vu).not.toContain('Valider mon budget');
        expect(budgetDe(await projetConserve(page))).toEqual(avant);
      } finally {
        await page.close();
      }
    }, 90_000);

    it('à l’ouverture par une adresse : le refus s’affiche, l’assistant ne s’ouvre pas', async () => {
      const page = await pageAuJour(site);
      try {
        await page.goto(ADRESSE(site.url, FAUX), { waitUntil: 'networkidle0' });
        await prete(page);
        await pause(500);
        const vu = await page.evaluate(() => (document.body.textContent ?? '').replace(/\s+/g, ' '));
        expect(vu).toContain('Le budget de l\'adresse n\'a pas été importé');
        expect(vu).toMatch(/1 autre problème/);
        expect(await auResume(page)).toBe(false);
        expect(budgetDe(await projetConserve(page)), 'le refus a changé le projet').toEqual(budgetDe(VIERGE!));
      } finally {
        await page.close();
      }
    }, 90_000);
  });
});
