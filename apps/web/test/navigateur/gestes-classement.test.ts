/**
 * Harnais d'I6 — « Catégoriser en peu de clics » (issue #71, chantier de #38).
 *
 * `VM-I6-gestes` seule faisait compter les gestes à la main : aucun nombre ne survivait d'une PR
 * à l'autre. Ce harnais mesure le compte dans le navigateur, sur le
 * jeu d'exemple, et le compare à la visée tranchée par le porteur le 13 septembre 2026 (#71).
 *
 * **Un geste** = une action de l'utilisateur : une frappe sur un bouton ou une ligne, un choix dans
 * une liste, une case cochée. Le compte part de l'écran Opérations, l'opération sous les yeux —
 * c'est le point de départ que le porteur a fixé.
 *
 * **Visée et seuil.** La visée est celle du porteur : 2 gestes pour catégoriser, 3 avec une
 * sous-catégorie, un geste de plus pour automatiser toutes les opérations semblables (3 et 4). Le
 * harnais mesure à la visée plus un geste de marge, accordée par le porteur : il fait donc échouer
 * à 4, 5, 5 et 6 gestes. La visée reste devant le produit ; le seuil interdit la hausse.
 *
 * **Indépendant de l'état de l'exemple.** Chaque mesure part d'une opération que le harnais remet
 * lui-même à zéro (bouton « Tout remettre à zéro »), pour mesurer un vrai classement et non une
 * correction. La sous-catégorie est créée par l'interface : l'exemple n'en porte aucune.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Page } from 'puppeteer-core';
import { allerÀ, navigateur, ouvrirLeSite, type Site } from '../harnais.js';

/** Visée du porteur (#71, 13 septembre 2026), en gestes, depuis l'écran Opérations. */
const VISÉE = {
  catégoriser: 2,
  'catégoriser avec une sous-catégorie': 3,
  'automatiser les semblables': 3,
  'automatiser les semblables avec une sous-catégorie': 4,
} as const;

/** La marge accordée au harnais par le porteur : il mesure à la visée plus un geste. */
const MARGE = 1;
const seuil = (visée: number) => visée + MARGE;

type Cas = keyof typeof VISÉE;

/** Ce qu'une mesure relève : le compte, le détail des gestes, et ce que le classement a produit. */
interface Mesure {
  cas: Cas;
  gestes: string[];
  classée: boolean;
  catégorie: string;
  automatismesAvant: number;
  automatismesAprès: number;
  automatismeAttendu: boolean;
}

// ---------------------------------------------------------------------------
// Ce qu'on exige d'une mesure, et le témoin rouge qui le garde
// ---------------------------------------------------------------------------

function vérifierUneMesure(m: Mesure) {
  const visée = VISÉE[m.cas];
  const où = `${m.cas} · ${m.gestes.length} geste(s) : ${m.gestes.join(' → ')}`;
  expect.soft(m.classée, `${où} : l'opération ne porte pas « ${m.catégorie} » après ces gestes`).toBe(true);
  expect
    .soft(m.gestes.length, `${où} : visée ${visée}, seuil ${seuil(visée)} (visée + ${MARGE} de marge)`)
    .toBeLessThanOrEqual(seuil(visée));
  if (m.automatismeAttendu) {
    expect
      .soft(m.automatismesAprès - m.automatismesAvant, `${où} : aucun automatisme créé pour les opérations semblables`)
      .toBe(1);
  }
}

/**
 * Témoin rouge : les mêmes assertions rejouées sur une mesure volontairement cassée — un classement
 * qui coûte un geste de plus que le seuil, et un automatisme qui ne s'enregistre pas. Il doit
 * échouer ; `it.fails` tient l'échec attendu (#66). Il se joue sans navigateur : c'est la règle
 * qu'on garde ici, pas une seconde visite de l'écran.
 */
