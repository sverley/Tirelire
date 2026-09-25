/**
 * Harnais d'I5 — « Inciter à tout utiliser » (issue #71, #38).
 *
 * Le registre portait la dette : « l'inventaire des fonctions et de leur point d'entrée ». Le voici,
 * écrit une fois et vérifié à chaque exécution, sur une base vide — l'état où une fonction mal
 * amenée se paie le plus cher.
 *
 * Trois choses s'y vérifient :
 *
 * 1. **L'inventaire est complet.** Chaque écran que le shell sait afficher (le type `View` de
 *    `src/lib/state.svelte.ts`, lu ici comme une source de vérité) figure à l'inventaire. Ajouter un
 *    écran sans lui donner de point d'entrée fait échouer ce harnais, et non une relecture.
 * 2. **Chacun s'atteint depuis l'accueil, en deux gestes au plus**, par un point d'entrée qui le
 *    nomme — et, sous Configuration, qui dit en une phrase à quoi il sert. Une fonction qu'il faut
 *    connaître pour trouver ne tient pas I5.
 * 3. **Un écran vide dit ce qui le remplirait.** Sur une base vide, chaque écran porte son amorce :
 *    le bouton qui le remplit, ou la phrase qui nomme l'écran par où commencer.
 *
 * Ce que le harnais ne juge pas : l'attrait, qui ne se mesure pas ici, et la taille ou le contraste
 * des points d'entrée, déjà gardés par `ergonomie.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Page } from 'puppeteer-core';
import { allerÀ, navigateur, ouvrirLeSite, RACINE, type Site } from '../harnais.js';

/** Au plus deux gestes depuis l'accueil : un onglet, ou Configuration puis la fonction. */
const GESTES_MAX = 2;

/** Une fonction de l'application : son point d'entrée, ce qu'on doit y lire, ce qui l'amorce. */
interface Fonction {
  /** L'écran du shell, tel que le type `View` le nomme. */
  vue: string;
  nom: string;
  /** Par où on l'atteint : un onglet de la barre du bas, ou une entrée de Configuration. */
  par: 'onglet' | 'Configuration';
  /** Le libellé du point d'entrée, tel qu'on le lit à l'écran. */
  point: string;
  /** Ce que l'écran atteint doit dire de lui-même. */
  marque: string;
  /** Ce que l'écran doit offrir quand il est vide : l'action qui le remplit, ou l'écran par où commencer. */
  amorce: string;
}

const INVENTAIRE: Fonction[] = [
  { vue: 'plan', nom: 'Plan', par: 'onglet', point: 'Plan', marque: 'Bienvenue dans Tirelire', amorce: 'Construire mon budget' },
  { vue: 'operations', nom: 'Opérations', par: 'onglet', point: 'Opérations', marque: 'Opérations', amorce: 'importe un relevé' },
  { vue: 'import', nom: 'Import', par: 'onglet', point: 'Import', marque: "Import d'un relevé", amorce: 'compte principal' },
  { vue: 'review', nom: 'Bilan', par: 'onglet', point: 'Bilan', marque: 'Bilan', amorce: 'Importe des relevés ou saisis des opérations' },
  { vue: 'more', nom: 'Configuration', par: 'onglet', point: 'Plus', marque: 'Configuration', amorce: 'Construire mon budget' },
  { vue: 'wizard', nom: 'Construire mon budget', par: 'Configuration', point: 'Lancer', marque: 'Le problème que Tirelire résout', amorce: 'Commencer' },
  { vue: 'accounts', nom: 'Comptes', par: 'Configuration', point: 'Comptes', marque: 'Comptes', amorce: 'Ajouter un compte' },
  { vue: 'tirelires', nom: 'Tirelires', par: 'Configuration', point: 'Tirelires', marque: 'Tirelires', amorce: 'Ajouter une tirelire' },
  { vue: 'categories', nom: 'Catégories', par: 'Configuration', point: 'Catégories', marque: 'Catégories', amorce: 'Ajouter une catégorie de dépenses' },
  { vue: 'flows', nom: 'Flux prévus', par: 'Configuration', point: 'Flux prévus', marque: 'Flux prévus', amorce: 'Ajouter un flux' },
  { vue: 'entries', nom: 'Saisie manuelle', par: 'Configuration', point: 'Saisie manuelle', marque: 'Saisie', amorce: 'Saisir une opération' },
  { vue: 'sync', nom: 'Synchronisation', par: 'Configuration', point: 'Synchronisation', marque: 'Synchronisation', amorce: 'Proposer' },
  { vue: 'settings', nom: 'Réglages', par: 'Configuration', point: 'Réglages', marque: 'Réglages', amorce: 'Exporter le fichier SQLite' },
];

