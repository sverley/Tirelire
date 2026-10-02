/**
 * La lecture du budget au Bilan (#320, D57) : les périodes à venir, la période en cours et les
 * suivantes, chacune telle que le Plan de cette période la lit (D06, D29, D52). Aucun calcul propre :
 * chaque période est `computePlan`, lu à la date où l'écran Plan le lit, et les échéances en manque
 * sont celles que le Plan annonce (`dueDateShortfalls`, #184). Une information, un seul endroit
 * (D78) : le Bilan ne fait que regrouper ce que le Plan dit, période par période, sans moyenne.
 */
import type { Cents, Id, ISODate, Ledger, NeedKind } from './model.js';
import { alive } from './model.js';
import { computePlan, type LineStatus } from './plan.js';
import { budgetPeriodContaining, nextPeriod, type Period } from './periods.js';
import { dueDateShortfalls, type DueDateShortfall } from './shortfall.js';

/** Ce qu'un besoin demande sur une période, et ce que les revenus en couvrent (lecture D06, D29). */
export interface BudgetNeedReading {
  needId: Id;
  tirelireId: Id;
  name: string;
  tirelireName: string;
  kind: NeedKind;
  /** La dotation de la période ; négative pour un besoin qui verse au budget (D48). */
  requested: Cents;
  /** Ce que les revenus de la période en couvrent. */
  funded: Cents;
  /** Ce qu'ils n'en couvrent pas : `requested − funded`, 0 pour un besoin qui verse. */
  uncovered: Cents;
  status: LineStatus;
}

export interface BudgetPeriodReading {
  period: Period;
  /** La date à laquelle le Plan lit cette période : la date de lecture dans la période en cours, son premier jour au-delà (D52). */
  asOf: ISODate;
  totals: {
    incomes: Cents;
    fixedCharges: Cents;
    /** Somme des dotations demandées. */
    requested: Cents;
    /** Part des dotations couverte par les revenus. */
    funded: Cents;
    margin: Cents;
  };
  /** Chaque besoin de la période, dans l'ordre du Plan (priorité, genre, nom). */
  needs: BudgetNeedReading[];
  /** Les besoins que les revenus ne couvrent pas entièrement, comme le Plan les signale. */
  uncovered: BudgetNeedReading[];
}

export interface BudgetReading {
  periods: BudgetPeriodReading[];
  /** Les échéances en manque, ou déjà répondues, dont la date tombe dans ces périodes : une fois chacune. */
  shortfalls: DueDateShortfall[];
}

/** Y a-t-il un budget à lire : au moins un besoin vivant, sur une tirelire vivante (D28) ? */
export function hasBudget(ledger: Ledger): boolean {
  const tirelires = new Set(alive(ledger.tirelires).map((t) => t.id));
  return alive(ledger.needs).some((n) => tirelires.has(n.tirelireId));
}

/**
 * Le budget sur `count` périodes, de celle qui contient `today` (la date de lecture) aux suivantes ;
 * `undefined` sans budget à lire. Chaque période est lue comme l'écran Plan la lit : à `today` dans
 * la période en cours, à son premier jour au-delà, les soldes étant connus jusqu'à `today` (D52).
 */
export function readBudgetAhead(ledger: Ledger, today: ISODate, count: number): BudgetReading | undefined {
  if (!hasBudget(ledger)) return undefined;
  const startDay = ledger.settings.periodStartDay;
  const periods: BudgetPeriodReading[] = [];
  let p = budgetPeriodContaining(today, startDay);
  for (let i = 0; i < count; i++) {
    const asOf = p.start <= today && today <= p.end ? today : p.start;
    const plan = computePlan(ledger, asOf, today);
    const needs = plan.lines.map(
      (l): BudgetNeedReading => ({
        needId: l.needId,
        tirelireId: l.tirelireId,
        name: l.name,
        tirelireName: l.tirelireName,
        kind: l.kind,
        requested: l.requested,
        funded: l.funded,
        uncovered: l.kind === 'payout' ? 0 : l.requested - l.funded,
        status: l.status,
      }),
    );
    const { incomes, fixedCharges, requested, funded, margin } = plan.totals;
    periods.push({
      period: plan.period,
      asOf,
      totals: { incomes, fixedCharges, requested, funded, margin },
      needs,
      uncovered: needs.filter((n) => n.uncovered > 0),
    });
    p = nextPeriod(p, startDay);
  }
  const first = periods[0]!.period.start;
  const last = periods.at(-1)!.period.end;
  const shortfalls = dueDateShortfalls(ledger, today).filter((s) => s.dueDate >= first && s.dueDate <= last);
  return { periods, shortfalls };
}
