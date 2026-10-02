/**
 * Supprimer des opérations, depuis quelque écran que ce soit (Opérations, Saisie, « Retirer la
 * correction » du Plan).
 *
 * Une saisie qu'une opération reprend ne se supprime pas tant que la reprise tient (#306, point 9) :
 * l'application le dit, et propose de défaire d'abord la reprise. La reprise défaite, la saisie se
 * supprime, et l'occurrence qu'elle corrigeait ou masquait compte de nouveau.
 */
import { liveSubOperations, removalBlockers, undoResumption } from '@tirelire/core';
import { app } from './state.svelte';
import { shortDate } from './format';

/**
 * Supprime ces opérations et leurs sous-opérations. `question`, si elle est donnée, se pose avant ;
 * une reprise qui tient pose la sienne à la place. Rend `true` si la suppression a eu lieu.
 */
export function supprimerOperations(ids: string[], question?: string): boolean {
  const reprises = removalBlockers(app.ledger, ids);
  if (reprises.length) {
    const qui = reprises.map((o) => `« ${o.label} » du ${shortDate(o.date)}`).join(', ');
    const texte = `Cette saisie est reprise par ${qui} : elle ne se supprime pas tant que la reprise tient.\n\nDéfaire d’abord la reprise, puis supprimer la saisie ?`;
    if (!confirm(texte)) return false;
    for (const o of reprises) app.applyPatch(undoResumption(app.ledger, o.id));
  } else if (question && !confirm(question)) return false;
  const cibles = new Set(ids);
  for (const s of liveSubOperations(app.ledger.subOperations)) if (cibles.has(s.operationId)) app.store.remove('subOperations', s.id);
  for (const id of ids) app.remove('operations', id);
  return true;
}
