/**
 * Garde du second défaut de l'issue #23 : un panneau d'édition de la Configuration dit sur quoi il
 * porte (#21, D59). Le premier défaut — panneau hors écran, retour après Annuler — relève de #1 et
 * #2 et n'est pas gardé ici.
 *
 * **Indépendant des données.** Le harnais ne charge pas l'exemple. Il part d'une base vide, dans un
 * contexte de navigateur isolé, et crée par l'interface ce dont il a besoin : comptes, tirelires
 * placées ou non, besoins avec et sans nom, catégorie et sous-catégorie, flux, saisies. Les noms sont
 * tirés au hasard, dont un long et insécable par écran ; aucun ne contient un autre.
 *
 * **Indépendant de la formulation des titres.** Les vérifications sont relatives : le titre nomme
 * l'élément touché, et lui seul (plus sa tirelire, pour un besoin) ; deux actions sur le même
 * élément donnent deux titres différents ; passer d'un élément à l'autre renomme le panneau ; deux
 * panneaux ouverts ensemble nomment chacun le leur ; une catégorie basculée d'une nature à l'autre
 * s'annonce comme celle qu'on aurait ouverte d'emblée ; une révision ne s'annonce pas comme une
 * modification. Aucun libellé de titre n'est écrit ici ; la mise en place, elle, s'appuie sur les
 * libellés des boutons et des champs.
 *
 * Pour chaque panneau s'ajoutent : titre lisible à l'ouverture, qui ne suit pas la frappe, d'au
 * moins 12 px et 4,5:1 de contraste, sans débordement à 375 px. Une garde de couverture échoue si
 * un élément créé n'a pas vu son panneau ouvert : le harnais ne peut pas passer à vide.
 *
 * Animations coupées (`prefers-reduced-motion`) : c'est le texte qu'on lit, pas le défilement.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, ouvrirLeSite, type Site } from './harnais.js';

const TEXTE_MIN = 12;
const CONTRASTE_MIN = 4.5;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const jeton = (n: number) => Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const court = (préfixe: string) => `${préfixe} ${jeton(8)}`;
/** Nom long et insécable, comme un libellé de relevé bancaire. */
const insécable = (préfixe: string) => `${préfixe}${jeton(45)}`;

const NOMS = {
  compteA: court('Cpt'),
  compteB: court('Cpt'),
  compteLong: insécable('CPT'),
  tirelireA: court('Tir'),
  tirelireB: court('Tir'),
  tirelireSansPlacement: insécable('TIR'),
  besoinNommé: court('Bes'),
  catégorie: court('Cat'),
  sousCatégorie: court('Sca'),
  catégorieLongue: insécable('CAT'),
  flux: court('Flx'),
  fluxLong: insécable('FLX'),
  opération: court('Ope'),
  opérationLongue: insécable('OPE'),
};
type Noms = typeof NOMS;
const TOUS = Object.values(NOMS);

type Conteneur = 'ligne' | 'carte' | 'libre';
interface Couverture {
  requis: string[];
  conteneur?: Conteneur;
  min?: number;
}

const COMPTES = { menu: 'Comptes', titre: 'Comptes' };
const TIRELIRES = { menu: 'Tirelires', titre: 'Tirelires' };
const CATÉGORIES = { menu: 'Catégories', titre: 'Catégories' };
const FLUX = { menu: 'Flux prévus', titre: 'Flux prévus' };
const SAISIE = { menu: 'Saisie manuelle', titre: 'Saisie' };

