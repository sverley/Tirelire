/**
 * Le budget JSON (#366, #378) : un fichier qui **définit** les parties du budget qu'il contient —
 * chacune des tables `accounts`, `tirelires`, `needs`, `categories`, `planned_flows`, et chaque clé
 * de `settings`. Une partie présente se définit entièrement : une ligne qu'elle ne nomme pas n'existe
 * pas dans l'état qu'elle définit ; une partie absente n'est pas définie. Le fichier se lit seul,
 * sans le projet (`lireBudgetJson`). Ce n'est pas un second stockage : le fichier SQLite reste la
 * vérité (D08, D58, D93). Le format est décrit dans `docs/format-budget-json.md`, et libre de changer
 * jusqu'à `v1` (D30, D91).
 *
 * Il est aussi le brouillon de l'assistant (D93) : l'assistant garde l'état qu'il a lu
 * (`etatDuProjet`), et la validation n'applique au projet du moment que la différence entre le
 * fichier et cet état (`differenceBudget`, `preparerApplication`, `appliquerBudget`). Pour un import,
 * l'état lu est le projet du moment (`importerBudgetJson`).
 *
 * Il parle le vocabulaire du fichier (D42, D58) : les tables, leurs colonnes SQL, les réglages du
 * format. Une valeur s'y écrit en JSON natif : une colonne JSON est un objet ou une liste, un booléen
 * `true` ou `false`. Une ligne retirée qu'une ligne qu'il porte désigne encore s'y écrit comme dans le
 * fichier, avec sa colonne `deleted_at` (#409) : il se lit seul, et relire ce qu'il a écrit redonne
 * les mêmes lignes.
 */
import type { Ledger, Settings } from './model.js';
import { MAIN_ACCOUNT_ID, standingOrderTarget } from './model.js';
import { CLES_REGLAGES, settingProblem, referencesDe } from './formes.js';
import { sha256Hex } from './ids.js';
import { rowProblem, TABLES, type ColumnDef, type TableDef } from './schema.js';
import type { LedgerStore } from './store.js';
import { messageDeRefus, verifierLiens, type LigneLue, type Probleme } from './verification.js';

/** Le nom du format, que porte la clé `format` du JSON. */
export const BUDGET_JSON_FORMAT = 'tirelire-budget';
/** La version du format que cette application lit et écrit, que porte la clé `version` (D30). */
export const BUDGET_JSON_VERSION = 5;

/** Les tables du budget, dans l'ordre où elles se lisent, par clé de `Ledger`. */
export const CLES_TABLES_BUDGET = ['accounts', 'tirelires', 'needs', 'categories', 'plannedFlows'] as const;
const CLES_TABLES = CLES_TABLES_BUDGET;
export type CleTableBudget = (typeof CLES_TABLES)[number];
type CleTable = CleTableBudget;

/** Le début d'un identifiant déduit du nom, par table : `acc-`, `env-`, `need-`, `cat-`, `flow-`. */
export const PREFIXES_IDENTIFIANT: Record<CleTable, string> = { accounts: 'acc', tirelires: 'env', needs: 'need', categories: 'cat', plannedFlows: 'flow' };

/** Les colonnes acceptées par table, par nom SQL, `deleted_at` comprise (#409) ; les réglages sous `settings`. */
export const COLONNES_BUDGET_JSON: Record<string, string[]> = {
  ...Object.fromEntries(CLES_TABLES.map((k) => [TABLES[k]!.name, TABLES[k]!.columns.map((c) => c.col)])),
  settings: [...CLES_REGLAGES],
};

/**
 * Une ligne du budget, aux valeurs du fichier (SQL). Une ligne retirée porte sa suppression logique,
 * `deleted_at`, l'horodatage de sa suppression (D58, #409) ; une ligne vivante l'a vide.
 */
type Valeurs = Record<string, string | number | null>;
export interface LigneBudget {
  id: string;
  v: Valeurs;
}

/**
 * Un budget défini : les parties qu'il définit, et elles seules. Une table présente porte toutes ses
 * lignes ; une table absente n'est pas définie. Un réglage présent est défini ; absent, il ne l'est pas.
 * C'est la forme du fichier lu, et celle de l'état lu dans un projet.
 */
export interface BudgetDefini {
  tables: Partial<Record<CleTable, LigneBudget[]>>;
  settings: Partial<Omit<Settings, 'siteId'>>;
}

export type LectureBudgetJson = { ok: true; budget: BudgetDefini } | { ok: false; problemes: Probleme[]; message: string };

/** Les parties d'un budget à écrire ou à lire : des tables (clés de `Ledger`) et des clés de réglage. */
export type PartieBudget = CleTable | keyof Omit<Settings, 'siteId'>;

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const decrire = (v: unknown): string => {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
};

