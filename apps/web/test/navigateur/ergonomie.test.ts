/**
 * Ce que la relecture d'un écran ne dit pas et qu'une mesure dit : la taille de ce qu'on vise du
 * pouce, la lisibilité d'un texte gris au soleil, et ce qu'une barre fixe recouvre.
 *
 * Ces quatre gardes viennent de l'audit du 8 septembre 2026. Elles encodent des seuils, pas des
 * opinions : 44 px de cible (Material en demande 48, Apple 44 ; on prend le moins-disant pour ne
 * pas gonfler des listes denses), 12 px de texte, 4,5:1 de contraste — le seuil AA de WCAG 2.1
 * pour du texte courant — et l'impossibilité pour un champ qu'on vient d'atteindre de se retrouver
 * sous la barre d'onglets.
 *
 * Ce qu'elles ne mesurent pas, faute de pouvoir le faire dans un navigateur de bureau : les marges
 * du bord à bord Android, le vrai clavier logiciel, le rendu des polices système. Cela reste à
 * vérifier sur l'appareil.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'puppeteer-core';
import { allerÀ, cliquer, navigateur, ouvrirLExemple, ouvrirLeSite, type Site } from '../harnais.js';

/** Le plus petit côté acceptable pour une cible tactile, en pixels CSS. */
const CIBLE = 44;
/** La plus petite taille de texte lisible sur un téléphone. */
const TEXTE = 12;
/** Contraste minimum d'un texte courant sur son fond (WCAG 2.1 AA). */
const CONTRASTE = 4.5;
/** Un bouton destructif ne doit pas être collé à son voisin : on veut de quoi ne pas se tromper. */
const ÉCART_DESTRUCTIF = 12;

// ---------------------------------------------------------------------------
// Mesures, exécutées dans la page
// ---------------------------------------------------------------------------

/** Éléments qu'un doigt vise, et dont la boîte doit donc être assez grande. */
const VISABLES = 'button, a[href], select, label.btn, input[type="checkbox"], input[type="date"], input[type="file"]';

function mesurerLesCibles(min: number, écartDestructif: number) {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const nommer = (el: Element) => {
    const t = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');
    return t.slice(0, 30) || `<${el.tagName.toLowerCase()}>`;
  };
  const cibles = [...document.querySelectorAll('button, a[href], select, label.btn, input[type="checkbox"], input[type="date"], input[type="file"]')].filter(visible);

  const tropPetites = cibles
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    // Une case à cocher est petite par nature : c'est l'étiquette qui l'entoure qui porte la cible.
    .map(({ el, r }) => {
      const étiquette = el.closest('label');
      const boîte = étiquette && el.tagName === 'INPUT' ? étiquette.getBoundingClientRect() : r;
      return { el, boîte };
    })
    .filter(({ boîte }) => boîte.height < min - 0.5 || boîte.width < min - 0.5)
    .map(({ el, boîte }) => `${nommer(el)} — ${Math.round(boîte.width)}×${Math.round(boîte.height)}`);

  // Un destructif collé à son voisin : le pouce qui rate « Modifier » supprime. Les barres fixes
  // sont hors du compte — elles ne sont pas dans la même liste, et la page leur réserve sa place.
  const horsBarres = (el: Element) => !el.closest('.tabbar') && !el.closest('.topbar');
  const collés: string[] = [];
  for (const d of cibles.filter((el) => el.classList.contains('danger'))) {
    const rd = d.getBoundingClientRect();
    for (const autre of cibles.filter(horsBarres)) {
      if (autre === d) continue;
      const ra = autre.getBoundingClientRect();
      const dx = Math.max(0, Math.max(rd.left - ra.right, ra.left - rd.right));
      const dy = Math.max(0, Math.max(rd.top - ra.bottom, ra.top - rd.bottom));
      const écart = Math.hypot(dx, dy);
      if (écart < écartDestructif - 0.5) collés.push(`${nommer(d)} à ${Math.round(écart)} px de ${nommer(autre)}`);
    }
  }
  return { tropPetites: [...new Set(tropPetites)], collés: [...new Set(collés)] };
}

function mesurerLeTexte(min: number, contrasteMin: number) {
  /** Éléments qui portent eux-mêmes du texte visible (et non celui de leurs enfants). */
  const porteursDeTexte = () => {
    const out: Element[] = [];
    for (const el of document.querySelectorAll('body *')) {
      const propre = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0);
      if (!propre) continue;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && Number(s.opacity) > 0.1) out.push(el);
    }
    return out;
  };
  const nommer = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);

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
  /** Le fond effectif : le premier ancêtre dont la couleur n'est pas transparente. */
  const fond = (el: Element): [number, number, number, number] => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c[3] > 0.05) return c;
    }
    return [255, 255, 255, 1];
  };
  const contraste = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  const tropPetits: string[] = [];
  const tropPâles: string[] = [];
  for (const el of porteursDeTexte()) {
    const s = getComputedStyle(el);
    const taille = parseFloat(s.fontSize);
    if (taille < min - 0.01) tropPetits.push(`« ${nommer(el)} » à ${taille} px`);
    // Le seuil s'abaisse à 3:1 pour le grand texte, comme le prévoit le critère.
    const gras = Number(s.fontWeight) >= 700 || s.fontWeight === 'bold';
    const grand = taille >= 24 || (gras && taille >= 18.66);
    const seuil = grand ? 3 : contrasteMin;
    const c = contraste(luminance(rgb(s.color)), luminance(fond(el)));
    if (c < seuil - 0.01) tropPâles.push(`« ${nommer(el)} » ${c.toFixed(2)}:1 (${s.color} sur fond)`);
  }
  return { tropPetits: [...new Set(tropPetits)], tropPâles: [...new Set(tropPâles)] };
}

