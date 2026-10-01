/**
 * Harnais d'audit de #297, côté écran — ce que les écrans Opérations et Saisie font des
 * sous-opérations (point 6 du « Fait quand ») : on divise une part à tout niveau et on la lit avec son
 * montant et ce qui vaut pour elle ; modifier l'opération, un niveau ou sa saisie garde ce que
 * contiennent les autres niveaux. Le calcul, la conservation et la synchronisation sont gardés dans
 * le cœur (`packages/core/test/sous-operations-harnais.test.ts`) ; ici, seulement ce qui se voit et
 * ce que l'écran ne perd pas.
 *
 * Écrits par l'auditeur : le codeur n'avait aucun test d'écran pour ce point. Les deux parcours
 * partent de l'exemple chargé (« Fournitures scolaires », −146 €, une ligne : catégorie « Enfants »,
 * tirelire « Enfants et loisirs »), divisé à la main en deux moitiés de −73 € : l'une classée
 * « Alimentation », l'autre sans catégorie ni tirelire, qui prend celles du niveau au-dessus.
 *
 * Niveaux (D83) : 0 pour ce qu'une modification de l'écran ne doit pas perdre (des données saisies,
 * irréparables une fois perdues) ; 2 pour ce que l'écran donne à lire (un cas faux, l'usage restant
 * possible).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

const OPÉRATION = 'Fournitures scolaires';
const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/** Le panneau de ventilation ouvert, lu en une chaîne. */
const panneau = (page: Page) =>
  page.evaluate(() => (document.querySelector('form.edit')?.textContent ?? '').replace(/\s+/g, ' ').trim());

/** Ce que dit la ligne `i` du panneau : ses deux choix « vides » (ce qu'elle prend du niveau au-dessus) et son montant. */
const ligne = (page: Page, i: number) =>
  page.evaluate((i: number) => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const g = [...document.querySelectorAll('form.edit .grid')][i];
    const choix = (début: string) =>
      [...(g?.querySelectorAll('label') ?? [])].find((x) => t(x).startsWith(début))?.querySelector('select') as HTMLSelectElement | null;
    return { catégorie: t(choix('Catégorie')?.options[0]), tirelire: t(choix('Tirelire')?.options[0]), soit: t(g?.querySelector('.sub')) };
  }, i);

/** Ce que l'écran Opérations affiche sous le libellé d'une opération : ses lignes comptées, avec leur montant. */
const résumé = (page: Page, libellé: string) =>
  page.evaluate((l: string) => {
    const t = (e?: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const r = [...document.querySelectorAll('main .card .row')]
      .filter((x) => x.querySelector(':scope > label.cocher'))
      .find((x) => t(x.querySelector(':scope > button.label strong')) === l);
    return t(r?.querySelector(':scope > button.label .sub'));
  }, libellé);

/** Passe l'affichage de l'écran Opérations sur « Toutes » : l'opération de l'exemple est verrouillée. */
async function afficherToutes(page: Page) {
  const fait = await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => (o.textContent ?? '').trim() === 'Non traitées'));
    const o = s && [...s.options].find((x) => (x.textContent ?? '').trim() === 'Toutes');
    if (!s || !o) return false;
    s.value = o.value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  if (!fait) throw new Error('le filtre « Toutes » est introuvable sur l’écran Opérations');
  await pause();
}

async function ouvrirLaLigne(page: Page, libellé: string) {
  const ouvert = await page.evaluate((l: string) => {
    const r = [...document.querySelectorAll('main .card .row')]
      .filter((x) => x.querySelector(':scope > label.cocher'))
      .find((x) => (x.querySelector(':scope > button.label strong')?.textContent ?? '').trim() === l);
    const b = r?.querySelector(':scope > button.label') as HTMLButtonElement | undefined;
    b?.click();
    return !!b;
  }, libellé);
  if (!ouvert) throw new Error(`opération « ${libellé} » introuvable`);
  await pause();
}

/** Clique le `n`-ième bouton du panneau ouvert dont le texte est exactement `texte`. */
async function bouton(page: Page, texte: string, n = 0) {
  const fait = await page.evaluate(
    ({ texte, n }: { texte: string; n: number }) => {
      const b = [...document.querySelectorAll('form.edit button')].filter((x) => (x.textContent ?? '').trim() === texte)[n] as HTMLButtonElement | undefined;
      b?.click();
      return !!b;
    },
    { texte, n },
  );
  if (!fait) throw new Error(`bouton « ${texte} » (n° ${n}) introuvable dans le panneau : ${await panneau(page)}`);
  await pause(300);
}

