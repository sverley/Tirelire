/**
 * Harnais d'audit de #214 — « Les aides des champs viennent de l'exemple », côté écran : sur le site construit,
 * à 375 px, au jour des tests (`JOUR_DES_TESTS`, 20 septembre 2026). Les points 1 à 4 du « Fait quand », et le
 * point 7 que l'auditeur y ajoute (une ligne dont un champ ne porte pas la valeur de son aide est ajoutée telle
 * qu'elle est saisie).
 *
 * Retenus parmi les tests du codeur (`navigateur/aides-exemple.test.ts`, d'où ils sont déplacés, ce fichier-là
 * n'existe plus) : les douze, tels quels, sauf leur niveau ; le deuxième du point 2 devient celui du point 7. Le
 * point 5 (« un test échoue si une aide… n'est pas celle que l'exemple désigne ») est tranché par ces douze, qui
 * lisent chaque aide à l'écran et la comparent à l'exemple, et par `../aides-exemple-harnais.test.ts`, qui
 * refuse une aide écrite en dur et lit les versions en vigueur à d'autres dates ; le point 6 (D43) est de la
 * documentation, vérifiée à la relecture. La lecture de l'exemple côté cœur (`suggestions-saisies.test.ts`) et
 * les tests de `../aides-exemple.test.ts` qui ne sont pas retenus restent dans les fichiers du codeur, au
 * niveau 4 : ce que ce fichier-ci observe à l'écran les couvre.
 *
 * Niveaux (D83), par phrase du « Fait quand » :
 *  - 2 pour les points 1 à 3 et 7 : D43 (les aides d'un formulaire viennent d'une même ligne de l'exemple) et D46
 *    (ajouter une ligne qui les recopie fait ce que fait le raccourci de cette ligne) sont des décisions ; une aide
 *    fausse, une ligne recopiée qui perd ce que l'exemple en dit, ou une valeur saisie remplacée par celle de
 *    l'exemple en est un cas faux, l'usage restant possible : la ligne se lit dans l'étape avec son montant et se
 *    corrige sur place, et rien n'entre dans le projet avant la validation (D40). Pas 1 : la description ne porte
 *    pas, comme énoncé, que l'assistant parcouru en suivant ses aides redonne l'exemple (c'est la parole du
 *    porteur du 24 septembre, que l'issue cite). Pas 0 pour le point 7, contrairement au point 7 de #211, où le nom
 *    ou le solde posés étaient remplacés à la validation : ici une valeur saisie remplacée l'est à l'ajout de la
 *    ligne, qui la montre dans l'étape, avant la validation finale.
 *
 * Deux des trois choix du codeur, que l'issue ne tranche pas et qu'il a posés au porteur (commentaire de l'issue,
 * 03/10), sont tenus par des assertions de ce fichier : les champs sans texte indicatif — jour, liste, date, case —
 * prennent, tant qu'on n'y a pas touché, la valeur de la ligne d'aide (le jour au point 1, le type du compte à
 * l'étape Comptes) ; une aide est la valeur exacte de la ligne, pour le genre choisi (« Dentiste (payé par Marie) »
 * dans Saisie, la cible et la mensualité du même objectif dans Tirelires). Si le porteur en retient un autre, ces
 * assertions changent. Le troisième, un solde laissé vide vaut zéro, n'est tenu par aucun test retenu.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { alive, exampleLedger } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
const exemple = exampleLedger();
/** Un montant comme on le saisit : « 3 400,00 », l'espace des milliers ordinaire. */
const euros = (centimes: number) => (Math.abs(centimes) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');
const flux = alive(exemple.plannedFlows);

/** Un champ d'un formulaire ouvert : son libellé, l'aide qu'il montre et ce qu'il contient. */
interface Champ {
  libelle: string;
  aide: string;
  valeur: string;
}

/** Les champs du formulaire à ajouter ouvert : leur libellé (sans « (facultatif) »), leur aide, leur valeur. */
const champs = (page: Page): Promise<Champ[]> =>
  page.evaluate(() => {
    const premierTexte = (l: Element) => [...l.childNodes].find((n) => n.nodeType === 3)?.textContent?.replace(/\s+/g, ' ').trim().replace(/ \(facultatif\)$/, '') ?? '';
    return ([...document.querySelectorAll('main form label.f')] as HTMLElement[])
      .map((l) => ({ l, e: l.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null }))
      .filter((x) => x.e)
      .map(({ l, e }) => ({ libelle: premierTexte(l), aide: (e as HTMLInputElement).placeholder ?? '', valeur: e!.value }));
  });

/** Le champ du formulaire ouvert qui porte ce libellé. */
async function champ(page: Page, libelle: string): Promise<Champ> {
  const c = (await champs(page)).find((x) => x.libelle === libelle);
  expect(c, `pas de champ « ${libelle} » dans le formulaire ouvert`).toBeDefined();
  return c!;
}

/** Saisit une valeur dans le champ du formulaire ouvert qui porte ce libellé, comme le fait la saisie : `input`, puis `change`. */
async function saisirChamp(page: Page, libelle: string, valeur: string) {
  const fait = await page.evaluate(
    (lib: string, v: string) => {
      const premierTexte = (l: Element) => [...l.childNodes].find((n) => n.nodeType === 3)?.textContent?.replace(/\s+/g, ' ').trim().replace(/ \(facultatif\)$/, '') ?? '';
      const label = ([...document.querySelectorAll('main form label.f')] as HTMLElement[]).find((l) => premierTexte(l) === lib);
      const el = label?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null | undefined;
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    libelle,
    valeur,
  );
  expect(fait, `champ introuvable : ${libelle}`).toBe(true);
  await pause(200);
}

/** Recopie, dans chaque champ texte d'aide du formulaire, l'aide qu'il montre — ce que fait qui accepte les aides telles quelles. */
async function recopierLesAides(page: Page, libelles: string[]) {
  for (const libelle of libelles) {
    const c = await champ(page, libelle);
    expect(c.aide, `« ${libelle} » ne montre aucune aide à recopier`).not.toBe('');
    await saisirChamp(page, libelle, c.aide);
  }
}

// ---------------------------------------------------------------------------------------------
// L'assistant, sur un projet vierge
// ---------------------------------------------------------------------------------------------

async function ouvrir(page: Page, site: Site) {
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
}

const lire = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return { h2: t(document.querySelector('main h2')), primaires: ([...document.querySelectorAll('main .actions button.primary')] as HTMLButtonElement[]).map(t) };
  });

