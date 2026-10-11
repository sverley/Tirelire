/**
 * La section Catégories (#365, règle des sections, D94) : la ligne d'une catégorie et la correction de
 * son nom sur place, avec le refus d'un doublon (D61) ; ce que la ligne dit de sa parente, de sa
 * tirelire par défaut (D32) et des flux qui la portent ; son retrait ; les raccourcis de l'exemple et
 * leurs liens (D46, #212) ; le formulaire d'ajout avec ses aides (#214) et le garnissage d'un projet
 * vierge — écrits une fois, ici, pour l'étape Catégories de l'assistant et l'écran Catégories.
 *
 * Ce qui change d'un endroit à l'autre se donne à la construction, et rien d'autre : la destination
 * des écritures (le brouillon de l'assistant, #210, ou le projet) et la ligne d'où viennent les aides
 * du formulaire (D43 : dans l'assistant, celle du premier raccourci restant de l'étape ; hors de lui,
 * une ligne de l'exemple de la nature choisie), que l'endroit lit dans `lib/aides`. Le garnissage d'office ne se fait que sur demande de
 * l'endroit (`garnir`), que l'assistant seul fait, sur un projet vierge (D46). Le texte d'explication
 * et les champs montrés sont ceux du composant (`SectionCategories.svelte`) et de l'endroit qui
 * l'emploie.
 */
import {
  alive,
  budgetSuggestions,
  findCategoryByName,
  suggestedCategory,
  type Category,
  type CategoryNature,
  type CategorySuggestion,
  type Id,
  type Ledger,
  type LedgerKey,
  type PlannedFlow,
} from '@tirelire/core';
import { recopieCategorie, type AideCategorie } from './aides';

/** Où la section lit et écrit : le brouillon de l'assistant, ou le projet. */
export interface DestinationDesCategories {
  readonly ledger: Ledger;
  upsert<K extends LedgerKey>(key: K, row: Ledger[K][number]): void;
  remove(key: LedgerKey, id: string): void;
  newId(): Id;
}

/** Où l'endroit prend la ligne d'aide du formulaire : parmi les raccourcis restants et l'exemple, pour la nature choisie s'il y en a une (D43). */
export type AideDuFormulaire = (restantes: readonly CategorySuggestion[], toutes: readonly CategorySuggestion[], nature: CategoryNature | undefined) => AideCategorie | undefined;

/** Les natures, dans l'ordre où la section les range, avec ce qu'elle en dit. Typée : une nature renommée casse la compilation. */
export const NATURES_DE_CATEGORIE: Array<{ nature: CategoryNature; titre: string; vide: string; libelle: string }> = [
  { nature: 'expense', titre: 'Dépenses', vide: 'Aucune catégorie de dépense pour l’instant.', libelle: 'Dépense' },
  { nature: 'income', titre: 'Revenus', vide: 'Aucune catégorie de revenu pour l’instant.', libelle: 'Revenu' },
];

/** Ce que le formulaire d'ajout porte en plus, là où l'endroit montre les champs avancés (D59). */
export interface ChampsAvances {
  parentId?: string | undefined;
  tirelireId?: string | undefined;
}

export class SectionCategories {
  readonly #d: DestinationDesCategories;
  readonly #aide: AideDuFormulaire;
  constructor(destination: DestinationDesCategories, aide: AideDuFormulaire) {
    this.#d = destination;
    this.#aide = aide;
  }