/** Ce qu'une visite relève, écran par écran. */
interface Visite {
  vue: string;
  nom: string;
  gestes: number;
  atteint: boolean;
  point: string;
  annonce: string;
  description: string;
  marqueLue: boolean;
  amorceLue: boolean;
  texte: string;
}

interface Relevé {
  vuesDuShell: string[];
  visites: Visite[];
}

/** Les écrans que le shell sait afficher, lus dans le type `View` : l'inventaire doit tous les couvrir. */
export function vuesDuShell(source: string): string[] {
  const m = source.match(/export type View\s*=\s*([^;]+);/);
  if (!m) throw new Error('le type View est introuvable dans src/lib/state.svelte.ts');
  return [...m[1]!.matchAll(/'([a-z]+)'/g)].map((x) => x[1]!);
}

// ---------------------------------------------------------------------------
// Ce qu'on exige de l'inventaire, et le témoin rouge qui le garde
// ---------------------------------------------------------------------------

function vérifierLInventaire(r: Relevé) {
  const inventoriées = new Set(INVENTAIRE.map((f) => f.vue));
  const horsInventaire = r.vuesDuShell.filter((v) => !inventoriées.has(v));
  expect.soft(horsInventaire, 'des écrans du shell ne figurent pas à l’inventaire des fonctions').toEqual([]);
  const inconnues = [...inventoriées].filter((v) => !r.vuesDuShell.includes(v));
  expect.soft(inconnues, 'l’inventaire cite des écrans que le shell n’affiche pas').toEqual([]);

  for (const v of r.visites) {
    const où = `${v.nom}`;
    expect.soft(v.atteint, `${où} : ne s’atteint pas depuis l’accueil par « ${v.point} »`).toBe(true);
    expect.soft(v.gestes, `${où} : ${v.gestes} gestes depuis l’accueil`).toBeLessThanOrEqual(GESTES_MAX);
    expect.soft(v.point, `${où} : son point d’entrée ne porte aucun libellé`).not.toBe('');
    expect.soft(v.marqueLue, `${où} : l’écran atteint ne s’annonce pas (${v.texte.slice(0, 120)})`).toBe(true);
    if (INVENTAIRE.find((f) => f.vue === v.vue)?.par === 'Configuration') {
      expect.soft(v.annonce.includes(v.nom), `${où} : son point d’entrée ne le nomme pas (« ${v.annonce} »)`).toBe(true);
      expect.soft(v.description, `${où} : son point d’entrée ne dit pas à quoi il sert`).not.toBe('');
    }
    expect.soft(v.amorceLue, `${où} : écran vide qui ne dit pas ce qui le remplirait (${v.texte.slice(0, 160)})`).toBe(true);
  }
}

/**
 * Témoin rouge : les mêmes assertions rejouées sur un inventaire volontairement cassé — un écran du
 * shell absent de l'inventaire, une fonction qu'il faut trois gestes pour atteindre, et un écran vide
 * muet. Il doit échouer ; `it.fails` tient l'échec attendu (#66). Il se joue sans navigateur : c'est
 * la règle qu'on garde ici, pas une seconde visite des écrans.
 */
