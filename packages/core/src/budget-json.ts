/**
 * Le budget JSON (#366) : un format d'échange du budget, sans ses opérations, que le cœur lit en
 * lignes du budget posées sur un projet donné. Ce n'est pas un second stockage : le fichier SQLite
 * reste la vérité (D08, D58), et le budget JSON entre par l'assistant (#367). Le format est décrit
 * dans `docs/format-budget-json.md`, et libre de changer jusqu'à `v1` (D30, D91).
 *
 * Il parle le vocabulaire du fichier (D42, D58) : les tables `accounts`, `tirelires`, `needs`,
 * `categories`, `planned_flows`, leurs colonnes SQL, et les réglages du format. Une valeur s'y écrit
 * en JSON natif : une colonne JSON est un objet ou une liste, un booléen `true` ou `false`.
 *
 * La lecture est tout ou rien : chaque ligne passe par `rowProblem`, chaque réglage par
 * `settingProblem`, et ce qui lie les lignes par `verifierLiens`, la même vérification qu'un fichier
 * ouvert (D58). Une seule faute refuse le tout, et rien n'est écrit.
 */
import type { Account, Category, Id, Ledger, Need, PlannedFlow, Settings, Tirelire } from './model.js';
import { MAIN_ACCOUNT_ID } from './model.js';
import { CLES_REGLAGES, settingProblem } from './formes.js';
import { rowProblem, TABLES, type ColumnDef, type TableDef } from './schema.js';
import type { LedgerStore } from './store.js';
import { messageDeRefus, verifierLiens, type LigneLue, type Probleme } from './verification.js';

/** Le nom du format, que porte la clé `format` du JSON. */
export const BUDGET_JSON_FORMAT = 'tirelire-budget';
/** La version du format que cette application lit, que porte la clé `version` (D30). */
export const BUDGET_JSON_VERSION = 1;

/** Les tables du budget, dans l'ordre où elles se lisent, par clé de `Ledger`. */
const CLES_TABLES = ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows'] as const;
type CleTable = (typeof CLES_TABLES)[number];

/** Ce qu'une ligne du fichier porte et que le budget JSON ne porte pas : la suppression logique. */
const COLONNES_EXCLUES = new Set(['deleted_at']);

/** Les colonnes acceptées par table, par nom SQL ; les réglages sous `settings`. */
export const COLONNES_BUDGET_JSON: Record<string, string[]> = {
  ...Object.fromEntries(
    CLES_TABLES.map((k) => {
      const t = TABLES[k]!;
      return [t.name, t.columns.map((c) => c.col).filter((c) => !COLONNES_EXCLUES.has(c))];
    }),
  ),
  settings: [...CLES_REGLAGES],
};

/** Le budget lu : ses lignes, prêtes à écrire sur le projet, et ses réglages. */
export interface BudgetLu {
  accounts: Account[];
  tirelires: Tirelire[];
  needs: Need[];
  categories: Category[];
  plannedFlows: PlannedFlow[];
  settings: Partial<Omit<Settings, 'siteId'>>;
}

export type LectureBudgetJson = { ok: true; budget: BudgetLu } | { ok: false; problemes: Probleme[]; message: string };

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const decrire = (v: unknown): string => {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
};

/** Le refus d'un budget JSON : le premier problème, et combien d'autres il y a. */
function refus(problemes: Probleme[]): LectureBudgetJson {
  const message = messageDeRefus(problemes).replace('Ce fichier Tirelire ne s’ouvre pas', 'Ce budget JSON ne se lit pas');
  return { ok: false, problemes, message };
}

/**
 * Lit un budget JSON — son texte ou sa valeur déjà lue — en lignes du budget, posées sur `projet`.
 * Une ligne dont l'identifiant existe dans le projet le remplace ; le compte principal du JSON, celui
 * de genre `principal`, renseigne celui du projet (D40). Rien n'est écrit.
 */