  // --- Lecture ---
  get categories(): Category[] {
    return alive(this.#d.ledger.categories);
  }
  get tirelires() {
    return alive(this.#d.ledger.tirelires);
  }
  get flows(): PlannedFlow[] {
    return alive(this.#d.ledger.plannedFlows);
  }
  /** Les catégories d'une nature, dans l'ordre où la destination les porte. */
  readonly deNature = (nature: CategoryNature) => this.categories.filter((c) => c.nature === nature);

  /** Ce que la ligne dit d'une catégorie : sa catégorie parente, sa tirelire par défaut et les flux qui la portent, une fois chacun. */
  readonly detail = (c: Category): string => {
    const parties: string[] = [];
    const parent = c.parentId ? this.categories.find((x) => x.id === c.parentId)?.name : undefined;
    if (parent) parties.push(`Dans « ${parent} »`);
    const tirelire = c.tirelireId ? this.tirelires.find((t) => t.id === c.tirelireId)?.name : undefined;
    if (tirelire) parties.push(`Tirelire par défaut : ${tirelire}`);
    const portes = [...new Set(this.flows.filter((f) => f.action?.categoryId === c.id).map((f) => f.name))];
    if (portes.length) parties.push(`Flux : ${portes.join(', ')}`);
    return parties.join(' · ');
  };

  /**
   * Deux catégories de même nature ne portent pas le même nom (D61) : le message dit laquelle existe
   * déjà. `sauf` est la catégorie qu'on renomme, qui ne fait pas doublon avec elle-même (« santé » pour « Santé »).
   */
  readonly doublonDe = (nom: string, nature: CategoryNature, sauf?: string): string => {
    const existante = findCategoryByName(this.categories.filter((x) => x.id !== sauf), nom, nature);
    return existante ? `Une catégorie « ${existante.name} » existe déjà pour cette nature.` : '';
  };

  // --- Raccourcis de l'exemple (D43, D46) : toujours offerts ; un raccourci déjà repris disparaît ---
  readonly propositions = budgetSuggestions().categories;
  /** Une catégorie de même nature et de même nom n'est plus proposée : une catégorie se reconnaît à sa nature et à son nom (D46, D61). */
  get restantes(): CategorySuggestion[] {
    return this.propositions.filter((p) => !findCategoryByName(this.categories, p.name, p.nature));
  }
  /**
   * Une catégorie de l'exemple, avec ses liens vers ce qui existe ici, par noms (D46) : sa tirelire
   * par défaut quand une tirelire porte le nom que l'exemple dit — sinon elle se garde sans (D32, I3) —,
   * et chaque flux que l'exemple lui donne : le flux de même nom et de même genre, quand il n'a pas
   * déjà une catégorie, que celle posée l'emporte.
   */
  readonly appliquer = (p: CategorySuggestion) => {
    const id = this.#d.newId();
    const tirelire = p.tirelireName === undefined ? undefined : this.tirelires.find((t) => t.name === p.tirelireName);
    this.#d.upsert('categories', suggestedCategory(p, { id, ...(tirelire ? { tirelireId: tirelire.id } : {}) }));
    for (const lie of p.flows) {
      for (const f of this.flows.filter((x) => x.name === lie.name && x.kind === lie.kind && x.action?.categoryId === undefined)) {
        this.#d.upsert('plannedFlows', { ...f, action: { ...f.action, categoryId: id } });
      }
    }
  };
  /** Le garnissage d'office : chaque raccourci restant repris. L'endroit décide s'il le fait (D46). */
  garnir() {
    this.restantes.forEach(this.appliquer);
  }

  // --- Formulaire d'ajout et ses aides (#214) ---
  /** La nature se choisit ; tant qu'on n'y a pas touché (`undefined`), elle est celle de la ligne d'aide (#214). */
  saisie = $state<{ name: string; nature?: CategoryNature | undefined }>({ name: '' });
  saisieError = $state('');
  /** La ligne d'aide du formulaire, telle que l'endroit la prend (D43). */
  get aideDuFormulaire(): AideCategorie | undefined {
    return this.#aide(this.restantes, this.propositions, this.saisie.nature);
  }
  get natureSaisie(): CategoryNature {
    return this.saisie.nature ?? this.aideDuFormulaire?.nature ?? 'expense';
  }
  /** Rouvre le formulaire vide, à cette nature, ou à celle de l'aide. */
  vider(nature?: CategoryNature) {
    this.saisie = nature ? { name: '', nature } : { name: '' };
    this.saisieError = '';
  }
  /**
   * Ajoute la catégorie saisie. Avec le nom et la nature de son aide, sans rien d'autre de choisi, elle
   * fait ce que fait le raccourci de cette ligne, liens compris (#214). Rend vrai si elle est ajoutée.
   */
  ajouter(avances: ChampsAvances = {}): boolean {
    this.ligneError = '';
    const nom = this.saisie.name.trim();
    if (!nom) return void (this.saisieError = 'Donnez un nom à cette catégorie.'), false;
    const nature = this.natureSaisie;
    const refus = this.doublonDe(nom, nature);
    if (refus) return void (this.saisieError = refus), false;
    const ligne = this.aideDuFormulaire;
    if (ligne && !avances.parentId && !avances.tirelireId && recopieCategorie({ name: nom, nature }, ligne)) {
      this.appliquer(ligne.ligne);
      this.saisie = { name: '' };
    } else {
      this.#d.upsert('categories', {
        id: this.#d.newId(),
        name: nom,
        nature,
        ...(avances.parentId ? { parentId: avances.parentId } : {}),
        ...(nature === 'expense' && avances.tirelireId ? { tirelireId: avances.tirelireId } : {}),
      } satisfies Category);
      this.saisie = { ...this.saisie, name: '' };
    }
    this.saisieError = '';
    return true;
  }

  // --- La ligne : correction du nom sur place, retrait ---
  /** Ce qu'un geste sur une ligne refuse (renommer en doublon, retirer une parente), dit sous la liste jusqu'au geste suivant. */
  ligneError = $state('');
  /** Efface ce que les gestes ont refusé : au geste suivant, et quand on quitte l'endroit. */
  effacerErreurs() {
    this.ligneError = '';
    this.saisieError = '';
  }
  /**
   * Renomme une catégorie, aussitôt écrit là où la section écrit ; un nom vide ou déjà pris par une
   * catégorie de même nature est refusé, et le dit. Rend faux quand le champ doit reprendre le nom d'avant.
   */
  renommer(c: Category, valeur: string): boolean {
    this.saisieError = '';
    const nom = valeur.trim();
    const refus = !nom ? 'Le nom est obligatoire.' : nom === c.name ? '' : this.doublonDe(nom, c.nature, c.id);
    this.ligneError = refus;
    if (refus || nom === c.name) return false;
    this.#d.upsert('categories', { ...c, name: nom });
    return true;
  }
  /** Ce qui empêche de retirer une catégorie : celles qu'elle porte. */
  refusDuRetrait(c: Category): string {
    const enfants = this.categories.filter((x) => x.parentId === c.id).length;
    return enfants ? `« ${c.name} » a ${enfants} sous-catégorie(s) : détachez-les ou retirez-les d’abord.` : '';
  }
  /**
   * Retire une catégorie, et elle ne reste sur aucun flux. Une catégorie qui en porte d'autres ne se
   * retire pas, et la ligne le dit. `confirmer` est l'accord que l'endroit demande avant de retirer :
   * l'écran Catégories le demande, l'assistant non. Les opérations ne sont pas touchées : celles qui
   * sont déjà classées gardent leur ventilation.
   */
  retirer(c: Category, confirmer: () => boolean = () => true) {
    this.saisieError = '';
    const refus = this.refusDuRetrait(c);
    this.ligneError = refus;
    if (refus || !confirmer()) return;
    for (const f of this.flows.filter((f) => f.action?.categoryId === c.id)) {
      const { categoryId: _retiree, ...action } = f.action!;
      const { action: _avant, ...sans } = f;
      this.#d.upsert('plannedFlows', Object.keys(action).length ? { ...sans, action } : sans);
    }
    this.#d.remove('categories', c.id);
  }
}
