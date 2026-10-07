/**
 * Le brouillon de l'assistant (D40) : ce que l'assistant change, tenu à côté du projet.
 *
 * L'assistant n'écrit pas dans le projet à chaque geste : il écrit dans son brouillon, et lit « le
 * projet, plus son brouillon » (`montrer`). Rien n'entre dans le projet avant `valider`, qui y écrit
 * exactement ce que l'assistant montre.
 *
 * Le brouillon ne copie pas le projet : il ne porte que ce que l'assistant a changé, lignes écrites
 * ou retirées et réglages. Ce que l'assistant montre est donc toujours le projet tel qu'il est, avec
 * le brouillon dessus, même si le projet bouge pendant que le brouillon attend ; et `valider`, qui
 * ne réécrit que le brouillon, se rejoue sans effet de bord si elle a été interrompue.
 *
 * Sans Svelte ni navigateur : l'état de l'application (`state.svelte.ts`) le tient et l'expose.
 */
import {
  DEFAULT_SETTINGS,
  LEDGER_KEYS,
  RowRefused,
  TABLES,
  alive,
  budgetSuggestions,
  rowProblem,
  settingProblem,
  type ApplicationBudget,
  type ColumnDef,
  type Ledger,
  type LedgerKey,
  type LedgerStore,
  type Settings,
} from '@tirelire/core';

/** Ce que porte toute ligne : son identifiant, et sa suppression logique quand sa table en a une. */
type Ligne = { id: string; deletedAt?: string };

