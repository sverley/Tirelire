/**
 * Le rappel de sauvegarde (C5, #41). Sans serveur, rien ne garde de copie des données hors des
 * appareils : l'application rappelle d'en enregistrer une, au rythme de la période budgétaire (D02),
 * celui de l'usage projeté — un import par mois.
 *
 * Une synchronisation n'en dispense pas : elle se date à part, et n'entre pas ici.
 */
import { addDays, diffDays, minDate } from './dates.js';
import type { ISODate } from './model.js';
import { budgetPeriodContaining, nextPeriod } from './periods.js';

/** La dernière sauvegarde de cette instance : son jour, et la marque des données qu'elle portait. */
export interface DerniereSauvegarde {
  date: ISODate;
  /** `LedgerStore.dataMark()` au moment de l'enregistrement. */
  marque: string;
}

/**
 * Le même jour, une période budgétaire plus tard : la même place dans la période suivante, ou son
 * dernier jour si elle est plus courte. `debutPeriode = 1` redonne le mois calendaire.
 */
export function unePeriodeApres(date: ISODate, debutPeriode: number): ISODate {
  const p = budgetPeriodContaining(date, debutPeriode);
  const n = nextPeriod(p, debutPeriode);
  return minDate(addDays(n.start, diffDays(p.start, date)), n.end);
}

/**
 * Faut-il rappeler d'enregistrer une copie ? Jamais sauvegardé : dès qu'il y a des données. Après une
 * sauvegarde : quand les données ont changé depuis, et qu'elle date de plus d'une période budgétaire.
 *
 * `marque` est celle des données d'aujourd'hui, vide tant que rien n'a été saisi.
 */
export function sauvegardeARappeler(o: { derniere: DerniereSauvegarde | undefined; marque: string; aujourdhui: ISODate; debutPeriode: number }): boolean {
  if (!o.marque) return false;
  if (!o.derniere) return true;
  if (o.derniere.marque === o.marque) return false;
  return o.aujourdhui > unePeriodeApres(o.derniere.date, o.debutPeriode);
}
