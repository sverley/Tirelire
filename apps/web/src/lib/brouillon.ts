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
  etatLuDuProjet,
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

/**
 * Les sections sur lesquelles l'assistant s'ouvre depuis l'écran de leur partie (D94, #363) : il n'y
 * couvre que leurs parties, et ne s'ouvre que sur leurs étapes, puis le résumé.
 */
export type SectionAssistant = 'comptes' | 'tirelires';

/** Les parties que couvre l'assistant ouvert sur une section : ce que ses étapes écrivent d'abord. */
export const PARTIES_DES_SECTIONS: Record<SectionAssistant, readonly PartieBudget[]> = {
  comptes: ['accounts', 'principalCushion'],
  tirelires: ['tirelires', 'needs'],
};

/** Ce que l'assistant s'appelle, complet ou ouvert sur une section : son titre, et le nom que lui donne le choix entre deux assistants. */
export function titreDeLAssistant(section?: SectionAssistant): string {
  return section === 'comptes' ? 'Compléter mes comptes' : section === 'tirelires' ? 'Compléter mes tirelires' : 'Construire mon budget';
}

/** La première étape de l'assistant ouvert sur une section : il s'ouvre sur elle, sans « Le principe ». */
const PREMIERE_ETAPE: Record<SectionAssistant, string> = { comptes: 'accounts', tirelires: 'everyday' };

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
  /**
   * L'assistant est ouvert sur une seule section, depuis l'écran de sa partie (#363) : le fichier ne
   * couvre que ses parties, et rien d'autre ne se propose d'office. Absent : l'assistant complet.
   */
  section?: SectionAssistant;
  /**
   * Les parties de l'assistant qu'un fichier repris ne définit pas, telles que le projet les portait à
   * la reprise (#379), ou que la section ne couvre pas, telles qu'il les portait à l'ouverture (#363) :
   * hors du fichier, elles ne s'enregistrent pas, et la validation n'y change rien. La première étape
   * qui en change une l'y fait entrer, avec cet état lu.
   */
  horsFichier?: BudgetDefini;
}

/** Fait entrer dans le fichier une partie qu'il ne définit pas encore, telle qu'elle a été lue. */
function definir(b: Brouillon, partie: string): void {
  const h = b.horsFichier;
  if (!h) return;
  const tables = h.tables as Record<string, unknown[] | undefined>;
  const settings = h.settings as Record<string, unknown>;
  if (tables[partie]) {
    (b.fichier.tables as Record<string, unknown>)[partie] = JSON.parse(JSON.stringify(tables[partie]));
    (b.etatLu.tables as Record<string, unknown>)[partie] = tables[partie];
    delete tables[partie];
  } else if (partie in settings) {
    (b.etatLu.settings as Record<string, unknown>)[partie] = settings[partie];
    delete settings[partie];
  }
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

/**
 * Un brouillon neuf : l'ouverture de l'assistant sur ce projet — complet, ou sur une seule section
 * (#363). Ouvert sur une section, il ne couvre que ses parties ; les autres sont lues hors du fichier,
 * et seul le réglage de la section se propose d'office sur un projet vierge : le coussin pour les
 * comptes, rien pour les tirelires — jamais le jour de début de période, qui appartient aux revenus (D44).
 */
export function nouveauBrouillon(projet: Ledger, section?: SectionAssistant): Brouillon {
  const vierge = projetEstVierge(projet);
  const parties = section ? PARTIES_DES_SECTIONS[section] : PARTIES_ASSISTANT;
  // L'état lu porte aussi les lignes que le projet a retirées : la différence les reconnaît (#409).
  const etatLu = etatLuDuProjet(projet, parties);
  const reglagesProposes: Partial<Settings> = {};
  if (vierge) for (const [cle, valeur] of Object.entries(reglagesDeLExemple(projet))) if (parties.includes(cle as PartieBudget)) Object.assign(reglagesProposes, { [cle]: valeur });
  const fichier = copie(etatLu);
  Object.assign(fichier.settings, reglagesProposes); // le garnissage d'office écrit dans le fichier (D46)
  const b: Brouillon = { fichier, etatLu, ouverture: JSON.stringify(fichier), etape: 'intro', semees: [], projetVierge: vierge, reglagesProposes };
  if (section) {
    b.section = section;
    b.etape = PREMIERE_ETAPE[section];
    b.horsFichier = etatLuDuProjet(projet, PARTIES_ASSISTANT.filter((p) => !parties.includes(p)));
  }
  return b;
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
  if (!b.fichier.tables[key]) definir(b, key);
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
  if (!(key in b.fichier.settings)) definir(b, key);
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
export function montrer(projet: Ledger, b: Brouillon, retireeLe: string = RETIREE): Ledger {
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
      if (lues.has(r.id) && !r.deletedAt && !(key === 'accounts' && r.id === MAIN_ACCOUNT_ID)) return { ...r, deletedAt: retireeLe };
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
  // Les parties hors du fichier comptent, sans différence : lues des deux côtés telles quelles.
  const h = b.horsFichier ?? { tables: {}, settings: {} };
  const fichier: BudgetDefini = { tables: { ...h.tables, ...b.fichier.tables }, settings: { ...h.settings, ...b.fichier.settings } };
  const etatLu: BudgetDefini = { tables: { ...h.tables, ...b.etatLu.tables }, settings: { ...h.settings, ...b.etatLu.settings } };
  const difference = differenceBudget(fichier, etatLu);
  return { difference, preparation: preparerApplication(difference, etatLu, projet) };
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
  const etatLu = etatLuDuProjet(projet, definies);
  const horsFichier = etatLuDuProjet(projet, manquantes);
  return {
    fichier,
    etatLu,
    ouverture: JSON.stringify(fichier),
    etape: 'summary',
    semees: [],
    projetVierge: projetEstVierge(projet),
    reglagesProposes: {},
    budgetImporte: true,
    horsFichier,
  };
}

/**
 * Le budget JSON à enregistrer (#379) : les parties du fichier, telles que l'assistant les montre — le
 * projet du moment avec la différence dessus. Repris sur le même projet, il redonne la même
 * différence. Ni l'étape, ni les étapes garnies : elles décrivent la session (D58).
 *
 * Une ligne retirée qu'une ligne portée désigne encore s'y écrit avec sa date de suppression (#409) :
 * celle du projet, ou, pour une ligne que le brouillon retire, le moment de l'enregistrement.
 */
export function fichierAEnregistrer(projet: Ledger, b: Brouillon, maintenant: string = new Date().toISOString()): BudgetDefini {
  return etatDuProjet(montrer(projet, b, maintenant), partiesDe(b.fichier));
}

/**
 * Les lignes d'une table que le fichier porte retirées (#409) : venues d'un budget JSON ou de l'état
 * lu, elles ne se montrent nulle part comme vivantes ; un ordre qui en désigne une la garde.
 */
export function retireesDuFichier(b: Brouillon, key: CleTableBudget): Set<string> {
  const lignes = b.fichier.tables[key] ?? b.horsFichier?.tables[key] ?? [];
  return new Set(lignes.filter((l) => l.v['deleted_at'] !== null && l.v['deleted_at'] !== undefined).map((l) => l.id));
}
