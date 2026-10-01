/**
 * Tests du codeur de #296, côté écran — le plan d'une période à venir montre le solde prévu des
 * comptes et des tirelires, et les opérations qui le font se lisent sur demande, chacune avec son
 * origine, repliées par défaut (point 4 du « Fait quand »). Le calcul est gardé dans le cœur
 * (`packages/core/test/solde-prevu.test.ts`) ; ici, seulement ce qui se lit à l'écran.
 *
 * L'exemple chargé par « Charger l'exemple » se lit au 6 septembre 2026 ; octobre 2026 est la
 * première période à venir. Les montants ne sont pas figés : ils sont relus dans le cœur, sur le même
 * grand livre. Tous de niveau 4 (rôle du codeur).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { computePlan, exampleLedger, formatCents } from '@tirelire/core';
import { cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LECTURE = '2026-09-06';
const OCTOBRE = 'octobre 2026';
const DÉBUT_OCTOBRE = '2026-09-28';
/** Un montant tel que l'écran l'écrit, espaces normalisées comme à la lecture. */
const fmt = (c: number) => formatCents(c).replace(/\s+/g, ' ');

interface Ligne {
  nom: string;
  montant: string;
  sous: string[];
  bouton?: string;
  détail: Array<{ libellé: string; sous: string; montant: string }>;
}

/** Le bloc « Soldes prévus », lu tel qu'affiché : ses comptes, ses tirelires, et ce qui est déplié. */
async function soldesPrévus(page: Page): Promise<{ titre: string; comptes: Ligne[]; tirelires: Ligne[] } | null> {
  return page.evaluate(() => {
    const h2 = [...document.querySelectorAll('main h2')].find((h) => /^Soldes prévus/.test(h.textContent?.trim() ?? ''));
    if (!h2) return null;
    const texte = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const lire = (titre: string) => {
      let el = h2.nextElementSibling;
      while (el && !(el.tagName === 'H3' && texte(el) === titre)) el = el.nextElementSibling;
      const carte = el?.nextElementSibling;
      const out: Array<{ nom: string; montant: string; sous: string[]; bouton?: string; détail: Array<{ libellé: string; sous: string; montant: string }> }> = [];
      for (const enfant of carte ? [...carte.children] : []) {
        if (enfant.classList.contains('row')) {
          out.push({
            nom: texte(enfant.querySelector('.label')?.firstChild as Element | null),
            montant: texte(enfant.querySelector(':scope > div:last-child')),
            sous: [...enfant.querySelectorAll('.label > .sub')].map(texte),
            détail: [],
          });
        } else if (enfant.classList.contains('actions')) {
          const dernier = out[out.length - 1];
          if (dernier) dernier.bouton = texte(enfant.querySelector('button'));
        } else if (enfant.classList.contains('orders')) {
          // Le premier bloc déplié sous une ligne est celui des opérations ; les suivants (opérations
          // non reçues, parts des tirelires hébergées) n'en sont pas.
          const dernier = out[out.length - 1];
          if (!dernier || enfant.previousElementSibling?.classList.contains('orders')) continue;
          for (const r of enfant.querySelectorAll('.row'))
            dernier.détail.push({ libellé: texte(r.querySelector('.label')?.firstChild as Element | null), sous: texte(r.querySelector('.sub')), montant: texte(r.querySelector(':scope > div:last-child')) });
        }
      }
      return out;
    };
    return { titre: texte(h2), comptes: lire('Comptes'), tirelires: lire('Tirelires') };
  });
}

/** Clique le bouton « Détail » qui suit la ligne `nom` du bloc. */
async function déplier(page: Page, nom: string): Promise<boolean> {
  const fait = await page.evaluate((n: string) => {
    const h2 = [...document.querySelectorAll('main h2')].find((h) => /^Soldes prévus/.test(h.textContent?.trim() ?? ''));
    let el = h2?.nextElementSibling ?? null;
    for (; el; el = el.nextElementSibling) {
      for (const r of el.querySelectorAll(':scope > .row')) {
        if ((r.querySelector('.label')?.firstChild?.textContent ?? '').trim() !== n) continue;
        const b = r.nextElementSibling?.querySelector('button');
        if (!b) return false;
        (b as HTMLButtonElement).click();
        return true;
      }
    }
    return false;
  }, nom);
  await pause(150);
  return fait;
}

