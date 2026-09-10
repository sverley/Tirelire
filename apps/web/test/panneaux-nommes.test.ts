/**
 * Garde du second défaut de l'issue #23 : un panneau d'édition de la Configuration dit sur quoi il
 * porte (#21, D59). Le premier défaut — panneau hors écran, retour après Annuler — relève de #1 et
 * #2 et n'est pas gardé ici.
 *
 * `panneaux-edition.test.ts` vérifie qu'un élément `.titre-panneau` existe et qu'une variable
 * `titre` est affectée quelque part dans la vue. Il reste vert si un bouton ouvre son panneau sans
 * poser de titre, si le titre lit le champ en cours de saisie, ou s'il ne nomme rien. Ce harnais-ci
 * ouvre réellement les panneaux, à 375 px, et lit ce qu'ils annoncent :
 *
 * - chaque bouton qui ouvre un panneau, sur les cinq écrans, tous états de filtre allumés, produit
 *   un titre qui nomme l'action et l'élément touché — la tirelire, pour un besoin ;
 * - ce titre se lit à l'ouverture sans chercher, ne suit pas la frappe, et reste lisible (12 px au
 *   moins, contraste 4,5:1 sur le fond du panneau) ;
 * - passer d'un élément à l'autre sans annuler renomme le panneau, et deux panneaux ouverts ensemble
 *   sur Tirelires nomment chacun le leur ; une révision (D50) s'annonce comme telle ;
 * - le titre ne contredit pas le formulaire : une catégorie passée en revenu ne s'annonce pas en
 *   dépense ;
 * - un libellé long et insécable, courant dans les relevés bancaires, ne déborde pas du panneau.
 *
 * Les animations sont coupées (`prefers-reduced-motion`) : c'est le texte qu'on lit, pas le
 * défilement qu'on mesure.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from './harnais.js';

const TEXTE_MIN = 12;
const CONTRASTE_MIN = 4.5;
/** Libellé de prélèvement tel qu'un relevé l'exporte : sans espace sur toute sa longueur. */
const LIBELLÉ_INSÉCABLE = 'PRLVSEPADGFIPTAXEFONCIERE2026REF0123456789ABCDEF';

const ÉCRANS = [
  { menu: 'Comptes', titre: 'Comptes' },
  { menu: 'Tirelires', titre: 'Tirelires' },
  { menu: 'Catégories', titre: 'Catégories' },
  { menu: 'Flux prévus', titre: 'Flux prévus' },
  { menu: 'Saisie manuelle', titre: 'Saisie' },
];

interface Lecture {
  titre: string;
  lisible: boolean;
  déborde: boolean;
  taille: number;
  contraste: number;
}

interface Ouverture extends Partial<Lecture> {
  rang: number;
  bouton: string;
  verbe: string;
  noms: string[];
  panneaux: number;
  figé: boolean;
  fermé: boolean;
}

interface Outillage {
  ouvreurs(): HTMLButtonElement[];
  attendu(b: HTMLButtonElement, écran: string): { verbe: string; noms: string[] };
  lire(f: Element): Lecture;
  texte(el: Element | null | undefined): string;
  propre(el: Element | null | undefined): string;
  attendre(): Promise<void>;
  toutOuvrir(écran: string): Promise<Ouverture[]>;
}
type AvecOutillage = Window & { __panneaux: Outillage };