/** Les panneaux que chaque écran doit avoir ouverts, sur les éléments que le harnais a créés. */
const ÉCRANS: Array<{ menu: string; titre: string; couverture: Couverture[] }> = [
  { ...COMPTES, couverture: [{ requis: [NOMS.compteA] }, { requis: [NOMS.compteB] }, { requis: [NOMS.compteLong] }, { requis: [] }] },
  {
    ...TIRELIRES,
    couverture: [
      // La tirelire elle-même, et l'ajout d'un besoin sur elle.
      { requis: [NOMS.tirelireA], conteneur: 'carte', min: 2 },
      // Son besoin sans nom, puis son besoin nommé.
      { requis: [NOMS.tirelireA], conteneur: 'ligne' },
      { requis: [NOMS.tirelireA, NOMS.besoinNommé], conteneur: 'ligne' },
      { requis: [NOMS.tirelireB], conteneur: 'carte', min: 2 },
      // Une tirelire sans placement ne s'ouvre que depuis sa ligne.
      { requis: [NOMS.tirelireSansPlacement], conteneur: 'ligne' },
      { requis: [] },
    ],
  },
  { ...CATÉGORIES, couverture: [{ requis: [NOMS.catégorie] }, { requis: [NOMS.sousCatégorie] }, { requis: [NOMS.catégorieLongue] }, { requis: [], min: 2 }] },
  { ...FLUX, couverture: [{ requis: [NOMS.flux] }, { requis: [NOMS.fluxLong] }, { requis: [] }] },
  { ...SAISIE, couverture: [{ requis: [NOMS.opération] }, { requis: [NOMS.opérationLongue] }, { requis: [] }] },
];

interface Lecture {
  titre: string;
  lisible: boolean;
  /** Où tombe le titre, pour qu'un échec de lisibilité se comprenne sans rejouer. */
  position: string;
  déborde: boolean;
  taille: number;
  contraste: number;
}

interface Ouverture extends Lecture {
  libellé: string;
  conteneur: Conteneur;
  requis: string[];
  panneaux: number;
  figé: boolean;
  fermé: boolean;
  ajouteDébordement: boolean;
}

interface Outillage {
  texte(el?: Element | null): string;
  propre(el?: Element | null): string;
  attendre(): Promise<void>;
  panneaux(): HTMLFormElement[];
  lire(f: Element): Lecture;
  ouvreursPossibles(): HTMLButtonElement[];
  attendus(b: Element, noms: string[]): { requis: string[]; conteneur: Conteneur };
  carte(nom: string): Element | undefined;
  bouton(racine: ParentNode, libellé: string): HTMLButtonElement;
  remplir(f: Element, étiquette: string, valeur: string): Promise<void>;
  soumettre(f: HTMLFormElement): Promise<void>;
  annuler(): Promise<void>;
  toutOuvrir(noms: string[]): Promise<{ erreur?: string; ouvertures: Ouverture[] }>;
}

