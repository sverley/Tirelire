/**
 * Harnais d'audit de #213 — « L'assistant propose tous les revenus et toutes les charges fixes de l'exemple, versions
 * datées comprises », côté écran : sur le site construit, à 375 px, au jour des tests (`JOUR_DES_TESTS`, 20 septembre 2026).
 * Les points 1 à 5 et 7 du « Fait quand », et le point 9 que l'auditeur y ajoute (ce que montre le raccourci d'un flux
 * à plusieurs versions).
 *
 * Retenus parmi les tests du codeur (`navigateur/assistant-flux-exemple.test.ts`, d'où ils sont déplacés, ce fichier-là
 * n'existe plus), puis complétés : le compte et le groupe de chacun des huit flux dans Flux prévus (point 7), et, pour
 * chacun des huit, ce que dit son formulaire — fenêtre, tolérance, motif, montant variable, dates —, comparé à ce que
 * l'exemple lui-même porte (point 2) ; le codeur ne lisait que le formulaire du premier « Salaire ». Les points 4 et 6,
 * côté cœur, sont dans `packages/core/test/suggestions-flux-harnais.test.ts` ; la première phrase du point 6 (« le test
 * des propositions échoue si… ») est tranchée par `packages/core/test/suggestions.test.ts`, que le codeur a étendu aux
 * flux ; le point 8 (D51) est de la documentation, vérifiée à la relecture.
 *
 * Niveaux (D83), par phrase du « Fait quand » :
 *  - 2 pour les points 1 à 5 et 9 : D43 et D46 (des propositions déjà là, tirées de l'exemple, qui disparaissent quand
 *    elles existent), D50 (ce que le bandeau compte) et D51 (chaque version se lit avec sa date et se retire seule) sont
 *    des décisions ; une ligne absente, fausse ou sans sa date en est un cas faux, l'usage restant possible. Pas 1 : la
 *    description ne porte pas, comme énoncé, que l'assistant accepté tel quel redonne l'exemple (c'est la parole du
 *    porteur, chantier 5, que l'issue cite).
 *  - 1 pour les deux tests du point 7 : leur phrase est I11 telle qu'elle est écrite (« tout ce qu'une étape d'assistant
 *    crée ou fait se fait et se modifie aussi hors assistant ») appliquée aux huit flux et à leurs dates. Rouges sur
 *    `main` (sept flux au lieu de huit, aucune ligne « Salaire » bornée), et sur deux mutations du code de la PR : sans
 *    les dates de validité, les deux rougissent ; avec les flux posés sur un autre compte que le principal, le premier
 *    seul.
 *
 * Les dates se lisent à l'écran sous la forme de l'application (« jusqu’au 27 oct. 2026 », `validityLabel`, comme sur un
 * compte) : les tests ne figent que le jour et l'année, pas l'abréviation du mois.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { alive, euros, exampleLedger } from '@tirelire/core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Un montant lu à l'écran, en centimes : « 3400,00 » ou « 4 200,00 € ». */
const centimes = (texte: string) => Math.round(parseFloat(texte.replace(/[^\d,.-]/g, '').replace(',', '.')) * 100);

interface Ligne {
  nom: string;
  montant: string;
  jour: string;
  /** Les lignes d'explication sous la ligne : la prochaine échéance, la validité. */
  suites: string[];
  pastilles: string[];
}

/** Les lignes de flux de l'étape en cours (Revenus ou Charges fixes) : nom, montant, jour, ce que l'étape en dit. */
const lignes = (page: Page): Promise<Ligne[]> =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return ([...document.querySelectorAll('main .ligne-flux')] as HTMLElement[]).map((l) => ({
      nom: (l.querySelector('input.nom') as HTMLInputElement).value.trim(),
      montant: (l.querySelector('input.mt') as HTMLInputElement).value.trim(),
      jour: ((l.querySelectorAll('input.jour')[0] as HTMLInputElement | undefined)?.value ?? '').trim(),
      suites: [...l.querySelectorAll('.suite')].map(t),
      pastilles: [...l.querySelectorAll('.pill')].map(t),
    }));
  });