/** Installe dans la page les lectures communes, une fois par page. */
function installer() {
  const texte = (el: Element | null | undefined) => (el?.textContent ?? '').trim().replace(/\s+/g, ' ');
  const propre = (el: Element | null | undefined) => {
    if (!el) return '';
    const copie = el.cloneNode(true) as Element;
    copie.querySelectorAll('.sub, .pill').forEach((e) => e.remove());
    return texte(copie);
  };
  const CRÉATIONS = ['Ajouter une tirelire', 'Ajouter un compte', 'Ajouter un flux', 'Saisir une opération'];
  const estOuvreur = (t: string) => ['Modifier', 'Ajouter un besoin', 'Placer', ...CRÉATIONS].includes(t) || t.startsWith('Ajouter une catégorie de ');
  const ouvreurs = () =>
    [...document.querySelectorAll('main button')].filter(
      (b) => !b.closest('form.edit') && !b.classList.contains('filtre') && estOuvreur(texte(b)),
    ) as HTMLButtonElement[];

  const attendu = (b: HTMLButtonElement, écran: string) => {
    const t = texte(b);
    const carte = b.closest('.card');
    const nomCarte = propre(carte?.querySelector(':scope > .row > .label strong'));
    const ligne = b.closest('.row');
    const label = ligne?.querySelector(':scope > .label');
    const nomLigne = propre(label?.querySelector('strong') ?? label);
    if (CRÉATIONS.includes(t)) return { verbe: t, noms: [] as string[] };
    if (t.startsWith('Ajouter une catégorie de ')) return { verbe: t.replace(/s$/, ''), noms: [] as string[] };
    if (t === 'Ajouter un besoin') return { verbe: 'Ajouter un besoin', noms: [nomCarte] };
    if (t === 'Placer') return { verbe: 'Modifier la tirelire', noms: [propre(label)] };
    if (écran === 'Tirelires' && ligne) return { verbe: 'Modifier le besoin', noms: nomLigne && nomLigne !== nomCarte ? [nomCarte, nomLigne] : [nomCarte] };
    if (écran === 'Tirelires') return { verbe: 'Modifier la tirelire', noms: [nomCarte] };
    if (écran === 'Comptes') return { verbe: 'Modifier le compte', noms: [nomCarte] };
    if (écran === 'Catégories') return { verbe: 'Modifier la catégorie', noms: [nomLigne] };
    if (écran === 'Flux prévus') return { verbe: 'Modifier le flux', noms: [nomLigne] };
    return { verbe: "Modifier l'opération", noms: [nomLigne] };
  };

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
    const titre = f.querySelector('.titre-panneau');
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
    return {
      titre: texte(titre),
      lisible: !!r && r.height > 0 && r.top >= haut - 0.5 && r.bottom <= bas + 0.5 && !!dessus && f.contains(dessus),
      déborde: encre > bordDroit + 0.5,
      taille: st ? parseFloat(st.fontSize) : 0,
      contraste: titre ? (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) : 0,
    };
  };

  const pause = (ms: number) => new Promise((fin) => setTimeout(fin, ms));
  const attendre = async () => {
    await pause(30);
    await new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin)));
  };

  const toutOuvrir = async (écran: string) => {
    const résultats: Ouverture[] = [];
    const n = ouvreurs().length;
    for (let rang = 0; rang < n; rang++) {
      const b = ouvreurs()[rang]!;
      const { verbe, noms } = attendu(b, écran);
      b.click();
      await attendre();
      const panneaux = [...document.querySelectorAll('form.edit')];
      const f = panneaux[0];
      const lu = f ? lire(f) : {};
      let figé = true;
      const champ = f?.querySelector('input:not([type]), input[type="text"]') as HTMLInputElement | null;
      if (f && champ) {
        champ.value = `${champ.value} zz`;
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        await attendre();
        figé = texte(f.querySelector('.titre-panneau')) === (lu as Lecture).titre;
      }
      const annuler = f ? [...f.querySelectorAll('button')].find((x) => texte(x) === 'Annuler') : undefined;
      annuler?.click();
      await attendre();
      résultats.push({ rang, bouton: texte(b), verbe, noms, panneaux: panneaux.length, ...lu, figé, fermé: document.querySelectorAll('form.edit').length === 0 });
    }
    return résultats;
  };

  (window as unknown as AvecOutillage).__panneaux = { ouvreurs, attendu, lire, texte, propre, attendre, toutOuvrir };
}

// ---------------------------------------------------------------------------

