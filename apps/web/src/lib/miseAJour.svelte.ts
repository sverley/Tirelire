/**
 * Une mise à jour se dit, et ne se fait qu'à la demande (#142, principe 4, C8).
 *
 * Le service worker est en mode « prompt » (`vite.config.ts`) : une nouvelle version s'installe puis
 * attend. La page qui tourne le sait (`prete`) et continue d'exécuter sa version ; l'utilisateur
 * choisit de recharger (`recharger`), ou non : la nouvelle version s'exécute alors à l'ouverture
 * suivante, quand plus aucune fenêtre de Tirelire n'exécute l'ancienne.
 *
 * La recherche d'une version plus récente se fait au chargement, et chaque fois que l'utilisateur
 * revient sur l'onglet ou l'application : jamais en arrière-plan (C6).
 */
import { registerSW } from 'virtual:pwa-register';

class MiseAJour {
  /** Une version plus récente est installée et attend. */
  prete = $state(false);
  /** L'utilisateur a remis à plus tard, pour cette version-là. */
  masquee = $state(false);

  private appliquer: ((recharger?: boolean) => Promise<void>) | undefined;
  private inscription: ServiceWorkerRegistration | undefined;
  private demarree = false;

  demarrer(): void {
    if (this.demarree || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    this.demarree = true;
    this.appliquer = registerSW({
      immediate: true,
      onNeedRefresh: () => {
        this.prete = true;
        this.masquee = false;
      },
      onRegisteredSW: (_url, inscription) => {
        if (!inscription) return;
        this.inscription = inscription;
        const chercher = () => {
          if (document.visibilityState !== 'visible' || !navigator.onLine) return;
          inscription.update().catch(() => undefined);
        };
        document.addEventListener('visibilitychange', chercher);
        window.addEventListener('focus', chercher);
      },
    });
  }

  /**
   * Recharge la page sur la nouvelle version, après avoir écrit ce qui attendait de l'être
   * (`avant`) : rien de ce qui a été saisi ne se perd.
   */
  async recharger(avant: () => Promise<void>): Promise<void> {
    await avant();
    // Une page que le service worker contrôle : la nouvelle version s'active, puis la page se
    // recharge quand elle en prend le contrôle.
    if (this.appliquer && navigator.serviceWorker.controller && this.inscription?.waiting) {
      await this.appliquer(true);
      return;
    }
    // Une page qu'il ne contrôle pas — ouverte à la première visite, jamais rechargée depuis — ne
    // voit jamais ce changement de contrôle : la nouvelle version, activée si elle attend encore,
    // s'ouvre par un simple rechargement.
    const enAttente = this.inscription?.waiting;
    if (enAttente) await activer(enAttente);
    location.reload();
  }
}

/** Active une version qui attend, et rend la main quand c'est fait, ou au plus tard après 5 s. */
function activer(sw: ServiceWorker): Promise<void> {
  return new Promise((fin) => {
    const delai = setTimeout(fin, 5000);
    sw.addEventListener('statechange', () => {
      if (sw.state === 'activated' || sw.state === 'redundant') {
        clearTimeout(delai);
        fin();
      }
    });
    sw.postMessage({ type: 'SKIP_WAITING' });
  });
}

export const miseAJour = new MiseAJour();