/** Le bandeau de l'assistant : chaque total sous son intitulé. */
const bandeau = (page: Page): Promise<Record<string, string>> =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return Object.fromEntries([...document.querySelectorAll('main .stats .stat')].map((s) => [t(s.querySelector('.k')), t(s.querySelector('.v'))]));
  });

/** Les raccourcis que l'étape offre encore : leur libellé et leur montant. */
const raccourcis = (page: Page) =>
  page.evaluate(() =>
    ([...document.querySelectorAll('main .propositions .prop')] as HTMLElement[])
      .filter((b) => (b.querySelector('.n')?.textContent ?? '').trim().startsWith('+ '))
      .map((b) => ({ nom: (b.querySelector('.n')?.textContent ?? '').trim(), montant: (b.querySelector('.v')?.textContent ?? '').trim() })),
  );

const lire = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return {
      h2: t(document.querySelector('main h2')),
      primaires: ([...document.querySelectorAll('main .actions button.primary')] as HTMLButtonElement[]).map(t),
    };
  });

async function ouvrir(page: Page, site: Site) {
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
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

/** Du point où l'on est jusqu'au résumé, par les seuls boutons primaires. */
async function jusquAuResume(page: Page) {
  for (let i = 0; i < 14 && !(await lire(page)).primaires.includes('Valider mon budget'); i++) await avancer(page);
  expect((await lire(page)).primaires, 'le résumé n’est pas atteint par les boutons primaires').toContain('Valider mon budget');
}

/** Ouvre l'assistant sur un projet vierge, depuis le Plan, et le franchit jusqu'à l'étape des revenus (principe, comptes). */
async function arriverAuxRevenus(page: Page) {
  await allerÀ(page, 'Plan');
  expect(await cliquer(page, 'Construire mon budget'), 'pas de bouton « Construire mon budget »').toBe(true);
  await pause(300);
  expect(await avancer(page), 'le principe ne se franchit pas par son bouton primaire').toBe(true);
  expect(await avancer(page), 'l’étape Comptes ne se franchit pas par son bouton primaire').toBe(true);
  expect((await lire(page)).h2).toMatch(/Qu.est-ce qui rentre/);
}

/** Ouvre l'assistant sur un projet existant, depuis Configuration, et le franchit jusqu'à l'étape des revenus. */
async function rouvrirAuxRevenus(page: Page) {
  await allerÀ(page, 'Plus');
  expect(await cliquer(page, 'Lancer'), 'pas de bouton « Lancer » pour ouvrir l’assistant').toBe(true);
  await pause(300);
  expect(await avancer(page)).toBe(true);
  expect(await avancer(page)).toBe(true);
  expect((await lire(page)).h2).toMatch(/Qu.est-ce qui rentre/);
}

/** Valide l'assistant tel quel : de l'étape où l'on est jusqu'au bout, sans rien changer. */
async function validerTelQuel(page: Page) {
  await jusquAuResume(page);
  expect(await cliquer(page, 'Valider mon budget')).toBe(true);
  await pause(400);
}

/** Un projet existant : l'assistant parcouru sans rien changer, puis validé. */
async function projetValide(site: Site): Promise<Page> {
  const page = await nouvellePage(site);
  await ouvrir(page, site);
  await arriverAuxRevenus(page);
  await validerTelQuel(page);
  return page;
}

/** Retire d'un clic la première ligne de l'étape en cours qui porte ce nom. */
async function retirer(page: Page, nom: string) {
  const fait = await page.evaluate((n: string) => {
    const champ = ([...document.querySelectorAll('main input.nom')] as HTMLInputElement[]).find((i) => i.value.trim() === n);
    const b = champ?.closest('.ligne-flux')?.querySelector('button.danger') as HTMLButtonElement | null | undefined;
    b?.click();
    return !!b;
  }, nom);
  expect(fait, `la ligne « ${nom} » n’a pas de bouton pour la retirer`).toBe(true);
  await pause(250);
}

/** Saisit une valeur dans le champ du sélecteur, comme le fait la saisie : `input`, puis `change`. */
async function saisir(page: Page, sélecteur: string, valeur: string) {
  const fait = await page.evaluate(
    (s: string, v: string) => {
      const el = document.querySelector(s) as HTMLInputElement | null;
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    sélecteur,
    valeur,
  );
  expect(fait, `champ introuvable : ${sélecteur}`).toBe(true);
  await pause(200);
}

/** Un écran ordinaire, atteint par le menu Plus. */
async function ecran(page: Page, nom: string) {
  await allerÀ(page, 'Plus');
  expect(await cliquer(page, nom), `pas d’écran « ${nom} » dans le menu Plus`).toBe(true);
  await pause(250);
}

interface LigneEcran {
  nom: string;
  /** Le titre du groupe de l'écran où la ligne se range : « Revenus », « Charge fixes »… */
  genre: string;
  sous: string;
  pastilles: string[];
}

/** Les lignes de l'écran Flux prévus : leur nom, leur groupe, ce qu'elles disent sous le nom, leurs pastilles. */
const fluxPrevus = (page: Page): Promise<LigneEcran[]> =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return ([...document.querySelectorAll('main .row')] as HTMLElement[])
      .filter((r) => r.querySelector('.label strong'))
      .map((r) => ({
        nom: t(r.querySelector('.label strong')),
        genre: t(r.closest('.card')?.previousElementSibling),
        sous: t(r.querySelector('.label .sub')),
        pastilles: [...r.querySelectorAll('.pill')].map(t),
      }));
  });

