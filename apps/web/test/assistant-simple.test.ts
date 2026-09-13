/**
 * Harnais d'I4 — « Simple par défaut, souple sur demande » (issue #71, chantier de #38).
 *
 * Le registre portait la dette : « l'assistant mène jusqu'au plan sans ouvrir de réglage avancé ».
 * C'est ce que ce harnais mesure, sur une base vide, dans le navigateur.
 *
 * **Le chemin simple.** Depuis l'accueil, l'assistant s'atteint en au plus deux gestes, puis chaque
 * étape se franchit par son seul bouton primaire — aucun champ rempli, aucune liste dépliée, aucun
 * détour par la Configuration. À l'arrivée, le Plan de la période en cours montre un budget : des
 * tirelires dotées et un total réservé non nul. Un utilisateur qui ne sait rien doit pouvoir
 * traverser ainsi.
 *
 * **Ce que le harnais ne juge pas.** La qualité des valeurs que l'assistant propose, ni le nombre de
 * réglages avancés qui existent ailleurs : I4 n'interdit pas le souple, il interdit qu'il barre le
 * chemin simple. Le harnais relève donc le parcours et vérifie que rien n'y a été exigé.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Page } from 'puppeteer-core';
import { allerÀ, navigateur, ouvrirLeSite, type Site } from './harnais.js';

/** Ce que le chemin simple s'autorise, de l'accueil au plan, en gestes. */
const BUDGET_DE_GESTES = 12;
/** Au plus deux gestes pour ouvrir l'assistant depuis l'accueil : un raccourci, ou Configuration. */
const GESTES_POUR_OUVRIR = 2;

/** Une étape traversée : ce qu'elle annonçait, et ce qu'elle a exigé. */
interface Étape {
  titre: string;
  primaire: string;
  franchie: boolean;
  resteDansLAssistant: boolean;
  erreur: string;
}

/** Le relevé complet d'un parcours simple, de l'accueil au plan. */
interface Parcours {
  routes: Array<{ depuis: string; gestes: number; ouvre: boolean }>;
  étapes: Étape[];
  gestes: number;
  résumé: boolean;
  planAtteint: boolean;
  tirelinesDotées: number;
  réservé: string;
  réservéNonNul: boolean;
}

/** Les étapes que l'assistant annonce lui-même : le parcours doit toutes les traverser. */
const ÉTAPES_ANNONCÉES = 7;

// ---------------------------------------------------------------------------
// Ce qu'on exige du chemin simple, et le témoin rouge qui le garde
// ---------------------------------------------------------------------------

function vérifierLeParcours(p: Parcours) {
  for (const r of p.routes) {
    expect.soft(r.ouvre, `depuis ${r.depuis} : ce chemin n’ouvre pas l’assistant`).toBe(true);
    expect.soft(r.gestes, `depuis ${r.depuis} : ${r.gestes} gestes pour ouvrir l’assistant`).toBeLessThanOrEqual(GESTES_POUR_OUVRIR);
  }
  expect.soft(p.étapes.length, 'toutes les étapes annoncées ne sont pas traversées').toBeGreaterThanOrEqual(ÉTAPES_ANNONCÉES);
  for (const é of p.étapes) {
    const où = `étape « ${é.titre} »`;
    expect.soft(é.primaire, `${où} : aucun bouton primaire pour continuer`).not.toBe('');
    expect.soft(é.franchie, `${où} : le bouton primaire ne fait pas avancer, un réglage est exigé`).toBe(true);
    expect.soft(é.resteDansLAssistant, `${où} : il faut quitter l’assistant pour continuer`).toBe(true);
    expect.soft(é.erreur, `${où} : l’étape refuse ses valeurs par défaut`).toBe('');
  }
  expect.soft(p.résumé, 'le parcours n’atteint pas le résumé du budget').toBe(true);
  expect.soft(p.planAtteint, 'le résumé ne mène pas au Plan').toBe(true);
  expect.soft(p.tirelinesDotées, 'le Plan ne dote aucune tirelire après le parcours simple').toBeGreaterThanOrEqual(1);
  expect.soft(p.réservéNonNul, `le Plan ne réserve rien après le parcours simple (${p.réservé})`).toBe(true);
  expect.soft(p.gestes, `${p.gestes} gestes de l’accueil au plan`).toBeLessThanOrEqual(BUDGET_DE_GESTES);
}

/**
 * Témoin rouge : les mêmes assertions rejouées sur un parcours volontairement cassé — une étape qui
 * n'avance pas sans réglage, et un plan vide à l'arrivée. Il doit échouer ; `it.fails` tient l'échec
 * attendu (#66). Il se joue sans navigateur : c'est la règle qu'on garde ici, pas une seconde
 * traversée.
 */
it.fails('témoin rouge · un parcours simple qui exige un réglage pour avancer', () => {
  vérifierLeParcours({
    routes: [{ depuis: 'accueil', gestes: 1, ouvre: true }],
    étapes: [
      { titre: 'Le principe', primaire: 'Commencer ›', franchie: true, resteDansLAssistant: true, erreur: '' },
      { titre: 'Comptes', primaire: 'Suivant ›', franchie: false, resteDansLAssistant: true, erreur: 'Crée d’abord un compte principal.' },
    ],
    gestes: 3,
    résumé: false,
    planAtteint: false,
    tirelinesDotées: 0,
    réservé: '0,00 €',
    réservéNonNul: false,
  });
});

