/**
 * Proposer d'installer la webapp, là où le navigateur le permet (#194).
 *
 * Chrome, sur Android comme sur ordinateur, signale par l'événement `beforeinstallprompt` qu'il peut
 * installer la page ; l'application le retient et propose l'installation elle-même. L'accepter
 * ouvre la fenêtre d'installation de Chrome : aucune commande, aucun réglage, aucune adresse (C1).
 *
 * L'installation reste une capacité propre à une plateforme (C2) : installée, ou dans un navigateur
 * qui ne l'offre pas, l'application ne propose rien, et tout se fait dans l'onglet.
 *
 * L'application propose, l'utilisateur décide (principe 4) : refusée ou remise à plus tard, la
 * proposition ne revient plus d'elle-même ; elle reste dans Plus, et dans Réglages là où
 * l'installation est conseillée. Ce choix est propre à ce navigateur, comme l'installation : il se
 * garde dans son stockage, jamais dans le fichier des données.
 */

/** Ce que Chrome passe avec `beforeinstallprompt` : ouvrir sa fenêtre, puis lire la réponse. */
interface DemandeDInstallation extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Clé, dans le stockage du navigateur, de la proposition écartée. */
const CLE_ECARTEE = 'tirelire.installationEcartee';

function lireEcartee(): boolean {
  try {
    return localStorage.getItem(CLE_ECARTEE) === '1';
  } catch {
    return false;
  }
}

class Installation {
  /** Le navigateur peut installer l'application maintenant. */
  possible = $state(false);
  /** L'application s'exécute installée, ou vient de l'être. */
  installee = $state(false);
  /** L'utilisateur a refusé ou remis à plus tard la proposition : elle ne revient plus d'elle-même. */
  ecartee = $state(lireEcartee());

  /** L'installation s'offre : dans Plus et dans Réglages. */
  offerte: boolean = $derived(this.possible && !this.installee);
  /** L'application la propose d'elle-même, sur l'accueil. */
  proposee: boolean = $derived(this.offerte && !this.ecartee);

  private demande: DemandeDInstallation | undefined;
  private demarree = false;

  demarrer(): void {
    if (this.demarree || typeof window === 'undefined') return;
    this.demarree = true;
    const autonome = typeof matchMedia === 'function' ? matchMedia('(display-mode: standalone)') : undefined;
    const lireInstallee = () =>
      !!autonome?.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    this.installee = lireInstallee();
    autonome?.addEventListener?.('change', () => (this.installee = lireInstallee()));
    window.addEventListener('beforeinstallprompt', (e) => {
      // Chrome montrerait sinon sa propre invitation : c'est l'application qui propose, à sa place.
      e.preventDefault();
      this.demande = e as DemandeDInstallation;
      this.possible = true;
    });
    window.addEventListener('appinstalled', () => {
      this.demande = undefined;
      this.possible = false;
      this.installee = true;
    });
  }

  /**
   * Ouvre la fenêtre d'installation du navigateur. Refusée, la proposition est écartée. La demande
   * ne sert qu'une fois : le navigateur en signale une autre s'il peut encore installer.
   */
  async installer(): Promise<void> {
    const demande = this.demande;
    if (!demande) return;
    this.demande = undefined;
    this.possible = false;
    try {
      await demande.prompt();
      const { outcome } = await demande.userChoice;
      if (outcome === 'accepted') this.installee = true;
      else this.ecarter();
    } catch {
      // La fenêtre n'a pas pu s'ouvrir : rien n'est installé, et l'application ne réessaie pas.
    }
  }

  /** « Plus tard » : la proposition ne revient plus d'elle-même ; Plus la garde. */
  ecarter(): void {
    this.ecartee = true;
    try {
      localStorage.setItem(CLE_ECARTEE, '1');
    } catch {
      /* stockage indisponible : écartée pour cette ouverture seulement */
    }
  }
}

export const installation = new Installation();
