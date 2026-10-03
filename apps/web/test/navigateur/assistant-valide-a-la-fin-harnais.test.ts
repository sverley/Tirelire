/**
 * Harnais d'audit de #210, côté écran — ce que l'assistant fait entrer dans le projet, et quand : sur le site
 * construit, à 375 px. Points 1 à 5 du « Fait quand » ; le point 6 (les documents) se relit, sans test.
 *
 * Retenus parmi les tests du codeur (`navigateur/assistant-valide-a-la-fin.test.ts`, d'où ils sont déplacés, ce
 * fichier-là n'existe plus), puis complétés. Ce que ses tests laissaient sans observation : le compte principal
 * renseigné, les autres comptes, le placement des réserves, le début de période (le point 1 les nomme) et la
 * correction d'une ligne (il ne retirait que). Ici, « rien n'est entré dans le projet » se lit de la même façon
 * partout : les écrans ordinaires (Plan, Comptes, Flux prévus, Tirelires, Réglages) disent exactement ce qu'ils
 * disaient avant d'ouvrir l'assistant, y compris après un rechargement, qui rouvre le fichier enregistré.
 *
 * Niveaux (D83), par phrase du « Fait quand » :
 *  - 1 pour le point 1 : sa phrase est la valeur d'I10 telle qu'elle est écrite (« le budget et les flux ne
 *    changent que sur une validation de l'utilisateur »). Pas 0 : le dépôt retire par suppression logique, la ligne
 *    reste, datée ; rien n'est perdu ni sorti de l'appareil.
 *  - 1 pour le point 2 : si la validation n'écrivait pas tout ce que l'assistant montre, U1 (« le budget seul se
 *    construit par l'assistant ») ne serait plus tenu. Les points 5 (I11, I4) sont tenus par les harnais que le
 *    codeur a adaptés, `assistant-equivalent` et `assistant-simple` : ils ne sont pas répétés ici ; la validation
 *    de ce fichier-ci se parcourt aux seuls boutons primaires.
 *  - 3 pour le point 3, ce qui se retrouve en revenant et ce que dit le résumé : le résultat reste juste, mais
 *    perdre ce qu'on avait préparé en changeant d'onglet, ou ne pas savoir que rien n'est enregistré, le rend
 *    moins bon. Quitter sans valider n'enregistre rien est, lui, le point 1.
 *  - 2 pour la perte au remplacement du projet (« Tout effacer », ouverture d'un fichier ; phrase ajoutée au point 3
 *    par l'architecte le 03/10) : ce qui était préparé sur un projet ne doit pas se valider sur un autre, ce serait
 *    un cas faux, l'usage restant possible.
 *  - 2 pour le point 4 : D43 et D46 sont des décisions, des propositions qui reviennent ou qui manquent en sont
 *    un cas faux.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import type { Page } from 'puppeteer-core';
import { LedgerStore } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const SQL = await initSqlJs();
const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
const NOM_PRINCIPAL = 'Compte de la maison';
const NOM_AUTRE_COMPTE = 'Livret de la maison';

/** Ce que l'écran montre : titres, boutons, boutons primaires de l'assistant, texte. */
const lire = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return {
      h1: t(document.querySelector('main h1')),
      h2: t(document.querySelector('main h2')),
      primaires: ([...document.querySelectorAll('main .actions button.primary')] as HTMLButtonElement[]).map(t),
      boutons: ([...document.querySelectorAll('main button')] as HTMLButtonElement[]).map(t),
      texte: t(document.querySelector('main')),
    };
  });

/** Les noms que l'étape en cours montre dans ses champs de nom. */
const noms = (page: Page) =>
  page.evaluate(() => ([...document.querySelectorAll('main input.nom')] as HTMLInputElement[]).map((i) => i.value.trim()).filter(Boolean));

async function attendreLApplication(page: Page) {
  await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
}

async function ouvrir(page: Page, site: Site) {
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await attendreLApplication(page);
}

async function recharger(page: Page) {
  await pause(900); // l'application conserve son fichier peu après la dernière écriture
  await page.reload({ waitUntil: 'networkidle0' });
  await attendreLApplication(page);
}

/** Clique le bouton primaire « Suivant » ou « Commencer » ; rend faux s'il n'y en a pas. */
async function avancer(page: Page): Promise<boolean> {
  const fait = await page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const b = ([...document.querySelectorAll('main .actions button.primary')] as HTMLButtonElement[]).find((x) => /Suivant|Commencer/.test(t(x)));
    b?.click();
    return !!b;
  });
  await pause(250);
  return fait;
}

