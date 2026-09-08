/**
 * Petites actions Svelte partagées par les vues.
 */

/**
 * Amène l'élément dans le champ de vision quand il apparaît, en déplaçant le moins possible.
 *
 * Sert aux panneaux d'édition, qui s'ouvrent sous la ligne qu'ils modifient : sur un téléphone,
 * une ligne en bas d'écran ouvrirait sinon son formulaire sous le pli, et taper « Modifier »
 * n'aurait l'air de rien faire. `block: 'nearest'` ne bouge rien si le panneau est déjà visible.
 */
export function revealed(node: HTMLElement) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  requestAnimationFrame(() => {
    node.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  });
}
