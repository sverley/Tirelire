/**
 * Harnais d'audit de #13 (PR #20), à l'écran : l'étape « Vos ordres permanents » mesurée contre le
 * besoin, à 375 px.
 *
 * La garde de la PR (`ordres-permanents.test.ts`) cherche des textes dans la page : « 650,00 »
 * quelque part, « Rattrapage » quelque part, le libellé du bouton qui change. Ce harnais compare
 * chaque bloc au plan que le cœur calcule pour le même exemple, et suit les gestes jusqu'à leur
 * effet :
 * - un bloc par compte cible ; la part permanente, pas le total du mois ; le libellé vu est celui
 *   qui est copié ; le détail des tirelires somme au montant de l'ordre ; un seul bouton ;
 * - au bout du parcours normal (Suivant… Mes virements), rien n'est enregistré ; un appui enregistre
 *   un flux, un second n'en fait pas un autre, et l'écran Flux prévus en témoigne ;
 * - le libellé se copie d'un geste, presse-papiers disponible ou non ;
 * - sans compte d'épargne, puis sans placement, l'étape le dit au lieu d'être vide ;
 * - un libellé tronqué à 35 caractères se lit en entier à 375 px.
 *
 * Les seuils tactiles restent à la garde de la PR ; les pastilles d'étapes sont une question ouverte
 * dans le fil de #20.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { computePlan, exampleLedger, type Ledger, type PlanTransfer } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from './harnais.js';

/** La date que pose « Charger l'exemple ». */
const JOUR = '2026-09-06';
const NOM_LONG = 'Livret développement durable et solidaire';

function ordresDuPlan(ledger: Ledger = exampleLedger()): PlanTransfer[] {
  return computePlan(ledger, JOUR).transfers.filter((t) => t.standing > 0);
}

/** « −1 200,00 € », « ← 20,00 € » → centimes signés. */
function centimes(texte: string): number {
  const chiffres = texte.replace(/[^\d,]/g, '');
  const valeur = Math.round(Number.parseFloat(chiffres.replace(',', '.')) * 100);
  return /[-−]\s*\d/.test(texte) ? -valeur : valeur;
}

