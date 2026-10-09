/**
 * La ventilation d'un ordre permanent (#394, D21, D27, D60, D94) : sa lecture, part par part, avec
 * ce que les parts n'absorbent pas, non affecté sur le compte d'accueil ; sa correction dans un
 * panneau, et les refus de ce panneau. Écrite une fois, ici et dans `VentilationOrdre.svelte` et
 * `PanneauVentilation.svelte`, pour l'écran Plan et l'étape de l'assistant qui montre les virements
 * permanents déjà en place.
 *
 * Tout s'y lit en positif : le montant de l'ordre et ses parts, quel que soit le compte où l'ordre
 * est décrit. Le signe se rend à l'écriture (`ventilationSignee`).
 */
import { resolveShares, type AllocationLine, type Cents, type Category, type Id, type PlannedFlow, type Share, type SubOperation, type Tirelire } from '@tirelire/core';
import { centsToInput, inputToCents, money } from './format';

/** Le texte qui explique la ventilation : affiché dans l'assistant, replié sur l'écran Plan (D94). */
export const EXPLICATION_VENTILATION =
  'Un ordre permanent se répartit entre vos tirelires en parts : une part fixe (un montant), une part en pourcentage du montant de l’ordre, ou la part restante, qui prend ce qui reste. Ce que les parts n’absorbent pas reste non affecté sur le compte qui reçoit le virement.';

export interface LigneDeVentilation {
  /** Ce que la part nomme : la tirelire, la catégorie, ou les deux. */
  nom: string;
  /** Sa forme, en mots : « part fixe », « 30 % », « le reste ». */
  forme: string;
  /** Son montant pour le montant de l'ordre, en positif. */
  montant: Cents;
  tirelireId?: Id;
  share: Share;
  /** La tirelire de la part est retirée : la part se montre sous son nom, marquée comme retirée (#407). */
  retiree?: true;
}

export interface LectureDeVentilation {
  lignes: LigneDeVentilation[];
  /** Le montant de l'ordre moins la somme des parts : négatif quand les parts le dépassent. */
  nonAffecte: Cents;
}

export interface Noms {
  /** Les tirelires vivantes : celles qu'une part peut nommer, et que le panneau propose. */
  tirelires: Array<Pick<Tirelire, 'id' | 'name'>>;
  categories: Array<Pick<Category, 'id' | 'name'>>;
  /**
   * Les tirelires retirées, que la part d'un ordre enregistré peut encore nommer (#407, points 5 et
   * 8) : la part se lit sous leur nom, marquée comme retirée ; le panneau ne les propose pas.
   */
  retirees?: Array<Pick<Tirelire, 'id' | 'name'>>;
}

/** La tirelire retirée que nomme une part, s'il y en a une. */
function tirelireRetiree(l: { tirelireId?: Id | undefined }, noms: Noms): Pick<Tirelire, 'id' | 'name'> | undefined {
  if (!l.tirelireId || noms.tirelires.some((x) => x.id === l.tirelireId)) return undefined;
  return noms.retirees?.find((x) => x.id === l.tirelireId);
}

/** Ce qu'une part nomme : la tirelire, la catégorie, ou « tirelire · catégorie ». */
export function nomDeLaPart(l: { tirelireId?: Id | undefined; categoryId?: Id | undefined }, noms: Noms): string {
  const t = l.tirelireId ? (noms.tirelires.find((x) => x.id === l.tirelireId)?.name ?? tirelireRetiree(l, noms)?.name ?? 'tirelire retirée') : undefined;
  const c = l.categoryId ? (noms.categories.find((x) => x.id === l.categoryId)?.name ?? 'catégorie retirée') : undefined;
  return [t, c].filter(Boolean).join(' · ');
}

/** Une part, en positif. */
function positive(share: Share): Share {
  return share.kind === 'fixed' ? { kind: 'fixed', amount: Math.abs(share.amount) } : share;
}

/**
 * La ventilation d'un ordre de `montant` (positif) : une ligne par part, par le calcul même de
 * l'opération qui reprend une occurrence de l'ordre (`resolveShares`, #393 point 2), et le non
 * affecté. Les parts peuvent être signées : elles se lisent en positif.
 */
export function lireVentilation(montant: Cents, allocation: AllocationLine[] | undefined, noms: Noms): LectureDeVentilation {
  const parts = (allocation ?? []).map((l, i) => ({ ...l, share: positive(l.share), id: `p${i}`, operationId: 'ordre' }) as SubOperation);
  const resolus = resolveShares(Math.abs(montant), parts);
  const lignes = parts.map((p) => ({
    nom: nomDeLaPart(p, noms),
    forme: p.share.kind === 'fixed' ? 'part fixe' : p.share.kind === 'percent' ? `${String(p.share.pct).replace('.', ',')} %` : 'le reste',
    montant: resolus.get(p.id) ?? 0,
    ...(p.tirelireId ? { tirelireId: p.tirelireId } : {}),
    share: p.share,
    ...(tirelireRetiree(p, noms) ? { retiree: true as const } : {}),
  }));
  return { lignes, nonAffecte: Math.abs(montant) - lignes.reduce((s, l) => s + l.montant, 0) };
}

/** La ligne du non affecté, ou rien quand il est nul (point 1 de #394). */
export function ligneNonAffecte(nonAffecte: Cents, compte: string): { libelle: string; detail?: string } | undefined {
  if (nonAffecte === 0) return undefined;
  const libelle = `Non affecté sur « ${compte} »`;
  return nonAffecte < 0 ? { libelle, detail: `les parts dépassent le montant de ${money(-nonAffecte)}` } : { libelle };
}