/** Le refus d'un budget JSON : le premier problème, et combien d'autres il y a. */
function refus(problemes: Probleme[], quoi = 'Ce budget JSON ne se lit pas'): { ok: false; problemes: Probleme[]; message: string } {
  const message = messageDeRefus(problemes).replace('Ce fichier Tirelire ne s’ouvre pas', quoi);
  return { ok: false, problemes, message };
}

/**
 * L'identifiant déduit du nom d'une ligne : le début de sa table et le nom, sans accent, en minuscules,
 * chaque suite d'autres caractères devenue un tiret — toujours le même pour le même nom. Un nom sans
 * lettre ni chiffre prend une empreinte du nom.
 */
export function identifiantDuNom(cle: CleTable, nom: string): string {
  const base = nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${PREFIXES_IDENTIFIANT[cle]}-${base || sha256Hex(nom).slice(0, 12)}`;
}

/**
 * Lit un budget JSON — son texte ou sa valeur déjà lue — seul, sans le projet : format, version,
 * colonnes, valeurs, identifiants, références entre ses propres lignes. Une référence vers une partie
 * qu'il ne définit pas se vérifie à l'application, contre le projet. Tout ou rien.
 */
export function lireBudgetJson(source: string | unknown): LectureBudgetJson {
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

  // Le compte principal du fichier, le seul de genre `principal` : il est celui du projet (D40).
  const comptes = Array.isArray(brut['accounts']) ? (brut['accounts'] as unknown[]) : [];
  const principaux = comptes.filter((a) => estObjet(a) && a['kind'] === 'principal') as Array<Record<string, unknown>>;
  if (principaux.length > 1)
    problemes.push({ table: 'accounts', colonne: 'kind', message: `accounts porte ${principaux.length} comptes de genre « principal » : un seul, celui du projet (D40).` });
  const idsPrincipal = new Set<unknown>([MAIN_ACCOUNT_ID]);
  if (principaux.length === 1) {
    const p = principaux[0]!;
    if (typeof p['id'] === 'string' && p['id']) idsPrincipal.add(p['id']);
    else if (typeof p['name'] === 'string' && p['name']) idsPrincipal.add(identifiantDuNom('accounts', p['name']));
  }
  const versProjet = (id: unknown): unknown => (idsPrincipal.has(id) ? MAIN_ACCOUNT_ID : id);

  // Chaque table présente, ligne par ligne.
  const tables: BudgetDefini['tables'] = {};
  for (const k of CLES_TABLES) {
    const t = TABLES[k]!;
    const valeur = brut[t.name];
    if (valeur === undefined) continue;
    const liste: LigneBudget[] = [];
    tables[k] = liste;
    if (!Array.isArray(valeur)) {
      problemes.push({ table: t.name, message: `${t.name} vaut ${decrire(valeur)}, qui n’est pas une liste de lignes.` });
      continue;
    }
    const vus = new Set<string>();
    const nomsSansId = new Set<string>();
    valeur.forEach((ligne, rang) => {
      const lue = lireLigne(k, t, ligne, rang, versProjet, problemes);
      if (!lue) return;
      if (lue.deduit) {
        const nom = String((ligne as Record<string, unknown>)['name']);
        if (nomsSansId.has(nom)) {
          problemes.push({ table: t.name, id: lue.nomLigne, colonne: 'id', message: `Deux lignes de ${t.name} s’appellent « ${nom} » sans identifiant : l’identifiant déduit du nom serait le même.` });
          return;
        }
        nomsSansId.add(nom);
      }
      if (vus.has(lue.ligne.id)) problemes.push({ table: t.name, id: lue.nomLigne, colonne: 'id', message: `L’identifiant « ${lue.ligne.id} » se répète dans la table ${t.name}.` });
      vus.add(lue.ligne.id);
      liste.push(lue.ligne);
    });
  }

  // Les réglages : chaque clé présente est définie.
  const settings: Record<string, unknown> = {};
  const reglages = brut['settings'];
  if (reglages !== undefined) {
    if (!estObjet(reglages)) problemes.push({ table: 'settings', message: `settings vaut ${decrire(reglages)}, qui n’est pas un objet.` });
    else
      for (const [cle, v] of Object.entries(reglages)) {
        const pb = settingProblem(cle, v === undefined || v === null ? null : JSON.stringify(v));
        if (pb) problemes.push({ table: 'settings', id: cle, colonne: 'value', message: pb });
        else if (v !== null && v !== undefined) settings[cle] = v;
      }
  }

  // Les références entre ses propres lignes : vers une table qu'il définit, la ligne doit y être.
  referencesInternes(tables, problemes);

  if (problemes.length) return refus(problemes);
  return { ok: true, budget: { tables, settings: settings as BudgetDefini['settings'] } };
}

/**
 * Les lignes qu'une ligne du budget désigne (« Les identifiants et les références ») : par une colonne
 * (`tirelire_id`, `account_id`, `parent_id`…) ou dans une colonne JSON (le placement, l'action). Le même
 * code sert à la lecture, qui les vérifie, et à l'écriture, qui porte les lignes retirées désignées
 * (D94, #409).
 */
function referencesDeLaLigne(t: TableDef, l: LigneBudget): Array<{ table: string; id: string; colonne: string; chemin: string }> {
  const refs: Array<{ table: string; id: string; colonne: string; chemin: string }> = [];
  for (const c of t.columns) {
    const x = l.v[c.col];
    if (x === null || x === undefined) continue;
    if (c.ref) refs.push({ table: c.ref, id: String(x), colonne: c.col, chemin: `${t.name}.${c.col}` });
    if (c.shape && typeof x === 'string') {
      let valeur: unknown;
      try {
        valeur = JSON.parse(x);
      } catch {
        continue;
      }
      for (const r of referencesDe(`${t.name}.${c.col}`, valeur, c.shape)) refs.push({ table: r.table, id: r.id, colonne: c.col, chemin: r.chemin });
    }
  }
  return refs;
}

/**
 * Les références d'une ligne vers une table que le fichier définit : elle doit y être, vivante ou
 * retirée (#409 ; le compte principal est toujours là). Une ligne retirée se vérifie comme une vivante.
 */
function referencesInternes(tables: BudgetDefini['tables'], problemes: Probleme[]): void {
  const ids = new Map<string, Set<string>>();
  for (const k of CLES_TABLES) {
    const l = tables[k];
    if (l) ids.set(TABLES[k]!.name, new Set(l.map((x) => x.id)));
  }
  ids.get('accounts')?.add(MAIN_ACCOUNT_ID);
  for (const k of CLES_TABLES) {
    const t = TABLES[k]!;
    for (const l of tables[k] ?? [])
      for (const r of referencesDeLaLigne(t, l)) {
        const cible = ids.get(r.table);
        if (cible && !cible.has(r.id)) problemes.push({ table: t.name, id: l.id, colonne: r.colonne, message: `${r.chemin} désigne « ${r.id} », absent de la table ${r.table} du budget JSON.` });
      }
  }
}

/** Une ligne retirée : sa suppression logique est posée (D58). */
const estRetiree = (v: Valeurs): boolean => v['deleted_at'] !== null && v['deleted_at'] !== undefined;

/**
 * Les lignes que porte un budget défini qui s'écrit (#409, point 1) : dans chaque table qu'il définit,
 * ses lignes vivantes et, de proche en proche, chaque ligne retirée de cette table qu'une ligne portée
 * désigne ; aucune autre ligne retirée. Une table qu'il ne définit pas n'y gagne aucune ligne. L'ordre
 * des lignes ne change pas.
 */
function lignesPortees(tables: BudgetDefini['tables']): BudgetDefini['tables'] {
  const parNom = new Map<string, { k: CleTable; parId: Map<string, LigneBudget> }>();
  for (const k of CLES_TABLES) {
    const l = tables[k];
    if (l) parNom.set(TABLES[k]!.name, { k, parId: new Map(l.map((x) => [x.id, x])) });
  }
  const portees = new Set<LigneBudget>();
  const aSuivre: Array<{ k: CleTable; l: LigneBudget }> = [];
  for (const k of CLES_TABLES) for (const l of tables[k] ?? []) if (!estRetiree(l.v)) aSuivre.push({ k, l }), portees.add(l);
  while (aSuivre.length) {
    const { k, l } = aSuivre.pop()!;
    for (const r of referencesDeLaLigne(TABLES[k]!, l)) {
      const cible = parNom.get(r.table);
      const designee = cible?.parId.get(r.id);
      if (!cible || !designee || portees.has(designee)) continue;
      portees.add(designee);
      aSuivre.push({ k: cible.k, l: designee });
    }
  }
  const out: BudgetDefini['tables'] = {};
  for (const k of CLES_TABLES) {
    const l = tables[k];
    if (l) out[k] = l.filter((x) => portees.has(x));
  }
  return out;
}

/**
 * Une ligne du JSON, convertie en valeurs du fichier, ses problèmes dits dans `problemes`. Sans
 * identifiant, il se déduit du nom ; sans l'un ni l'autre, la ligne est refusée.
 */
function lireLigne(
  k: CleTable,
  t: TableDef,
  ligne: unknown,
  rang: number,
  versProjet: (id: unknown) => unknown,
  problemes: Probleme[],
): { ligne: LigneBudget; nomLigne: string; deduit: boolean } | undefined {
  if (!estObjet(ligne)) {
    problemes.push({ table: t.name, id: `#${rang + 1}`, message: `La ligne ${rang + 1} de ${t.name} vaut ${decrire(ligne)}, qui n’est pas un objet.` });
    return undefined;
  }
  const idJson = ligne['id'];
  const nom = ligne['name'];
  let idLigne: string | undefined;
  let deduit = false;
  if (idJson === undefined || idJson === null) {
    if (typeof nom === 'string' && nom) {
      idLigne = identifiantDuNom(k, nom);
      deduit = true;
    }
  } else if (typeof idJson === 'string' && idJson) idLigne = idJson;
  const nomLigne = idLigne ?? `#${rang + 1}`;
  const nombre = problemes.length;
  if (idLigne === undefined)
    problemes.push({ table: t.name, id: nomLigne, colonne: 'id', message: idJson === undefined || idJson === null ? `${t.name}.id manque, et la ligne n’a pas de nom d’où le déduire.` : `${t.name}.id est un texte.` });
  const acceptees = COLONNES_BUDGET_JSON[t.name]!;
  for (const col of Object.keys(ligne))
    if (!acceptees.includes(col)) problemes.push({ table: t.name, id: nomLigne, colonne: col, message: `La colonne « ${t.name}.${col} » n’est pas du budget JSON.` });
  const v: Valeurs = {};
  for (const c of t.columns) {
    if (c.col === 'id') continue;
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
  if (idLigne === undefined) return undefined;
  // Seule la ligne du compte principal prend son identité : un identifiant n'est unique que dans sa table.
  const id = (t.name === 'accounts' && ligne['kind'] === 'principal' ? MAIN_ACCOUNT_ID : t.name === 'accounts' ? versProjet(idLigne) : idLigne) as string;
  if (problemes.length === nombre) {
    const pb = rowProblem(t, id, v);
    if (pb) {
      const m = new RegExp(`^${t.name}\\.(\\w+)`).exec(pb);
      problemes.push({ table: t.name, id: nomLigne, ...(m ? { colonne: m[1]! } : {}), message: pb });
    }
  }
  // Une ligne fautive reste lue, pour que ce qui la désigne ne soit pas compté en plus.
  return { ligne: { id, v }, nomLigne, deduit };
}