it.fails('témoin rouge · un classement qui coûte un geste de plus que le seuil', () => {
  vérifierUneMesure({
    cas: 'automatiser les semblables',
    gestes: ['ouvrir la ligne', 'déplier la ventilation', 'choisir la catégorie', 'cocher un automatisme', 'Enregistrer'],
    classée: true,
    catégorie: 'Alimentation',
    automatismesAvant: 2,
    automatismesAprès: 2,
    automatismeAttendu: true,
  });
});

// ---------------------------------------------------------------------------
// Mesure dans le navigateur
// ---------------------------------------------------------------------------

const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));

/** Le filtre d'affichage de l'écran Opérations : mise en place, jamais comptée comme un geste. */
async function filtrer(page: Page, libellé: string) {
  for (let essai = 0; essai < 15; essai++) {
    const fait = await page.evaluate((l: string) => {
      const s = [...document.querySelectorAll('select')].find((x) =>
        [...x.options].some((o) => (o.textContent ?? '').trim() === 'Non traitées'),
      ) as HTMLSelectElement | undefined;
      const o = s && [...s.options].find((x) => (x.textContent ?? '').trim() === l);
      if (!s || !o) return false;
      s.value = o.value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, libellé);
    if (fait) {
      await pause(200);
      return;
    }
    await pause(200);
  }
  const vu = await page.evaluate(() => (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300));
  throw new Error(`filtre « ${libellé} » introuvable sur l'écran Opérations — écran vu : ${vu}`);
}

/**
 * Les opérations affichées, avec leur signe. Une ligne d'opération se reconnaît à sa case à cocher :
 * la carte « Recherche » porte elle aussi un bouton de libellé, et n'est pas une opération.
 */
const listées = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('main .card .row')]
      .filter((r) => r.querySelector(':scope > label.cocher'))
      .map((r) => ({
        libellé: (r.querySelector(':scope > button.label strong')?.textContent ?? '').trim(),
        dépense: !r.querySelector(':scope > .num.pos'),
      })),
  );

/** Ouvre la ligne d'une opération : c'est le premier geste de toute mesure. */
async function ouvrirLaLigne(page: Page, libellé: string) {
  const ouvert = await page.evaluate((l: string) => {
    const r = [...document.querySelectorAll('main .card .row')]
      .filter((x) => x.querySelector(':scope > label.cocher'))
      .find((x) => (x.querySelector(':scope > button.label strong')?.textContent ?? '').trim() === l);
    const b = r?.querySelector(':scope > button.label') as HTMLButtonElement | undefined;
    b?.click();
    return !!b;
  }, libellé);
  await pause(200);
  return ouvert;
}

/** Remet une opération à zéro : mise en place, pour mesurer un classement et non une correction. */
async function remettreÀZéro(page: Page, libellé: string) {
  await filtrer(page, 'Toutes');
  if (!(await ouvrirLaLigne(page, libellé))) throw new Error(`opération « ${libellé} » introuvable`);
  await page.evaluate(() => {
    const f = document.querySelector('form.edit');
    const bouton = (t: string) =>
      ([...(f?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]).find((x) => (x.textContent ?? '').trim() === t);
    (bouton('Tout remettre à zéro') ?? bouton('Fermer'))?.click();
  });
  await pause(250);
  await filtrer(page, 'Non traitées');
}

/** Combien d'automatismes le Bilan affiche : lu avant et après, pour voir celui qu'on vient de créer. */
async function automatismes(page: Page) {
  await allerÀ(page, 'Bilan');
  const n = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((x) => (x.textContent ?? '').trim() === 'Automatismes');
    let e = h?.nextElementSibling ?? null;
    while (e && !e.classList.contains('card')) e = e.nextElementSibling;
    return e ? e.querySelectorAll(':scope > .row').length : -1;
  });
  await allerÀ(page, 'Opérations');
  await pause(150);
  return n;
}

