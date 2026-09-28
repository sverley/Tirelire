/**
 * Les dates de la dernière sauvegarde et de la dernière synchronisation (C5, #41).
 *
 * Elles décrivent cette instance, pas les données : elles restent à côté du fichier, avec son
 * identité et ses curseurs de relais, et ne voyagent ni par la synchronisation ni dans le fichier
 * (D58). Un fichier sauvegardé puis ouvert ailleurs y donne « jamais » pour les deux. Remplacer les
 * données — tout effacer, charger l'exemple, ouvrir un fichier — oublie la sauvegarde (`db.ts`) : ce
 * qui a été sauvegardé n'est plus ce qui est là.
 *
 * Seul un essai qui aboutit se date : une sauvegarde est un fichier des données remis à
 * l'utilisateur ; une synchronisation, un échange avec une autre instance qui a abouti — pour le
 * relais, un aller-retour dont le dépôt a été accepté.
 */
import type { DerniereSauvegarde, LedgerStore } from '@tirelire/core';
import { shortDate } from './format';

/** Clé, dans l'état de l'instance, de la dernière sauvegarde. */
export const CLE_SAUVEGARDE = 'derniere_sauvegarde';
/** Clé, dans l'état de l'instance, de la dernière synchronisation. */
export const CLE_SYNCHRONISATION = 'derniere_synchronisation';

/** Par où la synchronisation s'est faite. */
export type Moyen = 'direct' | 'relais' | 'paquet';

export interface DerniereSynchronisation {
  date: string;
  moyen: Moyen;
}

const MOYENS: Moyen[] = ['direct', 'relais', 'paquet'];
const JOUR = /^\d{4}-\d{2}-\d{2}$/;

function lire(store: LedgerStore, cle: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(store.getLocal(cle) ?? '') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function lireSauvegarde(store: LedgerStore): DerniereSauvegarde | undefined {
  const v = lire(store, CLE_SAUVEGARDE);
  return v && typeof v['date'] === 'string' && JOUR.test(v['date']) && typeof v['marque'] === 'string' ? { date: v['date'], marque: v['marque'] } : undefined;
}

export function lireSynchronisation(store: LedgerStore): DerniereSynchronisation | undefined {
  const v = lire(store, CLE_SYNCHRONISATION);
  return v && typeof v['date'] === 'string' && JOUR.test(v['date']) && MOYENS.includes(v['moyen'] as Moyen) ? { date: v['date'], moyen: v['moyen'] as Moyen } : undefined;
}

export function noterSauvegarde(store: LedgerStore, s: DerniereSauvegarde): void {
  store.setLocal(CLE_SAUVEGARDE, JSON.stringify(s));
}

export function noterSynchronisation(store: LedgerStore, s: DerniereSynchronisation): void {
  store.setLocal(CLE_SYNCHRONISATION, JSON.stringify(s));
}

const PAR: Record<Moyen, string> = { direct: 'en direct', relais: 'par le relais', paquet: 'par paquet' };

/** « 20 sept. 2026 », ou « jamais ». */
export function texteSauvegarde(s: DerniereSauvegarde | undefined): string {
  return s ? shortDate(s.date) : 'jamais';
}

/** « 20 sept. 2026, par le relais », ou « jamais ». */
export function texteSynchronisation(s: DerniereSynchronisation | undefined): string {
  return s ? `${shortDate(s.date)}, ${PAR[s.moyen]}` : 'jamais';
}

/**
 * Tirelire est en bêta tant que sa version est `v0.x` (#277) : le format du fichier peut changer à
 * la version suivante sans migration, l'ancien étant refusé en le disant (D30). Le signal sur la
 * sûreté des données le dit. `v1`, qui fige le format, fera tomber ce drapeau.
 */
export const BETA = true;
