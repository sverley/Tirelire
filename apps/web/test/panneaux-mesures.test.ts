/**
 * Garde géométrique des panneaux d'édition de la Configuration (issue #23, D59).
 *
 * `panneaux-edition.test.ts` fige la *structure* dont dépend la correction ; D59 annonçait que la
 * mesure dans un vrai navigateur « reste à écrire » dans `harnais.ts`. La voici. Elle vérifie, à
 * 375 px, les trois exigences de l'issue sur les cinq écrans (Comptes, Tirelires, Catégories,
 * Flux prévus, Saisie) :
 *
 * 1. **Visible sans le chercher** : après le clic, le titre et le premier champ du panneau tombent
 *    entre la barre du haut et la barre d'onglets, sans rien par-dessus ; le panneau suit ce qu'on
 *    vient de toucher ; rien ne déborde en largeur.
 * 2. **Dit sur quoi il porte** : le titre nomme l'action et l'élément touché (la tirelire pour un
 *    besoin), et ne suit pas la frappe dans le champ « Nom ».
 * 3. **Annuler ramène d'où l'on est parti** : le bouton pressé revient à sa place à l'écran.
 *
 * Chaque cas part du pire endroit réaliste : la ligne visée posée juste au-dessus de la barre
 * d'onglets avec de la liste en dessous (« bas d'écran »), ou la liste déroulée jusqu'en bas comme
 * dans le constat du 8 septembre (« bas de liste », « Ajouter un besoin » sur la dernière tirelire).
 *
 * Ce qu'elle ne mesure pas : le clavier logiciel réel, le défilement inertiel du doigt, les marges
 * du bord à bord Android. Cela reste à vérifier sur l'appareil.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from './harnais.js';

/** Écart toléré, en pixels CSS, entre la place du bouton avant l'ouverture et après Annuler. */
const TOLÉRANCE_RETOUR = 4;

type Position = 'bas-de-liste' | 'bas-d-écran' | 'tel-quel';

interface Cas {
  /** Libellé de l'entrée dans Configuration, et titre `h1` de l'écran. */
  écran: { menu: string; titre: string };
  /** Texte exact du bouton qui ouvre le panneau. */
  bouton: string;
  /** Sélecteur des conteneurs où chercher ce bouton (distingue « Modifier » d'un besoin et d'une tirelire). */
  portée: string;
  /** Rang du bouton parmi les candidats, ou le dernier. */
  rang: number | 'dernier';
  position: Position;
  /** Début attendu du titre du panneau. */
  verbe: string;
  /** D'où lire le nom que le titre doit contenir : la ligne du bouton, sa carte, ou rien (création). */
  nomDepuis: 'ligne' | 'carte' | 'aucun';
  /** Faux quand le panneau suit, à raison, une autre ligne que celle du bouton (la révision créée par D50). */
  adjacent?: false;
}

const TIRELIRES = { menu: 'Tirelires', titre: 'Tirelires' };
const COMPTES = { menu: 'Comptes', titre: 'Comptes' };
const CATÉGORIES = { menu: 'Catégories', titre: 'Catégories' };
const FLUX = { menu: 'Flux prévus', titre: 'Flux prévus' };
const SAISIE = { menu: 'Saisie manuelle', titre: 'Saisie' };