// ---------------------------------------------------------------------------
// Le panneau de correction
// ---------------------------------------------------------------------------

export type FormeDeLaPart = Share['kind'];

/** Une part telle que le panneau la montre : ses champs en texte. */
export interface PartEnSaisie {
  tirelireId: Id | '';
  categoryId: Id | '';
  forme: FormeDeLaPart;
  /** Un montant en euros pour une part fixe, un pourcentage pour une part en pourcentage. */
  valeur: string;
}

/** Les parts d'une ventilation, en saisie. */
export function enSaisie(allocation: AllocationLine[] | undefined): PartEnSaisie[] {
  return (allocation ?? []).map((l) => ({
    tirelireId: l.tirelireId ?? '',
    categoryId: l.categoryId ?? '',
    forme: l.share.kind,
    valeur: l.share.kind === 'fixed' ? centsToInput(Math.abs(l.share.amount)) : l.share.kind === 'percent' ? String(l.share.pct).replace('.', ',') : '',
  }));
}

/** Une part fixe ou un pourcentage absent, nul ou négatif se lit `undefined`. */
function pourcentage(s: string): number | undefined {
  const t = s.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  return n > 0 ? n : undefined;
}

/**
 * Les parts en saisie, lues telles qu'elles sont, sans rien refuser : de quoi dire chaque part dans
 * le panneau pendant qu'on la remplit (#408, point 2). Une part dont le montant ou le pourcentage
 * manque vaut zéro ; `validerCorrection` seule décide de ce qui s'écrit.
 */
export function allocationDeSaisie(parts: PartEnSaisie[]): AllocationLine[] {
  return parts.map((p) => {
    const share: Share =
      p.forme === 'fixed' ? { kind: 'fixed', amount: Math.max(inputToCents(p.valeur) ?? 0, 0) } : p.forme === 'percent' ? { kind: 'percent', pct: pourcentage(p.valeur) ?? 0 } : { kind: 'variable' };
    return { ...(p.tirelireId ? { tirelireId: p.tirelireId } : {}), ...(p.categoryId ? { categoryId: p.categoryId } : {}), share };
  });
}

export type Correction = { ok: true; montant: Cents; allocation: AllocationLine[] } | { ok: false; message: string };

/**
 * Ce que le panneau écrit, ou le refus qui nomme ce qui ne va pas (point 4 de #394, D27, D85). Des
 * parts qui dépassent le montant ne sont pas refusées : la lecture le dit.
 */
export function validerCorrection(montantTexte: string, parts: PartEnSaisie[], noms: Noms): Correction {
  const montant = inputToCents(montantTexte);
  if (montant === undefined || montant <= 0) return { ok: false, message: 'Indiquez le montant de l’ordre, en euros, plus grand que zéro.' };
  if (parts.filter((p) => p.forme === 'variable').length > 1)
    return { ok: false, message: 'Une seule part peut prendre le reste : choisissez une autre forme pour les autres.' };
  const allocation: AllocationLine[] = [];
  for (const [i, p] of parts.entries()) {
    const n = `La part ${i + 1}`;
    if (!p.tirelireId && !p.categoryId) return { ok: false, message: `${n} ne nomme ni tirelire ni catégorie : choisissez-en au moins une.` };
    const nom = `${n} (${nomDeLaPart({ tirelireId: p.tirelireId || undefined, categoryId: p.categoryId || undefined }, noms)})`;
    let share: Share;
    if (p.forme === 'fixed') {
      const c = inputToCents(p.valeur);
      if (c === undefined || c <= 0) return { ok: false, message: `${nom} : indiquez son montant, en euros, plus grand que zéro.` };
      share = { kind: 'fixed', amount: c };
    } else if (p.forme === 'percent') {
      const pct = pourcentage(p.valeur);
      if (pct === undefined) return { ok: false, message: `${nom} : indiquez son pourcentage, plus grand que zéro.` };
      if (pct > 100) return { ok: false, message: `${nom} : un pourcentage ne dépasse pas 100.` };
      share = { kind: 'percent', pct };
    } else share = { kind: 'variable' };
    allocation.push({ ...(p.tirelireId ? { tirelireId: p.tirelireId } : {}), ...(p.categoryId ? { categoryId: p.categoryId } : {}), share });
  }
  return { ok: true, montant, allocation };
}

/** Les parts lues en positif, dans le signe de l'ordre `flow`. */
export function ventilationSignee(allocation: AllocationLine[], sign: 1 | -1): AllocationLine[] {
  return allocation.map((l) => ({ ...l, share: l.share.kind === 'fixed' ? { kind: 'fixed', amount: sign * Math.abs(l.share.amount) } : l.share }));
}

/**
 * L'ordre `flow` avec exactement le montant et les parts que montre le panneau, le reste de l'ordre
 * gardé — ancrage, nom, sélection, état (#393, point 10).
 */
export function avecVentilation(flow: PlannedFlow, montant: Cents, allocation: AllocationLine[]): PlannedFlow {
  const sign: 1 | -1 = flow.amount > 0 ? 1 : -1;
  const state = flow.action?.state;
  const action = { ...(allocation.length ? { allocation: ventilationSignee(allocation, sign) } : {}), ...(state ? { state } : {}) };
  const next: PlannedFlow = { ...flow, amount: sign * montant };
  delete next.kept; // corriger l'ordre met fin au choix de le garder tel quel (#205, point 7)
  if (Object.keys(action).length) next.action = action;
  else delete next.action;
  return next;
}
