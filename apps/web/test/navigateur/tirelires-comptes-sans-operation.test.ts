/**
 * Tests du codeur de #322 — « Les écrans Tirelires et Comptes se lisent sans opération ». Sur le
 * site construit, dans une base vide, au téléphone (375 px), sans aucune opération :
 *
 * - Comptes dit « solde initial à renseigner » pour le compte principal tant qu'il ne l'est pas, et
 *   « Modifier » le renseigne (point 3) ;
 * - après l'assistant mené par ses seuls boutons primaires, ses tirelires sans placement se rangent
 *   sous le compte principal, sans alerte, placement « libre », avec « Ajouter un besoin »,
 *   « Modifier », « Supprimer » (point 1) ; une échéance en manque s'y annonce (#184, point 3) ;
 * - seule une tirelire dont le placement vise un compte supprimé reste à part, en alerte, et son
 *   « Modifier » ouvre son placement (point 2).
 *
 * Niveau 4 (D83) : tests du codeur, l'auditeur choisit parmi eux le harnais.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Une carte de l'écran Tirelires : sa rubrique (le h2 qui la précède), son texte, ses boutons, son alerte. */
interface CarteTirelire {
  rubrique: string;
  texte: string;
  boutons: string[];
  alerte: boolean;
}

const texteDuMain = (page: Page) => page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));

/** Clique, dans `main` (ou la barre d'onglets), le premier bouton dont le libellé contient `libellé`. */
async function geste(page: Page, libellé: string, dansLaCarte?: string): Promise<boolean> {
  const fait = await page.evaluate(
    (l: string, carte: string | null) => {
      const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
      const portée = carte ? [...document.querySelectorAll('main .card')].find((c) => t(c.querySelector('strong, .label')).includes(carte)) : document;
      const b = portée && ([...portée.querySelectorAll(carte ? 'button' : 'main button, .tabbar button')] as HTMLButtonElement[]).find((x) => t(x).includes(l));
      b?.click();
      return !!b;
    },
    libellé,
    dansLaCarte ?? null,
  );
  await pause(200);
  return fait;
}

/** Remplit, dans le formulaire ouvert, le champ dont l'étiquette commence par `étiquette` (une valeur, ou le texte d'une option). */
async function remplir(page: Page, étiquette: string, valeur: string): Promise<boolean> {
  const fait = await page.evaluate(
    (é: string, v: string) => {
      const label = [...document.querySelectorAll('main form.edit label')].find((l) => (l.textContent ?? '').trim().startsWith(é));
      const champ = label?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null;
      if (!champ) return false;
      if (champ instanceof HTMLSelectElement) {
        const o = [...champ.options].find((x) => x.value === v || x.text.trim() === v);
        if (!o) return false;
        champ.value = o.value;
      } else champ.value = v;
      champ.dispatchEvent(new Event('input', { bubbles: true }));
      champ.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    étiquette,
    valeur,
  );
  await pause(100);
  return fait;
}

/** Ouvre un écran de Configuration par son nom. */
async function écran(page: Page, nom: string): Promise<void> {
  await allerÀ(page, 'Plus');
  await geste(page, nom);
}

const lireLesTirelires = (page: Page): Promise<CarteTirelire[]> =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    let rubrique = '';
    const cartes: CarteTirelire[] = [];
    for (const e of document.querySelectorAll('main h2, main > .card')) {
      if (e.tagName === 'H2') rubrique = t(e);
      else cartes.push({ rubrique, texte: t(e), boutons: [...e.querySelectorAll(':scope > .actions button, :scope > .row button')].map((b) => t(b)), alerte: e.classList.contains('warn') });
    }
    return cartes;
  });

/** La ligne « solde initial … » de la carte du compte principal. */
const soldeInitialDuPrincipal = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const carte = [...document.querySelectorAll('main .card')].find((c) => t(c.querySelector('.pill')) === 'principal');
    return [...(carte?.querySelectorAll('.sub') ?? [])].map(t).find((s) => s.includes('solde initial')) ?? '';
  });

/** L'assistant, de l'accueil au plan, par ses seuls boutons primaires (le chemin simple d'I4). */
async function traverserLAssistant(page: Page): Promise<boolean> {
  await allerÀ(page, 'Plan');
  if (!(await geste(page, 'Construire mon budget'))) return false;
  for (let i = 0; i < 15; i++) {
    const primaire = await page.evaluate(() => {
      const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
      if ([...document.querySelectorAll('main button')].some((b) => t(b) === 'Voir le plan')) return 'Voir le plan';
      const b = ([...document.querySelectorAll('main .actions button.primary')] as HTMLButtonElement[]).find((x) => /Suivant|Commencer/.test(t(x)));
      return b ? t(b) : '';
    });
    if (!primaire) return false;
    await geste(page, primaire);
    if (primaire === 'Voir le plan') {
      await pause(400);
      return true;
    }
  }
  return false;
}