/** Installe dans la page les lectures et gestes communs, une fois pour toute la session. */
function installer() {
  const texte = (el?: Element | null) => (el?.textContent ?? '').trim().replace(/\s+/g, ' ');
  const propre = (el?: Element | null) => {
    if (!el) return '';
    const copie = el.cloneNode(true) as Element;
    copie.querySelectorAll('.sub, .pill').forEach((e) => e.remove());
    return texte(copie);
  };
  const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
  const attendre = async () => {
    await pause(30);
    await new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin)));
  };
  const panneaux = () => [...document.querySelectorAll('form.edit')] as HTMLFormElement[];
  /** Ce que le panneau annonce : sa ligne de titre, ou à défaut un intitulé ; rien sinon. */
  const titreDe = (f: Element) => f.querySelector('.titre-panneau, h1, h2, h3, h4, legend');

  const rgb = (c: string): [number, number, number, number] => {
    const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
    return [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 1];
  };
  const luminance = ([r, v, b]: [number, number, number, number]) => {
    const canal = (x: number) => {
      const c = x / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * canal(r) + 0.7152 * canal(v) + 0.0722 * canal(b);
  };
  const fond = (el: Element): [number, number, number, number] => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c[3] > 0.05) return c;
    }
    return [255, 255, 255, 1];
  };

  const lire = (f: Element): Lecture => {
    const titre = titreDe(f);
    const haut = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    const bas = document.querySelector('.tabbar')?.getBoundingClientRect().top ?? window.innerHeight;
    const r = titre?.getBoundingClientRect();
    const dessus = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    // Bord droit de l'encre du titre, et non de sa boîte : c'est le texte insécable qui déborde.
    let encre = 0;
    if (titre) {
      const plage = document.createRange();
      plage.selectNodeContents(titre);
      encre = Math.max(0, ...[...plage.getClientRects()].map((x) => x.right));
    }
    const s = getComputedStyle(f);
    const bordDroit = f.getBoundingClientRect().right - parseFloat(s.paddingRight) - parseFloat(s.borderRightWidth);
    const st = titre ? getComputedStyle(titre) : null;
    const a = st ? luminance(rgb(st.color)) : 0;
    const b = titre ? luminance(fond(titre)) : 0;
    const quoi = (el: Element | null) => (el ? `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}` : 'rien');
    return {
      position: r ? `titre ${Math.round(r.top)}→${Math.round(r.bottom)} px, zone lisible ${Math.round(haut)}→${Math.round(bas)} px, dessus : ${quoi(dessus)}, scrollY ${Math.round(window.scrollY)}/${document.documentElement.scrollHeight - window.innerHeight}` : 'pas de titre',
      titre: texte(titre),
      lisible: !!r && r.height > 0 && r.top >= haut - 0.5 && r.bottom <= bas + 0.5 && !!dessus && f.contains(dessus),
      déborde: encre > bordDroit + 0.5,
      taille: st ? parseFloat(st.fontSize) : 0,
      contraste: titre ? (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) : 0,
    };
  };

  /** Tout bouton hors panneau, ni destructif, ni filtre, ni « Réviser » (qui écrit une révision). */
  const ouvreursPossibles = () =>
    ([...document.querySelectorAll('main button')] as HTMLButtonElement[]).filter(
      (b) => !b.closest('form.edit') && !b.disabled && !b.classList.contains('danger') && !b.classList.contains('filtre') && texte(b) !== 'Réviser',
    );

  const nomsDans = (el: Element | null | undefined, noms: string[]) => {
    const t = propre(el);
    return noms.filter((n) => t.includes(n));
  };
  /** Les noms que le titre doit porter, lus sur la ligne ou la carte du bouton. */
  const attendus = (b: Element, noms: string[]) => {
    const ligne = b.closest('.row');
    const carte = b.closest('.card');
    const enTête = carte?.querySelector(':scope > .row') ?? null;
    const étiquette = (r: Element | null) => r?.querySelector(':scope > .label') ?? null;
    if (ligne) {
      const requis = nomsDans(étiquette(ligne), noms);
      // Ligne secondaire d'une carte à barre d'actions : un besoin, dont la tirelire est la carte.
      if (carte && enTête && enTête !== ligne && carte.querySelector(':scope > .actions')) requis.push(...nomsDans(étiquette(enTête), noms));
      return { requis: [...new Set(requis)].sort(), conteneur: 'ligne' as Conteneur };
    }
    if (carte) return { requis: nomsDans(étiquette(enTête), noms).sort(), conteneur: 'carte' as Conteneur };
    return { requis: [] as string[], conteneur: 'libre' as Conteneur };
  };

  const carte = (nom: string) => [...document.querySelectorAll('.card')].find((c) => propre(c.querySelector(':scope > .row > .label')) === nom);
  const bouton = (racine: ParentNode, libellé: string) => {
    const b = ([...racine.querySelectorAll('button')] as HTMLButtonElement[]).find(
      (x) => texte(x) === libellé && (racine instanceof HTMLFormElement || !x.closest('form.edit')),
    );
    if (!b) throw new Error(`bouton « ${libellé} » introuvable`);
    return b;
  };
  const remplir = async (f: Element, étiquette: string, valeur: string) => {
    const l = [...f.querySelectorAll('label')].find((x) => texte(x).startsWith(étiquette));
    const c = l?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null;
    if (!c) throw new Error(`champ « ${étiquette} » introuvable`);
    if (c instanceof HTMLSelectElement) {
      const options = [...c.options];
      const o = options.find((x) => texte(x) === valeur) ?? options.find((x) => x.value === valeur);
      if (!o) throw new Error(`« ${valeur} » absent du choix « ${étiquette} »`);
      c.value = o.value;
      c.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      c.value = valeur;
      c.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await attendre();
  };
  const soumettre = async (f: HTMLFormElement) => {
    f.requestSubmit();
    for (let i = 0; i < 60; i++) {
      await pause(50);
      if (!f.isConnected) return;
      const erreur = f.querySelector('.err');
      if (erreur) throw new Error(`enregistrement refusé : ${texte(erreur)}`);
    }
    throw new Error('le panneau ne se ferme pas après Enregistrer');
  };
  const annuler = async () => {
    for (const f of panneaux()) ([...f.querySelectorAll('button')].find((x) => texte(x) === 'Annuler') as HTMLButtonElement | undefined)?.click();
    await attendre();
  };

  const toutOuvrir = async (noms: string[]) => {
    const h1 = () => texte(document.querySelector('h1'));
    const écran = h1();
    const ouvertures: Ouverture[] = [];
    const n = ouvreursPossibles().length;
    for (let rang = 0; rang < n; rang++) {
      const b = ouvreursPossibles()[rang];
      if (!b) break;
      const libellé = texte(b);
      const { requis, conteneur } = attendus(b, noms);
      // On ne touche que ce qu'on voit : le bouton est amené à l'écran avant le clic, comme au doigt.
      b.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      await attendre();
      const largeurAvant = document.documentElement.scrollWidth;
      b.click();
      await attendre();
      if (h1() !== écran) return { erreur: `« ${libellé} » quitte l'écran ${écran}`, ouvertures };
      const ps = panneaux();
      if (ps.length === 0) continue; // pas un bouton d'ouverture
      const f = ps[0]!;
      const lu = lire(f);
      const ajouteDébordement = document.documentElement.scrollWidth > Math.max(largeurAvant, document.documentElement.clientWidth);
      let figé = true;
      const champ = f.querySelector('input:not([type]), input[type="text"]') as HTMLInputElement | null;
      if (champ) {
        champ.value = `${champ.value} zz`;
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        await attendre();
        figé = texte(titreDe(f)) === lu.titre;
      }
      await annuler();
      ouvertures.push({ libellé, conteneur, requis, panneaux: ps.length, ...lu, figé, fermé: panneaux().length === 0, ajouteDébordement });
    }
    return { ouvertures };
  };

  (window as unknown as { __panneaux: Outillage }).__panneaux = {
    texte, propre, attendre, panneaux, lire, ouvreursPossibles, attendus, carte, bouton, remplir, soumettre, annuler, toutOuvrir,
  };
}