/** Les blocs de l'étape, lus dans la page. */
function lireBlocs() {
  const net = (s?: string | null) => (s ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim();
  const cartes = [...document.querySelectorAll('.card')].filter(
    (c) => c.querySelector('code') && /^Vers /.test(net(c.querySelector('strong')?.textContent)),
  );
  return cartes.map((c) => {
    const code = c.querySelector('code') as HTMLElement;
    const détail = c.querySelector('.orders');
    const lignes = détail ? [...détail.querySelectorAll(':scope > .row')] : [];
    const r = code.getBoundingClientRect();
    return {
      compte: net(c.querySelector('strong')?.textContent).replace(/^Vers /, ''),
      montant: net(c.querySelector(':scope > .row > .num')?.textContent),
      copié: code.textContent ?? '',
      vu: code.innerText,
      servies: lignes
        .filter((l) => !l.classList.contains('total'))
        .map((l) => ({ nom: net(l.querySelector('.label')?.textContent), montant: net(l.querySelector('.num')?.textContent) })),
      total: net(lignes.find((l) => l.classList.contains('total'))?.querySelector('.num')?.textContent),
      texte: net(c.textContent),
      boutonsDEnregistrement: [...c.querySelectorAll('button')].filter((b) => /virement attendu/.test(b.textContent ?? '')).length,
      libelléEnEntier: r.left >= 0 && r.right <= document.documentElement.clientWidth && code.scrollWidth <= code.clientWidth + 1,
    };
  });
}

describe.skipIf(!navigateur)('#13 · « Vos ordres permanents » mesurée contre le besoin', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);

  afterAll(async () => {
    await site?.fermer();
  });

  const attendreTitre = (page: Page, titre: string) =>
    page.waitForFunction((t: string) => [...document.querySelectorAll('h2')].some((h) => h.textContent === t), { timeout: 10_000 }, titre);

  async function ouvrirLAssistant(page: Page) {
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Lancer'), "l'assistant est introuvable").toBe(true);
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Construire mon budget');
  }

  async function allerÀLÉtape(page: Page) {
    expect(await cliquer(page, 'Ordres permanents'), "l'étape est introuvable").toBe(true);
    await attendreTitre(page, 'Vos ordres permanents');
  }

  /** Nombre de flux prévus portant chacun de ces noms, lu sur l'écran Flux prévus. */
  async function fluxPrévus(page: Page, noms: string[]) {
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Flux prévus')).toBe(true);
    return page.evaluate(
      (ns: string[]) =>
        ns.map((n) => {
          const lignes = [...document.querySelectorAll('strong')].filter((s) => s.textContent?.trim() === n);
          return { nombre: lignes.length, montant: lignes[0]?.closest('.row')?.querySelector('.num')?.textContent ?? '' };
        }),
      noms,
    );
  }

  it("au bout du parcours normal, chaque bloc dit ce que calcule le plan, et rien n'est enregistré", async () => {
    const page = await ouvrirLExemple(site);
    await ouvrirLAssistant(page);
    for (let i = 0; i < 15 && !(await cliquer(page, 'Mes virements')); i++) {
      if (!(await cliquer(page, 'Commencer')) && !(await cliquer(page, 'Suivant'))) throw new Error('parcours bloqué avant « Mes virements »');
    }
    await attendreTitre(page, 'Vos ordres permanents');

    const plan = ordresDuPlan();
    const blocs = await page.evaluate(lireBlocs);
    expect(blocs.map((b) => b.compte).sort(), 'un bloc par compte cible, ni plus ni moins').toEqual(plan.map((t) => t.accountName).sort());

    for (const t of plan) {
      const b = blocs.find((x) => x.compte === t.accountName)!;
      const servies = t.orders.filter((o) => o.standing > 0);
      expect(centimes(b.montant), `${t.accountName} : le montant affiché n'est pas la part permanente`).toBe(t.standing);
      expect(centimes(b.total)).toBe(t.standing);
      expect(b.copié, "le libellé du bloc n'est pas celui du plan").toBe(t.label);
      expect(b.vu, 'le libellé vu diffère du libellé copié').toBe(b.copié);
      expect(b.servies.map((s) => s.nom)).toEqual(servies.map((o) => o.tirelireName));
      expect(b.servies.map((s) => centimes(s.montant))).toEqual(servies.map((o) => o.standing));
      expect(b.boutonsDEnregistrement, 'un bouton, et un seul, par bloc').toBe(1);
      expect(b.texte, 'un virement attendu existe déjà : enregistré d’office').not.toContain('Mettre à jour');
      if (t.exceptional > 0) expect(b.texte, 'le complément exceptionnel doit rester visible, à part').toContain('Rattrapage');
    }

    // La phrase qui dit ce qui se passera à l'import (D21, D06).
    const texte = await page.evaluate(() => (document.body.textContent ?? '').replace(/\s+/g, ' '));
    for (const idée of [/libellé/, /montant/, /ventilation prévue/, /ordre de financement/, /(planchers|rattrapages) d.abord/, /priorités/, /plan suivant/]) {
      expect(texte, `la phrase de suite ne dit pas : ${idée.source}`).toMatch(idée);
    }

    // Témoin indépendant de l'étape : l'écran Flux prévus.
    const flux = await fluxPrévus(page, plan.map((t) => `Virement ${t.accountName}`));
    expect(flux.map((f) => f.nombre), "un virement attendu existe sans qu'on ait appuyé").toEqual(plan.map(() => 0));
    await page.close();
  }, 90_000);

  it("un appui enregistre le virement attendu, un second n'en fait pas un autre", async () => {
    const page = await ouvrirLExemple(site);
    await ouvrirLAssistant(page);
    await allerÀLÉtape(page);
    const [t] = ordresDuPlan();

    expect(await cliquer(page, 'Enregistrer ce virement attendu')).toBe(true);
    expect(await cliquer(page, 'Mettre à jour le virement attendu')).toBe(true);

    const [flux] = await fluxPrévus(page, [`Virement ${t!.accountName}`]);
    expect(flux!.nombre, 'deux appuis doivent laisser un seul flux attendu').toBe(1);
    expect(centimes(flux!.montant), 'le flux enregistré ne porte pas la part permanente').toBe(-t!.standing);
    await page.close();
  }, 90_000);

  it("le libellé se copie d'un geste, presse-papiers disponible ou non", async () => {
    const page = await ouvrirLExemple(site);
    await ouvrirLAssistant(page);
    await allerÀLÉtape(page);
    const [t] = ordresDuPlan();

    await page.evaluate(() => {
      const w = window as unknown as { __copie?: string };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (x: string) => ((w.__copie = x), Promise.resolve()) },
      });
    });
    expect(await cliquer(page, 'Copier')).toBe(true);
    const copie = await page.evaluate(() => ({
      texte: (window as unknown as { __copie?: string }).__copie,
      confirmé: [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Copié'),
    }));
    expect(copie.texte, 'le presse-papiers ne reçoit pas le libellé exact').toBe(t!.label);
    expect(copie.confirmé, 'rien ne dit que la copie a eu lieu').toBe(true);

    // Presse-papiers refusé (contexte non sécurisé, navigateur ancien) : le texte est sélectionné.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('refusé')) } });
      window.getSelection()?.removeAllRanges();
    });
    expect(await cliquer(page, 'Copi')).toBe(true);
    expect(await page.evaluate(() => window.getSelection()?.toString()), 'sans presse-papiers, le libellé n’est pas sélectionné').toBe(t!.label);
    await page.close();
  }, 90_000);

  it("sans compte d'épargne, puis sans placement, l'étape le dit au lieu d'être vide", async () => {
    const contexte = await site.chrome.createBrowserContext();
    const page = await contexte.newPage();
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.goto(site.url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.body.textContent?.includes('Ouverture de la base'));
    await ouvrirLAssistant(page);
    await allerÀLÉtape(page);

    const lireÉtat = () =>
      page.evaluate(() => ({
        messages: [...document.querySelectorAll('.empty')].map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean),
        blocs: document.querySelectorAll('code').length,
        enregistrer: [...document.querySelectorAll('button')].some((b) => /virement attendu/.test(b.textContent ?? '')),
      }));

    const sansCompte = await lireÉtat();
    expect(sansCompte.messages, 'projet vide : l’étape n’explique rien').toHaveLength(1);
    expect(sansCompte.blocs + Number(sansCompte.enregistrer)).toBe(0);

    // On ajoute un compte comme l'étape le propose, sans déclarer de placement.
    expect(await cliquer(page, "Ajouter un compte d'épargne")).toBe(true);
    await attendreTitre(page, 'Vos comptes en banque');
    await page.evaluate(() => {
      const champ = document.querySelector('input[placeholder="Livret A"]') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(champ, 'Livret A');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(await cliquer(page, 'Ajouter un compte')).toBe(true);
    await allerÀLÉtape(page);

    const sansPlacement = await lireÉtat();
    expect(sansPlacement.messages, 'aucun placement déclaré : l’étape n’explique rien').toHaveLength(1);
    expect(sansPlacement.messages[0], 'le message ne suit pas la situation').not.toBe(sansCompte.messages[0]);
    expect(sansPlacement.blocs + Number(sansPlacement.enregistrer)).toBe(0);
    await contexte.close();
  }, 90_000);

  it('à 375 px, un libellé tronqué à 35 caractères se lit en entier, tel qu’il sera copié', async () => {
    const page = await ouvrirLExemple(site);
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, 'Comptes')).toBe(true);
    const ouvert = await page.evaluate(() => {
      const carte = [...document.querySelectorAll('.card')].find((c) => c.querySelector('strong')?.textContent?.trim() === 'Livret A');
      const bouton = carte && [...carte.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Modifier');
      (bouton as HTMLButtonElement | undefined)?.click();
      return !!bouton;
    });
    expect(ouvert, 'compte « Livret A » introuvable').toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate((nom: string) => {
      const champ = document.querySelector('form.edit input') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(champ, nom);
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    }, NOM_LONG);
    expect(await cliquer(page, 'Enregistrer')).toBe(true);

    await ouvrirLAssistant(page);
    await allerÀLÉtape(page);
    const renommé: Ledger = { ...exampleLedger(), accounts: exampleLedger().accounts.map((a) => (a.id === 'acc-livret' ? { ...a, name: NOM_LONG } : a)) };
    const t = ordresDuPlan(renommé).find((x) => x.accountId === 'acc-livret')!;
    expect(t.label).toHaveLength(35);

    const b = (await page.evaluate(lireBlocs)).find((x) => x.compte === NOM_LONG);
    const débordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.close();

    expect(b, 'le compte renommé n’a pas de bloc').toBeDefined();
    expect(b!.copié).toBe(t.label);
    expect(b!.vu, 'le libellé vu diffère du libellé copié').toBe(t.label);
    expect(b!.libelléEnEntier, 'le libellé est coupé à 375 px').toBe(true);
    expect(débordement).toBeLessThanOrEqual(0);
  }, 90_000);
});