const CAS: Cas[] = [
  // Le constat de l'issue, à l'identique.
  { écran: TIRELIRES, bouton: 'Ajouter un besoin', portée: '.card > .actions', rang: 'dernier', position: 'bas-de-liste', verbe: 'Ajouter un besoin', nomDepuis: 'carte' },
  { écran: TIRELIRES, bouton: 'Ajouter un besoin', portée: '.card > .actions', rang: 2, position: 'bas-d-écran', verbe: 'Ajouter un besoin', nomDepuis: 'carte' },
  { écran: TIRELIRES, bouton: 'Modifier', portée: '.card > .row .actions', rang: 3, position: 'bas-d-écran', verbe: 'Modifier le besoin', nomDepuis: 'carte' },
  { écran: TIRELIRES, bouton: 'Réviser', portée: '.card > .row .actions', rang: 1, position: 'bas-d-écran', verbe: 'Réviser le besoin', nomDepuis: 'carte', adjacent: false },
  { écran: TIRELIRES, bouton: 'Modifier', portée: '.card > .actions', rang: 1, position: 'bas-d-écran', verbe: 'Modifier la tirelire', nomDepuis: 'carte' },
  { écran: TIRELIRES, bouton: 'Ajouter une tirelire', portée: 'main', rang: 0, position: 'tel-quel', verbe: 'Ajouter une tirelire', nomDepuis: 'aucun' },
  // « Modifier » sur le troisième compte : le second constat de l'issue.
  { écran: COMPTES, bouton: 'Modifier', portée: '.card > .row .actions', rang: 2, position: 'bas-d-écran', verbe: 'Modifier le compte', nomDepuis: 'carte' },
  { écran: COMPTES, bouton: 'Modifier', portée: '.card > .row .actions', rang: 'dernier', position: 'bas-de-liste', verbe: 'Modifier le compte', nomDepuis: 'carte' },
  { écran: COMPTES, bouton: 'Ajouter un compte', portée: 'main', rang: 0, position: 'tel-quel', verbe: 'Ajouter un compte', nomDepuis: 'aucun' },
  { écran: CATÉGORIES, bouton: 'Modifier', portée: '.card .row .actions', rang: 2, position: 'bas-d-écran', verbe: 'Modifier la catégorie', nomDepuis: 'ligne' },
  { écran: CATÉGORIES, bouton: 'Modifier', portée: '.card .row .actions', rang: 'dernier', position: 'bas-de-liste', verbe: 'Modifier la catégorie', nomDepuis: 'ligne' },
  { écran: CATÉGORIES, bouton: 'Ajouter une catégorie de revenus', portée: 'main .actions', rang: 0, position: 'bas-d-écran', verbe: 'Ajouter une catégorie de revenu', nomDepuis: 'aucun' },
  { écran: FLUX, bouton: 'Modifier', portée: '.card .row .actions', rang: 2, position: 'bas-d-écran', verbe: 'Modifier le flux', nomDepuis: 'ligne' },
  { écran: FLUX, bouton: 'Modifier', portée: '.card .row .actions', rang: 'dernier', position: 'bas-de-liste', verbe: 'Modifier le flux', nomDepuis: 'ligne' },
  { écran: FLUX, bouton: 'Ajouter un flux', portée: 'main', rang: 0, position: 'tel-quel', verbe: 'Ajouter un flux', nomDepuis: 'aucun' },
  { écran: SAISIE, bouton: 'Modifier', portée: '.card .row .actions', rang: 'dernier', position: 'bas-de-liste', verbe: "Modifier l'opération", nomDepuis: 'ligne' },
  { écran: SAISIE, bouton: 'Saisir une opération', portée: 'main', rang: 0, position: 'tel-quel', verbe: 'Saisir une opération', nomDepuis: 'aucun' },
];

// ---------------------------------------------------------------------------
// Mesures, exécutées dans la page
// ---------------------------------------------------------------------------

/** Marque le bouton visé (`data-cible`) et lit le nom de ce qu'il touche. */
function marquer(portée: string, texte: string, rang: number | 'dernier', nomDepuis: 'ligne' | 'carte' | 'aucun') {
  document.querySelectorAll('[data-cible]').forEach((e) => e.removeAttribute('data-cible'));
  const candidats = [...document.querySelectorAll(portée)]
    .flatMap((c) => [...c.querySelectorAll(':scope > button, :scope button')])
    .filter((b, i, tous) => tous.indexOf(b) === i)
    .filter((b) => !b.closest('form.edit') && (b.textContent ?? '').trim() === texte) as HTMLElement[];
  const cible = rang === 'dernier' ? candidats[candidats.length - 1] : candidats[rang];
  if (!cible) return { trouvés: candidats.length, nom: '' };
  cible.setAttribute('data-cible', '');
  const propre = (el: Element | null | undefined) => {
    if (!el) return '';
    const copie = el.cloneNode(true) as Element;
    copie.querySelectorAll('.sub, .pill').forEach((e) => e.remove());
    return (copie.textContent ?? '').trim().replace(/\s+/g, ' ');
  };
  let nom = '';
  if (nomDepuis === 'ligne') {
    const label = cible.closest('.row')?.querySelector(':scope > .label');
    nom = propre(label?.querySelector('strong') ?? label);
  } else if (nomDepuis === 'carte') {
    nom = propre(cible.closest('.card')?.querySelector(':scope > .row > .label strong'));
  }
  return { trouvés: candidats.length, nom };
}

function placer(position: Position) {
  const cible = document.querySelector('[data-cible]') as HTMLElement;
  if (position === 'bas-de-liste') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  // `scroll-padding-bottom` pose la ligne juste au-dessus de la barre d'onglets.
  if (position === 'bas-d-écran') cible.scrollIntoView({ block: 'end', behavior: 'instant' });
  const haut = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
  const bas = document.querySelector('.tabbar')?.getBoundingClientRect().top ?? window.innerHeight;
  const r = cible.getBoundingClientRect();
  return { scrollY: Math.round(window.scrollY), haut: r.top, visible: r.top >= haut - 0.5 && r.bottom <= bas + 0.5 };
}

