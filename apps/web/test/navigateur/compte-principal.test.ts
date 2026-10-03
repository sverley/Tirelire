/**
 * Harnais d'audit de #209 — « Le compte principal existe dans toute base, même vide », ce qui se
 * voit à l'écran. Troisième fichier du harnais, parce que les tests navigateur vivent à part
 * (`apps/web/test/navigateur/`, D83) ; `compte-principal.test.ts` dit ce que le harnais mesure.
 *
 * Sur le site construit, dans une base vide — l'utilisateur qui découvre l'application —, sans
 * rien supposer de la forme des écrans au-delà de ce qui existe : la barre d'onglets, les cartes de
 * l'écran Comptes et leur pastille de genre, le formulaire d'un compte et son choix de genre, les
 * boutons primaires de l'assistant.
 *
 * 1. À l'ouverture, le plan ne signale pas d'absence de compte principal, et l'écran Comptes montre
 *    un compte principal et un seul, sans aucun geste ; après « Tout effacer », de même.
 * 4. L'assistant parcouru jusqu'au plan, par ses seuls boutons primaires, n'ajoute aucun compte
 *    principal : l'écran Comptes en montre toujours un et un seul.
 * 5. L'écran Comptes ne propose pas de supprimer le compte principal, ni de lui donner un autre
 *    genre ; le formulaire d'un nouveau compte ne propose pas le genre principal.
 *
 * Niveaux (D83) : 1 — tous les usages passent par le compte principal (U1 à U5), et U1 demande
 * que l'assistant renseigne au lieu de créer. Les témoins rouges se jouent sans navigateur.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { exampleLedger } from '@tirelire/core';
import { allerÀ, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Ce que l'écran Comptes montre : chaque carte, sa pastille de genre, ses boutons. */
interface Carte {
  nom: string;
  genre: string;
  boutons: string[];
}

/** Ce qu'un formulaire de compte propose comme genres, s'il en propose. */
interface Formulaire {
  titre: string;
  genres: string[];
  choixActif: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Ce qu'on exige, et les témoins rouges qui le gardent
// ─────────────────────────────────────────────────────────────────────────────────────────────

function vérifierUnSeulPrincipal(cartes: Carte[], où: string): Carte {
  const principaux = cartes.filter((c) => c.genre === 'principal');
  expect(principaux.length, `${où} : ${principaux.length} carte(s) de compte principal, il en faut une et une seule (${cartes.map((c) => `${c.nom} [${c.genre}]`).join(', ') || 'aucune carte'})`).toBe(1);
  return principaux[0]!;
}

function vérifierPlanSansAbsence(texte: string, où: string): void {
  expect(/aucun compte principal/i.test(texte), `${où} : le plan signale une absence de compte principal`).toBe(false);
}

function vérifierPasDeSuppression(carte: Carte): void {
  expect(carte.boutons.some((b) => /supprimer|retirer/i.test(b)), `la carte du compte principal propose : ${carte.boutons.join(', ')}`).toBe(false);
}

function vérifierPasDAutreGenre(f: Formulaire): void {
  const autres = f.genres.filter((g) => g !== 'principal');
  expect(!f.choixActif || autres.length === 0, `${f.titre} : le compte principal peut passer à ${autres.join(', ')}`).toBe(true);
}

function vérifierPasDeSecondPrincipal(f: Formulaire): void {
  expect(f.genres.includes('principal'), `${f.titre} : un nouveau compte peut être principal`).toBe(false);
}

describe('[niveau 1] harnais du registre', () => {
  it.fails('témoin rouge · un écran Comptes sans compte principal', () => {
    vérifierUnSeulPrincipal([{ nom: 'Livret', genre: 'accueil', boutons: ['Modifier', 'Supprimer'] }], 'ouverture');
  });
  it.fails('témoin rouge · un assistant qui ajoute un second compte principal', () => {
    vérifierUnSeulPrincipal(
      [
        { nom: 'Compte principal', genre: 'principal', boutons: ['Modifier'] },
        { nom: 'Compte principal', genre: 'principal', boutons: ['Modifier'] },
      ],
      'après l’assistant',
    );
  });
  it.fails('témoin rouge · un plan qui signale l’absence du compte principal', () => {
    vérifierPlanSansAbsence('Plan Aucun compte principal défini. Virements à faire', 'ouverture');
  });
  it.fails('témoin rouge · une carte de compte principal qui se laisse supprimer', () => {
    vérifierPasDeSuppression({ nom: 'Compte principal', genre: 'principal', boutons: ['Modifier', 'Supprimer'] });
  });
  it.fails('témoin rouge · un compte principal qui peut changer de genre', () => {
    vérifierPasDAutreGenre({ titre: 'Modifier le compte', genres: ['principal', 'courant', 'epargne'], choixActif: true });
  });
  it.fails('témoin rouge · un nouveau compte qui peut être principal', () => {
    vérifierPasDeSecondPrincipal({ titre: 'Ajouter un compte', genres: ['principal', 'courant', 'epargne'], choixActif: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Lecture des écrans
// ─────────────────────────────────────────────────────────────────────────────────────────────

const texteDuMain = (page: Page) => page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' '));

/** Les cartes de l'écran Comptes. */
const lireLesCartes = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return [...document.querySelectorAll('main .card')]
      .filter((c) => c.querySelector('.pill'))
      .map((c) => ({
        nom: t(c.querySelector('strong')),
        genre: t(c.querySelector('.pill')),
        boutons: [...c.querySelectorAll('button')].map((b) => t(b)),
      }));
  });

/** Le formulaire ouvert : son titre, et les genres que propose son choix de genre, s'il en a un et qu'il est actif. */
const lireLeFormulaire = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const choix = ([...document.querySelectorAll('main select')] as HTMLSelectElement[]).find((s) => [...s.options].some((o) => o.value === 'principal' || /principal/i.test(o.text)));
    return {
      titre: t(document.querySelector('main h2, main h1')),
      genres: choix ? [...choix.options].map((o) => o.value) : [],
      choixActif: !!choix && !choix.disabled,
    };
  });

/** Clique un bouton par son libellé : un geste. */
async function geste(page: Page, libellé: string): Promise<boolean> {
  const fait = await page.evaluate((l: string) => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const b = ([...document.querySelectorAll('main button, .tabbar button')] as HTMLButtonElement[]).find((x) => t(x).includes(l));
    b?.click();
    return !!b;
  }, libellé);
  await pause(200);
  return fait;
}

