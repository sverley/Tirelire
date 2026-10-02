/**
 * Harnais d'audit de #184, côté écran — ce que le Plan, l'écran Tirelires et l'écran Opérations font
 * du manque d'une échéance et du lissage décidé (points 2, 3, 4, 5 et 7 du « Fait quand »). Le calcul,
 * la réponse enregistrée, la synchronisation et la conservation sont gardés dans le cœur
 * (`packages/core/test/manque-lissage-harnais.test.ts`) ; ici, seulement ce qui se voit et ce que
 * l'écran écrit.
 *
 * Écrits par l'auditeur : le codeur n'avait aucun test d'écran. Les parcours partent de l'exemple
 * chargé (« Charger l'exemple », lu au 6 septembre 2026), dont la taxe foncière porte son lissage
 * décidé : « Retirer le lissage » ramène le manque (100 € au 15 octobre) et sa proposition. Les
 * montants attendus sont relus dans le cœur, sur le même exemple, et non figés ici.
 *
 * Niveaux (D83) : 1 pour ce que le principe 1.4 promet à l'écran — le manque, annoncé aussitôt, avec
 * sa proposition (Plan et Tirelires) ; 0 pour ce qu'une modification de l'écran ne doit pas perdre,
 * la date d'une part de lissage ; 2 pour le reste de ce que le Plan donne à lire et à faire (refuser,
 * revenir sur le refus, lisser).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { dueDateShortfalls, euros, exampleLedger, formatCents } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));
/** Un montant tel que l'écran l'écrit, espaces normalisées comme à la lecture. */
const fmt = (c: number) => formatCents(c).replace(/\s+/g, ' ');
const LECTURE = '2026-09-06';

/** Le texte d'un élément de l'écran, espaces normalisées. */
const lire = (page: Page, selecteur: string) =>
  page.evaluate((s: string) => (document.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' ').trim(), selecteur);

/** Le bloc « Échéances en manque » du Plan, lu en une chaîne, et les boutons qu'il porte. */
async function blocManque(page: Page): Promise<{ texte: string; boutons: string[] } | null> {
  return page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const h2 = [...document.querySelectorAll('main h2')].find((h) => t(h) === 'Échéances en manque');
    let carte = h2?.nextElementSibling ?? null;
    while (carte && !carte.classList.contains('card')) carte = carte.nextElementSibling;
    if (!h2 || !carte) return null;
    return { texte: t(carte), boutons: [...carte.querySelectorAll('button')].map(t) };
  });
}

async function attendreLeBloc(page: Page, motif: RegExp): Promise<{ texte: string; boutons: string[] }> {
  for (let i = 0; i < 40; i++) {
    const b = await blocManque(page);
    if (b && motif.test(b.texte)) return b;
    await pause(100);
  }
  throw new Error(`le bloc « Échéances en manque » ne dit pas ${motif} : ${JSON.stringify(await blocManque(page))}`);
}

async function allerAuPlan(page: Page) {
  await allerÀ(page, 'Plan');
  await page.waitForFunction(() => [...document.querySelectorAll('main h2')].some((h) => h.textContent?.trim() === 'Tirelires'));
}

