/**
 * Le virement permanent d'un couple de comptes (D21), vu par l'interface.
 *
 * Deux écrans l'offrent : le Plan, qui le montre période par période, et la dernière étape de
 * l'assistant, qui le donne à recopier chez la banque. Le geste étant le même — retrouver le flux
 * attendu déjà enregistré, sinon en fabriquer un —, il n'a qu'une écriture, ici, plutôt qu'une
 * copie par vue qui divergerait à la première correction.
 */
import {
  alive,
  standingTransferFlow,
  type Id,
  type Ledger,
  type Plan,
  type PlannedFlow,
  type PlanTransfer,
} from '@tirelire/core';

/**
 * Flux attendu déjà enregistré pour ce virement, s'il y en a un. Reconnu par son compte
 * destinataire : D21 ne prévoit qu'un virement permanent par couple de comptes.
 */
export function fluxDuVirement(ledger: Ledger, t: PlanTransfer): PlannedFlow | undefined {
  return alive(ledger.plannedFlows).find((f) => f.kind === 'transfer' && f.counterpartAccountId === t.accountId);
}

/**
 * Le flux attendu à écrire pour ce virement, ou `undefined` quand il n'y a rien à mettre en place :
 * aucune part permanente, ou pas de compte principal d'où partir.
 *
 * Un flux déjà enregistré est repris par son identifiant — on le met à jour, on n'en empile pas un
 * second à chaque appui.
 */
export function virementPermanent(ledger: Ledger, plan: Plan, t: PlanTransfer, nouvelId: Id): PlannedFlow | undefined {
  const principal = alive(ledger.accounts).find((a) => a.kind === 'principal');
  if (!principal) return undefined;
  return standingTransferFlow(plan, t, principal.id, fluxDuVirement(ledger, t)?.id ?? nouvelId);
}