/** Attend que la page cesse de défiler (l'action `revealed` défile en douceur). */
function calme() {
  return new Promise<void>((fin) => {
    let dernier = -1;
    let stables = 0;
    let tours = 0;
    const tic = () => {
      const y = window.scrollY;
      stables = y === dernier ? stables + 1 : 0;
      dernier = y;
      if (stables >= 12 || ++tours > 400) fin();
      else requestAnimationFrame(tic);
    };
    requestAnimationFrame(tic);
  });
}

function mesurerOuvert() {
  const haut = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
  const bas = document.querySelector('.tabbar')?.getBoundingClientRect().top ?? window.innerHeight;
  const panneaux = [...document.querySelectorAll('form.edit')];
  const f = panneaux[0] as HTMLElement | undefined;
  const cible = document.querySelector('[data-cible]');
  const titre = f?.querySelector('.titre-panneau') ?? null;
  const champ = f ? ([...f.querySelectorAll('input, select, textarea')].find((c) => c.getBoundingClientRect().height > 0) ?? null) : null;
  const dansLaZone = (el: Element | null) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= haut - 0.5 && r.bottom <= bas + 0.5;
  };
  const dégagé = (el: Element | null) => {
    if (!el || !f) return false;
    const r = el.getBoundingClientRect();
    const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!dessus && f.contains(dessus);
  };
  const r = f?.getBoundingClientRect();
  return {
    panneaux: panneaux.length,
    scrollY: Math.round(window.scrollY),
    panneauHaut: r ? Math.round(r.top) : null,
    titre: (titre?.textContent ?? '').trim(),
    titreDansLaZone: dansLaZone(titre),
    titreDégagé: dégagé(titre),
    champDansLaZone: dansLaZone(champ),
    // Le panneau suit immédiatement ce qu'on a touché : ligne, carte, ou barre du bouton.
    attaché: !!(f && cible && f.previousElementSibling?.contains(cible)),
    débordeLatéralement: document.documentElement.scrollWidth > document.documentElement.clientWidth || (r ? r.right > document.documentElement.clientWidth + 0.5 : false),
  };
}

/** Modifie le premier champ texte comme le ferait la frappe, sans déplacer la page. */
function taper() {
  const f = document.querySelector('form.edit');
  const champ = f?.querySelector('input:not([type]), input[type="text"]') as HTMLInputElement | null;
  if (!champ) return { tapé: false, titre: (f?.querySelector('.titre-panneau')?.textContent ?? '').trim() };
  champ.value = `${champ.value} zz`;
  champ.dispatchEvent(new Event('input', { bubbles: true }));
  return { tapé: true, titre: '' };
}

function lireTitre() {
  return (document.querySelector('form.edit .titre-panneau')?.textContent ?? '').trim();
}