describe.skipIf(!navigateur)('#184 · le manque d’une échéance à l’écran (principe 1.4, D88)', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  });
  afterAll(async () => {
    await site?.fermer();
  });

  // Le montant, la date et la proposition que le cœur annonce pour la taxe foncière sans réponse.
  const manque = (() => {
    const l = exampleLedger();
    l.shortfallAnswers = [];
    l.operations = l.operations.filter((o) => o.id !== 'op-lissage-tf');
    l.subOperations = l.subOperations.filter((s) => s.operationId !== 'op-lissage-tf');
    return dueDateShortfalls(l, LECTURE).find((s) => s.needId === 'need-tf')!;
  })();

  it('[niveau 1] le Plan annonce le manque, montant et date, à côté de ce que l’ordre permanent demande, avec la proposition de lisser — et rien ne s’écrit sans le geste de l’utilisateur', async () => {
    const page = await ouvrirLExemple(site);
    try {
      await allerAuPlan(page);
      // L'exemple porte le lissage décidé de la taxe foncière : le bloc le dit, et se retire d'un geste.
      const decide = await attendreLeBloc(page, /Lissage décidé/);
      expect(decide.boutons).toContain('Retirer le lissage');
      expect(await cliquer(page, 'Retirer le lissage')).toBe(true);

      const b = await attendreLeBloc(page, /Il manquera/);
      expect(b.texte).toContain(`Il manquera ${fmt(manque.amount)}`);
      expect(b.texte).toMatch(/15 oct/);
      expect(b.texte).toContain(`l’ordre permanent en demande ${fmt(manque.cruise)} par période`);
      for (const part of manque.proposal!) expect(b.texte).toContain(fmt(part.amount));
      expect(b.boutons).toEqual(expect.arrayContaining(['Lisser', 'Modifier', 'Refuser']));
      expect(b.texte).not.toMatch(/Lissage décidé|Lissage refusé/);

      // Rien ne s'est lissé de soi-même : le plan de la période ne demande que la croisière de la taxe.
      const ligne = await page.evaluate(() => {
        const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
        return t([...document.querySelectorAll('main .row')].find((r) => t(r.querySelector('.label strong')) === 'Taxe foncière' && /croisière/.test(t(r))));
      });
      expect(ligne).toContain(`croisière ${fmt(manque.cruise)}`);
      expect(ligne).not.toMatch(/demandé|lissage décidé/);
    } finally {
      await page.close();
    }
  });

  it('[niveau 2] refuser, revenir sur le refus, puis lisser : la réponse se lit, la proposition ne revient pas, le manque qui reste se dit toujours', async () => {
    const page = await ouvrirLExemple(site);
    try {
      await allerAuPlan(page);
      await cliquer(page, 'Retirer le lissage');
      await attendreLeBloc(page, /Il manquera/);

      expect(await cliquer(page, 'Refuser')).toBe(true);
      const refuse = await attendreLeBloc(page, /Lissage refusé/);
      expect(refuse.boutons).toEqual(['Revenir sur le refus']);
      expect(refuse.texte).toContain(`Il manquera ${fmt(manque.amount)}`);
      expect(refuse.texte).not.toMatch(/Proposé/);

      expect(await cliquer(page, 'Revenir sur le refus')).toBe(true);
      const revenue = await attendreLeBloc(page, /Proposé/);
      expect(revenue.boutons).toEqual(expect.arrayContaining(['Lisser', 'Modifier', 'Refuser']));

      expect(await cliquer(page, 'Lisser')).toBe(true);
      const lisse = await attendreLeBloc(page, /Lissage décidé/);
      expect(lisse.boutons).toEqual(['Retirer le lissage']);
      expect(lisse.texte).not.toMatch(/Il manquera|Proposé/);
      for (const part of manque.proposal!) expect(lisse.texte).toContain(fmt(part.amount));
      // Le plan de la période lit la part du lissage décidé sur la ligne de la taxe.
      expect(await lire(page, 'main')).toContain(`dont lissage décidé ${fmt(euros(50))}`);
    } finally {
      await page.close();
    }
  });

  it('[niveau 1] une échéance qu’on vient d’enregistrer en manque se dit aussitôt : montant, date, croisière par période, proposition', async () => {
    const page = await ouvrirLExemple(site);
    try {
      await allerÀ(page, 'Plus');
      expect(await cliquer(page, 'Tirelires')).toBe(true);
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Tirelires');

      // Une tirelire neuve, puis une échéance de 120 € tous les 24 mois, au 10 novembre : trop proche.
      await page.evaluate(async () => {
        const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const attendre = () => new Promise((r) => setTimeout(r, 150));
        const remplir = async (f: Element, etiquette: string, valeur: string) => {
          const l = [...f.querySelectorAll('label')].find((x) => t(x).startsWith(etiquette));
          const c = l?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null;
          if (!c) throw new Error(`champ « ${etiquette} » introuvable`);
          if (c instanceof HTMLSelectElement) {
            const o = [...c.options].find((x) => t(x).startsWith(valeur)) ?? [...c.options].find((x) => x.value === valeur);
            if (!o) throw new Error(`« ${valeur} » absent du choix « ${etiquette} »`);
            c.value = o.value;
            c.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            c.value = valeur;
            c.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await attendre();
        };
        const bouton = (racine: ParentNode, libelle: string) => {
          const b = ([...racine.querySelectorAll('button')] as HTMLButtonElement[]).find((x) => t(x) === libelle);
          if (!b) throw new Error(`bouton « ${libelle} » introuvable`);
          return b;
        };
        bouton(document, 'Ajouter une tirelire').click();
        await attendre();
        let f = document.querySelector('form.edit') as HTMLFormElement;
        await remplir(f, 'Nom', 'Contrôle technique');
        f.requestSubmit();
        await attendre();
        const carte = [...document.querySelectorAll('.card')].find((c) => t(c.querySelector(':scope > .row > .label strong')) === 'Contrôle technique');
        if (!carte) throw new Error('carte « Contrôle technique » introuvable');
        bouton(carte, 'Ajouter un besoin').click();
        await attendre();
        f = document.querySelector('form.edit') as HTMLFormElement;
        await remplir(f, 'Type', 'Échéance');
        await remplir(f, 'Montant de l', '120,00');
        await remplir(f, 'Tous les', '24');
        await remplir(f, 'Première échéance', '2026-11-10');
        f.requestSubmit();
        await attendre();
      });

      await page.waitForFunction(() => !!document.querySelector('[role="status"]'), { timeout: 5000 });
      const annonce = await lire(page, '[role="status"]');
      expect(annonce).toMatch(/Il manquera [\d\s.,  ]*€ le 10 nov/);
      expect(annonce).toContain(`l’ordre permanent en demande ${fmt(euros(5))} par période`);
      expect(annonce).toMatch(/Proposé : lisser/);
      const boutons = await page.evaluate(() => [...document.querySelectorAll('[role="status"] button')].map((b) => (b.textContent ?? '').trim()));
      expect(boutons).toEqual(expect.arrayContaining(['Lisser', 'Modifier', 'Refuser']));
    } finally {
      await page.close();
    }
  });

  it('[niveau 0] l’éditeur de la ventilation montre la date d’une part de lissage, et la garde — modifiée ou non — à l’enregistrement', async () => {
    const page = await ouvrirLExemple(site);
    try {
      await allerÀ(page, 'Opérations');
      // L'opération du lissage est verrouillée : l'affichage « Toutes » la montre.
      const toutes = await page.evaluate(() => {
        const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => (o.textContent ?? '').trim() === 'Non traitées'));
        const o = s && [...s.options].find((x) => (x.textContent ?? '').trim() === 'Toutes');
        if (!s || !o) return false;
        s.value = o.value;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      });
      expect(toutes).toBe(true);
      await pause();

      const ouvrir = () =>
        page.evaluate(() => {
          const r = [...document.querySelectorAll('main .card .row')]
            .filter((x) => x.querySelector(':scope > label.cocher'))
            .find((x) => (x.querySelector(':scope > button.label strong')?.textContent ?? '').trim() === 'Lissage — Taxe foncière');
          const b = r?.querySelector(':scope > button.label') as HTMLButtonElement | undefined;
          b?.click();
          return !!b;
        });
      const dates = () => page.evaluate(() => [...document.querySelectorAll('form.edit input[type="date"]')].map((i) => (i as HTMLInputElement).value));

      expect(await ouvrir()).toBe(true);
      await pause();
      expect(await dates()).toEqual(['2026-08-28', '2026-09-28']);

      // La seconde part passe au 1er octobre, et on enregistre.
      await page.evaluate(() => {
        const champ = [...document.querySelectorAll('form.edit input[type="date"]')][1] as HTMLInputElement;
        champ.value = '2026-10-01';
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        (document.querySelector('form.edit') as HTMLFormElement).requestSubmit();
      });
      await pause(400);

      // Rouverte, l'opération garde ses deux dates : la première intacte, la seconde modifiée.
      expect(await ouvrir()).toBe(true);
      await pause();
      expect(await dates()).toEqual(['2026-08-28', '2026-10-01']);
    } finally {
      await page.close();
    }
  });
});