// ---------------------------------------------------------------------------
// Écrire un état
// ---------------------------------------------------------------------------

const TOUTES_PARTIES: PartieBudget[] = [...CLES_TABLES, ...(CLES_REGLAGES as Array<keyof Omit<Settings, 'siteId'>>)];

/**
 * L'état lu d'un projet, pour les parties choisies — toutes par défaut : toutes ses lignes, vivantes et
 * retirées, aux valeurs du fichier, et ses réglages. C'est l'état lu que garde l'assistant, et celui
 * d'un import : la différence y reconnaît une ligne que le projet porte déjà retirée (#409, point 4).
 */
export function etatLuDuProjet(projet: Ledger, parties: readonly PartieBudget[] = TOUTES_PARTIES): BudgetDefini {
  const tables: BudgetDefini['tables'] = {};
  const settings: Record<string, unknown> = {};
  for (const p of parties) {
    if ((CLES_TABLES as readonly string[]).includes(p)) {
      const k = p as CleTable;
      const t = TABLES[k]!;
      tables[k] = (projet[k] as unknown as Array<Record<string, unknown>>).map((r) => ({ id: r['id'] as string, v: enValeurs(t, r) }));
    } else if (CLES_REGLAGES.includes(p)) settings[p] = projet.settings[p as keyof Settings];
  }
  return { tables, settings: settings as BudgetDefini['settings'] };
}

