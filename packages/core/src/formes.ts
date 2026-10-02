/**
 * Les formes qu'écrit l'application, colonne par colonne (D58, #198) : une date, un horodatage, et
 * chaque colonne JSON. Chaque forme dit ce qui ne va pas, en nommant la table et la colonne, ou
 * `undefined` si la valeur a sa forme. Elles servent à écrire une ligne, à la recevoir et à ouvrir un
 * fichier (`rowProblem`) : une valeur refusée à l'un l'est aux autres.
 *
 * Une colonne JSON se décrit par une `Description`, une donnée : la même sert à vérifier sa forme
 * (`problemeDeForme`), à y trouver les identifiants qui désignent une ligne d'une autre table
 * (`referencesDe`), et à les énumérer (`feuillesDe`) — un identifiant s'y décrit par `ident`, avec
 * la table qu'il désigne, si bien qu'à l'ouverture d'un fichier chacun est vérifié comme une colonne.
 */
import { DEFAULT_SETTINGS } from './model.js';

/** Unités d'un rythme (`PeriodUnit`). */
export const PERIOD_UNITS = ['day', 'week', 'month', 'year'] as const;

/** Effets d'une action sur l'état d'une opération (`AutomationStateAction`). */
export const AUTOMATION_STATE_ACTIONS = ['lock', 'reconcile', 'none', 'unlock'] as const;

/** Une valeur simple : son test, ce qu'elle doit être, et, pour un identifiant, la table qu'il désigne. */
export interface Feuille {
  genre: 'valeur';
  test: (v: unknown) => boolean;
  attendu: string;
  /** Nom SQL de la table dont la valeur est un identifiant. */
  ref?: string;
}

/** Un champ d'objet : sa description, obligatoire ou non. */
export interface Champ {
  desc: Description;
  requis?: boolean;
}

/**
 * La forme d'une valeur JSON :
 * - `objet` : des champs nommés, aucun autre ;
 * - `liste` : des éléments de même forme ; `parts`, des éléments à part (`share`), une seule variable (D27, D38) ;
 * - `table` : des clés libres, des valeurs de même forme ;
 * - `choix` : selon la valeur d'une clé (`kind`, `mode`), une forme parmi plusieurs ;
 * - `valeur` : une valeur simple.
 */
export type Description =
  | { genre: 'objet'; champs: Record<string, Champ> }
  | { genre: 'liste'; de: Description; parts?: boolean }
  | { genre: 'table'; de: Description }
  | { genre: 'choix'; cle: string; cas: Record<string, Record<string, Champ>> }
  | Feuille;

const vu = (v: unknown): string => {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
};

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Une date `AAAA-MM-JJ` qui existe au calendrier. */
export function estDate(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Un horodatage tel que l'écrit `Date.prototype.toISOString` : `AAAA-MM-JJTHH:MM:SS.mmmZ`. */
export function estHorodatage(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d.toISOString() === v;
}

const estEntier = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v);
const estNombre = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

// Les feuilles.
const valeur = (test: (v: unknown) => boolean, attendu: string): Feuille => ({ genre: 'valeur', test, attendu });
const centimes = valeur(estEntier, 'un montant entier en centimes');
const nombre = valeur(estNombre, 'un nombre');
const texte = valeur((x) => typeof x === 'string', 'un texte');
const date = valeur(estDate, 'une date AAAA-MM-JJ');
const booleen = valeur((x) => typeof x === 'boolean', 'vrai ou faux');
const parmi = (valeurs: readonly string[], quoi: string): Feuille => valeur((x) => valeurs.includes(x as string), `${quoi} (${valeurs.join(', ')})`);

/** Un identifiant : un texte non vide qui désigne une ligne de `table`. */
const ident = (table: string): Feuille => ({ genre: 'valeur', test: (x) => typeof x === 'string' && x !== '', attendu: `un identifiant de la table ${table}`, ref: table });

const requis = (desc: Description): Champ => ({ desc, requis: true });
const facultatif = (desc: Description): Champ => ({ desc });

/** Une part (D27, D38) : fixe en centimes entiers, en pourcentage, ou variable. */
export const PART: Description = {
  genre: 'choix',
  cle: 'kind',
  cas: { fixed: { amount: requis(centimes) }, percent: { pct: requis(nombre) }, variable: {} },
};

/** Le placement d'une tirelire (D38) : une composante par compte, une seule variable. */
export const PLACEMENT: Description = { genre: 'liste', parts: true, de: { genre: 'objet', champs: { accountId: requis(ident('accounts')), share: requis(PART) } } };

