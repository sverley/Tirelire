/**
 * Harnais d'audit de #369 — l'écran Tirelires emploie la section Tirelires de l'assistant (#361).
 * Reprend les tests du codeur (niveaux marqués par l'auditeur, D83) et les complète : sur le site
 * construit, à 375 px, projet vierge ; les tests se suivent, chacun repart de l'écran Tirelires rouvert.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

describe.skipIf(!navigateur)('#369 · l’écran Tirelires emploie la section Tirelires', () => {
  let site: Site;
  let page: Page;

  beforeAll(async () => {
    site = await ouvrirLeSite();
    page = await nouvellePage(site);
    page.on('dialog', (d) => void d.accept());
    await page.goto(site.url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
  }, 180_000);

  afterAll(async () => {
    await page?.close().catch(() => {});
    await site?.fermer();
  });

  const ouvrir = async () => {
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Tirelires')).toBe(true);
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Tirelires');
    await pause(150);
  };
  const cartes = () =>
    page.evaluate(() => ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).map((c) => (c.querySelector('input.nom') as HTMLInputElement).value));
  const raccourcis = () => page.evaluate(() => [...document.querySelectorAll('main .prop .n')].map((n) => (n.textContent ?? '').replace(/^\+\s*/, '').trim()));
  const remplir = (étiquette: string, valeur: string) =>
    page.evaluate(
      (é: string, v: string) => {
        const l = [...document.querySelectorAll('main form.edit label')].find((x) => (x.textContent ?? '').trim().startsWith(é));
        const c = l?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null;
        if (!c) return false;
        if (c instanceof HTMLSelectElement) {
          const o = [...c.options].find((x) => x.value === v || (x.textContent ?? '').trim() === v);
          if (!o) return false;
          c.value = o.value;
          c.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          c.value = v;
          c.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      },
      étiquette,
      valeur,
    );

  it('[niveau 1] point 3 (I5, I10, D46) — sur une base vide, rien n’est créé d’office', async () => {
    await ouvrir();
    expect(await cartes(), 'rien n’est créé d’office').toEqual([]);
  });

  it('[niveau 1] point 3 (I5) — sur une base vide, l’écran porte les raccourcis de l’exemple, sous « Ajouter en un geste »', async () => {
    await ouvrir();
    expect((await raccourcis()).length, 'l’écran vide doit porter ce qui le remplirait').toBeGreaterThan(0);
    expect(await page.evaluate(() => document.body.textContent?.includes('Ajouter en un geste'))).toBe(true);
  });

  it('[niveau 3] point 4 — l’explication est celle des étapes de l’assistant, repliée sous « Comment ça marche ? », et s’ouvre d’un geste', async () => {
    await ouvrir();
    const repliee = await page.evaluate(() => {
      const d = document.querySelector('main details.explication') as HTMLDetailsElement | null;
      return d ? { ouverte: d.open, titre: (d.querySelector('summary')?.textContent ?? '').trim(), texte: d.textContent ?? '' } : null;
    });
    expect(repliee, 'pas de « Comment ça marche ? »').not.toBeNull();
    expect(repliee!.titre).toBe('Comment ça marche ?');
    expect(repliee!.ouverte).toBe(false);
    await page.evaluate(() => (document.querySelector('main details.explication > summary') as HTMLElement).click());
    await pause(100);
    expect(await page.evaluate(() => (document.querySelector('main details.explication') as HTMLDetailsElement).open)).toBe(true);
    for (const début of ['Courses, essence', 'C’est ici que les tirelires servent', 'Une épargne sans date']) {
      expect(repliee!.texte.replace(/'/g, '’')).toContain(début);
    }
  });

  it('[niveau 2] point 3 (D46) — un raccourci crée dans le projet la tirelire de l’exemple, puis disparaît', async () => {
    await ouvrir();
    const avant = await raccourcis();
    const nom = avant[0]!;
    expect(await page.evaluate(() => { const b = document.querySelector('main .prop') as HTMLButtonElement | null; b?.click(); return !!b; })).toBe(true);
    await pause(300);
    expect(await cartes()).toContain(nom);
    expect(await raccourcis(), `le raccourci « ${nom} » doit disparaître`).not.toContain(nom);
    // Il est écrit dans le projet : l'écran rouvert la retrouve.
    await allerÀ(page, 'Plan');
    await ouvrir();
    expect(await cartes()).toContain(nom);
  });

  it('[niveau 1] point 1 (U1) — la carte se corrige sur place — nom, déjà de côté, montant du besoin, son nom — et chaque correction s’écrit aussitôt dans le projet', async () => {
    await ouvrir();
    const avant = (await cartes())[0]!;
    // Une correction à la fois, comme au doigt : la carte se redessine entre deux champs.
    const corriger = async (selecteur: string, valeur: string) => {
      await page.evaluate(
        (sel: string, v: string) => {
          const i = document.querySelector(`main .card.tirelire ${sel}`) as HTMLInputElement | null;
          if (!i) return;
          i.value = v;
          i.dispatchEvent(new Event('change', { bubbles: true }));
        },
        selecteur,
        valeur,
      );
      await pause(200);
    };
    await corriger('.deja input.mt', '45,00');
    await corriger('.ligne input.mt', '123,00');
    await corriger('.ligne input.besoin', 'Besoin renommé');
    await corriger('input.nom', 'Renommée en place');
    await allerÀ(page, 'Plan');
    await ouvrir();
    const lu = await page.evaluate(() => {
      const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === 'Renommée en place');
      return c
        ? {
            deja: (c.querySelector('.deja input.mt') as HTMLInputElement).value,
            montant: (c.querySelector('.ligne input.mt') as HTMLInputElement).value,
            besoin: (c.querySelector('.ligne input.besoin') as HTMLInputElement | null)?.value ?? null,
          }
        : null;
    });
    expect(lu, `la tirelire « ${avant} » renommée sur la carte doit se retrouver`).not.toBeNull();
    expect(lu!.deja).toBe('45,00');
    expect(lu!.montant).toBe('123,00');
    if (lu!.besoin !== null) expect(lu!.besoin).toBe('Besoin renommé');
  });

  it('[niveau 2] point 1 — la carte ajoute un besoin avec un nom et un montant par période, écrit dans le projet', async () => {
    await ouvrir();
    const lignes = () => page.evaluate(() => document.querySelectorAll('main .card.tirelire .ligne').length);
    const avant = await lignes();
    await page.evaluate(() => {
      const f = document.querySelector('main .card.tirelire form.ajout-besoin') as HTMLElement;
      const mettre = (i: HTMLInputElement, v: string) => {
        i.value = v;
        i.dispatchEvent(new Event('input', { bubbles: true }));
      };
      mettre(f.querySelector('input.besoin-nom') as HTMLInputElement, 'Besoin ajouté sur la carte');
      mettre(f.querySelector('input.mt') as HTMLInputElement, '12,00');
    });
    await pause(100);
    await page.evaluate(() => (document.querySelector('main .card.tirelire form.ajout-besoin button[type="submit"]') as HTMLButtonElement).click());
    await pause(300);
    expect(await lignes()).toBe(avant + 1);
    await allerÀ(page, 'Plan');
    await ouvrir();
    expect(await lignes()).toBe(avant + 1);
    expect(await page.evaluate(() => [...document.querySelectorAll('main .card.tirelire .ligne input.besoin')].some((i) => (i as HTMLInputElement).value === 'Besoin ajouté sur la carte'))).toBe(true);
  });

  it('[niveau 2] point 2 (D51, D59) — la carte garde « Réviser », « Modifier » et la priorité ; le panneau nommé porte les champs avancés', async () => {
    await ouvrir();
    const ligne = await page.evaluate(() => {
      const l = document.querySelector('main .card.tirelire .ligne .par-besoin') as HTMLElement;
      return { texte: (l.textContent ?? '').replace(/\s+/g, ' '), boutons: [...l.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()) };
    });
    expect(ligne.texte).toMatch(/priorité \d+/);
    expect(ligne.boutons).toEqual(expect.arrayContaining(['Réviser', 'Modifier']));
    expect(await page.evaluate(() => document.querySelector('main .card.tirelire')?.textContent?.includes('voulu :'))).toBe(true);
    // Le panneau de la tirelire : placement en parts, solde initial et sa date, plafond du report.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('main .card.tirelire > .actions button')].find((x) => (x.textContent ?? '').trim() === 'Modifier') as HTMLButtonElement;
      b.click();
    });
    await pause(250);
    const panneau = await page.evaluate(() => (document.querySelector('main form.edit')?.textContent ?? '').replace(/\s+/g, ' '));
    for (const mot of ['Placement voulu', 'Solde initial', 'Date du solde initial', 'Excédent en fin de période']) expect(panneau).toContain(mot);
    await cliquer(page, 'Annuler');
    // Le panneau d'un besoin : priorité et dates de validité.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('main .par-besoin button')].find((x) => (x.textContent ?? '').trim() === 'Modifier') as HTMLButtonElement;
      b.click();
    });
    await pause(250);
    const besoin = await page.evaluate(() => (document.querySelector('main form.edit')?.textContent ?? '').replace(/\s+/g, ' '));
    for (const mot of ['Priorité', 'En vigueur à partir du', 'En vigueur jusqu’au']) expect(besoin.replace(/'/g, '’')).toContain(mot);
    await cliquer(page, 'Annuler');
  });

  it('[niveau 2] point 2 (D59) — l’écran garde l’ajout d’un besoin de tout type sur une tirelire existante, par un panneau nommé', async () => {
    await ouvrir();
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('main .card.tirelire > .actions button')].find((x) => (x.textContent ?? '').includes('autre type')) as HTMLButtonElement;
      b.click();
    });
    await pause(250);
    const nom = (await cartes())[0]!;
    const panneau = await page.evaluate(() => {
      const f = document.querySelector('main form.edit') as HTMLElement;
      const types = [...(f.querySelector('select') as HTMLSelectElement).options].map((o) => o.value);
      return { titre: (f.querySelector('.titre-panneau')?.textContent ?? '').trim(), types };
    });
    expect(panneau.titre).toContain(nom);
    expect(panneau.types).toEqual(expect.arrayContaining(['dueDate', 'goal', 'payout']));
    await cliquer(page, 'Annuler');
  });

  it('[niveau 2] points 1 et 5 (#214) — le formulaire d’ajout est celui de la section, avec ses aides ; une échéance ajoute sa ligne et son prélèvement attendu', async () => {
    await ouvrir();
    expect(await cliquer(page, 'Ajouter une tirelire')).toBe(true);
    await pause(200);
    const aide = await page.evaluate(() => {
      const l = [...document.querySelectorAll('main form.edit label')].find((x) => (x.textContent ?? '').trim().startsWith('Quoi'));
      return (l?.querySelector('input') as HTMLInputElement | null)?.placeholder ?? null;
    });
    expect(aide, 'le champ « Quoi ? » porte l’aide de l’exemple').toBeTruthy();
    expect(await remplir('Quelle sorte', 'Dépense à échéance')).toBe(true);
    await pause(150);
    expect(await remplir('Quoi', 'Contrôle technique')).toBe(true);
    expect(await remplir('Montant de la facture', '90,00')).toBe(true);
    expect(await remplir('Prochaine échéance', '2027-03-01')).toBe(true);
    await pause(100);
    await page.evaluate(() => (document.querySelector('main form.edit button[type="submit"]') as HTMLButtonElement).click());
    await pause(300);
    expect(await cartes()).toContain('Contrôle technique');
    const carte = await page.evaluate(() => {
      const c = ([...document.querySelectorAll('main .card.tirelire')] as HTMLElement[]).find((x) => (x.querySelector('input.nom') as HTMLInputElement).value === 'Contrôle technique')!;
      return { echeance: !!c.querySelector('.ligne-echeance input[type="date"]'), prelevement: (c.querySelector('.prelevement')?.textContent ?? '').replace(/\s+/g, ' ').trim() };
    });
    expect(carte.echeance).toBe(true);
    expect(carte.prelevement).toMatch(/Prélèvement attendu/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'l’écran déborde à 375 px').toBe(true);
  });
});