export function lireBudgetJson(source: string | unknown, projet: Ledger): LectureBudgetJson {
  let brut: unknown = source;
  if (typeof source === 'string') {
    try {
      brut = JSON.parse(source);
    } catch (e) {
      return refus([{ table: 'budget', message: `Le texte ne se lit pas en JSON (${(e as Error).message}).` }]);
    }
  }
  if (!estObjet(brut)) return refus([{ table: 'budget', message: `Un budget JSON est un objet, pas ${decrire(brut)}.` }]);
  if (brut['format'] !== BUDGET_JSON_FORMAT)
    return refus([{ table: 'budget', colonne: 'format', message: `format vaut ${decrire(brut['format'])} : un budget JSON porte « ${BUDGET_JSON_FORMAT} ».` }]);
  if (brut['version'] !== BUDGET_JSON_VERSION)
    return refus([
      {
        table: 'budget',
        colonne: 'version',
        message: `version vaut ${decrire(brut['version'])} : cette version de Tirelire ne lit que la version ${BUDGET_JSON_VERSION} du budget JSON (D30).`,
      },
    ]);

  const problemes: Probleme[] = [];
  const nomsTables = new Map(CLES_TABLES.map((k) => [TABLES[k]!.name, k] as const));
  for (const cle of Object.keys(brut)) {
    if (cle === 'format' || cle === 'version' || cle === 'settings' || nomsTables.has(cle)) continue;
    problemes.push({ table: cle, message: `La table « ${cle} » n’est pas du budget JSON (${[...nomsTables.keys(), 'settings'].join(', ')}).` });
  }

  // Le compte principal du JSON : son identifiant désigne celui du projet (D40).
  const comptes = Array.isArray(brut['accounts']) ? (brut['accounts'] as unknown[]) : [];
  const principaux = comptes.filter((a) => estObjet(a) && a['kind'] === 'principal');
  const idPrincipal = principaux.length === 1 && typeof (principaux[0] as Record<string, unknown>)['id'] === 'string' ? ((principaux[0] as Record<string, unknown>)['id'] as string) : undefined;
  if (principaux.length > 1)
    problemes.push({ table: 'accounts', colonne: 'kind', message: `accounts porte ${principaux.length} comptes de genre « principal » : un seul, celui du projet (D40).` });
  const versProjet = (id: unknown): unknown => (idPrincipal !== undefined && id === idPrincipal ? MAIN_ACCOUNT_ID : id);

  // Chaque table, ligne par ligne.
  const lues = new Map<CleTable, LigneLue[]>();
  for (const k of CLES_TABLES) {
    const t = TABLES[k]!;
    const liste: LigneLue[] = [];
    lues.set(k, liste);
    const valeur = brut[t.name];
    if (valeur === undefined) continue;
    if (!Array.isArray(valeur)) {
      problemes.push({ table: t.name, message: `${t.name} vaut ${decrire(valeur)}, qui n’est pas une liste de lignes.` });
      continue;
    }
    const vus = new Set<string>();
    valeur.forEach((ligne, rang) => {
      const ligneLue = lireLigne(t, ligne, rang, versProjet, problemes);
      if (!ligneLue) return;
      const idJson = (ligne as Record<string, unknown>)['id'] as string;
      if (vus.has(idJson)) problemes.push({ table: t.name, id: idJson, colonne: 'id', message: `L’identifiant « ${idJson} » se répète dans la table ${t.name}.` });
      vus.add(idJson);
      liste.push(ligneLue);
    });
  }

  // Les réglages.
  const settings: Record<string, unknown> = {};
  const reglages = brut['settings'];
  if (reglages !== undefined) {
    if (!estObjet(reglages)) problemes.push({ table: 'settings', message: `settings vaut ${decrire(reglages)}, qui n’est pas un objet.` });
    else
      for (const [cle, v] of Object.entries(reglages)) {
        const pb = settingProblem(cle, v === undefined || v === null ? null : JSON.stringify(v));
        if (pb) problemes.push({ table: 'settings', id: cle, colonne: 'value', message: pb });
        else if (v !== null) settings[cle] = v;
      }
  }

  // Ce qui lie les lignes : le projet, puis le JSON par-dessus, vérifiés comme un fichier ouvert.
  const toutes = new Map<string, LigneLue[]>();
  for (const k of Object.keys(TABLES)) {
    const t = TABLES[k]!;
    const parId = new Map<string, LigneLue>();
    for (const r of (projet[k as keyof Ledger] as unknown as Array<Record<string, unknown>>) ?? []) parId.set(r['id'] as string, enLigne(t, r));
    const venues = lues.get(k as CleTable);
    if (venues) for (const l of venues) parId.set(l.id, l);
    toutes.set(t.name, [...parId.values()]);
  }
  const avant = problemes.length;
  verifierLiens(toutes, problemes);
  // Seuls comptent les problèmes des lignes du JSON : celles du projet ont été vérifiées à l'écriture.
  const duJson = new Set(CLES_TABLES.flatMap((k) => lues.get(k)!.map((l) => `${TABLES[k]!.name}\u0000${l.id}`)));
  const liens = problemes.splice(avant).filter((p) => duJson.has(`${p.table}\u0000${p.id ?? ''}`));
  problemes.push(...liens);

  if (problemes.length) return refus(problemes);

  const budget: BudgetLu = { accounts: [], tirelires: [], needs: [], categories: [], plannedFlows: [], settings: settings as BudgetLu['settings'] };
  for (const k of CLES_TABLES) {
    const t = TABLES[k]!;
    (budget[k] as unknown[]) = lues.get(k)!.map((l) => fromRow(t, { id: l.id, ...l.v }));
  }
  return { ok: true, budget };
}

/** Une valeur du modèle, telle qu'elle s'écrit dans sa colonne du fichier. */
function toSql(c: ColumnDef, x: unknown): string | number | null {
  if (x === undefined || x === null) return null;
  if (c.type === 'json') return JSON.stringify(x);
  if (c.type === 'boolean') return x ? 1 : 0;
  return x as string | number;
}