describe('[niveau 1] harnais du registre', () => {
  it.fails('témoin rouge · une fonction sans point d entrée depuis l accueil', () => {
    vérifierLInventaire({
      vuesDuShell: [...INVENTAIRE.map((f) => f.vue), 'automatismes'],
      visites: [
        {
          vue: 'entries',
          nom: 'Saisie manuelle',
          gestes: 3,
          atteint: true,
          point: 'Saisie manuelle',
          annonce: 'Saisie manuelle',
          description: '',
          marqueLue: true,
          amorceLue: false,
          texte: 'Saisie Aucune opération saisie.',
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Visite dans le navigateur
// ---------------------------------------------------------------------------

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Ce que l'écran courant dit de lui-même. */
const lireLÉcran = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    return { h1: t(document.querySelector('main h1')), texte: t(document.querySelector('main')) };
  });

/**
 * Le point d'entrée, tel qu'il se présente avant qu'on le suive : son libellé, la ligne qui
 * l'annonce — c'est elle qui doit nommer la fonction — et la phrase qui dit à quoi elle sert.
 */
const lirePoint = (page: Page, libellé: string) =>
  page.evaluate((l: string) => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const boutons = [...document.querySelectorAll('main button')];
    const b =
      boutons.find((x) => t(x.querySelector('strong')) === l) ?? boutons.find((x) => t(x) === l) ?? boutons.find((x) => t(x).includes(l));
    if (!b) return { point: '', annonce: '', description: '' };
    const ligne = b.closest('.row') ?? b;
    return { point: t(b.querySelector('strong')) || t(b), annonce: t(ligne), description: t(ligne.querySelector('.sub')) };
  }, libellé);

/** Suit un point d'entrée par son libellé : un geste. */
async function suivre(page: Page, libellé: string) {
  const fait = await page.evaluate((l: string) => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const boutons = [...document.querySelectorAll('main button')] as HTMLButtonElement[];
    const b = boutons.find((x) => t(x.querySelector('strong')) === l) ?? boutons.find((x) => t(x) === l) ?? boutons.find((x) => t(x).includes(l));
    b?.click();
    return !!b;
  }, libellé);
  await pause(250);
  return fait;
}

async function visiter(page: Page, f: Fonction): Promise<Visite> {
  await allerÀ(page, 'Plan'); // retour à l'accueil : remise en place, jamais comptée
  let gestes = 0;
  let point = f.point;
  let annonce = '';
  let description = '';

  if (f.par === 'onglet') {
    await allerÀ(page, f.point);
    gestes = 1;
  } else {
    await allerÀ(page, 'Plus');
    gestes = 1;
    const lu = await lirePoint(page, f.point);
    point = lu.point || f.point;
    annonce = lu.annonce;
    description = lu.description;
    if (await suivre(page, f.point)) gestes += 1;
  }
  await pause(200);

  const écran = await lireLÉcran(page);
  return {
    vue: f.vue,
    nom: f.nom,
    gestes,
    atteint: écran.texte.includes(f.marque),
    point,
    annonce,
    description,
    marqueLue: écran.h1 === f.marque || écran.texte.includes(f.marque),
    amorceLue: écran.texte.includes(f.amorce),
    texte: écran.texte,
  };
}

describe('[niveau 1] harnais du registre', () => {
  describe.skipIf(!navigateur)('I5 · inventaire des fonctions et de leur point d’entrée (issue #71)', () => {
    let site: Site;
    let contexte: BrowserContext;
    let page: Page;
    let relevé: Relevé;

    beforeAll(async () => {
      site = await ouvrirLeSite();
      // Contexte isolé, base vide : c'est là qu'un écran mal amené ne dit rien.
      contexte = await site.chrome.createBrowserContext();
      page = await contexte.newPage();
      page.on('dialog', (d) => void d.dismiss());
      await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
      await page.goto(site.url, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));

      const visites: Visite[] = [];
      for (const f of INVENTAIRE) visites.push(await visiter(page, f));
      relevé = { vuesDuShell: vuesDuShell(readFileSync(resolve(RACINE, 'src/lib/state.svelte.ts'), 'utf8')), visites };
    }, 300_000);

    afterAll(async () => {
      await contexte?.close();
      await site?.fermer();
    });

    it('inventaire des fonctions · chacune atteinte, nommée, et amorcée à vide', () => {
      console.log(`[accès] ${relevé.visites.map((v) => `${v.nom} (${v.gestes})`).join(' · ')}`);
      vérifierLInventaire(relevé);
    }, 60_000);
  });
});