describe.skipIf(!navigateur)('panneaux d’édition : ils disent sur quoi ils portent (issue #23, second défaut)', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);

  afterAll(async () => {
    await site?.fermer();
  });

  /** Ouvre un écran de Configuration à 375 px, animations coupées, tous états de filtre allumés. */
  async function ouvrir(écran: { menu: string; titre: string }): Promise<Page> {
    const page = await ouvrirLExemple(site, 375, 812);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await allerÀ(page, 'Plus');
    expect(await cliquer(page, écran.menu), `l'écran ${écran.menu} est introuvable`).toBe(true);
    await page.waitForFunction((t) => document.querySelector('h1')?.textContent === t, {}, écran.titre);
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('.filtre:not(.actif)')) (b as HTMLButtonElement).click();
    });
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate(installer);
    return page;
  }

  for (const écran of ÉCRANS) {
    it(`${écran.titre} : chaque bouton ouvre un panneau qui nomme l’action et l’élément`, async () => {
      const page = await ouvrir(écran);
      try {
        const résultats = await page.evaluate((t) => (window as unknown as AvecOutillage).__panneaux.toutOuvrir(t), écran.titre);
        console.log(`[titres] ${écran.titre} : ${résultats.length} panneaux ouverts — ${[...new Set(résultats.map((r) => r.titre))].slice(0, 4).join(' | ')} …`);
        expect(résultats.length, 'aucun bouton ouvreur trouvé').toBeGreaterThan(0);
        for (const r of résultats) {
          const où = `${écran.titre}, « ${r.bouton} » n° ${r.rang + 1}`;
          expect.soft(r.panneaux, `${où} : un et un seul panneau`).toBe(1);
          expect.soft(r.titre ?? '', `${où} : titre « ${r.titre} », attendu « ${r.verbe} … »`).toMatch(new RegExp(`^${r.verbe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
          for (const nom of r.noms) expect.soft(r.titre ?? '', `${où} : le titre ne nomme pas « ${nom} »`).toContain(nom);
          expect.soft(r.lisible, `${où} : titre pas lisible à l’ouverture`).toBe(true);
          expect.soft(r.figé, `${où} : le titre suit la frappe`).toBe(true);
          expect.soft(r.déborde, `${où} : le titre déborde du panneau`).toBe(false);
          expect.soft(r.taille ?? 0, `${où} : titre sous ${TEXTE_MIN} px`).toBeGreaterThanOrEqual(TEXTE_MIN);
          expect.soft(r.contraste ?? 0, `${où} : contraste du titre sous ${CONTRASTE_MIN}:1`).toBeGreaterThanOrEqual(CONTRASTE_MIN - 0.01);
          expect.soft(r.fermé, `${où} : Annuler n’a pas fermé le panneau`).toBe(true);
        }
      } finally {
        await page.close();
      }
    }, 120_000);
  }

  it('Comptes : passer d’un compte à l’autre sans annuler renomme le panneau', async () => {
    const page = await ouvrir(ÉCRANS[0]!);
    try {
      const r = await page.evaluate(async () => {
        const o = (window as unknown as AvecOutillage).__panneaux;
        const modifier = o.ouvreurs().filter((b) => o.texte(b) === 'Modifier');
        modifier[0]!.click();
        await o.attendre();
        const b = o.ouvreurs().filter((x) => o.texte(x) === 'Modifier')[1]!;
        const nom = o.attendu(b, 'Comptes').noms[0];
        b.click();
        await o.attendre();
        const panneaux = [...document.querySelectorAll('form.edit')];
        return { panneaux: panneaux.length, titre: panneaux[0] ? o.lire(panneaux[0]).titre : '', nom };
      });
      expect(r.panneaux).toBe(1);
      expect(r.titre).toBe(`Modifier le compte — ${r.nom}`);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('Tirelires : deux panneaux ouverts ensemble nomment chacun le leur', async () => {
    const page = await ouvrir(ÉCRANS[1]!);
    try {
      const r = await page.evaluate(async () => {
        const o = (window as unknown as AvecOutillage).__panneaux;
        const deCarte = (t: string) => o.ouvreurs().filter((b) => o.texte(b) === t && b.parentElement?.parentElement?.classList.contains('card'));
        const cartes = [...document.querySelectorAll('.card')].filter((c) => c.querySelector(':scope > .actions'));
        const nom = (c: Element) => o.propre(c.querySelector(':scope > .row > .label strong'));
        deCarte('Modifier')[0]!.click();
        await o.attendre();
        deCarte('Ajouter un besoin')[1]!.click();
        await o.attendre();
        const panneaux = [...document.querySelectorAll('form.edit')];
        return {
          panneaux: panneaux.length,
          titres: panneaux.map((f) => o.lire(f).titre),
          tirelire: nom(cartes[0]!),
          besoin: nom(cartes[1]!),
        };
      });
      expect(r.panneaux).toBe(2);
      expect(r.titres).toContain(`Modifier la tirelire — ${r.tirelire}`);
      expect(r.titres).toContain(`Ajouter un besoin — ${r.besoin}`);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('Tirelires : une révision s’annonce comme telle et nomme sa tirelire', async () => {
    const page = await ouvrir(ÉCRANS[1]!);
    try {
      const r = await page.evaluate(async () => {
        const o = (window as unknown as AvecOutillage).__panneaux;
        const réviser = [...document.querySelectorAll('main button')].find((b) => o.texte(b) === 'Réviser') as HTMLButtonElement | undefined;
        if (!réviser) return { trouvé: false, titre: '', nom: '' };
        const nom = o.propre(réviser.closest('.card')?.querySelector(':scope > .row > .label strong'));
        réviser.click();
        await o.attendre();
        const f = document.querySelector('form.edit');
        return { trouvé: true, titre: f ? o.lire(f).titre : '', nom };
      });
      expect(r.trouvé, 'l’exemple ne porte aucun besoin révisable').toBe(true);
      expect(r.titre).toMatch(/^Réviser le besoin/);
      expect(r.titre).toContain(r.nom);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('Catégories : le titre ne contredit pas la nature choisie dans le formulaire', async () => {
    const page = await ouvrir(ÉCRANS[2]!);
    try {
      const r = await page.evaluate(async () => {
        const o = (window as unknown as AvecOutillage).__panneaux;
        o.ouvreurs().find((b) => o.texte(b) === 'Ajouter une catégorie de dépenses')!.click();
        await o.attendre();
        const avant = o.lire(document.querySelector('form.edit')!).titre;
        const nature = [...document.querySelectorAll('form.edit label')].find((l) => o.texte(l).startsWith('Nature'))?.querySelector('select') as HTMLSelectElement;
        nature.value = 'income';
        nature.dispatchEvent(new Event('change', { bubbles: true }));
        await o.attendre();
        const f = document.querySelector('form.edit');
        const choisie = (([...(f?.querySelectorAll('label') ?? [])].find((l) => o.texte(l).startsWith('Nature'))?.querySelector('select') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent ?? '').trim();
        let section = '';
        for (let n: Element | null = f; n && !section; n = n.previousElementSibling) if (n.tagName === 'H2') section = o.texte(n);
        return { avant, après: f ? o.lire(f).titre : '(panneau fermé)', choisie, section };
      });
      console.log(`[nature] titre « ${r.avant} » → « ${r.après} » ; nature choisie « ${r.choisie} » ; panneau sous « ${r.section} »`);
      expect(r.après, `le panneau, rangé sous « ${r.section} » avec la nature « ${r.choisie} », s’annonce « ${r.après} »`).not.toMatch(/dépense/);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('Saisie : un libellé bancaire insécable ne déborde pas du titre à 375 px', async () => {
    const page = await ouvrir(ÉCRANS[4]!);
    try {
      const r = await page.evaluate(async (libellé: string) => {
        const o = (window as unknown as AvecOutillage).__panneaux;
        const modifier = o.ouvreurs().filter((b) => o.texte(b) === 'Modifier');
        modifier[modifier.length - 1]!.click();
        await o.attendre();
        const f = document.querySelector('form.edit') as HTMLFormElement;
        const champ = [...f.querySelectorAll('label')].find((l) => o.texte(l).startsWith('Libellé'))!.querySelector('input') as HTMLInputElement;
        champ.value = libellé;
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        await o.attendre();
        f.requestSubmit();
        await o.attendre();
        const resté = document.querySelector('form.edit');
        if (resté) return { enregistré: false, erreur: o.texte(resté.querySelector('.error, .neg, .warn')), titre: '', déborde: false, pageDéborde: false, pageDébordeFermé: false };
        // Panneau fermé, la liste seule : sert à attribuer un débordement au titre plutôt qu'à la ligne.
        const pageDébordeFermé = document.documentElement.scrollWidth > document.documentElement.clientWidth;
        const ligne = [...document.querySelectorAll('.row')].find((x) => o.texte(x.querySelector('.label strong')) === libellé);
        (ligne?.querySelector('.actions button') as HTMLButtonElement).click();
        await o.attendre();
        const g = document.querySelector('form.edit')!;
        const lu = o.lire(g);
        return { enregistré: true, erreur: '', titre: lu.titre, déborde: lu.déborde, pageDéborde: document.documentElement.scrollWidth > document.documentElement.clientWidth, pageDébordeFermé };
      }, LIBELLÉ_INSÉCABLE);
      expect(r.enregistré, `mise en place : libellé non enregistré (${r.erreur})`).toBe(true);
      expect(r.titre).toContain(LIBELLÉ_INSÉCABLE);
      expect.soft(r.déborde, `« ${r.titre} » déborde du panneau`).toBe(false);
      console.log(`[insécable] titre déborde : ${r.déborde} ; page qui défile latéralement — panneau fermé : ${r.pageDébordeFermé}, panneau ouvert : ${r.pageDéborde}`);
      expect(r.pageDébordeFermé, 'mise en place : la liste seule déborde déjà, le titre n’est pas en cause').toBe(false);
      expect.soft(r.pageDéborde, 'le panneau ouvert fait défiler la page latéralement').toBe(false);
    } finally {
      await page.close();
    }
  }, 60_000);
});
