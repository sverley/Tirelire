/**
 * Sous-opérations (D88) : une opération se divise en sous-opérations, sur autant de niveaux qu'on
 * veut ; à chaque niveau, les parts sont celles de D27, et leurs montants s'additionnent jusqu'à
 * celui du niveau qui les contient.
 *
 * Ce qui lit une ventilation — soldes et composantes des tirelires, non affecté, bilan, plan — ne
 * lit que les **lignes comptées** (`countedLines`) : les sous-opérations qui ne se divisent plus,
 * et le reste d'une division que ses parts ne couvrent pas. Chacune porte son montant résolu et ce
 * qui vaut pour elle, pris d'elle ou du niveau qui la contient, de proche en proche. Elles
 * couvrent le montant de l'opération une fois et une seule : aucun euro ne compte deux fois.
 */
import type { Cents, Id, ISODate, Operation, ReplenishmentKind, Share, SubOperation } from './model.js';

/**
 * Ligne comptée : une sous-opération qui ne se divise plus, ou le reste d'une division. Le reste
 * de la division de l'opération elle-même, sans rien qui vaille pour lui, est son non affecté.
 */
export interface CountedLine {
  /** La sous-opération qui ne se divise plus, ou `<niveau>:reste` pour le reste d'une division. */
  id: Id;
  operationId: Id;
  /** La sous-opération comptée ; absente pour le reste d'une division. */
  subOperationId?: Id;
  /** Montant résolu, dans le signe de l'opération. */
  amount: Cents;
  /**
   * Date à laquelle la ligne compte dans sa tirelire et sa catégorie (#184) : celle de la
   * sous-opération, sinon celle du niveau qui la contient, de proche en proche, jusqu'à celle de
   * l'opération. Le compte réel, lui, bouge toujours à la date de l'opération.
   */
  date: ISODate;
  categoryId?: Id;
  tirelireId?: Id;
  replenishment?: ReplenishmentKind;
}

/** Suffixe de l'identifiant du reste d'une division. */
export const REMAINDER_SUFFIX = ':reste';

/** Les sous-opérations d'une division : celles que contient `parentId`, ou l'opération sans lui. */
export function divisionOf(subs: SubOperation[], operationId: Id, parentId?: Id): SubOperation[] {
  return subs.filter((s) => s.operationId === operationId && (s.parentId ?? undefined) === parentId);
}

/** Toutes les sous-opérations que contient `id`, à tous les niveaux sous lui. */
export function descendantsOf(subs: SubOperation[], id: Id): SubOperation[] {
  const out: SubOperation[] = [];
  const queue = [id];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const s of subs) {
      if (s.parentId === parent) {
        out.push(s);
        queue.push(s.id);
      }
    }
  }
  return out;
}

/**
 * Les sous-opérations vivantes d'un ensemble d'opérations : non supprimées, et dont chaque niveau
 * qui les contient l'est aussi, dans la même opération. Une sous-opération dont un niveau a été
 * retiré — sur cette instance ou sur une autre, avant synchronisation — est retirée avec lui :
 * aucune ne reste sans le niveau qui la contient (#297).
 */
export function liveSubOperations(subs: SubOperation[], operationIds?: Set<Id>): SubOperation[] {
  const byId = new Map(subs.map((s) => [s.id, s]));
  const live = new Map<Id, boolean>();
  const isLive = (s: SubOperation, seen: Set<Id>): boolean => {
    const known = live.get(s.id);
    if (known !== undefined) return known;
    let ok = !s.deletedAt && (!operationIds || operationIds.has(s.operationId));
    if (ok && s.parentId) {
      const parent = byId.get(s.parentId);
      // Un niveau absent, d'une autre opération, ou un cycle : la sous-opération ne tient à rien.
      ok = !!parent && parent.operationId === s.operationId && !seen.has(parent.id) && isLive(parent, new Set([...seen, s.id]));
    }
    live.set(s.id, ok);
    return ok;
  };
  return subs.filter((s) => isLive(s, new Set([s.id])));
}

/** Montant d'une part fixe ou en pourcentage d'un niveau de montant `amount` (D27). */
function shareAmount(share: Share, amount: Cents): Cents {
  if (share.kind === 'fixed') return share.amount;
  if (share.kind === 'percent') return Math.round((amount * share.pct) / 100);
  return 0;
}

