/**
 * Édition manuelle d'une opération (D22, D27).
 *
 * C'est la modification qui change l'état, pas l'ouverture de l'éditeur : toute écriture passe
 * par ici et verrouille l'opération, ce qui la met hors d'atteinte des règles. Le déverrouillage
 * est le seul geste qui la leur rend, et il n'appartient qu'à l'utilisateur.
 *
 * La ventilation est à parts : une seule ligne variable, qui prend le reste. Les lignes sont
 * validées ici plutôt que dans l'interface, pour que l'invariant tienne aussi quand une règle ou
 * une action groupée écrit une ventilation.
 */
import type { Allocation, Id, Operation, Share } from './model.js';
import { alive } from './model.js';
import type { Ledger } from './model.js';
import { emptyPatch, type Patch } from './matching.js';
import { uuidv7 } from './ids.js';

/** Ligne de ventilation demandée : sans identifiant, elle est créée. */
export interface AllocationDraft {
  id?: Id;
  categoryId?: Id;
  envelopeId?: Id;
  share: Share;
}

export class EditError extends Error {}

/**
 * Modification manuelle d'une opération : les champs donnés sont appliqués et l'opération est
 * verrouillée (D22). Passer `oneOff: false` efface l'attribut plutôt que de l'écrire à faux.
 */
export function manualEdit(op: Operation, changes: Partial<Omit<Operation, 'id' | 'state'>>): Operation {
  const next: Operation = { ...op, ...changes, state: 'locked' };
  if (changes.oneOff === false) delete next.oneOff;
  return next;
}

/** Rend une opération aux règles (D22, D26) : elle redevient non traitée, sans rien perdre. */
export function unlock(op: Operation): Operation {
  return { ...op, state: 'untreated' };
}

/**
 * Valide une ventilation à parts (D27) : au plus une ligne variable, pourcentages entre 0 et 100,
 * et somme des parts fixes et pourcentages qui ne dépasse pas le montant de l'opération quand il
 * n'y a pas de ligne variable pour absorber le reste.
 */
export function validateShares(op: Operation, drafts: AllocationDraft[]): void {
  if (drafts.filter((d) => d.share.kind === 'variable').length > 1)
    throw new EditError('Une seule ligne variable par ventilation.');
  for (const d of drafts) {
    if (d.share.kind === 'percent' && (d.share.pct < 0 || d.share.pct > 100))
      throw new EditError('Un pourcentage se situe entre 0 et 100.');
  }
  const sign = op.amount < 0 ? -1 : 1;
  const used = drafts.reduce((s, d) => {
    if (d.share.kind === 'fixed') return s + d.share.amount;
    if (d.share.kind === 'percent') return s + Math.round((op.amount * d.share.pct) / 100);
    return s;
  }, 0);
  if (drafts.some((d) => d.share.kind === 'fixed' && sign * d.share.amount < 0))
    throw new EditError("Une part fixe va dans le sens de l'opération.");
  if (sign * used > sign * op.amount) throw new EditError('Les parts dépassent le montant de l’opération.');
}

/**
 * Remplace la ventilation d'une opération et la verrouille. Les lignes absentes du brouillon
 * sont supprimées. Une opération sans ligne vaut une ligne variable non classée (D27) : c'est
 * donc une ventilation valide, et tout son montant pèse sur le non affecté du compte.
 */
export function editAllocations(
  ledger: Ledger,
  operationId: Id,
  drafts: AllocationDraft[],
  changes: Partial<Omit<Operation, 'id' | 'state'>> = {},
): Patch {
  const op = alive(ledger.operations).find((o) => o.id === operationId);
  if (!op) throw new EditError('Opération introuvable.');
  validateShares(op, drafts);
  const patch = emptyPatch();
  patch.operations.push(manualEdit(op, changes));
  const existing = alive(ledger.allocations).filter((a) => a.operationId === operationId);
  const keep = new Set<Id>();
  for (const d of drafts) {
    const al: Allocation = {
      id: d.id ?? uuidv7(),
      operationId,
      share: d.share,
      ...(d.categoryId ? { categoryId: d.categoryId } : {}),
      ...(d.envelopeId ? { envelopeId: d.envelopeId } : {}),
    };
    keep.add(al.id);
    patch.allocations.push(al);
  }
  patch.removedAllocations = existing.filter((a) => !keep.has(a.id)).map((a) => a.id);
  return patch;
}
