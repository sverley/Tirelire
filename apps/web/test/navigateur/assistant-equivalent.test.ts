/**
 * Harnais d'I11 — « Les assistants font partie de la vie de l'application » (issue #72, carnet #38).
 * L'invariant : « Rien de réservé aux assistants. Ce qu'un assistant crée reste vivant
 * dans l'application, et ce qu'il fait se retrouve dans l'usage courant. » Jusqu'ici, seule une
 * vérification manuelle (`VM-I11-hors-assistant`) le tenait.
 *
 * Ce que ce harnais mesure : sur un projet vierge, l'assistant « Construire mon budget »
 * (`Wizard.svelte`) sème automatiquement des lignes nommées à chaque étape — comptes, revenus,
 * charges fixes, budgets courants, échéances, épargnes — à partir des raccourcis proposés (D43).
 * Pour chaque nom ainsi créé, le harnais retrouve son équivalent dans l'écran de configuration
 * ordinaire correspondant (Comptes, Flux prévus, Tirelires) et vérifie qu'un bouton « Modifier »
 * y ouvre un champ éditable portant ce même nom : ce que l'assistant a fait n'est pas un îlot,
 * on peut le reprendre à la main.
 *
 * Ce que le harnais ne juge pas : le contenu des raccourcis proposés (I4/#71 le fait déjà), ni
 * l'ergonomie du formulaire qui s'ouvre (position à l'écran, focus — #… autre défaut constaté,
 * hors du périmètre d'I11).
 *
 * Décidé le 13 septembre 2026 avec le porteur, pour I7 et non I11, mais noté ici par cohérence de
 * méthode : quand une question de portée se pose sur un harnais d'invariant, elle se tranche avec
 * le porteur et se consigne en commentaire de la PR plutôt que par une hypothèse silencieuse.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, ouvrirLeSite, type Site } from '../harnais.js';

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Étapes de l'assistant qui créent des lignes nommées, et l'écran où les retrouver ensuite. */
const ÉTAPES: Array<{ id: string; écran: string }> = [
  { id: 'accounts', écran: 'Comptes' },
  { id: 'income', écran: 'Flux prévus' },
  { id: 'fixed', écran: 'Flux prévus' },
  { id: 'everyday', écran: 'Tirelires' },
  { id: 'periodic', écran: 'Tirelires' },
  { id: 'savings', écran: 'Tirelires' },
];

interface Équivalence {
  nom: string;
  écran: string;
  trouvé: boolean;
  bouton: boolean;
  éditable: boolean;
}

// ---------------------------------------------------------------------------
// Ce qu'on exige de l'équivalence, et le témoin rouge qui le garde
// ---------------------------------------------------------------------------

function vérifierÉquivalence(rapport: Équivalence[]) {
  expect(rapport.length, "aucune ligne créée par l'assistant à vérifier : le parcours n'a rien semé").toBeGreaterThan(0);
  for (const r of rapport) {
    const où = `« ${r.nom} » (${r.écran})`;
    expect.soft(r.trouvé, `${où} : introuvable hors de l'assistant`).toBe(true);
    expect.soft(r.bouton, `${où} : aucun bouton « Modifier » à côté, hors assistant`).toBe(true);
    expect.soft(r.éditable, `${où} : « Modifier » n'ouvre pas de champ éditable portant ce nom`).toBe(true);
  }
}

/**
 * Témoin rouge : les mêmes assertions rejouées sur un rapport volontairement cassé — une tirelire
 * que l'assistant a créée mais qui n'existe nulle part ailleurs. Il doit échouer ; `it.fails` tient
 * l'échec attendu (#66). Il se joue sans navigateur : c'est la règle qu'on garde ici, pas une
 * seconde traversée.
 */
it.fails('témoin rouge · une ligne créée par l’assistant introuvable hors assistant', () => {
  vérifierÉquivalence([{ nom: 'Vacances', écran: 'Tirelires', trouvé: false, bouton: false, éditable: false }]);
});

// ---------------------------------------------------------------------------
// Traversée dans le navigateur
// ---------------------------------------------------------------------------

/** Les noms que l'étape en cours a semés, lus dans ses propres champs. */
async function nomsDeLÉtape(page: Page, étape: string): Promise<string[]> {
  return page.evaluate((étape: string) => {
    const val = (el: Element | null) => ((el as HTMLInputElement | null)?.value ?? '').trim();
    if (étape === 'accounts') {
      return [...document.querySelectorAll('.ligne-compte')].map((l) => val(l.querySelector('input'))).filter(Boolean);
    }
    return [...document.querySelectorAll('input.nom')].map((i) => val(i)).filter(Boolean);
  }, étape);
}