/** Le report d'une tirelire. */
export const REPORT: Description = {
  genre: 'choix',
  cle: 'mode',
  cas: { none: {}, unlimited: {}, capped: { months: requis(valeur((x) => estEntier(x) && (x as number) >= 0, 'un nombre entier de mois')) } },
};

/** Un rythme (D47). */
export const RYTHME: Description = {
  genre: 'objet',
  champs: {
    interval: requis(valeur((x) => estEntier(x) && (x as number) >= 1, 'un nombre entier d’au moins 1')),
    unit: requis(parmi(PERIOD_UNITS, 'une unité')),
    anchorDate: requis(date),
  },
};

/** La tolérance de montant d'un flux. */
export const TOLERANCE: Description = { genre: 'objet', champs: { abs: facultatif(centimes), pct: facultatif(nombre) } };

/** La sélection d'un automatisme (D23, D36). */
export const SELECTION: Description = {
  genre: 'objet',
  champs: {
    labelPattern: facultatif(texte),
    accountId: facultatif(ident('accounts')),
    amountMin: facultatif(centimes),
    amountMax: facultatif(centimes),
    dateFrom: facultatif(date),
    dateTo: facultatif(date),
  },
};

/** L'action d'un automatisme (D23) ; sa ventilation n'a qu'une part variable (D27). */
export const ACTION: Description = {
  genre: 'objet',
  champs: {
    categoryId: facultatif(ident('categories')),
    tirelireId: facultatif(ident('tirelires')),
    allocation: facultatif({
      genre: 'liste',
      parts: true,
      de: { genre: 'objet', champs: { categoryId: facultatif(ident('categories')), tirelireId: facultatif(ident('tirelires')), share: requis(PART) } },
    }),
    oneOff: facultatif(booleen),
    state: facultatif(parmi(AUTOMATION_STATE_ACTIONS, 'un effet')),
  },
};

/** Les colonnes d'un profil d'import. */
export const COLONNES_IMPORT: Description = {
  genre: 'objet',
  champs: Object.fromEntries(
    ['date', 'valueDate', 'label', 'fullLabel', 'amount', 'debit', 'credit', 'account', 'category', 'subCategory'].map((k) => [k, { desc: texte, ...(k === 'date' || k === 'label' ? { requis: true } : {}) }]),
  ),
};

/** La table des comptes d'un profil d'import : valeur lue dans le relevé → identifiant de compte. */
export const TABLE_COMPTES: Description = { genre: 'table', de: ident('accounts') };

/** Ce qui ne va pas dans une valeur JSON déjà lue, nommée `nom` ; `undefined` si elle a sa forme. */
export function problemeDeForme(nom: string, v: unknown, d: Description): string | undefined {
  switch (d.genre) {
    case 'valeur':
      return d.test(v) ? undefined : `${nom} vaut ${vu(v)}, qui n’est pas ${d.attendu}.`;
    case 'objet':
      return champs(nom, v, d.champs, 'un objet');
    case 'choix': {
      if (!estObjet(v) || typeof v[d.cle] !== 'string' || !Object.hasOwn(d.cas, v[d.cle] as string))
        return `${nom} vaut ${vu(v)} : ${d.cle} doit valoir ${Object.keys(d.cas)
          .map((k) => `« ${k} »`)
          .join(', ')}.`;
      return champs(nom, v, { [d.cle]: { desc: texte }, ...d.cas[v[d.cle] as string]! }, 'un objet');
    }
    case 'table': {
      if (!estObjet(v)) return `${nom} vaut ${vu(v)}, qui n’est pas un objet.`;
      for (const [k, x] of Object.entries(v)) {
        const pb = problemeDeForme(`${nom}.${k}`, x, d.de);
        if (pb) return pb;
      }
      return undefined;
    }
    case 'liste': {
      if (!Array.isArray(v)) return `${nom} vaut ${vu(v)}, qui n’est pas une liste.`;
      for (let i = 0; i < v.length; i++) {
        const pb = problemeDeForme(`${nom}[${i}]`, v[i], d.de);
        if (pb) return pb;
      }
      if (d.parts) {
        const variables = v.filter((e) => ((e as Record<string, unknown>)['share'] as Record<string, unknown>)['kind'] === 'variable').length;
        if (variables > 1) return `${nom} porte ${variables} parts variables : une seule est permise.`;
      }
      return undefined;
    }
  }
}

function champs(nom: string, v: unknown, liste: Record<string, Champ>, quoi: string): string | undefined {
  if (!estObjet(v)) return `${nom} vaut ${vu(v)}, qui n’est pas ${quoi}.`;
  const trop = Object.keys(v).find((k) => !Object.hasOwn(liste, k));
  if (trop) return `${nom} porte « ${trop} », qui n’est pas du format.`;
  for (const [cle, ch] of Object.entries(liste)) {
    if (v[cle] === undefined) {
      if (ch.requis) return `${nom}.${cle} manque.`;
      continue;
    }
    const pb = problemeDeForme(`${nom}.${cle}`, v[cle], ch.desc);
    if (pb) return pb;
  }
  return undefined;
}

