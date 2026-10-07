/**
 * Ce que la validation de l'assistant va changer, dans les mots de l'utilisateur (#379, point 3) :
 * partie par partie, les ajouts, modifications et retraits de la différence que prépare le cœur
 * (#378), et les lignes que le projet a changées ailleurs pendant que l'assistant les changeait aussi.
 *
 * Sans Svelte ni navigateur : le résumé de l'assistant l'affiche.
 */
import { CLES_TABLES_BUDGET, TABLES, type CleTableBudget, type ConflitBudget, type DifferenceBudget, type LigneModele } from '@tirelire/core';
import { money } from './format';

/** Le nom de chaque partie, tel que l'assistant l'emploie. */
export const NOMS_DES_PARTIES: Record<CleTableBudget, string> = {
  accounts: 'Comptes',
  tirelires: 'Tirelires',
  needs: 'Besoins',
  categories: 'Catégories',
  plannedFlows: 'Flux prévus',
};

/** Ce que dit chaque colonne, par propriété du modèle. */
const CHAMPS: Record<string, string> = {
  name: 'nom',
  kind: 'genre',
  bank: 'banque',
  accountNumber: 'numéro de compte',
  openingBalance: 'solde de départ',
  openingDate: 'date du solde de départ',
  tracksSettlement: 'suivi du solde',
  settlementThreshold: 'seuil du solde',
  settlementDirection: 'sens du solde',
  activeFrom: 'début',
  activeTo: 'fin',
  placement: 'placement',
  rollover: 'report',
  tirelireId: 'tirelire',
  amount: 'montant',
  periodicity: 'rythme',
  monthlyAmount: 'montant par mois',
  priority: 'priorité',
  parentId: 'catégorie parente',
  nature: 'nature',
  accountId: 'compte',
  counterpartAccountId: 'compte de destination',
  categoryId: 'catégorie',
  dateWindowDays: 'marge de dates',
  amountTolerance: 'tolérance de montant',
  labelPattern: 'libellé reconnu',
  variable: 'montant variable',
  action: 'action',
};

/** Les réglages, par clé. */
const REGLAGES: Record<string, string> = {
  periodStartDay: 'Jour de début de période',
  principalCushion: 'Coussin du compte principal',
  transferThreshold: 'Seuil des virements',
  orderRounding: 'Arrondi des ordres',
};

const MONTANTS = new Set(['amount', 'openingBalance', 'monthlyAmount', 'settlementThreshold', 'principalCushion', 'transferThreshold', 'orderRounding']);

/** Une valeur, lisible : un montant en euros, une date, un nom ; une valeur composée se dit « réglée ». */
function valeurLisible(prop: string, v: unknown, nommer: (prop: string, id: string) => string | undefined): string {
  if (v === undefined || v === null || v === '') return 'vide';
  if (MONTANTS.has(prop) && typeof v === 'number') return money(v);
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  if (typeof v === 'string' && prop.endsWith('Id')) return nommer(prop, v) ?? v;
  if (typeof v === 'object') return 'réglé';
  return String(v);
}

/** Une ligne de la différence, à afficher. */
export interface LigneDite {
  texte: string;
  detail?: string;
}

export interface PartieDite {
  nom: string;
  ajouts: LigneDite[];
  modifications: LigneDite[];
  retraits: LigneDite[];
}

export interface DifferenceDite {
  parties: PartieDite[];
  reglages: LigneDite[];
  conflits: LigneDite[];
  vide: boolean;
}

/**
 * La différence et les conflits, dits. `nommer` rend le nom d'une ligne désignée (un compte, une
 * tirelire, une catégorie), pour qu'un lien se lise par son nom.
 */
export function direDifference(
  difference: DifferenceBudget,
  conflits: ConflitBudget[],
  nommer: (prop: string, id: string) => string | undefined,
): DifferenceDite {
  const nomDe = (cle: CleTableBudget, l: LigneModele): string => {
    const nom = typeof l['name'] === 'string' && l['name'] ? (l['name'] as string) : undefined;
    if (nom) return `« ${nom} »`;
    if (cle === 'needs' && typeof l['tirelireId'] === 'string') {
      const t = nommer('tirelireId', l['tirelireId'] as string);
      return t ? `le besoin de « ${t} »` : 'un besoin';
    }
    return `« ${l.id} »`;
  };
  const colonneVersProp = (cle: CleTableBudget, col: string): string => TABLES[cle]!.columns.find((c) => c.col === col)?.prop ?? col;

  const parties: PartieDite[] = [];
  for (const cle of CLES_TABLES_BUDGET) {
    const d = difference.tables[cle];
    if (!d || (!d.ajouts.length && !d.modifications.length && !d.retraits.length)) continue;
    parties.push({
      nom: NOMS_DES_PARTIES[cle],
      ajouts: d.ajouts.map((l) => ({ texte: nomDe(cle, l) })),
      modifications: d.modifications.map((m) => {
        const props = m.colonnes.map((c) => colonneVersProp(cle, c));
        const detail = props
          .map((p) => `${CHAMPS[p] ?? p} : ${valeurLisible(p, m.avant[p], nommer)} → ${valeurLisible(p, m.apres[p], nommer)}`)
          .join(' ; ');
        return { texte: nomDe(cle, m.avant['name'] !== m.apres['name'] ? m.apres : m.avant), detail };
      }),
      retraits: d.retraits.map((l) => ({ texte: nomDe(cle, l) })),
    });
  }
  const reglages = difference.reglages.map((r) => ({
    texte: REGLAGES[r.cle] ?? r.cle,
    detail: `${valeurLisible(r.cle, r.avant, nommer)} → ${valeurLisible(r.cle, r.apres, nommer)}`,
  }));

  const cleDeTable = (nom: string): CleTableBudget | undefined => CLES_TABLES_BUDGET.find((k) => TABLES[k]!.name === nom);
  const dits = conflits.map((c) => {
    if (c.table === 'settings') {
      const v = (l: LigneModele | null) => valeurLisible(c.id, l?.['value'], nommer);
      return { texte: REGLAGES[c.id] ?? c.id, detail: `retenu : ${v(c.retenue)} ; écarté : ${v(c.ecartee)}` };
    }
    const cle = cleDeTable(c.table)!;
    const ligne = (c.retenue ?? c.ecartee)!;
    const decrire = (l: LigneModele | null): string => {
      if (!l) return 'retirée';
      const props = TABLES[cle]!.columns.map((x) => x.prop).filter((p) => p !== 'id' && p !== 'deletedAt' && l[p] !== undefined);
      const autre = l === c.retenue ? c.ecartee : c.retenue;
      const differentes = autre ? props.filter((p) => JSON.stringify(l[p]) !== JSON.stringify(autre[p])) : props;
      return differentes.map((p) => `${CHAMPS[p] ?? p} ${valeurLisible(p, l[p], nommer)}`).join(', ') || 'identique';
    };
    return {
      texte: `${NOMS_DES_PARTIES[cle]} : ${nomDe(cle, ligne)}`,
      detail: `version de l’assistant retenue (${decrire(c.retenue)}) ; version écartée (${decrire(c.ecartee)})`,
    };
  });
  return { parties, reglages, conflits: dits, vide: !parties.length && !reglages.length };
}
