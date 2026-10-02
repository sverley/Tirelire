/**
 * Les formes qu'écrit l'application, colonne par colonne (D58, #198) : une date, un horodatage, et
 * chaque colonne JSON. Chaque fonction dit ce qui ne va pas, en nommant la table et la colonne, ou
 * `undefined` si la valeur a sa forme. Elles servent à écrire une ligne, à la recevoir et à ouvrir un
 * fichier (`rowProblem`) : une valeur refusée à l'un l'est aux autres.
 */
import { DEFAULT_SETTINGS } from './model.js';

/** Unités d'un rythme (`PeriodUnit`). */
export const PERIOD_UNITS = ['day', 'week', 'month', 'year'] as const;

/** Effets d'une action sur l'état d'une opération (`AutomationStateAction`). */
export const AUTOMATION_STATE_ACTIONS = ['lock', 'reconcile', 'none', 'unlock'] as const;

/** Une forme de valeur : ce qui ne va pas, dit à partir du nom de la colonne, ou `undefined`. */
export type Forme = (nom: string, v: unknown) => string | undefined;

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

const entier = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v);
const nombre = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const texte = (v: unknown): boolean => typeof v === 'string' && v !== '';

/** Clés permises d'un objet : la première en trop, s'il y en a une. */
function cleEnTrop(o: Record<string, unknown>, permises: readonly string[]): string | undefined {
  return Object.keys(o).find((k) => !permises.includes(k));
}

/** Champs d'un objet : obligatoires ou non, chacun avec son test et ce qu'il attend. */
type Champ = { test: (v: unknown) => boolean; attendu: string; requis?: boolean };

function objet(nom: string, v: unknown, champs: Record<string, Champ>): string | undefined {
  if (!estObjet(v)) return `${nom} vaut ${vu(v)}, qui n’est pas un objet.`;
  const trop = cleEnTrop(v, Object.keys(champs));
  if (trop) return `${nom} porte « ${trop} », qui n’est pas du format.`;
  for (const [cle, ch] of Object.entries(champs)) {
    const x = v[cle];
    if (x === undefined) {
      if (ch.requis) return `${nom}.${cle} manque.`;
      continue;
    }
    if (!ch.test(x)) return `${nom}.${cle} vaut ${vu(x)}, qui n’est pas ${ch.attendu}.`;
  }
  return undefined;
}

/** Une part (D27, D38) : fixe en centimes entiers, en pourcentage, ou variable. */
export const formePart: Forme = (nom, v) => {
  if (!estObjet(v)) return `${nom} vaut ${vu(v)}, qui n’est pas une part.`;
  if (v['kind'] === 'fixed') return objet(nom, v, { kind: { test: () => true, attendu: '' }, amount: { test: entier, attendu: 'un montant entier en centimes', requis: true } });
  if (v['kind'] === 'percent') return objet(nom, v, { kind: { test: () => true, attendu: '' }, pct: { test: nombre, attendu: 'un nombre', requis: true } });
  if (v['kind'] === 'variable') return objet(nom, v, { kind: { test: () => true, attendu: '' } });
  return `${nom} vaut ${vu(v)} : une part est fixe (« fixed »), en pourcentage (« percent ») ou variable (« variable »).`;
};

/** Une liste de parts, dont une seule variable (D27, D38). */
function parts(nom: string, v: unknown, champs: Record<string, Champ>): string | undefined {
  if (!Array.isArray(v)) return `${nom} vaut ${vu(v)}, qui n’est pas une liste.`;
  let variables = 0;
  for (let i = 0; i < v.length; i++) {
    const e = v[i];
    const pb = objet(`${nom}[${i}]`, e, { ...champs, share: { test: () => true, attendu: '', requis: true } }) ?? formePart(`${nom}[${i}].share`, (e as Record<string, unknown>)['share']);
    if (pb) return pb;
    if (((e as Record<string, unknown>)['share'] as Record<string, unknown>)['kind'] === 'variable') variables++;
  }
  if (variables > 1) return `${nom} porte ${variables} parts variables : une seule est permise.`;
  return undefined;
}

/** Le placement d'une tirelire (D38) : une composante par compte, une seule variable. */
export const formePlacement: Forme = (nom, v) => parts(nom, v, { accountId: { test: texte, attendu: 'un identifiant de compte', requis: true } });

/** Le report d'une tirelire. */
export const formeReport: Forme = (nom, v) => {
  if (!estObjet(v)) return `${nom} vaut ${vu(v)}, qui n’est pas un report.`;
  if (v['mode'] === 'none' || v['mode'] === 'unlimited') return objet(nom, v, { mode: { test: () => true, attendu: '' } });
  if (v['mode'] === 'capped') return objet(nom, v, { mode: { test: () => true, attendu: '' }, months: { test: (x) => entier(x) && (x as number) >= 0, attendu: 'un nombre entier de mois', requis: true } });
  return `${nom} vaut ${vu(v)} : un report est « none », « unlimited » ou « capped ».`;
};