/** Un identifiant trouvé dans une valeur JSON : où il est, ce qu'il vaut, la table qu'il désigne. */
export interface ReferenceJson {
  chemin: string;
  id: string;
  table: string;
}

/** Les identifiants d'une valeur JSON qui a sa forme, chacun avec la table qu'il désigne. */
export function referencesDe(nom: string, v: unknown, d: Description): ReferenceJson[] {
  switch (d.genre) {
    case 'valeur':
      return d.ref && typeof v === 'string' ? [{ chemin: nom, id: v, table: d.ref }] : [];
    case 'objet':
    case 'choix': {
      if (!estObjet(v)) return [];
      const liste = d.genre === 'objet' ? d.champs : (d.cas[v[d.cle] as string] ?? {});
      return Object.entries(liste).flatMap(([k, ch]) => (v[k] === undefined ? [] : referencesDe(`${nom}.${k}`, v[k], ch.desc)));
    }
    case 'table':
      return estObjet(v) ? Object.entries(v).flatMap(([k, x]) => referencesDe(`${nom}.${k}`, x, d.de)) : [];
    case 'liste':
      return Array.isArray(v) ? v.flatMap((x, i) => referencesDe(`${nom}[${i}]`, x, d.de)) : [];
  }
}

/**
 * Chaque valeur simple d'une forme, par son chemin (`[]` pour un élément de liste, `{}` pour une
 * valeur de table), avec la table qu'elle désigne si c'est un identifiant. Sert au test qui veut
 * qu'aucun identifiant n'échappe à la vérification (#198, point 10).
 */
export function feuillesDe(nom: string, d: Description): Array<{ chemin: string; feuille: Feuille }> {
  switch (d.genre) {
    case 'valeur':
      return [{ chemin: nom, feuille: d }];
    case 'objet':
      return Object.entries(d.champs).flatMap(([k, ch]) => feuillesDe(`${nom}.${k}`, ch.desc));
    case 'choix':
      return Object.entries(d.cas).flatMap(([cas, liste]) => Object.entries(liste).flatMap(([k, ch]) => feuillesDe(`${nom}<${cas}>.${k}`, ch.desc)));
    case 'table':
      return feuillesDe(`${nom}{}`, d.de);
    case 'liste':
      return feuillesDe(`${nom}[]`, d.de);
  }
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

/** Ce que chaque réglage du format attend. `siteId` n'en est pas un : il décrit l'instance (D58). */
const REGLAGES: Record<string, Feuille> = {
  periodStartDay: valeur((x) => estEntier(x) && (x as number) >= 1 && (x as number) <= 31, 'un jour du mois, de 1 à 31'),
  principalCushion: centimes,
  transferThreshold: centimes,
  orderRounding: valeur((x) => estEntier(x) && (x as number) >= 0, 'un montant entier positif en centimes'),
};

/** Les clés des réglages du format, celles de `DEFAULT_SETTINGS` sans ce qui décrit l'instance. */
export const CLES_REGLAGES = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'siteId');

/**
 * Ce qui empêche d'écrire un réglage, sa valeur telle qu'elle est stockée (JSON, ou vide) ; `undefined`
 * s'il s'écrit. Un réglage qui décrit une instance — son identité — n'a pas sa place dans le fichier
 * ni dans un paquet (D58).
 */
export function settingProblem(cle: unknown, valeurStockee: unknown): string | undefined {
  if (typeof cle !== 'string' || !cle) return `settings.key est obligatoire.`;
  if (cle === 'siteId') return `settings « siteId » décrit une instance : il reste à l’instance, jamais dans le fichier ni dans un paquet.`;
  const attendu = REGLAGES[cle];
  if (!attendu) return `settings « ${cle} » n’est pas un réglage du format (${CLES_REGLAGES.join(', ')}).`;
  if (valeurStockee === null || valeurStockee === undefined) return undefined;
  if (typeof valeurStockee !== 'string') return `settings « ${cle} » : la valeur ${vu(valeurStockee)} n’est pas du JSON.`;
  let v: unknown;
  try {
    v = JSON.parse(valeurStockee);
  } catch {
    return `settings « ${cle} » : la valeur « ${valeurStockee} » ne se lit pas en JSON.`;
  }
  if (!attendu.test(v)) return `settings « ${cle} » vaut ${vu(v)}, qui n’est pas ${attendu.attendu}.`;
  return undefined;
}
