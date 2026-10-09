/**
 * Harnais d'audit de #321 — sans opération, aucun écran ne présente l'import comme un préalable : ce que
 * disent et offrent l'écran Opérations sans opération (point 1), l'écran Import (point 2) et le bandeau
 * des opérations anciennes (point 3), et qu'aucun des trois ne déborde à 375 px (C9).
 *
 * Le point 4 — les textes que la tâche écrit vouvoient (D85) — se vérifie sans navigateur : les trois
 * textes tels que l'application les montre dans `apps/web/test/import-enrichissement-ecran.test.ts`, sur
 * l'application montée sous jsdom ; aucune forme du tutoiement dans leurs sources, dans
 * `apps/web/test/vouvoiement-textes-harnais.test.ts`. #420 en a retiré le test d'ici.
 *
 * Retenus parmi les tests du codeur (`import-enrichissement.test.ts`, d'où ils sont déplacés ; aucun n'est
 * resté au niveau 4, le fichier disparaît), puis complétés :
 *  - la phrase d'Opérations se lit par ses idées (le budget, le plan, importer, saisir, le réel), non par
 *    ses mots : une reformulation ne rougit pas le harnais, une phrase qui cesse d'en dire une, si ; elle
 *    reste une seule phrase, et les deux moyens sont dans la même rangée, au même rang ;
 *  - l'état du constat de l'issue (l'assistant mené jusqu'au bout, un solde sur le compte principal,
 *    aucune opération) est lu comme la base vide : l'écran dit la même chose ;
 *  - le texte d'aujourd'hui d'Import n'est plus figé mot pour mot : le harnais garde qu'il vient après
 *    ce que l'import apporte, par son ancre « compte principal », que garde déjà le harnais d'I5 ; relu au
 *    diff, le paragraphe est inchangé ;
 *  - aucun des trois blocs ne fait déborder l'écran à 375 px (C9).
 * Les blocs se reconnaissent à `data-sans-operation` et `data-apport-import`, les marques que le codeur pose.
 *
 * Niveaux (D83) : 1 pour les points 1 à 3 : I3 (« aucun écran ne bloque ni n'insiste pour importer » ;
 * aucun usage n'est présenté comme la version réduite d'un autre : U1, U5) et I5 (l'écran vide dit ce qui
 * le remplit), comme l'audit de #320 a classé la même famille de besoins. Y compris « dès la première
 * opération, l'écran redevient celui d'aujourd'hui » : s'il cessait de l'être, qui a des opérations
 * perdrait la recherche et les actions, donc U5 et I6. Chacun a son témoin rouge, montré à l'audit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/** Les idées que la phrase d'Opérations sans opération doit dire (« Fait quand », point 1). */
const IDÉES_DE_LA_PHRASE: Record<string, RegExp> = {
  'le budget': /budget/i,
  'le plan': /plan/i,
  'se tiennent sans opération': /sans (elles|opérations?)/i,
  importées: /import/i,
  saisies: /saisi/i,
  'au réel': /réel/i,
};

/** Ce qu'un texte ne dit pas parmi les idées demandées. */
const idéesAbsentes = (texte: string, idées: Record<string, RegExp>) =>
  Object.entries(idées)
    .filter(([, re]) => !re.test(texte))
    .map(([nom]) => nom);

/** Ce que montre l'écran : titre, boutons, champs, texte, onglet actif, débordement. */
const lireLÉcran = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main');
    return {
      h1: t(main?.querySelector('h1')),
      boutons: [...(main?.querySelectorAll('button') ?? [])].map(t),
      champs: main?.querySelectorAll('input, select, textarea').length ?? 0,
      texte: t(main),
      ongletActif: t(document.querySelector('.tabbar button.active')),
      deborde: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

/** Le bandeau des opérations anciennes : son texte, ses boutons (texte et classe), le débordement. */
const lireLeBandeau = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const carte = [...document.querySelectorAll('main .card.warn')].find((c) => t(c).includes('Dernière opération connue'));
    return carte
      ? {
          texte: t(carte),
          boutons: [...carte.querySelectorAll('button')].map((b) => ({ texte: t(b), classe: b.className })),
          deborde: document.documentElement.scrollWidth > window.innerWidth,
        }
      : null;
  });

/** Clique, dans le bandeau des opérations anciennes, le bouton qui porte exactement ce texte. */
const cliquerDansLeBandeau = async (page: Page, texte: string) => {
  const ok = await page.evaluate((libellé: string) => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const carte = [...document.querySelectorAll('main .card.warn')].find((c) => t(c).includes('Dernière opération connue'));
    const b = [...(carte?.querySelectorAll('button') ?? [])].find((x) => t(x) === libellé) as HTMLButtonElement | undefined;
    b?.click();
    return !!b;
  }, texte);
  if (ok) await pause(150);
  return ok;
};

/** Une base vide, l'application ouverte sur l'accueil. */
async function baseVide(site: Site): Promise<Page> {
  const page = await nouvellePage(site);
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent?.includes('Construire mon budget')));
  return page;
}

