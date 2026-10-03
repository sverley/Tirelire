/**
 * Tests du codeur de #213 — « L'assistant propose tous les revenus et toutes les charges fixes de l'exemple, versions
 * datées comprises », côté écran : sur le site construit, à 375 px, au jour des tests (`JOUR_DES_TESTS`, 20 septembre 2026).
 * La lecture de ces flux dans l'exemple et le flux qu'en fait une proposition, côté cœur, sont dans
 * `packages/core/test/suggestions-flux.test.ts`.
 *
 * Chaque test dit, dans son titre, le point du « Fait quand » qu'il vérifie. Tous sont de niveau 4 (D83) : l'auditeur
 * donne leur niveau à ceux qu'il retient.
 *
 * Les dates se lisent à l'écran sous la forme de l'application (« jusqu’au 27 oct. 2026 ») : les tests ne figent que le
 * jour et l'année, pas l'abréviation du mois.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { euros } from '@tirelire/core';
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

    it('[niveau 4] #213 · 1 — l’étape arrive avec les quatre revenus de l’exemple, et eux seuls : les deux « Salaire », « Loyer locatif », « Allocations »', () => {
      expect(arrivee.map((l) => l.nom)).toEqual(['Salaire', 'Salaire', 'Loyer locatif', 'Allocations']);
    });

    it('[niveau 4] #213 · 2 — chacun avec son montant et son jour, tels que l’exemple les dit', () => {
      expect(arrivee.map((l) => centimes(l.montant))).toEqual([euros(3400), euros(3550), euros(700), euros(100)]);
      expect(arrivee.map((l) => l.jour)).toEqual(['28', '28', '5', '5']);
    });

    it('[niveau 4] #213 · 3 — deux versions d’un même flux se lisent comme deux lignes du même nom, chacune avec sa date', () => {
      const [avant, apres, loyer, alloc] = arrivee as [Ligne, Ligne, Ligne, Ligne];
      expect(avant.suites.join(' ')).toMatch(/jusqu’au 27 \S+ 2026/);
      expect(apres.suites.join(' ')).toMatch(/à partir du 28 \S+ 2026/);
      // La version qui commence plus tard le dit aussi par sa pastille : elle n'est pas en vigueur à la date de lecture.
      expect(apres.pastilles).toContain('à venir');
      expect(avant.pastilles).not.toContain('à venir');
      // Une ligne que l'exemple ne borne ne dit rien de sa validité.
      for (const l of [loyer, alloc]) expect(l.suites.join(' '), l.nom).not.toMatch(/jusqu’au|à partir du/);
    });

    it('[niveau 4] #213 · 1 — les raccourcis sont tous consommés d’entrée, et l’étape se franchit par son seul bouton primaire (D46, I4)', async () => {
      expect(await raccourcis(page), 'sur un projet vierge, la rangée des raccourcis est vide').toEqual([]);
      expect((await lire(page)).primaires.some((p) => /Suivant/.test(p))).toBe(true);
    });

    it('[niveau 4] #213 · 3 — les deux lignes « Salaire » se retirent une à une', async () => {
      await retirer(page, 'Salaire');
      const reste = await lignes(page);
      expect(reste.map((l) => l.nom)).toEqual(['Salaire', 'Loyer locatif', 'Allocations']);
      expect(reste[0]!.suites.join(' '), 'c’est la première version qui est retirée').toMatch(/à partir du 28 \S+ 2026/);
      await retirer(page, 'Salaire');
      expect((await lignes(page)).map((l) => l.nom)).toEqual(['Loyer locatif', 'Allocations']);
    });
  });

  describe('sur un projet vierge, à l’étape Charges fixes', () => {
    it('[niveau 4] #213 · 1 — l’étape arrive avec les quatre charges fixes de l’exemple, et elles seules, chacune avec son montant, son jour et sa date de fin', async () => {
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

    it('[niveau 4] #213 · 4 — le bandeau ne compte que les versions en vigueur au début de la période : un seul salaire, et le crédit', async () => {
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
    it('[niveau 4] #213 · 5 — le raccourci d’un flux apporte toutes ses versions, avec leurs dates, et disparaît dès qu’un flux du même nom existe', async () => {
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

    it('[niveau 4] #213 · 5 — un flux saisi à la main sous le même nom fait disparaître le raccourci', async () => {
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

    it('[niveau 4] #213 · 7 — laisse dans le projet les huit flux de revenu et de charge fixe, et eux seuls, retrouvables dans Flux prévus, avec leur date', async () => {
      const l = revenusEtCharges(await fluxPrevus(page));
      expect(l.map((x) => x.nom).sort((a, b) => a.localeCompare(b, 'fr'))).toEqual([
        'Allocations',
        'Assurance habitation',
        'Crédit immobilier',
        'Électricité',
        'Internet et mobiles',
        'Loyer locatif',
        'Salaire',
        'Salaire',
      ]);
      const salaires = l.filter((x) => x.nom === 'Salaire');
      expect(salaires.map((x) => x.sous).join(' | ')).toMatch(/jusqu’au 27 \S+ 2026/);
      expect(salaires.map((x) => x.sous).join(' | ')).toMatch(/à partir du 28 \S+ 2026/);
      expect(l.find((x) => x.nom === 'Crédit immobilier')!.sous).toMatch(/jusqu’au 5 \S+ 2026/);
    });

    it('[niveau 4] #213 · 2 et 7 — ce que l’étape ne montrait pas se lit dans Flux prévus, tel que l’exemple le dit : fenêtre, tolérance de montant, motif de libellé, montant variable', async () => {
      await modifier(page, 'Salaire', /jusqu’au 27/);
      expect(await champ(page, 'Première date')).toBe('2026-08-28');
      expect(await champ(page, 'Fenêtre des échéances')).toBe('3');
      expect(await champ(page, 'Tolérance de montant (%)')).toBe('10');
      expect(await champ(page, 'Motif de libellé')).toBe('VIR(EMENT)? .*SALAIRE');
      expect(await champ(page, 'Montant variable')).toBe(true);
      expect(await champ(page, 'Actif à partir du')).toBe('');
      expect(await champ(page, 'Actif jusqu')).toBe('2026-10-27');
    });

    it('[niveau 4] #213 · 7 — les dates de début et de fin se modifient dans Flux prévus, et la ligne le dit', async () => {
      // Le formulaire du salaire en vigueur est ouvert (test précédent) : on repousse sa date de fin.
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