/**
 * Un champ atteint reste-t-il visible ? On le met au point, on l'amène à l'écran comme le
 * navigateur le fait, et on regarde ce qui occupe son centre : si c'est la barre d'onglets, le
 * champ est dessous.
 */
function mesurerLOcclusion() {
  const champs = [...document.querySelectorAll('form.edit input, form.edit select')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) as HTMLElement[];
  const masqués: string[] = [];
  for (const champ of champs) {
    champ.focus();
    champ.scrollIntoView({ block: 'nearest' });
    const r = champ.getBoundingClientRect();
    const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (dessus && dessus !== champ && !champ.contains(dessus)) {
      const par = (dessus.closest('.tabbar') && 'la barre d’onglets') || (dessus.closest('.topbar') && 'la barre du haut') || dessus.tagName.toLowerCase();
      const étiquette = (champ.closest('label')?.textContent ?? champ.getAttribute('aria-label') ?? '?').trim().slice(0, 30);
      masqués.push(`« ${étiquette} » recouvert par ${par}`);
    }
  }
  return { champs: champs.length, masqués: [...new Set(masqués)] };
}

// ---------------------------------------------------------------------------
// Ce que les mesures doivent dire, et le témoin rouge qui le garde
// ---------------------------------------------------------------------------

function vérifierLesCibles(r: { tropPetites: string[]; collés: string[] }, écran: string) {
  expect(r.tropPetites, `cibles sous ${CIBLE} px sur l'écran ${écran}`).toEqual([]);
  expect(r.collés, `bouton destructif à moins de ${ÉCART_DESTRUCTIF} px de son voisin`).toEqual([]);
}

function vérifierLeTexte(r: { tropPetits: string[]; tropPâles: string[] }, écran: string) {
  expect(r.tropPetits, `texte sous ${TEXTE} px sur l'écran ${écran}`).toEqual([]);
  expect(r.tropPâles, `contraste sous ${CONTRASTE}:1 sur l'écran ${écran}`).toEqual([]);
}

/**
 * Témoin rouge du harnais C9 (docs/gardes.md) : les mêmes assertions, rejouées sur la mesure d'un
 * écran volontairement cassé — cibles de 20 px, destructif collé à son voisin, texte de 9 px en
 * gris pâle. Il doit échouer ; `it.fails` tient l'échec attendu (#66). Il se joue sans navigateur :
 * ce sont les seuils qu'on garde ici, pas une seconde mesure de l'application.
 */
it.fails('témoin rouge · un écran aux cibles de 20 px et au texte gris pâle', () => {
  vérifierLesCibles({ tropPetites: ['Modifier — 20×20'], collés: ['Supprimer à 2 px de Modifier'] }, 'inventé');
  vérifierLeTexte({ tropPetits: ['« Solde à régler » à 9 px'], tropPâles: ['« Solde à régler » 2.10:1 (rgb(180, 180, 180) sur fond)'] }, 'inventé');
});

describe.skipIf(!navigateur)('ergonomie au doigt', () => {
  let site: Site;

  beforeAll(async () => {
    site = await ouvrirLeSite();
  }, 120_000);

  afterAll(async () => {
    await site?.fermer();
  });

  /** Les écrans où l'on passe du temps, et où l'on agit ligne par ligne. */
  const ÉCRANS: Array<{ nom: string; onglet: string; suite?: (page: Page) => Promise<void> }> = [
    { nom: 'Plan', onglet: 'Plan' },
    { nom: 'Opérations', onglet: 'Opérations' },
    { nom: 'Bilan', onglet: 'Bilan' },
    {
      nom: 'Tirelires',
      onglet: 'Plus',
      suite: async (page) => {
        await cliquer(page, 'Tirelires');
      },
    },
  ];

  for (const écran of ÉCRANS) {
    it(`${écran.nom} : rien de plus petit que ${CIBLE} px sous le doigt`, async () => {
      const page = await ouvrirLExemple(site);
      await allerÀ(page, écran.onglet);
      await écran.suite?.(page);
      const r = await page.evaluate(mesurerLesCibles, CIBLE, ÉCART_DESTRUCTIF);
      await page.close();

      vérifierLesCibles(r, écran.nom);
    }, 60_000);

    it(`${écran.nom} : rien sous ${TEXTE} px ni sous ${CONTRASTE}:1`, async () => {
      const page = await ouvrirLExemple(site);
      await allerÀ(page, écran.onglet);
      await écran.suite?.(page);
      const r = await page.evaluate(mesurerLeTexte, TEXTE, CONTRASTE);
      await page.close();

      vérifierLeTexte(r, écran.nom);
    }, 60_000);
  }

  it('un champ atteint ne passe pas sous la barre d’onglets, clavier ouvert', async () => {
    // 375 × 380 : ce qui reste d'un écran de téléphone quand le clavier logiciel occupe le bas.
    const page = await ouvrirLExemple(site, 375, 380);
    await allerÀ(page, 'Plus');
    await cliquer(page, 'Tirelires');
    await cliquer(page, 'Ajouter une tirelire');
    const r = await page.evaluate(mesurerLOcclusion);
    await page.close();

    expect(r.champs, 'aucun champ trouvé : le formulaire ne s’est pas ouvert').toBeGreaterThan(0);
    expect(r.masqués, 'un champ mis au point reste sous une barre fixe').toEqual([]);
  }, 60_000);
});