/**
 * L'état d'un projet, pour les parties choisies — toutes par défaut : ses lignes vivantes et, de proche
 * en proche, les lignes retirées qu'elles désignent dans ces parties (#409, point 1), aux valeurs du
 * fichier, et ses réglages. C'est ce que `ecrireBudgetJson` écrit.
 */
export function etatDuProjet(projet: Ledger, parties: readonly PartieBudget[] = TOUTES_PARTIES): BudgetDefini {
  const lu = etatLuDuProjet(projet, parties);
  return { tables: lignesPortees(lu.tables), settings: lu.settings };
}

/**
 * Le budget JSON, en version 5, des parties choisies d'un projet — toutes par défaut : une valeur JSON,
 * prête à `JSON.stringify`. Une colonne vide n'est pas écrite. Relu, il redonne les mêmes lignes.
 */
export function ecrireBudgetJson(projet: Ledger, parties: readonly PartieBudget[] = TOUTES_PARTIES): Record<string, unknown> {
  return budgetDefiniEnJson(etatDuProjet(projet, parties));
}

/**
 * Le budget JSON, en version 5, d'un budget défini — ses parties, et elles seules : une valeur JSON,
 * prête à `JSON.stringify` (#379 : le brouillon de l'assistant s'enregistre ainsi). Il porte, dans
 * chaque table, les lignes vivantes et les lignes retirées qu'une ligne portée désigne (#409, point 1).
 */
