/**
 * Harnais d'audit de #306, côté écran — ce que le Plan, l'écran Opérations et l'écran Flux prévus
 * font de la reprise (points 2, 4 et 5 du « Fait quand »). Le calcul, l'import, l'état et la
 * ventilation d'une reprise, la correction et le masquage, le format et le plan de l'exemple sont
 * gardés dans le cœur (`packages/core/test/reprise-harnais.test.ts`) ; ici, seulement ce qui se lit à
 * l'écran et ce que l'écran écrit.
 *
 * Écrits par l'auditeur : le codeur n'avait aucun test d'écran. Les parcours partent de l'exemple
 * chargé (« Charger l'exemple », lu au 6 septembre 2026), dont octobre 2026 est la première période
 * à venir et dont le salaire du 28 août a été repris par une opération du relevé. Les montants
 * attendus sont relus dans le cœur, sur le même exemple, et non figés ici.
 *
 * Niveaux (D83) : 1 pour ce que U1 promet à l'écran — corriger une opération prévue, ou la masquer,
 * depuis le détail d'un solde prévu, et la retrouver en retirant la saisie (point 2) ; 3 pour ce que
 * l'écran des opérations en dit, ce qu'une opération reprend et l'écart, et la reprise qui se défait
 * (point 4) ; 2 pour la seule sélection du flux à l'écran Flux prévus et la liste des automatismes
 * (point 5).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { applyPatchToLedger, computePlan, correctPlannedOperation, euros, exampleLedger, formatCents } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));
/** Un montant tel que l'écran l'écrit, espaces normalisées comme à la lecture. */
const fmt = (c: number) => formatCents(c).replace(/\s+/g, ' ');
const LECTURE = '2026-09-06';
const OCTOBRE = 'octobre 2026';
const DÉBUT_OCTOBRE = '2026-09-28';
const COMPTE = 'Compte courant';

/** Ce que le cœur calcule pour le compte courant en octobre, l'exemple éventuellement corrigé. */
const prévu = (corrige?: (l: ReturnType<typeof exampleLedger>) => ReturnType<typeof exampleLedger>) => {
  const l = corrige ? corrige(exampleLedger()) : exampleLedger();
  return computePlan(l, DÉBUT_OCTOBRE, LECTURE).forecast!.accounts.find((a) => a.name === COMPTE)!;
};
/** L'opération prévue du salaire, dans le détail d'octobre : elle se corrige ou se masque. */
const salaire = () => prévu().movements.find((m) => m.flowId === 'flow-salaire')!;

/** Le solde prévu que l'écran donne au compte courant, dans le bloc « Soldes prévus ». */
async function soldePrévu(page: Page): Promise<string | null> {
  return page.evaluate((nom: string) => {
    const texte = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const h2 = [...document.querySelectorAll('main h2')].find((h) => /^Soldes prévus/.test(texte(h)));
    for (let el = h2?.nextElementSibling ?? null; el; el = el.nextElementSibling) {
      for (const r of el.querySelectorAll(':scope > .row')) {
        if (texte(r.querySelector('.label')?.firstChild as Element | null) === nom) return texte(r.querySelector(':scope > div:last-child'));
      }
    }
    return null;
  }, COMPTE);
}

/** Déplie ou replie le détail du compte courant. */
async function déplier(page: Page): Promise<boolean> {
  const fait = await page.evaluate((nom: string) => {
    const texte = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const h2 = [...document.querySelectorAll('main h2')].find((h) => /^Soldes prévus/.test(texte(h)));
    for (let el = h2?.nextElementSibling ?? null; el; el = el.nextElementSibling) {
      for (const r of el.querySelectorAll(':scope > .row')) {
        if (texte(r.querySelector('.label')?.firstChild as Element | null) !== nom) continue;
        const b = r.nextElementSibling?.querySelector('button');
        if (!b) return false;
        (b as HTMLButtonElement).click();
        return true;
      }
    }
    return false;
  }, COMPTE);
  await pause(150);
  return fait;
}

