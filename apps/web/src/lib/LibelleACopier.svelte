<!--
  Un libellé à recopier chez la banque, avec son geste « Copier » (#13, point 6) : ce qui se copie est
  ce qui se lit, caractère pour caractère, blancs compris. Sans presse-papiers, le geste dit que rien
  n'a été copié et sélectionne le libellé, qui se copie à la main (C2). Écrit une fois, pour le résumé
  de l'assistant et la carte d'un compte de l'écran Plan.
-->
<script lang="ts">
  import { copierTexte } from './consigneOrdre';

  let { libelle }: { libelle: string } = $props();

  let etat = $state<'' | 'copie' | 'echec'>('');
  let champ = $state<HTMLElement | undefined>(undefined);

  async function copier() {
    if (await copierTexte(libelle)) {
      etat = 'copie';
      return;
    }
    etat = 'echec';
    const choix = typeof window !== 'undefined' ? window.getSelection() : null;
    if (champ && choix) {
      const plage = document.createRange();
      plage.selectNodeContents(champ);
      choix.removeAllRanges();
      choix.addRange(plage);
    }
  }
</script>

<div class="libelle-a-copier">
  <div class="ligne-libelle">
    <div class="quoi">
      <span class="muted small">Libellé à recopier chez votre banque</span>
      <span class="libelle num" bind:this={champ}>{libelle}</span>
    </div>
    <button class="btn small" type="button" aria-label={`Copier le libellé ${libelle}`} onclick={copier}>Copier</button>
  </div>
  {#if etat === 'copie'}
    <p class="small retour" role="status">Libellé copié.</p>
  {:else if etat === 'echec'}
    <p class="small retour neg" role="status">Rien n’a été copié : le libellé est sélectionné, copiez-le à la main.</p>
  {/if}
</div>

<style>
  .libelle-a-copier { margin: 6px 0; }
  .ligne-libelle { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
  .quoi { flex: 1 1 12em; min-width: 0; display: flex; flex-direction: column; }
  /* Le libellé se lit en entier, blancs compris, et se sélectionne d'un geste (C2, C9). */
  .libelle { white-space: pre-wrap; overflow-wrap: anywhere; user-select: all; -webkit-user-select: all; font-weight: 600; }
  .retour { margin: 2px 0 0; }
</style>