export function budgetDefiniEnJson(etat: BudgetDefini): Record<string, unknown> {
  const out: Record<string, unknown> = { format: BUDGET_JSON_FORMAT, version: BUDGET_JSON_VERSION };
  const portees = lignesPortees(etat.tables);
  for (const k of CLES_TABLES) {
    const lignes = portees[k];
    if (!lignes) continue;
    const t = TABLES[k]!;
    out[t.name] = lignes.map((l) => {
      const o: Record<string, unknown> = { id: l.id };
      for (const c of t.columns) {
        if (c.col === 'id') continue;
        const x = l.v[c.col];
        if (x === null || x === undefined) continue;
        o[c.col] = c.type === 'json' ? JSON.parse(x as string) : c.type === 'boolean' ? x === 1 : x;
      }
      return o;
    });
  }
  if (Object.keys(etat.settings).length) out['settings'] = { ...etat.settings };
  return out;
}

// ---------------------------------------------------------------------------
// La différence
// ---------------------------------------------------------------------------

/** Une ligne du modèle (propriétés en camelCase), telle que le projet la porte. */
export type LigneModele = Record<string, unknown> & { id: string };

export interface ModificationLigne {
  id: string;
  avant: LigneModele;
  apres: LigneModele;
  /** Les colonnes changées, par nom SQL. */
  colonnes: string[];
}

export interface DifferenceTable {
  ajouts: LigneModele[];
  modifications: ModificationLigne[];
  retraits: LigneModele[];
  /**
   * Les lignes retirées du fichier que l'état lu ne porte pas, ni vivantes ni retirées : elles entrent
   * retirées, entières, avec la date de suppression du fichier (#409, point 4). Ce ne sont pas des ajouts
   * de lignes vivantes.
   */
  entreesRetirees: LigneModele[];
}

export interface DifferenceBudget {
  tables: Partial<Record<CleTable, DifferenceTable>>;
  reglages: Array<{ cle: keyof Omit<Settings, 'siteId'>; avant: unknown; apres: unknown }>;
}