interface Mouvement {
  libellé: string;
  sous: string;
  boutons: string[];
}

/** Les opérations du détail déplié : leur libellé, ce qui s'en dit, et les boutons qui les suivent. */
async function mouvements(page: Page): Promise<Mouvement[]> {
  return page.evaluate(() => {
    const texte = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('main .orders > .row')].map((r) => {
      const suite = r.nextElementSibling;
      return {
        libellé: texte(r.querySelector('.label')?.firstChild as Element | null),
        sous: [...r.querySelectorAll('.label > .sub')].map(texte).join(' | '),
        boutons: suite?.classList.contains('actions') ? [...suite.querySelectorAll('button')].map(texte) : [],
      };
    });
  });
}

/** Clique le bouton `bouton` qui suit l'opération `libellé` du détail, dont ce qui s'en dit contient `sous`. */
async function agir(page: Page, libellé: string, sous: RegExp, bouton: string): Promise<boolean> {
  const fait = await page.evaluate(
    (l: string, motif: string, b: string) => {
      const texte = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
      for (const r of document.querySelectorAll('main .orders > .row')) {
        if (texte(r.querySelector('.label')?.firstChild as Element | null) !== l) continue;
        if (!new RegExp(motif).test([...r.querySelectorAll('.label > .sub')].map(texte).join(' | '))) continue;
        const cible = [...(r.nextElementSibling?.classList.contains('actions') ? r.nextElementSibling.querySelectorAll('button') : [])].find((x) => texte(x) === b);
        if (!cible) return false;
        (cible as HTMLButtonElement).click();
        return true;
      }
      return false;
    },
    libellé,
    sous.source,
    bouton,
  );
  await pause(200);
  return fait;
}

