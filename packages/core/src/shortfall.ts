/**
 * Le manque d'une échéance et sa réponse (principe 1.4, D88, #184).
 *
 * Une échéance est en manque quand le solde prévu de sa tirelire, à sa date, est négatif : ce qui ne
 * sera pas réuni à temps par sa croisière. Rien ne se lisse d'office. L'application annonce le
 * montant et la date, et propose de le lisser sur les périodes restantes avant la date, période en
 * cours comprise ; l'utilisateur accepte la proposition, la modifie ou la refuse (principe 4).
 *
 * La réponse s'enregistre, une par échéance (`ShortfallAnswer`) : le lissage retenu est une saisie de
 * montant nul divisée en sous-opérations datées sur la tirelire, qui comptent comme des dotations —
 * chaque part, à sa date, passe du non affecté du compte à la tirelire, sans changer le compte (I2) ;
 * le refus n'est pas une opération. Tant qu'une réponse existe, la proposition ne revient pas ; le
 * manque qui resterait s'annonce toujours.
 *
 * Calculer un manque ne modifie rien (I10) : seules les fonctions qui rendent une réponse écrivent,
 * et seulement ce que l'appelant enregistre.
 */
import type { Cents, Id, ISODate, Ledger, Need, Operation, ShortfallAnswer, SubOperation } from './model.js';
import { alive, dueDateFlowForNeed, needName, shortfallAnswerId } from './model.js';
import { dotationAccount, indexLedger, needCruise, tirelireBalance } from './balances.js';
import { budgetPeriodContaining, nextOccurrence, nextPeriod, type Period } from './periods.js';
import { addDays, maxDate } from './dates.js';
import { withPlannedOperations } from './forecast.js';
import { estDate } from './formes.js';
import { normalizeLabel, uuidv7 } from './ids.js';
import { emptyPatch, type Patch } from './matching.js';
import { EditError } from './edit.js';

/** Une part d'un lissage : un montant positif versé à la tirelire, à une date. */
export interface SmoothingPart {
  date: ISODate;
  amount: Cents;
}

/** Ce qu'une échéance a reçu comme réponse à son manque. */
export type ShortfallAnswerState =
  | { kind: 'smoothing'; answerId: Id; operationId: Id; parts: SmoothingPart[] }
  | { kind: 'refusal'; answerId: Id };

/** Le manque d'une échéance, ou la réponse qu'elle a reçue. */
export interface DueDateShortfall {
  needId: Id;
  tirelireId: Id;
  name: string;
  tirelireName: string;
  /** Date de l'échéance. */
  dueDate: ISODate;
  /** Ce qui manquera à la date, positif ; 0 quand le solde prévu y suffit. */
  amount: Cents;
  /** Ce que l'ordre permanent demande pour ce besoin par période : sa croisière (D60). */
  cruise: Cents;
  /** La réponse enregistrée pour cette échéance, s'il y en a une. */
  answer?: ShortfallAnswerState;
  /** La proposition de lisser : seulement en manque, et tant que l'échéance n'a pas de réponse. */
  proposal?: SmoothingPart[];
}

/** Écart, en jours, entre une échéance et le prélèvement de son besoin qui la paie (comme `reviewProvisions`). */
const FENETRE_PAIEMENT = 15;

/**
 * L'échéance que chaque besoin à échéance attend à `today` ou après, en manque ou déjà répondue :
 * montant et date du manque, réponse, et proposition de lisser tant qu'il n'y a pas de réponse.
 * Quelle que soit la façon dont l'échéance est arrivée — saisie, assistant, synchronisation,
 * sauvegarde restaurée —, elle se lit ici de la même façon.
 */