/** Clique le bouton primaire « Suivant » ou « Commencer ». */
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

/** Ouvre l'assistant sur un projet vierge, depuis le Plan, et le franchit jusqu'à l'étape Comptes. */
async function arriverAuxComptes(page: Page) {
  await allerÀ(page, 'Plan');
  expect(await cliquer(page, 'Construire mon budget'), 'pas de bouton « Construire mon budget »').toBe(true);
  await pause(300);
  expect(await avancer(page), 'le principe ne se franchit pas par son bouton primaire').toBe(true);
  expect((await lire(page)).h2).toMatch(/Vos comptes en banque/);
}

/** … jusqu'à l'étape des revenus. */
async function arriverAuxRevenus(page: Page) {
  await arriverAuxComptes(page);
  expect(await avancer(page), 'l’étape Comptes ne se franchit pas par son bouton primaire').toBe(true);
  expect((await lire(page)).h2).toMatch(/Qu.est-ce qui rentre/);
}

interface LigneDeFlux {
  nom: string;
  montant: string;
  jour: string;
}

/** Les lignes de flux de l'étape en cours (Revenus ou Charges fixes). */
const lignes = (page: Page): Promise<LigneDeFlux[]> =>
  page.evaluate(() =>
    ([...document.querySelectorAll('main .ligne-flux')] as HTMLElement[]).map((l) => ({
      nom: (l.querySelector('input.nom') as HTMLInputElement).value.trim(),
      montant: (l.querySelector('input.mt') as HTMLInputElement).value.trim(),
      jour: ((l.querySelectorAll('input.jour')[0] as HTMLInputElement | undefined)?.value ?? '').trim(),
    })),
  );