// ---------------------------------------------------------------------------
// Ce qu'un panneau ouvert doit dire, et le témoin rouge qui le garde
// ---------------------------------------------------------------------------

/** Ce qu'on attend d'un panneau ouvert : il nomme l'élément touché, lui seul, et se lit. */
function vérifierUneOuverture(écran: string, o: Ouverture, tous: string[]) {
  const où = `${écran}, « ${o.libellé} » ${o.requis.length ? `sur ${o.requis.join(' + ')}` : '(création)'}`;
  expect.soft(o.panneaux, `${où} : un et un seul panneau`).toBe(1);
  expect.soft(o.titre, `${où} : panneau sans titre`).not.toBe('');
  for (const nom of o.requis) expect.soft(o.titre.includes(nom), `${où} : « ${o.titre} » ne nomme pas « ${nom} »`).toBe(true);
  const intrus = tous.filter((nom) => !o.requis.includes(nom) && o.titre.includes(nom));
  expect.soft(intrus, `${où} : « ${o.titre} » nomme un autre élément`).toEqual([]);
  expect.soft(o.lisible, `${où} : titre pas lisible à l’ouverture (${o.position})`).toBe(true);
  expect.soft(o.figé, `${où} : le titre suit la frappe`).toBe(true);
  expect.soft(o.déborde, `${où} : le titre déborde du panneau`).toBe(false);
  expect.soft(o.ajouteDébordement, `${où} : ouvrir le panneau fait défiler la page latéralement`).toBe(false);
  expect.soft(o.taille, `${où} : titre sous ${TEXTE_MIN} px`).toBeGreaterThanOrEqual(TEXTE_MIN);
  expect.soft(o.contraste, `${où} : contraste du titre sous ${CONTRASTE_MIN}:1`).toBeGreaterThanOrEqual(CONTRASTE_MIN - 0.01);
  expect.soft(o.fermé, `${où} : Annuler n’a pas fermé le panneau`).toBe(true);
}

