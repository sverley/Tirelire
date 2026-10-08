/**
 * Harnais d'audit de #13 — à l'écran, à 375 px : le résumé de l'assistant dit les ordres à poser
 * (points 1, 3, 4, 6, 7, 8), et l'écran Plan propose, une fois l'assistant validé, le même ordre —
 * montant, ventilation, libellé, jour —, dit son jour et se copie (points 2, 5, 6, 7, 8). Repris des
 * tests du codeur ; l'auditeur y a ajouté le point 4 sans ordre de l'exemple (tirelires hors de tout
 * compte d'accueil, puis aucune tirelire).
 *
 * Le parcours part d'une base vierge, avec les propositions de l'exemple : l'ordre de l'exemple vers
 * le Livret A est déjà là au résumé, et le compte n'a pas de bloc (point 1, dernière phrase) ; une fois
 * cet ordre retiré, le budget demande un ordre vers le Livret A, que le résumé dit. Le compte est
 * ensuite renommé d'un nom long, pour un libellé de 35 caractères, la longueur d'un libellé bancaire.
 *
 * Niveau (D83) : 1 — U2 (point 1), D43, D60 et I10 (point 3 : rien ne s'enregistre sans geste), I3
 * (point 4), U3 (points 2, 5 : ce qui se pose est ce que l'import reconnaîtra), C2 (point 6), C9
 * (point 8). Rouges vus sur le code de `main` et sur mutations : voir la vérification de l'auditeur.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LedgerStore, alive, type Ledger } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
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
const t = (s?: string | null) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();

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
            const v = get.result as Uint8Array | ArrayBuffer | undefined;
            if (!v) return ok(null);
            const u = v instanceof Uint8Array ? v : new Uint8Array(v);
            let s = '';
            for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
            ok(btoa(s));
          };
        };
      }),
  );
  expect(b64, 'le fichier de l’application est introuvable').not.toBeNull();
  const store = await LedgerStore.create({ sqlJs: SQL, bytes: new Uint8Array(Buffer.from(b64!, 'base64')) });
  const projet = store.load();
  store.close();
  return projet;
}
const ordresVers = (l: Ledger, compte: string) => {
  const id = l.accounts.find((a) => a.name === compte)?.id;
  return alive(l.plannedFlows).filter((f) => f.kind === 'transfer' && (f.counterpartAccountId === id || f.accountId === id));
};

describe.skipIf(!navigateur)('[niveau 1] #13 — les ordres à poser, de l’assistant au Plan, à 375 px', () => {
  let site: Site;
  let page: Page;
  let dansLAssistant: Ordre & { compte: string };

  beforeAll(async () => {
    site = await ouvrirLeSite();
    page = await ouvrirLAssistant(site);
    for (const e of ['Budgets', 'Pas tous les mois', 'Épargne', 'Résumé']) await etape(page, e);
  }, 120_000);
  afterAll(async () => {
    await page?.close();
    await site?.fermer();
  });

  it('1, 4 — l’ordre de l’exemple est là : pas de bloc, une phrase, et rien qui invite à créer un compte', async () => {
    expect(await blocsDeLAssistant(page)).toEqual([]);
    const phrase = await page.evaluate(() => (document.querySelector('main .rien-a-poser')?.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(phrase).toMatch(/^Aucun autre ordre permanent à poser chez votre banque/);
    expect(phrase).not.toMatch(/créez|créer|ajoutez/i);
    expect(await page.evaluate(() => !!document.querySelector('main .card.ordre'))).toBe(true);
  });

  it('1, 3, 6, 7 — l’ordre retiré, le résumé dit celui à poser vers le Livret A, sans geste qui l’enregistre', async () => {
    const retire = await page.evaluate(() => {
      const b = document.querySelector('main .card.ordre button[title="Retirer ce virement"]') as HTMLButtonElement | null;
      b?.click();
      return !!b;
    });
    expect(retire).toBe(true);
    await pause(250);
    const blocs = await blocsDeLAssistant(page);
    expect(blocs.map((b) => b.compte)).toEqual(['Livret A']);
    const b = blocs[0]!;
    expect(b.montant).toBe('650,00 €');
    expect(b.parts.length, 'la ventilation ne se lit pas').toBeGreaterThan(0);
    expect(b.libelles).toEqual(['TIRELIRE LIVRET A']);
    expect(b.jours).toEqual([expect.stringMatching(/^Jour du virement : le 28 de chaque mois\. .*jusqu’à 5 jours avant ou après est reconnu à l’import/)]);
    expect(b.boutons, 'le bloc ne doit offrir que la copie').toEqual(['Copier']);
    const suite = await page.evaluate(() => {
      const p = document.querySelector('main p.explication-suite');
      return { affiche: !!p && !p.closest('details'), texte: p?.textContent ?? '' };
    });
    expect(suite.affiche, 'le texte de la suite n’est pas affiché dans l’assistant').toBe(true);
    expect(suite.texte).toMatch(/libellé et son montant/);
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

  it('3 — validé, aucun ordre n’est enregistré ; l’écran dit que les ordres se mettent en place sur le Plan, et le bouton principal y conduit', async () => {
    expect(await cliquer(page, 'Valider mon budget')).toBe(true);
    await pause(400);
    expect(ordresVers(await projetConserve(page), NOM_LONG)).toEqual([]);
    const fin = await page.evaluate(() => ({
      dit: (document.querySelector('main .ordres-sur-le-plan')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      primaires: [...document.querySelectorAll('main .btn.primary')].map((b) => (b.textContent ?? '').trim()),
    }));
    expect(fin.dit).toMatch(/se mettent en place sur l’écran Plan/);
    expect(fin.primaires).toEqual(['Voir le plan']);
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

  it('5 — enregistré, l’ordre dit le jour de son ancrage et son libellé, ceux que le Plan proposait', async () => {
    const avant = await carteDuPlan(page, NOM_LONG, '.proposition');
    expect(await cliquer(page, 'Enregistrer mon ordre permanent')).toBe(true);
    await pause(300);
    const [ordre] = ordresVers(await projetConserve(page), NOM_LONG);
    expect(ordre?.labelPattern).toBe(LIBELLE_LONG);
    expect(Number(ordre!.periodicity.anchorDate.slice(8))).toBe(28);
    const enregistre = await carteDuPlan(page, NOM_LONG, '.ordre-enregistre');
    expect(enregistre?.libelles).toEqual(avant!.libelles);
    expect(enregistre?.jours).toEqual(avant!.jours);
    expect(t(enregistre?.jours[0])).toMatch(/le 28 de chaque mois/);
  });
});

describe.skipIf(!navigateur)('[niveau 1] #13 · 4 — rien à poser, c’est dit ; sans tirelire, rien', () => {
  let site: Site;
  let page: Page;
  const resume = (p: Page) =>
    p.evaluate(() => ({
      blocs: document.querySelectorAll('main .card.ordre-a-poser').length,
      phrase: (document.querySelector('main .rien-a-poser')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      titre: [...document.querySelectorAll('main h3')].some((h) => /ordres permanents à poser/.test(h.textContent ?? '')),
    }));

  beforeAll(async () => {
    site = await ouvrirLeSite();
    page = await ouvrirLAssistant(site);
    for (const e of ['Budgets', 'Pas tous les mois', 'Épargne', 'Résumé']) await etape(page, e);
  }, 120_000);
  afterAll(async () => {
    await page?.close();
    await site?.fermer();
  });

  it('sans ordre de l’exemple, les tirelires laissées hors de tout compte d’accueil : une phrase, aucun bloc, rien qui invite à créer un compte', async () => {
    const retire = await page.evaluate(() => {
      const b = document.querySelector('main .card.ordre button[title="Retirer ce virement"]') as HTMLButtonElement | null;
      b?.click();
      return !!b;
    });
    expect(retire).toBe(true);
    await pause(250);
    expect((await resume(page)).blocs, 'le budget doit d’abord demander un ordre').toBeGreaterThan(0);
    const places = await page.evaluate(() => {
      const choix = [...document.querySelectorAll('main select')] as HTMLSelectElement[];
      let n = 0;
      for (const c of choix) {
        if (!c.querySelector('option[value=""]') || c.value === '') continue;
        c.value = '';
        c.dispatchEvent(new Event('change', { bubbles: true }));
        n++;
      }
      return n;
    });
    expect(places, 'aucune tirelire n’était placée ailleurs').toBeGreaterThan(0);
    await pause(250);
    const r = await resume(page);
    expect(r).toMatchObject({ blocs: 0, titre: false });
    expect(r.phrase).toMatch(/^Aucun ordre permanent à poser chez votre banque/);
    expect(r.phrase).not.toMatch(/créez|créer|ajoutez|ouvrez/i);
  });

  it('sans aucune tirelire, le résumé ne parle pas d’ordre à poser', async () => {
    for (const e of ['Budgets', 'Pas tous les mois', 'Épargne']) {
      await etape(page, e);
      for (let i = 0; i < 40; i++) {
        const retiree = await page.evaluate(() => {
          const b = document.querySelector('main button[title="Retirer cette tirelire"]') as HTMLButtonElement | null;
          b?.click();
          return !!b;
        });
        if (!retiree) break;
        await pause(60);
      }
    }
    await etape(page, 'Résumé');
    const r = await resume(page);
    expect(r).toEqual({ blocs: 0, phrase: '', titre: false });
    expect(await page.evaluate(() => /ordre permanent à poser/i.test(document.querySelector('main')?.textContent ?? ''))).toBe(false);
  });
});
