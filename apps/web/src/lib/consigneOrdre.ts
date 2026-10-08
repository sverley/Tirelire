/**
 * Ce qu'il faut pour poser un ordre permanent chez la banque (#13) : son libellé, tel qu'il sera
 * réellement, à recopier d'un geste ; le jour où la banque doit virer, et l'écart de jours que la
 * reconnaissance admet autour (D11, D12) ; ce qui se passera ensuite (D21, D60, I10). Écrit une
 * fois, ici et dans `ConsigneOrdre.svelte` et `ExplicationSuite.svelte`, pour le résumé de
 * l'assistant et la carte d'un compte de l'écran Plan (principe 13).
 *
 * Tout se lit sur l'ordre — l'ordre enregistré, ou celui que le plan enregistrera
 * (`ordreAPoser`) — : le jour dit est celui qui s'enregistre avec lui.
 */
import { parseDate, standingTransferFlow, type Id, type Plan, type PlanTransfer, type PlannedFlow } from '@tirelire/core';
import { periodicityLabel } from './format';

/**
 * Ce qui suit la mise en place d'un ordre : affiché dans l'assistant, replié sur l'écran Plan (D94).
 * Sans import, l'ordre n'est pas « tenu pour exécuté » : il compte à sa date parce qu'il est
 * enregistré, et rien ne le dit manquant (D52 ; #13, point 7).
 */
export const EXPLICATION_SUITE =
  'Importer vos relevés n’est pas nécessaire : sans import, le plan compte l’ordre à sa date, parce qu’il est enregistré, et ne le dit jamais manquant. Si vous importez un relevé, la ligne du virement y est reconnue par son libellé et son montant, dans la tolérance de l’ordre ; l’opération prend les parts de la ventilation de l’ordre, et ce que les parts n’absorbent pas reste non affecté sur le compte qui reçoit le virement. Si votre budget change, le Plan vous dit quand modifier l’ordre chez votre banque ; il ne réécrit jamais l’ordre enregistré.';

/**
 * L'ordre que le plan propose vers le compte de `transfer`, tel que l'écran Plan l'enregistrera
 * (`standingTransferFlow`) : son montant, sa ventilation, son libellé et son ancrage. `existant`
 * est l'ordre enregistré du compte qui en a exactement un : il en garde le libellé et l'ancrage.
 * `undefined` sans proposition, ou quand le plan n'enregistrerait rien. Rien ne s'écrit (I10).
 */
export function ordreAPoser(plan: Plan, transfer: PlanTransfer, principalId: Id, existant?: PlannedFlow): PlannedFlow | undefined {
  if (!transfer.proposal) return undefined;
  return standingTransferFlow(plan, transfer, principalId, 'ordre-a-poser', transfer.proposal.amount, existant);
}

export interface Consigne {
  /** Le libellé à recopier chez la banque, caractère pour caractère ; absent si l'ordre n'en a pas. */
  libelle?: string;
  /** Le jour du mois de l'ancrage de l'ordre. */
  jour: number;
  /** Quand la banque doit virer, en mots : « le 28 de chaque mois ». */
  quand: string;
  /** L'écart de jours admis autour de ce jour, lu sur l'ordre (D12). */
  fenetre: number;
  /** Ce que la reconnaissance admet, en mots. */
  reconnaissance: string;
}

/** La consigne d'un ordre : son libellé, son jour et sa fenêtre, lus sur lui. */
export function consigneDe(f: PlannedFlow): Consigne {
  const { d } = parseDate(f.periodicity.anchorDate);
  const mensuel = f.periodicity.unit === 'month' && f.periodicity.interval === 1;
  const quand = mensuel
    ? `le ${d === 1 ? '1er' : d} de chaque mois${d > 28 ? ', ou le dernier jour du mois quand il est plus court' : ''}`
    : periodicityLabel(f.periodicity);
  const fenetre = Math.max(0, f.dateWindowDays);
  const reconnaissance =
    fenetre === 0
      ? 'un virement passé un autre jour n’est pas reconnu à l’import'
      : `un virement passé jusqu’à ${fenetre} jour${fenetre > 1 ? 's' : ''} avant ou après est reconnu à l’import ; au-delà, il ne l’est pas`;
  return { ...(f.labelPattern ? { libelle: f.labelPattern } : {}), jour: d, quand, fenetre, reconnaissance };
}

/**
 * Met `texte` dans le presse-papiers, exactement (C2) : vrai s'il y est, faux si la copie directe
 * est impossible — pas de presse-papiers, ou refusé —, et rien n'est alors copié.
 */
export async function copierTexte(texte: string): Promise<boolean> {
  const presse = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!presse?.writeText) return false;
  try {
    await presse.writeText(texte);
    return true;
  } catch {
    return false;
  }
}