// ---------------------------------------------------------------------------
// Traversée dans le navigateur
// ---------------------------------------------------------------------------

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Ce que l'écran montre : son titre d'assistant, son étape, son bouton primaire, son erreur. */
const lireLÉcran = (page: Page) =>
  page.evaluate(() => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const primaire = ([...document.querySelectorAll('main .actions button.primary')] as HTMLButtonElement[]).find(
      (b) => /Suivant|Commencer/.test(t(b)),
    );
    return {
      h1: t(document.querySelector('main h1')),
      h2: t(document.querySelector('main h2')),
      primaire: t(primaire),
      erreur: t(document.querySelector('main .err')),
      résumé: [...document.querySelectorAll('main button')].some((b) => t(b) === 'Voir le plan'),
    };
  });

/** Clique un bouton par son libellé exact : un geste, et un seul. */
async function geste(page: Page, libellé: string) {
  const fait = await page.evaluate((l: string) => {
    const t = (e?: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ');
    const b = ([...document.querySelectorAll('main button, .tabbar button')] as HTMLButtonElement[]).find((x) => t(x).includes(l));
    b?.click();
    return !!b;
  }, libellé);
  await pause(200);
  return fait;
}

async function traverser(page: Page): Promise<Parcours> {
  const routes: Parcours['routes'] = [];

  // Route par la Configuration, éprouvée d'abord : elle n'entame rien, l'assistant s'ouvre sur
  // « Le principe » et le projet reste vierge tant qu'aucune étape n'est franchie.
  await allerÀ(page, 'Plus');
  const parConfiguration = await geste(page, 'Lancer');
  routes.push({ depuis: 'Configuration', gestes: 2, ouvre: parConfiguration && (await lireLÉcran(page)).h1 === 'Construire mon budget' });

  // Route depuis l'accueil, celle que le parcours emprunte ensuite.
  await allerÀ(page, 'Plan');
  const parLAccueil = await geste(page, 'Construire mon budget');
  const écran = await lireLÉcran(page);
  routes.push({ depuis: 'accueil', gestes: 1, ouvre: parLAccueil && écran.h1 === 'Construire mon budget' });

  let gestes = 1;
  const étapes: Étape[] = [];
  for (let i = 0; i < ÉTAPES_ANNONCÉES + 3; i++) {
    const avant = await lireLÉcran(page);
    if (avant.résumé) break;
    const franchi = avant.primaire ? await geste(page, avant.primaire) : false;
    if (franchi) gestes += 1;
    const après = await lireLÉcran(page);
    étapes.push({
      titre: avant.h2 || avant.h1,
      primaire: avant.primaire,
      franchie: franchi && (après.h2 !== avant.h2 || après.résumé),
      resteDansLAssistant: après.h1 === 'Construire mon budget',
      erreur: après.erreur,
    });
    if (!franchi) break;
  }

  const fin = await lireLÉcran(page);
  const planAtteint = fin.résumé ? await geste(page, 'Voir le plan') : false;
  if (planAtteint) gestes += 1;
  await pause(400);

  const plan = await page.evaluate(() => {
    const texte = (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ');
    const réservé = texte.match(/([\d  \u202f.,]+€)\s*Réservé et viré/);
    return { texte, réservé: réservé?.[1]?.trim() ?? '', dotées: (texte.match(/croisière/g) ?? []).length };
  });

  return {
    routes,
    étapes,
    gestes,
    résumé: fin.résumé,
    planAtteint,
    tirelinesDotées: plan.dotées,
    réservé: plan.réservé,
    réservéNonNul: !!plan.réservé && !/^0[.,]00/.test(plan.réservé.replace(/[\s\u202f]/g, '')),
  };
}

describe.skipIf(!navigateur)('I4 · le chemin simple mène au plan (issue #71)', () => {
  let site: Site;
  let contexte: BrowserContext;
  let page: Page;
  let parcours: Parcours;

  beforeAll(async () => {
    site = await ouvrirLeSite();
    // Contexte isolé, base vide : l'utilisateur qui découvre l'application.
    contexte = await site.chrome.createBrowserContext();
    page = await contexte.newPage();
    page.on('dialog', (d) => void d.dismiss());
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.goto(site.url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
    parcours = await traverser(page);
  }, 300_000);

  afterAll(async () => {
    await contexte?.close();
    await site?.fermer();
  });

  it('parcours simple · de la base vide au plan, sans un seul réglage avancé', () => {
    console.log(
      `[simple] ${parcours.gestes} gestes, ${parcours.étapes.length} étapes — ${parcours.étapes.map((e) => e.titre).join(' → ')} → plan (${parcours.tirelinesDotées} tirelires, réservé ${parcours.réservé})`,
    );
    vérifierLeParcours(parcours);
  }, 60_000);
});
