/**
 * Édition manuelle d'une opération (D22, D27, D88).
 *
 * C'est la modification qui change l'état, pas l'ouverture de l'éditeur : toute écriture passe
 * par ici et verrouille l'opération, ce qui la met hors d'atteinte des règles. Le déverrouillage
 * est le seul geste qui la leur rend, et il n'appartient qu'à l'utilisateur.
 *
 * Une opération se divise en sous-opérations, et chaque sous-opération peut se diviser à son tour.
 * Une division est à parts : une seule part variable, qui prend le reste. Les parts sont validées
 * ici plutôt que dans l'interface, pour que l'invariant tienne aussi quand une règle ou une action
 * groupée écrit une ventilation.
 */
import type { Cents, SubOperation, Id, ISODate, Operation, ReplenishmentKind, Share } from './model.js';
import { alive } from './model.js';
import type { Ledger } from './model.js';
import { emptyPatch, type Patch } from './matching.js';
import { uuidv7 } from './ids.js';
import { descendantsOf, divisionOf, liveSubOperations, subOperationAmount } from './suboperations.js';

/** Sous-opération demandée dans une division : sans identifiant, elle est créée. */
export interface SubOperationDraft {
  id?: Id;
  categoryId?: Id;
  tirelireId?: Id;
  share: Share;
  /** Cette sous-opération renfloue la tirelire (D49). */
  replenishment?: ReplenishmentKind;
  /** Date propre de la sous-opération (#184) : seule une part de lissage en porte une. */
  date?: ISODate;
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
 * Valide une division à parts (D27) d'un niveau de montant `amount` : au plus une part variable,
 * pourcentages entre 0 et 100, parts fixes dans le sens de l'opération, et somme des parts fixes
 * et pourcentages qui ne dépasse pas le montant du niveau.
 *
 * Un niveau de montant nul n'a pas de sens : ses parts fixes vont dans l'un ou l'autre, et le reste
 * de la division prend l'opposé. C'est la forme d'un lissage décidé, qui fait passer de l'argent du
 * non affecté à la tirelire sans changer le compte réel (D88, #184).
 */
export function validateShares(amount: Cents, drafts: SubOperationDraft[]): void {
  if (drafts.filter((d) => d.share.kind === 'variable').length > 1)
    throw new EditError('Une seule part variable par division.');
  for (const d of drafts) {
    if (d.share.kind === 'percent' && (d.share.pct < 0 || d.share.pct > 100))
      throw new EditError('Un pourcentage se situe entre 0 et 100.');
  }
  if (amount === 0) return;
  const sign = amount < 0 ? -1 : 1;
  const used = drafts.reduce((s, d) => {
    if (d.share.kind === 'fixed') return s + d.share.amount;
    if (d.share.kind === 'percent') return s + Math.round((amount * d.share.pct) / 100);
    return s;
  }, 0);
  if (drafts.some((d) => d.share.kind === 'fixed' && sign * d.share.amount < 0))
    throw new EditError("Une part fixe va dans le sens de l'opération.");
  if (sign * used > sign * amount) throw new EditError('Les parts dépassent le montant qu’elles divisent.');
}

function sameSubOperation(a: SubOperation, b: SubOperation): boolean {
  return (
    (a.parentId ?? undefined) === (b.parentId ?? undefined) &&
    (a.categoryId ?? undefined) === (b.categoryId ?? undefined) &&
    (a.tirelireId ?? undefined) === (b.tirelireId ?? undefined) &&
    (a.replenishment ?? undefined) === (b.replenishment ?? undefined) &&
    (a.date ?? undefined) === (b.date ?? undefined) &&
    JSON.stringify(a.share) === JSON.stringify(b.share)
  );
}

/**
 * Remplace une division d'une opération — celle de l'opération elle-même, ou celle de la
 * sous-opération `parentId`, à tout niveau — et verrouille l'opération. Les sous-opérations absentes
 * du brouillon sont retirées, avec tout ce qu'elles contiennent ; celles qui restent gardent ce
 * qu'elles contiennent, et seules les sous-opérations qui changent s'écrivent, si bien que deux
 * instances qui modifient deux niveaux différents d'une même opération n'écrivent pas les mêmes
 * lignes (D58). Une division vide vaut une part variable non classée (D27) : le niveau garde tout
 * son montant, et ce qui vaut pour lui.
 */
export function editDivision(
  ledger: Ledger,
  operationId: Id,
  drafts: SubOperationDraft[],
  changes: Partial<Omit<Operation, 'id' | 'state'>> = {},
  parentId?: Id,
): Patch {
  const op = alive(ledger.operations).find((o) => o.id === operationId);
  if (!op) throw new EditError('Opération introuvable.');
  const subs = liveSubOperations(ledger.subOperations).filter((s) => s.operationId === operationId);
  const amount = parentId === undefined ? op.amount : subOperationAmount(op, subs, parentId);
  if (amount === undefined) throw new EditError('Sous-opération introuvable.');
  validateShares(amount, drafts);
  const existing = divisionOf(subs, operationId, parentId);
  const byId = new Map(existing.map((s) => [s.id, s]));
  const elsewhere = new Set(ledger.subOperations.filter((s) => !byId.has(s.id)).map((s) => s.id));
  for (const d of drafts) {
    if (d.id && elsewhere.has(d.id)) throw new EditError('Cette sous-opération n’appartient pas à la division modifiée.');
  }
  const patch = emptyPatch();
  patch.operations.push(manualEdit(op, changes));
  const keep = new Set<Id>();
  for (const d of drafts) {
    const sub: SubOperation = {
      id: d.id ?? uuidv7(),
      operationId,
      ...(parentId ? { parentId } : {}),
      share: d.share,
      ...(d.categoryId ? { categoryId: d.categoryId } : {}),
      ...(d.tirelireId ? { tirelireId: d.tirelireId } : {}),
      ...(d.replenishment ? { replenishment: d.replenishment } : {}),
      ...(d.date ? { date: d.date } : {}),
    };
    keep.add(sub.id);
    const before = byId.get(sub.id);
    if (!before || !sameSubOperation(before, sub)) patch.subOperations.push(sub);
  }
  const removed = existing.filter((s) => !keep.has(s.id));
  patch.removedSubOperations = [...removed, ...removed.flatMap((s) => descendantsOf(subs, s.id))].map((s) => s.id);
  return patch;
}