/** Les catégories que le panneau de ventilation propose, dans l'ordre de la liste. */
const catégoriesProposées = (page: Page) =>
  page.evaluate(() => {
    const f = document.querySelector('form.edit');
    const l = [...(f?.querySelectorAll('label') ?? [])].find((x) => (x.textContent ?? '').trim().startsWith('Catégorie'));
    const s = l?.querySelector('select') as HTMLSelectElement | null;
    return s ? [...s.options].map((o) => (o.textContent ?? '').trim()).filter((t) => t && t !== '—') : [];
  });

interface Consigne {
  cas: Cas;
  libellé: string;
  catégorie: string;
  automatiser: boolean;
}

/**
 * Le classement lui-même, geste par geste : chaque action réussie ajoute une ligne au compte. Un
 * geste qui ne trouve pas sa cible n'est pas compté — la mesure échouera alors sur « classée ».
 */
async function mesurer(page: Page, c: Consigne): Promise<Mesure> {
  const automatismesAvant = c.automatiser ? await automatismes(page) : 0;
  const gestes: string[] = [];

  if (await ouvrirLaLigne(page, c.libellé)) gestes.push(`ouvrir « ${c.libellé} »`);

  const choisie = await page.evaluate((nom: string) => {
    const f = document.querySelector('form.edit');
    const l = [...(f?.querySelectorAll('label') ?? [])].find((x) => (x.textContent ?? '').trim().startsWith('Catégorie'));
    const s = l?.querySelector('select') as HTMLSelectElement | null;
    const o = s && [...s.options].find((x) => (x.textContent ?? '').trim() === nom);
    if (!s || !o) return false;
    s.value = o.value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, c.catégorie);
  if (choisie) gestes.push(`choisir « ${c.catégorie} »`);
  await pause(150);

  if (c.automatiser) {
    const cochée = await page.evaluate(() => {
      const f = document.querySelector('form.edit');
      const l = [...(f?.querySelectorAll('label') ?? [])].find((x) => (x.textContent ?? '').includes('Créer un automatisme'));
      const i = l?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (!i) return false;
      i.click();
      return i.checked;
    });
    if (cochée) gestes.push('cocher « Créer un automatisme »');
    await pause(150);
  }

  const enregistré = await page.evaluate(() => {
    const f = document.querySelector('form.edit');
    const b = ([...(f?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]).find(
      (x) => (x.textContent ?? '').trim() === 'Enregistrer',
    );
    b?.click();
    return !!b;
  });
  if (enregistré) gestes.push('Enregistrer');
  await pause(400);

  await filtrer(page, 'Toutes');
  const classée = await page.evaluate(
    ({ l, cat }: { l: string; cat: string }) => {
      const r = [...document.querySelectorAll('main .card .row')]
        .filter((x) => x.querySelector(':scope > label.cocher'))
        .find((x) => (x.querySelector(':scope > button.label strong')?.textContent ?? '').trim() === l);
      return (r?.querySelector(':scope > button.label .sub')?.textContent ?? '').includes(cat);
    },
    { l: c.libellé, cat: c.catégorie },
  );
  await filtrer(page, 'Non traitées');

  return {
    cas: c.cas,
    gestes,
    classée,
    catégorie: c.catégorie,
    automatismesAvant,
    automatismesAprès: c.automatiser ? await automatismes(page) : 0,
    automatismeAttendu: c.automatiser,
  };
}

describe.skipIf(!navigateur)('I6 · catégoriser en peu de gestes (issue #71)', () => {
  let site: Site;
  let contexte: BrowserContext;
  let page: Page;
  const mesures = new Map<Cas, Mesure>();

  beforeAll(async () => {
    site = await ouvrirLeSite();
    contexte = await site.chrome.createBrowserContext();
    page = await contexte.newPage();
    page.on('dialog', (d) => void d.dismiss());
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.goto(site.url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.body.textContent?.includes('Ouverture de la base'));
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes("Charger l'exemple"));
      (b as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Tirelires'));

    // L'exemple ne porte aucune sous-catégorie : le harnais en crée une par l'interface.
    await allerÀ(page, 'Plus');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('main button')].find((x) => (x.textContent ?? '').startsWith('Catégories'));
      (b as HTMLButtonElement | undefined)?.click();
    });
    await pause(250);
    const sousCatégorie = await page.evaluate((nom: string) => {
      const b = [...document.querySelectorAll('main button')].find(
        (x) => (x.textContent ?? '').trim() === 'Ajouter une catégorie de dépenses',
      ) as HTMLButtonElement | undefined;
      if (!b) return '';
      b.click();
      return nom;
    }, 'Sous-poste de mesure');
    await pause(250);
    const créée = await page.evaluate((nom: string) => {
      const f = document.querySelector('form.edit');
      if (!f) return false;
      const champ = (début: string) =>
        [...f.querySelectorAll('label')].find((x) => (x.textContent ?? '').trim().startsWith(début));
      const nomChamp = champ('Nom')?.querySelector('input') as HTMLInputElement | null;
      if (!nomChamp) return false;
      nomChamp.value = nom;
      nomChamp.dispatchEvent(new Event('input', { bubbles: true }));
      const parent = champ('Catégorie parente')?.querySelector('select') as HTMLSelectElement | null;
      const premier = parent && [...parent.options].find((o) => o.value);
      if (!parent || !premier) return false;
      parent.value = premier.value;
      parent.dispatchEvent(new Event('change', { bubbles: true }));
      (f as HTMLFormElement).requestSubmit();
      return true;
    }, sousCatégorie);
    if (!créée) throw new Error('la sous-catégorie de mesure n’a pas pu être créée');
    await pause(400);

    await allerÀ(page, 'Opérations');
    await filtrer(page, 'Toutes');
    const dépenses = (await listées(page)).filter((o) => o.dépense).map((o) => o.libellé);
    await filtrer(page, 'Non traitées');
    if (dépenses.length < 3) throw new Error(`l'exemple ne contient que ${dépenses.length} dépense(s) : mesure impossible`);

    // Une catégorie principale de l'exemple, choisie dans la liste que le panneau propose lui-même.
    await remettreÀZéro(page, dépenses[0]!);
    await ouvrirLaLigne(page, dépenses[0]!);
    const proposées = await catégoriesProposées(page);
    const principale = proposées.find((c) => c !== sousCatégorie);
    if (!principale) throw new Error('aucune catégorie proposée par le panneau de ventilation');
    await page.evaluate(() => {
      const f = document.querySelector('form.edit');
      const b = ([...(f?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]).find(
        (x) => (x.textContent ?? '').trim() === 'Fermer',
      );
      b?.click();
    });
    await pause(200);

    const consignes: Consigne[] = [
      { cas: 'catégoriser', libellé: dépenses[0]!, catégorie: principale, automatiser: false },
      { cas: 'catégoriser avec une sous-catégorie', libellé: dépenses[1]!, catégorie: sousCatégorie, automatiser: false },
      { cas: 'automatiser les semblables', libellé: dépenses[2]!, catégorie: principale, automatiser: true },
      {
        cas: 'automatiser les semblables avec une sous-catégorie',
        libellé: dépenses[0]!,
        catégorie: sousCatégorie,
        automatiser: true,
      },
    ];
    for (const c of consignes) {
      await remettreÀZéro(page, c.libellé);
      mesures.set(c.cas, await mesurer(page, c));
    }
  }, 300_000);

  afterAll(async () => {
    await contexte?.close();
    await site?.fermer();
  });

  it('gestes de classement · catégoriser une opération, puis toutes les semblables', () => {
    for (const cas of Object.keys(VISÉE) as Cas[]) {
      const m = mesures.get(cas);
      expect(m, `le cas « ${cas} » n’a pas été mesuré`).toBeDefined();
      console.log(`[gestes] ${cas} : ${m!.gestes.length} (visée ${VISÉE[cas]}, seuil ${seuil(VISÉE[cas])}) — ${m!.gestes.join(' → ')}`);
      vérifierUneMesure(m!);
    }
  }, 60_000);
});