/** Amène « Annuler » au plus court s'il est sous le pli, comme le ferait le doigt, et le marque. */
function préparerAnnuler() {
  const f = document.querySelector('form.edit');
  const annuler = [...(f?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'Annuler');
  if (!annuler) return { trouvé: false, scrollY: Math.round(window.scrollY), hautCible: null as number | null };
  annuler.setAttribute('data-annuler', '');
  annuler.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  const cible = document.querySelector('[data-cible]');
  return { trouvé: true, scrollY: Math.round(window.scrollY), hautCible: cible ? cible.getBoundingClientRect().top : null };
}

function mesurerFermé() {
  const haut = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
  const bas = document.querySelector('.tabbar')?.getBoundingClientRect().top ?? window.innerHeight;
  const cible = document.querySelector('[data-cible]');
  const r = cible?.getBoundingClientRect();
  return {
    panneaux: document.querySelectorAll('form.edit').length,
    scrollY: Math.round(window.scrollY),
    cibleEncoreLà: !!cible,
    haut: r ? r.top : null,
    visible: !!r && r.top >= haut - 0.5 && r.bottom <= bas + 0.5,
  };
}

// ---------------------------------------------------------------------------

describe.skipIf(!navigateur)('panneaux d’édition mesurés à 375 px (issue #23)', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);

  afterAll(async () => {
    await site?.fermer();
  });

  async function ouvrir(écran: Cas['écran']): Promise<Page> {
    const page = await ouvrirLExemple(site, 375, 812);
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, écran.menu), `l'écran ${écran.menu} est introuvable`).toBe(true);
    await page.waitForFunction((t) => document.querySelector('h1')?.textContent === t, {}, écran.titre);
    return page;
  }

  const nomDuCas = (c: Cas) =>
    `${c.écran.titre} · « ${c.bouton} » ${c.rang === 'dernier' ? 'dernier' : `n° ${c.rang + 1}`} · ${c.position}`;

  for (const cas of CAS) {
    it(nomDuCas(cas), async () => {
      const page = await ouvrir(cas.écran);
      try {
        const marque = await page.evaluate(marquer, cas.portée, cas.bouton, cas.rang, cas.nomDepuis);
        const rangMin = cas.rang === 'dernier' ? 1 : cas.rang + 1;
        expect(marque.trouvés, `pas assez de boutons « ${cas.bouton} » dans l'exemple`).toBeGreaterThanOrEqual(rangMin);
        if (cas.nomDepuis !== 'aucun') expect(marque.nom, 'nom de l’élément touché illisible').not.toBe('');

        const avant = await page.evaluate(placer, cas.position);
        expect(avant.visible, 'mise en place : le bouton visé doit être à l’écran avant le clic').toBe(true);

        const bouton = await page.$('[data-cible]');
        await bouton!.click();
        await new Promise((r) => setTimeout(r, 120));
        await page.evaluate(calme);
        const ouvert = await page.evaluate(mesurerOuvert);

        const frappe = await page.evaluate(taper);
        const titreAprèsFrappe = await page.evaluate(lireTitre);

        const annuler = await page.evaluate(préparerAnnuler);
        if (annuler.trouvé) {
          await (await page.$('[data-annuler]'))!.click();
          await new Promise((r) => setTimeout(r, 120));
          await page.evaluate(calme);
        }
        const fermé = await page.evaluate(mesurerFermé);
        const écart = fermé.haut === null ? null : Math.round(fermé.haut - avant.haut);
        // Décomposition : ce que l'ouverture a fait défiler (`revealed`), ce qu'il a fallu défiler pour
        // atteindre Annuler, et ce que la fermeture seule a déplacé (D59 : « rien au-dessus ne bouge »).
        const fermetureSeule = fermé.haut === null || annuler.hautCible === null ? null : Math.round(fermé.haut - annuler.hautCible);

        console.log(
          `[mesure] ${nomDuCas(cas)} | nom « ${marque.nom} » | titre « ${ouvert.titre} » | scrollY ${avant.scrollY} → ${ouvert.scrollY} → ${annuler.scrollY} → ${fermé.scrollY} | panneau à ${ouvert.panneauHaut} px | ouverture +${ouvert.scrollY - avant.scrollY} · accès à Annuler +${annuler.scrollY - ouvert.scrollY} · fermeture seule ${fermetureSeule} px | attaché ${ouvert.attaché ? 'oui' : 'non'} | bouton ${Math.round(avant.haut)} → ${fermé.haut === null ? '?' : Math.round(fermé.haut)} px (écart ${écart})`,
        );

        // 1. Visible sans le chercher.
        expect.soft(ouvert.panneaux, 'un et un seul panneau ouvert').toBe(1);
        expect.soft(ouvert.titreDansLaZone, `titre hors de la zone lisible (panneau à ${ouvert.panneauHaut} px)`).toBe(true);
        expect.soft(ouvert.titreDégagé, 'titre recouvert par une barre').toBe(true);
        expect.soft(ouvert.champDansLaZone, 'premier champ hors de la zone lisible').toBe(true);
        // Une création n'a pas de ligne à qui s'attacher (et la barre de filtre de D56 s'intercale) :
        // l'adjacence n'est exigée que pour une modification, où elle dit aussi sur quoi porte le panneau.
        if (cas.nomDepuis !== 'aucun' && cas.adjacent !== false) expect.soft(ouvert.attaché, 'le panneau ne suit pas la ligne touchée').toBe(true);
        expect.soft(ouvert.débordeLatéralement, 'débordement horizontal à 375 px').toBe(false);

        // 2. Dit sur quoi il porte, et ne suit pas la frappe.
        expect.soft(ouvert.titre.startsWith(cas.verbe), `titre « ${ouvert.titre} » : attendu « ${cas.verbe} … »`).toBe(true);
        if (cas.nomDepuis !== 'aucun') {
          expect.soft(ouvert.titre.includes(marque.nom), `titre « ${ouvert.titre} » : ne nomme pas « ${marque.nom} »`).toBe(true);
        }
        if (frappe.tapé) expect.soft(titreAprèsFrappe, 'le titre suit la frappe').toBe(ouvert.titre);

        // 3. Annuler ramène d'où l'on est parti.
        expect.soft(annuler.trouvé, 'pas de bouton Annuler').toBe(true);
        expect.soft(fermé.panneaux, 'Annuler n’a pas fermé le panneau').toBe(0);
        expect.soft(fermé.cibleEncoreLà, 'le bouton de départ a disparu').toBe(true);
        expect.soft(fermé.visible, `après Annuler, le bouton pressé n'est plus à l'écran (écart ${écart} px)`).toBe(true);
        expect.soft(Math.abs(écart ?? Infinity), `après Annuler, le bouton pressé a bougé de ${écart} px`).toBeLessThanOrEqual(TOLÉRANCE_RETOUR);
      } finally {
        await page.close();
      }
    }, 60_000);
  }
});