/** Un rythme (D47). */
export const formeRythme: Forme = (nom, v) =>
  objet(nom, v, {
    interval: { test: (x) => entier(x) && (x as number) >= 1, attendu: 'un nombre entier d’au moins 1', requis: true },
    unit: { test: (x) => (PERIOD_UNITS as readonly unknown[]).includes(x), attendu: `une unité (${PERIOD_UNITS.join(', ')})`, requis: true },
    anchorDate: { test: estDate, attendu: 'une date AAAA-MM-JJ', requis: true },
  });

/** La tolérance de montant d'un flux. */
export const formeTolerance: Forme = (nom, v) => objet(nom, v, { abs: { test: entier, attendu: 'un montant entier en centimes' }, pct: { test: nombre, attendu: 'un nombre' } });

/** La sélection d'un automatisme (D23, D36). */
export const formeSelection: Forme = (nom, v) =>
  objet(nom, v, {
    labelPattern: { test: (x) => typeof x === 'string', attendu: 'un texte' },
    accountId: { test: texte, attendu: 'un identifiant de compte' },
    amountMin: { test: entier, attendu: 'un montant entier en centimes' },
    amountMax: { test: entier, attendu: 'un montant entier en centimes' },
    dateFrom: { test: estDate, attendu: 'une date AAAA-MM-JJ' },
    dateTo: { test: estDate, attendu: 'une date AAAA-MM-JJ' },
  });

/** L'action d'un automatisme (D23) ; sa ventilation n'a qu'une part variable (D27). */
export const formeAction: Forme = (nom, v) =>
  objet(nom, v, {
    categoryId: { test: texte, attendu: 'un identifiant de catégorie' },
    tirelireId: { test: texte, attendu: 'un identifiant de tirelire' },
    allocation: { test: () => true, attendu: '' },
    oneOff: { test: (x) => typeof x === 'boolean', attendu: 'vrai ou faux' },
    state: { test: (x) => (AUTOMATION_STATE_ACTIONS as readonly unknown[]).includes(x), attendu: `un effet (${AUTOMATION_STATE_ACTIONS.join(', ')})` },
  }) ??
  (estObjet(v) && v['allocation'] !== undefined
    ? parts(`${nom}.allocation`, v['allocation'], {
        categoryId: { test: texte, attendu: 'un identifiant de catégorie' },
        tirelireId: { test: texte, attendu: 'un identifiant de tirelire' },
      })
    : undefined);

/** Les colonnes d'un profil d'import. */
export const formeColonnesImport: Forme = (nom, v) => {
  const t = { test: (x: unknown) => typeof x === 'string', attendu: 'un nom de colonne' };
  return objet(nom, v, { date: { ...t, requis: true }, valueDate: t, label: { ...t, requis: true }, fullLabel: t, amount: t, debit: t, credit: t, account: t, category: t, subCategory: t });
};

/** La table des comptes d'un profil d'import : valeur lue → identifiant de compte. */
export const formeTableComptes: Forme = (nom, v) => {
  if (!estObjet(v)) return `${nom} vaut ${vu(v)}, qui n’est pas un objet.`;
  const mauvaise = Object.entries(v).find(([, x]) => !texte(x));
  return mauvaise ? `${nom}.${mauvaise[0]} vaut ${vu(mauvaise[1])}, qui n’est pas un identifiant de compte.` : undefined;
};

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

/** Ce que chaque réglage du format attend. `siteId` n'en est pas un : il décrit l'instance (D58). */
const REGLAGES: Record<string, Champ> = {
  periodStartDay: { test: (x) => entier(x) && (x as number) >= 1 && (x as number) <= 31, attendu: 'un jour du mois, de 1 à 31' },
  principalCushion: { test: entier, attendu: 'un montant entier en centimes' },
  transferThreshold: { test: entier, attendu: 'un montant entier en centimes' },
  orderRounding: { test: (x) => entier(x) && (x as number) >= 0, attendu: 'un montant entier positif en centimes' },
};

/** Les clés des réglages du format, celles de `DEFAULT_SETTINGS` sans ce qui décrit l'instance. */
export const CLES_REGLAGES = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'siteId');

/**
 * Ce qui empêche d'écrire un réglage, sa valeur telle qu'elle est stockée (JSON, ou vide) ; `undefined`
 * s'il s'écrit. Un réglage qui décrit une instance — son identité — n'a pas sa place dans le fichier
 * ni dans un paquet (D58).
 */
export function settingProblem(cle: unknown, valeur: unknown): string | undefined {
  if (typeof cle !== 'string' || !cle) return `settings.key est obligatoire.`;
  if (cle === 'siteId') return `settings « siteId » décrit une instance : il reste à l’instance, jamais dans le fichier ni dans un paquet.`;
  const attendu = REGLAGES[cle];
  if (!attendu) return `settings « ${cle} » n’est pas un réglage du format (${CLES_REGLAGES.join(', ')}).`;
  if (valeur === null || valeur === undefined) return undefined;
  if (typeof valeur !== 'string') return `settings « ${cle} » : la valeur ${vu(valeur)} n’est pas du JSON.`;
  let v: unknown;
  try {
    v = JSON.parse(valeur);
  } catch {
    return `settings « ${cle} » : la valeur « ${valeur} » ne se lit pas en JSON.`;
  }
  if (!attendu.test(v)) return `settings « ${cle} » vaut ${vu(v)}, qui n’est pas ${attendu.attendu}.`;
  return undefined;
}