/** Parcourt l'assistant sur un projet vierge et relève, par écran, les noms qu'il a semés. */
async function traverser(page: Page): Promise<Map<string, Set<string>>> {
  const parÉcran = new Map<string, Set<string>>();
  const relever = (écran: string, noms: string[]) => {
    const ensemble = parÉcran.get(écran) ?? new Set<string>();
    for (const n of noms) ensemble.add(n);
    parÉcran.set(écran, ensemble);
  };

  await allerÀ(page, 'Plan');
  await cliquer(page, 'Construire mon budget');
  await pause(300);
  await cliquer(page, 'Commencer'); // intro → accounts
  await pause(250);

  for (const étape of ÉTAPES) {
    relever(étape.écran, await nomsDeLÉtape(page, étape.id));
    await cliquer(page, 'Suivant');
    await pause(250);
  }
  return parÉcran;
}

/**
 * Clique l'action attachée au nom (« Modifier », ou « Placer » pour une tirelire semée sans
 * placement, qui ouvre le même formulaire), et vérifie qu'un champ éditable le porte ensuite.
 */
async function vérifierUnÉquivalent(page: Page, nom: string, écran: string): Promise<Équivalence> {
  const clic = await page.evaluate((nom: string) => {
    // Le nom porté par un `.label` : dans son `<strong>` s'il en a un (Comptes, Flux, tirelire
    // placée, qui peut être suivi d'un `.pill`) ; sinon dans son texte de tête, avant tout enfant
    // (tirelire « Sans compte de placement »).
    const propre = (label: Element) => {
      const fort = label.querySelector(':scope > strong');
      if (fort) return (fort.textContent ?? '').trim();
      let texte = '';
      for (const n of label.childNodes) {
        if (n.nodeType !== Node.TEXT_NODE) break;
        texte += n.textContent ?? '';
      }
      return texte.trim();
    };
    const label = [...document.querySelectorAll('.label')].find((l) => propre(l) === nom);
    if (!label) return { trouvé: false, bouton: false };
    const boutonParmi = (bloc: Element | null, sélecteur: string) =>
      bloc
        ? ([...bloc.querySelectorAll(sélecteur)] as HTMLButtonElement[]).find((b) => ['Modifier', 'Placer'].includes(b.textContent?.trim() ?? ''))
        : undefined;
    // La ligne porte son propre bouton (Comptes, Flux, tirelire non placée) ; sinon c'est la
    // carte qui le porte, après d'éventuelles lignes de besoin imbriquées (Tirelires placées).
    const bouton =
      boutonParmi(label.closest('.row'), ':scope > button, :scope > .actions button') ??
      boutonParmi(label.closest('.card'), ':scope > .actions button');
    if (!bouton) return { trouvé: true, bouton: false };
    bouton.click();
    return { trouvé: true, bouton: true };
  }, nom);
  if (!clic.bouton) return { nom, écran, trouvé: clic.trouvé, bouton: false, éditable: false };

  await pause(200);
  const éditable = await page.evaluate(
    (nom: string) => [...document.querySelectorAll('input')].some((i) => i.value === nom && !i.disabled && i.offsetParent !== null),
    nom,
  );
  return { nom, écran, trouvé: true, bouton: true, éditable };
}

describe.skipIf(!navigateur)('I11 · ce que l’assistant crée se retrouve hors de l’assistant (issue #72)', () => {
  let site: Site;
  let contexte: BrowserContext;
  let page: Page;
  let rapport: Équivalence[];

  beforeAll(async () => {
    site = await ouvrirLeSite();
    // Contexte isolé, base vide : c'est le seul état où l'assistant sème ses raccourcis (D43).
    contexte = await site.chrome.createBrowserContext();
    page = await contexte.newPage();
    page.on('dialog', (d) => void d.dismiss());
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.goto(site.url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));

    const parÉcran = await traverser(page);
    rapport = [];
    for (const [écran, noms] of parÉcran) {
      await allerÀ(page, 'Plus');
      await cliquer(page, écran);
      await pause(200);
      for (const nom of noms) rapport.push(await vérifierUnÉquivalent(page, nom, écran));
    }
  }, 300_000);

  afterAll(async () => {
    await contexte?.close();
    await site?.fermer();
  });

  it('chaque ligne semée par l’assistant a son bouton « Modifier » et son champ éditable, hors assistant', () => {
    console.log(`[I11] ${rapport.length} lignes vérifiées : ${rapport.map((r) => `${r.nom} (${r.écran})`).join(', ')}`);
    vérifierÉquivalence(rapport);
  }, 60_000);
});