/** Les revenus et les charges fixes de l'écran : l'assistant sème aussi des flux d'échéance (« Pas tous les mois »), qui ne sont pas de #213. */
const revenusEtCharges = (l: LigneEcran[]) => l.filter((x) => /^(Revenu|Charge fixe)/.test(x.genre));

/** Ouvre le formulaire du flux de Flux prévus dont la ligne dit ceci sous son nom. */
async function modifier(page: Page, nom: string, sousContient: RegExp) {
  const fait = await page.evaluate(
    (n: string, motif: string) => {
      const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
      const ligne = ([...document.querySelectorAll('main .row')] as HTMLElement[]).find(
        (r) => t(r.querySelector('.label strong')) === n && new RegExp(motif).test(t(r.querySelector('.label .sub'))),
      );
      const b = ([...(ligne?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]).find((x) => t(x) === 'Modifier');
      b?.click();
      return !!b;
    },
    nom,
    sousContient.source,
  );
  expect(fait, `pas de bouton « Modifier » sur la ligne « ${nom} » (${sousContient})`).toBe(true);
  await pause(250);
}

/** Ce que dit un champ du formulaire ouvert, par le début de son libellé : sa valeur, ou sa case cochée. */
const champ = (page: Page, libellé: string) =>
  page.evaluate((l: string) => {
    const label = ([...document.querySelectorAll('form.edit label.f')] as HTMLElement[]).find((x) => (x.textContent ?? '').trim().startsWith(l));
    const el = label?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null | undefined;
    if (!el) return undefined;
    return el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
  }, libellé);

/** Saisit une valeur dans le champ du formulaire ouvert, par le début de son libellé. */
async function saisirChamp(page: Page, libellé: string, valeur: string) {
  const fait = await page.evaluate(
    (l: string, v: string) => {
      const label = ([...document.querySelectorAll('form.edit label.f')] as HTMLElement[]).find((x) => (x.textContent ?? '').trim().startsWith(l));
      const el = label?.querySelector('input') as HTMLInputElement | null | undefined;
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    libellé,
    valeur,
  );
  expect(fait, `champ introuvable : ${libellé}`).toBe(true);
  await pause(200);
}

/** Les revenus et les charges fixes de l'exemple : ce que l'assistant accepté tel quel laisse dans le projet (points 2 et 7). */
const exemple = exampleLedger();
const compteDe = (id: string) => alive(exemple.accounts).find((a) => a.id === id)!.name;
const fluxDeLExemple = alive(exemple.plannedFlows).filter((f) => f.kind === 'income' || f.kind === 'fixedCharge');

/** Ce que dit le formulaire d'un flux de Flux prévus, tel qu'il se lit : des textes. */
interface FluxLu {
  nom: string;
  compte: string;
  montant: string;
  tousLes: string;
  unite: string;
  premiere: string;
  fenetre: string;
  toleranceEuros: string;
  tolerancePct: string;
  motif: string;
  de: string;
  a: string;
  variable: boolean;
}

/**
 * Ouvre, l'un après l'autre, le formulaire de chaque revenu et de chaque charge fixe de Flux prévus, lit ce qu'il
 * dit, et le referme sans rien changer.
 */
const formulairesDesFlux = (page: Page): Promise<FluxLu[]> =>
  page.evaluate(async () => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const attendre = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
    const lignes = () =>
      ([...document.querySelectorAll('main .row')] as HTMLElement[]).filter(
        (r) => r.querySelector('.label strong') && /^(Revenu|Charge fixe)/.test(t(r.closest('.card')?.previousElementSibling)),
      );
    const bouton = (parent: ParentNode, texte: string) => ([...parent.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => t(b) === texte);
    const champ = (libelle: string) => ([...document.querySelectorAll('form.edit label.f')] as HTMLElement[]).find((l) => t(l).startsWith(libelle));
    const entree = (libelle: string) => champ(libelle)?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null | undefined;
    const lus: FluxLu[] = [];
    const n = lignes().length;
    for (let i = 0; i < n; i++) {
      bouton(lignes()[i]!, 'Modifier')?.click();
      await attendre(150);
      lus.push({
        nom: entree('Nom')?.value ?? '',
        compte: (entree('Compte') as HTMLSelectElement | null | undefined)?.selectedOptions[0]?.textContent?.trim() ?? '',
        montant: entree('Montant')?.value ?? '',
        tousLes: entree('Tous les')?.value ?? '',
        unite: entree('Unité')?.value ?? '',
        premiere: entree('Première date')?.value ?? '',
        fenetre: entree('Fenêtre des échéances')?.value ?? '',
        toleranceEuros: entree('Tolérance de montant (€)')?.value ?? '',
        tolerancePct: entree('Tolérance de montant (%)')?.value ?? '',
        motif: entree('Motif de libellé')?.value ?? '',
        de: entree('Actif à partir du')?.value ?? '',
        a: entree('Actif jusqu')?.value ?? '',
        variable: (entree('Montant variable') as HTMLInputElement | null | undefined)?.checked ?? false,
      });
      bouton(document, 'Annuler')?.click();
      await attendre(150);
    }
    return lus;
  });

describe.skipIf(!navigateur)('#213 · l’assistant propose tous les revenus et toutes les charges fixes de l’exemple, versions datées comprises', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 300_000);

  afterAll(async () => {
    await site?.fermer();
  });

  describe('sur un projet vierge, à l’étape Revenus', () => {
    let page: Page;
    let arrivee: Ligne[];

    beforeAll(async () => {
      page = await nouvellePage(site);
      await ouvrir(page, site);
      await arriverAuxRevenus(page);
      arrivee = await lignes(page);
    }, 120_000);

    afterAll(async () => {
      await page?.close().catch(() => {});
    });

    it('[niveau 2] point 1 — l’étape arrive avec les quatre revenus de l’exemple, et eux seuls : les deux « Salaire », « Loyer locatif », « Allocations »', () => {
      expect(arrivee.map((l) => l.nom)).toEqual(['Salaire', 'Salaire', 'Loyer locatif', 'Allocations']);
    });

    it('[niveau 2] point 2 — chacun avec son montant et son jour, tels que l’exemple les dit', () => {
      expect(arrivee.map((l) => centimes(l.montant))).toEqual([euros(3400), euros(3550), euros(700), euros(100)]);
      expect(arrivee.map((l) => l.jour)).toEqual(['28', '28', '5', '5']);
    });

    it('[niveau 2] point 3 — deux versions d’un même flux se lisent comme deux lignes du même nom, chacune avec sa date', () => {
      const [avant, apres, loyer, alloc] = arrivee as [Ligne, Ligne, Ligne, Ligne];
      expect(avant.suites.join(' ')).toMatch(/jusqu’au 27 \S+ 2026/);
      expect(apres.suites.join(' ')).toMatch(/à partir du 28 \S+ 2026/);
      // La version qui commence plus tard le dit aussi par sa pastille : elle n'est pas en vigueur à la date de lecture.
      expect(apres.pastilles).toContain('à venir');
      expect(avant.pastilles).not.toContain('à venir');
      // Une ligne que l'exemple ne borne ne dit rien de sa validité.
      for (const l of [loyer, alloc]) expect(l.suites.join(' '), l.nom).not.toMatch(/jusqu’au|à partir du/);
    });

    it('[niveau 2] point 1 — les raccourcis sont tous consommés d’entrée, et l’étape se franchit par son seul bouton primaire (D46, I4)', async () => {
      expect(await raccourcis(page), 'sur un projet vierge, la rangée des raccourcis est vide').toEqual([]);
      expect((await lire(page)).primaires.some((p) => /Suivant/.test(p))).toBe(true);
    });

    it('[niveau 2] point 3 — les deux lignes « Salaire » se retirent une à une', async () => {
      await retirer(page, 'Salaire');
      const reste = await lignes(page);
      expect(reste.map((l) => l.nom)).toEqual(['Salaire', 'Loyer locatif', 'Allocations']);
      expect(reste[0]!.suites.join(' '), 'c’est la première version qui est retirée').toMatch(/à partir du 28 \S+ 2026/);
      await retirer(page, 'Salaire');
      expect((await lignes(page)).map((l) => l.nom)).toEqual(['Loyer locatif', 'Allocations']);
    });
  });

  describe('sur un projet vierge, à l’étape Charges fixes', () => {
    it('[niveau 2] point 1 — l’étape arrive avec les quatre charges fixes de l’exemple, et elles seules, chacune avec son montant, son jour et sa date de fin', async () => {
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        await arriverAuxRevenus(page);
        expect(await avancer(page), 'l’étape des revenus ne se franchit pas par son bouton primaire').toBe(true);
        expect((await lire(page)).h2).toMatch(/Qu.est-ce qui part tout seul/);
        const l = await lignes(page);
        expect(l.map((x) => x.nom)).toEqual(['Crédit immobilier', 'Assurance habitation', 'Internet et mobiles', 'Électricité']);
        expect(l.map((x) => centimes(x.montant))).toEqual([euros(950), euros(45), euros(75), euros(150)]);
        expect(l.map((x) => x.jour)).toEqual(['5', '10', '12', '15']);
        // Le crédit dit sa dernière échéance ; les autres charges ne disent rien de leur validité.
        expect(l[0]!.suites.join(' ')).toMatch(/jusqu’au 5 \S+ 2026/);
        for (const x of l.slice(1)) expect(x.suites.join(' '), x.nom).not.toMatch(/jusqu’au|à partir du/);
        expect(await raccourcis(page), 'sur un projet vierge, la rangée des raccourcis est vide').toEqual([]);
      } finally {
        await page.close();
      }
    }, 180_000);

    it('[niveau 2] point 4 — le bandeau ne compte que les versions en vigueur au début de la période : un seul salaire, et le crédit', async () => {
      const page = await nouvellePage(site);
      try {
        await ouvrir(page, site);
        await arriverAuxRevenus(page);
        expect(await avancer(page)).toBe(true);
        const b = await bandeau(page);
        // Septembre (le 1er au 30, début de période des projets vierges) : 3 400 + 700 + 100, et 950 + 45 + 75 + 150.
        // Les deux versions du salaire ensemble donneraient 7 750 € de revenus.
        expect(centimes(b['Revenus par période']!), 'revenus de la période').toBe(euros(4200));
        expect(centimes(b['Charges fixes']!), 'charges fixes de la période').toBe(euros(1220));
      } finally {
        await page.close();
      }
    }, 180_000);
  });

  describe('sur un projet existant', () => {
    it('[niveau 2] point 5 et 9 — le raccourci d’un flux apporte toutes ses versions, avec leurs dates, et disparaît dès qu’un flux du même nom existe ; il montre le montant de la version en vigueur', async () => {
      const page = await projetValide(site);
      try {
        // Le projet n'est plus vierge : l'assistant part de son contenu, il ne sème plus rien (D43).
        await rouvrirAuxRevenus(page);
        expect((await lignes(page)).map((l) => l.nom), 'sur un projet existant, rien n’est semé d’office').toEqual(['Salaire', 'Salaire', 'Loyer locatif', 'Allocations']);
        expect(await raccourcis(page)).toEqual([]);

        // Le flux est retiré dans l'assistant : son raccourci revient, une seule fois pour ses deux versions.
        await retirer(page, 'Salaire');
        expect(await raccourcis(page), 'une version reste : le raccourci ne revient pas').toEqual([]);
        await retirer(page, 'Salaire');
        const offerts = await raccourcis(page);
        expect(offerts.map((r) => r.nom), 'un raccourci par flux, non par version').toEqual(['+ Salaire']);
        // Il montre le montant de la version en vigueur à la date de lecture.
        expect(centimes(offerts[0]!.montant)).toBe(euros(3400));

        // Un clic apporte le flux avec toutes ses versions, chacune avec sa date, puis le raccourci disparaît.
        expect(await cliquer(page, '+ Salaire')).toBe(true);
        await pause(250);
        const apres = await lignes(page);
        expect(apres.map((l) => l.nom).sort()).toEqual(['Allocations', 'Loyer locatif', 'Salaire', 'Salaire']);
        const salaires = apres.filter((l) => l.nom === 'Salaire');
        expect(salaires.map((l) => centimes(l.montant))).toEqual([euros(3400), euros(3550)]);
        expect(salaires[0]!.suites.join(' ')).toMatch(/jusqu’au 27 \S+ 2026/);
        expect(salaires[1]!.suites.join(' ')).toMatch(/à partir du 28 \S+ 2026/);
        expect(await raccourcis(page), 'tous les flux de l’exemple sont là : plus de raccourci').toEqual([]);
      } finally {
        await page.close();
      }
    }, 240_000);

    it('[niveau 2] point 5 — un flux saisi à la main sous le même nom fait disparaître le raccourci', async () => {
      const page = await projetValide(site);
      try {
        await rouvrirAuxRevenus(page);
        await retirer(page, 'Salaire');
        await retirer(page, 'Salaire');
        expect((await raccourcis(page)).map((r) => r.nom)).toEqual(['+ Salaire']);

        await saisir(page, 'main form.edit input[placeholder="Salaire"]', 'Salaire');
        await saisir(page, 'main form.edit input[placeholder="2 400,00"]', '2 000,00');
        expect(await cliquer(page, 'Ajouter')).toBe(true);
        await pause(250);
        expect(await raccourcis(page)).toEqual([]);
      } finally {
        await page.close();
      }
    }, 240_000);
  });

  describe('l’assistant validé tel quel', () => {
    let page: Page;

    beforeAll(async () => {
      page = await projetValide(site);
      await ecran(page, 'Flux prévus');
    }, 180_000);

    afterAll(async () => {
      await page?.close().catch(() => {});
    });

    it('[niveau 1] point 7 — laisse dans le projet les huit flux de revenu et de charge fixe, et eux seuls, chacun dans son groupe et sur son compte, retrouvables dans Flux prévus avec leur date (I11)', async () => {
      const l = revenusEtCharges(await fluxPrevus(page));
      const vus = l.map((x) => `${x.nom} | ${/^Revenu/.test(x.genre) ? 'income' : 'fixedCharge'} | ${x.sous.split(' · ')[0]}`).sort();
      const attendus = fluxDeLExemple.map((f) => `${f.name} | ${f.kind} | ${compteDe(f.accountId)}`).sort();
      expect(vus, 'les flux de Flux prévus (nom | genre | compte) ne sont pas ceux de l’exemple').toEqual(attendus);
      expect(l).toHaveLength(8);
      const salaires = l.filter((x) => x.nom === 'Salaire');
      expect(salaires.map((x) => x.sous).join(' | ')).toMatch(/jusqu’au 27 \S+ 2026/);
      expect(salaires.map((x) => x.sous).join(' | ')).toMatch(/à partir du 28 \S+ 2026/);
      expect(l.find((x) => x.nom === 'Crédit immobilier')!.sous).toMatch(/jusqu’au 5 \S+ 2026/);
    });

    it('[niveau 2] point 2 — chacun des huit flux se lit dans son formulaire tel que l’exemple le dit : montant, rythme, première date, compte, fenêtre, tolérance, motif, montant variable, dates de début et de fin', async () => {
      const lus = (await formulairesDesFlux(page)).map((x) => ({
        nom: x.nom,
        compte: x.compte,
        montant: Math.abs(centimes(x.montant)),
        tousLes: x.tousLes,
        unite: x.unite,
        premiere: x.premiere,
        fenetre: x.fenetre,
        toleranceEuros: x.toleranceEuros === '' ? null : centimes(x.toleranceEuros),
        tolerancePct: x.tolerancePct === '' ? null : Number(x.tolerancePct),
        motif: x.motif,
        de: x.de,
        a: x.a,
        variable: x.variable,
      }));
      const attendus = fluxDeLExemple.map((f) => ({
        nom: f.name,
        compte: compteDe(f.accountId),
        montant: Math.abs(f.amount),
        tousLes: String(f.periodicity.interval),
        unite: f.periodicity.unit,
        premiere: f.periodicity.anchorDate,
        fenetre: String(f.dateWindowDays),
        toleranceEuros: f.amountTolerance?.abs ?? null,
        tolerancePct: f.amountTolerance?.pct ?? null,
        motif: f.labelPattern ?? '',
        de: f.activeFrom ?? '',
        a: f.activeTo ?? '',
        variable: !!f.variable,
      }));
      const parNomEtDate = (a: { nom: string; premiere: string }, b: { nom: string; premiere: string }) =>
        `${a.nom}|${a.premiere}`.localeCompare(`${b.nom}|${b.premiere}`);
      expect(lus.sort(parNomEtDate)).toEqual(attendus.sort(parNomEtDate));
    });

    it('[niveau 1] point 7 — les dates de début et de fin se modifient dans Flux prévus, et la ligne le dit (I11)', async () => {
      // Le salaire en vigueur : on lit ses deux dates, puis on repousse sa date de fin.
      await modifier(page, 'Salaire', /jusqu’au 27/);
      expect(await champ(page, 'Actif à partir du')).toBe('');
      expect(await champ(page, 'Actif jusqu')).toBe('2026-10-27');
      await saisirChamp(page, 'Actif jusqu', '2026-11-30');
      expect(await cliquer(page, 'Enregistrer')).toBe(true);
      await pause(300);
      const salaires = (await fluxPrevus(page)).filter((x) => x.nom === 'Salaire');
      expect(salaires.map((x) => x.sous).join(' | ')).toMatch(/jusqu’au 30 \S+ 2026/);

      // La version suivante : sa date de début se lit et se modifie de même.
      await modifier(page, 'Salaire', /à partir du 28/);
      expect(await champ(page, 'Actif à partir du')).toBe('2026-10-28');
      expect(await champ(page, 'Actif jusqu')).toBe('');
      await saisirChamp(page, 'Actif à partir du', '2026-12-01');
      expect(await cliquer(page, 'Enregistrer')).toBe(true);
      await pause(300);
      expect((await fluxPrevus(page)).filter((x) => x.nom === 'Salaire').map((x) => x.sous).join(' | ')).toMatch(/à partir du 1 \S+ 2026/);
    });
  });
});