/** Ouvre l'écran Comptes depuis n'importe où, et rend ses cartes. */
async function comptes(page: Page): Promise<Carte[]> {
  await allerÀ(page, 'Plus');
  await geste(page, 'Comptes');
  return lireLesCartes(page);
}

/** Le bouton de la carte du compte principal dont le libellé contient `libellé`. */
async function gesteSurLePrincipal(page: Page, libellé: string): Promise<boolean> {
  const fait = await page.evaluate((l: string) => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const carte = [...document.querySelectorAll('main .card')].find((c) => t(c.querySelector('.pill')) === 'principal');
    const b = carte && ([...carte.querySelectorAll('button')] as HTMLButtonElement[]).find((x) => t(x).includes(l));
    b?.click();
    return !!b;
  }, libellé);
  await pause(200);
  return fait;
}

/** L'assistant, de l'accueil au plan, par ses seuls boutons primaires (comme le chemin simple d'I4). */
async function traverserLAssistant(page: Page): Promise<boolean> {
  await allerÀ(page, 'Plan');
  if (!(await geste(page, 'Construire mon budget'))) return false;
  for (let i = 0; i < 12; i++) {
    const primaire = await page.evaluate(() => {
      const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
      if ([...document.querySelectorAll('main button')].some((b) => t(b) === 'Voir le plan')) return 'Voir le plan';
      const b = ([...document.querySelectorAll('main .actions button.primary')] as HTMLButtonElement[]).find((x) => /Suivant|Commencer|Valider/.test(t(x)));
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Dans le navigateur
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('[niveau 1] #209 · à l’écran', () => {
  describe.skipIf(!navigateur)('sur le site construit, dans une base vide', () => {
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

    it('1. à l’ouverture, le plan ne signale pas d’absence et l’écran Comptes montre un compte principal et un seul', async () => {
      await allerÀ(page, 'Plan');
      vérifierPlanSansAbsence(await texteDuMain(page), 'ouverture');
      vérifierUnSeulPrincipal(await comptes(page), 'ouverture');
    }, 60_000);

    it('5. l’écran Comptes ne propose ni de le supprimer, ni de changer son genre, ni d’en ajouter un second', async () => {
      const principal = vérifierUnSeulPrincipal(await comptes(page), 'écran Comptes');
      vérifierPasDeSuppression(principal);
      if (await gesteSurLePrincipal(page, 'Modifier')) vérifierPasDAutreGenre(await lireLeFormulaire(page));
      await comptes(page);
      expect(await geste(page, 'Ajouter un compte'), 'l’écran Comptes ne propose plus d’ajouter un compte').toBe(true);
      vérifierPasDeSecondPrincipal(await lireLeFormulaire(page));
    }, 60_000);

    it('4. l’assistant parcouru jusqu’au plan n’ajoute aucun compte principal : celui d’avant reste le seul', async () => {
      vérifierUnSeulPrincipal(await comptes(page), 'avant l’assistant');
      expect(await traverserLAssistant(page), 'l’assistant ne mène pas au plan par ses boutons primaires').toBe(true);
      vérifierPlanSansAbsence(await texteDuMain(page), 'après l’assistant');
      const après = vérifierUnSeulPrincipal(await comptes(page), 'après l’assistant');
      // L'assistant renseigne le compte principal avec ce que l'exemple en dit (#211) : le même compte, qui prend
      // le nom de l'exemple ; aucun second compte principal n'apparaît.
      const dansLExemple = exampleLedger().accounts.find((a) => a.kind === 'principal')!;
      expect(après.nom, 'l’assistant, parcouru sans rien saisir, ne renseigne pas le compte principal comme l’exemple le dit').toBe(dansLExemple.name);
    }, 120_000);

    it('1. après « Tout effacer », la base neuve a de nouveau son compte principal, et un seul', async () => {
      await allerÀ(page, 'Plus');
      await geste(page, 'Réglages');
      expect(await geste(page, 'Tout effacer'), 'le bouton « Tout effacer » est introuvable').toBe(true);
      await pause(800);
      vérifierUnSeulPrincipal(await comptes(page), 'après « Tout effacer »');
      await allerÀ(page, 'Plan');
      vérifierPlanSansAbsence(await texteDuMain(page), 'après « Tout effacer »');
    }, 60_000);
  });
});
