/**
 * Le brouillon de l'assistant (D40, D93, #379) : le budget JSON de #378, tenu à côté du projet.
 *
 * À l'ouverture, l'assistant écrit dans ce format les parties qu'il couvre — comptes, tirelires,
 * besoins, catégories, flux, le jour de début de période et le coussin — telles qu'il les lit dans le
 * projet, et garde cet état lu (`etatLu`). Chaque geste modifie ce fichier (`fichier`) ; ce qu'il ne
 * touche pas y reste tel quel. L'assistant montre le projet du moment avec la différence entre le
 * fichier et l'état lu posée dessus (`montrer`) : ce que le projet change pendant que le brouillon
 * attend se voit, sauf sur une ligne que l'assistant change aussi. Rien n'entre dans le projet avant
 * `valider`, qui n'y applique, par le cœur, que cette différence, tout en une fois.
 *
 * Sans Svelte ni navigateur : l'état de l'application (`state.svelte.ts`) le tient et l'expose.
 */
import {
  CLES_TABLES_BUDGET,
  DEFAULT_SETTINGS,
  MAIN_ACCOUNT_ID,
  RowRefused,
  TABLES,
  alive,
  appliquerBudget,
  budgetSuggestions,
  differenceBudget,
  etatDuProjet,
  ligneBudgetDuModele,
  ligneBudgetVersModele,
  memesLignesBudget,
  partiesDe,
  preparerApplication,
  rowProblem,
  settingProblem,
  type BudgetDefini,
  type CleTableBudget,
  type ColumnDef,
  type Ledger,
  type LedgerKey,
  type LedgerStore,
  type PartieBudget,
  type Settings,
} from '@tirelire/core';

/** Ce que porte toute ligne : son identifiant, et sa suppression logique quand sa table en a une. */
type Ligne = { id: string; deletedAt?: string };

/** Les parties du budget que l'assistant couvre : ses tables, et les réglages qu'il montre. */
export const PARTIES_ASSISTANT: readonly PartieBudget[] = [...CLES_TABLES_BUDGET, 'periodStartDay', 'principalCushion'];

/** La suppression logique que montre l'assistant sur une ligne que son brouillon retire. */
const RETIREE = '1970-01-01T00:00:00.000Z';

export interface Brouillon {
  /** Le fichier : le budget JSON que l'assistant prépare, partie par partie (#378). */
  fichier: BudgetDefini;
  /** L'état lu : les mêmes parties, telles que le projet les portait quand le fichier a été ouvert. */
  etatLu: BudgetDefini;
  /** Le fichier tel qu'il était à l'ouverture, garnissage d'office compris : de quoi dire s'il a changé. */
  ouverture: string;
  /** L'étape où il en est : on la retrouve en revenant dans l'assistant. Hors du fichier (D58). */
  etape: string;
  /** Les étapes dont les propositions ont déjà été présentées : une fois par étape (D46). Hors du fichier. */
  semees: string[];
  /** Le projet était-il vierge à l'ouverture (D43) ? Figé : la première ligne préparée ne le change pas. */
  projetVierge: boolean;
  /**
   * Les réglages que l'ouverture a écrits d'office dans le fichier, sur un projet vierge : le jour de
   * début de période et le coussin du compte principal de l'exemple (D43, D44, D46).
   */
  reglagesProposes: Partial<Settings>;
  /**
   * Le brouillon vient d'un budget JSON importé ou repris (#367, #379) : l'assistant n'y ajoute aucune
   * proposition de l'exemple d'office (D46) ; les raccourcis restent offerts.
   */
  budgetImporte?: true;
}

/**
 * Un projet vierge : aucune tirelire, aucun besoin, aucun flux, aucun compte en plus du principal
 * (D43). Les opérations ne comptent pas : un relevé peut avoir été importé avant que le budget existe.
 */