export function dueDateShortfalls(ledger: Ledger, today: ISODate): DueDateShortfall[] {
  const startDay = ledger.settings.periodStartDay;
  const current = budgetPeriodContaining(today, startDay);
  const base = indexLedger(ledger);
  const echeances: Array<{ need: Need; dueDate: ISODate }> = [];
  for (const need of alive(ledger.needs)) {
    if (need.kind !== 'dueDate' || !need.periodicity || !base.tireliresById.has(need.tirelireId)) continue;
    const dueDate = nextOccurrence(need.periodicity, maxDate(today, need.activeFrom ?? today));
    if (need.activeTo && dueDate > need.activeTo) continue;
    echeances.push({ need, dueDate });
  }
  if (echeances.length === 0) return [];

  // Un seul grand livre prévu, jusqu'au plus lointain prélèvement possible d'une échéance (D88).
  const until = addDays(echeances.reduce((m, x) => maxDate(m, x.dueDate), today), FENETRE_PAIEMENT);
  const idx = indexLedger(withPlannedOperations(ledger, today, until).ledger);
  const answers = new Map(alive(ledger.shortfallAnswers ?? []).map((a) => [a.id, a]));

  const out: DueDateShortfall[] = [];
  for (const { need, dueDate } of echeances) {
    const e = idx.tireliresById.get(need.tirelireId)!;
    const target = need.amount ?? 0;
    // Le solde prévu se lit après le prélèvement du besoin — son opération prévue, ou l'opération
    // rapprochée de son flux —, s'il en a un ; sans prélèvement, l'échéance se paie à sa date pour
    // son montant, et toute autre dépense de la tirelire s'y ajoute (#184, point 11).
    const prelevement = dueDateFlowForNeed(need, ledger.plannedFlows, dueDate);
    const paiements = prelevement
      ? (idx.entriesByTirelire.get(e.id) ?? []).filter(
          (x) =>
            x.effect < 0 &&
            x.operation.plannedFlowId === prelevement.id &&
            x.date >= addDays(dueDate, -FENETRE_PAIEMENT) &&
            x.date <= addDays(dueDate, FENETRE_PAIEMENT),
        )
      : [];
    const at = paiements.reduce((m, x) => maxDate(m, x.date), dueDate);
    const solde = tirelireBalance(e, idx, at) - (paiements.length ? 0 : target);
    const amount = Math.max(0, -solde);
    const answer = answerState(answers.get(shortfallAnswerId(need.id, dueDate)), base.operationsById, base.linesByOperation, need);
    if (amount === 0 && !answer) continue;
    out.push({
      needId: need.id,
      tirelireId: e.id,
      name: needName(need, e),
      tirelireName: e.name,
      dueDate,
      amount,
      cruise: needCruise(need),
      ...(answer ? { answer } : {}),
      ...(amount > 0 && !answer ? { proposal: proposeSmoothing(amount, current, dueDate, startDay, e.openingDate) } : {}),
    });
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.name.localeCompare(b.name, 'fr')));
}

/**
 * La réponse vivante d'une échéance. Un lissage dont la saisie n'est plus vivante ne répond plus :
 * la proposition revient (#184, point 5).
 */