/** Les raccourcis que l'étape offre encore. */
const raccourcis = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    ([...document.querySelectorAll('main .propositions .prop .n')] as HTMLElement[]).map((n) => (n.textContent ?? '').trim()).filter((n) => n.startsWith('+ ')),
  );

/** Retire d'un clic la première ligne de l'étape en cours qui porte ce nom. */
async function retirer(page: Page, nom: string) {
  const fait = await page.evaluate((n: string) => {
    const nomDeLigne = ([...document.querySelectorAll('main input.nom')] as HTMLInputElement[]).find((i) => i.value.trim() === n);
    const b = nomDeLigne?.closest('.ligne-flux')?.querySelector('button.danger') as HTMLButtonElement | null | undefined;
    b?.click();
    return !!b;
  }, nom);
  expect(fait, `la ligne « ${nom} » n’a pas de bouton pour la retirer`).toBe(true);
  await pause(250);
}

/** Du point où l'on est jusqu'au résumé, puis la validation. */
async function validerTelQuel(page: Page) {
  for (let i = 0; i < 14 && !(await lire(page)).primaires.includes('Valider mon budget'); i++) await avancer(page);
  expect(await cliquer(page, 'Valider mon budget')).toBe(true);
  await pause(400);
}

/**
 * L'état de chaque élément de l'étape en cours qui porte ce nom : son texte et la valeur de chacun de ses champs. Deux
 * lectures égales disent que l'élément est le même, à l'écran.
 */
const etatDe = (page: Page, element: string, identifiant: string, nom: string): Promise<Array<{ texte: string; champs: string[] }>> =>
  page.evaluate(
    (el: string, ident: string, n: string) =>
      ([...document.querySelectorAll(`main ${el}`)] as HTMLElement[])
        .filter((e) => (e.querySelector(ident) as HTMLInputElement | null)?.value.trim() === n)
        .map((e) => ({
          texte: (e.textContent ?? '').trim().replace(/\s+/g, ' '),
          champs: ([...e.querySelectorAll('input, select')] as Array<HTMLInputElement | HTMLSelectElement>).map((i) =>
            i instanceof HTMLInputElement && i.type === 'checkbox' ? String(i.checked) : i.value,
          ),
        })),
    element,
    identifiant,
    nom,
  );

/** Clique le bouton de retrait de l'élément de l'étape qui porte ce nom. */
async function retirerElement(page: Page, element: string, identifiant: string, retrait: string, nom: string) {
  const fait = await page.evaluate(
    (el: string, ident: string, ret: string, n: string) => {
      const e = ([...document.querySelectorAll(`main ${el}`)] as HTMLElement[]).find((x) => (x.querySelector(ident) as HTMLInputElement | null)?.value.trim() === n);
      const b = e?.querySelector(ret) as HTMLButtonElement | null | undefined;
      b?.click();
      return !!b;
    },
    element,
    identifiant,
    retrait,
    nom,
  );
  expect(fait, `« ${nom} » n’a pas de bouton de retrait (${retrait})`).toBe(true);
  await pause(300);
}

/** Retire un élément de l'étape, recopie les aides de son formulaire, ajoute : l'élément doit être, à l'écran, ce qu'il était. */
/**
 * Clique le bouton dont le texte est exactement celui-ci : à l'étape Budgets, les « Ajouter un besoin »
 * des cartes précèdent le « Ajouter » d'une nouvelle tirelire (#344).
 */
async function cliquerExactement(page: Page, texte: string): Promise<boolean> {
  const trouvé = await page.evaluate((t: string) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === t) as HTMLButtonElement | undefined;
    b?.click();
    return !!b;
  }, texte);
  if (trouvé) await new Promise((r) => setTimeout(r, 150));
  return trouvé;
}