/**
 * Montants résolus d'une division (D27) : une part fixe vaut son montant, une part en pourcentage
 * se calcule sur le montant du niveau qui la contient, et la part variable prend le reste, bornée
 * à zéro — jamais de signe opposé à l'opération. Les parts sont résolues dans l'ordre reçu, ce qui
 * rend le calcul déterministe et rejouable à montant inconnu d'avance.
 */
export function resolveShares(amount: Cents, division: SubOperation[]): Map<Id, Cents> {
  const out = new Map<Id, Cents>();
  let variable: SubOperation | undefined;
  for (const s of division) {
    if (s.share.kind === 'variable') {
      // Une seule part variable par division (D27) : les suivantes ne prennent rien.
      if (variable) out.set(s.id, 0);
      else variable = s;
      continue;
    }
    out.set(s.id, shareAmount(s.share, amount));
  }
  if (variable) out.set(variable.id, variableRest(amount, division));
  return out;
}

/** Reste non couvert par les parts fixes et en pourcentage d'une division, borné à zéro (D27). */
export function variableRest(amount: Cents, shares: Array<{ share: Share }>): Cents {
  const sign = amount < 0 ? -1 : 1;
  const used = shares.reduce((s, x) => s + shareAmount(x.share, amount), 0);
  const rest = amount - used;
  return sign * rest > 0 ? rest : 0;
}

/** Ce qui vaut pour un niveau : ce qu'il porte, sinon ce qui vaut pour le niveau qui le contient. */
interface Labels {
  date: ISODate;
  categoryId?: Id;
  tirelireId?: Id;
  replenishment?: ReplenishmentKind;
}

function labelsOf(s: SubOperation, above: Labels): Labels {
  const categoryId = s.categoryId ?? above.categoryId;
  const tirelireId = s.tirelireId ?? above.tirelireId;
  const replenishment = s.replenishment ?? above.replenishment;
  return {
    date: s.date ?? above.date,
    ...(categoryId ? { categoryId } : {}),
    ...(tirelireId ? { tirelireId } : {}),
    ...(replenishment ? { replenishment } : {}),
  };
}

/**
 * Lignes comptées d'une opération, à partir de ses sous-opérations vivantes (`liveSubOperations`) :
 * chaque sous-opération qui ne se divise plus, avec son montant et ce qui vaut pour elle, et, pour
 * chaque division que ses parts ne couvrent pas au centime, son reste, qui garde ce qui vaut pour
 * le niveau divisé. La somme des lignes est le montant de l'opération.
 */
export function countedLines(op: Operation, subs: SubOperation[]): CountedLine[] {
  const children = new Map<Id | undefined, SubOperation[]>();
  for (const s of subs) {
    if (s.operationId !== op.id) continue;
    const key = s.parentId ?? undefined;
    const arr = children.get(key);
    if (arr) arr.push(s);
    else children.set(key, [s]);
  }
  const out: CountedLine[] = [];
  const visit = (levelId: Id, parentId: Id | undefined, amount: Cents, labels: Labels) => {
    const division = children.get(parentId) ?? [];
    const amounts = resolveShares(amount, division);
    let used = 0;
    for (const s of division) {
      const own = amounts.get(s.id) ?? 0;
      used += own;
      const below = labelsOf(s, labels);
      if (children.has(s.id)) visit(s.id, s.id, own, below);
      else out.push({ id: s.id, operationId: op.id, subOperationId: s.id, amount: own, ...below });
    }
    if (amount - used !== 0) out.push({ id: `${levelId}${REMAINDER_SUFFIX}`, operationId: op.id, amount: amount - used, ...labels });
  };
  visit(op.id, undefined, op.amount, { date: op.date });
  return out;
}

/** Montant résolu d'une sous-opération, à tout niveau (D27), `undefined` si elle n'est pas de `op`. */
export function subOperationAmount(op: Operation, subs: SubOperation[], id: Id): Cents | undefined {
  const byId = new Map(subs.filter((s) => s.operationId === op.id).map((s) => [s.id, s]));
  const target = byId.get(id);
  if (!target) return undefined;
  const chain: SubOperation[] = [];
  for (let s: SubOperation | undefined = target; s; s = s.parentId ? byId.get(s.parentId) : undefined) chain.unshift(s);
  let amount = op.amount;
  for (const s of chain) amount = resolveShares(amount, divisionOf(subs, op.id, s.parentId)).get(s.id) ?? 0;
  return amount;
}
