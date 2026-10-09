/**
 * Harnais d'audit de #42 — « Les données du navigateur doivent être protégées de l'effacement »,
 * second fichier : les niveaux 2 à 4, hors registre (D81). Le premier, `stockage-persistant.test.ts`, dit ce
 * que le harnais mesure et comment ; ce fichier reprend la dernière phrase du « Fait quand » :
 * « Les textes vouvoient (D85). »
 *
 * Les textes que #42 ajoute ou touche : le signal de l'accueil, quand la persistance est refusée ou
 * impossible, et la carte « Données » de Réglages, sous les trois réponses — elle tutoie encore
 * aujourd'hui (« Exporte-le régulièrement : c'est ta sauvegarde »). La réponse du navigateur se règle
 * comme dans le premier fichier, par `navigator.storage.persist()` et `navigator.storage.persisted()`.
 *
 * Le tutoiement se repère à ses formes sûres : les pronoms et possessifs de la deuxième personne du
 * singulier (tu, te, t', toi, ton, ta, tes, tien…) et l'impératif suivi d'un pronom (« Exporte-le »,
 * « Garde-les »). Un impératif sans pronom (« pense à exporter ») échappe au repérage : il reste à la
 * relecture.
 *
 * Niveaux (D83) : 2 — D85 est une décision ; un texte qui tutoie la contredit, l'usage restant
 * possible. Un contrôle du repérage lui-même est de niveau 4.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, nouvellePage, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

type Réponse = 'accordée' | 'refusée' | 'impossible';

interface Texte {
  où: string;
  texte: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Ce qu'on exige, et les témoins rouges qui le gardent
// ─────────────────────────────────────────────────────────────────────────────────────────────

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

describe('[niveau 2] C4 · #42 · les textes vouvoient (D85)', () => {
  it.fails('témoin rouge · une carte « Données » qui tutoie', () => {
    vérifierVouvoiement({ où: 'Réglages, persistance refusée', texte: "Tout est stocké dans ce navigateur, dans un fichier SQLite. Exporte-le régulièrement : c'est ta sauvegarde." });
  });
  it.fails('témoin rouge · un signal qui tutoie', () => {
    vérifierVouvoiement({ où: 'accueil, persistance refusée', texte: 'Tes données peuvent être effacées par le navigateur.' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Mesures dans le navigateur
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Règle ce que le navigateur répondra, avant tout script de la page (comme le premier fichier). */
async function régler(page: Page, réponse: Réponse): Promise<void> {
  await page.evaluateOnNewDocument((r: string) => {
    const proto = (window as unknown as { StorageManager?: { prototype: Record<string, unknown> } }).StorageManager?.prototype;
    if (!proto) return;
    if (r === 'impossible') {
      delete proto['persist'];
      delete proto['persisted'];
      return;
    }
    let persistante = false;
    proto['persisted'] = () => Promise.resolve(persistante);
    proto['persist'] = () => {
      if (r !== 'refusée') persistante = true;
      return Promise.resolve(persistante);
    };
  }, réponse);
}

/** Le texte du signal : le plus petit élément visible, hors barre d'onglets, qui dit « effac… » et « navigateur ». */
const lireLeSignal = (page: Page) =>
  page.evaluate(() => {
    const t = (e: Element) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();
    const dit = (s: string) => /effac/i.test(s) && /navigateur/i.test(s);
    const candidats = [...document.body.querySelectorAll('*')].filter((e) => !e.closest('.tabbar, script, style, template') && dit(t(e)) && e.getBoundingClientRect().height > 0);
    const feuille = candidats.find((e) => ![...e.children].some((c) => dit(t(c))));
    if (!feuille) return null;
    // Le bloc du signal : on remonte tant qu'on reste sous `main`, l'en-tête ou le corps, jusqu'au
    // premier bloc qui porte une commande, pour lire aussi ses boutons.
    const bornes = new Set<Element | null>([document.body, document.documentElement, document.querySelector('main'), document.querySelector('header')]);
    for (let bloc: Element | null = feuille; bloc && !bornes.has(bloc); bloc = bloc.parentElement)
      if (bloc.querySelector('button, a[href], [role="button"]')) return t(bloc);
    return t(feuille);
  });

const lireLaCarteDonnées = async (page: Page) => {
  await allerÀ(page, 'Plus');
  await cliquer(page, 'Réglages');
  await pause(300);
  return page.evaluate(() => {
    const titre = [...document.querySelectorAll('main h1, main h2, main h3')].find((h) => h.textContent?.trim() === 'Données');
    const carte = titre?.nextElementSibling;
    return carte ? (carte.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
  });
};

describe('[niveau 2] C4 · #42 · les textes vouvoient (D85)', () => {
  describe.skipIf(!navigateur)('dans le navigateur', () => {
    let site: Site;

    beforeAll(async () => {
      site = await ouvrirLeSite();
    }, 120_000);

    afterAll(async () => {
      await site?.fermer();
    });

    for (const réponse of ['accordée', 'refusée', 'impossible'] as const) {
      it(`${réponse} : le signal et la carte « Données » vouvoient`, async () => {
        const page = await nouvellePage(site);
        try {
          await régler(page, réponse);
          await page.goto(site.url, { waitUntil: 'networkidle0' });
          await pause(2_500);
          if (réponse !== 'accordée') {
            const signal = await lireLeSignal(page);
            // L'absence du signal relève du premier fichier (point 3) ; ici, seuls ses mots comptent.
            if (signal !== null) vérifierVouvoiement({ où: `accueil, persistance ${réponse}`, texte: signal });
          }
          vérifierVouvoiement({ où: `Réglages, persistance ${réponse}`, texte: await lireLaCarteDonnées(page) });
        } finally {
          await page.close();
        }
      }, 60_000);
    }
  });
});