const memesValeurs = (a: Valeurs, b: Valeurs): boolean => Object.keys({ ...a, ...b }).every((c) => (a[c] ?? null) === (b[c] ?? null));
const colonnesChangees = (t: TableDef, a: Valeurs, b: Valeurs): string[] => t.columns.filter((c) => c.col !== 'id' && (a[c.col] ?? null) !== (b[c.col] ?? null)).map((c) => c.col);
const jsonEgal = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Ce que le fichier change à un état lu — les mêmes parties, lues dans le projet à un moment donné :
 * partie par partie, les lignes ajoutées, modifiées (et leurs colonnes changées), retirées, et les
 * réglages changés. Une partie que le fichier ne définit pas n'a pas de différence. Le compte
 * principal ne se retire pas : il reste celui du projet (D40).
 *
 * Une ligne retirée du fichier (#409, point 4) : vivante dans l'état lu, elle est un retrait, comme si
 * le fichier ne la nommait pas ; retirée dans l'état lu, elle ne fait aucune différence, quelles que
 * soient ses colonnes ; absente de l'état lu, elle entre retirée (`entreesRetirees`). Une ligne de
 * l'état lu déjà retirée que le fichier ne nomme pas ne fait pas de différence non plus. Une ligne
 * vivante du fichier se diffère comme une ligne que l'état lu ne porte pas vivante.
 */
export function differenceBudget(fichier: BudgetDefini, etatLu: BudgetDefini): DifferenceBudget {
  const tables: DifferenceBudget['tables'] = {};
  for (const k of CLES_TABLES) {
    const venues = fichier.tables[k];
    if (!venues) continue;
    const t = TABLES[k]!;
    const lues = new Map((etatLu.tables[k] ?? []).map((l) => [l.id, l]));
    const d: DifferenceTable = { ajouts: [], modifications: [], retraits: [], entreesRetirees: [] };
    const nommees = new Set<string>();
    for (const l of venues) {
      const avant = lues.get(l.id);
      if (estRetiree(l.v)) {
        if (!avant) d.entreesRetirees.push(versModele(t, l));
        else if (estRetiree(avant.v)) nommees.add(l.id);
        continue; // vivante dans l'état lu : un retrait, comme si le fichier ne la nommait pas
      }
      nommees.add(l.id);
      if (!avant || estRetiree(avant.v)) d.ajouts.push(versModele(t, l));
      else if (!memesValeurs(avant.v, l.v)) d.modifications.push({ id: l.id, avant: versModele(t, avant), apres: versModele(t, l), colonnes: colonnesChangees(t, avant.v, l.v) });
    }
    for (const [id, l] of lues) if (!nommees.has(id) && !estRetiree(l.v) && !(k === 'accounts' && id === MAIN_ACCOUNT_ID)) d.retraits.push(versModele(t, l));
    tables[k] = d;
  }
  const reglages: DifferenceBudget['reglages'] = [];
  for (const [cle, apres] of Object.entries(fichier.settings)) {
    const avant = (etatLu.settings as Record<string, unknown>)[cle];
    if (!jsonEgal(avant, apres)) reglages.push({ cle: cle as keyof Omit<Settings, 'siteId'>, avant, apres });
  }
  return { tables, reglages };
}

/** La différence est-elle vide : rien à ajouter, modifier, retirer ni régler ? */
export function differenceVide(d: DifferenceBudget): boolean {
  return !d.reglages.length && Object.values(d.tables).every((x) => !x.ajouts.length && !x.modifications.length && !x.retraits.length && !x.entreesRetirees?.length);
}

// ---------------------------------------------------------------------------
// Appliquer la différence au projet du moment
// ---------------------------------------------------------------------------

/**
 * Une ligne que la différence touche et que le projet a changée depuis l'état lu : la version retenue
 * est celle de l'application, la plus récente (D58) ; l'écartée, celle du projet. `null` : la ligne
 * retirée, ou absente.
 */
export interface ConflitBudget {
  table: string;
  id: string;
  retenue: LigneModele | null;
  ecartee: LigneModele | null;
}

/**
 * Ce que l'application écrira : les lignes entières — une ligne qui entre retirée porte sa date de
 * suppression (#409) —, les retraits, les réglages ; et les conflits.
 */
export interface ApplicationBudget {
  ecritures: Array<{ cle: CleTable; ligne: LigneModele }>;
  retraits: Array<{ cle: CleTable; id: string }>;
  reglages: Partial<Omit<Settings, 'siteId'>>;
  conflits: ConflitBudget[];
}

export type PreparationBudget = ({ ok: true } & ApplicationBudget) | { ok: false; problemes: Probleme[]; message: string };

/**
 * Prépare l'application d'une différence au projet du moment, sans rien écrire : ce qui s'écrira, ce
 * qui se retirera, et les conflits — une ligne que la différence touche et que le projet a changée
 * depuis l'état lu (modifiée, ajoutée ou retirée). Ce que le projet a changé et que la différence ne
 * touche pas reste. Le projet qui en résulterait passe par la vérification d'un fichier ouvert (D58) :
 * une faute refuse le tout, en nommant la première et en comptant les autres.
 */
export function preparerApplication(difference: DifferenceBudget, etatLu: BudgetDefini, projet: Ledger): PreparationBudget {
  const ecritures: ApplicationBudget['ecritures'] = [];
  const retraits: ApplicationBudget['retraits'] = [];
  const conflits: ConflitBudget[] = [];
  for (const k of CLES_TABLES) {
    const d = difference.tables[k];
    if (!d) continue;
    const t = TABLES[k]!;
    const lues = new Map((etatLu.tables[k] ?? []).filter((l) => !estRetiree(l.v)).map((l) => [l.id, l.v]));
    const toutes = projet[k] as unknown as Array<Record<string, unknown>>;
    const courantes = new Map(toutes.filter((r) => !r['deletedAt']).map((r) => [r['id'] as string, r]));
    const dejaRetirees = new Set(toutes.filter((r) => r['deletedAt']).map((r) => r['id'] as string));
    const aChange = (id: string): boolean => {
      const lu = lues.get(id);
      const r = courantes.get(id);
      if (!lu || !r) return !lu !== !r;
      return !memesValeurs(lu, enValeurs(t, r));
    };
    const ecartee = (id: string): LigneModele | null => {
      const r = courantes.get(id);
      return r ? versModele(t, { id, v: enValeurs(t, r) }) : null;
    };
    for (const ligne of [...d.ajouts, ...d.modifications.map((m) => m.apres)]) {
      if (aChange(ligne.id)) conflits.push({ table: t.name, id: ligne.id, retenue: ligne, ecartee: ecartee(ligne.id) });
      ecritures.push({ cle: k, ligne });
    }
    for (const ligne of d.retraits) {
      if (aChange(ligne.id)) conflits.push({ table: t.name, id: ligne.id, retenue: null, ecartee: ecartee(ligne.id) });
      if (courantes.has(ligne.id)) retraits.push({ cle: k, id: ligne.id });
    }
    // Une ligne qui entre retirée (#409, point 4) : le projet du moment qui la porte déjà retirée n'en
    // reçoit rien ; qui l'a reçue vivante depuis l'état lu, c'est un conflit, et la version retenue,
    // retirée, en est le retrait ; sinon elle s'écrit, entière, avec sa date de suppression.
    for (const ligne of d.entreesRetirees ?? []) {
      if (dejaRetirees.has(ligne.id)) continue;
      if (courantes.has(ligne.id)) {
        conflits.push({ table: t.name, id: ligne.id, retenue: ligne, ecartee: ecartee(ligne.id) });
        retraits.push({ cle: k, id: ligne.id });
        continue;
      }
      ecritures.push({ cle: k, ligne });
    }
  }
  const reglages: Record<string, unknown> = {};
  for (const r of difference.reglages) {
    const lu = (etatLu.settings as Record<string, unknown>)[r.cle];
    const courant = projet.settings[r.cle];
    if (!jsonEgal(lu, courant))
      conflits.push({ table: 'settings', id: r.cle, retenue: { id: r.cle, value: r.apres }, ecartee: { id: r.cle, value: courant } });
    reglages[r.cle] = r.apres;
  }

  const problemes = verifierResultat(projet, ecritures, retraits, reglages);
  if (problemes.length) return refus(problemes, 'Ce budget ne s’applique pas');
  return { ok: true, ecritures, retraits, reglages: reglages as ApplicationBudget['reglages'], conflits };
}

/**
 * Le projet qui résulterait de l'application, vérifié comme un fichier ouvert (D58) : chaque ligne
 * écrite, et ce qui lie les lignes — une ligne retirée qu'une autre ligne vivante, une opération
 * comprise, désigne encore. Seuls comptent les problèmes que l'application fait naître : ceux que le
 * projet avait déjà ne sont pas les siens.
 *
 * Sauf ce qu'un ordre enregistré désigne (#407, point 4) : une tirelire ou un compte que
 * l'application retire reste dans le fichier, avec sa date de suppression, et un ordre permanent
 * que le projet porte peut encore le désigner — il reste ce que l'utilisateur a validé (D60, I10),
 * et le plan le signale. Une part ne refuse le tout que si sa tirelire n'est pas dans le fichier, ni
 * vivante ni retirée.
 */
function verifierResultat(projet: Ledger, ecritures: ApplicationBudget['ecritures'], retraits: ApplicationBudget['retraits'], reglages: Record<string, unknown>): Probleme[] {
  const problemes: Probleme[] = [];
  const ecrites = new Set<string>();
  for (const { cle, ligne } of ecritures) {
    const t = TABLES[cle]!;
    ecrites.add(`${t.name}\u0000${ligne.id}`);
    const pb = rowProblem(t, ligne.id, enValeurs(t, ligne));
    if (pb) {
      const m = new RegExp(`^${t.name}\\.(\\w+)`).exec(pb);
      problemes.push({ table: t.name, id: ligne.id, ...(m ? { colonne: m[1]! } : {}), message: pb });
    }
  }
  const retirees = new Set(retraits.map((r) => `${TABLES[r.cle]!.name}\u0000${r.id}`));
  for (const r of retraits) {
    const t = TABLES[r.cle]!;
    const ligne = (projet[r.cle] as unknown as Array<Record<string, unknown>>).find((x) => x['id'] === r.id)!;
    const pb = rowProblem(t, r.id, { ...enValeurs(t, ligne), deleted_at: new Date().toISOString() });
    if (pb) problemes.push({ table: t.name, id: r.id, message: pb });
  }
  for (const [cle, v] of Object.entries(reglages)) {
    const pb = settingProblem(cle, JSON.stringify(v));
    if (pb) problemes.push({ table: 'settings', id: cle, colonne: 'value', message: pb });
  }

  // Les liens, sur le projet avant et après : une ligne retirée n'est plus désignable.
  const lignesDe = (apres: boolean): Map<string, LigneLue[]> => {
    const m = new Map<string, LigneLue[]>();
    for (const k of Object.keys(TABLES)) {
      const t = TABLES[k]!;
      const parId = new Map<string, LigneLue>();
      for (const r of (projet[k as keyof Ledger] as unknown as Array<Record<string, unknown>>) ?? []) {
        const id = r['id'] as string;
        if (apres && retirees.has(`${t.name}\u0000${id}`)) continue;
        parId.set(id, { id, hlc: '', v: enValeurs(t, r) });
      }
      if (apres) for (const e of ecritures) if (e.cle === k) parId.set(e.ligne.id, { id: e.ligne.id, hlc: '', v: enValeurs(t, e.ligne) });
      m.set(t.name, [...parId.values()]);
    }
    return m;
  };
  const cleDe = (p: Probleme) => `${p.table}\u0000${p.id ?? ''}\u0000${p.colonne ?? ''}\u0000${p.message}`;
  const avant: Probleme[] = [];
  verifierLiens(lignesDe(false), avant);
  const dejaLa = new Set(avant.map(cleDe));
  const apres = lignesDe(true);
  const vivantes = new Map<string, boolean>();
  for (const [nom, l] of apres) for (const x of l) vivantes.set(`${nom}\u0000${x.id}`, x.v['deleted_at'] === null || x.v['deleted_at'] === undefined);
  const liens: Probleme[] = [];
  verifierLiens(apres, liens);
  // Les mêmes liens, les tirelires et les comptes retirés restés dans le fichier : un problème qui n'y
  // est plus vient d'une de ces lignes retirées, et ne compte pas quand un ordre enregistré le porte.
  const ordres = ordresEnregistres(projet);
  const sansRetires = new Set<string>();
  if (ordres.size) {
    const avecRetires = new Map(apres);
    for (const k of ['tirelires', 'accounts'] as const) {
      const t = TABLES[k]!;
      const presentes = new Set(apres.get(t.name)!.map((x) => x.id));
      const retireesIci = (projet[k] as unknown as Array<Record<string, unknown>>).filter((r) => retirees.has(`${t.name}\u0000${r['id'] as string}`) && !presentes.has(r['id'] as string));
      avecRetires.set(t.name, [...apres.get(t.name)!, ...retireesIci.map((r) => ({ id: r['id'] as string, hlc: '', v: { ...enValeurs(t, r), deleted_at: 'retirée' } }))]);
    }
    const encore: Probleme[] = [];
    verifierLiens(avecRetires, encore);
    const restent = new Set(encore.map(cleDe));
    for (const p of liens) if (!restent.has(cleDe(p))) sansRetires.add(cleDe(p));
  }
  for (const p of liens) {
    if (dejaLa.has(cleDe(p))) continue;
    if (p.table === 'planned_flows' && p.id && ordres.has(p.id) && sansRetires.has(cleDe(p))) continue;
    const source = `${p.table}\u0000${p.id ?? ''}`;
    // Une ligne déjà supprimée qui désigne une ligne retirée ne compte pas : elle n'existe plus.
    if (!ecrites.has(source) && vivantes.get(source) === false) continue;
    problemes.push(p);
  }
  return problemes;
}

/** Les ordres permanents que le projet porte (D57, D60) : un flux de virement vivant du compte principal vers un autre compte. */
function ordresEnregistres(projet: Ledger): Set<string> {
  return new Set(projet.plannedFlows.filter((f) => !f.deletedAt && standingOrderTarget(f, MAIN_ACCOUNT_ID) !== undefined).map((f) => f.id));
}

/**
 * Écrit sur le projet que tient `store` une application préparée par `preparerApplication` : chaque
 * ligne entière par `upsert`, chaque retrait par la suppression logique `remove`, chaque réglage par
 * `setSetting` (D58, D89). Elle a été vérifiée en entier sur ce projet : rien n'y est refusé.
 */
export function appliquerBudget(store: LedgerStore, application: ApplicationBudget): void {
  for (const { cle, ligne } of application.ecritures) store.upsert(cle, ligne as never);
  for (const { cle, id } of application.retraits) store.remove(cle, id);
  for (const [cle, v] of Object.entries(application.reglages)) store.setSetting(cle as keyof Settings, v as never);
}

/** L'import d'un budget JSON : lu seul, comparé au projet du moment comme état lu, préparé. */
export type ImportBudgetJson = { ok: true; difference: DifferenceBudget; application: ApplicationBudget } | { ok: false; problemes: Probleme[]; message: string };

/**
 * Importe un budget JSON sur un projet, sans rien écrire : l'état lu est le projet du moment, pour les
 * parties que le fichier définit. Appliquer donne au projet, pour chaque partie définie, exactement
 * les lignes du fichier (le compte principal reste celui du projet, D40).
 */
export function importerBudgetJson(source: string | unknown, projet: Ledger): ImportBudgetJson {
  const lu = lireBudgetJson(source);
  if (!lu.ok) return lu;
  const etatLu = etatLuDuProjet(projet, partiesDe(lu.budget));
  const difference = differenceBudget(lu.budget, etatLu);
  const prep = preparerApplication(difference, etatLu, projet);
  if (!prep.ok) return prep;
  const { ok: _ok, ...application } = prep;
  return { ok: true, difference, application };
}

/** Les parties qu'un budget défini définit. */
export function partiesDe(b: BudgetDefini): PartieBudget[] {
  return [...CLES_TABLES.filter((k) => b.tables[k]), ...(Object.keys(b.settings) as PartieBudget[])];
}

/** Une ligne du budget, rendue au modèle : propriétés en camelCase, JSON lu, booléens. */
function versModele(t: TableDef, l: LigneBudget): LigneModele {
  return { ...fromRow(t, l.v), id: l.id } as LigneModele;
}

/** Une ligne du modèle, aux valeurs du fichier, sa suppression logique comprise. */
function enValeurs(t: TableDef, r: Record<string, unknown>): Valeurs {
  const v: Valeurs = {};
  for (const c of t.columns) if (c.col !== 'id') v[c.col] = toSql(c, r[c.prop]);
  return v;
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


/** Une ligne du modèle, en ligne du budget (valeurs du fichier, sa suppression logique comprise) : ce que le brouillon de l'assistant garde (#379). */
export function ligneBudgetDuModele(cle: CleTable, r: Record<string, unknown> & { id: string }): LigneBudget {
  return { id: r.id, v: enValeurs(TABLES[cle]!, r) };
}

/** Une ligne du budget, rendue au modèle (#379). */
export function ligneBudgetVersModele(cle: CleTable, l: LigneBudget): LigneModele {
  return versModele(TABLES[cle]!, l);
}

/** Deux lignes du budget portent-elles les mêmes valeurs (#379) ? */
export function memesLignesBudget(a: LigneBudget, b: LigneBudget): boolean {
  return memesValeurs(a.v, b.v);
}