/** Choisit `texte` dans la liste de la ligne `i` dont l'étiquette commence par `début`. */
async function choisir(page: Page, i: number, début: string, texte: string) {
  const fait = await page.evaluate(
    ({ i, début, texte }: { i: number; début: string; texte: string }) => {
      const g = [...document.querySelectorAll('form.edit .grid')][i];
      const l = [...(g?.querySelectorAll('label') ?? [])].find((x) => (x.textContent ?? '').trim().startsWith(début));
      const s = l?.querySelector('select') as HTMLSelectElement | null;
      const o = s && [...s.options].find((x) => (x.textContent ?? '').trim() === texte);
      if (!s || !o) return false;
      s.value = o.value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    { i, début, texte },
  );
  if (!fait) throw new Error(`« ${début} » : choix « ${texte} » introuvable sur la ligne ${i}`);
  await pause(150);
}

/** Saisit la valeur (pourcentage ou montant) de la ligne `i`. */
async function saisir(page: Page, i: number, valeur: string) {
  const fait = await page.evaluate(
    ({ i, valeur }: { i: number; valeur: string }) => {
      const champ = [...document.querySelectorAll('form.edit .grid')][i]?.querySelector('input') as HTMLInputElement | null;
      if (!champ) return false;
      champ.value = valeur;
      champ.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    { i, valeur },
  );
  if (!fait) throw new Error(`pas de champ de valeur sur la ligne ${i}`);
  await pause(150);
}

/**
 * Le point de départ des deux parcours : la part de l'exemple divisée à la main en 50 % « Alimentation »
 * et le reste, enregistrée. Rend ce que disait le panneau du niveau à son ouverture, avant qu'on y écrive.
 */
async function diviserEnDeux(page: Page): Promise<string> {
  await allerÀ(page, 'Opérations');
  await afficherToutes(page);
  await ouvrirLaLigne(page, OPÉRATION);
  await bouton(page, 'Diviser');
  const ouverture = await panneau(page);
  await choisir(page, 0, 'Part', 'Pourcentage');
  await saisir(page, 0, '50');
  await choisir(page, 0, 'Catégorie', 'Alimentation');
  await bouton(page, 'Ajouter une ligne');
  await bouton(page, 'Enregistrer');
  return ouverture;
}

describe.skipIf(!navigateur)('#297 · 6. les écrans', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  });
  afterAll(async () => {
    await site?.fermer();
  });

  it('[niveau 2] #297 · 6. on divise une part à tout niveau, et on la lit avec son montant et ce qui vaut pour elle', async () => {
    const page = await ouvrirLExemple(site);
    try {
      const ouverture = await diviserEnDeux(page);
      // Le niveau qu'on ouvre dit son montant et ce que prendra une ligne qui ne règle rien.
      expect(ouverture).toContain('Opération › −146,00 € · Enfants · Enfants et loisirs');
      expect(ouverture).toContain('Vous divisez cette part de −146,00 €');
      expect(ouverture).toContain('prend Enfants et Enfants et loisirs');

      // Enregistrée, la division se relit : chaque part a son montant, et la seconde, qui ne règle rien, montre ce qu'elle prend.
      expect((await ligne(page, 0)).soit).toBe('soit −73,00 €');
      expect(await ligne(page, 1)).toEqual({ catégorie: '— (Enfants)', tirelire: '— (Enfants et loisirs)', soit: 'soit −73,00 €' });
      // La liste des opérations la lit à ses feuilles : chaque part avec ses étiquettes (celles du niveau pour la seconde) et son montant.
      const lignes = await résumé(page, OPÉRATION);
      expect(lignes).toMatch(/Alimentation[^+]*−73,00 €/);
      expect(lignes).toContain('Enfants / Enfants et loisirs / −73,00 €');

      // Et on la divise encore, un niveau plus bas, sans limite : le niveau dit tout ce qui le contient.
      await bouton(page, 'Diviser', 1);
      const troisième = await panneau(page);
      // Les espaces autour de « › » ne sont pas ce que ce test garde.
      expect(troisième).toMatch(/Opération › −146,00 € · Enfants · Enfants et loisirs\s*›\s*−73,00 €/);
      expect(troisième).toContain('Vous divisez cette part de −73,00 €');
    } finally {
      await page.close();
    }
  });

  it('[niveau 0] #297 · 6. modifier un niveau, l’opération ou sa saisie garde ce que contiennent les autres niveaux', async () => {
    const page = await ouvrirLExemple(site);
    try {
      await diviserEnDeux(page);

      // Au premier niveau, on change la catégorie de la part divisée : ses deux moitiés restent, et celle qui ne règle rien prend la nouvelle.
      await bouton(page, 'Remonter d’un niveau');
      expect((await ligne(page, 0)).soit).toContain('divisée en 2');
      await choisir(page, 0, 'Catégorie', 'Santé');
      await bouton(page, 'Enregistrer');
      const aprèsNiveau = await résumé(page, OPÉRATION);
      expect(aprèsNiveau).toMatch(/Alimentation[^+]*−73,00 €/);
      expect(aprèsNiveau).toContain('Santé / Enfants et loisirs / −73,00 €');

      // La saisie ne règle qu'une catégorie et une tirelire : elle garde la division, à tous ses niveaux.
      await allerÀ(page, 'Plus');
      await cliquer(page, 'Saisie manuelle');
      await pause(300);
      const renommée = await page.evaluate(
        ({ ancien, nouveau }: { ancien: string; nouveau: string }) => {
          const r = [...document.querySelectorAll('main .card .row')].find((x) => (x.querySelector('.label strong')?.textContent ?? '').trim() === ancien);
          const modifier = [...(r?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'Modifier') as HTMLButtonElement | undefined;
          return !!modifier && (modifier.click(), true);
        },
        { ancien: OPÉRATION, nouveau: `${OPÉRATION} (rentrée)` },
      );
      expect(renommée, 'la saisie de l’opération s’ouvre').toBe(true);
      await pause(300);
      await page.evaluate((nouveau: string) => {
        const f = document.querySelector('form.edit');
        const champ = [...(f?.querySelectorAll('label') ?? [])].find((x) => (x.textContent ?? '').trim().startsWith('Libellé'))?.querySelector('input') as HTMLInputElement | null;
        if (!champ) throw new Error('champ « Libellé » introuvable dans la saisie');
        champ.value = nouveau;
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        ([...(f?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'Enregistrer') as HTMLButtonElement).click();
      }, `${OPÉRATION} (rentrée)`);
      await pause(400);

      await allerÀ(page, 'Opérations');
      await afficherToutes(page);
      const aprèsSaisie = await résumé(page, `${OPÉRATION} (rentrée)`);
      expect(aprèsSaisie).toMatch(/Alimentation[^+]*−73,00 €/);
      expect(aprèsSaisie).toContain('Santé / Enfants et loisirs / −73,00 €');
    } finally {
      await page.close();
    }
  });
});
