/**
 * Propositions de budget pour l'assistant (D43).
 *
 * Une page blanche ne dit pas ce qu'on attend de vous : « qu'est-ce qui ne tombe pas tous les
 * mois ? » est une bonne question, mais on n'y répond bien qu'en voyant des exemples.
 *
 * Ces propositions sont **entièrement dérivées du jeu d'exemple** (`example.ts`), qui en est la
 * seule source : rien n'est écrit en double ici. Étoffer l'exemple — ce que le lot 8 prévoit —
 * enrichit donc l'assistant du même geste, et aucune des deux listes ne peut prendre du retard sur
 * l'autre. En contrepartie, l'exemple porte une seconde responsabilité : ses libellés sont lus par
 * quelqu'un qui découvre l'application, et ses montants sont les ordres de grandeur qu'on lui
 * propose.
 *
 * Rien n'est imposé : une proposition remplit le formulaire, que l'utilisateur corrige avant
 * d'ajouter.
 */
import { parseDate } from './dates.js';
import { exampleLedger } from './example.js';
import { alive, type Cents } from './model.js';

export interface IncomeSuggestion {
  name: string;
  amount: Cents;
  intervalMonths: number;
  day: number;
}

export interface ChargeSuggestion {
  name: string;
  amount: Cents;
  intervalMonths: number;
  day: number;
}

export interface EverydaySuggestion {
  name: string;
  amount: Cents;
  /** Report du reliquat en fin de période (D05). */
  keep: boolean;
}

export interface PeriodicSuggestion {
  name: string;
  amount: Cents;
  intervalMonths: number;
  /** Mois et jour de l'échéance ; l'année est celle de la prochaine occurrence. */
  month: number;
  day: number;
}

export interface SavingsSuggestion {
  name: string;
  monthly: Cents;
  target?: Cents;
}

export interface BudgetSuggestions {
  incomes: IncomeSuggestion[];
  charges: ChargeSuggestion[];
  everyday: EverydaySuggestion[];
  periodic: PeriodicSuggestion[];
  savings: SavingsSuggestion[];
}

/** Propositions à offrir dans l'assistant, l'exemple d'abord puis quelques cas fréquents. */
export function budgetSuggestions(): BudgetSuggestions {
  const l = exampleLedger();
  const flows = alive(l.plannedFlows);
  const needs = alive(l.needs);
  const nameOf = (tirelireId: string | undefined) =>
    alive(l.tirelires).find((t) => t.id === tirelireId)?.name ?? '';

  const incomes: IncomeSuggestion[] = flows
    .filter((f) => f.kind === 'income')
    .map((f) => ({
      name: f.name,
      amount: Math.abs(f.amount),
      intervalMonths: f.periodicity.intervalMonths,
      day: parseDate(f.periodicity.anchorDate).d,
    }));

  const charges: ChargeSuggestion[] = flows
    .filter((f) => f.kind === 'fixedCharge')
    .map((f) => ({
      name: f.name,
      amount: Math.abs(f.amount),
      intervalMonths: f.periodicity.intervalMonths,
      day: parseDate(f.periodicity.anchorDate).d,
    }));

  const everyday: EverydaySuggestion[] = needs
    .filter((n) => n.kind === 'recurring')
    .map((n) => ({
      name: nameOf(n.tirelireId),
      amount: n.amount ?? 0,
      keep: alive(l.tirelires).find((t) => t.id === n.tirelireId)?.rollover?.mode !== 'none',
    }));

  const periodic: PeriodicSuggestion[] = needs
    .filter((n) => n.kind === 'dueDate')
    .map((n) => {
      const { m, d } = parseDate(n.periodicity?.anchorDate ?? '2027-01-01');
      return {
        name: nameOf(n.tirelireId),
        amount: n.amount ?? 0,
        intervalMonths: n.periodicity?.intervalMonths ?? 12,
        month: m,
        day: d,
      };
    });

  const savings: SavingsSuggestion[] = needs
    .filter((n) => n.kind === 'goal')
    .map((n) => ({
      name: nameOf(n.tirelireId),
      monthly: n.monthlyAmount ?? 0,
      ...(n.amount !== undefined ? { target: n.amount } : {}),
    }));

  return { incomes, charges, everyday, periodic, savings };
}

/**
 * Prochaine occurrence d'un jour et d'un mois donnés, à partir de `from` : l'assistant s'en sert
 * pour dater l'échéance proposée sans demander l'année.
 */
export function nextDueDate(month: number, day: number, from: string): string {
  const { y, m, d } = parseDate(from);
  const year = month > m || (month === m && day >= d) ? y : y + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
