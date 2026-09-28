/**
 * La persistance du stockage (C4) : demander au navigateur de garder les données de l'application,
 * et savoir ce qu'il a répondu.
 *
 * Sans cette demande, un navigateur qui manque de place peut effacer les données d'une adresse sans
 * prévenir. Chromium accorde ou refuse sans rien demander à l'utilisateur, et sa réponse peut changer
 * d'une ouverture à l'autre (une application installée l'obtient plus volontiers) : la demande se
 * refait donc à chaque ouverture tant qu'elle n'est pas accordée.
 *
 * Demander n'écrit, ne déplace ni ne renomme rien : les données restent où elles sont, et rien ne
 * sort de l'appareil (I7).
 */

/**
 * - `accordee` : le navigateur garde les données, même à court de place ;
 * - `refusee` : il ne s'y est pas engagé, et peut les effacer faute de place ;
 * - `impossible` : il n'offre pas la demande ;
 * - `inconnue` : la réponse n'est pas encore là.
 */
export type EtatPersistance = 'accordee' | 'refusee' | 'impossible' | 'inconnue';

/** Ce que l'application lit du gestionnaire de stockage : ses deux méthodes, peut-être absentes. */
interface GestionnaireStockage {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
}

function gestionnaire(): GestionnaireStockage | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator.storage as GestionnaireStockage | undefined);
}

/**
 * Lit si les données sont déjà persistantes et, sinon, le demande. Ne rejette jamais : une demande
 * qui échoue vaut un refus, puisque rien n'engage alors le navigateur à garder les données.
 */
export async function demanderPersistance(stockage = gestionnaire()): Promise<EtatPersistance> {
  const persist = typeof stockage?.persist === 'function' ? stockage.persist.bind(stockage) : undefined;
  const persisted = typeof stockage?.persisted === 'function' ? stockage.persisted.bind(stockage) : undefined;
  if (!persist && !persisted) return 'impossible';
  try {
    if (persisted && (await persisted())) return 'accordee';
    if (!persist) return 'impossible';
    return (await persist()) ? 'accordee' : 'refusee';
  } catch {
    return 'refusee';
  }
}