/**
 * Témoin rouge du harnais C9 (docs/gardes.md) : les mêmes assertions, rejouées sur la lecture d'un
 * panneau volontairement cassé — le panneau d'avant #21, intitulé « Modifier » tout court, écrit en
 * gris pâle et renommé à chaque frappe. Il doit échouer ; `it.fails` tient l'échec attendu (#66).
 * Il se joue sans navigateur : c'est la règle qu'on garde ici, pas une seconde visite des écrans.
 */
it.fails('témoin rouge · un panneau intitulé « Modifier » tout court, qui suit la frappe', () => {
  vérifierUneOuverture(
    'Tirelires',
    {
      libellé: 'Modifier',
      conteneur: 'ligne',
      requis: ['Taxe foncière'],
      panneaux: 1,
      titre: 'Modifier',
      lisible: true,
      position: 'inventée',
      figé: false,
      déborde: false,
      ajouteDébordement: false,
      taille: 10,
      contraste: 2.1,
      fermé: true,
    },
    ['Taxe foncière', 'Assurance auto'],
  );
});

describe.skipIf(!navigateur)('panneaux d’édition : ils disent sur quoi ils portent (issue #23, second défaut)', () => {
  let site: Site;
  let contexte: BrowserContext;
  let page: Page;

  async function aller(écran: { menu: string; titre: string }) {
    await allerÀ(page, 'Plus');
    if (!(await cliquer(page, écran.menu))) throw new Error(`l'écran ${écran.menu} est introuvable`);
    await page.waitForFunction((t) => document.querySelector('h1')?.textContent === t, {}, écran.titre);
  }

  beforeAll(async () => {
    site = await ouvrirLeSite();
    // Contexte isolé : base vide, sans rien hériter des autres tests ni de l'exemple.
    contexte = await site.chrome.createBrowserContext();
    page = await contexte.newPage();
    page.on('dialog', (d) => void d.dismiss());
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(site.url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.tabbar') && !document.body.textContent?.includes('Ouverture de la base'));
    await page.evaluate(installer);

    const distincts = TOUS.every((a) => TOUS.every((b) => a === b || !b.includes(a)));
    if (!distincts) throw new Error('tirage de noms : un nom en contient un autre, relancer');

    await aller(COMPTES);
    await page.evaluate(async (n: Noms) => {
      const o = (window as unknown as { __panneaux: Outillage }).__panneaux;
      for (const nom of [n.compteA, n.compteB, n.compteLong]) {
        o.bouton(document, 'Ajouter un compte').click();
        await o.attendre();
        const f = o.panneaux()[0]!;
        await o.remplir(f, 'Nom', nom);
        await o.soumettre(f);
      }
    }, NOMS);

    await aller(TIRELIRES);
    await page.evaluate(async (n: Noms) => {
      const o = (window as unknown as { __panneaux: Outillage }).__panneaux;
      for (const [nom, placée] of [[n.tirelireA, true], [n.tirelireB, true], [n.tirelireSansPlacement, false]] as const) {
        o.bouton(document, 'Ajouter une tirelire').click();
        await o.attendre();
        const f = o.panneaux()[0]!;
        await o.remplir(f, 'Nom', nom);
        // Le formulaire peut proposer d'emblée une ligne de placement : on la complète, ou on la retire.
        const aUneLigne = () => [...f.querySelectorAll('label')].some((l) => o.texte(l).startsWith('Compte'));
        if (placée) {
          if (!aUneLigne()) {
            o.bouton(f, 'Ajouter un compte').click();
            await o.attendre();
          }
          await o.remplir(f, 'Compte', n.compteB).catch(() => o.remplir(f, 'Compte', n.compteA));
        } else {
          while (aUneLigne()) {
            o.bouton(f, 'Retirer').click();
            await o.attendre();
          }
        }
        await o.soumettre(f);
      }
      for (const nom of ['', n.besoinNommé]) {
        const carte = o.carte(n.tirelireA);
        if (!carte) throw new Error(`carte « ${n.tirelireA} » introuvable`);
        o.bouton(carte, 'Ajouter un besoin').click();
        await o.attendre();
        const f = o.panneaux()[0]!;
        if (nom) await o.remplir(f, 'Nom', nom);
        await o.remplir(f, 'Montant', '100,00');
        await o.soumettre(f);
      }
    }, NOMS);

    await aller(CATÉGORIES);
    await page.evaluate(async (n: Noms) => {
      const o = (window as unknown as { __panneaux: Outillage }).__panneaux;
      const ouvrirDépense = async () => {
        for (const b of o.ouvreursPossibles().filter((x) => o.attendus(x, []).conteneur === 'libre')) {
          b.click();
          await o.attendre();
          const f = o.panneaux()[0];
          const nature = f && ([...f.querySelectorAll('select')] as HTMLSelectElement[]).find((s) => [...s.options].some((x) => x.value === 'income'));
          if (f && nature?.value === 'expense') return f;
          await o.annuler();
        }
        throw new Error('aucun panneau de création de catégorie de dépense');
      };
      for (const [nom, parent] of [[n.catégorie, ''], [n.sousCatégorie, n.catégorie], [n.catégorieLongue, '']] as const) {
        const f = await ouvrirDépense();
        await o.remplir(f, 'Nom', nom);
        if (parent) await o.remplir(f, 'Catégorie parente', parent);
        await o.soumettre(f);
      }
    }, NOMS);

    await aller(FLUX);
    await page.evaluate(async (n: Noms) => {
      const o = (window as unknown as { __panneaux: Outillage }).__panneaux;
      for (const nom of [n.flux, n.fluxLong]) {
        o.bouton(document, 'Ajouter un flux').click();
        await o.attendre();
        const f = o.panneaux()[0]!;
        await o.remplir(f, 'Nom', nom);
        await o.remplir(f, 'Montant', '10,00');
        await o.soumettre(f);
      }
    }, NOMS);

    await aller(SAISIE);
    await page.evaluate(async (n: Noms) => {
      const o = (window as unknown as { __panneaux: Outillage }).__panneaux;
      for (const nom of [n.opération, n.opérationLongue]) {
        o.bouton(document, 'Saisir une opération').click();
        await o.attendre();
        const f = o.panneaux()[0]!;
        await o.remplir(f, 'Libellé', nom);
        await o.remplir(f, 'Montant', '12,00');
        await o.soumettre(f);
      }
    }, NOMS);
  }, 180_000);

  afterAll(async () => {
    await contexte?.close();
    await site?.fermer();
  });

  for (const écran of ÉCRANS) {
    it(`${écran.titre} : chaque panneau nomme l’élément touché, et lui seul`, async () => {
      await aller(écran);
      const { erreur, ouvertures } = await page.evaluate((noms: string[]) => (window as unknown as { __panneaux: Outillage }).__panneaux.toutOuvrir(noms), TOUS);
      expect(erreur).toBeUndefined();
      console.log(`[titres] ${écran.titre} : ${ouvertures.length} panneaux — ${ouvertures.map((o) => `« ${o.titre} »`).join(' ; ')}`);

      for (const o of ouvertures) vérifierUneOuverture(écran.titre, o, TOUS);

      // Deux actions différentes sur les mêmes éléments doivent s'annoncer différemment.
      const parCible = new Map<string, Map<string, Set<string>>>();
      for (const o of ouvertures) {
        const cible = o.requis.join(' + ') || '(création)';
        const actions = parCible.get(cible) ?? new Map<string, Set<string>>();
        const action = `« ${o.libellé} » (${o.conteneur})`;
        actions.set(action, (actions.get(action) ?? new Set<string>()).add(o.titre));
        parCible.set(cible, actions);
      }
      for (const [cible, actions] of parCible) {
        const liste = [...actions];
        for (let i = 0; i < liste.length; i++)
          for (let j = i + 1; j < liste.length; j++) {
            const communs = [...liste[i]![1]].filter((t) => liste[j]![1].has(t));
            expect.soft(communs, `${écran.titre}, ${cible} : ${liste[i]![0]} et ${liste[j]![0]} s’annoncent pareil`).toEqual([]);
          }
      }

      // Couverture : le harnais ne passe pas à vide.
      for (const c of écran.couverture) {
        const clé = [...c.requis].sort().join(' + ');
        const n = ouvertures.filter((o) => o.requis.join(' + ') === clé && (!c.conteneur || o.conteneur === c.conteneur)).length;
        expect(n, `couverture : panneau non ouvert pour ${clé || 'une création'}${c.conteneur ? ` (${c.conteneur})` : ''}`).toBeGreaterThanOrEqual(c.min ?? 1);
      }
    }, 120_000);
  }

  for (const écran of ÉCRANS) {
    it(`${écran.titre} : passer d’un élément à l’autre sans annuler renomme le panneau`, async () => {
      await aller(écran);
      const r = await page.evaluate(async (noms: string[]) => {
        const o = (window as unknown as { __panneaux: Outillage }).__panneaux;
        const cands = o.ouvreursPossibles().map((b) => ({ b, action: o.texte(b), ...o.attendus(b, noms) }));
        const seul = cands.filter((x) => x.requis.length === 1);
        let paire: [(typeof seul)[number], (typeof seul)[number]] | undefined;
        for (const x of seul) for (const y of seul) if (!paire && x.action === y.action && x.conteneur === y.conteneur && x.requis[0] !== y.requis[0]) paire = [x, y];
        if (!paire) return { trouvé: false, panneaux: 0, titre: '', de: '', vers: '' };
        paire[0].b.click();
        await o.attendre();
        paire[1].b.click();
        await o.attendre();
        const ps = o.panneaux();
        const titre = ps[0] ? o.lire(ps[0]).titre : '';
        await o.annuler();
        return { trouvé: true, panneaux: ps.length, titre, de: paire[0].requis[0]!, vers: paire[1].requis[0]! };
      }, TOUS);
      expect(r.trouvé, 'deux éléments ouvrables par la même action introuvables').toBe(true);
      expect(r.panneaux).toBe(1);
      expect(r.titre.includes(r.vers), `« ${r.titre} » ne nomme pas « ${r.vers} »`).toBe(true);
      expect(r.titre.includes(r.de), `« ${r.titre} » nomme encore « ${r.de} »`).toBe(false);
    }, 60_000);
  }

  it('Tirelires : deux panneaux ouverts ensemble nomment chacun le leur', async () => {
    await aller(TIRELIRES);
    const r = await page.evaluate(
      async (noms: string[], a: string, b: string) => {
        const o = (window as unknown as { __panneaux: Outillage }).__panneaux;
        const deCarte = (nom: string) =>
          o.ouvreursPossibles().filter((x) => {
            const at = o.attendus(x, noms);
            return at.conteneur === 'carte' && at.requis.length === 1 && at.requis[0] === nom;
          });
        // Le panneau de la tirelire s'ouvre après sa carte ; celui d'un besoin, dans la carte.
        const où = async (x: HTMLButtonElement) => {
          x.click();
          await o.attendre();
          const f = o.panneaux()[0];
          const lieu = f ? (f.closest('.card') ? 'dans' : 'après') : 'aucun';
          await o.annuler();
          return lieu;
        };
        let pourA: HTMLButtonElement | undefined;
        let pourB: HTMLButtonElement | undefined;
        for (const x of deCarte(a)) if (!pourA && (await où(x)) === 'après') pourA = x;
        for (const x of deCarte(b)) if (!pourB && (await où(x)) === 'dans') pourB = x;
        if (!pourA || !pourB) return { trouvé: false, panneaux: 0, après: '', dans: '', carte: '' };
        pourA.click();
        await o.attendre();
        pourB.click();
        await o.attendre();
        const ps = o.panneaux();
        const fApres = ps.find((f) => !f.closest('.card'));
        const fDans = ps.find((f) => !!f.closest('.card'));
        const résultat = {
          trouvé: true,
          panneaux: ps.length,
          après: fApres ? o.lire(fApres).titre : '',
          dans: fDans ? o.lire(fDans).titre : '',
          carte: fDans ? o.propre(fDans.closest('.card')!.querySelector(':scope > .row > .label')) : '',
        };
        await o.annuler();
        return résultat;
      },
      TOUS,
      NOMS.tirelireA,
      NOMS.tirelireB,
    );
    expect(r.trouvé, 'boutons de tirelire et de besoin introuvables').toBe(true);
    expect(r.panneaux).toBe(2);
    expect(r.carte).toBe(NOMS.tirelireB);
    expect(r.après.includes(NOMS.tirelireA) && !r.après.includes(NOMS.tirelireB), `panneau de la tirelire : « ${r.après} »`).toBe(true);
    expect(r.dans.includes(NOMS.tirelireB) && !r.dans.includes(NOMS.tirelireA), `panneau du besoin : « ${r.dans} »`).toBe(true);
  }, 60_000);

  it('Catégories : basculer la nature fait annoncer la nature choisie', async () => {
    await aller(CATÉGORIES);
    const r = await page.evaluate(async () => {
      const o = (window as unknown as { __panneaux: Outillage }).__panneaux;
      const natureDe = (f: Element) =>
        ([...f.querySelectorAll('select')] as HTMLSelectElement[]).find((s) => {
          const v = [...s.options].map((x) => x.value);
          return v.includes('expense') && v.includes('income');
        });
      const parNature = new Map<string, { b: HTMLButtonElement; titre: string }>();
      for (const b of o.ouvreursPossibles().filter((x) => o.attendus(x, []).conteneur === 'libre')) {
        b.click();
        await o.attendre();
        const f = o.panneaux()[0];
        const s = f && natureDe(f);
        if (f && s) parNature.set(s.value, { b, titre: o.lire(f).titre });
        await o.annuler();
      }
      const natures = [...parNature.keys()];
      if (natures.length < 2) return { trouvé: false, départ: '', direct: '', basculé: '' };
      const [de, vers] = natures as [string, string];
      parNature.get(de)!.b.click();
      await o.attendre();
      const s = natureDe(o.panneaux()[0]!)!;
      s.value = vers;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      await o.attendre();
      const f = o.panneaux()[0];
      const basculé = f ? o.lire(f).titre : '';
      await o.annuler();
      return { trouvé: true, départ: parNature.get(de)!.titre, direct: parNature.get(vers)!.titre, basculé };
    });
    expect(r.trouvé, 'deux panneaux de création de natures différentes introuvables').toBe(true);
    expect(r.direct, 'les créations des deux natures s’annoncent pareil').not.toBe(r.départ);
    expect(r.basculé, `après bascule, « ${r.basculé} » au lieu de « ${r.direct} »`).toBe(r.direct);
  }, 60_000);

  // En dernier : « Réviser » écrit une révision dans la base.
  it('Tirelires : une révision nomme sa tirelire et ne s’annonce pas comme une modification', async () => {
    await aller(TIRELIRES);
    const r = await page.evaluate(async (noms: string[], a: string) => {
      const o = (window as unknown as { __panneaux: Outillage }).__panneaux;
      const réviser = ([...document.querySelectorAll('main button')] as HTMLButtonElement[]).find((b) => {
        const at = o.attendus(b, noms);
        return o.texte(b) === 'Réviser' && at.conteneur === 'ligne' && at.requis.join() === a;
      });
      const ligne = réviser?.closest('.row');
      const modifier = ligne ? o.ouvreursPossibles().find((b) => b.closest('.row') === ligne) : undefined;
      if (!réviser || !modifier) return { trouvé: false, modification: '', révision: '' };
      modifier.click();
      await o.attendre();
      const modification = o.lire(o.panneaux()[0]!).titre;
      await o.annuler();
      réviser.click();
      await o.attendre();
      const f = o.panneaux()[0];
      const révision = f ? o.lire(f).titre : '';
      await o.annuler();
      return { trouvé: true, modification, révision };
    }, TOUS, NOMS.tirelireA);
    expect(r.trouvé, 'besoin révisable introuvable').toBe(true);
    expect(r.révision.includes(NOMS.tirelireA), `« ${r.révision} » ne nomme pas la tirelire`).toBe(true);
    expect(TOUS.filter((n) => n !== NOMS.tirelireA && r.révision.includes(n)), 'la révision nomme un autre élément').toEqual([]);
    expect(r.révision, 'la révision s’annonce comme une modification').not.toBe(r.modification);
  }, 60_000);
});