function answerState(
  answer: ShortfallAnswer | undefined,
  operationsById: Map<Id, Operation>,
  linesByOperation: Map<Id, Array<{ date: ISODate; amount: Cents; tirelireId?: Id }>>,
  need: Need,
): ShortfallAnswerState | undefined {
  if (!answer) return undefined;
  if (!answer.operationId) return { kind: 'refusal', answerId: answer.id };
  if (!operationsById.has(answer.operationId)) return undefined;
  const parts = (linesByOperation.get(answer.operationId) ?? [])
    .filter((l) => l.tirelireId === need.tirelireId)
    .map((l) => ({ date: l.date, amount: l.amount }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { kind: 'smoothing', answerId: answer.id, operationId: answer.operationId, parts };
}

/**
 * La proposition de lisser `amount` (#184, point 4) : une part par période restante avant
 * `dueDate`, de `from` comprise (D02), datée du premier jour de la période, à parts égales au
 * centime, la dernière prenant le reste.
 */
export function proposeSmoothing(amount: Cents, from: Period, dueDate: ISODate, startDay: number, opening?: ISODate): SmoothingPart[] {
  // Aucune part avant l'ouverture de la tirelire, où elle ne compterait pas : la période qui la
  // contient prend le jour d'ouverture, celles qui la précèdent n'en ont pas (#184, point 10).
  const dates: ISODate[] = [];
  for (let p = from; p.start <= dueDate; p = nextPeriod(p, startDay)) {
    if (opening && p.end < opening) continue;
    dates.push(opening ? maxDate(p.start, opening) : p.start);
  }
  if (dates.length === 0) dates.push(opening ? maxDate(from.start, opening) : from.start);
  const part = Math.floor(amount / dates.length);
  return dates.map((date, i) => ({ date, amount: i === dates.length - 1 ? amount - part * (dates.length - 1) : part }));
}

/** Ce qu'une réponse écrit : les opérations et sous-opérations d'un patch, et la réponse elle-même. */
export interface AnswerWrite {
  patch: Patch;
  answer: ShortfallAnswer;
}

/**
 * Enregistre le lissage retenu pour l'échéance `dueDate` du besoin (#184, point 5) : une saisie de
 * montant nul sur le compte qui reçoit les dotations de la tirelire, divisée en une sous-opération
 * datée par part, sur la tirelire ; et la réponse qui la désigne. Les parts sont celles de la
 * proposition, ou celles que l'utilisateur a modifiées — montants et dates.
 */
export function smoothingAnswer(ledger: Ledger, needId: Id, dueDate: ISODate, parts: SmoothingPart[]): AnswerWrite {
  const need = alive(ledger.needs).find((n) => n.id === needId);
  if (!need) throw new EditError('Besoin introuvable.');
  const idx = indexLedger(ledger);
  const e = idx.tireliresById.get(need.tirelireId);
  if (!e) throw new EditError('Tirelire introuvable.');
  if (parts.length === 0) throw new EditError('Un lissage a au moins une part.');
  for (const p of parts) {
    if (!Number.isInteger(p.amount) || p.amount <= 0) throw new EditError('Chaque part d’un lissage est un montant positif.');
    if (!estDate(p.date)) throw new EditError('Chaque part d’un lissage porte une date.');
    if (p.date > dueDate) throw new EditError('Une part d’un lissage tombe au plus tard à la date de l’échéance.');
    if (p.date < e.openingDate) throw new EditError(`Une part d’un lissage tombe au plus tôt à l’ouverture de la tirelire, le ${e.openingDate}.`);
  }
  const sorted = [...parts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const label = `Lissage — ${needName(need, e)}`;
  const op: Operation = {
    id: uuidv7(),
    accountId: dotationAccount(e, idx),
    origin: 'manual',
    date: sorted[0]!.date,
    label,
    normalizedLabel: normalizeLabel(label),
    amount: 0,
    // Une décision de l'utilisateur : elle naît verrouillée, aucune règle ne la réécrit (D22).
    state: 'locked',
  };
  const subs: SubOperation[] = sorted.map((p) => ({
    id: uuidv7(),
    operationId: op.id,
    tirelireId: e.id,
    share: { kind: 'fixed', amount: p.amount },
    date: p.date,
  }));
  const patch = emptyPatch();
  patch.operations.push(op);
  patch.subOperations.push(...subs);
  return { patch, answer: { id: shortfallAnswerId(needId, dueDate), needId, dueDate, operationId: op.id } };
}

/** Enregistre le refus de lisser l'échéance (#184, point 5) : une réponse sans opération. */
export function refusalAnswer(needId: Id, dueDate: ISODate): ShortfallAnswer {
  return { id: shortfallAnswerId(needId, dueDate), needId, dueDate };
}

/**
 * Ce que retirer une réponse retire (#184, point 5) : la réponse, et pour un lissage sa saisie et
 * ses sous-opérations. La proposition revient.
 */
export function withdrawnAnswer(ledger: Ledger, answerId: Id): { answerId: Id; operationId?: Id; subOperationIds: Id[] } {
  const answer = alive(ledger.shortfallAnswers ?? []).find((a) => a.id === answerId);
  if (!answer) throw new EditError('Réponse introuvable.');
  if (!answer.operationId) return { answerId, subOperationIds: [] };
  const subOperationIds = alive(ledger.subOperations)
    .filter((s) => s.operationId === answer.operationId)
    .map((s) => s.id);
  return { answerId, operationId: answer.operationId, subOperationIds };
}

/**
 * Les manques que le plan de `period` signale (#184, point 2) : celui de la période en cours et de
 * chaque période jusqu'à la date de l'échéance, période qui la contient comprise. Une période
 * passée n'en signale aucun.
 */
export function shortfallsForPeriod(shortfalls: DueDateShortfall[], period: Period, today: ISODate): DueDateShortfall[] {
  if (period.end < today) return [];
  return shortfalls.filter((s) => s.dueDate >= period.start);
}