export function projetEstVierge(projet: Ledger): boolean {
  return (
    alive(projet.tirelires).length === 0 &&
    alive(projet.needs).length === 0 &&
    alive(projet.plannedFlows).length === 0 &&
    alive(projet.accounts).filter((a) => a.kind !== 'principal').length === 0
  );
}

/**
 * Ce que l'exemple dit des réglages, pour un projet vierge : le jour de début de période et le coussin
 * (D44, D41). Un réglage que le projet a déjà posé n'est pas remplacé : « à renseigner » se lit à sa
 * valeur par défaut, comme pour le nom et le solde du compte principal (D43 : rouvrir l'assistant ne
 * doit rien casser).
 */
function reglagesDeLExemple(projet: Ledger): Partial<Settings> {
  const exemple = budgetSuggestions();
  const proposes: Partial<Settings> = {};
  if (projet.settings.periodStartDay === DEFAULT_SETTINGS.periodStartDay) proposes.periodStartDay = exemple.periodStartDay;
  if (projet.settings.principalCushion === DEFAULT_SETTINGS.principalCushion) proposes.principalCushion = exemple.mainAccount.cushion;
  return proposes;
}

/** Un brouillon neuf : l'ouverture de l'assistant sur ce projet. */
export function nouveauBrouillon(projet: Ledger): Brouillon {
  const vierge = projetEstVierge(projet);
  const etatLu = etatDuProjet(projet, PARTIES_ASSISTANT);
  const reglagesProposes = vierge ? reglagesDeLExemple(projet) : {};
  const fichier = copie(etatLu);
  Object.assign(fichier.settings, reglagesProposes); // le garnissage d'office écrit dans le fichier (D46)
  return { fichier, etatLu, ouverture: JSON.stringify(fichier), etape: 'intro', semees: [], projetVierge: vierge, reglagesProposes };
}

const copie = (b: BudgetDefini): BudgetDefini => JSON.parse(JSON.stringify(b)) as BudgetDefini;

/**
 * Rien n'y est préparé : le fichier est celui de l'ouverture, et aucune proposition n'a été présentée.
 * Un brouillon intact ne se retrouve pas en revenant dans l'assistant : l'ouverture repart du projet
 * tel qu'il est, et son état d'ouverture (projet vierge ou non) se relit.
 */
export function brouillonIntact(b: Brouillon): boolean {
  return !b.budgetImporte && b.semees.length === 0 && JSON.stringify(b.fichier) === b.ouverture;
}

/** La valeur d'une colonne telle que le dépôt la range : de quoi demander à `rowProblem` si la ligne s'écrira. */
function rangee(col: ColumnDef, valeur: unknown): string | number | null {
  if (valeur === undefined || valeur === null) return null;
  switch (col.type) {
    case 'json':
      return JSON.stringify(valeur);
    case 'boolean':
      return valeur ? 1 : 0;
    case 'integer':
    case 'real':
      return Number(valeur);
    default:
      return String(valeur);
  }
}

/** Refuse, comme le dépôt le ferait avant d'écrire, une ligne qui ne s'écrirait pas. */
function verifier(key: LedgerKey, ligne: Ligne): void {
  const t = TABLES[key]!;
  const v: Record<string, string | number | null> = {};
  for (const col of t.columns) if (col.prop !== 'id') v[col.col] = rangee(col, (ligne as Record<string, unknown>)[col.prop]);
  const probleme = rowProblem(t, ligne.id, v);
  if (probleme) throw new RowRefused(t.name, probleme);
}

/** Refuse, comme le dépôt le ferait avant d'écrire, un réglage qui ne s'écrirait pas. */
function verifierReglage(key: keyof Settings, value: unknown): void {
  const probleme = settingProblem(key, value === undefined ? null : JSON.stringify(value));
  if (probleme) throw new RowRefused('settings', probleme);
}

const estTableDuBudget = (key: LedgerKey): key is CleTableBudget => (CLES_TABLES_BUDGET as readonly string[]).includes(key);