describe.skipIf(!navigateur)('#296 · le solde prévu à l’écran Plan, à 375 px', () => {
  let site: Site;
  let page: Page;
  const plan = computePlan(exampleLedger(), DÉBUT_OCTOBRE, LECTURE);

  beforeAll(async () => {
    site = await ouvrirLeSite();
    page = await ouvrirLExemple(site);
  }, 120_000);
  afterAll(async () => {
    await page?.close().catch(() => {});
    await site?.fermer();
  });

  it('[niveau 4] la période où l’on lit ne montre pas de solde prévu', async () => {
    expect(await soldesPrévus(page)).toBeNull();
  });

  it('[niveau 4] point 1 — octobre montre le solde prévu de chaque compte et de chaque tirelire, celui que le cœur calcule', async () => {
    expect(await cliquer(page, OCTOBRE)).toBe(true);
    await pause(200);
    const bloc = await soldesPrévus(page);
    expect(bloc, 'pas de bloc « Soldes prévus » en octobre').not.toBeNull();
    const f = plan.forecast!;
    expect(bloc!.comptes.map((c) => [c.nom, c.montant])).toEqual(f.accounts.map((a) => [a.name, fmt(a.end)]));
    expect(bloc!.tirelires.map((t) => [t.nom, t.montant])).toEqual(f.tirelires.map((t) => [t.name, fmt(t.end)]));
  });

  it('[niveau 4] point 3 — un manque se lit avec sa date et son montant', async () => {
    const bloc = (await soldesPrévus(page))!;
    for (const a of plan.forecast!.accounts.filter((x) => x.shortfall)) {
      const l = bloc.comptes.find((c) => c.nom === a.name)!;
      expect(l.sous.join(' | ')).toMatch(/Manque/);
      expect(l.sous.join(' | ')).toContain(fmt(a.shortfall!.amount));
    }
    expect(plan.forecast!.accounts.some((a) => a.shortfall), 'l’exemple n’a aucun manque en octobre : ce test ne vérifie rien').toBe(true);
  });

  it('[niveau 4] point 4 — repliées par défaut, les opérations se lisent sur demande, chacune avec son origine', async () => {
    let bloc = (await soldesPrévus(page))!;
    for (const l of [...bloc.comptes, ...bloc.tirelires]) expect(l.détail, `« ${l.nom} » est déplié par défaut`).toEqual([]);

    expect(await déplier(page, 'Compte courant')).toBe(true);
    expect(await déplier(page, 'Taxe foncière')).toBe(true);
    bloc = (await soldesPrévus(page))!;
    const courant = bloc.comptes.find((c) => c.nom === 'Compte courant')!;
    const attendu = plan.forecast!.accounts.find((a) => a.name === 'Compte courant')!;
    expect(courant.détail.length).toBe(attendu.movements.length);
    expect(courant.détail.some((d) => /prévue par ce flux/.test(d.sous) && d.libellé === 'Salaire')).toBe(true);
    const taxe = bloc.tirelires.find((t) => t.nom === 'Taxe foncière')!;
    expect(taxe.détail.map((d) => d.sous).join(' | ')).toMatch(/dotation/);
    expect(taxe.détail.some((d) => d.libellé === 'Taxe foncière (prélèvement)' && /prévue par ce flux/.test(d.sous))).toBe(true);

    // Replier rend l'état par défaut.
    expect(await déplier(page, 'Compte courant')).toBe(true);
    bloc = (await soldesPrévus(page))!;
    expect(bloc.comptes.find((c) => c.nom === 'Compte courant')!.détail).toEqual([]);
  });

  it('[niveau 4] déplié, l’écran ne déborde pas à 375 px', async () => {
    expect(await déplier(page, 'Compte courant')).toBe(true);
    const déborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(déborde).toBe(false);
  });
});