async function retirerPuisRecopier(
  page: Page,
  quoi: { element: string; identifiant: string; retrait: string; nom: string; libelles: string[]; ajouter: string; contient: string },
) {
  const avant = await etatDe(page, quoi.element, quoi.identifiant, quoi.nom);
  expect(avant.length, `« ${quoi.nom} » n’est pas dans l’étape`).toBeGreaterThan(0);
  expect(avant.map((x) => x.texte).join(' '), `« ${quoi.nom} » : ce que l’étape en dit`).toContain(quoi.contient);
  await retirerElement(page, quoi.element, quoi.identifiant, quoi.retrait, quoi.nom);
  expect(await etatDe(page, quoi.element, quoi.identifiant, quoi.nom), `« ${quoi.nom} » n’est pas retiré`).toEqual([]);
  expect((await champ(page, quoi.libelles[0]!)).aide, `« ${quoi.nom} » retiré, ses aides sont les siennes`).toBe(quoi.nom);
  await recopierLesAides(page, quoi.libelles);
  expect(await cliquerExactement(page, quoi.ajouter), `pas de bouton « ${quoi.ajouter} »`).toBe(true);
  await pause(300);
  expect(await etatDe(page, quoi.element, quoi.identifiant, quoi.nom), `« ${quoi.nom} » rajouté en recopiant ses aides n’est pas celui de son raccourci`).toEqual(avant);
}

/** Un écran ordinaire, atteint par le menu Plus. */
async function ecran(page: Page, nom: string) {
  await allerÀ(page, 'Plus');
  expect(await cliquer(page, nom), `pas d’écran « ${nom} » dans le menu Plus`).toBe(true);
  await pause(250);
}

/** Ce que dit, dans Flux prévus, le formulaire du flux dont la ligne porte ce nom : le motif, la fenêtre, la catégorie. */
async function formulaireDuFlux(page: Page, nom: string) {
  const fait = await page.evaluate((n: string) => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const ligne = ([...document.querySelectorAll('main .row')] as HTMLElement[]).find((r) => t(r.querySelector('.label strong')) === n);
    const b = ([...(ligne?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]).find((x) => t(x) === 'Modifier');
    b?.click();
    return !!b;
  }, nom);
  expect(fait, `pas de bouton « Modifier » sur le flux « ${nom} »`).toBe(true);
  await pause(250);
  const lu = {
    motif: (await champ(page, 'Motif de libellé (regex)')).valeur,
    fenetre: (await champ(page, 'Fenêtre des échéances (± jours)')).valeur,
    montant: (await champ(page, 'Montant')).valeur,
  };
  await cliquer(page, 'Annuler');
  return lu;
}