export interface Brouillon {
  /** Les lignes que l'assistant a écrites ou retirées, par table puis par identifiant. */
  lignes: Partial<Record<LedgerKey, Record<string, Ligne>>>;
  /** Les réglages qu'il a changés. */
  reglages: Partial<Settings>;
  /** L'étape où il en est : on la retrouve en revenant dans l'assistant. */
  etape: string;
  /** Les étapes dont les propositions ont déjà été présentées : une fois par étape (D46). */
  semees: string[];
  /** Le projet était-il vierge à l'ouverture (D43) ? Figé : la première ligne préparée ne le change pas. */
  projetVierge: boolean;
  /**
   * Les réglages que l'ouverture propose d'elle-même, sur un projet vierge : le jour de début de
   * période et le coussin du compte principal de l'exemple (D43, D44). Figés avec `projetVierge`.
   * Ils sont montrés et validés comme les réglages préparés, qui l'emportent sur eux, mais ils ne
   * comptent pas comme préparés : un brouillon qui n'a que eux est intact.
   */
  reglagesProposes: Partial<Settings>;
  /**
   * Le brouillon vient d'un budget JSON importé (#367) : ses lignes sont celles du JSON, et l'assistant
   * n'y ajoute aucune proposition de l'exemple d'office (D46) ; les raccourcis restent offerts.
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
  return {
    lignes: {},
    reglages: {},
    etape: 'intro',
    semees: [],
    projetVierge: vierge,
    reglagesProposes: vierge ? reglagesDeLExemple(projet) : {},
  };
}

/**
 * Rien n'y est préparé : ni ligne, ni réglage, ni proposition présentée. Un brouillon intact ne se
 * retrouve pas en revenant dans l'assistant : l'ouverture repart du projet tel qu'il est, et son
 * état d'ouverture (projet vierge ou non) se relit.
 */
export function brouillonIntact(b: Brouillon): boolean {
  return (
    !b.budgetImporte &&
    b.semees.length === 0 &&
    Object.keys(b.reglages).length === 0 &&
    Object.values(b.lignes).every((table) => !table || Object.keys(table).length === 0)
  );
}

/** La table du brouillon pour `key`, créée à la demande. */
function table(b: Brouillon, key: LedgerKey): Record<string, Ligne> {
  return (b.lignes[key] ??= {});
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

/**
 * Écrit une ligne, entière, dans le brouillon : la ligne du projet qui porte le même identifiant est
 * masquée. Une ligne que le dépôt refuserait d'écrire est refusée ici, au geste qui la prépare, comme
 * le dépôt l'aurait refusée : la validation n'a alors pas à échouer en route sur une ligne mal formée.
 */
export function ecrire<K extends LedgerKey>(b: Brouillon, key: K, row: Ledger[K][number]): void {
  const ligne = row as unknown as Ligne;
  verifier(key, ligne);
  table(b, key)[ligne.id] = ligne;
}

/**
 * Retire une ligne du brouillon. Une ligne que le projet a déjà est marquée supprimée, comme le fait
 * le dépôt (suppression logique) ; une ligne que le brouillon a créée disparaît, le projet n'en a rien
 * à retirer. Un retrait que le dépôt refuserait — le compte principal ne se supprime pas — est refusé
 * ici, au geste, comme pour une ligne écrite.
 */
export function retirer(
  b: Brouillon,
  projet: Ledger,
  key: LedgerKey,
  id: string,
  maintenant: string = new Date().toISOString(),
): void {
  const duProjet = (projet[key] as Ligne[]).find((r) => r.id === id);
  if (!duProjet) {
    delete b.lignes[key]?.[id];
    return;
  }
  const courante = b.lignes[key]?.[id] ?? duProjet;
  if (courante.deletedAt) return;
  if (!duProjet.deletedAt) verifier(key, { ...duProjet, deletedAt: maintenant }); // la ligne que le dépôt supprimera
  table(b, key)[id] = { ...courante, deletedAt: maintenant };
}

/** Change un réglage dans le brouillon ; un réglage que le dépôt refuserait l'est ici, comme pour une ligne. */
export function reglage<K extends keyof Settings>(b: Brouillon, key: K, value: Settings[K]): void {
  if (key === 'siteId') return; // l'identité de l'instance n'est pas un réglage du foyer, le dépôt l'ignore aussi
  verifierReglage(key, value);
  b.reglages[key] = value;
}

/**
 * Le projet tel que l'assistant le montre : le projet, avec le brouillon dessus. Une ligne que le
 * brouillon réécrit garde sa place ; une ligne qu'il crée vient à la fin de sa table, dans l'ordre où
 * il l'a écrite.
 */
export function montrer(projet: Ledger, b: Brouillon): Ledger {
  const montre: Ledger = { ...projet, settings: { ...projet.settings, ...b.reglagesProposes, ...b.reglages } };
  for (const key of LEDGER_KEYS) {
    const changees = b.lignes[key];
    if (!changees) continue;
    const ids = Object.keys(changees);
    if (!ids.length) continue;
    const duProjet = projet[key] as Ligne[];
    const connus = new Set(duProjet.map((r) => r.id));
    const fusion = [...duProjet.map((r) => changees[r.id] ?? r), ...ids.filter((id) => !connus.has(id)).map((id) => changees[id]!)];
    (montre as unknown as Record<string, Ligne[]>)[key] = fusion;
  }
  return montre;
}

/**
 * Écrit dans le projet ce que le brouillon change : tout, en une seule suite d'écritures sans rien
 * d'asynchrone entre elles. L'application ne conserve le fichier qu'après un délai qui suit la
 * dernière écriture (`openStore`, `db.ts`) : ce qui est conservé est le projet d'avant ou le projet
 * d'après, jamais un projet à moitié écrit.
 *
 * Rien ne s'écrit si le dépôt refuserait une seule des écritures : toutes sont vérifiées avant la
 * première, et le refus (`RowRefused`) laisse le projet comme il était et le brouillon intact. Les
 * lignes et les réglages ont déjà été vérifiés à leur préparation ; c'est la même vérification, que
 * la validation refait pour ne pas dépendre de la façon dont le brouillon a été rempli.
 *
 * Rejouable : une ligne identique à celle du projet n'est pas réécrite par le dépôt, et une ligne
 * déjà supprimée l'est déjà. Si malgré tout une écriture échouait, ce qui a été écrit resterait, le
 * reste attendrait le prochain essai, et le brouillon, qui montre toujours le projet avec lui
 * dessus, n'aurait rien perdu.
 *
 * `projet` est le projet avant la première écriture : il dit quelles lignes un retrait doit supprimer.
 */
export function valider(store: LedgerStore, projet: Ledger, b: Brouillon): void {
  const ecritures: Array<() => void> = [];
  for (const key of LEDGER_KEYS) {
    const changees = b.lignes[key];
    if (!changees) continue;
    const duProjet = new Map((projet[key] as Ligne[]).map((r) => [r.id, r]));
    for (const [id, ligne] of Object.entries(changees)) {
      if (ligne.deletedAt) {
        const existante = duProjet.get(id);
        if (existante && !existante.deletedAt) {
          verifier(key, { ...existante, deletedAt: ligne.deletedAt });
          ecritures.push(() => store.remove(key, id));
        }
        continue;
      }
      verifier(key, ligne);
      ecritures.push(() => store.upsert(key, ligne as never));
    }
  }
  const reglages: Partial<Settings> = { ...b.reglagesProposes, ...b.reglages };
  for (const key of Object.keys(reglages) as Array<keyof Settings>) {
    verifierReglage(key, reglages[key]);
    ecritures.push(() => store.setSetting(key, reglages[key] as never));
  }
  for (const ecriture of ecritures) ecriture();
}

/**
 * Le brouillon d'un budget JSON importé (#366, #367, #378) : le projet et l'application préparée par
 * `importerBudgetJson` posée dessus, ouvert sur le résumé — les lignes écrites, les lignes retirées
 * (une partie définie par le fichier n'a que ses lignes) et les réglages. Aucune proposition de
 * l'exemple ne s'y ajoute, ni lignes ni réglages. L'application a été vérifiée sur ce projet : l'écrire
 * dans le brouillon ne refuse rien.
 */
export function brouillonDImport(projet: Ledger, application: ApplicationBudget): Brouillon {
  const b: Brouillon = { ...nouveauBrouillon(projet), reglagesProposes: {}, etape: 'summary', budgetImporte: true };
  for (const { cle, ligne } of application.ecritures) ecrire(b, cle, ligne as never);
  for (const { cle, id } of application.retraits) retirer(b, projet, cle, id);
  for (const [cle, valeur] of Object.entries(application.reglages)) reglage(b, cle as keyof Settings, valeur as never);
  return b;
}
