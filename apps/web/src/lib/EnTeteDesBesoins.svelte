<!-- L'en-tête des colonnes des lignes d'un genre de besoin : il partage la grille des lignes (D46, #361). -->
<script lang="ts">
  import type { NeedKind } from '@tirelire/core';
  let { kind }: { kind: NeedKind } = $props();
</script>

{#if kind === 'recurring'}
  <div class="tete tete-courant"><span>Quoi ?</span><span class="d">Par période</span><span></span><span></span></div>
{:else if kind === 'dueDate'}
  <div class="tete tete-echeance"><span>Quoi ?</span><span class="d">Montant</span><span>Prochaine échéance</span><span></span></div>
{:else if kind === 'goal'}
  <div class="tete tete-epargne"><span>Quoi ?</span><span class="d">Par période</span><span class="d">Cible</span><span></span></div>
{:else}
  <div class="tete tete-echeance"><span>Quoi ?</span><span class="d">À reverser</span><span>Depuis le</span><span></span></div>
{/if}
