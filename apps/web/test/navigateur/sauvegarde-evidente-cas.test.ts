/**
 * Harnais d'audit de #41 — « Sans serveur, la sauvegarde doit être évidente », second fichier : les
 * niveaux 2 à 4, hors registre (D81). Le premier, `sauvegarde-evidente.test.ts`, dit ce que le
 * harnais mesure et comment ; ce fichier reprend la dernière phrase du « Fait quand » :
 * « Les textes vouvoient (D85). »
 *
 * Les textes que #41 ajoute ou touche : le rappel de l'accueil et la carte « Données » de Réglages,
 * lus comme dans le premier fichier (un enfant direct de `main` qui parle de sauvegarde ; l'élément
 * qui suit le titre « Données »), persistance accordée.
 *
 * Le tutoiement se repère à ses formes sûres, comme dans le harnais de #42 : les pronoms et
 * possessifs de la deuxième personne du singulier et l'impératif suivi d'un pronom (« Exporte-le »).
 * Un impératif sans pronom échappe au repérage : il reste à la relecture.
 *
 * Niveaux (D83) : 2 — D85 est une décision ; un texte qui tutoie la contredit, l'usage restant
 * possible.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

interface Texte {
  où: string;
  texte: string | null;
}

const TUTOIEMENT = [
  /(?<![\p{L}\p{N}])(tu|te|toi|ton|ta|tes|tien|tienne|tiens|tiennes)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])t['’](?=\p{L})/iu,
  /(?<![\p{L}\p{N}])\p{L}+e-(le|la|les|lui|leur|moi|en|y)(?![\p{L}\p{N}])/iu,
];

function vérifierVouvoiement(t: Texte): void {
  expect(t.texte, `${t.où} : texte introuvable`).not.toBeNull();
  const formes = TUTOIEMENT.map((m) => t.texte!.match(m)?.[0]).filter((f): f is string => !!f);
  expect(formes, `${t.où} : le texte tutoie (${formes.map((f) => `« ${f} »`).join(', ')}) : « ${t.texte} »`).toEqual([]);
}

describe('[niveau 2] C5 · #41 · les textes vouvoient (D85)', () => {
  it.fails('témoin rouge · un rappel qui tutoie', () => {
    vérifierVouvoiement({ où: 'accueil', texte: 'Tu n’as jamais sauvegardé tes données. Enregistre-les.' });
  });
  it.fails('témoin rouge · une carte « Données » qui tutoie', () => {
    vérifierVouvoiement({ où: 'Réglages', texte: 'Ta dernière sauvegarde : jamais' });
  });
});

/** Réponse du navigateur : persistance accordée, pour que le seul signal soit le rappel. */
async function accorder(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    const proto = (window as unknown as { StorageManager?: { prototype: Record<string, unknown> } }).StorageManager?.prototype;
    if (!proto) return;
    proto['persisted'] = () => Promise.resolve(true);
    proto['persist'] = () => Promise.resolve(true);
  });
}

/** Le texte du rappel : un enfant direct de `main` dont le texte parle de sauvegarde, ou `null`. */
const lireLeRappel = (page: Page) =>
  page.evaluate(() => {
    const b = [...(document.querySelector('main')?.children ?? [])].find((e) => /sauvegard/i.test(e.textContent ?? '') && e.getBoundingClientRect().height > 0 && !!e.querySelector('button'));
    return b ? (b as HTMLElement).innerText : null;
  });

const lireLaCarteDonnées = async (page: Page) => {
  await allerÀ(page, 'Plus');
  await cliquer(page, 'Réglages');
  await pause(300);
  return page.evaluate(() => {
    const titre = [...document.querySelectorAll('main h1, main h2, main h3')].find((h) => h.textContent?.trim() === 'Données');
    return (titre?.nextElementSibling as HTMLElement | null | undefined)?.innerText ?? null;
  });
};

describe('[niveau 2] C5 · #41 · les textes vouvoient (D85)', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    let site: Site;

    beforeAll(async () => {
      site = await ouvrirLeSite();
    }, 120_000);

    afterAll(async () => {
      await site?.fermer();
    });

    it('le rappel et la carte « Données » vouvoient', async () => {
      const page = await nouvellePage(site);
      try {
        await accorder(page);
        await page.goto(site.url, { waitUntil: 'networkidle0' });
        await pause(800);
        await cliquer(page, "Charger l'exemple");
        await pause(1_000);
        await page.reload({ waitUntil: 'networkidle0' });
        await pause(2_500);
        const rappel = await lireLeRappel(page);
        // L'absence du rappel relève du premier fichier (point 3) ; ici, seuls ses mots comptent.
        if (rappel !== null) vérifierVouvoiement({ où: 'accueil, rappel', texte: rappel });
        vérifierVouvoiement({ où: 'Réglages, carte « Données »', texte: await lireLaCarteDonnées(page) });
      } finally {
        await page.close();
      }
    }, 90_000);
  });
});