async function attendreTitre(page: Page, titre: string) {
  await page.waitForFunction((t: string) => document.querySelector('main h1')?.textContent?.replace(/\s+/g, ' ').trim() === t, { timeout: 5000 }, titre);
  await pause();
}

/** L'assistant mené jusqu'au bout avec ses valeurs par défaut : un budget, des comptes, aucune opération. */
async function menerLAssistant(page: Page) {
  expect(await cliquer(page, 'Construire mon budget')).toBe(true);
  for (let i = 0; i < 15; i++) {
    const suivant = await page.evaluate(() => {
      const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
      const boutons = [...document.querySelectorAll('main button')] as HTMLButtonElement[];
      const fin = boutons.find((x) => t(x) === 'Voir le plan');
      const b = fin ?? boutons.find((x) => x.classList.contains('primary') && /Suivant|Commencer|Valider/.test(t(x)));
      b?.click();
      return fin ? 'fin' : b ? 'suite' : 'rien';
    });
    await pause();
    if (suivant !== 'suite') break;
  }
}

/** L'exemple lu un mois et demi après sa dernière opération : le bandeau des opérations anciennes paraît. */
async function exempleAuBandeau(site: Site): Promise<Page> {
  const page = await ouvrirLExemple(site);
  // L'exemple s'arrête début septembre : lu le 20 octobre, ses opérations sont anciennes.
  await page.$eval('header input[type=date]', (i) => {
    const champ = i as HTMLInputElement;
    champ.value = '2026-10-20';
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    champ.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await pause(300);
  return page;
}

/** L'écran Opérations tel que le « Fait quand » le veut quand il n'y a aucune opération. */
async function vérifierLÉcranSansOpération(page: Page, où: string) {
  await allerÀ(page, 'Opérations');
  await attendreTitre(page, 'Opérations');
  const é = await lireLÉcran(page);
  const phrase = é.texte.replace(é.h1, '').replace('Importer un relevé', '').replace('Saisir une opération', '').trim();
  expect(idéesAbsentes(phrase, IDÉES_DE_LA_PHRASE), `${où} : la phrase ne dit pas tout (« ${phrase} »)`).toEqual([]);
  expect((phrase.match(/[.!?](?=\s|$)/g) ?? []).length, `${où} : en une phrase (« ${phrase} »)`).toBe(1);
  expect(é.boutons, `${où} : les deux moyens, et rien d'autre`).toEqual(['Importer un relevé', 'Saisir une opération']);
  const rang = await page.evaluate(() => {
    const [a, b] = [...document.querySelectorAll('main button')] as HTMLElement[];
    return { classes: [a?.className, b?.className], mêmeRangée: !!a && a.parentElement === b?.parentElement };
  });
  expect(rang.classes[0], `${où} : les deux moyens au même rang`).toBe(rang.classes[1]);
  expect(rang.mêmeRangée, `${où} : les deux moyens dans la même rangée`).toBe(true);
  expect(é.champs, `${où} : ni recherche, ni filtre, ni action`).toBe(0);
  expect(é.texte, `${où} : ni recherche, ni actions`).not.toMatch(/Recherche|Actions sur|Tout cocher|Non traitées/);
  expect(é.deborde, `${où} : l'écran déborde à 375 px (C9)`).toBe(false);
}

describe.skipIf(!navigateur)('#321 · l’import, un enrichissement et non un préalable', () => {
  let site: Site;
  beforeAll(async () => {
    site = await ouvrirLeSite();
  });
  afterAll(async () => {
    await site?.fermer();
  });

  it('[niveau 1] point 1 — sans aucune opération, base vide comme après l’assistant, Opérations le dit en une phrase et offre les deux moyens, au même rang, rien d’autre', async () => {
    const page = await baseVide(site);
    try {
      await vérifierLÉcranSansOpération(page, 'base vide');

      // Le constat de l'issue : l'assistant mené jusqu'au bout, un budget, aucune opération. Il se lance
      // depuis le Plan, où la base vide propose « Construire mon budget ».
      await allerÀ(page, 'Plan');
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => x.textContent?.includes('Construire mon budget')));
      await menerLAssistant(page);
      await vérifierLÉcranSansOpération(page, 'après l’assistant');

      expect(await cliquer(page, 'Saisir une opération')).toBe(true);
      await attendreTitre(page, 'Saisie');

      await allerÀ(page, 'Opérations');
      await attendreTitre(page, 'Opérations');
      expect(await cliquer(page, 'Importer un relevé')).toBe(true);
      await attendreTitre(page, "Import d'un relevé");
      expect((await lireLÉcran(page)).ongletActif).toContain('Import');
    } finally {
      await page.close();
    }
  });

  it('[niveau 1] point 1 — dès la première opération saisie, Opérations redevient l’écran d’aujourd’hui', async () => {
    const page = await baseVide(site);
    try {
      await menerLAssistant(page);
      await vérifierLÉcranSansOpération(page, 'avant la première opération');

      expect(await cliquer(page, 'Saisir une opération')).toBe(true);
      await attendreTitre(page, 'Saisie');
      expect(await cliquer(page, 'Saisir une opération')).toBe(true);
      // Les aides de Saisie sont celles d'une même opération de l'exemple (#214) : « Dentiste (payé par Marie) », 80,00 €.
      await page.type('main input[placeholder="Dentiste (payé par Marie)"]', 'Boulangerie');
      await page.type('main input[placeholder="80,00"]', '4,20');
      expect(await cliquer(page, 'Enregistrer')).toBe(true);
      await pause(300);

      await allerÀ(page, 'Opérations');
      await attendreTitre(page, 'Opérations');
      const é = await lireLÉcran(page);
      expect(é.texte).toContain('Recherche');
      expect(é.texte).toContain('opération(s) sur 1 connues');
      expect(é.boutons.some((b) => b.startsWith('Actions sur'))).toBe(true);
      expect(é.boutons.some((b) => b.startsWith('Tout cocher'))).toBe(true);
      expect(await page.$('main [data-sans-operation]'), 'l’écran sans opération ne reste pas').toBeNull();
    } finally {
      await page.close();
    }
  });

  it('[niveau 1] point 2 — Import dit d’abord ce que l’import apporte (U3, U4, U5) et que le budget n’en a pas besoin (U1), puis son texte d’aujourd’hui', async () => {
    const page = await baseVide(site);
    try {
      await allerÀ(page, 'Import');
      await attendreTitre(page, "Import d'un relevé");
      const apport = await page.evaluate(() => {
        const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const bloc = document.querySelector('main [data-apport-import]');
        const technique = [...document.querySelectorAll('main p')].find((p) => t(p).includes('compte principal'));
        const choix = [...document.querySelectorAll('main label')].find((l) => t(l).includes('Choisir un fichier'));
        const avant = (a?: Node | null, b?: Node | null) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        return bloc
          ? {
              items: [...bloc.querySelectorAll('li')].map(t),
              paragraphes: [...bloc.querySelectorAll('p')].map(t),
              avantLeTexteTechnique: avant(bloc, technique),
              avantLeChoixDuFichier: avant(bloc, choix),
              technique: !!technique,
            }
          : null;
      });
      expect(apport, 'le bloc de ce que l’import apporte doit paraître').not.toBeNull();
      expect(apport!.items, 'trois apports, au même rang : U3, U4, U5').toHaveLength(3);
      const [u3, u4, u5] = apport!.items;
      expect(idéesAbsentes(u3 ?? '', { rapprocher: /rapproch/i, 'un budget': /budget/i }), `U3 : « ${u3} »`).toEqual([]);
      expect(idéesAbsentes(u4 ?? '', { reconstruire: /reconstruire/i, 'un budget': /budget/i, 'l’historique': /historique/i }), `U4 : « ${u4} »`).toEqual([]);
      expect(idéesAbsentes(u5 ?? '', { classer: /class/i, analyser: /analys/i, 'sans budget': /sans budget/i }), `U5 : « ${u5} »`).toEqual([]);
      const bas = apport!.paragraphes.join(' ');
      expect(idéesAbsentes(bas, { 'le budget': /budget/i, 'n’en a pas besoin': /pas besoin/i, 'sans import': /sans (aucun )?import/i }), `U1 : « ${bas} »`).toEqual([]);
      expect(apport!.technique, 'le texte d’aujourd’hui (le relevé du compte principal) reste').toBe(true);
      expect(apport!.avantLeTexteTechnique, 'ce que l’import apporte vient avant le texte technique').toBe(true);
      expect(apport!.avantLeChoixDuFichier, 'et avant le choix du fichier').toBe(true);
      expect((await lireLÉcran(page)).deborde, 'Import déborde à 375 px (C9)').toBe(false);
    } finally {
      await page.close();
    }
  });

  it('[niveau 1] point 3 — le bandeau des opérations anciennes propose d’importer ou de saisir, au même rang, en plus de « Lire au … »', async () => {
    const page = await exempleAuBandeau(site);
    try {
      const bandeau = await lireLeBandeau(page);
      expect(bandeau, 'le bandeau des opérations anciennes doit paraître').not.toBeNull();
      expect(idéesAbsentes(bandeau!.texte, { importer: /import/i, saisir: /saisi/i }), `le bandeau ne nomme pas les deux moyens : « ${bandeau!.texte} »`).toEqual([]);
      const textes = bandeau!.boutons.map((b) => b.texte);
      expect(textes.slice(0, 2)).toEqual(['Importer un relevé', 'Saisir une opération']);
      expect(textes[2]).toMatch(/^Lire au /);
      expect(bandeau!.boutons[0]?.classe, 'importer et saisir au même rang').toBe(bandeau!.boutons[1]?.classe);
      expect(bandeau!.deborde, 'le bandeau déborde à 375 px (C9)').toBe(false);

      expect(await cliquerDansLeBandeau(page, 'Saisir une opération')).toBe(true);
      await attendreTitre(page, 'Saisie');
    } finally {
      await page.close();
    }
  });
});
