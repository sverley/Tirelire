import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { revealed } from '../src/lib/actions';

/**
 * `revealed` est ce qui empêche le défaut de revenir : le panneau s'ouvre sous la ligne modifiée,
 * donc sous le pli dès qu'on édite une ligne en bas d'écran. jsdom n'implémente pas
 * `scrollIntoView` — on l'espionne, ce qui suffit à vérifier le contrat.
 */
describe('action revealed', () => {
  let noeud: HTMLElement;
  let amene: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    noeud = document.createElement('div');
    amene = vi.fn();
    noeud.scrollIntoView = amene;
    document.body.append(noeud);
    window.matchMedia = ((requete: string) => ({ matches: false, media: requete })) as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('amène le panneau à l’écran au rendu suivant', () => {
    revealed(noeud);
    expect(amene).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(amene).toHaveBeenCalledTimes(1);
  });

  it('déplace le moins possible : rien si le panneau est déjà visible', () => {
    revealed(noeud);
    vi.advanceTimersByTime(50);
    // `nearest` est ce qui distingue « amener à l'écran » de « recentrer la page ».
    expect(amene.mock.calls[0]?.[0]).toMatchObject({ block: 'nearest' });
  });

  it('renonce à l’animation quand le mouvement est réduit', () => {
    window.matchMedia = ((requete: string) => ({ matches: true, media: requete })) as typeof window.matchMedia;
    revealed(noeud);
    vi.advanceTimersByTime(50);
    expect(amene.mock.calls[0]?.[0]).toMatchObject({ behavior: 'auto' });
  });
});