/** Les lignes du fichier pour `key` : une table que l'assistant ne couvre pas ne s'y écrit pas. */
function lignesDuFichier(b: Brouillon, key: LedgerKey) {
  if (!estTableDuBudget(key)) throw new Error(`L’assistant n’écrit pas la table « ${key} » : elle n’est pas dans son brouillon.`);
  return (b.fichier.tables[key] ??= []);
}

/**
 * Écrit une ligne, entière, dans le fichier : elle remplace celle qui porte le même identifiant, ou
 * s'ajoute à la fin de sa table. Une ligne que le dépôt refuserait d'écrire est refusée ici, au geste
 * qui la prépare, comme le dépôt l'aurait refusée.
 */
export function ecrire<K extends LedgerKey>(b: Brouillon, key: K, row: Ledger[K][number]): void {
  const ligne = row as unknown as Ligne;
  verifier(key, ligne);
  const lignes = lignesDuFichier(b, key);
  const l = ligneBudgetDuModele(key as CleTableBudget, ligne as Ligne & Record<string, unknown>);
  const i = lignes.findIndex((x) => x.id === ligne.id);
  if (i >= 0) lignes[i] = l;
  else lignes.push(l);
}

/**
 * Retire une ligne du fichier. Une ligne que le projet porte et que l'état lu ne connaissait pas — le
 * projet l'a reçue depuis l'ouverture — y est ajoutée, pour que la différence la retire. Un retrait
 * que le dépôt refuserait — le compte principal ne se supprime pas — est refusé ici, au geste.
 */
export function retirer(
  b: Brouillon,
  projet: Ledger,
  key: LedgerKey,
  id: string,
  maintenant: string = new Date().toISOString(),
): void {
  const duProjet = (projet[key] as Ligne[]).find((r) => r.id === id && !r.deletedAt);
  if (duProjet) verifier(key, { ...duProjet, deletedAt: maintenant }); // la ligne que le dépôt supprimera
  const lignes = lignesDuFichier(b, key);
  const i = lignes.findIndex((x) => x.id === id);
  if (i >= 0) lignes.splice(i, 1);
  const lues = (b.etatLu.tables[key as CleTableBudget] ??= []);
  if (duProjet && !lues.some((x) => x.id === id)) lues.push(ligneBudgetDuModele(key as CleTableBudget, duProjet as Ligne & Record<string, unknown>));
}

/** Change un réglage dans le fichier ; un réglage que le dépôt refuserait l'est ici, comme pour une ligne. */
export function reglage<K extends keyof Settings>(b: Brouillon, key: K, value: Settings[K]): void {
  if (key === 'siteId') return; // l'identité de l'instance n'est pas un réglage du foyer, le dépôt l'ignore aussi
  verifierReglage(key, value);
  (b.fichier.settings as Record<string, unknown>)[key] = value;
}

const jsonEgal = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Le projet tel que l'assistant le montre : le projet du moment, avec la différence du fichier dessus.
 * Une ligne que le fichier change garde sa place et prend sa version ; une ligne qu'il retire se montre
 * supprimée ; une ligne qu'il ajoute vient à la fin de sa table, dans l'ordre du fichier ; une ligne
 * qu'il ne change pas est celle du projet, telle qu'elle est maintenant. Le compte principal ne se
 * retire pas (D40).
 */