/** Renseigne le montant du panneau « Corriger l'opération prévue », puis l'enregistre. */
async function corriger(page: Page, montant: string): Promise<boolean> {
  const fait = await page.evaluate((m: string) => {
    const f = document.querySelector('main form.edit.attached');
    const champ = f?.querySelector('input') as HTMLInputElement | null;
    const envoyer = [...(f?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'Enregistrer') as HTMLButtonElement | undefined;
    if (!champ || !envoyer) return false;
    champ.value = m;
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    envoyer.click();
    return true;
  }, montant);
  await pause(250);
  return fait;
}

/** Les textes d'une ligne d'opération de l'écran Opérations qui contient `motif`. */
async function ligneOpération(page: Page, motif: RegExp): Promise<string | null> {
  return page.evaluate((source: string) => {
    const texte = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const re = new RegExp(source);
    const lignes = [...document.querySelectorAll('main .row')].filter((r) => re.test(texte(r)));
    return lignes.length ? texte(lignes[lignes.length - 1]) : null;
  }, motif.source);
}

describe.skipIf(!navigateur)('#306 · la reprise à l’écran, à 375 px', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);
  afterAll(async () => {
    await site?.fermer();
  });

  it('[niveau 1] point 2 — dans le détail d’un solde prévu, l’utilisateur corrige une opération prévue ou la masque, et retire sa saisie pour la faire compter de nouveau', async () => {
    const page = await ouvrirLExemple(site);
    try {
      const mv = salaire();
      const initial = fmt(prévu().end);
      const corrigé = fmt(prévu((l) => applyPatchToLedger(l, correctPlannedOperation(l, 'flow-salaire', mv.date, euros(3000), mv.date))).end);
      const masqué = fmt(prévu((l) => applyPatchToLedger(l, correctPlannedOperation(l, 'flow-salaire', mv.date, 0, mv.date))).end);
      expect(new Set([initial, corrigé, masqué]).size, 'corriger ou masquer le salaire ne change rien : ce test ne vérifie rien').toBe(3);

      expect(await cliquer(page, OCTOBRE)).toBe(true);
      await pause(200);
      expect(await soldePrévu(page), 'le solde prévu d’octobre n’est pas celui du cœur').toBe(initial);
      expect(await déplier(page)).toBe(true);
      const avant = (await mouvements(page)).find((m) => m.libellé === mv.label && /prévue par ce flux/.test(m.sous));
      expect(avant, `l’opération prévue « ${mv.label} » n’est pas dans le détail`).toBeDefined();
      expect(avant!.boutons, 'une opération prévue se corrige et se masque depuis le détail').toEqual(expect.arrayContaining(['Corriger', 'Masquer']));

      // Corriger : elle vaudra 3 000 €, à la même date. Le solde prévu est celui que le cœur calcule.
      expect(await agir(page, mv.label, /prévue par ce flux/, 'Corriger')).toBe(true);
      expect(await corriger(page, '3000')).toBe(true);
      expect(await soldePrévu(page), 'après la correction, le solde prévu n’est pas celui du cœur').toBe(corrigé);
      const correction = (await mouvements(page)).find((m) => /corrige l’opération prévue/.test(m.sous));
      expect(correction, 'la saisie ne dit pas qu’elle corrige l’opération prévue').toBeDefined();
      expect(correction!.boutons).toContain('Retirer la correction');

      // Retirer la correction : l'opération prévue compte de nouveau.
      expect(await agir(page, correction!.libellé, /corrige l’opération prévue/, 'Retirer la correction')).toBe(true);
      expect(await soldePrévu(page), 'retirer la correction ne rend pas le solde prévu d’origine').toBe(initial);

      // Masquer : elle n'aura pas lieu. Retirer cette saisie la fait compter de nouveau.
      expect(await agir(page, mv.label, /prévue par ce flux/, 'Masquer')).toBe(true);
      expect(await soldePrévu(page), 'après le masquage, le solde prévu n’est pas celui du cœur').toBe(masqué);
      const masque = (await mouvements(page)).find((m) => /masque l’opération prévue/.test(m.sous));
      expect(masque, 'la saisie de zéro ne dit pas qu’elle masque l’opération prévue').toBeDefined();
      expect(masque!.boutons).toContain('Rétablir l’opération prévue');
      expect(await agir(page, masque!.libellé, /masque l’opération prévue/, 'Rétablir l’opération prévue')).toBe(true);
      expect(await soldePrévu(page), 'rétablir l’opération prévue ne rend pas le solde prévu d’origine').toBe(initial);
    } finally {
      await page.close().catch(() => {});
    }
  });

  it('[niveau 3] point 4 — l’écran des opérations dit ce qu’une opération reprend et l’écart de montant, et la reprise se défait', async () => {
    const page = await ouvrirLExemple(site);
    try {
      await allerÀ(page, 'Opérations');
      await pause(300);
      // L'écran s'ouvre sur les opérations non traitées : le salaire d'août est rapproché.
      const filtré = await page.evaluate(() => {
        const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => (o.textContent ?? '').trim() === 'Non traitées')) as HTMLSelectElement | undefined;
        const o = s && [...s.options].find((x) => (x.textContent ?? '').trim() === 'Toutes');
        if (!s || !o) return false;
        s.value = o.value;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      });
      expect(filtré, 'l’écran Opérations n’offre pas de lire toutes les opérations').toBe(true);
      await pause(300);
      const reprise = /reprend l’opération prévue « Salaire » du/;
      const ligne = await ligneOpération(page, reprise);
      expect(ligne, 'aucune ligne ne dit que le salaire d’août reprend l’opération prévue du salaire').not.toBeNull();
      // L'exemple : 3 400 € reçus pour 3 400 € prévus.
      expect(ligne).toMatch(/écart nul/);

      // Ouvrir la ligne, défaire la reprise : elle ne dit plus rien de tel.
      const ouvert = await page.evaluate(() => {
        const bouton = [...document.querySelectorAll('main .row button.label')].find((b) => /reprend l’opération prévue « Salaire » du/.test((b.textContent ?? '').replace(/\s+/g, ' ')));
        (bouton as HTMLButtonElement | undefined)?.click();
        return !!bouton;
      });
      expect(ouvert).toBe(true);
      await pause(200);
      expect(await cliquer(page, 'Défaire la reprise'), 'le panneau de l’opération n’offre pas de défaire la reprise').toBe(true);
      await pause(300);
      expect(await ligneOpération(page, reprise), 'la reprise défaite se lit encore à l’écran').toBeNull();
    } finally {
      await page.close().catch(() => {});
    }
  });

  it('[niveau 2] point 5 — un flux n’a qu’une sélection : un seul jeu de critères à l’écran Flux prévus, aucun automatisme engendré, aucun dans la liste des automatismes', async () => {
    const page = await ouvrirLExemple(site);
    try {
      const automatismes = async () => {
        await allerÀ(page, 'Bilan');
        await pause(200);
        return page.evaluate(() => {
          const h = [...document.querySelectorAll('h2')].find((x) => (x.textContent ?? '').trim() === 'Automatismes');
          let e = h?.nextElementSibling ?? null;
          while (e && !e.classList.contains('card')) e = e.nextElementSibling;
          return e ? [...e.querySelectorAll(':scope > .row')].map((r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim()) : null;
        });
      };
      const avant = await automatismes();
      expect(avant, 'le Bilan ne montre pas sa liste d’automatismes').not.toBeNull();
      expect(avant!.filter((t) => /issu d’un flux/.test(t))).toEqual([]);

      await allerÀ(page, 'Plus');
      await cliquer(page, 'Flux prévus');
      await pause(300);
      const modifié = await page.evaluate(() => {
        const b = [...document.querySelectorAll('main button')].find((x) => (x.textContent ?? '').trim() === 'Modifier');
        (b as HTMLButtonElement | undefined)?.click();
        return !!b;
      });
      expect(modifié, 'aucun flux ne se modifie à l’écran Flux prévus').toBe(true);
      await pause(250);
      const champs = await page.evaluate(() => [...document.querySelectorAll('main form.edit label')].map((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim()));
      expect(champs.length, 'le formulaire du flux ne s’est pas ouvert').toBeGreaterThan(0);
      // Un seul jeu de critères : le compte, le motif de libellé, la tolérance de montant, la fenêtre.
      expect(champs.filter((c) => /^Motif de libellé/.test(c))).toHaveLength(1);
      expect(champs.filter((c) => /^Tolérance de montant/.test(c))).toHaveLength(2);
      expect(champs.filter((c) => /^Fenêtre/.test(c))).toHaveLength(1);
      expect(champs.filter((c) => /automatisme/i.test(c)), 'le flux propose encore de créer un automatisme à part').toEqual([]);
      expect(champs.some((c) => /^Verrouiller les opérations que ce flux reprend/.test(c))).toBe(true);

      // Enregistrer le flux, verrouillage demandé : aucun automatisme de plus.
      const enregistré = await page.evaluate(() => {
        const f = document.querySelector('main form.edit');
        const case_ = [...(f?.querySelectorAll('label.check') ?? [])].find((l) => /^Verrouiller les opérations/.test((l.textContent ?? '').trim()))?.querySelector('input') as HTMLInputElement | null;
        if (case_ && !case_.checked) case_.click();
        const b = [...(f?.querySelectorAll('button') ?? [])].find((x) => (x.textContent ?? '').trim() === 'Enregistrer') as HTMLButtonElement | undefined;
        b?.click();
        return !!b;
      });
      expect(enregistré).toBe(true);
      await pause(300);
      expect(await automatismes(), 'enregistrer un flux a engendré un automatisme').toEqual(avant);
    } finally {
      await page.close().catch(() => {});
    }
  });
});