/** Une ligne écrite, rendue au modèle : propriétés en camelCase, JSON lu, booléens. */
function fromRow(t: TableDef, v: Record<string, string | number | null>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of t.columns) {
    const x = v[c.col];
    if (x === null || x === undefined) continue;
    out[c.prop] = c.type === 'json' ? JSON.parse(x as string) : c.type === 'boolean' ? x === 1 : x;
  }
  return out;
}

/** Une ligne du projet, telle qu'elle s'écrit dans le fichier. */
function enLigne(t: TableDef, r: Record<string, unknown>): LigneLue {
  const v: Record<string, string | number | null> = {};
  for (const c of t.columns) if (c.col !== 'id') v[c.col] = toSql(c, r[c.prop]);
  return { id: r['id'] as Id, hlc: '', v };
}

/**
 * Une ligne du JSON, convertie en valeurs du fichier, ses problèmes dits dans `problemes` ; `undefined`
 * si elle n'a pas d'identifiant. Le compte principal du JSON prend l'identifiant de celui du projet, et ce qui le
 * désigne aussi.
 */
function lireLigne(t: TableDef, ligne: unknown, rang: number, versProjet: (id: unknown) => unknown, problemes: Probleme[]): LigneLue | undefined {
  if (!estObjet(ligne)) {
    problemes.push({ table: t.name, id: `#${rang + 1}`, message: `La ligne ${rang + 1} de ${t.name} vaut ${decrire(ligne)}, qui n’est pas un objet.` });
    return undefined;
  }
  const idJson = ligne['id'];
  const nomLigne = typeof idJson === 'string' && idJson ? idJson : `#${rang + 1}`;
  const nombre = problemes.length;
  if (typeof idJson !== 'string' || !idJson) problemes.push({ table: t.name, id: nomLigne, colonne: 'id', message: `${t.name}.id est obligatoire, et c’est un texte.` });
  const acceptees = COLONNES_BUDGET_JSON[t.name]!;
  for (const col of Object.keys(ligne))
    if (!acceptees.includes(col)) problemes.push({ table: t.name, id: nomLigne, colonne: col, message: `La colonne « ${t.name}.${col} » n’est pas du budget JSON.` });
  const v: Record<string, string | number | null> = {};
  for (const c of t.columns) {
    if (c.col === 'id' || COLONNES_EXCLUES.has(c.col)) {
      if (c.col !== 'id') v[c.col] = null;
      continue;
    }
    let x = ligne[c.col];
    if (x === undefined || x === null) {
      v[c.col] = null;
      continue;
    }
    if (c.ref === 'accounts') x = versProjet(x);
    if (c.type === 'boolean' && typeof x !== 'boolean') {
      problemes.push({ table: t.name, id: nomLigne, colonne: c.col, message: `${t.name}.${c.col} vaut ${decrire(x)}, qui n’est pas true ou false.` });
      continue;
    }
    if (c.type === 'json' && typeof x !== 'object') {
      problemes.push({ table: t.name, id: nomLigne, colonne: c.col, message: `${t.name}.${c.col} vaut ${decrire(x)}, qui n’est pas un objet ou une liste JSON.` });
      continue;
    }
    if (c.col === 'placement' && Array.isArray(x)) x = x.map((p) => (estObjet(p) ? { ...p, accountId: versProjet(p['accountId']) } : p));
    if ((c.type === 'integer' || c.type === 'real') && typeof x !== 'number') {
      problemes.push({ table: t.name, id: nomLigne, colonne: c.col, message: `${t.name}.${c.col} vaut ${decrire(x)}, qui n’est pas un nombre.` });
      continue;
    }
    if (c.type === 'text' && typeof x !== 'string') {
      problemes.push({ table: t.name, id: nomLigne, colonne: c.col, message: `${t.name}.${c.col} vaut ${decrire(x)}, qui n’est pas un texte.` });
      continue;
    }
    v[c.col] = toSql(c, x);
  }
  if (typeof idJson !== 'string' || !idJson) return undefined;
  // Seule la ligne du compte principal prend son identité : un identifiant n'est unique que dans sa table.
  const id = (t.name === 'accounts' ? versProjet(idJson) : idJson) as string;
  // Une ligne fautive reste lue, pour que ce qui la désigne ne soit pas compté en plus.
  if (problemes.length > nombre) return { id, hlc: '', v };
  const pb = rowProblem(t, id, v);
  if (pb) {
    const m = new RegExp(`^${t.name}\\.(\\w+)`).exec(pb);
    problemes.push({ table: t.name, id: nomLigne, ...(m ? { colonne: m[1]! } : {}), message: pb });
  }
  return { id, hlc: '', v };
}

/**
 * Écrit un budget lu sur le projet que tient `store` : chaque ligne par `upsert`, chaque réglage par
 * `setSetting` (D89). Le budget a été vérifié en entier sur ce projet : rien n'y est refusé.
 */
export function ecrireBudget(store: LedgerStore, budget: BudgetLu): void {
  for (const k of CLES_TABLES) for (const r of budget[k]) store.upsert(k, r as never);
  for (const [cle, v] of Object.entries(budget.settings)) store.setSetting(cle as keyof Settings, v as never);
}