describe('[niveau 4] #322 · Tirelires et Comptes sans opération', () => {
  describe.skipIf(!navigateur)('sur le site construit, base vide, au téléphone', () => {
    let site: Site;
    let page: Page;

    beforeAll(async () => {
      site = await ouvrirLeSite();
      page = await nouvellePage(site);
      page.on('dialog', (d) => void d.accept());
      await page.goto(site.url, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
    }, 300_000);

    afterAll(async () => {
      await page?.close().catch(() => {});
      await site?.fermer();
    });

    it('point 3 · le compte principal non renseigné dit « solde initial à renseigner »', async () => {
      await écran(page, 'Comptes');
      const ligne = await soldeInitialDuPrincipal(page);
      expect(ligne).toContain('solde initial à renseigner');
      expect(ligne).not.toMatch(/0,00|1970/);
    });

    it('point 1 · les tirelires de l’assistant se rangent sous le compte principal, sans alerte, avec leurs gestes', async () => {
      expect(await traverserLAssistant(page), 'assistant non traversé').toBe(true);
      await écran(page, 'Tirelires');
      const cartes = await lireLesTirelires(page);
      expect(cartes.length, await texteDuMain(page)).toBeGreaterThan(0);
      for (const c of cartes) {
        expect(c.alerte, c.texte).toBe(false);
        expect(c.rubrique, c.texte).toBe('Compte principal');
        expect(c.texte, c.texte).toContain('voulu : libre');
        for (const b of ['Ajouter un besoin', 'Modifier', 'Supprimer']) expect(c.boutons, c.texte).toContain(b);
      }
      expect(await texteDuMain(page)).not.toContain('Sans compte de placement');
    });

    it('point 1 · une échéance en manque, ajoutée à une tirelire sans placement, s’annonce aussitôt', async () => {
      const [première] = await lireLesTirelires(page);
      const nom = première!.texte.split(' voulu')[0]!;
      expect(await geste(page, 'Ajouter un besoin', nom)).toBe(true);
      expect(await remplir(page, 'Type', 'dueDate')).toBe(true);
      expect(await remplir(page, 'Montant de l', '1 200,00')).toBe(true);
      expect(await remplir(page, 'Première échéance', '2026-10-15')).toBe(true);
      expect(await geste(page, 'Enregistrer')).toBe(true);
      const annonce = await page.evaluate(() => (document.querySelector('main .card .card.warn[role="status"]')?.textContent ?? '').replace(/\s+/g, ' '));
      expect(annonce, await texteDuMain(page)).not.toBe('');
    });

    it('point 2 · seule une tirelire dont le compte de placement n’existe plus reste à part, et « Modifier » ouvre son placement', async () => {
      await écran(page, 'Comptes');
      await geste(page, 'Ajouter un compte');
      await remplir(page, 'Nom', 'Livret Témoin');
      await geste(page, 'Enregistrer');
      await écran(page, 'Tirelires');
      await geste(page, 'Ajouter une tirelire');
      await remplir(page, 'Nom', 'Orpheline');
      expect(await remplir(page, 'Compte', 'Livret Témoin')).toBe(true);
      await geste(page, 'Enregistrer');
      await écran(page, 'Comptes');
      expect(await geste(page, 'Supprimer', 'Livret Témoin')).toBe(true);
      await écran(page, 'Tirelires');

      const cartes = await lireLesTirelires(page);
      const àPart = cartes.filter((c) => c.rubrique === 'Sans compte de placement');
      expect(àPart.map((c) => c.texte.startsWith('Orpheline'))).toEqual([true]);
      expect(àPart[0]!.alerte).toBe(true);
      expect(àPart[0]!.texte).toMatch(/n.existe plus/);
      expect(àPart[0]!.boutons).toContain('Modifier');
      expect(cartes.filter((c) => c.alerte && c.rubrique !== 'Sans compte de placement')).toEqual([]);

      expect(await geste(page, 'Modifier', 'Orpheline')).toBe(true);
      expect(await texteDuMain(page)).toContain('Placement voulu');
      await geste(page, 'Annuler');
    });

    it('point 3 · « Modifier » renseigne le compte principal, qui dit alors son solde initial et sa date', async () => {
      await écran(page, 'Comptes');
      expect(await geste(page, 'Modifier', 'Compte principal')).toBe(true);
      expect(await remplir(page, 'Solde initial', '1 500,00')).toBe(true);
      await geste(page, 'Enregistrer');
      const ligne = await soldeInitialDuPrincipal(page);
      expect(ligne).toMatch(/solde initial 1\s?500,00\s?€ au /);
      expect(ligne).not.toMatch(/à renseigner|1970/);
    });
  });
});
