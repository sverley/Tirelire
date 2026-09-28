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
import { HLC_COLUMN, TABLES } from './schema.js';
import type { LedgerStore } from './store.js';

/**
 * Une marque de l'état des données : elle change à chaque écriture qui touche le fichier, locale ou
 * reçue d'une autre instance, et deux états identiques ont la même. Chaque écriture date sa ligne
 * d'une horloge qui n'a jamais servi (D58) : l'ensemble des couples (ligne, horloge) dit l'état sans
 * lire les valeurs. Vide tant que personne n'a rien écrit — le compte principal par défaut n'a pas
 * d'horloge (D40). Elle ne lit que le fichier : rien de l'instance n'y entre.
 */
export function marqueDesDonnees(store: LedgerStore): string {
  const tables = [...Object.values(TABLES).map((t) => ({ nom: t.name, cle: 'id' })), { nom: 'settings', cle: 'key' }];
  let n = 0;
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (const { nom, cle } of tables) {
    for (const r of store.query(`SELECT ${cle} AS c, ${HLC_COLUMN} AS h FROM ${nom} WHERE ${HLC_COLUMN} <> '' ORDER BY ${cle}`)) {
      n++;
      const s = `${nom}\u0000${String(r['c'])}\u0000${String(r['h'])}\u0001`;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193) >>> 0;
        b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
      }
    }
  }
  return n ? `${n}.${a.toString(16)}.${b.toString(16)}` : '';
}

/** La dernière sauvegarde de cette instance : son jour, et la marque des données qu'elle portait. */
export interface DerniereSauvegarde {
  date: ISODate;
  /** `marqueDesDonnees` au moment de l'enregistrement. */
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