export function montrer(projet: Ledger, b: Brouillon): Ledger {
  const settings: Record<string, unknown> = { ...projet.settings };
  for (const [cle, valeur] of Object.entries(b.fichier.settings))
    if (!jsonEgal(valeur, (b.etatLu.settings as Record<string, unknown>)[cle])) settings[cle] = valeur;
  const montre: Ledger = { ...projet, settings: settings as unknown as Settings };
  for (const key of CLES_TABLES_BUDGET) {
    const venues = b.fichier.tables[key];
    if (!venues) continue;
    const lues = new Map((b.etatLu.tables[key] ?? []).map((l) => [l.id, l]));
    const fichier = new Map(venues.map((l) => [l.id, l]));
    const change = (id: string): boolean => {
      const f = fichier.get(id)!;
      const l = lues.get(id);
      return !l || !memesLignesBudget(f, l);
    };
    const duProjet = projet[key] as unknown as Ligne[];
    const connus = new Set(duProjet.map((r) => r.id));
    const fusion: Ligne[] = duProjet.map((r) => {
      if (fichier.has(r.id)) return change(r.id) ? ligneBudgetVersModele(key, fichier.get(r.id)!) : r;
      if (lues.has(r.id) && !r.deletedAt && !(key === 'accounts' && r.id === MAIN_ACCOUNT_ID)) return { ...r, deletedAt: RETIREE };
      return r;
    });
    for (const l of venues) if (!connus.has(l.id)) fusion.push(ligneBudgetVersModele(key, l));
    (montre as unknown as Record<string, Ligne[]>)[key] = fusion;
  }
  return montre;
}

/**
 * Ce que la validation fera sur le projet du moment : la différence entre le fichier et l'état lu,
 * préparée par le cœur (#378) — ce qui s'écrira, se retirera, les conflits —, ou son refus.
 */
export function preparerValidation(projet: Ledger, b: Brouillon) {
  const difference = differenceBudget(b.fichier, b.etatLu);
  return { difference, preparation: preparerApplication(difference, b.etatLu, projet) };
}

/**
 * Applique au projet la différence entre le fichier et l'état lu, par le cœur (#378) : tout, en une
 * seule suite d'écritures sans rien d'asynchrone entre elles. Ce que le projet a changé ailleurs et
 * que le fichier ne change pas reste ; une ligne changée des deux côtés prend la version de
 * l'assistant (D58). Le projet qui en résulterait est vérifié avant la première écriture : un refus
 * (`RowRefused`) dit le premier problème et le nombre des autres, et laisse le projet comme il était
 * et le brouillon intact.
 *
 * `projet` est le projet du moment, avant la première écriture.
 */
export function valider(store: LedgerStore, projet: Ledger, b: Brouillon): void {
  const { preparation } = preparerValidation(projet, b);
  if (!preparation.ok) throw new RowRefused('budget', preparation.message);
  appliquerBudget(store, preparation);
}

/**
 * Le brouillon d'un budget JSON lu (#367, #378, #379) : le fichier est celui-là, l'état lu est le
 * projet du moment pour les parties qu'il définit ; les parties de l'assistant qu'il ne définit pas sont
 * lues dans le projet, sans différence. Ouvert sur le résumé, sans proposition de l'exemple.
 */
export function brouillonDuFichier(projet: Ledger, budget: BudgetDefini): Brouillon {
  const definies = partiesDe(budget);
  const manquantes = PARTIES_ASSISTANT.filter((p) => !definies.includes(p));
  const fichier = copie(budget);
  const etatLu = etatDuProjet(projet, definies);
  const lu = etatDuProjet(projet, manquantes);
  for (const [k, lignes] of Object.entries(lu.tables)) {
    (fichier.tables as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(lignes));
    (etatLu.tables as Record<string, unknown>)[k] = lignes;
  }
  Object.assign(fichier.settings, lu.settings);
  Object.assign(etatLu.settings, lu.settings);
  return {
    fichier,
    etatLu,
    ouverture: JSON.stringify(fichier),
    etape: 'summary',
    semees: [],
    projetVierge: projetEstVierge(projet),
    reglagesProposes: {},
    budgetImporte: true,
  };
}

/**
 * Le budget JSON à enregistrer (#379) : les parties du fichier, telles que l'assistant les montre — le
 * projet du moment avec la différence dessus —, en version 2. Repris sur le même projet, il redonne
 * la même différence. Ni l'étape, ni les étapes garnies : elles décrivent la session (D58).
 */
export function fichierAEnregistrer(projet: Ledger, b: Brouillon): BudgetDefini {
  return etatDuProjet(montrer(projet, b), partiesDe(b.fichier));
}