/** Du point où l'on est jusqu'au résumé, par les seuls boutons primaires ; rend les noms que chaque étape montrait à l'arrivée. */
async function jusquAuResume(page: Page): Promise<Map<string, string[]>> {
  const parEtape = new Map<string, string[]>();
  for (let i = 0; i < 14; i++) {
    const e = await lire(page);
    if (e.primaires.includes('Valider mon budget')) return parEtape;
    parEtape.set(e.h2 || e.h1, await noms(page));
    if (!(await avancer(page))) break;
  }
  return parEtape;
}

/** Saisit une valeur dans le `indice`-ième champ de ce sélecteur, comme le fait la saisie : `input`, puis `change`. */
async function saisir(page: Page, sélecteur: string, valeur: string, indice = 0) {
  const fait = await page.evaluate(
    (s: string, v: string, i: number) => {
      const el = document.querySelectorAll(s)[i] as HTMLInputElement | undefined;
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    sélecteur,
    valeur,
    indice,
  );
  expect(fait, `champ introuvable : ${sélecteur} (n° ${indice})`).toBe(true);
  await pause(200);
}

/** Corrige le nom de la ligne qui porte `ancien`, dans l'étape en cours. */
async function renommer(page: Page, ancien: string, nouveau: string) {
  const liste = await noms(page);
  const indice = liste.indexOf(ancien);
  expect(indice, `« ${ancien} » n’est pas dans l’étape en cours : ${liste.join(', ')}`).toBeGreaterThanOrEqual(0);
  await saisir(page, 'main input.nom', nouveau, indice);
}

/** Retire d'un clic la ligne qui porte ce nom, dans l'étape en cours. */
async function retirerLigne(page: Page, nom: string) {
  const fait = await page.evaluate((n: string) => {
    const champ = ([...document.querySelectorAll('main input.nom')] as HTMLInputElement[]).find((i) => i.value.trim() === n);
    const ligne = champ?.closest('.ligne-flux, .row, .card');
    const b = ligne?.querySelector('button.danger') as HTMLButtonElement | null;
    b?.click();
    return !!b;
  }, nom);
  expect(fait, `la ligne « ${nom} » n’a pas de bouton pour la retirer`).toBe(true);
  await pause(250);
}

/** Ouvre l'assistant sur un projet vierge, depuis le Plan. */
async function ouvrirLAssistant(page: Page) {
  await allerÀ(page, 'Plan');
  await cliquer(page, 'Construire mon budget');
  await pause(300);
}

/** Ouvre l'assistant sur un projet existant, depuis Configuration. */
async function lancerLAssistant(page: Page) {
  await allerÀ(page, 'Plus');
  expect(await cliquer(page, 'Lancer'), 'pas de bouton « Lancer » pour ouvrir l’assistant').toBe(true);
  await pause(300);
}

async function allerALEtape(page: Page, titre: RegExp) {
  for (let i = 0; i < 12 && !titre.test((await lire(page)).h2); i++) await avancer(page);
  expect((await lire(page)).h2, `l’étape ${titre} n’a pas été atteinte`).toMatch(titre);
}

/** Remonte, par « Précédent », jusqu'à l'étape qui porte ce titre : on retrouve l'assistant là où on l'a quitté. */
async function remonterALEtape(page: Page, titre: RegExp) {
  for (let i = 0; i < 12 && !titre.test((await lire(page)).h2); i++) {
    await cliquer(page, 'Précédent');
    await pause(200);
  }
  expect((await lire(page)).h2, `l’étape ${titre} n’a pas été retrouvée en remontant`).toMatch(titre);
}

/** Le texte d'un écran ordinaire, atteint par le menu Plus. */
async function ecranOrdinaire(page: Page, ecran: string): Promise<string> {
  await allerÀ(page, 'Plus');
  expect(await cliquer(page, ecran), `pas d’écran « ${ecran} » dans le menu Plus`).toBe(true);
  await pause(200);
  return (await lire(page)).texte;
}

/** Ce que disent les écrans qui lisent le projet : Plan, Comptes, Flux prévus, Tirelires, et le jour de début de période (Réglages). */
async function projetLu(page: Page) {
  await allerÀ(page, 'Plan');
  await pause(200);
  const plan = (await lire(page)).texte;
  const comptes = await ecranOrdinaire(page, 'Comptes');
  const flux = await ecranOrdinaire(page, 'Flux prévus');
  const tirelires = await ecranOrdinaire(page, 'Tirelires');
  await ecranOrdinaire(page, 'Réglages');
  const jour = await page.evaluate(() => {
    const h = [...document.querySelectorAll('main h2')].find((x) => (x.textContent ?? '').includes('Début de la période budgétaire'));
    return (h?.nextElementSibling?.querySelector('input') as HTMLInputElement | null)?.value ?? null;
  });
  return { plan, comptes, flux, tirelires, jour };
}

/** Rien n'a changé dans ce que lisent les écrans ordinaires, écran par écran : le message dit lequel a bougé. */
function memeProjet(obtenu: Awaited<ReturnType<typeof projetLu>>, attendu: Awaited<ReturnType<typeof projetLu>>, quand: string) {
  for (const ecran of ['plan', 'comptes', 'flux', 'tirelires', 'jour'] as const) {
    expect(obtenu[ecran], `${quand} : l’écran « ${ecran} » n’est plus ce qu’il était à l’ouverture de l’assistant`).toEqual(attendu[ecran]);
  }
}

/**
 * Prépare un budget dans l'assistant d'un projet vierge, sans le valider : le compte principal renseigné, les
 * comptes et les lignes proposés d'office, le début de période au jour de la paie, une réserve placée sur un
 * autre compte. Rend ce qui a été préparé.
 */
async function preparer(page: Page) {
  await ouvrirLAssistant(page);
  await avancer(page); // le principe → les comptes
  await saisir(page, 'main .ligne-compte.principal input', NOM_PRINCIPAL, 0);
  await saisir(page, 'main .ligne-compte.principal input.mt', '1234,56');
  // L'assistant ne propose aucun autre compte d'office : on en ajoute un, par le formulaire de l'étape.
  await saisir(page, 'main form.edit input[placeholder="Livret A"]', NOM_AUTRE_COMPTE);
  expect(await cliquer(page, 'Ajouter un compte'), 'pas de bouton « Ajouter un compte »').toBe(true);
  await pause(250);
  const autresComptes = await page.evaluate(() =>
    ([...document.querySelectorAll('main .ligne-compte:not(.principal)')] as HTMLElement[])
      .map((l) => (l.querySelector('input') as HTMLInputElement).value.trim())
      .filter(Boolean),
  );
  await avancer(page); // → les revenus
  expect(await cliquer(page, 'Commencer au jour de ma paie'), 'pas de proposition « Commencer au jour de ma paie »').toBe(true);
  await pause(200);
  const jour = await page.evaluate(() => {
    const champ = [...document.querySelectorAll('main label.f')].find((l) => (l.textContent ?? '').includes('La période commence le'));
    return (champ?.querySelector('input') as HTMLInputElement | null)?.value ?? null;
  });
  expect(jour, 'le jour de début de période n’a pas changé').not.toBe('1');
  const parEtape = await jusquAuResume(page);

  // Une réserve placée ailleurs que sur le compte principal (le résumé en propose le choix).
  const placement = await page.evaluate(() => {
    const choix = ([...document.querySelectorAll('main select')] as HTMLSelectElement[]).find((s) => [...s.options].some((o) => o.textContent?.trim() === 'Peu importe'));
    if (!choix) return null;
    const option = [...choix.options].find((o) => o.value && o.value !== 'acc-principal');
    if (!option) return null;
    const reserve = (choix.closest('.card')?.querySelector('.label strong')?.textContent ?? '').trim();
    choix.value = option.value;
    choix.dispatchEvent(new Event('change', { bubbles: true }));
    return { reserve, compte: (option.textContent ?? '').trim() };
  });
  await pause(250);
  return { autresComptes, jour, parEtape, placement };
}

describe.skipIf(!navigateur)('#210 · l’assistant n’écrit dans le projet qu’à sa validation', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 300_000);

  afterAll(async () => {
    await site?.fermer();
  });

  describe('[niveau 1] point 1 — rien de ce que l’assistant montre n’entre dans le projet avant la validation', () => {
    it('projet vierge : ni les propositions d’office, ni le compte principal renseigné, ni les autres comptes, ni le début de période, ni le placement ; pas davantage après un rechargement', async () => {
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        const avant = await projetLu(page);
        expect(avant.comptes, 'le compte principal porte déjà le nom que l’assistant va lui donner').not.toContain(NOM_PRINCIPAL);

        const prepare = await preparer(page);
        // Le budget est bien préparé : des lignes d'office, un autre compte, un placement.
        expect([...prepare.parEtape.values()].flat().length, 'l’assistant ne propose rien d’office dans un projet vierge').toBeGreaterThanOrEqual(3);
        expect(prepare.autresComptes.length, 'l’assistant ne propose aucun autre compte').toBeGreaterThanOrEqual(1);
        expect(prepare.placement, 'le résumé ne propose pas de placer une réserve').not.toBeNull();
        expect((await lire(page)).primaires).toContain('Valider mon budget');

        // On quitte l'assistant sans valider : les écrans qui lisent le projet n'ont rien reçu.
        memeProjet(await projetLu(page), avant, 'avant la validation');

        // Le fichier enregistré non plus : un rechargement le rouvre tel qu'il était, et l'assistant repart du début.
        await recharger(page);
        memeProjet(await projetLu(page), avant, 'après un rechargement sans validation');
        await ouvrirLAssistant(page);
        const debut = await lire(page);
        expect(debut.h1).toBe('Construire mon budget');
        expect(debut.primaires.some((p) => p.includes('Commencer'))).toBe(true);
      } finally {
        await page.close();
      }
    }, 240_000);

    it('projet existant : l’assistant part du contenu, une ligne corrigée, une ligne retirée et un placement changé n’entrent qu’à la validation', async () => {
      const page = await ouvrirLExemple(site);
      try {
        const avant = await projetLu(page);

        await lancerLAssistant(page);
        await allerALEtape(page, /Qu.est-ce qui rentre/);
        const rentrees = await noms(page);
        expect(rentrees.length, 'l’assistant ne part pas du contenu du projet').toBeGreaterThanOrEqual(2);
        // Deux rentrées qui n'ont pas de sosie : leur correction et leur retrait se lisent sur leur nom.
        const uniques = rentrees.filter((n) => rentrees.filter((x) => x === n).length === 1);
        expect(uniques.length, 'les rentrées de l’exemple ont des homonymes').toBeGreaterThanOrEqual(2);
        const [corrigee, retiree] = uniques as [string, string];
        const corrigeeEn = `${corrigee} corrigée`;
        expect(avant.flux).toContain(corrigee);
        expect(avant.flux).toContain(retiree);

        await renommer(page, corrigee, corrigeeEn);
        await retirerLigne(page, retiree);
        expect(await noms(page)).toContain(corrigeeEn);
        expect(await noms(page)).not.toContain(retiree);

        await jusquAuResume(page);
        const placement = await page.evaluate(() => {
          const choix = ([...document.querySelectorAll('main select')] as HTMLSelectElement[]).find((s) => [...s.options].some((o) => o.textContent?.trim() === 'Peu importe'));
          if (!choix) return null;
          const actuel = choix.value;
          const option = [...choix.options].find((o) => o.value !== actuel);
          if (!option) return null;
          const reserve = (choix.closest('.card')?.querySelector('.label strong')?.textContent ?? '').trim();
          choix.value = option.value;
          choix.dispatchEvent(new Event('change', { bubbles: true }));
          return { reserve, compte: (option.textContent ?? '').trim() };
        });
        expect(placement, 'le résumé de l’exemple ne propose pas de placer une réserve').not.toBeNull();
        await pause(250);

        // Rien n'est entré : le projet est celui d'avant, correction, retrait et placement compris.
        memeProjet(await projetLu(page), avant, 'avant la validation');

        // On revient dans l'assistant : il reprend où on l'a quitté, au résumé ; la correction et le retrait y sont toujours.
        await lancerLAssistant(page);
        expect((await lire(page)).primaires, 'l’assistant ne reprend pas où il en était').toContain('Valider mon budget');
        await remonterALEtape(page, /Qu.est-ce qui rentre/);
        expect(await noms(page)).toContain(corrigeeEn);
        expect(await noms(page)).not.toContain(retiree);
        await jusquAuResume(page);
        expect(await cliquer(page, 'Valider mon budget')).toBe(true);
        await pause(400);

        // La validation les fait entrer.
        const apres = await projetLu(page);
        expect(apres.flux, 'la correction n’est pas entrée à la validation').toContain(corrigeeEn);
        expect(apres.flux, 'le retrait n’est pas entré à la validation').not.toContain(retiree);
        expect(apres.tirelires, 'le placement n’est pas entré à la validation').not.toEqual(avant.tirelires);
      } finally {
        await page.close();
      }
    }, 300_000);
  });

  describe('[niveau 1] point 2 — la validation fait entrer exactement ce que l’assistant montre, tout en une fois', () => {
    it('projet vierge, aux seuls boutons primaires : comptes, lignes, tirelires, début de période et placement entrent ; ils survivent à un rechargement ; le plan dote des tirelires', async () => {
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        const prepare = await preparer(page);
        const lignes = [...prepare.parEtape].filter(([etape]) => !/comptes/i.test(etape));
        const nomsFlux = lignes.filter(([etape]) => /rentre|part tout seul/i.test(etape)).flatMap(([, n]) => n);
        const nomsTirelires = lignes.filter(([etape]) => !/rentre|part tout seul/i.test(etape)).flatMap(([, n]) => n);
        expect(nomsFlux.length, 'aucune ligne de flux préparée').toBeGreaterThanOrEqual(2);
        expect(nomsTirelires.length, 'aucune tirelire préparée').toBeGreaterThanOrEqual(1);

        expect(await cliquer(page, 'Valider mon budget')).toBe(true);
        await pause(400);

        // Le bouton primaire du résumé validé mène au plan, qui dote des tirelires.
        expect(await cliquer(page, 'Voir le plan'), 'le résumé validé ne mène pas au plan').toBe(true);
        await pause(300);
        expect((await lire(page)).texte, 'le plan ne dote aucune tirelire').toContain('croisière');

        const apres = await projetLu(page);
        expect(apres.comptes, 'le compte principal renseigné n’est pas entré').toContain(NOM_PRINCIPAL);
        expect(apres.comptes, 'le solde du compte principal n’est pas entré').toMatch(/1\D?234,56/);
        for (const nom of prepare.autresComptes) expect(apres.comptes, `le compte « ${nom} » n’est pas entré`).toContain(nom);
        for (const nom of nomsFlux) expect(apres.flux, `« ${nom} » n’est pas entré dans Flux prévus`).toContain(nom);
        for (const nom of nomsTirelires) expect(apres.tirelires, `« ${nom} » n’est pas entré dans Tirelires`).toContain(nom);
        expect(apres.jour, 'le début de période n’est pas entré').toBe(prepare.jour);
        expect(apres.tirelires, 'le placement de la réserve n’est pas entré').toContain(`le reste sur ${prepare.placement!.compte}`);

        // Et tout cela est enregistré : un rechargement le retrouve.
        await recharger(page);
        memeProjet(await projetLu(page), apres, 'après un rechargement');
      } finally {
        await page.close();
      }
    }, 240_000);
  });

  describe('[niveau 3] point 3 — ce qui est préparé se retrouve en revenant, et le résumé dit que rien n’est enregistré', () => {
    it('on quitte l’assistant au milieu et on y revient : l’étape et ses lignes sont là ; le résumé dit que rien n’est enregistré, sans « Voir le plan » ; après la validation, il le dit enregistré', async () => {
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        await ouvrirLAssistant(page);
        await avancer(page);
        await allerALEtape(page, /ne tombe pas tous les mois/i);
        const avant = await noms(page);
        expect(avant.length, 'l’étape ne propose rien d’office').toBeGreaterThanOrEqual(1);

        await allerÀ(page, 'Plan'); // on quitte l'assistant sans le terminer
        await pause(200);
        await ouvrirLAssistant(page);
        expect((await lire(page)).h2, 'l’assistant ne reprend pas à l’étape où on l’a quitté').toMatch(/ne tombe pas tous les mois/i);
        expect(await noms(page), 'les lignes préparées ne sont pas retrouvées telles quelles').toEqual(avant);

        await jusquAuResume(page);
        const resume = await lire(page);
        expect(resume.primaires).toContain('Valider mon budget');
        expect(resume.texte, 'le résumé ne dit pas que rien n’est encore enregistré').toContain('Rien n’est encore enregistré');
        expect(resume.boutons, 'le plan s’offre avant la validation').not.toContain('Voir le plan');

        expect(await cliquer(page, 'Valider mon budget')).toBe(true);
        await pause(400);
        const apres = await lire(page);
        expect(apres.h2).toContain('enregistré');
        expect(apres.texte).not.toContain('Rien n’est encore enregistré');
        expect(apres.boutons).toContain('Voir le plan');
      } finally {
        await page.close();
      }
    }, 180_000);
  });

  describe('[niveau 2] point 3 — remplacer le projet perd ce qui était préparé', () => {
    /** Un assistant préparé jusqu'aux revenus sur un projet vierge, puis on quitte l'assistant pour Réglages. */
    async function preparerPuisAllerAuxReglages(): Promise<Page> {
      const page = await nouvellePage(site);
      page.on('dialog', (d) => void d.accept());
      await ouvrir(page, site);
      await ouvrirLAssistant(page);
      await avancer(page);
      await allerALEtape(page, /Qu.est-ce qui rentre/);
      expect((await noms(page)).length, 'rien n’est préparé d’office').toBeGreaterThanOrEqual(2);
      await ecranOrdinaire(page, 'Réglages');
      return page;
    }

    /** L'assistant rouvert repart du début : le principe, « Commencer » ; il ne reprend pas aux revenus. */
    async function repartDuDebut(page: Page, apres: string) {
      await ouvrirLAssistant(page);
      const e = await lire(page);
      expect(e.h1, `après ${apres}`).toBe('Construire mon budget');
      expect(e.primaires.some((p) => p.includes('Commencer')), `l’assistant reprend ce qui était préparé sur le projet remplacé (après ${apres})`).toBe(true);
    }

    it('« Tout effacer »', async () => {
      const page = await preparerPuisAllerAuxReglages();
      try {
        expect(await cliquer(page, 'Tout effacer'), 'pas de bouton « Tout effacer »').toBe(true);
        await pause(1_500);
        await repartDuDebut(page, '« Tout effacer »');
      } finally {
        await page.close();
      }
    }, 180_000);

    it('l’ouverture d’un fichier', async () => {
      const store = await LedgerStore.create({ sqlJs: SQL, siteId: 'audit-210' });
      const octets = store.export();
      store.close();
      const dossier = mkdtempSync(join(tmpdir(), 'tirelire-210-'));
      const chemin = join(dossier, 'projet.sqlite');
      writeFileSync(chemin, octets);
      const page = await preparerPuisAllerAuxReglages();
      try {
        const champ = (await page.evaluateHandle(() => [...document.querySelectorAll<HTMLInputElement>('main input[type="file"]')].find((c) => /sqlite/i.test(c.accept)) ?? null)).asElement();
        expect(champ, 'aucun champ pour importer un fichier SQLite dans Réglages').not.toBeNull();
        await (champ as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(chemin);
        await pause(1_500);
        await repartDuDebut(page, 'l’ouverture d’un fichier');
      } finally {
        await page.close();
        rmSync(dossier, { recursive: true, force: true });
      }
    }, 180_000);
  });

  describe('[niveau 2] point 4 — projet vierge : les propositions sont là dès l’arrivée sur chaque étape, une seule fois', () => {
    it('chaque étape qui propose montre ses lignes à l’arrivée ; une ligne retirée ne revient pas en repassant par l’étape', async () => {
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        await ouvrirLAssistant(page);
        await avancer(page); // le principe → les comptes
        await avancer(page); // les comptes → les revenus

        // Cinq étapes proposent : revenus, charges fixes, budgets, pas tous les mois, épargne.
        const apresRetrait = new Map<string, string[]>();
        for (let i = 0; i < 5; i++) {
          const etape = (await lire(page)).h2;
          const arrivee = await noms(page);
          expect(arrivee.length, `l’étape « ${etape} » ne propose rien d’office à l’arrivée`).toBeGreaterThanOrEqual(1);
          await page.evaluate(() => (document.querySelector('main button.danger') as HTMLButtonElement | null)?.click());
          await pause(250);
          const restantes = await noms(page);
          expect(restantes, `« ${etape} » : le retrait n’a retiré qu’une ligne`).toHaveLength(arrivee.length - 1);
          apresRetrait.set(etape, restantes);
          expect(await avancer(page)).toBe(true);
        }
        expect(apresRetrait.size, 'les cinq étapes n’ont pas des titres distincts').toBe(5);

        // On repasse par chaque étape, en remontant depuis le résumé : rien ne revient.
        expect((await lire(page)).primaires).toContain('Valider mon budget');
        for (let i = 0; i < 5; i++) {
          await cliquer(page, 'Précédent');
          await pause(250);
          const etape = (await lire(page)).h2;
          expect(await noms(page), `« ${etape} » : une ligne retirée est revenue en repassant par l’étape`).toEqual(apresRetrait.get(etape));
        }
      } finally {
        await page.close();
      }
    }, 240_000);
  });
});
