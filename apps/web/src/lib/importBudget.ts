/**
 * L'entrée d'un budget JSON dans l'application (#367) : le texte que porte une adresse. La partie
 * après « # » ne quitte jamais l'appareil : le navigateur ne l'envoie à aucun serveur (I7).
 */

/** Ce que l'adresse porte avant le JSON encodé pour une adresse. */
export const ADRESSE_BUDGET = '#budget=';

/** L'adresse porte-t-elle un budget ? */
export const adressePorteUnBudget = (hash: string): boolean => hash.startsWith(ADRESSE_BUDGET);

/**
 * Le texte du JSON que porte la partie après « # » d'une adresse, ou le refus quand elle n'est pas
 * encodée pour une adresse.
 */
export function budgetDeLAdresse(hash: string): { texte: string } | { refus: string } {
  try {
    return { texte: decodeURIComponent(hash.slice(ADRESSE_BUDGET.length)) };
  } catch {
    return { refus: 'Ce budget JSON ne se lit pas : le texte de l’adresse n’est pas encodé pour une adresse (un « % » doit être suivi de deux chiffres ou lettres).' };
  }
}
