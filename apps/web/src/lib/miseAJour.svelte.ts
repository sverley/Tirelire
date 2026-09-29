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
    if (this.appliquer) await this.appliquer(true);
    else location.reload();
  }
}

export const miseAJour = new MiseAJour();