describe.skipIf(!navigateur)('#214 · les aides des champs viennent de l’exemple', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 300_000);

  afterAll(async () => {
    await site?.fermer();
  });

  describe('dans l’assistant, sur un projet vierge', () => {
    it('[niveau 2] point 1 — à l’étape Revenus, toutes les aides du formulaire viennent d’une même ligne : la première de l’étape, puis celle du premier raccourci restant', async () => {
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        await arriverAuxRevenus(page);

        // Tout est là : aucun raccourci, la première ligne de l'exemple de l'étape — « Salaire », 3 400,00 €, le 28.
        expect(await raccourcis(page)).toEqual([]);
        expect(await champ(page, 'Quoi ?')).toMatchObject({ aide: 'Salaire', valeur: '' });
        expect(await champ(page, 'Combien ?')).toMatchObject({ aide: '3 400,00', valeur: '' });
        expect((await champ(page, 'Vers le (jour)')).valeur, 'le jour suit la ligne d’aide').toBe('28');

        // « Loyer locatif » retiré : son raccourci revient, et toutes les aides passent à sa ligne — 700,00 €, le 5.
        await retirer(page, 'Loyer locatif');
        expect(await raccourcis(page)).toEqual(['+ Loyer locatif']);
        expect(await champ(page, 'Quoi ?')).toMatchObject({ aide: 'Loyer locatif' });
        expect(await champ(page, 'Combien ?')).toMatchObject({ aide: '700,00' });
        expect((await champ(page, 'Vers le (jour)')).valeur).toBe('5');

        // « Allocations » aussi : le premier raccourci restant, dans l'ordre de l'exemple, reste « Loyer locatif ».
        await retirer(page, 'Allocations');
        expect(await champ(page, 'Quoi ?')).toMatchObject({ aide: 'Loyer locatif' });

        // Le raccourci de « Loyer locatif » pris, c'est « Allocations » (100,00 €, le 5) qui donne ses aides.
        expect(await cliquer(page, '+ Loyer locatif')).toBe(true);
        await pause(250);
        expect(await champ(page, 'Quoi ?')).toMatchObject({ aide: 'Allocations' });
        expect(await champ(page, 'Combien ?')).toMatchObject({ aide: '100,00' });
      } finally {
        await page.close();
      }
    }, 240_000);

    it('[niveau 2] point 1 — chaque étape de l’assistant montre les aides de la première ligne de l’exemple de l’étape : comptes, charges fixes, budgets, échéances, épargne, catégories', async () => {
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        await arriverAuxComptes(page);
        // Comptes : « Livret A », dont l'exemple dit le solde, 4 815,00 €.
        expect(await champ(page, 'Nom du compte'), 'comptes : le nom').toMatchObject({ aide: 'Livret A' });
        expect(await champ(page, 'Solde actuel'), 'comptes : le solde').toMatchObject({ aide: '4 815,00' });
        expect((await champ(page, 'Type')).valeur, 'comptes : le type suit la ligne d’aide, un compte d’épargne').toBe('epargne');

        const etapes: Array<[RegExp, string, Record<string, string>]> = [
          [/Qu.est-ce qui rentre/, 'revenus', { 'Quoi ?': 'Salaire', 'Combien ?': euros(340000) }],
          [/part tout seul/, 'charges fixes', { 'Quoi ?': 'Crédit immobilier', 'Combien ?': euros(95000) }],
          [/tenir à un montant/, 'budgets', { 'Quoi ?': 'Alimentation', 'Combien par période ?': euros(90000) }],
          [/ne tombe pas tous les mois/, 'échéances', { 'Quoi ?': 'Taxe foncière', 'Montant de la facture': euros(120000) }],
          [/mettre de côté/, 'épargne', { 'Quoi ?': 'Épargne de précaution', 'Combien par période ?': euros(30000), 'Cible': euros(600000) }],
          [/Comment classer/, 'catégories', { 'Nom de la catégorie': 'Salaire' }],
        ];
        for (const [titre, nom, attendu] of etapes) {
          expect(await avancer(page), `${nom} : l’étape précédente ne se franchit pas`).toBe(true);
          expect((await lire(page)).h2, `${nom} : on n’est pas à la bonne étape`).toMatch(titre);
          const vus = Object.fromEntries((await champs(page)).filter((c) => c.aide !== '').map((c) => [c.libelle, c.aide]));
          expect(vus, `${nom} : les aides du formulaire`).toMatchObject(attendu);
        }
      } finally {
        await page.close();
      }
    }, 240_000);

    it('[niveau 2] point 2 — ajouter « Loyer locatif » en recopiant ses aides fait ce que fait son raccourci : la ligne revient avec son motif de libellé et sa fenêtre, une fois l’assistant validé', async () => {
      const loyer = flux.find((f) => f.name === 'Loyer locatif')!;
      expect(loyer.labelPattern, 'l’exemple donne un motif au loyer : sans lui, ce test ne prouverait rien').toBeTruthy();
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        await arriverAuxRevenus(page);
        await retirer(page, 'Loyer locatif');
        await recopierLesAides(page, ['Quoi ?', 'Combien ?']);
        expect(await cliquer(page, 'Ajouter')).toBe(true);
        await pause(250);
        expect(await raccourcis(page), 'la ligne ajoutée vaut son raccourci : il disparaît').toEqual([]);
        expect((await lignes(page)).find((l) => l.nom === 'Loyer locatif')).toMatchObject({ montant: euros(loyer.amount), jour: '5' });

        await validerTelQuel(page);
        await ecran(page, 'Flux prévus');
        expect(await formulaireDuFlux(page, 'Loyer locatif')).toEqual({ motif: loyer.labelPattern, fenetre: String(loyer.dateWindowDays), montant: euros(loyer.amount) });
      } finally {
        await page.close();
      }
    }, 240_000);

    it('[niveau 2] point 7 (ajouté par l’auditeur) — un champ qui change et la ligne n’est plus celle de l’exemple : « Loyer locatif » à 710,00 € garde son montant et ne reçoit ni le motif ni la fenêtre de l’exemple', async () => {
      const loyer = flux.find((f) => f.name === 'Loyer locatif')!;
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        await arriverAuxRevenus(page);
        await retirer(page, 'Loyer locatif');
        await recopierLesAides(page, ['Quoi ?']);
        await saisirChamp(page, 'Combien ?', '710,00');
        expect(await cliquer(page, 'Ajouter')).toBe(true);
        await pause(250);
        expect((await lignes(page)).find((l) => l.nom === 'Loyer locatif')).toMatchObject({ montant: '710,00' });

        await validerTelQuel(page);
        await ecran(page, 'Flux prévus');
        const lu = await formulaireDuFlux(page, 'Loyer locatif');
        expect(lu.montant).toBe('710,00');
        expect(lu.motif, 'une ligne saisie à la main n’a pas le motif de l’exemple').not.toBe(loyer.labelPattern);
      } finally {
        await page.close();
      }
    }, 240_000);

    it('[niveau 2] point 2 — une étape vidée puis remplie en recopiant chaque aide finit avec les lignes de l’exemple, et elles seules, versions datées du « Salaire » comprises', async () => {
      const revenus = flux.filter((f) => f.kind === 'income');
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        await arriverAuxRevenus(page);
        for (const l of await lignes(page)) await retirer(page, l.nom);
        expect(await lignes(page)).toEqual([]);
        expect((await raccourcis(page)).length, 'trois raccourcis : un par revenu, le « Salaire » en un seul').toBe(3);

        for (let tour = 0; tour < 6 && (await raccourcis(page)).length > 0; tour++) {
          await recopierLesAides(page, ['Quoi ?', 'Combien ?']);
          expect(await cliquer(page, 'Ajouter')).toBe(true);
          await pause(250);
        }
        expect(await raccourcis(page), 'toutes les lignes sont revenues').toEqual([]);
        // Les lignes de l'étape écrivent leur montant sans espace des milliers (« 3400,00 »).
        const sansEspace = (montant: string) => montant.replace(/ /g, '');
        const vues = (await lignes(page)).map((l) => `${l.nom} | ${sansEspace(l.montant)} | ${l.jour}`).sort();
        const attendues = revenus.map((f) => `${f.name} | ${sansEspace(euros(f.amount))} | ${f.periodicity.anchorDate.slice(8).replace(/^0/, '')}`).sort();
        expect(vues).toEqual(attendues);
      } finally {
        await page.close();
      }
    }, 240_000);

    it('[niveau 2] point 2 — à chaque étape, l’élément retiré puis rajouté en recopiant ses aides est celui que son raccourci apportait : versions datées, prélèvement, suivi du solde, liens des catégories', async () => {
      const page = await nouvellePage(site);
      page.on('dialog', (d) => void d.accept());
      try {
        await ouvrir(page, site);
        await arriverAuxComptes(page);
        await retirerPuisRecopier(page, { element: '.ligne-compte', identifiant: 'input', retrait: 'button.danger', nom: 'Carte enfants', libelles: ['Nom du compte', 'Solde actuel'], ajouter: 'Ajouter un compte', contient: 'Solde à régler' });

        await avancer(page);
        await avancer(page);
        expect((await lire(page)).h2).toMatch(/part tout seul/);
        await retirerPuisRecopier(page, { element: '.ligne-flux', identifiant: 'input.nom', retrait: 'button.danger', nom: 'Crédit immobilier', libelles: ['Quoi ?', 'Combien ?'], ajouter: 'Ajouter', contient: 'jusqu’au 5' });

        await avancer(page);
        expect((await lire(page)).h2).toMatch(/tenir à un montant/);
        await retirerPuisRecopier(page, { element: '.card.tirelire', identifiant: 'input.nom', retrait: 'button.danger', nom: 'Alimentation', libelles: ['Quoi ?', 'Combien par période ?'], ajouter: 'Ajouter', contient: 'jusqu’au 27 oct' });

        await avancer(page);
        expect((await lire(page)).h2).toMatch(/ne tombe pas tous les mois/);
        await retirerPuisRecopier(page, { element: '.card.tirelire', identifiant: 'input.nom', retrait: 'button.danger', nom: 'Taxe foncière', libelles: ['Quoi ?', 'Montant de la facture'], ajouter: 'Ajouter', contient: 'Prélèvement attendu' });

        await avancer(page);
        expect((await lire(page)).h2).toMatch(/mettre de côté/);
        await retirerPuisRecopier(page, { element: '.card.tirelire', identifiant: 'input.nom', retrait: 'button.danger', nom: 'Épargne de précaution', libelles: ['Quoi ?', 'Combien par période ?', 'Cible'], ajouter: 'Ajouter', contient: 'jusqu’au 27 déc' });

        await avancer(page);
        expect((await lire(page)).h2).toMatch(/Comment classer/);
        await retirerPuisRecopier(page, { element: '.ligne-categorie', identifiant: 'input.nom', retrait: 'button.danger', nom: 'Salaire', libelles: ['Nom de la catégorie'], ajouter: 'Ajouter une catégorie', contient: 'Flux : Salaire' });
      } finally {
        await page.close();
      }
    }, 300_000);
  });

  describe('hors de l’assistant, sur l’exemple chargé', () => {
    let page: Page;

    beforeAll(async () => {
      page = await ouvrirLExemple(site);
    }, 180_000);

    afterAll(async () => {
      await page?.close().catch(() => {});
    });

    it('[niveau 2] point 3 — Comptes : l’aide du nom est celle d’un compte de l’exemple du type choisi (le formulaire d’ajout de la section, #362)', async () => {
      await ecran(page, 'Comptes');
      const epargne = alive(exemple.accounts).find((a) => a.kind === 'epargne')!;
      const courant = alive(exemple.accounts).find((a) => a.kind === 'courant')!;
      expect((await champ(page, 'Type')).valeur).toBe('epargne');
      expect((await champ(page, 'Nom du compte')).aide).toBe(epargne.name);
      await saisirChamp(page, 'Type', 'courant');
      expect((await champ(page, 'Nom du compte')).aide).toBe(courant.name);
    }, 120_000);

    it('[niveau 2] point 3 — Tirelires : l’aide du nom de la tirelire est celle d’une tirelire de l’exemple', async () => {
      await ecran(page, 'Tirelires');
      expect(await cliquer(page, 'Ajouter une tirelire')).toBe(true);
      await pause(200);
      expect(alive(exemple.tirelires).map((t) => t.name)).toContain((await champ(page, 'Nom')).aide);
      await cliquer(page, 'Annuler');
    }, 120_000);

    it('[niveau 2] point 3 — Tirelires, besoin : les aides sont les valeurs d’un besoin de l’exemple du type choisi, et le « montant à reverser » d’un versement n’en a aucune', async () => {
      await ecran(page, 'Tirelires');
      expect(await cliquer(page, 'Ajouter un besoin')).toBe(true);
      await pause(200);
      const attendu: Array<[string, Record<string, string>]> = [
        ['dueDate', { 'Montant de l\'échéance': euros(120000) }],
        ['recurring', { 'Nom': 'Cours de piano', 'Montant': euros(4500) }],
        ['goal', { 'Mensualité': euros(30000), 'Cible': euros(600000) }],
      ];
      for (const [genre, aides] of attendu) {
        await saisirChamp(page, 'Type', genre);
        const vus = Object.fromEntries((await champs(page)).filter((c) => c.aide !== '').map((c) => [c.libelle, c.aide]));
        expect(vus, `besoin « ${genre} »`).toMatchObject(aides);
      }
      await saisirChamp(page, 'Type', 'payout');
      expect((await champ(page, 'Montant à reverser')).aide, 'l’exemple n’a aucun versement : pas de montant inventé').toBe('');
      await cliquer(page, 'Annuler');
    }, 120_000);

    it('[niveau 2] point 3 — Flux prévus : le nom, le montant et le motif d’aide sont ceux d’un même flux de l’exemple du type choisi', async () => {
      await ecran(page, 'Flux prévus');
      expect(await cliquer(page, 'Ajouter un flux')).toBe(true);
      await pause(200);
      for (const genre of ['income', 'fixedCharge', 'dueDate', 'transfer'] as const) {
        await saisirChamp(page, 'Type', genre);
        const f = flux.find((x) => x.kind === genre)!;
        expect(await champ(page, 'Nom'), genre).toMatchObject({ aide: f.name });
        expect(await champ(page, 'Montant'), genre).toMatchObject({ aide: euros(f.amount) });
        expect(await champ(page, 'Motif de libellé (regex)'), genre).toMatchObject({ aide: f.labelPattern ?? '' });
      }
      await cliquer(page, 'Annuler');
    }, 120_000);

    it('[niveau 2] point 3 — Catégories : l’aide du nom est celle d’une catégorie de l’exemple de la nature choisie', async () => {
      await ecran(page, 'Catégories');
      const categories = alive(exemple.categories);
      expect(await cliquer(page, 'Ajouter une catégorie de dépenses')).toBe(true);
      await pause(200);
      const aideDepense = (await champ(page, 'Nom')).aide;
      expect(categories.find((c) => c.name === aideDepense)?.nature).toBe('expense');
      await cliquer(page, 'Annuler');
      expect(await cliquer(page, 'Ajouter une catégorie de revenus')).toBe(true);
      await pause(200);
      const aideRevenu = (await champ(page, 'Nom')).aide;
      expect(categories.find((c) => c.name === aideRevenu)?.nature).toBe('income');
      await cliquer(page, 'Annuler');
    }, 120_000);

    it('[niveau 2] point 3 — Saisie : le libellé, le montant et la catégorie d’aide sont ceux d’une même opération saisie de l’exemple de la nature choisie', async () => {
      await ecran(page, 'Saisie');
      expect(await cliquer(page, 'Saisir une opération')).toBe(true);
      await pause(200);
      const attendu: Array<[string, string, number, string]> = [
        ['expense', 'Dentiste (payé par Marie)', 8000, 'Santé'],
        ['income', 'VIR SALAIRE AOUT', 340000, 'Salaire'],
        ['transfer', 'VIR PERM TIRELIRE CARTE ENFANTS', 20000, 'Virement interne'],
      ];
      for (const [nature, libelle, montant, categorie] of attendu) {
        await saisirChamp(page, 'Nature', nature);
        expect(await champ(page, 'Libellé'), nature).toMatchObject({ aide: libelle });
        expect(await champ(page, 'Montant'), nature).toMatchObject({ aide: euros(montant) });
        expect(await champ(page, 'ou nouvelle catégorie'), nature).toMatchObject({ aide: categorie });
      }
      await cliquer(page, 'Annuler');
    }, 120_000);
  });
});
